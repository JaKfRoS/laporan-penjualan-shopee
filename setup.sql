
-- BAGIAN 1: MEMBERSIHKAN TABEL LAMA (OPSIONAL, HATI-HATI)
-- DROP TABLE IF EXISTS sku_mappings;
-- DROP TABLE IF EXISTS products;

-- BAGIAN 2: TABLE PRODUCTS (MASTER DATA)
CREATE TABLE IF NOT EXISTS products (
    sku text NOT NULL,
    store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    product_name text NOT NULL,
    variation_name text DEFAULT NULL, -- Opsional, untuk konteks internal
    cost_price numeric DEFAULT 0, -- HPP
    stock int DEFAULT 0,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    PRIMARY KEY (sku, store_id) -- Composite PK agar SKU unik per toko
);

-- MIGRATION: Ensure columns exists (fix for existing tables)
ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_price numeric DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS variation_name text DEFAULT NULL; -- NEW COLUMN

-- Index untuk pencarian SKU cepat
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);

-- BAGIAN 3: TABLE SKU MAPPINGS (HUBUNGAN NAMA SHOPEE -> SKU MASTER)
CREATE TABLE IF NOT EXISTS sku_mappings (
    id SERIAL PRIMARY KEY,
    store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    shopee_product_name text NOT NULL,
    shopee_variation_name text DEFAULT '',
    mapped_sku text NOT NULL,
    created_at timestamptz DEFAULT now(),
    
    -- CONSTRAINT FK: Pastikan SKU yang di-map ada di tabel products
    CONSTRAINT fk_mapping_product 
      FOREIGN KEY (mapped_sku, store_id) 
      REFERENCES products (sku, store_id) 
      ON DELETE CASCADE,

    -- CONSTRAINT UNIQUE: Mencegah duplikasi mapping untuk kombinasi nama produk + variasi yang sama di toko yang sama
    CONSTRAINT unique_mapping_per_store 
      UNIQUE (store_id, shopee_product_name, shopee_variation_name)
);

-- Index untuk pencarian mapping cepat saat import
CREATE INDEX IF NOT EXISTS idx_mappings_lookup 
ON sku_mappings(store_id, shopee_product_name, shopee_variation_name);

-- BAGIAN 4: UPDATE STRUKTUR TABLE ORDER_ITEMS (SALES REPORTS)
ALTER TABLE order_items 
ADD COLUMN IF NOT EXISTS final_sku text,
ADD COLUMN IF NOT EXISTS hpp_at_time numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS is_sku_mapped boolean DEFAULT FALSE;

-- BAGIAN 4.5: UPDATE STRUKTUR TABLE ORDERS (FEE BREAKDOWN)
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS fee_details jsonb DEFAULT '{}'::jsonb;

-- Index untuk performa join laporan
CREATE INDEX IF NOT EXISTS idx_order_items_product_lookup 
ON order_items(store_id, product_name, variation);

-- BAGIAN 5: DATABASE VIEW FOR PROFIT CALCULATION
-- View ini otomatis menghitung profit berdasarkan data real-time
CREATE OR REPLACE VIEW view_order_profits AS
SELECT 
    oi.id AS order_item_id,
    oi.store_id,
    oi.order_id,
    o.order_date,
    o.status,
    oi.product_name AS shopee_product_name,
    oi.variation AS shopee_variation_name,
    oi.quantity,
    oi.product_total AS sales_omzet, -- Harga Jual Total
    oi.final_sku,
    
    -- Ambil HPP dari history transaksi (hpp_at_time) atau fallback ke master product saat ini
    COALESCE(oi.hpp_at_time, p.cost_price, 0) AS unit_cost_price,
    (COALESCE(oi.hpp_at_time, p.cost_price, 0) * oi.quantity) AS total_cost_price,
    
    -- Gross Profit Calculation
    (oi.product_total - (COALESCE(oi.hpp_at_time, p.cost_price, 0) * oi.quantity)) AS gross_profit

FROM order_items oi
JOIN orders o ON oi.order_id = o.order_id AND oi.store_id = o.store_id
LEFT JOIN products p ON oi.final_sku = p.sku AND oi.store_id = p.store_id;

-- BAGIAN 6: SECURITY POLICIES (RLS)
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE sku_mappings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable all for authenticated users" ON products;
CREATE POLICY "Enable all for authenticated users" ON products FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Enable all for authenticated users" ON sku_mappings;
CREATE POLICY "Enable all for authenticated users" ON sku_mappings FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- BAGIAN 7: FUNGSI DELETE/UPDATE CEPAT (PERFORMANCE)

-- Fungsi Hapus Aman (Single)
CREATE OR REPLACE FUNCTION delete_product_safely(p_sku text, p_store_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- 1. Hapus Mapping
  DELETE FROM sku_mappings WHERE mapped_sku = p_sku AND store_id = p_store_id;
  -- 2. Unlink Orders
  UPDATE order_items SET final_sku = NULL, is_sku_mapped = FALSE WHERE final_sku = p_sku AND store_id = p_store_id;
  -- 3. Hapus Produk
  DELETE FROM products WHERE sku = p_sku AND store_id = p_store_id;
END;
$$;

-- Fungsi Hapus Massal Cepat (Bulk Delete Array)
CREATE OR REPLACE FUNCTION delete_products_bulk(p_skus text[], p_store_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- 1. Hapus Mapping Massal
  DELETE FROM sku_mappings WHERE mapped_sku = ANY(p_skus) AND store_id = p_store_id;
  -- 2. Unlink Orders Massal
  UPDATE order_items SET final_sku = NULL, is_sku_mapped = FALSE WHERE final_sku = ANY(p_skus) AND store_id = p_store_id;
  -- 3. Hapus Produk Massal
  DELETE FROM products WHERE sku = ANY(p_skus) AND store_id = p_store_id;
END;
$$;
