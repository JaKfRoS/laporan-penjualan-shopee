
import React, { useState } from 'react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { supabase } from '../../services/supabase';
import { Store, Mapping, RawRow } from '../../types';
import { toast } from 'react-hot-toast';
import { FileUp, Columns, CheckCircle2, ChevronRight, Loader2, AlertCircle, FileSpreadsheet, Percent, Info, Calculator } from 'lucide-react';

interface ImportWizardProps {
  store: Store;
  onComplete: () => void;
}

const DEFAULT_MAPPING: Mapping = {
  "No. Pesanan": "order_id",
  "Waktu Pesanan Dibuat": "order_date",
  "Waktu Pembayaran Dilakukan": "payment_date",
  "Status Pesanan": "status",
  "Total Pembayaran": "total_payment",
  "Total Diskon": "total_discount",
  "Voucher Ditanggung Penjual": "seller_voucher",
  "Estimasi Potongan Biaya Pengiriman": "shipping_estimated",
  "Biaya Administrasi": "admin_fee",
  "Biaya Layanan": "service_fee",
  "Username (Pembeli)": "buyer_username",
  "Nama Produk": "product_name",
  "Jumlah": "quantity",
  "Total Harga Produk": "product_total",
  "Variasi": "variation",
  "Kota/Kabupaten": "city",
  "Provinsi": "province",
};

