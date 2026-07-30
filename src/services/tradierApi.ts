import axios, { AxiosInstance } from 'axios';
import {
  TradierOrderRequest,
  TradierOrderResponse,
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
