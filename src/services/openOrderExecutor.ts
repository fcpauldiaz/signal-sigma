import { SignalSigmaApi } from './signalSigmaApi';
import { resolveQuotePrice, TradierApi } from './tradierApi';
import { placeOrders } from '../utils/orderPlacer';
import { PlaceableOrder, SignalSigmaOpenOrder, TradierQuote } from '../types';

export type OpenOrderExecutionResult = {
  pendingCount: number;
  placedCount: number;
  skippedCount: number;
  confirmedCount: number;
  failedCount: number;
};

export async function executeOpenOrders(options: {
  signalSigmaApi: SignalSigmaApi;
  tradierApi: TradierApi;
  portfolioId: string;
}): Promise<OpenOrderExecutionResult> {
  const { signalSigmaApi, tradierApi, portfolioId } = options;

  const { orders } = await signalSigmaApi.getOpenOrders(portfolioId);
  const pending = orders.filter((order) => order.status === 'PENDING');

  console.log(`Found ${pending.length} pending open order(s)`);

  if (pending.length === 0) {
    return {
      pendingCount: 0,
      placedCount: 0,
      skippedCount: 0,
      confirmedCount: 0,
      failedCount: 0,
    };
  }

  const buySymbols = pending
    .filter((order) => order.direction === 'BUY')
    .map((order) => order.symbol);
  const quotes = await tradierApi.getQuotes(buySymbols);

  const toPlace: PlaceableOrder[] = [];
  let skippedCount = 0;

  for (const order of pending) {
    const decision = evaluateOrder(order, quotes);
    if (!decision.place) {
      skippedCount += 1;
      console.log(
        `  SKIP ${order.direction} ${order.amount} ${order.symbol}: ${decision.reason}`
      );
      continue;
    }

    toPlace.push({
      signalSigmaOrderId: order.id,
      symbol: order.symbol,
      side: order.direction === 'BUY' ? 'buy' : 'sell',
      quantity: Math.trunc(order.amount),
      signalPrice: order.price,
    });
  }

  if (toPlace.length === 0) {
    console.log('No eligible orders to place after price checks.');
    return {
      pendingCount: pending.length,
      placedCount: 0,
      skippedCount,
      confirmedCount: 0,
      failedCount: 0,
    };
  }

  console.log(`Placing ${toPlace.length} order(s) with Tradier...`);
  const placement = await placeOrders(tradierApi, toPlace);

  const successfulIds = placement.successful.map(
    (order) => order.signalSigmaOrderId
  );

  if (successfulIds.length > 0) {
    console.log(
      `Confirming execution in Signal Sigma for ${successfulIds.length} order(s)...`
    );
    await signalSigmaApi.executeOrders(portfolioId, successfulIds);
    console.log('Signal Sigma execution confirmed');
  }

  return {
    pendingCount: pending.length,
    placedCount: placement.successful.length,
    skippedCount,
    confirmedCount: successfulIds.length,
    failedCount: placement.failed.length,
  };
}

function evaluateOrder(
  order: SignalSigmaOpenOrder,
  quotes: Map<string, TradierQuote>
): { place: true } | { place: false; reason: string } {
  const quantity = Math.trunc(order.amount);
  if (quantity <= 0) {
    return { place: false, reason: 'quantity is zero' };
  }

  if (order.direction === 'SELL') {
    return { place: true };
  }

  if (order.direction !== 'BUY') {
    return { place: false, reason: `unsupported direction ${order.direction}` };
  }

  const marketPrice = resolveQuotePrice(quotes.get(order.symbol.toUpperCase()));
  if (marketPrice === null) {
    return { place: false, reason: 'no Tradier quote available' };
  }

  if (marketPrice > order.price) {
    return {
      place: false,
      reason: `market ${marketPrice} > signal ${order.price}`,
    };
  }

  return { place: true };
}
