import { useCallback, useEffect, useRef, useState } from 'react';
import type { Language } from '@/lib/i18n';

// Maps the app's language selector to a BCP-47 locale speechSynthesis can
// match against installed voices. Egyptian Arabic isn't its own widely
// available TTS voice, so ar-EG falls back to ar-SA/any ar-* voice the
// platform has — still far better than reading English over Arabic text.
const VOICE_LANG: Record<Language, string> = {
  en: 'en-US',
  ar: 'ar-EG',
  fr: 'fr-FR',
  de: 'de-DE',
  es: 'es-ES',
  zh: 'zh-CN',
  ru: 'ru-RU',
};

function pickVoice(voices: SpeechSynthesisVoice[], language: Language): SpeechSynthesisVoice | null {
  const target = VOICE_LANG[language] || 'en-US';
  const targetBase = target.split('-')[0];
  return (
    voices.find((v) => v.lang === target) ||
    voices.find((v) => v.lang.toLowerCase().startsWith(targetBase)) ||
    voices.find((v) => v.lang.toLowerCase().startsWith('en')) ||
    voices[0] ||
    null
  );
}

/**
 * Reads trip instructions aloud, tied to the app's chosen language — not the
 * device's system language — so a rider who set the app to Arabic hears
 * Arabic instructions even on an English-locale phone, and vice versa.
 * Built on the standard Web Speech API: free, no key, works offline once a
 * voice is installed on-device.
 */
export function useVoiceInstructions(language: Language) {
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [enabled, setEnabled] = useState(() => {
    if (typeof window === 'undefined') return true;
    const stored = window.localStorage.getItem('sikka-voice-enabled');
    return stored === null ? true : stored === 'true';
  });
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setSupported(false);
      return;
    }
    setSupported(true);
    const loadVoices = () => { voicesRef.current = window.speechSynthesis.getVoices(); };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => { window.speechSynthesis.onvoiceschanged = null; };
  }, []);

  const setVoiceEnabled = useCallback((value: boolean) => {
    setEnabled(value);
    window.localStorage.setItem('sikka-voice-enabled', String(value));
    if (!value) window.speechSynthesis.cancel();
  }, []);

  const speak = useCallback((text: string) => {
    if (!supported || !enabled || !text.trim()) return;
    window.speechSynthesis.cancel(); // never queue/overlap — newest instruction wins
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = pickVoice(voicesRef.current, language);
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang || VOICE_LANG[language] || 'en-US';
    utterance.rate = 0.95;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
  }, [supported, enabled, language]);

  const stop = useCallback(() => {
    if (supported) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [supported]);

  useEffect(() => () => { if (supported) window.speechSynthesis.cancel(); }, [supported]);

  return { supported, speaking, enabled, setVoiceEnabled, speak, stop };
}
