
import React, { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { supabase } from '../../services/supabase';

interface ProductChartProps {
  storeId: string;
}

export const ProductChart: React.FC<ProductChartProps> = ({ storeId }) => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTopProducts();
  }, [storeId]);

  const fetchTopProducts = async () => {
    try {
      // FIX: Filter berdasarkan store_id agar data toko lain tidak masuk
      const { data: items, error } = await supabase
        .from('order_items')
        .select(`
          product_name,
          product_total,
          store_id
        `)
        .eq('store_id', storeId); // Filter wajib di sini

      if (error) throw error;

      const totals: Record<string, number> = {};
      items.forEach(item => {
        // Normalisasi nama produk agar yang mirip digabung (opsional, basic trimming)
        const name = item.product_name.trim();
        totals[name] = (totals[name] || 0) + item.product_total;
      });

      const chartData = Object.entries(totals)
        .map(([name, total]) => ({ name: name.length > 20 ? name.substring(0, 20) + '...' : name, total }))
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
    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
      <h3 className="text-lg font-semibold text-slate-800 mb-6">Top 5 Products by Revenue</h3>
      <div className="h-64">
        {loading ? (
           <div className="w-full h-full flex items-center justify-center bg-slate-50 rounded-xl animate-pulse">
             <span className="text-slate-400 text-xs font-bold uppercase">Loading Data...</span>
           </div>
        ) : data.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
              <XAxis 
                type="number"
                axisLine={false} 
                tickLine={false} 
                tick={{ fontSize: 12, fill: '#64748b' }}
                tickFormatter={(value) => `Rp ${(value/1000).toFixed(0)}K`}
              />
              <YAxis 
                dataKey="name" 
                type="category"
                axisLine={false} 
                tickLine={false} 
                tick={{ fontSize: 11, fill: '#64748b' }}
                width={100}
              />
              <Tooltip 
                cursor={{ fill: '#f8fafc' }}
                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}
                formatter={(value: any) => [`Rp ${value.toLocaleString()}`, 'Total Revenue']}
              />
              <Bar dataKey="total" radius={[0, 4, 4, 0]}>
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 border-2 border-dashed border-slate-100 rounded-xl">
             <span className="text-xs font-bold uppercase">Belum ada data produk</span>
          </div>
        )}
      </div>
    </div>
  );
};
