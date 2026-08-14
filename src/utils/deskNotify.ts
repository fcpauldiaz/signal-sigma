import * as fs from 'fs';
import * as path from 'path';
import type { OpenOrderExecutionResult } from '../services/openOrderExecutor';
import type { TradingMode } from './tradierConfig';

export type DeskJobKind = 'rebalance' | 'place-orders' | 'rebalance-and-place';

type PushTokenFile = {
  tokens: string[];
};

type ExpoPushTicket = {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
};

const DATA_DIR = path.resolve(process.cwd(), 'data');
const TOKENS_PATH = path.join(DATA_DIR, 'push-tokens.json');
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_TOKEN_RE = /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/;

export function isExpoPushToken(token: string): boolean {
  return EXPO_TOKEN_RE.test(token.trim());
}

function readTokens(): string[] {
  try {
    if (!fs.existsSync(TOKENS_PATH)) return [];
    const parsed = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8')) as PushTokenFile;
    return Array.isArray(parsed.tokens)
      ? parsed.tokens.filter((token) => typeof token === 'string' && isExpoPushToken(token))
      : [];
  } catch {
    return [];
  }
}

function writeTokens(tokens: string[]): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const unique = [...new Set(tokens)];
  fs.writeFileSync(
    TOKENS_PATH,
    `${JSON.stringify({ tokens: unique }, null, 2)}\n`,
    'utf8'
  );
}

export function registerPushToken(token: string): void {
  const trimmed = token.trim();
  if (!isExpoPushToken(trimmed)) {
    throw new Error('Invalid Expo push token');
  }
  writeTokens([...readTokens(), trimmed]);
}

export function removePushToken(token: string): void {
  writeTokens(readTokens().filter((existing) => existing !== token.trim()));
}

function isOrderResult(value: unknown): value is OpenOrderExecutionResult {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.placedCount === 'number' && typeof record.failedCount === 'number';
}

function jobLabel(kind: DeskJobKind): string {
  if (kind === 'place-orders') return 'Place orders';
  if (kind === 'rebalance-and-place') return 'Rebalance + place';
  return 'Rebalance';
}

function orderBody(result: OpenOrderExecutionResult): string {
  const parts = [
    `placed ${result.placedCount}`,
    `failed ${result.failedCount}`,
    `skipped ${result.skippedCount}`,
  ];
  if (result.confirmedCount > 0) {
    parts.push(`confirmed ${result.confirmedCount}`);
  }
  return parts.join(', ');
}

function shouldSkipIdlePlace(
  onlyIfActivity: boolean,
  kind: DeskJobKind,
  result: unknown
): boolean {
  if (!onlyIfActivity) return false;
  if (kind === 'rebalance') return false;
  if (!isOrderResult(result)) return false;
  return result.placedCount === 0 && result.failedCount === 0;
}

export async function sendDeskNotification(input: {
  title: string;
  body: string;
  href?: string;
}): Promise<void> {
  const tokens = readTokens();
  if (tokens.length === 0) return;

  const messages = tokens.map((to) => ({
    to,
    title: input.title,
    body: input.body,
    sound: 'default' as const,
    data: input.href ? { href: input.href } : {},
  }));

  try {
    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages),
    });
    if (!response.ok) {
      console.error(`Expo push failed: ${response.status} ${response.statusText}`);
      return;
    }
    const payload = (await response.json()) as { data?: ExpoPushTicket[] };
    const tickets = payload.data ?? [];
    tickets.forEach((ticket, index) => {
      if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
        const stale = tokens[index];
        if (stale) removePushToken(stale);
      }
    });
  } catch (error) {
    console.error(
      'Expo push error:',
      error instanceof Error ? error.message : error
    );
  }
}

export async function notifyDeskJob(input: {
  kind: DeskJobKind;
  mode: TradingMode;
  status: 'success' | 'error';
  message?: string;
  result?: unknown;
  onlyIfActivity?: boolean;
}): Promise<void> {
  if (input.status === 'success' && shouldSkipIdlePlace(Boolean(input.onlyIfActivity), input.kind, input.result)) {
    return;
  }

  const title = `${input.mode} ${jobLabel(input.kind)}`;
  let body = input.message?.trim() || (input.status === 'success' ? 'completed' : 'failed');
  if (input.status === 'success' && isOrderResult(input.result)) {
    body = orderBody(input.result);
  }

  await sendDeskNotification({
    title,
    body,
    href: input.kind === 'rebalance' ? '/(tabs)' : '/(tabs)/orders',
  });
}

export async function notifyRebalance(
  mode: TradingMode,
  ok: boolean,
  error?: string
): Promise<void> {
  await notifyDeskJob({
    kind: 'rebalance',
    mode,
    status: ok ? 'success' : 'error',
    message: ok ? 'completed' : error || 'failed',
  });
}

export async function notifyOrders(
  mode: TradingMode,
  result: OpenOrderExecutionResult,
  options?: { onlyIfActivity?: boolean }
): Promise<void> {
  await notifyDeskJob({
    kind: 'place-orders',
    mode,
    status: 'success',
    result,
    onlyIfActivity: options?.onlyIfActivity,
  });
}
