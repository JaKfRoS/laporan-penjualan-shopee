
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
  "product_total": ["Dibayar Pembeli", "Total Harga Produk", "Product Subtotal", "Harga Awal"],
  "variation": ["Variasi", "Nama Variasi", "Variation Name", "Model Name"], 
  "city": ["Kota/Kabupaten", "City"],
  "province": ["Provinsi", "Province"],
  "final_sku": ["Nomor Referensi SKU", "SKU Reference No.", "SKU Induk"],
  "return_status": ["Status Pembatalan/Pengembalian", "Return Status", "Status Retur"]
};

const INCOME_HEADER_ALIASES: Record<string, string[]> = {
  "order_id": ["No. Pesanan", "Order ID", "No. Referensi", "ID Pesanan"],
  "order_date": ["Waktu Pesanan Dibuat", "Order Creation Date"],
  "release_date": ["Tanggal Dana Dilepaskan", "Waktu Pesanan Selesai", "Order Complete Time", "Waktu Pencairan", "Tanggal Pencairan"],
  "original_price": ["Harga Asli Produk", "Original Price", "Harga Awal"],
  "product_discount": ["Total Diskon Produk", "Product Discount", "Diskon Produk"],
  "shopee_product_discount": ["Diskon Produk dari Shopee", "Shopee Product Discount"],
  "seller_voucher": ["Voucher disponsor oleh Penjual", "Seller Voucher", "Voucher Penjual"],
  "admin_fee": ["Biaya Administrasi", "Admin Fee"],
  "service_fee": ["Biaya Layanan", "Service Fee"],
  "order_processing_fee": ["Biaya Proses Pesanan", "Order Processing Fee", "Biaya Penanganan", "Processing Fee"],
  "transaction_fee": ["Biaya Transaksi", "Transaction Fee"],
  "premium_fee": ["Premi", "Premium Fee"],
  "ams_commission": ["Biaya Komisi AMS", "AMS Commission Fee"],
  "net_revenue": ["Total Penghasilan", "Net Revenue", "Jumlah Dana Dilepaskan", "Pendapatan Bersih", "Total Dana Dilepaskan"],
  "refund_amount": ["Jumlah Pengembalian Dana ke Pembeli", "Refund Amount"],
  "return_shipping_fee": ["Ongkos Kirim Pengembalian Barang", "Return Shipping Fee"],
  "shipping_fee_forwarded": ["Ongkir yang Diteruskan oleh Shopee ke Jasa Kirim", "Shipping Fee Paid by Seller", "Shipping Fee Forwarded"],
  "shipping_rebate": ["Gratis Ongkir dari Shopee", "Shipping Fee Rebate", "Shipping Rebate"],
  "shipping_paid_by_buyer": ["Ongkos Kirim Dibayar oleh Pembeli", "Shipping Fee Paid by Buyer", "Ongkir Dibayar Pembeli"],
  "seller_cofund_voucher": ["Voucher co-fund disponsor oleh Penjual", "Seller Co-fund Voucher"],
  "seller_coin_cashback": ["Cashback Koin disponsori Penjual", "Seller Coin Cashback"],
  "seller_cofund_coin_cashback": ["Cashback Koin Co-fund disponsori Penjual", "Seller Co-fund Coin Cashback"],
  "shipping_discount_by_courier": ["Diskon Ongkir Ditanggung Jasa Kirim", "Shipping Discount by Courier"],
  "shipping_refund": ["Pengembalian Biaya Kirim", "Shipping Refund"],
  "return_to_sender_shipping_fee": ["Kembali ke Biaya Pengiriman Pengirim", "Return to Sender Shipping Fee"],
  "save_shipping_program_fee": ["Biaya Program Hemat Biaya Kirim", "Save Shipping Program Fee"],
  "campaign_fee": ["Biaya Kampanye", "Campaign Fee"],
  "auto_topup_fee": ["Biaya Isi Saldo Otomatis (dari Penghasilan)", "Auto Top-up Fee"]
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
  const [adjustmentData, setAdjustmentData] = useState<RawRow[]>([]);
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

             // Check for Adjustment sheet
             const adjSheetName = wb.SheetNames.find(n => n.toLowerCase().includes('adjustment') || n.toLowerCase().includes('penyesuaian'));
             if (adjSheetName) {
                 const wsAdj = wb.Sheets[adjSheetName];
                 const aoaAdj = XLSX.utils.sheet_to_json(wsAdj, { header: 1, range: 0, defval: '' }) as any[][];
                 const adjIdx = aoaAdj.findIndex(row => 
                    Array.isArray(row) && row.some(cell => String(cell).toLowerCase().includes('tanggal penyesuaian') || String(cell).toLowerCase().includes('biaya penyesuaian'))
                 );
                 if (adjIdx > -1) {
                     const adjData = XLSX.utils.sheet_to_json(wsAdj, { range: adjIdx }) as RawRow[];
                     setAdjustmentData(adjData);
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
    
    let num: number;
    let isNegative = false;

    if (typeof val === 'number') {
        num = val;
        if (num < 0) {
            isNegative = true;
            num = Math.abs(num);
        }
    } else {
        let str = String(val).trim();
        
        // Remove Rp, spaces, and currency symbols
        str = str.replace(/Rp/gi, '').replace(/IDR/gi, '').replace(/\s/g, '');
        
        // Handle negative sign at the beginning or end
        if (str.startsWith('-') || str.endsWith('-') || (str.startsWith('(') && str.endsWith(')'))) {
            isNegative = true;
            str = str.replace(/[-()]/g, '');
        }

        const dotCount = (str.match(/\./g) || []).length;
        const commaCount = (str.match(/,/g) || []).length;

        if (dotCount > 0 && commaCount > 0) {
            if (str.lastIndexOf(',') > str.lastIndexOf('.')) {
                // 1.234,56 -> 1234.56
                str = str.replace(/\./g, '').replace(',', '.');
            } else {
                // 1,234.56 -> 1234.56
                str = str.replace(/,/g, '');
            }
        } else if (dotCount > 0 && commaCount === 0) {
            if (dotCount === 1) {
                const parts = str.split('.');
                if (parts[1].length === 3) {
                    // 145.600 -> 145600
                    str = str.replace(/\./g, '');
                } else {
                    // 145.6 -> 145.6
                }
            } else {
                // 1.234.567 -> 1234567
                str = str.replace(/\./g, '');
            }
        } else if (commaCount > 0 && dotCount === 0) {
            if (commaCount === 1) {
                const parts = str.split(',');
                if (parts[1].length === 3) {
                    // 145,600 -> 145600
                    str = str.replace(/,/g, '');
                } else {
                    // 145,6 -> 145.6
                    str = str.replace(',', '.');
                }
            } else {
                // 1,234,567 -> 1234567
                str = str.replace(/,/g, '');
            }
        }
        
        num = parseFloat(str.replace(/[^\d.-]/g, ''));
        if (isNaN(num)) num = 0;
    }

    // Fix for Excel parsing "145.600" as "145.6" (English locale issue)
    // In IDR, we don't use decimals for GMV/Fees. If it has decimals and is < 10000, 
    // it's highly likely it was divided by 1000 by Excel.
    if (num % 1 !== 0 && num < 10000) {
        num = Math.round(num * 1000);
    }

    return isNegative ? -Math.abs(num) : num;
  };

  // --- SAFE DATE PARSER ---
  const getSafeDate = (val: any): string | null => {
    if (!val) return null;
    try {
      let isNumericDate = false;
      let d: Date;
      if (typeof val === 'number') {
        // Excel numeric date (e.g., 45678.123)
        // This calculates the date in UTC time explicitly since Unix Epoch
        d = new Date((val - (25567 + 1)) * 86400 * 1000);
        isNumericDate = true;
      } else {
        // For string inputs like '2025-12-01 00:05' or '31/12/2025 15:30'
        let strVal = String(val).trim();
        
        // Handle DD/MM/YYYY or DD-MM-YYYY format
        const ddMmYyyyMatch = strVal.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})(.*)$/);
        if (ddMmYyyyMatch) {
            strVal = `${ddMmYyyyMatch[3]}-${ddMmYyyyMatch[2]}-${ddMmYyyyMatch[1]}${ddMmYyyyMatch[4]}`;
        }

        // If it's already in YYYY-MM-DD HH:mm:ss format, append +07 (WIB)
        if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(strVal)) {
          return strVal.includes('+') ? strVal : `${strVal}+07`;
        }
        d = new Date(strVal);
      }
      
      if (isNaN(d.getTime())) return null;
      
      // Option B: Store as WIB (Local Time) with explicit offset to avoid UTC shift
      // If the input was an Excel numeric date, it was mapped to UTC explicitly.
      const year = isNumericDate ? d.getUTCFullYear() : d.getFullYear();
      const month = String(isNumericDate ? d.getUTCMonth() + 1 : d.getMonth() + 1).padStart(2, '0');
      const day = String(isNumericDate ? d.getUTCDate() : d.getDate()).padStart(2, '0');
      const hours = String(isNumericDate ? d.getUTCHours() : d.getHours()).padStart(2, '0');
      const minutes = String(isNumericDate ? d.getUTCMinutes() : d.getMinutes()).padStart(2, '0');
      const seconds = String(isNumericDate ? d.getUTCSeconds() : d.getSeconds()).padStart(2, '0');
      
      return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}+07`;
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
          
          // Check if fees are present in Order Data (usually they are 0 or incomplete in Order Export)
          // If status is 'Selesai' but we don't have Income Data yet, we might want to flag it.
          // For now, we default to the status in the file, but Income Data processing will override it.
          // User requested: "Jika kolom biaya masih kosong, beri status 'Pending Settlement'"
          // In Order Export, fees are often 0.
          
          if (status.toLowerCase() === 'selesai') {
              // We assume it's pending settlement until we match it with Income Data
              // However, we don't want to overwrite 'Selesai' if we are just re-importing Orders.
              // Let's set a flag or just keep it 'Selesai' and let Income Data confirm it.
              // Actually, the user explicitly asked: "Jika biaya = 0, tampilkan status 'Menunggu Rekonsiliasi'"
              // We can check if we have fee columns mapped and if they are 0.
              // But Order Export usually doesn't have full fee columns.
              // So, let's set it to 'Menunggu Rekonsiliasi' if it's 'Selesai'. 
              // Income Data processing will change it back to 'Selesai'.
              status = 'Menunggu Rekonsiliasi';
          }

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

        // CEK DUPLIKASI ITEM DALAM SATU PESANAN (Merge jika ada produk & variasi yang sama)
        const existingItem = orderGroups[orderId].items.find(item => 
          item.product_name === csvName && item.variation === csvVariation
        );

        if (existingItem) {
          existingItem.quantity += qty;
          existingItem.product_total += prodTotal;
          existingItem.unit_price = existingItem.quantity > 0 ? existingItem.product_total / existingItem.quantity : 0;
        } else {
          orderGroups[orderId].items.push({
            order_id: orderId,
            store_id: store.id,
            product_name: csvName, 
            variation: csvVariation || '', // Pastikan tidak null untuk unique constraint
            quantity: qty,
            product_total: prodTotal,
            unit_price: qty > 0 ? prodTotal / qty : 0,
            final_sku: finalSku,
            hpp_at_time: hppAtTime,
            is_sku_mapped: isMapped
          });
        }
      });

      // 3. PROCESS INCOME DATA (Enrichment)
      // Map headers for Income Data dynamically
      const incomeHeaders = Object.keys(incomeData[0] || {});
      const incomeMapping: Mapping = {};
      Object.entries(INCOME_HEADER_ALIASES).forEach(([dbKey, aliases]) => {
         const found = incomeHeaders.find(h => {
             const cleanH = String(h).trim().toLowerCase().replace(/\(idr\)/g, '').replace(/\(rp\)/g, '').trim();
             return aliases.some(a => cleanH === a.toLowerCase() || cleanH.includes(a.toLowerCase()));
         });
         if (found) incomeMapping[dbKey] = found;
      });

      const incomeReportsToInsert: any[] = [];
      const incomeUpdates: { orderId: string, payload: any }[] = [];

      incomeData.forEach(row => {
         const orderId = String(row[incomeMapping['order_id']] || row['No. Pesanan'] || '').trim();
         if (!orderId) return;

         const netRevenue = parseNumberIndonesia(row[incomeMapping['net_revenue']] || row['Total Penghasilan'] || row['Jumlah Dana Dilepaskan']);
         const adminFee = Math.abs(parseNumberIndonesia(row[incomeMapping['admin_fee']] || row['Biaya Administrasi']));
         const serviceFee = Math.abs(parseNumberIndonesia(row[incomeMapping['service_fee']] || row['Biaya Layanan']));
         const amsFee = Math.abs(parseNumberIndonesia(row[incomeMapping['ams_commission']] || row['Biaya Komisi AMS']));
         const procFee = Math.abs(parseNumberIndonesia(row[incomeMapping['order_processing_fee']] || row['Biaya Proses Pesanan']));
         const premFee = Math.abs(parseNumberIndonesia(row[incomeMapping['premium_fee']] || row['Premi']));
         const refundAmount = Math.abs(parseNumberIndonesia(row[incomeMapping['refund_amount']] || row['Jumlah Pengembalian Dana ke Pembeli']));
         const returnShippingFee = Math.abs(parseNumberIndonesia(row[incomeMapping['return_shipping_fee']] || row['Ongkos Kirim Pengembalian Barang']));
         const shippingForwarded = Math.abs(parseNumberIndonesia(row[incomeMapping['shipping_fee_forwarded']] || row['Ongkir yang Diteruskan oleh Shopee ke Jasa Kirim']));
         const sellerVoucher = Math.abs(parseNumberIndonesia(row[incomeMapping['seller_voucher']] || row['Voucher disponsor oleh Penjual']));
         const shippingRebate = Math.abs(parseNumberIndonesia(row[incomeMapping['shipping_rebate']] || row['Diskon Ongkos Kirim Ditanggung Shopee'] || row['Gratis Ongkir dari Shopee']));
         const transactionFee = Math.abs(parseNumberIndonesia(row[incomeMapping['transaction_fee']] || row['Biaya Transaksi']));
         const shippingPaidByBuyer = Math.abs(parseNumberIndonesia(row[incomeMapping['shipping_paid_by_buyer']] || row['Ongkos Kirim Dibayar oleh Pembeli'] || row['Ongkir Dibayar Pembeli']));
         
         const shopeeProductDiscount = Math.abs(parseNumberIndonesia(row[incomeMapping['shopee_product_discount']] || row['Diskon Produk dari Shopee']));
         const sellerCofundVoucher = Math.abs(parseNumberIndonesia(row[incomeMapping['seller_cofund_voucher']] || row['Voucher co-fund disponsor oleh Penjual']));
         const sellerCoinCashback = Math.abs(parseNumberIndonesia(row[incomeMapping['seller_coin_cashback']] || row['Cashback Koin disponsori Penjual']));
         const sellerCofundCoinCashback = Math.abs(parseNumberIndonesia(row[incomeMapping['seller_cofund_coin_cashback']] || row['Cashback Koin Co-fund disponsori Penjual']));
         const shippingDiscountByCourier = Math.abs(parseNumberIndonesia(row[incomeMapping['shipping_discount_by_courier']] || row['Diskon Ongkir Ditanggung Jasa Kirim']));
         const shippingRefund = Math.abs(parseNumberIndonesia(row[incomeMapping['shipping_refund']] || row['Pengembalian Biaya Kirim']));
         const returnToSenderShippingFee = Math.abs(parseNumberIndonesia(row[incomeMapping['return_to_sender_shipping_fee']] || row['Kembali ke Biaya Pengiriman Pengirim']));
         const saveShippingProgramFee = Math.abs(parseNumberIndonesia(row[incomeMapping['save_shipping_program_fee']] || row['Biaya Program Hemat Biaya Kirim']));
         const campaignFee = Math.abs(parseNumberIndonesia(row[incomeMapping['campaign_fee']] || row['Biaya Kampanye']));
         const autoTopupFee = Math.abs(parseNumberIndonesia(row[incomeMapping['auto_topup_fee']] || row['Biaya Isi Saldo Otomatis (dari Penghasilan)'] || row['Biaya Isi Saldo Otomatis']));

         const originalPrice = Math.abs(parseNumberIndonesia(row[incomeMapping['original_price']] || row['Harga Asli Produk']));
         const productDiscount = Math.abs(parseNumberIndonesia(row[incomeMapping['product_discount']] || row['Total Diskon Produk']));
         const incomeGmv = originalPrice - productDiscount;

         // Calculate total marketplace fee using GMV - Net Revenue for perfect accuracy if GMV is available
         // Note: Net Revenue = GMV + ShippingPaidByBuyer - TotalMarketplaceFee
         // So TotalMarketplaceFee = GMV + ShippingPaidByBuyer - Net Revenue
         const calculatedFee = (adminFee + amsFee + serviceFee + procFee + premFee + shippingForwarded + returnShippingFee + sellerVoucher + refundAmount + transactionFee) - shippingRebate - shippingPaidByBuyer;
         const totalMarketplaceFee = incomeGmv > 0 ? (incomeGmv + shippingPaidByBuyer - netRevenue) : calculatedFee;
         
         const feeDetails = {
            admin_fee: adminFee,
            ams_commission: amsFee,
            service_fee: serviceFee,
            shipping_rebate: shippingRebate,
            refund_amount: refundAmount,
            shipping_forwarded: shippingForwarded,
            return_shipping_fee: returnShippingFee,
            premium_fee: premFee,
            seller_voucher: sellerVoucher,
            processing_fee: procFee,
            transaction_fee: transactionFee,
            shopee_product_discount: shopeeProductDiscount,
            seller_cofund_voucher: sellerCofundVoucher,
            seller_coin_cashback: sellerCoinCashback,
            seller_cofund_coin_cashback: sellerCofundCoinCashback,
            shipping_paid_by_buyer: shippingPaidByBuyer,
            shipping_discount_by_courier: shippingDiscountByCourier,
            shipping_refund: shippingRefund,
            return_to_sender_shipping_fee: returnToSenderShippingFee,
            save_shipping_program_fee: saveShippingProgramFee,
            campaign_fee: campaignFee,
            auto_topup_fee: autoTopupFee
         };

         // Parse Release Date and Order Date if available
         const releaseDateRaw = row[incomeMapping['release_date']] || row['Tanggal Dana Dilepaskan'] || row['Waktu Pencairan'];
         const releaseDate = releaseDateRaw ? getSafeDate(releaseDateRaw) : null;
         
         const orderDateRaw = row[incomeMapping['order_date']] || row['Waktu Pesanan Dibuat'];
         const orderDate = orderDateRaw ? getSafeDate(orderDateRaw) : null;

         let status = 'Selesai';
         if (refundAmount > 0) status = 'Pengembalian';

         // We will only target income_reports to completely decouple finance data
         // Ensure we don't have multiple rows for the same order in the loop
         const existingIndex = incomeReportsToInsert.findIndex(r => r.order_id === orderId);
         
         if (existingIndex >= 0) {
             const existing = incomeReportsToInsert[existingIndex];
             existing.net_revenue += netRevenue;
             existing.service_fee += totalMarketplaceFee;
             existing.product_total += (incomeGmv > 0 ? incomeGmv : 0);
             existing.refund_amount += refundAmount;
             if (refundAmount > 0) existing.status = 'Pengembalian';
             
             // Accumulate fee details
             for (const key in feeDetails) {
                 existing.fee_details[key] = (existing.fee_details[key] || 0) + (feeDetails as any)[key];
             }
         } else {
             const incomeRow = {
                 store_id: store.id,
                 order_id: orderId,
                 order_date: orderDate,
                 release_date: releaseDate,
                 net_revenue: netRevenue,
                 service_fee: totalMarketplaceFee,
                 product_total: incomeGmv > 0 ? incomeGmv : 0,
                 fee_details: feeDetails,
                 refund_amount: refundAmount,
                 status: status
             };
             incomeReportsToInsert.push(incomeRow);
         }
      });

      setImportStats({ total: Object.keys(orderGroups).length, unmapped: unmappedCount });

      // 4. PREPARE PAYLOADS
      const ordersToUpsert = Object.values(orderGroups).map(g => {
        const o = g.order as any;
        const finalProductTotal = o._has_income_gmv ? o.product_total : g.grossProductValue;
        
        // Remove temporary flag before saving
        delete o._has_income_gmv;

        return { 
          ...o, 
          product_total: finalProductTotal,
        };
      });

      const itemsToUpsert = Object.values(orderGroups).flatMap(g => g.items);

      // 5. DATABASE TRANSACTIONS
      if (ordersToUpsert.length > 0) {
        const { error: orderError } = await supabase
          .from('orders')
          .upsert(ordersToUpsert, { onConflict: 'store_id, order_id' });
        
        if (orderError) throw orderError;

        // BATCH UPSERT UNTUK ORDER ITEMS (Mencegah Duplikasi & Data Hilang)
        for (let i = 0; i < itemsToUpsert.length; i += 500) {
            const chunk = itemsToUpsert.slice(i, i + 500);
            const { error: itemError } = await supabase
              .from('order_items')
              .upsert(chunk, { onConflict: 'store_id, order_id, product_name, variation' });
            if (itemError) throw itemError;
        }
      }

      // 5.5 INSERT INTO INCOME REPORTS (NEW SEPARATED TABLE)
      if (incomeReportsToInsert.length > 0) {
          const chunkSize = 500;
          for (let i = 0; i < incomeReportsToInsert.length; i += chunkSize) {
              const chunk = incomeReportsToInsert.slice(i, i + chunkSize);
              const { error: incomeError } = await supabase
                  .from('income_reports')
                  .upsert(chunk, { onConflict: 'store_id, order_id' });
                  
              if (incomeError) {
                  console.error("Gagal menyimpan Laporan Keuangan", incomeError);
                  throw new Error(`Data Laporan Penghasilan gagal disimpan. Pastikan Anda sudah menjalankan SQL Update terbaru. Detail: ${incomeError.message}`);
              }
          }
      }

      // 5.6 PROCESS ADJUSTMENT DATA
      if (adjustmentData.length > 0) {
          const adjustmentsToInsert = adjustmentData.map((row, index) => {
              const dateRaw = row['Tanggal Penyesuaian Dibuat'] || row['Tanggal Dana Dilepaskan'];
              const adjDate = dateRaw ? getSafeDate(dateRaw) : new Date().toISOString();
              const amount = parseNumberIndonesia(row['Biaya Penyesuaian'] || '0');
              const reason = row['Alasan Penyesuaian'] || row['Tipe Penyesuaian | Deskripsi'] || '';
              // Use index to ensure deterministic ID for the same file upload, preventing duplicates
              const deterministicDate = dateRaw ? adjDate : 'NODATE';
              const orderId = `ADJ-${store.id}-${deterministicDate}-${amount}-${reason.replace(/\s+/g, '').substring(0, 30)}-${row['No. Pesanan Terhubung'] || '-'}-${index}`;
              
              return {
                  store_id: store.id,
                  adjustment_date: adjDate,
                  amount: amount,
                  reason: reason,
                  order_id: orderId
              };
          }).filter(a => a.amount !== 0);

          if (adjustmentsToInsert.length > 0) {
              // Manual Duplicate Prevention
              const orderIds = adjustmentsToInsert.map(a => a.order_id);
              const { data: existing } = await supabase
                .from('adjustments')
                .select('order_id')
                .eq('store_id', store.id)
                .in('order_id', orderIds);
              
              const existingIds = new Set(existing?.map(e => e.order_id) || []);
              const newAdjustments = adjustmentsToInsert.filter(a => !existingIds.has(a.order_id));

              if (newAdjustments.length > 0) {
                  const { error: adjError } = await supabase
                      .from('adjustments')
                      .insert(newAdjustments);
                  if (adjError) {
                      console.error("Adjustment Error:", adjError);
                      // Non-fatal, just log
                  }
              }
          }
      }

      // 6. UPDATE LAST IMPORT TIMESTAMP
      const now = new Date().toISOString();
      await supabase
        .from('stores')
        .update({ last_import_at: now })
        .eq('id', store.id);

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

      <div className="bg-orange-50 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/20 rounded-2xl p-4 mb-8 flex flex-col items-center justify-center gap-1">
        <div className="flex items-center gap-3">
          <StoreIcon className="w-5 h-5 text-orange-600" />
          <span className="text-sm text-orange-800 dark:text-orange-200 font-medium">
            Mengimpor data untuk toko: <span className="font-black uppercase tracking-wide">{store.name}</span>
          </span>
        </div>
        {store.last_import_at && (
          <span className="text-[10px] text-orange-600/70 dark:text-orange-400/70 font-bold uppercase tracking-widest">
            Terakhir diperbarui: {new Date(store.last_import_at).toLocaleString('id-ID')}
          </span>
        )}
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
