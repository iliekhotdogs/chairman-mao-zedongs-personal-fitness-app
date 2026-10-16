const withTimeout = (p: Promise<unknown>, ms: number) => {
  let t: ReturnType<typeof setTimeout>;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error('timeout')), ms); })]).finally(() => clearTimeout(t));
};

/** Best-effort flush + remote sign-out, then ALWAYS wipe local state, so offline or failing network can't leave the previous user's data behind. */
export async function signOutAndWipe(o: { flush: () => Promise<unknown>; signOut: () => Promise<unknown>; reset: () => void; clear: () => Promise<unknown>; timeoutMs?: number }): Promise<{ remoteOk: boolean }> {
  const ms = o.timeoutMs ?? 5000;
  let remoteOk = true;
  for (const step of [o.flush, o.signOut]) {
    try { await withTimeout(Promise.resolve().then(step), ms); } catch { remoteOk = false; }
  }
  o.reset();
  try { await o.clear(); } catch { /* reset already dropped in-memory data; storage failure is non-fatal */ }
  return { remoteOk };
}
