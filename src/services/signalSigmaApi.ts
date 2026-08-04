import axios, { AxiosInstance } from 'axios';
import {
  OpenOrdersApiEnvelope,
  OpenOrdersResponse,
  PortfolioApiEnvelope,
  PortfolioResponse,
  StrategyApiEnvelope,
  StrategySummary,
  StrategyTableApiEnvelope,
  Ticker,
} from '../types';
import { TtlCache } from '../utils/ttlCache';
import { SignalSigmaAuth } from './signalSigmaAuth';

export type StrategyPositionBook = {
  id: string;
  title: string;
  tickers: Ticker[];
};

export type FetchCacheOptions = {
  bypassCache?: boolean;
};

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const signalSigmaCache = new TtlCache();

export function invalidateSignalSigmaCache(): void {
  signalSigmaCache.invalidate();
}

export class SignalSigmaApi {
  private auth: SignalSigmaAuth;
  private client: AxiosInstance;

  constructor(auth: SignalSigmaAuth) {
    this.auth = auth;
    this.client = axios.create({
      baseURL: 'https://signal-sigma-api-prod-649902632625.europe-west2.run.app',
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  private async getAuthHeaders(): Promise<Record<string, string>> {
    const accessToken = await this.auth.getAccessToken();
    return {
      Authorization: `Bearer ${accessToken}`,
    };
  }

  private async withAuthRetry<T>(request: () => Promise<T>): Promise<T> {
    try {
      return await request();
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        this.auth.clearTokens();
        return await request();
      }
      throw error;
    }
  }

  private normalizePortfolioResponse(
    payload: PortfolioApiEnvelope
  ): PortfolioResponse {
    if (payload.data?.portfolios) {
      return payload.data;
    }
    if (payload.portfolios) {
      return { portfolios: payload.portfolios };
    }
    throw new Error('Invalid portfolio response: portfolios not found');
  }

  private normalizeOpenOrdersResponse(
    payload: OpenOrdersApiEnvelope
  ): OpenOrdersResponse {
    if (payload.data?.orders) {
      return payload.data;
    }
    if (payload.orders) {
      return { orders: payload.orders };
    }
    throw new Error('Invalid open orders response: orders not found');
  }

  async getPortfolios(
    options: FetchCacheOptions = {}
  ): Promise<PortfolioResponse> {
    if (options.bypassCache) {
      return this.fetchPortfolios();
    }
    return signalSigmaCache.getOrSet('portfolios', CACHE_TTL_MS, () =>
      this.fetchPortfolios()
    );
  }

  private async fetchPortfolios(): Promise<PortfolioResponse> {
    try {
      return await this.withAuthRetry(async () => {
        const headers = await this.getAuthHeaders();
        const response = await this.client.get<PortfolioApiEnvelope>(
          '/api/portfolio',
          { headers }
        );
        return this.normalizePortfolioResponse(response.data);
      });
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(
          `Failed to fetch portfolios: ${error.response?.status} ${error.response?.statusText}`
        );
      }
      throw error;
    }
  }

  async getOpenOrders(
    portfolioId: string,
    options: FetchCacheOptions = {}
  ): Promise<OpenOrdersResponse> {
    const key = `open-orders:${portfolioId}`;
    if (options.bypassCache) {
      const fresh = await this.fetchOpenOrders(portfolioId);
      signalSigmaCache.invalidate(key);
      return fresh;
    }
    return signalSigmaCache.getOrSet(key, CACHE_TTL_MS, () =>
      this.fetchOpenOrders(portfolioId)
    );
  }

  private async fetchOpenOrders(
    portfolioId: string
  ): Promise<OpenOrdersResponse> {
    try {
      return await this.withAuthRetry(async () => {
        const headers = await this.getAuthHeaders();
        const response = await this.client.get<OpenOrdersApiEnvelope>(
          `/api/portfolio/${portfolioId}/orders`,
          {
            headers,
            params: { snapshotDate: 'null' },
          }
        );
        return this.normalizeOpenOrdersResponse(response.data);
      });
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(
          `Failed to fetch open orders: ${error.response?.status} ${error.response?.statusText}`
        );
      }
      throw error;
    }
  }

  async getStrategy(strategyId: string): Promise<StrategySummary> {
    try {
      return await this.withAuthRetry(async () => {
        const headers = await this.getAuthHeaders();
        const response = await this.client.get<StrategyApiEnvelope>(
          `/api/strategy/${strategyId}`,
          { headers }
        );
        const strategy = response.data.data?.strategy;
        if (!strategy) {
          throw new Error('Invalid strategy response: strategy not found');
        }
        return strategy;
      });
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(
          `Failed to fetch strategy ${strategyId}: ${error.response?.status} ${error.response?.statusText}`
        );
      }
      throw error;
    }
  }

  async getStrategyTable(
    strategyId: string,
    tableType = 'OVERVIEW'
  ): Promise<Ticker[]> {
    try {
      return await this.withAuthRetry(async () => {
        const headers = await this.getAuthHeaders();
        // Frontend passes empty snapshotDate for live strategy books.
        const response = await this.client.get<StrategyTableApiEnvelope>(
          `/api/strategy/${strategyId}/table`,
          {
            headers,
            params: { tableType, snapshotDate: '' },
          }
        );
        return response.data.data?.tickers ?? [];
      });
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(
          `Failed to fetch strategy table ${strategyId}: ${error.response?.status} ${error.response?.statusText}`
        );
      }
      throw error;
    }
  }

  async getStrategyPositionBooks(
    strategyIds: string[],
    options: FetchCacheOptions = {}
  ): Promise<StrategyPositionBook[]> {
    const key = `strategy-books:${strategyIds.slice().sort().join(',')}`;
    if (options.bypassCache) {
      return this.fetchStrategyPositionBooks(strategyIds);
    }
    return signalSigmaCache.getOrSet(key, CACHE_TTL_MS, () =>
      this.fetchStrategyPositionBooks(strategyIds)
    );
  }

  private async fetchStrategyPositionBooks(
    strategyIds: string[]
  ): Promise<StrategyPositionBook[]> {
    return Promise.all(
      strategyIds.map(async (strategyId) => {
        const [strategy, tickers] = await Promise.all([
          this.getStrategy(strategyId),
          this.getStrategyTable(strategyId, 'OVERVIEW'),
        ]);
        return {
          id: strategy.id,
          title: strategy.title,
          tickers: tickers.filter((t) => t.systemClassification !== 'cash'),
        };
      })
    );
  }

  async executeOrders(portfolioId: string, orderIds: string[]): Promise<void> {
    if (orderIds.length === 0) {
      return;
    }

    try {
      await this.withAuthRetry(async () => {
        const headers = await this.getAuthHeaders();
        await this.client.post(
          `/api/portfolio/${portfolioId}/orders/execute`,
          { orderIds },
          { headers }
        );
      });
      signalSigmaCache.invalidate(`open-orders:${portfolioId}`);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(
          `Failed to confirm order execution: ${error.response?.status} ${error.response?.statusText} - ${JSON.stringify(error.response?.data)}`
        );
      }
      throw error;
    }
  }
}
