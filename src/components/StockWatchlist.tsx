import React, { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, Target, Edit, Trash2, BarChart3 } from 'lucide-react';
import { SavedStock } from '../types';
import { supabase } from '../lib/supabase';
import { formatCurrency, formatPercentage, getPerformanceColor } from '../utils/dcf';

export default function StockWatchlist() {
  const [stocks, setStocks] = useState<SavedStock[]>([]);
  const [loading, setLoading] = useState(false);
  const [sortBy, setSortBy] = useState<'ticker' | 'expectedReturn' | 'cagr' | 'buyTarget'>('ticker');
  const [filterBy, setFilterBy] = useState<'all' | 'undervalued' | 'overvalued'>('all');

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
        const enrichedStocks: SavedStock[] = data.map(stock => ({
          id: stock.id,
          ticker: stock.ticker,
          currentPrice: stock.current_price,
          fairValue: stock.fair_value,
          expectedReturn: stock.expected_return,
          cagr: stock.cagr,
          buyTarget: stock.buy_target,
          dcfInputs: stock.dcf_inputs,
          createdAt: new Date(stock.created_at),
          updatedAt: new Date(stock.updated_at)
        }));
        setStocks(enrichedStocks);
      }
    } catch (error) {
      console.error('Error loading stocks:', error);
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
    if (stock.currentPrice <= stock.buyTarget) return { status: 'strong-buy', color: 'bg-green-600', text: 'Strong Buy' };
    if (stock.currentPrice <= stock.fairValue * 0.9) return { status: 'buy', color: 'bg-green-500', text: 'Buy' };
    if (stock.currentPrice <= stock.fairValue) return { status: 'hold', color: 'bg-yellow-500', text: 'Hold' };
    if (stock.currentPrice <= stock.fairValue * 1.1) return { status: 'weak-hold', color: 'bg-orange-500', text: 'Weak Hold' };
    return { status: 'sell', color: 'bg-red-600', text: 'Overvalued' };
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
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Fair Value</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Buy Target</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Expected Return</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">CAGR</th>
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
                      <div className="text-sm font-medium text-blue-600">
                        {formatCurrency(stock.fairValue)}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        <Target className="w-4 h-4 text-blue-500" />
                        <span className="text-sm font-medium text-blue-600">
                          {formatCurrency(stock.buyTarget)}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className={`text-sm font-medium ${getPerformanceColor(stock.expectedReturn, 'return')}`}>
                        {formatPercentage(stock.expectedReturn)}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className={`text-sm font-medium ${getPerformanceColor(stock.cagr, 'cagr')}`}>
                        {formatPercentage(stock.cagr)}
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