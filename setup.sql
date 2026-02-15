
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

-- 3. Agar saat Order dihapus -> Items otomatis terhapus (Sudah ada di script sebelumnya, tapi kita pastikan lagi)
ALTER TABLE order_items
DROP CONSTRAINT IF EXISTS order_items_store_order_fkey;

ALTER TABLE order_items
ADD CONSTRAINT order_items_store_order_fkey
FOREIGN KEY (store_id, order_id)
REFERENCES orders (store_id, order_id)
ON DELETE CASCADE;


-- BAGIAN 2: FUNGSI HAPUS AKUN SENDIRI --

-- Fungsi ini berjalan dengan hak akses superuser (SECURITY DEFINER)
-- Tugasnya menghapus user dari tabel auth.users berdasarkan ID yang sedang login
CREATE OR REPLACE FUNCTION delete_user_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Hapus user dari tabel auth (Data toko & order akan ikut terhapus karena CASCADE di atas)
  DELETE FROM auth.users WHERE id = auth.uid();
END;
$$;