export const ImportWizard: React.FC<ImportWizardProps> = ({ store, onComplete }) => {
  const [step, setStep] = useState(1);
  const [csvData, setCsvData] = useState<RawRow[]>([]);
  const [mapping, setMapping] = useState<Mapping>({});
  const [isProcessing, setIsProcessing] = useState(false);
  const [adminFeePercent, setAdminFeePercent] = useState<string>('');
  const [serviceFeePercent, setServiceFeePercent] = useState<string>('');

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
    Object.entries(DEFAULT_MAPPING).forEach(([shopeeKey, dbKey]) => {
      const foundHeader = headers.find(h => h.trim().toLowerCase() === shopeeKey.toLowerCase());
      if (foundHeader) newMapping[dbKey] = foundHeader;
    });
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

  const processImport = async () => {
    if (!store?.id) return;
    setIsProcessing(true);
    try {
      const orderGroups: Record<string, { order: any, items: any[], grossProductValue: number }> = {};
      const customAdminRate = parseFloat(adminFeePercent) / 100;
      const customServiceRate = parseFloat(serviceFeePercent) / 100;

      csvData.forEach((row) => {
        const orderId = String(row[mapping['order_id']] || '').trim();
        if (!orderId) return;

        const prodTotal = parseNumberIndonesia(row[mapping['product_total']]);
        const qtyRaw = row[mapping['quantity']];
        const qty = parseInt(String(qtyRaw).replace(/\D/g, '')) || 1;

        if (!orderGroups[orderId]) {
          const voucher = parseNumberIndonesia(row[mapping['seller_voucher']]);
          const csvAdminFee = Math.abs(parseNumberIndonesia(row[mapping['admin_fee']]));
          const csvServiceFee = Math.abs(parseNumberIndonesia(row[mapping['service_fee']]));
          const status = row[mapping['status']] || 'Unknown';
          
          let orderDate: string;
          try {
            const rawDate = row[mapping['order_date']];
            if (typeof rawDate === 'number') {
              orderDate = new Date((rawDate - (25567 + 1)) * 86400 * 1000).toISOString();
            } else {
              orderDate = new Date(rawDate).toISOString();
            }
          } catch (e) { orderDate = new Date().toISOString(); }

          orderGroups[orderId] = {
            order: {
              store_id: store.id,
              order_id: orderId,
              order_date: orderDate,
              payment_date: row[mapping['payment_date']] ? new Date(row[mapping['payment_date']]).toISOString() : null,
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
              product_total: 0 // Will be summed below
            },
            items: [],
            grossProductValue: 0
          };
        }

        orderGroups[orderId].grossProductValue += prodTotal;
        orderGroups[orderId].items.push({
          order_id: orderId,
          product_name: row[mapping['product_name']] || 'Produk Tanpa Nama',
          variation: row[mapping['variation']],
          quantity: qty,
          product_total: prodTotal,
          unit_price: qty > 0 ? prodTotal / qty : 0
        });
      });

      const ordersToUpsert = Object.values(orderGroups).map(g => {
        const o = g.order;
        const isCancelled = o.status?.toLowerCase().includes('batal') || o.status?.toLowerCase().includes('cancel');
        
        // GMV = Total Harga Produk kotor
        const gmv = g.grossProductValue;
        
        // Kalkulasi Biaya berdasar GMV (Standard Shopee)
        let finalAdminFee = o.admin_fee;
        if (!isNaN(customAdminRate) && customAdminRate > 0) {
          finalAdminFee = Math.max(0, gmv * customAdminRate);
        }

        let finalServiceFee = o.service_fee;
        if (!isNaN(customServiceRate) && customServiceRate > 0) {
          finalServiceFee = Math.max(0, gmv * customServiceRate);
        }

        // Net Revenue = GMV - Voucher Penjual - Biaya Admin - Biaya Layanan
        // Sesuai hitungan manual user: 1.477.914 - 15% = 1.256.226
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

      const { error: orderError } = await supabase
        .from('orders')
        .upsert(ordersToUpsert, { onConflict: 'order_id' });
      if (orderError) throw orderError;

      const orderIds = ordersToUpsert.map(o => o.order_id);
      await supabase.from('order_items').delete().in('order_id', orderIds);
      const { error: itemError } = await supabase.from('order_items').insert(itemsToUpsert);
      if (itemError) throw itemError;

      toast.success(`Berhasil sinkron ${ordersToUpsert.length} data.`);
      setStep(3);
    } catch (err: any) {
      toast.error("Gagal: " + err.message);
    } finally { setIsProcessing(false); }
  };

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      {/* Step Indicator */}
      <div className="flex items-center justify-between mb-12 relative">
        <div className="absolute top-1/2 left-0 w-full h-0.5 bg-slate-200 dark:bg-slate-800 -z-10 -translate-y-1/2"></div>
        {[1, 2, 3].map((s) => (
          <div key={s} className={`w-10 h-10 rounded-full flex items-center justify-center font-bold transition-all shadow-sm ${
            step >= s ? 'bg-orange-600 text-white scale-110' : 'bg-slate-200 dark:bg-slate-800 text-slate-500'
          }`}>
            {step > s ? <CheckCircle2 className="w-6 h-6" /> : s}
          </div>
        ))}
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-xl border border-slate-100 dark:border-slate-800 p-8">
        {step === 1 && (
          <div className="text-center py-10">
            <div className="w-20 h-20 bg-orange-100 dark:bg-orange-500/10 rounded-3xl flex items-center justify-center mx-auto mb-6 rotate-3">
              <FileSpreadsheet className="w-10 h-10 text-orange-600" />
            </div>
            <h2 className="text-2xl font-black mb-2 dark:text-white uppercase tracking-tight">Impor Laporan</h2>
            <p className="text-slate-500 dark:text-slate-400 mb-8 max-w-xs mx-auto text-sm font-medium">Upload file asli dari Shopee (CSV/Excel). Tidak perlu diedit manual.</p>
            <input type="file" accept=".csv, .xlsx, .xls" onChange={handleFileUpload} className="hidden" id="sheet-upload" />
            <label htmlFor="sheet-upload" className="px-10 py-4 bg-orange-600 text-white rounded-2xl font-black hover:bg-orange-700 transition-all cursor-pointer inline-flex items-center gap-3 shadow-xl shadow-orange-500/30 active:scale-95">
              PILIH FILE SEKARANG
              <ChevronRight className="w-5 h-5" />
            </label>
          </div>
        )}

        {step === 2 && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="flex items-center gap-3 mb-8">
              <div className="p-2 bg-orange-100 dark:bg-orange-500/10 rounded-lg">
                <Calculator className="w-6 h-6 text-orange-600" />
              </div>
              <h2 className="text-xl font-black dark:text-white uppercase tracking-tight">Kalkulator Biaya Otomatis</h2>
            </div>

            <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 mb-10">
              <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-6 flex items-center gap-2">
                <Percent className="w-3.5 h-3.5" /> Pengaturan Persentase Biaya (Opsional)
              </h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <label className="text-sm font-black dark:text-white">Admin Fee (%)</label>
                    <span className="text-[10px] bg-white dark:bg-slate-900 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 text-slate-400 font-bold">Misal: 6.0</span>
                  </div>
                  <div className="relative">
                    <input 
                      type="number" 
                      step="0.01"
                      placeholder="Gunakan dari CSV" 
                      value={adminFeePercent}
                      onChange={(e) => setAdminFeePercent(e.target.value)}
                      className="w-full pl-4 pr-10 py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-black outline-none focus:ring-2 focus:ring-orange-500/20 transition-all"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">%</span>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <label className="text-sm font-black dark:text-white">Service Fee (%)</label>
                    <span className="text-[10px] bg-white dark:bg-slate-900 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 text-slate-400 font-bold">Misal: 4.0</span>
                  </div>
                  <div className="relative">
                    <input 
                      type="number" 
                      step="0.01"
                      placeholder="Gunakan dari CSV" 
                      value={serviceFeePercent}
                      onChange={(e) => setServiceFeePercent(e.target.value)}
                      className="w-full pl-4 pr-10 py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-black outline-none focus:ring-2 focus:ring-orange-500/20 transition-all"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">%</span>
                  </div>
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-700 flex items-center gap-2 text-[10px] text-slate-500 font-bold italic">
                <Info className="w-3 h-3" />
                Rumus: (Total Harga Produk - Voucher) - Admin Fee - Service Fee. Pesanan batal dihitung 0.
              </div>
            </div>

            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 ml-1">Pemetaan Kolom Database</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10 bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-100 dark:border-slate-800">
              {Object.keys(DEFAULT_MAPPING).map((shopeeLabel) => {
                const dbKey = DEFAULT_MAPPING[shopeeLabel];
                return (
                  <div key={dbKey} className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block ml-1">
                      {shopeeLabel}
                    </label>
                    <select 
                      value={mapping[dbKey] || ''}
                      onChange={(e) => setMapping({ ...mapping, [dbKey]: e.target.value })}
                      className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:ring-4 focus:ring-orange-500/10 focus:border-orange-500 outline-none dark:text-white transition-all font-bold"
                    >
                      <option value="">-- Lewati Kolom --</option>
                      {Object.keys(csvData[0] || {}).map(col => (
                        <option key={col} value={col}>{col}</option>
                      ))}
                    </select>
                  </div>
                );
              })}
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
            <h2 className="text-2xl font-black mb-2 dark:text-white uppercase tracking-tight">Kalkulasi Berhasil</h2>
            <p className="text-slate-500 dark:text-slate-400 mb-8 font-medium">Semua biaya telah dihitung ulang secara otomatis. Pesanan dibatalkan sudah dikecualikan.</p>
            <button onClick={onComplete} className="px-12 py-4 bg-orange-600 text-white rounded-2xl font-black hover:bg-orange-700 transition-all shadow-xl shadow-orange-500/20 active:scale-95">
              LIHAT HASIL ANALISIS
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
