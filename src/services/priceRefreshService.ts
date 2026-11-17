import { supabase } from '../lib/supabase';
import { stockPriceService } from './stockPriceService';
import type { DCFInputs } from '../types';

/**
 * The one shared price-refresh path for the watchlist and the portfolio.
 *
 * Before this, each tab refreshed its own stored prices: the watchlist
 * wrote saved_stocks.current_price (+ price history) and the portfolio
 * wrote portfolio_stocks.current_price. The daily 9 AM run only clicks
 * the watchlist button, so the portfolio's stored prices went stale.
 *
 * Now the portfolio *derives* its displayed price instead of trusting
 * its stored column:
 *
 *   1. watchlist price (saved_stocks.current_price) when the holding's
 *      ticker is in the watchlist — the watchlist is the source of truth;
 *   2. a live Finnhub fetch (via the existing stockPriceService, with
 *      its 4-hour cache and rate limiting) when the ticker is not in
 *      the watchlist;
 *   3. the stored portfolio_stocks.current_price (last-resort fallback);
 *   4. the buy price.
 *
 * Both Update Prices buttons call refreshAllPrices below: one live fetch
 * for the union of watchlist + portfolio tickers, one write of the
 * watchlist rows (+ exactly one price-history row each), and a mirror of
 * the fresh prices into portfolio_stocks.current_price so the stored
 * fallback — and PortfolioAnalytics, which reads it directly — stays
 * fresh. Price history is written ONLY by the watchlist persist here,
 * never by the portfolio path.
 */

// ---------------------------------------------------------------------------
// Background queue persistence (moved from StockWatchlist so the
// portfolio's refresh can enqueue rate-limited tickers for the same drain).
// ---------------------------------------------------------------------------

export const PRICE_QUEUE_STORAGE_KEY = 'stockPriceUpdateQueue';
export const PRICE_QUEUE_MAX_AGE_MS = 15 * 60 * 1000; // a queue older than this is stale — drop it
export const PRICE_QUEUE_RETRY_DELAY_MS = 60 * 1000; // wait out the Finnhub minute window

export interface PersistedPriceQueue {
  symbols: string[];
  attempts: Record<string, number>;
  nextRetryAt: number; // epoch ms — earliest the queue may resume fetching
  startedAt: number;
}

export const loadPersistedPriceQueue = (): PersistedPriceQueue | null => {
  try {
    const stored = localStorage.getItem(PRICE_QUEUE_STORAGE_KEY);
    if (!stored) return null;
    const queue = JSON.parse(stored) as PersistedPriceQueue;
    if (!queue || !Array.isArray(queue.symbols) || queue.symbols.length === 0) return null;
    if (Date.now() - queue.startedAt > PRICE_QUEUE_MAX_AGE_MS) return null;
    return queue;
  } catch (error) {
    console.warn('Failed to load pending price-update queue:', error);
    return null;
  }
};

export const savePersistedPriceQueue = (queue: PersistedPriceQueue | null) => {
  try {
    if (queue === null) {
      localStorage.removeItem(PRICE_QUEUE_STORAGE_KEY);
    } else {
      localStorage.setItem(PRICE_QUEUE_STORAGE_KEY, JSON.stringify(queue));
    }
  } catch (error) {
    console.warn('Failed to save pending price-update queue:', error);
  }
};

/**
 * Merge rate-limited tickers into the persisted queue so the watchlist's
 * background drain picks them up when that tab is next opened. Symbols
 * already queued keep their attempt count (a ticker never gets fresh
 * retries just because a new refresh ran); new symbols start at one
 * attempt. Returns the saved queue, or null when given nothing.
 */
