
export interface Store {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
  last_import_at?: string;
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
