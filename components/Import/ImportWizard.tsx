
import React, { useState } from 'react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { supabase } from '../../services/supabase';
import { Store, Mapping, RawRow, Product } from '../../types';
import { toast } from 'react-hot-toast';
import { FileUp, Columns, CheckCircle2, ChevronRight, Loader2, Info, Calculator, Store as StoreIcon, ShoppingBag, Megaphone, Percent } from 'lucide-react';

interface ImportWizardProps {
  store: Store;
  onComplete: () => void;
}

// ALIAS HEADER MAPPING (Urutan Sangat Penting: Prioritas Atas dipilih duluan)
const HEADER_ALIASES: Record<string, string[]> = {
  "order_id": ["No. Pesanan", "Order ID", "No. Transaksi"],
  "order_date": ["Waktu Pesanan Dibuat", "Order Creation Date", "Tgl Pemesanan"],
  "payment_date": ["Waktu Pembayaran Dilakukan", "Payment Time", "Tgl Pembayaran"],
  "status": ["Status Pesanan", "Order Status"],
  "total_payment": ["Total Pembayaran", "Total Payment"],
  "total_discount": ["Total Diskon", "Total Discount"],
  "seller_voucher": ["Voucher Ditanggung Penjual", "Seller Voucher"],
  "shipping_estimated": ["Estimasi Potongan Biaya Pengiriman", "Estimated Shipping Fee"],
  "admin_fee": ["Biaya Administrasi", "Admin Fee"],
  "service_fee": ["Biaya Layanan", "Service Fee"],
  "buyer_username": ["Username (Pembeli)", "Buyer Username", "Username"],
  "product_name": ["Nama Produk", "Product Name"],
  "quantity": ["Jumlah", "Quantity", "Qty"],
  // PENTING: "Total Harga Produk" harus dideteksi, jangan sampai tertukar dengan "Harga Awal"
  "product_total": ["Total Harga Produk", "Product Subtotal", "Harga Awal"],
  "variation": ["Variasi", "Nama Variasi", "Variation Name", "Model Name"], 
  "city": ["Kota/Kabupaten", "City"],
  "province": ["Provinsi", "Province"],
  "final_sku": ["Nomor Referensi SKU", "SKU Reference No.", "SKU Induk"]
};

// Helper: Normalize Text for Matching (Trim & Lowercase)
const normalize = (str: any) => {
  if (!str) return '';
  return String(str).trim().toLowerCase();
};

