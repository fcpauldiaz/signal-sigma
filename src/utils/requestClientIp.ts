import type { IncomingHttpHeaders, IncomingMessage } from 'http';

function firstHeader(
  headers: IncomingHttpHeaders,
  name: string
): string | undefined {
  const raw = headers[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return undefined;
  const first = value.split(',')[0]?.trim();
  return first || undefined;
}

function normalizeIp(ip: string): string {
  if (ip.startsWith('::ffff:')) return ip.slice('::ffff:'.length);
  return ip;
}

export function requestClientIp(req: IncomingMessage): string {
  const fromHeaders =
    firstHeader(req.headers, 'cf-connecting-ip') ||
    firstHeader(req.headers, 'true-client-ip') ||
    firstHeader(req.headers, 'x-real-ip') ||
    firstHeader(req.headers, 'x-forwarded-for');
  return normalizeIp(fromHeaders || req.socket.remoteAddress || 'unknown');
}
