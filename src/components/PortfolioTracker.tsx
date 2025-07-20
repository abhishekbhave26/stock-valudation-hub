import React, { useState, useEffect } from 'react';
import { Plus, TrendingUp, TrendingDown, Wallet, Filter } from 'lucide-react';
import { PortfolioStock } from '../types';
import { supabase } from '../lib/supabase';
import { fetchMultipleStockPrices } from '../utils/stockApi';
import { formatCurrency, formatPercentage } from '../utils/dcf';
import { format } from 'date-fns';

export default function PortfolioTracker() {
  const [portfolioStocks, setPortfolioStocks] = useState<PortfolioStock[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [sortBy, setSortBy] = useState<'ticker' | 'totalReturn' | 'cagr'>('ticker');
  const [filterBy, setFilterBy] = useState<'all' | 'positive' | 'negative'>('all');

  const [newStock, setNewStock] = useState({
    ticker: '',
    quantity: 0,
    buyPrice: 0,
    purchaseDate: new Date().toISOString().split('T')[0]
  });

  useEffect(() => {
    loadPortfolio();
  }, []);

  const loadPortfolio = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('portfolio_stocks')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      if (data && data.length > 0) {
        const tickers = data.map(stock => stock.ticker);
        const prices = await fetchMultipleStockPrices(tickers);

        const enrichedStocks: PortfolioStock[] = data.map(stock => {
          const currentPrice = prices[stock.ticker] || 0;
          const totalValue = currentPrice * stock.quantity;
          const totalCost = stock.buy_price * stock.quantity;
          const totalReturn = totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : 0;
          
          // Calculate CAGR
          const purchaseDate = new Date(stock.purchase_date);
          const yearsDiff = (Date.now() - purchaseDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
          const cagr = yearsDiff > 0 ? (Math.pow(currentPrice / stock.buy_price, 1 / yearsDiff) - 1) * 100 : 0;

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
      }
    } catch (error) {
      console.error('Error loading portfolio:', error);
    } finally {
      setLoading(false);
    }
  };

  const addStock = async () => {
    if (!newStock.ticker || newStock.quantity <= 0 || newStock.buyPrice <= 0) return;

    try {
      const { error } = await supabase
        .from('portfolio_stocks')
        .insert([{
          ticker: newStock.ticker.toUpperCase(),
          quantity: newStock.quantity,
          buy_price: newStock.buyPrice,
          purchase_date: newStock.purchaseDate
        }]);

      if (error) throw error;

      setNewStock({
        ticker: '',
        quantity: 0,
        buyPrice: 0,
        purchaseDate: new Date().toISOString().split('T')[0]
      });
      setShowAddForm(false);
      loadPortfolio();
    } catch (error) {
      console.error('Error adding stock:', error);
    }
  };

  const removeStock = async (id: string) => {
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

  const filteredAndSortedStocks = portfolioStocks
    .filter(stock => {
      if (filterBy === 'positive') return (stock.totalReturn || 0) > 0;
      if (filterBy === 'negative') return (stock.totalReturn || 0) < 0;
      return true;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'totalReturn':
          return (b.totalReturn || 0) - (a.totalReturn || 0);
        case 'cagr':
          return (b.cagr || 0) - (a.cagr || 0);
        default:
          return a.ticker.localeCompare(b.ticker);
      }
    });

  const totalPortfolioValue = portfolioStocks.reduce((sum, stock) => sum + (stock.totalValue || 0), 0);
  const totalCost = portfolioStocks.reduce((sum, stock) => sum + (stock.buyPrice * stock.quantity), 0);
  const totalReturn = totalCost > 0 ? ((totalPortfolioValue - totalCost) / totalCost) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* Portfolio Summary */}
      <div className="bg-white rounded-xl shadow-lg p-6">
        <div className="flex items-center gap-3 mb-4">
          <Wallet className="w-6 h-6 text-blue-600" />
          <h2 className="text-xl font-semibold text-gray-800">Portfolio Summary</h2>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
      </div>

      {/* Controls */}
      <div className="bg-white rounded-xl shadow-lg p-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-gray-500" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                className="px-3 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500"
              >
                <option value="ticker">Sort by Ticker</option>
                <option value="totalReturn">Sort by Return</option>
                <option value="cagr">Sort by CAGR</option>
              </select>
            </div>
            
            <select
              value={filterBy}
              onChange={(e) => setFilterBy(e.target.value as typeof filterBy)}
              className="px-3 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Stocks</option>
              <option value="positive">Profitable</option>
              <option value="negative">Losing</option>
            </select>
          </div>
          
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Stock
          </button>
        </div>

        {/* Add Stock Form */}
        {showAddForm && (
          <div className="mt-4 p-4 bg-gray-50 rounded-lg border">
            <h3 className="font-medium text-gray-800 mb-3">Add New Stock</h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <input
                type="text"
                placeholder="Ticker (e.g., AAPL)"
                value={newStock.ticker}
                onChange={(e) => setNewStock(prev => ({ ...prev, ticker: e.target.value.toUpperCase() }))}
                className="px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="number"
                placeholder="Quantity"
                value={newStock.quantity || ''}
                onChange={(e) => setNewStock(prev => ({ ...prev, quantity: Number(e.target.value) }))}
                className="px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="number"
                placeholder="Buy Price"
                value={newStock.buyPrice || ''}
                onChange={(e) => setNewStock(prev => ({ ...prev, buyPrice: Number(e.target.value) }))}
                step="0.01"
                className="px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="date"
                value={newStock.purchaseDate}
                onChange={(e) => setNewStock(prev => ({ ...prev, purchaseDate: e.target.value }))}
                className="px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex gap-2 mt-3">
              <button
                onClick={addStock}
                disabled={!newStock.ticker || newStock.quantity <= 0 || newStock.buyPrice <= 0}
                className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add
              </button>
              <button
                onClick={() => setShowAddForm(false)}
                className="bg-gray-500 text-white px-4 py-2 rounded hover:bg-gray-600"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredAndSortedStocks.map((stock) => (
            <div key={stock.id} className="bg-white rounded-xl shadow-lg p-6 hover:shadow-xl transition-shadow">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-lg font-bold text-gray-800">{stock.ticker}</h3>
                  <p className="text-sm text-gray-500">
                    {stock.quantity} shares • {format(stock.purchaseDate, 'MMM dd, yyyy')}
                  </p>
                </div>
                <button
                  onClick={() => removeStock(stock.id!)}
                  className="text-gray-400 hover:text-red-500 text-sm"
                >
                  ×
                </button>
              </div>

              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Current Price:</span>
                  <span className="font-medium">{formatCurrency(stock.currentPrice || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Buy Price:</span>
                  <span className="font-medium">{formatCurrency(stock.buyPrice)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Total Value:</span>
                  <span className="font-medium">{formatCurrency(stock.totalValue || 0)}</span>
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
                    <span className={`font-bold ${(stock.cagr || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {formatPercentage(stock.cagr || 0)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}