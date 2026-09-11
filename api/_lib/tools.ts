import { getSupabaseAdmin } from './db';

// Logika tool sama persis dengan supabase/functions/mcp-server/index.ts (versi
// Deno yang dipakai lewat token statis di Claude Code) - dipusatkan di sini
// untuk jalur OAuth (custom connector) supaya keduanya konsisten.

const PPN_IKLAN_RATE = 0.11;

async function getOwnedStores(userId: string, namaToko?: string) {
  const supabaseAdmin = getSupabaseAdmin();
  const { data, error } = await supabaseAdmin.from('stores').select('id, name').eq('user_id', userId);
  if (error) throw new Error(error.message);
  const stores = data || [];
  if (!namaToko) return stores;
  const needle = namaToko.toLowerCase();
  return stores.filter(s => s.name.toLowerCase().includes(needle));
}

function textResult(payload: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

function errorResult(message: string) {
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}

export const TOOLS = [
  {
    name: 'list_toko',
    description: 'Daftar toko yang terhubung ke akun ini.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'rekap_penjualan',
    description: 'Rekap total penjualan (jumlah pesanan, omzet, net revenue, potongan marketplace) untuk rentang tanggal tertentu, berdasarkan tanggal pesanan.',
    inputSchema: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'Tanggal mulai, format YYYY-MM-DD' },
        end_date: { type: 'string', description: 'Tanggal akhir, format YYYY-MM-DD' },
        nama_toko: { type: 'string', description: 'Nama toko spesifik (boleh sebagian). Kosongkan untuk semua toko di akun ini.' },
      },
      required: ['start_date', 'end_date'],
      additionalProperties: false,
    },
  },
  {
    name: 'status_iklan',
    description: 'Ringkasan performa iklan Shopee minggu terbaru per nama iklan: biaya (sudah disesuaikan PPN 11% kalau perlu), omzet, ACOS, ROAS, dan status kesehatan dibanding target toko.',
    inputSchema: {
      type: 'object',
      properties: {
        nama_toko: { type: 'string', description: 'Nama toko spesifik (boleh sebagian). Kosongkan untuk semua toko di akun ini.' },
      },
      additionalProperties: false,
    },
  },
];

export async function callTool(userId: string, name: string, args: Record<string, any>) {
  const supabaseAdmin = getSupabaseAdmin();

  if (name === 'list_toko') {
    const stores = await getOwnedStores(userId);
    return textResult(stores);
  }

  if (name === 'rekap_penjualan') {
    const { start_date, end_date, nama_toko } = args || {};
    if (!start_date || !end_date) return errorResult('start_date dan end_date wajib diisi.');
    const stores = await getOwnedStores(userId, nama_toko);
    if (stores.length === 0) return errorResult(`Toko "${nama_toko}" tidak ditemukan di akun ini.`);
    const storeIds = stores.map(s => s.id);

    const { data: orders, error } = await supabaseAdmin
      .from('orders')
      .select('product_total, net_revenue, total_discount, seller_voucher, admin_fee, service_fee')
      .in('store_id', storeIds)
      .gte('order_date', start_date)
      .lte('order_date', end_date);
    if (error) return errorResult(error.message);

    const totals = (orders || []).reduce(
      (acc, o) => ({
        jumlah_pesanan: acc.jumlah_pesanan + 1,
        omzet: acc.omzet + (o.product_total || 0),
        net_revenue: acc.net_revenue + (o.net_revenue || 0),
        potongan_marketplace: acc.potongan_marketplace + (o.total_discount || 0) + (o.seller_voucher || 0) + (o.admin_fee || 0) + (o.service_fee || 0),
      }),
      { jumlah_pesanan: 0, omzet: 0, net_revenue: 0, potongan_marketplace: 0 }
    );

    return textResult({ periode: `${start_date} s/d ${end_date}`, toko: stores.map(s => s.name), ...totals });
  }

  if (name === 'status_iklan') {
    const { nama_toko } = args || {};
    const stores = await getOwnedStores(userId, nama_toko);
    if (stores.length === 0) return errorResult(`Toko "${nama_toko}" tidak ditemukan di akun ini.`);
    const storeIds = stores.map(s => s.id);
    const storeNameById = new Map(stores.map(s => [s.id, s.name]));

    const [{ data: rows, error: rErr }, { data: targets, error: tErr }] = await Promise.all([
      supabaseAdmin.from('iklan_mingguan').select('*').in('store_id', storeIds).order('periode_mulai', { ascending: false }),
      supabaseAdmin.from('iklan_kpi_target').select('*').in('store_id', storeIds),
    ]);
    if (rErr) return errorResult(rErr.message);
    if (tErr) return errorResult(tErr.message);

    const targetByStore = new Map((targets || []).map(t => [t.store_id, t]));
    const latestByKey = new Map<string, any>();
    (rows || []).forEach(r => {
      const key = `${r.store_id}::${r.nama_iklan_raw}`;
      if (!latestByKey.has(key)) latestByKey.set(key, r); // rows terurut desc -> pertama = minggu terbaru
    });

    const result = Array.from(latestByKey.values()).map(r => {
      const target = targetByStore.get(r.store_id) || { target_acos: 30, target_roas: 3, biaya_termasuk_ppn: false };
      const biaya = target.biaya_termasuk_ppn ? r.biaya : r.biaya * (1 + PPN_IKLAN_RATE);
      const acos = r.omzet > 0 ? (biaya / r.omzet) * 100 : 0;
      const roas = biaya > 0 ? r.omzet / biaya : 0;
      const status = acos > target.target_acos ? 'waspada' : 'sehat';
      return {
        toko: storeNameById.get(r.store_id),
        nama_iklan: r.nama_iklan_raw,
        periode: `${r.periode_mulai} s/d ${r.periode_akhir}`,
        biaya: Math.round(biaya),
        omzet: r.omzet,
        acos: Number(acos.toFixed(1)),
        roas: Number(roas.toFixed(2)),
        target_acos: target.target_acos,
        status,
      };
    });

    return textResult(result);
  }

  return errorResult(`Tool "${name}" tidak dikenal.`);
}
