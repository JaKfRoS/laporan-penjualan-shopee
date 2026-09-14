
import { GoogleGenAI } from '@google/genai';
import { AiSettings, AiProvider } from '../types';

// Bring-your-own-key: request LLM langsung dari browser memakai API key milik
// user sendiri (tersimpan di tabel ai_settings, dibatasi RLS per akun). Tidak
// ada proxy backend - konsekuensinya key bisa terlihat lewat DevTools browser
// user itu sendiri (bukan ke user lain), sama seperti pola BYOK di aplikasi
// client-only lainnya.

export const DEFAULT_MODELS: Record<AiProvider, string> = {
  gemini: 'gemini-2.0-flash',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku-latest',
  openai_compatible: 'gpt-4o-mini',
};

export const PROVIDER_LABELS: Record<AiProvider, string> = {
  gemini: 'Google Gemini',
  openai: 'OpenAI',
  anthropic: 'Anthropic Claude',
  openai_compatible: 'Lainnya (kompatibel OpenAI)',
};

export class AiNotConfiguredError extends Error {
  constructor() {
    super('AI belum diatur. Silakan atur API key di halaman Pengaturan.');
    this.name = 'AiNotConfiguredError';
  }
}

const SYSTEM_INSTRUCTION =
  'Anda adalah analis bisnis e-commerce Shopee yang profesional. Berikan saran yang ringkas, berbasis data, ' +
  'dalam bentuk poin-poin memakai format Markdown ("- " di awal tiap poin, dan **teks tebal** untuk istilah penting). ' +
  'Gunakan Bahasa Indonesia.';

function buildPrompt(data: unknown): string {
  return `Analisa data penjualan Shopee berikut dan berikan 3-5 insight yang actionable untuk penjual. Data (JSON): ${JSON.stringify(data)}`;
}

async function callGemini(settings: AiSettings, prompt: string): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: settings.api_key });
  const response = await ai.models.generateContent({
    model: settings.model || DEFAULT_MODELS.gemini,
    contents: prompt,
    config: { systemInstruction: SYSTEM_INSTRUCTION },
  });
  return response.text || '';
}

async function callOpenAiCompatible(settings: AiSettings, prompt: string, baseUrl: string, errorLabel: string): Promise<string> {
  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.api_key}`,
    },
    body: JSON.stringify({
      model: settings.model || DEFAULT_MODELS[settings.provider],
      messages: [
        { role: 'system', content: SYSTEM_INSTRUCTION },
        { role: 'user', content: prompt },
      ],
      temperature: 0.4,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${errorLabel} error ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  return json.choices?.[0]?.message?.content || '';
}

async function callAnthropic(settings: AiSettings, prompt: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': settings.api_key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: settings.model || DEFAULT_MODELS.anthropic,
      max_tokens: 1024,
      system: SYSTEM_INSTRUCTION,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Anthropic error ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  return json.content?.[0]?.text || '';
}

export async function getSalesInsights(data: unknown, settings: AiSettings | null): Promise<string> {
  if (!settings || !settings.api_key) {
    throw new AiNotConfiguredError();
  }
  const prompt = buildPrompt(data);
  let text = '';

  switch (settings.provider) {
    case 'gemini':
      text = await callGemini(settings, prompt);
      break;
    case 'openai':
      text = await callOpenAiCompatible(settings, prompt, 'https://api.openai.com/v1', 'OpenAI');
      break;
    case 'openai_compatible':
      if (!settings.base_url) throw new Error('Base URL belum diatur untuk provider custom.');
      text = await callOpenAiCompatible(settings, prompt, settings.base_url, 'API');
      break;
    case 'anthropic':
      text = await callAnthropic(settings, prompt);
      break;
    default:
      throw new Error(`Provider "${settings.provider}" tidak dikenal.`);
  }

  return text.trim() || 'Tidak ada insight yang bisa dihasilkan dari data periode ini.';
}
