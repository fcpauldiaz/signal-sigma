import axios, { AxiosInstance } from 'axios';
import {
  TradierBalances,
  TradierClosedPosition,
  TradierOrderRequest,
  TradierOrderResponse,
  TradierPosition,
  TradierQuote,
} from '../types';
import { getTradierConfig, TradierConfig, TradingMode } from '../utils/tradierConfig';

type TradierQuotePayload = {
  symbol?: string;
  last?: number | string | null;
  bid?: number | string | null;
  ask?: number | string | null;
};

export class TradierApi {
  readonly mode: TradingMode;
  readonly accountId: string;
  readonly baseUrl: string;
  private client: AxiosInstance;

  constructor(config: TradierConfig = getTradierConfig()) {
    this.mode = config.mode;
    this.accountId = config.accountId;
    this.baseUrl = config.baseUrl;
    this.client = axios.create({
      baseURL: config.baseUrl,
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
  }

  static fromEnv(): TradierApi {
    return new TradierApi(getTradierConfig());
  }

  async getQuotes(symbols: string[]): Promise<Map<string, TradierQuote>> {
    const uniqueSymbols = [...new Set(symbols.map((s) => s.toUpperCase()))];
    const quotes = new Map<string, TradierQuote>();

    if (uniqueSymbols.length === 0) {
      return quotes;
    }

    try {
      const response = await this.client.get<{
        quotes?: { quote?: TradierQuotePayload | TradierQuotePayload[] };
      }>('/markets/quotes', {
        params: {
          symbols: uniqueSymbols.join(','),
          greeks: 'false',
        },
      });

      const raw = response.data.quotes?.quote;
      const list = !raw ? [] : Array.isArray(raw) ? raw : [raw];

      for (const item of list) {
        if (!item.symbol) {
          continue;
        }
        const symbol = item.symbol.toUpperCase();
        quotes.set(symbol, {
          symbol,
          last: toNumber(item.last),
          bid: toNumber(item.bid),
          ask: toNumber(item.ask),
        });
      }

      return quotes;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(
          `Failed to fetch Tradier quotes (${this.mode}): ${error.response?.status} ${error.response?.statusText} - ${JSON.stringify(error.response?.data)}`
        );
      }
      throw error;
    }
  }

  async placeOrder(orderRequest: TradierOrderRequest): Promise<TradierOrderResponse> {
    try {
      const params = new URLSearchParams();
      params.append('class', orderRequest.class);
      params.append('symbol', orderRequest.symbol);
      params.append('side', orderRequest.side);
      params.append('quantity', orderRequest.quantity.toString());
      params.append('type', orderRequest.type);
      params.append('duration', orderRequest.duration);
      if (orderRequest.tag) {
        params.append('tag', orderRequest.tag);
      }

      const response = await this.client.post<TradierOrderResponse>(
        `/accounts/${this.accountId}/orders`,
        params.toString()
      );

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(
          `Failed to place Tradier order (${this.mode}): ${error.response?.status} ${error.response?.statusText} - ${JSON.stringify(error.response?.data)}`
        );
      }
      throw error;
    }
  }

  async getBalances(): Promise<TradierBalances> {
    try {
      const response = await this.client.get<{
        balances?: Record<string, number | string | null>;
      }>(`/accounts/${this.accountId}/balances`);
      const b = response.data.balances || {};
      return {
        totalEquity: toNumber(b.total_equity),
        totalCash: toNumber(b.total_cash),
        marketValue: toNumber(b.market_value),
        openPl: toNumber(b.open_pl),
        closePl: toNumber(b.close_pl),
        pendingOrdersCount: toNumber(b.pending_orders_count),
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(
          `Failed to fetch Tradier balances (${this.mode}): ${error.response?.status} ${error.response?.statusText}`
        );
      }
      throw error;
    }
  }

  async getPositions(): Promise<TradierPosition[]> {
    try {
      const response = await this.client.get<{
        positions?:
          | 'null'
          | {
              position?:
                | {
                    symbol?: string;
                    quantity?: number | string;
                    cost_basis?: number | string;
                    date_acquired?: string;
                  }
                | Array<{
                    symbol?: string;
                    quantity?: number | string;
                    cost_basis?: number | string;
                    date_acquired?: string;
                  }>;
            };
      }>(`/accounts/${this.accountId}/positions`);

      const raw = response.data.positions;
      if (!raw || raw === 'null') {
        return [];
      }
      const list = !raw.position
        ? []
        : Array.isArray(raw.position)
          ? raw.position
          : [raw.position];

      return list
        .filter((p) => p.symbol)
        .map((p) => ({
          symbol: String(p.symbol).toUpperCase(),
          quantity: toNumber(p.quantity) ?? 0,
          costBasis: toNumber(p.cost_basis) ?? 0,
          dateAcquired: p.date_acquired || null,
        }));
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(
          `Failed to fetch Tradier positions (${this.mode}): ${error.response?.status} ${error.response?.statusText}`
        );
      }
      throw error;
    }
  }

  async getGainLoss(limit = 100): Promise<TradierClosedPosition[]> {
    try {
      const response = await this.client.get<{
        gainloss?:
          | 'null'
          | {
              closed_position?:
                | Record<string, unknown>
                | Array<Record<string, unknown>>;
            };
      }>(`/accounts/${this.accountId}/gainloss`, {
        params: { page: 1, limit },
      });

      const raw = response.data.gainloss;
      if (!raw || raw === 'null') {
        return [];
      }
      const list = !raw.closed_position
        ? []
        : Array.isArray(raw.closed_position)
          ? raw.closed_position
          : [raw.closed_position];

      return list.map((p) => ({
        symbol: String(p.symbol || ''),
        quantity: toNumber(p.quantity as number | string | null) ?? 0,
        cost: toNumber(p.cost as number | string | null) ?? 0,
        proceeds: toNumber(p.proceeds as number | string | null) ?? 0,
        gainLoss: toNumber(p.gain_loss as number | string | null) ?? 0,
        gainLossPercent:
          toNumber(p.gain_loss_percent as number | string | null) ?? 0,
        openDate: String(p.open_date || ''),
        closeDate: String(p.close_date || ''),
        term: toNumber(p.term as number | string | null) ?? 0,
      }));
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(
          `Failed to fetch Tradier gain/loss (${this.mode}): ${error.response?.status} ${error.response?.statusText}`
        );
      }
      throw error;
    }
  }
}

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function resolveQuotePrice(quote: TradierQuote | undefined): number | null {
  if (!quote) {
    return null;
  }
  if (quote.last !== null) {
    return quote.last;
  }
  if (quote.bid !== null && quote.ask !== null) {
    return (quote.bid + quote.ask) / 2;
  }
  return quote.bid ?? quote.ask;
}
