import { supabase } from './services/supabase';

async function test() {
  const { data, error } = await supabase.from('orders').select('status');
  if (error) {
    console.error("Error fetching orders:", error);
    return;
  }
  
  const statusCounts: Record<string, number> = {};
  data?.forEach(d => {
    const status = d.status || 'NULL';
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  });
  
  console.log("Status counts:", statusCounts);
}
test();
