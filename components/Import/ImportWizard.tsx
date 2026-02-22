
import React, { useState } from 'react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { supabase } from '../../services/supabase';
import { Store, Mapping, RawRow, Product } from '../../types';
import { toast } from 'react-hot-toast';
import { FileUp, Columns, CheckCircle2, ChevronRight, Loader2, Info, Calculator, Store as StoreIcon, ShoppingBag, Megaphone, Percent, FileSpreadsheet } from 'lucide-react';

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
  "final_sku": ["Nomor Referensi SKU", "SKU Reference No.", "SKU Induk"],
  "return_status": ["Status Pembatalan/Pengembalian", "Return Status", "Status Retur"]
};

const INCOME_HEADER_ALIASES: Record<string, string[]> = {
  "order_id": ["No. Pesanan", "Order ID"],
  "original_price": ["Harga Asli Produk", "Original Price", "Harga Awal"],
  "product_discount": ["Total Diskon Produk", "Product Discount", "Diskon Produk"],
  "shopee_product_discount": ["Diskon Produk dari Shopee", "Shopee Product Discount"],
  "seller_voucher": ["Voucher disponsor oleh Penjual", "Seller Voucher", "Voucher Penjual"],
  "admin_fee": ["Biaya Administrasi", "Admin Fee"],
  "service_fee": ["Biaya Layanan", "Service Fee"],
  "order_processing_fee": ["Biaya Proses Pesanan", "Order Processing Fee", "Biaya Transaksi", "Transaction Fee"],
  "premium_fee": ["Premi", "Premium Fee"],
  "ams_commission": ["Biaya Komisi AMS", "AMS Commission Fee"],
  "net_revenue": ["Total Penghasilan", "Net Revenue"],
  "refund_amount": ["Jumlah Pengembalian Dana ke Pembeli", "Refund Amount"],
  "return_shipping_fee": ["Ongkos Kirim Pengembalian Barang", "Return Shipping Fee"],
  "shipping_fee_forwarded": ["Ongkir yang Diteruskan oleh Shopee ke Jasa Kirim", "Shipping Fee Paid by Seller", "Shipping Fee Forwarded"],
  "shipping_rebate": ["Gratis Ongkir dari Shopee", "Shipping Fee Rebate", "Shipping Rebate"]
};

// Helper: Normalize Text for Matching (Trim & Lowercase)
const normalize = (str: any) => {
  if (!str) return '';
  return String(str).trim().toLowerCase();
};

