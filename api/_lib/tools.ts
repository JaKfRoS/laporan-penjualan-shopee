import { getSupabaseAdmin } from './db.js';
import { applyPpnAdjustment, calcAdsMetrics, resolveHpp, resolveKpiTarget, calcMargin, calcStatusKesehatan } from '../../components/Ads/adsHelpers.js';

// Logika tool sama persis dengan supabase/functions/mcp-server/index.ts (versi
// Deno yang dipakai lewat token statis di Claude Code) - dipusatkan di sini
// untuk jalur OAuth (custom connector) supaya keduanya konsisten.
//
// performa_iklan mengimpor rumus langsung dari components/Ads/adsHelpers.ts
// (dipakai juga oleh AdsCenter.tsx) supaya tidak ada risiko drift rumus
// seperti yang beberapa kali terjadi di fitur lain aplikasi ini.

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
    name: 'rekap_performa_penjualan',
    description:
      'Rekap penjualan berbasis TANGGAL PESANAN DIBUAT (kapan pembeli order) - sama seperti mode "Basis Pesanan Dibuat" di Dashboard. Cocok untuk melihat performa penjualan periode berjalan, termasuk pesanan yang belum tentu sudah cair dananya.',
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
    name: 'rekap_penjualan_selesai',
    description:
      'Rekap penjualan berbasis TANGGAL DANA DILEPASKAN Shopee (release_date) - sama seperti mode "Basis Pesanan Selesai" di Dashboard. Sumber datanya laporan pendanaan (income_reports) digabung dengan orders. Cocok untuk melihat omzet/dana cair yang benar-benar sudah settle di periode ini, terlepas kapan pesanannya dibuat.',
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
    name: 'rekap_keuangan',
    description:
      'Rekap keuangan (fitur Keuangan/Cashflow di aplikasi): Penjualan, Potongan Marketplace, Dana Cair, HPP, dan Laba Kotor untuk rentang tanggal tertentu berbasis tanggal dana dilepaskan (release_date) - sama seperti halaman Keuangan.',
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
    name: 'performa_iklan',
    description:
      'Ringkasan performa iklan Shopee minggu terbaru per nama iklan/produk (fitur Ads & Promosi): biaya (sudah disesuaikan PPN 11% kalau perlu), omzet, ACOS, ROAS, HPP, Margin Setelah Iklan, dan status kesehatan dibanding target (per produk kalau diatur, atau target default toko).',
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

  if (name === 'rekap_performa_penjualan') {
    const { start_date, end_date, nama_toko } = args || {};
    if (!start_date || !end_date) return errorResult('start_date dan end_date wajib diisi.');
    const stores = await getOwnedStores(userId, nama_toko);
    if (stores.length === 0) return errorResult(`Toko "${nama_toko}" tidak ditemukan di akun ini.`);
    const storeIds = stores.map(s => s.id);

    // Agregasi dilakukan di database lewat RPC (bukan tarik semua baris lalu
    // jumlahkan di JS, dan bukan aggregate function di select= - PostgREST di
    // project ini tidak mendukungnya) - PostgREST/Supabase membatasi hasil
    // .select() ke 1000 baris secara default, jadi toko dengan pesanan lebih
    // dari itu akan salah dihitung kalau baris mentahnya ditarik satu-satu.
    //
    // Formula omzet/net_revenue/potongan_marketplace meniru PERSIS logika
    // "Omzet Riil"/"Dana Cair"/"Potongan Marketplace" di Dashboard.tsx: hanya
    // pesanan selesai/retur (bukan batal), omzet pakai fallback product_total
    // -> total_payment (product_total sering 0 kalau header file import tidak
    // cocok), net_revenue pakai fallback dari gmv-fee, dan potongan dihitung
    // dari breakdown fee_details - bukan cuma kolom diskon mentah. Lihat
    // fungsi SQL rekap_penjualan_agg untuk detail lengkapnya.
    const { data, error } = await supabaseAdmin.rpc('rekap_penjualan_agg', {
      p_store_ids: storeIds,
      p_start_date: start_date,
      p_end_date: end_date,
    });
    if (error) return errorResult(error.message);

    const row: any = (data && data[0]) || {};
    const totals = {
      jumlah_pesanan: Number(row.jumlah_pesanan) || 0,
      omzet: Number(row.omzet) || 0,
      net_revenue: Number(row.net_revenue) || 0,
      potongan_marketplace: Number(row.potongan_marketplace) || 0,
    };

    return textResult({ periode: `${start_date} s/d ${end_date}`, toko: stores.map(s => s.name), ...totals });
  }

  if (name === 'rekap_penjualan_selesai') {
    const { start_date, end_date, nama_toko } = args || {};
    if (!start_date || !end_date) return errorResult('start_date dan end_date wajib diisi.');
    const stores = await getOwnedStores(userId, nama_toko);
    if (stores.length === 0) return errorResult(`Toko "${nama_toko}" tidak ditemukan di akun ini.`);
    const storeIds = stores.map(s => s.id);

    // Meniru merge income_reports+orders mode "Basis Pesanan Selesai" -
    // lihat komentar panjang di fungsi SQL rekap_pesanan_selesai_agg.
    const { data, error } = await supabaseAdmin.rpc('rekap_pesanan_selesai_agg', {
      p_store_ids: storeIds,
      p_start_date: start_date,
      p_end_date: end_date,
    });
    if (error) return errorResult(error.message);

    const row: any = (data && data[0]) || {};
    const totals = {
      jumlah_pesanan: Number(row.jumlah_pesanan) || 0,
      omzet: Number(row.omzet) || 0,
      net_revenue: Number(row.dana_cair) || 0,
      potongan_marketplace: Number(row.potongan_fee_details) || 0,
    };

    return textResult({ periode: `${start_date} s/d ${end_date}`, toko: stores.map(s => s.name), ...totals });
  }

  if (name === 'rekap_keuangan') {
    const { start_date, end_date, nama_toko } = args || {};
    if (!start_date || !end_date) return errorResult('start_date dan end_date wajib diisi.');
    const stores = await getOwnedStores(userId, nama_toko);
    if (stores.length === 0) return errorResult(`Toko "${nama_toko}" tidak ditemukan di akun ini.`);
    const storeIds = stores.map(s => s.id);

    // Dataset sama persis dengan rekap_penjualan_selesai (RPC yang sama), tapi
    // "Potongan Marketplace" di halaman Keuangan dihitung sebagai residual
    // (omzet - dana cair) - bukan dari breakdown fee_details - karena
    // fee_details punya celah kecil (mis. penyesuaian dari Shopee) yang bikin
    // breakdown tidak selalu pas. Ini sengaja beda dari rekap_penjualan_selesai
    // supaya masing-masing tool cocok dengan angka di halaman yang ditirunya.
    const { data, error } = await supabaseAdmin.rpc('rekap_pesanan_selesai_agg', {
      p_store_ids: storeIds,
      p_start_date: start_date,
      p_end_date: end_date,
    });
    if (error) return errorResult(error.message);

    const row: any = (data && data[0]) || {};
    const omzet = Number(row.omzet) || 0;
    const danaCair = Number(row.dana_cair) || 0;
    const hpp = Number(row.hpp) || 0;
    const totals = {
      jumlah_pesanan: Number(row.jumlah_pesanan) || 0,
      penjualan: omzet,
      potongan_marketplace: Math.max(0, omzet - danaCair),
      dana_cair: danaCair,
      hpp,
      laba_kotor: danaCair - hpp,
    };

    return textResult({ periode: `${start_date} s/d ${end_date}`, toko: stores.map(s => s.name), ...totals });
  }

  if (name === 'performa_iklan') {
    const { nama_toko } = args || {};
    const stores = await getOwnedStores(userId, nama_toko);
    if (stores.length === 0) return errorResult(`Toko "${nama_toko}" tidak ditemukan di akun ini.`);
    const storeIds = stores.map(s => s.id);
    const storeNameById = new Map(stores.map(s => [s.id, s.name]));

    const [
      { data: rows, error: rErr },
      { data: targets, error: tErr },
      { data: mappings, error: mErr },
      { data: products, error: pErr },
    ] = await Promise.all([
      supabaseAdmin.from('iklan_mingguan').select('*').in('store_id', storeIds).order('periode_mulai', { ascending: false }),
      supabaseAdmin.from('iklan_kpi_target').select('*').in('store_id', storeIds),
      supabaseAdmin.from('iklan_produk_mapping').select('*').in('store_id', storeIds),
      supabaseAdmin.from('products').select('sku, store_id, product_name, cost_price').in('store_id', storeIds),
    ]);
    if (rErr) return errorResult(rErr.message);
    if (tErr) return errorResult(tErr.message);
    if (mErr) return errorResult(mErr.message);
    if (pErr) return errorResult(pErr.message);

    const targetByStore = new Map((targets || []).map(t => [t.store_id, t]));
    const mappingByKey = new Map((mappings || []).map(m => [`${m.store_id}::${m.nama_iklan_raw}`, m]));
    const productByKey = new Map((products || []).map(p => [`${p.store_id}::${p.sku}`, p]));

    const latestByKey = new Map<string, any>();
    (rows || []).forEach(r => {
      const key = `${r.store_id}::${r.nama_iklan_raw}`;
      if (!latestByKey.has(key)) latestByKey.set(key, r); // rows terurut desc -> pertama = minggu terbaru
    });

    const result = Array.from(latestByKey.entries()).map(([key, r]) => {
      const storeTarget = targetByStore.get(r.store_id) || { target_acos: 30, target_roas: 3, biaya_termasuk_ppn: false };
      const mapping = mappingByKey.get(key) || null;
      const product = mapping?.product_sku ? productByKey.get(`${r.store_id}::${mapping.product_sku}`) : undefined;

      const adjusted = applyPpnAdjustment(r, storeTarget.biaya_termasuk_ppn);
      const metrics = calcAdsMetrics(adjusted);
      const hpp = resolveHpp(mapping, product || null);
      const target = resolveKpiTarget(mapping, storeTarget);
      const margin = calcMargin(hpp.value, mapping?.proses_pesanan ?? 1250, mapping?.pot_admin_persen ?? 0, mapping?.operasional_persen ?? 0, adjusted);
      const status = calcStatusKesehatan(metrics.acos, target.targetAcos, margin.marginSetelahIklan);

      return {
        toko: storeNameById.get(r.store_id),
        nama_iklan: r.nama_iklan_raw,
        produk_terhubung: product?.product_name || null,
        periode: `${r.periode_mulai} s/d ${r.periode_akhir}`,
        biaya: Math.round(adjusted.biaya),
        omzet: adjusted.omzet,
        acos: Number(metrics.acos.toFixed(1)),
        roas: Number(metrics.roas.toFixed(2)),
        hpp: hpp.value,
        margin_setelah_iklan: margin.marginSetelahIklan !== null ? Math.round(margin.marginSetelahIklan) : null,
        target_acos: target.targetAcos,
        target_acos_sumber: target.acosSource,
        status,
      };
    });

    return textResult(result);
  }

  return errorResult(`Tool "${name}" tidak dikenal.`);
}
