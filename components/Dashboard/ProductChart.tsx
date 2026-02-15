
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
      const { data: items, error } = await supabase
        .from('order_items')
        .select(`
          product_name,
          product_total,
          order_id
        `);

      if (error) throw error;

      // Manually aggregate since we need to join or filter by store_id
      const totals: Record<string, number> = {};
      items.forEach(item => {
        totals[item.product_name] = (totals[item.product_name] || 0) + item.product_total;
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
      </div>
    </div>
  );
};
