import React, { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { TrendingUp, TrendingDown, Trash2, BarChart3, CreditCard as Edit, RefreshCw, AlertTriangle, Search, Star, Download, ChevronDown, ChevronRight, X } from 'lucide-react';
import { SavedStock } from '../types';
import { supabase } from '../lib/supabase';
import { formatCurrency, formatPercentage, getPerformanceColor, calculateDCF } from '../utils/dcf';
import { DCFInputs } from '../types';
import { stockPriceService } from '../services/stockPriceService';
import { useAuth } from '../hooks/useAuth';
import { format, differenceInDays } from 'date-fns';
import { downloadCsv } from '../utils/csv';
import { STOCK_CATEGORIES } from '../utils/categories';

// Pure helpers (module scope so the memoized row and the sorted list can share them
// without re-creating them on every render).
const getValuationStatus = (stock: SavedStock) => {
  const currentPrice = stock.currentPrice;
  const fairValue = stock.fairValue;

  if (currentPrice <= fairValue * 0.8) return { status: 'strong-buy', color: 'bg-green-600', text: 'Strong Buy' };
  if (currentPrice <= fairValue) return { status: 'buy', color: 'bg-green-500', text: 'Buy' };
  if (currentPrice <= fairValue * 1.2) return { status: 'hold', color: 'bg-yellow-500', text: 'Hold' };
  return { status: 'overvalued', color: 'bg-red-600', text: 'Overvalued' };
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

interface StockWatchlistRowProps {
  stock: SavedStock;
  /** True when the latest price update failed for this ticker (last known price shown). */
  priceUpdateFailed: boolean;
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
  priceUpdateFailed,
  priceHistory,
  isHistoryExpanded,
  onToggleHistory,
  onToggleFavorite,
  onEdit,
  onDelete
}: StockWatchlistRowProps) {
  const valuation = getValuationStatus(stock);
  const isStale = isStockStale(stock);
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
                Uncategorized
              </span>
            )}
          </div>
          {isStale && (
            <AlertTriangle
              className="w-4 h-4 text-red-500"
              title={`Last updated ${format(new Date(stock.updatedAt), 'MMM dd, yyyy')} - over 90 days ago`}
            />
          )}
          {priceUpdateFailed && (
            <AlertTriangle
              className="w-4 h-4 text-amber-500"
              title="Price failed to update — showing last known price"
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
          {stock.dcf_inputs && stock.dcf_inputs.projectedPrices && (
            <>
              <div>1Y: {formatCurrency(stock.dcf_inputs.projectedPrices[0] || 0)}</div>
              <div>3Y: {formatCurrency(stock.dcf_inputs.projectedPrices[2] || 0)}</div>
              <div>5Y: {formatCurrency(stock.dcf_inputs.projectedPrices[4] || 0)}</div>
            </>
          )}
        </div>
      </td>
      <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
        <div className={`text-sm font-medium ${getPerformanceColor(stock.cagr, 'cagr')}`}>
          {formatPercentage(stock.cagr)}
        </div>
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
        <div className="text-sm font-medium text-blue-600">
          {formatCurrency(stock.buyTarget)}
        </div>
      </td>
      <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium text-white ${valuation.color}`}>
          {valuation.text}
        </span>
      </td>
      <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
        <div className={`text-sm ${isStale ? 'text-red-600 font-medium' : 'text-gray-900'}`}>
          {format(new Date(stock.updatedAt), 'MMM dd, yyyy')}
        </div>
        {isStale && (
          <div className="text-xs text-red-500">Needs update</div>
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
  const [filterBy, setFilterBy] = useState<
    'all' | 'favorites' | 'undervalued' | 'overvalued' | 'cagr10' | 'cagr15' | 'cagr20'
  >('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
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
  const [failedPriceTickers, setFailedPriceTickers] = useState<string[]>([]);

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

  const saveEdit = async () => {
    if (!editingStock || !editForm) return;

    try {
      // Recalculate DCF with new inputs
      const { results } = calculateDCF(editForm);
      const trimmedInvestorRelationsLink = editForm.investorRelationsLink?.trim() || '';
      
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
            ...editForm,
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

  const updateAllCurrentPrices = async () => {
    if (stocks.length === 0) return;
    
    setUpdatingPrices(true);
    const uniqueSymbols = [...new Set(stocks.map(stock => stock.ticker.toUpperCase()))];
    try {
      // Explicit refresh: bypass the 4-hour local cache so this always fetches live prices.
      const priceMap = await stockPriceService.getMultipleStockPrices(uniqueSymbols, { forceRefresh: true });
      // Any ticker with no price in the map failed to fetch — surface it instead
      // of silently leaving yesterday's price in place. Setting the list (even
      // to empty) also clears failures from the previous update.
      setFailedPriceTickers(uniqueSymbols.filter(symbol => !priceMap.has(symbol)));
      // Prepare batch updates for database
      const priceUpdates: { id: string; ticker: string; currentPrice: number; expectedReturn?: number; cagr?: number }[] = [];
      
      stocks.forEach(stock => {
        const normalizedTicker = stock.ticker.toUpperCase();
        const priceData = priceMap.get(normalizedTicker);
        if (priceData) {
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
        }
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
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      // Record one price-history row per successfully updated stock so the
      // Day Change column and recent closes have data going forward.
      // This must never block the price update itself: failures are logged
      // and the refresh continues to the reload below.
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
      
      // Reload watchlist to reflect changes
      await loadStocks();
      
    } catch (error) {
      console.error('Failed to update current prices:', error);
    } finally {
      setUpdatingPrices(false);
    }
  };

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
      
      // Valuation filter
      if (filterBy === 'favorites') return Boolean(stock.isFavorite);
      if (filterBy === 'undervalued') return stock.currentPrice < stock.fairValue;
      if (filterBy === 'overvalued') return stock.currentPrice > stock.fairValue;
      if (filterBy === 'cagr10') return stock.cagr >= 0.1;
      if (filterBy === 'cagr15') return stock.cagr >= 0.15;
      if (filterBy === 'cagr20') return stock.cagr >= 0.2;
      return true;
    })
    .sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case 'expectedReturn':
          comparison = b.expectedReturn - a.expectedReturn;
          break;
        case 'cagr':
          comparison = b.cagr - a.cagr;
          break;
        case 'buyTarget':
          comparison = a.buyTarget - b.buyTarget;
          break;
        case 'status':
          const statusOrder = { 'strong-buy': 0, 'buy': 1, 'hold': 2, 'overvalued': 3 };
          const aStatus = getValuationStatus(a).status;
          const bStatus = getValuationStatus(b).status;
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
    }), [stocks, searchTerm, filterBy, categoryFilter, sortBy, sortDirection]);

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
                  <input
                    type="text"
                    list="edit-stock-category-suggestions"
                    value={editForm.category || ''}
                    onChange={(e) => handleEditCategoryChange(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g., Big Tech"
                  />
                  <datalist id="edit-stock-category-suggestions">
                    {[...new Set([...STOCK_CATEGORIES, ...stocks.map(s => s.category).filter(Boolean)])]
                      .sort((a, b) => a.localeCompare(b))
                      .map(category => (
                        <option key={category} value={category} />
                      ))}
                  </datalist>
                  <p className="text-xs text-gray-500 mt-1">One primary category per stock — pick a suggestion or type your own.</p>
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
                disabled={updatingPrices || stocks.length === 0}
                className="flex items-center justify-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                title="Update all current prices"
              >
                <RefreshCw className={`w-4 h-4 ${updatingPrices ? 'animate-spin' : ''}`} />
                {updatingPrices ? 'Updating...' : 'Update Prices'}
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
                  priceUpdateFailed={failedPriceTickers.includes(stock.ticker.toUpperCase())}
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
