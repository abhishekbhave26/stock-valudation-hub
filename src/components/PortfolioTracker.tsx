import React, { useState, useEffect } from 'react';
import { Plus, TrendingUp, TrendingDown, Wallet, Filter, CreditCard as Edit, Save, X, PieChart, Grid2x2 as Grid, List, RefreshCw, Camera, Download } from 'lucide-react';
import { PortfolioStock } from '../types';
import { supabase } from '../lib/supabase';
import { formatCurrency, formatPercentage } from '../utils/dcf';
import { format } from 'date-fns';
import { PieChart as RechartsPieChart, Cell, ResponsiveContainer, Tooltip, Pie } from 'recharts';
import { stockPriceService } from '../services/stockPriceService';
import {
  enqueueRateLimitedSymbols,
  refreshAllPrices,
  resolvePortfolioPrices
} from '../services/priceRefreshService';
import type { ResolvedHoldingPrice } from '../services/priceRefreshService';
import { useAuth } from '../hooks/useAuth';
import { downloadCsv } from '../utils/csv';

// CAGR annualizes the return since purchase, so it is only meaningful
// once a holding has been held long enough for annualizing to make
// sense. Below this, a few days of return annualizes into absurd
// figures (CLS showed 52,659,478% one day after purchase). Holdings
// younger than this show no CAGR. Note the stored purchase date sits
// one day later than the displayed date (UTC-midnight storage,
// Pacific rendering), so the measured holding period is a day short —
// negligible at 30 days.
const MIN_CAGR_HOLDING_DAYS = 30;
const MIN_CAGR_YEARS = MIN_CAGR_HOLDING_DAYS / 365.25;

type PortfolioTrackerProps = {
  isDarkMode?: boolean;
};

