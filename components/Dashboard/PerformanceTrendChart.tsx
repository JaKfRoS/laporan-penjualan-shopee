
import React, { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Order } from '../../types';
import { format, parseISO, eachDayOfInterval } from 'date-fns';

interface PerformanceTrendChartProps {
  orders: Order[];
  startDate: string;
  endDate: string;
}

export const PerformanceTrendChart: React.FC<PerformanceTrendChartProps> = ({ orders, startDate, endDate }) => {
  const chartData = useMemo(() => {
    const dailyData: Record<string, { revenue: number, orders: number }> = {};
    
    // Initialize all days in interval to ensure they are sorted and present
    try {
      const start = parseISO(startDate);
      const end = parseISO(endDate);
      const days = eachDayOfInterval({ start, end });
      
      days.forEach(day => {
        const dateStr = format(day, 'yyyy-MM-dd');
        dailyData[dateStr] = { revenue: 0, orders: 0 };
      });
    } catch (e) {
      // Fallback if dates are invalid
      return [];
    }

    orders.forEach(order => {
      try {
        const rawDate = order.order_date;
        if (rawDate) {
          const dateStr = format(parseISO(rawDate), 'yyyy-MM-dd');
          if (dailyData[dateStr]) {
            dailyData[dateStr].revenue += order.product_total || 0;
            dailyData[dateStr].orders += 1;
          }
        }
      } catch (e) {
        // Skip invalid date
      }
    });

    return Object.entries(dailyData)
      .map(([date, data]) => ({
        date,
        displayDate: format(parseISO(date), 'd'),
        month: format(parseISO(date), 'MMM'),
        fullDate: format(parseISO(date), 'dd-MM-yyyy'),
        revenue: data.revenue,
        orders: data.orders
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [orders, startDate, endDate]);

  // Custom Tooltip to match the image
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl shadow-2xl border border-slate-100 dark:border-slate-800">
          <p className="text-[10px] font-bold text-slate-400 uppercase mb-2 tracking-widest">{data.fullDate}</p>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-8">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-blue-500" />
                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Penjualan</span>
              </div>
              <span className="text-xs font-bold text-slate-900 dark:text-white">Rp {data.revenue.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between gap-8">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-orange-500" />
                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Pesanan</span>
              </div>
              <span className="text-xs font-bold text-slate-900 dark:text-white">{data.orders}</span>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-800 transition-colors">
      <div className="mb-8">
        <h3 className="text-sm font-black uppercase tracking-tight text-slate-900 dark:text-white">Tren Penjualan & Pesanan</h3>
        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Performa Harian</p>
      </div>
      
      <div style={{ width: '100%', height: 320, minHeight: 320 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis 
              dataKey="date" 
              axisLine={false} 
              tickLine={false} 
              tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 600 }} 
              dy={10}
              interval="preserveStartEnd"
              tickFormatter={(value) => format(parseISO(value), 'd')}
            />
            <YAxis 
              yAxisId="left"
              axisLine={false} 
              tickLine={false} 
              tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 600 }}
              tickFormatter={(value) => value === 0 ? '' : `Rp ${value >= 1000000 ? (value/1000000).toFixed(1) + 'M' : (value/1000).toFixed(0) + 'K'}`}
              width={60}
            />
            <YAxis 
              yAxisId="right"
              orientation="right"
              axisLine={false} 
              tickLine={false} 
              tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 600 }}
              width={30}
            />
            <Tooltip 
              content={<CustomTooltip />}
              cursor={{ stroke: '#e2e8f0', strokeWidth: 1, strokeDasharray: '5 5' }}
            />
            <Legend 
              verticalAlign="bottom" 
              align="center"
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ paddingTop: '20px', fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.05em' }}
            />
            <Line 
              yAxisId="left"
              type="linear" 
              dataKey="revenue" 
              name="Penjualan"
              stroke="#3b82f6" 
              strokeWidth={2.5}
              dot={{ r: 3, fill: '#3b82f6', strokeWidth: 0 }}
              activeDot={{ r: 5, strokeWidth: 0 }}
              animationDuration={1500}
            />
            <Line 
              yAxisId="right"
              type="linear" 
              dataKey="orders" 
              name="Pesanan"
              stroke="#f97316" 
              strokeWidth={2.5}
              dot={{ r: 3, fill: '#f97316', strokeWidth: 0 }}
              activeDot={{ r: 5, strokeWidth: 0 }}
              animationDuration={1500}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
