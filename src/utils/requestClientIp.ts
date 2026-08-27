import { isIP, isIPv4 } from 'net';
import type { IncomingHttpHeaders, IncomingMessage } from 'http';

export type ClientOrigin = {
  ip: string;
  city?: string;
  country?: string;
};

const SKIP_COUNTRY_CODES = new Set(['XX', 'T1', 'A1', 'A2']);
const COUNTRY_NAMES = new Intl.DisplayNames(['en'], { type: 'region' });

function headerValues(
  headers: IncomingHttpHeaders,
  name: string
): string[] {
  const raw = headers[name];
  const joined = Array.isArray(raw) ? raw.join(',') : raw;
  if (!joined) return [];
  return joined
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function firstHeader(
  headers: IncomingHttpHeaders,
  name: string
): string | undefined {
  return headerValues(headers, name)[0];
}

function normalizeIp(ip: string): string {
  const trimmed = ip.replace(/^\[|\]$/g, '');
  if (trimmed.startsWith('::ffff:')) return trimmed.slice('::ffff:'.length);
  return trimmed;
}

function isPublicIp(ip: string): boolean {
  if (isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 192 && b === 168) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    return true;
  }
  if (isIP(ip) === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return false;
    if (lower.startsWith('fe80:')) return false;
    const firstHex = parseInt(lower.split(':')[0] || '0', 16);
    if ((firstHex & 0xfe00) === 0xfc00) return false;
    return true;
  }
  return false;
}

function collectCandidateIps(req: IncomingMessage): string[] {
  const fromHeaders = [
    ...headerValues(req.headers, 'cf-connecting-ip'),
    ...headerValues(req.headers, 'true-client-ip'),
    ...headerValues(req.headers, 'x-real-ip'),
    ...headerValues(req.headers, 'x-forwarded-for'),
  ];
  const socket = req.socket.remoteAddress;
  const raw = socket ? [...fromHeaders, socket] : fromHeaders;
  const unique: string[] = [];
  for (const value of raw) {
    const ip = normalizeIp(value);
    if (!isIP(ip) || unique.includes(ip)) continue;
    unique.push(ip);
  }
  return unique;
}

export function requestClientIp(req: IncomingMessage): string {
  const candidates = collectCandidateIps(req);
  const publicIps = candidates.filter(isPublicIp);
  return (
    publicIps.find((ip) => isIPv4(ip)) ||
    publicIps[0] ||
    candidates.find((ip) => isIPv4(ip)) ||
    candidates[0] ||
    'unknown'
  );
}

function countryFromCf(headers: IncomingHttpHeaders): string | undefined {
  const code = firstHeader(headers, 'cf-ipcountry')?.trim().toUpperCase();
  if (!code || code.length !== 2 || SKIP_COUNTRY_CODES.has(code)) {
    return undefined;
  }
  try {
    return COUNTRY_NAMES.of(code) || undefined;
  } catch {
    return undefined;
  }
}

export function requestClientOrigin(req: IncomingMessage): ClientOrigin {
  const ip = requestClientIp(req);
  const city = firstHeader(req.headers, 'cf-ipcity')?.trim() || undefined;
  const country = countryFromCf(req.headers);
  return {
    ip,
    ...(city ? { city } : {}),
    ...(country ? { country } : {}),
  };
}

export function formatClientOrigin(origin: ClientOrigin): string {
  return [origin.ip, origin.city, origin.country].filter(Boolean).join(', ');
}
