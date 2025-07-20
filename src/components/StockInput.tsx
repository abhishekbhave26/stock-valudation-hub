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
  { value: 'P/OCF', label: 'Price-to-Operating Cash Flow (P/OCF)' },
  { value: 'EV/Sales', label: 'EV/Sales' },
  { value: 'EV/EBITDA', label: 'EV/EBITDA' }
] as const;

export default function StockInput({ onCalculate, loading }: StockInputProps) {
  const [inputs, setInputs] = useState<DCFInputs>({
    ticker: '',
    currentPrice: 0,
    valuationMetric: 'P/S',
    valuationMultiple: 20,
    baseMetricPerShare: 0,
    sharesOutstanding: 0,
    desiredReturn: 12,
    growthRates: [15, 12, 10, 8, 6]
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputs.ticker && inputs.baseMetricPerShare > 0 && inputs.currentPrice > 0 && inputs.sharesOutstanding > 0) {
      onCalculate(inputs);
    }
  };

  const updateGrowthRate = (year: number, value: number) => {
    setInputs(prev => ({
      ...prev,
      growthRates: prev.growthRates.map((rate, index) => 
        index === year ? value : rate
      )
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
              Current Price ($)
            </label>
            <input
              type="number"
              value={inputs.currentPrice || ''}
              onChange={(e) => setInputs(prev => ({ ...prev, currentPrice: Number(e.target.value) }))}
              min="0"
              step="0.01"
              placeholder="e.g., 150.25"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
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
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          
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
              Base Metric Per Share ($)
            </label>
            <input
              type="number"
              value={inputs.baseMetricPerShare || ''}
              onChange={(e) => setInputs(prev => ({ ...prev, baseMetricPerShare: Number(e.target.value) }))}
              min="0"
              step="0.01"
              placeholder="e.g., 15.25"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Shares Outstanding (M)
            </label>
            <input
              type="number"
              value={inputs.sharesOutstanding || ''}
              onChange={(e) => setInputs(prev => ({ ...prev, sharesOutstanding: Number(e.target.value) }))}
              min="0"
              step="1"
              placeholder="e.g., 1500"
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
          <h3 className="text-lg font-medium text-gray-800">5-Year Metric Growth Rate Projections (%)</h3>
          <p className="text-sm text-gray-600">Enter growth rates for your selected metric (can be positive or negative, up to 10,000%)</p>
          
          <div className="grid grid-cols-5 gap-4">
            {[0, 1, 2, 3, 4].map(year => (
              <div key={year}>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Year {year + 1}
                </label>
                <input
                  type="number"
                  value={inputs.growthRates[year]}
                  onChange={(e) => updateGrowthRate(year, Number(e.target.value))}
                  min="-100"
                  max="10000"
                  step="0.1"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            ))}
          </div>
        </div>

        <button
          type="submit"
          disabled={loading || !inputs.ticker || inputs.baseMetricPerShare <= 0 || inputs.currentPrice <= 0 || inputs.sharesOutstanding <= 0}
          className="w-full bg-blue-600 text-white py-3 px-6 rounded-lg font-medium hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Calculating...' : 'Calculate Fair Value'}
        </button>
      </form>
    </div>
  );
}
            </div>
          ))}
        </div>
