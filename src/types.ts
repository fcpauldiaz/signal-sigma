export interface SignalSigmaAuthResponse {
  message?: string;
  data: {
    accessToken: string;
    refreshToken: string;
  };
}

export interface Ticker {
  id: string;
  portfolioId: string;
  strategyId: string | null;
  symbol: string;
  name: string;
  isin: string;
  lastChange: number;
  lastPrice: number;
  amount: number;
  targetAmount: number;
  percent: number;
  value: number;
  displayValue: number;
  percentInGroup: number;
  ownershipPrice: number;
  ownershipDate: string;
  daysHeld: string;
  realizedPl: number;
  realizedCagr: number;
  priceTarget: number;
  priceTargetDate: string;
  percentToTarget: number;
  daysToTarget: string;
  cagrToTarget: number;
  stopLoss: number;
  systemClassification: string;
  systemBenchmark: string;
  customGroup: string;
  customGroupBenchmark: string;
  displayPercent: number;
  riskToTarget: number;
  percentToStop: number;
  riskToStop: number;
  percentTo20Dma: number;
  riskTo20Dma: number;
  percentTo50Dma: number;
  riskTo50Dma: number;
  percentTo100Dma: number;
  riskTo100Dma: number;
  percentTo200Dma: number;
  riskTo200Dma: number;
  mainCurrency: string;
  isEditable: boolean;
  isManual: boolean;
}

export interface Portfolio {
  id: string;
  title: string;
  isOwner: boolean;
  isAmountsFractional: boolean;
  displayCurrency: string;
  cashHoldings: string[];
  windowsOption: string;
  showIndicator: boolean;
  emailAlertSubscription: boolean;
  tickers: Ticker[];
}

export interface PortfolioResponse {
  portfolios: Portfolio[];
}

export interface PortfolioApiEnvelope {
  message?: string;
  data?: PortfolioResponse;
  portfolios?: Portfolio[];
}

export interface TradierOrderRequest {
  class: 'equity';
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  type: 'market';
  duration: 'day';
  tag?: string;
}

export interface TradierOrderResponse {
  order?: {
    id: number;
    status: string;
    partner_id?: string;
  };
  errors?: {
    error: string;
  };
}

export type SignalSigmaOrderDirection = 'BUY' | 'SELL';
export type SignalSigmaOrderStatus = 'PENDING' | 'EXECUTED' | string;

export interface SignalSigmaOpenOrder {
  id: string;
  userId: string;
  portfolioId: string;
  symbol: string;
  amount: number;
  actualAmount: number;
  date: string;
  price: number;
  value: number;
  percent: number;
  mainCurrency: string;
  direction: SignalSigmaOrderDirection;
  status: SignalSigmaOrderStatus;
  name: string;
  isin: string;
}

export interface OpenOrdersResponse {
  orders: SignalSigmaOpenOrder[];
}

export interface OpenOrdersApiEnvelope {
  message?: string;
  data?: OpenOrdersResponse;
  orders?: SignalSigmaOpenOrder[];
}

export interface TradierQuote {
  symbol: string;
  last: number | null;
  bid: number | null;
  ask: number | null;
}

export interface TradierPosition {
  symbol: string;
  quantity: number;
  costBasis: number;
  dateAcquired: string | null;
}

export interface TradierClosedPosition {
  symbol: string;
  quantity: number;
  cost: number;
  proceeds: number;
  gainLoss: number;
  gainLossPercent: number;
  openDate: string;
  closeDate: string;
  term: number;
}

export interface TradierBalances {
  totalEquity: number | null;
  totalCash: number | null;
  marketValue: number | null;
  openPl: number | null;
  closePl: number | null;
  pendingOrdersCount: number | null;
}

export interface PlaceableOrder {
  signalSigmaOrderId: string;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  signalPrice: number;
}