export const ImportWizard: React.FC<ImportWizardProps> = ({ store, onComplete }) => {
  const [mode, setMode] = useState<'sales' | 'ads'>('sales');
  const [step, setStep] = useState(1);
  
  // Data State
  const [ordersData, setOrdersData] = useState<RawRow[]>([]);
  const [incomeData, setIncomeData] = useState<RawRow[]>([]);
  const [files, setFiles] = useState<{ orders: string | null, income: string | null }>({ orders: null, income: null });
  
  const [mapping, setMapping] = useState<Mapping>({});
  const [isProcessing, setIsProcessing] = useState(false);
  const [adminFeePercent, setAdminFeePercent] = useState<string>('');
  const [serviceFeePercent, setServiceFeePercent] = useState<string>('');
  const [importStats, setImportStats] = useState({ total: 0, unmapped: 0 });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'orders' | 'income') => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFiles(prev => ({ ...prev, [type]: file.name }));
    const fileExt = file.name.split('.').pop()?.toLowerCase();
    
    const processData = (data: RawRow[]) => {
        if (type === 'orders') setOrdersData(data);
        else setIncomeData(data);
    };

    if (fileExt === 'csv') {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => processData(results.data as RawRow[]),
        error: (err) => toast.error("Gagal memproses CSV: " + err.message)
      });
    } else if (fileExt === 'xlsx' || fileExt === 'xls') {
      try {
        const reader = new FileReader();
        reader.onload = (evt) => {
          const bstr = evt.target?.result;
          const wb = XLSX.read(bstr, { type: 'binary' });
          
          let targetSheetName = wb.SheetNames[0];
          let headerRowIndex = 0;

          // Smart Sheet Detection for Income Report
          if (type === 'income') {
             let found = false;
             for (const sheetName of wb.SheetNames) {
                 const ws = wb.Sheets[sheetName];
                 // Read first 20 rows to check for headers
                 const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, range: 0, defval: '' }) as any[][];
                 const idx = aoa.findIndex(row => 
                    Array.isArray(row) && row.some(cell => String(cell).toLowerCase().includes('no. pesanan') || String(cell).toLowerCase().includes('order id'))
                 );
                 
                 if (idx > -1) {
                     targetSheetName = sheetName;
                     headerRowIndex = idx;
                     found = true;
                     break;
                 }
             }
             
             if (!found) {
                 // Fallback: Check if Sheet 2 exists (index 1), as user mentioned
                 if (wb.SheetNames.length > 1) {
                     targetSheetName = wb.SheetNames[1];
                     // Check header in Sheet 2
                     const ws = wb.Sheets[targetSheetName];
                     const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, range: 0 }) as any[][];
                     const idx = aoa.findIndex(row => 
                        Array.isArray(row) && row.some(cell => String(cell).toLowerCase().includes('no. pesanan') || String(cell).toLowerCase().includes('order id'))
                     );
                     if (idx > -1) headerRowIndex = idx;
                 }
             }
          }

          const ws = wb.Sheets[targetSheetName];
          const data = XLSX.utils.sheet_to_json(ws, { range: headerRowIndex }) as RawRow[];
          processData(data);
        };
        reader.readAsBinaryString(file);
      } catch (err) {
        toast.error("Gagal memproses Excel.");
      }
    }
  };

  // Check if both files are ready to proceed
  const canProceed = mode === 'ads' ? true : (ordersData.length > 0 && incomeData.length > 0);

  const handleNextStep = () => {
      if (mode === 'sales') {
          // Generate Mapping based on Orders Data (Primary)
          const headers = Object.keys(ordersData[0] || {});
          const newMapping: Mapping = {};
          
          Object.entries(HEADER_ALIASES).forEach(([dbKey, aliases]) => {
            for (const alias of aliases) {
                const foundHeader = headers.find(h => h.trim().toLowerCase() === alias.toLowerCase());
                if (foundHeader) {
                    newMapping[dbKey] = foundHeader;
                    break; 
                }
            }
          });
          
          setMapping(newMapping);
      }
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
        d = new Date((val - (25567 + 1)) * 86400 * 1000);
      } else {
        d = new Date(val);
      }
      if (isNaN(d.getTime())) return null;
      return d.toISOString();
    } catch (e) {
      return null;
    }
  };

  const processImport = async () => {
    if (!store?.id) return;
    setIsProcessing(true);
    
    if (mode === 'ads') {
        toast.error("Fitur Import Iklan belum aktif.");
        setIsProcessing(false);
        return;
    }

    try {
      // 1. FETCH MASTER DATA
      const { data: products } = await supabase.from('products').select('sku, cost_price').eq('store_id', store.id);
      const { data: mappings } = await supabase.from('sku_mappings').select('shopee_product_name, shopee_variation_name, mapped_sku').eq('store_id', store.id);

      const productMap = new Map<string, number>(); 
      products?.forEach(p => productMap.set(normalize(p.sku), p.cost_price));

      const mappingMap = new Map<string, string>(); 
      mappings?.forEach(m => {
        const key = `${normalize(m.shopee_product_name)}|${normalize(m.shopee_variation_name)}`;
        mappingMap.set(key, m.mapped_sku);
      });

      const orderGroups: Record<string, { order: any, items: any[], grossProductValue: number }> = {};
      let unmappedCount = 0;

      // 2. PROCESS ORDERS DATA (Base)
      ordersData.forEach((row) => {
        const orderId = String(row[mapping['order_id']] || '').trim();
        if (!orderId) return;

        const prodTotal = parseNumberIndonesia(row[mapping['product_total']]);
        const qtyRaw = row[mapping['quantity']];
        const qty = parseInt(String(qtyRaw).replace(/\D/g, '')) || 1;

        if (!orderGroups[orderId]) {
          const voucher = parseNumberIndonesia(row[mapping['seller_voucher']]);
          let status = row[mapping['status']] || 'Unknown';
          const returnStatus = row[mapping['return_status']];
          
          if (returnStatus && typeof returnStatus === 'string') {
             const cleanReturn = returnStatus.trim();
             if (cleanReturn !== '' && cleanReturn !== '-' && cleanReturn.toLowerCase() !== 'nan') {
                 status = cleanReturn; 
             }
          }

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
              admin_fee: 0, // Will be updated from Income Data
              service_fee: 0, // Will be updated from Income Data
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
        
        // Item Mapping Logic
        const csvSku = normalize(row[mapping['final_sku']]); 
        const csvName = row[mapping['product_name']] || 'Produk Tanpa Nama';
        const csvVariation = mapping['variation'] ? (row[mapping['variation']] || '') : ''; 
        
        const normName = normalize(csvName);
        const normVariation = normalize(csvVariation);
        const mappingKey = `${normName}|${normVariation}`;

        let finalSku: string | null = null;
        let hppAtTime = 0;
        let isMapped = false;

        if (csvSku && productMap.has(csvSku)) {
            finalSku = row[mapping['final_sku']]; 
            hppAtTime = productMap.get(csvSku) || 0;
            isMapped = true;
        } else if (mappingMap.has(mappingKey)) {
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
        
        if (!isMapped) unmappedCount++;

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

      // 3. PROCESS INCOME DATA (Enrichment)
      // Map headers for Income Data dynamically
      const incomeHeaders = Object.keys(incomeData[0] || {});
      const incomeMapping: Mapping = {};
      Object.entries(INCOME_HEADER_ALIASES).forEach(([dbKey, aliases]) => {
         const found = incomeHeaders.find(h => aliases.some(a => a.toLowerCase() === h.trim().toLowerCase()));
         if (found) incomeMapping[dbKey] = found;
      });

      incomeData.forEach(row => {
         const orderId = String(row[incomeMapping['order_id']] || '').trim();
         if (!orderId || !orderGroups[orderId]) return; // Only update known orders

         const netRevenue = parseNumberIndonesia(row[incomeMapping['net_revenue']]);
         const adminFee = Math.abs(parseNumberIndonesia(row[incomeMapping['admin_fee']]));
         const serviceFee = Math.abs(parseNumberIndonesia(row[incomeMapping['service_fee']]));
         const amsFee = Math.abs(parseNumberIndonesia(row[incomeMapping['ams_commission']]));
         const procFee = Math.abs(parseNumberIndonesia(row[incomeMapping['order_processing_fee']]));
         const premFee = Math.abs(parseNumberIndonesia(row[incomeMapping['premium_fee']]));
         const refundAmount = Math.abs(parseNumberIndonesia(row[incomeMapping['refund_amount']]));
         const returnShippingFee = Math.abs(parseNumberIndonesia(row[incomeMapping['return_shipping_fee']]));
         const shippingForwarded = Math.abs(parseNumberIndonesia(row[incomeMapping['shipping_fee_forwarded']]));
         const sellerVoucher = Math.abs(parseNumberIndonesia(row[incomeMapping['seller_voucher']]));
         const shippingRebate = Math.abs(parseNumberIndonesia(row[incomeMapping['shipping_rebate']]));
         
         // Update Order
         orderGroups[orderId].order.net_revenue = netRevenue;
         
         // Update Product Total (Omzet) from Income Data if available
         const originalPrice = parseNumberIndonesia(row[incomeMapping['original_price']]);
         const productDiscount = Math.abs(parseNumberIndonesia(row[incomeMapping['product_discount']]));
         
         if (originalPrice > 0) {
            // Formula User: Harga Asli Produk - Total Diskon Produk
            orderGroups[orderId].order.product_total = originalPrice - productDiscount;
         }

         // Store Total Potongan MP (Marketplace Fees) in service_fee
         // Components from Reference:
         // - Biaya Administrasi (adminFee)
         // - Biaya Komisi AMS (amsFee)
         // - Biaya Layanan (serviceFee)
         // - Jumlah Pengembalian Dana (refundAmount)
         // - Ongkir Diteruskan (shippingForwarded)
         // - Ongkos Kirim Pengembalian (returnShippingFee)
         // - Premi (premFee)
         // - Voucher Penjual (sellerVoucher)
         // - Biaya Proses/Transaksi (procFee) -- Just in case
         // - MINUS: Gratis Ongkir (shippingRebate)
         
         const totalMarketplaceFee = (adminFee + amsFee + serviceFee + procFee + premFee + shippingForwarded + returnShippingFee + sellerVoucher + refundAmount) - shippingRebate;
         
         orderGroups[orderId].order.service_fee = totalMarketplaceFee;

         // NEW: Store Detailed Fee Breakdown for Export
         orderGroups[orderId].order.fee_details = {
            admin_fee: adminFee,
            ams_commission: amsFee,
            service_fee: serviceFee,
            shipping_rebate: shippingRebate, // Gratis Ongkir (Positive value usually, but treated as subsidy)
            refund_amount: refundAmount,
            shipping_forwarded: shippingForwarded,
            return_shipping_fee: returnShippingFee,
            premium_fee: premFee,
            seller_voucher: sellerVoucher,
            processing_fee: procFee
         };
         orderGroups[orderId].order.admin_fee = 0; // Reset admin_fee as we use service_fee for total
         
         // Check for Refund
         if (refundAmount > 0) {
             orderGroups[orderId].order.status = 'Pengembalian';
         }
      });

      setImportStats({ total: Object.keys(orderGroups).length, unmapped: unmappedCount });

      // 4. PREPARE PAYLOADS
      const ordersToUpsert = Object.values(orderGroups).map(g => {
        const o = g.order;
        // Use product_total from Income Data if available, otherwise fallback to Orders Data GMV
        const gmv = o.product_total > 0 ? o.product_total : g.grossProductValue;
        
        return { 
          ...o, 
          product_total: gmv,
        };
      });

      const itemsToUpsert = Object.values(orderGroups).flatMap(g => g.items);

      // 5. DATABASE TRANSACTIONS
      const { error: orderError } = await supabase
        .from('orders')
        .upsert(ordersToUpsert, { onConflict: 'store_id, order_id' });
      
      if (orderError) throw orderError;

      const orderIds = ordersToUpsert.map(o => o.order_id);
      
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
            <div className="flex flex-col items-center gap-8 mb-10">
                <div className="flex justify-center gap-4 w-full">
                    <button 
                        onClick={() => setMode('sales')}
                        className={`flex-1 max-w-[200px] p-4 rounded-2xl border-2 transition-all flex flex-col items-center gap-3 ${
                            mode === 'sales' 
                            ? 'border-orange-500 bg-orange-50 dark:bg-orange-500/10 text-orange-700 dark:text-orange-400' 
                            : 'border-slate-100 dark:border-slate-800 text-slate-400 hover:border-slate-300'
                        }`}
                    >
                        <ShoppingBag className={`w-8 h-8 ${mode === 'sales' ? 'text-orange-600' : 'text-slate-300'}`} />
                        <span className="text-xs font-black uppercase tracking-wider">Laporan Penjualan</span>
                    </button>
                    {/* Ads Button Disabled for now or keep if needed */}
                </div>

                {mode === 'sales' && (
                    <div className="w-full max-w-2xl grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* 1. Upload Orders */}
                        <div className="bg-slate-50 dark:bg-slate-800/50 p-6 rounded-3xl border border-slate-200 dark:border-slate-700 text-center">
                            <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/20 rounded-full flex items-center justify-center mx-auto mb-4">
                                <FileSpreadsheet className="w-6 h-6 text-blue-600" />
                            </div>
                            <h3 className="font-bold mb-2 dark:text-white">1. Data Pesanan</h3>
                            <p className="text-xs text-slate-500 mb-4 h-10">File CSV "Laporan Pesanan" dari Shopee.</p>
                            
                            <input 
                                type="file" 
                                accept=".csv, .xlsx, .xls" 
                                onChange={(e) => handleFileUpload(e, 'orders')} 
                                className="hidden" 
                                id="orders-upload" 
                            />
                            <label 
                                htmlFor="orders-upload" 
                                className={`w-full py-3 rounded-xl font-bold text-sm cursor-pointer block transition-all ${
                                    files.orders 
                                    ? 'bg-green-100 text-green-700 border border-green-200' 
                                    : 'bg-white border border-slate-300 hover:border-blue-500 hover:text-blue-600'
                                }`}
                            >
                                {files.orders ? (
                                    <span className="flex items-center justify-center gap-2"><CheckCircle2 className="w-4 h-4"/> {files.orders.slice(0, 15)}...</span>
                                ) : 'Pilih File Pesanan'}
                            </label>
                        </div>

                        {/* 2. Upload Income */}
                        <div className="bg-slate-50 dark:bg-slate-800/50 p-6 rounded-3xl border border-slate-200 dark:border-slate-700 text-center">
                            <div className="w-12 h-12 bg-green-100 dark:bg-green-900/20 rounded-full flex items-center justify-center mx-auto mb-4">
                                <Calculator className="w-6 h-6 text-green-600" />
                            </div>
                            <h3 className="font-bold mb-2 dark:text-white">2. Data Penghasilan</h3>
                            <p className="text-xs text-slate-500 mb-4 h-10">File Excel "Laporan Penghasilan" (Income) dari Shopee.</p>
                            
                            <input 
                                type="file" 
                                accept=".csv, .xlsx, .xls" 
                                onChange={(e) => handleFileUpload(e, 'income')} 
                                className="hidden" 
                                id="income-upload" 
                            />
                            <label 
                                htmlFor="income-upload" 
                                className={`w-full py-3 rounded-xl font-bold text-sm cursor-pointer block transition-all ${
                                    files.income 
                                    ? 'bg-green-100 text-green-700 border border-green-200' 
                                    : 'bg-white border border-slate-300 hover:border-green-500 hover:text-green-600'
                                }`}
                            >
                                {files.income ? (
                                    <span className="flex items-center justify-center gap-2"><CheckCircle2 className="w-4 h-4"/> {files.income.slice(0, 15)}...</span>
                                ) : 'Pilih File Penghasilan'}
                            </label>
                        </div>
                    </div>
                )}
                
                {mode === 'sales' && (
                    <button 
                        onClick={handleNextStep}
                        disabled={!canProceed}
                        className="px-10 py-4 bg-orange-600 text-white rounded-2xl font-black transition-all shadow-xl shadow-orange-500/30 disabled:opacity-50 disabled:shadow-none hover:scale-105 active:scale-95 flex items-center gap-3"
                    >
                        LANJUTKAN <ChevronRight className="w-5 h-5" />
                    </button>
                )}
            </div>
        )}

        {step === 1 && (
          <div className="text-center py-2">
            <p className="mt-2 text-[10px] text-slate-400 uppercase tracking-widest font-medium">
                Pastikan kedua file diupload untuk hasil akurat.
            </p>
          </div>
        )}

        {step === 2 && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="flex items-center gap-3 mb-8">
              <div className="p-2 bg-orange-100 dark:bg-orange-500/10 rounded-lg">
                <Calculator className="w-6 h-6 text-orange-600" />
              </div>
              <h2 className="text-xl font-black dark:text-white uppercase tracking-tight">Konfirmasi Sinkronisasi</h2>
            </div>

            <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 mb-10">
              <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
                  Sistem akan memproses <b>{ordersData.length}</b> baris data pesanan dan menggabungkannya dengan data penghasilan.
              </p>
              
              <div className="flex items-start gap-3 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-100 dark:border-blue-900/30">
                <Info className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                <div className="text-xs text-blue-800 dark:text-blue-300">
                    <p className="font-bold mb-1">Penting:</p>
                    <ul className="list-disc pl-4 space-y-1">
                        <li>Data Pesanan digunakan untuk detail produk & SKU.</li>
                        <li>Data Penghasilan digunakan untuk update status (Retur) & biaya-biaya (Admin, Layanan, Net Revenue).</li>
                        <li>Pastikan kedua file berasal dari periode yang sama.</li>
                    </ul>
                </div>
              </div>
            </div>

            <div className="flex justify-between items-center pt-8 border-t border-slate-100 dark:border-slate-800">
              <button onClick={() => setStep(1)} className="text-slate-400 font-bold hover:text-slate-600 text-sm">KEMBALI</button>
              <button 
                onClick={processImport}
                disabled={isProcessing}
                className="px-10 py-4 bg-slate-900 dark:bg-orange-600 text-white rounded-2xl font-black hover:opacity-90 transition-all flex items-center gap-3 disabled:opacity-50 shadow-xl"
              >
                {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
                {isProcessing ? 'SEDANG MENGHITUNG...' : 'MULAI SINKRONISASI'}
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
