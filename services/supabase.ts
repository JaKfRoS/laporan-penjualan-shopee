
import { createClient } from '@supabase/supabase-js';

// Prioritize environment variables injected by the platform.
// For Vite, we use import.meta.env. For other environments, we fallback to process.env or hardcoded values.
const getEnv = (key: string) => {
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[key]) {
    return import.meta.env[key];
  }
  try {
    if (typeof process !== 'undefined' && process.env && process.env[key]) {
      return process.env[key];
    }
  } catch (e) {
    // process might not be defined
  }
  return null;
};

const url = getEnv('VITE_SUPABASE_URL') || getEnv('NEXT_PUBLIC_SUPABASE_URL') || 'https://bsjsqvcrgjqsxvitwudn.supabase.co';
const key = getEnv('VITE_SUPABASE_ANON_KEY') || getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY') || 'sb_publishable_0x5JhYcOGxp57um20O_RkQ_EwwNQvd4';

// Helper to check if the client is pointing to a real project
export const isSupabaseConfigured = () => {
  return url && !url.includes('your-project-url') && key && key !== 'your-anon-key';
};

export const supabase = createClient(url, key);
