import React, { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import StockInput from './StockInput';
import ValuationResults from './ValuationResults';
import { DCFInputs, DCFResults, ValidationWarning } from '../types';
import { calculateDCF } from '../utils/dcf';

interface DCFCalculatorProps {
  onSaveStock?: (stockData: any) => void;
}

export default function DCFCalculator({ onSaveStock }: DCFCalculatorProps) {
  const [results, setResults] = useState<DCFResults | null>(null);
  const [warnings, setWarnings] = useState<ValidationWarning[]>([]);
  const [dcfInputs, setDcfInputs] = useState<DCFInputs | null>(null);
  const [ticker, setTicker] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  const handleCalculate = async (inputs: DCFInputs) => {
    setLoading(true);
    setError('');
    setResults(null);
    setWarnings([]);
    
    try {
      setDcfInputs(inputs);
      setTicker(inputs.ticker);
      
      // Calculate DCF
      const { results: dcfResults, warnings: dcfWarnings } = calculateDCF(inputs);
      setResults(dcfResults);
      setWarnings(dcfWarnings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to calculate DCF');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <StockInput onCalculate={handleCalculate} loading={loading} />
      
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
            <div>
              <h4 className="font-medium text-red-800">Error</h4>
              <p className="text-sm text-red-700 mt-1">{error}</p>
            </div>
          </div>
        </div>
      )}
      
      {results && dcfInputs && (
        <ValuationResults
          results={results}
          warnings={warnings}
          ticker={ticker}
          dcfInputs={dcfInputs}
          onSaveStock={onSaveStock}
        />
      )}
    </div>
  );
}