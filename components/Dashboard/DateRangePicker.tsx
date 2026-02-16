
import React, { useState, useEffect } from 'react';
import { Calendar, RotateCcw, CheckCircle2 } from 'lucide-react';

interface DateRangePickerProps {
  onChange: (range: { start: string, end: string }) => void;
}

export const DateRangePicker: React.FC<DateRangePickerProps> = ({ onChange }) => {
  // Local state untuk input user, belum dikirim ke parent sampai klik apply
  const [localStartDate, setLocalStartDate] = useState('');
  const [localEndDate, setLocalEndDate] = useState('');
  
  // State untuk melacak apa yang terakhir dikirim ke parent (untuk membandingkan perubahan)
  const [appliedRange, setAppliedRange] = useState({ start: '', end: '' });
  
  const [activePreset, setActivePreset] = useState<string>('');

  // Native Date formatting helper
  const formatDate = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // 1. Handle Preset (Instant Action)
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
      case 'last30':
        const last30 = new Date(today);
        last30.setDate(last30.getDate() - 29);
        startStr = formatDate(last30);
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
    
    // Update local state visuals
    setLocalStartDate(startStr);
    setLocalEndDate(endStr);
    
    // Update tracking state
    setAppliedRange({ start: startStr, end: endStr });

    // Trigger parent immediately for presets
    onChange({ start: startStr, end: endStr });
  };

  // 2. Handle Manual Change (Delayed Action - Wait for Apply)
  const handleManualChange = (type: 'start' | 'end', value: string) => {
    setActivePreset(''); // Clear preset highlight
    if (type === 'start') setLocalStartDate(value);
    else setLocalEndDate(value);
  };

  // 3. Handle Apply Button Click
  const handleApply = () => {
    setAppliedRange({ start: localStartDate, end: localEndDate });
    onChange({ start: localStartDate, end: localEndDate });
  };

  const handleReset = () => {
    setLocalStartDate('');
    setLocalEndDate('');
    setAppliedRange({ start: '', end: '' });
    setActivePreset('');
    onChange({ start: '', end: '' });
  };

  const presets = [
    { id: 'today', label: 'Hari Ini' },
    { id: 'yesterday', label: 'Kemarin' },
    { id: 'last7', label: '7 Hari' },
    { id: 'thisMonth', label: 'Bulan Ini' },
  ];

  // Cek apakah ada perubahan yang belum diapply
  const hasUnappliedChanges = localStartDate !== appliedRange.start || localEndDate !== appliedRange.end;
  const hasValues = localStartDate || localEndDate;

  return (
    <div className="flex flex-col sm:flex-row items-center gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-2 shadow-sm">
      {/* Presets Row */}
      <div className="flex items-center gap-1 overflow-x-auto custom-scrollbar max-w-full pb-1 sm:pb-0">
        <Calendar className="w-5 h-5 text-slate-400 ml-2 mr-2 hidden sm:block" />
        {presets.map(p => (
          <button
            key={p.id}
            onClick={() => applyPreset(p.id)}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg whitespace-nowrap transition-all ${
              activePreset === p.id 
                ? 'bg-orange-100 dark:bg-orange-500/20 text-orange-700 dark:text-orange-400 border border-orange-200 dark:border-orange-500/20' 
                : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 border border-transparent'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="h-6 w-px bg-slate-200 dark:bg-slate-800 hidden sm:block"></div>

      {/* Manual Inputs */}
      <div className="flex items-center gap-2 w-full sm:w-auto">
        <div className="relative group flex-1 sm:flex-none">
           <input 
             type="date" 
             value={localStartDate}
             onChange={(e) => handleManualChange('start', e.target.value)}
             className={`w-full sm:w-auto pl-3 pr-2 py-1.5 border rounded-lg text-xs font-bold outline-none focus:ring-2 focus:ring-orange-500/20 transition-all cursor-pointer uppercase tracking-wider ${
               hasUnappliedChanges 
                 ? 'bg-orange-50 border-orange-300 text-orange-900' 
                 : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
             }`}
           />
        </div>
        <span className="text-slate-300 dark:text-slate-600 font-bold text-xs">s/d</span>
        <div className="relative group flex-1 sm:flex-none">
           <input 
             type="date" 
             value={localEndDate}
             min={localStartDate}
             onChange={(e) => handleManualChange('end', e.target.value)}
             className={`w-full sm:w-auto pl-3 pr-2 py-1.5 border rounded-lg text-xs font-bold outline-none focus:ring-2 focus:ring-orange-500/20 transition-all cursor-pointer uppercase tracking-wider ${
               hasUnappliedChanges 
                 ? 'bg-orange-50 border-orange-300 text-orange-900' 
                 : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
             }`} 
           />
        </div>
        
        {/* Tombol Action */}
        <div className="flex items-center gap-1">
          {hasUnappliedChanges && (
            <button
              onClick={handleApply}
              className="flex items-center gap-1 px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white text-xs font-bold rounded-lg transition-all animate-in zoom-in duration-200 shadow-md shadow-orange-500/20"
            >
              <CheckCircle2 className="w-3 h-3" />
              Terapkan
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
