import React, { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react';
import { TrendingUp, TrendingDown, Trash2, BarChart3, CreditCard as Edit, RefreshCw, AlertTriangle, Search, Star, Download, ChevronDown, ChevronRight, X, Loader2, CheckCircle2 } from 'lucide-react';
import { SavedStock } from '../types';
import { supabase } from '../lib/supabase';
import { formatCurrency, formatPercentage, getPerformanceColor, calculateDCF, getScenarioResults, normalizeScenarioInputs } from '../utils/dcf';
import { DCFInputs, DCFScenarioName, DCFScenarioInputs } from '../types';
import { stockPriceService } from '../services/stockPriceService';
import type { StockPrice } from '../services/stockPriceService';
import { useAuth } from '../hooks/useAuth';
import { format, differenceInDays } from 'date-fns';
import { downloadCsv } from '../utils/csv';
import { STOCK_CATEGORIES } from '../utils/categories';

// Pure helpers (module scope so the memoized row and the sorted list can share them
// without re-creating them on every render).
const getValuationStatusForFairValue = (currentPrice: number, fairValue: number) => {
  if (currentPrice <= fairValue * 0.8) return { status: 'strong-buy', color: 'bg-green-600', text: 'Strong Buy' };
  if (currentPrice <= fairValue) return { status: 'buy', color: 'bg-green-500', text: 'Buy' };
  if (currentPrice <= fairValue * 1.2) return { status: 'hold', color: 'bg-yellow-500', text: 'Hold' };
  return { status: 'overvalued', color: 'bg-red-600', text: 'Overvalued' };
};

// The valuation numbers the watchlist shows for one scenario. Base always
// uses the stored fields (unchanged behavior); bear/bull are computed on the
// fly from dcf_inputs and are `isSet: false` (all values null) until the case
// is fully entered — an unset case shows dashes, never invented numbers.
const getDisplayValuation = (stock: SavedStock, scenario: DCFScenarioName) => {
  if (scenario === 'base') {
    return {
      isSet: true,
      fairValue: stock.fairValue,
      cagr: stock.cagr,
      buyTarget: stock.buyTarget,
      expectedReturn: stock.expectedReturn,
      projectedPrices: stock.dcf_inputs?.projectedPrices ?? null as number[] | null
    };
  }
  const results = stock.dcf_inputs ? getScenarioResults(stock.dcf_inputs, scenario) : null;
  if (!results) {
    return {
      isSet: false,
      fairValue: null as number | null,
      cagr: null as number | null,
      buyTarget: null as number | null,
      expectedReturn: null as number | null,
      projectedPrices: null as number[] | null
    };
  }
  return {
    isSet: true,
    fairValue: results.fairValue,
    cagr: results.cagr,
    buyTarget: results.buyTargetPrice,
    expectedReturn: results.totalReturn,
    projectedPrices: results.projectedPrices
  };
};

const getCurrentValuation = (stock: SavedStock) => {
  const metric = stock.dcf_inputs?.valuationMetric;
  const baseMetric = stock.dcf_inputs?.baseMetricPerShare;
  if (!metric || !baseMetric || baseMetric === 0) return null;
  const currentValuation = stock.currentPrice / baseMetric;
  return {
    value: currentValuation,
    metric
  };
};

const isStockStale = (stock: SavedStock) => {
  const updatedAt = new Date(stock.updatedAt);
  const daysSinceUpdate = differenceInDays(new Date(), updatedAt);
  return daysSinceUpdate > 90;
};

// A bear/bull case counts as set only when all five growth rates and the
// multiple are finite numbers — the same rule as the DCF scenarios work
// (getValidScenario in src/utils/dcf.ts). Anything partial is unset, never
// completed from the base case.
const isScenarioSet = (scenario: DCFScenarioInputs | undefined | null): boolean => {
  if (!scenario) return false;
  if (!Array.isArray(scenario.growthRates) || scenario.growthRates.length !== 5) return false;
  if (!scenario.growthRates.every(rate => typeof rate === 'number' && Number.isFinite(rate))) return false;
  return typeof scenario.valuationMultiple === 'number' && Number.isFinite(scenario.valuationMultiple);
};

// A category counts as set when it is a non-empty value other than "N/A"
// (the placeholder used when no category fits a stock yet).
const isCategorySet = (category: string | undefined | null): boolean => {
  if (!category) return false;
  const value = category.trim();
  return value !== '' && value.toUpperCase() !== 'N/A';
};

/** Config items still missing for a stock, as short labels: 'Bear case',
 *  'Bull case' and/or 'Category'. Empty array means the stock's config is
 *  complete. The bear/bull fields arrive with the DCF-scenarios work and
 *  the category with the stock-categories work; until those land, every
 *  stock reports all three as missing — which is the correct behaviour
 *  for unset config. Reads `stock.category` (populated by the categories
 *  work's loadStocks mapping) with a fallback to `dcf_inputs.category`,
 *  so this works both before and after that PR merges. */
const getMissingConfig = (stock: SavedStock): string[] => {
  const missing: string[] = [];
  const inputs = stock.dcf_inputs;
  if (!isScenarioSet(inputs?.bearCase)) missing.push('Bear case');
  if (!isScenarioSet(inputs?.bullCase)) missing.push('Bull case');
  const category = stock.category ?? inputs?.category;
  if (!isCategorySet(category)) missing.push('Category');
  return missing;
};

// Max recorded closes shown in the expandable history row.
const RECENT_CLOSES_SHOWN = 5;

// Most recent recorded close for a ticker from a previous calendar day.
// Rows recorded today (e.g. from an earlier "Update Prices" run today)
// are skipped so the comparison is always vs the last prior day.
const getPriorDayClose = (
  priceHistory: Record<string, { price: number; recordedAt: string }[]>,
  stock: SavedStock
): { price: number; recordedAt: string } | null => {
  const history = priceHistory[stock.ticker.toUpperCase()] ?? [];
  const todayKey = format(new Date(), 'yyyy-MM-dd');
  return history.find(entry => format(new Date(entry.recordedAt), 'yyyy-MM-dd') !== todayKey) ?? null;
};

// Day Change = today's current price vs the most recent prior-day
// recorded close. Null when no prior-day price exists yet (history only
// starts accumulating after this feature ships).
const getDayChange = (
  priceHistory: Record<string, { price: number; recordedAt: string }[]>,
  stock: SavedStock
): number | null => {
  const priorDay = getPriorDayClose(priceHistory, stock);
  if (!priorDay || priorDay.price <= 0) return null;
  return (stock.currentPrice - priorDay.price) / priorDay.price;
};

const getRecentCloses = (
  priceHistory: Record<string, { price: number; recordedAt: string }[]>,
  stock: SavedStock
): { price: number; recordedAt: string }[] => {
  return (priceHistory[stock.ticker.toUpperCase()] ?? []).slice(0, RECENT_CLOSES_SHOWN);
};

// Background price-update queue (async Finnhub 60/min handling).
// When a bulk refresh hits the free plan's 60-calls/minute cap, the
// rate-limited tickers are queued here instead of failing: the queue
// retries them in the background once the window clears, while the page
// stays usable. The queue is persisted to localStorage so a page reload
// mid-queue resumes it instead of losing the pending tickers. It only
// runs while the page (or the daily automated run's tab) is open.
const PRICE_QUEUE_STORAGE_KEY = 'stockPriceUpdateQueue';
const PRICE_QUEUE_MAX_AGE_MS = 15 * 60 * 1000; // a queue older than this is stale — drop it
const PRICE_QUEUE_RETRY_DELAY_MS = 60 * 1000; // wait out the Finnhub minute window
const PRICE_QUEUE_PACE_MS = 1000; // one queued fetch per second, stays under 60/min
const PRICE_QUEUE_MAX_ATTEMPTS = 3; // attempts per ticker before it counts as failed

interface PersistedPriceQueue {
  symbols: string[];
  attempts: Record<string, number>;
  nextRetryAt: number; // epoch ms — earliest the queue may resume fetching
  startedAt: number;
  // Tickers that already failed outright in the first wave (e.g. CSU.CA,
  // which has no price data on the free plan). These live in the persisted
  // queue — not just in memory — so a page reload mid-queue cannot lose
  // them: the resumed drain reports them in the failure banner instead of
  // claiming "All prices updated" while they sit stale.
  failed: string[];
}

const loadPersistedPriceQueue = (): PersistedPriceQueue | null => {
  try {
    const stored = localStorage.getItem(PRICE_QUEUE_STORAGE_KEY);
    if (!stored) return null;
    const queue = JSON.parse(stored) as PersistedPriceQueue;
    if (!queue || !Array.isArray(queue.symbols) || queue.symbols.length === 0) return null;
    if (Date.now() - queue.startedAt > PRICE_QUEUE_MAX_AGE_MS) return null;
    // Queues saved by the pre-fix build have no `failed` list yet.
    if (!Array.isArray(queue.failed)) queue.failed = [];
    return queue;
  } catch (error) {
    console.warn('Failed to load pending price-update queue:', error);
    return null;
  }
};

const savePersistedPriceQueue = (queue: PersistedPriceQueue | null) => {
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

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface StockWatchlistRowProps {
  stock: SavedStock;
  /** Which DCF case's targets/valuation this row displays (base by default). */
  displayScenario: DCFScenarioName;
  /** True when the latest price update failed for this ticker (last known price shown). */
  priceUpdateFailed: boolean;
  /** True while this ticker is queued for a background retry after a rate
   *  limit — shown as "Updating…", never as a failure. */
  priceUpdatePending: boolean;
  /** All recorded closes, keyed by uppercase ticker — the stable state
   *  reference, so passing it doesn't defeat memoization. */
  priceHistory: Record<string, { price: number; recordedAt: string }[]>;
  /** True when this row's recent-closes history is expanded. */
  isHistoryExpanded: boolean;
  onToggleHistory: (stockId: string) => void;
  onToggleFavorite: (stock: SavedStock) => void;
  onEdit: (stock: SavedStock) => void;
  onDelete: (stock: SavedStock) => void;
}

// Memoized so typing in search, toggling sort/filter, or opening the edit modal
// doesn't re-render all 67 rows — only rows whose stock or props changed re-render.
// Day Change / recent closes are derived inside the row from the stable
// priceHistory reference, so they don't create new prop identities per render.
const StockWatchlistRow = memo(function StockWatchlistRow({
  stock,
  displayScenario,
  priceUpdateFailed,
  priceUpdatePending,
  priceHistory,
  isHistoryExpanded,
  onToggleHistory,
  onToggleFavorite,
  onEdit,
  onDelete
}: StockWatchlistRowProps) {
  const display = getDisplayValuation(stock, displayScenario);
  const valuation = display.isSet && display.fairValue !== null
    ? getValuationStatusForFairValue(stock.currentPrice, display.fairValue)
    : null;
  const isStale = isStockStale(stock);
  const missingConfig = getMissingConfig(stock);
  const needsUpdate = isStale || missingConfig.length > 0;
  // Tooltip naming every reason this row is flagged, e.g.
  // "Last updated Oct 05, 2026 - over 90 days ago — Config needs update: Bear case, Category".
  const needsUpdateTitle = [
    isStale ? `Last updated ${format(new Date(stock.updatedAt), 'MMM dd, yyyy')} - over 90 days ago` : null,
    missingConfig.length > 0 ? `Config needs update: ${missingConfig.join(', ')}` : null,
  ].filter(Boolean).join(' — ');
  const currentValuation = getCurrentValuation(stock);
  const dayChange = getDayChange(priceHistory, stock);
  const recentCloses = getRecentCloses(priceHistory, stock);

  return (
    <React.Fragment>
    <tr className="hover:bg-gray-50">
      <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onToggleFavorite(stock)}
            className={`rounded-full p-1 transition-colors ${
              stock.isFavorite ? 'text-yellow-500' : 'text-gray-300 hover:text-yellow-400'
            }`}
            title={stock.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            aria-label={stock.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          >
            <Star className={`w-4 h-4 ${stock.isFavorite ? 'fill-current' : ''}`} />
          </button>
          <div className="flex flex-col">
            <div className="font-medium text-gray-900">{stock.ticker}</div>
            {stock.category ? (
              <span className="inline-flex items-center self-start px-1.5 py-0.5 rounded text-[11px] font-medium bg-gray-100 text-gray-600 mt-0.5">
                {stock.category}
              </span>
            ) : (
              <span className="inline-flex items-center self-start px-1.5 py-0.5 rounded text-[11px] font-medium bg-gray-50 text-gray-400 mt-0.5">
                N/A
              </span>
            )}
          </div>
          {needsUpdate && (
            <AlertTriangle
              className="w-4 h-4 text-red-500"
              title={needsUpdateTitle}
            />
          )}
          {priceUpdateFailed && (
            <AlertTriangle
              className="w-4 h-4 text-amber-500"
              title="Price failed to update — showing last known price"
            />
          )}
          {priceUpdatePending && (
            <span title="Price updating in the background — will fill in automatically">
              <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
            </span>
          )}
        </div>
      </td>
      <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
        <div className="text-sm font-medium text-gray-900">
          {formatCurrency(stock.currentPrice)}
        </div>
        {priceUpdateFailed && (
          <div className="text-xs text-amber-600">Price not updated</div>
        )}
        {priceUpdatePending && (
          <div className="text-xs text-blue-600">Updating…</div>
        )}
      </td>
      <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
        <div className="flex items-center gap-1">
          {dayChange === null ? (
            <span className="text-sm text-gray-400" title="No prior-day price recorded yet — history starts accumulating after the next price update">—</span>
          ) : (
            <>
              {dayChange >= 0 ? (
                <TrendingUp className="w-4 h-4 text-green-600" />
              ) : (
                <TrendingDown className="w-4 h-4 text-red-600" />
              )}
              <span className={`text-sm font-medium ${dayChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {formatPercentage(dayChange)}
              </span>
            </>
          )}
          <button
            type="button"
            onClick={() => onToggleHistory(stock.id!)}
            className={`ml-1 rounded p-0.5 ${
              recentCloses.length === 0
                ? 'text-gray-300 hover:text-gray-400'
                : 'text-gray-400 hover:text-gray-600'
            }`}
            title={
              recentCloses.length === 0
                ? 'No recorded closes yet'
                : isHistoryExpanded
                  ? 'Hide recent closes'
                  : 'Show recent closes'
            }
            aria-label={
              recentCloses.length === 0
                ? 'No recorded closes yet'
                : isHistoryExpanded
                  ? 'Hide recent closes'
                  : 'Show recent closes'
            }
          >
            {isHistoryExpanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </button>
        </div>
      </td>
      <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
        <div className="text-xs space-y-1">
          {display.projectedPrices ? (
            <>
              <div>1Y: {formatCurrency(display.projectedPrices[0] || 0)}</div>
              <div>3Y: {formatCurrency(display.projectedPrices[2] || 0)}</div>
              <div>5Y: {formatCurrency(display.projectedPrices[4] || 0)}</div>
            </>
          ) : (
            <span className="text-gray-400" title={`${displayScenario === 'bear' ? 'Bear' : 'Bull'} case not entered yet`}>—</span>
          )}
        </div>
      </td>
      <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
        {display.cagr !== null ? (
          <div className={`text-sm font-medium ${getPerformanceColor(display.cagr, 'cagr')}`}>
            {formatPercentage(display.cagr)}
          </div>
        ) : (
          <span className="text-sm text-gray-400">—</span>
        )}
      </td>
      <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
        {currentValuation ? (
          <div className="text-sm font-medium text-gray-900">
            {currentValuation.value.toFixed(2)} {currentValuation.metric}
          </div>
        ) : (
          <div className="text-sm text-gray-400">—</div>
        )}
      </td>
      <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
        {display.buyTarget !== null ? (
          <div className="text-sm font-medium text-blue-600">
            {formatCurrency(display.buyTarget)}
          </div>
        ) : (
          <span className="text-sm text-gray-400">—</span>
        )}
      </td>
      <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
        {valuation ? (
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium text-white ${valuation.color}`}>
            {valuation.text}
          </span>
        ) : (
          <span className="text-sm text-gray-400" title={`${displayScenario === 'bear' ? 'Bear' : 'Bull'} case not entered yet`}>—</span>
        )}
      </td>
      <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
        <div className={`text-sm ${needsUpdate ? 'text-red-600 font-medium' : 'text-gray-900'}`}>
          {format(new Date(stock.updatedAt), 'MMM dd, yyyy')}
        </div>
        {isStale && (
          <div className="text-xs text-red-500">Needs update</div>
        )}
        {missingConfig.length > 0 && (
          <div className="text-xs text-red-500">Config needs update: {missingConfig.join(' · ')}</div>
        )}
      </td>
      <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-sm font-medium">
        <div className="flex items-center gap-2">
          <button
            onClick={() => onEdit(stock)}
            className="text-blue-600 hover:text-blue-900"
          >
            <Edit className="w-4 h-4" />
          </button>
          <button
            onClick={() => onDelete(stock)}
            className="text-red-600 hover:text-red-900"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </td>
    </tr>
    {isHistoryExpanded && (
      <tr className="bg-gray-50">
        <td colSpan={10} className="px-3 sm:px-6 py-3">
          <div className="text-xs text-gray-600">
            <span className="font-medium text-gray-800">Recent recorded closes: </span>
            {recentCloses.length === 0 ? (
              <span className="text-gray-400">No recorded closes yet</span>
            ) : (
              recentCloses.map((entry, index) => (
                <span key={`${entry.recordedAt}-${index}`}>
                  {index > 0 && <span className="text-gray-400"> · </span>}
                  {format(new Date(entry.recordedAt), 'MMM dd, yyyy')}: {formatCurrency(entry.price)}
                </span>
              ))
            )}
          </div>
        </td>
      </tr>
    )}
    </React.Fragment>
  );
});

export default function StockWatchlist() {
  const { user } = useAuth();
  const [stocks, setStocks] = useState<SavedStock[]>([]);
  const [loading, setLoading] = useState(false);
  const [sortBy, setSortBy] = useState<'ticker' | 'expectedReturn' | 'cagr' | 'buyTarget' | 'status' | 'lastUpdated' | 'valuation' | 'category'>('cagr');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  // Which DCF case the watchlist displays (base by default). Persisted so
  // the toggle survives reloads; base-case storage is untouched.
  const [displayScenario, setDisplayScenario] = useState<DCFScenarioName>(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('watchlistScenario') : null;
    return saved === 'bear' || saved === 'bull' ? saved : 'base';
  });

  const handleDisplayScenarioChange = (scenario: DCFScenarioName) => {
    setDisplayScenario(scenario);
    localStorage.setItem('watchlistScenario', scenario);
  };
  const [filterBy, setFilterBy] = useState<
    'all' | 'favorites' | 'undervalued' | 'overvalued' | 'cagr10' | 'cagr15' | 'cagr20'
  >('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [editingStock, setEditingStock] = useState<SavedStock | null>(null);
  const [editForm, setEditForm] = useState<DCFInputs | null>(null);
  // True while the "Create new category…" option is picked in the edit
  // modal's Category dropdown, so a free-text input is shown instead.
  const [editCustomCategory, setEditCustomCategory] = useState(false);
  const [editResults, setEditResults] = useState<any>(null);
  const [editWarnings, setEditWarnings] = useState<any[]>([]);
  const [updatingPrices, setUpdatingPrices] = useState(false);
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());
  // Recent recorded closes per ticker (uppercase ticker -> newest first).
  // Populated by a single batched query in loadStocks; used for the
  // Day Change column and the expandable recent-closes row.
  const [priceHistory, setPriceHistory] = useState<Record<string, { price: number; recordedAt: string }[]>>({});
  const [expandedHistory, setExpandedHistory] = useState<Set<string>>(new Set());

  const PRICE_HISTORY_LIMIT = 1000;
  // Tickers (uppercase) whose price failed to update on the last explicit refresh.
  // Shown in a banner + row warning; cleared on the next update that succeeds for them.
  // Only set once a refresh fully finishes (first wave + background queue),
  // so tickers still queued for retry never appear here as failures.
  const [failedPriceTickers, setFailedPriceTickers] = useState<string[]>([]);
  // Tickers currently queued for a background retry after hitting the
  // Finnhub 60/min rate limit. Shown as "Updating…" — never as failures
  // while the queue is still working.
  const [pendingPriceTickers, setPendingPriceTickers] = useState<string[]>([]);
  // True while the background queue is still draining.
  const [priceQueueActive, setPriceQueueActive] = useState(false);
  // True once a refresh (first wave + queue) finished with no failures.
  const [priceUpdateComplete, setPriceUpdateComplete] = useState(false);
  // Bumps to cancel a running queue drain (unmount, or a superseding refresh).
  const queueRunIdRef = useRef(0);
  // Guards the resume-on-reload effect so a persisted queue is only
  // picked up once per page load.
  const queueResumedRef = useRef(false);

  const WATCHLIST_LIMIT = 500;
  const valuationMetrics = [
    { value: 'P/S', label: 'Price-to-Sales (P/S)' },
    { value: 'P/E', label: 'Price-to-Earnings (P/E)' },
    { value: 'P/FCF', label: 'Price-to-Free Cash Flow (P/FCF)' },
    { value: 'P/B', label: 'Price-to-Book (P/B)' },
    { value: 'P/OCF', label: 'Price-to-Operating Cash Flow (P/OCF)' },
    { value: 'EV/Sales', label: 'EV/Sales' },
    { value: 'EV/EBITDA', label: 'EV/EBITDA' }
  ];

  const loadStocks = useCallback(async () => {
    if (!user?.email) {
      setStocks([]);
      return;
    }
    
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('saved_stocks')
        .select('*')
        .eq('user_email', user.email)
        .order('created_at', { ascending: false });

      if (error) throw error;

      if (data) {
        const enrichedStocks: SavedStock[] = data.map(stock => {
          const currentPrice = stock.current_price;
          const totalReturn = currentPrice > 0 && stock.fair_value > 0 ? (currentPrice - stock.fair_value) / stock.fair_value : stock.expected_return;

          // Recalculate CAGR from current price to terminal value (5Y projected price)
          let cagr = stock.cagr;
          if (stock.dcf_inputs && stock.dcf_inputs.projectedPrices && stock.dcf_inputs.projectedPrices.length >= 5) {
            const terminalValue = stock.dcf_inputs.projectedPrices[4];
            if (currentPrice > 0 && terminalValue > 0) {
              cagr = Math.pow(terminalValue / currentPrice, 1/5) - 1;
            }
          }

          return {
            id: stock.id,
            ticker: stock.ticker,
            dcf_inputs: stock.dcf_inputs,
            createdAt: new Date(stock.created_at),
            updatedAt: new Date(stock.updated_at),
            notes: stock.notes || '',
            userEmail: stock.user_email,
            currentPrice,
            fairValue: stock.fair_value,
            expectedReturn: totalReturn,
            cagr: cagr,
            buyTarget: stock.buy_target,
            isFavorite: stock.is_favorite ?? false,
            // Category lives in the saved row's dcf_inputs JSONB (no schema
            // change needed); empty when the stock has no category yet.
            category: stock.dcf_inputs?.category?.trim() || ''
          };
        });
        setStocks(enrichedStocks);
      } else {
        setStocks([]);
      }

      // Fetch recent recorded closes for the user's tickers in one query.
      // History only starts accumulating once price-history recording ships,
      // so an empty result here is expected at first. A failure here must
      // never block the watchlist itself.
      try {
        const tickers = [...new Set((data ?? []).map(stock => stock.ticker))];
        if (tickers.length > 0) {
          const { data: historyData, error: historyError } = await supabase
            .from('stock_price_history')
            .select('ticker, price, recorded_at')
            .eq('user_email', user.email)
            .in('ticker', tickers)
            .order('recorded_at', { ascending: false })
            .limit(PRICE_HISTORY_LIMIT);

          if (historyError) throw historyError;

          const grouped: Record<string, { price: number; recordedAt: string }[]> = {};
          (historyData ?? []).forEach(row => {
            const key = row.ticker.toUpperCase();
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push({ price: Number(row.price), recordedAt: row.recorded_at });
          });
          setPriceHistory(grouped);
        } else {
          setPriceHistory({});
        }
      } catch (historyError) {
        console.error('Error loading price history:', historyError);
        setPriceHistory({});
      }
    } catch (error) {
      console.error('Error loading stocks:', error);
      
      // Check if it's a configuration issue
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      
      if (!supabaseUrl || !supabaseKey || 
          supabaseUrl.includes('placeholder') || supabaseKey.includes('placeholder') ||
          supabaseUrl === 'your_supabase_url_here' || supabaseKey === 'your_supabase_anon_key_here') {
        console.warn('Supabase not configured properly. Please update your .env file with valid Supabase credentials.');
        alert('Supabase is not configured. Please check the console for setup instructions and update your .env file.');
      }
      
      setStocks([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  // NOTE: this effect must stay below the loadStocks definition — its
  // dependency array reads `loadStocks` during render, and reading the
  // `const` before its declaration throws
  // "Cannot access 'loadStocks' before initialization" (that is what
  // crashed the PR #36 preview: the effect used to sit above this line).
  useEffect(() => {
    loadStocks();
  }, [loadStocks]);

  // Cancel any running queue drain when the component unmounts, so a
  // stale drain can't write state after the page is gone.
  useEffect(() => {
    return () => {
      queueRunIdRef.current += 1;
    };
  }, []);

  const deleteStock = useCallback(async (stock: SavedStock) => {
    const confirmed = window.confirm(`Are you sure you want to delete ${stock.ticker} from your watchlist?`);
    if (!confirmed) return;

    try {
      const { error } = await supabase
        .from('saved_stocks')
        .delete()
        .eq('id', stock.id);

      if (error) throw error;
      loadStocks();
    } catch (error) {
      console.error('Error deleting stock:', error);
    }
  }, [loadStocks]);

  const toggleFavorite = useCallback(async (stock: SavedStock) => {
    try {
      const nextValue = !stock.isFavorite;
      const { error } = await supabase
        .from('saved_stocks')
        .update({ is_favorite: nextValue, updated_at: new Date().toISOString() })
        .eq('id', stock.id);

      if (error) throw error;

      setStocks(prev =>
        prev.map(item => (item.id === stock.id ? { ...item, isFavorite: nextValue } : item))
      );
    } catch (error) {
      console.error('Error updating favorite status:', error);
    }
  }, []);

  const startEdit = useCallback((stock: SavedStock) => {
    setEditingStock(stock);
    const formData = {
      ...stock.dcf_inputs,
      currentPrice: stock.currentPrice,
      notes: stock.notes || '',
      investorRelationsLink: stock.dcf_inputs?.investorRelationsLink || ''
    };
    setEditForm(formData);
    // A category outside the fixed list means it was created custom — keep
    // the custom input open so it stays editable instead of vanishing.
    setEditCustomCategory(
      Boolean(stock.category) && !STOCK_CATEGORIES.includes(stock.category ?? '')
    );

    // Calculate initial results
    const { results, warnings } = calculateDCF(formData);
    setEditResults(results);
    setEditWarnings(warnings);
  }, []);

  const cancelEdit = () => {
    setEditingStock(null);
    setEditForm(null);
    setEditResults(null);
    setEditWarnings([]);
  };

  const handleEditFormChange = (field: string, value: number) => {
    if (!editForm) return;
    
    const updatedForm = { ...editForm, [field]: value };
    setEditForm(updatedForm);
    
    // Recalculate DCF results with updated form data
    const { results, warnings } = calculateDCF(updatedForm);
    setEditResults(results);
    setEditWarnings(warnings);
  };

  // Category is free text (not a number), so it has its own handler.
  // It rides along in editForm and is saved into dcf_inputs by saveEdit.
  const handleEditCategoryChange = (value: string) => {
    if (!editForm) return;
    setEditForm({ ...editForm, category: value });
  };

  const handleGrowthRateChange = (index: number, value: number) => {
    if (!editForm) return;
    
    const updatedGrowthRates = [...editForm.growthRates];
    updatedGrowthRates[index] = value;
    const updatedForm = { ...editForm, growthRates: updatedGrowthRates };
    setEditForm(updatedForm);
    
    // Recalculate DCF results with updated form data
    const { results, warnings } = calculateDCF(updatedForm);
    setEditResults(results);
    setEditWarnings(warnings);
  };

  // Bear/bull inputs live in the edit form as optional objects. An empty
  // field is NaN and the case stays unset until ALL five growth rates and
  // the multiple are entered — nothing is ever copied from the base case.
  const handleScenarioMultipleChange = (scenario: 'bearCase' | 'bullCase', value: number) => {
    if (!editForm) return;
    setEditForm({
      ...editForm,
      [scenario]: {
        growthRates: editForm[scenario]?.growthRates ?? [NaN, NaN, NaN, NaN, NaN],
        valuationMultiple: value
      }
    });
  };

  const handleScenarioGrowthRateChange = (scenario: 'bearCase' | 'bullCase', index: number, value: number) => {
    if (!editForm) return;
    const current = editForm[scenario] ?? { growthRates: [NaN, NaN, NaN, NaN, NaN], valuationMultiple: NaN };
    setEditForm({
      ...editForm,
      [scenario]: {
        growthRates: current.growthRates.map((rate, i) => (i === index ? value : rate)),
        valuationMultiple: current.valuationMultiple
      }
    });
  };

  const handleClearScenario = (scenario: 'bearCase' | 'bullCase') => {
    if (!editForm) return;
    const next = { ...editForm };
    delete next[scenario];
    setEditForm(next);
  };

  // Blank for unset/empty scenario numbers (NaN), so the form never shows
  // a made-up value.
  const scenarioInputValue = (value: number | undefined): number | '' =>
    value !== undefined && Number.isFinite(value) ? value : '';

  const saveEdit = async () => {
    if (!editingStock || !editForm) return;

    try {
      // Recalculate DCF with new inputs (base case)
      const { results } = calculateDCF(editForm);
      const trimmedInvestorRelationsLink = editForm.investorRelationsLink?.trim() || '';
      // Strip any half-filled bear/bull case so only complete scenarios
      // are ever saved — an unset case stays unset, never guessed.
      const cleanForm = normalizeScenarioInputs(editForm);

      const { error } = await supabase
        .from('saved_stocks')
        .update({
          ticker: editForm.ticker,
          current_price: editForm.currentPrice,
          fair_value: results.fairValue,
          expected_return: results.totalReturn,
          cagr: results.cagr,
          buy_target: results.buyTargetPrice,
          dcf_inputs: {
            ...cleanForm,
            projectedPrices: results.projectedPrices,
            investorRelationsLink: trimmedInvestorRelationsLink,
            category: editForm.category?.trim() || ''
          },
          notes: editForm.notes || '',
          updated_at: new Date().toISOString()
        })
        .eq('id', editingStock.id);

      if (error) throw error;
      
      cancelEdit();
      loadStocks();
    } catch (error) {
      console.error('Error updating stock:', error);
    }
  };

  // Write freshly fetched prices to Supabase (saved_stocks rows + one
  // price-history row each) and return the applied updates so the caller
  // can patch the visible rows in place. Used by the first wave and by
  // each background-queue success.
  const persistPriceUpdates = useCallback(async (
    priceMap: Map<string, StockPrice>,
    stocksSnapshot: SavedStock[]
  ): Promise<{ id: string; ticker: string; currentPrice: number; expectedReturn: number; cagr: number }[]> => {
    const priceUpdates: { id: string; ticker: string; currentPrice: number; expectedReturn: number; cagr: number }[] = [];

    stocksSnapshot.forEach(stock => {
      const normalizedTicker = stock.ticker.toUpperCase();
      const priceData = priceMap.get(normalizedTicker);
      if (!priceData) return;
      let expectedReturn = stock.expectedReturn;
      let cagr = stock.cagr;
      if (stock.dcf_inputs && stock.dcf_inputs.projectedPrices && stock.dcf_inputs.projectedPrices.length >= 5) {
        const terminalValue = stock.dcf_inputs.projectedPrices[4];
        expectedReturn = stock.fairValue > 0
          ? (priceData.price - stock.fairValue) / stock.fairValue
          : stock.expectedReturn;
        cagr = terminalValue > 0 && priceData.price > 0
          ? Math.pow(terminalValue / priceData.price, 1 / 5) - 1
          : stock.cagr;
      }

      priceUpdates.push({
        id: stock.id!,
        ticker: stock.ticker.toUpperCase(),
        currentPrice: priceData.price,
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
    if (successfullyUpdated.length > 0 && user?.email) {
      try {
        const { error: historyError } = await supabase
          .from('stock_price_history')
          .insert(
            successfullyUpdated.map(update => ({
              user_email: user.email,
              ticker: update.ticker,
              price: update.currentPrice
            }))
          );

        if (historyError) throw historyError;
      } catch (historyError) {
        console.error('Failed to record price history:', historyError);
      }
    }

    // Return only the updates that actually landed, so the caller patches
    // exactly the rows that changed.
    return priceUpdates.filter(update =>
      successfullyUpdated.some(done => done.id === update.id)
    );
  }, [user]);

  // Drain a background queue: wait out the Finnhub minute window, then
  // fetch the pending tickers one per second. Successes are saved to
  // Supabase and patched into the visible rows in place; 429s are
  // re-queued (up to PRICE_QUEUE_MAX_ATTEMPTS); anything else (e.g. a
  // symbol with no price data) counts as failed. When the queue empties,
  // the failure banner gets only the genuinely failed tickers and the
  // completion state is shown. The queue is re-persisted after every
  // step so a page reload resumes where it left off.
  const drainPriceQueue = useCallback(async (
    initialQueue: PersistedPriceQueue,
    stocksSnapshot: SavedStock[],
    runId: number,
    initialFailed: string[] = []
  ) => {
    // The failed list lives ON the queue object (not in a separate local)
    // so every re-persist of the queue carries it: a reload mid-queue
    // resumes with the first-wave failures intact.
    let queue: PersistedPriceQueue = {
      symbols: [...initialQueue.symbols],
      attempts: { ...initialQueue.attempts },
      nextRetryAt: initialQueue.nextRetryAt,
      startedAt: initialQueue.startedAt,
      failed: [...new Set([...(initialQueue.failed ?? []), ...initialFailed])]
    };

    while (queue.symbols.length > 0) {
      if (runId !== queueRunIdRef.current) return; // cancelled / superseded

      // Wait until the rate-limit window has cleared.
      const waitMs = queue.nextRetryAt - Date.now();
      if (waitMs > 0) {
        await sleep(waitMs);
      }
      if (runId !== queueRunIdRef.current) return;

      // One fetch per second: stays under 60/min even as the watchlist grows.
      const pending = [...queue.symbols];
      const stillPending: string[] = [];
      for (const symbol of pending) {
        if (runId !== queueRunIdRef.current) return;
        const result = await stockPriceService.fetchPrice(symbol, { forceRefresh: true });
        if (result.outcome === 'updated' && result.price) {
          const applied = await persistPriceUpdates(
            new Map([[symbol, result.price]]),
            stocksSnapshot
          );
          if (applied.length > 0) {
            const update = applied[0];
            const fetchedAt = result.price.timestamp;
            setStocks(prev =>
              prev.map(item =>
                item.id === update.id
                  ? { ...item, currentPrice: update.currentPrice, expectedReturn: update.expectedReturn, cagr: update.cagr, updatedAt: new Date(fetchedAt) }
                  : item
              )
            );
          }
        } else if (result.outcome === 'rate-limited') {
          const attempts = (queue.attempts[symbol] ?? 1) + 1;
          queue.attempts[symbol] = attempts;
          if (attempts > PRICE_QUEUE_MAX_ATTEMPTS) {
            queue.failed.push(symbol);
          } else {
            stillPending.push(symbol);
          }
        } else {
          // No usable price data (e.g. CSU.CA on the free plan) — retrying
          // will not help, so this counts as failed right away.
          queue.failed.push(symbol);
        }

        // Keep the visible pending set in step with what is left.
        const remaining = [
          ...stillPending,
          ...pending.slice(pending.indexOf(symbol) + 1)
        ];
        setPendingPriceTickers(remaining);
        savePersistedPriceQueue(
          remaining.length > 0
            ? { ...queue, symbols: remaining, nextRetryAt: Date.now() + PRICE_QUEUE_RETRY_DELAY_MS }
            : null
        );

        if (runId !== queueRunIdRef.current) return;
        await sleep(PRICE_QUEUE_PACE_MS);
      }

      queue = {
        ...queue,
        symbols: stillPending,
        nextRetryAt: Date.now() + PRICE_QUEUE_RETRY_DELAY_MS
      };
      setPendingPriceTickers(stillPending);
      savePersistedPriceQueue(stillPending.length > 0 ? queue : null);
    }

    // Queue drained: only genuinely failed tickers reach the banner.
    setPriceQueueActive(false);
    setPendingPriceTickers([]);
    savePersistedPriceQueue(null);
    setFailedPriceTickers(queue.failed);
    setPriceUpdateComplete(queue.failed.length === 0);
    // One final reload so prices, updated dates and price history are all
    // in step with what the queue just saved.
    await loadStocks();
  }, [persistPriceUpdates, loadStocks]);

  const updateAllCurrentPrices = async () => {
    // One refresh at a time: a running first wave or background queue owns
    // the rate-limit window until it finishes.
    if (stocks.length === 0 || updatingPrices || priceQueueActive) return;

    const runId = ++queueRunIdRef.current;
    setUpdatingPrices(true);
    setPriceUpdateComplete(false);
    setFailedPriceTickers([]);
    setPendingPriceTickers([]);
    const uniqueSymbols = [...new Set(stocks.map(stock => stock.ticker.toUpperCase()))];
    try {
      // Explicit refresh: bypass the 4-hour local cache so this always fetches live prices.
      // The service caps the first wave at the free plan's 60/min allowance
      // and reports the rest as rate-limited instead of spending calls that
      // would come back 429 — those go to the background queue below.
      const outcomes = await stockPriceService.fetchPricesWithOutcomes(uniqueSymbols, { forceRefresh: true });
      if (runId !== queueRunIdRef.current) return;

      const priceMap = new Map<string, StockPrice>();
      const rateLimitedSymbols: string[] = [];
      const failedSymbols: string[] = [];
      outcomes.forEach((result, symbol) => {
        if (result.outcome === 'updated' && result.price) {
          priceMap.set(symbol, result.price);
        } else if (result.outcome === 'rate-limited') {
          rateLimitedSymbols.push(symbol);
        } else {
          failedSymbols.push(symbol);
        }
      });

      // Save the first wave immediately — the page looks refreshed at once
      // and control returns without waiting out the rate-limit window.
      await persistPriceUpdates(priceMap, stocks);
      if (runId !== queueRunIdRef.current) return;

      // Reload watchlist to reflect changes
      await loadStocks();

      if (rateLimitedSymbols.length > 0) {
        // Rate-limited tickers go to the background queue instead of the
        // failure banner: they retry once the minute window clears, while
        // the page stays usable. The banner only ever sees tickers the
        // queue has given up on (plus any that failed outright here).
        const queue: PersistedPriceQueue = {
          symbols: rateLimitedSymbols,
          attempts: Object.fromEntries(rateLimitedSymbols.map(symbol => [symbol, 1])),
          nextRetryAt: Date.now() + PRICE_QUEUE_RETRY_DELAY_MS,
          startedAt: Date.now(),
          failed: failedSymbols
        };
        savePersistedPriceQueue(queue);
        setPendingPriceTickers(rateLimitedSymbols);
        setPriceQueueActive(true);
        // Fire and forget: the drain updates rows in place as it goes and
        // reports completion (or the genuinely failed tickers) when done.
        void drainPriceQueue(queue, stocks, runId, failedSymbols);
      } else {
        // Nothing queued: the refresh is already complete.
        setFailedPriceTickers(failedSymbols);
        setPriceUpdateComplete(failedSymbols.length === 0);
      }
    } catch (error) {
      console.error('Failed to update current prices:', error);
    } finally {
      setUpdatingPrices(false);
    }
  };

  // Resume a background queue that was still draining when the page was
  // reloaded: the pending tickers pick up where they left off (waiting
  // out the saved retry time first), and prices already saved to
  // Supabase show up via the normal loadStocks above.
  // NOTE: this effect must stay below the drainPriceQueue definition —
  // its dependency array reads `drainPriceQueue` during render, and
  // reading the const before its declaration would throw
  // "Cannot access 'drainPriceQueue' before initialization".
  useEffect(() => {
    if (queueResumedRef.current || stocks.length === 0) return;
    const savedQueue = loadPersistedPriceQueue();
    if (!savedQueue) return;
    queueResumedRef.current = true;
    const runId = ++queueRunIdRef.current;
    setPendingPriceTickers(savedQueue.symbols);
    setPriceQueueActive(true);
    void drainPriceQueue(savedQueue, stocks, runId);
  }, [stocks, drainPriceQueue]);

  const toggleNotesExpansion = (stockId: string) => {
    setExpandedNotes(prev => {
      const newSet = new Set(prev);
      if (newSet.has(stockId)) {
        newSet.delete(stockId);
      } else {
        newSet.add(stockId);
      }
      return newSet;
    });
  };

  // Stable identity so the memoized row doesn't re-render on every parent
  // render; it only uses the functional setState update.
  // (Day Change / recent closes are computed inside the row from the
  // module-scope helpers above, using the priceHistory state.)
  const toggleHistoryExpansion = useCallback((stockId: string) => {
    setExpandedHistory(prev => {
      const newSet = new Set(prev);
      if (newSet.has(stockId)) {
        newSet.delete(stockId);
      } else {
        newSet.add(stockId);
      }
      return newSet;
    });
  }, []);

  const handleNotesChange = (notes: string) => {
    if (!editForm) return;
    setEditForm({ ...editForm, notes });
  };

  const handleInvestorRelationsLinkChange = (investorRelationsLink: string) => {
    if (!editForm) return;
    setEditForm({ ...editForm, investorRelationsLink });
  };

  const getInvestorRelationsUrl = (link?: string) => {
    const trimmed = link?.trim();
    if (!trimmed) return '';
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  };

  const exportWatchlistCsv = () => {
    if (stocks.length === 0) return;

    const rows = stocks.map(stock => {
      const dcfInputs = stock.dcf_inputs ?? stock.dcfInputs;
      if (!dcfInputs) {
        return {
          Ticker: stock.ticker,
          Category: stock.category ?? '',
          'Current Price': stock.currentPrice,
          'Desired Return (%)': '',
          'Valuation Metric': '',
          'Valuation Multiple': '',
          'Base Metric Per Share': '',
          'Growth Rate Y1 (%)': '',
          'Growth Rate Y2 (%)': '',
          'Growth Rate Y3 (%)': '',
          'Growth Rate Y4 (%)': '',
          'Growth Rate Y5 (%)': '',
          'Projected Metric Y1': '',
          'Projected Metric Y2': '',
          'Projected Metric Y3': '',
          'Projected Metric Y4': '',
          'Projected Metric Y5': '',
          'Projected Price Y1': '',
          'Projected Price Y2': '',
          'Projected Price Y3': '',
          'Projected Price Y4': '',
          'Projected Price Y5': '',
          'Fair Value': stock.fairValue,
          'Total Return (%)': stock.expectedReturn * 100,
          'CAGR (%)': stock.cagr * 100,
          'Buy Target': stock.buyTarget,
          'Terminal Value': '',
          'Present Value': '',
          'Last Updated': format(new Date(stock.updatedAt), 'yyyy-MM-dd')
        };
      }

      const resolvedInputs = {
        ...dcfInputs,
        currentPrice: stock.currentPrice
      } as DCFInputs;
      const { results } = calculateDCF(resolvedInputs);

      return {
        Ticker: stock.ticker,
        Category: stock.category ?? dcfInputs?.category ?? '',
        'Current Price': stock.currentPrice,
        'Desired Return (%)': resolvedInputs.desiredReturn,
        'Valuation Metric': resolvedInputs.valuationMetric,
        'Valuation Multiple': resolvedInputs.valuationMultiple,
        'Base Metric Per Share': resolvedInputs.baseMetricPerShare,
        'Growth Rate Y1 (%)': resolvedInputs.growthRates[0],
        'Growth Rate Y2 (%)': resolvedInputs.growthRates[1],
        'Growth Rate Y3 (%)': resolvedInputs.growthRates[2],
        'Growth Rate Y4 (%)': resolvedInputs.growthRates[3],
        'Growth Rate Y5 (%)': resolvedInputs.growthRates[4],
        'Projected Metric Y1': results.projectedValues[0],
        'Projected Metric Y2': results.projectedValues[1],
        'Projected Metric Y3': results.projectedValues[2],
        'Projected Metric Y4': results.projectedValues[3],
        'Projected Metric Y5': results.projectedValues[4],
        'Projected Price Y1': results.projectedPrices[0],
        'Projected Price Y2': results.projectedPrices[1],
        'Projected Price Y3': results.projectedPrices[2],
        'Projected Price Y4': results.projectedPrices[3],
        'Projected Price Y5': results.projectedPrices[4],
        'Fair Value': results.fairValue,
        'Total Return (%)': results.totalReturn * 100,
        'CAGR (%)': results.cagr * 100,
        'Buy Target': results.buyTargetPrice,
        'Terminal Value': results.terminalValue,
        'Present Value': results.presentValue,
        'Last Updated': format(new Date(stock.updatedAt), 'yyyy-MM-dd')
      };
    });

    downloadCsv('stock-watchlist.csv', rows);
  };

  const filteredAndSortedStocks = useMemo(() => stocks
    .filter(stock => {
      // Search filter
      if (searchTerm && !stock.ticker.toLowerCase().includes(searchTerm.toLowerCase())) {
        return false;
      }

      // Category filter
      if (categoryFilter !== 'all' && (stock.category || '') !== categoryFilter) {
        return false;
      }
      
      // Valuation filter — relative to the displayed case's fair value
      // (base fair value when the selected case is not entered).
      if (filterBy === 'favorites') return Boolean(stock.isFavorite);
      const displayFairValue = getDisplayValuation(stock, displayScenario).fairValue ?? stock.fairValue;
      if (filterBy === 'undervalued') return stock.currentPrice < displayFairValue;
      if (filterBy === 'overvalued') return stock.currentPrice > displayFairValue;
      const displayCagr = getDisplayValuation(stock, displayScenario).cagr ?? stock.cagr;
      if (filterBy === 'cagr10') return displayCagr >= 0.1;
      if (filterBy === 'cagr15') return displayCagr >= 0.15;
      if (filterBy === 'cagr20') return displayCagr >= 0.2;
      return true;
    })
    .sort((a, b) => {
      let comparison = 0;
      // Sorts on valuation numbers follow the displayed case; an unset
      // case sorts to the bottom (treated as -Infinity).
      const aDisplay = getDisplayValuation(a, displayScenario);
      const bDisplay = getDisplayValuation(b, displayScenario);
      switch (sortBy) {
        case 'expectedReturn':
          comparison = (bDisplay.expectedReturn ?? -Infinity) - (aDisplay.expectedReturn ?? -Infinity);
          break;
        case 'cagr':
          comparison = (bDisplay.cagr ?? -Infinity) - (aDisplay.cagr ?? -Infinity);
          break;
        case 'buyTarget':
          comparison = (aDisplay.buyTarget ?? -Infinity) - (bDisplay.buyTarget ?? -Infinity);
          break;
        case 'status':
          const statusOrder = { 'strong-buy': 0, 'buy': 1, 'hold': 2, 'overvalued': 3 };
          const aStatus = aDisplay.isSet && aDisplay.fairValue !== null
            ? getValuationStatusForFairValue(a.currentPrice, aDisplay.fairValue).status
            : 'overvalued';
          const bStatus = bDisplay.isSet && bDisplay.fairValue !== null
            ? getValuationStatusForFairValue(b.currentPrice, bDisplay.fairValue).status
            : 'overvalued';
          comparison = statusOrder[aStatus] - statusOrder[bStatus];
          break;
        case 'lastUpdated':
          comparison = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
          break;
        case 'valuation':
          comparison = (getCurrentValuation(b)?.value ?? 0) - (getCurrentValuation(a)?.value ?? 0);
          break;
        case 'category':
          comparison = (a.category ?? '').localeCompare(b.category ?? '');
          break;
        default:
          comparison = a.ticker.localeCompare(b.ticker);
      }
      
      return sortDirection === 'desc' ? comparison : -comparison;
    }), [stocks, searchTerm, filterBy, categoryFilter, sortBy, sortDirection, displayScenario]);

  // Categories actually present on the watchlist, for the filter dropdown.
  // Built from the loaded rows so user-typed categories show up too.
  const availableCategories = useMemo(() => {
    const seen = new Set<string>();
    stocks.forEach(stock => {
      if (stock.category) seen.add(stock.category);
    });
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [stocks]);

  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
        <p className="text-gray-500 mt-2">Loading watchlist...</p>
      </div>
    );
  }

  if (stocks.length === 0) {
    return (
      <div className="text-center py-12 bg-white rounded-xl shadow-lg">
        <BarChart3 className="w-16 h-16 text-gray-400 mx-auto mb-4" />
        <h3 className="text-xl font-semibold text-gray-800 mb-2">No Stocks in Watchlist</h3>
        <p className="text-gray-500 mb-4">Start by analyzing stocks with the DCF calculator and save them to your watchlist.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Edit Modal */}
      {editingStock && editForm && editResults && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-6xl w-full max-h-[95vh] overflow-y-auto">
            <h3 className="text-xl font-semibold mb-4">Edit {editingStock.ticker}</h3>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Left Column - Edit Form */}
              <div className="space-y-4">
                <h4 className="text-lg font-medium text-gray-800 border-b pb-2">DCF Parameters</h4>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Current Price ($)</label>
                    <input
                      type="number"
                      value={editForm.currentPrice}
                      onChange={(e) => handleEditFormChange('currentPrice', parseFloat(e.target.value) || 0)}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                      step="0.01"
                    />
                    <p className="text-xs text-gray-500 mt-1">Auto-updated by default, but you can override it here.</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Desired Return (%)</label>
                    <input
                      type="number"
                      value={editForm.desiredReturn}
                      onChange={(e) => handleEditFormChange('desiredReturn', parseFloat(e.target.value))}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                      step="0.1"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                  <select
                    value={editCustomCategory ? '__new__' : (editForm.category || '')}
                    onChange={(e) => {
                      if (e.target.value === '__new__') {
                        setEditCustomCategory(true);
                        handleEditCategoryChange('');
                      } else {
                        setEditCustomCategory(false);
                        handleEditCategoryChange(e.target.value);
                      }
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select a category</option>
                    {STOCK_CATEGORIES.map(category => (
                      <option key={category} value={category}>{category}</option>
                    ))}
                    <option value="__new__">Create new category…</option>
                  </select>
                  {editCustomCategory && (
                    <input
                      type="text"
                      value={editForm.category || ''}
                      onChange={(e) => handleEditCategoryChange(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 mt-2"
                      placeholder="New category name"
                    />
                  )}
                  <p className="text-xs text-gray-500 mt-1">One primary category per stock.</p>
                </div>
                
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Valuation Multiple</label>
                      <input
                        type="number"
                        value={editForm.valuationMultiple}
                        onChange={(e) => handleEditFormChange('valuationMultiple', parseFloat(e.target.value))}
                        className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                        step="0.1"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Valuation Metric</label>
                      <select
                        value={editForm.valuationMetric}
                        onChange={(e) => handleEditFormChange('valuationMetric', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                      >
                        {valuationMetrics.map(metric => (
                          <option key={metric.value} value={metric.value}>
                            {metric.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Base Metric Per Share</label>
                    <input
                      type="number"
                      value={editForm.baseMetricPerShare}
                      onChange={(e) => handleEditFormChange('baseMetricPerShare', parseFloat(e.target.value))}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                      step="0.01"
                    />
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Growth Rates (%)</label>
                  <div className="grid grid-cols-5 gap-2">
                    {editForm.growthRates.map((rate, index) => (
                      <div key={index}>
                        <label className="block text-xs text-gray-500 mb-1 text-center">Y{index + 1}</label>
                        <input
                          type="number"
                          value={rate}
                          onChange={(e) => handleGrowthRateChange(index, parseFloat(e.target.value))}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-center text-sm focus:ring-2 focus:ring-blue-500"
                          step="0.1"
                        />
                      </div>
                    ))}
                  </div>
                </div>
                
                {/* Bear Case (optional) */}
                <div className="border border-red-200 bg-red-50 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-700">Bear Case (optional)</label>
                    {(editForm.bearCase?.growthRates.some(rate => Number.isFinite(rate)) ||
                      Number.isFinite(editForm.bearCase?.valuationMultiple)) && (
                      <button
                        type="button"
                        onClick={() => handleClearScenario('bearCase')}
                        className="text-xs text-gray-500 hover:text-red-600 underline"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mb-3">
                    Same inputs as the base case. Leave blank and the bear case stays unset.
                  </p>
                  <div className="grid grid-cols-2 gap-4 mb-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Valuation Multiple</label>
                      <input
                        type="number"
                        value={scenarioInputValue(editForm.bearCase?.valuationMultiple)}
                        onChange={(e) => handleScenarioMultipleChange('bearCase', parseFloat(e.target.value))}
                        className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                        step="0.1"
                        placeholder="e.g., 18"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-5 gap-2">
                    {(editForm.bearCase?.growthRates ?? [NaN, NaN, NaN, NaN, NaN]).map((rate, index) => (
                      <div key={index}>
                        <label className="block text-xs text-gray-500 mb-1 text-center">Y{index + 1}</label>
                        <input
                          type="number"
                          value={scenarioInputValue(rate)}
                          onChange={(e) => handleScenarioGrowthRateChange('bearCase', index, parseFloat(e.target.value))}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-center text-sm focus:ring-2 focus:ring-blue-500"
                          step="0.1"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Bull Case (optional) */}
                <div className="border border-green-200 bg-green-50 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-700">Bull Case (optional)</label>
                    {(editForm.bullCase?.growthRates.some(rate => Number.isFinite(rate)) ||
                      Number.isFinite(editForm.bullCase?.valuationMultiple)) && (
                      <button
                        type="button"
                        onClick={() => handleClearScenario('bullCase')}
                        className="text-xs text-gray-500 hover:text-red-600 underline"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mb-3">
                    Same inputs as the base case. Leave blank and the bull case stays unset.
                  </p>
                  <div className="grid grid-cols-2 gap-4 mb-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Valuation Multiple</label>
                      <input
                        type="number"
                        value={scenarioInputValue(editForm.bullCase?.valuationMultiple)}
                        onChange={(e) => handleScenarioMultipleChange('bullCase', parseFloat(e.target.value))}
                        className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                        step="0.1"
                        placeholder="e.g., 32"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-5 gap-2">
                    {(editForm.bullCase?.growthRates ?? [NaN, NaN, NaN, NaN, NaN]).map((rate, index) => (
                      <div key={index}>
                        <label className="block text-xs text-gray-500 mb-1 text-center">Y{index + 1}</label>
                        <input
                          type="number"
                          value={scenarioInputValue(rate)}
                          onChange={(e) => handleScenarioGrowthRateChange('bullCase', index, parseFloat(e.target.value))}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-center text-sm focus:ring-2 focus:ring-blue-500"
                          step="0.1"
                        />
                      </div>
                    ))}
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Investment Notes</label>
                  <textarea
                    value={editForm.notes || ''}
                    onChange={(e) => handleNotesChange(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                    rows={4}
                    placeholder="Add your investment thesis, pros/cons, key metrics, or any other analysis notes..."
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Track your investment reasoning, key metrics, pros/cons, and analysis updates
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {editForm.ticker}'s Investor Relations page
                  </label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      type="url"
                      value={editForm.investorRelationsLink || ''}
                      onChange={(e) => handleInvestorRelationsLinkChange(e.target.value)}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                      placeholder="https://investor.company.com"
                    />
                    {getInvestorRelationsUrl(editForm.investorRelationsLink) && (
                      <a
                        href={getInvestorRelationsUrl(editForm.investorRelationsLink)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center justify-center rounded-lg bg-blue-50 px-4 py-2 text-sm font-medium text-blue-600 hover:bg-blue-100"
                      >
                        Open Link
                      </a>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Add the official investor relations page for quick access.
                  </p>
                </div>
              </div>
              
              {/* Right Column - DCF Results */}
              <div className="space-y-4">
                <h4 className="text-lg font-medium text-gray-800 border-b pb-2">Updated DCF Results</h4>
                
                {/* Warnings */}
                {editWarnings.length > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                    <h5 className="font-medium text-amber-800 mb-2">Validation Warnings</h5>
                    <ul className="space-y-1">
                      {editWarnings.map((warning, index) => (
                        <li key={index} className="text-sm text-amber-700">
                          • {warning.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                
                {/* Key Metrics */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="text-center p-3 bg-blue-50 rounded-lg">
                    <div className="text-lg font-bold text-blue-600">
                      {formatCurrency(editResults.fairValue)}
                    </div>
                    <p className="text-xs text-gray-600">Fair Value</p>
                  </div>
                  <div className="text-center p-3 bg-green-50 rounded-lg">
                    <div className={`text-lg font-bold ${getPerformanceColor(editResults.totalReturn, 'return')}`}>
                      {formatPercentage(editResults.totalReturn)}
                    </div>
                    <p className="text-xs text-gray-600">Total Return</p>
                  </div>
                  <div className="text-center p-3 bg-purple-50 rounded-lg">
                    <div className={`text-lg font-bold ${getPerformanceColor(editResults.cagr, 'cagr')}`}>
                      {formatPercentage(editResults.cagr)}
                    </div>
                    <p className="text-xs text-gray-600">CAGR</p>
                  </div>
                  <div className="text-center p-3 bg-yellow-50 rounded-lg">
                    <div className="text-lg font-bold text-green-600">
                      {formatCurrency(editResults.buyTargetPrice)}
                    </div>
                    <p className="text-xs text-gray-600">Buy Target</p>
                  </div>
                </div>
                
                {/* 5-Year Projections Table */}
                <div>
                  <h5 className="font-medium text-gray-700 mb-2">5-Year Projections</h5>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border border-gray-200 rounded">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-2 py-1 text-left">Year</th>
                          <th className="px-2 py-1 text-left">Metric Value</th>
                          <th className="px-2 py-1 text-left">Price</th>
                          <th className="px-2 py-1 text-left">Growth</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {editResults.projectedPrices.map((price, index) => {
                          const baseYear = new Date(editingStock.updatedAt).getFullYear();
                          return (
                            <tr key={index}>
                              <td className="px-2 py-1">{baseYear + index + 1}</td>
                              <td className="px-2 py-1 font-medium text-gray-700">${editResults.projectedValues[index].toFixed(2)}</td>
                              <td className="px-2 py-1 font-medium text-blue-600">{formatCurrency(price)}</td>
                              <td className="px-2 py-1">{editForm.growthRates[index]}%</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
                
                {/* Scenario Comparison — Bear / Base / Bull targets */}
                {(() => {
                  const bearResults = getScenarioResults(editForm, 'bear');
                  const bullResults = getScenarioResults(editForm, 'bull');
                  return (
                <div>
                  <h5 className="font-medium text-gray-700 mb-2">Scenario Targets — Bear / Base / Bull</h5>
                  <p className="text-xs text-gray-500 mb-2">
                    A case shows “—” until its growth rates and multiple are fully entered.
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border border-gray-200 rounded">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-2 py-1 text-left">Year</th>
                          <th className="px-2 py-1 text-left text-red-600">Bear</th>
                          <th className="px-2 py-1 text-left text-blue-600">Base</th>
                          <th className="px-2 py-1 text-left text-green-600">Bull</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {editResults.projectedPrices.map((price: number, index: number) => {
                          const baseYear = new Date(editingStock.updatedAt).getFullYear();
                          return (
                            <tr key={index}>
                              <td className="px-2 py-1">{baseYear + index + 1}</td>
                              <td className="px-2 py-1 font-medium text-red-600">
                                {bearResults ? formatCurrency(bearResults.projectedPrices[index]) : '—'}
                              </td>
                              <td className="px-2 py-1 font-medium text-blue-600">{formatCurrency(price)}</td>
                              <td className="px-2 py-1 font-medium text-green-600">
                                {bullResults ? formatCurrency(bullResults.projectedPrices[index]) : '—'}
                              </td>
                            </tr>
                          );
                        })}
                        <tr className="bg-gray-50">
                          <td className="px-2 py-1 font-medium">Fair Value</td>
                          <td className="px-2 py-1 font-medium text-red-600">
                            {bearResults ? formatCurrency(bearResults.fairValue) : '—'}
                          </td>
                          <td className="px-2 py-1 font-medium text-blue-600">{formatCurrency(editResults.fairValue)}</td>
                          <td className="px-2 py-1 font-medium text-green-600">
                            {bullResults ? formatCurrency(bullResults.fairValue) : '—'}
                          </td>
                        </tr>
                        <tr className="bg-gray-50">
                          <td className="px-2 py-1 font-medium">Buy Target</td>
                          <td className="px-2 py-1 font-medium text-red-600">
                            {bearResults ? formatCurrency(bearResults.buyTargetPrice) : '—'}
                          </td>
                          <td className="px-2 py-1 font-medium text-blue-600">{formatCurrency(editResults.buyTargetPrice)}</td>
                          <td className="px-2 py-1 font-medium text-green-600">
                            {bullResults ? formatCurrency(bullResults.buyTargetPrice) : '—'}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
                  );
                })()}

                {/* Valuation Summary */}
                <div className="bg-gray-50 rounded-lg p-3">
                  <h5 className="font-medium text-gray-700 mb-2">Valuation Summary</h5>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span>Current Price:</span>
                      <span className="font-medium">{formatCurrency(editForm.currentPrice)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Fair Value:</span>
                      <span className="font-medium text-blue-600">{formatCurrency(editResults.fairValue)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Upside/Downside:</span>
                      <span className={`font-medium ${editResults.totalReturn >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {formatPercentage(editResults.totalReturn)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Action Buttons */}
            <div className="flex gap-3 mt-8 pt-4 border-t">
              <button
                onClick={saveEdit}
                className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 font-medium"
              >
                Save Changes
              </button>
              <button
                onClick={cancelEdit}
                className="bg-gray-500 text-white px-6 py-2 rounded-lg hover:bg-gray-600 font-medium"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="bg-white rounded-xl shadow-lg p-6">
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-800 mb-1">Stock Watchlist</h2>
            <p className="text-sm text-gray-500">{stocks.length}/{WATCHLIST_LIMIT} stocks tracked</p>
          </div>
          
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
            {/* First row on mobile: Update button and search */}
            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 flex-1">
              <button
                onClick={updateAllCurrentPrices}
                disabled={updatingPrices || priceQueueActive || stocks.length === 0}
                className="flex items-center justify-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                title={priceQueueActive ? 'Background price update still running — the remaining tickers will fill in automatically' : 'Update all current prices'}
              >
                <RefreshCw className={`w-4 h-4 ${updatingPrices || priceQueueActive ? 'animate-spin' : ''}`} />
                {updatingPrices ? 'Updating...' : priceQueueActive ? `Updating ${pendingPriceTickers.length} remaining…` : 'Update Prices'}
              </button>

              <button
                onClick={exportWatchlistCsv}
                disabled={stocks.length === 0}
                className="flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                title="Export watchlist to CSV"
              >
                <Download className="w-4 h-4" />
                Export CSV
              </button>
              
              <div className="relative flex-1 sm:max-w-xs">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search stocks..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent w-full"
                />
              </div>
            </div>
            
            {/* Second row on mobile: Sort and filter controls */}
            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
              <div className="grid grid-cols-2 sm:flex gap-2 sm:gap-3">
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 min-w-0"
                >
                  <option value="ticker">Sort: Ticker</option>
                  <option value="category">Sort: Category</option>
                  <option value="expectedReturn">Sort: Return</option>
                  <option value="cagr">Sort: CAGR</option>
                  <option value="buyTarget">Sort: Buy Target</option>
                  <option value="status">Sort: Status</option>
                  <option value="lastUpdated">Sort: Updated</option>
                  <option value="valuation">Sort: Valuation</option>
                </select>
                
                <select
                  value={sortDirection}
                  onChange={(e) => setSortDirection(e.target.value as 'asc' | 'desc')}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 min-w-0"
                >
                  <option value="desc">↓ Desc</option>
                  <option value="asc">↑ Asc</option>
                </select>
              </div>
              
              <select
                value={filterBy}
                onChange={(e) => setFilterBy(e.target.value as typeof filterBy)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 min-w-0"
              >
                <option value="all">All Stocks</option>
                <option value="favorites">Favorites</option>
                <option value="undervalued">Undervalued</option>
                <option value="overvalued">Overvalued</option>
                <option value="cagr10">CAGR ~ 10%</option>
                <option value="cagr15">CAGR ≥ 15%</option>
                <option value="cagr20">CAGR ~ 20%</option>
              </select>

              {/* DCF case toggle: which case's targets/valuation the table shows */}
              <div
                className="inline-flex rounded-lg border border-gray-300 overflow-hidden"
                role="group"
                aria-label="DCF scenario"
                title="Switch which DCF case the watchlist displays (base by default)"
              >
                {(['bear', 'base', 'bull'] as const).map(scenario => (
                  <button
                    key={scenario}
                    type="button"
                    onClick={() => handleDisplayScenarioChange(scenario)}
                    aria-pressed={displayScenario === scenario}
                    className={`px-3 py-2 text-sm font-medium capitalize transition-colors ${
                      displayScenario === scenario
                        ? scenario === 'bear'
                          ? 'bg-red-600 text-white'
                          : scenario === 'bull'
                            ? 'bg-green-600 text-white'
                            : 'bg-blue-600 text-white'
                        : 'bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {scenario}
                  </button>
                ))}
              </div>

              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 min-w-0"
                title="Filter by category"
              >
                <option value="all">All Categories</option>
                {availableCategories.map(category => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>
      {/* Background price-update queue */}
      {priceQueueActive && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3" role="status">
          <Loader2 className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5 animate-spin" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-blue-800">
              Updating {pendingPriceTickers.length} {pendingPriceTickers.length === 1 ? 'price' : 'prices'} in the background: {pendingPriceTickers.join(', ')}
            </p>
            <p className="text-sm text-blue-700">
              The first batch is already refreshed. The rest will fill in automatically once the rate-limit window clears — no need to wait or click again.
            </p>
          </div>
        </div>
      )}
      {/* Refresh completed with no failures */}
      {priceUpdateComplete && !priceQueueActive && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-start gap-3" role="status">
          <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-green-800">All prices updated.</p>
          </div>
          <button
            type="button"
            onClick={() => setPriceUpdateComplete(false)}
            className="text-green-600 hover:text-green-800 flex-shrink-0"
            title="Dismiss"
            aria-label="Dismiss price update complete notice"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      )}
      {/* Price update failures */}
      {failedPriceTickers.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3" role="alert">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-800">
              {failedPriceTickers.length} {failedPriceTickers.length === 1 ? 'price' : 'prices'} failed to update: {failedPriceTickers.join(', ')}
            </p>
            <p className="text-sm text-amber-700">
              Showing last known prices for these stocks. Try Update Prices again to retry.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setFailedPriceTickers([])}
            className="text-amber-600 hover:text-amber-800 flex-shrink-0"
            title="Dismiss"
            aria-label="Dismiss price update failure notice"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      )}
      {/* Stock Table */}
      <div className="bg-white rounded-xl shadow-lg overflow-hidden">
        <div className="overflow-auto max-h-[75vh]">
          <table className="w-full">
            <thead className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50">Stock</th>
                <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50">Current Price</th>
                <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50">Day Change</th>
                <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50">Target Prices</th>
                <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50">CAGR</th>
                <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50">Current Valuation</th>
                <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50">Buy Target</th>
                <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50">Status</th>
                <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50">Last Updated</th>
                <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredAndSortedStocks.map((stock) => (
                <StockWatchlistRow
                  key={stock.id}
                  stock={stock}
                  displayScenario={displayScenario}
                  priceUpdateFailed={failedPriceTickers.includes(stock.ticker.toUpperCase())}
                  priceUpdatePending={pendingPriceTickers.includes(stock.ticker.toUpperCase())}
                  priceHistory={priceHistory}
                  isHistoryExpanded={expandedHistory.has(stock.id!)}
                  onToggleHistory={toggleHistoryExpansion}
                  onToggleFavorite={toggleFavorite}
                  onEdit={startEdit}
                  onDelete={deleteStock}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