export function enqueueRateLimitedSymbols(symbols: string[]): PersistedPriceQueue | null {
  const fresh = [...new Set(symbols.map(symbol => symbol.toUpperCase()))];
  if (fresh.length === 0) return null;
  const existing = loadPersistedPriceQueue();
  const queue: PersistedPriceQueue = {
    symbols: [...new Set([...(existing?.symbols ?? []), ...fresh])],
    attempts: { ...(existing?.attempts ?? {}) },
    nextRetryAt: Date.now() + PRICE_QUEUE_RETRY_DELAY_MS,
    // A fresh enqueue proves the queue is live, so the 15-minute staleness
    // clock restarts — otherwise newly queued tickers could be dropped
    // with an old queue.
    startedAt: Date.now()
  };
  fresh.forEach(symbol => {
    if (queue.attempts[symbol] === undefined) queue.attempts[symbol] = 1;
  });
  savePersistedPriceQueue(queue);
  return queue;
}

// ---------------------------------------------------------------------------
// Watchlist reads
// ---------------------------------------------------------------------------

/** A watchlist row as needed to persist a price update. */
export interface WatchlistPriceRow {
  id?: string;
  ticker: string;
  fairValue: number;
  expectedReturn: number;
  cagr: number;
  dcf_inputs?: DCFInputs | null;
}

export interface AppliedPriceUpdate {
  id: string;
  ticker: string;
  currentPrice: number;
  expectedReturn: number;
  cagr: number;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Current watchlist prices (ticker -> price), skipping rows with no usable price. */
export async function getWatchlistPriceMap(userEmail: string): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  try {
    const { data, error } = await supabase
      .from('saved_stocks')
      .select('ticker, current_price')
      .eq('user_email', userEmail);
    if (error) throw error;
    (data ?? []).forEach(row => {
      const price = Number(row.current_price);
      if (row.ticker && Number.isFinite(price) && price > 0) {
        prices.set(String(row.ticker).toUpperCase(), price);
      }
    });
  } catch (error) {
    // A failed watchlist read must not block the portfolio: the Finnhub
    // fallback below still resolves every holding.
    console.error('Failed to load watchlist prices:', error);
  }
  return prices;
}

/** Full watchlist rows needed to persist a price update (recomputes expected return / CAGR). */
export async function getWatchlistRows(userEmail: string): Promise<WatchlistPriceRow[]> {
  const { data, error } = await supabase
    .from('saved_stocks')
    .select('id, ticker, fair_value, expected_return, cagr, dcf_inputs')
    .eq('user_email', userEmail);
  if (error) throw error;
  return (data ?? []).map(row => ({
    id: row.id as string | undefined,
    ticker: String(row.ticker).toUpperCase(),
    fairValue: Number(row.fair_value) || 0,
    expectedReturn: Number(row.expected_return) || 0,
    cagr: Number(row.cagr) || 0,
    dcf_inputs: (row.dcf_inputs ?? null) as DCFInputs | null
  }));
}

// ---------------------------------------------------------------------------
// Watchlist persist (the only writer of price history)
// ---------------------------------------------------------------------------

/**
 * Write freshly fetched prices to Supabase (saved_stocks rows + one
 * price-history row each) and return the applied updates so the caller
 * can patch the visible rows in place. Only updates that actually
 * landed are returned.
 *
 * Also mirrors each applied price into portfolio_stocks.current_price
 * for holdings of the same ticker. The stored portfolio price is only
 * the last-resort fallback (and what PortfolioAnalytics reads directly),
 * so keeping it fresh is what keeps that tab correct — the displayed
 * portfolio price is still derived from the watchlist, not stored.
 * Prices in priceMap for tickers with no watchlist row (portfolio-only
 * tickers, e.g. a successful background-queue retry) are mirrored too,
 * so the queue drain never reports completion while the stored
 * fallback for such a ticker stays stale.
 * The mirror is best effort: a failure is logged and never blocks the
 * watchlist update.
 */
