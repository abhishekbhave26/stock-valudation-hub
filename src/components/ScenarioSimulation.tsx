import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlaskConical, Search, TrendingDown, TrendingUp, RotateCcw, Info } from 'lucide-react';
import { SavedStock } from '../types';
import { supabase } from '../lib/supabase';
import { formatCurrency, formatPercentage, getValuationStatusForPrice } from '../utils/dcf';
import { useAuth } from '../hooks/useAuth';

// ---------------------------------------------------------------------------
// Market scenario simulation.
//
// This tab is arithmetic, not a prediction. For a chosen market move M and a
// stock's sensitivity S, the simulated price is:
//
//   simulated price = current price x (1 + M x S)
//   simulated move  = M x S
//
// Sensitivities are the user's own estimates of how much a stock moves
// relative to the market — they are NOT measured betas and nothing here is
// fetched from any data provider. The default sensitivity is 1.0 (moves with
// the market). SOFI defaults to 2.5 because the user gave that example
// ("if the market falls 10%, SOFI might fall 25-30%"); it is editable like
// every other sensitivity and is labelled as coming from that example.
// Nothing on this tab changes the watchlist, DCF inputs, or prices.
// ---------------------------------------------------------------------------

const DEFAULT_SENSITIVITY = 1.0;

// Sensitivities the user stated as examples. Labelled in the UI as such;
// editable like any other sensitivity.
const EXAMPLE_SENSITIVITIES: Record<string, number> = {
  SOFI: 2.5,
};

interface ScenarioPreset {
  id: string;
  label: string;
  marketMove: number; // percent, e.g. -10 means the market falls 10%
  description: string;
}

const PRESETS: ScenarioPreset[] = [
  { id: 'correction', label: 'Market −10%', marketMove: -10, description: 'A 10% market correction' },
  { id: 'recession', label: 'Recession', marketMove: -20, description: 'A 20% market drop (recession-style sell-off)' },
  { id: 'boom', label: 'Economic Boom', marketMove: 10, description: 'A 10% market rally (economic boom)' },
];

const SENSITIVITY_STORAGE_PREFIX = 'scenario-sensitivities-';

type SensitivitySource = 'you' | 'example' | 'default';

