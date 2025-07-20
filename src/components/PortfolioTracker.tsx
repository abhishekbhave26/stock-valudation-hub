import React, { useState, useEffect } from 'react';
import { Plus, TrendingUp, TrendingDown, Wallet, Filter, Edit, Save, X, PieChart } from 'lucide-react';
import { PortfolioStock } from '../types';
import { supabase } from '../lib/supabase';
import { formatCurrency, formatPercentage } from '../utils/dcf';
import { format } from 'date-fns';
import { PieChart as RechartsPieChart, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Pie } from 'recharts';

export default function PortfolioTracker() {
  const [portfolioStocks, setPortfolioStocks] = useState<PortfolioStock[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [sortBy, setSortBy] = useState<'ticker' | 'totalReturn' | 'cagr'>('ticker');
  const [filterBy, setFilterBy] = useState<'all' | 'positive' | 'negative'>('all');
  const [editingStock, setEditingStock] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<any>(null);

  const [newStock, setNewStock] = useState({
    ticker: '',
    quantity: 0,
    buyPrice: 0,
    purchaseDate: new Date().toISOString().split('T')[0],
    currentPrice: 0
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
        const enrichedStocks: PortfolioStock[] = data.map(stock => {
          const currentPrice = stock.current_price || stock.buy_price;
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
    if (!newStock.ticker || newStock.quantity <= 0 || newStock.buyPrice <= 0 || newStock.currentPrice <= 0) return;

    try {
      const { error } = await supabase
        .from('portfolio_stocks')
        .insert([{
          ticker: newStock.ticker.toUpperCase(),
          quantity: newStock.quantity,
          buy_price: newStock.buyPrice,
          purchase_date: newStock.purchaseDate,
          current_price: newStock.currentPrice
        }]);

      if (error) throw error;

      setNewStock({
        ticker: '',
        quantity: 0,
        buyPrice: 0,
        purchaseDate: new Date().toISOString().split('T')[0],
        currentPrice: 0
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

  const startEdit = (stock: PortfolioStock) => {
    setEditingStock(stock.id!);
    setEditForm({
      ticker: stock.ticker,
      quantity: stock.quantity,
      buyPrice: stock.buyPrice,
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

  // Prepare data for visualizations
  const pieChartData = portfolioStocks.map(stock => ({
    name: stock.ticker,
    value: stock.totalValue || 0,
    color: `hsl(${Math.random() * 360}, 70%, 50%)`
  }));

  const barChartData = portfolioStocks.map(stock => ({
    ticker: stock.ticker,
    totalReturn: stock.totalReturn || 0,
    cagr: stock.cagr || 0
  }));

  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82CA9D', '#FFC658', '#FF7C7C'];

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
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {pieChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => formatCurrency(value as number)} />
                </RechartsPieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Performance Bar Chart */}
          <div className="bg-white rounded-xl shadow-lg p-6">
            <div className="flex items-center gap-3 mb-4">
              <TrendingUp className="w-5 h-5 text-green-600" />
              <h3 className="text-lg font-semibold text-gray-800">Performance Comparison</h3>
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="ticker" />
                  <YAxis />
                  <Tooltip formatter={(value) => `${(value as number).toFixed(2)}%`} />
                  <Legend />
                  <Bar dataKey="totalReturn" fill="#8884d8" name="Total Return %" />
                  <Bar dataKey="cagr" fill="#82ca9d" name="CAGR %" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

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
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
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
                type="number"
                placeholder="Current Price"
                value={newStock.currentPrice || ''}
                onChange={(e) => setNewStock(prev => ({ ...prev, currentPrice: Number(e.target.value) }))}
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
                disabled={!newStock.ticker || newStock.quantity <= 0 || newStock.buyPrice <= 0 || newStock.currentPrice <= 0}
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
                    <input
                      type="number"
                      value={editForm.currentPrice}
                      onChange={(e) => setEditForm(prev => ({ ...prev, currentPrice: Number(e.target.value) }))}
                      className="px-2 py-1 border border-gray-300 rounded text-sm"
                      placeholder="Current Price"
                      step="0.01"
                    />
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
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}