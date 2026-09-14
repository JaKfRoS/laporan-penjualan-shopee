
import { GoogleGenAI } from '@google/genai';
import { AiSettings, AiProvider } from '../types';

// Bring-your-own-key: request LLM langsung dari browser memakai API key milik
// user sendiri (tersimpan di tabel ai_settings, dibatasi RLS per akun). Tidak
// ada proxy backend - konsekuensinya key bisa terlihat lewat DevTools browser
// user itu sendiri (bukan ke user lain), sama seperti pola BYOK di aplikasi
// client-only lainnya.

export const DEFAULT_MODELS: Record<AiProvider, string> = {
  // gemini-2.0-flash sudah tidak tersedia lagi di API Gemini per akun user
  // (dicoba manual, gagal) - gemini-3.6-flash terkonfirmasi jalan.
  gemini: 'gemini-3.6-flash',
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

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const INSIGHT_SYSTEM_INSTRUCTION =
  'Anda adalah analis bisnis e-commerce Shopee yang profesional. Berikan saran yang ringkas, berbasis data, ' +
  'dalam bentuk poin-poin memakai format Markdown ("- " di awal tiap poin, dan **teks tebal** untuk istilah penting). ' +
  'Gunakan Bahasa Indonesia.';

const CHAT_SYSTEM_INSTRUCTION =
  'Anda adalah AI Assistant ShopeeSales - asisten diskusi untuk penjual Shopee. Jawab pertanyaan seputar performa ' +
  'toko (omzet, potongan marketplace, iklan/ACOS/ROAS, produk, strategi bundling, dll) secara ringkas, jelas, dan ' +
  'actionable dalam Bahasa Indonesia, memakai format Markdown ringan ("- " untuk poin, **tebal** untuk istilah penting) ' +
  'bila relevan. Selalu rujuk ke angka pada konteks data toko di bawah ini saat menjawab - jangan mengarang angka yang ' +
  'tidak ada di konteks, dan katakan terus terang kalau suatu data tidak tersedia di konteks.\n\n' +
  'Konteks data toko (hasil analisis periode berjalan):\n';

function buildInsightPrompt(data: unknown): string {
  return `Analisa data penjualan Shopee berikut dan berikan 3-5 insight yang actionable untuk penjual. Data (JSON): ${JSON.stringify(data)}`;
}

// --- Provider callers (multi-turn: `messages` bisa 1 baris (insight) atau riwayat percakapan penuh (chat)) ---

async function callGemini(settings: AiSettings, messages: ChatMessage[], systemInstruction: string): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: settings.api_key });
  const contents = messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const response = await ai.models.generateContent({
    model: settings.model || DEFAULT_MODELS.gemini,
    contents,
    config: { systemInstruction },
  });
  return response.text || '';
}

async function callOpenAiCompatible(settings: AiSettings, messages: ChatMessage[], systemInstruction: string, baseUrl: string, errorLabel: string): Promise<string> {
  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.api_key}`,
    },
    body: JSON.stringify({
      model: settings.model || DEFAULT_MODELS[settings.provider],
      messages: [
        { role: 'system', content: systemInstruction },
        ...messages.map(m => ({ role: m.role, content: m.content })),
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

async function callAnthropic(settings: AiSettings, messages: ChatMessage[], systemInstruction: string): Promise<string> {
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
      system: systemInstruction,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Anthropic error ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  return json.content?.[0]?.text || '';
}

async function callProvider(settings: AiSettings, messages: ChatMessage[], systemInstruction: string): Promise<string> {
  switch (settings.provider) {
    case 'gemini':
      return callGemini(settings, messages, systemInstruction);
    case 'openai':
      return callOpenAiCompatible(settings, messages, systemInstruction, 'https://api.openai.com/v1', 'OpenAI');
    case 'openai_compatible':
      if (!settings.base_url) throw new Error('Base URL belum diatur untuk provider custom.');
      return callOpenAiCompatible(settings, messages, systemInstruction, settings.base_url, 'API');
    case 'anthropic':
      return callAnthropic(settings, messages, systemInstruction);
    default:
      throw new Error(`Provider "${settings.provider}" tidak dikenal.`);
  }
}

export async function getSalesInsights(data: unknown, settings: AiSettings | null): Promise<string> {
  if (!settings || !settings.api_key) {
    throw new AiNotConfiguredError();
  }
  const prompt = buildInsightPrompt(data);
  const text = await callProvider(settings, [{ role: 'user', content: prompt }], INSIGHT_SYSTEM_INSTRUCTION);
  return text.trim() || 'Tidak ada insight yang bisa dihasilkan dari data periode ini.';
}

// Chat lanjutan berbasis hasil AI Insights - contextSummary berisi ringkasan
// data toko + teks insight yang sudah tampil di kartu, supaya asisten bisa
// jawab pertanyaan follow-up tanpa "lupa" angka yang sudah dianalisis.
export async function chatWithAssistant(messages: ChatMessage[], contextSummary: string, settings: AiSettings | null): Promise<string> {
  if (!settings || !settings.api_key) {
    throw new AiNotConfiguredError();
  }
  const systemInstruction = CHAT_SYSTEM_INSTRUCTION + contextSummary;
  const text = await callProvider(settings, messages, systemInstruction);
  return text.trim() || 'Maaf, saya belum bisa menjawab itu sekarang.';
}