export async function persistWatchlistPrices(
  userEmail: string,
  priceMap: Map<string, number>,
  stocksSnapshot: WatchlistPriceRow[]
): Promise<AppliedPriceUpdate[]> {
  const priceUpdates: AppliedPriceUpdate[] = [];

  stocksSnapshot.forEach(stock => {
    if (!stock.id) return;
    const normalizedTicker = stock.ticker.toUpperCase();
    const price = priceMap.get(normalizedTicker);
    if (price === undefined) return;
    let expectedReturn = stock.expectedReturn;
    let cagr = stock.cagr;
    if (stock.dcf_inputs && stock.dcf_inputs.projectedPrices && stock.dcf_inputs.projectedPrices.length >= 5) {
      const terminalValue = stock.dcf_inputs.projectedPrices[4];
      expectedReturn = stock.fairValue > 0
        ? (price - stock.fairValue) / stock.fairValue
        : stock.expectedReturn;
      cagr = terminalValue > 0 && price > 0
        ? Math.pow(terminalValue / price, 1 / 5) - 1
        : stock.cagr;
    }

    priceUpdates.push({
      id: stock.id,
      ticker: stock.ticker.toUpperCase(),
      currentPrice: price,
      expectedReturn,
      cagr
    });
  });

  // Batch update database - process in larger chunks to reduce round trips
  const UPDATE_BATCH_SIZE = 100;
  const successfullyUpdated: { id: string; ticker: string; currentPrice: number }[] = [];
  for (let i = 0; i < priceUpdates.length; i += UPDATE_BATCH_SIZE) {
    const batch = priceUpdates.slice(i, i + UPDATE_BATCH_SIZE);

    const updatePromises = batch.map(async update => {
      try {
        const { error } = await supabase
          .from('saved_stocks')
          .update({
            current_price: update.currentPrice,
            expected_return: update.expectedReturn,
            cagr: update.cagr,
            updated_at: new Date().toISOString()
          })
          .eq('id', update.id);

        if (error) throw error;
        return { success: true, id: update.id };
      } catch (error) {
        console.error(`Failed to update watchlist price for stock ${update.id}:`, error);
        return { success: false, id: update.id };
      }
    });

    const batchResults = await Promise.allSettled(updatePromises);
    batchResults.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value.success) {
        const update = batch[index];
        successfullyUpdated.push({ id: update.id, ticker: update.ticker, currentPrice: update.currentPrice });
      }
    });

    // Small delay between database update batches
    if (i + UPDATE_BATCH_SIZE < priceUpdates.length) {
      await sleep(100);
    }
  }

  // Record one price-history row per successfully updated stock so the
  // Day Change column and recent closes have data going forward.
  // This must never block the price update itself: failures are logged
  // and the refresh continues.
  if (successfullyUpdated.length > 0 && userEmail) {
    try {
      const { error: historyError } = await supabase
        .from('stock_price_history')
        .insert(
          successfullyUpdated.map(update => ({
            user_email: userEmail,
            ticker: update.ticker,
            price: update.currentPrice
          }))
        );

      if (historyError) throw historyError;
    } catch (historyError) {
      console.error('Failed to record price history:', historyError);
    }
  }

  // Mirror the applied prices into the stored portfolio fallback (see
  // the function comment). Best effort — never throws.
  // A portfolio-only ticker has no watchlist row, so a successful retry
  // of one lands in priceMap but never in successfullyUpdated: without
  // the extra mirror below, the queue drain would remove the ticker and
  // report completion while the stored fallback stays stale
  // (PortfolioAnalytics reads it directly).
  const mirrored = new Map<string, number>();
  successfullyUpdated.forEach(update => mirrored.set(update.ticker, update.currentPrice));
  const watchlistTickers = new Set(stocksSnapshot.map(stock => stock.ticker.toUpperCase()));
  priceMap.forEach((price, ticker) => {
    const normalizedTicker = ticker.toUpperCase();
    if (!watchlistTickers.has(normalizedTicker) && !mirrored.has(normalizedTicker)) {
      mirrored.set(normalizedTicker, price);
    }
  });
  if (mirrored.size > 0 && userEmail) {
    await mirrorPricesToPortfolio(userEmail, mirrored);
  }

  // Return only the updates that actually landed, so the caller patches
  // exactly the rows that changed.
  return priceUpdates.filter(update =>
    successfullyUpdated.some(done => done.id === update.id)
  );
}

