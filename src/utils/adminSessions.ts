import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';

export const DESK_SESSION_COOKIE = 'desk_session';
export const ADMIN_SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const ADMIN_SESSION_MAX_AGE_SEC = Math.floor(ADMIN_SESSION_TTL_MS / 1000);

const DATA_DIR = path.resolve(process.cwd(), 'data');
const SESSIONS_PATH = path.join(DATA_DIR, 'admin-sessions.json');

type SessionStore = Record<string, { exp: number }>;

function readStore(): SessionStore {
  try {
    if (!fs.existsSync(SESSIONS_PATH)) {
      return {};
    }
    const parsed = JSON.parse(fs.readFileSync(SESSIONS_PATH, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed as SessionStore;
  } catch {
    return {};
  }
}

function writeStore(store: SessionStore): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SESSIONS_PATH, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}

function pruneExpired(store: SessionStore, now = Date.now()): SessionStore {
  const next: SessionStore = {};
  for (const [id, entry] of Object.entries(store)) {
    if (entry && typeof entry.exp === 'number' && entry.exp > now) {
      next[id] = entry;
    }
  }
  return next;
}

export function createSession(): { id: string; maxAgeSec: number } {
  const id = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const store = pruneExpired(readStore(), now);
  store[id] = { exp: now + ADMIN_SESSION_TTL_MS };
  writeStore(store);
  return { id, maxAgeSec: ADMIN_SESSION_MAX_AGE_SEC };
}

export function isValidSession(id: string | null | undefined): boolean {
  if (!id) return false;
  const now = Date.now();
  const store = pruneExpired(readStore(), now);
  const entry = store[id];
  if (!entry) {
    writeStore(store);
    return false;
  }
  writeStore(store);
  return true;
}

export function destroySession(id: string | null | undefined): void {
  if (!id) return;
  const store = pruneExpired(readStore());
  delete store[id];
  writeStore(store);
}

export function parseCookies(
  header: string | string[] | undefined
): Record<string, string> {
  const raw = Array.isArray(header) ? header.join(';') : header || '';
  const out: Record<string, string> = {};
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(value);
  }
  return out;
}

export function getSessionIdFromRequest(
  req: http.IncomingMessage
): string | null {
  const cookies = parseCookies(req.headers.cookie);
  const id = cookies[DESK_SESSION_COOKIE]?.trim();
  return id || null;
}

export function requestIsHttps(req: http.IncomingMessage): boolean {
  const proto = req.headers['x-forwarded-proto'];
  if (typeof proto === 'string' && proto.length > 0) {
    return proto.split(',')[0].trim().toLowerCase() === 'https';
  }
  const socket = req.socket as { encrypted?: boolean };
  return Boolean(socket.encrypted);
}

export function buildSessionCookie(
  id: string,
  maxAgeSec: number,
  secure: boolean
): string {
  const parts = [
    `${DESK_SESSION_COOKIE}=${encodeURIComponent(id)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSec}`,
  ];
  if (secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function buildClearSessionCookie(secure: boolean): string {
  const parts = [
    `${DESK_SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}
