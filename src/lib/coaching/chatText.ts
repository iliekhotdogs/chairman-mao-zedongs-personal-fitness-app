import type { ChatMessage } from '../types';

export type Inline = { text: string; bold?: boolean };
export type Block = { kind: 'p' | 'li'; marker?: string; parts: Inline[] };

/** Splits **bold** (and strips stray `code` ticks) so asterisks never show literally. */
export function inlineParts(s: string): Inline[] {
  const out: Inline[] = [];
  s.replace(/`/g, '').split(/\*\*(.+?)\*\*/g).forEach((chunk, i) => {
    if (chunk) out.push(i % 2 ? { text: chunk, bold: true } : { text: chunk });
  });
  return out;
}

/** Basic markdown for coach bubbles: paragraphs, `-`/`*` and `1.` lists, bold; `##` markers dropped. */
export function parseChatMarkdown(text: string): Block[] {
  return text.split('\n').filter((l) => l.trim()).map((raw) => {
    const line = raw.trim().replace(/^#{1,6}\s+/, '');
    const num = line.match(/^(\d+)[.)]\s+(.*)$/);
    if (num) return { kind: 'li', marker: `${num[1]}.`, parts: inlineParts(num[2]) };
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    if (bullet) return { kind: 'li', marker: '•', parts: inlineParts(bullet[1]) };
    return { kind: 'p', parts: inlineParts(line) };
  });
}

/** Retry reuses the failed user message (no duplicate bubble); a fresh send creates one. */
export function outgoingMessage(body: string, retry: ChatMessage | null, id: string, now: string): { msg: ChatMessage; isNew: boolean } {
  return retry ? { msg: retry, isNew: false } : { msg: { id, role: 'user', text: body, createdAt: now, updatedAt: now }, isNew: true };
}
