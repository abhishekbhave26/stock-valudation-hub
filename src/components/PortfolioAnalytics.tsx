import React, { useEffect, useMemo, useState } from 'react';
import { BarChart3, TrendingUp, Wallet } from 'lucide-react';
import { PortfolioStock } from '../types';
import { supabase } from '../lib/supabase';
import { formatCurrency, formatPercentage } from '../utils/dcf';
import { format } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line } from 'recharts';
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

type SnapshotHolding = {
  id: string;
  snapshot_id: string;
  ticker: string;
  quantity: number;
  buy_price: number;
  current_price: number;
  total_value: number;
  total_cost: number;
  total_return: number;
  weight_percent: number;
};

export default function PortfolioAnalytics({ isDarkMode = false }: PortfolioAnalyticsProps) {
  const { user } = useAuth();
  const [portfolioStocks, setPortfolioStocks] = useState<PortfolioStock[]>([]);
  const [loadingPortfolio, setLoadingPortfolio] = useState(false);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loadingSnapshots, setLoadingSnapshots] = useState(false);
  const [deletingSnapshotId, setDeletingSnapshotId] = useState<string | null>(null);
  const [snapshotHoldings, setSnapshotHoldings] = useState<SnapshotHolding[]>([]);
  const [loadingHoldings, setLoadingHoldings] = useState(false);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string>('');
  const [baseSnapshotId, setBaseSnapshotId] = useState<string>('');
  const [compareSnapshotId, setCompareSnapshotId] = useState<string>('');
  const [comparisonSort, setComparisonSort] = useState<{ key: 'ticker' | 'valueChange' | 'weightChange'; direction: 'asc' | 'desc' }>({
    key: 'valueChange',
    direction: 'desc'
  });

  useEffect(() => {
    loadPortfolio();
    loadSnapshots();
  }, [user]);

  useEffect(() => {
    if (snapshots.length === 0) {
      setSnapshotHoldings([]);
      setSelectedSnapshotId('');
      setBaseSnapshotId('');
      setCompareSnapshotId('');
      return;
    }

    if (!selectedSnapshotId) {
      setSelectedSnapshotId(snapshots[0]?.id ?? '');
    }

    if (!baseSnapshotId || !compareSnapshotId) {
      setCompareSnapshotId(snapshots[0]?.id ?? '');
      setBaseSnapshotId(snapshots[1]?.id ?? snapshots[0]?.id ?? '');
    }

    const snapshotIds = snapshots.map(snapshot => snapshot.id);
    loadSnapshotHoldings(snapshotIds);
  }, [snapshots]);

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

  const loadSnapshotHoldings = async (snapshotIds: string[]) => {
    if (!user?.email || snapshotIds.length === 0) {
      setSnapshotHoldings([]);
      return;
    }

    setLoadingHoldings(true);
    try {
      const { data, error } = await supabase
        .from('portfolio_snapshot_holdings')
        .select('*')
        .in('snapshot_id', snapshotIds);

      if (error) throw error;

      setSnapshotHoldings(data || []);
    } catch (error) {
      console.error('Error loading snapshot holdings:', error);
      setSnapshotHoldings([]);
    } finally {
      setLoadingHoldings(false);
    }
  };

  const deleteSnapshot = async (snapshotId: string) => {
    const confirmed = window.confirm(
      'Do you intend to delete this snapshot and all holdings captured for it?'
    );
    if (!confirmed) {
      return;
    }

    setDeletingSnapshotId(snapshotId);
    try {
      const { error: holdingsError } = await supabase
        .from('portfolio_snapshot_holdings')
        .delete()
        .eq('snapshot_id', snapshotId);

      if (holdingsError) throw holdingsError;

      const { error: snapshotError } = await supabase
        .from('portfolio_snapshots')
        .delete()
        .eq('id', snapshotId);

      if (snapshotError) throw snapshotError;

      setSnapshotHoldings(prevHoldings => prevHoldings.filter(holding => holding.snapshot_id !== snapshotId));
      setSnapshots(prevSnapshots => {
        const updated = prevSnapshots.filter(snapshot => snapshot.id !== snapshotId);
        if (selectedSnapshotId === snapshotId) {
          setSelectedSnapshotId(updated[0]?.id ?? '');
        }
        return updated;
      });
    } catch (error) {
      console.error('Error deleting snapshot:', error);
    } finally {
      setDeletingSnapshotId(null);
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
  const selectedSnapshot = snapshots.find(snapshot => snapshot.id === selectedSnapshotId);
  const selectedSnapshotHoldings = snapshotHoldings.filter(holding => holding.snapshot_id === selectedSnapshotId);
  const snapshotsById = useMemo(
    () => snapshots.reduce<Record<string, Snapshot>>((acc, snapshot) => {
      acc[snapshot.id] = snapshot;
      return acc;
    }, {}),
    [snapshots]
  );
  const holdingsBySnapshotId = useMemo(() => {
    return snapshotHoldings.reduce<Record<string, SnapshotHolding[]>>((acc, holding) => {
      if (!acc[holding.snapshot_id]) {
        acc[holding.snapshot_id] = [];
      }
      acc[holding.snapshot_id].push(holding);
      return acc;
    }, {});
  }, [snapshotHoldings]);
  const sortedHoldings = [...selectedSnapshotHoldings].sort((a, b) => b.weight_percent - a.weight_percent);
  const topTickers = sortedHoldings.slice(0, 5).map(holding => holding.ticker);
  const allocationTrendData = snapshots
    .slice()
    .reverse()
    .map(snapshot => {
      const snapshotRow: Record<string, string | number> = {
        snapshotDate: format(new Date(snapshot.snapshot_at), 'MMM dd')
      };
      topTickers.forEach(ticker => {
        const holding = snapshotHoldings.find(item => item.snapshot_id === snapshot.id && item.ticker === ticker);
        snapshotRow[ticker] = holding ? Math.round(holding.weight_percent * 100) / 100 : 0;
      });
      return snapshotRow;
    });
  const allocationColors = ['#2563eb', '#16a34a', '#f97316', '#7c3aed', '#0ea5e9'];
  const baseSnapshot = snapshotsById[baseSnapshotId];
  const compareSnapshot = snapshotsById[compareSnapshotId];
  const baseHoldings = holdingsBySnapshotId[baseSnapshotId] ?? [];
  const compareHoldings = holdingsBySnapshotId[compareSnapshotId] ?? [];
  const baseHoldingsByTicker = useMemo(() => {
    return baseHoldings.reduce<Record<string, SnapshotHolding>>((acc, holding) => {
      acc[holding.ticker] = holding;
      return acc;
    }, {});
  }, [baseHoldings]);
  const compareHoldingsByTicker = useMemo(() => {
    return compareHoldings.reduce<Record<string, SnapshotHolding>>((acc, holding) => {
      acc[holding.ticker] = holding;
      return acc;
    }, {});
  }, [compareHoldings]);
  const snapshotComparisonRows = useMemo(() => {
    if (!baseSnapshot || !compareSnapshot) {
      return [];
    }
    const tickers = Array.from(new Set([
      ...Object.keys(baseHoldingsByTicker),
      ...Object.keys(compareHoldingsByTicker)
    ])).sort();

    return tickers.map(ticker => {
      const startHolding = baseHoldingsByTicker[ticker];
      const endHolding = compareHoldingsByTicker[ticker];
      const startQty = startHolding?.quantity ?? 0;
      const endQty = endHolding?.quantity ?? 0;
      const startPrice = startHolding?.current_price ?? 0;
      const endPrice = endHolding?.current_price ?? 0;
      const qtyChange = endQty - startQty;
      const qtyChangePercent = startQty > 0 ? qtyChange / startQty : null;
      const priceChange = endPrice - startPrice;
      const priceChangePercent = startPrice > 0 ? priceChange / startPrice : null;
      const valueChange = (endHolding?.total_value ?? 0) - (startHolding?.total_value ?? 0);
      const weightChange = (endHolding?.weight_percent ?? 0) - (startHolding?.weight_percent ?? 0);

      let status = 'Unchanged';
      if (!startHolding && endHolding) {
        status = 'New Position';
      } else if (startHolding && !endHolding) {
        status = 'Sold Out';
      } else if (qtyChange > 0) {
        status = 'Added';
      } else if (qtyChange < 0) {
        status = 'Trimmed';
      } else if (priceChange !== 0) {
        status = priceChange > 0 ? 'Price Up' : 'Price Down';
      }

      return {
        ticker,
        status,
        startQty,
        endQty,
        qtyChange,
        qtyChangePercent,
        startPrice,
        endPrice,
        priceChange,
        priceChangePercent,
        valueChange,
        weightChange
      };
    });
  }, [baseHoldingsByTicker, compareHoldingsByTicker, baseSnapshot, compareSnapshot]);
  const sortedSnapshotComparisonRows = useMemo(() => {
    const rows = [...snapshotComparisonRows];
    rows.sort((a, b) => {
      switch (comparisonSort.key) {
        case 'ticker':
          return comparisonSort.direction === 'asc'
            ? a.ticker.localeCompare(b.ticker)
            : b.ticker.localeCompare(a.ticker);
        case 'weightChange':
          return comparisonSort.direction === 'asc'
            ? a.weightChange - b.weightChange
            : b.weightChange - a.weightChange;
        case 'valueChange':
        default:
          return comparisonSort.direction === 'asc'
            ? a.valueChange - b.valueChange
            : b.valueChange - a.valueChange;
      }
    });
    return rows;
  }, [snapshotComparisonRows, comparisonSort]);
  const snapshotComparisonSummary = useMemo(() => {
    const summary = {
      newPositions: 0,
      addedPositions: 0,
      trimmedPositions: 0,
      soldPositions: 0,
      unchangedPositions: 0,
      priceOnlyMoves: 0
    };

    snapshotComparisonRows.forEach(row => {
      switch (row.status) {
        case 'New Position':
          summary.newPositions += 1;
          break;
        case 'Added':
          summary.addedPositions += 1;
          break;
        case 'Trimmed':
          summary.trimmedPositions += 1;
          break;
        case 'Sold Out':
          summary.soldPositions += 1;
          break;
        case 'Price Up':
        case 'Price Down':
          summary.priceOnlyMoves += 1;
          break;
        default:
          summary.unchangedPositions += 1;
      }
    });
    return summary;
  }, [snapshotComparisonRows]);
  const snapshotPeriodMetrics = useMemo(() => {
    if (!baseSnapshot || !compareSnapshot) {
      return {
        totalValueChange: 0,
        totalReturn: 0,
        cagr: 0,
        yearsDiff: 0
      };
    }
    const startValue = baseSnapshot.total_value;
    const endValue = compareSnapshot.total_value;
    const totalValueChange = endValue - startValue;
    const totalReturn = startValue > 0 ? totalValueChange / startValue : 0;
    const startDate = new Date(baseSnapshot.snapshot_at);
    const endDate = new Date(compareSnapshot.snapshot_at);
    const yearsDiff = (endDate.getTime() - startDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    const cagr = yearsDiff > 0 && startValue > 0 ? Math.pow(endValue / startValue, 1 / yearsDiff) - 1 : 0;
    return {
      totalValueChange,
      totalReturn,
      cagr,
      yearsDiff
    };
  }, [baseSnapshot, compareSnapshot]);

  const handleComparisonSort = (key: 'ticker' | 'valueChange' | 'weightChange') => {
    setComparisonSort(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc'
    }));
  };
  const sortIcon = (key: 'ticker' | 'valueChange' | 'weightChange') => {
    if (comparisonSort.key !== key) {
      return '↕';
    }
    return comparisonSort.direction === 'asc' ? '↑' : '↓';
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-lg p-4 sm:p-6">
        <div className="flex items-center gap-3">
          <BarChart3 className="w-6 h-6 text-blue-600" />
          <div>
            <h2 className="text-xl font-semibold text-gray-800">Portfolio Analytics</h2>
            <p className="text-sm text-gray-500">Review portfolio snapshots (including holdings breakdowns) and return contribution insights.</p>
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
          <p className="text-sm text-gray-500">No snapshots yet. Create one from the Portfolio Tracker to capture your holdings.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left">
                  <tr>
                    <th className="px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider">Snapshot Date</th>
                    <th className="px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider">Total Value</th>
                    <th className="px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider">Total Cost</th>
                    <th className="px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider">Total Return</th>
                    <th className="px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
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
                      <td className="px-4 py-2">
                        <button
                          type="button"
                          onClick={() => deleteSnapshot(snapshot.id)}
                          disabled={deletingSnapshotId === snapshot.id}
                          className="text-xs font-semibold text-red-600 hover:text-red-700 disabled:text-gray-400"
                        >
                          {deletingSnapshotId === snapshot.id ? 'Deleting...' : 'Delete'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {allocationTrendData.length > 1 && topTickers.length > 0 && (
              <div className="mt-6">
                <h4 className="text-sm font-semibold text-gray-700">Allocation Trend (Top Holdings)</h4>
                <p className="text-xs text-gray-500 mb-3">Shows how your largest holdings’ portfolio weights changed across snapshots.</p>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={allocationTrendData}>
                      <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                      <XAxis dataKey="snapshotDate" tick={{ fill: chartTextColor }} />
                      <YAxis tick={{ fill: chartTextColor }} />
                      <Tooltip
                        contentStyle={tooltipStyles}
                        formatter={(value, name) => [`${value}%`, name]}
                      />
                      <Legend />
                      {topTickers.map((ticker, index) => (
                        <Line
                          key={ticker}
                          type="monotone"
                          dataKey={ticker}
                          stroke={allocationColors[index % allocationColors.length]}
                          strokeWidth={2}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-lg p-6">
        <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
          <div>
            <h3 className="text-lg font-semibold text-gray-800">Snapshot Comparison (13F-Style)</h3>
            <p className="text-xs text-gray-500">Compare two snapshots to identify new buys, trims, sells, and price-driven changes.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={baseSnapshotId}
              onChange={(event) => setBaseSnapshotId(event.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
              disabled={snapshots.length < 2}
            >
              {snapshots.map(snapshot => (
                <option key={snapshot.id} value={snapshot.id}>
                  From {format(new Date(snapshot.snapshot_at), 'MMM dd, yyyy HH:mm')}
                </option>
              ))}
            </select>
            <select
              value={compareSnapshotId}
              onChange={(event) => setCompareSnapshotId(event.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
              disabled={snapshots.length < 2}
            >
              {snapshots.map(snapshot => (
                <option key={snapshot.id} value={snapshot.id}>
                  To {format(new Date(snapshot.snapshot_at), 'MMM dd, yyyy HH:mm')}
                </option>
              ))}
            </select>
          </div>
        </div>
        {snapshots.length < 2 ? (
          <p className="text-sm text-gray-500">Create at least two snapshots to compare changes over time.</p>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
              <div className="bg-gray-50 rounded-lg p-4 text-center">
                <p className="text-xs text-gray-500">Value Change</p>
                <p className={`text-lg font-semibold ${snapshotPeriodMetrics.totalValueChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {formatCurrency(snapshotPeriodMetrics.totalValueChange)}
                </p>
                <p className="text-xs text-gray-500 mt-1">Return {formatPercentage(snapshotPeriodMetrics.totalReturn)}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4 text-center">
                <p className="text-xs text-gray-500">Period CAGR</p>
                <p className={`text-lg font-semibold ${snapshotPeriodMetrics.cagr >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {formatPercentage(snapshotPeriodMetrics.cagr)}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {snapshotPeriodMetrics.yearsDiff > 0 ? `${snapshotPeriodMetrics.yearsDiff.toFixed(2)} yrs` : 'N/A'}
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4 text-center">
                <p className="text-xs text-gray-500">Adds / Trims</p>
                <p className="text-lg font-semibold text-gray-800">
                  {snapshotComparisonSummary.addedPositions} / {snapshotComparisonSummary.trimmedPositions}
                </p>
                <p className="text-xs text-gray-500 mt-1">New {snapshotComparisonSummary.newPositions} · Sold {snapshotComparisonSummary.soldPositions}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4 text-center">
                <p className="text-xs text-gray-500">Price-Only Moves</p>
                <p className="text-lg font-semibold text-gray-800">{snapshotComparisonSummary.priceOnlyMoves}</p>
                <p className="text-xs text-gray-500 mt-1">Unchanged {snapshotComparisonSummary.unchangedPositions}</p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left">
                  <tr>
                    <th className="px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider">
                      <button
                        type="button"
                        onClick={() => handleComparisonSort('ticker')}
                        className="inline-flex items-center gap-1 text-gray-600 hover:text-gray-900"
                      >
                        Ticker <span className="text-[10px]">{sortIcon('ticker')}</span>
                      </button>
                    </th>
                    <th className="px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider">Qty (From → To)</th>
                    <th className="px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider">Price (From → To)</th>
                    <th className="px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider">
                      <button
                        type="button"
                        onClick={() => handleComparisonSort('valueChange')}
                        className="inline-flex items-center gap-1 text-gray-600 hover:text-gray-900"
                      >
                        Value Change <span className="text-[10px]">{sortIcon('valueChange')}</span>
                      </button>
                    </th>
                    <th className="px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider">
                      <button
                        type="button"
                        onClick={() => handleComparisonSort('weightChange')}
                        className="inline-flex items-center gap-1 text-gray-600 hover:text-gray-900"
                      >
                        Weight Δ <span className="text-[10px]">{sortIcon('weightChange')}</span>
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {sortedSnapshotComparisonRows.map(row => (
                    <tr key={row.ticker}>
                      <td className="px-4 py-2 text-gray-900 font-medium">{row.ticker}</td>
                      <td className="px-4 py-2 text-gray-700">{row.status}</td>
                      <td className="px-4 py-2 text-gray-700">
                        {row.startQty} → {row.endQty}{' '}
                        {row.qtyChange !== 0 && (
                          <span className={row.qtyChange > 0 ? 'text-green-600' : 'text-red-600'}>
                            ({row.qtyChange > 0 ? '+' : ''}{row.qtyChange}
                            {row.qtyChangePercent !== null ? `, ${formatPercentage(row.qtyChangePercent)}` : ''})
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-gray-700">
                        {formatCurrency(row.startPrice)} → {formatCurrency(row.endPrice)}{' '}
                        {row.priceChange !== 0 && row.priceChangePercent !== null && (
                          <span className={row.priceChange > 0 ? 'text-green-600' : 'text-red-600'}>
                            ({row.priceChange > 0 ? '+' : ''}{formatPercentage(row.priceChangePercent)})
                          </span>
                        )}
                      </td>
                      <td className={`px-4 py-2 font-medium ${row.valueChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {formatCurrency(row.valueChange)}
                      </td>
                      <td className={`px-4 py-2 font-medium ${row.weightChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {row.weightChange >= 0 ? '+' : ''}{row.weightChange.toFixed(2)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Returns and CAGR are based on total value changes between snapshots and do not adjust for external cash flows.
            </p>
          </>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-lg p-6">
        <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
          <div>
            <h3 className="text-lg font-semibold text-gray-800">Snapshot Holdings Breakdown</h3>
            <p className="text-xs text-gray-500">Inspect stock-level weights, value, and return for a specific snapshot.</p>
          </div>
          <select
            value={selectedSnapshotId}
            onChange={(event) => setSelectedSnapshotId(event.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
            disabled={snapshots.length === 0}
          >
            {snapshots.map(snapshot => (
              <option key={snapshot.id} value={snapshot.id}>
                {format(new Date(snapshot.snapshot_at), 'MMM dd, yyyy HH:mm')}
              </option>
            ))}
          </select>
        </div>
        {loadingHoldings ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
            <p className="text-gray-500 mt-2">Loading snapshot holdings...</p>
          </div>
        ) : selectedSnapshotHoldings.length === 0 ? (
          <p className="text-sm text-gray-500">No holdings captured for this snapshot yet.</p>
        ) : (
          <>
            {selectedSnapshot && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <div className="bg-gray-50 rounded-lg p-4 text-center">
                  <p className="text-xs text-gray-500">Snapshot Value</p>
                  <p className="text-lg font-semibold text-gray-800">{formatCurrency(selectedSnapshot.total_value)}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-4 text-center">
                  <p className="text-xs text-gray-500">Snapshot Cost</p>
                  <p className="text-lg font-semibold text-gray-800">{formatCurrency(selectedSnapshot.total_cost)}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-4 text-center">
                  <p className="text-xs text-gray-500">Snapshot Return</p>
                  <p className={`text-lg font-semibold ${selectedSnapshot.total_return >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {formatPercentage(selectedSnapshot.total_return)}
                  </p>
                </div>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left">
                  <tr>
                    <th className="px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider">Ticker</th>
                    <th className="px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider">Weight %</th>
                    <th className="px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider">Total Value</th>
                    <th className="px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider">Total Cost</th>
                    <th className="px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider">Total Return</th>
                    <th className="px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider">Price (Buy → Current)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {sortedHoldings.map(holding => (
                    <tr key={holding.id}>
                      <td className="px-4 py-2 text-gray-900 font-medium">{holding.ticker}</td>
                      <td className="px-4 py-2 text-blue-600 font-medium">{holding.weight_percent.toFixed(2)}%</td>
                      <td className="px-4 py-2 text-gray-900">{formatCurrency(holding.total_value)}</td>
                      <td className="px-4 py-2 text-gray-700">{formatCurrency(holding.total_cost)}</td>
                      <td className={`px-4 py-2 font-medium ${holding.total_return >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {formatPercentage(holding.total_return)}
                      </td>
                      <td className="px-4 py-2 text-gray-700">
                        {formatCurrency(holding.buy_price)} → {formatCurrency(holding.current_price)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
