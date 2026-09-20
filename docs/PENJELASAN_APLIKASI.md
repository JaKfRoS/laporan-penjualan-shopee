# ShopeeSales — Penjelasan Aplikasi

> Dokumen ini dibuat untuk menjelaskan fitur, alur data, dan cara kerja aplikasi ShopeeSales ke asisten AI lain (atau developer baru) yang belum familiar dengan codebase ini. Ditulis berdasarkan kondisi aplikasi per September 2026.

## 1. Apa itu ShopeeSales?

ShopeeSales adalah dashboard analitik penjualan untuk seller Shopee. User meng-import laporan mentah yang di-export dari Shopee Seller Center (pesanan, laporan pendanaan, laporan iklan) ke aplikasi ini, lalu aplikasi mengolahnya menjadi dashboard, laporan keuangan, analisa produk, dan rekomendasi iklan — hal-hal yang tidak disediakan langsung oleh Shopee dengan baik.

Aplikasi ini **multi-tenant**: satu akun bisa punya beberapa toko, dan banyak akun/seller berbeda memakai aplikasi yang sama secara independen (data terisolasi ketat per akun lewat Row Level Security Supabase).

## 2. Tech Stack & Arsitektur

- **Frontend**: React 19 + TypeScript, Vite sebagai build tool, Tailwind CSS (dimuat lewat CDN di `index.html`, bukan build-time).
- **Backend/Database**: Supabase (Postgres + Auth + Row Level Security). Tidak ada backend custom untuk aplikasi utama — semua query dilakukan langsung dari browser ke Supabase pakai `@supabase/supabase-js` (anon key + RLS yang membatasi tiap user cuma bisa akses datanya sendiri).
- **Hosting aplikasi utama**: Vercel (`shopeesales.vercel.app`).
- **Charting**: Recharts. **Export**: `xlsx` (Excel) dan `jspdf`/`jspdf-autotable` (PDF).
- **Tidak ada backend Node/Express terpisah** untuk aplikasi utama — satu-satunya kode backend custom adalah untuk fitur *integrasi chat AI* (lihat bagian 8).

### Struktur folder penting

```
App.tsx                        # root: routing tab, auth, daftar toko, tab "Pengaturan"
components/
  Dashboard/                   # Sales Dashboard + AI Insights + Floating AI Chat
  Cashflow/                    # halaman "Keuangan"
  Product/                     # halaman "Produk & HPP"
  Ads/                         # halaman "Ads & Pemasaran" + rule engine rekomendasi
  Calculator/                  # "Kalkulator Harga"
  Import/                      # wizard import CSV/XLSX
  Settings/                    # kartu "Integrasi AI" di halaman Pengaturan
  Auth/, Sidebar.tsx, Layout.tsx, StoreSelector.tsx, ErrorBoundary.tsx
services/                      # helper non-UI: supabase client, parser import, kalkulasi AI, dll
types/index.ts                 # semua TypeScript interface (Store, Order, OrderItem, dll)
api/                           # backend serverless (Vercel) KHUSUS utk OAuth custom connector Claude
supabase/functions/mcp-server/ # Edge Function KHUSUS utk koneksi MCP token statis (Claude Code)
```

## 3. Alur Data (garis besar)

```
Export Shopee Seller Center (CSV/XLSX)
        │
        ▼
  Import Wizard (components/Import/ImportWizard.tsx)
  - mapping kolom, parsing, validasi
  - tulis ke tabel Supabase: orders, order_items, income_reports, adjustments
        │
        ▼
  Supabase Postgres (RLS per user_id lewat tabel `stores`)
        │
        ▼
  Dashboard / Keuangan / Produk / Ads
  - fetch data via supabase-js langsung dari browser
  - agregasi & kalkulasi dilakukan di CLIENT (JS), bukan di database
  - AI Insights & Chat Assistant baca hasil agregasi ini sebagai konteks
```

