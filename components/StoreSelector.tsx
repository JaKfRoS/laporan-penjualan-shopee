
import React, { useState, useRef, useEffect } from 'react';
import { Store as StoreIcon, ChevronDown, Plus, Check, X, Layers } from 'lucide-react';
import { Store } from '../types';

interface StoreSelectorProps {
  stores: Store[];
  currentStore: Store | null;
  onSelect: (store: Store) => void;
  onAddStore: (name: string) => void;
}

export const StoreSelector: React.FC<StoreSelectorProps> = ({ stores, currentStore, onSelect, onAddStore }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [newStoreName, setNewStoreName] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Menutup dropdown saat klik di luar area komponen
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setIsAdding(false);
      }
    }
    
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newStoreName.trim()) {
      onAddStore(newStoreName.trim());
      setNewStoreName('');
      setIsAdding(false);
    }
  };

  const handleSelect = (store: Store) => {
    onSelect(store);
    setIsOpen(false);
  };

  const handleSelectAll = () => {
    // Membuat dummy store object untuk 'Semua Toko'
    const allStore: Store = {
      id: 'all',
      name: 'Semua Toko',
      user_id: 'all',
      created_at: new Date().toISOString()
    };
    onSelect(allStore);
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-900 border transition-all duration-200 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 ${
          isOpen 
            ? 'border-orange-500 ring-2 ring-orange-500/20' 
            : 'border-slate-200 dark:border-slate-800'
        }`}
      >
        <div className={`p-1 rounded-full ${isOpen ? 'bg-orange-100 text-orange-600' : 'bg-slate-100 text-slate-500'}`}>
           {currentStore?.id === 'all' ? <Layers className="w-3.5 h-3.5" /> : <StoreIcon className="w-3.5 h-3.5" />}
        </div>
        <span className="max-w-[120px] truncate">{currentStore?.name || 'Pilih Toko'}</span>
        <ChevronDown className={`w-4 h-4 text-slate-400 ml-1 transition-transform duration-200 ${isOpen ? 'rotate-180 text-orange-500' : ''}`} />
      </button>
      
      {isOpen && (
        <div className="fixed md:absolute left-4 right-4 md:left-auto md:right-0 top-32 md:top-full md:mt-2 w-auto md:w-80 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl z-[100] overflow-hidden animate-in fade-in zoom-in-95 duration-200 origin-top md:origin-top-right">
          
          {/* Header Dropdown */}
          <div className="p-4 border-b border-slate-50 dark:border-slate-800/50 flex justify-between items-center bg-slate-50/80 dark:bg-slate-800/30 backdrop-blur-sm">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Daftar Toko ({stores.length})
            </span>
            <button 
              onClick={(e) => {
                e.stopPropagation();
                setIsAdding(!isAdding);
                if (!isAdding) setTimeout(() => document.getElementById('new-store-input')?.focus(), 100);
              }}
              className={`p-1.5 rounded-lg transition-all ${
                isAdding 
                  ? 'bg-red-50 text-red-600 hover:bg-red-100' 
                  : 'bg-white shadow-sm border border-slate-200 hover:bg-orange-50 hover:text-orange-600 hover:border-orange-200'
              }`}
              title={isAdding ? "Batal Tambah" : "Tambah Toko Baru"}
            >
              {isAdding ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
            </button>
          </div>

          {/* Form Tambah Toko */}
          {isAdding && (
            <div className="p-3 border-b border-slate-50 dark:border-slate-800 bg-orange-50/50 dark:bg-orange-900/10 animate-in slide-in-from-top-2">
              <form onSubmit={handleSubmit} className="flex gap-2">
                <input 
                  id="new-store-input"
                  type="text"
                  placeholder="Nama toko baru..."
                  value={newStoreName}
                  onChange={(e) => setNewStoreName(e.target.value)}
                  className="flex-1 px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-orange-200 dark:border-orange-800 rounded-lg outline-none focus:ring-2 focus:ring-orange-500/20 dark:text-white placeholder:text-slate-400 font-medium"
                />
                <button 
                  type="submit" 
                  disabled={!newStoreName.trim()}
                  className="p-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-orange-500/20 transition-all"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
              </form>
            </div>
          )}

          {/* List Toko */}
          <div className="max-h-[300px] overflow-y-auto custom-scrollbar p-2">
            {/* Opsi Semua Toko */}
            {stores.length > 0 && (
              <button
                onClick={handleSelectAll}
                className={`w-full text-left px-3 py-3 mb-1 rounded-xl text-sm transition-all flex items-center justify-between group relative overflow-hidden ${
                  currentStore?.id === 'all'
                  ? 'bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-400 font-bold border border-purple-100 dark:border-purple-500/20' 
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 border border-transparent'
                }`}
              >
                <div className="flex items-center gap-3 z-10 relative">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-black uppercase ${
                    currentStore?.id === 'all' ? 'bg-purple-200 text-purple-700' : 'bg-slate-100 text-slate-500 group-hover:bg-white group-hover:shadow-sm'
                  }`}>
                    <Layers className="w-4 h-4" />
                  </div>
                  <span className="truncate max-w-[160px]">Semua Toko</span>
                </div>
                {currentStore?.id === 'all' && (
                  <div className="bg-purple-100 dark:bg-purple-500/20 p-1 rounded-full">
                    <Check className="w-3 h-3 text-purple-600" />
                  </div>
                )}
              </button>
            )}

            {stores.length > 0 ? (
              stores.map((store) => (
                <button
                  key={store.id}
                  onClick={() => handleSelect(store)}
                  className={`w-full text-left px-3 py-3 mb-1 rounded-xl text-sm transition-all flex items-center justify-between group relative overflow-hidden ${
                    currentStore?.id === store.id 
                    ? 'bg-orange-50 dark:bg-orange-500/10 text-orange-700 dark:text-orange-400 font-bold border border-orange-100 dark:border-orange-500/20' 
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-3 z-10 relative">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-black uppercase ${
                      currentStore?.id === store.id ? 'bg-orange-200 text-orange-700' : 'bg-slate-100 text-slate-500 group-hover:bg-white group-hover:shadow-sm'
                    }`}>
                      {store.name.substring(0, 2)}
                    </div>
                    <span className="truncate max-w-[160px]">{store.name}</span>
                  </div>
                  {currentStore?.id === store.id && (
                    <div className="bg-orange-100 dark:bg-orange-500/20 p-1 rounded-full">
                      <Check className="w-3 h-3 text-orange-600" />
                    </div>
                  )}
                </button>
              ))
            ) : (
              <div className="py-8 text-center flex flex-col items-center gap-2 text-slate-400">
                <StoreIcon className="w-8 h-8 opacity-20" />
                <span className="text-xs italic">Belum ada toko.</span>
              </div>
            )}
          </div>
          
          {/* Footer Info */}
          <div className="px-4 py-2 bg-slate-50 dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 text-[10px] text-slate-400 text-center font-medium">
            Kelola toko Anda di sini
          </div>
        </div>
      )}
    </div>
  );
};
