/**
 * Tiny logger so failures are never swallowed silently.
 * In development it writes to the console; in production it is quiet unless a
 * reporter (e.g. Sentry) is registered with `setLogReporter`.
 */
export type LogLevel = 'warn' | 'error';
export type LogReporter = (level: LogLevel, scope: string, message: string, error?: unknown) => void;

let reporter: LogReporter | null = null;

/** Register an error reporter (Sentry or similar). Pass null to remove it. */
export function setLogReporter(r: LogReporter | null): void {
  reporter = r;
}

const isDev = typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production';

function emit(level: LogLevel, scope: string, message: string, error?: unknown): void {
  if (isDev && process.env.NODE_ENV !== 'test') {
    (level === 'error' ? console.error : console.warn)(`[${scope}] ${message}`, ...(error === undefined ? [] : [error]));
  }
  try {
    reporter?.(level, scope, message, error);
  } catch {
    // a broken reporter must never break the app
  }
}

export const log = {
  warn: (scope: string, message: string, error?: unknown) => emit('warn', scope, message, error),
  error: (scope: string, message: string, error?: unknown) => emit('error', scope, message, error),
};