export default function ScenarioSimulation() {
  const { user } = useAuth();
  const [stocks, setStocks] = useState<SavedStock[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activePreset, setActivePreset] = useState<string>('correction');
  const [marketMove, setMarketMove] = useState<number>(-10);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'ticker' | 'simulatedMove' | 'simulatedPrice' | 'status'>('simulatedMove');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  // Sensitivities the user has set explicitly, keyed by uppercase ticker.
  // Anything not here falls back to EXAMPLE_SENSITIVITIES, then 1.0.
  const [overrides, setOverrides] = useState<Record<string, number>>({});

  const storageKey = user?.email ? `${SENSITIVITY_STORAGE_PREFIX}${user.email}` : null;

  const loadStocks = useCallback(async () => {
    if (!user?.email) {
      setStocks([]);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const { data, error } = await supabase
        .from('saved_stocks')
        .select('*')
        .eq('user_email', user.email)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setStocks(
        (data ?? []).map((stock) => ({
          id: stock.id,
          ticker: stock.ticker,
          currentPrice: stock.current_price,
          fairValue: stock.fair_value,
          expectedReturn: stock.expected_return,
          cagr: stock.cagr,
          buyTarget: stock.buy_target,
          dcf_inputs: stock.dcf_inputs,
          createdAt: new Date(stock.created_at),
          updatedAt: new Date(stock.updated_at),
          notes: stock.notes || '',
          isFavorite: stock.is_favorite ?? false,
        }))
      );
    } catch (error) {
      console.error('Error loading stocks for simulation:', error);
      setLoadError('Could not load the watchlist. Please try again.');
      setStocks([]);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadStocks();
  }, [loadStocks]);

  // Load saved sensitivities for this user.
  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, number>;
        const cleaned: Record<string, number> = {};
        Object.entries(parsed).forEach(([ticker, value]) => {
          const n = Number(value);
          if (ticker && Number.isFinite(n) && n >= 0 && n <= 10) cleaned[ticker.toUpperCase()] = n;
        });
        setOverrides(cleaned);
      }
    } catch {
      // Corrupt stored value: ignore it and start from defaults.
      setOverrides({});
    }
  }, [storageKey]);

  const persistOverrides = (next: Record<string, number>) => {
    setOverrides(next);
    if (storageKey) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // Storage full/blocked: the in-memory values still apply this session.
      }
    }
  };

  const getSensitivity = (ticker: string): { value: number; source: SensitivitySource } => {
    const key = ticker.toUpperCase();
    if (overrides[key] !== undefined) return { value: overrides[key], source: 'you' };
    if (EXAMPLE_SENSITIVITIES[key] !== undefined) return { value: EXAMPLE_SENSITIVITIES[key], source: 'example' };
    return { value: DEFAULT_SENSITIVITY, source: 'default' };
  };

  const setSensitivity = (ticker: string, value: number) => {
    const key = ticker.toUpperCase();
    const clamped = Math.min(10, Math.max(0, Number.isFinite(value) ? value : DEFAULT_SENSITIVITY));
    persistOverrides({ ...overrides, [key]: clamped });
  };

  const resetSensitivity = (ticker: string) => {
    const key = ticker.toUpperCase();
    const next = { ...overrides };
    delete next[key];
    persistOverrides(next);
  };

  const resetAllSensitivities = () => {
    persistOverrides({});
  };

  const applyPreset = (preset: ScenarioPreset) => {
    setActivePreset(preset.id);
    setMarketMove(preset.marketMove);
  };

  const handleCustomMove = (value: number) => {
    setActivePreset('custom');
    setMarketMove(Math.min(50, Math.max(-50, Number.isFinite(value) ? value : 0)));
  };

  const rows = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    const computed = stocks
      .filter((stock) => !term || stock.ticker.toLowerCase().includes(term))
      .map((stock) => {
        const { value: sensitivity, source } = getSensitivity(stock.ticker);
        const simulatedMove = (marketMove / 100) * sensitivity; // fraction
        const simulatedPrice = stock.currentPrice > 0 ? stock.currentPrice * (1 + simulatedMove) : 0;
        const currentStatus = getValuationStatusForPrice(stock.currentPrice, stock.fairValue);
        const simulatedStatus = getValuationStatusForPrice(simulatedPrice, stock.fairValue);
        return { stock, sensitivity, sensitivitySource: source, simulatedMove, simulatedPrice, currentStatus, simulatedStatus };
      });

    const direction = sortDirection === 'asc' ? 1 : -1;
    computed.sort((a, b) => {
      switch (sortBy) {
        case 'ticker':
          return direction * a.stock.ticker.localeCompare(b.stock.ticker);
        case 'simulatedPrice':
          return direction * (a.simulatedPrice - b.simulatedPrice);
        case 'status': {
          const rank: Record<string, number> = { 'strong-buy': 0, buy: 1, hold: 2, overvalued: 3 };
          return direction * ((rank[a.simulatedStatus.status] ?? 4) - (rank[b.simulatedStatus.status] ?? 4));
        }
        case 'simulatedMove':
        default:
          return direction * (a.simulatedMove - b.simulatedMove);
      }
    });
    return computed;
    // getSensitivity reads `overrides`, which changes only via setSensitivity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stocks, marketMove, searchTerm, sortBy, sortDirection, overrides]);

  const summary = useMemo(() => {
    const moves = rows.map((r) => r.simulatedMove).filter((m) => Number.isFinite(m));
    const avgMove = moves.length > 0 ? moves.reduce((sum, m) => sum + m, 0) / moves.length : 0;
    const wouldBeStrongBuy = rows.filter((r) => r.simulatedStatus.status === 'strong-buy').length;
    const wouldBeBuy = rows.filter((r) => r.simulatedStatus.status === 'buy').length;
    const flipsToBuy = rows.filter(
      (r) => (r.simulatedStatus.status === 'strong-buy' || r.simulatedStatus.status === 'buy') &&
        r.currentStatus.status !== 'strong-buy' && r.currentStatus.status !== 'buy'
    ).length;
    return { avgMove, wouldBeStrongBuy, wouldBeBuy, flipsToBuy };
  }, [rows]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-xl shadow-lg p-6 dark:bg-slate-800">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-600 rounded-lg">
            <FlaskConical className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">Market Scenario Simulation</h2>
            <p className="text-sm text-gray-500 dark:text-slate-400">
              What happens to your watchlist if the market moves? Simulated prices only — nothing here changes your watchlist or DCF data.
            </p>
          </div>
        </div>

        {/* How it works — the honesty label */}
        <div className="mt-4 flex gap-2 rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-900 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-200">
          <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <p>
            <strong>How this is computed:</strong> simulated price = current price × (1 + market move × sensitivity).
            A sensitivity of 1.0 means the stock moves with the market; 2.5 means it moves 2.5× as much.
            Sensitivities are <strong>your estimates</strong>, not measured betas — the default is 1.0 unless you set your own.
            This is a what-if exercise, not a prediction and not investment advice.
          </p>
        </div>
      </div>

      {/* Scenario picker */}
      <div className="bg-white rounded-xl shadow-lg p-6 dark:bg-slate-800">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-slate-200 mb-3">Scenario</h3>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => applyPreset(preset)}
              title={preset.description}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activePreset === preset.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600'
              }`}
            >
              {preset.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setActivePreset('custom')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activePreset === 'custom'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600'
            }`}
          >
            Custom
          </button>
        </div>

        <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <label htmlFor="market-move" className="text-sm text-gray-700 dark:text-slate-200 whitespace-nowrap">
            Market move
          </label>
          <input
            id="market-move"
            type="range"
            min={-50}
            max={50}
            step={1}
            value={marketMove}
            onChange={(e) => handleCustomMove(Number(e.target.value))}
            className="flex-1 accent-blue-600"
            aria-label="Market move percent"
          />
          <div className="flex items-center gap-1">
            <input
              type="number"
              value={marketMove}
              min={-50}
              max={50}
              step={1}
              onChange={(e) => handleCustomMove(Number(e.target.value))}
              className="w-20 px-2 py-1.5 border border-gray-300 rounded-lg text-sm text-center dark:bg-slate-700 dark:border-slate-600 dark:text-white"
              aria-label="Market move percent value"
            />
            <span className="text-sm text-gray-500 dark:text-slate-400">%</span>
          </div>
        </div>
        <p className="mt-2 text-sm text-gray-600 dark:text-slate-300">
          Simulating a market move of{' '}
          <strong className={marketMove < 0 ? 'text-red-600' : marketMove > 0 ? 'text-green-600' : ''}>
            {marketMove > 0 ? `+${marketMove}%` : `${marketMove}%`}
          </strong>{' '}
          across {stocks.length} watchlist stocks.
        </p>

        {/* Summary */}
        {rows.length > 0 && (
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-lg bg-gray-50 p-3 dark:bg-slate-700">
              <div className="text-xs text-gray-500 dark:text-slate-400">Average simulated move</div>
              <div className={`text-lg font-semibold ${summary.avgMove < 0 ? 'text-red-600' : summary.avgMove > 0 ? 'text-green-600' : 'text-gray-900 dark:text-white'}`}>
                {formatPercentage(summary.avgMove)}
              </div>
            </div>
            <div className="rounded-lg bg-gray-50 p-3 dark:bg-slate-700">
              <div className="text-xs text-gray-500 dark:text-slate-400">Would be Strong Buy</div>
              <div className="text-lg font-semibold text-gray-900 dark:text-white">{summary.wouldBeStrongBuy}</div>
            </div>
            <div className="rounded-lg bg-gray-50 p-3 dark:bg-slate-700">
              <div className="text-xs text-gray-500 dark:text-slate-400">Would be Buy</div>
              <div className="text-lg font-semibold text-gray-900 dark:text-white">{summary.wouldBeBuy}</div>
            </div>
            <div className="rounded-lg bg-gray-50 p-3 dark:bg-slate-700">
              <div className="text-xs text-gray-500 dark:text-slate-400">Flip to Buy / Strong Buy</div>
              <div className="text-lg font-semibold text-gray-900 dark:text-white">{summary.flipsToBuy}</div>
            </div>
          </div>
        )}
      </div>

      {/* Controls: search / sort / reset */}
      <div className="bg-white rounded-xl shadow-lg p-4 dark:bg-slate-800">
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search stocks..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm dark:bg-slate-700 dark:border-slate-600 dark:text-white"
            />
          </div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm dark:bg-slate-700 dark:border-slate-600 dark:text-white"
            aria-label="Sort simulated results"
          >
            <option value="simulatedMove">Sort: Simulated move</option>
            <option value="ticker">Sort: Ticker</option>
            <option value="simulatedPrice">Sort: Simulated price</option>
            <option value="status">Sort: Valuation status</option>
          </select>
          <button
            type="button"
            onClick={() => setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm dark:bg-slate-700 dark:border-slate-600 dark:text-white"
          >
            {sortDirection === 'asc' ? '↑ Asc' : '↓ Desc'}
          </button>
          <button
            type="button"
            onClick={resetAllSensitivities}
            title="Clear all sensitivities you set, back to defaults (1.0, SOFI 2.5 from your example)"
            className="flex items-center gap-1 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <RotateCcw className="w-4 h-4" />
            Reset sensitivities
          </button>
        </div>
      </div>

      {/* Results */}
      <div className="bg-white rounded-xl shadow-lg overflow-hidden dark:bg-slate-800">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-500 dark:text-slate-400">Loading watchlist…</div>
        ) : loadError ? (
          <div className="p-8 text-center text-sm text-red-600">{loadError}</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500 dark:text-slate-400">
            {stocks.length === 0 ? 'No stocks in your watchlist yet.' : 'No stocks match your search.'}
          </div>
        ) : (
          <div className="overflow-auto max-h-[75vh]">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
              <thead className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 dark:bg-slate-700 dark:border-slate-600">
                <tr>
                  <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-slate-300">Stock</th>
                  <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-slate-300">Current Price</th>
                  <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-slate-300">Sensitivity</th>
                  <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-slate-300">Simulated Move</th>
                  <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-slate-300">Simulated Price</th>
                  <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-slate-300">Valuation at Simulated Price</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {rows.map(({ stock, sensitivity, sensitivitySource, simulatedMove, simulatedPrice, currentStatus, simulatedStatus }) => (
                  <tr key={stock.id ?? stock.ticker} className="hover:bg-gray-50 dark:hover:bg-slate-700/50">
                    <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                      <div className="font-medium text-gray-900 dark:text-white">{stock.ticker}</div>
                      <div className="text-xs text-gray-500 dark:text-slate-400">
                        Now: {currentStatus.text}
                      </div>
                    </td>
                    <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                      {formatCurrency(stock.currentPrice)}
                    </td>
                    <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          value={sensitivity}
                          min={0}
                          max={10}
                          step={0.1}
                          onChange={(e) => setSensitivity(stock.ticker, Number(e.target.value))}
                          className="w-16 px-2 py-1 border border-gray-300 rounded-lg text-sm text-center dark:bg-slate-700 dark:border-slate-600 dark:text-white"
                          aria-label={`Sensitivity for ${stock.ticker}`}
                          title="How many times the market move this stock moves. Your estimate — not a measured beta."
                        />
                        <span className="text-xs text-gray-400" title={
                          sensitivitySource === 'you'
                            ? 'Sensitivity you set'
                            : sensitivitySource === 'example'
                              ? 'Default from your example (SOFI falls 25–30% on a 10% market drop)'
                              : 'Default sensitivity (moves with the market)'
                        }>
                          {sensitivitySource === 'you' ? 'yours' : sensitivitySource === 'example' ? 'example' : 'default'}
                        </span>
                        {sensitivitySource === 'you' && (
                          <button
                            type="button"
                            onClick={() => resetSensitivity(stock.ticker)}
                            className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400"
                            title="Reset to default sensitivity"
                          >
                            Reset
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1 text-sm font-medium ${simulatedMove < 0 ? 'text-red-600' : simulatedMove > 0 ? 'text-green-600' : 'text-gray-500 dark:text-slate-400'}`}>
                        {simulatedMove < 0 ? <TrendingDown className="w-4 h-4" /> : simulatedMove > 0 ? <TrendingUp className="w-4 h-4" /> : null}
                        {formatPercentage(simulatedMove)}
                      </span>
                    </td>
                    <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                      {simulatedPrice > 0 ? formatCurrency(simulatedPrice) : '—'}
                    </td>
                    <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium text-white ${simulatedStatus.color}`}>
                        {simulatedStatus.text}
                      </span>
                      {simulatedStatus.text !== currentStatus.text && (
                        <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                          was {currentStatus.text}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-gray-400 dark:text-slate-500 text-center">
        Simulation only — simulated prices are arithmetic on your current prices and your sensitivity estimates.
        They are not predictions, not measured betas, and not investment advice.
      </p>
    </div>
  );
}
