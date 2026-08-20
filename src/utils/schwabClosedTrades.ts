import { TradierClosedPosition } from '../types';

export type SchwabInstrument = {
  assetType?: string;
  symbol?: string;
  cusip?: string;
  description?: string;
  underlyingSymbol?: string;
  putCall?: string;
  strikePrice?: number;
  expirationDate?: string;
  optionExpirationDate?: string;
};

export type SchwabTransferItem = {
  instrument?: SchwabInstrument;
  amount?: number;
  cost?: number;
  price?: number;
  positionEffect?: string;
  instruction?: string;
};

export type SchwabTransaction = {
  activityId?: number | string;
  type?: string;
  status?: string;
  tradeDate?: string;
  transactionDate?: string;
  time?: string;
  netAmount?: number;
  transferItems?: SchwabTransferItem[];
};

type OpenLot = {
  symbol: string;
  quantity: number;
  cost: number;
  openDate: string;
  side: 'long' | 'short';
};

export function closedTradesFromSchwabTransactions(
  transactions: SchwabTransaction[]
): TradierClosedPosition[] {
  const lots = new Map<string, OpenLot[]>();
  const closed: TradierClosedPosition[] = [];

  const ordered = transactions
    .slice()
    .sort((a, b) => transactionTime(a).localeCompare(transactionTime(b)));

  for (const txn of ordered) {
    if ((txn.type || '').toUpperCase() !== 'TRADE') {
      continue;
    }
    const when = transactionTime(txn);
    for (const item of txn.transferItems || []) {
      if (!isSecurityItem(item)) {
        continue;
      }
      const symbol = instrumentSymbol(item.instrument);
      if (!symbol) {
        continue;
      }
      const quantity = Math.abs(toFinite(item.amount) ?? 0);
      if (quantity === 0) {
        continue;
      }
      const price = toFinite(item.price) ?? 0;
      const notional = Math.abs(price * quantity);
      const reportedCost = Math.abs(toFinite(item.cost) ?? 0);
      const action = classifyAction(item);

      if (action === 'open-long' || action === 'open-short') {
        const side = action === 'open-long' ? 'long' : 'short';
        const cost = reportedCost > 0 ? reportedCost : notional;
        pushLot(lots, symbol, {
          symbol,
          quantity,
          cost,
          openDate: when,
          side,
        });
        continue;
      }

      if (action === 'close-long' || action === 'close-short') {
        const side = action === 'close-long' ? 'long' : 'short';
        const proceeds = notional > 0 ? notional : reportedCost;
        closed.push(
          ...closeLots(lots, symbol, side, quantity, proceeds, when)
        );
      }
    }
  }

  return closed;
}

function classifyAction(
  item: SchwabTransferItem
): 'open-long' | 'open-short' | 'close-long' | 'close-short' | 'skip' {
  const instruction = (item.instruction || '').toUpperCase().replace(/-/g, '_');
  const effect = (item.positionEffect || '').toUpperCase();
  const amount = toFinite(item.amount) ?? 0;

  if (
    instruction === 'SELL_TO_OPEN' ||
    instruction === 'SELL_SHORT' ||
    instruction === 'SHORT'
  ) {
    return 'open-short';
  }
  if (
    instruction === 'BUY_TO_CLOSE' ||
    instruction === 'BUY_TO_COVER' ||
    instruction === 'COVER'
  ) {
    return 'close-short';
  }
  if (instruction === 'BUY_TO_OPEN' || instruction === 'BUY') {
    return effect === 'CLOSING' ? 'close-short' : 'open-long';
  }
  if (instruction === 'SELL_TO_CLOSE' || instruction === 'SELL') {
    return effect === 'OPENING' ? 'open-short' : 'close-long';
  }
  if (effect === 'OPENING') {
    return amount < 0 ? 'open-short' : 'open-long';
  }
  if (effect === 'CLOSING') {
    return amount > 0 ? 'close-short' : 'close-long';
  }
  if (amount < 0) {
    return 'close-long';
  }
  if (amount > 0) {
    return 'open-long';
  }
  return 'skip';
}