Catatan penting: untuk **Dashboard** (dan chart-chart turunannya), agregasi angka (omzet, HPP, dsb) dihitung di **sisi client** dari data mentah yang di-fetch penuh (bukan lewat SQL aggregate/RPC). Ini beda dengan jalur MCP/chat (bagian 8) yang agregasinya dilakukan di database lewat SQL function — dua jalur ini dibangun terpisah dan **rumusnya harus disinkronkan manual** kalau salah satu berubah (sudah beberapa kali jadi sumber bug di masa lalu — lihat bagian 10).

## 4. Tabel Database Inti

| Tabel | Isi |
|---|---|
| `stores` | Daftar toko per user (`user_id`, `name`). Semua RLS lain nempel ke tabel ini lewat `store_id`. |
| `orders` | Satu baris per pesanan Shopee. Kolom penting: `order_id`, `store_id`, `order_date` (timestamptz), `release_date` (**date**, tanggal dana dilepaskan), `status`, `product_total`, `total_payment`, `net_revenue`, `admin_fee`, `service_fee`, `fee_details` (JSONB berisi ~22 komponen biaya/rebate Shopee). |
| `order_items` | Baris per produk dalam satu pesanan. `order_id`, `product_name`, `variation`, `quantity`, `unit_price`, `product_total`, `final_sku` (SKU hasil mapping, fallback ke `product_name` kalau belum di-mapping), `hpp_at_time` (HPP per unit saat itu, snapshot). |
| `income_reports` | Laporan pendanaan Shopee (per `order_id`), sumber utama utk mode "Basis Pesanan Selesai". Kolom mirip `orders` (product_total, net_revenue, fee_details, `release_date` sebagai **date**). |
| `adjustments` | Penyesuaian saldo non-pesanan: biaya iklan (top-up saldo iklan), penarikan dana, kompensasi, dll. Dibedakan lewat parsing teks kolom `reason`. |
| `products` | Master produk per toko: `sku`, `product_name`, `cost_price` (HPP resmi). |
| `iklan_mingguan`, `iklan_kpi_target`, `iklan_produk_mapping` | Data modul Ads: hasil import laporan iklan mingguan, target KPI (ACOS/ROAS) per toko/produk, dan mapping nama iklan → SKU produk. |
| `ai_settings` | 1 baris per user: provider AI pilihan, API key (BYOK), model, base URL custom. RLS: cuma pemilik yang bisa baca/tulis barisnya sendiri. |
| `mcp_access_tokens`, `oauth_*` | Tabel khusus jalur integrasi chat AI (bagian 8) — token statis untuk Claude Code, dan tabel OAuth (client, authorization code, dst) untuk custom connector claude.ai. |

## 5. Fitur-fitur Aplikasi (menu Sidebar)

### 5.1 Sales Dashboard (`components/Dashboard/Dashboard.tsx`)
Halaman utama. Filter tanggal + **dua mode kalkulasi** (lihat bagian 6). Menampilkan:
- KPI card (omzet, jumlah pesanan, AOV, pesanan dibatalkan, biaya iklan, ROAS/ACOS aktual, dst — beda set kartu per mode).
- Grafik tren performa (`PerformanceTrendChart`) dan breakdown produk (`ProductChart`).
- Tabel pesanan detail (`OrdersTable`).
- Export ke Excel (`xlsx`) dan PDF (`jspdf`).
- **AI Insights**: kartu "ShopeeSales AI Agent" — generate 3-5 insight otomatis dari ringkasan periode berjalan (lihat bagian 7).
- **Floating AI Chat Assistant**: tombol "Ajukan Pertanyaan" di kartu insight membuka chat bubble mengambang untuk tanya-jawab lanjutan (bagian 7).

### 5.2 Keuangan (`components/Cashflow/CashflowPage.tsx`)
Mirip Dashboard mode "Basis Pesanan Selesai", tapi fokus ke cash flow: Penjualan, Potongan Marketplace (dihitung sebagai residual `omzet − dana cair`, BUKAN breakdown `fee_details` seperti di Dashboard — sengaja beda formula karena `fee_details` punya celah kecil), Dana Cair, HPP, dan Laba Kotor.

### 5.3 Produk & HPP (`components/Product/ProductManager.tsx`)
Master data produk: kelola SKU, nama produk, dan `cost_price` (HPP) per toko. Sumber kebenaran untuk HPP yang dipakai di kalkulasi margin di seluruh aplikasi.

