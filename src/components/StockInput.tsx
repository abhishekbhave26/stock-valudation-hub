import React, { useState } from 'react';
import { Search, TrendingUp, RefreshCw } from 'lucide-react';
import { DCFInputs } from '../types';
import { stockPriceService } from '../services/stockPriceService';

interface StockInputProps {
  onCalculate: (data: DCFInputs) => void;
  loading: boolean;
}

export default function StockInput({ onCalculate, loading }: StockInputProps) {
  const [formData, setFormData] = useState<DCFInputs>({
    ticker: '',
    currentPrice: 0,
    valuationMetric: 'P/S' as const,
    valuationMultiple: 25,
    baseMetricPerShare: 0,
    desiredReturn: 15,
    growthRates: [15, 12, 10, 8, 6]
  });
  const [fetchingPrice, setFetchingPrice] = useState(false);

  const handleInputChange = (field: keyof DCFInputs, value: any) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleGrowthRateChange = (year: number, value: number) => {
    setFormData(prev => ({
      ...prev,
      growthRates: prev.growthRates.map((rate, index) => 
        index === year ? value : rate
      )
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onCalculate(formData);
  };

  const handleFetchCurrentPrice = async () => {
    if (!formData.ticker) return;
    
    setFetchingPrice(true);
    try {
      const priceData = await stockPriceService.getStockPrice(formData.ticker);
      if (priceData) {
        setFormData(prev => ({
          ...prev,
          currentPrice: priceData.price
        }));
      }
    } catch (error) {
      console.error('Failed to fetch current price:', error);
    } finally {
      setFetchingPrice(false);
    }
  };
  const valuationMetrics = [
    { value: 'P/S', label: 'Price-to-Sales (P/S)' },
    { value: 'P/E', label: 'Price-to-Earnings (P/E)' },
    { value: 'P/FCF', label: 'Price-to-Free Cash Flow (P/FCF)' },
    { value: 'P/B', label: 'Price-to-Book (P/B)' },
    { value: 'P/OCF', label: 'Price-to-Operating Cash Flow (P/OCF)' },
    { value: 'EV/Sales', label: 'EV/Sales' },
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
              Current Price ($)
            </label>
            <div className="relative">
              <input
                type="number"
                value={formData.currentPrice || ''}
                onChange={(e) => handleInputChange('currentPrice', parseFloat(e.target.value))}
                className="w-full px-4 py-3 pr-12 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="e.g., 150.00"
                step="0.01"
                required
              />
              <button
                type="button"
                onClick={handleFetchCurrentPrice}
                disabled={!formData.ticker || fetchingPrice}
                className="absolute right-2 top-1/2 transform -translate-y-1/2 p-2 text-gray-400 hover:text-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Fetch current price"
              >
                <RefreshCw className={`w-4 h-4 ${fetchingPrice ? 'animate-spin' : ''}`} />
              </button>
            </div>
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

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Valuation Metric
            </label>
            <select
              value={formData.valuationMetric}
              onChange={(e) => handleInputChange('valuationMetric', e.target.value)}
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
              placeholder="e.g., 25"
              step="0.1"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Base Metric Per Share ({new Date().getFullYear()})
            </label>
            <input
              type="number"
              value={formData.baseMetricPerShare || ''}
              onChange={(e) => handleInputChange('baseMetricPerShare', parseFloat(e.target.value))}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="e.g., 24.50"
              step="0.01"
              required
            />
          </div>
        </div>

        {/* Growth Rate Projections */}
        <div>
          <h3 className="text-lg font-semibold text-gray-800 mb-4">5-Year Growth Rate Projections (%)</h3>
          <div className="grid grid-cols-5 gap-4">
            {formData.growthRates.map((rate, index) => (
              <div key={index}>
                <label className="block text-sm text-gray-600 mb-1 text-center">
                  Year {index + 1}
                </label>
                <input
                  type="number"
                  value={rate}
                  onChange={(e) => handleGrowthRateChange(index, parseFloat(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-center"
                  step="0.1"
                />
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
}