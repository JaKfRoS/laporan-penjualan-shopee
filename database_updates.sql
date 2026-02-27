-- BAGIAN PENTING: KOLOM BARU --
ALTER TABLE products ADD COLUMN IF NOT EXISTS variation_name text DEFAULT NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS processing_fee numeric DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS parent_sku text DEFAULT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fee_details jsonb DEFAULT '{}'::jsonb;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS last_import_at timestamptz DEFAULT NULL;

-- TABEL ADS PERFORMANCE --
CREATE TABLE IF NOT EXISTS ads_performance (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    periode text NOT NULL,
    report_date date DEFAULT NULL,
    impressions numeric DEFAULT 0,
    clicks numeric DEFAULT 0,
    conversions numeric DEFAULT 0,
    amount_spent numeric DEFAULT 0,
    gmv_generated numeric DEFAULT 0,
    created_at timestamptz DEFAULT now(),
    UNIQUE(store_id, periode)
);

-- Ensure columns exist if table was created previously with different schema
ALTER TABLE ads_performance ADD COLUMN IF NOT EXISTS periode text DEFAULT '';
ALTER TABLE ads_performance ADD COLUMN IF NOT EXISTS report_date date DEFAULT NULL;
ALTER TABLE ads_performance ADD COLUMN IF NOT EXISTS impressions numeric DEFAULT 0;
ALTER TABLE ads_performance ADD COLUMN IF NOT EXISTS clicks numeric DEFAULT 0;
ALTER TABLE ads_performance ADD COLUMN IF NOT EXISTS conversions numeric DEFAULT 0;
ALTER TABLE ads_performance ADD COLUMN IF NOT EXISTS amount_spent numeric DEFAULT 0;
ALTER TABLE ads_performance ADD COLUMN IF NOT EXISTS gmv_generated numeric DEFAULT 0;

-- Fix for existing report_date column that might have NOT NULL constraint
ALTER TABLE ads_performance ALTER COLUMN report_date DROP NOT NULL;

-- Add unique constraint if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ads_performance_store_id_periode_key'
        AND conrelid = 'public.ads_performance'::regclass
    ) THEN
        ALTER TABLE ads_performance ADD CONSTRAINT ads_performance_store_id_periode_key UNIQUE (store_id, periode);
    END IF;
END
$$;

ALTER TABLE ads_performance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable all for authenticated users" ON ads_performance;
CREATE POLICY "Enable all for authenticated users" ON ads_performance FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- TABEL ADS PRODUCTS --
CREATE TABLE IF NOT EXISTS ads_products (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    product_name text NOT NULL,
    hpp numeric DEFAULT 0,
    harga_jual numeric DEFAULT 0,
    proses_pesanan numeric DEFAULT 1250,
    pot_admin_persen numeric DEFAULT 0,
    operasional_persen numeric DEFAULT 0,
    created_at timestamptz DEFAULT now(),
    UNIQUE(store_id, product_name)
);

ALTER TABLE ads_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable all for authenticated users" ON ads_products;
CREATE POLICY "Enable all for authenticated users" ON ads_products FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- TABEL ADS PRODUCT PERFORMANCE --
CREATE TABLE IF NOT EXISTS ads_product_performance (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    ads_product_id uuid NOT NULL REFERENCES ads_products(id) ON DELETE CASCADE,
    periode text NOT NULL,
    report_date date DEFAULT NULL,
    impressions numeric DEFAULT 0,
    clicks numeric DEFAULT 0,
    conversions numeric DEFAULT 0,
    amount_spent numeric DEFAULT 0,
    gmv_generated numeric DEFAULT 0,
    created_at timestamptz DEFAULT now(),
    UNIQUE(ads_product_id, periode)
);

ALTER TABLE ads_product_performance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable all for authenticated users" ON ads_product_performance;
CREATE POLICY "Enable all for authenticated users" ON ads_product_performance FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- BAGIAN 4.5: RPC Safe Delete & Policies --

-- Policy agar user bisa menghapus/edit
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE sku_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable all for authenticated users" ON products;
CREATE POLICY "Enable all for authenticated users" ON products FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Enable all for authenticated users" ON sku_mappings;
CREATE POLICY "Enable all for authenticated users" ON sku_mappings FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Enable all for authenticated users" ON order_items;
CREATE POLICY "Enable all for authenticated users" ON order_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Fungsi Hapus Massal Cepat
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
