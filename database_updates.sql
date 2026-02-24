-- BAGIAN PENTING: KOLOM BARU --
ALTER TABLE products ADD COLUMN IF NOT EXISTS variation_name text DEFAULT NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS processing_fee numeric DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fee_details jsonb DEFAULT '{}'::jsonb;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS last_import_at timestamptz DEFAULT NULL;

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
