-- PERBAIKAN: Tombol "Hapus Toko" di menu Pengaturan selalu gagal.
--
-- Tabel order_items punya DUA foreign key yang bermuara ke stores:
--   1. order_items_store_order_fkey  (store_id, order_id) -> orders  = ON DELETE CASCADE
--   2. order_items_store_id_fkey     (store_id)           -> stores  = ON DELETE NO ACTION
--
-- Semua foreign key lain yang menunjuk ke stores memakai CASCADE; hanya yang
-- nomor 2 ini yang NO ACTION. Akibatnya Postgres menolak "DELETE FROM stores"
-- untuk toko yang masih punya baris order_items (error 23503), sehingga tombol
-- hapus toko tidak pernah bisa berhasil.
--
-- Script ini hanya mengubah aturan ON DELETE milik constraint yang sudah ada.
-- Tidak ada data yang disentuh atau dihapus.
--
-- Sudah dijalankan pada project bsjsqvcrgjqsxvitwudn (migrasi:
-- fix_order_items_store_fk_cascade). Simpan di sini agar database lain yang
-- dibuat dari script repo ini ikut konsisten.

ALTER TABLE public.order_items
  DROP CONSTRAINT IF EXISTS order_items_store_id_fkey;

ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_store_id_fkey
    FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;
