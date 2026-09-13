import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// MCP server (dev-only, read-only) untuk aplikasi laporan penjualan Shopee ini.
//
// Autentikasi TIDAK memakai verify_jwt bawaan Supabase (function di-deploy dengan
// verify_jwt: false) karena token yang dipakai di sini bukan token login Supabase,
// melainkan token khusus MCP yang tersimpan (sudah di-hash) di tabel
// `mcp_access_tokens`, dipetakan ke satu user_id. Semua query di bawah memakai
// SUPABASE_SERVICE_ROLE_KEY (bypass RLS) tapi selalu difilter manual ke store_id
// milik user_id itu saja - meniru persis pola RLS owner_manage_* yang sudah ada,
// supaya proyek Supabase ini (sudah dipakai banyak toko/tenant nyata) tidak pernah
// bisa bocor lintas akun lewat endpoint ini.
//
// Rumus performa_iklan sengaja DIDUPLIKASI dari components/Ads/adsHelpers.ts
// (bukan diimpor) karena deploy Edge Function ini berdiri sendiri, tidak
// membawa serta pohon direktori frontend. Kalau formula di adsHelpers.ts
// berubah, salin ulang perubahannya ke sini juga.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PROTOCOL_VERSION = "2025-06-18";
const PPN_IKLAN_RATE = 0.11;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function resolveUserId(authHeader: string | null): Promise<string | null> {
  const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const tokenHash = await hashToken(token);
  const { data, error } = await supabase
    .from("mcp_access_tokens")
    .select("user_id")
    .eq("token_hash", tokenHash)
    .is("revoked_at", null)
    .maybeSingle();
  if (error || !data) return null;
  supabase.from("mcp_access_tokens").update({ last_used_at: new Date().toISOString() }).eq("token_hash", tokenHash).then(() => {});
  return data.user_id;
}

async function getOwnedStores(userId: string, namaToko?: string) {
  const { data, error } = await supabase.from("stores").select("id, name").eq("user_id", userId);
  if (error) throw new Error(error.message);
  const stores = data || [];
  if (!namaToko) return stores;
  const needle = namaToko.toLowerCase();
  return stores.filter(s => s.name.toLowerCase().includes(needle));
}

