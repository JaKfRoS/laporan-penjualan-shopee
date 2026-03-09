
-- MIGRATION: Fix Unique Constraint for Adjustments Table
-- This ensures that upsert operations work correctly and prevent duplicates.

-- 1. Clean up potential duplicates that would violate the new constraint
-- We keep the most recent one (highest ID or created_at)
DELETE FROM adjustments a USING (
    SELECT MIN(id) as id, store_id, order_id, adjustment_date, amount
    FROM adjustments
    GROUP BY store_id, order_id, adjustment_date, amount
    HAVING COUNT(*) > 1
) b
WHERE a.store_id = b.store_id
AND a.order_id = b.order_id
AND a.adjustment_date = b.adjustment_date
AND a.amount = b.amount
AND a.id <> b.id;

-- 2. Ensure the unique constraint exists
-- We drop it first if it exists under a different name or to be sure we have the right columns
ALTER TABLE adjustments DROP CONSTRAINT IF EXISTS adjustments_store_id_order_id_adjustment_date_amount_key;
ALTER TABLE adjustments DROP CONSTRAINT IF EXISTS adjustments_unique_constraint;

-- Add the composite unique constraint
ALTER TABLE adjustments ADD CONSTRAINT adjustments_unique_constraint UNIQUE (store_id, order_id, adjustment_date, amount);
