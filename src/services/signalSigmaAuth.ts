import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { SignalSigmaAuthResponse } from '../types';

const API_BASE = 'https://signal-sigma-api-prod-649902632625.europe-west2.run.app';

export type SignalSigmaAuthConfig = {
  refreshToken?: string;
  accessToken?: string;
  email?: string;
  password?: string;
  persistTokens?: boolean;
  envFilePath?: string;
};

type TokenPair = {
  accessToken: string;
  refreshToken: string;
};

function isJwtExpired(token: string, skewSeconds = 60): boolean {
  try {
    const payloadPart = token.split('.')[1];
    if (!payloadPart) {
      return true;
    }
    const payload = JSON.parse(
      Buffer.from(payloadPart, 'base64url').toString('utf8')
    ) as { exp?: number };
    if (typeof payload.exp !== 'number') {
      return false;
    }
    return Date.now() / 1000 >= payload.exp - skewSeconds;
  } catch {
    return true;
  }
}

export class SignalSigmaAuth {
  private refreshToken: string | null;
  private accessToken: string | null;
  private readonly email: string | null;
  private readonly password: string | null;
  private readonly persistTokens: boolean;
  private readonly envFilePath: string;
  private readonly loginEndpoint = `${API_BASE}/api/auth/login`;
  private readonly refreshEndpoint = `${API_BASE}/api/auth/refresh`;
  private authInFlight: Promise<string> | null = null;

  private static shared: SignalSigmaAuth | null = null;

  constructor(config: SignalSigmaAuthConfig | string) {
    if (typeof config === 'string') {
      this.refreshToken = config || null;
      this.accessToken = null;
      this.email = null;
      this.password = null;
      this.persistTokens = false;
      this.envFilePath = path.resolve(process.cwd(), '.env');
      return;
    }

    this.refreshToken = config.refreshToken || null;
    this.accessToken = config.accessToken || null;
    this.email = config.email || null;
    this.password = config.password || null;
    this.persistTokens = config.persistTokens ?? true;
    this.envFilePath = config.envFilePath ?? path.resolve(process.cwd(), '.env');

    if (!this.refreshToken && !(this.email && this.password)) {
      throw new Error(
        'Signal Sigma auth requires SIGNAL_SIGMA_REFRESH_TOKEN or SIGNAL_SIGMA_EMAIL + SIGNAL_SIGMA_PASSWORD'
      );
    }

    if (this.accessToken && isJwtExpired(this.accessToken)) {
      this.accessToken = null;
    }
  }

  static fromEnv(): SignalSigmaAuth {
    const persistEnv = process.env.SIGNAL_SIGMA_PERSIST_TOKENS;
    return new SignalSigmaAuth({
      refreshToken: process.env.SIGNAL_SIGMA_REFRESH_TOKEN,
      accessToken: process.env.SIGNAL_SIGMA_ACCESS_TOKEN,
      email: process.env.SIGNAL_SIGMA_EMAIL,
      password: process.env.SIGNAL_SIGMA_PASSWORD,
      persistTokens: persistEnv === undefined ? true : persistEnv === 'true',
    });
  }

  /** Process-wide auth instance so UI polls reuse the same access token. */
  static sharedFromEnv(): SignalSigmaAuth {
    if (!this.shared) {
      this.shared = SignalSigmaAuth.fromEnv();
    }
    return this.shared;
  }

  async ensureAuthenticated(): Promise<string> {
    if (this.accessToken && !isJwtExpired(this.accessToken)) {
      return this.accessToken;
    }

    if (this.authInFlight) {
      return this.authInFlight;
    }

    this.authInFlight = this.authenticate().finally(() => {
      this.authInFlight = null;
    });
    return this.authInFlight;
  }

  private async authenticate(): Promise<string> {
    this.accessToken = null;

    if (this.refreshToken && !isJwtExpired(this.refreshToken)) {
      try {
        return await this.refreshAccessToken();
      } catch (refreshError) {
        if (!this.canLogin()) {
          throw refreshError;
        }
        console.warn(
          'Refresh token failed; falling back to email/password login...',
          refreshError instanceof Error ? refreshError.message : refreshError
        );
        return await this.login();
      }
    }

    if (this.refreshToken && isJwtExpired(this.refreshToken)) {
      if (!this.canLogin()) {
        throw new Error(
          'Signal Sigma refresh token expired. Set SIGNAL_SIGMA_EMAIL and SIGNAL_SIGMA_PASSWORD to re-authenticate.'
        );
      }
      console.warn('Refresh token expired; logging in with email/password...');
    }

    return await this.login();
  }