function textResult(payload: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

function errorResult(message: string) {
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

// --- Rumus iklan (duplikat dari components/Ads/adsHelpers.ts) ---

function applyPpnAdjustment(agg: any, biayaTermasukPpn: boolean) {
  return biayaTermasukPpn ? agg : { ...agg, biaya: agg.biaya * (1 + PPN_IKLAN_RATE) };
}

function calcAdsMetrics(row: any) {
  return {
    ctr: row.impresi > 0 ? (row.klik / row.impresi) * 100 : 0,
    cr: row.klik > 0 ? (row.produk_terjual / row.klik) * 100 : 0,
    roas: row.biaya > 0 ? row.omzet / row.biaya : 0,
    acos: row.omzet > 0 ? (row.biaya / row.omzet) * 100 : 0,
    cpc: row.klik > 0 ? row.biaya / row.klik : 0,
  };
}

function resolveHpp(mapping: any, masterProduct: any) {
  const masterValue = masterProduct && masterProduct.cost_price > 0 ? masterProduct.cost_price : null;
  const override = mapping?.hpp_override ?? null;
  if (override !== null) {
    return { value: override, source: "manual", masterValue, berbedaDariMaster: masterValue !== null && override !== masterValue };
  }
  if (masterValue !== null) {
    return { value: masterValue, source: "master", masterValue, berbedaDariMaster: false };
  }
  return { value: null, source: "none", masterValue: null, berbedaDariMaster: false };
}

function resolveKpiTarget(mapping: any, storeTarget: any) {
  const acosOverride = mapping?.target_acos_override ?? null;
  const roasOverride = mapping?.target_roas_override ?? null;
  return {
    targetAcos: acosOverride !== null ? acosOverride : storeTarget.target_acos,
    targetRoas: roasOverride !== null ? roasOverride : storeTarget.target_roas,
    acosSource: acosOverride !== null ? "produk" : "toko",
    roasSource: roasOverride !== null ? "produk" : "toko",
  };
}

function calcMargin(hpp: number | null, prosesPesanan: number, potAdminPersen: number, operasionalPersen: number, ads: any) {
  if (hpp === null) return { grossMarginRatio: null, bepRoas: null, marginSetelahIklan: null, gapReason: "hpp-belum-lengkap" };
  if (ads.omzet <= 0 || ads.produk_terjual <= 0) return { grossMarginRatio: null, bepRoas: null, marginSetelahIklan: null, gapReason: "belum-ada-penjualan" };

  const hppTotal = hpp * ads.produk_terjual;
  const prosesTotal = prosesPesanan * ads.produk_terjual;
  const potAdminTotal = ads.omzet * (potAdminPersen / 100);
  const operasionalTotal = ads.omzet * (operasionalPersen / 100);
  const grossMarginTotal = ads.omzet - hppTotal - prosesTotal - potAdminTotal - operasionalTotal;
  const grossMarginRatio = grossMarginTotal / ads.omzet;
  const bepRoas = grossMarginRatio > 0 ? 1 / grossMarginRatio : 0;
  const marginSetelahIklan = grossMarginTotal - ads.biaya;
  return { grossMarginRatio, bepRoas, marginSetelahIklan, gapReason: null };
}

function calcStatusKesehatan(acos: number, targetAcos: number, marginSetelahIklan: number | null) {
  if (marginSetelahIklan !== null && marginSetelahIklan < 0) return "perlu-aksi";
  if (acos > targetAcos) return "waspada";
  return "sehat";
}

const TOOLS = [
  {
    name: "list_toko",
    description: "Daftar toko yang terhubung ke akun ini.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "rekap_performa_penjualan",
    description:
      'Rekap PERFORMA penjualan berbasis TANGGAL PESANAN DIBUAT (kapan pembeli order) - sama seperti mode "Basis Pesanan Dibuat" di Dashboard. Fokus ke omzet, rata-rata nilai per pesanan, jumlah pesanan dibatalkan, dan produk terlaris pada periode ini - bukan rincian potongan marketplace (pakai rekap_keuangan untuk itu).',
    inputSchema: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "Tanggal mulai, format YYYY-MM-DD" },
        end_date: { type: "string", description: "Tanggal akhir, format YYYY-MM-DD" },
        nama_toko: { type: "string", description: "Nama toko spesifik (boleh sebagian). Kosongkan untuk semua toko di akun ini." },
      },
      required: ["start_date", "end_date"],
      additionalProperties: false,
    },
  },
  {
    name: "rekap_penjualan_selesai",
    description:
      'Rekap penjualan berbasis TANGGAL DANA DILEPASKAN Shopee (release_date) - sama seperti mode "Basis Pesanan Selesai" di Dashboard. Sumber datanya laporan pendanaan (income_reports) digabung dengan orders. Cocok untuk melihat omzet/dana cair yang benar-benar sudah settle di periode ini, terlepas kapan pesanannya dibuat.',
    inputSchema: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "Tanggal mulai, format YYYY-MM-DD" },
        end_date: { type: "string", description: "Tanggal akhir, format YYYY-MM-DD" },
        nama_toko: { type: "string", description: "Nama toko spesifik (boleh sebagian). Kosongkan untuk semua toko di akun ini." },
      },
      required: ["start_date", "end_date"],
      additionalProperties: false,
    },
  },
  {
    name: "rekap_keuangan",
    description:
      "Rekap keuangan (fitur Keuangan/Cashflow di aplikasi): Penjualan, Potongan Marketplace, Dana Cair, HPP, dan Laba Kotor untuk rentang tanggal tertentu berbasis tanggal dana dilepaskan (release_date) - sama seperti halaman Keuangan.",
    inputSchema: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "Tanggal mulai, format YYYY-MM-DD" },
        end_date: { type: "string", description: "Tanggal akhir, format YYYY-MM-DD" },
        nama_toko: { type: "string", description: "Nama toko spesifik (boleh sebagian). Kosongkan untuk semua toko di akun ini." },
      },
      required: ["start_date", "end_date"],
      additionalProperties: false,
    },
  },
  {
    name: "performa_iklan",
    description:
      "Ringkasan performa iklan Shopee minggu terbaru per nama iklan/produk (fitur Ads & Promosi): biaya (sudah disesuaikan PPN 11% kalau perlu), omzet, ACOS, ROAS, HPP, Margin Setelah Iklan, dan status kesehatan dibanding target (per produk kalau diatur, atau target default toko).",
    inputSchema: {
      type: "object",
      properties: {
        nama_toko: { type: "string", description: "Nama toko spesifik (boleh sebagian). Kosongkan untuk semua toko di akun ini." },
      },
      additionalProperties: false,
    },
  },
];

