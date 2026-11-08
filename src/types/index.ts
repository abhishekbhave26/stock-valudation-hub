export interface StockData {
  ticker: string;
  currentPrice: number;
  lastUpdated: Date;
}

export type DCFScenarioName = 'bear' | 'base' | 'bull';

/** Bear/bull case inputs, mirroring the base case: per-year earnings
 *  growth rates (one per projection year) and a valuation multiple.
 *  A scenario is only "set" when ALL five growth rates and the multiple
 *  are finite numbers — anything partial is treated as unset, never
 *  filled in from the base case. */
export interface DCFScenarioInputs {
  growthRates: number[];
  valuationMultiple: number;
}

export interface DCFInputs {
  ticker: string;
  currentPrice: number;
  valuationMetric: 'P/S' | 'P/E' | 'P/FCF' | 'P/B' | 'P/OCF' | 'EV/Sales' | 'EV/EBITDA';
  valuationMultiple: number;
  baseMetricPerShare: number;
  desiredReturn: number;
  growthRates: number[];
  projectedPrices?: number[];
  bearCase?: DCFScenarioInputs;
  bullCase?: DCFScenarioInputs;
  notes?: string;
  investorRelationsLink?: string;
  /** Categories for the stock (e.g. "Big Tech", "AI Semiconductors").
   *  A stock can have several. Picked in the form's multi-select, with a
   *  "create new" input; stored as an array in the saved row's dcf_inputs
   *  JSONB. Older rows hold a single string — read through
   *  normalizeStringList, which turns it into a one-element array. */
  category?: string[];
  /** Regions for the stock (e.g. "United States", "Europe", "Global").
   *  Parallel to category: multi-select in the form, stored as an array in
   *  dcf_inputs JSONB. "Global" is exclusive — a stock with Global has no
   *  other region. Blank until set — unlike category, a missing region is
   *  never flagged in the watchlist. */
  region?: string[];
}

export interface DCFResults {
  projectedValues: number[];
  projectedPrices: number[];
  terminalValue: number;
  presentValue: number;
  fairValue: number;
  totalReturn: number;
  cagr: number;
  buyTargetPrice: number;
  targetPrice1Y: number;
  targetPrice3Y: number;
  targetPrice5Y: number;
}

export interface SavedStock {
  id?: string;
  ticker: string;
  currentPrice: number;
  fairValue: number;
  expectedReturn: number;
  cagr: number;
  buyTarget: number;
  dcf_inputs?: DCFInputs;
  dcfInputs?: DCFInputs;
  createdAt: Date;
  updatedAt: Date;
  notes?: string;
  isFavorite?: boolean;
  /** Categories for the stock, read from dcf_inputs.category and normalized
   *  to an array (a stored single string becomes one element; "N/A" and
   *  blanks become empty). Empty when the stock has no category yet. */
  categories: string[];
  /** Regions for the stock, read from dcf_inputs.region and normalized the
   *  same way. Empty when the stock has no region yet (existing stocks stay
   *  blank until set in the UI — regions are not seeded by migration). */
  regions: string[];
}

export interface PortfolioStock {
  id?: string;
  ticker: string;
  quantity: number;
  buyPrice?: number;
  purchaseDate: Date;
  buy_price?: number;
  currentPrice?: number;
  current_price?: number;
  totalValue?: number;
  totalReturn?: number;
  cagr?: number;
}

export interface ValidationWarning {
  type: 'growth' | 'multiple' | 'return';
  message: string;
}
