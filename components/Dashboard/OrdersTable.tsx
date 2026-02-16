
import React, { useState, useRef, useEffect } from 'react';
import { Order, Store } from '../../types';
import { format } from 'date-fns';
import { Search, Filter, ExternalLink, ChevronDown, Check, ChevronLeft, ChevronRight, Store as StoreIcon } from 'lucide-react';

interface OrdersTableProps {
  orders: Order[];
  stores?: Store[];
}

export const OrdersTable: React.FC<OrdersTableProps> = ({ orders, stores }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  
  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  
  // State untuk custom dropdown
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  // Menutup dropdown saat klik di luar
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
        setIsFilterOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Reset page saat filter berubah
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, statusFilter]);

  const filteredOrders = orders.filter(o => {
    const matchesSearch = o.order_id.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         (o.buyer_username || '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'All' || o.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const statuses = ['All', ...Array.from(new Set(orders.map(o => o.status)))];

  // Pagination Logic
  const totalPages = Math.ceil(filteredOrders.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const currentOrders = filteredOrders.slice(startIndex, startIndex + itemsPerPage);

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
    }
  };

  const getStoreName = (storeId: string) => {
    if (!stores) return null;
    return stores.find(s => s.id === storeId)?.name || 'Toko tidak dikenal';
  };

  const showStoreColumn = stores && stores.length > 0;

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 overflow-hidden transition-colors">
      <div className="p-6 border-b border-slate-50 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h3 className="text-lg font-semibold text-slate-800 dark:text-white">Recent Orders</h3>
        <div className="flex items-center gap-3">
          
          {/* Search Input */}
          <div className="relative flex-1 sm:flex-none">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search ID or Buyer..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-700 dark:text-slate-200 focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 outline-none transition-all w-full sm:w-64"
            />
          </div>

          {/* Custom Filter Dropdown (Pengganti Select) */}
          <div className="relative" ref={filterRef}>
            <button
              onClick={() => setIsFilterOpen(!isFilterOpen)}
              className={`flex items-center gap-2 px-4 py-2 border rounded-xl text-sm font-medium transition-all ${
                isFilterOpen 
                  ? 'bg-orange-50 dark:bg-orange-500/10 border-orange-500 text-orange-700 dark:text-orange-400' 
                  : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
              }`}
            >
              <Filter className={`w-4 h-4 ${isFilterOpen ? 'text-orange-500' : 'text-slate-400'}`} />
              <span>{statusFilter === 'All' ? 'Semua Status' : statusFilter}</span>
              <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${isFilterOpen ? 'rotate-180 text-orange-500' : ''}`} />
            </button>

            {isFilterOpen && (
              <div className="absolute right-0 top-full mt-2 w-56 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl z-20 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                <div className="p-2">
                  <div className="px-3 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-50 dark:border-slate-800/50 mb-1">
                    Filter Status Pesanan
                  </div>
                  <div className="max-h-60 overflow-y-auto custom-scrollbar">
                    {statuses.map((status) => (
                      <button
                        key={status}
                        onClick={() => {
                          setStatusFilter(status);
                          setIsFilterOpen(false);
                        }}
                        className={`w-full text-left px-3 py-2.5 rounded-xl text-sm flex items-center justify-between transition-all mb-0.5 ${
                          statusFilter === status
                            ? 'bg-orange-50 dark:bg-orange-500/10 text-orange-700 dark:text-orange-400 font-bold'
                            : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                        }`}
                      >
                        {status}
                        {statusFilter === status && <Check className="w-3.5 h-3.5 text-orange-600" />}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

        </div>
      </div>

      <div className="overflow-x-auto custom-scrollbar">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-800/50">
              <th className="px-6 py-4 text-xs font-black text-slate-400 uppercase tracking-wider">Order ID</th>
              {showStoreColumn && (
                <th className="px-6 py-4 text-xs font-black text-slate-400 uppercase tracking-wider">Toko</th>
              )}
              <th className="px-6 py-4 text-xs font-black text-slate-400 uppercase tracking-wider">Date</th>
              <th className="px-6 py-4 text-xs font-black text-slate-400 uppercase tracking-wider">Buyer</th>
              <th className="px-6 py-4 text-xs font-black text-slate-400 uppercase tracking-wider">Status</th>
              <th className="px-6 py-4 text-xs font-black text-slate-400 uppercase tracking-wider">Net Revenue</th>
              <th className="px-6 py-4 text-xs font-black text-slate-400 uppercase tracking-wider">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {currentOrders.map((order) => (
              <tr key={order.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                <td className="px-6 py-4 text-sm font-bold text-slate-900 dark:text-white">{order.order_id}</td>
                {showStoreColumn && (
                  <td className="px-6 py-4 text-sm">
                    <div className="inline-flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-2 py-1 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-700">
                      <StoreIcon className="w-3 h-3" />
                      <span className="truncate max-w-[120px]">{getStoreName(order.store_id)}</span>
                    </div>
                  </td>
                )}
                <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-400">{format(new Date(order.order_date), 'MMM dd, yyyy')}</td>
                <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-400">{order.buyer_username || '-'}</td>
                <td className="px-6 py-4 text-sm">
                  <span className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${
                    order.status === 'Selesai' 
                      ? 'bg-green-100 dark:bg-green-500/10 text-green-700 dark:text-green-400 border-green-200 dark:border-green-500/20' 
                      : order.status?.includes('Batal') || order.status?.includes('Dibatalkan')
                      ? 'bg-red-100 dark:bg-red-500/10 text-red-700 dark:text-red-400 border-red-200 dark:border-red-500/20' 
                      : 'bg-blue-100 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-500/20'
                  }`}>
                    {order.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm font-black text-slate-900 dark:text-white">
                  Rp {order.net_revenue.toLocaleString()}
                </td>
                <td className="px-6 py-4 text-sm">
                  <button className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-orange-600 transition-all">
                    <ExternalLink className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filteredOrders.length === 0 && (
        <div className="py-12 text-center flex flex-col items-center justify-center">
          <Search className="w-12 h-12 text-slate-200 dark:text-slate-700 mb-3" />
          <p className="text-slate-500 dark:text-slate-400 text-sm font-medium">No orders found matching your criteria.</p>
        </div>
      )}

      {/* Pagination Footer */}
      {filteredOrders.length > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between px-6 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 gap-4">
          
          <div className="flex items-center gap-4">
            <div className="text-xs text-slate-500 dark:text-slate-400 font-medium">
              Showing <span className="font-bold text-slate-900 dark:text-white">{startIndex + 1}</span> to <span className="font-bold text-slate-900 dark:text-white">{Math.min(startIndex + itemsPerPage, filteredOrders.length)}</span> of <span className="font-bold text-slate-900 dark:text-white">{filteredOrders.length}</span> entries
            </div>

            <select
              value={itemsPerPage}
              onChange={(e) => {
                setItemsPerPage(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 rounded-lg px-2 py-1 outline-none focus:ring-2 focus:ring-orange-500/20 cursor-pointer"
            >
              <option value={10}>10 Baris</option>
              <option value={20}>20 Baris</option>
              <option value={50}>50 Baris</option>
            </select>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 1}
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all text-slate-600 dark:text-slate-300"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                 // Simple logic to show near current page
                 let p = i + 1;
                 if (totalPages > 5 && currentPage > 3) {
                   p = currentPage - 2 + i;
                 }
                 if (p > totalPages) return null;
                 
                 return (
                  <button
                    key={p}
                    onClick={() => handlePageChange(p)}
                    className={`w-8 h-8 text-xs font-bold rounded-lg transition-all ${
                      currentPage === p
                        ? 'bg-orange-600 text-white shadow-md shadow-orange-500/20'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-800'
                    }`}
                  >
                    {p}
                  </button>
                 );
              })}
            </div>
            <button
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all text-slate-600 dark:text-slate-300"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
