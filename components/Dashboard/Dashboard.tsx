
import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { supabase } from '../../services/supabase';
import { Store, Order } from '../../types';
import { KPICard } from './KPICard';
import { PerformanceTrendChart } from './PerformanceTrendChart';
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

interface DashboardFilters {
  mode: 'order_date' | 'release_date';
  start: string;
  end: string;
}

export const Dashboard: React.FC<DashboardProps> = ({ store, allStores }) => {
  // 1. Single Source of Truth for Filters
  const [filters, setFilters] = useState<DashboardFilters>(() => {
    // Initialize from URL if available, otherwise defaults
    const params = new URLSearchParams(window.location.search);
    const now = new Date();
    const defaultEnd = format(now, 'yyyy-MM-dd');
    const defaultStart = format(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd');

    return {
      mode: (params.get('mode') as any) || 'order_date',
      start: params.get('start') || defaultStart,
      end: params.get('end') || defaultEnd
    };
  });

  // Sync filters to URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set('mode', filters.mode);
    params.set('start', filters.start);
    params.set('end', filters.end);
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState({}, '', newUrl);
  }, [filters.mode, filters.start, filters.end]);

  // Display Data
  const [filteredOrders, setFilteredOrders] = useState<Order[]>([]);
  const [adjustments, setAdjustments] = useState<any[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [insights, setInsights] = useState<string | null>(null);
  const [isGeneratingInsights, setIsGeneratingInsights] = useState(false);
  
  const abortControllerRef = useRef<AbortController | null>(null);

  // 3. Refactor useEffect Fetching with specific dependencies
  useEffect(() => {
    fetchData(filters.mode, filters.start, filters.end, store.id);
    return () => {
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, [filters.mode, filters.start, filters.end, store.id]);

  const fetchData = async (mode: string, start: string, end: string, storeId: string) => {
    // 4. Race Condition Guard with AbortController
    if (abortControllerRef.current) abortControllerRef.current.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);

    try {
      // Helper function to fetch all data using pagination
      const fetchAll = async (baseQuery: any) => {
        let allData: any[] = [];
        let from = 0;
        const pageSize = 1000;
        let finished = false;

        while (!finished) {
          if (controller.signal.aborted) throw new Error('AbortError');
          
          const { data, error } = await baseQuery.range(from, from + pageSize - 1);
          if (error) throw error;
          if (data && data.length > 0) {
            allData = [...allData, ...data];
            if (data.length < pageSize) finished = true;
            else from += pageSize;
          } else {
            finished = true;
          }
        }
        return allData;
      };

      let query = supabase
        .from('orders')
        .select('*, order_items(*)')
        .order(mode, { ascending: false });

      let adjQuery = supabase
        .from('adjustments')
        .select('*')
        .order('adjustment_date', { ascending: false });

      const isMultiple = (store as any).is_multiple;
      const targetStoreIds = isMultiple ? (store as any).selected_ids : [storeId];

      if (storeId === 'all') {
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
      } else if (isMultiple) {
        query = query.in('store_id', targetStoreIds);
        adjQuery = adjQuery.in('store_id', targetStoreIds);
      } else {
        query = query.eq('store_id', storeId);
        adjQuery = adjQuery.eq('store_id', storeId);
      }

      // Server-side date filtering (Option B: WIB Standard with +07 offset)
      if (start) {
        query = query.gte(mode, `${start} 00:00:00+07`);
        adjQuery = adjQuery.gte('adjustment_date', start);
      }
      if (end) {
        // Inclusive Start - Exclusive End (Standard Perbaikan)
        // We add 1 day to the end date and use 'lt' (less than)
        const [y, m, d] = end.split('-').map(Number);
        const nextDayDate = new Date(y, m - 1, d + 1);
        const ny = nextDayDate.getFullYear();
        const nm = String(nextDayDate.getMonth() + 1).padStart(2, '0');
        const nd = String(nextDayDate.getDate()).padStart(2, '0');
        const nextDay = `${ny}-${nm}-${nd}`;
        
        query = query.lt(mode, `${nextDay} 00:00:00+07`);
        adjQuery = adjQuery.lte('adjustment_date', end);
      }

      let incomeQuery = supabase
        .from('income_reports')
        .select('*');

      if (storeId === 'all') {
        if (allStores && allStores.length > 0) {
           const storeIds = allStores.map(s => s.id);
           incomeQuery = incomeQuery.in('store_id', storeIds);
        }
      } else if (isMultiple) {
        incomeQuery = incomeQuery.in('store_id', targetStoreIds);
      } else {
        incomeQuery = incomeQuery.eq('store_id', storeId);
      }

      if (start) {
        incomeQuery = incomeQuery.gte(mode, start);
      }
      if (end) {
        incomeQuery = incomeQuery.lte(mode, end);
      }

    const [ordersData, adjData, incomeData] = await Promise.all([
        fetchAll(query),
        fetchAll(adjQuery),
        fetchAll(incomeQuery).catch(err => {
            if (err.message?.includes('relation "income_reports" does not exist')) {
                // Return empty array if relation not found, will prompt sql guide
                return [];
            }
            throw err;
        })
      ]);
      
      if (controller.signal.aborted) return;

      const orderMap = new Map();
      (ordersData || []).forEach((o: any) => orderMap.set(o.order_id, o));

      const missingOrderIds: string[] = [];
      (incomeData || []).forEach((inc: any) => {
         if (!orderMap.has(inc.order_id)) {
             missingOrderIds.push(inc.order_id);
         }
      });

      let additionalOrdersData: any[] = [];
      if (missingOrderIds.length > 0) {
          for (let i = 0; i < missingOrderIds.length; i += 500) {
             const chunk = missingOrderIds.slice(i, i + 500);
             let chunkQuery = supabase.from('orders').select('*, order_items(*)').in('order_id', chunk);
             if (storeId === 'all') {
                 // No extra filter
             } else if (isMultiple) {
                 chunkQuery = chunkQuery.in('store_id', targetStoreIds);
             } else {
                 chunkQuery = chunkQuery.eq('store_id', storeId);
             }
             const { data } = await chunkQuery;
             if (data && data.length > 0) {
                 additionalOrdersData = [...additionalOrdersData, ...data];
             }
          }
      }

      const combinedOrders = [...(ordersData || []), ...additionalOrdersData];

      const mergedOrders = [...combinedOrders];
      const combinedOrderMap = new Map();
      mergedOrders.forEach((o, index) => combinedOrderMap.set(o.order_id, index));

      (incomeData || []).forEach(inc => {
        if (combinedOrderMap.has(inc.order_id)) {
           const idx = combinedOrderMap.get(inc.order_id);
           mergedOrders[idx] = { ...mergedOrders[idx], ...inc, is_from_income: true };
        } else {
           mergedOrders.push({ ...inc, is_from_income: true });
        }
      });

      // 5. Jangan Ada Auto Fallback ke Periode Default
      setFilteredOrders(mergedOrders);
      setAdjustments(adjData || []);
    } catch (err: any) {
      if (err.name !== 'AbortError' && err.message !== 'AbortError') {
        if (err.message?.toLowerCase().includes('refresh token') || err.message?.includes('refresh_token_not_found') || err.message?.toLowerCase().includes('invalid refresh token')) {
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

    // 3. Pesanan Selesai
    const completedCount = data.filter(o => (o.status || '').toLowerCase() === 'selesai').length;

    // 4. METRICS CALCULATION (SETTLED DATA FOCUS)
    // 1. Filter: Hanya Order yang SUDAH SELESAI (Omzet Riil)
    const completedOrdersOnly = data.filter(o => (o.status || '').trim().toLowerCase() === 'selesai');
    
    // Filter: Transaksi Retur untuk Penyesuaian & Count
    const returnedOrders = data.filter(o => {
      const s = (o.status || '').trim().toLowerCase();
      return s.includes('retur') || s.includes('pengembalian');
    });

    // A. Omzet Riil (GMV Selesai)
    const omzetRiil = completedOrdersOnly.reduce((acc, o) => acc + Number(o.product_total || 0), 0);

    // H. Kebocoran Ongkir (Shipping Leakage) & Settled Orders for Cash Flow
    const settledOrders = data.filter(o => {
        const s = (o.status || '').trim().toLowerCase();
        return s === 'selesai' || s === 'pengembalian';
    });

    // G. Total Penyesuaian & Biaya Iklan
    let biayaIklan = 0;
    let penyesuaianLain = 0;
    let adjustmentPlus = 0;
    let adjustmentMinus = 0;
    let totalWithdrawals = 0;
    const adjustmentDetails: any[] = [];

    adjustments.forEach(a => {
      const reason = (a.reason || '').toLowerCase();
      const amount = Number(a.amount) || 0;
      
      const isAds = reason.includes('type: ads') || 
                    reason.includes('category: isi ulang saldo iklan') ||
                    reason.includes('iklan') || 
                    reason.includes('ads') || 
                    reason.includes('koin penjual');
      
      const isWithdrawal = reason.includes('type: withdrawal') || reason.includes('penarikan dana');
      const isAdjustment = reason.includes('type: adjustment') ||
                           reason.includes('penyesuaian') ||
                           reason.includes('adjustment') ||
                           reason.includes('kompensasi') ||
                           reason.includes('reimbursement') ||
                           reason.includes('ganti rugi') ||
                           reason.includes('klaim') ||
                           reason.includes('claim') ||
                           reason.includes('selisih') ||
                           reason.includes('perbedaan') ||
                           reason.includes('perbaikan') ||
                           reason.includes('pengembalian biaya');

      const isIncome = !isAdjustment && (reason.includes('type: income') || reason.includes('penghasilan dari pesanan'));

      if (isAds) {
        biayaIklan += Math.abs(amount);
      }
      
      if (isWithdrawal) {
        totalWithdrawals += Math.abs(amount);
      } else if (!isAds && !isIncome && !reason.includes('[balance_snapshot]')) {
        // Only include true adjustments (corrections, compensations, etc)
        if (amount > 0) adjustmentPlus += amount;
        if (amount < 0) adjustmentMinus += amount;
        
        const descMatch = a.reason.match(/Desc: (.*)/);
        const description = descMatch ? descMatch[1].split('|')[0].trim() : a.reason.replace('[AUTO_UPLOAD]', '').replace('[MANUAL_EXPENSE]', '').trim();

        adjustmentDetails.push({
          id: a.id,
          date: a.adjustment_date,
          description,
          amount
        });
        penyesuaianLain += amount;
      }
    });

    completedOrdersOnly.forEach(o => {
      if (o.fee_details) {
        if (o.fee_details.auto_topup_fee) biayaIklan += Math.abs(o.fee_details.auto_topup_fee);
        if (o.fee_details.seller_coin_cashback) biayaIklan += Math.abs(o.fee_details.seller_coin_cashback);
        if (o.fee_details.seller_cofund_coin_cashback) biayaIklan += Math.abs(o.fee_details.seller_cofund_coin_cashback);
      }
    });

    // C. Dana Cair (Total Net Revenue dari Pesanan Selesai/Pengembalian)
    const totalNetRevenue = settledOrders.reduce((acc, o) => acc + Number(o.net_revenue || 0), 0);
    const danaCair = totalNetRevenue;

    // J. Fee Breakdown (Selesai + Pengembalian for comprehensive cash flow view)
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
      processing: 0,
      transaction: 0,
      shopeeProductDiscount: 0,
      sellerCofundVoucher: 0,
      sellerCoinCashback: 0,
      sellerCofundCoinCashback: 0,
      shippingPaidByBuyer: 0,
      shippingDiscountByCourier: 0,
      shippingRefund: 0,
      returnToSenderShippingFee: 0,
      saveShippingProgramFee: 0,
      campaignFee: 0,
      autoTopupFee: 0
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
        feeBreakdown.transaction += (o.fee_details.transaction_fee || 0);
        feeBreakdown.shopeeProductDiscount += (o.fee_details.shopee_product_discount || 0);
        feeBreakdown.sellerCofundVoucher += (o.fee_details.seller_cofund_voucher || 0);
        feeBreakdown.sellerCoinCashback += (o.fee_details.seller_coin_cashback || 0);
        feeBreakdown.sellerCofundCoinCashback += (o.fee_details.seller_cofund_coin_cashback || 0);
        feeBreakdown.shippingPaidByBuyer += (o.fee_details.shipping_paid_by_buyer || 0);
        feeBreakdown.shippingDiscountByCourier += (o.fee_details.shipping_discount_by_courier || 0);
        feeBreakdown.shippingRefund += (o.fee_details.shipping_refund || 0);
        feeBreakdown.returnToSenderShippingFee += (o.fee_details.return_to_sender_shipping_fee || 0);
        feeBreakdown.saveShippingProgramFee += (o.fee_details.save_shipping_program_fee || 0);
        feeBreakdown.campaignFee += (o.fee_details.campaign_fee || 0);
        feeBreakdown.autoTopupFee += (o.fee_details.auto_topup_fee || 0);
      }
    });

    // B. Potongan Marketplace (Selesai + Retur) - Calculated from fee breakdown to match UI
    const potonganMarketplace = (
      feeBreakdown.admin + 
      feeBreakdown.ams + 
      feeBreakdown.service + 
      feeBreakdown.refund + 
      feeBreakdown.shippingForwarded + 
      feeBreakdown.returnShipping + 
      feeBreakdown.premium + 
      feeBreakdown.voucher + 
      feeBreakdown.processing + 
      feeBreakdown.transaction +
      feeBreakdown.sellerCofundVoucher +
      feeBreakdown.sellerCoinCashback +
      feeBreakdown.sellerCofundCoinCashback +
      feeBreakdown.shippingRefund +
      feeBreakdown.returnToSenderShippingFee +
      feeBreakdown.saveShippingProgramFee +
      feeBreakdown.campaignFee +
      feeBreakdown.autoTopupFee
    ) - feeBreakdown.shippingRebate - feeBreakdown.shippingPaidByBuyer - feeBreakdown.shippingDiscountByCourier - feeBreakdown.shopeeProductDiscount;

    // D. Total HPP (Hanya untuk order yang SELESAI)
    const hppSelesai = completedOrdersOnly.reduce((acc, o) => {
      const orderHpp = o.order_items?.reduce((h, item) => {
        return h + ((item.hpp_at_time || 0) * item.quantity);
      }, 0) || 0;
      return acc + orderHpp;
    }, 0);

    // E. Profit Riil = Dana Cair - HPP + Penyesuaian
    const profitRiil = danaCair - hppSelesai + penyesuaianLain;

    // F. Supporting Metrics
    const percentNetProfit = omzetRiil > 0 ? (profitRiil / omzetRiil) * 100 : 0;
    const percentPotonganOmzet = omzetRiil > 0 ? (potonganMarketplace / omzetRiil) * 100 : 0;

    // H. Kebocoran Ongkir (Shipping Leakage)
    // Rumus: (Ongkir Dibayar Pembeli + Gratis Ongkir dari Shopee) - (Ongkir Diteruskan ke Jasa Kirim + Ongkos Kirim Pengembalian Barang)
    const shippingLeakage = (feeBreakdown.shippingPaidByBuyer + feeBreakdown.shippingRebate) - (feeBreakdown.shippingForwarded + feeBreakdown.returnShipping);

    // Performance Mode Metrics (Keep existing)
    const totalOmzetPesanan = data.reduce((acc, o) => acc + (o.product_total || 0), 0);
    const totalOmzetBersih = data.reduce((acc, o) => {
      const status = (o.status || '').toLowerCase();
      if (status.includes('batal') || status.includes('cancel') || status.includes('retur') || status.includes('pengembalian')) {
        return acc;
      }
      return acc + (o.product_total || 0);
    }, 0);
    const averageOrderValue = totalOrdersCount > 0 ? totalOmzetPesanan / totalOrdersCount : 0;
    const roasAktual = Math.abs(biayaIklan) > 0 ? totalOmzetBersih / Math.abs(biayaIklan) : 0;
    const acosAktual = totalOmzetBersih > 0 ? (Math.abs(biayaIklan) / totalOmzetBersih) * 100 : 0;

    return { 
      totalOrders: totalOrdersCount,
      returnedCount: returnedOrders.length,
      completedCount: completedOrdersOnly.length,
      omzetRiil,
      potonganMarketplace,
      danaCair,
      hppSelesai,
      profitRiil,
      percentNetProfit,
      percentPotonganOmzet,
      shippingLeakage,
      biayaIklan,
      roasAktual,
      acosAktual,
      totalOmzetPesanan,
      totalOmzetBersih,
      averageOrderValue,
      cancelledCount,
      feeBreakdown,
      adjustmentPlus,
      adjustmentMinus,
      adjustmentDetails
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

      let startDateStr = filters.start;
      let endDateStr = filters.end;

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
        // Use metrics from useMemo to ensure consistency
        const rows = [];

        // Header Section
        rows.push([`LAPORAN TOKO ${sheetStoreName.toUpperCase()}`]);
        rows.push(["powered by OneWaymedia"]);
        rows.push([""]);
        rows.push(["Platform:", "Shopee"]);
        rows.push(["Tipe Kalkulasi:", filters.mode === 'order_date' ? "Basis Pesanan Dibuat" : "Basis Pesanan Selesai"]);
        rows.push(["Tanggal Export:", exportTime]);
        rows.push(["Periode:", displayPeriod]);
        rows.push(["Filter:", filters.mode === 'order_date' ? "Tanggal Pesanan Dibuat" : "Tanggal Dana Dilepaskan"]);
        rows.push([""]);

        // Ringkasan Analytics
        rows.push(["Ringkasan Analytics"]);
        rows.push(["Metrik", "Nilai", "Keterangan"]);

        if (filters.mode === 'order_date') {
          rows.push(["Omset Pesanan (GMV)", metrics.totalOmzetPesanan, "Total nilai seluruh pesanan masuk (termasuk Batal/Retur)"]);
          rows.push(["Omset Bersih (Net GMV)", metrics.totalOmzetBersih, "Total nilai pesanan aktif (mengecualikan Batal/Retur)"]);
          rows.push(["Biaya Iklan", metrics.biayaIklan, "Total biaya iklan (Top-up Keuangan)"]);
          rows.push(["ROAS Aktual", `${metrics.roasAktual.toFixed(2)}x`, "Return on Ad Spend"]);
          rows.push(["% ACOS", `${metrics.acosAktual.toFixed(2)}%`, "Advertising Cost of Sales"]);
          rows.push(["Total Pesanan", metrics.totalOrders, "Jumlah seluruh transaksi"]);
          rows.push(["AOV", metrics.averageOrderValue, "Rata-rata nilai per transaksi"]);
          rows.push(["Pesanan Dibatalkan", metrics.cancelledCount, "Jumlah pesanan batal"]);
        } else {
          rows.push(["Omzet Riil", metrics.omzetRiil, "Total nilai pesanan (Dibayar Pembeli) status Selesai"]);
          rows.push(["Potongan Marketplace", -metrics.potonganMarketplace, "Total komisi/biaya marketplace"]);
          rows.push(["Dana Cair", metrics.danaCair, "Total pendapatan bersih yang diterima"]);
          rows.push(["HPP", -metrics.hppSelesai, "Total modal pokok produk pesanan selesai"]);
          rows.push(["Penyesuaian Shopee", metrics.adjustmentPlus + metrics.adjustmentMinus, "Total penyesuaian saldo (Kompensasi, Klaim, Bonus, dll)"]);
          rows.push(["Profit Riil", metrics.profitRiil, "Dana Cair - HPP"]);
          rows.push(["% Net Profit", `${metrics.percentNetProfit.toFixed(1)}%`, "Profit Riil / Omzet Riil"]);
          rows.push(["% Potongan Marketplace", `${metrics.percentPotonganOmzet.toFixed(1)}%`, "Potongan / Omzet Riil"]);
          rows.push(["Selisih Ongkir", metrics.shippingLeakage, "(Ongkir Pembeli + Gratis Ongkir) - (Ongkir Diteruskan + Ongkir Retur)"]);
          rows.push(["Pesanan Selesai", metrics.completedCount, "Jumlah pesanan sudah cair"]);
          rows.push(["Pesanan Retur", metrics.returnedCount, "Jumlah pesanan retur"]);
        }

        rows.push([""]);

        if (filters.mode === 'release_date') {
          // Fee Breakdown only for Cash Flow
          rows.push(["Fee Breakdown (Shopee)"]);
          rows.push(["Jenis Fee", "Jumlah", "Tipe"]);
          
          const addRowIfNonZero = (name: string, value: number, type: string, alwaysShow: boolean = false) => {
            if (value !== 0 || alwaysShow) {
              rows.push([name, value, type]);
            }
          };

          // Voucher & Subsidi Shopee
          addRowIfNonZero("Diskon Produk dari Shopee", metrics.feeBreakdown.shopeeProductDiscount, "Pemasukan");
          addRowIfNonZero("Voucher disponsor oleh Penjual", -metrics.feeBreakdown.voucher, "Biaya");
          addRowIfNonZero("Voucher co-fund disponsor oleh Penjual", -metrics.feeBreakdown.sellerCofundVoucher, "Biaya");
          addRowIfNonZero("Cashback Koin disponsori Penjual", -metrics.feeBreakdown.sellerCoinCashback, "Biaya");
          addRowIfNonZero("Cashback Koin Co-fund disponsori Penjual", -metrics.feeBreakdown.sellerCofundCoinCashback, "Biaya");

          // Total Biaya Pengiriman
          addRowIfNonZero("Ongkir Dibayar Pembeli", metrics.feeBreakdown.shippingPaidByBuyer, "Pemasukan");
          addRowIfNonZero("Diskon Ongkir Ditanggung Jasa Kirim", metrics.feeBreakdown.shippingDiscountByCourier, "Pemasukan");
          addRowIfNonZero("Gratis Ongkir dari Shopee", metrics.feeBreakdown.shippingRebate, "Pemasukan");
          addRowIfNonZero("Ongkir yang Diteruskan oleh Shopee ke Jasa Kirim", -metrics.feeBreakdown.shippingForwarded, "Biaya");
          addRowIfNonZero("Ongkos Kirim Pengembalian Barang", -metrics.feeBreakdown.returnShipping, "Biaya", true);
          addRowIfNonZero("Pengembalian Biaya Kirim", -metrics.feeBreakdown.shippingRefund, "Biaya");
          addRowIfNonZero("Kembali ke Biaya Pengiriman Pengirim", -metrics.feeBreakdown.returnToSenderShippingFee, "Biaya");

          // Biaya Admin & Layanan
          addRowIfNonZero("Biaya Komisi AMS", -metrics.feeBreakdown.ams, "Biaya");
          addRowIfNonZero("Biaya Administrasi", -metrics.feeBreakdown.admin, "Biaya");
          addRowIfNonZero("Biaya Layanan", -metrics.feeBreakdown.service, "Biaya");
          addRowIfNonZero("Biaya Proses Pesanan", -metrics.feeBreakdown.processing, "Biaya");
          addRowIfNonZero("Premi", -metrics.feeBreakdown.premium, "Biaya");
          addRowIfNonZero("Biaya Program Hemat Biaya Kirim", -metrics.feeBreakdown.saveShippingProgramFee, "Biaya");
          addRowIfNonZero("Biaya Transaksi", -metrics.feeBreakdown.transaction, "Biaya");
          addRowIfNonZero("Biaya Kampanye", -metrics.feeBreakdown.campaignFee, "Biaya");
          addRowIfNonZero("Biaya Isi Saldo Otomatis (dari Penghasilan)", -metrics.feeBreakdown.autoTopupFee, "Biaya");

          // Pengembalian Dana
          addRowIfNonZero("Jumlah Pengembalian Dana ke Pembeli", -metrics.feeBreakdown.refund, "Biaya", true);
          
          rows.push([""]);
        }

        const ws = XLSX.utils.aoa_to_sheet(rows);
        ws['!cols'] = [{ wch: 40 }, { wch: 20 }, { wch: 50 }];
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

      const fileName = `Laporan_${store.name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`;
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
      
      let startDateStr = filters.start;
      let endDateStr = filters.end;
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
      doc.text(`Tipe Kalkulasi: ${filters.mode === 'order_date' ? "Basis Pesanan Dibuat" : "Basis Pesanan Selesai"}`, 14, 52);
      doc.text(`Tanggal Export: ${exportTime}`, 14, 59);
      doc.text(`Periode: ${displayPeriod}`, 14, 66);
      doc.text(`Filter: ${filters.mode === 'order_date' ? "Tanggal Pesanan Dibuat" : "Tanggal Dana Dilepaskan"}`, 14, 73);

      // 2. Ringkasan Analytics
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text("Ringkasan Analytics", 14, 90);

        const summaryBody = filters.mode === 'order_date' ? [
          ['Omset Pesanan (GMV)', `Rp ${metrics.totalOmzetPesanan.toLocaleString()}`, 'Total nilai pesanan dibuat pelanggan'],
          ['Omset Bersih (Net GMV)', `Rp ${metrics.totalOmzetBersih.toLocaleString()}`, 'Total nilai pesanan aktif (mengecualikan Batal/Retur)'],
          ['Biaya Iklan', `Rp ${Math.abs(metrics.biayaIklan).toLocaleString()}`, 'Total biaya iklan (Top-up Keuangan)'],
          ['ROAS Aktual', `${metrics.roasAktual.toFixed(2)}x`, 'Return on Ad Spend'],
          ['% ACOS', `${metrics.acosAktual.toFixed(2)}%`, 'Advertising Cost of Sales'],
          ['Total Pesanan', metrics.totalOrders.toString(), 'Jumlah seluruh transaksi'],
          ['AOV', `Rp ${Math.round(metrics.averageOrderValue).toLocaleString('id-ID')}`, 'Rata-rata nilai per transaksi'],
          ['Pesanan Dibatalkan', metrics.cancelledCount.toString(), 'Jumlah pesanan batal'],
        ] : [
        ['Omzet Riil', `Rp ${metrics.omzetRiil.toLocaleString()}`, 'Total nilai pesanan (Dibayar Pembeli) status Selesai'],
        ['Potongan Marketplace', `-Rp ${metrics.potonganMarketplace.toLocaleString()}`, 'Total komisi/biaya marketplace'],
        ['Dana Cair', `Rp ${metrics.danaCair.toLocaleString()}`, 'Total pendapatan bersih yang diterima'],
        ['HPP', `-Rp ${metrics.hppSelesai.toLocaleString()}`, 'Total modal pokok produk pesanan selesai'],
        ['Penyesuaian Shopee', `${metrics.adjustmentPlus + metrics.adjustmentMinus < 0 ? '-' : '+'}Rp ${Math.abs(metrics.adjustmentPlus + metrics.adjustmentMinus).toLocaleString()}`, 'Total penyesuaian saldo (Kompensasi, Klaim, Bonus, dll)'],
        ['Profit Riil', `Rp ${metrics.profitRiil.toLocaleString()}`, 'Dana Cair - HPP + Penyesuaian'],
        ['% Net Profit', `${metrics.percentNetProfit.toFixed(1)}%`, 'Profit Riil / Omzet Riil'],
        ['% Potongan Marketplace', `${metrics.percentPotonganOmzet.toFixed(1)}%`, 'Potongan / Omzet Riil'],
        ['Selisih Ongkir', `-Rp ${metrics.shippingLeakage.toLocaleString()}`, 'Selisih ongkir pembeli vs aktual'],
        ['Pesanan Selesai', metrics.completedCount.toString(), 'Jumlah pesanan sudah cair'],
        ['Pesanan Retur', metrics.returnedCount.toString(), 'Jumlah pesanan retur'],
      ];

      autoTable(doc, {
        startY: 95,
        head: [['Metrik', 'Nilai', 'Keterangan']],
        body: summaryBody,
        theme: 'striped',
        headStyles: { fillColor: [37, 99, 235] },
      });

      // 3. Fee Breakdown (Only for Cash Flow)
      if (filters.mode === 'release_date') {
        doc.addPage();
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.text("Fee Breakdown (Shopee)", 14, 22);

        autoTable(doc, {
          startY: 27,
          head: [['Jenis Fee', 'Jumlah', 'Tipe']],
          body: [
            ['Biaya Administrasi', `-Rp ${metrics.feeBreakdown.admin.toLocaleString()}`, 'Biaya'],
            ['Biaya Komisi AMS', `-Rp ${metrics.feeBreakdown.ams.toLocaleString()}`, 'Biaya'],
            ['Biaya Layanan', `-Rp ${metrics.feeBreakdown.service.toLocaleString()}`, 'Biaya'],
            ['Biaya Proses Pesanan', `-Rp ${metrics.feeBreakdown.processing.toLocaleString()}`, 'Biaya'],
            ['Biaya Transaksi', `-Rp ${metrics.feeBreakdown.transaction.toLocaleString()}`, 'Biaya'],
            ['Gratis Ongkir dari Shopee', `+Rp ${metrics.feeBreakdown.shippingRebate.toLocaleString()}`, 'Pemasukan'],
            ['Jumlah Pengembalian Dana ke Pembeli', `-Rp ${metrics.feeBreakdown.refund.toLocaleString()}`, 'Biaya'],
            ['Ongkir yang Diteruskan oleh Shopee ke Jasa Kirim', `-Rp ${metrics.feeBreakdown.shippingForwarded.toLocaleString()}`, 'Biaya'],
            ['Ongkos Kirim Pengembalian Barang', `-Rp ${metrics.feeBreakdown.returnShipping.toLocaleString()}`, 'Biaya'],
            ['Premi', `-Rp ${metrics.feeBreakdown.premium.toLocaleString()}`, 'Biaya'],
            ['Voucher disponsor oleh Penjual', `-Rp ${metrics.feeBreakdown.voucher.toLocaleString()}`, 'Biaya'],
          ],
          theme: 'striped',
          headStyles: { fillColor: [239, 68, 68] },
        });
      }

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
      
      if (filters.mode === 'order_date') {
        // Performance Mode Summary
        doc.text("Total Pesanan", 30, summaryYStart);
        doc.text(metrics.totalOrders.toString(), 250, summaryYStart, { align: 'right' });

        doc.text("Omset Pesanan (GMV)", 30, summaryYStart + rowHeight);
        doc.text(`Rp ${metrics.totalOmzetPesanan.toLocaleString()}`, 250, summaryYStart + rowHeight, { align: 'right' });

        doc.text("Omset Bersih (Net GMV)", 30, summaryYStart + (rowHeight * 2));
        doc.text(`Rp ${metrics.totalOmzetBersih.toLocaleString()}`, 250, summaryYStart + (rowHeight * 2), { align: 'right' });

        doc.text("Biaya Iklan", 30, summaryYStart + (rowHeight * 3));
        doc.text(`Rp ${Math.abs(metrics.biayaIklan).toLocaleString()}`, 250, summaryYStart + (rowHeight * 3), { align: 'right' });

        doc.text("ROAS Aktual", 30, summaryYStart + (rowHeight * 4));
        doc.text(`${metrics.roasAktual.toFixed(2)} x`, 250, summaryYStart + (rowHeight * 4), { align: 'right' });

        doc.text("% ACOS", 30, summaryYStart + (rowHeight * 5));
        doc.text(`${metrics.acosAktual.toFixed(2)} %`, 250, summaryYStart + (rowHeight * 5), { align: 'right' });
      } else {
        // Cash Flow Mode Summary
        doc.text("Omzet Riil", 30, summaryYStart);
        doc.text(`Rp ${metrics.omzetRiil.toLocaleString()}`, 250, summaryYStart, { align: 'right' });

        doc.text("Potongan Marketplace", 30, summaryYStart + rowHeight);
        doc.text(`-Rp ${metrics.potonganMarketplace.toLocaleString()}`, 250, summaryYStart + rowHeight, { align: 'right' });

        doc.text("Dana Cair", 30, summaryYStart + (rowHeight * 2));
        doc.text(`Rp ${metrics.danaCair.toLocaleString()}`, 250, summaryYStart + (rowHeight * 2), { align: 'right' });

        doc.text("HPP", 30, summaryYStart + (rowHeight * 3));
        doc.text(`-Rp ${metrics.hppSelesai.toLocaleString()}`, 250, summaryYStart + (rowHeight * 3), { align: 'right' });

        doc.text("Penyesuaian", 30, summaryYStart + (rowHeight * 4));
        doc.text(`${metrics.adjustmentPlus + metrics.adjustmentMinus < 0 ? '-' : '+'}Rp ${Math.abs(metrics.adjustmentPlus + metrics.adjustmentMinus).toLocaleString()}`, 250, summaryYStart + (rowHeight * 4), { align: 'right' });

        doc.text("Profit Riil", 30, summaryYStart + (rowHeight * 5));
        doc.text(`Rp ${metrics.profitRiil.toLocaleString()}`, 250, summaryYStart + (rowHeight * 5), { align: 'right' });
      }

      // Footer for the final page
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(148, 163, 184); // slate-400
      const footerY = 190;
      doc.text(`Digenerate pada ${exportTime}`, 20, footerY);
      doc.text("ShopeeSales - E-Commerce Analytics Platform", 277, footerY, { align: 'right' });

      // 6. Add Page Numbers
      const pageCount = doc.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(150);
        doc.text(`Halaman ${i} dari ${pageCount}`, doc.internal.pageSize.getWidth() / 2, doc.internal.pageSize.getHeight() - 10, { align: 'center' });
      }

      const fileName = `Laporan_${store.name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
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
        <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between gap-6">
          <div className="w-full xl:flex-1 flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-4">
            <div className="flex-1 min-w-[280px] sm:min-w-[340px]">
              <DateRangePicker 
                start={filters.start}
                end={filters.end}
                onChange={(range) => setFilters(prev => ({ ...prev, ...range }))} 
              />
            </div>
            <div className="flex bg-slate-100/80 dark:bg-slate-800/80 p-1.5 rounded-2xl shrink-0 backdrop-blur-sm border border-slate-200/50 dark:border-slate-700/50 w-full sm:w-auto overflow-x-auto">
              <button
                onClick={() => setFilters(prev => ({ ...prev, mode: 'order_date' }))}
                className={`flex-1 sm:flex-none px-5 py-2.5 text-[10px] font-black uppercase tracking-wider rounded-xl transition-all shadow-none whitespace-nowrap ${filters.mode === 'order_date' ? 'bg-white dark:bg-slate-700 text-orange-600 shadow-md ring-1 ring-slate-900/5' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
              >
                Basis Pesanan Dibuat
              </button>
              <button
                onClick={() => setFilters(prev => ({ ...prev, mode: 'release_date' }))}
                className={`flex-1 sm:flex-none px-5 py-2.5 text-[10px] font-black uppercase tracking-wider rounded-xl transition-all shadow-none whitespace-nowrap ${filters.mode === 'release_date' ? 'bg-white dark:bg-slate-700 text-orange-600 shadow-md ring-1 ring-slate-900/5' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
              >
                Basis Pesanan Selesai
              </button>
            </div>
          </div>
          
          <div className="flex flex-wrap items-center gap-3 w-full xl:w-auto shrink-0 justify-start xl:justify-end">
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

        {filters.mode === 'order_date' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-6 mt-10">
            <KPICard 
              title="Omset Pesanan (GMV)" 
              value={`Rp ${(metrics.totalOmzetPesanan || 0).toLocaleString()}`} 
              trend="Gross Revenue"
              icon={<ShoppingBag className="w-4 h-4 text-orange-600" />}
              description="Sama dengan 'Penjualan' di Shopee Bisnis Saya (termasuk pesanan yang dibatalkan setelah masuk status siap dikirim)."
              isHighlight
            />
            <KPICard 
              title="Omset Bersih (Net GMV)" 
              value={`Rp ${(metrics.totalOmzetBersih || 0).toLocaleString()}`} 
              trend="Net Revenue"
              icon={<CheckCircle2 className="w-4 h-4 text-green-600" />}
              description="Omset riil yang mengecualikan seluruh pesanan Batal/Retur (lebih akurat daripada 'Penjualan' Shopee)."
              isHighlight
            />
            <KPICard 
              title="Biaya Iklan" 
              value={`Rp ${Math.abs(metrics.biayaIklan || 0).toLocaleString()}`} 
              trend="Ad Spend"
              icon={<Percent className="w-4 h-4 text-red-600" />}
              description="Total biaya iklan yang dikeluarkan (berdasarkan transaksi saldo penjual, sudah termasuk PPN iklan 11%)."
              isNegative
            />
            <KPICard 
              title="ROAS Aktual" 
              value={`${(metrics.roasAktual || 0).toFixed(2)}x`} 
              trend="Return on Ad Spend"
              icon={<BrainCircuit className="w-4 h-4 text-purple-600" />}
              description="Efektivitas iklan (Omzet Bersih / Biaya Iklan)."
              isHighlight
            />
            <KPICard 
              title="% ACOS" 
              value={`${(metrics.acosAktual || 0).toFixed(2)}%`} 
              trend="Ad Cost of Sales"
              icon={<Percent className="w-4 h-4 text-rose-600" />}
              description="Persentase biaya iklan dibandingkan omzet bersih (Biaya Iklan / Omzet Bersih)."
              isNegative
            />
            <KPICard 
              title="Total Pesanan" 
              value={`${metrics.totalOrders}`} 
              trend="Order Count"
              icon={<PackageSearch className="w-4 h-4 text-blue-600" />}
              description="Jumlah seluruh transaksi yang masuk dalam periode ini."
            />
            <KPICard 
              title="AOV" 
              value={`Rp ${Math.round(metrics.averageOrderValue || 0).toLocaleString('id-ID')}`} 
              trend="Avg Order Value"
              icon={<ArrowRightLeft className="w-4 h-4 text-indigo-600" />}
              description="Rata-rata nilai belanja per pelanggan."
            />
            <KPICard 
              title="Pesanan Dibatalkan" 
              value={`${metrics.cancelledCount}`} 
              trend="Cancelled"
              icon={<XCircle className="w-4 h-4 text-red-500" />}
              description="Jumlah pesanan yang dibatalkan oleh pembeli atau sistem."
              isNegative
            />
          </div>
        ) : (
          <div className="space-y-8 mt-6">
            {/* Grup 1 – Alur Keuangan (Primary Flow) */}
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <div className="h-5 w-1.5 bg-orange-500 rounded-full"></div>
                <h3 className="text-xs font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Alur Keuangan (Cash Flow)</h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 md:gap-6">
                <KPICard 
                  title="Omzet Riil" 
                  value={`Rp ${(metrics.omzetRiil || 0).toLocaleString()}`} 
                  trend="Gross Revenue"
                  icon={<ShoppingBag className="w-4 h-4 text-blue-600" />}
                  description="Total nilai pesanan (Dibayar Pembeli) dengan status 'Selesai'."
                />
                <KPICard 
                  title="Potongan Marketplace" 
                  value={`-Rp ${(metrics.potonganMarketplace || 0).toLocaleString()}`} 
                  trend="Fees"
                  isNegative
                  icon={<Percent className="w-4 h-4 text-red-600" />}
                  description="Total komisi/biaya marketplace."
                />
                <KPICard 
                  title="Dana Cair" 
                  value={`Rp ${(metrics.danaCair || 0).toLocaleString()}`} 
                  trend="Net Revenue"
                  icon={<Wallet className="w-4 h-4 text-green-600" />}
                  description="Total pendapatan bersih dari pesanan yang sudah dilepaskan Shopee."
                  isHighlight
                />
                <KPICard 
                  title="HPP" 
                  value={`-Rp ${(metrics.hppSelesai || 0).toLocaleString()}`} 
                  trend="COGS"
                  isNegative
                  icon={<PackageSearch className="w-4 h-4 text-orange-600" />}
                  description="Total modal pokok produk untuk pesanan selesai."
                />
                <KPICard 
                  title="Penyesuaian" 
                  value={`${metrics.adjustmentPlus + metrics.adjustmentMinus < 0 ? '-' : '+'}Rp ${Math.abs(metrics.adjustmentPlus + metrics.adjustmentMinus).toLocaleString()}`} 
                  trend={`+${metrics.adjustmentPlus.toLocaleString()} / -${Math.abs(metrics.adjustmentMinus).toLocaleString()}`}
                  isNegative={metrics.adjustmentPlus + metrics.adjustmentMinus < 0}
                  icon={<ArrowRightLeft className="w-4 h-4 text-purple-600" />}
                  description="Total penyesuaian saldo (Kompensasi, Klaim, Bonus, dll)."
                />
                <KPICard 
                  title="Profit Riil" 
                  value={`Rp ${(metrics.profitRiil || 0).toLocaleString()}`} 
                  trend="Net Profit"
                  icon={<Wallet className="w-4 h-4 text-yellow-600" />}
                  description="Dana Cair - HPP + Penyesuaian."
                  isHighlight
                />
              </div>
            </div>

            {/* Grup 2 – Metrik Pendukung */}
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <div className="h-5 w-1.5 bg-slate-400 dark:bg-slate-600 rounded-full"></div>
                <h3 className="text-xs font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Metrik Pendukung</h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 md:gap-6">
                <KPICard 
                  title="% Net Profit" 
                  value={`${metrics.percentNetProfit.toFixed(1)}%`} 
                  trend="Profitability"
                  icon={<Percent className="w-4 h-4 text-green-600" />}
                  description="Profit Riil / Omzet Riil × 100%."
                />
                <KPICard 
                  title="% Potongan" 
                  value={`${metrics.percentPotonganOmzet.toFixed(1)}%`} 
                  trend="Marketplace Fee %"
                  icon={<Percent className="w-4 h-4 text-red-600" />}
                  description="Potongan Marketplace / Omzet Riil × 100%."
                />
                <KPICard 
                  title="Selisih Ongkir" 
                  value={`${metrics.shippingLeakage < 0 ? '-' : '+'}Rp ${Math.abs(metrics.shippingLeakage || 0).toLocaleString()}`} 
                  trend="Shipping Diff"
                  isNegative={metrics.shippingLeakage < 0}
                  icon={<AlertCircle className={`w-4 h-4 ${metrics.shippingLeakage < 0 ? 'text-red-600' : 'text-green-600'}`} />}
                  description="(Ongkir Pembeli + Gratis Ongkir) - (Ongkir Diteruskan + Ongkir Retur)"
                />
                <KPICard 
                  title="Pesanan Selesai" 
                  value={`${metrics.completedCount}`} 
                  trend="Completed"
                  icon={<CheckCircle2 className="w-4 h-4 text-green-600" />}
                  description="Jumlah pesanan yang sudah cair."
                />
                <KPICard 
                  title="Pesanan Retur" 
                  value={`${metrics.returnedCount}`} 
                  trend="Returned"
                  icon={<AlertCircle className="w-4 h-4 text-amber-600" />}
                  description="Jumlah pesanan retur."
                  isNegative
                />
              </div>
            </div>
          </div>
        )}

        {/* Adjustments Breakdown Section */}
        {filters.mode === 'release_date' && metrics.adjustmentDetails.length > 0 && (
          <div className="mt-8 bg-white dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm overflow-hidden border-l-4 border-l-purple-500">
            <div className="p-6 border-b border-slate-50 dark:border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-purple-50/30 dark:bg-purple-900/10">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-100 dark:bg-purple-900/20 rounded-xl">
                  <ArrowRightLeft className="w-5 h-5 text-purple-600" />
                </div>
                <div>
                  <h3 className="text-sm font-black uppercase tracking-tight text-slate-900 dark:text-white">Rincian Penyesuaian Saldo</h3>
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Dana Masuk/Keluar Non-Pesanan</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                 <div className="text-right">
                    <p className="text-[10px] text-slate-400 font-bold uppercase">Total Penyesuaian</p>
                    <p className={`text-sm font-black ${metrics.adjustmentPlus + metrics.adjustmentMinus < 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {metrics.adjustmentPlus + metrics.adjustmentMinus < 0 ? '-' : '+'}Rp {Math.abs(metrics.adjustmentPlus + metrics.adjustmentMinus).toLocaleString()}
                    </p>
                 </div>
              </div>
            </div>
            <div className="p-0 overflow-x-auto">
               <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50/50 dark:bg-slate-800/50 text-slate-400">
                     <tr>
                        <th className="px-6 py-3 font-black uppercase text-[10px] tracking-wider">Tanggal</th>
                        <th className="px-6 py-3 font-black uppercase text-[10px] tracking-wider">Keterangan</th>
                        <th className="px-6 py-3 font-black uppercase text-[10px] tracking-wider text-right">Nominal</th>
                     </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                     {metrics.adjustmentDetails.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map((adj, idx) => (
                        <tr key={adj.id || idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                           <td className="px-6 py-3 font-medium text-slate-500 whitespace-nowrap">{format(new Date(adj.date), 'dd/MM/yyyy')}</td>
                           <td className="px-6 py-3 font-bold text-slate-700 dark:text-slate-300">{adj.description}</td>
                           <td className={`px-6 py-3 text-right font-black ${adj.amount < 0 ? 'text-red-500' : 'text-green-500'}`}>
                              {adj.amount < 0 ? '-' : '+'}Rp {Math.abs(adj.amount).toLocaleString()}
                           </td>
                        </tr>
                     ))}
                  </tbody>
               </table>
            </div>
          </div>
        )}

        {/* Fee Breakdown Dashboard Section */}
        {filters.mode === 'release_date' && (
          <div className="mt-8 bg-white dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-50 dark:border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-slate-50/50 dark:bg-slate-800/30">
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
              
              {/* Voucher & Subsidi Shopee */}
              <div className="space-y-3">
                <h4 className="text-[11px] font-black uppercase text-slate-400 tracking-widest border-b border-slate-100 dark:border-slate-800 pb-2 mb-3">Voucher & Subsidi Shopee</h4>
                {metrics.feeBreakdown.shopeeProductDiscount !== 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-500 font-medium">Diskon Produk dari Shopee</span>
                    <span className="text-xs font-bold text-green-600">+Rp {metrics.feeBreakdown.shopeeProductDiscount.toLocaleString()}</span>
                  </div>
                )}
                {metrics.feeBreakdown.voucher !== 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-500 font-medium">Voucher disponsor oleh Penjual</span>
                    <span className="text-xs font-bold text-red-600">-Rp {metrics.feeBreakdown.voucher.toLocaleString()}</span>
                  </div>
                )}
                {metrics.feeBreakdown.sellerCofundVoucher !== 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-500 font-medium">Voucher co-fund Penjual</span>
                    <span className="text-xs font-bold text-red-600">-Rp {metrics.feeBreakdown.sellerCofundVoucher.toLocaleString()}</span>
                  </div>
                )}
                {metrics.feeBreakdown.sellerCoinCashback !== 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-500 font-medium">Cashback Koin Penjual</span>
                    <span className="text-xs font-bold text-red-600">-Rp {metrics.feeBreakdown.sellerCoinCashback.toLocaleString()}</span>
                  </div>
                )}
                {metrics.feeBreakdown.sellerCofundCoinCashback !== 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-500 font-medium">Cashback Koin Co-fund Penjual</span>
                    <span className="text-xs font-bold text-red-600">-Rp {metrics.feeBreakdown.sellerCofundCoinCashback.toLocaleString()}</span>
                  </div>
                )}
              </div>

              {/* Total Biaya Pengiriman */}
              <div className="space-y-3">
                <h4 className="text-[11px] font-black uppercase text-slate-400 tracking-widest border-b border-slate-100 dark:border-slate-800 pb-2 mb-3">Total Biaya Pengiriman</h4>
                {metrics.feeBreakdown.shippingPaidByBuyer !== 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-500 font-medium">Ongkir Dibayar Pembeli</span>
                    <span className="text-xs font-bold text-green-600">+Rp {metrics.feeBreakdown.shippingPaidByBuyer.toLocaleString()}</span>
                  </div>
                )}
                {metrics.feeBreakdown.shippingDiscountByCourier !== 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-500 font-medium">Diskon Ongkir Jasa Kirim</span>
                    <span className="text-xs font-bold text-green-600">+Rp {metrics.feeBreakdown.shippingDiscountByCourier.toLocaleString()}</span>
                  </div>
                )}
                {metrics.feeBreakdown.shippingRebate !== 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-500 font-medium">Gratis Ongkir dari Shopee</span>
                    <span className="text-xs font-bold text-green-600">+Rp {metrics.feeBreakdown.shippingRebate.toLocaleString()}</span>
                  </div>
                )}
                {metrics.feeBreakdown.shippingForwarded !== 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-500 font-medium">Ongkir Diteruskan ke Jasa Kirim</span>
                    <span className="text-xs font-bold text-red-600">-Rp {metrics.feeBreakdown.shippingForwarded.toLocaleString()}</span>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-xs text-slate-500 font-medium">Ongkir Pengembalian Barang</span>
                  <span className="text-xs font-bold text-red-600">-Rp {metrics.feeBreakdown.returnShipping.toLocaleString()}</span>
                </div>
                {metrics.feeBreakdown.shippingRefund !== 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-500 font-medium">Pengembalian Biaya Kirim</span>
                    <span className="text-xs font-bold text-red-600">-Rp {metrics.feeBreakdown.shippingRefund.toLocaleString()}</span>
                  </div>
                )}
                {metrics.feeBreakdown.returnToSenderShippingFee !== 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-500 font-medium">Kembali ke Biaya Pengiriman Pengirim</span>
                    <span className="text-xs font-bold text-red-600">-Rp {metrics.feeBreakdown.returnToSenderShippingFee.toLocaleString()}</span>
                  </div>
                )}
              </div>

              {/* Biaya Admin & Layanan */}
              <div className="space-y-3">
                <h4 className="text-[11px] font-black uppercase text-slate-400 tracking-widest border-b border-slate-100 dark:border-slate-800 pb-2 mb-3">Biaya Admin & Layanan</h4>
                {metrics.feeBreakdown.ams !== 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-500 font-medium">Biaya Komisi AMS</span>
                    <span className="text-xs font-bold text-red-600">-Rp {metrics.feeBreakdown.ams.toLocaleString()}</span>
                  </div>
                )}
                {metrics.feeBreakdown.admin !== 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-500 font-medium">Biaya Administrasi</span>
                    <span className="text-xs font-bold text-red-600">-Rp {metrics.feeBreakdown.admin.toLocaleString()}</span>
                  </div>
                )}
                {metrics.feeBreakdown.service !== 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-500 font-medium">Biaya Layanan</span>
                    <span className="text-xs font-bold text-red-600">-Rp {metrics.feeBreakdown.service.toLocaleString()}</span>
                  </div>
                )}
                {metrics.feeBreakdown.processing !== 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-500 font-medium">Biaya Proses Pesanan</span>
                    <span className="text-xs font-bold text-red-600">-Rp {metrics.feeBreakdown.processing.toLocaleString()}</span>
                  </div>
                )}
                {metrics.feeBreakdown.premium !== 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-500 font-medium">Premi</span>
                    <span className="text-xs font-bold text-red-600">-Rp {metrics.feeBreakdown.premium.toLocaleString()}</span>
                  </div>
                )}
                {metrics.feeBreakdown.saveShippingProgramFee !== 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-500 font-medium">Biaya Program Hemat Biaya Kirim</span>
                    <span className="text-xs font-bold text-red-600">-Rp {metrics.feeBreakdown.saveShippingProgramFee.toLocaleString()}</span>
                  </div>
                )}
                {metrics.feeBreakdown.transaction !== 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-500 font-medium">Biaya Transaksi</span>
                    <span className="text-xs font-bold text-red-600">-Rp {metrics.feeBreakdown.transaction.toLocaleString()}</span>
                  </div>
                )}
                {metrics.feeBreakdown.campaignFee !== 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-500 font-medium">Biaya Kampanye</span>
                    <span className="text-xs font-bold text-red-600">-Rp {metrics.feeBreakdown.campaignFee.toLocaleString()}</span>
                  </div>
                )}
                {metrics.feeBreakdown.autoTopupFee !== 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-500 font-medium">Biaya Isi Saldo Otomatis</span>
                    <span className="text-xs font-bold text-red-600">-Rp {metrics.feeBreakdown.autoTopupFee.toLocaleString()}</span>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-xs text-slate-500 font-medium">Pengembalian Dana ke Pembeli</span>
                  <span className="text-xs font-bold text-red-600">-Rp {metrics.feeBreakdown.refund.toLocaleString()}</span>
                </div>
              </div>

              {/* Total Potongan */}
              <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl flex flex-col justify-center">
                <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">Total Potongan</span>
                <span className="text-xl font-black text-red-600">
                  -Rp {metrics.potonganMarketplace.toLocaleString()}
                </span>
                <div className="mt-2 h-1 w-full bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-red-500" 
                    style={{ width: `${Math.min(100, (metrics.potonganMarketplace / (metrics.omzetRiil || 1)) * 100)}%` }}
                  />
                </div>
                <span className="text-[10px] text-slate-400 mt-1 font-bold">
                  {((metrics.potonganMarketplace / (metrics.omzetRiil || 1)) * 100).toFixed(1)}% dari Omzet Riil
                </span>
              </div>
            </div>
          </div>
        )}

        {filters.mode === 'order_date' && (
          <div className="mt-6">
            <PerformanceTrendChart 
              orders={filteredOrders.filter(o => !o.status?.toLowerCase().includes('batal'))} 
              startDate={filters.start}
              endDate={filters.end}
            />
          </div>
        )}

        <div className="mt-6">
          <ProductChart 
            storeId={store.id} 
            allStoreIds={store.id === 'all' ? allStores?.map(s => s.id) : (store as any).selected_ids} 
            orders={filteredOrders}
            startDate={filters.start}
            endDate={filters.end}
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
