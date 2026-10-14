import { safeSourceUrl } from '@/lib/navLinks';

describe('safeSourceUrl', () => {
  it('allows https links to the nutrition databases', () => {
    expect(safeSourceUrl('https://fdc.nal.usda.gov/fdc-app.html#/food-details/123/nutrients')).toBe('https://fdc.nal.usda.gov/fdc-app.html#/food-details/123/nutrients');
    expect(safeSourceUrl('https://world.openfoodfacts.org/product/3017620422003')).toBe('https://world.openfoodfacts.org/product/3017620422003');
    expect(safeSourceUrl('https://fr.openfoodfacts.org/produit/1')).toBe('https://fr.openfoodfacts.org/produit/1');
  });

  it('rejects other schemes, hosts and lookalikes', () => {
    expect(safeSourceUrl('javascript:alert(1)')).toBeNull();
    expect(safeSourceUrl('http://world.openfoodfacts.org/product/1')).toBeNull();
    expect(safeSourceUrl('https://evil.example/https://fdc.nal.usda.gov')).toBeNull();
    expect(safeSourceUrl('https://openfoodfacts.org.evil.example/')).toBeNull();
    expect(safeSourceUrl('https://notopenfoodfacts.org/')).toBeNull();
    expect(safeSourceUrl('https://user:pw@world.openfoodfacts.org/')).toBeNull();
    expect(safeSourceUrl('https://world.openfoodfacts.org:8443/')).toBeNull();
    expect(safeSourceUrl('data:text/html,hi')).toBeNull();
    expect(safeSourceUrl('not a url')).toBeNull();
    expect(safeSourceUrl(undefined)).toBeNull();
    expect(safeSourceUrl('')).toBeNull();
  });
});
