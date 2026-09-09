
export interface Store {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
  last_import_at?: string;
  // Synthetic fields for the "multiple stores selected" pseudo-store
  is_multiple?: boolean;
  selected_ids?: string[];
}

export interface OrderItem {
  id: string;
  order_id: string;
  store_id?: string;
  product_name: string;
  variation: string | null;
  quantity: number;
  unit_price: number;
  product_total: number;
  // New Fields for Mapping
  final_sku?: string | null;
  hpp_at_time?: number;
  is_sku_mapped?: boolean;
}

export interface Order {
  id: string;
  store_id: string;
  order_id: string;
  order_date: string;
  payment_date: string | null;
  status: string;
  total_payment: number;
  total_discount: number;
  seller_voucher: number;
  shipping_estimated: number;
  admin_fee: number;
  service_fee: number;
  net_revenue: number;
  product_total: number; // Nilai kotor produk (GMV)
  buyer_username: string | null;
  city: string | null;
  province: string | null;
  created_at: string;
  order_items?: OrderItem[]; // Added relations
  fee_details?: any; // JSONB for detailed fee breakdown
  release_date?: string | null; // Tanggal Dana Dilepaskan
}

export interface Product {
  sku: string;
  store_id: string;
  parent_sku?: string;
  product_name: string;
  variation_name?: string;
  cost_price: number; // Renamed from hpp to match DB request
  processing_fee?: number; // Added processing_fee
  stock: number;
  created_at?: string;
}

export interface SkuMapping {
  id?: number;
  store_id: string;
  shopee_product_name: string;
  shopee_variation_name: string;
  mapped_sku: string;
  created_at?: string;
}

export type JenisIklan = 'Iklan Pencarian' | 'Iklan Serba Bisa' | 'Iklan Toko';

// Mapping nama iklan mentah (dari file export Ads Manager) -> SKU Master Produk.
// product_sku sengaja tanpa relasi tipe ke Product - boleh menunjuk SKU yang
// belum/tidak ada di Master Produk (mis. dihapus belakangan), sama seperti SkuMapping.
export interface IklanProdukMapping {
  id: string;
  store_id: string;
  nama_iklan_raw: string;
  product_sku: string | null;
  hpp_override: number | null;
  harga_jual_override: number | null;
  proses_pesanan: number;
  pot_admin_persen: number;
  operasional_persen: number;
  created_at?: string;
  updated_at?: string;
}

// Satu baris performa iklan mingguan (per nama iklan/produk, per rentang periode).
export interface IklanMingguan {
  id: string;
  store_id: string;
  periode_mulai: string;
  periode_akhir: string;
  nama_iklan_raw: string;
  jenis_iklan: JenisIklan | null;
  product_sku: string | null;
  biaya: number;
  impresi: number;
  klik: number;
  produk_terjual: number;
  omzet: number;
  created_at?: string;
}

export interface IklanKpiTarget {
  id: string;
  store_id: string;
  target_acos: number;
  target_roas: number;
  target_ctr: number | null;
  target_konversi: number | null;
  rekomendasi_aktif: boolean;
  biaya_termasuk_ppn: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface AdPerformance {
  id: string;
  store_id: string;
  report_date: string;
  platform: 'shopee' | 'facebook' | 'tiktok';
  impressions: number;
  clicks: number;
  ctr: number;
  conversions: number;
  amount_spent: number; 
  gmv_generated: number; 
  created_at: string;
}

export type Mapping = Record<string, string>;

export interface RawRow {
  [key: string]: any;
}
