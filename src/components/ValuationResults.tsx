import React from 'react';
import { TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react';
import { DCFResults, ValidationWarning } from '../types';
import { formatCurrency, formatPercentage, getPerformanceColor } from '../utils/dcf';

interface ValuationResultsProps {
  results: DCFResults[];
  warnings: ValidationWarning[];
  currentPrice: number;
  ticker: string;
}

export default function ValuationResults({ results, warnings, currentPrice, ticker }: ValuationResultsProps) {
  const getScenarioColor = (scenario: string) => {
    switch (scenario) {
      case 'bull': return 'border-green-500 bg-green-50';
      case 'base': return 'border-blue-500 bg-blue-50';
      case 'bear': return 'border-red-500 bg-red-50';
      default: return 'border-gray-300 bg-gray-50';
    }
  };

  const getScenarioIcon = (scenario: string) => {
    switch (scenario) {
      case 'bull': return <TrendingUp className="w-5 h-5 text-green-600" />;
      case 'base': return <div className="w-5 h-5 bg-blue-600 rounded-full" />;
      case 'bear': return <TrendingDown className="w-5 h-5 text-red-600" />;
      default: return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Current Price Display */}
      <div className="bg-white rounded-xl shadow-lg p-6">
        <div className="text-center">
          <h3 className="text-2xl font-bold text-gray-800 mb-2">{ticker}</h3>
          <div className="text-3xl font-bold text-blue-600 mb-1">
            {formatCurrency(currentPrice)}
          </div>
          <p className="text-sm text-gray-500">Current Price</p>
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

      {/* Scenario Results */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {results.map((result) => (
          <div
            key={result.scenario}
            className={`bg-white rounded-xl shadow-lg border-2 ${getScenarioColor(result.scenario)} p-6`}
          >
            <div className="flex items-center gap-3 mb-4">
              {getScenarioIcon(result.scenario)}
              <h3 className="text-lg font-semibold text-gray-800 capitalize">
                {result.scenario} Case
              </h3>
            </div>

            <div className="space-y-4">
              <div className="text-center p-4 bg-white rounded-lg border border-gray-200">
                <div className="text-2xl font-bold text-gray-800 mb-1">
                  {formatCurrency(result.fairValue)}
                </div>
                <p className="text-sm text-gray-500">Fair Value</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="text-center">
                  <div className={`text-lg font-bold ${getPerformanceColor(result.expectedReturn, 'return')}`}>
                    {formatPercentage(result.expectedReturn)}
                  </div>
                  <p className="text-xs text-gray-500">Expected Return</p>
                </div>
                <div className="text-center">
                  <div className={`text-lg font-bold ${getPerformanceColor(result.cagr, 'cagr')}`}>
                    {formatPercentage(result.cagr)}
                  </div>
                  <p className="text-xs text-gray-500">CAGR</p>
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="text-sm font-medium text-gray-700">5-Year Projections</h4>
                <div className="grid grid-cols-5 gap-1">
                  {result.projectedValues.map((value, index) => (
                    <div key={index} className="text-center">
                      <div className="text-xs font-medium text-gray-800">
                        ${(value / 1000).toFixed(0)}B
                      </div>
                      <div className="text-xs text-gray-500">Y{index + 1}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-2 border-t border-gray-200">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Terminal Value:</span>
                  <span className="font-medium">{formatCurrency(result.terminalValue)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Present Value:</span>
                  <span className="font-medium">{formatCurrency(result.presentValue)}</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}