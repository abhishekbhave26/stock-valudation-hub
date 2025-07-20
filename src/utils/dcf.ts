import { DCFInputs, DCFResults, ValidationWarning } from '../types';

export function calculateDCF(inputs: DCFInputs): {
  results: DCFResults;
  warnings: ValidationWarning[];
} {
  const warnings: ValidationWarning[] = [];
  
  // Validation warnings
  const avgGrowth = inputs.growthRates.reduce((a, b) => a + b, 0) / 5;
  
  if (avgGrowth > 100) {
    warnings.push({
      type: 'growth',
      message: 'Average growth rate seems very high (>100% avg)'
    });
  }
  
  if (inputs.valuationMultiple > 100) {
    warnings.push({
      type: 'multiple',
      message: 'Valuation multiple seems very high (>100x)'
    });
  }
  
  if (inputs.desiredReturn < 7) {
    warnings.push({
      type: 'return',
      message: 'Desired return rate seems low (<7%)'
    });
  }
  
  // Calculate DCF
  const growthRates = inputs.growthRates;
  const projectedValues: number[] = [];
  const projectedPrices: number[] = [];
  
  // Project metric values for 5 years
  let currentValue = inputs.baseMetricPerShare;
  
  for (let year = 0; year < 5; year++) {
    currentValue = currentValue * (1 + growthRates[year] / 100);
    projectedValues.push(currentValue);
    
    // Calculate projected stock price = metric per share * valuation multiple
    const projectedPrice = currentValue * inputs.valuationMultiple;
    projectedPrices.push(projectedPrice);
  }
  
  // Terminal value per share = final year metric per share * valuation multiple
  const terminalValuePerShare = projectedValues[4] * inputs.valuationMultiple;
  
  // Calculate present value (discount back to today)
  const discountRate = inputs.desiredReturn / 100;
  let presentValuePerShare = 0;
  
  // Discount projected values (assuming 10% of metric converts to cash flow per share)
  for (let year = 1; year <= 5; year++) {
    const yearValue = year < 5 ? projectedValues[year - 1] * 0.1 : terminalValuePerShare;
    presentValuePerShare += yearValue / Math.pow(1 + discountRate, year);
  }
  
  const fairValue = presentValuePerShare;
  
  // Total Return: from current price to terminal value
  const totalReturn = ((terminalValuePerShare - inputs.currentPrice) / inputs.currentPrice) * 100;
  
  // CAGR: compound annual growth rate from current price to terminal value
  const cagr = (Math.pow(terminalValuePerShare / inputs.currentPrice, 1/5) - 1) * 100;
  
  // Calculate buy target price to achieve desired return (using fair value, not terminal value)
  const buyTargetPrice = terminalValuePerShare / Math.pow(1 + discountRate, 5);
  
  // Calculate target prices for different time periods
  const targetPrice1Y = projectedPrices[0]; // Year 1 projected price
  const targetPrice3Y = projectedPrices[2]; // Year 3 projected price  
  const targetPrice5Y = projectedPrices[4]; // Year 5 projected price
  
  const results: DCFResults = {
    projectedValues,
    projectedPrices,
    terminalValue: terminalValuePerShare,
    presentValue: presentValuePerShare,
    fairValue,
    totalReturn,
    cagr,
    buyTargetPrice,
    targetPrice1Y,
    targetPrice3Y,
    targetPrice5Y
  };
  
  return { results, warnings };
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2
  }).format(value);
}

export function formatPercentage(value: number): string {
  return `${value.toFixed(2)}%`;
}

export function getPerformanceColor(value: number, type: 'return' | 'cagr'): string {
  if (type === 'cagr') {
    if (value >= 15) return 'text-green-600';
    if (value >= 10) return 'text-yellow-600';
    return 'text-red-600';
  }
  
  if (value >= 50) return 'text-green-600';
  if (value >= 20) return 'text-yellow-600';
  return 'text-red-600';
}