
import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../services/supabase';
import { Package, ShoppingBag, TrendingUp } from 'lucide-react';
import { format, subDays } from 'date-fns';

interface ProductChartProps {
  storeId: string;
  allStoreIds?: string[];
  orders: any[]; // Data pesanan yang sudah difilter di Dashboard
  startDate: string;
  endDate: string;
}

export const ProductChart: React.FC<ProductChartProps> = ({ storeId, allStoreIds, orders, startDate, endDate }) => {
  const [last30DaysData, setLast30DaysData] = useState<Record<string, number>>({});
  const [loading30Days, setLoading30Days] = useState(false);

  // 1. Hitung Top 5 dari orders yang sudah difilter
  const topProducts = useMemo(() => {
    const totals: Record<string, { total: number; qty: number }> = {};
    
    orders.forEach(order => {
      if (order.order_items) {
        order.order_items.forEach((item: any) => {
          const name = item.product_name.trim();
          if (!totals[name]) {
            totals[name] = { total: 0, qty: 0 };
          }
          totals[name].total += item.product_total || 0;
          totals[name].qty += item.quantity || 0;
        });
      }
    });

    return Object.entries(totals)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  }, [orders]);

  // 2. Fetch data 30 hari terakhir untuk top 5 produk tersebut
  useEffect(() => {
    if (topProducts.length > 0) {
      fetch30DaysRevenue();
    }
  }, [topProducts, storeId, allStoreIds]);

  const fetch30DaysRevenue = async () => {
    setLoading30Days(true);
    try {
      const names = topProducts.map(p => p.name);
      const thirtyDaysAgo = format(subDays(new Date(), 30), 'yyyy-MM-dd');

      let query = supabase
        .from('orders')
        .select(`
          order_id,
          order_date,
          store_id,
          order_items!inner(product_name, product_total)
        `)
        .gte('order_date', `${thirtyDaysAgo} 00:00:00+07`)
        .in('order_items.product_name', names);

      if (allStoreIds && allStoreIds.length > 0) {
        query = query.in('store_id', allStoreIds);
      } else {
        query = query.eq('store_id', storeId);
      }

      const { data, error } = await query;
      if (error) throw error;

      const totals30: Record<string, number> = {};
      data?.forEach(order => {
        order.order_items?.forEach((item: any) => {
          if (names.includes(item.product_name)) {
            totals30[item.product_name] = (totals30[item.product_name] || 0) + (item.product_total || 0);
          }
        });
      });

      setLast30DaysData(totals30);
    } catch (err) {
      console.error('Error fetching 30 days revenue:', err);
    } finally {
      setLoading30Days(false);
    }
  };

  const periodLabel = useMemo(() => {
    if (!startDate || !endDate) return 'Periode Terpilih';
    const start = format(new Date(startDate), 'dd MMM');
    const end = format(new Date(endDate), 'dd MMM');
    return `${start} - ${end}`;
  }, [startDate, endDate]);

  if (orders.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-900 p-8 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm text-center">
        <Package className="w-12 h-12 text-slate-200 dark:text-slate-800 mx-auto mb-4" />
        <h3 className="text-lg font-bold text-slate-800 dark:text-white">5 Produk Teratas</h3>
        <p className="text-slate-400 text-sm mt-2 font-medium">Belum ada data produk untuk periode ini</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h3 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">5 Produk Teratas</h3>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {topProducts.map((product, index) => (
          <div 
            key={index} 
            className="group bg-white dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm hover:shadow-md transition-all duration-300 overflow-hidden flex flex-col p-4"
            id={`top-product-card-${index}`}
          >
            {/* Image Placeholder */}
            <div className="w-full aspect-square bg-slate-50 dark:bg-slate-800/50 rounded-lg mb-4 flex items-center justify-center border border-slate-100 dark:border-slate-800">
               <div className="relative">
                 <Package className="w-12 h-12 text-slate-200 dark:text-slate-700" />
               </div>
            </div>

            {/* Product Info */}
            <h4 className="text-sm font-bold text-slate-800 dark:text-white mb-4 line-clamp-2 min-h-[2.5rem] leading-tight text-center">
              {product.name}
            </h4>

            <div className="w-full space-y-2 mb-4">
              <div className="flex justify-between items-start text-[10px] leading-tight">
                <span className="text-slate-500 font-medium w-2/3">Terjual {periodLabel} :</span>
                <span className="text-slate-900 dark:text-slate-300 font-bold text-right">{product.qty}pcs</span>
              </div>

              <div className="flex justify-between items-start text-[10px] leading-tight">
                <span className="text-slate-500 font-medium w-2/3">Omzet {periodLabel} :</span>
                <span className="text-slate-900 dark:text-slate-300 font-bold text-right">Rp {(product.total / 1000000).toFixed(1)}jt</span>
              </div>
            </div>

            {/* 30 Days Badge Footer */}
            <div className="mt-auto pt-2 flex items-center justify-between gap-2 border-t border-slate-50 dark:border-slate-800">
               <div className="bg-orange-500 text-white text-[8px] font-black px-2 py-1 rounded-[4px] uppercase whitespace-nowrap">
                  Omzet 30 hari terakhir :
               </div>
               <span className="text-lg font-black text-orange-500">
                 {loading30Days ? '...' : `${((last30DaysData[product.name] || 0) / 1000000).toFixed(0)}jt`}
               </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
