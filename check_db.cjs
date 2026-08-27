const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function run() {
  const { data, error } = await supabase
    .from('income_reports')
    .select('order_id, net_revenue, product_total, service_fee')
    .order('net_revenue', { ascending: false })
    .limit(10);
  console.log(data);
}
run();
