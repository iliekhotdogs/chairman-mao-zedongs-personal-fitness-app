import { authErrorMessage, formatHeight, friendlySyncError, isEmail, OFFLINE_MESSAGE, pageTitle } from '../uiText';
import { maxProteinG, parseNumberText } from '../inputRules';

describe('uiText', () => {
  it('maps network sync errors to one friendly line', () => {
    expect(friendlySyncError('Upload failed: TypeError: Failed to fetch')).toBe(OFFLINE_MESSAGE);
    expect(friendlySyncError('Upload failed: permission denied')).toBe('Upload failed: permission denied');
    expect(friendlySyncError(undefined)).toBeUndefined();
  });
  it('maps auth errors', () => {
    expect(authErrorMessage('Invalid login credentials')).toMatch(/don't match/);
    expect(authErrorMessage('Invalid API key')).toMatch(/misconfigured/);
    expect(authErrorMessage('Other')).toBe('Other');
  });
  it('checks emails', () => {
    expect(isEmail(' a@b.co ')).toBe(true);
    expect(isEmail('a@b')).toBe(false);
    expect(isEmail('ab.co')).toBe(false);
  });
  it('formats height per unit system', () => {
    expect(formatHeight(175.26, 'metric')).toBe('175 cm');
    expect(formatHeight(175.26, 'imperial')).toBe('5 ft 9 in');
  });
  it('titles routes, with 404 for unknown paths', () => {
    expect(pageTitle('/')).toBe('Today · FitCoach');
    expect(pageTitle('/food/manual')).toBe('Food · FitCoach');
    expect(pageTitle('/foodie')).toBe('Page not found · FitCoach');
  });
});

describe('input rules', () => {
  it('explains negative numbers', () => {
    expect(parseNumberText('-5').error).toBe("Can't be negative.");
  });
  it('caps protein at 60% of calories', () => {
    expect(maxProteinG(2000)).toBe(300);
  });
});
