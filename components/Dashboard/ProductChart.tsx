import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../services/supabase';
import { chunk, mapWithConcurrency } from '../../services/concurrency';
import { Package, ShoppingBag, TrendingUp, AlertCircle } from 'lucide-react';
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
  const [productLineItems, setProductLineItems] = useState<any[]>([]);
  const [loadingLineItems, setLoadingLineItems] = useState(false);

  // Fetch product_line_items for accurate revenue
  useEffect(() => {
    const fetchLineItems = async () => {
      if (orders.length === 0) {
        setProductLineItems([]);
        return;
      }
      setLoadingLineItems(true);
      try {
        const orderIds = orders.map(o => o.order_id);
        // Was a serial loop: one round-trip per 100 orders, so a busy month cost
        // dozens of sequential requests before the top-products panel appeared.
        const results = await mapWithConcurrency(chunk(orderIds, 150), 5, async (ids) => {
          let query = supabase.from('product_line_items').select('*').in('order_id', ids);
          if (allStoreIds && allStoreIds.length > 0) {
             query = query.in('store_id', allStoreIds);
          } else {
             query = query.eq('store_id', storeId);
          }
          const { data, error } = await query;
          return data && !error ? data : [];
        });
        setProductLineItems(results.flat());
      } catch (err) {
        console.error('Error fetching product line items', err);
      } finally {
        setLoadingLineItems(false);
      }
    };
    
    fetchLineItems();
  }, [orders, storeId, allStoreIds]);

  // 1. Hitung Top 10 dari product_line_items atau fallback ke order_items
  const topProducts = useMemo(() => {
    const totals: Record<string, { total: number; qty: number; name: string, variation: string }> = {};
    
    // Build a set of order_ids that have product_line_items
    const ordersWithLineItems = new Set(productLineItems.map(p => p.order_id));

    // A. Add data from product_line_items
    productLineItems.forEach(item => {
      const name = item.product_name.trim();
      const variation = item.variation_name ? String(item.variation_name).trim() : '';
      const key = `${name}:::${variation}`;
      
      if (!totals[key]) totals[key] = { name, variation, total: 0, qty: 0 };
      totals[key].total += Number(item.net_revenue) || 0;
      totals[key].qty += Number(item.quantity) || 1;
    });

    // B. Fallback to order_items for orders that don't have product_line_items
    orders.forEach(order => {
      if (!ordersWithLineItems.has(order.order_id) && order.order_items) {
        order.order_items.forEach((item: any) => {
          const name = item.product_name.trim();
          const variation = item.variation ? String(item.variation).trim() : '';
          const key = `${name}:::${variation}`;
          
          if (!totals[key]) totals[key] = { name, variation, total: 0, qty: 0 };
          totals[key].total += item.product_total || 0; // fallback to gross
          totals[key].qty += item.quantity || 0;
        });
      }
    });

    return Object.values(totals)
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [orders, productLineItems]);

  // 2. Fetch data 30 hari terakhir untuk top 10 produk tersebut
  useEffect(() => {
    if (topProducts.length > 0) {
      fetch30DaysRevenue();
    }
  }, [topProducts, storeId, allStoreIds]);

  const fetch30DaysRevenue = async () => {
    setLoading30Days(true);
    try {
      // Create search keys (name + variation)
      const targetKeys = topProducts.map(p => `${p.name}:::${p.variation}`);
      const thirtyDaysAgo = format(subDays(new Date(), 30), 'yyyy-MM-dd');
      
      // We will just do a simplified fallback check for the last 30 days
      // For performance, we fetch order_items. It won't have perfect net_revenue but it shows the trend.
      const names = Array.from(new Set(topProducts.map(p => p.name)));
      
      let query = supabase
        .from('orders')
        .select(`
          order_id,
          order_date,
          store_id,
          order_items!inner(product_name, variation, product_total)
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
          const key = `${item.product_name.trim()}:::${item.variation ? String(item.variation).trim() : ''}`;
          if (targetKeys.includes(key)) {
            totals30[key] = (totals30[key] || 0) + (item.product_total || 0);
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
        <h3 className="text-lg font-bold text-slate-800 dark:text-white">10 Produk Teratas</h3>
        <p className="text-slate-400 text-sm mt-2 font-medium">Belum ada data produk untuk periode ini</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">10 Produk & Variasi Terlaris</h3>
        </div>
        {loadingLineItems && <div className="text-xs text-slate-400 animate-pulse">Menghitung analitik variasi...</div>}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 sm:gap-4">
        {topProducts.map((product, index) => {
          const key = `${product.name}:::${product.variation}`;
          return (
          <div
            key={index}
            className="group bg-white dark:bg-slate-900 rounded-lg sm:rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm hover:shadow-md transition-all duration-300 overflow-hidden flex flex-col p-2 sm:p-4 relative"
            id={`top-product-card-${index}`}
          >
            <div className="absolute top-0 left-0 w-6 h-6 sm:w-8 sm:h-8 bg-slate-900 dark:bg-white text-white dark:text-slate-900 flex items-center justify-center font-black rounded-br-lg sm:rounded-br-xl z-10 text-[10px] sm:text-xs">
              #{index + 1}
            </div>

            {/* Image Placeholder */}
            <div className="w-full aspect-square bg-slate-50 dark:bg-slate-800/50 rounded-md sm:rounded-lg mb-2 sm:mb-4 flex items-center justify-center border border-slate-100 dark:border-slate-800 relative overflow-hidden">
               <div className="relative">
                 <Package className="w-8 h-8 sm:w-12 sm:h-12 text-slate-200 dark:text-slate-700" />
               </div>
            </div>

            {/* Product Info */}
            <div className="mb-2 sm:mb-4 text-center">
              <h4 className="text-[11px] sm:text-sm font-bold text-slate-800 dark:text-white line-clamp-2 min-h-[2rem] sm:min-h-[2.5rem] leading-tight mb-1" title={product.name}>
                {product.name}
              </h4>
              {product.variation && (
                <span className="inline-block px-1.5 sm:px-2 py-0.5 bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 text-[9px] sm:text-[10px] font-bold rounded-md truncate max-w-full">
                  {product.variation}
                </span>
              )}
            </div>

            <div className="w-full space-y-1 sm:space-y-2 mb-2 sm:mb-4 mt-auto">
              <div className="flex justify-between items-center text-[10px] sm:text-[11px] leading-tight">
                <span className="text-slate-500 font-medium">Qty:</span>
                <span className="text-slate-900 dark:text-slate-300 font-bold">{product.qty} pcs</span>
              </div>
              <div className="flex justify-between items-center text-[10px] sm:text-[11px] leading-tight">
                <span className="text-slate-500 font-medium">Revenue:</span>
                <span className="text-green-600 font-black">Rp {(product.total / 1000000).toFixed(1)}jt</span>
              </div>
            </div>

            {/* 30 Days Badge Footer */}
            <div className="mt-2 sm:mt-4 pt-2 flex items-center justify-between gap-1 sm:gap-2 border-t border-slate-50 dark:border-slate-800">
               <div className="bg-orange-500 text-white text-[7px] sm:text-[8px] font-black px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-[4px] uppercase whitespace-nowrap">
                  30hr
               </div>
               <span className="text-[10px] sm:text-[11px] font-black text-orange-500">
                 {loading30Days ? '...' : `Rp ${((last30DaysData[key] || 0) / 1000000).toFixed(1)}jt`}
               </span>
            </div>
          </div>
        )})}
      </div>
    </div>
  );
};
