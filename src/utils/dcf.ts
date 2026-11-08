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

  // Growth rates are percentages (e.g. 15 = 15%). The old threshold here
  // was 5000 while the message said 50%, so this warning could never fire
  // on any realistic input. Fixed to 50 to match the message.
  if (inputs.growthRates.some(rate => rate > 50)) {
    warnings.push({
      type: 'growth',
      message: 'Growth rates above 50% may be unsustainable long-term'
    });
  }

  // The valuation multiple is applied to PROJECTED metric values, so it is
  // a forward multiple — and the right sanity bar depends on the metric.
  // A single 80x bar for every metric was wrong for that reason: the
  // richest legitimate forward P/E in the watchlist is PLTR ~100x and HIMS
  // ~86x (Oct 5, 2026 reference), so 80x flagged real inputs, while 80x
  // P/S (richest real: PLTR ~74x) or 80x EV/EBITDA (richest real: AXON
  // ~210x, itself distorted by depressed earnings) mean very different
  // things. Thresholds below sit just above the richest real value of each
  // metric in the watchlist, so genuine inputs never trip them but typos
  // (e.g. an extra zero) still do. P/B is left at 80x: no watchlist data
  // justifies a change, and 80x P/B only ever fires on absurd entries.
  const MULTIPLE_WARNING_LIMITS: Record<DCFInputs['valuationMetric'], number> = {
    'P/E': 150,
    'P/FCF': 150,
    'P/OCF': 150,
    'P/S': 100,
    'EV/Sales': 100,
    'EV/EBITDA': 250,
    'P/B': 80,
  };
  const multipleLimit = MULTIPLE_WARNING_LIMITS[inputs.valuationMetric] ?? 80;
  if (inputs.valuationMultiple > multipleLimit) {
    warnings.push({
      type: 'multiple',
      message: `${inputs.valuationMetric} multiple above ${multipleLimit}x is unusually high for a projected value — please double-check`
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