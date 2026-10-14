import type { ErrorEvent } from '@sentry/react-native';
import { errorReportingEnabled, initErrorReporting, redact, scrubBreadcrumb, scrubEvent, sentryLogReporter } from '../errorReporting';

jest.mock('@sentry/react-native', () => ({
  __esModule: true, init: jest.fn(), addBreadcrumb: jest.fn(), captureException: jest.fn(), wrap: jest.fn((c: unknown) => c),
}));
const mockSentry = jest.requireMock('@sentry/react-native') as Record<'init' | 'addBreadcrumb' | 'captureException', jest.Mock>;

describe('error reporting', () => {
  beforeEach(() => jest.clearAllMocks());

  it('is off without EXPO_PUBLIC_SENTRY_DSN and never initialises Sentry', () => {
    expect(errorReportingEnabled).toBe(false);
    initErrorReporting();
    expect(mockSentry.init).not.toHaveBeenCalled();
  });

  it('keeps network breadcrumbs without query strings or bodies', () => {
    const crumb = scrubBreadcrumb({
      category: 'fetch',
      data: { method: 'GET', status_code: 200, url: 'https://x.supabase.co/rest/v1/records?user_id=eq.abc&select=data', request_body: '{"weightKg":80}' },
    });
    expect(crumb?.data).toEqual({ method: 'GET', status_code: 200, url: 'https://x.supabase.co/rest/v1/records' });
  });

  it('drops console and touch breadcrumbs, which can contain user data', () => {
    expect(scrubBreadcrumb({ category: 'console', message: 'weight 80kg' })).toBeNull();
    expect(scrubBreadcrumb({ category: 'touch', message: 'Pressed "Log 650 kcal"' })).toBeNull();
    expect(scrubBreadcrumb({ category: 'app.log', message: 'sign-in failed for a@b.co' })?.message).toBe('sign-in failed for [email]');
  });

  it('strips personal fields from events', () => {
    const event = {
      type: undefined,
      message: 'failed for someone@example.com',
      user: { id: 'u', email: 'someone@example.com', ip_address: '1.2.3.4' },
      request: { url: 'https://x', data: '{"food":"pizza"}' },
      server_name: 'Wesley-iPhone',
      contexts: { device: { name: "Wesley's iPhone", model: 'iPhone' } },
      exception: { values: [{ type: 'Error', value: 'No row for someone@example.com' }] },
      breadcrumbs: [{ category: 'console', message: 'x' }, { category: 'navigation', data: { from: '/a?x=1', to: '/b' } }],
    } as unknown as ErrorEvent;
    const out = scrubEvent(event);
    expect(out.user).toBeUndefined();
    expect(out.request).toBeUndefined();
    expect(out.server_name).toBeUndefined();
    expect(out.contexts?.device).toEqual({ model: 'iPhone' });
    expect(out.message).toBe('failed for [email]');
    expect(out.exception?.values?.[0].value).toBe('No row for [email]');
    expect(out.breadcrumbs).toEqual([{ category: 'navigation', data: { from: '/a', to: '/b' } }]);
  });

  it('sends log.error as an exception and log.warn as a breadcrumb without the error payload', () => {
    sentryLogReporter('warn', 'sync', 'Sync failed.', { message: 'row data', details: { weightKg: 80 } });
    expect(mockSentry.addBreadcrumb).toHaveBeenCalledWith({ category: 'app.log', level: 'warning', message: '[sync] Sync failed.' });
    const error = new Error('boom');
    sentryLogReporter('error', 'store', 'Could not persist state.', error);
    expect(mockSentry.captureException).toHaveBeenCalledWith(error, { tags: { scope: 'store' }, extra: { logMessage: 'Could not persist state.' } });
    sentryLogReporter('error', 'store', 'Plain failure', { data: 'secret' });
    expect((mockSentry.captureException.mock.calls[1][0] as Error).message).toBe('Plain failure');
  });

  it('redacts e-mail addresses', () => {
    expect(redact('a.b+c@d-e.org and x@y.io')).toBe('[email] and [email]');
  });
});
