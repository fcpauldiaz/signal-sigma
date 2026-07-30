import {
  SignalSigmaOpenOrder,
  Ticker,
  TradierQuote,
} from '../types';
import { resolveQuotePrice } from '../services/tradierApi';

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

export function buildOwnershipBySymbol(
  tickers: Ticker[]
): Map<string, OwnershipLookup> {
  const map = new Map<string, OwnershipLookup>();
  for (const ticker of tickers) {
    const symbol = ticker.symbol.toUpperCase();
    map.set(symbol, {
      ownershipPrice: ticker.ownershipPrice,
      strategy: ticker.customGroup || '—',
      orderPrice: ticker.lastPrice,
      lastPrice: ticker.lastPrice,
    });
  }
  return map;
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
      reason: 'no portfolio position / ownership price',
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
