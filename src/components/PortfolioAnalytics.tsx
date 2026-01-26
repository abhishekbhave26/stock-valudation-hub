import React, { useEffect, useState } from 'react';
import { BarChart3, TrendingUp, Wallet } from 'lucide-react';
import { PortfolioStock } from '../types';
import { supabase } from '../lib/supabase';
import { formatCurrency, formatPercentage } from '../utils/dcf';
import { format } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useAuth } from '../hooks/useAuth';

type PortfolioAnalyticsProps = {
  isDarkMode?: boolean;
};

type Snapshot = {
  id: string;
  snapshot_at: string;
  total_value: number;
  total_cost: number;
  total_return: number;
};

export default function PortfolioAnalytics({ isDarkMode = false }: PortfolioAnalyticsProps) {
  const { user } = useAuth();
  const [portfolioStocks, setPortfolioStocks] = useState<PortfolioStock[]>([]);
  const [loadingPortfolio, setLoadingPortfolio] = useState(false);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loadingSnapshots, setLoadingSnapshots] = useState(false);

  useEffect(() => {
    loadPortfolio();
    loadSnapshots();
  }, [user]);

  const loadPortfolio = async () => {
    if (!user?.email) {
      setPortfolioStocks([]);
      return;
    }

    setLoadingPortfolio(true);
    try {
      const { data, error } = await supabase
        .from('portfolio_stocks')
        .select('*')
        .eq('user_email', user.email)
        .order('created_at', { ascending: false });

      if (error) throw error;

      if (data && data.length > 0) {
        const enrichedStocks: PortfolioStock[] = data.map(stock => {
          const currentPrice = stock.current_price || stock.buy_price;
          const totalValue = currentPrice * stock.quantity;
          const totalCost = stock.buy_price * stock.quantity;
          const totalReturn = totalCost > 0 ? (totalValue - totalCost) / totalCost : 0;

          const purchaseDate = new Date(stock.purchase_date);
          const yearsDiff = (Date.now() - purchaseDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
          const cagr = yearsDiff > 0 ? Math.pow(currentPrice / stock.buy_price, 1 / yearsDiff) - 1 : 0;

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
      setPortfolioStocks([]);
    } finally {
      setLoadingPortfolio(false);
    }
  };

  const loadSnapshots = async () => {
    if (!user?.email) {
      setSnapshots([]);
      return;
    }

    setLoadingSnapshots(true);
    try {
      const { data, error } = await supabase
        .from('portfolio_snapshots')
        .select('*')
        .eq('user_email', user.email)
        .order('snapshot_at', { ascending: false });

      if (error) throw error;

      setSnapshots(data || []);
    } catch (error) {
      console.error('Error loading portfolio snapshots:', error);
      setSnapshots([]);
    } finally {
      setLoadingSnapshots(false);
    }
  };

  const totalCost = portfolioStocks.reduce((sum, stock) => sum + (stock.buy_price * stock.quantity), 0);

  const barChartData = portfolioStocks.map(stock => {
    const profitValue = (stock.totalValue || 0) - (stock.buy_price * stock.quantity);
    const rawContribution = totalCost > 0 ? (profitValue / totalCost) * 100 : 0;
    const contributionPercent = Math.round(rawContribution * 100) / 100;

    return {
      ticker: stock.ticker,
      profitValue,
      contributionPercent
    };
  });

  const chartGridColor = isDarkMode ? '#334155' : '#e5e7eb';
  const chartTextColor = isDarkMode ? '#cbd5f5' : '#64748b';
  const tooltipStyles = {
    backgroundColor: isDarkMode ? '#0f172a' : '#ffffff',
    borderColor: isDarkMode ? '#334155' : '#e5e7eb',
    color: isDarkMode ? '#e2e8f0' : '#111827'
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-lg p-4 sm:p-6">
        <div className="flex items-center gap-3">
          <BarChart3 className="w-6 h-6 text-blue-600" />
          <div>
            <h2 className="text-xl font-semibold text-gray-800">Portfolio Analytics</h2>
            <p className="text-sm text-gray-500">Review portfolio snapshots and return contribution insights.</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-lg p-6">
        <div className="flex items-center gap-3 mb-4">
          <TrendingUp className="w-5 h-5 text-green-600" />
          <h3 className="text-lg font-semibold text-gray-800">Return Contribution</h3>
        </div>
        {loadingPortfolio ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
            <p className="text-gray-500 mt-2">Loading portfolio data...</p>
          </div>
        ) : portfolioStocks.length === 0 ? (
          <p className="text-sm text-gray-500">Add holdings to view return contribution analytics.</p>
        ) : (
          <>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                  <XAxis dataKey="ticker" tick={{ fill: chartTextColor }} />
                  <YAxis tick={{ fill: chartTextColor }} />
                  <Tooltip
                    contentStyle={tooltipStyles}
                    formatter={(value, name, item) => {
                      if (name === 'contributionPercent') {
                        const profitValue = (item?.payload?.profitValue ?? 0) as number;
                        return [
                          `${(value as number).toFixed(2)}% (${formatCurrency(profitValue)})`,
                          'Contribution'
                        ];
                      }
                      return value;
                    }}
                  />
                  <Legend />
                  <Bar dataKey="contributionPercent" fill="#8884d8" name="Value-Weighted Return %" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-gray-500 mt-2">Based on each holding’s profit relative to total invested cost.</p>
          </>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-lg p-6">
        <div className="flex items-center gap-3 mb-4">
          <Wallet className="w-5 h-5 text-blue-600" />
          <h3 className="text-lg font-semibold text-gray-800">Portfolio Snapshots</h3>
        </div>
        {loadingSnapshots ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
            <p className="text-gray-500 mt-2">Loading snapshots...</p>
          </div>
        ) : snapshots.length === 0 ? (
          <p className="text-sm text-gray-500">No snapshots yet. Update prices to create your first snapshot.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <th className="px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider">Snapshot Date</th>
                  <th className="px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider">Total Value</th>
                  <th className="px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider">Total Cost</th>
                  <th className="px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider">Total Return</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {snapshots.map(snapshot => (
                  <tr key={snapshot.id}>
                    <td className="px-4 py-2 text-gray-900">
                      {format(new Date(snapshot.snapshot_at), 'MMM dd, yyyy HH:mm')}
                    </td>
                    <td className="px-4 py-2 text-gray-900">
                      {formatCurrency(snapshot.total_value)}
                    </td>
                    <td className="px-4 py-2 text-gray-700">
                      {formatCurrency(snapshot.total_cost)}
                    </td>
                    <td className={`px-4 py-2 font-medium ${snapshot.total_return >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {formatPercentage(snapshot.total_return)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
