
import React from 'react';
import { TrendingUp, TrendingDown, Activity, Info } from 'lucide-react';

interface KPICardProps {
  title: string;
  value: string | number;
  trend: string;
  icon?: React.ReactNode;
  isNegative?: boolean;
  isHighlight?: boolean;
  description?: string;
}

export const KPICard: React.FC<KPICardProps> = ({ title, value, trend, icon, isNegative, isHighlight, description }) => {
  return (
    <div className={`p-4 md:p-6 rounded-[1.5rem] md:rounded-[2rem] shadow-sm border transition-all duration-300 group relative ${
      isHighlight 
        ? 'bg-orange-600 border-orange-500 shadow-orange-500/20' 
        : 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800 hover:shadow-xl hover:-translate-y-1'
    }`}>
      {description && (
        <div className="absolute top-4 right-4 z-10 group/info">
          <Info className={`w-4 h-4 cursor-help ${isHighlight ? 'text-white/60 hover:text-white' : 'text-slate-400 hover:text-slate-600'}`} />
          <div className="absolute right-0 top-6 w-48 p-2 bg-slate-800 text-white text-xs rounded-lg opacity-0 group-hover/info:opacity-100 transition-opacity pointer-events-none z-20 shadow-lg">
            {description}
          </div>
        </div>
      )}
      <div className="flex flex-col md:flex-row md:justify-between items-start gap-2 md:gap-0 mb-2 md:mb-4">
        <div className="flex items-center gap-2">
          <div className={`p-1.5 rounded-lg transition-colors ${
            isHighlight ? 'bg-white/20' : 'bg-slate-50 dark:bg-slate-800 group-hover:bg-orange-50 dark:group-hover:bg-orange-500/10'
          }`}>
            {icon || <Activity className={`w-3.5 h-3.5 ${isHighlight ? 'text-white' : 'text-slate-400 group-hover:text-orange-600'}`} />}
          </div>
          <h4 className={`text-[9px] md:text-[10px] font-black uppercase tracking-[0.1em] md:tracking-[0.15em] leading-tight ${
            isHighlight ? 'text-orange-100' : 'text-slate-400 dark:text-slate-500'
          }`}>{title}</h4>
        </div>
        <div className={`self-start md:self-auto flex items-center gap-1 text-[9px] md:text-[10px] font-black px-2 py-0.5 md:py-1 rounded-full whitespace-nowrap ${
          isHighlight 
            ? 'bg-white/20 text-white' 
            : isNegative
              ? 'bg-red-100 dark:bg-red-500/10 text-red-700 dark:text-red-500'
              : 'bg-green-100 dark:bg-green-500/10 text-green-700 dark:text-green-500'
        }`}>
          {trend}
        </div>
      </div>
      <div className={`text-lg md:text-2xl font-black tracking-tight ${
        isHighlight ? 'text-white' : 'text-slate-900 dark:text-white'
      }`}>{value}</div>
      
      <div className="mt-2 md:mt-4 h-1 w-full bg-black/5 dark:bg-white/5 rounded-full overflow-hidden">
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
