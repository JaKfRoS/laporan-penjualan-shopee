
-- MIGRATION: Add Unique Constraint to order_items for Upsert Support
-- This ensures we can safely use upsert to prevent duplicates and data loss.

-- 1. First, clean up any existing duplicates that might violate the constraint
-- We keep the one with the highest ID (most recent)
DELETE FROM order_items a USING (
      SELECT MIN(id) as id, store_id, order_id, product_name, variation
      FROM order_items 
      GROUP BY store_id, order_id, product_name, variation
      HAVING COUNT(*) > 1
    ) b
    WHERE a.store_id = b.store_id 
    AND a.order_id = b.order_id 
    AND a.product_name = b.product_name 
    AND a.variation = b.variation
    AND a.id <> b.id;

-- 2. Add the unique constraint
-- We use COALESCE or ensure variation is not null if we want to include it in the unique key
-- In Shopee, variation can be empty, so we should treat NULL as empty string or use a clever index.
-- For simplicity, let's ensure variation is NOT NULL and defaults to empty string.

ALTER TABLE order_items ALTER COLUMN variation SET DEFAULT '';
UPDATE order_items SET variation = '' WHERE variation IS NULL;
ALTER TABLE order_items ALTER COLUMN variation SET NOT NULL;

-- Now add the unique constraint
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS unique_order_item_per_store;
ALTER TABLE order_items ADD CONSTRAINT unique_order_item_per_store UNIQUE (store_id, order_id, product_name, variation);
