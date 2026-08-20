import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import {
  getSchwabAuthBaseUrl,
  getSchwabConfig,
  getSchwabRefreshTokenTtlMs,
  SchwabConfig,
} from '../utils/schwabConfig';

export type SchwabTokenSet = {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
  refreshExpiresAt: number;
};

export type SchwabAuthStatus = {
  configured: boolean;
  connected: boolean;
  needsReauth: boolean;
  message: string;
  refreshExpiresAt: string | null;
};

type PendingAuth = {
  state: string;
  expiresAt: number;
};

const DATA_DIR = path.resolve(process.cwd(), 'data');
const TOKEN_PATH = path.join(DATA_DIR, 'schwab-tokens.json');
const ACCESS_SKEW_MS = 60_000;
const STATE_TTL_MS = 10 * 60 * 1000;
const pendingByState = new Map<string, PendingAuth>();

export class SchwabAuth {
  private refreshInFlight: Promise<string> | null = null;

  constructor(
    private readonly config: SchwabConfig | null = getSchwabConfig()
  ) {}

  static fromEnv(): SchwabAuth {
    return new SchwabAuth(getSchwabConfig());
  }

  isConfigured(): boolean {
    return this.config !== null;
  }

  getCallbackUrl(): string | null {
    return this.config?.callbackUrl ?? null;
  }

  getStatus(): SchwabAuthStatus {
    if (!this.config) {
      return {
        configured: false,
        connected: false,
        needsReauth: false,
        message:
          'Schwab is not configured. Set SCHWAB_APP_KEY and SCHWAB_APP_SECRET.',
        refreshExpiresAt: null,
      };
    }

    const tokens = readTokens();
    if (!tokens) {
      return {
        configured: true,
        connected: false,
        needsReauth: true,
        message: 'Authorize Schwab to load this account.',
        refreshExpiresAt: null,
      };
    }

    if (tokens.refreshExpiresAt <= Date.now()) {
      return {
        configured: true,
        connected: false,
        needsReauth: true,
        message: 'Schwab refresh token expired. Authorize again.',
        refreshExpiresAt: new Date(tokens.refreshExpiresAt).toISOString(),
      };
    }

    return {
      configured: true,
      connected: true,
      needsReauth: tokens.refreshExpiresAt - Date.now() < 24 * 60 * 60 * 1000,
      message: tokens.refreshExpiresAt - Date.now() < 24 * 60 * 60 * 1000
        ? 'Refresh token expires within 24 hours. Re-authorize soon.'
        : 'connected',
      refreshExpiresAt: new Date(tokens.refreshExpiresAt).toISOString(),
    };
  }

  buildAuthorizeUrl(): { url: string; state: string } {
    if (!this.config) {
      throw new Error('Schwab is not configured');
    }

    pruneExpiredStates();
    const state = crypto.randomBytes(24).toString('hex');
    pendingByState.set(state, {
      state,
      expiresAt: Date.now() + STATE_TTL_MS,
    });

    const url = new URL(`${getSchwabAuthBaseUrl()}/authorize`);
    url.searchParams.set('client_id', this.config.appKey);
    url.searchParams.set('redirect_uri', this.config.callbackUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', state);
    return { url: url.toString(), state };
  }

  consumeState(state: string | null): boolean {
    if (!state) return false;
    pruneExpiredStates();
    const pending = pendingByState.get(state);
    pendingByState.delete(state);
    return Boolean(pending && pending.expiresAt > Date.now());
  }

  async exchangeCode(code: string): Promise<SchwabTokenSet> {
    if (!this.config) {
      throw new Error('Schwab is not configured');
    }
    const tokens = await this.requestTokens({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.callbackUrl,
    });
    writeTokens(tokens);
    return tokens;
  }

  async getAccessToken(): Promise<string> {
    const tokens = readTokens();
    if (!tokens) {
      throw new Error('Schwab is not authorized');
    }
    if (tokens.refreshExpiresAt <= Date.now()) {
      throw new Error('Schwab refresh token expired. Authorize again.');
    }
    if (tokens.accessExpiresAt - ACCESS_SKEW_MS > Date.now()) {
      return tokens.accessToken;
    }
    return this.refreshAccessToken(tokens.refreshToken);
  }

  async forceRefresh(): Promise<string> {
    const tokens = readTokens();
    if (!tokens) {
      throw new Error('Schwab is not authorized');
    }
    return this.refreshAccessToken(tokens.refreshToken);
  }

  clearTokens(): void {
    try {
      if (fs.existsSync(TOKEN_PATH)) {
        fs.unlinkSync(TOKEN_PATH);
      }
    } catch {
      // ignore
    }
  }

  private async refreshAccessToken(refreshToken: string): Promise<string> {
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }

    this.refreshInFlight = this.requestTokens({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    })
      .then((tokens) => {
        writeTokens(tokens);
        return tokens.accessToken;
      })
      .catch((error) => {
        if (axios.isAxiosError(error) && error.response?.status === 400) {
          this.clearTokens();
        }
        throw new Error(
          axios.isAxiosError(error)
            ? `Schwab token refresh failed: ${error.response?.status ?? ''} ${JSON.stringify(error.response?.data ?? error.message)}`
            : error instanceof Error
              ? error.message
              : String(error)
        );
      })
      .finally(() => {
        this.refreshInFlight = null;
      });

    return this.refreshInFlight;
  }

  private async requestTokens(
    body: Record<string, string>
  ): Promise<SchwabTokenSet> {
    if (!this.config) {
      throw new Error('Schwab is not configured');
    }

    const credentials = Buffer.from(
      `${this.config.appKey}:${this.config.appSecret}`
    ).toString('base64');
    const params = new URLSearchParams(body);
    const response = await axios.post<{
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    }>(`${getSchwabAuthBaseUrl()}/token`, params.toString(), {
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    const accessToken = response.data.access_token;
    const nextRefresh = response.data.refresh_token;
    if (!accessToken) {
      throw new Error('Schwab token response missing access_token');
    }

    const existing = readTokens();
    const refreshToken = nextRefresh || existing?.refreshToken;
    if (!refreshToken) {
      throw new Error('Schwab token response missing refresh_token');
    }

    const expiresInSec = response.data.expires_in ?? 1800;
    const now = Date.now();
    return {
      accessToken,
      refreshToken,
      accessExpiresAt: now + expiresInSec * 1000,
      refreshExpiresAt: nextRefresh
        ? now + getSchwabRefreshTokenTtlMs()
        : existing?.refreshExpiresAt ?? now + getSchwabRefreshTokenTtlMs(),
    };
  }
}

function pruneExpiredStates(): void {
  const now = Date.now();
  for (const [state, pending] of pendingByState) {
    if (pending.expiresAt <= now) {
      pendingByState.delete(state);
    }
  }
}

function readTokens(): SchwabTokenSet | null {
  try {
    if (!fs.existsSync(TOKEN_PATH)) {
      return null;
    }
    const parsed = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8')) as Partial<
      SchwabTokenSet
    >;
    if (
      typeof parsed.accessToken !== 'string' ||
      typeof parsed.refreshToken !== 'string' ||
      typeof parsed.accessExpiresAt !== 'number' ||
      typeof parsed.refreshExpiresAt !== 'number'
    ) {
      return null;
    }
    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      accessExpiresAt: parsed.accessExpiresAt,
      refreshExpiresAt: parsed.refreshExpiresAt,
    };
  } catch {
    return null;
  }
}

function writeTokens(tokens: SchwabTokenSet): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(TOKEN_PATH, `${JSON.stringify(tokens, null, 2)}\n`, 'utf8');
}
