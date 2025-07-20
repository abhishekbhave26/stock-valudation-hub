import { DCFInputs, DCFResults, ValidationWarning } from '../types';

export function calculateDCF(inputs: DCFInputs): { results: DCFResults; warnings: ValidationWarning[] } {
  const warnings: ValidationWarning[] = [];
  
  // Validate inputs and add warnings
  if (inputs.desiredReturn > 25) {
    warnings.push({
      type: 'return',
      message: 'Desired return above 25% may be unrealistic for most stocks'
    });
  }
  
  if (inputs.growthRates.some(rate => rate > 50)) {
    warnings.push({
      type: 'growth',
      message: 'Growth rates above 50% may be unsustainable long-term'
    });
  }
  
  if (inputs.valuationMultiple > 80) {
    warnings.push({
      type: 'multiple',
      message: 'Valuation multiple above 80x may indicate overvaluation'
    });
  }

  const projectedValues: number[] = [];
  const projectedPrices: number[] = [];
  
  // Calculate projected values and prices for 5 years
  let currentMetricValue = inputs.baseMetricPerShare;
  
  for (let year = 0; year < 5; year++) {
    const growthRate = inputs.growthRates[year] / 100;
    currentMetricValue = currentMetricValue * (1 + growthRate);
    const projectedPrice = currentMetricValue * inputs.valuationMultiple;
    
    projectedValues.push(currentMetricValue);
    projectedPrices.push(projectedPrice);
  }

  // Terminal value (Year 5 price)
  const terminalValue = projectedPrices[4];
  
  // Present value calculation using desired return as discount rate
  const discountRate = inputs.desiredReturn / 100;
  let presentValue = 0;
  
  for (let year = 1; year <= 5; year++) {
    presentValue += projectedPrices[year - 1] / Math.pow(1 + discountRate, year);
  }
  
  // Fair value is the present value of all future cash flows
  const fairValue = presentValue / 5; // Average present value
  
  // Calculate total return from current price to terminal value
  const totalReturn = (terminalValue - inputs.currentPrice) / inputs.currentPrice;
  
  // Calculate CAGR from current price to terminal value over 5 years
  const cagr = Math.pow(terminalValue / inputs.currentPrice, 1/5) - 1;
  
  // Calculate buy target price for desired return
  const buyTargetPrice = terminalValue / Math.pow(1 + discountRate, 5);

  const results: DCFResults = {
    projectedValues,
    projectedPrices,
    terminalValue,
    presentValue,
    fairValue,
    totalReturn,
    cagr,
    buyTargetPrice,
    targetPrice1Y: projectedPrices[0],
    targetPrice3Y: projectedPrices[2],
    targetPrice5Y: projectedPrices[4]
  };

  return { results, warnings };
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatPercentage(value: number): string {
  if (value === undefined || value === null || isNaN(value)) {
    return '0.00%';
  }
  return `${(value * 100).toFixed(2)}%`;
}

export function getPerformanceColor(value: number, type: 'return' | 'cagr'): string {
  if (value === undefined || value === null || isNaN(value)) {
    return 'text-gray-500';
  }
  
  const threshold = type === 'cagr' ? 0.15 : 0.20; // 15% for CAGR, 20% for returns
  
  if (value >= threshold) return 'text-green-600';
  if (value >= threshold * 0.5) return 'text-yellow-600';
  return 'text-red-600';
}