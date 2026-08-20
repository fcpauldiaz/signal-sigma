import axios, { AxiosInstance } from 'axios';
import {
  TradierBalances,
  TradierClosedPosition,
  TradierPosition,
} from '../types';
import { SchwabAuth } from './schwabAuth';
import {
  getSchwabConfig,
  getSchwabTraderBaseUrl,
  SchwabConfig,
} from '../utils/schwabConfig';
import {
  closedTradesFromSchwabTransactions,
  SchwabTransaction,
} from '../utils/schwabClosedTrades';

export type SchwabBrokerPosition = TradierPosition & {
  lastPrice: number | null;
  avgCost: number | null;
  marketValue: number | null;
  openPl: number | null;
  openPlPercent: number | null;
};

type SchwabAccountNumber = {
  accountNumber?: string;
  hashValue?: string;
};

type SchwabPositionRaw = {
  shortQuantity?: number;
  longQuantity?: number;
  averagePrice?: number;
  averageLongPrice?: number;
  marketValue?: number;
  longOpenProfitLoss?: number;
  shortOpenProfitLoss?: number;
  currentDayProfitLoss?: number;
  instrument?: {
    symbol?: string;
    assetType?: string;
    underlyingSymbol?: string;
  };
};

type SchwabBalancesRaw = {
  liquidationValue?: number;
  equity?: number;
  accountValue?: number;
  cashBalance?: number;
  totalCash?: number;
  moneyMarketFund?: number;
  longMarketValue?: number;
  shortMarketValue?: number;
  marketValue?: number;
  unrealizedProfitLoss?: number;
};

type SchwabAccountRaw = {
  securitiesAccount?: {
    accountNumber?: string;
    type?: string;
    positions?: SchwabPositionRaw[];
    currentBalances?: SchwabBalancesRaw;
    initialBalances?: SchwabBalancesRaw;
  };
};

const TRANSACTION_LOOKBACK_MS = 365 * 24 * 60 * 60 * 1000;
const CHUNK_MS = 180 * 24 * 60 * 60 * 1000;

export class SchwabApi {
  private client: AxiosInstance;
  private accountHashCache: string | null = null;

  constructor(
    private readonly auth: SchwabAuth,
    private readonly config: SchwabConfig | null = getSchwabConfig()
  ) {
    this.client = axios.create({
      baseURL: getSchwabTraderBaseUrl(),
      headers: { Accept: 'application/json' },
    });
  }

  static fromEnv(): SchwabApi {
    return new SchwabApi(SchwabAuth.fromEnv());
  }

  async getAccountHash(): Promise<string> {
    if (this.accountHashCache) {
      return this.accountHashCache;
    }
    if (!this.config) {
      throw new Error('Schwab is not configured');
    }
    if (this.config.accountHash) {
      this.accountHashCache = this.config.accountHash;
      return this.accountHashCache;
    }

    const numbers = await this.request<SchwabAccountNumber[]>(
      'GET',
      '/accounts/accountNumbers'
    );
    const list = Array.isArray(numbers) ? numbers : [];
    const match = this.config.accountNumber
      ? list.find((item) => item.accountNumber === this.config?.accountNumber)
      : list[0];
    const hash = match?.hashValue;
    if (!hash) {
      throw new Error(
        this.config.accountNumber
          ? `Schwab account ${this.config.accountNumber} not in linked accounts`
          : 'No Schwab accounts linked to this app'
      );
    }
    this.accountHashCache = hash;
    return hash;
  }

