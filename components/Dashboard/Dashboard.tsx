
import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { supabase } from '../../services/supabase';
import { Store, Order } from '../../types';
import { KPICard } from './KPICard';
import { RevenueChart } from './RevenueChart';
import { ProductChart } from './ProductChart';
import { OrdersTable } from './OrdersTable';
import { DateRangePicker } from './DateRangePicker';
import { BrainCircuit, Loader2, Info, AlertCircle, ShoppingBag, XCircle, Wallet, FileSpreadsheet, ArrowRightLeft, Settings, Percent, CheckCircle2, PackageSearch } from 'lucide-react';
import { getSalesInsights } from '../../services/gemini';
import { toast } from 'react-hot-toast';
import { format } from 'date-fns';

interface DashboardProps { 
  store: Store; 
  allStores?: Store[]; 
}

export const Dashboard: React.FC<DashboardProps> = ({ store, allStores }) => {
  // Display Data
  const [filteredOrders, setFilteredOrders] = useState<Order[]>([]);
  const [adjustments, setAdjustments] = useState<any[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [dateFilterType, setDateFilterType] = useState<'order_date' | 'release_date'>('order_date');
  const [insights, setInsights] = useState<string | null>(null);
  const [isGeneratingInsights, setIsGeneratingInsights] = useState(false);
  
  const abortControllerRef = useRef<AbortController | null>(null);

  // FETCH DATA SAAT TOKO ATAU TANGGAL BERUBAH (SERVER-SIDE FILTERING)
  useEffect(() => {
    fetchData();
    return () => {
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, [store, dateRange, dateFilterType]);

  const fetchData = async () => {
    if (abortControllerRef.current) abortControllerRef.current.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);

    try {
      let query = supabase
        .from('orders')
        .select('*, order_items(*)')
        .order(dateFilterType, { ascending: false });

      let adjQuery = supabase
        .from('adjustments')
        .select('*')
        .order('adjustment_date', { ascending: false });

      if (store.id === 'all') {
        if (allStores && allStores.length > 0) {
           const storeIds = allStores.map(s => s.id);
           query = query.in('store_id', storeIds);
           adjQuery = adjQuery.in('store_id', storeIds);
        } else {
           setFilteredOrders([]);
           setAdjustments([]);
           setLoading(false);
           return;
        }
      } else {
        query = query.eq('store_id', store.id);
        adjQuery = adjQuery.eq('store_id', store.id);
      }

      // Server-side date filtering
      if (dateRange.start) {
        query = query.gte(dateFilterType, `${dateRange.start}T00:00:00`);
        adjQuery = adjQuery.gte('adjustment_date', `${dateRange.start}T00:00:00`);
      }
      if (dateRange.end) {
        query = query.lte(dateFilterType, `${dateRange.end}T23:59:59`);
        adjQuery = adjQuery.lte('adjustment_date', `${dateRange.end}T23:59:59`);
      }

      const [ordersRes, adjRes] = await Promise.all([query, adjQuery]);
      
      if (controller.signal.aborted) return;

      if (ordersRes.error) throw ordersRes.error;
      if (adjRes.error) throw adjRes.error;
      
      setFilteredOrders(ordersRes.data || []);
      setAdjustments(adjRes.data || []);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        if (err.message?.toLowerCase().includes('refresh token') || err.message?.includes('refresh_token_not_found') || err.message?.toLowerCase().includes('invalid refresh token')) {
          // Ignore auth errors, let App.tsx handle SIGNED_OUT event
          return;
        }
        toast.error('Gagal memuat data: ' + err.message);
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  };

  const metrics = useMemo(() => {
    const data = filteredOrders;
    
    // 1. Total Pesanan Masuk (Semua status)
    const totalOrdersCount = data.length;

    // 2. Pesanan Batal
    const cancelledOrders = data.filter(o => 
      (o.status || '').toLowerCase().includes('batal') || 
      (o.status || '').toLowerCase().includes('cancel')
    );
    const cancelledCount = cancelledOrders.length;

    // 4. METRICS CALCULATION (SETTLED DATA FOCUS)
    // Filter: Hanya Transaksi Selesai untuk Omzet & Laba Kotor
    const completedOrders = data.filter(o => o.status === 'Selesai');
    
    // Filter: Transaksi Retur untuk Penyesuaian
    const returnedOrders = data.filter(o => 
      (o.status || '').toLowerCase().includes('retur') || 
      (o.status || '').toLowerCase().includes('pengembalian')
    );

    // 1. Filter: Hanya Order yang SUDAH SELESAI atau PENGEMBALIAN (Retur)
    // Reference: Includes orders with Profit/Loss (Selesai) and Returns (which have fees)
    const settledOrders = data.filter(o => {
        const s = (o.status || '').toLowerCase();
        return s === 'selesai' || s === 'pengembalian';
    });

    // A. Total Omzet (GMV) - Hanya yang sudah SELESAI
    const totalOmzet = settledOrders.reduce((acc, o) => acc + (o.product_total || 0), 0);

    // B. Uang Cair (Net Revenue) - Sum dari Net Revenue order yang SELESAI
    const netRevenueSelesai = settledOrders.reduce((acc, o) => acc + (o.net_revenue || 0), 0);

    // C. Total Potongan Marketplace
    const totalPotongan = settledOrders.reduce((acc, o) => acc + (o.service_fee || 0), 0);

    // D. Total HPP (Hanya untuk order yang SELESAI)
    const totalHPPSelesai = settledOrders.reduce((acc, o) => {
      const isReturned = (o.status || '').toLowerCase().includes('pengembalian') || (o.status || '').toLowerCase().includes('retur');
      if (isReturned) return acc; // HPP 0 for returns

      const orderHpp = o.order_items?.reduce((h, item) => {
        return h + ((item.hpp_at_time || 0) * item.quantity);
      }, 0) || 0;
      return acc + orderHpp;
    }, 0);

    // E. Total Keuntungan (Profit) = Uang Cair - HPP
    // Formula User: "Total Keuntungan = uang cair - total hpp"
    const totalKeuntungan = netRevenueSelesai - totalHPPSelesai;

    // F. Total Penyesuaian
    const totalPenyesuaian = adjustments.reduce((acc, a) => acc + (Number(a.amount) || 0), 0);

    // G. Keuntungan Setelah Penyesuaian
    const keuntunganSetelahPenyesuaian = totalKeuntungan + totalPenyesuaian;

    // H. Uang yang Berpotensi Cair
    // Filter Valid Orders (Exclude Batal/Cancel)
    const validOrders = data.filter(o => {
        const s = (o.status || '').toLowerCase();
        return !s.includes('batal') && !s.includes('cancel');
    });
    const totalGmvValid = validOrders.reduce((acc, o) => acc + (o.product_total || 0), 0);
    
    // Formula User: "Uang yang Berpotensi Cair = total gmv valid - total omzet"
    const uangPotensiCair = totalGmvValid - totalOmzet;

    // --- NEW METRICS FOR DYNAMIC KPI ---

    // 1. Performance Mode Metrics
    const totalOmzetPesanan = data.reduce((acc, o) => acc + (o.product_total || 0), 0); // GMV All Orders
    const averageOrderValue = totalOrdersCount > 0 ? totalOmzetPesanan / totalOrdersCount : 0;
    
    // Product Performance (Top SKU Contribution)
    const skuCounts: Record<string, number> = {};
    let totalItemsSold = 0;
    data.forEach(o => {
      o.order_items?.forEach(item => {
        const sku = item.sku || 'Unknown';
        skuCounts[sku] = (skuCounts[sku] || 0) + item.quantity;
        totalItemsSold += item.quantity;
      });
    });
    const sortedSkus = Object.entries(skuCounts).sort((a, b) => b[1] - a[1]);
    const topSkuCount = sortedSkus.length > 0 ? sortedSkus[0][1] : 0;
    const topSkuContribution = totalItemsSold > 0 ? (topSkuCount / totalItemsSold) * 100 : 0;

    // Operational Risk (Batal/Retur Count)
    const operationalRiskCount = cancelledCount + returnedOrders.length;

    // 2. Cash Flow Mode Metrics
    // Dana Cair Bersih (Settled) -> netRevenueSelesai (Already calculated)
    // Potongan Shopee -> totalPotongan (Already calculated)
    // Profit Riil Akhir -> keuntunganSetelahPenyesuaian (Already calculated)
    
    // Kebocoran Ongkir (Shipping Leakage)
    // Sum (Shipping Forwarded - Estimated Shipping) where Forwarded > Estimated
    let shippingLeakage = 0;
    settledOrders.forEach(o => {
      if (o.fee_details) {
        const forwarded = o.fee_details.shipping_forwarded || 0;
        const estimated = o.shipping_estimated || 0;
        // Note: shipping_forwarded is usually negative in fee_details (cost), so we take Math.abs
        // Wait, in ImportWizard, shipping_forwarded is parsed as number. Usually fees are negative.
        // Let's assume absolute values for comparison or check sign.
        // In feeBreakdown below, we add fee_details values. 
        // Let's check ImportWizard logic. 
        // "shipping_fee_forwarded": parseNumberIndonesia(row[mapping['shipping_fee_forwarded']])
        // Usually in Shopee report, expenses are negative.
        // So forwarded is likely negative. Estimated is usually positive (what buyer pays or system estimates).
        // Leakage is when Actual Cost (Forwarded) > Estimated Cost.
        // Let's use Math.abs for safety if we are comparing magnitudes.
        const absForwarded = Math.abs(forwarded);
        const absEstimated = Math.abs(estimated);
        
        // If actual shipping cost is higher than estimated, seller pays the difference.
        if (absForwarded > absEstimated) {
           shippingLeakage += (absForwarded - absEstimated);
        }
      }
    });

    // Dana Tertahan (Pending Escrow)
    // Estimasi net_payout untuk pesanan 'Selesai' yang belum masuk laporan Income (no release_date)
    // We can identify these by checking if fee_details is empty or release_date is null
    // But current logic in ImportWizard might fill fee_details with 0s.
    // Let's rely on 'Menunggu Rekonsiliasi' status if we implemented it, or check release_date.
    // The Order interface has release_date.
    const pendingEscrowOrders = data.filter(o => {
       const s = (o.status || '').toLowerCase();
       return s === 'selesai' && !o.release_date;
    });
    // Estimate Net Payout: Product Total - (Product Total * 10% approx fees)
    // Or just use Product Total as "Gross Pending"
    const pendingEscrow = pendingEscrowOrders.reduce((acc, o) => {
       // Simple estimation: 90% of GMV
       return acc + ((o.product_total || 0) * 0.9);
    }, 0);


    // I. Persentase
    const marginKeuntungan = totalOmzet > 0 ? (totalKeuntungan / totalOmzet) * 100 : 0;
    const rataRataPotongan = totalOmzet > 0 ? (totalPotongan / totalOmzet) * 100 : 0;

    // J. Fee Breakdown
    let feeBreakdown = {
      admin: 0,
      ams: 0,
      service: 0,
      shippingRebate: 0,
      refund: 0,
      shippingForwarded: 0,
      returnShipping: 0,
      premium: 0,
      voucher: 0,
      processing: 0
    };

    settledOrders.forEach(o => {
      if (o.fee_details) {
        feeBreakdown.admin += (o.fee_details.admin_fee || 0);
        feeBreakdown.ams += (o.fee_details.ams_commission || 0);
        feeBreakdown.service += (o.fee_details.service_fee || 0);
        feeBreakdown.shippingRebate += (o.fee_details.shipping_rebate || 0);
        feeBreakdown.refund += (o.fee_details.refund_amount || 0);
        feeBreakdown.shippingForwarded += (o.fee_details.shipping_forwarded || 0);
        feeBreakdown.returnShipping += (o.fee_details.return_shipping_fee || 0);
        feeBreakdown.premium += (o.fee_details.premium_fee || 0);
        feeBreakdown.voucher += (o.fee_details.seller_voucher || 0);
        feeBreakdown.processing += (o.fee_details.processing_fee || 0);
      }
    });

    return { 
      totalOrders: totalOrdersCount, // Changed to totalOrdersCount (all orders) for Performance Mode
      returnedCount: returnedOrders.length,
      totalOmzet,
      netRevenueSelesai, // Uang Cair
      totalPotongan,
      totalHPPSelesai,
      labaKotor: totalKeuntungan, // Gross Profit
      totalPenyesuaian,
      labaBersih: keuntunganSetelahPenyesuaian, // Net Profit
      totalKeuntungan,
      keuntunganSetelahPenyesuaian,
      marginKeuntungan,
      rataRataPotongan,
      uangPotensiCair,
      percentLabaKotor: marginKeuntungan,
      percentLabaBersih: marginKeuntungan,
      percentPotongan: rataRataPotongan,
      feeBreakdown,
      // New Metrics
      totalOmzetPesanan,
      averageOrderValue,
      topSkuContribution,
      operationalRiskCount,
      shippingLeakage,
      pendingEscrow
    };
  }, [filteredOrders, adjustments]);

  const handleExportXLSX = () => {
    if (filteredOrders.length === 0) {
      toast.error("Tidak ada data untuk diekspor");
      return;
    }

    const toastId = toast.loading("Menyiapkan Laporan Excel...");

    try {
      const exportTime = new Date().toLocaleString('id-ID');
      const dataToExport = filteredOrders;

      let startDateStr = dateRange.start;
      let endDateStr = dateRange.end;

      if (!startDateStr && dataToExport.length > 0) {
        const sortedDates = [...dataToExport].sort((a, b) => new Date(a.order_date).getTime() - new Date(b.order_date).getTime());
        startDateStr = sortedDates[0].order_date.split('T')[0];
      }
      
      if (!endDateStr && dataToExport.length > 0) {
        const sortedDates = [...dataToExport].sort((a, b) => new Date(b.order_date).getTime() - new Date(a.order_date).getTime());
        endDateStr = sortedDates[0].order_date.split('T')[0];
      }

      const formatDate = (dateStr: string) => {
        try { return format(new Date(dateStr), 'dd/MM/yyyy'); } 
        catch { return dateStr; }
      };

      const displayPeriod = `${formatDate(startDateStr || '')} - ${formatDate(endDateStr || '')}`;
      const wb = XLSX.utils.book_new();

      const createSummarySheet = (sheetOrders: Order[], sheetStoreName: string) => {
        // 1. Calculate Summary Metrics
        const settledOrders = sheetOrders.filter(o => {
            const s = (o.status || '').toLowerCase();
            return s === 'selesai' || s === 'pengembalian';
        });
        const batalOrders = sheetOrders.filter(o => o.status?.toLowerCase().includes('batal') || o.status?.toLowerCase().includes('cancel'));
        const returOrders = sheetOrders.filter(o => o.status?.toLowerCase().includes('retur') || o.status?.toLowerCase().includes('pengembalian'));
        const validOrders = sheetOrders.filter(o => !o.status?.toLowerCase().includes('batal') && !o.status?.toLowerCase().includes('cancel'));
        
        const totalOmzet = settledOrders.reduce((acc, o) => acc + (o.product_total || 0), 0);
        const totalPemasukan = settledOrders.reduce((acc, o) => acc + (o.net_revenue || 0), 0);
        const totalGmvValid = validOrders.reduce((acc, o) => acc + (o.product_total || 0), 0);
        const totalPotensiCair = totalGmvValid - totalOmzet;

        const totalHPP = settledOrders.reduce((acc, o) => {
             const isReturned = (o.status || '').toLowerCase().includes('pengembalian') || (o.status || '').toLowerCase().includes('retur');
             if (isReturned) return acc;
             const orderHpp = o.order_items?.reduce((h, item) => h + ((item.hpp_at_time || 0) * item.quantity), 0) || 0;
             return acc + orderHpp;
        }, 0);
        
        const totalTransaksi = sheetOrders.length;
        const transaksiBatal = batalOrders.length;
        const transaksiRetur = returOrders.length;
        const avgOrderValue = totalTransaksi > 0 ? totalOmzet / totalTransaksi : 0; 

        // 2. Calculate Fee Breakdown
        let feeBreakdown = {
            admin: 0,
            ams: 0,
            service: 0,
            shippingRebate: 0,
            refund: 0,
            shippingForwarded: 0,
            returnShipping: 0,
            premium: 0,
            voucher: 0,
            processing: 0
        };

        settledOrders.forEach(o => {
            if (o.fee_details) {
                feeBreakdown.admin += (o.fee_details.admin_fee || 0);
                feeBreakdown.ams += (o.fee_details.ams_commission || 0);
                feeBreakdown.service += (o.fee_details.service_fee || 0);
                feeBreakdown.shippingRebate += (o.fee_details.shipping_rebate || 0);
                feeBreakdown.refund += (o.fee_details.refund_amount || 0);
                feeBreakdown.shippingForwarded += (o.fee_details.shipping_forwarded || 0);
                feeBreakdown.returnShipping += (o.fee_details.return_shipping_fee || 0);
                feeBreakdown.premium += (o.fee_details.premium_fee || 0);
                feeBreakdown.voucher += (o.fee_details.seller_voucher || 0);
                feeBreakdown.processing += (o.fee_details.processing_fee || 0);
            }
        });

        const totalFee = -feeBreakdown.admin - feeBreakdown.ams - feeBreakdown.service + feeBreakdown.shippingRebate - feeBreakdown.refund - feeBreakdown.shippingForwarded - feeBreakdown.returnShipping - feeBreakdown.premium - feeBreakdown.voucher - feeBreakdown.processing;

        // 3. Construct Excel Rows
        const rows = [];

        // Header Section
        rows.push([`LAPORAN TOKO ${sheetStoreName.toUpperCase()}`]);
        rows.push(["powered by OneWaymedia"]);
        rows.push([""]);
        rows.push(["Platform:", "Shopee"]);
        rows.push(["Tipe Kalkulasi:", dateFilterType === 'order_date' ? "Performa Sales (Berdasarkan Tanggal Pesanan)" : "Arus Kas (Berdasarkan Tanggal Pencairan)"]);
        rows.push(["Tanggal Export:", exportTime]);
        rows.push(["Periode:", displayPeriod]);
        rows.push(["Filter:", dateFilterType === 'order_date' ? "Tanggal Pesanan Dibuat" : "Tanggal Dana Dilepaskan"]);
        rows.push([""]);

        // Ringkasan Analytics
        rows.push(["Ringkasan Analytics"]);
        rows.push(["Metrik", "Nilai", "Keterangan"]);
        rows.push(["Total GMV Valid", totalGmvValid, "Total omset semua pesanan kecuali batal/cancel"]);
        rows.push(["Total Omzet", totalOmzet, "Total omset pesanan selesai"]);
        rows.push(["Total Potensi Cair", totalPotensiCair, "Total potensi uang cair dari pesanan belum selesai"]);
        rows.push(["Total Pemasukan", totalPemasukan, "Uang yang cair di saldo penjual"]);
        rows.push(["Total HPP", totalHPP, "Total HPP pesanan selesai"]);
        
        // Calculate Total Penyesuaian
        const totalPenyesuaian = adjustments.reduce((acc, a) => acc + (Number(a.amount) || 0), 0);
        const totalKeuntungan = (totalPemasukan - totalHPP) + totalPenyesuaian;

        rows.push(["Total Penyesuaian", totalPenyesuaian, "Total nilai adjustment (kompensasi/denda)"]);
        rows.push(["Total Keuntungan", totalKeuntungan, "Total keuntungan pesanan selesai + Penyesuaian"]);
        rows.push(["Total Transaksi", totalTransaksi, "Total seluruh transaksi"]);
        rows.push(["Transaksi Batal", transaksiBatal, "Total transaksi batal/cancel"]);
        rows.push(["Transaksi Retur", transaksiRetur, "Total transaksi retur/pengembalian"]);
        rows.push(["Rata-rata Nilai Order", avgOrderValue, "Rata-rata nilai per transaksi"]);

        // Margin & Persentase
        const margin = totalOmzet > 0 ? (totalKeuntungan / totalOmzet) : 0;
        const totalPotongan = settledOrders.reduce((acc, o) => acc + (o.service_fee || 0), 0);
        const costPercent = totalOmzet > 0 ? (totalPotongan / totalOmzet) : 0; 
        
        rows.push(["Margin Keuntungan", `${(margin * 100).toFixed(2)}%`, "Persentase keuntungan terhadap omzet"]); 
        rows.push(["Rata-Rata Potongan", `${(costPercent * 100).toFixed(2)}%`, "Persentase potongan marketplace terhadap omzet"]);
        rows.push([""]);

        // Fee Breakdown
        rows.push(["Fee Breakdown (Shopee)"]);
        rows.push(["Jenis Fee", "Jumlah", "Tipe"]);
        rows.push(["Biaya Administrasi", -feeBreakdown.admin, "Biaya"]);
        rows.push(["Biaya Komisi AMS", -feeBreakdown.ams, "Biaya"]);
        rows.push(["Biaya Layanan", -feeBreakdown.service, "Biaya"]);
        rows.push(["Gratis Ongkir dari Shopee", feeBreakdown.shippingRebate, "Pemasukan"]);
        rows.push(["Jumlah Pengembalian Dana ke Pembeli", -feeBreakdown.refund, "Biaya"]);
        rows.push(["Ongkir yang Diteruskan oleh Shopee ke Jasa Kirim", -feeBreakdown.shippingForwarded, "Biaya"]);
        rows.push(["Ongkos Kirim Pengembalian Barang", -feeBreakdown.returnShipping, "Biaya"]);
        rows.push(["Premi", -feeBreakdown.premium, "Biaya"]);
        rows.push(["Voucher disponsor oleh Penjual", -feeBreakdown.voucher, "Biaya"]);
        rows.push(["Total Fee", totalFee, "Total Keseluruhan Fee"]);
        rows.push([""]);

        const ws = XLSX.utils.aoa_to_sheet(rows);

        // Styling Columns
        ws['!cols'] = [
            { wch: 40 }, // Metrik
            { wch: 20 }, // Nilai
            { wch: 50 }, // Keterangan
        ];

        return ws;
      };

      const createTransactionSheet = (sheetOrders: Order[], title: string) => {
        const rows = [];
        rows.push([title]);
        rows.push([`Total ${sheetOrders.length} transaksi`]);
        rows.push([
            "Order ID", 
            "Tanggal", 
            "Produk", 
            "Qty", 
            "Status", 
            "Harga Jual", 
            "Total Biaya", 
            "HPP", 
            "Profit"
        ]);

        sheetOrders.forEach(o => {
            const firstItem = o.order_items && o.order_items.length > 0 ? o.order_items[0] : null;
            const productName = firstItem ? firstItem.product_name : '-';
            const qty = o.order_items ? o.order_items.reduce((s, i) => s + i.quantity, 0) : 0;
            
            const isReturned = (o.status || '').toLowerCase().includes('pengembalian') || (o.status || '').toLowerCase().includes('retur');
            const hpp = isReturned ? 0 : (o.order_items?.reduce((h, item) => h + ((item.hpp_at_time || 0) * item.quantity), 0) || 0);
            const profit = o.status?.toLowerCase().includes('batal') ? 0 : ((o.net_revenue || 0) - hpp);
            
            rows.push([
                o.order_id,
                formatDate(o.order_date),
                productName,
                qty,
                o.status,
                o.product_total || 0,
                -Math.abs(o.service_fee || 0), 
                hpp,
                profit
            ]);
        });

        const ws = XLSX.utils.aoa_to_sheet(rows);
        ws['!cols'] = [
            { wch: 20 }, { wch: 15 }, { wch: 40 }, { wch: 5 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }
        ];
        return ws;
      };

      const summaryWs = createSummarySheet(dataToExport, store.name);
      XLSX.utils.book_append_sheet(wb, summaryWs, "Summary");

      const selesaiOrders = dataToExport.filter(o => (o.status || '').toLowerCase() === 'selesai');
      const batalReturOrders = dataToExport.filter(o => o.status?.toLowerCase().includes('batal') || o.status?.toLowerCase().includes('cancel') || o.status?.toLowerCase().includes('retur') || o.status?.toLowerCase().includes('pengembalian'));
      const prosesOrders = dataToExport.filter(o => !o.status?.toLowerCase().includes('batal') && !o.status?.toLowerCase().includes('cancel') && !o.status?.toLowerCase().includes('retur') && !o.status?.toLowerCase().includes('pengembalian') && (o.status || '').toLowerCase() !== 'selesai');

      if (selesaiOrders.length > 0) {
        const selesaiWs = createTransactionSheet(selesaiOrders, "Pesanan Sudah Selesai");
        XLSX.utils.book_append_sheet(wb, selesaiWs, "Selesai");
      }
      if (prosesOrders.length > 0) {
        const prosesWs = createTransactionSheet(prosesOrders, "Pesanan Proses & Kirim");
        XLSX.utils.book_append_sheet(wb, prosesWs, "Proses & Kirim");
      }
      if (batalReturOrders.length > 0) {
        const batalReturWs = createTransactionSheet(batalReturOrders, "Pesanan Batal & Retur");
        XLSX.utils.book_append_sheet(wb, batalReturWs, "Batal & Retur");
      }

      const fileName = `Laporan_Proyek_${store.name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`;
      XLSX.writeFile(wb, fileName);

      toast.success("Laporan Excel berhasil dibuat!", { id: toastId });
    } catch (err: any) {
      console.error(err);
      toast.error("Gagal mengekspor: " + err.message, { id: toastId });
    }
  };

  const handleExportPDF = () => {
    if (filteredOrders.length === 0) {
      toast.error("Tidak ada data untuk diekspor");
      return;
    }

    const toastId = toast.loading("Menyiapkan Laporan PDF...");

    try {
      const doc = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4'
      });
      const exportTime = new Date().toLocaleString('id-ID');
      
      let startDateStr = dateRange.start;
      let endDateStr = dateRange.end;
      if (!startDateStr && filteredOrders.length > 0) {
        const sortedDates = [...filteredOrders].sort((a, b) => new Date(a.order_date).getTime() - new Date(b.order_date).getTime());
        startDateStr = sortedDates[0].order_date.split('T')[0];
      }
      if (!endDateStr && filteredOrders.length > 0) {
        const sortedDates = [...filteredOrders].sort((a, b) => new Date(b.order_date).getTime() - new Date(a.order_date).getTime());
        endDateStr = sortedDates[0].order_date.split('T')[0];
      }
      const formatDate = (dateStr: string) => {
        try { return format(new Date(dateStr), 'dd/MM/yyyy'); } 
        catch { return dateStr; }
      };
      const displayPeriod = `${formatDate(startDateStr || '')} - ${formatDate(endDateStr || '')}`;

      // 1. Header
      doc.setFontSize(22);
      doc.setFont('helvetica', 'bold');
      const reportTitle = `LAPORAN TOKO ${store.id === 'all' ? 'GABUNGAN' : store.name.toUpperCase()}`;
      doc.text(reportTitle, 14, 22);
      
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100);
      doc.text("powered by OneWaymedia", 14, 30);

      if (store.id === 'all' && allStores) {
        doc.setFontSize(8);
        doc.text(`Detail Toko: ${allStores.map(s => s.name).join(', ')}`, 14, 35);
      }

      doc.setTextColor(0);
      doc.setFontSize(11);
      doc.text(`Platform: Shopee`, 14, 45);
      doc.text(`Tipe Kalkulasi: ${dateFilterType === 'order_date' ? "Performa Sales (Berdasarkan Tanggal Pesanan)" : "Arus Kas (Berdasarkan Tanggal Pencairan)"}`, 14, 52);
      doc.text(`Tanggal Export: ${exportTime}`, 14, 59);
      doc.text(`Periode: ${displayPeriod}`, 14, 66);
      doc.text(`Filter: ${dateFilterType === 'order_date' ? "Tanggal Pesanan Dibuat" : "Tanggal Dana Dilepaskan"}`, 14, 73);

      // 2. Ringkasan Analytics
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text("Ringkasan Analytics", 14, 90);

      const settledOrders = filteredOrders.filter(o => {
          const s = (o.status || '').toLowerCase();
          return s === 'selesai' || s === 'pengembalian';
      });
      const batalOrders = filteredOrders.filter(o => o.status?.toLowerCase().includes('batal') || o.status?.toLowerCase().includes('cancel'));
      const returOrders = filteredOrders.filter(o => o.status?.toLowerCase().includes('retur') || o.status?.toLowerCase().includes('pengembalian'));
      const validOrders = filteredOrders.filter(o => !o.status?.toLowerCase().includes('batal') && !o.status?.toLowerCase().includes('cancel'));
      
      const totalOmzet = settledOrders.reduce((acc, o) => acc + (o.product_total || 0), 0);
      const totalPemasukan = settledOrders.reduce((acc, o) => acc + (o.net_revenue || 0), 0);
      const totalGmvValid = validOrders.reduce((acc, o) => acc + (o.product_total || 0), 0);
      const totalPotensiCair = totalGmvValid - totalOmzet;

      const totalHPP = settledOrders.reduce((acc, o) => {
           const isReturned = (o.status || '').toLowerCase().includes('pengembalian') || (o.status || '').toLowerCase().includes('retur');
           if (isReturned) return acc;
           const orderHpp = o.order_items?.reduce((h, item) => h + ((item.hpp_at_time || 0) * item.quantity), 0) || 0;
           return acc + orderHpp;
      }, 0);
      
      const totalPenyesuaian = adjustments.reduce((acc, a) => acc + (Number(a.amount) || 0), 0);
      const totalKeuntungan = (totalPemasukan - totalHPP) + totalPenyesuaian;
      
      const totalTransaksi = filteredOrders.length;
      const transaksiBatal = batalOrders.length;
      const transaksiRetur = returOrders.length;
      const avgOrderValue = totalTransaksi > 0 ? totalOmzet / totalTransaksi : 0;
      const margin = totalOmzet > 0 ? (totalKeuntungan / totalOmzet) * 100 : 0;
      const totalPotongan = settledOrders.reduce((acc, o) => acc + (o.service_fee || 0), 0);
      const costPercent = totalOmzet > 0 ? (totalPotongan / totalOmzet) * 100 : 0;

      autoTable(doc, {
        startY: 95,
        head: [['Metrik', 'Nilai', 'Keterangan']],
        body: [
          ['Total GMV Valid', `Rp ${totalGmvValid.toLocaleString()}`, 'Total omset semua pesanan kecuali batal/cancel'],
          ['Total Omzet', `Rp ${totalOmzet.toLocaleString()}`, 'Total omset pesanan selesai'],
          ['Total Potensi Cair', `Rp ${totalPotensiCair.toLocaleString()}`, 'Total potensi uang cair dari pesanan belum selesai'],
          ['Total Pemasukan', `Rp ${totalPemasukan.toLocaleString()}`, 'Uang yang cair di saldo penjual'],
          ['Total HPP', `Rp ${totalHPP.toLocaleString()}`, 'Total HPP pesanan selesai'],
          ['Total Penyesuaian', `Rp ${totalPenyesuaian.toLocaleString()}`, 'Total nilai adjustment (kompensasi/denda)'],
          ['Total Keuntungan', `Rp ${totalKeuntungan.toLocaleString()}`, 'Total keuntungan pesanan selesai + Penyesuaian'],
          ['Total Transaksi', totalTransaksi.toString(), 'Total seluruh transaksi'],
          ['Transaksi Batal', transaksiBatal.toString(), 'Total transaksi batal/cancel'],
          ['Transaksi Retur', transaksiRetur.toString(), 'Total transaksi retur/pengembalian'],
          ['Rata-rata Nilai Order', `Rp ${avgOrderValue.toLocaleString()}`, 'Rata-rata nilai per transaksi'],
          ['Margin Keuntungan', `${margin.toFixed(2)}%`, 'Persentase keuntungan terhadap omzet'],
          ['Rata-Rata Potongan', `${costPercent.toFixed(2)}%`, 'Persentase potongan marketplace terhadap omzet'],
        ],
        theme: 'striped',
        headStyles: { fillColor: [37, 99, 235] },
      });

      // 3. Fee Breakdown
      let feeBreakdown = { admin: 0, ams: 0, service: 0, shippingRebate: 0, refund: 0, shippingForwarded: 0, returnShipping: 0, premium: 0, voucher: 0, processing: 0 };
      settledOrders.forEach(o => {
          if (o.fee_details) {
              feeBreakdown.admin += (o.fee_details.admin_fee || 0);
              feeBreakdown.ams += (o.fee_details.ams_commission || 0);
              feeBreakdown.service += (o.fee_details.service_fee || 0);
              feeBreakdown.shippingRebate += (o.fee_details.shipping_rebate || 0);
              feeBreakdown.refund += (o.fee_details.refund_amount || 0);
              feeBreakdown.shippingForwarded += (o.fee_details.shipping_forwarded || 0);
              feeBreakdown.returnShipping += (o.fee_details.return_shipping_fee || 0);
              feeBreakdown.premium += (o.fee_details.premium_fee || 0);
              feeBreakdown.voucher += (o.fee_details.seller_voucher || 0);
              feeBreakdown.processing += (o.fee_details.processing_fee || 0);
          }
      });

      const totalFee = -feeBreakdown.admin - feeBreakdown.ams - feeBreakdown.service + feeBreakdown.shippingRebate - feeBreakdown.refund - feeBreakdown.shippingForwarded - feeBreakdown.returnShipping - feeBreakdown.premium - feeBreakdown.voucher - feeBreakdown.processing;

      doc.addPage();
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text("Fee Breakdown (Shopee)", 14, 22);

      autoTable(doc, {
        startY: 27,
        head: [['Jenis Fee', 'Jumlah', 'Tipe']],
        body: [
          ['Biaya Administrasi', `-Rp ${feeBreakdown.admin.toLocaleString()}`, 'Biaya'],
          ['Biaya Komisi AMS', `-Rp ${feeBreakdown.ams.toLocaleString()}`, 'Biaya'],
          ['Biaya Layanan', `-Rp ${feeBreakdown.service.toLocaleString()}`, 'Biaya'],
          ['Gratis Ongkir dari Shopee', `+Rp ${feeBreakdown.shippingRebate.toLocaleString()}`, 'Pemasukan'],
          ['Jumlah Pengembalian Dana ke Pembeli', `-Rp ${feeBreakdown.refund.toLocaleString()}`, 'Biaya'],
          ['Ongkir yang Diteruskan oleh Shopee ke Jasa Kirim', `-Rp ${feeBreakdown.shippingForwarded.toLocaleString()}`, 'Biaya'],
          ['Ongkos Kirim Pengembalian Barang', `-Rp ${feeBreakdown.returnShipping.toLocaleString()}`, 'Biaya'],
          ['Premi', `-Rp ${feeBreakdown.premium.toLocaleString()}`, 'Biaya'],
          ['Voucher disponsor oleh Penjual', `-Rp ${feeBreakdown.voucher.toLocaleString()}`, 'Biaya'],
          ['Total Fee', `${totalFee < 0 ? '-' : ''}Rp ${Math.abs(totalFee).toLocaleString()}`, 'Total Keseluruhan Fee'],
        ],
        theme: 'striped',
        headStyles: { fillColor: [239, 68, 68] },
      });

      // 4. Detail Transaksi
      const renderTransactionTable = (title: string, orders: Order[]) => {
        if (orders.length === 0) return;
        doc.addPage();
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.text(title, 14, 22);
        doc.setFontSize(10);
        doc.text(`Total ${orders.length} transaksi`, 14, 28);

        const tableData = orders.map(o => {
          const firstItem = o.order_items && o.order_items.length > 0 ? o.order_items[0] : null;
          const isReturned = (o.status || '').toLowerCase().includes('pengembalian') || (o.status || '').toLowerCase().includes('retur');
          const hpp = isReturned ? 0 : (o.order_items?.reduce((h, item) => h + ((item.hpp_at_time || 0) * item.quantity), 0) || 0);
          const profit = o.status?.toLowerCase().includes('batal') ? 0 : ((o.net_revenue || 0) - hpp);
          return [
            o.order_id,
            formatDate(o.order_date),
            firstItem ? firstItem.product_name.substring(0, 30) + '...' : '-',
            o.order_items ? o.order_items.reduce((s, i) => s + i.quantity, 0) : 0,
            o.status,
            `Rp ${(o.product_total || 0).toLocaleString()}`,
            `-Rp ${Math.abs(o.service_fee || 0).toLocaleString()}`,
            `Rp ${hpp.toLocaleString()}`,
            `Rp ${profit.toLocaleString()}`
          ];
        });

        autoTable(doc, {
          startY: 33,
          head: [['Order ID', 'Tanggal', 'Produk', 'Qty', 'Status', 'Harga Jual', 'Total Biaya', 'HPP', 'Profit']],
          body: tableData,
          theme: 'grid',
          headStyles: { fillColor: [37, 99, 235], fontSize: 8 },
          styles: { fontSize: 7 },
        });
      };

      const selesaiOrders = filteredOrders.filter(o => (o.status || '').toLowerCase() === 'selesai');
      const potensiCairOrders = filteredOrders.filter(o => !o.status?.toLowerCase().includes('batal') && !o.status?.toLowerCase().includes('cancel') && !o.status?.toLowerCase().includes('retur') && !o.status?.toLowerCase().includes('pengembalian') && (o.status || '').toLowerCase() !== 'selesai');
      const batalReturOrders = filteredOrders.filter(o => o.status?.toLowerCase().includes('batal') || o.status?.toLowerCase().includes('cancel') || o.status?.toLowerCase().includes('retur') || o.status?.toLowerCase().includes('pengembalian'));

      renderTransactionTable("Detail Transaksi: Pesanan Sudah Selesai", selesaiOrders);
      renderTransactionTable("Detail Transaksi: Pesanan Proses & Kirim", potensiCairOrders);
      renderTransactionTable("Detail Transaksi: Pesanan Batal & Retur", batalReturOrders);

      // 5. Final Summary Page (Matching Image)
      doc.addPage();
      doc.setFontSize(24);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 41, 59); // slate-800
      doc.text("Ringkasan", 20, 30);

      const summaryYStart = 60;
      const rowHeight = 15;
      doc.setFontSize(14);
      
      // Total Transaksi
      doc.text("Total Transaksi", 30, summaryYStart);
      doc.text(totalTransaksi.toString(), 250, summaryYStart, { align: 'right' });

      // Total Omzet
      doc.text("Total Omzet", 30, summaryYStart + rowHeight);
      doc.text(`Rp ${totalOmzet.toLocaleString()}`, 250, summaryYStart + rowHeight, { align: 'right' });

      // Total Keuntungan
      doc.text("Total Keuntungan", 30, summaryYStart + (rowHeight * 2));
      doc.text(`Rp ${totalKeuntungan.toLocaleString()}`, 250, summaryYStart + (rowHeight * 2), { align: 'right' });

      // Total Penyesuaian (New)
      doc.text("Total Penyesuaian", 30, summaryYStart + (rowHeight * 3));
      doc.text(`Rp ${totalPenyesuaian.toLocaleString()}`, 250, summaryYStart + (rowHeight * 3), { align: 'right' });

      // Margin Keuntungan
      doc.text("Margin Keuntungan", 30, summaryYStart + (rowHeight * 4));
      doc.text(`${margin.toFixed(2)} %`, 250, summaryYStart + (rowHeight * 4), { align: 'right' });

      // Footer for the final page
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(148, 163, 184); // slate-400
      const footerY = 190;
      doc.text(`Digenerate pada ${exportTime}`, 20, footerY);
      doc.text("ShopeeSales - E-Commerce Analytics Platform", 277, footerY, { align: 'right' });

      const fileName = `Laporan_Proyek_${store.name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
      doc.save(fileName);

      toast.success("Laporan PDF berhasil dibuat!", { id: toastId });
    } catch (err: any) {
      console.error(err);
      toast.error("Gagal mengekspor PDF: " + err.message, { id: toastId });
    }
  };

  const generateAIInsights = async () => {
    setIsGeneratingInsights(true);
    const summary = filteredOrders.slice(0, 50).map(o => ({ date: o.order_date, revenue: o.net_revenue, status: o.status }));
    const text = await getSalesInsights(summary);
    setInsights(text || "No insights found.");
    setIsGeneratingInsights(false);
  };

  // Tampilkan loading HANYA saat pertama kali buka toko/aplikasi
  if (loading && filteredOrders.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500 relative">
      
      <div>
        {/* Controls Header */}
        <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4">
          <div className="w-full xl:w-auto flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <DateRangePicker onChange={setDateRange} />
            <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
              <button
                onClick={() => setDateFilterType('order_date')}
                className={`px-4 py-2 text-xs font-bold rounded-lg transition-all ${dateFilterType === 'order_date' ? 'bg-white dark:bg-slate-700 text-orange-600 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
              >
                Filter Performa Sales
              </button>
              <button
                onClick={() => setDateFilterType('release_date')}
                className={`px-4 py-2 text-xs font-bold rounded-lg transition-all ${dateFilterType === 'release_date' ? 'bg-white dark:bg-slate-700 text-orange-600 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
              >
                Filter Arus Kas
              </button>
            </div>
          </div>
          
          <div className="flex flex-col sm:flex-row gap-2 w-full xl:w-auto justify-end">
            <button 
              onClick={generateAIInsights}
              disabled={isGeneratingInsights}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition-colors disabled:opacity-50 shadow-lg shadow-purple-500/20 text-xs font-black uppercase w-full sm:w-auto"
            >
              <BrainCircuit className="w-4 h-4" />
              {isGeneratingInsights ? 'Analisis...' : 'AI Insights'}
            </button>
            <button 
              onClick={handleExportXLSX}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-xs font-black uppercase shadow-sm group w-full sm:w-auto"
            >
              <FileSpreadsheet className="w-4 h-4 text-green-600 group-hover:scale-110 transition-transform" />
              Excel
            </button>
            <button 
              onClick={handleExportPDF}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-xs font-black uppercase shadow-sm group w-full sm:w-auto"
            >
              <FileSpreadsheet className="w-4 h-4 text-red-600 group-hover:scale-110 transition-transform" />
              PDF
            </button>
          </div>
        </div>

        {insights && (
          <div className="bg-gradient-to-r from-purple-600 to-indigo-600 p-1 rounded-3xl shadow-xl animate-in slide-in-from-top-4 mt-6">
            <div className="bg-white dark:bg-slate-900 rounded-[1.4rem] p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2 text-purple-600 font-black uppercase text-xs tracking-widest">
                  <BrainCircuit className="w-5 h-5" />
                  Saran Intelijen Bisnis
                </div>
                <button onClick={() => setInsights(null)} className="text-slate-400 hover:text-slate-600"><XCircle className="w-5 h-5" /></button>
              </div>
              <div className="text-slate-700 dark:text-slate-300 text-sm whitespace-pre-line leading-relaxed font-medium">
                {insights}
              </div>
            </div>
          </div>
        )}

        <div className={`grid grid-cols-2 md:grid-cols-2 ${dateFilterType === 'order_date' ? 'lg:grid-cols-4' : 'lg:grid-cols-3'} gap-3 md:gap-4 mt-6`}>
          {/* Row 1 */}
          {dateFilterType === 'order_date' ? (
            <>
              <KPICard 
                title="Omset Pesanan (GMV)" 
                value={`Rp ${(metrics.totalOmzetPesanan || 0).toLocaleString()}`} 
                trend="Gross Revenue"
                icon={<ShoppingBag className="w-4 h-4 text-orange-600" />}
                description="Total nilai pesanan dibuat pelanggan (sebelum potongan biaya)."
                isHighlight
              />
              <KPICard 
                title="Volume & Aktivitas" 
                value={`${metrics.totalOrders} / Rp ${(metrics.averageOrderValue || 0).toLocaleString()}`} 
                trend="Trx / AOV"
                icon={<PackageSearch className="w-4 h-4 text-blue-600" />}
                description="Jumlah transaksi dan rata-rata nilai belanja per pelanggan."
              />
              <KPICard 
                title="Product Performance" 
                value={`${(metrics.topSkuContribution || 0).toFixed(1)}%`} 
                trend="Top SKU Dominance"
                icon={<CheckCircle2 className="w-4 h-4 text-blue-600" />}
                description="Persentase dominasi produk paling laku di toko Anda."
              />
              <KPICard 
                title="Operasional Risk" 
                value={`${metrics.operationalRiskCount}`} 
                trend="Batal / Retur"
                icon={<AlertCircle className="w-4 h-4 text-red-600" />}
                description="Jumlah pesanan yang gagal diproses atau dikembalikan pelanggan."
                isNegative
              />
            </>
          ) : (
            <>
              <KPICard 
                title="Dana Cair Bersih (Settled)" 
                value={`Rp ${(metrics.netRevenueSelesai || 0).toLocaleString()}`} 
                trend="Cash In"
                icon={<Wallet className="w-4 h-4 text-green-600" />}
                description="Uang asli yang sudah dilepaskan Shopee ke Saldo Penjual."
                isHighlight
              />
              <KPICard 
                title="Total HPP (Modal)" 
                value={`-Rp ${(metrics.totalHPPSelesai || 0).toLocaleString()}`} 
                trend="COGS"
                isNegative
                icon={<PackageSearch className="w-4 h-4 text-orange-600" />}
                description="Total modal pokok produk untuk pesanan yang dananya sudah cair."
              />
              <KPICard 
                title="Profit Riil Akhir" 
                value={`Rp ${(metrics.keuntunganSetelahPenyesuaian || 0).toLocaleString()}`} 
                trend="Net Profit"
                icon={<Wallet className="w-4 h-4 text-yellow-600" />}
                description="Keuntungan bersih nyata setelah dikurangi modal barang dan biaya operasional."
                isHighlight
              />
              <KPICard 
                title="Potongan Shopee" 
                value={`-Rp ${(metrics.totalPotongan || 0).toLocaleString()}`} 
                trend="Marketplace Fees"
                isNegative
                icon={<Percent className="w-4 h-4 text-red-600" />}
                description="Total biaya yang dipotong platform (termasuk program Gratis Ongkir/Cashback Xtra)."
              />
              <KPICard 
                title="Kebocoran Ongkir" 
                value={`-Rp ${(metrics.shippingLeakage || 0).toLocaleString()}`} 
                trend="Shipping Leakage"
                isNegative
                icon={<AlertCircle className="w-4 h-4 text-red-600" />}
                description="Kerugian akibat selisih timbangan atau dimensi produk (Nomok Ongkir)."
              />
              <KPICard 
                title="Dana Tertahan" 
                value={`Rp ${(metrics.pendingEscrow || 0).toLocaleString()}`} 
                trend="Pending Escrow"
                icon={<Wallet className="w-4 h-4 text-slate-500" />}
                description="Proyeksi uang yang akan cair dalam beberapa hari ke depan."
              />
            </>
          )}
        </div>

        {/* Fee Breakdown Dashboard Section */}
        <div className="mt-8 bg-white dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-50 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/30">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-100 dark:bg-red-900/20 rounded-xl">
                <Percent className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="text-sm font-black uppercase tracking-tight text-slate-900 dark:text-white">Breakdown Biaya Platform</h3>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Detail Potongan Marketplace (Shopee)</p>
              </div>
            </div>
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-500 font-medium">Biaya Administrasi</span>
                <span className="text-xs font-bold text-red-600">-Rp {metrics.feeBreakdown.admin.toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-500 font-medium">Biaya Komisi AMS</span>
                <span className="text-xs font-bold text-red-600">-Rp {metrics.feeBreakdown.ams.toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-500 font-medium">Biaya Layanan</span>
                <span className="text-xs font-bold text-red-600">-Rp {metrics.feeBreakdown.service.toLocaleString()}</span>
              </div>
            </div>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-500 font-medium">Gratis Ongkir (Subsidi)</span>
                <span className="text-xs font-bold text-green-600">+Rp {metrics.feeBreakdown.shippingRebate.toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-500 font-medium">Pengembalian Dana</span>
                <span className="text-xs font-bold text-red-600">-Rp {metrics.feeBreakdown.refund.toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-500 font-medium">Ongkir Diteruskan</span>
                <span className="text-xs font-bold text-red-600">-Rp {metrics.feeBreakdown.shippingForwarded.toLocaleString()}</span>
              </div>
            </div>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-500 font-medium">Ongkir Pengembalian</span>
                <span className="text-xs font-bold text-red-600">-Rp {metrics.feeBreakdown.returnShipping.toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-500 font-medium">Premi</span>
                <span className="text-xs font-bold text-red-600">-Rp {metrics.feeBreakdown.premium.toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-500 font-medium">Voucher Penjual</span>
                <span className="text-xs font-bold text-red-600">-Rp {metrics.feeBreakdown.voucher.toLocaleString()}</span>
              </div>
            </div>
            <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl flex flex-col justify-center">
              <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">Total Potongan</span>
              <span className="text-xl font-black text-red-600">
                -Rp {metrics.totalPotongan.toLocaleString()}
              </span>
              <div className="mt-2 h-1 w-full bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-red-500" 
                  style={{ width: `${Math.min(100, (metrics.totalPotongan / (metrics.totalOmzet || 1)) * 100)}%` }}
                />
              </div>
              <span className="text-[10px] text-slate-400 mt-1 font-bold">
                {((metrics.totalPotongan / (metrics.totalOmzet || 1)) * 100).toFixed(1)}% dari Omzet
              </span>
            </div>
          </div>
        </div>

        <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-900/30 rounded-2xl flex items-start gap-3 mt-6">
          <Info className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
          <div className="text-xs text-blue-800 dark:text-blue-300 font-medium leading-relaxed">
            <p className="font-bold mb-1 uppercase tracking-tight">Metodologi Perhitungan (Basis Kas/Cair)</p>
            <ul className="list-disc pl-4 space-y-1">
                <li><b>Total Omzet:</b> Total harga produk dari pesanan berstatus "Selesai".</li>
                <li><b>Uang Cair:</b> Total penghasilan bersih dari marketplace (setelah admin/layanan/ongkir).</li>
                <li><b>Laba Kotor:</b> Uang Cair dikurangi HPP produk terjual.</li>
                <li><b>Laba Bersih:</b> Laba Kotor ditambah Total Penyesuaian (Retur/Refund).</li>
            </ul>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
          <RevenueChart orders={filteredOrders.filter(o => !o.status?.toLowerCase().includes('batal'))} />
          <ProductChart 
            storeId={store.id} 
            allStoreIds={store.id === 'all' ? allStores?.map(s => s.id) : undefined} 
          />
        </div>

        <div className="mt-6">
          <OrdersTable 
            orders={filteredOrders} 
            stores={store.id === 'all' ? allStores : undefined} 
          />
        </div>
      </div>
    </div>
  );
};
