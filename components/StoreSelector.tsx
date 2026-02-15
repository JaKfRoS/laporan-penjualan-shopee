
import React, { useState } from 'react';
import { Store as StoreIcon, ChevronDown, Plus, Check } from 'lucide-react';
import { Store } from '../types';

interface StoreSelectorProps {
  stores: Store[];
  currentStore: Store | null;
  onSelect: (store: Store) => void;
  onAddStore: (name: string) => void;
}

export const StoreSelector: React.FC<StoreSelectorProps> = ({ stores, currentStore, onSelect, onAddStore }) => {
  const [isAdding, setIsAdding] = useState(false);
  const [newStoreName, setNewStoreName] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newStoreName.trim()) {
      onAddStore(newStoreName.trim());
      setNewStoreName('');
      setIsAdding(false);
    }
  };

  return (
    <div className="relative group">
      <button className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
        <StoreIcon className="w-4 h-4 text-slate-400" />
        <span className="max-w-[120px] truncate">{currentStore?.name || 'Select Store'}</span>
        <ChevronDown className="w-4 h-4 text-slate-400 ml-1" />
      </button>
      
      <div className="absolute right-0 top-full mt-2 w-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl hidden group-hover:block z-50 overflow-hidden">
        <div className="p-2 border-b border-slate-50 dark:border-slate-800/50 text-xs font-semibold text-slate-400 uppercase px-4 py-3 tracking-wider flex justify-between items-center">
          Daftar Toko
          <button 
            onClick={() => setIsAdding(!isAdding)}
            className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded text-orange-600"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {isAdding && (
          <form onSubmit={handleSubmit} className="p-3 border-b border-slate-50 dark:border-slate-800 bg-orange-50/30 dark:bg-orange-500/5">
            <div className="flex gap-2">
              <input 
                autoFocus
                type="text"
                placeholder="Nama toko baru..."
                value={newStoreName}
                onChange={(e) => setNewStoreName(e.target.value)}
                className="flex-1 px-2 py-1 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded outline-none focus:ring-1 focus:ring-orange-500 dark:text-white"
              />
              <button type="submit" className="p-1 bg-orange-600 text-white rounded">
                <Check className="w-3 h-3" />
              </button>
            </div>
          </form>
        )}

        <div className="max-h-60 overflow-y-auto custom-scrollbar">
          {stores.map((store) => (
            <button
              key={store.id}
              onClick={() => onSelect(store)}
              className={`w-full text-left px-4 py-3 text-sm transition-colors flex items-center justify-between ${
                currentStore?.id === store.id 
                ? 'bg-orange-50 dark:bg-orange-500/10 text-orange-600 font-semibold' 
                : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              <span className="truncate">{store.name}</span>
              {currentStore?.id === store.id && <Check className="w-3.5 h-3.5" />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
