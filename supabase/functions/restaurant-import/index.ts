// Refreshes the shared restaurant catalog from official nutrition pages.
//   POST {} or { source_id }  -> { results: [{ source_id, status, items, note }] }
// Callers: the weekly pg_cron job (service-role key) or a signed-in admin. Never users.
// Only sources with enabled = true are fetched; a source is enabled only after its site's
// robots.txt and terms were checked (restaurant_sources.review_note says why one is off).
// A failed or suspicious parse keeps the previous rows and sets status = 'needs_review'.
import { admin, isAdmin, requestUser } from '../_shared/auth.ts';
import { json as jsonFor, preflight, readJsonBody } from '../_shared/http.ts';
import { PARSERS } from './parsers/index.ts';
import { pdfText } from './parsers/pdfText.ts';
import { decideImport, validateItems } from './validate.ts';

const USER_AGENT = 'FitCoachCatalogBot/1.0 (weekly nutrition refresh)';
const MAX_BYTES = 10_000_000;

async function isServiceRole(request: Request): Promise<boolean> {
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!token || !key) return false;
  const digest = async (s: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  const [a, b] = await Promise.all([digest(token), digest(key)]);
  return a.every((byte, i) => byte === b[i]); // compares fixed-length hashes, not the secrets
}

type Source = { id: string; url: string; parser: string };

async function importSource(source: Source) {
  const now = new Date().toISOString();
  const fail = async (note: string) => {
    await admin.from('restaurant_sources').update({ status: 'needs_review', review_note: note, last_checked_at: now }).eq('id', source.id);
    return { source_id: source.id, status: 'needs_review', items: 0, note };
  };
  const parser = PARSERS[source.parser];
  if (!parser) return fail(`Unknown parser "${source.parser}".`);
  let text: string;
  try {
    const response = await fetch(source.url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) return fail(`Fetch returned HTTP ${response.status}. Previous items kept.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > MAX_BYTES) return fail('Source is larger than 10 MB. Previous items kept.');
    text = parser.format === 'pdf' ? await pdfText(bytes) : new TextDecoder().decode(bytes);
  } catch (error) {
    return fail(`Fetch failed: ${error instanceof Error ? error.message : error}. Previous items kept.`.slice(0, 300));
  }
  let parsed;
  try {
    parsed = validateItems(parser.parse(text, source.url, now));
  } catch (error) {
    return fail(`Parser error: ${error instanceof Error ? error.message : error}. Previous items kept.`.slice(0, 300));
  }
  const { count, error: countError } = await admin.from('restaurant_items').select('id', { count: 'exact', head: true }).eq('source_id', source.id);
  if (countError) throw countError;
  const decision = decideImport(count ?? 0, parsed.items.length, parsed.rejected);
  if (!decision.replace) return fail(decision.note ?? 'Needs review.');
  const { error } = await admin.rpc('replace_restaurant_items', { p_source: source.id, p_items: parsed.items, p_checked_at: now });
  if (error) throw error;
  return { source_id: source.id, status: 'ok', items: parsed.items.length, note: parsed.rejected ? `${parsed.rejected} rows rejected by validation.` : null };
}

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;
  const json = (value: unknown, status = 200) => jsonFor(request, value, status);
  if (!(await isServiceRole(request))) {
    const user = await requestUser(request);
    if (!user || !(await isAdmin(user))) return json({ error: 'Admin only.' }, 403);
  }
  let body: Record<string, unknown>;
  try { body = await readJsonBody(request, 1000, true); } catch { return json({ error: 'Invalid request.' }, 400); }
  let query = admin.from('restaurant_sources').select('id, url, parser').eq('enabled', true);
  if (typeof body.source_id === 'string') query = query.eq('id', body.source_id);
  const { data: sources, error } = await query;
  if (error) return json({ error: 'Restaurant catalog is not set up. Apply the migration first.' }, 503);
  const results = [];
  for (const source of sources ?? []) {
    try { results.push(await importSource(source)); } catch (e) {
      console.error(`restaurant-import ${source.id} failed: ${e instanceof Error ? e.message : JSON.stringify(e)}`);
      results.push({ source_id: source.id, status: 'error', items: 0, note: 'Database error; see function logs.' });
    }
  }
  return json({ results });
});