export const ImportWizard: React.FC<ImportWizardProps> = ({ store, onComplete }) => {
  const [importType, setImportType] = useState<'orders' | 'ads'>('orders');
  const [step, setStep] = useState(1);
  const [csvData, setCsvData] = useState<RawRow[]>([]);
  const [mapping, setMapping] = useState<Mapping>({});
  const [isProcessing, setIsProcessing] = useState(false);
  const [adminFeePercent, setAdminFeePercent] = useState<string>('');
  const [serviceFeePercent, setServiceFeePercent] = useState<string>('');
  const [importStats, setImportStats] = useState({ total: 0, unmapped: 0 });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const fileExt = file.name.split('.').pop()?.toLowerCase();
    if (fileExt === 'csv') {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => processParsedData(results.data as RawRow[]),
        error: (err) => toast.error("Gagal memproses CSV: " + err.message)
      });
    } else if (fileExt === 'xlsx' || fileExt === 'xls') {
      try {
        const reader = new FileReader();
        reader.onload = (evt) => {
          const bstr = evt.target?.result;
          const wb = XLSX.read(bstr, { type: 'binary' });
          const wsname = wb.SheetNames[0];
          const ws = wb.Sheets[wsname];
          const data = XLSX.utils.sheet_to_json(ws) as RawRow[];
          processParsedData(data);
        };
        reader.readAsBinaryString(file);
      } catch (err) {
        toast.error("Gagal memproses Excel.");
      }
    }
  };

  const processParsedData = (data: RawRow[]) => {
    if (data.length === 0) return;
    setCsvData(data);
    const headers = Object.keys(data[0] || {});
    const newMapping: Mapping = {};
    
    if (importType === 'orders') {
        // PERBAIKAN LOGIKA MAPPING (STRICT PRIORITY)
        // Sebelumnya: Loop Headers -> Cari Alias (Salah, karena 'Harga Awal' muncul duluan di CSV)
        // Sekarang: Loop Alias -> Cari di Headers (Benar, 'Total Harga Produk' diprioritaskan)
        
        Object.entries(HEADER_ALIASES).forEach(([dbKey, aliases]) => {
          for (const alias of aliases) {
             const foundHeader = headers.find(h => h.trim().toLowerCase() === alias.toLowerCase());
             if (foundHeader) {
                newMapping[dbKey] = foundHeader;
                break; // Berhenti setelah menemukan prioritas utama (misal: Total Harga Produk)
             }
          }
        });
    }
    
    setMapping(newMapping);
    setStep(2);
  };

  const parseNumberIndonesia = (val: any): number => {
    if (val === undefined || val === null || val === '') return 0;
    let clean = String(val).replace(/Rp/g, '').replace(/\s/g, '').replace(/\./g, '');
    clean = clean.replace(/,/g, '.');
    const num = parseFloat(clean);
    return isNaN(num) ? 0 : num;
  };

  // --- SAFE DATE PARSER ---
  const getSafeDate = (val: any): string | null => {
    if (!val) return null;
    try {
      let d: Date;
      if (typeof val === 'number') {
        // Excel serial date
        d = new Date((val - (25567 + 1)) * 86400 * 1000);
      } else {
        d = new Date(val);
      }
      // Check if date is valid
      if (isNaN(d.getTime())) return null;
      return d.toISOString();
    } catch (e) {
      return null;
    }
  };

  const processImport = async () => {
    if (!store?.id) return;
    setIsProcessing(true);
    
    if (importType === 'ads') {
        toast.error("Fitur Import Iklan belum aktif.");
        setIsProcessing(false);
        return;
    }

    try {
      // 1. FETCH MASTER DATA (Lookup Tables)
      const { data: products } = await supabase.from('products').select('sku, cost_price').eq('store_id', store.id);
      const { data: mappings } = await supabase.from('sku_mappings').select('shopee_product_name, shopee_variation_name, mapped_sku').eq('store_id', store.id);

      // Create Fast Lookup Maps (Normalized Keys)
      const productMap = new Map<string, number>(); 
      products?.forEach(p => productMap.set(normalize(p.sku), p.cost_price));

      const mappingMap = new Map<string, string>(); 
      mappings?.forEach(m => {
        const key = `${normalize(m.shopee_product_name)}|${normalize(m.shopee_variation_name)}`;
        mappingMap.set(key, m.mapped_sku);
      });

      const orderGroups: Record<string, { order: any, items: any[], grossProductValue: number }> = {};
      const customAdminRate = parseFloat(adminFeePercent) / 100;
      const customServiceRate = parseFloat(serviceFeePercent) / 100;
      let unmappedCount = 0;

      // 2. PROCESS CSV ROWS
      csvData.forEach((row) => {
        const orderId = String(row[mapping['order_id']] || '').trim();
        if (!orderId) return;

        // "product_total" mapping sekarang sudah benar mengarah ke "Total Harga Produk" (Harga Diskon x Qty)
        // Bukan ke "Harga Awal"
        const prodTotal = parseNumberIndonesia(row[mapping['product_total']]);
        const qtyRaw = row[mapping['quantity']];
        const qty = parseInt(String(qtyRaw).replace(/\D/g, '')) || 1;

        // Init Order Group if new
        if (!orderGroups[orderId]) {
          const voucher = parseNumberIndonesia(row[mapping['seller_voucher']]);
          const csvAdminFee = Math.abs(parseNumberIndonesia(row[mapping['admin_fee']]));
          const csvServiceFee = Math.abs(parseNumberIndonesia(row[mapping['service_fee']]));
          const status = row[mapping['status']] || 'Unknown';
          
          // --- ROBUST DATE PARSING ---
          const orderDate = getSafeDate(row[mapping['order_date']]) || new Date().toISOString();
          const paymentDate = getSafeDate(row[mapping['payment_date']]);

          orderGroups[orderId] = {
            order: {
              store_id: store.id,
              order_id: orderId,
              order_date: orderDate,
              payment_date: paymentDate,
              status: status,
              total_payment: parseNumberIndonesia(row[mapping['total_payment']]),
              total_discount: parseNumberIndonesia(row[mapping['total_discount']]),
              seller_voucher: voucher,
              shipping_estimated: parseNumberIndonesia(row[mapping['shipping_estimated']]),
              admin_fee: csvAdminFee,
              service_fee: csvServiceFee,
              buyer_username: row[mapping['buyer_username']],
              city: row[mapping['city']],
              province: row[mapping['province']],
              product_total: 0 
            },
            items: [],
            grossProductValue: 0
          };
        }

        orderGroups[orderId].grossProductValue += prodTotal;
        
        // --- MATCHING LOGIC ---
        const csvSku = normalize(row[mapping['final_sku']]); 
        const csvName = row[mapping['product_name']] || 'Produk Tanpa Nama';
        const csvVariation = mapping['variation'] ? (row[mapping['variation']] || '') : ''; 
        
        const normName = normalize(csvName);
        const normVariation = normalize(csvVariation);
        const mappingKey = `${normName}|${normVariation}`;

        let finalSku: string | null = null;
        let hppAtTime = 0;
        let isMapped = false;

        // PRIORITY 1: Reference SKU from CSV exists in Products Table
        if (csvSku && productMap.has(csvSku)) {
            finalSku = row[mapping['final_sku']]; 
            hppAtTime = productMap.get(csvSku) || 0;
            isMapped = true;
        } 
        // PRIORITY 2: Mapping Table (Name + Variation)
        else if (mappingMap.has(mappingKey)) {
            const mappedSku = mappingMap.get(mappingKey);
            if (mappedSku) {
                const normMappedSku = normalize(mappedSku);
                if (productMap.has(normMappedSku)) {
                    finalSku = mappedSku;
                    hppAtTime = productMap.get(normMappedSku) || 0;
                    isMapped = true;
                }
            }
        }
        
        if (!isMapped) {
            unmappedCount++;
        }

        orderGroups[orderId].items.push({
          order_id: orderId,
          store_id: store.id,
          product_name: csvName, 
          variation: csvVariation, 
          quantity: qty,
          product_total: prodTotal,
          unit_price: qty > 0 ? prodTotal / qty : 0,
          final_sku: finalSku,
          hpp_at_time: hppAtTime,
          is_sku_mapped: isMapped
        });
      });

      setImportStats({ total: Object.keys(orderGroups).length, unmapped: unmappedCount });

      // 3. PREPARE PAYLOADS
      const ordersToUpsert = Object.values(orderGroups).map(g => {
        const o = g.order;
        const isCancelled = o.status?.toLowerCase().includes('batal') || o.status?.toLowerCase().includes('cancel');
        const gmv = g.grossProductValue;
        
        let finalAdminFee = o.admin_fee;
        if (!isNaN(customAdminRate) && customAdminRate > 0) finalAdminFee = Math.max(0, gmv * customAdminRate);

        let finalServiceFee = o.service_fee;
        if (!isNaN(customServiceRate) && customServiceRate > 0) finalServiceFee = Math.max(0, gmv * customServiceRate);

        const netRevenue = gmv - o.seller_voucher - finalAdminFee - finalServiceFee;
        
        return { 
          ...o, 
          product_total: gmv,
          admin_fee: finalAdminFee, 
          service_fee: finalServiceFee, 
          net_revenue: isCancelled ? 0 : netRevenue
        };
      });

      const itemsToUpsert = Object.values(orderGroups).flatMap(g => g.items);

      // 4. DATABASE TRANSACTIONS
      const { error: orderError } = await supabase
        .from('orders')
        .upsert(ordersToUpsert, { onConflict: 'store_id, order_id' });
      
      if (orderError) throw orderError;

      const orderIds = ordersToUpsert.map(o => o.order_id);
      
      // Clean old items to prevent dupes
      await supabase
        .from('order_items')
        .delete()
        .eq('store_id', store.id) 
        .in('order_id', orderIds);
      
      const { error: itemError } = await supabase.from('order_items').insert(itemsToUpsert);
      if (itemError) throw itemError;

      toast.success(`Berhasil sinkron ${ordersToUpsert.length} pesanan.`);
      setStep(3);

    } catch (err: any) {
      console.error(err);
      toast.error("Gagal: " + (err.message || "Terjadi kesalahan database"));
    } finally { setIsProcessing(false); }
  };

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      {/* Step Indicator */}
      <div className="flex items-center justify-between mb-8 relative">
        <div className="absolute top-1/2 left-0 w-full h-0.5 bg-slate-200 dark:bg-slate-800 -z-10 -translate-y-1/2"></div>
        {[1, 2, 3].map((s) => (
          <div key={s} className={`w-10 h-10 rounded-full flex items-center justify-center font-bold transition-all shadow-sm ${
            step >= s ? 'bg-orange-600 text-white scale-110' : 'bg-slate-200 dark:bg-slate-800 text-slate-500'
          }`}>
            {step > s ? <CheckCircle2 className="w-6 h-6" /> : s}
          </div>
        ))}
      </div>

      <div className="bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/20 rounded-2xl p-4 mb-8 flex items-center justify-center gap-3">
        <StoreIcon className="w-5 h-5 text-orange-600" />
        <span className="text-sm text-orange-800 dark:text-orange-200 font-medium">
          Mengimpor data untuk toko: <span className="font-black uppercase tracking-wide">{store.name}</span>
        </span>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-xl border border-slate-100 dark:border-slate-800 p-8">
        
        {step === 1 && (
            <div className="flex justify-center gap-4 mb-10">
                <button 
                    onClick={() => setImportType('orders')}
                    className={`flex-1 max-w-[200px] p-4 rounded-2xl border-2 transition-all flex flex-col items-center gap-3 ${
                        importType === 'orders' 
                        ? 'border-orange-500 bg-orange-50 dark:bg-orange-500/10 text-orange-700 dark:text-orange-400' 
                        : 'border-slate-100 dark:border-slate-800 text-slate-400 hover:border-slate-300'
                    }`}
                >
                    <ShoppingBag className={`w-8 h-8 ${importType === 'orders' ? 'text-orange-600' : 'text-slate-300'}`} />
                    <span className="text-xs font-black uppercase tracking-wider">Laporan Pesanan</span>
                </button>
            </div>
        )}

        {step === 1 && (
          <div className="text-center py-6">
            <h2 className="text-xl font-black mb-2 dark:text-white uppercase tracking-tight">
                Import {importType === 'orders' ? 'Riwayat Pesanan' : 'Performa Iklan'}
            </h2>
            <p className="text-slate-500 dark:text-slate-400 mb-8 max-w-xs mx-auto text-sm font-medium">
                 Upload CSV 'Laporan Pesanan' dari Shopee. Sistem akan otomatis mencocokkan SKU Master.
            </p>
            <input type="file" accept=".csv, .xlsx, .xls" onChange={handleFileUpload} className="hidden" id="sheet-upload" />
            <label htmlFor="sheet-upload" className="px-10 py-4 text-white rounded-2xl font-black transition-all cursor-pointer inline-flex items-center gap-3 shadow-xl active:scale-95 bg-orange-600 hover:bg-orange-700 shadow-orange-500/30">
              PILIH FILE PESANAN
              <ChevronRight className="w-5 h-5" />
            </label>
            
            <p className="mt-6 text-[10px] text-slate-400 uppercase tracking-widest font-medium">
                Sistem mendeteksi kolom: Variasi, Nama Variasi, Model Name, dll.
            </p>
          </div>
        )}

        {step === 2 && importType === 'orders' && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="flex items-center gap-3 mb-8">
              <div className="p-2 bg-orange-100 dark:bg-orange-500/10 rounded-lg">
                <Calculator className="w-6 h-6 text-orange-600" />
              </div>
              <h2 className="text-xl font-black dark:text-white uppercase tracking-tight">Kalkulasi Biaya</h2>
            </div>

            <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 mb-10">
              <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-6 flex items-center gap-2">
                <Percent className="w-3.5 h-3.5" /> Override Biaya (Opsional)
              </h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <label className="text-sm font-black dark:text-white">Admin Fee (%)</label>
                  </div>
                  <div className="relative">
                    <input 
                      type="number" 
                      step="0.01"
                      placeholder="Gunakan dari CSV" 
                      value={adminFeePercent}
                      onWheel={(e) => e.currentTarget.blur()}
                      onChange={(e) => setAdminFeePercent(e.target.value)}
                      className="w-full pl-4 pr-10 py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-black outline-none focus:ring-2 focus:ring-orange-500/20 transition-all"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">%</span>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <label className="text-sm font-black dark:text-white">Service Fee (%)</label>
                  </div>
                  <div className="relative">
                    <input 
                      type="number" 
                      step="0.01"
                      placeholder="Gunakan dari CSV" 
                      value={serviceFeePercent}
                      onWheel={(e) => e.currentTarget.blur()}
                      onChange={(e) => setServiceFeePercent(e.target.value)}
                      className="w-full pl-4 pr-10 py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-black outline-none focus:ring-2 focus:ring-orange-500/20 transition-all"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">%</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-between items-center pt-8 border-t border-slate-100 dark:border-slate-800">
              <button onClick={() => setStep(1)} className="text-slate-400 font-bold hover:text-slate-600 text-sm">GANTI FILE</button>
              <button 
                onClick={processImport}
                disabled={isProcessing}
                className="px-10 py-4 bg-slate-900 dark:bg-orange-600 text-white rounded-2xl font-black hover:opacity-90 transition-all flex items-center gap-3 disabled:opacity-50 shadow-xl"
              >
                {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
                {isProcessing ? 'SEDANG MENGHITUNG...' : 'SINKRON DATA'}
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="text-center py-10 animate-in zoom-in-95 duration-300">
            <div className="w-20 h-20 bg-green-100 dark:bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle2 className="w-10 h-10 text-green-600" />
            </div>
            <h2 className="text-2xl font-black mb-2 dark:text-white uppercase tracking-tight">Import Selesai</h2>
            <p className="text-slate-500 dark:text-slate-400 mb-8 font-medium">
                Data pesanan telah diperbarui. <br/>
                {importStats.unmapped > 0 ? (
                    <span className="text-red-500 font-bold">
                        Peringatan: Ada {importStats.unmapped} varian produk yang tidak dikenali (SKU Kosong). <br/>
                        Segera lakukan Mapping Manual di menu "Produk".
                    </span>
                ) : (
                    <span className="text-green-600 font-bold">Semua produk berhasil dikenali oleh sistem (100% Mapped).</span>
                )}
            </p>
            <div className="flex justify-center gap-4">
                <button onClick={onComplete} className="px-8 py-4 bg-orange-600 text-white rounded-2xl font-black hover:bg-orange-700 transition-all shadow-xl shadow-orange-500/20 active:scale-95">
                  OK, LANJUTKAN
                </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