function closeLots(
  lots: Map<string, OpenLot[]>,
  symbol: string,
  side: 'long' | 'short',
  quantity: number,
  proceeds: number,
  closeDate: string
): TradierClosedPosition[] {
  const queue = lots.get(symbol) || [];
  const matching = queue.filter((lot) => lot.side === side);
  const kept = queue.filter((lot) => lot.side !== side);
  const closed: TradierClosedPosition[] = [];
  let remaining = quantity;
  let remainingProceeds = proceeds;
  const proceedsPerShare = quantity > 0 ? proceeds / quantity : 0;

  while (remaining > 0 && matching.length > 0) {
    const lot = matching[0];
    const take = Math.min(lot.quantity, remaining);
    const cost = lot.quantity > 0 ? (lot.cost * take) / lot.quantity : 0;
    const takeProceeds = proceedsPerShare * take;
    const gainLoss =
      side === 'long' ? takeProceeds - cost : cost - takeProceeds;
    closed.push(
      toClosedTrade(symbol, take, cost, takeProceeds, gainLoss, lot.openDate, closeDate)
    );
    remaining -= take;
    remainingProceeds -= takeProceeds;
    lot.quantity -= take;
    lot.cost -= cost;
    if (lot.quantity <= 1e-8) {
      matching.shift();
    }
  }

  if (remaining > 0) {
    const takeProceeds =
      remainingProceeds > 0 ? remainingProceeds : proceedsPerShare * remaining;
    closed.push(
      toClosedTrade(symbol, remaining, 0, takeProceeds, takeProceeds, closeDate, closeDate)
    );
  }

  lots.set(symbol, [...kept, ...matching]);
  return closed;
}

function toClosedTrade(
  symbol: string,
  quantity: number,
  cost: number,
  proceeds: number,
  gainLoss: number,
  openDate: string,
  closeDate: string
): TradierClosedPosition {
  const openMs = Date.parse(openDate);
  const closeMs = Date.parse(closeDate);
  const term =
    Number.isFinite(openMs) && Number.isFinite(closeMs)
      ? Math.max(0, Math.round((closeMs - openMs) / 86_400_000))
      : 0;
  return {
    symbol,
    quantity,
    cost,
    proceeds,
    gainLoss,
    gainLossPercent: cost !== 0 ? (gainLoss / Math.abs(cost)) * 100 : 0,
    openDate,
    closeDate,
    term,
  };
}

function pushLot(
  lots: Map<string, OpenLot[]>,
  symbol: string,
  lot: OpenLot
): void {
  const queue = lots.get(symbol) || [];
  queue.push(lot);
  lots.set(symbol, queue);
}

function isSecurityItem(item: SchwabTransferItem): boolean {
  const assetType = (item.instrument?.assetType || '').toUpperCase();
  return assetType !== '' && assetType !== 'CURRENCY';
}

export function instrumentSymbol(
  instrument: SchwabInstrument | undefined
): string {
  if (!instrument) {
    return '';
  }
  const raw = (instrument.symbol || '').trim().toUpperCase();
  if (raw) {
    return raw;
  }
  const underlying = (instrument.underlyingSymbol || '').trim().toUpperCase();
  if (!underlying) {
    return '';
  }
  const putCall = (instrument.putCall || '').toUpperCase().startsWith('P')
    ? 'P'
    : 'C';
  const expiryRaw =
    instrument.optionExpirationDate || instrument.expirationDate || '';
  const expiry = expiryRaw.replace(/-/g, '').slice(2, 8);
  const strike = Math.round((instrument.strikePrice || 0) * 1000)
    .toString()
    .padStart(8, '0');
  if (!expiry) {
    return underlying;
  }
  return `${underlying.padEnd(6, ' ')}${expiry}${putCall}${strike}`;
}

function transactionTime(txn: SchwabTransaction): string {
  return txn.tradeDate || txn.transactionDate || txn.time || '';
}

function toFinite(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
