
import React from 'react';
import { LayoutDashboard, UploadCloud, Settings, LogOut, BarChart3, Moon, Sun, Megaphone, Calculator, PackageSearch } from 'lucide-react';

interface SidebarProps {
  activeTab: 'dashboard' | 'import' | 'settings' | 'ads' | 'calculator' | 'products';
  setActiveTab: (tab: 'dashboard' | 'import' | 'settings' | 'ads' | 'calculator' | 'products') => void;
  isDarkMode: boolean;
  toggleDarkMode: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab, isDarkMode, toggleDarkMode }) => {
  const menuItems = [
    { id: 'dashboard', label: 'Sales Dashboard', icon: LayoutDashboard },
    { id: 'products', label: 'Produk & HPP', icon: PackageSearch },
    { id: 'ads', label: 'Ads & Pemasaran', icon: Megaphone },
    { id: 'calculator', label: 'Kalkulator Harga', icon: Calculator },
    { id: 'import', label: 'Import Data', icon: UploadCloud },
    { id: 'settings', label: 'Pengaturan', icon: Settings },
  ];

  return (
    <aside className="w-64 h-full overflow-y-auto bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col hidden md:flex transition-colors">
      <div className="p-6">
        <div className="flex items-center gap-2 text-orange-600 mb-8">
          <BarChart3 className="w-8 h-8" />
          <span className="text-xl font-bold tracking-tight dark:text-white">ShopeeSales</span>
        </div>

        <nav className="space-y-1">
          {menuItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id as any)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                  activeTab === item.id 
                    ? 'bg-orange-50 dark:bg-orange-500/10 text-orange-600 dark:text-orange-500 font-semibold shadow-sm' 
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <Icon className={`w-5 h-5 ${activeTab === item.id ? 'text-orange-600 dark:text-orange-500' : 'text-slate-400'}`} />
                {item.label}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="mt-auto p-6 space-y-4">
        <button 
          onClick={toggleDarkMode}
          className="w-full flex items-center justify-between px-4 py-2 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-all"
        >
          <span className="text-xs font-bold uppercase tracking-wider">Appearance</span>
          {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>

        <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-4 border border-slate-100 dark:border-slate-800">
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-500 uppercase tracking-wider mb-2">Need Help?</p>
          <p className="text-[11px] text-slate-600 dark:text-slate-400 mb-3 leading-tight">Check our documentation for CSV mapping guides.</p>
          <button className="text-xs font-bold text-orange-600 hover:text-orange-700">View Help Center &rarr;</button>
        </div>
      </div>
    </aside>
  );
};
