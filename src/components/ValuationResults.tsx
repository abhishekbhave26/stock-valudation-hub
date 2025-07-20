import React from 'react';
import { TrendingUp, TrendingDown, AlertTriangle, Plus } from 'lucide-react';
import { DCFResults, ValidationWarning, DCFInputs } from '../types';
import { formatCurrency, formatPercentage, getPerformanceColor } from '../utils/dcf';

interface ValuationResultsProps {
  results: DCFResults;
  warnings: ValidationWarning[];
  ticker: string;
  dcfInputs: DCFInputs;
  onSaveStock?: (stockData: any) => void;
}

export default function ValuationResults({ results, warnings, ticker, dcfInputs, onSaveStock }: ValuationResultsProps) {
  const handleSaveStock = () => {
    if (!onSaveStock) return;
    
    const stockData = {
      ticker,
      currentPrice: dcfInputs.currentPrice,
      fairValue: results.fairValue,
      expectedReturn: results.expectedReturn,
      cagr: results.cagr,
      buyTarget: results.fairValue * 0.8, // 20% margin of safety
      dcfInputs
    };
    
    onSaveStock(stockData);
  };
  return (
    <div className="space-y-6">
      {/* Current Price Display */}
      <div className="bg-white rounded-xl shadow-lg p-6">
        <div className="flex justify-between items-center">
          <div className="text-center flex-1">
            <h3 className="text-2xl font-bold text-gray-800 mb-2">{ticker}</h3>
            <div className="text-3xl font-bold text-blue-600 mb-1">
              {formatCurrency(dcfInputs.currentPrice)}
            </div>
            <p className="text-sm text-gray-500">Current Price</p>
          </div>
          {onSaveStock && (
            <button
              onClick={handleSaveStock}
              className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Save to Watchlist
            </button>
          )}
        </div>
      </div>

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5" />
            <div>
              <h4 className="font-medium text-amber-800 mb-2">Validation Warnings</h4>
              <ul className="space-y-1">
                {warnings.map((warning, index) => (
                  <li key={index} className="text-sm text-amber-700">
                    • {warning.message}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* DCF Results */}
      <div className="bg-white rounded-xl shadow-lg border-2 border-blue-500 bg-blue-50 p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-5 h-5 bg-blue-600 rounded-full" />
          <h3 className="text-xl font-semibold text-gray-800">DCF Valuation Results</h3>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <div className="text-center p-4 bg-white rounded-lg border border-gray-200">
            <div className="text-3xl font-bold text-blue-600 mb-1">
              {formatCurrency(results.fairValue)}
            </div>
            <p className="text-sm text-gray-500">Fair Value</p>
          </div>

          <div className="text-center p-4 bg-white rounded-lg border border-gray-200">
            <div className={`text-3xl font-bold ${getPerformanceColor(results.expectedReturn, 'return')}`}>
              {formatPercentage(results.expectedReturn)}
            </div>
            <p className="text-sm text-gray-500">Expected Return</p>
          </div>

          <div className="text-center p-4 bg-white rounded-lg border border-gray-200">
            <div className={`text-3xl font-bold ${getPerformanceColor(results.cagr, 'cagr')}`}>
              {formatPercentage(results.cagr)}
            </div>
            <p className="text-sm text-gray-500">CAGR</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-3">
            <h4 className="text-lg font-medium text-gray-700">5-Year Metric Projections</h4>
            <div className="grid grid-cols-5 gap-2">
              {results.projectedValues.map((value, index) => (
                <div key={index} className="text-center p-2 bg-white rounded border">
                  <div className="text-sm font-medium text-gray-800">
                    ${value.toFixed(2)}
                  </div>
                  <div className="text-xs text-gray-500">Y{index + 1}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="text-lg font-medium text-gray-700">5-Year Price Projections</h4>
            <div className="grid grid-cols-5 gap-2">
              {results.projectedPrices.map((price, index) => (
                <div key={index} className="text-center p-2 bg-white rounded border">
                  <div className="text-sm font-medium text-gray-800">
                    {formatCurrency(price)}
                  </div>
                  <div className="text-xs text-gray-500">Y{index + 1}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="pt-4 border-t border-gray-200 mt-6">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">Terminal Value:</span>
              <span className="font-medium">{formatCurrency(results.terminalValue)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Present Value:</span>
              <span className="font-medium">{formatCurrency(results.presentValue)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}