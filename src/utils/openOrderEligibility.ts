import {
  SignalSigmaOpenOrder,
  Ticker,
  TradierQuote,
} from '../types';
import { resolveQuotePrice } from '../services/tradierApi';
import type { StrategyPositionBook } from '../services/signalSigmaApi';

export type OwnershipLookup = {
  ownershipPrice: number;
  strategy: string;
  orderPrice: number;
  lastPrice: number;
};

export type OrderDecision =
  | {
      place: true;
      ownershipPrice: number;
      strategy: string;
      marketPrice: number | null;
      quantity: number;
    }
  | {
      place: false;
      reason: string;
      ownershipPrice: number | null;
      strategy: string | null;
      marketPrice: number | null;
      quantity: number;
    };

const DEFAULT_STRATEGY_IDS = [
  'f835ece6-e41a-4d8a-ac3f-c5468088149a', // Millennium Alpha
  '5e3f1ff3-5bdb-4bcf-8baf-e69652056e3d', // Momentum
  'efd217dd-da21-48fd-8442-d5abe3664c08', // Vision
];

export function getConfiguredStrategyIds(): string[] {
  const raw = process.env.SIGNAL_SIGMA_STRATEGY_IDS?.trim();
  if (!raw) {
    return DEFAULT_STRATEGY_IDS;
  }
  return raw
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

/** Signal Sigma encodes SELL size as a negative amount. */
export function orderQuantity(order: SignalSigmaOpenOrder): number {
  return Math.abs(Math.trunc(order.amount));
}

export function isCashBookRow(input: {
  symbol: string;
  systemClassification?: string | null;
  customGroup?: string | null;
  strategy?: string | null;
}): boolean {
  if (input.systemClassification?.trim().toLowerCase() === 'cash') {
    return true;
  }
  const group = (input.customGroup || input.strategy || '')
    .trim()
    .toLowerCase();
  if (group === 'cash') {
    return true;
  }
  const symbol = input.symbol.trim().toUpperCase();
  return symbol.startsWith('TOTAL ');
}

export function cashRowsLast<T extends Parameters<typeof isCashBookRow>[0]>(
  rows: T[]
): T[] {
  const holdings: T[] = [];
  const cash: T[] = [];
  for (const row of rows) {
    if (isCashBookRow(row)) {
      cash.push(row);
    } else {
      holdings.push(row);
    }
  }
  return [...holdings, ...cash];
}

export function buildOwnershipBySymbol(
  portfolioTickers: Ticker[],
  strategyBooks: StrategyPositionBook[]
): Map<string, OwnershipLookup> {
  const map = new Map<string, OwnershipLookup>();

  const strategyByTitle = new Map<string, StrategyPositionBook>();
  for (const book of strategyBooks) {
    strategyByTitle.set(normalizeStrategyName(book.title), book);
  }

  for (const ticker of portfolioTickers) {
    const symbol = ticker.symbol.toUpperCase();
    const group = ticker.customGroup?.trim() || '';
    if (!group || isCashBookRow(ticker)) {
      continue;
    }

    const book =
      strategyByTitle.get(normalizeStrategyName(group)) ||
      findBookContainingSymbol(strategyBooks, symbol);

    const strategyTicker = book?.tickers.find(
      (t) => t.symbol.toUpperCase() === symbol
    );

    if (!strategyTicker || !(strategyTicker.ownershipPrice > 0)) {
      continue;
    }

    map.set(symbol, {
      ownershipPrice: strategyTicker.ownershipPrice,
      strategy: book?.title || group,
      orderPrice: ticker.lastPrice,
      lastPrice: strategyTicker.lastPrice,
    });
  }

  // Cover symbols present in strategies but missing/unmatched on the portfolio row.
  for (const book of strategyBooks) {
    for (const strategyTicker of book.tickers) {
      const symbol = strategyTicker.symbol.toUpperCase();
      if (map.has(symbol) || !(strategyTicker.ownershipPrice > 0)) {
        continue;
      }
      map.set(symbol, {
        ownershipPrice: strategyTicker.ownershipPrice,
        strategy: book.title,
        orderPrice: strategyTicker.lastPrice,
        lastPrice: strategyTicker.lastPrice,
      });
    }
  }

  return map;
}

/**
 * Strategy labels for display / SELL enrichment — includes portfolio groups and
 * strategy books even when ownership price is unavailable (common on exits).
 */
export function buildStrategyLabelBySymbol(
  portfolioTickers: Ticker[],
  strategyBooks: StrategyPositionBook[]
): Map<string, string> {
  const map = new Map<string, string>();

  for (const book of strategyBooks) {
    for (const ticker of book.tickers) {
      map.set(ticker.symbol.toUpperCase(), book.title);
    }
  }

  for (const ticker of portfolioTickers) {
    const symbol = ticker.symbol.toUpperCase();
    if (map.has(symbol)) {
      continue;
    }
    const group = ticker.customGroup?.trim();
    if (group && group.toLowerCase() !== 'cash') {
      map.set(symbol, group);
    }
  }

  return map;
}

function normalizeStrategyName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function findBookContainingSymbol(
  books: StrategyPositionBook[],
  symbol: string
): StrategyPositionBook | undefined {
  return books.find((book) =>
    book.tickers.some((t) => t.symbol.toUpperCase() === symbol)
  );
}

export function evaluateOpenOrder(
  order: SignalSigmaOpenOrder,
  quotes: Map<string, TradierQuote>,
  ownershipBySymbol: Map<string, OwnershipLookup>,
  strategyLabelBySymbol: Map<string, string> = new Map()
): OrderDecision {
  const quantity = orderQuantity(order);
  const symbol = order.symbol.toUpperCase();
  const position = ownershipBySymbol.get(symbol);
  const strategyLabel =
    position?.strategy || strategyLabelBySymbol.get(symbol) || null;

  if (quantity <= 0) {
    return {
      place: false,
      reason: 'quantity is zero',
      ownershipPrice: null,
      strategy: strategyLabel,
      marketPrice: null,
      quantity,
    };
  }

  if (order.direction === 'SELL') {
    const ownershipPrice =
      position?.ownershipPrice && position.ownershipPrice > 0
        ? position.ownershipPrice
        : order.price > 0
          ? order.price
          : null;

    return {
      place: true,
      ownershipPrice: ownershipPrice ?? order.price,
      strategy: strategyLabel || '—',
      marketPrice: null,
      quantity,
    };
  }

  if (order.direction !== 'BUY') {
    return {
      place: false,
      reason: `unsupported direction ${order.direction}`,
      ownershipPrice: null,
      strategy: strategyLabel,
      marketPrice: null,
      quantity,
    };
  }

  if (!position) {
    return {
      place: false,
      reason: 'no strategy ownership price',
      ownershipPrice: null,
      strategy: strategyLabel,
      marketPrice: null,
      quantity,
    };
  }

  if (!(position.ownershipPrice > 0)) {
    return {
      place: false,
      reason: `invalid ownership price ${position.ownershipPrice}`,
      ownershipPrice: position.ownershipPrice,
      strategy: position.strategy,
      marketPrice: null,
      quantity,
    };
  }

  const marketPrice = resolveQuotePrice(quotes.get(symbol));
  if (marketPrice === null) {
    return {
      place: false,
      reason: 'no Tradier quote available',
      ownershipPrice: position.ownershipPrice,
      strategy: position.strategy,
      marketPrice: null,
      quantity,
    };
  }

  if (marketPrice > position.ownershipPrice) {
    return {
      place: false,
      reason: `market ${marketPrice} > ownership ${position.ownershipPrice} (${position.strategy})`,
      ownershipPrice: position.ownershipPrice,
      strategy: position.strategy,
      marketPrice,
      quantity,
    };
  }

  return {
    place: true,
    ownershipPrice: position.ownershipPrice,
    strategy: position.strategy,
    marketPrice,
    quantity,
  };
}
