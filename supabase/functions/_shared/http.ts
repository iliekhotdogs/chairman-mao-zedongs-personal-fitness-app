// CORS, JSON responses and size-limited body reading shared by every function.
// ALLOWED_ORIGINS (comma separated, e.g. "https://fitcoach.vercel.app,http://localhost:8081")
// pins CORS to the app's origins. Unset means "*" (development).
import { clientIpFrom } from './ip.ts';

const ALLOWED = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',').map((origin) => origin.trim().replace(/\/$/, '')).filter(Boolean);

export function corsHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (!ALLOWED.length) return { ...headers, 'Access-Control-Allow-Origin': '*' };
  const origin = request.headers.get('Origin') ?? '';
  // Native apps send no Origin; CORS does not apply to them.
  return { ...headers, 'Access-Control-Allow-Origin': ALLOWED.includes(origin) ? origin : ALLOWED[0], Vary: 'Origin' };
}

export function json(request: Request, value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { ...corsHeaders(request), 'Content-Type': 'application/json' } });
}

export function preflight(request: Request): Response | null {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request) });
  if (request.method !== 'POST') return json(request, { error: 'POST only' }, 405);
  return null;
}

export class BodyError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** Reads a JSON object body, refusing anything larger than maxBytes. The
 * content-length header is checked first, and the stream is cut off at the
 * limit too, so a missing or false header cannot make us buffer a huge body. */
export async function readJsonBody(request: Request, maxBytes: number, allowEmpty = false): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyError('Request too large.', 413);
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new BodyError('Request too large.', 413);
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const raw = new TextDecoder().decode(bytes);
  if (!raw.trim()) {
    if (allowEmpty) return {};
    throw new BodyError('Invalid JSON.', 400);
  }
  let body: unknown;
  try { body = JSON.parse(raw); } catch { throw new BodyError('Invalid JSON.', 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BodyError('Invalid request.', 400);
  return body as Record<string, unknown>;
}

/** Client IP behind Supabase's proxies; see ip.ts for which header is trusted and why. */
export function clientIp(request: Request): string {
  return clientIpFrom((name) => request.headers.get(name));
}

/** Keyed SHA-256 (HMAC) of the client IP, so rate-limit tables never store raw
 * addresses. Key: the IP_HASH_SECRET secret, or the service-role key when unset
 * (both server-only). Null when the IP is unknown. */
export async function clientIpHash(request: Request): Promise<string | null> {
  const ip = clientIp(request);
  if (ip === 'unknown') return null;
  const secret = Deno.env.get('IP_HASH_SECRET')?.trim() || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || 'fitcoach';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(ip)));
  return Array.from(mac, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export const utcDay = () => new Date().toISOString().slice(0, 10);
