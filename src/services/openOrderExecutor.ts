import { SignalSigmaApi } from './signalSigmaApi';
import { TradierApi } from './tradierApi';
import { placeOrders } from '../utils/orderPlacer';
import {
  buildOwnershipBySymbol,
  evaluateOpenOrder,
  getConfiguredStrategyIds,
} from '../utils/openOrderEligibility';
import { PlaceableOrder } from '../types';

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

  const [{ orders }, portfolios, strategyBooks] = await Promise.all([
    signalSigmaApi.getOpenOrders(portfolioId),
    signalSigmaApi.getPortfolios(),
    signalSigmaApi.getStrategyPositionBooks(getConfiguredStrategyIds()),
  ]);

  const portfolio = portfolios.portfolios.find((p) => p.id === portfolioId);
  if (!portfolio) {
    throw new Error(`Portfolio ${portfolioId} not found`);
  }

  const ownershipBySymbol = buildOwnershipBySymbol(
    portfolio.tickers,
    strategyBooks
  );
  const pending = orders.filter((order) => order.status === 'PENDING');

  console.log(`Found ${pending.length} pending open order(s)`);
  console.log(
    `Strategy ownership books: ${strategyBooks
      .map((b) => `${b.title}(${b.tickers.length})`)
      .join(', ')}`
  );

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
    const decision = evaluateOpenOrder(order, quotes, ownershipBySymbol);
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
      signalPrice: decision.ownershipPrice,
    });
  }

  if (toPlace.length === 0) {
    console.log('No eligible orders to place after ownership price checks.');
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