  async login(): Promise<string> {
    if (!this.email || !this.password) {
      throw new Error(
        'Email/password login requires SIGNAL_SIGMA_EMAIL and SIGNAL_SIGMA_PASSWORD'
      );
    }

    try {
      const response = await axios.post<SignalSigmaAuthResponse>(
        this.loginEndpoint,
        {
          email: this.email,
          password: this.password,
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      const tokens = this.extractTokens(response.data);
      this.applyTokens(tokens);
      console.log('Signal Sigma login successful');
      return tokens.accessToken;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const detail =
          typeof error.response?.data === 'object'
            ? JSON.stringify(error.response.data)
            : error.response?.statusText;
        throw new Error(
          `Failed to login to Signal Sigma: ${error.response?.status} ${detail}`
        );
      }
      throw error;
    }
  }

  async refreshAccessToken(): Promise<string> {
    if (!this.refreshToken) {
      throw new Error('No refresh token available');
    }

    try {
      const response = await axios.post<SignalSigmaAuthResponse>(
        this.refreshEndpoint,
        {
          refreshToken: this.refreshToken,
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      const tokens = this.extractTokens(response.data);
      this.applyTokens(tokens);
      return tokens.accessToken;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        try {
          const retryResponse = await axios.post<SignalSigmaAuthResponse>(
            this.refreshEndpoint,
            {},
            {
              headers: {
                Authorization: `Bearer ${this.refreshToken}`,
                'Content-Type': 'application/json',
              },
            }
          );
          const tokens = this.extractTokens(retryResponse.data);
          this.applyTokens(tokens);
          return tokens.accessToken;
        } catch {
          throw new Error(
            `Failed to refresh Signal Sigma access token: Both body and header methods failed. ${error.response?.status} ${error.response?.statusText}`
          );
        }
      }

      if (axios.isAxiosError(error)) {
        const detail =
          typeof error.response?.data === 'object'
            ? JSON.stringify(error.response.data)
            : error.response?.statusText;
        throw new Error(
          `Failed to refresh Signal Sigma access token: ${error.response?.status} ${detail}`
        );
      }
      throw error;
    }
  }

  async getAccessToken(): Promise<string> {
    return await this.ensureAuthenticated();
  }

  getCurrentAccessToken(): string | null {
    return this.accessToken;
  }

  getRefreshToken(): string {
    if (!this.refreshToken) {
      throw new Error('No refresh token available');
    }
    return this.refreshToken;
  }

  clearTokens(): void {
    this.accessToken = null;
  }

  private canLogin(): boolean {
    return Boolean(this.email && this.password);
  }

  private extractTokens(responseData: SignalSigmaAuthResponse): TokenPair {
    if (responseData.data?.accessToken && responseData.data?.refreshToken) {
      return {
        accessToken: responseData.data.accessToken,
        refreshToken: responseData.data.refreshToken,
      };
    }

    const flat = responseData as unknown as {
      accessToken?: string;
      refreshToken?: string;
    };
    if (flat.accessToken && flat.refreshToken) {
      return {
        accessToken: flat.accessToken,
        refreshToken: flat.refreshToken,
      };
    }

    throw new Error('Invalid response structure: tokens not found in response');
  }

  private applyTokens(tokens: TokenPair): void {
    this.accessToken = tokens.accessToken;
    this.refreshToken = tokens.refreshToken;
    process.env.SIGNAL_SIGMA_REFRESH_TOKEN = tokens.refreshToken;
    process.env.SIGNAL_SIGMA_ACCESS_TOKEN = tokens.accessToken;

    if (this.persistTokens) {
      this.persistRefreshTokenToEnv(tokens.refreshToken);
    }
  }

  private persistRefreshTokenToEnv(refreshToken: string): void {
    try {
      if (!fs.existsSync(this.envFilePath)) {
        return;
      }

      const current = fs.readFileSync(this.envFilePath, 'utf8');
      const next = current.includes('SIGNAL_SIGMA_REFRESH_TOKEN=')
        ? current.replace(
            /^SIGNAL_SIGMA_REFRESH_TOKEN=.*$/m,
            `SIGNAL_SIGMA_REFRESH_TOKEN=${refreshToken}`
          )
        : `${current.trimEnd()}\nSIGNAL_SIGMA_REFRESH_TOKEN=${refreshToken}\n`;

      if (next !== current) {
        fs.writeFileSync(this.envFilePath, next, 'utf8');
      }
    } catch (error) {
      console.warn(
        'Could not persist refresh token to .env:',
        error instanceof Error ? error.message : error
      );
    }
  }
}
