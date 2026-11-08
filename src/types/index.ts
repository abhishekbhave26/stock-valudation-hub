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
  /** One primary category for the stock (e.g. "Big Tech", "AI Semiconductors").
   *  Free text with suggestions; stored in the saved row's dcf_inputs JSONB. */
  category?: string;
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
  /** One primary category for the stock, read from dcf_inputs.category.
   *  Empty string when the stock has no category yet. */
  category?: string;
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
