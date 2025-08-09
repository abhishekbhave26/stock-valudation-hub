import React, { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, Trash2, BarChart3, Edit, RefreshCw } from 'lucide-react';
import { SavedStock } from '../types';
import { supabase } from '../lib/supabase';
import { formatCurrency, formatPercentage, getPerformanceColor, calculateDCF } from '../utils/dcf';
import { DCFInputs } from '../types';
import { stockPriceService } from '../services/stockPriceService';
import { useAuth } from '../hooks/useAuth';

export default function StockWatchlist() {
  const { user } = useAuth();
  const [stocks, setStocks] = useState<SavedStock[]>([]);
  const [loading, setLoading] = useState(false);
  const [sortBy, setSortBy] = useState<'ticker' | 'expectedReturn' | 'cagr' | 'buyTarget' | 'status'>('status');
  const [filterBy, setFilterBy] = useState<'all' | 'undervalued' | 'overvalued'>('all');
  const [editingStock, setEditingStock] = useState<SavedStock | null>(null);
  const [editForm, setEditForm] = useState<DCFInputs | null>(null);
  const [editResults, setEditResults] = useState<any>(null);
  const [editWarnings, setEditWarnings] = useState<any[]>([]);
  const [updatingPrices, setUpdatingPrices] = useState(false);

  const WATCHLIST_LIMIT = 200;

  useEffect(() => {
    loadStocks();
  }, [user]);

  const loadStocks = async () => {
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
          return {
            ...stock,
            currentPrice: stock.current_price,
            fairValue: stock.fair_value,
            expectedReturn: stock.expected_return,
            cagr: stock.cagr,
            buyTarget: stock.buy_target
          };
        });
        setStocks(enrichedStocks);
      } else {
        setStocks([]);
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
  };

  const deleteStock = async (id: string) => {
    const stock = stocks.find(s => s.id === id);
    if (!stock) return;
    
    const confirmed = window.confirm(`Are you sure you want to delete ${stock.ticker} from your watchlist?`);
    if (!confirmed) return;
    
    try {
      const { error } = await supabase
        .from('saved_stocks')
        .delete()
        .eq('id', id);

      if (error) throw error;
      loadStocks();
    } catch (error) {
      console.error('Error deleting stock:', error);
    }
  };

  const startEdit = (stock: SavedStock) => {
    setEditingStock(stock);
    const formData = {
      ...stock.dcf_inputs,
      currentPrice: stock.currentPrice
    };
    setEditForm(formData);
    
    // Calculate initial results
    const { results, warnings } = calculateDCF(formData);
    setEditResults(results);
    setEditWarnings(warnings);
  };

  const cancelEdit = () => {
    setEditingStock(null);
    setEditForm(null);
    setEditResults(null);
    setEditWarnings([]);
  };

  const saveEdit = async () => {
    if (!editingStock || !editForm) return;

    try {
      // Recalculate DCF with new inputs
      const { results } = calculateDCF(editForm);
      
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
            projectedPrices: results.projectedPrices
          },
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
    console.log('Starting price update for', stocks.length, 'stocks');
    
    try {
      const symbols = [...new Set(stocks.map(stock => stock.ticker))];
      console.log('Unique symbols to update:', symbols);
      const priceUpdates: { id: string; currentPrice: number }[] = [];
      
      // Fetch prices for all unique symbols
      for (const symbol of symbols) {
        try {
          console.log('Fetching price for', symbol);
          const priceData = await stockPriceService.getStockPrice(symbol);
          if (priceData) {
            console.log('Got price for', symbol, ':', priceData.price);
            // Find all stocks with this symbol and prepare updates
            stocks
              .filter(stock => stock.ticker === symbol)
              .forEach(stock => {
                priceUpdates.push({
                  id: stock.id!,
                  currentPrice: priceData.price
                });
              });
          } else {
            console.error('No price data received for', symbol);
          }
        } catch (error) {
          console.error(`Failed to fetch price for ${symbol}:`, error);
        }
      }
      
      console.log('Price updates to apply:', priceUpdates);
      
      // Update database with new prices
      for (const update of priceUpdates) {
        try {
          const { error } = await supabase
            .from('saved_stocks')
            .update({ current_price: update.currentPrice })
            .eq('id', update.id);
          
          if (error) {
            console.error('Database update error:', error);
            throw error;
          }
        } catch (error) {
          console.error(`Failed to update price for stock ${update.id}:`, error);
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

  const getValuationStatus = (stock: SavedStock) => {
    const currentPrice = stock.currentPrice;
    const fairValue = stock.fairValue;
    
    if (currentPrice <= fairValue * 0.8) return { status: 'strong-buy', color: 'bg-green-600', text: 'Strong Buy' };
    if (currentPrice <= fairValue) return { status: 'buy', color: 'bg-green-500', text: 'Buy' };
    if (currentPrice <= fairValue * 1.2) return { status: 'hold', color: 'bg-yellow-500', text: 'Hold' };
    return { status: 'overvalued', color: 'bg-red-600', text: 'Overvalued' };
  };

  const filteredAndSortedStocks = stocks
    .filter(stock => {
      if (filterBy === 'undervalued') return stock.currentPrice < stock.fairValue;
      if (filterBy === 'overvalued') return stock.currentPrice > stock.fairValue;
      return true;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'expectedReturn':
          return b.expectedReturn - a.expectedReturn;
        case 'cagr':
          return b.cagr - a.cagr;
        case 'buyTarget':
          return a.buyTarget - b.buyTarget;
        case 'status':
          const statusOrder = { 'strong-buy': 0, 'buy': 1, 'hold': 2, 'overvalued': 3 };
          const aStatus = getValuationStatus(a).status;
          const bStatus = getValuationStatus(b).status;
          return statusOrder[aStatus] - statusOrder[bStatus];
        default:
          return a.ticker.localeCompare(b.ticker);
      }
    });

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
                    <div className="w-full px-3 py-2 border border-gray-200 rounded bg-gray-50 text-gray-700">
                      {formatCurrency(editForm.currentPrice)}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">Current price is updated automatically</p>
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
                          <th className="px-2 py-1 text-left">Price</th>
                          <th className="px-2 py-1 text-left">Growth</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {editResults.projectedPrices.map((price, index) => {
                          const currentYear = new Date().getFullYear();
                          return (
                            <tr key={index}>
                              <td className="px-2 py-1">{currentYear + index + 1}</td>
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
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-800 mb-1">Stock Watchlist</h2>
            <p className="text-sm text-gray-500">{stocks.length}/{WATCHLIST_LIMIT} stocks tracked</p>
          </div>
          
          <div className="flex items-center gap-4">
            <button
              onClick={updateAllCurrentPrices}
              disabled={updatingPrices || stocks.length === 0}
              className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title="Update all current prices"
            >
              <RefreshCw className={`w-4 h-4 ${updatingPrices ? 'animate-spin' : ''}`} />
              {updatingPrices ? 'Updating...' : 'Update Prices'}
            </button>
            
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
            >
              <option value="ticker">Sort by Ticker</option>
              <option value="expectedReturn">Sort by Expected Return</option>
              <option value="cagr">Sort by CAGR</option>
              <option value="buyTarget">Sort by Buy Target</option>
              <option value="status">Sort by Status</option>
            </select>
            
            <select
              value={filterBy}
              onChange={(e) => setFilterBy(e.target.value as typeof filterBy)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Stocks</option>
              <option value="undervalued">Undervalued</option>
              <option value="overvalued">Overvalued</option>
            </select>
          </div>
        </div>
      </div>

      {/* Stock Table */}
      <div className="bg-white rounded-xl shadow-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Stock</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Current Price</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Target Prices</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">CAGR</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Fair Value</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredAndSortedStocks.map((stock) => {
                const valuation = getValuationStatus(stock);
                return (
                  <tr key={stock.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="font-medium text-gray-900">{stock.ticker}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        {formatCurrency(stock.currentPrice)}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
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
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className={`text-sm font-medium ${getPerformanceColor(stock.cagr, 'cagr')}`}>
                        {formatPercentage(stock.cagr)}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-green-600">
                        {formatCurrency(stock.fairValue)}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium text-white ${valuation.color}`}>
                        {valuation.text}
                      </span>
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
                          onClick={() => deleteStock(stock.id!)}
                          className="text-red-600 hover:text-red-900"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}