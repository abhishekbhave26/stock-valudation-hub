import React, { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react';
import { TrendingUp, TrendingDown, Trash2, BarChart3, CreditCard as Edit, RefreshCw, AlertTriangle, Search, Star, Download, ChevronDown, ChevronRight, X, Loader2, CheckCircle2, Tags, ArrowUp, ArrowDown } from 'lucide-react';
import { SavedStock } from '../types';
import { supabase } from '../lib/supabase';
import { formatCurrency, formatPercentage, getPerformanceColor, calculateDCF, getScenarioResults, normalizeScenarioInputs } from '../utils/dcf';
import { DCFInputs, DCFScenarioName } from '../types';
import { stockPriceService } from '../services/stockPriceService';
import {
  enqueueRateLimitedSymbols,
  loadPersistedPriceQueue,
  persistWatchlistPrices,
  refreshAllPrices,
  savePersistedPriceQueue,
  PRICE_QUEUE_RETRY_DELAY_MS
} from '../services/priceRefreshService';
import type { AppliedPriceUpdate, PersistedPriceQueue } from '../services/priceRefreshService';
import { useAuth } from '../hooks/useAuth';
import { useTaxonomy } from '../hooks/useTaxonomy';
import TaxonomyManager from './TaxonomyManager';
import TaxonomyMultiSelect from './TaxonomyMultiSelect';
import { normalizeStringList, firstSortedValue } from '../utils/taxonomy';
import { format, differenceInDays } from 'date-fns';
import { downloadCsv } from '../utils/csv';

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
  // Bear/bull CAGR and total return must use the latest price, not the
  // price stored in dcf_inputs when the case was entered: price refreshes
  // write only saved_stocks.current_price, never dcf_inputs.currentPrice,
  // so the stored price goes stale. Base is untouched — it already uses
  // the stored fields, whose CAGR loadStocks recalculates from the latest
  // price. Fall back to the stored price when the latest price is not a
  // usable positive number, so a zero/missing price can never produce
  // NaN or Infinity here.
  const latestPrice = stock.currentPrice > 0 ? stock.currentPrice : stock.dcf_inputs.currentPrice;
  const results = stock.dcf_inputs ? getScenarioResults({ ...stock.dcf_inputs, currentPrice: latestPrice }, scenario) : null;
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

// The stored per-year growth rates (percent) for the displayed case: base
// uses the top-level rates; bear/bull use their scenario rates. Null when
// the case is unset — a scenario only counts as set when all five growth
// rates and its multiple are finite numbers, matching the validation in
// dcf.ts, so a partial case never yields invented numbers.
const getDisplayGrowthRates = (stock: SavedStock, scenario: DCFScenarioName): number[] | null => {
  const inputs = stock.dcf_inputs;
  if (!inputs) return null;
  if (scenario === 'base') {
    const rates = inputs.growthRates;
    if (!Array.isArray(rates) || rates.length !== 5) return null;
    if (!rates.every(rate => typeof rate === 'number' && Number.isFinite(rate))) return null;
    return rates;
  }
  const scenarioInputs = scenario === 'bear' ? inputs.bearCase : inputs.bullCase;
  if (!scenarioInputs) return null;
  const rates = scenarioInputs.growthRates;
  if (!Array.isArray(rates) || rates.length !== 5) return null;
  if (!rates.every(rate => typeof rate === 'number' && Number.isFinite(rate))) return null;
  if (!Number.isFinite(scenarioInputs.valuationMultiple)) return null;
  return rates;
};

// Growth CAGR: the 5-year compound annual growth rate of the underlying
// metric (earnings/revenue), from the displayed case's Y1–Y5 growth rates.
// This is the growth of the business, not the price-return CAGR shown in
// the CAGR column. Null when the displayed case is unset.
const getGrowthCagr = (stock: SavedStock, scenario: DCFScenarioName): number | null => {
  const rates = getDisplayGrowthRates(stock, scenario);
  if (!rates) return null;
  const compounded = rates.reduce((acc, rate) => acc * (1 + rate / 100), 1);
  const cagr = Math.pow(compounded, 1 / 5) - 1;
  return Number.isFinite(cagr) ? cagr : null;
};

// Valuation-to-growth ratio, PEG-like: the current valuation multiple
// (whatever metric the stock uses — P/E, P/S, P/FCF, P/OCF) divided by
// next year's (Y1) growth rate in percent. E.g. 30x P/E ÷ 30% growth = 1.00.
// Null when the displayed case is unset, there is no current valuation,
// or Y1 growth is not positive — a zero or negative growth rate makes the
// ratio meaningless, never a negative or infinite number.
const getValGrowthRatio = (stock: SavedStock, scenario: DCFScenarioName): number | null => {
  const currentValuation = getCurrentValuation(stock);
  if (!currentValuation) return null;
  const rates = getDisplayGrowthRates(stock, scenario);
  if (!rates) return null;
  const y1Growth = rates[0];
  if (!Number.isFinite(y1Growth) || y1Growth <= 0) return null;
  return currentValuation.value / y1Growth;
};

const isStockStale = (stock: SavedStock) => {
  const updatedAt = new Date(stock.updatedAt);
  const daysSinceUpdate = differenceInDays(new Date(), updatedAt);
  return daysSinceUpdate > 90;
};

/** Config items still missing for a stock, as short labels: currently only
 *  'Category'. Bear/bull cases are optional scenarios, not required config,
 *  so an unset bear or bull case never flags the row. A stock flags only
 *  when it has ZERO categories — one or more is fine. Regions never feed
 *  this flag. Empty array means the stock's config is complete. */
const getMissingConfig = (stock: SavedStock): string[] => {
  const missing: string[] = [];
  if (stock.categories.length === 0) missing.push('Category');
  return missing;
};

/** Shared "needs update" condition for a row: not updated in > 90 days
 *  OR missing a category. Extracted from the row so the badge and the
 *  "Stale only" / "Needs update only" filters can never disagree. */
const getNeedsUpdate = (stock: SavedStock): boolean =>
  isStockStale(stock) || getMissingConfig(stock).length > 0;

// Exhaustive two-tier watchlist filters (Basic bar + Advanced panel).
// Numeric inputs are strings in state; '' means "no constraint".
// Search lives in its own `searchTerm` state (the existing Search input)
// and the panel open/closed state is separate UI state.
interface WatchlistFilters {
  statuses: string[]; // 'strong-buy' | 'buy' | 'hold' | 'overvalued'
  growthCagrMin: string; // percent, '' = unset
  valuationMax: string;
  valuationMetric: '' | 'P/E' | 'P/S' | 'P/FCF'; // '' = All
  valGrowthMax: string;
  dayChangeMax: string; // percent, '' = unset
  priceMin: string; priceMax: string;
  priceCagrMin: string; priceCagrMax: string; // percent
  categories: string[]; regions: string[];
  baseMetricMin: string; baseMetricMax: string;
  desiredReturnMin: string; desiredReturnMax: string; // percent
  fvPriceMin: string; fvPriceMax: string; // decimal ratio
  bearFvMin: string; bearFvMax: string; // dollars
  bullFvMin: string; bullFvMax: string; // dollars
  updatedBefore: string; // 'yyyy-MM-dd', '' = unset
  staleOnly: boolean;
  notesQuery: string;
  needsUpdateOnly: boolean;
}

const DEFAULT_FILTERS: WatchlistFilters = {
  statuses: [],
  growthCagrMin: '',
  valuationMax: '',
  valuationMetric: '',
  valGrowthMax: '',
  dayChangeMax: '',
  priceMin: '', priceMax: '',
  priceCagrMin: '', priceCagrMax: '',
  categories: [], regions: [],
  baseMetricMin: '', baseMetricMax: '',
  desiredReturnMin: '', desiredReturnMax: '',
  fvPriceMin: '', fvPriceMax: '',
  bearFvMin: '', bearFvMax: '',
  bullFvMin: '', bullFvMax: '',
  updatedBefore: '',
  staleOnly: false,
  notesQuery: '',
  needsUpdateOnly: false,
};

// Parse a filter number input: empty or non-numeric input means "no
// constraint" (null) — never crash, never match everything.
const parseFilterNumber = (value: string): number | null => {
  if (value.trim() === '') return null;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

// Range check for one numeric field: when neither end constrains, any
// value matches (including null — an unset filter never excludes). When
// at least one end is set, a null / non-finite value never matches, each
// end applies independently, and an inverted range simply matches nothing.
const inFilterRange = (value: number | null, min: string, max: string): boolean => {
  const minValue = parseFilterNumber(min);
  const maxValue = parseFilterNumber(max);
  if (minValue === null && maxValue === null) return true;
  if (value === null || !Number.isFinite(value)) return false;
  if (minValue !== null && value < minValue) return false;
  if (maxValue !== null && value > maxValue) return false;
  return true;
};

// Toggle one value in a filter list (statuses / categories / regions),
// always returning a new array — never mutating the state in place.
const toggleFilterList = (list: string[], value: string): string[] =>
  list.includes(value) ? list.filter(item => item !== value) : [...list, value];

// How many Advanced-panel fields are currently set — for the badge on
// the toggle while the panel is collapsed. Each non-empty input, each
// selected category/region and each checked box counts once.
const countActiveAdvancedFilters = (filters: WatchlistFilters): number => {
  let count = 0;
  const textFields: (keyof WatchlistFilters)[] = [
    'priceMin', 'priceMax', 'priceCagrMin', 'priceCagrMax',
    'baseMetricMin', 'baseMetricMax', 'desiredReturnMin', 'desiredReturnMax',
    'fvPriceMin', 'fvPriceMax', 'bearFvMin', 'bearFvMax',
    'bullFvMin', 'bullFvMax', 'updatedBefore', 'notesQuery',
  ];
  textFields.forEach(field => {
    const value = filters[field];
    if (typeof value === 'string' && value.trim() !== '') count += 1;
  });
  count += filters.categories.length + filters.regions.length;
  if (filters.staleOnly) count += 1;
  if (filters.needsUpdateOnly) count += 1;
  return count;
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
// stays usable. Queue persistence lives in priceRefreshService so the
// portfolio's refresh can enqueue into the same drain; it only runs
// while the page (or the daily automated run's tab) is open.
const PRICE_QUEUE_PACE_MS = 1000; // one queued fetch per second, stays under 60/min
const PRICE_QUEUE_MAX_ATTEMPTS = 3; // attempts per ticker before it counts as failed

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
  const needsUpdate = getNeedsUpdate(stock);
  // Tooltip naming every reason this row is flagged, e.g.
  // "Last updated Oct 05, 2026 - over 90 days ago — Needs: Category".
  // The missing pieces use the same short form as the visible
  // "Needs: …" line in the Last Updated cell.
  const needsUpdateTitle = [
    isStale ? `Last updated ${format(new Date(stock.updatedAt), 'MMM dd, yyyy')} - over 90 days ago` : null,
    missingConfig.length > 0 ? `Needs: ${missingConfig.map(item => item.replace(' case', '')).join(' · ')}` : null,
  ].filter(Boolean).join(' — ');
  const currentValuation = getCurrentValuation(stock);
  const growthCagr = getGrowthCagr(stock, displayScenario);
  const valGrowthRatio = getValGrowthRatio(stock, displayScenario);
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
            <div className="flex flex-wrap gap-1 mt-0.5">
              {stock.categories.length > 0 ? (
                stock.categories.map(category => (
                  <span key={category} className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-gray-100 text-gray-600">
                    {category}
                  </span>
                ))
              ) : (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-gray-50 text-gray-400">
                  N/A
                </span>
              )}
              {stock.regions.map(region => (
                <span key={region} className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-blue-50 text-blue-700">
                  {region}
                </span>
              ))}
            </div>
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
            <Loader2
              className="w-4 h-4 text-blue-500 animate-spin"
              title="Price updating in the background — will fill in automatically"
            />
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
        {display.cagr !== null ? (
          <div className={`text-sm font-medium ${getPerformanceColor(display.cagr, 'cagr')}`}>
            {formatPercentage(display.cagr)}
          </div>
        ) : (
          <span className="text-sm text-gray-400">—</span>
        )}
      </td>
      <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
        {growthCagr !== null ? (
          <div className={`text-sm font-medium ${getPerformanceColor(growthCagr, 'cagr')}`}>
            {formatPercentage(growthCagr)}
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
        {valGrowthRatio !== null ? (
          <div className="text-sm font-medium text-gray-900">
            {valGrowthRatio.toFixed(2)}
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
      <td className="px-3 sm:px-6 py-4">
        <div className={`whitespace-nowrap text-[10px] ${needsUpdate ? 'text-red-600 font-medium' : 'text-gray-900'}`}>
          {format(new Date(stock.updatedAt), 'MMM dd, yyyy')}
        </div>
        {isStale && (
          <div className="text-[11px] sm:text-xs text-red-500">Needs update</div>
        )}
        {missingConfig.length > 0 && (
          <div className="max-w-36 sm:max-w-none whitespace-normal break-words text-[11px] leading-snug sm:text-xs text-red-500">Needs: {missingConfig.map(item => item.replace(' case', '')).join(' · ')}</div>
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
  const [sortBy, setSortBy] = useState<'ticker' | 'expectedReturn' | 'dayChange' | 'cagr' | 'growthCagr' | 'valGrowth' | 'status' | 'lastUpdated' | 'valuation' | 'category' | 'region'>('cagr');
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
  // True while the Categories | Regions manager is shown instead of the table.
  const [showManager, setShowManager] = useState(false);
  // Bumped after the manager changes anything, so every useTaxonomy
  // instance re-reads the registry.
  const [taxonomyRefreshKey, setTaxonomyRefreshKey] = useState(0);
  // Dropdown options for the edit form: registry names plus any name
  // actually in use on the loaded rows (seed list while the registry table
  // does not exist yet).
  const inUseCategories = useMemo(
    () => stocks.flatMap(stock => stock.categories),
    [stocks]
  );
  const inUseRegions = useMemo(
    () => stocks.flatMap(stock => stock.regions),
    [stocks]
  );
  const { options: categoryOptions } = useTaxonomy('category', inUseCategories, taxonomyRefreshKey);
  const { options: regionOptions } = useTaxonomy('region', inUseRegions, taxonomyRefreshKey);
  const [searchTerm, setSearchTerm] = useState('');
  // Exhaustive two-tier watchlist filters (Basic bar + Advanced panel).
  // No filter state persists across reloads in v1 (unlike
  // displayScenario, which is persisted) — a deliberate scope choice.
  const [filters, setFilters] = useState<WatchlistFilters>(DEFAULT_FILTERS);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Reset every filter (both tiers) plus the pre-existing filterBy
  // select and the search box. The Advanced panel stays open or closed
  // as it is.
  const clearFilters = () => {
    setFilters(DEFAULT_FILTERS);
    setSearchTerm('');
    setFilterBy('all');
  };
  const [editingStock, setEditingStock] = useState<SavedStock | null>(null);
  const [editForm, setEditForm] = useState<DCFInputs | null>(null);
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
  // Ref for the Investment Notes textarea in the edit modal; the box
  // auto-grows to fit its content (see resizeNotesTextarea below).
  const notesTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const WATCHLIST_LIMIT = 500;
  // Short display labels keep the full metric name readable in the
  // narrow edit-form select (the long "Price-to-..." labels clipped to
  // "Price-to-Earnir…"). `value` is unchanged; `fullLabel` keeps the
  // complete name discoverable via the select's title tooltip.
  const valuationMetrics = [
    { value: 'P/S', label: 'Sales (P/S)', fullLabel: 'Price-to-Sales (P/S)' },
    { value: 'P/E', label: 'Earnings (P/E)', fullLabel: 'Price-to-Earnings (P/E)' },
    { value: 'P/FCF', label: 'Free Cash Flow (P/FCF)', fullLabel: 'Price-to-Free Cash Flow (P/FCF)' },
    { value: 'P/B', label: 'Book Value (P/B)', fullLabel: 'Price-to-Book (P/B)' },
    { value: 'P/OCF', label: 'Operating Cash Flow (P/OCF)', fullLabel: 'Price-to-Operating Cash Flow (P/OCF)' },
    { value: 'EV/Sales', label: 'EV/Sales', fullLabel: 'EV/Sales' },
    { value: 'EV/EBITDA', label: 'EV/EBITDA', fullLabel: 'EV/EBITDA' }
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
            // Categories/regions live in the saved row's dcf_inputs JSONB
            // (no schema change needed). Stored as arrays going forward;
            // older single-string values normalize to one element, and the
            // old "N/A" placeholder normalizes to empty.
            categories: normalizeStringList(stock.dcf_inputs?.category),
            regions: normalizeStringList(stock.dcf_inputs?.region)
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
      investorRelationsLink: stock.dcf_inputs?.investorRelationsLink || '',
      // Normalize to arrays: older rows hold a single string (or "N/A").
      category: normalizeStringList(stock.dcf_inputs?.category),
      region: normalizeStringList(stock.dcf_inputs?.region)
    };
    setEditForm(formData);

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
            category: normalizeStringList(editForm.category),
            region: normalizeStringList(editForm.region)
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
  // each background-queue success. The write path itself lives in
  // priceRefreshService (the one shared refresh) — this stays a thin
  // wrapper so the queue drain keeps its existing call shape.
  const persistPriceUpdates = useCallback(async (
    priceMap: Map<string, number>,
    stocksSnapshot: SavedStock[]
  ): Promise<AppliedPriceUpdate[]> => {
    if (!user?.email) return [];
    return persistWatchlistPrices(user.email, priceMap, stocksSnapshot);
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
    let queue: PersistedPriceQueue = {
      symbols: [...initialQueue.symbols],
      attempts: { ...initialQueue.attempts },
      nextRetryAt: initialQueue.nextRetryAt,
      startedAt: initialQueue.startedAt
    };
    const failed: string[] = [...initialFailed];

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
            new Map([[symbol, result.price.price]]),
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
            failed.push(symbol);
          } else {
            stillPending.push(symbol);
          }
        } else {
          // No usable price data (e.g. CSU.CA on the free plan) — retrying
          // will not help, so this counts as failed right away.
          failed.push(symbol);
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
    setFailedPriceTickers(failed);
    setPriceUpdateComplete(failed.length === 0);
    // One final reload so prices, updated dates and price history are all
    // in step with what the queue just saved.
    await loadStocks();
  }, [persistPriceUpdates, loadStocks]);

  const updateAllCurrentPrices = async () => {
    // One refresh at a time: a running first wave or background queue owns
    // the rate-limit window until it finishes.
    if (stocks.length === 0 || updatingPrices || priceQueueActive) return;
    if (!user?.email) return;

    const runId = ++queueRunIdRef.current;
    setUpdatingPrices(true);
    setPriceUpdateComplete(false);
    setFailedPriceTickers([]);
    setPendingPriceTickers([]);
    try {
      // One shared refresh for the watchlist and the portfolio: the
      // service fetches live prices for the watchlist + any portfolio-only
      // tickers (bypassing the 4-hour local cache), persists the watchlist
      // rows (+ price history) and mirrors fresh prices into the stored
      // portfolio fallback. The service caps the first wave at the free
      // plan's 60/min allowance and reports the rest as rate-limited
      // instead of spending calls that would come back 429 — those go to
      // the background queue below.
      const result = await refreshAllPrices(user.email, stocks);
      if (runId !== queueRunIdRef.current) return;

      // Reload watchlist to reflect changes
      await loadStocks();

      if (result.rateLimited.length > 0) {
        // Rate-limited tickers go to the background queue instead of the
        // failure banner: they retry once the minute window clears, while
        // the page stays usable. The banner only ever sees tickers the
        // queue has given up on (plus any that failed outright here).
        const queue = enqueueRateLimitedSymbols(result.rateLimited);
        if (queue) {
          setPendingPriceTickers(queue.symbols);
          setPriceQueueActive(true);
          // Fire and forget: the drain updates rows in place as it goes and
          // reports completion (or the genuinely failed tickers) when done.
          void drainPriceQueue(queue, stocks, runId, result.failed);
        } else {
          setFailedPriceTickers(result.failed);
          setPriceUpdateComplete(result.failed.length === 0);
        }
      } else {
        // Nothing queued: the refresh is already complete.
        setFailedPriceTickers(result.failed);
        setPriceUpdateComplete(result.failed.length === 0);
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

  // Auto-grow the Investment Notes textarea to fit its content, so
  // the notes never scroll internally. Resetting to 'auto' first lets
  // the box shrink as well as grow; rows={4} on the textarea keeps
  // the minimum height at four lines.
  const resizeNotesTextarea = useCallback(() => {
    const el = notesTextareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  // Resize whenever the edit modal opens or the notes change (typing,
  // or opening a different stock).
  useEffect(() => {
    resizeNotesTextarea();
  }, [editingStock, editForm?.notes, resizeNotesTextarea]);

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
          Category: stock.categories.join('; '),
          Region: stock.regions.join('; '),
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
        Category: stock.categories.join('; '),
        Region: stock.regions.join('; '),
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
      // Search filter (ticker substring, case-insensitive — there is no
      // company-name field in SavedStock, so search is ticker-only).
      if (searchTerm && !stock.ticker.toLowerCase().includes(searchTerm.toLowerCase())) {
        return false;
      }

      // Status checkboxes — status comes from the displayed case exactly
      // like the row badge. A row with no status ("—", unset case)
      // matches no status checkbox.
      if (filters.statuses.length > 0) {
        const display = getDisplayValuation(stock, displayScenario);
        if (!display.isSet || display.fairValue === null) return false;
        const status = getValuationStatusForFairValue(stock.currentPrice, display.fairValue).status;
        if (!filters.statuses.includes(status)) return false;
      }

      // Growth CAGR ≥ (percent). Null (e.g. HIMS) never matches.
      if (filters.growthCagrMin !== '') {
        const min = parseFilterNumber(filters.growthCagrMin);
        if (min !== null) {
          const growthCagr = getGrowthCagr(stock, displayScenario);
          if (growthCagr === null || growthCagr * 100 < min) return false;
        }
      }

      // Current Valuation ≤ (+ metric selector). Current valuation is
      // case-independent in the code (it uses the shared base metric),
      // so the selector + range apply to the single displayed value. A
      // metric selector on its own also constrains: only stocks on that
      // metric match. Stocks on P/B, P/OCF, EV/Sales or EV/EBITDA match
      // only when the selector is "All".
      if (filters.valuationMax !== '' || filters.valuationMetric !== '') {
        const valuationMax = parseFilterNumber(filters.valuationMax);
        if (valuationMax !== null || filters.valuationMetric !== '') {
          const currentValuation = getCurrentValuation(stock);
          if (currentValuation === null) return false;
          if (filters.valuationMetric !== '' && currentValuation.metric !== filters.valuationMetric) return false;
          if (valuationMax !== null && currentValuation.value > valuationMax) return false;
        }
      }

      // Val/Growth ≤ (displayed case's Y1 growth).
      if (filters.valGrowthMax !== '') {
        const max = parseFilterNumber(filters.valGrowthMax);
        if (max !== null) {
          const ratio = getValGrowthRatio(stock, displayScenario);
          if (ratio === null || ratio > max) return false;
        }
      }

      // Day Change ≤ (percent).
      if (filters.dayChangeMax !== '') {
        const max = parseFilterNumber(filters.dayChangeMax);
        if (max !== null) {
          const dayChange = getDayChange(priceHistory, stock);
          if (dayChange === null || dayChange * 100 > max) return false;
        }
      }

      // Price min–max (dollars).
      if (!inFilterRange(stock.currentPrice, filters.priceMin, filters.priceMax)) {
        return false;
      }

      // Price-return CAGR min–max (percent; same value the CAGR column
      // shows — the displayed-case CAGR, falling back to the stored base
      // CAGR when the case is unset, like the filterBy presets).
      if (!inFilterRange(
        (getDisplayValuation(stock, displayScenario).cagr ?? stock.cagr) * 100,
        filters.priceCagrMin,
        filters.priceCagrMax
      )) {
        return false;
      }

      // Category / Region multi-selects — a stock matches if ANY of its
      // categories / regions is selected. A stock with none set matches
      // only when nothing is selected.
      if (filters.categories.length > 0 &&
        !stock.categories.some(category => filters.categories.includes(category))) {
        return false;
      }
      if (filters.regions.length > 0 &&
        !stock.regions.some(region => filters.regions.includes(region))) {
        return false;
      }

      // Base metric value min–max (dollars per share), gated by the same
      // metric selector as Current Valuation. Negative base metrics
      // (e.g. HIMS −0.56) compare normally — no clamping at zero.
      if (filters.baseMetricMin !== '' || filters.baseMetricMax !== '') {
        const baseMetricMin = parseFilterNumber(filters.baseMetricMin);
        const baseMetricMax = parseFilterNumber(filters.baseMetricMax);
        if (baseMetricMin !== null || baseMetricMax !== null) {
          if (filters.valuationMetric !== '' && stock.dcf_inputs?.valuationMetric !== filters.valuationMetric) return false;
          const baseMetric = stock.dcf_inputs?.baseMetricPerShare ?? null;
          if (!inFilterRange(baseMetric, filters.baseMetricMin, filters.baseMetricMax)) return false;
        }
      }

      // Desired Return min–max (percent, raw stored number).
      if (!inFilterRange(stock.dcf_inputs?.desiredReturn ?? null, filters.desiredReturnMin, filters.desiredReturnMax)) {
        return false;
      }

      // FV / Price ratio min–max (decimal ratio, displayed case).
      if (!inFilterRange(
        (() => {
          const display = getDisplayValuation(stock, displayScenario);
          return display.fairValue !== null && stock.currentPrice > 0
            ? display.fairValue / stock.currentPrice
            : null;
        })(),
        filters.fvPriceMin,
        filters.fvPriceMax
      )) {
        return false;
      }

      // Bear-case FV range (dollars) and Bull-case FV range (dollars) —
      // read directly from their own case, not the displayed case. An
      // unset case has a null FV and never matches a set range.
      if (!inFilterRange(getDisplayValuation(stock, 'bear').fairValue, filters.bearFvMin, filters.bearFvMax)) {
        return false;
      }
      if (!inFilterRange(getDisplayValuation(stock, 'bull').fairValue, filters.bullFvMin, filters.bullFvMax)) {
        return false;
      }

      // Last Updated: "updated before [date]" (ISO string comparison,
      // so no timezone edge cases).
      if (filters.updatedBefore !== '' &&
        format(new Date(stock.updatedAt), 'yyyy-MM-dd') >= filters.updatedBefore) {
        return false;
      }

      // Stale only / Needs update only — the same in-app condition as
      // the row badge (not updated in > 90 days OR missing a category).
      if (filters.staleOnly && !getNeedsUpdate(stock)) return false;
      if (filters.needsUpdateOnly && !getNeedsUpdate(stock)) return false;

      // Notes text search (top-level notes field).
      if (filters.notesQuery.trim() !== '' &&
        !(stock.notes ?? '').toLowerCase().includes(filters.notesQuery.trim().toLowerCase())) {
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
        case 'dayChange': {
          // Biggest gainers first in descending mode, biggest losers
          // first in ascending mode. A stock with no prior-day close
          // yet (day change is null) always sorts to the bottom, in
          // both directions: the direction flip at the end of this
          // comparator would otherwise lift nulls to the top in
          // ascending mode, so the null ordering is pre-flipped here.
          const aChange = getDayChange(priceHistory, a);
          const bChange = getDayChange(priceHistory, b);
          if (aChange === null && bChange === null) {
            comparison = 0;
          } else if (aChange === null) {
            comparison = sortDirection === 'desc' ? 1 : -1;
          } else if (bChange === null) {
            comparison = sortDirection === 'desc' ? -1 : 1;
          } else {
            comparison = bChange - aChange;
          }
          break;
        }
        case 'cagr':
          comparison = (bDisplay.cagr ?? -Infinity) - (aDisplay.cagr ?? -Infinity);
          break;
        case 'growthCagr': {
          // Highest growth CAGR first in descending mode, lowest first
          // in ascending mode. A stock with no growth CAGR (unset case)
          // always sorts to the bottom, in both directions — same
          // pre-flip trick as dayChange and valGrowth.
          const aGrowthCagr = getGrowthCagr(a, displayScenario);
          const bGrowthCagr = getGrowthCagr(b, displayScenario);
          if (aGrowthCagr === null && bGrowthCagr === null) {
            comparison = 0;
          } else if (aGrowthCagr === null) {
            comparison = sortDirection === 'desc' ? 1 : -1;
          } else if (bGrowthCagr === null) {
            comparison = sortDirection === 'desc' ? -1 : 1;
          } else {
            comparison = bGrowthCagr - aGrowthCagr;
          }
          break;
        }
        case 'valGrowth': {
          // Highest ratio first in descending mode, lowest first in
          // ascending mode. A stock with no ratio (unset case, no current
          // valuation, or non-positive Y1 growth) always sorts to the
          // bottom, in both directions — same pre-flip trick as dayChange.
          const aRatio = getValGrowthRatio(a, displayScenario);
          const bRatio = getValGrowthRatio(b, displayScenario);
          if (aRatio === null && bRatio === null) {
            comparison = 0;
          } else if (aRatio === null) {
            comparison = sortDirection === 'desc' ? 1 : -1;
          } else if (bRatio === null) {
            comparison = sortDirection === 'desc' ? -1 : 1;
          } else {
            comparison = bRatio - aRatio;
          }
          break;
        }
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
          // Sort key is the alphabetically-first category (see
          // firstSortedValue) so multi-value stocks sort deterministically.
          comparison = firstSortedValue(a.categories).localeCompare(firstSortedValue(b.categories));
          break;
        case 'region':
          comparison = firstSortedValue(a.regions).localeCompare(firstSortedValue(b.regions));
          break;
        default:
          comparison = a.ticker.localeCompare(b.ticker);
      }
      
      return sortDirection === 'desc' ? comparison : -comparison;
    }), [stocks, searchTerm, filterBy, filters, sortBy, sortDirection, displayScenario, priceHistory]);

  // Categories actually present on the watchlist, for the filter dropdown.
  // Built from the loaded rows so user-typed categories show up too.
  const availableCategories = useMemo(() => {
    const seen = new Set<string>();
    stocks.forEach(stock => {
      stock.categories.forEach(category => seen.add(category));
    });
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [stocks]);

  // Regions actually present on the watchlist, for the filter dropdown.
  // Same derivation as categories; a merged-away region drops out here
  // as soon as no stock has it.
  const availableRegions = useMemo(() => {
    const seen = new Set<string>();
    stocks.forEach(stock => {
      stock.regions.forEach(region => seen.add(region));
    });
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [stocks]);

  // How many Advanced-panel filters are set — shown on the toggle as a
  // badge while the panel is collapsed.
  const activeAdvancedFilterCount = useMemo(
    () => countActiveAdvancedFilters(filters),
    [filters]
  );

  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
        <p className="text-gray-500 mt-2">Loading watchlist...</p>
      </div>
    );
  }

  // Categories | Regions manager, one click from the watchlist and back.
  if (showManager) {
    return (
      <TaxonomyManager
        stocks={stocks}
        refreshKey={taxonomyRefreshKey}
        onBack={() => setShowManager(false)}
        onChanged={() => {
          loadStocks();
          setTaxonomyRefreshKey(key => key + 1);
        }}
      />
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

                <TaxonomyMultiSelect
                  label="Category"
                  options={categoryOptions}
                  selected={editForm.category ?? []}
                  onChange={value => setEditForm({ ...editForm, category: value })}
                  createPlaceholder="New category name"
                />

                <TaxonomyMultiSelect
                  label="Region"
                  options={regionOptions}
                  selected={editForm.region ?? []}
                  onChange={value => setEditForm({ ...editForm, region: value })}
                  createPlaceholder="New region name"
                  exclusiveValue="Global"
                />
                
                {/* Shared Inputs — Common to All Cases */}
                {/* The valuation metric and its base value are the same for
                    the base, bear and bull cases, so they sit here once,
                    above the three case boxes, instead of inside any one
                    of them. Single stored fields — no data-model change. */}
                <div className="border border-gray-200 bg-gray-50 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-700">Common to All Cases</label>
                  </div>
                  <p className="text-xs text-gray-500 mb-3">
                    The valuation metric and its base value are the same for the base, bear and bull cases.
                  </p>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="min-w-0">
                      <label className="block text-sm font-medium text-gray-700 mb-1">Valuation Metric</label>
                      <select
                        value={editForm.valuationMetric}
                        onChange={(e) => handleEditFormChange('valuationMetric', e.target.value)}
                        title={valuationMetrics.find(metric => metric.value === editForm.valuationMetric)?.fullLabel ?? ''}
                        className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 text-sm"
                      >
                        {valuationMetrics.map(metric => (
                          <option key={metric.value} value={metric.value}>
                            {metric.label}
                          </option>
                        ))}
                      </select>
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
                </div>

                {/* Base Case */}
                <div className="border border-blue-200 bg-blue-50 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-700">Base Case</label>
                  </div>
                  <div className="grid grid-cols-2 gap-4 mb-3">
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
                    ref={notesTextareaRef}
                    value={editForm.notes || ''}
                    onChange={(e) => handleNotesChange(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 overflow-hidden resize-none"
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
                
                {/* 5-Year Projections Table — projected metric value for
                    all three cases, each in its scenario color. A case
                    shows "—" until its growth rates and multiple are
                    fully entered. Price and Growth are the base case's. */}
                {(() => {
                  const bearResults = getScenarioResults(editForm, 'bear');
                  const bullResults = getScenarioResults(editForm, 'bull');
                  return (
                <div>
                  <h5 className="font-medium text-gray-700 mb-2">5-Year Projections</h5>
                  <p className="text-xs text-gray-500 mb-2">
                    Projected metric value by scenario — a case shows “—” until its growth rates and multiple are fully entered.
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border border-gray-200 rounded">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-2 py-1 text-left">Year</th>
                          <th className="px-2 py-1 text-left text-red-600">Bear</th>
                          <th className="px-2 py-1 text-left text-blue-600">Base</th>
                          <th className="px-2 py-1 text-left text-green-600">Bull</th>
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
                              <td className="px-2 py-1 font-medium text-red-600">
                                {bearResults ? `$${bearResults.projectedValues[index].toFixed(2)}` : '—'}
                              </td>
                              <td className="px-2 py-1 font-medium text-blue-600">${editResults.projectedValues[index].toFixed(2)}</td>
                              <td className="px-2 py-1 font-medium text-green-600">
                                {bullResults ? `$${bullResults.projectedValues[index].toFixed(2)}` : '—'}
                              </td>
                              <td className="px-2 py-1 font-medium text-blue-600">{formatCurrency(price)}</td>
                              <td className="px-2 py-1">{editForm.growthRates[index]}%</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
                  );
                })()}
                
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
      <div className="bg-white rounded-xl shadow-lg p-4 sm:p-5">
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-800 mb-1">Stock Watchlist</h2>
            <p className="text-sm text-gray-500">{stocks.length}/{WATCHLIST_LIMIT} stocks tracked</p>
          </div>

          {/* Row 1: Actions + Search */}
          <div className="flex flex-col sm:flex-row sm:items-end gap-4">
            {/* Actions — Update Prices is the one primary button */}
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Actions</span>
              <div className="flex gap-2">
                <button
                  onClick={updateAllCurrentPrices}
                  disabled={updatingPrices || priceQueueActive || stocks.length === 0}
                  className="flex items-center justify-center gap-2 bg-green-600 text-white px-4 h-10 rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                  title={priceQueueActive ? 'Background price update still running — the remaining tickers will fill in automatically' : 'Update all current prices'}
                >
                  <RefreshCw className={`w-4 h-4 ${updatingPrices || priceQueueActive ? 'animate-spin' : ''}`} />
                  {updatingPrices ? 'Updating...' : priceQueueActive ? `Updating ${pendingPriceTickers.length} remaining…` : 'Update Prices'}
                </button>

                <button
                  onClick={exportWatchlistCsv}
                  disabled={stocks.length === 0}
                  className="flex items-center justify-center gap-2 border border-gray-300 bg-white text-gray-700 px-4 h-10 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                  title="Export watchlist to CSV"
                >
                  <Download className="w-4 h-4" />
                  Export CSV
                </button>
              </div>
            </div>

            {/* Search */}
            <div className="flex flex-col gap-1 flex-1 sm:max-w-xs">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Search</span>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search stocks..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 pr-4 h-10 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent w-full"
                />
              </div>
            </div>
          </div>

          <div className="border-t border-gray-100" />

          {/* Row 2: View + Sort & filter */}
          <div className="flex flex-col sm:flex-row sm:items-end gap-4">
            {/* View — DCF case toggle: which case's targets/valuation the table shows */}
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">View</span>
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
                    className={`px-3 h-10 text-sm font-medium capitalize transition-colors ${
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
            </div>

            {/* Sort & filter */}
            <div className="flex flex-col gap-1 min-w-0 flex-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Sort &amp; filter</span>
              <div className="flex flex-wrap gap-2">
                {/* Sort field + direction as one joined control */}
                <div className="flex rounded-lg border border-gray-300 overflow-hidden focus-within:ring-2 focus-within:ring-blue-500">
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                    aria-label="Sort by"
                    className="px-3 h-10 border-0 text-sm focus:outline-none min-w-0 bg-white"
                  >
                    <option value="ticker">Sort: Ticker</option>
                    <option value="category">Sort: Category</option>
                    <option value="region">Sort: Region</option>
                    <option value="expectedReturn">Sort: Return</option>
                    <option value="dayChange">Sort: Day Change</option>
                    <option value="cagr">Sort: CAGR</option>
                    <option value="growthCagr">Sort: Growth CAGR</option>
                    <option value="valGrowth">Sort: Val/Growth</option>
                    <option value="status">Sort: Status</option>
                    <option value="lastUpdated">Sort: Updated</option>
                    <option value="valuation">Sort: Valuation</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => setSortDirection(sortDirection === 'desc' ? 'asc' : 'desc')}
                    aria-label={sortDirection === 'desc' ? 'Sort descending — switch to ascending' : 'Sort ascending — switch to descending'}
                    title={sortDirection === 'desc' ? 'Descending — click for ascending' : 'Ascending — click for descending'}
                    className="flex items-center justify-center w-10 h-10 border-l border-gray-300 bg-gray-50 text-gray-600 hover:bg-gray-100 transition-colors shrink-0"
                  >
                    {sortDirection === 'desc' ? <ArrowDown className="w-4 h-4" /> : <ArrowUp className="w-4 h-4" />}
                  </button>
                </div>

                <select
                  value={filterBy}
                  onChange={(e) => setFilterBy(e.target.value as typeof filterBy)}
                  className="px-3 h-10 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 min-w-0 bg-white"
                >
                  <option value="all">All Stocks</option>
                  <option value="favorites">Favorites</option>
                  <option value="undervalued">Undervalued</option>
                  <option value="overvalued">Overvalued</option>
                  <option value="cagr10">CAGR ~ 10%</option>
                  <option value="cagr15">CAGR ≥ 15%</option>
                  <option value="cagr20">CAGR ~ 20%</option>
                </select>

                <button
                  type="button"
                  onClick={() => setShowManager(true)}
                  className="flex items-center justify-center gap-2 px-3 h-10 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 whitespace-nowrap"
                  title="Add, rename, merge or remove categories and regions"
                >
                  <Tags className="w-4 h-4" />
                  Manage categories &amp; regions
                </button>
              </div>
            </div>
          </div>

          <div className="border-t border-gray-100" />

          {/* Row 3: Filter — Basic bar (always visible) */}
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Filter</span>
            <div className="flex flex-wrap gap-2 items-end">
              {/* Status checkboxes */}
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-gray-500">Status</span>
                <div className="flex flex-wrap gap-3 h-10 items-center">
                  {([
                    ['strong-buy', 'Strong Buy'],
                    ['buy', 'Buy'],
                    ['hold', 'Hold'],
                    ['overvalued', 'Overvalued'],
                  ] as const).map(([value, label]) => (
                    <label key={value} className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer whitespace-nowrap">
                      <input
                        type="checkbox"
                        checked={filters.statuses.includes(value)}
                        onChange={() => setFilters(prev => ({ ...prev, statuses: toggleFilterList(prev.statuses, value) }))}
                        className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>

              {/* Growth CAGR ≥ */}
              <div className="flex flex-col gap-1">
                <label htmlFor="filter-growth-cagr-min" className="text-[11px] font-medium text-gray-500">Growth CAGR ≥ %</label>
                <input
                  id="filter-growth-cagr-min"
                  type="number"
                  placeholder="15"
                  value={filters.growthCagrMin}
                  onChange={(e) => setFilters(prev => ({ ...prev, growthCagrMin: e.target.value }))}
                  className="px-3 h-10 w-24 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Current Valuation ≤ + metric selector. The valuation is
                  case-independent (shared base metric), so this range
                  applies to the single displayed value. */}
              <div className="flex flex-col gap-1">
                <label htmlFor="filter-valuation-max" className="text-[11px] font-medium text-gray-500">Valuation ≤</label>
                <div className="flex gap-2">
                  <input
                    id="filter-valuation-max"
                    type="number"
                    placeholder="20"
                    value={filters.valuationMax}
                    onChange={(e) => setFilters(prev => ({ ...prev, valuationMax: e.target.value }))}
                    className="px-3 h-10 w-24 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                  />
                  <select
                    value={filters.valuationMetric}
                    onChange={(e) => setFilters(prev => ({ ...prev, valuationMetric: e.target.value as WatchlistFilters['valuationMetric'] }))}
                    aria-label="Valuation metric"
                    title="Which valuation metric the Valuation and Base metric filters apply to"
                    className="px-3 h-10 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 bg-white"
                  >
                    <option value="">All metrics</option>
                    <option value="P/E">P/E</option>
                    <option value="P/S">P/S</option>
                    <option value="P/FCF">P/FCF</option>
                  </select>
                </div>
              </div>

              {/* Val/Growth ≤ */}
              <div className="flex flex-col gap-1">
                <label htmlFor="filter-val-growth-max" className="text-[11px] font-medium text-gray-500">Val/Growth ≤</label>
                <input
                  id="filter-val-growth-max"
                  type="number"
                  step="0.1"
                  placeholder="1.0"
                  value={filters.valGrowthMax}
                  onChange={(e) => setFilters(prev => ({ ...prev, valGrowthMax: e.target.value }))}
                  className="px-3 h-10 w-24 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Day Change ≤ */}
              <div className="flex flex-col gap-1">
                <label htmlFor="filter-day-change-max" className="text-[11px] font-medium text-gray-500">Day Change ≤ %</label>
                <input
                  id="filter-day-change-max"
                  type="number"
                  placeholder="-5"
                  value={filters.dayChangeMax}
                  onChange={(e) => setFilters(prev => ({ ...prev, dayChangeMax: e.target.value }))}
                  className="px-3 h-10 w-24 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Advanced toggle + Clear all */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setAdvancedOpen(open => !open)}
                  aria-expanded={advancedOpen}
                  className="flex items-center justify-center gap-1 px-3 h-10 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 whitespace-nowrap"
                  title="Show or hide the advanced filters"
                >
                  {advancedOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  Advanced filters{!advancedOpen && activeAdvancedFilterCount > 0 ? ` (${activeAdvancedFilterCount})` : ''}
                </button>
                <button
                  type="button"
                  onClick={clearFilters}
                  className="px-3 h-10 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 whitespace-nowrap"
                  title="Reset all filters (both tiers), the View filter and search"
                >
                  Clear all
                </button>
              </div>
            </div>
          </div>

          {/* Advanced panel (collapsed by default) */}
          {advancedOpen && (
            <div className="border border-gray-200 rounded-lg p-4">
              <div className="flex flex-wrap gap-4 items-end">
                {/* Price min–max */}
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-gray-500">Price ($)</span>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      placeholder="Min"
                      aria-label="Minimum price"
                      value={filters.priceMin}
                      onChange={(e) => setFilters(prev => ({ ...prev, priceMin: e.target.value }))}
                      className="px-3 h-10 w-24 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                    />
                    <input
                      type="number"
                      placeholder="Max"
                      aria-label="Maximum price"
                      value={filters.priceMax}
                      onChange={(e) => setFilters(prev => ({ ...prev, priceMax: e.target.value }))}
                      className="px-3 h-10 w-24 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                {/* Price-return CAGR min–max */}
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-gray-500">Price CAGR (%)</span>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      placeholder="Min"
                      aria-label="Minimum price-return CAGR"
                      value={filters.priceCagrMin}
                      onChange={(e) => setFilters(prev => ({ ...prev, priceCagrMin: e.target.value }))}
                      className="px-3 h-10 w-24 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                    />
                    <input
                      type="number"
                      placeholder="Max"
                      aria-label="Maximum price-return CAGR"
                      value={filters.priceCagrMax}
                      onChange={(e) => setFilters(prev => ({ ...prev, priceCagrMax: e.target.value }))}
                      className="px-3 h-10 w-24 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                {/* Category multi-select */}
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-gray-500">Category</span>
                  <div className="max-h-40 overflow-y-auto border border-gray-300 rounded-lg min-w-[12rem]">
                    {availableCategories.length === 0 && (
                      <p className="px-3 py-2 text-sm text-gray-500">No categories yet.</p>
                    )}
                    {availableCategories.map(category => (
                      <label key={category} className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={filters.categories.includes(category)}
                          onChange={() => setFilters(prev => ({ ...prev, categories: toggleFilterList(prev.categories, category) }))}
                          className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                        />
                        <span>{category}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Region multi-select */}
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-gray-500">Region</span>
                  <div className="max-h-40 overflow-y-auto border border-gray-300 rounded-lg min-w-[12rem]">
                    {availableRegions.length === 0 && (
                      <p className="px-3 py-2 text-sm text-gray-500">No regions yet.</p>
                    )}
                    {availableRegions.map(region => (
                      <label key={region} className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={filters.regions.includes(region)}
                          onChange={() => setFilters(prev => ({ ...prev, regions: toggleFilterList(prev.regions, region) }))}
                          className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                        />
                        <span>{region}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Base metric min–max */}
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-gray-500">Base metric ($)</span>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      step="0.01"
                      placeholder="Min"
                      aria-label="Minimum base metric"
                      value={filters.baseMetricMin}
                      onChange={(e) => setFilters(prev => ({ ...prev, baseMetricMin: e.target.value }))}
                      className="px-3 h-10 w-24 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                    />
                    <input
                      type="number"
                      step="0.01"
                      placeholder="Max"
                      aria-label="Maximum base metric"
                      value={filters.baseMetricMax}
                      onChange={(e) => setFilters(prev => ({ ...prev, baseMetricMax: e.target.value }))}
                      className="px-3 h-10 w-24 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <span className="text-[11px] text-gray-400">Uses the metric selector in the Filter bar.</span>
                </div>

                {/* Desired Return min–max */}
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-gray-500">Desired Return (%)</span>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      placeholder="Min"
                      aria-label="Minimum desired return"
                      value={filters.desiredReturnMin}
                      onChange={(e) => setFilters(prev => ({ ...prev, desiredReturnMin: e.target.value }))}
                      className="px-3 h-10 w-24 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                    />
                    <input
                      type="number"
                      placeholder="Max"
                      aria-label="Maximum desired return"
                      value={filters.desiredReturnMax}
                      onChange={(e) => setFilters(prev => ({ ...prev, desiredReturnMax: e.target.value }))}
                      className="px-3 h-10 w-24 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                {/* FV / Price ratio min–max */}
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-gray-500">FV / Price</span>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      step="0.1"
                      placeholder="Min"
                      aria-label="Minimum fair value to price ratio"
                      value={filters.fvPriceMin}
                      onChange={(e) => setFilters(prev => ({ ...prev, fvPriceMin: e.target.value }))}
                      className="px-3 h-10 w-24 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                    />
                    <input
                      type="number"
                      step="0.1"
                      placeholder="Max"
                      aria-label="Maximum fair value to price ratio"
                      value={filters.fvPriceMax}
                      onChange={(e) => setFilters(prev => ({ ...prev, fvPriceMax: e.target.value }))}
                      className="px-3 h-10 w-24 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                {/* Bear-case FV min–max */}
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-gray-500">Bear FV ($)</span>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      placeholder="Min"
                      aria-label="Minimum bear-case fair value"
                      value={filters.bearFvMin}
                      onChange={(e) => setFilters(prev => ({ ...prev, bearFvMin: e.target.value }))}
                      className="px-3 h-10 w-24 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                    />
                    <input
                      type="number"
                      placeholder="Max"
                      aria-label="Maximum bear-case fair value"
                      value={filters.bearFvMax}
                      onChange={(e) => setFilters(prev => ({ ...prev, bearFvMax: e.target.value }))}
                      className="px-3 h-10 w-24 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                {/* Bull-case FV min–max */}
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-gray-500">Bull FV ($)</span>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      placeholder="Min"
                      aria-label="Minimum bull-case fair value"
                      value={filters.bullFvMin}
                      onChange={(e) => setFilters(prev => ({ ...prev, bullFvMin: e.target.value }))}
                      className="px-3 h-10 w-24 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                    />
                    <input
                      type="number"
                      placeholder="Max"
                      aria-label="Maximum bull-case fair value"
                      value={filters.bullFvMax}
                      onChange={(e) => setFilters(prev => ({ ...prev, bullFvMax: e.target.value }))}
                      className="px-3 h-10 w-24 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                {/* Last Updated cutoff + Stale only */}
                <div className="flex flex-col gap-1">
                  <label htmlFor="filter-updated-before" className="text-[11px] font-medium text-gray-500">Updated before</label>
                  <input
                    id="filter-updated-before"
                    type="date"
                    value={filters.updatedBefore}
                    onChange={(e) => setFilters(prev => ({ ...prev, updatedBefore: e.target.value }))}
                    className="px-3 h-10 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 bg-white"
                  />
                  <label className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={filters.staleOnly}
                      onChange={(e) => setFilters(prev => ({ ...prev, staleOnly: e.target.checked }))}
                      className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                    />
                    Stale only
                  </label>
                </div>

                {/* Notes text search */}
                <div className="flex flex-col gap-1">
                  <label htmlFor="filter-notes-query" className="text-[11px] font-medium text-gray-500">Notes contain</label>
                  <input
                    id="filter-notes-query"
                    type="text"
                    placeholder="Search notes..."
                    value={filters.notesQuery}
                    onChange={(e) => setFilters(prev => ({ ...prev, notesQuery: e.target.value }))}
                    className="px-3 h-10 w-48 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Needs update only */}
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-gray-500">Flags</span>
                  <label className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer whitespace-nowrap h-10">
                    <input
                      type="checkbox"
                      checked={filters.needsUpdateOnly}
                      onChange={(e) => setFilters(prev => ({ ...prev, needsUpdateOnly: e.target.checked }))}
                      className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                    />
                    Needs update only
                  </label>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      {/* Filter result count — updates live as filters change */}
      <p className="text-sm text-gray-500 px-1">{filteredAndSortedStocks.length} of {stocks.length} stocks</p>
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
      {filteredAndSortedStocks.length === 0 ? (
        <div className="bg-white rounded-xl shadow-lg p-8 text-center">
          <h3 className="text-lg font-semibold text-gray-800 mb-2">No stocks match the current filters</h3>
          <p className="text-gray-500 mb-4">Loosen a range or clear all filters to see the full watchlist.</p>
          <button
            type="button"
            onClick={clearFilters}
            className="px-4 h-10 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
          >
            Clear all filters
          </button>
        </div>
      ) : (
      <div className="bg-white rounded-xl shadow-lg overflow-hidden">
        <div className="overflow-auto max-h-[75vh]">
          <table className="w-full">
            <thead className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50">Stock</th>
                <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50">Current Price</th>
                <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50">Day Change</th>
                <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50">CAGR</th>
                <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50">Growth CAGR</th>
                <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50">Current Valuation</th>
                <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50">Val/Growth</th>
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
      )}
    </div>
  );
}
