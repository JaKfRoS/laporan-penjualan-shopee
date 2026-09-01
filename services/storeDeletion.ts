/**
 * Deleting a store used to be a single `delete().eq('id', id)` on `stores`, which
 * failed in two silent ways:
 *
 *  - If any child table's foreign key to `stores` was created without
 *    ON DELETE CASCADE, Postgres rejects the delete (23503) and the store stays.
 *  - Under RLS a delete that matches no visible row removes nothing and still
 *    reports no error, so the app showed "berhasil dihapus" while the store came
 *    back on the next refresh.
 *
 * So: clear the store's own rows first (the confirm dialog already says all of
 * the store's data goes with it), then delete the store and make PostgREST hand
 * the deleted row back so we can tell a real deletion from a no-op.
 */

// Children before parents: order_items -> orders, sku_mappings -> products, and
// ads_product_performance cascades from ads_products.
export const STORE_CHILD_TABLES = [
  'order_items',
  'orders',
  'income_reports',
  'adjustments',
  'product_line_items',
  'ads_performance',
  'ads_products',
  'sku_mappings',
  'products',
  'expenses',
];

// An older database may not have every table yet; that is not a failure.
const isMissingTable = (error: any) =>
  error?.code === '42P01' || /does not exist|could not find the table|schema cache/i.test(error?.message || '');

export const deleteStoreWithData = async (supabase: any, storeId: string): Promise<void> => {
  for (const table of STORE_CHILD_TABLES) {
    const { error } = await supabase.from(table).delete().eq('store_id', storeId);
    if (error && !isMissingTable(error)) throw error;
  }

  const { data, error } = await supabase.from('stores').delete().eq('id', storeId).select('id');
  if (error) throw error;

  if (!data || data.length === 0) {
    throw new Error(
      'Toko tidak jadi terhapus — database menolak permintaan ini. Coba muat ulang halaman lalu ulangi; jika masih gagal, kemungkinan izin akses (RLS) pada tabel stores perlu diperiksa.'
    );
  }
};
