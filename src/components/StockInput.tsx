import React, { useState } from 'react';
import { Search, Calculator } from 'lucide-react';
import { DCFInputs } from '../types';

interface StockInputProps {
  onCalculate: (inputs: DCFInputs) => void;
  loading: boolean;
}

const VALUATION_METRICS = [
  { value: 'P/S', label: 'Price-to-Sales (P/S)' },
  { value: 'P/E', label: 'Price-to-Earnings (P/E)' },
  { value: 'P/FCF', label: 'Price-to-Free Cash Flow (P/FCF)' },
  { value: 'P/B', label: 'Price-to-Book (P/B)' },
  { value: 'EV/Sales', label: 'EV/Sales' },
  { value: 'EV/EBITDA', label: 'EV/EBITDA' }
] as const;

export default function StockInput({ onCalculate, loading }: StockInputProps) {
  const [inputs, setInputs] = useState<DCFInputs>({
    ticker: '',
    valuationMetric: 'P/S',
    valuationMultiple: 10,
    baseMetricValue: 0,
    desiredReturn: 12,
    growthRates: {
      bull: [25, 20, 15, 12, 10],
      base: [15, 12, 10, 8, 6],
      bear: [5, 3, 2, 1, 0]
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputs.ticker && inputs.baseMetricValue > 0) {
      onCalculate(inputs);
    }
  };

  const updateGrowthRate = (scenario: 'bull' | 'base' | 'bear', year: number, value: number) => {
    setInputs(prev => ({
      ...prev,
      growthRates: {
        ...prev.growthRates,
        [scenario]: prev.growthRates[scenario].map((rate, index) => 
          index === year ? value : rate
        )
      }
    }));
  };

  return (
    <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
      <div className="flex items-center gap-3 mb-6">
        <Calculator className="w-6 h-6 text-blue-600" />
        <h2 className="text-xl font-semibold text-gray-800">DCF Valuation Calculator</h2>
      </div>
      
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Inputs */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Stock Ticker
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={inputs.ticker}
                onChange={(e) => setInputs(prev => ({ ...prev, ticker: e.target.value.toUpperCase() }))}
                placeholder="e.g., AAPL"
                className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Valuation Metric
            </label>
            <select
              value={inputs.valuationMetric}
              onChange={(e) => setInputs(prev => ({ ...prev, valuationMetric: e.target.value as DCFInputs['valuationMetric'] }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              {VALUATION_METRICS.map(metric => (
                <option key={metric.value} value={metric.value}>
                  {metric.label}
                </option>
              ))}
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Valuation Multiple
            </label>
            <input
              type="number"
              value={inputs.valuationMultiple}
              onChange={(e) => setInputs(prev => ({ ...prev, valuationMultiple: Number(e.target.value) }))}
              min="1"
              step="0.1"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Base Metric Value ($M)
            </label>
            <input
              type="number"
              value={inputs.baseMetricValue || ''}
              onChange={(e) => setInputs(prev => ({ ...prev, baseMetricValue: Number(e.target.value) }))}
              min="0"
              step="100"
              placeholder="e.g., 365000"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Desired Annual Return (%)
            </label>
            <input
              type="number"
              value={inputs.desiredReturn}
              onChange={(e) => setInputs(prev => ({ ...prev, desiredReturn: Number(e.target.value) }))}
              min="1"
              max="50"
              step="0.1"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
          </div>
        </div>

        {/* Growth Rate Projections */}
        <div className="space-y-4">
          <h3 className="text-lg font-medium text-gray-800">5-Year Growth Rate Projections (%)</h3>
          
          {['bull', 'base', 'bear'].map(scenario => (
            <div key={scenario} className="space-y-2">
              <h4 className={`text-sm font-medium capitalize ${
                scenario === 'bull' ? 'text-green-700' : 
                scenario === 'base' ? 'text-blue-700' : 'text-red-700'
              }`}>
                {scenario} Case
              </h4>
              <div className="grid grid-cols-5 gap-2">
                {[0, 1, 2, 3, 4].map(year => (
                  <div key={year}>
                    <label className="block text-xs text-gray-500 mb-1">
                      Year {year + 1}
                    </label>
                    <input
                      type="number"
                      value={inputs.growthRates[scenario as keyof typeof inputs.growthRates][year]}
                      onChange={(e) => updateGrowthRate(scenario as 'bull' | 'base' | 'bear', year, Number(e.target.value))}
                      min="-50"
                      max="100"
                      step="0.1"
                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <button
          type="submit"
          disabled={loading || !inputs.ticker || inputs.baseMetricValue <= 0}
          className="w-full bg-blue-600 text-white py-3 px-6 rounded-lg font-medium hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Calculating...' : 'Calculate Fair Value'}
        </button>
      </form>
    </div>
  );
}