### 5.4 Ads & Pemasaran (`components/Ads/`)
- `AdsCenter.tsx`: hub utama, import laporan iklan mingguan dari Shopee Ads Manager.
- `AdsCocokkanProduk.tsx`: mapping nama iklan → SKU produk (perlu di-mapping manual sekali per iklan baru).
- `AdsKpiSettings.tsx`: atur target ACOS/ROAS default per toko, dan toggle "biaya termasuk PPN 11%?" (karena file export Shopee Ads Manager biayanya belum termasuk PPN).
- `adsRules.ts`: rule engine yang menghasilkan rekomendasi otomatis (stop iklan, turunkan bid, naikkan budget, dst) berdasarkan ACOS/ROAS/CTR/CR vs target — ambang batasnya masih tebakan awal, belum divalidasi ke data riil banyak toko.
- Rumus inti (CTR, CR, ROAS, ACOS, margin setelah iklan) dipusatkan di `adsHelpers.ts` supaya Dashboard, halaman Ads, dan tool MCP `performa_iklan` semua baca angka yang identik.

### 5.5 Kalkulator Harga (`components/Calculator/PriceCalculator.tsx`)
Kalkulator harga jual: input HPP + margin target + skema biaya Shopee (admin, layanan, dst per toko) → keluar harga jual yang disarankan. Hanya berlaku untuk satu toko spesifik (skema biaya beda antar toko).

### 5.6 Import Data (`components/Import/ImportWizard.tsx`)
Wizard multi-step: upload file → mapping kolom (fleksibel, karena format export Shopee suka berubah) → validasi → tulis ke `orders`/`order_items`/`income_reports`/`adjustments`. Dipakai untuk 3 jenis laporan: Pesanan, Pendanaan (Income), dan Penyesuaian Saldo.

### 5.7 Pengaturan
- **Akun Saya**: daftar toko, ganti nama toko, hapus toko.
- **Integrasi AI** (`components/Settings/AiIntegrationSettings.tsx`): tempat user paste API key AI sendiri (bagian 7).
- **Zona Bahaya**: kosongkan data toko, hapus akun.

## 6. Dua Mode Kalkulasi Dashboard (penting!)

Ini konsep paling sering bikin bingung kalau tidak dipahami dari awal — Dashboard, Keuangan, dan tool MCP semuanya berputar di sekitar dua basis ini:

| | **Basis Pesanan Dibuat** (`order_date` mode) | **Basis Pesanan Selesai** (`release_date` mode) |
|---|---|---|
| Sumber data | Tabel `orders`, difilter `order_date` | `income_reports` (primer) digabung `orders` (sekunder, difilter `release_date`) |
| Cocok untuk | Lihat performa penjualan periode berjalan, termasuk pesanan yang belum settle | Lihat omzet/dana cair yang **benar-benar sudah cair**, terlepas kapan pesanannya dibuat |
| Omzet Pesanan (GMV) | `sum(product_total)` **SEMUA** pesanan apapun statusnya (sama seperti "Penjualan" di Shopee) | "Omzet Riil" = `sum(product_total)` **hanya** pesanan status Selesai |
| Potongan Marketplace | Tidak dihitung di tool rekap performa (fokusnya omzet & produk terlaris saja) | Breakdown lengkap dari `fee_details` (22 komponen fee/rebate) |

**Jebakan yang sudah pernah terjadi**: order_date adalah `timestamptz`, sedangkan `release_date` adalah `date` murni. Membandingkan `timestamptz` ke string tanggal polos tanpa offset zona waktu eksplisit (`+07`) akan salah hitung di ujung awal/akhir hari (WIB vs UTC beda 7 jam). Semua query yang berkaitan dengan `order_date` di kode ini SUDAH menangani ini dengan eksplisit menyertakan `00:00:00+07`.

## 7. Fitur AI

### 7.1 AI Insights
Tombol "AI Insights" di Dashboard mengirim **ringkasan agregat** periode yang sedang difilter (omzet, AOV, pesanan dibatalkan, ACOS/ROAS, top-5 produk terlaris, dst — bukan data mentah per baris) ke LLM, minta 3-5 insight actionable dalam format Markdown ringan (bullet + bold).

