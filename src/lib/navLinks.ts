/**
 * Source links on food items come from synced data and third-party databases,
 * so only open plain https links to the nutrition databases we actually use.
 * Anything else (javascript:, http:, other hosts) is shown as text, not a link.
 */
const EXACT_HOSTS = new Set(['fdc.nal.usda.gov', 'world.openfoodfacts.org']);
const SUFFIX_HOSTS = ['.openfoodfacts.org'];

export function safeSourceUrl(raw: string | undefined | null): string | null {
  if (!raw || typeof raw !== 'string') return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  if (EXACT_HOSTS.has(host) || SUFFIX_HOSTS.some((suffix) => host.endsWith(suffix))) return url.toString();
  return null;
}
