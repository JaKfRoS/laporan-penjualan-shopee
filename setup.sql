
-- Update tabel orders untuk menyertakan product_total
ALTER TABLE orders ADD COLUMN IF NOT EXISTS product_total numeric default 0;

-- Refresh fungsi RPC jika perlu (opsional tapi baik untuk konsistensi)
CREATE OR REPLACE FUNCTION delete_all_store_orders(target_store_id uuid)
RETURNS boolean 
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = public
AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM stores WHERE id = target_store_id AND user_id = auth.uid()) THEN
        DELETE FROM orders WHERE store_id = target_store_id;
        RETURN true;
    ELSE
        RETURN false;
    END IF;
END;
$$;
