import { validateSupabaseConfig } from '../integrations/config';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

describe('in-app Supabase configuration', () => {
  const url = 'https://example-project.supabase.co';

  it('accepts a project URL and publishable key', () => {
    expect(validateSupabaseConfig(url, 'sb_publishable_example')).toBeNull();
  });

  it('rejects secret and service-role keys', () => {
    expect(validateSupabaseConfig(url, 'sb_secret_example')).not.toBeNull();
    expect(validateSupabaseConfig(url, 'eyJservice_role')).not.toBeNull();
  });

  it('rejects non-project URLs and insecure transport', () => {
    expect(validateSupabaseConfig('http://example-project.supabase.co', 'sb_publishable_example')).not.toBeNull();
    expect(validateSupabaseConfig('https://evil.example.com', 'sb_publishable_example')).not.toBeNull();
  });
});
