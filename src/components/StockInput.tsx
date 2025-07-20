import React, { useState } from 'react';
import { Search, TrendingUp } from 'lucide-react';
import { StockInputData, ValuationMetric } from '../types';

interface StockInputProps {
  onCalculate: (data: StockInputData) => void;
  loading: boolean;
}

const StockInput: React.FC<StockInputProps> = ({ onCalculate, loading }) => {
  const [formData, setFormData] = useState<StockInputData>({
    ticker: '',
    valuationMetric: 'P/S',
    valuationMultiple: 15,
    baseMetricValue: 0,
    desiredReturn: 15,
    growthRates: {
      bull: [25, 20, 15, 12, 10],
      base: [15, 12, 10, 8, 6],
      bear: [8, 6, 4, 2, 1]
    }
  });

  const handleInputChange = (field: keyof StockInputData, value: any) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleGrowthRateChange = (scenario: 'bull' | 'base' | 'bear', year: number, value: number) => {
    setFormData(prev => ({
      ...prev,
      growthRates: {
        ...prev.growthRates,
        [scenario]: prev.growthRates[scenario].map((rate, index) => 
          index === year ? value : rate
        )
      }
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onCalculate(formData);
  };

  const valuationMetrics: { value: ValuationMetric; label: string }[] = [
    { value: 'P/S', label: 'Price-to-Sales (P/S)' },
    { value: 'P/E', label: 'Price-to-Earnings (P/E)' },
    { value: 'P/FCF', label: 'Price-to-Free Cash Flow (P/FCF)' },
    { value: 'EV/Revenue', label: 'EV/Revenue' },
    { value: 'EV/EBITDA', label: 'EV/EBITDA' }
  ];

  return (
    <div className="bg-white rounded-xl shadow-lg p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-blue-100 rounded-lg">
          <TrendingUp className="w-6 h-6 text-blue-600" />
        </div>
        <h2 className="text-2xl font-bold text-gray-800">Stock Valuation Input</h2>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Information */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Ticker Symbol
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                value={formData.ticker}
                onChange={(e) => handleInputChange('ticker', e.target.value.toUpperCase())}
                className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="e.g., AAPL"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Valuation Metric
            </label>
            <select
              value={formData.valuationMetric}
              onChange={(e) => handleInputChange('valuationMetric', e.target.value as ValuationMetric)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              {valuationMetrics.map(metric => (
                <option key={metric.value} value={metric.value}>
                  {metric.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Valuation Multiple
            </label>
            <input
              type="number"
              value={formData.valuationMultiple}
              onChange={(e) => handleInputChange('valuationMultiple', parseFloat(e.target.value))}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="e.g., 15"
              step="0.1"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Base Metric Value (Current)
            </label>
            <input
              type="number"
              value={formData.baseMetricValue}
              onChange={(e) => handleInputChange('baseMetricValue', parseFloat(e.target.value))}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="e.g., 365000000000"
              step="0.01"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Desired Annual Return (%)
            </label>
            <input
              type="number"
              value={formData.desiredReturn}
              onChange={(e) => handleInputChange('desiredReturn', parseFloat(e.target.value))}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="e.g., 15"
              step="0.1"
              required
            />
          </div>
        </div>

        {/* Growth Rate Projections */}
        <div>
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Growth Rate Projections (%)</h3>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {(['bull', 'base', 'bear'] as const).map(scenario => (
              <div key={scenario} className="space-y-3">
                <h4 className={`font-medium text-center py-2 px-4 rounded-lg ${
                  scenario === 'bull' ? 'bg-green-100 text-green-800' :
                  scenario === 'base' ? 'bg-blue-100 text-blue-800' :
                  'bg-red-100 text-red-800'
                }`}>
                  {scenario.charAt(0).toUpperCase() + scenario.slice(1)} Case
                </h4>
                {formData.growthRates[scenario].map((rate, index) => (
                  <div key={index}>
                    <label className="block text-sm text-gray-600 mb-1">
                      Year {index + 1}
                    </label>
                    <input
                      type="number"
                      value={rate}
                      onChange={(e) => handleGrowthRateChange(scenario, index, parseFloat(e.target.value))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      step="0.1"
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold py-3 px-6 rounded-lg transition-colors duration-200 flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
              Calculating...
            </>
          ) : (
            <>
              <TrendingUp className="w-5 h-5" />
              Calculate Fair Value
            </>
          )}
        </button>
      </form>
    </div>
  );
};

export default StockInput;