interface StockPrice {
  symbol: string;
  price: number;
  timestamp: number;
  source: string;
}

interface CachedPrice {
  price: number;
  timestamp: number;
  source: string;
}

interface GetPriceOptions {
  /**
   * Skip the local cache and fetch a live price. Fresh results are still
   * written to the cache. When a forced fetch fails, no stale cached price
   * is returned, so the caller can report the failure instead of silently
   * showing an old price.
   */
  forceRefresh?: boolean;
}

/**
 * What a single fetch attempt concluded. Callers use this to tell a
 * rate-limit rejection (worth queuing for a later retry) apart from a
 * genuinely unrecoverable failure (e.g. Finnhub returns no price data
 * for a symbol, which no amount of retrying will fix).
 */
type PriceFetchOutcome = 'updated' | 'rate-limited' | 'failed';

interface PriceFetchResult {
  symbol: string;
  price: StockPrice | null;
  outcome: PriceFetchOutcome;
}

class StockPriceService {
  private cache: Map<string, CachedPrice> = new Map();
  private readonly CACHE_DURATION = 4 * 60 * 60 * 1000; // 4 hours in milliseconds
  private readonly API_KEY = import.meta.env.VITE_FINNHUB_API_KEY;
  private readonly BASE_URL = 'https://finnhub.io/api/v1';

  // Rate limiting — Finnhub's free plan allows 60 calls/minute (the binding
  // limit; the 30 calls/second ceiling is only a burst cap). The per-minute
  // allowance is kept at 55 to leave headroom for calls made outside a
  // bulk refresh (e.g. single-ticker lookups).
  private readonly MAX_REQUESTS_PER_SECOND = 10;
  private readonly MAX_REQUESTS_PER_MINUTE = 55;
  private readonly MINUTE_WINDOW_MS = 60 * 1000;
  private readonly MAX_CONCURRENT_REQUESTS = 10;
  private requestTimestamps: number[] = [];

  constructor() {
    // Load cache from localStorage on initialization
    this.loadCacheFromStorage();
  }

  private loadCacheFromStorage() {
    try {
      const stored = localStorage.getItem('stockPriceCache');
      if (stored) {
        const data = JSON.parse(stored);
        this.cache = new Map(Object.entries(data));
      }
    } catch (error) {
      console.warn('Failed to load stock price cache from localStorage:', error);
    }
  }

  private saveCacheToStorage() {
    try {
      const cacheObj = Object.fromEntries(this.cache);
      localStorage.setItem('stockPriceCache', JSON.stringify(cacheObj));
    } catch (error) {
      console.warn('Failed to save stock price cache to localStorage:', error);
    }
  }

  private isCacheValid(cachedPrice: CachedPrice): boolean {
    const now = Date.now();
    return (now - cachedPrice.timestamp) < this.CACHE_DURATION;
  }

  private async waitForRateLimit(): Promise<void> {
    while (true) {
      const now = Date.now();
      this.requestTimestamps = this.requestTimestamps.filter(timestamp => now - timestamp < 1000);
      if (this.requestTimestamps.length < this.MAX_REQUESTS_PER_SECOND) {
        return;
      }
      const waitTime = 1000 - (now - this.requestTimestamps[0]);
      await new Promise(resolve => setTimeout(resolve, Math.max(waitTime, 50)));
    }
  }

  /**
   * Reserve one slot in the rolling 60-second window. Returns false when
   * the free plan's per-minute allowance is exhausted — the caller must
   * NOT make the HTTP call in that case, so no quota is wasted on a
   * request that would come back 429. Reservation and the actual call
   * happen within ~1s of each other, so the timestamp is a good proxy
   * for the call time.
   */
  private tryReserveMinuteSlot(): boolean {
    const now = Date.now();
    this.requestTimestamps = this.requestTimestamps.filter(
      timestamp => now - timestamp < this.MINUTE_WINDOW_MS
    );
    if (this.requestTimestamps.length >= this.MAX_REQUESTS_PER_MINUTE) {
      return false;
    }
    this.requestTimestamps.push(now);
    return true;
  }

  private async rateLimitedFetch(url: string): Promise<Response> {
    await this.waitForRateLimit();
    return fetch(url);
  }

