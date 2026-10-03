import { Platform } from 'react-native';
import { coachSystemPrompt, extractJson, parseIntents, type ModelTest, type NvidiaIntent } from './nvidia';

export const GEMINI_DEFAULT_MODEL = 'gemini-3.8-flash';
export const GEMINI_SUGGESTED_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash-lite'];
const TIMEOUT_MS = 90_000;

export class GeminiError extends Error {
  constructor(message: string, readonly status?: number) { super(message); }
}

function endpoint(model: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(model)) throw new GeminiError('Enter a valid Gemini model ID.');
  const base = Platform.OS === 'web' && typeof window !== 'undefined'
    ? `${window.location.origin}/__gemini/v1beta`
    : 'https://generativelanguage.googleapis.com/v1beta';
  return `${base}/models/${model}:generateContent`;
}

type Turn = { role: 'user' | 'assistant'; content: string };

async function generate(args: {
  key: string;
  model: string;
  prompt: string;
  history?: Turn[];
  system?: string;
  maxTokens?: number;
}): Promise<string> {
  const history = (args.history ?? []).slice(-12).map((turn) => ({
    role: turn.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: turn.content.slice(0, 2000) }],
  }));
  while (history.length && history[0].role !== 'user') history.shift();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(endpoint(args.model), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': args.key.trim() },
      body: JSON.stringify({
        ...(args.system ? { systemInstruction: { parts: [{ text: args.system }] } } : {}),
        contents: [...history, { role: 'user', parts: [{ text: args.prompt.slice(0, 2000) }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: args.maxTokens ?? 4096,
          ...(args.model.startsWith('gemini-3.') ? { thinkingConfig: { thinkingLevel: 'low' } } : {}),
        },
      }),
      signal: ctrl.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new GeminiError('Gemini did not answer within 90 seconds. Try again.');
    throw new GeminiError(Platform.OS === 'web'
      ? 'Could not reach Gemini. The web version needs the Expo development server running.'
      : 'Could not reach Gemini. Check your internet connection.');
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    if (response.status === 400) throw new GeminiError('Gemini rejected this request. Check the selected model in Settings → AI.', 400);
    if (response.status === 401 || response.status === 403) throw new GeminiError('Gemini rejected the API key. Check it in Google AI Studio and Settings → AI.', response.status);
    if (response.status === 404) throw new GeminiError(`Gemini model "${args.model}" is unavailable to this key. Choose another model.`, 404);
    if (response.status === 429) throw new GeminiError('Gemini rate limit or quota reached. Try again later.', 429);
    throw new GeminiError(`Gemini request failed (${response.status}).`, response.status);
  }

  let data: { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[] };
  try { data = await response.json(); }
  catch { throw new GeminiError('Gemini sent an unreadable reply.'); }
  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts?.filter((part) => !part.thought).map((part) => part.text ?? '').join('').trim();
  if (!text) throw new GeminiError(candidate?.finishReason === 'SAFETY' ? 'Gemini blocked this reply for safety.' : candidate?.finishReason === 'MAX_TOKENS' ? 'Gemini ran out of output tokens before answering. Try again.' : 'Gemini sent an empty reply.');
  return text;
}

export async function testGemini(key: string, model: string): Promise<ModelTest> {
  const start = Date.now();
  try {
    await generate({ key, model, prompt: 'Reply with the single word OK.', maxTokens: 1024 });
    return { ok: true, seconds: Math.round((Date.now() - start) / 100) / 10 };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), seconds: Math.round((Date.now() - start) / 100) / 10 };
  }
}

export async function geminiCoach(args: {
  key: string;
  model: string;
  message: string;
  history: Turn[];
  context: unknown;
  tone: 'supportive' | 'direct';
}): Promise<{ reply: string; safety: boolean; intents: NvidiaIntent[] }> {
  const text = await generate({
    key: args.key,
    model: args.model,
    prompt: args.message,
    history: args.history,
    system: coachSystemPrompt(args.context, args.tone),
  });
  try {
    const data = extractJson(text);
    const reply = typeof data.reply === 'string' ? data.reply.trim() : '';
    if (!reply) throw new GeminiError('Gemini sent an empty coach reply.');
    return { reply, safety: data.safety === true, intents: parseIntents(data.intents) };
  } catch {
    if (text.startsWith('{')) throw new GeminiError('Gemini sent an invalid coach reply.');
    return { reply: text, safety: false, intents: [] };
  }
}
