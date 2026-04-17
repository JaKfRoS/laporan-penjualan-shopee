
import React, { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { supabase } from '../../services/supabase';

interface ProductChartProps {
  storeId: string;
  allStoreIds?: string[]; // Jika storeId === 'all', gunakan array ini
}

export const ProductChart: React.FC<ProductChartProps> = ({ storeId, allStoreIds }) => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTopProducts();
  }, [storeId, allStoreIds]);

  const fetchTopProducts = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('order_items')
        .select(`
          product_name,
          product_total,
          store_id
        `);

      if (storeId === 'all' && allStoreIds && allStoreIds.length > 0) {
        query = query.in('store_id', allStoreIds);
      } else {
        query = query.eq('store_id', storeId);
      }

      const { data: items, error } = await query;

      if (error) throw error;

      const totals: Record<string, number> = {};
      if (items) {
        items.forEach(item => {
          // Normalisasi nama produk
          const name = item.product_name.trim();
          totals[name] = (totals[name] || 0) + item.product_total;
        });
      }

      const chartData = Object.entries(totals)
        .map(([name, total]) => ({ name: name, total }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 5);

      setData(chartData);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const COLORS = ['#f97316', '#fb923c', '#fdba74', '#fed7aa', '#ffedd5'];

  return (
    <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 transition-colors">
      <h3 className="text-lg font-semibold text-slate-800 dark:text-white mb-6">Top 5 Products by Revenue</h3>
      
      {/* PENTING: Div pembungkus dengan height pasti (300px) mencegah Recharts loop/crash */}
      <div style={{ width: '100%', height: 300, minHeight: 300 }}>
        {loading ? (
           <div className="w-full h-full flex items-center justify-center bg-slate-50 dark:bg-slate-800 rounded-xl animate-pulse">
             <span className="text-slate-400 text-xs font-bold uppercase">Loading Data...</span>
           </div>
        ) : data.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ left: 0, right: 30 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
              <XAxis 
                type="number"
                axisLine={false} 
                tickLine={false} 
                tick={{ fontSize: 10, fill: '#64748b' }}
                tickFormatter={(value) => `Rp ${(value/1000).toFixed(0)}K`}
              />
              <YAxis 
                dataKey="name" 
                type="category"
                axisLine={false} 
                tickLine={false} 
                tick={{ fontSize: 10, fill: '#64748b', fontWeight: 600 }}
                width={window.innerWidth < 640 ? 80 : 150}
                tickFormatter={(value) => value.length > (window.innerWidth < 640 ? 12 : 25) ? value.substring(0, (window.innerWidth < 640 ? 12 : 25)) + '...' : value}
              />
              <Tooltip 
                cursor={{ fill: '#f8fafc' }}
                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}
                formatter={(value: any) => [`Rp ${value.toLocaleString()}`, 'Total Revenue']}
                labelStyle={{ fontWeight: 'bold', color: '#1e293b' }}
              />
              <Bar dataKey="total" radius={[0, 4, 4, 0]} barSize={32}>
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 border-2 border-dashed border-slate-100 dark:border-slate-800 rounded-xl">
             <span className="text-xs font-bold uppercase">Belum ada data produk</span>
          </div>
        )}
      </div>
    </div>
  );
};
