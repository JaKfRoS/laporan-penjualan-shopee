CREATE TABLE IF NOT EXISTS product_line_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    store_id UUID REFERENCES stores(id) ON DELETE CASCADE,
    order_id TEXT NOT NULL,
    product_id TEXT,
    product_name TEXT NOT NULL,
    variation_name TEXT,
    quantity INTEGER DEFAULT 1,
    original_price NUMERIC DEFAULT 0,
    net_revenue NUMERIC DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(store_id, order_id, product_name, variation_name)
);
