import type { TradingMode } from './tradierConfig';
import type { SignalSigmaOpenOrder } from '../types';
import type { OrderDecision } from './openOrderEligibility';

export type OrderReadyOverride = 'auto' | 'force' | 'block';

const overrides = new Map<string, OrderReadyOverride>();

function overrideKey(mode: TradingMode, orderId: string): string {
  return `${mode}:${orderId}`;
}

export function parseOrderReadyOverride(
  value: unknown
): OrderReadyOverride | null {
  if (value === 'auto' || value === 'force' || value === 'block') {
    return value;
  }
  if (value === true || value === 'yes' || value === 'true') {
    return 'force';
  }
  if (value === false || value === 'no' || value === 'false') {
    return 'block';
  }
  return null;
}

export function getOrderReadyOverride(
  mode: TradingMode,
  orderId: string
): OrderReadyOverride {
  return overrides.get(overrideKey(mode, orderId)) ?? 'auto';
}

export function setOrderReadyOverride(
  mode: TradingMode,
  orderId: string,
  ready: OrderReadyOverride
): OrderReadyOverride {
  const key = overrideKey(mode, orderId);
  if (ready === 'auto') {
    overrides.delete(key);
    return 'auto';
  }
  overrides.set(key, ready);
  return ready;
}

export function clearOrderReadyOverrides(mode?: TradingMode): void {
  if (!mode) {
    overrides.clear();
    return;
  }
  const prefix = `${mode}:`;
  for (const key of overrides.keys()) {
    if (key.startsWith(prefix)) {
      overrides.delete(key);
    }
  }
}

/**
 * Apply a desk Ready override on top of evaluateOpenOrder.
 * force still requires qty > 0, BUY/SELL, and a usable price for Tradier.
 */
export function applyOrderReadyOverride(
  order: SignalSigmaOpenOrder,
  decision: OrderDecision,
  ready: OrderReadyOverride
): OrderDecision {
  if (ready === 'auto') {
    return decision;
  }

  if (ready === 'block') {
    return {
      place: false,
      reason: decision.place
        ? 'manually set to not ready'
        : decision.reason,
      ownershipPrice: decision.ownershipPrice,
      strategy: decision.strategy,
      marketPrice: decision.marketPrice,
      quantity: decision.quantity,
    };
  }

  if (decision.quantity <= 0) {
    return {
      place: false,
      reason: 'quantity is zero',
      ownershipPrice: decision.ownershipPrice,
      strategy: decision.strategy,
      marketPrice: decision.marketPrice,
      quantity: decision.quantity,
    };
  }

  if (order.direction !== 'BUY' && order.direction !== 'SELL') {
    return {
      place: false,
      reason: `unsupported direction ${order.direction}`,
      ownershipPrice: decision.ownershipPrice,
      strategy: decision.strategy,
      marketPrice: decision.marketPrice,
      quantity: decision.quantity,
    };
  }

  const ownershipPrice =
    decision.ownershipPrice != null && decision.ownershipPrice > 0
      ? decision.ownershipPrice
      : order.price > 0
        ? order.price
        : null;

  if (ownershipPrice == null) {
    return {
      place: false,
      reason: 'forced ready but no usable price',
      ownershipPrice: null,
      strategy: decision.strategy,
      marketPrice: decision.marketPrice,
      quantity: decision.quantity,
    };
  }

  return {
    place: true,
    ownershipPrice,
    strategy: decision.strategy || '—',
    marketPrice: decision.marketPrice,
    quantity: decision.quantity,
  };
}
