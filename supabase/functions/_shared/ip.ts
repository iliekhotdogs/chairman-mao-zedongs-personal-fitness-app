// Client IP selection. Pure TypeScript (no Deno/npm imports) so Jest can test it
// (src/lib/__tests__/edgeShared.test.ts).
//
// Why not the first X-Forwarded-For entry: the client controls it. Requests reach
// Supabase Edge Functions through Cloudflare and Supabase's API gateway, and each proxy
// APPENDS the address it saw to whatever X-Forwarded-For the client sent. A client that
// sends "X-Forwarded-For: 1.2.3.4" arrives as "1.2.3.4, <real ip>", so the leftmost
// entry can be anything the caller wants (observed on Supabase:
// https://github.com/orgs/supabase/discussions/34647 — a spoofed value stays first and
// the real address is appended, while cf-connecting-ip holds the real address).
//
// Order used here:
//   1. cf-connecting-ip: set by Cloudflare to the address that opened the connection;
//      Cloudflare overwrites any value the client sends
//      (https://developers.cloudflare.com/fundamentals/reference/http-headers/#cf-connecting-ip).
//   2. The RIGHTMOST X-Forwarded-For entry: appended by the platform's proxy, not by
//      the client (https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Forwarded-For#security_and_privacy_concerns).
//   3. x-real-ip: only as a last resort, because Supabase does not document who sets it.
// None of this is authentication: it only feeds per-network rate limits.

/** Loose IPv4/IPv6 shape check, so header junk never becomes a rate-limit key. */
const IP_SHAPE = /^[0-9A-Fa-f:.]{2,45}$/;

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim().replace(/^\[|\]$/g, '') ?? '';
  return IP_SHAPE.test(trimmed) ? trimmed : null;
}

/** Best client IP from request headers, or 'unknown'. `get` is Headers#get. */
export function clientIpFrom(get: (name: string) => string | null): string {
  const cf = clean(get('cf-connecting-ip'));
  if (cf) return cf;
  const forwarded = (get('x-forwarded-for') ?? '').split(',').map((part) => part.trim()).filter(Boolean);
  const rightmost = clean(forwarded.at(-1));
  if (rightmost) return rightmost;
  return clean(get('x-real-ip')) ?? 'unknown';
}
