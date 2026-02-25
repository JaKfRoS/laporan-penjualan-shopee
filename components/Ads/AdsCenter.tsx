import React, { useState, useEffect } from 'react';
import { supabase } from '../../services/supabase';
import { Store } from '../../types';
import toast from 'react-hot-toast';
import { Upload, Trash2, Megaphone, TrendingUp, TrendingDown, MousePointerClick, Eye, DollarSign, Percent, ArrowUpRight, ArrowDownRight, Package, ShoppingCart } from 'lucide-react';
import * as XLSX from 'xlsx';
import AdsProducts from './AdsProducts';

interface AdsCenterProps {
  store: Store;
}

interface AdRecord {
  id: string;
  periode: string;
  impressions: number;
  clicks: number;
  conversions: number;
  amount_spent: number;
  gmv_generated: number;
  created_at: string;
}

export default function AdsCenter({ store }: AdsCenterProps) {
  const [records, setRecords] = useState<AdRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [activeTab, setActiveTab] = useState<'overall' | 'products'>('overall');

  const [showSqlGuide, setShowSqlGuide] = useState(false);

  useEffect(() => {
    fetchRecords();
  }, [store.id]);

  const fetchRecords = async () => {
    setLoading(true);
    setShowSqlGuide(false);
    try {
      const { data, error } = await supabase
        .from('ads_performance')
        .select('*')
        .eq('store_id', store.id)
        .order('periode', { ascending: false });

      if (error) {
        if (error.message.includes('does not exist') || error.message.includes('schema cache')) {
          setShowSqlGuide(true);
        }
        throw error;
      }
      setRecords(data || []);
    } catch (err: any) {
      console.error(err);
      toast.error("Gagal memuat data iklan: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const toastId = toast.loading("Memproses file iklan...");

    try {
      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const ab = evt.target?.result as ArrayBuffer;
          const wb = XLSX.read(ab, { type: 'array' });
          const wsname = wb.SheetNames[0];
          const ws = wb.Sheets[wsname];
          const rawData = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 });

          // Find "Periode" in the first few rows
          let periode = '';
          let headerRowIndex = -1;

          for (let i = 0; i < Math.min(20, rawData.length); i++) {
            const row = rawData[i];
            if (!row || row.length === 0) continue;
            
            const firstCellRaw = typeof row[0] === 'string' ? row[0].trim() : String(row[0] || '').trim();
            const firstCell = firstCellRaw.replace(/^["']|["']$/g, '');
            const firstCellLower = firstCell.toLowerCase();
            
            // Check for Periode and Report Date
            if (firstCellLower === 'periode') {
              periode = row[1] ? String(row[1]).trim() : '';
            } else if (firstCellLower.startsWith('periode')) {
              const delimiter = firstCell.includes(';') ? ';' : ',';
              const parts = firstCell.split(delimiter);
              if (parts.length > 1) {
                periode = parts[1]?.trim() || '';
              }
            }
            
            if (periode) {
              periode = periode.replace(/^["']|["']$/g, '');
            }
            
            // Check for header row
            if (row.includes('Nama Iklan') || row.includes('Dilihat') || firstCell.includes('Nama Iklan')) {
              headerRowIndex = i;
            }
          }

          if (!periode) {
            console.error("Raw data first 10 rows:", rawData.slice(0, 10));
            throw new Error("Format file tidak valid: Kolom 'Periode' tidak ditemukan.");
          }

          if (headerRowIndex === -1) {
            throw new Error("Format file tidak valid: Header tabel iklan tidak ditemukan.");
          }

          let headers = rawData[headerRowIndex];
          let dataRows = rawData.slice(headerRowIndex + 1);

          // If it's a single string row (CSV parsed as 1 column), we need to split it
          if (headers.length === 1 && typeof headers[0] === 'string' && (headers[0].includes(',') || headers[0].includes(';'))) {
             const delimiter = headers[0].includes(';') ? ';' : ',';
             
             // Simple CSV split that handles quotes
             const splitCSV = (str: string) => {
               const result = [];
               let current = '';
               let inQuotes = false;
               for (let i = 0; i < str.length; i++) {
                 const char = str[i];
                 if (char === '"') {
                   inQuotes = !inQuotes;
                 } else if (char === delimiter && !inQuotes) {
                   result.push(current);
                   current = '';
                 } else {
                   current += char;
                 }
               }
               result.push(current);
               return result;
             };
             
             headers = splitCSV(headers[0]);
             dataRows = dataRows.map(r => r.length === 1 && typeof r[0] === 'string' ? splitCSV(r[0]) : r);
          }

          const getColIndex = (name: string) => headers.findIndex(h => {
            if (typeof h !== 'string') return false;
            const cleanHeader = h.trim().replace(/^["']|["']$/g, '');
            return cleanHeader === name;
          });
          
          const idxDilihat = getColIndex('Dilihat');
          const idxKlik = getColIndex('Jumlah Klik');
          const idxKonversi = getColIndex('Konversi');
          const idxBiaya = getColIndex('Biaya');
          const idxOmzet = getColIndex('Omzet Penjualan');
          const idxReportDate = getColIndex('Tanggal Laporan'); // New: get index for report_date
          const idxNamaIklan = getColIndex('Nama Iklan'); // New: get index for product name

          if (idxDilihat === -1 || idxKlik === -1 || idxBiaya === -1 || idxOmzet === -1) {
             throw new Error("Format file tidak valid: Kolom metrik utama tidak lengkap.");
          }

          let totalImpressions = 0;
          let totalClicks = 0;
          let totalConversions = 0;
          let totalBiaya = 0;
          let totalOmzet = 0;
          let reportDate: string | null = null; // New: Initialize reportDate

          const productDataMap = new Map<string, any>();

          const parseValue = (val: any) => {
            if (typeof val === 'number') return val;
            if (typeof val !== 'string') return 0;
            const cleanVal = val.trim().replace(/^["']|["']$/g, '');
            const parsed = parseFloat(cleanVal);
            return isNaN(parsed) ? 0 : parsed;
          };

          dataRows.forEach(row => {
            if (!row || row.length === 0 || !row[0]) return;
            
            const imp = parseValue(row[idxDilihat]);
            const clk = parseValue(row[idxKlik]);
            const conv = parseValue(row[idxKonversi]);
            const cost = parseValue(row[idxBiaya]);
            const gmv = parseValue(row[idxOmzet]);

            totalImpressions += imp;
            totalClicks += clk;
            totalConversions += conv;
            totalBiaya += cost;
            totalOmzet += gmv;

            // New: Try to parse report_date from the first valid row
            if (idxReportDate !== -1 && row[idxReportDate] && !reportDate) {
              const dateVal = String(row[idxReportDate]).trim().replace(/^["']|["']$/g, '');
              // Simple date validation/parsing (adjust as needed for specific formats)
              if (dateVal.match(/^\d{4}-\d{2}-\d{2}$/)) {
                reportDate = dateVal;
              } else if (dateVal.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
                const [day, month, year] = dateVal.split('/');
                reportDate = `${year}-${month}-${day}`;
              }
            }

            // Extract product level data
            if (idxNamaIklan !== -1 && row[idxNamaIklan]) {
              const productName = String(row[idxNamaIklan]).trim().replace(/^["']|["']$/g, '');
              if (productName) {
                if (!productDataMap.has(productName)) {
                  productDataMap.set(productName, {
                    impressions: 0,
                    clicks: 0,
                    conversions: 0,
                    amount_spent: 0,
                    gmv_generated: 0
                  });
                }
                const pData = productDataMap.get(productName);
                pData.impressions += imp;
                pData.clicks += clk;
                pData.conversions += conv;
                pData.amount_spent += cost;
                pData.gmv_generated += gmv;
              }
            }
          });

          // Upsert to database
          const { error } = await supabase
            .from('ads_performance')
            .upsert({
              store_id: store.id,
              periode: periode,
              report_date: reportDate, // New: Include report_date
              impressions: totalImpressions,
              clicks: totalClicks,
              conversions: totalConversions,
              amount_spent: totalBiaya,
              gmv_generated: totalOmzet
            }, { onConflict: 'store_id, periode' });

          if (error) throw error;

          // Upsert product level data
          const productNames = Array.from(productDataMap.keys());
          if (productNames.length > 0) {
            // 1. Get existing products
            const { data: existingProducts, error: errProducts } = await supabase
              .from('ads_products')
              .select('id, product_name')
              .eq('store_id', store.id)
              .in('product_name', productNames);

            if (errProducts) throw errProducts;

            const existingProductMap = new Map(existingProducts?.map(p => [p.product_name, p.id]));
            
            // 2. Insert new products
            const newProducts = productNames
              .filter(name => !existingProductMap.has(name))
              .map(name => ({
                store_id: store.id,
                product_name: name,
                hpp: 0,
                harga_jual: 0,
                proses_pesanan: 1250,
                pot_admin_persen: 0,
                operasional_persen: 0
              }));

            if (newProducts.length > 0) {
              const { data: insertedProducts, error: errInsert } = await supabase
                .from('ads_products')
                .insert(newProducts)
                .select('id, product_name');
              
              if (errInsert) throw errInsert;
              insertedProducts?.forEach(p => existingProductMap.set(p.product_name, p.id));
            }

            // 3. Upsert product performance
            const productPerformanceData = productNames.map(name => {
              const pData = productDataMap.get(name);
              return {
                ads_product_id: existingProductMap.get(name),
                periode: periode,
                report_date: reportDate,
                impressions: pData.impressions,
                clicks: pData.clicks,
                conversions: pData.conversions,
                amount_spent: pData.amount_spent,
                gmv_generated: pData.gmv_generated
              };
            });

            const { error: errPerf } = await supabase
              .from('ads_product_performance')
              .upsert(productPerformanceData, { onConflict: 'ads_product_id, periode' });

            if (errPerf) throw errPerf;
          }

          toast.success(`Data iklan periode ${periode} berhasil disimpan!`, { id: toastId });
          fetchRecords();
        } catch (err: any) {
          console.error(err);
          toast.error(err.message || "Gagal memproses file", { id: toastId });
        } finally {
          setIsUploading(false);
          // Reset file input
          e.target.value = '';
        }
      };
      reader.readAsArrayBuffer(file);
    } catch (err: any) {
      console.error(err);
      toast.error("Gagal membaca file", { id: toastId });
      setIsUploading(false);
      e.target.value = '';
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Hapus data iklan ini?")) return;
    
    try {
      const { error } = await supabase.from('ads_performance').delete().eq('id', id);
      if (error) throw error;
      toast.success("Data berhasil dihapus");
      fetchRecords();
    } catch (err: any) {
      toast.error("Gagal menghapus: " + err.message);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm">
        <div>
          <h2 className="text-xl md:text-2xl font-black uppercase tracking-tight flex items-center gap-3">
            <Megaphone className="w-6 h-6 md:w-8 md:h-8 text-blue-600" />
            Ads Center
          </h2>
          <p className="text-sm text-slate-500 mt-1">Jurnal performa iklan Shopee Anda</p>
        </div>
        
        <div className="flex flex-col md:flex-row items-center gap-4 w-full md:w-auto">
          <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl w-full md:w-auto">
            <button
              onClick={() => setActiveTab('overall')}
              className={`flex-1 md:flex-none px-4 py-2 rounded-lg text-sm font-bold transition-colors ${
                activeTab === 'overall' 
                  ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm' 
                  : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              Keseluruhan
            </button>
            <button
              onClick={() => setActiveTab('products')}
              className={`flex-1 md:flex-none px-4 py-2 rounded-lg text-sm font-bold transition-colors flex items-center justify-center gap-2 ${
                activeTab === 'products' 
                  ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm' 
                  : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              <Package className="w-4 h-4" /> Performa Produk
            </button>
          </div>

          <label className="cursor-pointer bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20 w-full md:w-auto">
            <Upload className="w-5 h-5" />
            {isUploading ? 'Memproses...' : 'Upload Laporan Iklan'}
            <input 
              type="file" 
              accept=".csv, .xlsx, .xls" 
              className="hidden" 
              onChange={handleFileUpload}
              disabled={isUploading}
            />
          </label>
        </div>
      </div>

      {showSqlGuide && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-6 rounded-3xl">
          <h3 className="text-lg font-bold text-amber-800 dark:text-amber-500 mb-2">Update Database Diperlukan</h3>
          <p className="text-sm text-amber-700 dark:text-amber-400 mb-4">
            Tabel ads_performance belum ada atau kolom periode tidak ditemukan. Silakan jalankan script SQL berikut di Supabase SQL Editor Anda:
          </p>
          <div className="bg-slate-900 rounded-xl p-4 relative group">
            <pre className="text-xs text-slate-300 overflow-x-auto whitespace-pre-wrap">
{`-- TABEL ADS PERFORMANCE --
CREATE TABLE IF NOT EXISTS ads_performance (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    periode text NOT NULL,
    report_date date DEFAULT NULL, -- New: Added report_date column
    impressions numeric DEFAULT 0,
    clicks numeric DEFAULT 0,
    conversions numeric DEFAULT 0,
    amount_spent numeric DEFAULT 0,
    gmv_generated numeric DEFAULT 0,
    created_at timestamptz DEFAULT now(),
    UNIQUE(store_id, periode)
);

-- TABEL ADS PRODUCTS --
CREATE TABLE IF NOT EXISTS ads_products (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    product_name text NOT NULL,
    hpp numeric DEFAULT 0,
    harga_jual numeric DEFAULT 0,
    proses_pesanan numeric DEFAULT 1250,
    pot_admin_persen numeric DEFAULT 0,
    operasional_persen numeric DEFAULT 0,
    created_at timestamptz DEFAULT now(),
    UNIQUE(store_id, product_name)
);

-- TABEL ADS PRODUCT PERFORMANCE --
CREATE TABLE IF NOT EXISTS ads_product_performance (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    ads_product_id uuid NOT NULL REFERENCES ads_products(id) ON DELETE CASCADE,
    periode text NOT NULL,
    report_date date DEFAULT NULL,
    impressions numeric DEFAULT 0,
    clicks numeric DEFAULT 0,
    conversions numeric DEFAULT 0,
    amount_spent numeric DEFAULT 0,
    gmv_generated numeric DEFAULT 0,
    created_at timestamptz DEFAULT now(),
    UNIQUE(ads_product_id, periode)
);

-- Ensure columns exist if table was created previously with different schema
ALTER TABLE ads_performance ADD COLUMN IF NOT EXISTS periode text DEFAULT '';
ALTER TABLE ads_performance ADD COLUMN IF NOT EXISTS report_date date DEFAULT NULL; -- New: Added report_date column
ALTER TABLE ads_performance ADD COLUMN IF NOT EXISTS impressions numeric DEFAULT 0;
ALTER TABLE ads_performance ADD COLUMN IF NOT EXISTS clicks numeric DEFAULT 0;
ALTER TABLE ads_performance ADD COLUMN IF NOT EXISTS conversions numeric DEFAULT 0;
ALTER TABLE ads_performance ADD COLUMN IF NOT EXISTS amount_spent numeric DEFAULT 0;
ALTER TABLE ads_performance ADD COLUMN IF NOT EXISTS gmv_generated numeric DEFAULT 0;

-- Fix for existing report_date column that might have NOT NULL constraint
ALTER TABLE ads_performance ALTER COLUMN report_date DROP NOT NULL;

-- Add unique constraint if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ads_performance_store_id_periode_key'
        AND conrelid = 'public.ads_performance'::regclass
    ) THEN
        ALTER TABLE ads_performance ADD CONSTRAINT ads_performance_store_id_periode_key UNIQUE (store_id, periode);
    END IF;
END
$$;

ALTER TABLE ads_performance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable all for authenticated users" ON ads_performance;
CREATE POLICY "Enable all for authenticated users" ON ads_performance FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE ads_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable all for authenticated users" ON ads_products;
CREATE POLICY "Enable all for authenticated users" ON ads_products FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE ads_product_performance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable all for authenticated users" ON ads_product_performance;
CREATE POLICY "Enable all for authenticated users" ON ads_product_performance FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Reload Schema Cache (Jalankan ini jika error masih muncul)
NOTIFY pgrst, 'reload schema';`}
            </pre>
            <button 
              onClick={() => {
                navigator.clipboard.writeText(`CREATE TABLE IF NOT EXISTS ads_performance (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    periode text NOT NULL,
    report_date date DEFAULT NULL, -- New: Added report_date column
    impressions numeric DEFAULT 0,
    clicks numeric DEFAULT 0,
    conversions numeric DEFAULT 0,
    amount_spent numeric DEFAULT 0,
    gmv_generated numeric DEFAULT 0,
    created_at timestamptz DEFAULT now(),
    UNIQUE(store_id, periode)
);
CREATE TABLE IF NOT EXISTS ads_products (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    product_name text NOT NULL,
    hpp numeric DEFAULT 0,
    harga_jual numeric DEFAULT 0,
    proses_pesanan numeric DEFAULT 1250,
    pot_admin_persen numeric DEFAULT 0,
    operasional_persen numeric DEFAULT 0,
    created_at timestamptz DEFAULT now(),
    UNIQUE(store_id, product_name)
);
CREATE TABLE IF NOT EXISTS ads_product_performance (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    ads_product_id uuid NOT NULL REFERENCES ads_products(id) ON DELETE CASCADE,
    periode text NOT NULL,
    report_date date DEFAULT NULL,
    impressions numeric DEFAULT 0,
    clicks numeric DEFAULT 0,
    conversions numeric DEFAULT 0,
    amount_spent numeric DEFAULT 0,
    gmv_generated numeric DEFAULT 0,
    created_at timestamptz DEFAULT now(),
    UNIQUE(ads_product_id, periode)
);
ALTER TABLE ads_performance ADD COLUMN IF NOT EXISTS periode text DEFAULT '';
ALTER TABLE ads_performance ADD COLUMN IF NOT EXISTS report_date date DEFAULT NULL; -- New: Added report_date column
ALTER TABLE ads_performance ADD COLUMN IF NOT EXISTS impressions numeric DEFAULT 0;
ALTER TABLE ads_performance ADD COLUMN IF NOT EXISTS clicks numeric DEFAULT 0;
ALTER TABLE ads_performance ADD COLUMN IF NOT EXISTS conversions numeric DEFAULT 0;
ALTER TABLE ads_performance ADD COLUMN IF NOT EXISTS amount_spent numeric DEFAULT 0;
ALTER TABLE ads_performance ADD COLUMN IF NOT EXISTS gmv_generated numeric DEFAULT 0;
ALTER TABLE ads_performance ALTER COLUMN report_date DROP NOT NULL;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ads_performance_store_id_periode_key'
        AND conrelid = 'public.ads_performance'::regclass
    ) THEN
        ALTER TABLE ads_performance ADD CONSTRAINT ads_performance_store_id_periode_key UNIQUE (store_id, periode);
    END IF;
END
$$;
ALTER TABLE ads_performance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable all for authenticated users" ON ads_performance;
CREATE POLICY "Enable all for authenticated users" ON ads_performance FOR ALL TO authenticated USING (true) WITH CHECK (true);
ALTER TABLE ads_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable all for authenticated users" ON ads_products;
CREATE POLICY "Enable all for authenticated users" ON ads_products FOR ALL TO authenticated USING (true) WITH CHECK (true);
ALTER TABLE ads_product_performance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable all for authenticated users" ON ads_product_performance;
CREATE POLICY "Enable all for authenticated users" ON ads_product_performance FOR ALL TO authenticated USING (true) WITH CHECK (true);
NOTIFY pgrst, 'reload schema';`);
                toast.success("Script disalin!");
              }}
              className="absolute top-2 right-2 bg-slate-800 hover:bg-slate-700 text-white px-3 py-1 rounded-lg text-xs font-bold transition-colors"
            >
              Copy SQL
            </button>
          </div>
          <p className="text-xs text-amber-700 dark:text-amber-400 mt-4 font-medium">
            * Jika Anda sudah menjalankan script ini dan masih error, tunggu sekitar 1-2 menit agar cache database Supabase ter-refresh, lalu muat ulang halaman ini.
          </p>
          <button 
            onClick={() => window.location.reload()}
            className="mt-4 bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-xl text-sm font-bold transition-colors"
          >
            Muat Ulang Halaman
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      ) : activeTab === 'products' ? (
        <AdsProducts store={store} />
      ) : records.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800 p-12 text-center">
          <div className="w-20 h-20 bg-slate-50 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4">
            <Megaphone className="w-10 h-10 text-slate-400" />
          </div>
          <h3 className="text-lg font-bold mb-2">Belum ada data iklan</h3>
          <p className="text-slate-500 max-w-md mx-auto">
            Upload file laporan iklan dari Shopee Seller Centre untuk mulai melacak performa iklan Anda.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {records.map((record, index) => {
            const ctr = record.impressions > 0 ? (record.clicks / record.impressions) * 100 : 0;
            const cr = record.clicks > 0 ? (record.conversions / record.clicks) * 100 : 0;
            const roas = record.amount_spent > 0 ? record.gmv_generated / record.amount_spent : 0;
            const acos = record.gmv_generated > 0 ? (record.amount_spent / record.gmv_generated) * 100 : 0;
            const cpc = record.clicks > 0 ? record.amount_spent / record.clicks : 0;

            const prevRecord = records[index + 1];
            const prevCtr = prevRecord && prevRecord.impressions > 0 ? (prevRecord.clicks / prevRecord.impressions) * 100 : 0;
            const prevCr = prevRecord && prevRecord.clicks > 0 ? (prevRecord.conversions / prevRecord.clicks) * 100 : 0;
            const prevRoas = prevRecord && prevRecord.amount_spent > 0 ? prevRecord.gmv_generated / prevRecord.amount_spent : 0;
            const prevAcos = prevRecord && prevRecord.gmv_generated > 0 ? (prevRecord.amount_spent / prevRecord.gmv_generated) * 100 : 0;
            const prevCpc = prevRecord && prevRecord.clicks > 0 ? prevRecord.amount_spent / prevRecord.clicks : 0;

            const renderIndicator = (current: number, previous: number | undefined, inverse: boolean = false) => {
              if (previous === undefined || previous === 0) return null;
              const diff = current - previous;
              const percentChange = (diff / previous) * 100;
              
              if (percentChange === 0) return null;

              const isPositive = percentChange > 0;
              // If inverse is true (like for ACOS or CPC or Biaya), lower is better
              const isGood = inverse ? !isPositive : isPositive;
              
              const colorClass = isGood ? 'text-emerald-600 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-500/10' : 'text-rose-600 bg-rose-50 dark:text-rose-400 dark:bg-rose-500/10';
              const Icon = isPositive ? TrendingUp : TrendingDown;

              return (
                <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${colorClass}`} title={`${isPositive ? '+' : ''}${percentChange.toFixed(2)}% vs minggu lalu`}>
                  <Icon className="w-3 h-3" />
                  {Math.abs(percentChange).toFixed(1)}%
                </span>
              );
            };

            return (
              <div key={record.id} className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800 overflow-hidden shadow-sm">
                <div className="p-4 md:p-6 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-800/20">
                  <div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Periode Mingguan</p>
                    <h3 className="text-lg font-black">{record.periode}</h3>
                  </div>
                  <button 
                    onClick={() => handleDelete(record.id)}
                    className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors"
                    title="Hapus data"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
                
                <div className="p-4 md:p-6 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4 md:gap-6">
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-slate-500 flex items-center gap-1"><Eye className="w-3 h-3" /> Dilihat</p>
                    <div className="flex items-center gap-2">
                      <p className="text-xl font-bold">{record.impressions.toLocaleString()}</p>
                      {renderIndicator(record.impressions, prevRecord?.impressions)}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-slate-500 flex items-center gap-1"><MousePointerClick className="w-3 h-3" /> Klik</p>
                    <div className="flex items-center gap-2">
                      <p className="text-xl font-bold">{record.clicks.toLocaleString()}</p>
                      {renderIndicator(record.clicks, prevRecord?.clicks)}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-slate-500 flex items-center gap-1"><ShoppingCart className="w-3 h-3" /> Pesanan</p>
                    <div className="flex items-center gap-2">
                      <p className="text-xl font-bold">{record.conversions.toLocaleString()}</p>
                      {renderIndicator(record.conversions, prevRecord?.conversions)}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-slate-500 flex items-center gap-1"><Percent className="w-3 h-3" /> Persentase Klik</p>
                    <div className="flex items-center gap-2">
                      <p className="text-xl font-bold">{ctr.toFixed(2)}%</p>
                      {renderIndicator(ctr, prevCtr)}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-slate-500 flex items-center gap-1"><TrendingUp className="w-3 h-3" /> CR%</p>
                    <div className="flex items-center gap-2">
                      <p className="text-xl font-bold">{cr.toFixed(2)}%</p>
                      {renderIndicator(cr, prevCr)}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-slate-500 flex items-center gap-1"><DollarSign className="w-3 h-3" /> ROAS</p>
                    <div className="flex items-center gap-2">
                      <p className={`text-xl font-bold ${roas >= 5 ? 'text-green-600' : roas >= 3 ? 'text-orange-500' : 'text-red-600'}`}>
                        {roas.toFixed(2)}x
                      </p>
                      {renderIndicator(roas, prevRoas)}
                    </div>
                  </div>
                  
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-slate-500">Biaya Iklan</p>
                    <div className="flex items-center gap-2">
                      <p className="text-xl font-bold text-red-600">Rp {record.amount_spent.toLocaleString()}</p>
                      {renderIndicator(record.amount_spent, prevRecord?.amount_spent, true)}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-slate-500">Penjualan (Iklan)</p>
                    <div className="flex items-center gap-2">
                      <p className="text-xl font-bold text-green-600">Rp {record.gmv_generated.toLocaleString()}</p>
                      {renderIndicator(record.gmv_generated, prevRecord?.gmv_generated)}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-slate-500">ACOS%</p>
                    <div className="flex items-center gap-2">
                      <p className="text-xl font-bold">{acos.toFixed(2)}%</p>
                      {renderIndicator(acos, prevAcos, true)}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-slate-500">CPC</p>
                    <div className="flex items-center gap-2">
                      <p className="text-xl font-bold">Rp {Math.round(cpc).toLocaleString()}</p>
                      {renderIndicator(cpc, prevCpc, true)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
