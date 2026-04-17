
import React, { useState, useEffect } from 'react';
import { Calendar, RotateCcw, CheckCircle2 } from 'lucide-react';

interface DateRangePickerProps {
  start: string;
  end: string;
  onChange: (range: { start: string, end: string }) => void;
}

export const DateRangePicker: React.FC<DateRangePickerProps> = ({ start, end, onChange }) => {
  const formatDate = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const [localStartDate, setLocalStartDate] = useState(start);
  const [localEndDate, setLocalEndDate] = useState(end);
  const [activePreset, setActivePreset] = useState<string>('');

  // Sync local state when props change (important for mode switching or external resets)
  useEffect(() => {
    setLocalStartDate(start);
    setLocalEndDate(end);
  }, [start, end]);

  const applyPreset = (preset: string) => {
    setActivePreset(preset);
    const today = new Date();
    let startStr = '';
    let endStr = '';

    switch (preset) {
      case 'today':
        startStr = formatDate(today);
        endStr = formatDate(today);
        break;
      case 'yesterday':
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        startStr = formatDate(yesterday);
        endStr = formatDate(yesterday);
        break;
      case 'last7':
        const last7 = new Date(today);
        last7.setDate(last7.getDate() - 6);
        startStr = formatDate(last7);
        endStr = formatDate(today);
        break;
      case 'thisMonth':
        const startMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        const endMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        startStr = formatDate(startMonth);
        endStr = formatDate(endMonth);
        break;
      default:
        break;
    }
    
    setLocalStartDate(startStr);
    setLocalEndDate(endStr);
    onChange({ start: startStr, end: endStr });
  };

  const handleManualChange = (type: 'start' | 'end', value: string) => {
    setActivePreset(''); 
    if (type === 'start') setLocalStartDate(value);
    else setLocalEndDate(value);
  };

  const handleApply = () => {
    onChange({ start: localStartDate, end: localEndDate });
  };

  const handleReset = () => {
    setLocalStartDate('');
    setLocalEndDate('');
    setActivePreset('');
    onChange({ start: '', end: '' });
  };

  const presets = [
    { id: 'today', label: 'Hari Ini' },
    { id: 'yesterday', label: 'Kemarin' },
    { id: 'last7', label: '7 Hari' },
    { id: 'thisMonth', label: 'Bulan Ini' },
  ];

  const hasUnappliedChanges = localStartDate !== start || localEndDate !== end;
  const hasValues = localStartDate || localEndDate;

  return (
    <div className="flex flex-wrap items-center gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-2 shadow-sm w-full">
      {/* Presets Row - Scrollable on mobile, wraps on larger screens */}
      <div className="flex items-center gap-1.5 overflow-x-auto lg:overflow-visible custom-scrollbar w-full sm:w-auto pb-1 sm:pb-0 shrink-0">
        <Calendar className="w-4 h-4 text-slate-400 ml-1.5 mr-1 shrink-0 hidden sm:block" />
        {presets.map(p => (
          <button
            key={p.id}
            onClick={() => applyPreset(p.id)}
            className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg whitespace-nowrap transition-all shrink-0 ${
              activePreset === p.id 
                ? 'bg-orange-600 text-white shadow-md shadow-orange-500/20' 
                : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 border border-transparent'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="h-5 w-px bg-slate-200 dark:bg-slate-800 hidden lg:block shrink-0 mx-1"></div>

      {/* Manual Inputs - Wraps to next line if needed */}
      <div className="flex flex-1 items-center gap-2 min-w-[300px] w-full sm:w-auto">
        <div className="relative group flex-1 sm:flex-none sm:w-36">
           <input 
             type="date" 
             value={localStartDate}
             onChange={(e) => handleManualChange('start', e.target.value)}
             className={`w-full min-w-0 px-3 py-1.5 border rounded-lg text-[10px] font-black outline-none focus:ring-2 focus:ring-orange-500/20 transition-all cursor-pointer uppercase tracking-tight ${
               hasUnappliedChanges 
                 ? 'bg-orange-50 border-orange-300 text-orange-900' 
                 : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
             }`}
           />
        </div>
        <span className="text-slate-300 dark:text-slate-600 font-bold text-[10px] shrink-0 uppercase tracking-tighter">s/d</span>
        <div className="relative group flex-1 sm:flex-none sm:w-36">
           <input 
             type="date" 
             value={localEndDate}
             min={localStartDate}
             onChange={(e) => handleManualChange('end', e.target.value)}
             className={`w-full min-w-0 px-3 py-1.5 border rounded-lg text-[10px] font-black outline-none focus:ring-2 focus:ring-orange-500/20 transition-all cursor-pointer uppercase tracking-tight ${
               hasUnappliedChanges 
                 ? 'bg-orange-50 border-orange-300 text-orange-900' 
                 : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
             }`} 
           />
        </div>
        
        {/* Tombol Action */}
        <div className="flex items-center gap-1 shrink-0">
          {hasUnappliedChanges && (
            <button
              onClick={handleApply}
              className="flex items-center gap-1 px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white text-[10px] font-bold rounded-lg transition-all animate-in zoom-in duration-200 shadow-md shadow-orange-500/20"
            >
              <CheckCircle2 className="w-3 h-3" />
              <span>Apply</span>
            </button>
          )}

          {hasValues && !hasUnappliedChanges && (
            <button 
              onClick={handleReset}
              className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all"
              title="Reset Filter"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
