export interface StockData {
  ticker: string;
  currentPrice: number;
  lastUpdated: Date;
}

export interface DCFInputs {
  ticker: string;
  valuationMetric: 'P/S' | 'P/E' | 'P/FCF' | 'P/B' | 'EV/Sales' | 'EV/EBITDA';
  valuationMultiple: number;
  baseMetricValue: number;
  desiredReturn: number;
  growthRates: {
    bull: number[];
    base: number[];
    bear: number[];
  };
}

export interface DCFResults {
  scenario: 'bull' | 'base' | 'bear';
  projectedValues: number[];
  terminalValue: number;
  presentValue: number;
  fairValue: number;
  expectedReturn: number;
  cagr: number;
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