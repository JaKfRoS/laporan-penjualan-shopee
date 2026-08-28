
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
    <div className={`p-4 rounded-2xl shadow-sm border transition-all duration-300 group relative flex flex-col justify-between gap-3 h-full min-h-[116px] w-full overflow-hidden ${
      isHighlight
        ? 'bg-orange-600 border-orange-500 shadow-orange-500/20 text-white'
        : 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800 hover:shadow-md'
    }`}>
      {description && (
        <div className="absolute top-3 right-3 z-10 group/info">
          <Info className={`w-3.5 h-3.5 cursor-help ${isHighlight ? 'text-white/60 hover:text-white' : 'text-slate-300 hover:text-slate-500'}`} />
          <div className="absolute right-0 top-6 w-44 p-2 bg-slate-800 text-white text-[10px] rounded-lg opacity-0 group-hover/info:opacity-100 transition-opacity pointer-events-none z-20 shadow-lg border border-slate-700">
            {description}
          </div>
        </div>
      )}

      {/* Fixed-height header keeps the value row aligned across cards whether the
          title fits on one line or wraps to two. */}
      <div className="flex items-center gap-2 min-h-[30px] pr-5">
        <div className={`p-1.5 rounded-lg shrink-0 transition-colors ${
          isHighlight ? 'bg-white/20' : 'bg-slate-50 dark:bg-slate-800 group-hover:bg-orange-50 dark:group-hover:bg-orange-500/10'
        }`}>
          {React.isValidElement<{ className?: string }>(icon)
            ? React.cloneElement(icon, {
                className: `${icon.props.className || ''} ${isHighlight ? 'text-white' : 'text-slate-400 group-hover:text-orange-600'}`
              })
            : icon || <Activity className={`w-4 h-4 ${isHighlight ? 'text-white' : 'text-slate-400 group-hover:text-orange-600'}`} />
          }
        </div>
        <h4 className={`text-[10px] sm:text-[11px] font-bold uppercase tracking-wide leading-tight line-clamp-2 ${
          isHighlight ? 'text-orange-100' : 'text-slate-500 dark:text-slate-400'
        }`}>{title}</h4>
      </div>

      <div className="flex flex-col gap-1.5 min-w-0">
        <div className={`text-base sm:text-lg font-black tracking-tight leading-tight tabular-nums break-words ${
          isHighlight ? 'text-white' : 'text-slate-900 dark:text-white'
        }`}>
          {value}
        </div>

        <div className={`inline-flex items-center w-fit max-w-full gap-1 text-[9px] sm:text-[10px] font-bold px-2 py-0.5 rounded-full truncate ${
          isHighlight
            ? 'bg-white/20 text-white'
            : isNegative
              ? 'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400'
              : 'bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-400'
        }`}>
          {trend}
        </div>
      </div>
    </div>
  );
};
