import { DCFInputs, DCFResults, ValidationWarning } from '../types';

export function calculateDCF(inputs: DCFInputs, currentPrice: number): {
  results: DCFResults[];
  warnings: ValidationWarning[];
} {
  const warnings: ValidationWarning[] = [];
  const results: DCFResults[] = [];
  
  // Validation warnings
  const avgGrowthBull = inputs.growthRates.bull.reduce((a, b) => a + b, 0) / 5;
  const avgGrowthBase = inputs.growthRates.base.reduce((a, b) => a + b, 0) / 5;
  
  if (avgGrowthBull > 25) {
    warnings.push({
      type: 'growth',
      message: 'Bull case growth rate seems unrealistic (>25% avg)'
    });
  }
  
  if (inputs.valuationMultiple > 50) {
    warnings.push({
      type: 'multiple',
      message: 'Valuation multiple seems very high (>50x)'
    });
  }
  
  if (inputs.desiredReturn < 5) {
    warnings.push({
      type: 'return',
      message: 'Desired return rate seems low (<5%)'
    });
  }
  
  // Calculate for each scenario
  const scenarios: Array<'bull' | 'base' | 'bear'> = ['bull', 'base', 'bear'];
  
  scenarios.forEach(scenario => {
    const growthRates = inputs.growthRates[scenario];
    const projectedValues: number[] = [];
    
    // Project metric values for 5 years
    let currentValue = inputs.baseMetricValue;
    for (let year = 0; year < 5; year++) {
      currentValue = currentValue * (1 + growthRates[year] / 100);
      projectedValues.push(currentValue);
    }
    
    // Terminal value = final year metric * valuation multiple
    const terminalValue = projectedValues[4] * inputs.valuationMultiple;
    
    // Calculate present value (discount back to today)
    const discountRate = inputs.desiredReturn / 100;
    let presentValue = 0;
    
    // Discount projected cash flows
    for (let year = 1; year <= 5; year++) {
      const yearValue = year < 5 ? projectedValues[year - 1] * 0.1 : terminalValue; // Assume 10% of metric as cash flow, terminal value in year 5
      presentValue += yearValue / Math.pow(1 + discountRate, year);
    }
    
    const fairValue = presentValue;
    const expectedReturn = ((fairValue / currentPrice) - 1) * 100;
    const cagr = (Math.pow(fairValue / currentPrice, 1/5) - 1) * 100;
    
    results.push({
      scenario,
      projectedValues,
      terminalValue,
      presentValue,
      fairValue,
      expectedReturn,
      cagr
    });
  });
  
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