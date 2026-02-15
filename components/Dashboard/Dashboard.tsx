
import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../../services/supabase';
import { Store, Order } from '../../types';
import { KPICard } from './KPICard';
import { RevenueChart } from './RevenueChart';
import { ProductChart } from './ProductChart';
import { OrdersTable } from './OrdersTable';
import { DateRangePicker } from './DateRangePicker';
import { Download, BrainCircuit, Loader2, Info, AlertCircle, ShoppingBag, XCircle, Wallet, FileSpreadsheet } from 'lucide-react';
import { getSalesInsights } from '../../services/gemini';
import { toast } from 'react-hot-toast';
import { format, parseISO } from 'date-fns';

interface DashboardProps { store: Store; }

export const Dashboard: React.FC<DashboardProps> = ({ store }) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [insights, setInsights] = useState<string | null>(null);
  const [isGeneratingInsights, setIsGeneratingInsights] = useState(false);

  useEffect(() => {
    fetchDashboardData();
  }, [store, dateRange]);

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('orders')
        .select('*')
        .eq('store_id', store.id)
        .order('order_date', { ascending: false });

      if (dateRange.start) query = query.gte('order_date', dateRange.start);
      if (dateRange.end) query = query.lte('order_date', dateRange.end);

      const { data, error } = await query;
      if (error) throw error;
      setOrders(data || []);
    } catch (err: any) {
      toast.error('Error loading dashboard: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const calculateMetrics = () => {
    const totalOrdersCount = orders.length;
    const cancelledOrders = orders.filter(o => 
      o.status?.toLowerCase().includes('batal') || 
      o.status?.toLowerCase().includes('cancel')
    );
    const cancelledCount = cancelledOrders.length;
    const gmv = orders.reduce((acc, o) => acc + (o.product_total || 0), 0);
    const netRevenue = orders.reduce((acc, o) => {
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

    const toastId = toast.loading("Menyiapkan Laporan Pesanan...");

    try {
      const exportTime = new Date().toLocaleString('id-ID');
      
      // Logika penentuan periode tanggal yang rapi
      let startDateStr = dateRange.start;
      let endDateStr = dateRange.end;

      if (!startDateStr && orders.length > 0) {
        // Ambil tanggal paling lama dari data
        const sortedDates = [...orders].sort((a, b) => new Date(a.order_date).getTime() - new Date(b.order_date).getTime());
        startDateStr = sortedDates[0].order_date.split('T')[0];
      }
      
      if (!endDateStr && orders.length > 0) {
        // Ambil tanggal terbaru dari data
        const sortedDates = [...orders].sort((a, b) => new Date(b.order_date).getTime() - new Date(a.order_date).getTime());
        endDateStr = sortedDates[0].order_date.split('T')[0];
      }

      const formatDate = (dateStr: string) => {
        try { return format(parseISO(dateStr), 'dd/MM/yyyy'); } 
        catch { return dateStr; }
      };

      const displayPeriod = `${formatDate(startDateStr || '')} s/d ${formatDate(endDateStr || '')}`;

      // 1. Menyiapkan Header Laporan
      const headerRows = [
        ["LAPORAN ESTIMASI PESANAN SHOPEE"],
        ["Toko:", store.name],
        ["Periode Laporan:", displayPeriod],
        ["Waktu Ekspor:", exportTime],
        ["Status Data:", "ESTIMASI (Berdasarkan data pesanan masuk)"],
        [""], 
        ["RINGKASAN ESTIMASI PERFORMA"],
        ["Total Penjualan (GMV Produk)", metrics.gmv],
        ["Total Estimasi Penghasilan", metrics.netRevenue],
        ["Total Pesanan", metrics.totalOrders],
        ["Pesanan Dibatalkan", metrics.cancelledCount],
        [""], 
        ["RINCIAN TRANSAKSI PESANAN"]
      ];

      // 2. Kolom Header Tabel
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

      const tableRows = orders.map(o => [
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

      // Lebar Kolom
      ws['!cols'] = [
        { wch: 22 }, { wch: 22 }, { wch: 15 }, { wch: 20 }, { wch: 15 }, 
        { wch: 15 }, { wch: 20 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, 
        { wch: 20 }, { wch: 30 }
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Laporan Pesanan");

      const fileName = `Laporan_Pesanan_${store.name}_${new Date().toISOString().split('T')[0]}.xlsx`;
      XLSX.writeFile(wb, fileName);

      toast.success("Laporan berhasil diunduh!", { id: toastId });
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
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <DateRangePicker onChange={setDateRange} />
        <div className="flex gap-2">
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
            Export Laporan
          </button>
        </div>
      </div>

      {insights && (
        <div className="bg-gradient-to-r from-purple-600 to-indigo-600 p-1 rounded-3xl shadow-xl animate-in slide-in-from-top-4">
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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

      <div className="p-4 bg-amber-50 dark:bg-amber-500/5 border border-amber-100 dark:border-amber-900/30 rounded-2xl flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="text-xs text-amber-800 dark:text-amber-300 font-medium leading-relaxed">
          <p className="font-bold mb-1 uppercase tracking-tight">Penting: Laporan Pesanan Bersifat Estimasi</p>
          <p>
            Nilai <b>Estimasi Net</b> mencakup pesanan yang belum selesai atau masih dalam pengiriman. Angka ini akan menjadi penghasilan final hanya setelah pembeli mengklik "Pesanan Diterima" dan dana dilepaskan ke Saldo Penjual Shopee.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RevenueChart orders={orders.filter(o => !o.status?.toLowerCase().includes('batal'))} />
        <ProductChart storeId={store.id} />
      </div>

      <OrdersTable orders={orders} />
    </div>
  );
};
