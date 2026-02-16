
import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../../services/supabase';
import { Store, Order } from '../../types';
import { KPICard } from './KPICard';
import { RevenueChart } from './RevenueChart';
import { ProductChart } from './ProductChart';
import { OrdersTable } from './OrdersTable';
import { DateRangePicker } from './DateRangePicker';
import { BrainCircuit, Loader2, Info, AlertCircle, ShoppingBag, XCircle, Wallet, FileSpreadsheet, RefreshCw } from 'lucide-react';
import { getSalesInsights } from '../../services/gemini';
import { toast } from 'react-hot-toast';
import { format } from 'date-fns';

interface DashboardProps { 
  store: Store; 
  allStores?: Store[]; // Optional: dibutuhkan jika store.id === 'all'
}

export const Dashboard: React.FC<DashboardProps> = ({ store, allStores }) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [insights, setInsights] = useState<string | null>(null);
  const [isGeneratingInsights, setIsGeneratingInsights] = useState(false);
  
  // AbortController ref to cancel stale requests
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetchDashboardData();
    
    // Cleanup function to abort request if component unmounts or deps change
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [store, dateRange]);

  const fetchDashboardData = async () => {
    // Cancel previous request if exists
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    
    // Create new controller
    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Show big loader only on initial load (no data)
    if (orders.length === 0) setLoading(true);
    else setIsRefreshing(true); // Show subtle loader if updating existing data

    try {
      let query = supabase
        .from('orders')
        .select('*')
        .order('order_date', { ascending: false });

      if (store.id === 'all') {
        if (allStores && allStores.length > 0) {
           const storeIds = allStores.map(s => s.id);
           query = query.in('store_id', storeIds);
        } else {
           setOrders([]);
           setLoading(false);
           setIsRefreshing(false);
           return;
        }
      } else {
        query = query.eq('store_id', store.id);
      }

      if (dateRange.start) {
        query = query.gte('order_date', `${dateRange.start}T00:00:00`);
      }
      
      if (dateRange.end) {
        query = query.lte('order_date', `${dateRange.end}T23:59:59`);
      }

      const { data, error } = await query;
      
      if (controller.signal.aborted) return; // Ignore if aborted

      if (error) throw error;
      setOrders(data || []);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        toast.error('Error loading dashboard: ' + err.message);
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        setIsRefreshing(false);
      }
    }
  };

  const calculateMetrics = (data: Order[] = orders) => {
    const totalOrdersCount = data.length;
    const cancelledOrders = data.filter(o => 
      o.status?.toLowerCase().includes('batal') || 
      o.status?.toLowerCase().includes('cancel')
    );
    const cancelledCount = cancelledOrders.length;
    const gmv = data.reduce((acc, o) => acc + (o.product_total || 0), 0);
    const netRevenue = data.reduce((acc, o) => {
      const isBatal = o.status?.toLowerCase().includes('batal') || o.status?.toLowerCase().includes('cancel');
      return acc + (isBatal ? 0 : (o.net_revenue || 0));
    }, 0);
    return { totalOrders: totalOrdersCount, cancelledCount, gmv, netRevenue };
  };

  const metrics = calculateMetrics();

  const handleExportXLSX = () => {
    if (orders.length === 0) {
      toast.error("Tidak ada data untuk diekspor");
      return;
    }

    const toastId = toast.loading("Menyiapkan Laporan Excel Multi-Sheet...");

    try {
      const exportTime = new Date().toLocaleString('id-ID');
      
      let startDateStr = dateRange.start;
      let endDateStr = dateRange.end;

      if (!startDateStr && orders.length > 0) {
        const sortedDates = [...orders].sort((a, b) => new Date(a.order_date).getTime() - new Date(b.order_date).getTime());
        startDateStr = sortedDates[0].order_date.split('T')[0];
      }
      
      if (!endDateStr && orders.length > 0) {
        const sortedDates = [...orders].sort((a, b) => new Date(b.order_date).getTime() - new Date(a.order_date).getTime());
        endDateStr = sortedDates[0].order_date.split('T')[0];
      }

      const formatDate = (dateStr: string) => {
        try { return format(new Date(dateStr), 'dd/MM/yyyy'); } 
        catch { return dateStr; }
      };

      const displayPeriod = `${formatDate(startDateStr || '')} s/d ${formatDate(endDateStr || '')}`;
      const wb = XLSX.utils.book_new();

      const createSheetData = (sheetOrders: Order[], sheetStoreName: string) => {
        const sheetMetrics = calculateMetrics(sheetOrders);
        
        const headerRows = [
          ["LAPORAN ESTIMASI PESANAN SHOPEE"],
          ["Toko:", sheetStoreName],
          ["Periode Laporan:", displayPeriod],
          ["Waktu Ekspor:", exportTime],
          ["Status Data:", "ESTIMASI (Berdasarkan data pesanan masuk)"],
          [""], 
          ["RINGKASAN PERFORMA (SHEET INI)"],
          ["Total Penjualan (GMV Produk)", sheetMetrics.gmv],
          ["Total Estimasi Penghasilan", sheetMetrics.netRevenue],
          ["Total Pesanan", sheetMetrics.totalOrders],
          ["Pesanan Dibatalkan", sheetMetrics.cancelledCount],
          [""], 
          ["RINCIAN TRANSAKSI PESANAN"]
        ];

        const tableHeaders = [
          "No. Pesanan", 
          "Waktu Pesanan", 
          "Status", 
          "Username Pembeli", 
          "Kota", 
          "Provinsi", 
          "GMV (Harga Produk)", 
          "Voucher Toko", 
          "Biaya Admin", 
          "Biaya Layanan", 
          "Estimasi Penghasilan", 
          "Keterangan"
        ];

        const tableRows = sheetOrders.map(o => [
          o.order_id,
          o.order_date ? new Date(o.order_date).toLocaleString('id-ID') : '-',
          o.status,
          o.buyer_username || '-',
          o.city || '-',
          o.province || '-',
          o.product_total,
          o.seller_voucher,
          o.admin_fee,
          o.service_fee,
          o.status?.toLowerCase().includes('batal') ? 0 : o.net_revenue,
          o.status?.toLowerCase().includes('batal') ? "Pesanan Dibatalkan" : (o.status === 'Selesai' ? "Selesai" : "Dalam Proses/Pengiriman")
        ]);

        const fullData = [...headerRows, tableHeaders, ...tableRows];
        const ws = XLSX.utils.aoa_to_sheet(fullData);

        ws['!cols'] = [
          { wch: 22 }, { wch: 22 }, { wch: 15 }, { wch: 20 }, { wch: 15 }, 
          { wch: 15 }, { wch: 20 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, 
          { wch: 20 }, { wch: 30 }
        ];

        return ws;
      };

      const mainSheetName = store.id === 'all' ? "GABUNGAN SEMUA TOKO" : `DATA ${store.name}`.substring(0, 30);
      const mainWs = createSheetData(orders, store.name);
      XLSX.utils.book_append_sheet(wb, mainWs, mainSheetName);

      if (store.id === 'all' && allStores) {
        allStores.forEach(s => {
          const storeOrders = orders.filter(o => o.store_id === s.id);
          if (storeOrders.length > 0) {
            const ws = createSheetData(storeOrders, s.name);
            const cleanName = s.name.replace(/[\\/?*[\]]/g, "").substring(0, 30);
            XLSX.utils.book_append_sheet(wb, ws, cleanName);
          }
        });
      }

      const fileName = `Laporan_${store.name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`;
      XLSX.writeFile(wb, fileName);

      toast.success("Laporan Excel berhasil dibuat!", { id: toastId });
    } catch (err: any) {
      toast.error("Gagal mengekspor: " + err.message, { id: toastId });
    }
  };

  const generateAIInsights = async () => {
    setIsGeneratingInsights(true);
    const summary = orders.slice(0, 50).map(o => ({ date: o.order_date, revenue: o.net_revenue, status: o.status }));
    const text = await getSalesInsights(summary);
    setInsights(text || "No insights found.");
    setIsGeneratingInsights(false);
  };

  if (loading && orders.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500 relative">
      {/* Updating Indicator Overlay - Made Subtle and Top Right aligned */}
      {isRefreshing && (
        <div className="absolute top-0 right-0 z-20 flex items-center gap-2 bg-orange-50 dark:bg-slate-800 text-orange-700 dark:text-orange-400 px-3 py-1 rounded-full text-xs font-bold border border-orange-100 dark:border-slate-700 shadow-sm animate-pulse">
           <Loader2 className="w-3 h-3 animate-spin" />
           Syncing Data...
        </div>
      )}

      {/* Removed opacity transition that blocked UI */}
      <div>
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div className="w-full lg:w-auto">
            <DateRangePicker onChange={setDateRange} />
          </div>
          
          <div className="flex gap-2 w-full lg:w-auto justify-end">
            <button 
              onClick={generateAIInsights}
              disabled={isGeneratingInsights}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition-colors disabled:opacity-50 shadow-lg shadow-purple-500/20 text-xs font-black uppercase"
            >
              <BrainCircuit className="w-4 h-4" />
              {isGeneratingInsights ? 'Analisis...' : 'AI Insights'}
            </button>
            <button 
              onClick={handleExportXLSX}
              className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-xs font-black uppercase shadow-sm group"
            >
              <FileSpreadsheet className="w-4 h-4 text-green-600 group-hover:scale-110 transition-transform" />
              Export Excel {store.id === 'all' ? '(Multi-Sheet)' : ''}
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

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
          <KPICard 
            title="Penjualan (GMV)" 
            value={`Rp ${metrics.gmv.toLocaleString()}`} 
            trend="Total Produk"
            icon={<ShoppingBag className="w-4 h-4 text-orange-600" />}
          />
          <KPICard 
            title="Total Pesanan" 
            value={metrics.totalOrders} 
            trend="Masuk"
            icon={<Info className="w-4 h-4 text-blue-600" />}
          />
          <KPICard 
            title="Pesanan Batal" 
            value={metrics.cancelledCount} 
            trend="Dibatalkan"
            isNegative
            icon={<XCircle className="w-4 h-4 text-red-600" />}
          />
          <KPICard 
            title="Estimasi Net" 
            value={`Rp ${metrics.netRevenue.toLocaleString()}`} 
            trend="Estimasi Profit"
            isHighlight
            icon={<Wallet className="w-4 h-4 text-green-600" />}
          />
        </div>

        <div className="p-4 bg-amber-50 dark:bg-amber-500/5 border border-amber-100 dark:border-amber-900/30 rounded-2xl flex items-start gap-3 mt-6">
          <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-800 dark:text-amber-300 font-medium leading-relaxed">
            <p className="font-bold mb-1 uppercase tracking-tight">Penting: Laporan Pesanan Bersifat Estimasi</p>
            <p>
              Nilai <b>Estimasi Net</b> mencakup pesanan yang belum selesai atau masih dalam pengiriman. Angka ini akan menjadi penghasilan final hanya setelah pembeli mengklik "Pesanan Diterima" dan dana dilepaskan ke Saldo Penjual Shopee.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
          <RevenueChart orders={orders.filter(o => !o.status?.toLowerCase().includes('batal'))} />
          <ProductChart 
            storeId={store.id} 
            allStoreIds={store.id === 'all' ? allStores?.map(s => s.id) : undefined} 
          />
        </div>

        <div className="mt-6">
          <OrdersTable 
            orders={orders} 
            stores={store.id === 'all' ? allStores : undefined} 
          />
        </div>
      </div>
    </div>
  );
};
