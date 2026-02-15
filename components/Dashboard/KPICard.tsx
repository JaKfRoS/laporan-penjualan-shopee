
import React from 'react';
import { TrendingUp, TrendingDown, Activity } from 'lucide-react';

interface KPICardProps {
  title: string;
  value: string | number;
  trend: string;
  icon?: React.ReactNode;
  isNegative?: boolean;
  isHighlight?: boolean;
}

export const KPICard: React.FC<KPICardProps> = ({ title, value, trend, icon, isNegative, isHighlight }) => {
  return (
    <div className={`p-6 rounded-[2rem] shadow-sm border transition-all duration-300 group ${
      isHighlight 
        ? 'bg-orange-600 border-orange-500 shadow-orange-500/20' 
        : 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800 hover:shadow-xl hover:-translate-y-1'
    }`}>
      <div className="flex justify-between items-start mb-4">
        <div className="flex items-center gap-2">
          <div className={`p-1.5 rounded-lg transition-colors ${
            isHighlight ? 'bg-white/20' : 'bg-slate-50 dark:bg-slate-800 group-hover:bg-orange-50 dark:group-hover:bg-orange-500/10'
          }`}>
            {icon || <Activity className={`w-3.5 h-3.5 ${isHighlight ? 'text-white' : 'text-slate-400 group-hover:text-orange-600'}`} />}
          </div>
          <h4 className={`text-[10px] font-black uppercase tracking-[0.15em] ${
            isHighlight ? 'text-orange-100' : 'text-slate-400 dark:text-slate-500'
          }`}>{title}</h4>
        </div>
        <div className={`flex items-center gap-1 text-[10px] font-black px-2 py-1 rounded-full ${
          isHighlight 
            ? 'bg-white/20 text-white' 
            : isNegative
              ? 'bg-red-100 dark:bg-red-500/10 text-red-700 dark:text-red-500'
              : 'bg-green-100 dark:bg-green-500/10 text-green-700 dark:text-green-500'
        }`}>
          {trend}
        </div>
      </div>
      <div className={`text-2xl font-black tracking-tight ${
        isHighlight ? 'text-white' : 'text-slate-900 dark:text-white'
      }`}>{value}</div>
      
      <div className="mt-4 h-1 w-full bg-black/5 dark:bg-white/5 rounded-full overflow-hidden">
        <div 
          className={`h-full rounded-full transition-all duration-1000 ${
            isHighlight ? 'bg-white' : isNegative ? 'bg-red-500' : 'bg-orange-500'
          }`}
          style={{ width: '70%' }}
        />
      </div>
    </div>
  );
};