/**
 * Write fresh prices into portfolio_stocks.current_price for holdings of
 * the given tickers. Best effort: failures are logged and never thrown,
 * because the displayed portfolio price is derived (watchlist first),
 * so a failed mirror only leaves the last-resort stored fallback stale.
 */
export async function mirrorPricesToPortfolio(
  userEmail: string,
  prices: Map<string, number>
): Promise<void> {
  if (prices.size === 0) return;
  try {
    const { data, error } = await supabase
      .from('portfolio_stocks')
      .select('id, ticker')
      .eq('user_email', userEmail);
    if (error) throw error;
    const updates = (data ?? []).flatMap(row => {
      const price = prices.get(String(row.ticker).toUpperCase());
      return price !== undefined && row.id ? [{ id: row.id as string, price }] : [];
    });
    await Promise.allSettled(updates.map(async update => {
      const { error: updateError } = await supabase
        .from('portfolio_stocks')
        .update({ current_price: update.price })
        .eq('id', update.id);
      if (updateError) throw updateError;
    }));
  } catch (error) {
    console.error('Failed to mirror prices to portfolio:', error);
  }
}

// ---------------------------------------------------------------------------
// Derived portfolio prices
// ---------------------------------------------------------------------------

export type PriceSource = 'watchlist' | 'finnhub' | 'stored' | 'buy-price';

export interface ResolvedHoldingPrice {
  price: number;
  source: PriceSource;
}

export interface PortfolioHoldingInput {
  id?: string;
  ticker: string;
  current_price?: number | null;
  buy_price: number;
}

/**
 * Resolve the displayed current price for each holding, in fallback order:
 * watchlist price -> live Finnhub fetch (non-watchlist tickers only) ->
 * stored portfolio_stocks.current_price -> buy price.
 *
 * The Finnhub fetch goes through the existing stockPriceService (same
 * 4-hour cache and rate limiting as the watchlist). With forceRefresh,
 * a failed live fetch returns no price instead of serving stale cache —
 * the holding then falls through to its stored price, exactly as the
 * forceRefresh contract intends. Without forceRefresh (plain loads),
 * the cached price is used, matching the portfolio's previous behavior.
 *
 * Results are keyed by holding id (falling back to the ticker when a
 * holding has no id), not by ticker: the shared market quotes above
 * are deduplicated by ticker, but each holding's stored / buy-price
 * fallback is applied to that holding only. Keying by ticker would let
 * the last of several same-ticker holdings overwrite the fallback for
 * all of them.
 */
export async function resolvePortfolioPrices(
  holdings: PortfolioHoldingInput[],
  userEmail: string,
  options: { forceRefresh?: boolean } = {}
): Promise<Map<string, ResolvedHoldingPrice>> {
  const watchlistPrices = await getWatchlistPriceMap(userEmail);
  const missing = [...new Set(holdings.map(holding => holding.ticker.toUpperCase()))]
    .filter(ticker => !watchlistPrices.has(ticker));
  const fetched = new Map<string, number>();
  if (missing.length > 0) {
    const outcomes = await stockPriceService.fetchPricesWithOutcomes(missing, {
      forceRefresh: options.forceRefresh ?? false
    });
    outcomes.forEach((result, symbol) => {
      if (result.outcome === 'updated' && result.price) {
        fetched.set(symbol, result.price.price);
      }
    });
  }

  const resolved = new Map<string, ResolvedHoldingPrice>();
  holdings.forEach(holding => {
    const ticker = holding.ticker.toUpperCase();
    const key = holding.id ?? ticker;
    const watchlistPrice = watchlistPrices.get(ticker);
    if (watchlistPrice !== undefined) {
      resolved.set(key, { price: watchlistPrice, source: 'watchlist' });
      return;
    }
    const finnhubPrice = fetched.get(ticker);
    if (finnhubPrice !== undefined) {
      resolved.set(key, { price: finnhubPrice, source: 'finnhub' });
      return;
    }
    const stored = Number(holding.current_price);
    if (Number.isFinite(stored) && stored > 0) {
      resolved.set(key, { price: stored, source: 'stored' });
      return;
    }
    resolved.set(key, { price: Number(holding.buy_price) || 0, source: 'buy-price' });
  });
  return resolved;
}