export default function PortfolioTracker({ isDarkMode = false }: PortfolioTrackerProps) {
  const { user } = useAuth();
  const [portfolioStocks, setPortfolioStocks] = useState<PortfolioStock[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [sortBy, setSortBy] = useState<'ticker' | 'totalReturn' | 'cagr' | 'totalValue' | 'purchaseDate'>('totalReturn');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [filterBy, setFilterBy] = useState<'all' | 'positive' | 'negative'>('all');
  const [viewMode, setViewMode] = useState<'tile' | 'list'>('list');
  const [editingStock, setEditingStock] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<any>(null);
  const [updatingPrices, setUpdatingPrices] = useState(false);
  const [fetchingNewStockPrice, setFetchingNewStockPrice] = useState(false);
  const [creatingSnapshot, setCreatingSnapshot] = useState(false);
  // One-line note when the last Update Prices run could not refresh every
  // holding (failed outright, or rate-limited and queued for the watchlist
  // drain). Cleared on the next refresh.
  const [priceRefreshNote, setPriceRefreshNote] = useState<string | null>(null);

  const PORTFOLIO_LIMIT = 150;

  const [newStock, setNewStock] = useState({
    ticker: '',
    quantity: 0,
    buyPrice: 0,
    purchaseDate: new Date().toISOString().split('T')[0],
    currentPrice: 0
  });

  const resetNewStock = () => {
    setNewStock({
      ticker: '',
      quantity: 0,
      buyPrice: 0,
      purchaseDate: new Date().toISOString().split('T')[0],
      currentPrice: 0
    });
  };

  useEffect(() => {
    loadPortfolio();
  }, [user]);


  const loadPortfolio = async () => {
    if (!user?.email) {
      setPortfolioStocks([]);
      return;
    }
    
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('portfolio_stocks')
        .select('*')
        .eq('user_email', user.email)
        .order('created_at', { ascending: false });

      if (error) throw error;

      if (data && data.length > 0) {
        // The displayed price is derived, not the stored column: watchlist
        // price first, then a Finnhub fetch for tickers not in the
        // watchlist, then the stored current_price, then the buy price.
        // Loading the portfolio tab therefore always shows the latest
        // watchlist prices — including after the daily 9 AM watchlist
        // refresh — with no portfolio-side refresh needed.
        let resolvedPrices: Map<string, ResolvedHoldingPrice> | null = null;
        try {
          resolvedPrices = await resolvePortfolioPrices(data, user.email);
        } catch (error) {
          console.error('Failed to resolve derived portfolio prices, using stored prices:', error);
        }

        const enrichedStocks: PortfolioStock[] = data.map(stock => {
          const currentPrice = resolvedPrices?.get(stock.ticker.toUpperCase())?.price
            ?? (stock.current_price || stock.buy_price);
          const totalValue = currentPrice * stock.quantity;
          const totalCost = stock.buy_price * stock.quantity;
          const totalReturn = totalCost > 0 ? (totalValue - totalCost) / totalCost : 0;
          
          // Calculate CAGR — only once the holding is at least 30 days
          // old. Annualizing a return earned over days produces
          // meaningless figures, so younger holdings get no CAGR.
          const purchaseDate = new Date(stock.purchase_date);
          const yearsDiff = (Date.now() - purchaseDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
          const cagr = yearsDiff >= MIN_CAGR_YEARS
            ? Math.pow(currentPrice / stock.buy_price, 1 / yearsDiff) - 1
            : undefined;

          return {
            ...stock,
            purchaseDate,
            currentPrice,
            totalValue,
            totalReturn,
            cagr
          };
        });

        setPortfolioStocks(enrichedStocks);
      } else {
        setPortfolioStocks([]);
      }
    } catch (error) {
      console.error('Error loading portfolio:', error);
      
      // Check if it's a configuration issue
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      
      if (!supabaseUrl || !supabaseKey || supabaseUrl.includes('placeholder') || supabaseKey.includes('placeholder')) {
        console.warn('Supabase not configured. Portfolio functionality will be limited.');
      }
      
      setPortfolioStocks([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchCurrentPriceForNewStock = async () => {
    if (!newStock.ticker) return;
    
    setFetchingNewStockPrice(true);
    try {
      const priceData = await stockPriceService.getStockPrice(newStock.ticker);
      if (priceData) {
        setNewStock(prev => ({
          ...prev,
          currentPrice: priceData.price
        }));
      } else {
        console.error('No price data received for', newStock.ticker);
      }
    } catch (error) {
      console.error('Failed to fetch current price:', error);
    } finally {
      setFetchingNewStockPrice(false);
    }
  };

  const addStock = async () => {
    if (!user?.email) {
      alert('Please sign in to add stocks to your portfolio.');
      return;
    }

    if (!newStock.ticker || newStock.quantity <= 0 || newStock.buyPrice <= 0) return;
    const resolvedCurrentPrice = newStock.currentPrice > 0 ? newStock.currentPrice : newStock.buyPrice;

    // Check portfolio limit before adding
    if (portfolioStocks.length >= PORTFOLIO_LIMIT) {
      alert(`You've reached the maximum limit of ${PORTFOLIO_LIMIT} stocks in your portfolio. Please remove some stocks before adding new ones.`);
      return;
    }

    try {
      const { error } = await supabase
        .from('portfolio_stocks')
        .insert([{
          ticker: newStock.ticker.toUpperCase(),
          quantity: newStock.quantity,
          buy_price: newStock.buyPrice,
          purchase_date: newStock.purchaseDate,
          current_price: resolvedCurrentPrice,
          user_email: user.email
        }]);

      if (error) throw error;

      resetNewStock();
      setShowAddForm(false);
      loadPortfolio();
    } catch (error) {
      console.error('Error adding stock:', error);
    }
  };

  const removeStock = async (id: string) => {
    const stock = portfolioStocks.find(s => s.id === id);
    if (!stock) return;
    
    const confirmed = window.confirm(`Are you sure you want to delete ${stock.ticker} stock from portfolio?`);
    if (!confirmed) return;
    
    try {
      const { error } = await supabase
        .from('portfolio_stocks')
        .delete()
        .eq('id', id);

      if (error) throw error;
      loadPortfolio();
    } catch (error) {
      console.error('Error removing stock:', error);
    }
  };

  const startEdit = (stock: PortfolioStock) => {
    setEditingStock(stock.id!);
    setEditForm({
      ticker: stock.ticker,
      quantity: stock.quantity,
      buyPrice: stock.buy_price,
      purchaseDate: format(stock.purchaseDate, 'yyyy-MM-dd'),
      currentPrice: stock.currentPrice || stock.buyPrice
    });
  };

  const cancelEdit = () => {
    setEditingStock(null);
    setEditForm(null);
  };

  const saveEdit = async () => {
    if (!editingStock || !editForm) return;

    try {
      const { error } = await supabase
        .from('portfolio_stocks')
        .update({
          ticker: editForm.ticker.toUpperCase(),
          quantity: editForm.quantity,
          buy_price: editForm.buyPrice,
          purchase_date: editForm.purchaseDate,
          current_price: editForm.currentPrice
        })
        .eq('id', editingStock);

      if (error) throw error;
      
      cancelEdit();
      loadPortfolio();
    } catch (error) {
      console.error('Error updating stock:', error);
    }
  };

  // One shared refresh with the watchlist: refreshAllPrices fetches
  // live prices for the watchlist + any portfolio-only tickers, persists
  // the watchlist rows (+ price history) and mirrors fresh prices into
  // the stored portfolio fallback. The displayed prices are then
  // re-derived by loadPortfolio (watchlist first), so both tabs agree.
  const updateAllCurrentPrices = async () => {
    if (portfolioStocks.length === 0 || !user?.email) return;

    setUpdatingPrices(true);
    setPriceRefreshNote(null);
    try {
      const result = await refreshAllPrices(user.email);
      if (result.rateLimited.length > 0) {
        // Queued for the watchlist's background drain, which picks them
        // up when that tab is next opened.
        enqueueRateLimitedSymbols(result.rateLimited);
      }
      // Surface refresh problems for this portfolio's own holdings only
      // (the watchlist banner covers the rest when that tab is open).
      const holdingTickers = new Set(portfolioStocks.map(stock => stock.ticker.toUpperCase()));
      const failedHoldings = result.failed.filter(ticker => holdingTickers.has(ticker));
      const pendingHoldings = result.rateLimited.filter(ticker => holdingTickers.has(ticker));
      const notes: string[] = [];
      if (failedHoldings.length > 0) notes.push(`couldn't refresh ${failedHoldings.join(', ')}`);
      if (pendingHoldings.length > 0) notes.push(`${pendingHoldings.join(', ')} still updating — they finish when you open the Stock Watchlist tab`);
      setPriceRefreshNote(notes.length > 0 ? `Update prices: ${notes.join('; ')}.` : null);

      // Reload to re-derive displayed prices from the fresh watchlist
      // prices (and the warm Finnhub cache for portfolio-only tickers).
      await loadPortfolio();
    } catch (error) {
      console.error('Failed to update current prices:', error);
    } finally {
      setUpdatingPrices(false);
    }
  };

  const createPortfolioSnapshot = async () => {
    if (!user?.email || portfolioStocks.length === 0) return;

    setCreatingSnapshot(true);
    try {
      const snapshotAt = new Date().toISOString();
      const snapshotTotalValue = portfolioStocks.reduce((sum, stock) => {
        const resolvedPrice = stock.currentPrice ?? stock.buy_price;
        return sum + (resolvedPrice * stock.quantity);
      }, 0);
      const snapshotTotalCost = portfolioStocks.reduce((sum, stock) => sum + (stock.buy_price * stock.quantity), 0);
      const snapshotTotalReturn = snapshotTotalCost > 0
        ? (snapshotTotalValue - snapshotTotalCost) / snapshotTotalCost
        : 0;

      const { data: snapshotRows, error: snapshotError } = await supabase
        .from('portfolio_snapshots')
        .insert([{
          user_email: user.email,
          snapshot_at: snapshotAt,
          total_value: snapshotTotalValue,
          total_cost: snapshotTotalCost,
          total_return: snapshotTotalReturn
        }])
        .select('id')
        .limit(1);

      if (snapshotError) throw snapshotError;

      const snapshotId = snapshotRows?.[0]?.id;
      if (!snapshotId) {
        throw new Error('Snapshot insert did not return an id.');
      }

      const holdingRows = portfolioStocks.map(stock => {
        const resolvedPrice = stock.currentPrice ?? stock.buy_price;
        const totalValue = resolvedPrice * stock.quantity;
        const totalCost = stock.buy_price * stock.quantity;
        const totalReturn = totalCost > 0 ? (totalValue - totalCost) / totalCost : 0;
        const weightPercent = snapshotTotalValue > 0 ? (totalValue / snapshotTotalValue) * 100 : 0;

        return {
          snapshot_id: snapshotId,
          ticker: stock.ticker,
          quantity: stock.quantity,
          buy_price: stock.buy_price,
          current_price: resolvedPrice,
          total_value: totalValue,
          total_cost: totalCost,
          total_return: totalReturn,
          weight_percent: weightPercent
        };
      });

      if (holdingRows.length > 0) {
        const { error: holdingsError } = await supabase
          .from('portfolio_snapshot_holdings')
          .insert(holdingRows);

        if (holdingsError) {
          throw holdingsError;
        }
      }
    } catch (error) {
      console.error('Failed to create portfolio snapshot:', error);
    } finally {
      setCreatingSnapshot(false);
    }
  };

  const exportPortfolioCsv = () => {
    if (portfolioStocks.length === 0) return;

    const rows = portfolioStocks.map(stock => {
      const resolvedCurrentPrice = stock.currentPrice ?? stock.current_price ?? stock.buy_price ?? stock.buyPrice;
      const resolvedBuyPrice = stock.buy_price ?? stock.buyPrice;
      const totalValue = stock.totalValue ?? resolvedCurrentPrice * stock.quantity;
      const portfolioPercent = totalPortfolioValue > 0 ? (totalValue / totalPortfolioValue) * 100 : 0;
      const positionTotalReturn = resolvedBuyPrice > 0
        ? (totalValue - resolvedBuyPrice * stock.quantity) / (resolvedBuyPrice * stock.quantity)
        : 0;
      const cagr = stock.cagr;

      return {
        Ticker: stock.ticker,
        Quantity: stock.quantity,
        'Buy Price': resolvedBuyPrice,
        'Current Price': resolvedCurrentPrice,
        'Total Value': totalValue,
        'Portfolio %': portfolioPercent,
        'Total Return (%)': positionTotalReturn * 100,
        'CAGR (%)': cagr == null ? '' : cagr * 100,
        'Purchase Date': format(stock.purchaseDate, 'yyyy-MM-dd'),
        'Portfolio Total Return (%)': totalReturn * 100,
        'Portfolio CAGR (%)': portfolioCAGR == null ? '' : portfolioCAGR * 100
      };
    });

    downloadCsv('portfolio-tracker.csv', rows);
  };

  const filteredAndSortedStocks = portfolioStocks
    .filter(stock => {
      if (filterBy === 'positive') return (stock.totalReturn || 0) > 0;
      if (filterBy === 'negative') return (stock.totalReturn || 0) < 0;
      return true;
    })
    .sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case 'totalReturn':
          comparison = (b.totalReturn || 0) - (a.totalReturn || 0);
          break;
        case 'cagr':
          comparison = (b.cagr || 0) - (a.cagr || 0);
          break;
        case 'totalValue':
          comparison = (b.totalValue || 0) - (a.totalValue || 0);
          break;
        case 'purchaseDate':
          comparison = b.purchaseDate.getTime() - a.purchaseDate.getTime();
          break;
        default:
          comparison = a.ticker.localeCompare(b.ticker);
      }
      
      return sortDirection === 'desc' ? comparison : -comparison;
    });

  const totalPortfolioValue = portfolioStocks.reduce((sum, stock) => sum + (stock.totalValue || 0), 0);
  const totalCost = portfolioStocks.reduce((sum, stock) => sum + (stock.buy_price * stock.quantity), 0);
  const totalReturn = totalCost > 0 ? (totalPortfolioValue - totalCost) / totalCost : 0;

  // Calculate portfolio-wide CAGR — gated the same way: the
  // cost-weighted average holding period must be at least 30 days,
  // otherwise annualizing the portfolio return is meaningless.
  const portfolioCAGR: number | undefined = (() => {
    if (portfolioStocks.length === 0 || totalCost === 0) return undefined;
    
    // Calculate weighted average holding period
    let totalWeightedYears = 0;
    let totalWeight = 0;
    
    portfolioStocks.forEach(stock => {
      const stockCost = stock.buy_price * stock.quantity;
      const yearsDiff = (Date.now() - stock.purchaseDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      
      if (yearsDiff > 0) {
        totalWeightedYears += yearsDiff * stockCost;
        totalWeight += stockCost;
      }
    });
    
    const avgYears = totalWeight > 0 ? totalWeightedYears / totalWeight : 0;

    if (avgYears < MIN_CAGR_YEARS) return undefined;

    // Calculate CAGR: (Ending Value / Beginning Value)^(1/years) - 1
    return Math.pow(totalPortfolioValue / totalCost, 1 / avgYears) - 1;
  })();

  // Define colors array before using it
  const COLORS = isDarkMode
    ? ['#60A5FA', '#34D399', '#FBBF24', '#F97316', '#C4B5FD', '#67E8F9', '#A3E635', '#FCA5A5', '#7DD3FC', '#F9A8D4']
    : ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82CA9D', '#FFC658', '#FF7C7C', '#8DD1E1', '#D084D0'];
  // Prepare data for visualizations
  const pieChartData = portfolioStocks.map((stock, index) => ({
    name: stock.ticker,
    value: stock.totalValue || 0,
    color: COLORS[index % COLORS.length]
  }));

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-lg p-4 sm:p-6">
        <div>
          <h2 className="text-xl font-semibold text-gray-800">Portfolio Tracker</h2>
          <p className="text-sm text-gray-500">Manage holdings and keep your portfolio updated.</p>
        </div>
      </div>

      <>
          {/* Portfolio Summary */}
          <div className="bg-white rounded-xl shadow-lg p-6">
            <div className="flex items-center gap-3 mb-4">
              <Wallet className="w-6 h-6 text-blue-600" />
              <h2 className="text-xl font-semibold text-gray-800">Portfolio Summary</h2>
            </div>
        
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="text-center p-4 bg-gray-50 rounded-lg">
                <div className="text-2xl font-bold text-gray-800">
                  {portfolioStocks.length}
                </div>
                <p className="text-sm text-gray-600">Total Stocks ({portfolioStocks.length}/{PORTFOLIO_LIMIT})</p>
              </div>
              <div className="text-center p-4 bg-blue-50 rounded-lg">
                <div className="text-2xl font-bold text-blue-600">
                  {formatCurrency(totalPortfolioValue)}
                </div>
                <p className="text-sm text-gray-600">Total Value</p>
              </div>
              <div className="text-center p-4 bg-gray-50 rounded-lg">
                <div className="text-2xl font-bold text-gray-800">
                  {formatCurrency(totalCost)}
                </div>
                <p className="text-sm text-gray-600">Total Cost</p>
              </div>
              <div className="text-center p-4 bg-green-50 rounded-lg">
                <div className={`text-2xl font-bold ${totalReturn >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {formatPercentage(totalReturn)}
                </div>
                <p className="text-sm text-gray-600">Total Return</p>
              </div>
            </div>
        
            <div className="mt-4">
              <div className="text-center p-4 bg-purple-50 rounded-lg">
                <div
                  className={`text-2xl font-bold ${portfolioCAGR == null ? 'text-gray-500' : portfolioCAGR >= 0 ? 'text-purple-600' : 'text-red-600'}`}
                  title={portfolioCAGR == null ? 'CAGR shows once holdings average at least 30 days' : undefined}
                >
                  {portfolioCAGR == null ? '—' : formatPercentage(portfolioCAGR)}
                </div>
                <p className="text-sm text-gray-600">Portfolio CAGR</p>
                <p className="text-xs text-gray-500 mt-1">Weighted by investment amount</p>
              </div>
            </div>
          </div>

          {/* Visualizations */}
          {portfolioStocks.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Portfolio Allocation Pie Chart */}
              <div className="bg-white rounded-xl shadow-lg p-6">
                <div className="flex items-center gap-3 mb-4">
                  <PieChart className="w-5 h-5 text-blue-600" />
                  <h3 className="text-lg font-semibold text-gray-800">Portfolio Allocation</h3>
                </div>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <RechartsPieChart>
                      <Pie
                        data={pieChartData}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }) => percent > 0.02 ? `${name} ${(percent * 100).toFixed(1)}%` : ''}
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {pieChartData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip 
                        formatter={(value, name) => [formatCurrency(value as number), name]}
                        labelFormatter={() => ''}
                      />
                    </RechartsPieChart>
                  </ResponsiveContainer>
                </div>
              </div>

            </div>
          )}

          {/* Portfolio Stocks */}
          {loading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
              <p className="text-gray-500 mt-2">Loading portfolio...</p>
            </div>
          ) : filteredAndSortedStocks.length === 0 ? (
            <div className="text-center py-8 bg-white rounded-xl shadow-lg">
              <Wallet className="w-12 h-12 text-gray-400 mx-auto mb-3" />
              <p className="text-gray-500">No stocks in your portfolio yet.</p>
              <button
                onClick={() => setShowAddForm(true)}
                className="mt-3 text-blue-600 hover:text-blue-700"
              >
                Add your first stock
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Controls */}
              <div className="bg-white rounded-xl shadow-lg p-6">
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <h2 className="text-xl font-semibold text-gray-800">Portfolio Holdings</h2>
                    
                    {/* Action Buttons */}
                    <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                      <button
                        onClick={() => setShowAddForm(true)}
                        disabled={portfolioStocks.length >= PORTFOLIO_LIMIT}
                        className="flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        <Plus className="w-4 h-4" />
                        Add Stock
                      </button>
                      
                      <button
                        onClick={updateAllCurrentPrices}
                        disabled={updatingPrices || portfolioStocks.length === 0}
                        className="flex items-center justify-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        <RefreshCw className={`w-4 h-4 ${updatingPrices ? 'animate-spin' : ''}`} />
                        {updatingPrices ? 'Updating...' : 'Update Prices'}
                      </button>

                      <button
                        onClick={exportPortfolioCsv}
                        disabled={portfolioStocks.length === 0}
                        className="flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        <Download className="w-4 h-4" />
                        Export CSV
                      </button>

                      <button
                        onClick={createPortfolioSnapshot}
                        disabled={creatingSnapshot || portfolioStocks.length === 0}
                        className="flex items-center justify-center gap-2 bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        <Camera className={`w-4 h-4 ${creatingSnapshot ? 'animate-pulse' : ''}`} />
                        {creatingSnapshot ? 'Saving...' : 'Create Snapshot'}
                      </button>
                    </div>
                  </div>

                  {priceRefreshNote && (
                    <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      {priceRefreshNote}
                    </p>
                  )}

                  {/* Sort, Filter and View Controls */}
                  <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
                    <div className="grid grid-cols-2 sm:flex gap-2 sm:gap-3">
                      <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                        className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 min-w-0"
                      >
                        <option value="ticker">Sort: Ticker</option>
                        <option value="totalReturn">Sort: Return</option>
                        <option value="cagr">Sort: CAGR</option>
                        <option value="totalValue">Sort: Value</option>
                        <option value="purchaseDate">Sort: Date</option>
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
                    
                    <div className="grid grid-cols-2 sm:flex gap-2 sm:gap-3">
                      <select
                        value={filterBy}
                        onChange={(e) => setFilterBy(e.target.value as typeof filterBy)}
                        className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 min-w-0"
                      >
                        <option value="all">All Stocks</option>
                        <option value="positive">Positive</option>
                        <option value="negative">Negative</option>
                      </select>
                      
                      <div className="flex bg-gray-100 rounded-lg p-1">
                        <button
                          onClick={() => setViewMode('list')}
                          className={`flex items-center gap-1 px-3 py-1 rounded text-sm transition-colors ${
                            viewMode === 'list' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600'
                          }`}
                        >
                          <List className="w-4 h-4" />
                          <span className="hidden sm:inline">List</span>
                        </button>
                        <button
                          onClick={() => setViewMode('tile')}
                          className={`flex items-center gap-1 px-3 py-1 rounded text-sm transition-colors ${
                            viewMode === 'tile' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600'
                          }`}
                        >
                          <Grid className="w-4 h-4" />
                          <span className="hidden sm:inline">Tile</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

          {viewMode === 'tile' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredAndSortedStocks.map((stock) => (
                <div key={stock.id} className="bg-white rounded-xl shadow-lg p-6 hover:shadow-xl transition-shadow relative">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="text-lg font-bold text-gray-800">{stock.ticker}</h3>
                      <p className="text-sm text-gray-500">
                        {stock.quantity} shares • {format(stock.purchaseDate, 'MMM dd, yyyy')}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => startEdit(stock)}
                        className="text-blue-500 hover:text-blue-700 text-sm"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => removeStock(stock.id!)}
                        className="text-gray-400 hover:text-red-500 text-sm"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {editingStock === stock.id ? (
                    <div className="space-y-3 border-t pt-4">
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={editForm.ticker}
                          onChange={(e) => setEditForm(prev => ({ ...prev, ticker: e.target.value.toUpperCase() }))}
                          className="px-2 py-1 border border-gray-300 rounded text-sm"
                          placeholder="Ticker"
                        />
                        <input
                          type="number"
                          value={editForm.quantity}
                          onChange={(e) => setEditForm(prev => ({ ...prev, quantity: Number(e.target.value) }))}
                          className="px-2 py-1 border border-gray-300 rounded text-sm"
                          placeholder="Quantity"
                        />
                        <input
                          type="number"
                          value={editForm.buyPrice}
                          onChange={(e) => setEditForm(prev => ({ ...prev, buyPrice: Number(e.target.value) }))}
                          className="px-2 py-1 border border-gray-300 rounded text-sm"
                          placeholder="Buy Price"
                          step="0.01"
                        />
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Current Price</label>
                          <div className="w-full px-3 py-2 border border-gray-200 rounded bg-gray-50 text-gray-700">
                            {formatCurrency(editForm.currentPrice)}
                          </div>
                          <p className="text-xs text-gray-500 mt-1">Current price is updated automatically</p>
                        </div>
                      </div>
                      <input
                        type="date"
                        value={editForm.purchaseDate}
                        onChange={(e) => setEditForm(prev => ({ ...prev, purchaseDate: e.target.value }))}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={saveEdit}
                          className="flex items-center gap-1 bg-green-600 text-white px-3 py-1 rounded text-sm hover:bg-green-700"
                        >
                          <Save className="w-3 h-3" />
                          Save
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="flex items-center gap-1 bg-gray-500 text-white px-3 py-1 rounded text-sm hover:bg-gray-600"
                        >
                          <X className="w-3 h-3" />
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-600">Current Price:</span>
                        <span className="font-medium">{formatCurrency(stock.currentPrice || 0)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-600">Buy Price:</span>
                        <span className="font-medium">{formatCurrency(stock.buy_price)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-600">Total Value:</span>
                        <span className="font-medium">{formatCurrency(stock.totalValue || 0)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-600">Portfolio %:</span>
                        <span className="font-medium text-blue-600">
                          {totalPortfolioValue > 0 ? ((stock.totalValue || 0) / totalPortfolioValue * 100).toFixed(1) : '0.0'}%
                        </span>
                      </div>
                      
                      <div className="pt-3 border-t border-gray-200">
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-gray-600">Total Return:</span>
                          <div className="flex items-center gap-1">
                            {(stock.totalReturn || 0) >= 0 ? (
                              <TrendingUp className="w-4 h-4 text-green-500" />
                            ) : (
                              <TrendingDown className="w-4 h-4 text-red-500" />
                            )}
                            <span className={`font-bold ${(stock.totalReturn || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {formatPercentage(stock.totalReturn || 0)}
                            </span>
                          </div>
                        </div>
                        <div className="flex justify-between items-center mt-1">
                          <span className="text-sm text-gray-600">CAGR:</span>
                          <span
                            className={`font-bold ${stock.cagr == null ? 'text-gray-500' : stock.cagr >= 0 ? 'text-green-600' : 'text-red-600'}`}
                            title={stock.cagr == null ? 'CAGR shows once a holding is at least 30 days old' : undefined}
                          >
                            {stock.cagr == null ? '—' : formatPercentage(stock.cagr)}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Stock</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Quantity</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Buy Price</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Current Price</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total Value</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Portfolio %</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Total Return</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">CAGR</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Purchase Date</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {filteredAndSortedStocks.map((stock) => (
                      <tr key={stock.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="font-medium text-gray-900">{stock.ticker}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{stock.quantity}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{formatCurrency(stock.buy_price)}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{formatCurrency(stock.currentPrice || 0)}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">{formatCurrency(stock.totalValue || 0)}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-blue-600">
                            {totalPortfolioValue > 0 ? ((stock.totalValue || 0) / totalPortfolioValue * 100).toFixed(1) : '0.0'}%
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-1">
                            {(stock.totalReturn || 0) >= 0 ? (
                              <TrendingUp className="w-4 h-4 text-green-500" />
                            ) : (
                              <TrendingDown className="w-4 h-4 text-red-500" />
                            )}
                            <span className={`text-sm font-medium ${(stock.totalReturn || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {formatPercentage(stock.totalReturn || 0)}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span
                            className={`text-sm font-medium ${stock.cagr == null ? 'text-gray-500' : stock.cagr >= 0 ? 'text-green-600' : 'text-red-600'}`}
                            title={stock.cagr == null ? 'CAGR shows once a holding is at least 30 days old' : undefined}
                          >
                            {stock.cagr == null ? '—' : formatPercentage(stock.cagr)}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">{format(stock.purchaseDate, 'MMM dd, yyyy')}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => startEdit(stock)}
                              className="text-blue-600 hover:text-blue-900"
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => removeStock(stock.id!)}
                              className="text-red-600 hover:text-red-900"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Add Stock Modal */}
      {showAddForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-semibold mb-4">Add Stock</h3>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Ticker</label>
                  <input
                    type="text"
                    value={newStock.ticker}
                    onChange={(e) => setNewStock(prev => ({ ...prev, ticker: e.target.value.toUpperCase() }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                    placeholder="AAPL"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Quantity</label>
                  <input
                    type="number"
                    value={newStock.quantity || ''}
                    onChange={(e) => setNewStock(prev => ({ ...prev, quantity: Number(e.target.value) }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                    min="0"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Buy Price</label>
                  <input
                    type="number"
                    value={newStock.buyPrice || ''}
                    onChange={(e) => setNewStock(prev => ({ ...prev, buyPrice: Number(e.target.value) }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                    step="0.01"
                    min="0"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Current Price</label>
                  <input
                    type="number"
                    value={newStock.currentPrice || ''}
                    onChange={(e) => setNewStock(prev => ({ ...prev, currentPrice: Number(e.target.value) }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                    step="0.01"
                    min="0"
                  />
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={fetchCurrentPriceForNewStock}
                  disabled={fetchingNewStockPrice || !newStock.ticker}
                  className="flex items-center gap-2 bg-gray-100 text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <RefreshCw className={`w-4 h-4 ${fetchingNewStockPrice ? 'animate-spin' : ''}`} />
                  {fetchingNewStockPrice ? 'Fetching...' : 'Fetch Current Price'}
                </button>
                <span className="text-xs text-gray-500">If empty, current price defaults to buy price.</span>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Purchase Date</label>
                <input
                  type="date"
                  value={newStock.purchaseDate}
                  onChange={(e) => setNewStock(prev => ({ ...prev, purchaseDate: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={addStock}
                className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
              >
                Add Stock
              </button>
              <button
                onClick={() => {
                  setShowAddForm(false);
                  resetNewStock();
                }}
                className="bg-gray-500 text-white px-4 py-2 rounded hover:bg-gray-600"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal for List View */}
      {editingStock && editForm && viewMode === 'list' && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-semibold mb-4">Edit {editForm.ticker}</h3>
            
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Ticker</label>
                  <input
                    type="text"
                    value={editForm.ticker}
                    onChange={(e) => setEditForm(prev => ({ ...prev, ticker: e.target.value.toUpperCase() }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Quantity</label>
                  <input
                    type="number"
                    value={editForm.quantity}
                    onChange={(e) => setEditForm(prev => ({ ...prev, quantity: Number(e.target.value) }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Buy Price</label>
                  <input
                    type="number"
                    value={editForm.buyPrice}
                    onChange={(e) => setEditForm(prev => ({ ...prev, buyPrice: Number(e.target.value) }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                    step="0.01"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Current Price</label>
                  <div className="w-full px-3 py-2 border border-gray-200 rounded bg-gray-50 text-gray-700">
                    {formatCurrency(editForm.currentPrice)}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">Current price is updated automatically</p>
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Purchase Date</label>
                <input
                  type="date"
                  value={editForm.purchaseDate}
                  onChange={(e) => setEditForm(prev => ({ ...prev, purchaseDate: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            
            <div className="flex gap-3 mt-6">
              <button
                onClick={saveEdit}
                className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
              >
                Save Changes
              </button>
              <button
                onClick={cancelEdit}
                className="bg-gray-500 text-white px-4 py-2 rounded hover:bg-gray-600"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      </>
    </div>
  );
}
