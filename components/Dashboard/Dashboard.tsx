
import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
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
  // Master Data (Fetched Once)
  const [allOrders, setAllOrders] = useState<Order[]>([]);
  
  // Display Data (Filtered locally)
  const [filteredOrders, setFilteredOrders] = useState<Order[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [insights, setInsights] = useState<string | null>(null);
  const [isGeneratingInsights, setIsGeneratingInsights] = useState(false);
  
  const abortControllerRef = useRef<AbortController | null>(null);

  // 1. FETCH DATA SEKALI SAJA SAAT TOKO BERUBAH
  useEffect(() => {
    fetchInitialData();
    return () => {
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, [store]);

  // 2. FILTER DATA SECARA LOKAL SAAT TANGGAL BERUBAH (INSTANT)
  useEffect(() => {
    if (allOrders.length === 0) {
      setFilteredOrders([]);
      return;
    }

    if (!dateRange.start && !dateRange.end) {
      // Jika tidak ada filter tanggal, tampilkan semua (atau default 30 hari terakhir jika mau)
      setFilteredOrders(allOrders);
      return;
    }

    const startDate = dateRange.start ? new Date(`${dateRange.start}T00:00:00`) : null;
    const endDate = dateRange.end ? new Date(`${dateRange.end}T23:59:59`) : null;

    const filtered = allOrders.filter(o => {
      const orderDate = new Date(o.order_date);
      
      if (startDate && orderDate < startDate) return false;
      if (endDate && orderDate > endDate) return false;
      
      return true;
    });

    setFilteredOrders(filtered);
  }, [dateRange, allOrders]);

  const fetchInitialData = async () => {
    if (abortControllerRef.current) abortControllerRef.current.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);

    try {
      let query = supabase
        .from('orders')
        .select('*, order_items(*)') // CHANGED: Fetch items relations
        .order('order_date', { ascending: false });

      // Ambil data dalam jumlah besar sekaligus (misal 5000 transaksi terakhir)
      // Agar client-side filtering bekerja mulus tanpa fetch ulang
      query = query.limit(5000);

      if (store.id === 'all') {
        if (allStores && allStores.length > 0) {
           const storeIds = allStores.map(s => s.id);
           query = query.in('store_id', storeIds);
        } else {
           setAllOrders([]);
           setFilteredOrders([]);
           setLoading(false);
           return;
        }
      } else {
        query = query.eq('store_id', store.id);
      }

      const { data, error } = await query;
      
      if (controller.signal.aborted) return;

      if (error) throw error;
      
      const safeData = data || [];
      setAllOrders(safeData);
      setFilteredOrders(safeData); // Default tampilkan semua sebelum difilter
    } catch (err: any) {
      if (err.name !== 'AbortError') {
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

    // 2. Filter: Order dengan Net Revenue < 0 (Refund/Penyesuaian)
    // Not used for main calculation as per reference, but kept for potential future use
    // const adjustmentOrders = data.filter(o => o.net_revenue < 0);

    // A. Total Omzet (GMV) - Hanya yang sudah SELESAI
    const totalOmzet = settledOrders.reduce((acc, o) => acc + (o.product_total || 0), 0);

    // B. Uang Cair (Net Revenue) - Sum dari Net Revenue order yang SELESAI
    const netRevenueSelesai = settledOrders.reduce((acc, o) => acc + (o.net_revenue || 0), 0);

    // C. Total Potongan Marketplace
    const totalPotongan = settledOrders.reduce((acc, o) => acc + (o.service_fee || 0), 0);

    // D. Total HPP (Hanya untuk order yang SELESAI)
    const totalHPPSelesai = settledOrders.reduce((acc, o) => {
      const orderHpp = o.order_items?.reduce((h, item) => {
        return h + ((item.hpp_at_time || 0) * item.quantity);
      }, 0) || 0;
      return acc + orderHpp;
    }, 0);

    // E. Total Keuntungan (Profit) = Uang Cair - HPP
    // Formula User: "Total Keuntungan = uang cair - total hpp"
    const totalKeuntungan = netRevenueSelesai - totalHPPSelesai;

    // F. Total Penyesuaian (0 based on reference)
    const totalPenyesuaian = 0;

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

    // I. Persentase
    const marginKeuntungan = totalOmzet > 0 ? (totalKeuntungan / totalOmzet) * 100 : 0;
    const rataRataPotongan = totalOmzet > 0 ? (totalPotongan / totalOmzet) * 100 : 0;

    return { 
      totalOrders: completedOrders.length,
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
      percentPotongan: rataRataPotongan
    };
  }, [filteredOrders]);

  const handleExportXLSX = () => {
    if (filteredOrders.length === 0) {
      toast.error("Tidak ada data untuk diekspor");
      return;
    }

    const toastId = toast.loading("Menyiapkan Laporan Excel...");

    try {
      const exportTime = new Date().toLocaleString('id-ID');
      
      // Gunakan filteredOrders agar Excel sesuai dengan apa yang dilihat user
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

      const displayPeriod = `${formatDate(startDateStr || '')} s/d ${formatDate(endDateStr || '')}`;
      const wb = XLSX.utils.book_new();

      const createSheetData = (sheetOrders: Order[], sheetStoreName: string) => {
        // Recalculate metrics for this sheet specifically
        const totalOrdersCount = sheetOrders.length;
        const cancelledCount = sheetOrders.filter(o => o.status?.toLowerCase().includes('batal') || o.status?.toLowerCase().includes('cancel')).length;
        const gmv = sheetOrders.reduce((acc, o) => acc + (o.product_total || 0), 0);
        const netRevenue = sheetOrders.reduce((acc, o) => {
             const isBatal = o.status?.toLowerCase().includes('batal') || o.status?.toLowerCase().includes('cancel');
             return acc + (isBatal ? 0 : (o.net_revenue || 0));
        }, 0);

        const headerRows = [
          ["LAPORAN ESTIMASI PESANAN SHOPEE"],
          ["Toko:", sheetStoreName],
          ["Periode Laporan:", displayPeriod],
          ["Waktu Ekspor:", exportTime],
          ["Status Data:", "ESTIMASI (Berdasarkan filter saat ini)"],
          [""], 
          ["RINGKASAN PERFORMA"],
          ["Total Penjualan (GMV Produk)", gmv],
          ["Total Estimasi Penghasilan", netRevenue],
          ["Total Pesanan", totalOrdersCount],
          ["Pesanan Dibatalkan", cancelledCount],
          [""], 
          ["RINCIAN TRANSAKSI PESANAN"]
        ];

        const tableHeaders = [
          "No. Pesanan", 
          "Waktu Pesanan", 
          "Status", 
          "Username Pembeli", 
          "Nama Produk (Pertama)", // New Header
          "Kota", 
          "Provinsi", 
          "GMV (Harga Produk)", 
          "Voucher Toko", 
          "Biaya Admin", 
          "Biaya Layanan", 
          "Estimasi Penghasilan", 
          "Keterangan"
        ];

        const tableRows = sheetOrders.map(o => {
            const firstProduct = o.order_items && o.order_items.length > 0 ? o.order_items[0].product_name : '-';
            return [
              o.order_id,
              o.order_date ? new Date(o.order_date).toLocaleString('id-ID') : '-',
              o.status,
              o.buyer_username || '-',
              firstProduct,
              o.city || '-',
              o.province || '-',
              o.product_total,
              o.seller_voucher,
              o.admin_fee,
              o.service_fee,
              o.status?.toLowerCase().includes('batal') ? 0 : o.net_revenue,
              o.status?.toLowerCase().includes('batal') ? "Pesanan Dibatalkan" : (o.status === 'Selesai' ? "Selesai" : "Dalam Proses/Pengiriman")
            ];
        });

        const fullData = [...headerRows, tableHeaders, ...tableRows];
        const ws = XLSX.utils.aoa_to_sheet(fullData);

        ws['!cols'] = [
          { wch: 22 }, { wch: 22 }, { wch: 15 }, { wch: 20 }, { wch: 30 }, { wch: 15 }, 
          { wch: 15 }, { wch: 20 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, 
          { wch: 20 }, { wch: 30 }
        ];

        return ws;
      };

      const mainSheetName = store.id === 'all' ? "GABUNGAN SEMUA TOKO" : `DATA ${store.name}`.substring(0, 30);
      const mainWs = createSheetData(dataToExport, store.name);
      XLSX.utils.book_append_sheet(wb, mainWs, mainSheetName);

      const fileName = `Laporan_${store.name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`;
      XLSX.writeFile(wb, fileName);

      toast.success("Laporan Excel berhasil dibuat!", { id: toastId });
    } catch (err: any) {
      toast.error("Gagal mengekspor: " + err.message, { id: toastId });
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
  if (loading && allOrders.length === 0) {
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
          <div className="w-full xl:w-auto">
            <DateRangePicker onChange={setDateRange} />
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
              Export Excel
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

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
          {/* Row 1 */}
          <KPICard 
            title="Total Omzet" 
            value={`Rp ${(metrics.totalOmzet || 0).toLocaleString()}`} 
            trend="Transaksi Selesai"
            icon={<ShoppingBag className="w-4 h-4 text-green-600" />}
          />
          <KPICard 
            title="Total Potongan Marketplace" 
            value={`-Rp ${(metrics.totalPotongan || 0).toLocaleString()}`} 
            trend="Biaya Platform"
            isNegative
            icon={<Percent className="w-4 h-4 text-red-600" />}
          />
          <KPICard 
            title="Total Omzet Dipotong Biaya Marketplace" 
            value={`Rp ${(metrics.netRevenueSelesai || 0).toLocaleString()}`} 
            trend="Net Revenue"
            icon={<Wallet className="w-4 h-4 text-blue-600" />}
          />

          {/* Row 2 */}
          <KPICard 
            title="Total Keuntungan" 
            value={`Rp ${(metrics.totalKeuntungan || 0).toLocaleString()}`} 
            trend="Profit"
            icon={<Wallet className="w-4 h-4 text-green-600" />}
          />
          <KPICard 
            title="Keuntungan Setelah Penyesuaian" 
            value={`Rp ${(metrics.keuntunganSetelahPenyesuaian || 0).toLocaleString()}`} 
            trend="Final Profit"
            icon={<Wallet className="w-4 h-4 text-emerald-600" />}
          />
          <KPICard 
            title="Margin Keuntungan" 
            value={`${(metrics.marginKeuntungan || 0).toFixed(1)}%`} 
            trend="% dari Omzet"
            icon={<CheckCircle2 className="w-4 h-4 text-green-600" />}
          />

          {/* Row 3 */}
          <KPICard 
            title="Rata-Rata Potongan Marketplace" 
            value={`${(metrics.rataRataPotongan || 0).toFixed(1)}%`} 
            trend="% Biaya"
            isNegative
            icon={<Percent className="w-4 h-4 text-red-600" />}
          />
          <KPICard 
            title="Total HPP" 
            value={`Rp ${(metrics.totalHPPSelesai || 0).toLocaleString()}`} 
            trend="Modal Produk"
            isNegative
            icon={<PackageSearch className="w-4 h-4 text-orange-600" />}
          />
           <KPICard 
            title="Uang yang Berpotensi Cair" 
            value={`Rp ${(metrics.uangPotensiCair || 0).toLocaleString()}`} 
            trend="Total GMV Valid"
            icon={<Wallet className="w-4 h-4 text-teal-600" />}
          />
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
