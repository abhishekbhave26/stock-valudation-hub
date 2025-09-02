export interface StockData {
  ticker: string;
  currentPrice: number;
  lastUpdated: Date;
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
  dcfInputs: DCFInputs;
  createdAt: Date;
  updatedAt: Date;
  notes?: string;
}

export interface PortfolioStock {
  id?: string;
  ticker: string;
  quantity: number;
  buyPrice: number;
  purchaseDate: Date;
  currentPrice?: number;
  totalValue?: number;
  totalReturn?: number;
  cagr?: number;
}

export interface ValidationWarning {
  type: 'growth' | 'multiple' | 'return';
  message: string;
}