export interface DCFInputs {
  currentPrice: number;
  revenue: number;
  revenueGrowthRate: number;
  netMargin: number;
  terminalGrowthRate: number;
  discountRate: number;
  sharesOutstanding: number;
  desiredReturn: number;
}

export interface DCFResults {
  fairValue: number;
  projectedValues: number[];
  projectedPrices: number[];
  terminalValue: number;
  totalReturn: number;
  cagr: number;
  buyTargetPrice: number;
}

export function calculateDCF(inputs: DCFInputs): DCFResults {
  const {
    currentPrice,
    revenue,
    revenueGrowthRate,
    netMargin,
    terminalGrowthRate,
    discountRate,
    sharesOutstanding,
    desiredReturn
  } = inputs;

  const projectedValues: number[] = [];
  const projectedPrices: number[] = [];
  
  // Calculate projected cash flows for 5 years
  for (let year = 1; year <= 5; year++) {
    const projectedRevenue = revenue * Math.pow(1 + revenueGrowthRate / 100, year);
    const projectedEarnings = projectedRevenue * (netMargin / 100);
    const projectedPrice = projectedEarnings / sharesOutstanding;
    
    projectedValues.push(projectedEarnings);
    projectedPrices.push(projectedPrice);
  }

  // Terminal value calculation
  const terminalEarnings = projectedValues[4] * (1 + terminalGrowthRate / 100);
  const terminalValue = terminalEarnings / (discountRate / 100 - terminalGrowthRate / 100);
  const terminalPrice = terminalValue / sharesOutstanding;

  // Present value calculation
  let presentValue = 0;
  for (let year = 1; year <= 5; year++) {
    presentValue += projectedValues[year - 1] / Math.pow(1 + discountRate / 100, year);
  }
  
  const presentValueOfTerminal = terminalValue / Math.pow(1 + discountRate / 100, 5);
  const totalPresentValue = presentValue + presentValueOfTerminal;
  const fairValue = totalPresentValue / sharesOutstanding;

  // Calculate Total Return (from current price to terminal price)
  const totalReturn = (terminalPrice - currentPrice) / currentPrice;
  
  // Calculate CAGR (from current price to terminal price over 5 years)
  const cagr = Math.pow(terminalPrice / currentPrice, 1/5) - 1;
  
  // Calculate Buy Target Price (price to pay today for desired return)
  const buyTargetPrice = terminalPrice / Math.pow(1 + desiredReturn / 100, 5);

  return {
    fairValue,
    projectedValues,
    projectedPrices,
    terminalValue: terminalPrice,
    totalReturn,
    cagr,
    buyTargetPrice
  };
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