async function callTool(userId: string, name: string, args: Record<string, any>) {
  if (name === "list_toko") {
    const stores = await getOwnedStores(userId);
    return textResult(stores);
  }

  if (name === "rekap_performa_penjualan") {
    const { start_date, end_date, nama_toko } = args || {};
    if (!start_date || !end_date) return errorResult("start_date dan end_date wajib diisi.");
    const stores = await getOwnedStores(userId, nama_toko);
    if (stores.length === 0) return errorResult(`Toko "${nama_toko}" tidak ditemukan di akun ini.`);
    const storeIds = stores.map(s => s.id);

    // Agregasi dilakukan di database lewat RPC (bukan tarik semua baris lalu
    // jumlahkan di JS, dan bukan aggregate function di select= - PostgREST di
    // project ini tidak mendukungnya) - PostgREST/Supabase membatasi hasil
    // .select() ke 1000 baris secara default, jadi toko dengan pesanan lebih
    // dari itu akan salah dihitung kalau baris mentahnya ditarik satu-satu.
    //
    // Fokus tool ini: omzet, rata-rata per pesanan, jumlah dibatalkan, dan
    // produk terlaris - BUKAN rincian potongan marketplace (itu di
    // rekap_keuangan). Omzet tetap pakai formula "Omzet Riil" Dashboard.tsx
    // (fallback product_total -> total_payment, hanya pesanan selesai/retur).
    // jumlah_dibatalkan dihitung dari SEMUA pesanan di rentang order_date
    // yang sama (bukan cuma yang settled).
    const [{ data, error }, { data: produkRows, error: produkErr }] = await Promise.all([
      supabase.rpc("rekap_penjualan_agg", { p_store_ids: storeIds, p_start_date: start_date, p_end_date: end_date }),
      supabase.rpc("produk_terlaris_agg", { p_store_ids: storeIds, p_start_date: start_date, p_end_date: end_date, p_limit: 10 }),
    ]);
    if (error) return errorResult(error.message);
    if (produkErr) return errorResult(produkErr.message);

    const row: any = (data && data[0]) || {};
    const jumlahPesanan = Number(row.jumlah_pesanan) || 0;
    const omzet = Number(row.omzet) || 0;
    const totals = {
      jumlah_pesanan: jumlahPesanan,
      omzet,
      rata_rata_per_pesanan: jumlahPesanan > 0 ? Math.round(omzet / jumlahPesanan) : 0,
      jumlah_dibatalkan: Number(row.jumlah_dibatalkan) || 0,
      produk_terlaris: (produkRows || []).map((p: any) => ({
        produk: p.produk,
        sku: p.sku || null,
        jumlah_terjual: Number(p.jumlah_terjual) || 0,
        omzet: Number(p.omzet) || 0,
      })),
    };

    return textResult({ periode: `${start_date} s/d ${end_date}`, toko: stores.map(s => s.name), ...totals });
  }

  if (name === "rekap_penjualan_selesai") {
    const { start_date, end_date, nama_toko } = args || {};
    if (!start_date || !end_date) return errorResult("start_date dan end_date wajib diisi.");
    const stores = await getOwnedStores(userId, nama_toko);
    if (stores.length === 0) return errorResult(`Toko "${nama_toko}" tidak ditemukan di akun ini.`);
    const storeIds = stores.map(s => s.id);

    // Meniru merge income_reports+orders mode "Basis Pesanan Selesai" -
    // lihat komentar panjang di fungsi SQL rekap_pesanan_selesai_agg.
    const { data, error } = await supabase.rpc("rekap_pesanan_selesai_agg", {
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

  if (name === "rekap_keuangan") {
    const { start_date, end_date, nama_toko } = args || {};
    if (!start_date || !end_date) return errorResult("start_date dan end_date wajib diisi.");
    const stores = await getOwnedStores(userId, nama_toko);
    if (stores.length === 0) return errorResult(`Toko "${nama_toko}" tidak ditemukan di akun ini.`);
    const storeIds = stores.map(s => s.id);

    // Dataset sama persis dengan rekap_penjualan_selesai (RPC yang sama), tapi
    // "Potongan Marketplace" di halaman Keuangan dihitung sebagai residual
    // (omzet - dana cair) - bukan dari breakdown fee_details - karena
    // fee_details punya celah kecil (mis. penyesuaian dari Shopee) yang bikin
    // breakdown tidak selalu pas. Ini sengaja beda dari rekap_penjualan_selesai
    // supaya masing-masing tool cocok dengan angka di halaman yang ditirunya.
    const { data, error } = await supabase.rpc("rekap_pesanan_selesai_agg", {
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

  if (name === "performa_iklan") {
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
      supabase.from("iklan_mingguan").select("*").in("store_id", storeIds).order("periode_mulai", { ascending: false }),
      supabase.from("iklan_kpi_target").select("*").in("store_id", storeIds),
      supabase.from("iklan_produk_mapping").select("*").in("store_id", storeIds),
      supabase.from("products").select("sku, store_id, product_name, cost_price").in("store_id", storeIds),
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

function jsonRpcResult(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed. Gunakan POST." }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify(jsonRpcError(null, -32700, "Parse error")), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { id, method, params } = body || {};

  // Notifikasi (tidak punya id) tidak butuh respons body.
  if (method === "notifications/initialized" || method === "notifications/cancelled") {
    return new Response(null, { status: 202 });
  }

  if (method === "initialize") {
    return new Response(
      JSON.stringify(
        jsonRpcResult(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: "shopee-sales-report", version: "1.0.0" },
        })
      ),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  if (method === "ping") {
    return new Response(JSON.stringify(jsonRpcResult(id, {})), { headers: { "Content-Type": "application/json" } });
  }

  // Dari sini semua method butuh token MCP yang valid.
  const userId = await resolveUserId(req.headers.get("authorization"));
  if (!userId) {
    return new Response(JSON.stringify(jsonRpcError(id, -32001, "Unauthorized: token MCP tidak valid atau sudah dicabut.")), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (method === "tools/list") {
    return new Response(JSON.stringify(jsonRpcResult(id, { tools: TOOLS })), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (method === "tools/call") {
    try {
      const result = await callTool(userId, params?.name, params?.arguments || {});
      return new Response(JSON.stringify(jsonRpcResult(id, result)), { headers: { "Content-Type": "application/json" } });
    } catch (err: any) {
      return new Response(JSON.stringify(jsonRpcResult(id, errorResult(err.message || String(err)))), {
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  return new Response(JSON.stringify(jsonRpcError(id, -32601, `Method "${method}" tidak didukung.`)), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
});