  async getAccountSnapshot(): Promise<{
    accountId: string;
    balances: TradierBalances;
    positions: SchwabBrokerPosition[];
  }> {
    const hash = await this.getAccountHash();
    const account = await this.request<SchwabAccountRaw>(
      'GET',
      `/accounts/${encodeURIComponent(hash)}`,
      { fields: 'positions' }
    );
    const securities = account.securitiesAccount;
    const rawBalances =
      securities?.currentBalances || securities?.initialBalances || {};
    const rawPositions = securities?.positions || [];

    const positions = rawPositions
      .map((position) => mapPosition(position))
      .filter((position): position is SchwabBrokerPosition => position !== null);

    const openPlFromPositions = positions.reduce(
      (sum, position) => sum + (position.openPl ?? 0),
      0
    );
    const marketValueFromPositions = positions.reduce(
      (sum, position) => sum + (position.marketValue ?? 0),
      0
    );

    return {
      accountId: securities?.accountNumber || hash,
      balances: {
        totalEquity:
          toFinite(rawBalances.liquidationValue) ??
          toFinite(rawBalances.equity) ??
          toFinite(rawBalances.accountValue),
        totalCash:
          toFinite(rawBalances.cashBalance) ??
          toFinite(rawBalances.totalCash) ??
          toFinite(rawBalances.moneyMarketFund),
        marketValue:
          toFinite(rawBalances.longMarketValue) != null ||
          toFinite(rawBalances.shortMarketValue) != null
            ? (toFinite(rawBalances.longMarketValue) ?? 0) +
              (toFinite(rawBalances.shortMarketValue) ?? 0)
            : toFinite(rawBalances.marketValue) ?? marketValueFromPositions,
        openPl: toFinite(rawBalances.unrealizedProfitLoss) ?? openPlFromPositions,
        closePl: null,
        pendingOrdersCount: null,
      },
      positions,
    };
  }

  async getClosedPositions(): Promise<{
    trades: TradierClosedPosition[];
    historyFrom: string;
    historyTo: string;
  }> {
    const hash = await this.getAccountHash();
    const historyTo = new Date();
    const historyFrom = new Date(historyTo.getTime() - TRANSACTION_LOOKBACK_MS);
    const transactions: SchwabTransaction[] = [];

    let chunkStart = historyFrom.getTime();
    while (chunkStart < historyTo.getTime()) {
      const chunkEnd = Math.min(chunkStart + CHUNK_MS, historyTo.getTime());
      const batch = await this.request<SchwabTransaction[] | { transactions?: SchwabTransaction[] }>(
        'GET',
        `/accounts/${encodeURIComponent(hash)}/transactions`,
        {
          startDate: new Date(chunkStart).toISOString(),
          endDate: new Date(chunkEnd).toISOString(),
          types: 'TRADE',
        }
      );
      const list = Array.isArray(batch)
        ? batch
        : Array.isArray(batch.transactions)
          ? batch.transactions
          : [];
      transactions.push(...list);
      chunkStart = chunkEnd + 1;
    }

    return {
      trades: closedTradesFromSchwabTransactions(transactions),
      historyFrom: historyFrom.toISOString(),
      historyTo: historyTo.toISOString(),
    };
  }

  private async request<T>(
    method: 'GET',
    url: string,
    params?: Record<string, string>
  ): Promise<T> {
    const send = async (token: string) =>
      this.client.request<T>({
        method,
        url,
        params,
        headers: { Authorization: `Bearer ${token}` },
      });

    try {
      const token = await this.auth.getAccessToken();
      const response = await send(token);
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        const token = await this.auth.forceRefresh();
        const retry = await send(token);
        return retry.data;
      }
      if (axios.isAxiosError(error)) {
        throw new Error(
          `Schwab ${method} ${url} failed: ${error.response?.status ?? ''} ${JSON.stringify(error.response?.data ?? error.message)}`
        );
      }
      throw error;
    }
  }
}

function mapPosition(position: SchwabPositionRaw): SchwabBrokerPosition | null {
  const symbol = (position.instrument?.symbol || '').trim().toUpperCase();
  if (!symbol) {
    return null;
  }
  const longQty = toFinite(position.longQuantity) ?? 0;
  const shortQty = toFinite(position.shortQuantity) ?? 0;
  const quantity = longQty - shortQty;
  if (quantity === 0) {
    return null;
  }
  const avgCost = toFinite(position.averageLongPrice) ?? toFinite(position.averagePrice);
  const marketValue = toFinite(position.marketValue);
  const costBasis =
    avgCost != null ? Math.abs(avgCost * quantity) : Math.abs(marketValue ?? 0);
  const openPl =
    toFinite(position.longOpenProfitLoss) ??
    toFinite(position.shortOpenProfitLoss) ??
    (marketValue != null ? marketValue - (quantity >= 0 ? costBasis : -costBasis) : null);
  const lastPrice =
    marketValue != null && quantity !== 0 ? marketValue / quantity : null;
  const openPlPercent =
    openPl != null && costBasis !== 0 ? (openPl / costBasis) * 100 : null;

  return {
    symbol,
    quantity,
    costBasis,
    dateAcquired: null,
    lastPrice,
    avgCost,
    marketValue,
    openPl,
    openPlPercent,
  };
}

function toFinite(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
