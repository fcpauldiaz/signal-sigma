import axios, { AxiosInstance } from 'axios';
import {
  OpenOrdersApiEnvelope,
  OpenOrdersResponse,
  PortfolioApiEnvelope,
  PortfolioResponse,
} from '../types';
import { SignalSigmaAuth } from './signalSigmaAuth';

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

  async getPortfolios(): Promise<PortfolioResponse> {
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

  async getOpenOrders(portfolioId: string): Promise<OpenOrdersResponse> {
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