### 7.2 Floating AI Chat Assistant (`FloatingAiChat.tsx`)
Tombol "Ajukan Pertanyaan" di kartu insight membuka chat mengambang (bubble di `bottom-right`, jadi jendela ~380×520px di desktop atau bottom-sheet fullscreen di mobile). Seluruh ringkasan angka + teks insight yang sudah ditampilkan dikirim sebagai *system context* ke setiap pesan chat, jadi asisten tidak "lupa" data yang sudah dianalisis dan tidak mengarang angka baru.

### 7.3 Arsitektur "Bring Your Own Key" (BYOK)
Tidak ada backend proxy untuk panggilan AI — **request ke LLM API dilakukan langsung dari browser user**, memakai API key yang mereka simpan sendiri di halaman Pengaturan (`services/aiSettings.ts`, tabel `ai_settings`, RLS ketat per user). Provider yang didukung (`services/aiInsights.ts`):
- **Google Gemini** (lewat SDK `@google/genai`)
- **OpenAI** (fetch langsung ke `api.openai.com`)
- **Anthropic Claude** (fetch langsung ke `api.anthropic.com`, perlu header `anthropic-dangerous-direct-browser-access` karena API-nya secara default memblokir panggilan langsung dari browser)
- **"Lainnya" / kompatibel-OpenAI** (base URL custom — DeepSeek, Groq, OpenRouter, Ollama, dll)

Konsekuensi arsitektur ini: API key user bisa terlihat lewat DevTools browser **milik mereka sendiri** (bukan ke user lain — itu tetap aman lewat RLS). Ini trade-off sadar demi kesederhanaan (tidak perlu backend baru), sama seperti pola BYOK di banyak aplikasi client-only lain.

Error dari provider (rate limit, key salah, jaringan putus) di-"manusiawi"-kan lewat `humanizeAiError()` supaya user awam paham apa yang terjadi, bukan dilempar JSON mentah dari API.

## 8. Integrasi Chat AI Eksternal (MCP Server) — beda dari fitur AI di atas!

Ini fitur terpisah: memungkinkan **Claude (claude.ai atau Claude Code)** membaca data toko lewat percakapan biasa, di luar aplikasi web ini. Ada DUA jalur paralel yang harus disinkronkan manual kalau ada perubahan tool:

### 8.1 Jalur claude.ai (Custom Connector, OAuth) — `api/`
Deploy terpisah di Vercel, implementasi OAuth 2.1 + PKCE + Dynamic Client Registration dari nol (bukan pakai official MCP SDK, karena isu ESM/transport di serverless). User login pakai akun aplikasi yang sama lewat halaman `/api/authorize`, dapat token yang di-scope ke `user_id` mereka.

### 8.2 Jalur Claude Code (`supabase/functions/mcp-server/`)
Supabase Edge Function (Deno) dengan autentikasi token statis (tabel `mcp_access_tokens`), dipakai lewat `.mcp.json` di Claude Code. **Harus di-redeploy manual** tiap kali logikanya diubah (`mcp__Supabase__deploy_edge_function`).

### 8.3 Tool yang tersedia (sama persis di kedua jalur)
| Tool | Fungsi |
|---|---|
| `list_toko` | Daftar toko milik akun yang terhubung |
| `rekap_performa_penjualan` | Basis Pesanan Dibuat — fokus omzet, AOV, pesanan dibatalkan, produk terlaris |
| `rekap_penjualan_selesai` | Basis Pesanan Selesai — omzet, dana cair, potongan marketplace (agregat) |
| `rekap_keuangan` | Sama seperti fitur Keuangan di app — Penjualan, Potongan Marketplace (+ rincian per komponen fee), Dana Cair, HPP, Laba Kotor |
| `analisa_performa_produk` | Analisa per SKU/varian: terlaris/terendah, urut by jumlah/omzet, filter nama produk, pilih basis pesanan_dibuat/pesanan_selesai |
| `performa_iklan` | Ringkasan performa iklan minggu terbaru per produk, ACOS/ROAS/status kesehatan |

