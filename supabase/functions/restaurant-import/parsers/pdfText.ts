// shortcut: minimal PDF text extraction. It inflates FlateDecode content streams and reads
// literal Tj/TJ strings as Windows-1252, one line per text baseline. Enough for the Olive Garden
// Canada guide (simple TrueType fonts, not encrypted); switch to a real PDF library if a source
// uses CID/hex-encoded fonts, object streams for page content, or encryption.

const latin1 = (bytes: Uint8Array) => { let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192)); return s; };

/** Inflated stream text; output decoded before an error (e.g. trailing bytes after the data) is kept. */
async function inflate(data: Uint8Array): Promise<string> {
  const reader = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
  let out = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      out += latin1(value);
    }
  } catch { /* keep what was inflated */ }
  return out;
}

const win1252 = new TextDecoder('windows-1252');
function literal(token: string): string {
  const bytes: number[] = [];
  const body = token.slice(1, -1);
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch !== '\\') { bytes.push(ch.charCodeAt(0) & 0xff); continue; }
    const next = body[++i];
    const octal = /^[0-7]{1,3}/.exec(body.slice(i, i + 3));
    if (octal) { bytes.push(parseInt(octal[0], 8) & 0xff); i += octal[0].length - 1; continue; }
    const map: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12 };
    if (next === '\n' || next === '\r') continue; // line continuation
    bytes.push(map[next] ?? next.charCodeAt(0));
  }
  return win1252.decode(new Uint8Array(bytes));
}

const TOKEN = /\((?:\\[\s\S]|[^\\)])*\)|\[|\]|<[0-9a-fA-F\s]*>|\/[^\s/[\]()<>]+|[-+]?\d*\.?\d+|[A-Za-z'"*]+/g;

/** Text of one content stream: pieces on the same baseline (within 2pt) are joined by tabs. */
export function contentText(content: string): string[] {
  const lines: { y: number; text: string }[] = [];
  let operands: string[] = [];
  let array: string[] | null = null;
  let lineY = 0, y = 0, scale = 1;
  const emit = (text: string) => {
    if (!text.trim()) return;
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - y) < 2) last.text += `\t${text.trim()}`;
    else lines.push({ y, text: text.trim() });
  };
  for (const [token] of content.matchAll(TOKEN)) {
    if (token === '[') { array = []; continue; }
    if (token === ']') { operands.push(JSON.stringify(array ?? [])); array = null; continue; }
    if (array) { array.push(token); continue; }
    if (/^[-+]?\d*\.?\d+$/.test(token) || token[0] === '(' || token[0] === '<' || token[0] === '/') { operands.push(token); continue; }
    const n = operands.map(Number);
    if (token === 'Tm') { scale = n[3] || 1; lineY = y = n[5]; }
    else if (token === 'Td' || token === 'TD') { lineY += n[1] * scale; y = lineY; }
    else if (token === 'T*') { lineY -= scale * 1.2; y = lineY; }
    else if (token === 'Tj' || token === "'") { if (operands[0]?.[0] === '(') emit(literal(operands[operands.length - 1])); }
    else if (token === 'TJ') {
      const parts = JSON.parse(operands[operands.length - 1] ?? '[]') as string[];
      emit(parts.map((p) => p[0] === '(' ? literal(p) : Number(p) < -200 ? ' ' : '').join(''));
    }
    operands = [];
  }
  return lines.map((l) => l.text);
}

/** Text lines of every page-content stream in the PDF, in file order. */
export async function pdfText(bytes: Uint8Array): Promise<string> {
  const raw = latin1(bytes);
  const out: string[] = [];
  for (const m of raw.matchAll(/<<((?:(?!<<)[\s\S]){0,2000}?)>>\s*stream\r?\n/g)) {
    const dict = m[1];
    if (!/\/FlateDecode/.test(dict) || /\/Subtype\s*\/(Image|Type1C)|\/Length1|\/Type\s*\/(XRef|ObjStm)/.test(dict)) continue;
    const start = m.index! + m[0].length;
    // Deflate rejects trailing bytes, so prefer the declared /Length over the endstream marker.
    const length = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
    const end = length ? start + Number(length[1]) : raw.indexOf('endstream', start);
    if (end < start) continue;
    const text = await inflate(bytes.subarray(start, end));
    if (text && /\bBT\b/.test(text)) out.push(...contentText(text));
  }
  return out.join('\n');
}