// ---------------------------------------------------------------------------
// The shared refresh — called by both Update Prices buttons
// ---------------------------------------------------------------------------

export interface RefreshAllResult {
  /** Fresh prices fetched live (force refresh), keyed by uppercase ticker. */
  prices: Map<string, number>;
  /** Tickers whose live fetch was rate-limited (caller queues them for retry). */
  rateLimited: string[];
  /** Tickers whose live fetch failed outright (no usable price data). */
  failed: string[];
  /** Watchlist rows whose new prices actually landed in saved_stocks. */
  appliedWatchlist: AppliedPriceUpdate[];
}

/**
 * One live refresh for both places: fetch the union of watchlist and
 * portfolio tickers from Finnhub (force refresh, so the 4-hour cache is
 * bypassed), persist the watchlist rows (+ one price-history row each),
 * and mirror every fresh price into the stored portfolio fallback.
 *
 * The caller owns what happens next with rate-limited tickers: the
 * watchlist queues them for its background drain, the portfolio
 * enqueues them the same way. Failed tickers are reported, never
 * silently papered over with a stale price.
 */
export async function refreshAllPrices(
  userEmail: string,
  watchlistSnapshot?: WatchlistPriceRow[]
): Promise<RefreshAllResult> {
  const snapshot = watchlistSnapshot ?? (await getWatchlistRows(userEmail));
  const watchlistTickers = new Set(snapshot.map(row => row.ticker.toUpperCase()));

  let portfolioTickers: string[] = [];
  try {
    const { data, error } = await supabase
      .from('portfolio_stocks')
      .select('ticker')
      .eq('user_email', userEmail);
    if (error) throw error;
    portfolioTickers = (data ?? []).map(row => String(row.ticker).toUpperCase());
  } catch (error) {
    // A failed portfolio read must not block the watchlist refresh.
    console.error('Failed to load portfolio tickers for price refresh:', error);
  }

  const uniqueSymbols = [...new Set([...watchlistTickers, ...portfolioTickers])];
  const prices = new Map<string, number>();
  const rateLimited: string[] = [];
  const failed: string[] = [];
  if (uniqueSymbols.length > 0) {
    const outcomes = await stockPriceService.fetchPricesWithOutcomes(uniqueSymbols, { forceRefresh: true });
    outcomes.forEach((result, symbol) => {
      if (result.outcome === 'updated' && result.price) {
        prices.set(symbol, result.price.price);
      } else if (result.outcome === 'rate-limited') {
        rateLimited.push(symbol);
      } else {
        failed.push(symbol);
      }
    });
  }

  // Persist the watchlist subset (saved_stocks + history). Day Change
  // history is written ONLY here — never by the portfolio path.
  const appliedWatchlist = await persistWatchlistPrices(userEmail, prices, snapshot);

  // Mirror the fresh prices of portfolio-only tickers into the stored
  // fallback; watchlist tickers were already mirrored by the persist
  // above, so only the non-watchlist subset is mirrored here.
  const fallbackPrices = new Map(
    [...prices.entries()].filter(([symbol]) => !watchlistTickers.has(symbol))
  );
  await mirrorPricesToPortfolio(userEmail, fallbackPrices);

  return { prices, rateLimited, failed, appliedWatchlist };
}
