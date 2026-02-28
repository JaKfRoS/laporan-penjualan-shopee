
import { createClient } from '@supabase/supabase-js';

// Prioritize environment variables injected by the platform.
// The user provided these specific values:
// NEXT_PUBLIC_SUPABASE_URL=https://bsjsqvcrgjqsxvitwudn.supabase.co
// NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_0x5JhYcOGxp57um20O_RkQ_EwwNQvd4

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://bsjsqvcrgjqsxvitwudn.supabase.co';
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_0x5JhYcOGxp57um20O_RkQ_EwwNQvd4';

// Helper to check if the client is pointing to a real project
export const isSupabaseConfigured = () => {
  return url && !url.includes('your-project-url') && key && key !== 'your-anon-key';
};

export const supabase = createClient(url, key);
