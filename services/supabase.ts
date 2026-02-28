
import { createClient } from '@supabase/supabase-js';

// Prioritize environment variables injected by the platform or vite.config.ts
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL || '';
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Helper to check if the client is pointing to a real project
export const isSupabaseConfigured = () => {
  return !!(url && url.startsWith('http') && key);
};

// Create client only if configured, otherwise return a dummy or null
// We export a proxy or a safe object to avoid crashes on import
export const supabase = isSupabaseConfigured() 
  ? createClient(url, key)
  : new Proxy({} as any, {
      get: (target, prop) => {
        if (prop === 'auth') return { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }), getSession: async () => ({ data: { session: null }, error: null }), signOut: async () => ({ error: null }) };
        return () => ({ from: () => ({ select: () => ({ eq: () => ({ order: () => ({}) }) }) }), rpc: () => ({}) });
      }
    });

