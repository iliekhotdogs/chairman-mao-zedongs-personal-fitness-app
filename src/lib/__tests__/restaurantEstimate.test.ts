import { toEstimate } from '../ai/provider';

jest.mock('../sync/supabase', () => ({ isSupabaseConfigured: () => true, supabase: () => null }));

const base = {
  items: [{ name: 'Chicken parm', portion: '1 plate', grams: 450, calories: 700, protein_g: 40, carbs_g: 60, fat_g: 30, confidence: 'medium' as const, portion_assumption: 'Full plate', source_kind: 'visual_estimate' as const, source_label: 'Visual estimate' }],
  overall_confidence: 'medium' as const, notes: [], model: 'm',
};
const candidate = { name: 'Chicken Parmigiana', serving: 'as served', calories: 1020, protein_g: 64, carbs_g: 80, fat_g: 51, source_url: 'https://example.com/n.pdf', checked_at: '2026-10-15T00:00:00Z', stale: false, disagreement: 'much lower' };

describe('estimate_food restaurant candidates', () => {
  it('maps official candidates to editable food items with source and date', () => {
    const est = toEstimate({ ...base, restaurant: { name: 'Olive Garden', supported: true, note: null, candidates: [candidate, { ...candidate, name: 'Old', stale: true }] } }, {});
    expect(est.items[0].source.kind).toBe('visual_estimate');
    const [first, second] = est.restaurant!.candidates;
    expect(first.item).toMatchObject({ name: 'Chicken Parmigiana', calories: 1020, proteinG: 64, source: { kind: 'official_restaurant', url: candidate.source_url, sourced: true } });
    expect(first.item.source.label).toBe('Olive Garden official nutrition, checked 2026-10-15');
    expect(first.disagreement).toBe('much lower');
    expect(second.stale).toBe(true);
    expect(second.item.source.label).toContain('may be out of date');
  });

  it('drops invalid candidates and passes the unknown-restaurant note through', () => {
    const est = toEstimate({ ...base, restaurant: { name: 'Joe’s Diner', supported: false, note: 'Add a label photo.', candidates: [{ ...candidate, calories: -1 }, { ...candidate, source_url: 'javascript:alert(1)' }] } }, {});
    expect(est.restaurant).toEqual({ name: 'Joe’s Diner', supported: false, note: 'Add a label photo.', candidates: [] });
    expect(toEstimate(base, {}).restaurant).toBeUndefined();
  });
});
