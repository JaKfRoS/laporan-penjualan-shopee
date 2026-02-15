
import React from 'react';
import { Calendar } from 'lucide-react';

interface DateRangePickerProps {
  onChange: (range: { start: string, end: string }) => void;
}

export const DateRangePicker: React.FC<DateRangePickerProps> = ({ onChange }) => {
  return (
    <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg p-1">
      <div className="flex items-center gap-2 px-3 py-1.5 border-r border-slate-100">
        <Calendar className="w-4 h-4 text-slate-400" />
        <span className="text-sm font-medium text-slate-600">Period:</span>
      </div>
      <div className="flex items-center gap-2 px-3 py-1">
        <input 
          type="date" 
          onChange={(e) => onChange({ start: e.target.value, end: '' })}
          className="text-sm text-slate-600 outline-none cursor-pointer" 
        />
        <span className="text-slate-300">to</span>
        <input 
          type="date" 
          onChange={(e) => onChange({ start: '', end: e.target.value })}
          className="text-sm text-slate-600 outline-none cursor-pointer" 
        />
      </div>
    </div>
  );
};
