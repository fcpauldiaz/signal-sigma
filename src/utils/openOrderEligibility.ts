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
    }
  | {
      place: false;
      reason: string;
      ownershipPrice: number | null;
      strategy: string | null;
      marketPrice: number | null;
    };

const DEFAULT_STRATEGY_IDS = [
  'f835ece6-e41a-4d8a-ac3f-c5468088149a', // Millennium Alpha
  '5e3f1ff3-5bdb-4bcf-8baf-e69652056e3d', // Momentum
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
    if (!group || group.toLowerCase() === 'cash') {
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
  ownershipBySymbol: Map<string, OwnershipLookup>
): OrderDecision {
  const quantity = Math.trunc(order.amount);
  if (quantity <= 0) {
    return {
      place: false,
      reason: 'quantity is zero',
      ownershipPrice: null,
      strategy: null,
      marketPrice: null,
    };
  }

  if (order.direction === 'SELL') {
    const position = ownershipBySymbol.get(order.symbol.toUpperCase());
    return {
      place: true,
      ownershipPrice: position?.ownershipPrice ?? order.price,
      strategy: position?.strategy ?? '—',
      marketPrice: null,
    };
  }

  if (order.direction !== 'BUY') {
    return {
      place: false,
      reason: `unsupported direction ${order.direction}`,
      ownershipPrice: null,
      strategy: null,
      marketPrice: null,
    };
  }

  const position = ownershipBySymbol.get(order.symbol.toUpperCase());
  if (!position) {
    return {
      place: false,
      reason: 'no strategy ownership price',
      ownershipPrice: null,
      strategy: null,
      marketPrice: null,
    };
  }

  if (!(position.ownershipPrice > 0)) {
    return {
      place: false,
      reason: `invalid ownership price ${position.ownershipPrice}`,
      ownershipPrice: position.ownershipPrice,
      strategy: position.strategy,
      marketPrice: null,
    };
  }

  const marketPrice = resolveQuotePrice(quotes.get(order.symbol.toUpperCase()));
  if (marketPrice === null) {
    return {
      place: false,
      reason: 'no Tradier quote available',
      ownershipPrice: position.ownershipPrice,
      strategy: position.strategy,
      marketPrice: null,
    };
  }

  if (marketPrice > position.ownershipPrice) {
    return {
      place: false,
      reason: `market ${marketPrice} > ownership ${position.ownershipPrice} (${position.strategy})`,
      ownershipPrice: position.ownershipPrice,
      strategy: position.strategy,
      marketPrice,
    };
  }

  return {
    place: true,
    ownershipPrice: position.ownershipPrice,
    strategy: position.strategy,
    marketPrice,
  };
}