Semua tool ini agregasinya dilakukan lewat **SQL RPC function** di Postgres (bukan tarik data mentah ke JS lalu jumlahkan) — supaya tidak kena limit default 1000 baris per request dari PostgREST/Supabase. Nama-nama RPC-nya: `rekap_penjualan_agg`, `produk_terlaris_agg`, `rekap_pesanan_selesai_agg`, `analisa_produk_agg`, `analisa_produk_selesai_agg`, `rekap_potongan_detail_agg`.

### 8.4 Keamanan multi-tenant di jalur MCP
Kedua server MCP memakai `SUPABASE_SERVICE_ROLE_KEY` (bypass RLS) supaya bisa jalan tanpa sesi login browser — jadi **setiap query WAJIB difilter manual** ke `store_id` milik `user_id` yang resolve dari token (`getOwnedStores()`). Ini satu-satunya pertahanan dari kebocoran data lintas akun di jalur ini — kalau helper ini ke-skip di satu tool baru, itu bug keamanan serius.

## 9. Keamanan & Multi-tenancy

- Aplikasi utama pakai Supabase Auth + RLS standar: tiap tabel dibatasi lewat policy `owner_manage_*` yang mengecek `auth.uid()` (langsung, atau lewat join ke `stores.user_id`).
- Jalur MCP (bagian 8) memakai service role key yang bypass RLS, jadi keamanannya bergantung 100% pada filter manual `getOwnedStores()` di setiap tool — bukan pada RLS.
- Sempat ada periode dev di mana login OAuth dibatasi ke satu akun saja (`DEV_ALLOWED_USER_ID`) — ini **sudah dihapus**, sekarang semua user terdaftar bisa connect ke MCP connector.

## 10. Isu/Bug Historis yang Layak Diketahui

Kalau lagi debug angka yang kelihatan aneh, ini pola-pola yang sudah pernah terjadi dan sudah diperbaiki — cek dulu apakah ada regresi ke pola yang sama:

1. **`orders.product_total` sering 0** untuk sebagian baris (bug mapping header saat import lama) — semua kalkulasi omzet yang penting pakai fallback `coalesce(nullif(product_total,0), total_payment, 0)`, jangan percaya `product_total` mentah begitu saja.
2. **Timezone `order_date`**: `timestamptz` vs `date` — selalu sertakan offset `+07` eksplisit saat membandingkan `order_date` ke tanggal.
3. **Default limit 1000 baris PostgREST**: jangan pernah `.select()` tanpa pagination eksplisit untuk tabel yang bisa besar. Di jalur MCP, solusinya agregasi di SQL (RPC). Di Dashboard, solusinya `fetchAll()` dengan pagination — sekarang sudah paralel (bukan sequential) pakai pola *query factory* karena `.range()` di supabase-js mengubah objek builder yang sama secara in-place (tidak aman dipanggil concurrent di builder yang sama).
4. **Filter di dalam agregasi vs sesudah agregasi**: filter seperti `nama_produk` harus diterapkan SEBAGAI keputusan tampil/sembunyi SETELAH grouping per SKU selesai, bukan sebagai `WHERE` per-baris SEBELUM `GROUP BY` — kalau tidak, satu SKU yang punya beberapa variasi teks `product_name` (mis. listing di-rename) akan under-count saat difilter.
5. **Dua jalur agregasi (client-side Dashboard vs SQL RPC untuk MCP) harus disinkronkan manual** — tidak ada mekanisme otomatis yang menjamin keduanya tetap identik kalau salah satu rumusnya diubah.

## 11. Yang Belum Ada / Batasan yang Diketahui

- Tidak ada test suite otomatis — verifikasi perubahan dilakukan manual lewat query SQL langsung + `npx tsc --noEmit` + `npm run build`.
- Ambang batas rule engine rekomendasi iklan (`adsRules.ts`) masih tebakan awal, belum divalidasi ke data riil banyak toko.
- BYOK AI: key user tidak dienkripsi di database (RLS-protected, tapi bukan enkripsi) — trade-off arsitektur client-only tanpa backend.
