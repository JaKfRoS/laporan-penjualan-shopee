
-- BAGIAN 1: PERBAIKAN STRUKTUR (CASCADE) --

-- 1. Agar saat User dihapus -> Toko otomatis terhapus
ALTER TABLE stores
DROP CONSTRAINT IF EXISTS stores_user_id_fkey;

ALTER TABLE stores
ADD CONSTRAINT stores_user_id_fkey
FOREIGN KEY (user_id)
REFERENCES auth.users(id)
ON DELETE CASCADE;

-- 2. Agar saat Toko dihapus -> Orders otomatis terhapus
ALTER TABLE orders
DROP CONSTRAINT IF EXISTS orders_store_id_fkey;

ALTER TABLE orders
ADD CONSTRAINT orders_store_id_fkey
FOREIGN KEY (store_id)
REFERENCES stores(id)
ON DELETE CASCADE;

-- 3. Agar saat Order dihapus -> Items otomatis terhapus
ALTER TABLE order_items
DROP CONSTRAINT IF EXISTS order_items_store_order_fkey;

ALTER TABLE order_items
ADD CONSTRAINT order_items_store_order_fkey
FOREIGN KEY (store_id, order_id)
REFERENCES orders (store_id, order_id)
ON DELETE CASCADE;


-- BAGIAN 2: TABEL IKLAN (BARU) --
CREATE TABLE IF NOT EXISTS ads_performance (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id uuid REFERENCES stores(id) ON DELETE CASCADE,
  report_date date NOT NULL,
  platform text DEFAULT 'shopee', -- 'shopee', 'facebook', 'tiktok'
  impressions int DEFAULT 0,
  clicks int DEFAULT 0,
  ctr numeric DEFAULT 0,
  conversions int DEFAULT 0,
  amount_spent numeric DEFAULT 0, -- PENTING: Biaya
  gmv_generated numeric DEFAULT 0, -- PENTING: Omzet Iklan
  created_at timestamptz DEFAULT now(),
  UNIQUE(store_id, report_date, platform) -- Mencegah duplikasi data harian
);


-- BAGIAN 3: FUNGSI HAPUS AKUN SENDIRI --

CREATE OR REPLACE FUNCTION delete_user_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM auth.users WHERE id = auth.uid();
END;
$$;

-- BAGIAN 4: PRODUCT MASTER & SKU MAPPING (BARU) --

-- 4.1 Tabel Master Produk (Internal HPP)
CREATE TABLE IF NOT EXISTS products (
    sku text PRIMARY KEY,
    store_id uuid REFERENCES stores(id) ON DELETE CASCADE,
    product_name text,
    hpp numeric DEFAULT 0,
    stock int DEFAULT 0,
    created_at timestamptz DEFAULT now()
);

-- 4.2 Tabel Mapping (Shopee Name -> SKU)
CREATE TABLE IF NOT EXISTS sku_mappings (
    id SERIAL PRIMARY KEY,
    store_id uuid REFERENCES stores(id) ON DELETE CASCADE,
    shopee_product_name text NOT NULL,
    shopee_variation_name text DEFAULT '',
    mapped_sku text REFERENCES products(sku) ON DELETE CASCADE,
    created_at timestamptz DEFAULT now(),
    UNIQUE(store_id, shopee_product_name, shopee_variation_name)
);

-- 4.3 Update Order Items untuk support HPP
ALTER TABLE order_items 
ADD COLUMN IF NOT EXISTS final_sku text,
ADD COLUMN IF NOT EXISTS hpp_at_time numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS is_sku_mapped boolean DEFAULT FALSE;

-- 4.4 RLS POLICIES (Supaya tidak error permission denied)
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE sku_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

-- PERBAIKAN: Drop policy lama sebelum membuat baru agar tidak error 'policy already exists'
DROP POLICY IF EXISTS "Enable all for authenticated users" ON products;
CREATE POLICY "Enable all for authenticated users" ON products FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Enable all for authenticated users" ON sku_mappings;
CREATE POLICY "Enable all for authenticated users" ON sku_mappings FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Enable all for authenticated users" ON order_items;
CREATE POLICY "Enable all for authenticated users" ON order_items FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- 4.5 RPC: Safe Delete Product (Single)
CREATE OR REPLACE FUNCTION delete_product_safely(p_sku text, p_store_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- 1. Hapus Mapping yang terhubung
  DELETE FROM sku_mappings 
  WHERE mapped_sku = p_sku AND store_id = p_store_id;

  -- 2. Putuskan hubungan dengan pesanan (Set NULL)
  UPDATE order_items 
  SET final_sku = NULL, is_sku_mapped = FALSE
  WHERE final_sku = p_sku AND store_id = p_store_id;

  -- 3. Hapus Produk Master
  DELETE FROM products 
  WHERE sku = p_sku AND store_id = p_store_id;
END;
$$;

-- 4.6 RPC: Bulk Delete Products (Optimized)
-- Menghapus banyak produk sekaligus dalam satu transaksi
CREATE OR REPLACE FUNCTION bulk_delete_products(p_skus text[], p_store_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- 1. Hapus Mapping untuk semua SKU di list
  DELETE FROM sku_mappings 
  WHERE mapped_sku = ANY(p_skus) AND store_id = p_store_id;

  -- 2. Putuskan hubungan pesanan untuk semua SKU di list
  UPDATE order_items 
  SET final_sku = NULL, is_sku_mapped = FALSE
  WHERE final_sku = ANY(p_skus) AND store_id = p_store_id;

  -- 3. Hapus Produk Master untuk semua SKU di list
  DELETE FROM products 
  WHERE sku = ANY(p_skus) AND store_id = p_store_id;
END;
$$;
