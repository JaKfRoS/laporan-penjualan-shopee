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

const TOOLS = [
  {
    name: "list_toko",
    description: "Daftar toko yang terhubung ke akun ini.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "rekap_penjualan",
    description: "Rekap total penjualan (jumlah pesanan, omzet, net revenue, potongan marketplace) untuk rentang tanggal tertentu, berdasarkan tanggal pesanan.",
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
    name: "status_iklan",
    description: "Ringkasan performa iklan Shopee minggu terbaru per nama iklan: biaya (sudah disesuaikan PPN 11% kalau perlu), omzet, ACOS, ROAS, dan status kesehatan dibanding target toko.",
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

  if (name === "rekap_penjualan") {
    const { start_date, end_date, nama_toko } = args || {};
    if (!start_date || !end_date) return errorResult("start_date dan end_date wajib diisi.");
    const stores = await getOwnedStores(userId, nama_toko);
    if (stores.length === 0) return errorResult(`Toko "${nama_toko}" tidak ditemukan di akun ini.`);
    const storeIds = stores.map(s => s.id);

    // Agregasi dilakukan di database (bukan tarik semua baris lalu jumlahkan di
    // JS) - PostgREST/Supabase membatasi hasil .select() ke 1000 baris secara
    // default, jadi toko dengan pesanan lebih dari itu akan salah dihitung
    // kalau baris mentahnya ditarik satu-satu.
    const { data, error } = await supabase
      .from("orders")
      .select(
        "jumlah_pesanan:count(), omzet:sum(product_total), net_revenue:sum(net_revenue), total_discount:sum(total_discount), seller_voucher:sum(seller_voucher), admin_fee:sum(admin_fee), service_fee:sum(service_fee)"
      )
      .in("store_id", storeIds)
      .gte("order_date", start_date)
      .lte("order_date", end_date)
      .single();
    if (error) return errorResult(error.message);

    const row: any = data || {};
    const totals = {
      jumlah_pesanan: Number(row.jumlah_pesanan) || 0,
      omzet: Number(row.omzet) || 0,
      net_revenue: Number(row.net_revenue) || 0,
      potongan_marketplace:
        (Number(row.total_discount) || 0) + (Number(row.seller_voucher) || 0) + (Number(row.admin_fee) || 0) + (Number(row.service_fee) || 0),
    };

    return textResult({ periode: `${start_date} s/d ${end_date}`, toko: stores.map(s => s.name), ...totals });
  }

  if (name === "status_iklan") {
    const { nama_toko } = args || {};
    const stores = await getOwnedStores(userId, nama_toko);
    if (stores.length === 0) return errorResult(`Toko "${nama_toko}" tidak ditemukan di akun ini.`);
    const storeIds = stores.map(s => s.id);
    const storeNameById = new Map(stores.map(s => [s.id, s.name]));

    const [{ data: rows, error: rErr }, { data: targets, error: tErr }] = await Promise.all([
      supabase.from("iklan_mingguan").select("*").in("store_id", storeIds).order("periode_mulai", { ascending: false }),
      supabase.from("iklan_kpi_target").select("*").in("store_id", storeIds),
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
      const status = acos > target.target_acos ? "waspada" : "sehat";
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
