import type { ComponentType } from 'react';
import * as Sentry from '@sentry/react-native';
import type { Breadcrumb, ErrorEvent } from '@sentry/react-native';

import { setLogReporter, type LogReporter } from './log';

/**
 * Optional crash and error reporting through Sentry. Off unless EXPO_PUBLIC_SENTRY_DSN is
 * set at build time (a DSN is public by design). When off, nothing is initialised or sent.
 *
 * Privacy: FitCoach holds health data, so reports carry only the error, the stack and
 * the app/OS version. `sendDefaultPii` is off; user, request, device name and server
 * name are removed; e-mail addresses are redacted from messages; breadcrumbs are
 * limited to navigation, app lifecycle, our own log lines (without their payload) and
 * network calls without query strings or bodies. No performance tracing, replays or
 * screenshots.
 */

const DSN = (process.env.EXPO_PUBLIC_SENTRY_DSN ?? '').trim().replace(/^(['"])(.*)\1$/, '$2');
export const errorReportingEnabled = /^https:\/\/[^\s]+@[^\s]+\/\d+$/.test(DSN);

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
export const redact = (text: string) => text.replace(EMAIL, '[email]');

const stripQuery = (url: unknown) => (typeof url === 'string' ? url.split(/[?#]/)[0] : undefined);

/** Keeps only breadcrumbs that cannot carry health data or personal details. */
export function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb | null {
  const category = crumb.category ?? '';
  if (category === 'fetch' || category === 'xhr') {
    const data = crumb.data ?? {};
    return { ...crumb, data: { method: data.method, status_code: data.status_code, url: stripQuery(data.url) } };
  }
  if (category === 'navigation') {
    const data = crumb.data ?? {};
    return { ...crumb, data: { from: stripQuery(data.from), to: stripQuery(data.to) } };
  }
  if (category === 'app.lifecycle' || category === 'app.log') {
    return { ...crumb, message: crumb.message ? redact(crumb.message) : crumb.message };
  }
  // console output, touch/ui events (may include typed text or labels), custom data: dropped.
  return null;
}

/** Removes personal fields from an event before it leaves the device. */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  delete event.user;
  delete event.request;
  delete event.server_name;
  if (event.contexts?.device) delete (event.contexts.device as Record<string, unknown>).name;
  if (event.message) event.message = redact(event.message);
  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = redact(ex.value);
  }
  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb).filter((crumb): crumb is Breadcrumb => crumb !== null);
  return event;
}

/** log.error → a Sentry event; log.warn → a breadcrumb that gives context to a later error. */
export const sentryLogReporter: LogReporter = (level, scope, message, error) => {
  if (level === 'warn') {
    const name = error instanceof Error ? `: ${error.name}` : '';
    Sentry.addBreadcrumb({ category: 'app.log', level: 'warning', message: redact(`[${scope}] ${message}${name}`) });
    return;
  }
  const exception = error instanceof Error ? error : new Error(message);
  // Non-Error values (Supabase error objects, strings) may hold row data; only their message is kept.
  Sentry.captureException(exception, { tags: { scope }, extra: { logMessage: redact(message) } });
};

let initialized = false;

/** Call once at startup (src/app/_layout.tsx). A no-op without a DSN. */
export function initErrorReporting(): void {
  if (!errorReportingEnabled || initialized) return;
  initialized = true;
  Sentry.init({
    dsn: DSN,
    environment: __DEV__ ? 'development' : 'production',
    sendDefaultPii: false,
    tracesSampleRate: 0,
    attachScreenshot: false,
    attachViewHierarchy: false,
    maxBreadcrumbs: 50,
    beforeBreadcrumb: scrubBreadcrumb,
    beforeSend: scrubEvent,
  });
  setLogReporter(sentryLogReporter);
}

/** Wraps the root component for Sentry's touch and error boundaries when reporting is on. */
export function withErrorReporting<P extends Record<string, unknown>>(Root: ComponentType<P>): ComponentType<P> {
  return errorReportingEnabled ? Sentry.wrap(Root) : Root;
}
