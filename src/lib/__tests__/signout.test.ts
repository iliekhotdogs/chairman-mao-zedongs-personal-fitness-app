import { signOutAndWipe } from '../sync/signOut';

const mk = (over: Partial<Parameters<typeof signOutAndWipe>[0]> = {}) => {
  const calls: string[] = [];
  return {
    calls,
    opts: {
      flush: async () => { calls.push('flush'); },
      signOut: async () => { calls.push('signOut'); },
      reset: () => { calls.push('reset'); },
      clear: async () => { calls.push('clear'); },
      ...over,
    },
  };
};

describe('sign out', () => {
  it('flushes, signs out, then resets store and clears storage', async () => {
    const { calls, opts } = mk();
    expect(await signOutAndWipe(opts)).toEqual({ remoteOk: true });
    expect(calls).toEqual(['flush', 'signOut', 'reset', 'clear']);
  });

  it('still wipes local state when flush and signOut fail offline', async () => {
    const { calls, opts } = mk({ flush: async () => { throw new Error('offline'); }, signOut: async () => { throw new Error('offline'); } });
    expect(await signOutAndWipe(opts)).toEqual({ remoteOk: false });
    expect(calls).toEqual(['reset', 'clear']);
  });

  it('does not hang when the network call never resolves', async () => {
    const { calls, opts } = mk({ signOut: () => new Promise(() => {}), timeoutMs: 20 });
    expect((await signOutAndWipe(opts)).remoteOk).toBe(false);
    expect(calls).toContain('clear');
  });
});

describe('delete data on this device', () => {
  it('still wipes locally when the server is unreachable', async () => {
    const { calls, opts } = mk({ signOut: async () => { throw new Error('offline'); } });
    expect(await signOutAndWipe(opts)).toEqual({ remoteOk: false });
    expect(calls).toContain('reset');
    expect(calls).toContain('clear');
  });
});
