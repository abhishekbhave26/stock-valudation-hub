import React, { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, Trash2, BarChart3, Edit } from 'lucide-react';
import { SavedStock } from '../types';
import { supabase } from '../lib/supabase';
import { formatCurrency, formatPercentage, getPerformanceColor } from '../utils/dcf';
import { DCFInputs } from '../types';
import { calculateDCF } from '../utils/dcf';

export default function StockWatchlist() {
  const [stocks, setStocks] = useState<SavedStock[]>([]);
  const [loading, setLoading] = useState(false);
  const [sortBy, setSortBy] = useState<'ticker' | 'expectedReturn' | 'cagr' | 'buyTarget'>('ticker');
  const [filterBy, setFilterBy] = useState<'all' | 'undervalued' | 'overvalued'>('all');
  const [editingStock, setEditingStock] = useState<SavedStock | null>(null);
  const [editForm, setEditForm] = useState<DCFInputs | null>(null);

  useEffect(() => {
    loadStocks();
  }, []);

  const loadStocks = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('saved_stocks')
        .select('*')
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
      // Check if it's a connection error due to invalid Supabase config
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      
      if (!supabaseUrl || !supabaseKey || supabaseUrl.includes('placeholder') || supabaseKey.includes('placeholder')) {
        console.warn('Supabase not configured. Watchlist functionality will be limited.');
      }
      setStocks([]);
    } finally {
      setLoading(false);
    }
  };

  const deleteStock = async (id: string) => {
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
    setEditForm(stock.dcf_inputs);
  };

  const cancelEdit = () => {
    setEditingStock(null);
    setEditForm(null);
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
        default:
          return a.ticker.localeCompare(b.ticker);
      }
    });

  const getValuationStatus = (stock: SavedStock) => {
    const currentPrice = stock.currentPrice;
    const fairValue = stock.fairValue;
    
    if (currentPrice <= fairValue * 0.8) return { status: 'strong-buy', color: 'bg-green-600', text: 'Strong Buy' };
    if (currentPrice <= fairValue) return { status: 'buy', color: 'bg-green-500', text: 'Buy' };
    if (currentPrice <= fairValue * 1.2) return { status: 'hold', color: 'bg-yellow-500', text: 'Hold' };
    return { status: 'overvalued', color: 'bg-red-600', text: 'Overvalued' };
  };

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
      {editingStock && editForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-semibold mb-4">Edit {editingStock.ticker}</h3>
            
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Current Price ($)</label>
                  <input
                    type="number"
                    value={editForm.currentPrice}
                    onChange={(e) => setEditForm(prev => prev ? {...prev, currentPrice: parseFloat(e.target.value)} : null)}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                    step="0.01"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Desired Return (%)</label>
                  <input
                    type="number"
                    value={editForm.desiredReturn}
                    onChange={(e) => setEditForm(prev => prev ? {...prev, desiredReturn: parseFloat(e.target.value)} : null)}
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
                    onChange={(e) => setEditForm(prev => prev ? {...prev, valuationMultiple: parseFloat(e.target.value)} : null)}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                    step="0.1"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Base Metric Per Share</label>
                  <input
                    type="number"
                    value={editForm.baseMetricPerShare}
                    onChange={(e) => setEditForm(prev => prev ? {...prev, baseMetricPerShare: parseFloat(e.target.value)} : null)}
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
                        onChange={(e) => {
                          const newRates = [...editForm.growthRates];
                          newRates[index] = parseFloat(e.target.value);
                          setEditForm(prev => prev ? {...prev, growthRates: newRates} : null);
                        }}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-center text-sm focus:ring-2 focus:ring-blue-500"
                        step="0.1"
                      />
                    </div>
                  ))}
                </div>
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

      {/* Controls */}
      <div className="bg-white rounded-xl shadow-lg p-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-800 mb-1">Stock Watchlist</h2>
            <p className="text-sm text-gray-500">{stocks.length} stocks tracked</p>
          </div>
          
          <div className="flex items-center gap-4">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
            >
              <option value="ticker">Sort by Ticker</option>
              <option value="expectedReturn">Sort by Expected Return</option>
              <option value="cagr">Sort by CAGR</option>
              <option value="buyTarget">Sort by Buy Target</option>
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