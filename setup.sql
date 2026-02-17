
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