  /**
   * Fetch one price and report why it did (or did not) come back. Unlike
   * the old behaviour, a 429 is NOT retried here: a retry inside the same
   * 60-second window would 429 again and burn quota. Rate-limited symbols
   * are the caller's to queue for a later retry, once the window clears.
   */
  async fetchPrice(symbol: string, options: GetPriceOptions = {}): Promise<PriceFetchResult> {
    const normalizedSymbol = symbol.toUpperCase();
    const { forceRefresh = false } = options;
    // Check cache first (an explicit refresh skips the cache so it always fetches live prices)
    const cached = this.cache.get(normalizedSymbol);
    if (cached && this.isCacheValid(cached) && !forceRefresh) {
      return {
        symbol: normalizedSymbol,
        price: {
          symbol: normalizedSymbol,
          price: cached.price,
          timestamp: cached.timestamp,
          source: cached.source
        },
        outcome: 'updated'
      };
    }

    // If no API key, return null
    if (!this.API_KEY) {
      console.error('No Finnhub API key provided. Add VITE_FINNHUB_API_KEY to your .env file');
      return { symbol: normalizedSymbol, price: null, outcome: 'failed' };
    }

    // Don't spend a call we know will be rejected: the per-minute window
    // is exhausted, so this symbol goes back to the caller's queue.
    if (!this.tryReserveMinuteSlot()) {
      return { symbol: normalizedSymbol, price: null, outcome: 'rate-limited' };
    }

    try {
      // Fetch from Finnhub API
      const url = `${this.BASE_URL}/quote?symbol=${normalizedSymbol}&token=${this.API_KEY}`;
      const response = await this.rateLimitedFetch(url);

      if (response.status === 429) {
        // The window was consumed by calls outside this service's view
        // (or a burst); queue it for retry after the window clears.
        console.warn(`Rate limited (429) fetching price for ${normalizedSymbol}`);
        return { symbol: normalizedSymbol, price: null, outcome: 'rate-limited' };
      }

      if (!response.ok) {
        console.error('API response not ok:', response.status, response.statusText);
        return { symbol: normalizedSymbol, price: null, outcome: 'failed' };
      }

      const data = await response.json();
      // Check for API errors
      if (data.error) {
        console.error('API returned error:', data.error);
        return { symbol: normalizedSymbol, price: null, outcome: 'failed' };
      }

      // Finnhub returns current price in 'c' field
      if (!data.c || data.c === 0) {
        // No usable price data (e.g. a listing Finnhub doesn't cover on
        // this plan, such as a TSX symbol). Retrying will not help.
        console.error('Invalid price data:', data);
        return { symbol: normalizedSymbol, price: null, outcome: 'failed' };
      }

      const price = parseFloat(data.c);
      const timestamp = Date.now();
      // Cache the result
      const cachedPrice: CachedPrice = {
        price,
        timestamp,
        source: 'Finnhub'
      };

      this.cache.set(normalizedSymbol, cachedPrice);
      this.saveCacheToStorage();

      return {
        symbol: normalizedSymbol,
        price: {
          symbol: normalizedSymbol,
          price,
          timestamp,
          source: 'Finnhub'
        },
        outcome: 'updated'
      };

    } catch (error) {
      console.error(`Failed to fetch price for ${normalizedSymbol}:`, error);

      // If we have expired cache data, return it as fallback — but not on an
      // explicit refresh, so a failed live fetch surfaces as a failure
      // instead of silently serving a stale price.
      if (cached && !forceRefresh) {
        console.warn(`Using expired cache data for ${normalizedSymbol}`);
        return {
          symbol: normalizedSymbol,
          price: {
            symbol: normalizedSymbol,
            price: cached.price,
            timestamp: cached.timestamp,
            source: `${cached.source} (cached)`
          },
          outcome: 'updated'
        };
      }

      return { symbol: normalizedSymbol, price: null, outcome: 'failed' };
    }
  }

  async getStockPrice(symbol: string, options: GetPriceOptions = {}): Promise<StockPrice | null> {
    const result = await this.fetchPrice(symbol, options);
    return result.price;
  }

  /**
   * Fetch prices for many symbols, keeping the per-symbol outcome so the
   * caller can tell rate-limited symbols (queue them) from genuinely
   * failed ones (surface them). Symbols the minute window has no room for
   * are reported 'rate-limited' without an HTTP call being made.
   */
  async fetchPricesWithOutcomes(symbols: string[], options: GetPriceOptions = {}): Promise<Map<string, PriceFetchResult>> {
    const results = new Map<string, PriceFetchResult>();
    const uniqueSymbols = [...new Set(symbols.map(s => s.toUpperCase()))];

    const queue = [...uniqueSymbols];
    const workers = Array.from({ length: this.MAX_CONCURRENT_REQUESTS }, async () => {
      while (queue.length > 0) {
        const symbol = queue.shift();
        if (!symbol) {
          return;
        }
        const result = await this.fetchPrice(symbol, options);
        results.set(symbol, result);
      }
    });

    await Promise.all(workers);

    return results;
  }

  async getMultipleStockPrices(symbols: string[], options: GetPriceOptions = {}): Promise<Map<string, StockPrice>> {
    const outcomes = await this.fetchPricesWithOutcomes(symbols, options);
    const results = new Map<string, StockPrice>();
    outcomes.forEach((result, symbol) => {
      if (result.price) {
        results.set(symbol, result.price);
      }
    });
    return results;
  }

  clearCache() {
    this.cache.clear();
    localStorage.removeItem('stockPriceCache');
  }

  getCacheInfo(): { symbol: string; price: number; age: string; source: string }[] {
    const now = Date.now();
    return Array.from(this.cache.entries()).map(([symbol, cached]) => ({
      symbol,
      price: cached.price,
      age: `${Math.round((now - cached.timestamp) / (1000 * 60 * 60))} hours ago`,
      source: cached.source
    }));
  }
}

export const stockPriceService = new StockPriceService();
export type { StockPrice, GetPriceOptions, PriceFetchResult, PriceFetchOutcome };
