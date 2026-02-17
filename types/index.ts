
export interface Store {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
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
}

export interface OrderItem {
  id: string;
  order_id: string;
  store_id?: string; // Added store_id to prevent mixing items
  product_name: string;
  variation: string | null;
  quantity: number;
  unit_price: number;
  product_total: number;
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
  amount_spent: number; // Biaya Iklan
  gmv_generated: number; // Omzet dari Iklan
  created_at: string;
}

export type Mapping = Record<string, string>;

export interface RawRow {
  [key: string]: any;
}
