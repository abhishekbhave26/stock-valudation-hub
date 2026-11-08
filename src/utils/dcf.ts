import { DCFInputs, DCFResults, DCFScenarioInputs, DCFScenarioName, ValidationWarning } from '../types';

/** A scenario counts as set only when all five growth rates and the
 *  multiple are finite numbers. Anything partial (e.g. a multiple typed
 *  but no growth rates yet) is unset — never completed from base-case
 *  values, so no bear/bull number is ever invented. */
export function getValidScenario(scenario: DCFScenarioInputs | undefined | null): DCFScenarioInputs | null {
  if (!scenario) return null;
  if (!Array.isArray(scenario.growthRates) || scenario.growthRates.length !== 5) return null;
  if (!scenario.growthRates.every(rate => typeof rate === 'number' && Number.isFinite(rate))) return null;
  if (typeof scenario.valuationMultiple !== 'number' || !Number.isFinite(scenario.valuationMultiple)) return null;
  return scenario;
}

/** Drop incomplete scenarios from inputs before saving, so partial
 *  (NaN / half-filled) bear/bull data never reaches the database. */
export function normalizeScenarioInputs<T extends DCFInputs>(inputs: T): T {
  const bearCase = getValidScenario(inputs.bearCase);
  const bullCase = getValidScenario(inputs.bullCase);
  const clean: T = { ...inputs };
  if (bearCase) clean.bearCase = bearCase; else delete clean.bearCase;
  if (bullCase) clean.bullCase = bullCase; else delete clean.bullCase;
  return clean;
}

interface ScenarioMathInputs {
  baseMetricPerShare: number;
  growthRates: number[];
  valuationMultiple: number;
  currentPrice: number;
  desiredReturn: number;
}

// Shared DCF math for one case (base, bear or bull): compound the base
// metric by the case's growth rates, apply the case's multiple.
function computeResults(inputs: ScenarioMathInputs): DCFResults {
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

  return {
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
}

/** Results for one named case. Base always computes; bear/bull return
 *  null when the case is not fully entered. */
export function getScenarioResults(inputs: DCFInputs, scenario: DCFScenarioName): DCFResults | null {
  if (scenario === 'base') {
    return computeResults({
      baseMetricPerShare: inputs.baseMetricPerShare,
      growthRates: inputs.growthRates,
      valuationMultiple: inputs.valuationMultiple,
      currentPrice: inputs.currentPrice,
      desiredReturn: inputs.desiredReturn
    });
  }
  const valid = getValidScenario(scenario === 'bear' ? inputs.bearCase : inputs.bullCase);
  if (!valid) return null;
  return computeResults({
    baseMetricPerShare: inputs.baseMetricPerShare,
    growthRates: valid.growthRates,
    valuationMultiple: valid.valuationMultiple,
    currentPrice: inputs.currentPrice,
    desiredReturn: inputs.desiredReturn
  });
}

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

  // Same checks for bear/bull cases when they are fully entered
  (['bear', 'bull'] as const).forEach(name => {
    const scenario = getValidScenario(name === 'bear' ? inputs.bearCase : inputs.bullCase);
    if (!scenario) return;
    const label = name === 'bear' ? 'Bear case' : 'Bull case';
    if (scenario.growthRates.some(rate => rate > 50)) {
      warnings.push({
        type: 'growth',
        message: `${label} growth rates above 50% may be unsustainable long-term`
      });
    }
    if (scenario.valuationMultiple > multipleLimit) {
      warnings.push({
        type: 'multiple',
        message: `${label} ${inputs.valuationMetric} multiple above ${multipleLimit}x is unusually high for a projected value — please double-check`
      });
    }
  });

  const results = computeResults({
    baseMetricPerShare: inputs.baseMetricPerShare,
    growthRates: inputs.growthRates,
    valuationMultiple: inputs.valuationMultiple,
    currentPrice: inputs.currentPrice,
    desiredReturn: inputs.desiredReturn
  });

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

export type ValuationStatus = 'strong-buy' | 'buy' | 'hold' | 'overvalued';

// Valuation status for an arbitrary price against a stock's fair value.
// Same thresholds as the watchlist (StockWatchlist.tsx getValuationStatus):
//   price <= 0.8x fair value -> Strong Buy
//   price <= fair value      -> Buy
//   price <= 1.2x fair value -> Hold
//   otherwise                -> Overvalued
// Shared so the scenario simulator grades simulated prices exactly like
// the watchlist grades current prices.
export function getValuationStatusForPrice(
  price: number,
  fairValue: number
): { status: ValuationStatus; color: string; text: string } {
  if (!fairValue || fairValue <= 0 || !price || price <= 0) {
    return { status: 'hold', color: 'bg-gray-400', text: 'No fair value' };
  }
  if (price <= fairValue * 0.8) return { status: 'strong-buy', color: 'bg-green-600', text: 'Strong Buy' };
  if (price <= fairValue) return { status: 'buy', color: 'bg-green-500', text: 'Buy' };
  if (price <= fairValue * 1.2) return { status: 'hold', color: 'bg-yellow-500', text: 'Hold' };
  return { status: 'overvalued', color: 'bg-red-600', text: 'Overvalued' };
}