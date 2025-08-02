import React, { useState } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import StockInput from './StockInput';
import ValuationResults from './ValuationResults';
import { DCFInputs, DCFResults, ValidationWarning } from '../types';
import { calculateDCF } from '../utils/dcf';
import { stockPriceService } from '../services/stockPriceService';

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
  const [fetchingPrice, setFetchingPrice] = useState(false);

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

  const handleFetchCurrentPrice = async (ticker: string): Promise<number | null> => {
    if (!ticker) return null;
    
    setFetchingPrice(true);
    try {
      const priceData = await stockPriceService.getStockPrice(ticker);
      if (priceData) {
        return priceData.price;
      }
      return null;
    } catch (error) {
      console.error('Failed to fetch current price:', error);
      return null;
    } finally {
      setFetchingPrice(false);
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
          onFetchPrice={handleFetchCurrentPrice}
          fetchingPrice={fetchingPrice}
        />
      )}
    </div>
  );
}