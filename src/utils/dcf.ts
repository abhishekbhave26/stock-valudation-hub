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

  if (inputs.growthRates.some(rate => rate > 5000)) {
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

  // Same checks for bear/bull cases when they are fully entered
  (['bear', 'bull'] as const).forEach(name => {
    const scenario = getValidScenario(name === 'bear' ? inputs.bearCase : inputs.bullCase);
    if (!scenario) return;
    const label = name === 'bear' ? 'Bear case' : 'Bull case';
    if (scenario.growthRates.some(rate => rate > 5000)) {
      warnings.push({
        type: 'growth',
        message: `${label} growth rates above 50% may be unsustainable long-term`
      });
    }
    if (scenario.valuationMultiple > 80) {
      warnings.push({
        type: 'multiple',
        message: `${label} valuation multiple above 80x may indicate overvaluation`
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