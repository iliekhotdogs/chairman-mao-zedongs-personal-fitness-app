import { outgoingMessage, parseChatMarkdown } from '../coaching/chatText';
import { simulateCoachReply } from '../coaching/coachSim';
import { functionErrorMessage } from '../ai/provider';
import { buildSampleState } from '../sampleData';

const TODAY = '2026-10-02';

describe('coach sim fallbacks', () => {
  const s = { ...buildSampleState('dev', TODAY), proposals: [] };
  it('greets briefly', () => {
    const r = simulateCoachReply(s, 'hi', TODAY);
    expect(r.text.length).toBeLessThan(80);
    expect(r.text).not.toMatch(/kcal|•/);
  });
  it('is honest on unmatched input', () => {
    for (const m of ['blargh', 'Can penguins swim?']) {
      const r = simulateCoachReply(s, m, TODAY);
      expect(r.text).toMatch(/can't answer that offline/);
      expect(r.text).not.toMatch(/Today's workout|kcal left|•/);
    }
  });
});

describe('parseChatMarkdown', () => {
  it('renders bold, lists and headings without literal markers', () => {
    const b = parseChatMarkdown('## Plan\n**Eat** well\n- one\n* two\n1. three');
    expect(b.map((x) => x.kind)).toEqual(['p', 'p', 'li', 'li', 'li']);
    expect(b[0].parts[0].text).toBe('Plan');
    expect(b[1].parts[0]).toEqual({ text: 'Eat', bold: true });
    expect(b[4].marker).toBe('1.');
    expect(JSON.stringify(b)).not.toMatch(/\*|##/);
  });
});

describe('retry reuse', () => {
  const failed = { id: 'u1', role: 'user' as const, text: 'hello', createdAt: 'a', updatedAt: 'a' };
  it('reuses the failed user message', () => expect(outgoingMessage('hello', failed, 'n', 'b')).toEqual({ msg: failed, isNew: false }));
  it('creates one for a fresh send', () => expect(outgoingMessage('hi', null, 'n', 'b').isNew).toBe(true));
});

describe('functionErrorMessage', () => {
  it('hides raw server strings', async () => expect(await functionErrorMessage(new Error('boom'), 'Friendly.')).toBe('Friendly.'));
  it('keeps known safe ones', async () => expect(await functionErrorMessage(new Error('Your daily AI limit is reached.'), 'x')).toMatch(/limit/));
});

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
