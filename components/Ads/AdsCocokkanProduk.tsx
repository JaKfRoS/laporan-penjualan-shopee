import React, { useState, useEffect, useMemo, useRef } from 'react';
import Fuse from 'fuse.js';
import toast from 'react-hot-toast';
import { Upload, CheckCircle2, AlertTriangle, Search, X, Loader2, Link2, RotateCcw } from 'lucide-react';
import { supabase } from '../../services/supabase';
import { parseAdsManagerFile, ParsedAdsReport } from '../../services/adsImport';
import { Store, Product, IklanProdukMapping } from '../../types';

interface AdsCocokkanProdukProps {
  store: Store;
  onImported: () => void; // beritahu parent (AdsCenter) supaya dashboard di-refresh
}

interface ReviewRow {
  namaIklanRaw: string;
  jenisIklan: string | null;
  impresi: number;
  klik: number;
  produkTerjual: number;
  biaya: number;
  omzet: number;
  selectedSku: string | null;
  isNewMapping: boolean; // true = belum ada baris iklan_produk_mapping untuk nama ini
}

const normalize = (s: string) => s.trim().toLowerCase();

export default function AdsCocokkanProduk({ store, onImported }: AdsCocokkanProdukProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [mappings, setMappings] = useState<IklanProdukMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [parsedMeta, setParsedMeta] = useState<{ periodeMulai: string; periodeAkhir: string } | null>(null);
  const [reviewRows, setReviewRows] = useState<ReviewRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [pickerFor, setPickerFor] = useState<string | null>(null); // namaIklanRaw yang sedang pilih produk
  const [pickerSearch, setPickerSearch] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchBaseData();
  }, [store.id]);

  const fetchBaseData = async () => {
    setLoading(true);
    try {
      const [{ data: prods, error: errProds }, { data: maps, error: errMaps }] = await Promise.all([
        supabase.from('products').select('*').eq('store_id', store.id),
        supabase.from('iklan_produk_mapping').select('*').eq('store_id', store.id),
      ]);
      if (errProds) throw errProds;
      if (errMaps) throw errMaps;
      setProducts(prods || []);
      setMappings(maps || []);
    } catch (err: any) {
      toast.error('Gagal memuat data: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const productsFuse = useMemo(
    () =>
      new Fuse(products, {
        keys: [
          { name: 'product_name', weight: 0.6 },
          { name: 'sku', weight: 0.4 },
        ],
        threshold: 0.4,
        ignoreLocation: true,
        minMatchCharLength: 2,
      }),
    [products]
  );

  const mappingBySkuLookup = useMemo(() => new Map(products.map(p => [p.sku, p])), [products]);
  const mappingByName = useMemo(() => new Map(mappings.map(m => [m.nama_iklan_raw, m])), [mappings]);

  const autoMatchSku = (namaIklanRaw: string): string | null => {
    // 1. Cocok persis (case-insensitive) dulu - paling bisa dipercaya
    const exact = products.find(p => normalize(p.product_name) === normalize(namaIklanRaw));
    if (exact) return exact.sku;
    // 2. Fallback kemiripan nama via Fuse - ambil kandidat teratas kalau skornya cukup dekat
    const results = productsFuse.search(namaIklanRaw, { limit: 1 });
    if (results.length > 0 && (results[0].score ?? 1) <= 0.35) return results[0].item.sku;
    return null;
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    try {
      const buffer = await file.arrayBuffer();
      const parsed: ParsedAdsReport = parseAdsManagerFile(buffer);

      const rows: ReviewRow[] = parsed.rows.map(r => {
        const existingMapping = mappingByName.get(r.namaIklanRaw);
        const selectedSku = existingMapping ? existingMapping.product_sku : autoMatchSku(r.namaIklanRaw);
        return {
          namaIklanRaw: r.namaIklanRaw,
          jenisIklan: r.jenisIklan,
          impresi: r.impresi,
          klik: r.klik,
          produkTerjual: r.produkTerjual,
          biaya: r.biaya,
          omzet: r.omzet,
          selectedSku,
          isNewMapping: !existingMapping,
        };
      });

      setParsedMeta({ periodeMulai: parsed.periodeMulai, periodeAkhir: parsed.periodeAkhir });
      setReviewRows(rows);
      toast.success(`${rows.length} baris iklan terbaca, periode ${parsed.periodeMulai} s/d ${parsed.periodeAkhir}`);
    } catch (err: any) {
      toast.error(err.message || 'Gagal membaca file');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const assignSku = (namaIklanRaw: string, sku: string | null, fromReview: boolean) => {
    if (fromReview) {
      setReviewRows(prev => prev.map(r => (r.namaIklanRaw === namaIklanRaw ? { ...r, selectedSku: sku } : r)));
    } else {
      // Assign langsung untuk mapping lama (di luar alur upload) - simpan seketika.
      saveDirectMapping(namaIklanRaw, sku);
    }
    setPickerFor(null);
    setPickerSearch('');
  };

  const saveDirectMapping = async (namaIklanRaw: string, sku: string | null) => {
    try {
      const { error } = await supabase
        .from('iklan_produk_mapping')
        .update({ product_sku: sku, updated_at: new Date().toISOString() })
        .eq('store_id', store.id)
        .eq('nama_iklan_raw', namaIklanRaw);
      if (error) throw error;

      // Backfill product_sku di riwayat iklan_mingguan yang sudah tersimpan untuk nama ini,
      // supaya dashboard & filter per-produk langsung ikut update tanpa perlu upload ulang.
      await supabase
        .from('iklan_mingguan')
        .update({ product_sku: sku })
        .eq('store_id', store.id)
        .eq('nama_iklan_raw', namaIklanRaw);

      toast.success('Produk berhasil dicocokkan');
      fetchBaseData();
      onImported();
    } catch (err: any) {
      toast.error('Gagal menyimpan pencocokan: ' + err.message);
    }
  };

  const handleSaveImport = async () => {
    if (!parsedMeta || reviewRows.length === 0) return;
    setSaving(true);
    try {
      const mappingUpserts = reviewRows
        .filter(r => r.isNewMapping)
        .map(r => ({
          store_id: store.id,
          nama_iklan_raw: r.namaIklanRaw,
          product_sku: r.selectedSku,
        }));

      if (mappingUpserts.length > 0) {
        const { error: errMap } = await supabase
          .from('iklan_produk_mapping')
          .upsert(mappingUpserts, { onConflict: 'store_id,nama_iklan_raw' });
        if (errMap) throw errMap;
      }

      // Untuk baris yang sudah punya mapping tapi user ubah pilihannya saat review,
      // update juga product_sku di mapping (bukan cuma di iklan_mingguan).
      const mappingUpdates = reviewRows.filter(
        r => !r.isNewMapping && mappingByName.get(r.namaIklanRaw)?.product_sku !== r.selectedSku
      );
      for (const r of mappingUpdates) {
        await supabase
          .from('iklan_produk_mapping')
          .update({ product_sku: r.selectedSku, updated_at: new Date().toISOString() })
          .eq('store_id', store.id)
          .eq('nama_iklan_raw', r.namaIklanRaw);
      }

      const iklanMingguanUpserts = reviewRows.map(r => ({
        store_id: store.id,
        periode_mulai: parsedMeta.periodeMulai,
        periode_akhir: parsedMeta.periodeAkhir,
        nama_iklan_raw: r.namaIklanRaw,
        jenis_iklan: r.jenisIklan,
        product_sku: r.selectedSku,
        biaya: r.biaya,
        impresi: r.impresi,
        klik: r.klik,
        produk_terjual: r.produkTerjual,
        omzet: r.omzet,
      }));

      const { error: errData } = await supabase
        .from('iklan_mingguan')
        .upsert(iklanMingguanUpserts, { onConflict: 'store_id,nama_iklan_raw,periode_mulai,periode_akhir' });
      if (errData) throw errData;

      toast.success('Data iklan berhasil disimpan!');
      setReviewRows([]);
      setParsedMeta(null);
      fetchBaseData();
      onImported();
    } catch (err: any) {
      toast.error('Gagal menyimpan: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const belumDicocokkan = mappings.filter(m => !m.product_sku);

  const ProductPicker: React.FC<{ namaIklanRaw: string; onPick: (sku: string | null) => void }> = ({ namaIklanRaw, onPick }) => {
    const results = pickerSearch.trim() ? productsFuse.search(pickerSearch.trim()).map(r => r.item).slice(0, 8) : products.slice(0, 8);
    return (
      <div className="absolute z-40 mt-1 w-72 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl overflow-hidden">
        <div className="p-2 border-b border-slate-100 dark:border-slate-700 flex items-center gap-2">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            autoFocus
            value={pickerSearch}
            onChange={e => setPickerSearch(e.target.value)}
            placeholder="Cari produk/SKU..."
            className="w-full text-sm outline-none bg-transparent text-slate-900 dark:text-white"
          />
          <button onClick={() => { setPickerFor(null); setPickerSearch(''); }} className="text-slate-400 hover:text-slate-600">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="max-h-56 overflow-y-auto">
          <button
            onClick={() => onPick(null)}
            className="w-full text-left px-3 py-2 text-xs text-slate-400 italic hover:bg-slate-50 dark:hover:bg-slate-700/50"
          >
            Kosongkan (belum dicocokkan)
          </button>
          {results.map(p => (
            <button
              key={p.sku}
              onClick={() => onPick(p.sku)}
              className="w-full text-left px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700/50 border-t border-slate-50 dark:border-slate-700/50"
            >
              <p className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">{p.product_name}</p>
              <p className="text-[10px] text-slate-400">{p.sku}</p>
            </button>
          ))}
          {results.length === 0 && <p className="px-3 py-4 text-xs text-slate-400 text-center">Tidak ada produk cocok</p>}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800 p-6 shadow-sm">
        <h3 className="font-black text-slate-800 dark:text-slate-100 mb-1">Upload Laporan Iklan</h3>
        <p className="text-sm text-slate-500 mb-4">Upload file export dari Shopee Ads Manager (.xlsx/.csv) untuk periode mingguan.</p>
        <label className="inline-flex cursor-pointer items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-xl font-bold transition-all shadow-lg shadow-blue-500/20">
          <Upload className="w-5 h-5" />
          {isUploading ? 'Memproses...' : 'Pilih File'}
          <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleFileUpload} disabled={isUploading} />
        </label>
      </div>

      {reviewRows.length > 0 && parsedMeta && (
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/20">
            <div>
              <h3 className="font-black text-slate-800 dark:text-slate-100">Cocokkan Produk</h3>
              <p className="text-xs text-slate-500">Periode {parsedMeta.periodeMulai} s/d {parsedMeta.periodeAkhir} &middot; {reviewRows.length} baris iklan</p>
            </div>
            <button
              onClick={() => { setReviewRows([]); setParsedMeta(null); }}
              className="text-xs font-bold text-slate-400 hover:text-red-500 flex items-center gap-1"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Batal
            </button>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {reviewRows.map(row => {
              const matchedProduct = row.selectedSku ? mappingBySkuLookup.get(row.selectedSku) : null;
              return (
                <div key={row.namaIklanRaw} className="px-6 py-3 flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-200 truncate" title={row.namaIklanRaw}>{row.namaIklanRaw}</p>
                    <p className="text-[10px] text-slate-400">{row.jenisIklan || 'Jenis iklan tidak diketahui'} &middot; Rp {row.biaya.toLocaleString()} biaya &middot; {row.produkTerjual} terjual</p>
                  </div>
                  <div className="relative shrink-0">
                    {matchedProduct ? (
                      <button
                        onClick={() => { setPickerFor(row.namaIklanRaw); setPickerSearch(''); }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 rounded-lg text-xs font-bold hover:bg-emerald-100 transition-colors max-w-[220px]"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{matchedProduct.product_name}</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => { setPickerFor(row.namaIklanRaw); setPickerSearch(''); }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 rounded-lg text-xs font-bold hover:bg-amber-100 transition-colors"
                      >
                        <AlertTriangle className="w-3.5 h-3.5" /> Belum dicocokkan
                      </button>
                    )}
                    {pickerFor === row.namaIklanRaw && (
                      <ProductPicker namaIklanRaw={row.namaIklanRaw} onPick={sku => assignSku(row.namaIklanRaw, sku, true)} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900/50 border-t border-slate-100 dark:border-slate-800 flex justify-end">
            <button
              onClick={handleSaveImport}
              disabled={saving}
              className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl font-black text-sm shadow-lg shadow-blue-500/20 transition-all"
            >
              {saving ? 'Menyimpan...' : 'Simpan Data Iklan'}
            </button>
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20">
          <h3 className="font-black text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Link2 className="w-4 h-4 text-amber-500" /> Produk Belum Dicocokkan
          </h3>
          <p className="text-xs text-slate-500">Nama iklan dari upload sebelumnya yang belum terhubung ke Master Produk.</p>
        </div>
        {belumDicocokkan.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-slate-400">Semua nama iklan sudah dicocokkan ke Master Produk. 🎉</p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {belumDicocokkan.map(m => (
              <div key={m.id} className="px-6 py-3 flex items-center justify-between gap-4">
                <p className="text-sm font-bold text-slate-800 dark:text-slate-200 truncate">{m.nama_iklan_raw}</p>
                <div className="relative shrink-0">
                  <button
                    onClick={() => { setPickerFor(m.nama_iklan_raw); setPickerSearch(''); }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 rounded-lg text-xs font-bold hover:bg-amber-100 transition-colors"
                  >
                    <AlertTriangle className="w-3.5 h-3.5" /> Cocokkan
                  </button>
                  {pickerFor === m.nama_iklan_raw && (
                    <ProductPicker namaIklanRaw={m.nama_iklan_raw} onPick={sku => assignSku(m.nama_iklan_raw, sku, false)} />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
