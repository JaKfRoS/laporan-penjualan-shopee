import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../services/supabase';
import { Store } from '../../types';
import toast from 'react-hot-toast';
import { ChevronLeft, Save, Edit2, TrendingUp, TrendingDown, Eye, MousePointerClick, Percent, DollarSign, Package, Calculator, ShoppingCart, Calendar } from 'lucide-react';

interface AdsProductsProps {
  store: Store;
}

interface AdsProduct {
  id: string;
  product_name: string;
  hpp: number;
  harga_jual: number;
  proses_pesanan: number;
  pot_admin_persen: number;
  operasional_persen: number;
}

interface AdsProductPerformance {
  id: string;
  ads_product_id: string;
  periode: string;
  report_date: string | null;
  impressions: number;
  clicks: number;
  conversions: number;
  amount_spent: number;
  gmv_generated: number;
  created_at: string;
}

export default function AdsProducts({ store }: AdsProductsProps) {
  const [products, setProducts] = useState<AdsProduct[]>([]);
  const [allPerformances, setAllPerformances] = useState<AdsProductPerformance[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProduct, setSelectedProduct] = useState<AdsProduct | null>(null);
  const [editingProduct, setEditingProduct] = useState<AdsProduct | null>(null);

  useEffect(() => {
    fetchData();
  }, [store.id]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // 1. Fetch Products
      const { data: prods, error: errProds } = await supabase
        .from('ads_products')
        .select('*')
        .eq('store_id', store.id)
        .order('product_name', { ascending: true });

      if (errProds) throw errProds;
      const fetchedProducts = prods || [];
      setProducts(fetchedProducts);

      // 2. Fetch all performances for these products to calculate 30-day stats
      if (fetchedProducts.length > 0) {
        const productIds = fetchedProducts.map(p => p.id);
        const chunkSize = 100;
        let allPerfs: AdsProductPerformance[] = [];
        
        for (let i = 0; i < productIds.length; i += chunkSize) {
          const chunk = productIds.slice(i, i + chunkSize);
          const { data: perfs, error: errPerfs } = await supabase
            .from('ads_product_performance')
            .select('*')
            .in('ads_product_id', chunk);
          
          if (errPerfs) throw errPerfs;
          if (perfs) allPerfs = [...allPerfs, ...perfs];
        }
        setAllPerformances(allPerfs);
      }
    } catch (err: any) {
      console.error(err);
      toast.error("Gagal memuat data produk: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectProduct = (product: AdsProduct) => {
    setSelectedProduct(product);
  };

  const handleSaveProduct = async () => {
    if (!editingProduct) return;
    try {
      const { error } = await supabase
        .from('ads_products')
        .update({
          hpp: editingProduct.hpp,
          harga_jual: editingProduct.harga_jual,
          proses_pesanan: editingProduct.proses_pesanan,
          pot_admin_persen: editingProduct.pot_admin_persen,
          operasional_persen: editingProduct.operasional_persen
        })
        .eq('id', editingProduct.id);

      if (error) throw error;
      toast.success("Pengaturan produk berhasil disimpan");
      setEditingProduct(null);
      
      // Update local state
      setProducts(products.map(p => p.id === editingProduct.id ? editingProduct : p));
      if (selectedProduct?.id === editingProduct.id) {
        setSelectedProduct(editingProduct);
      }
    } catch (err: any) {
      console.error(err);
      toast.error("Gagal menyimpan: " + err.message);
    }
  };

  const calculateKPIs = (product: AdsProduct) => {
    const grossMargin = product.harga_jual - product.hpp - product.proses_pesanan - (product.harga_jual * (product.pot_admin_persen / 100)) - (product.harga_jual * (product.operasional_persen / 100));
    const bepRoas = grossMargin > 0 ? product.harga_jual / grossMargin : 0;
    const targetRoasKompetitif = bepRoas * 1.7;
    const targetRoasIdeal = bepRoas * 2;

    return { grossMargin, bepRoas, targetRoasKompetitif, targetRoasIdeal };
  };

  const get30DayStats = (productId: string) => {
    const productPerfs = allPerformances
      .filter(p => p.ads_product_id === productId)
      .sort((a, b) => {
         const dateA = a.report_date ? new Date(a.report_date).getTime() : new Date(a.created_at).getTime();
         const dateB = b.report_date ? new Date(b.report_date).getTime() : new Date(b.created_at).getTime();
         return dateB - dateA;
      })
      .slice(0, 4); // Ambil 4 laporan terakhir (asumsi mingguan = 28-30 hari)

    const stats = productPerfs.reduce((acc, curr) => {
      acc.impressions += curr.impressions || 0;
      acc.clicks += curr.clicks || 0;
      acc.conversions += curr.conversions || 0;
      acc.amount_spent += curr.amount_spent || 0;
      acc.gmv_generated += curr.gmv_generated || 0;
      return acc;
    }, { impressions: 0, clicks: 0, conversions: 0, amount_spent: 0, gmv_generated: 0 });

    const roas = stats.amount_spent > 0 ? stats.gmv_generated / stats.amount_spent : 0;
    return { ...stats, roas, count: productPerfs.length };
  };

  const selectedPerformances = useMemo(() => {
    if (!selectedProduct) return [];
    return allPerformances
      .filter(p => p.ads_product_id === selectedProduct.id)
      .sort((a, b) => {
         const dateA = a.report_date ? new Date(a.report_date).getTime() : new Date(a.created_at).getTime();
         const dateB = b.report_date ? new Date(b.report_date).getTime() : new Date(b.created_at).getTime();
         return dateB - dateA;
      });
  }, [selectedProduct, allPerformances]);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (selectedProduct) {
    const kpis = calculateKPIs(selectedProduct);

    return (
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <button 
          onClick={() => setSelectedProduct(null)}
          className="flex items-center gap-2 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors font-medium text-sm"
        >
          <ChevronLeft className="w-4 h-4" /> Kembali ke Daftar Produk
        </button>

        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800 p-4 md:p-6 shadow-sm">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
            <div>
              <h2 className="text-xl font-black text-slate-800 dark:text-slate-100">{selectedProduct.product_name}</h2>
              <p className="text-sm text-slate-500">Pengaturan & Target KPI</p>
            </div>
            {!editingProduct && (
              <button 
                onClick={() => setEditingProduct(selectedProduct)}
                className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-500/10 dark:text-blue-400 dark:hover:bg-blue-500/20 rounded-xl font-bold text-sm transition-colors w-full md:w-auto justify-center"
              >
                <Edit2 className="w-4 h-4" /> Edit
              </button>
            )}
          </div>

          {editingProduct ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">HPP (Rp)</label>
                <input 
                  type="number" 
                  value={editingProduct.hpp} 
                  onChange={e => setEditingProduct({...editingProduct, hpp: Number(e.target.value)})}
                  className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Harga Jual (Rp)</label>
                <input 
                  type="number" 
                  value={editingProduct.harga_jual} 
                  onChange={e => setEditingProduct({...editingProduct, harga_jual: Number(e.target.value)})}
                  className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Proses Pesanan (Rp)</label>
                <input 
                  type="number" 
                  value={editingProduct.proses_pesanan} 
                  onChange={e => setEditingProduct({...editingProduct, proses_pesanan: Number(e.target.value)})}
                  className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Pot Admin (%)</label>
                <input 
                  type="number" 
                  value={editingProduct.pot_admin_persen} 
                  onChange={e => setEditingProduct({...editingProduct, pot_admin_persen: Number(e.target.value)})}
                  className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Operasional (%)</label>
                <input 
                  type="number" 
                  value={editingProduct.operasional_persen} 
                  onChange={e => setEditingProduct({...editingProduct, operasional_persen: Number(e.target.value)})}
                  className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div className="sm:col-span-2 lg:col-span-5 flex justify-end gap-3 mt-2">
                <button 
                  onClick={() => setEditingProduct(null)}
                  className="px-6 py-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl font-bold transition-colors"
                >
                  Batal
                </button>
                <button 
                  onClick={handleSaveProduct}
                  className="flex items-center gap-2 px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold shadow-lg shadow-blue-500/30 transition-all"
                >
                  <Save className="w-4 h-4" /> Simpan
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4 mb-8">
              <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl">
                <p className="text-xs text-slate-500 font-medium mb-1">HPP</p>
                <p className="font-bold">Rp {selectedProduct.hpp.toLocaleString()}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl">
                <p className="text-xs text-slate-500 font-medium mb-1">Harga Jual</p>
                <p className="font-bold">Rp {selectedProduct.harga_jual.toLocaleString()}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl">
                <p className="text-xs text-slate-500 font-medium mb-1">Proses Pesanan</p>
                <p className="font-bold">Rp {selectedProduct.proses_pesanan.toLocaleString()}</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl">
                <p className="text-xs text-slate-500 font-medium mb-1">Pot Admin</p>
                <p className="font-bold">{selectedProduct.pot_admin_persen}%</p>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl">
                <p className="text-xs text-slate-500 font-medium mb-1">Operasional</p>
                <p className="font-bold">{selectedProduct.operasional_persen}%</p>
              </div>
            </div>
          )}

          <div className="border-t border-slate-100 dark:border-slate-800 pt-6">
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-4 flex items-center gap-2">
              <Calculator className="w-4 h-4 text-blue-500" /> Target KPI Evaluasi
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/50 p-4 rounded-2xl">
                <p className="text-xs text-blue-600 dark:text-blue-400 font-bold uppercase tracking-wider mb-1">BEP ROAS</p>
                <p className="text-2xl font-black text-blue-700 dark:text-blue-300">{kpis.bepRoas.toFixed(2)}x</p>
                <p className="text-[10px] text-blue-500 mt-1">Batas aman iklan tidak rugi</p>
              </div>
              <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800/50 p-4 rounded-2xl">
                <p className="text-xs text-emerald-600 dark:text-emerald-400 font-bold uppercase tracking-wider mb-1">Target Kompetitif</p>
                <p className="text-2xl font-black text-emerald-700 dark:text-emerald-300">{kpis.targetRoasKompetitif.toFixed(2)}x</p>
                <p className="text-[10px] text-emerald-500 mt-1">1.7 × BEP ROAS</p>
              </div>
              <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800/50 p-4 rounded-2xl">
                <p className="text-xs text-indigo-600 dark:text-indigo-400 font-bold uppercase tracking-wider mb-1">Target Ideal</p>
                <p className="text-2xl font-black text-indigo-700 dark:text-indigo-300">{kpis.targetRoasIdeal.toFixed(2)}x</p>
                <p className="text-[10px] text-indigo-500 mt-1">2.0 × BEP ROAS</p>
              </div>
            </div>
          </div>
        </div>

        <h3 className="text-lg font-black text-slate-800 dark:text-slate-100 mt-8 mb-4">Performa Mingguan</h3>
        
        {selectedPerformances.length === 0 ? (
          <div className="text-center py-10 bg-white dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800">
            <p className="text-slate-500">Belum ada data performa untuk produk ini.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {selectedPerformances.map((record, index) => {
              const ctr = record.impressions > 0 ? (record.clicks / record.impressions) * 100 : 0;
              const cr = record.clicks > 0 ? (record.conversions / record.clicks) * 100 : 0;
              const roas = record.amount_spent > 0 ? record.gmv_generated / record.amount_spent : 0;
              const acos = record.gmv_generated > 0 ? (record.amount_spent / record.gmv_generated) * 100 : 0;
              const cpc = record.clicks > 0 ? record.amount_spent / record.clicks : 0;

              const prevRecord = selectedPerformances[index + 1];
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

              // Evaluasi ROAS berdasarkan target
              let roasStatusColor = 'text-slate-600';
              let roasStatusText = '';
              if (kpis.bepRoas > 0) {
                if (roas >= kpis.targetRoasIdeal) {
                  roasStatusColor = 'text-indigo-600 dark:text-indigo-400';
                  roasStatusText = 'Ideal';
                } else if (roas >= kpis.targetRoasKompetitif) {
                  roasStatusColor = 'text-emerald-600 dark:text-emerald-400';
                  roasStatusText = 'Kompetitif';
                } else if (roas >= kpis.bepRoas) {
                  roasStatusColor = 'text-amber-600 dark:text-amber-400';
                  roasStatusText = 'Aman (BEP)';
                } else {
                  roasStatusColor = 'text-rose-600 dark:text-rose-400';
                  roasStatusText = 'Rugi (Bawah BEP)';
                }
              }

              return (
                <div key={record.id} className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800 overflow-hidden shadow-sm">
                  <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Periode</p>
                    <h3 className="text-base font-black">{record.periode}</h3>
                  </div>
                  
                  <div className="p-4 md:p-6 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4 md:gap-6">
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-slate-500 flex items-center gap-1"><Eye className="w-3 h-3" /> Dilihat</p>
                      <div className="flex items-center gap-2">
                        <p className="text-lg font-bold">{record.impressions.toLocaleString()}</p>
                        {renderIndicator(record.impressions, prevRecord?.impressions)}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-slate-500 flex items-center gap-1"><MousePointerClick className="w-3 h-3" /> Klik</p>
                      <div className="flex items-center gap-2">
                        <p className="text-lg font-bold">{record.clicks.toLocaleString()}</p>
                        {renderIndicator(record.clicks, prevRecord?.clicks)}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-slate-500 flex items-center gap-1"><ShoppingCart className="w-3 h-3" /> Pesanan</p>
                      <div className="flex items-center gap-2">
                        <p className="text-lg font-bold">{record.conversions.toLocaleString()}</p>
                        {renderIndicator(record.conversions, prevRecord?.conversions)}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-slate-500 flex items-center gap-1"><Percent className="w-3 h-3" /> CTR</p>
                      <div className="flex items-center gap-2">
                        <p className="text-lg font-bold">{ctr.toFixed(2)}%</p>
                        {renderIndicator(ctr, prevCtr)}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-slate-500 flex items-center gap-1"><TrendingUp className="w-3 h-3" /> CR%</p>
                      <div className="flex items-center gap-2">
                        <p className="text-lg font-bold">{cr.toFixed(2)}%</p>
                        {renderIndicator(cr, prevCr)}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-slate-500 flex items-center gap-1"><DollarSign className="w-3 h-3" /> ROAS</p>
                      <div className="flex items-center gap-2">
                        <p className={`text-lg font-bold ${roasStatusColor}`}>
                          {roas.toFixed(2)}x
                        </p>
                        {renderIndicator(roas, prevRoas)}
                      </div>
                      {roasStatusText && <p className={`text-[10px] font-bold ${roasStatusColor}`}>{roasStatusText}</p>}
                    </div>
                    
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-slate-500">Biaya Iklan</p>
                      <div className="flex items-center gap-2">
                        <p className="text-lg font-bold text-red-600">Rp {record.amount_spent.toLocaleString()}</p>
                        {renderIndicator(record.amount_spent, prevRecord?.amount_spent, true)}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-slate-500">Penjualan</p>
                      <div className="flex items-center gap-2">
                        <p className="text-lg font-bold text-green-600">Rp {record.gmv_generated.toLocaleString()}</p>
                        {renderIndicator(record.gmv_generated, prevRecord?.gmv_generated)}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-slate-500">ACOS%</p>
                      <div className="flex items-center gap-2">
                        <p className="text-lg font-bold">{acos.toFixed(2)}%</p>
                        {renderIndicator(acos, prevAcos, true)}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-slate-500">CPC</p>
                      <div className="flex items-center gap-2">
                        <p className="text-lg font-bold">Rp {Math.round(cpc).toLocaleString()}</p>
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

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {products.length === 0 ? (
        <div className="text-center py-20 bg-white dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800">
          <Package className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <h3 className="text-lg font-bold text-slate-700 dark:text-slate-300 mb-2">Belum Ada Data Produk</h3>
          <p className="text-slate-500">Upload laporan iklan di tab "Keseluruhan" terlebih dahulu.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {products.map(product => {
            const isConfigured = product.harga_jual > 0;
            const stats = get30DayStats(product.id);
            
            return (
              <div 
                key={product.id} 
                onClick={() => handleSelectProduct(product)}
                className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800 p-5 cursor-pointer hover:shadow-md hover:border-blue-200 dark:hover:border-blue-800 transition-all group flex flex-col h-full"
              >
                <div className="flex items-start gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0 group-hover:bg-blue-100 transition-colors">
                    <Package className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-slate-800 dark:text-slate-200 truncate" title={product.product_name}>
                      {product.product_name}
                    </h3>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      {isConfigured ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400 rounded text-[10px] font-bold">
                          Terukur
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400 rounded text-[10px] font-bold">
                          Belum Diatur
                        </span>
                      )}
                      {stats.count > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 rounded text-[10px] font-bold">
                          <Calendar className="w-3 h-3" /> 30 Hari
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {stats.count > 0 ? (
                  <div className="grid grid-cols-2 gap-3 mt-auto pt-4 border-t border-slate-100 dark:border-slate-800">
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Biaya Iklan</p>
                      <p className="text-sm font-bold text-red-600">Rp {stats.amount_spent.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Penjualan</p>
                      <p className="text-sm font-bold text-green-600">Rp {stats.gmv_generated.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5 flex items-center gap-1"><ShoppingCart className="w-3 h-3" /> Pesanan</p>
                      <p className="text-sm font-bold text-slate-700 dark:text-slate-300">{stats.conversions.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">ROAS</p>
                      <p className={`text-sm font-bold ${stats.roas >= 5 ? 'text-green-600' : stats.roas >= 3 ? 'text-orange-500' : 'text-red-600'}`}>
                        {stats.roas.toFixed(2)}x
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="mt-auto pt-4 border-t border-slate-100 dark:border-slate-800 text-center">
                    <p className="text-xs text-slate-400">Belum ada data performa</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
