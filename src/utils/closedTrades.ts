import { TradierClosedPosition } from '../types';

export type ClosedTradeTotals = {
  realizedPl: number;
  realizedYtd: number;
  tradeCount: number;
  winners: number;
  losers: number;
  winRate: number;
};

export type ClosedTradeMonth = {
  month: string;
  gainLoss: number;
};

export type ClosedTradeCumulativePoint = {
  date: string;
  cumulative: number;
  gainLoss: number;
  symbol: string;
  quantity: number;
  cost: number;
  proceeds: number;
  gainLossPercent: number;
  openDate: string;
  closeDate: string;
};

export type AggregatedClosedTrades = {
  totals: ClosedTradeTotals;
  monthly: ClosedTradeMonth[];
  cumulativeSeries: ClosedTradeCumulativePoint[];
  recentClosed: TradierClosedPosition[];
};

export function aggregateClosedTrades(
  closed: TradierClosedPosition[],
  recentLimit: number
): AggregatedClosedTrades {
  const sorted = closed
    .slice()
    .sort((a, b) => a.closeDate.localeCompare(b.closeDate));

  const monthlyMap = new Map<string, number>();
  let cumulative = 0;
  const cumulativeSeries: ClosedTradeCumulativePoint[] = [];

  for (const trade of sorted) {
    const month = trade.closeDate.slice(0, 7);
    monthlyMap.set(month, (monthlyMap.get(month) || 0) + trade.gainLoss);
    cumulative += trade.gainLoss;
    cumulativeSeries.push({
      date: trade.closeDate.slice(0, 10),
      cumulative,
      gainLoss: trade.gainLoss,
      symbol: trade.symbol,
      quantity: trade.quantity,
      cost: trade.cost,
      proceeds: trade.proceeds,
      gainLossPercent: trade.gainLossPercent,
      openDate: trade.openDate,
      closeDate: trade.closeDate,
    });
  }

  const monthly = [...monthlyMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, gainLoss]) => ({ month, gainLoss }));

  const winners = sorted.filter((t) => t.gainLoss > 0).length;
  const losers = sorted.filter((t) => t.gainLoss < 0).length;
  const year = calendarYearEt();
  const realizedYtd = sorted.reduce(
    (sum, trade) =>
      closeYear(trade.closeDate) === year ? sum + trade.gainLoss : sum,
    0
  );

  return {
    totals: {
      realizedPl: cumulative,
      realizedYtd,
      tradeCount: sorted.length,
      winners,
      losers,
      winRate: sorted.length ? winners / sorted.length : 0,
    },
    monthly,
    cumulativeSeries,
    recentClosed: sorted.slice().reverse().slice(0, recentLimit),
  };
}

export function calendarYearEt(now = new Date()): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
  }).format(now);
}

export function closeYear(closeDate: string): string {
  return closeDate.slice(0, 4);
}
