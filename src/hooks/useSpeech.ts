import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

type Recognition = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function getCtor(): (new () => Recognition) | undefined {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

/**
 * Speech-to-text.
 *  - Web (Chrome/Edge on Windows): uses the browser's Web Speech API.
 *  - Android in Expo Go: not available as an API; users tap the text box and use the
 *    keyboard's microphone (Gboard voice typing), which produces the same text.
 *    A native speech module can be added with a development build later.
 */
export function useSpeech(onText: (text: string) => void) {
  const Ctor = getCtor();
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string>();
  const rec = useRef<Recognition | null>(null);
  const cb = useRef(onText);
  useEffect(() => {
    cb.current = onText;
  }, [onText]);

  useEffect(() => () => rec.current?.abort(), []);

  const start = useCallback(() => {
    if (!Ctor) return;
    setError(undefined);
    const r = new Ctor();
    r.lang = 'en-US';
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.continuous = false;
    r.onresult = (e) => {
      const text = Array.from(e.results).map((res) => res[0]?.transcript ?? '').join(' ').trim();
      if (text) cb.current(text);
    };
    r.onerror = (e) => {
      setError(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'Microphone permission was denied. Allow it in your browser\'s site settings, or type instead.' : e.error === 'no-speech' ? "Didn't catch that. Try again." : `Voice input error: ${e.error}`);
    };
    r.onend = () => setListening(false);
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      setError('Voice input could not start.');
    }
  }, [Ctor]);

  const stop = useCallback(() => rec.current?.stop(), []);

  return { supported: Boolean(Ctor), listening, error, start, stop };
}
