import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Dibuat lazy (bukan langsung di top-level module) supaya kalau env var belum
// diset, errornya muncul sebagai respons JSON yang jelas lewat withErrorHandling
// di tiap handler - bukan crash function mentah (FUNCTION_INVOCATION_FAILED)
// tanpa pesan apa pun seperti yang terjadi sebelum perbaikan ini.
let client: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'SUPABASE_URL dan/atau SUPABASE_SERVICE_ROLE_KEY belum diset di Environment Variables Vercel. Tambahkan lalu redeploy.'
    );
  }
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}
