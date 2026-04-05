import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  const { data, error } = await supabase.from('orders').select('order_id, net_revenue');
  if (error) {
    console.error(error);
    return;
  }
  
  const counts: Record<string, number> = {};
  data.forEach(d => {
    counts[d.order_id] = (counts[d.order_id] || 0) + 1;
  });
  
  const duplicates = Object.entries(counts).filter(([k, v]) => v > 1);
  console.log("Duplicates:", duplicates);
}
test();
