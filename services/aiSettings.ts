
import { supabase } from './supabase';
import { AiSettings } from '../types';

export type AiSettingsInput = {
  provider: AiSettings['provider'];
  api_key: string;
  model?: string | null;
  base_url?: string | null;
};

// RLS (owner_manage_ai_settings) sudah membatasi baris ke auth.uid() = user_id,
// jadi select tanpa .eq('user_id', ...) tetap aman - hanya baris milik user yang
// sedang login yang pernah bisa terlihat.
export async function getAiSettings(): Promise<AiSettings | null> {
  const { data, error } = await supabase.from('ai_settings').select('*').maybeSingle();
  if (error) throw error;
  return data as AiSettings | null;
}

export async function saveAiSettings(input: AiSettingsInput): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sesi login tidak ditemukan.');

  const { error } = await supabase.from('ai_settings').upsert({
    user_id: user.id,
    provider: input.provider,
    api_key: input.api_key,
    model: input.model || null,
    base_url: input.base_url || null,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function deleteAiSettings(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase.from('ai_settings').delete().eq('user_id', user.id);
  if (error) throw error;
}

export function maskApiKey(key: string): string {
  if (key.length <= 8) return '••••••••';
  return `${key.slice(0, 4)}${'•'.repeat(Math.min(20, key.length - 8))}${key.slice(-4)}`;
}
