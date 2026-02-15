
-- LANGKAH 1: Tambahkan kolom store_id ke order_items (jika belum ada)
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES stores(id);

-- LANGKAH 2: Isi data store_id yang kosong di order_items berdasarkan data orders
-- Ini PENTING agar data lama tidak error saat constraint baru dipasang
UPDATE order_items 
SET store_id = orders.store_id 
FROM orders 
WHERE order_items.order_id = orders.order_id 
AND order_items.store_id IS NULL;

-- LANGKAH 3: Hapus Foreign Key lama pada order_items
-- Kita gunakan IF EXISTS agar tidak error jika sudah dihapus
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_order_id_fkey;

-- LANGKAH 4: Hapus Constraint Unik lama pada orders (gunakan CASCADE untuk memaksa)
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_order_id_key CASCADE;

-- LANGKAH 5: Buat aturan unik baru: Kombinasi (Store ID + Order ID)
-- Ini yang mencegah data tertumpuk antar toko, tapi membolehkan Order ID sama di toko berbeda
ALTER TABLE orders ADD CONSTRAINT orders_store_order_unique UNIQUE (store_id, order_id);

-- LANGKAH 6: Buat ulang Foreign Key pada order_items agar mengarah ke (store_id, order_id)
-- Ini memastikan item produk terikat kuat ke toko spesifik
ALTER TABLE order_items
ADD CONSTRAINT order_items_store_order_fkey
FOREIGN KEY (store_id, order_id)
REFERENCES orders (store_id, order_id)
ON DELETE CASCADE;

-- LANGKAH 7: Fungsi untuk menghapus data toko dengan aman
CREATE OR REPLACE FUNCTION delete_all_store_orders(target_store_id uuid)
RETURNS boolean 
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = public
AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM stores WHERE id = target_store_id AND user_id = auth.uid()) THEN
        -- Karena ada ON DELETE CASCADE pada order_items, menghapus orders akan otomatis menghapus items-nya
        DELETE FROM orders WHERE store_id = target_store_id;
        RETURN true;
    ELSE
        RETURN false;
    END IF;
END;
$$;
