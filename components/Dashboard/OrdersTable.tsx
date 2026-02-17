
import React, { useState, useRef, useEffect } from 'react';
import { Order, Store } from '../../types';
import { format } from 'date-fns';
import { Search, Filter, ExternalLink, ChevronDown, Check, ChevronLeft, ChevronRight, Store as StoreIcon, AlertCircle, Link, Eye, X, Package, ShoppingBag, Layers, Tag } from 'lucide-react';

interface OrdersTableProps {
  orders: Order[];
  stores?: Store[];
}

export const OrdersTable: React.FC<OrdersTableProps> = ({ orders, stores }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null); // State for Modal
  
  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  
  // State untuk custom dropdown
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
        setIsFilterOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, statusFilter]);

  const filteredOrders = orders.filter(o => {
    const itemsStr = o.order_items?.map(i => i.product_name).join(' ') || '';
    
    const matchesSearch = o.order_id.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         (o.buyer_username || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                         itemsStr.toLowerCase().includes(searchTerm.toLowerCase());
                         
    const matchesStatus = statusFilter === 'All' || o.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const statuses = ['All', ...Array.from(new Set(orders.map(o => o.status)))];

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
    <>
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 overflow-hidden transition-colors">
        <div className="p-4 md:p-6 border-b border-slate-50 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <h3 className="text-lg font-semibold text-slate-800 dark:text-white">Recent Orders</h3>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            
            {/* Search Input */}
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input 
                type="text" 
                placeholder="Search ID, Buyer or Product..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 pr-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-700 dark:text-slate-200 focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 outline-none transition-all w-full sm:w-64"
              />
            </div>

            {/* Custom Filter Dropdown */}
            <div className="relative" ref={filterRef}>
              <button
                onClick={() => setIsFilterOpen(!isFilterOpen)}
                className={`w-full sm:w-auto flex items-center justify-between sm:justify-center gap-2 px-4 py-2.5 border rounded-xl text-sm font-medium transition-all ${
                  isFilterOpen 
                    ? 'bg-orange-50 dark:bg-orange-500/10 border-orange-500 text-orange-700 dark:text-orange-400' 
                    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                }`}
              >
                <div className="flex items-center gap-2">
                   <Filter className={`w-4 h-4 ${isFilterOpen ? 'text-orange-500' : 'text-slate-400'}`} />
                   <span>{statusFilter === 'All' ? 'Semua Status' : statusFilter}</span>
                </div>
                <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${isFilterOpen ? 'rotate-180 text-orange-500' : ''}`} />
              </button>

              {isFilterOpen && (
                <div className="absolute right-0 top-full mt-2 w-full sm:w-56 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl z-20 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
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
                <th className="px-6 py-4 text-xs font-black text-slate-400 uppercase tracking-wider whitespace-nowrap">Order ID</th>
                <th className="px-6 py-4 text-xs font-black text-slate-400 uppercase tracking-wider">Date</th>
                {/* Product Column */}
                <th className="px-6 py-4 text-xs font-black text-slate-400 uppercase tracking-wider w-1/3">Produk & Variasi</th>
                {/* Mapping Status Column */}
                <th className="px-6 py-4 text-xs font-black text-slate-400 uppercase tracking-wider text-center">Status SKU</th>
                <th className="px-6 py-4 text-xs font-black text-slate-400 uppercase tracking-wider">Status</th>
                {/* NEW Total HPP Column */}
                <th className="px-6 py-4 text-xs font-black text-slate-400 uppercase tracking-wider whitespace-nowrap">Total HPP</th>
                <th className="px-6 py-4 text-xs font-black text-slate-400 uppercase tracking-wider whitespace-nowrap">Net Revenue</th>
                <th className="px-6 py-4 text-xs font-black text-slate-400 uppercase tracking-wider">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {currentOrders.map((order) => {
                const items = order.order_items || [];
                const firstItem = items[0];
                const remainingCount = items.length - 1;
                const isAllMapped = items.every(i => i.is_sku_mapped);
                
                // Calculate Total HPP
                const isCancelled = order.status?.toLowerCase().includes('batal') || order.status?.toLowerCase().includes('cancel') || order.status?.toLowerCase().includes('pengembalian');
                const totalHPP = isCancelled ? 0 : items.reduce((sum, item) => sum + ((item.hpp_at_time || 0) * (item.quantity || 1)), 0);

                return (
                <tr key={order.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group">
                  <td className="px-6 py-4 text-sm font-bold text-slate-900 dark:text-white">
                      <div className="flex flex-col">
                        <span>{order.order_id}</span>
                        {showStoreColumn && (
                          <div className="mt-1 flex items-center gap-1 text-[10px] text-slate-400 font-medium">
                              <StoreIcon className="w-3 h-3" />
                              <span className="truncate max-w-[100px]">{getStoreName(order.store_id)}</span>
                          </div>
                        )}
                      </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-400 whitespace-nowrap">{format(new Date(order.order_date), 'dd MMM yyyy')}</td>
                  
                  {/* Product Column - Clickable to Open Modal */}
                  <td 
                    className="px-6 py-4 cursor-pointer"
                    onClick={() => setSelectedOrder(order)}
                    title="Klik untuk lihat detail produk lengkap"
                  >
                      {firstItem ? (
                          <div className="flex flex-col group-hover:opacity-80 transition-opacity">
                              <span className="text-sm font-bold text-slate-800 dark:text-slate-200 line-clamp-2 leading-tight group-hover:text-orange-600 transition-colors">
                                  {firstItem.product_name}
                              </span>
                              
                              {/* VARIATION BADGE - IMPROVED VISIBILITY */}
                              {firstItem.variation && firstItem.variation !== '-' && (
                                  <div className="flex items-center gap-1 mt-1.5">
                                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-600 dark:text-slate-300 bg-slate-200/60 dark:bg-slate-700 px-2 py-0.5 rounded-md border border-slate-300 dark:border-slate-600">
                                      <Tag className="w-3 h-3" />
                                      {firstItem.variation}
                                    </span>
                                  </div>
                              )}
                              
                              {remainingCount > 0 && (
                                  <span className="text-[10px] font-bold text-blue-600 bg-blue-50 dark:bg-blue-900/20 px-1.5 py-0.5 rounded w-fit mt-1">
                                      +{remainingCount} produk lainnya
                                  </span>
                              )}
                              <span className="text-[10px] text-slate-400 mt-1">
                                  Buyer: {order.buyer_username || '-'}
                              </span>
                          </div>
                      ) : (
                          <span className="text-slate-400 italic text-xs">Detail produk tidak tersedia</span>
                      )}
                  </td>

                  {/* SKU Mapping Status */}
                  <td className="px-6 py-4 text-center">
                      {items.length > 0 ? (
                          isAllMapped ? (
                              <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800">
                                  <Link className="w-3 h-3" />
                                  <span className="text-[10px] font-bold">Terhubung</span>
                              </div>
                          ) : (
                              <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800 animate-pulse">
                                  <AlertCircle className="w-3 h-3" />
                                  <span className="text-[10px] font-bold">Perlu Mapping</span>
                              </div>
                          )
                      ) : (
                          <span className="text-slate-300">-</span>
                      )}
                  </td>

                  <td className="px-6 py-4 text-sm">
                    <span className={`px-2.5 py-1 rounded-lg text-xs font-bold border whitespace-nowrap ${
                      order.status === 'Selesai' 
                        ? 'bg-green-100 dark:bg-green-500/10 text-green-700 dark:text-green-400 border-green-200 dark:border-green-500/20' 
                        : order.status?.includes('Batal') || order.status?.includes('Dibatalkan')
                        ? 'bg-red-100 dark:bg-red-500/10 text-red-700 dark:text-red-400 border-red-200 dark:border-red-500/20' 
                        : 'bg-blue-100 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-500/20'
                    }`}>
                      {order.status}
                    </span>
                  </td>

                  {/* Total HPP Column */}
                  <td className="px-6 py-4 text-sm font-medium text-slate-600 dark:text-slate-300 whitespace-nowrap">
                     {totalHPP > 0 ? (
                         <span>Rp {totalHPP.toLocaleString()}</span>
                     ) : (
                         <span className="text-slate-400 dark:text-slate-600 font-bold text-xs">Rp 0</span>
                     )}
                  </td>

                  <td className="px-6 py-4 text-sm font-black text-slate-900 dark:text-white whitespace-nowrap">
                    Rp {order.net_revenue.toLocaleString()}
                  </td>
                  <td className="px-6 py-4 text-sm">
                    <button 
                      onClick={() => setSelectedOrder(order)}
                      className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-orange-600 transition-all"
                      title="Lihat Detail Pesanan"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              )})}
            </tbody>
          </table>
        </div>

        {filteredOrders.length === 0 && (
          <div className="py-12 text-center flex flex-col items-center justify-center">
            <Search className="w-12 h-12 text-slate-200 dark:text-slate-700 mb-3" />
            <p className="text-slate-500 dark:text-slate-400 text-sm font-medium">No orders found matching your criteria.</p>
          </div>
        )}

        {filteredOrders.length > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between px-6 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 gap-4">
            
            <div className="flex items-center gap-4 w-full sm:w-auto justify-between sm:justify-start">
              <div className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                Page <span className="font-bold text-slate-900 dark:text-white">{currentPage}</span> of <span className="font-bold text-slate-900 dark:text-white">{totalPages}</span>
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

      {/* --- ORDER DETAILS MODAL --- */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
             {/* Header */}
             <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex justify-between items-start bg-slate-50/50 dark:bg-slate-800/30">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">{selectedOrder.order_id}</h3>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${
                        selectedOrder.status === 'Selesai' 
                        ? 'bg-green-100 text-green-700 border-green-200' 
                        : selectedOrder.status?.includes('Batal') 
                        ? 'bg-red-100 text-red-700 border-red-200' 
                        : 'bg-blue-100 text-blue-700 border-blue-200'
                    }`}>
                      {selectedOrder.status}
                    </span>
                  </div>
                  <p className="text-sm text-slate-500 dark:text-slate-400 flex items-center gap-2">
                     <span className="font-bold">{selectedOrder.buyer_username}</span> • {format(new Date(selectedOrder.order_date), 'dd MMM yyyy, HH:mm')}
                  </p>
                </div>
                <button 
                  onClick={() => setSelectedOrder(null)}
                  className="p-2 bg-slate-100 dark:bg-slate-800 hover:bg-red-50 dark:hover:bg-red-900/20 text-slate-500 hover:text-red-500 rounded-xl transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
             </div>

             {/* Content */}
             <div className="overflow-y-auto p-6 space-y-6 custom-scrollbar">
                
                {/* List Produk */}
                <div>
                   <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                      <Package className="w-4 h-4" /> Rincian Produk
                   </h4>
                   <div className="space-y-3">
                      {selectedOrder.order_items?.map((item, idx) => (
                        <div key={idx} className="flex gap-4 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900/50 transition-colors shadow-sm">
                           <div className="w-16 h-16 bg-slate-200 dark:bg-slate-800 rounded-2xl flex items-center justify-center border border-slate-300 dark:border-slate-700 shrink-0">
                              <ShoppingBag className="w-8 h-8 text-slate-400 dark:text-slate-500" />
                           </div>
                           <div className="flex-1 min-w-0 flex flex-col justify-center">
                              {/* Product Name */}
                              <p className="text-sm font-bold text-slate-900 dark:text-white leading-snug mb-1">
                                {item.product_name}
                              </p>
                              
                              {/* Explicit Variation Display */}
                              {item.variation && (
                                <div className="mt-1.5 mb-2">
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-orange-50 dark:bg-orange-900/20 border border-orange-100 dark:border-orange-900/30 text-xs font-bold text-orange-800 dark:text-orange-300">
                                    <Layers className="w-3.5 h-3.5" />
                                    Variasi: {item.variation}
                                  </span>
                                </div>
                              )}
                              
                              <div className="flex flex-wrap items-center gap-2 mt-1">
                                <span className="text-xs font-black bg-slate-900 dark:bg-slate-200 text-white dark:text-slate-900 px-3 py-1 rounded-lg border border-slate-900 dark:border-slate-200">
                                   Qty: {item.quantity}
                                </span>
                                {item.is_sku_mapped ? (
                                    <span className="text-xs font-bold text-green-500 dark:text-green-400 bg-green-500/10 px-3 py-1 rounded-lg flex items-center gap-1 border border-green-500/20">
                                      <Link className="w-3 h-3" /> Terhubung: {item.final_sku}
                                    </span>
                                ) : (
                                    <span className="text-xs font-bold text-red-500 dark:text-red-400 bg-red-500/10 px-3 py-1 rounded-lg flex items-center gap-1 border border-red-500/20">
                                      <AlertCircle className="w-3 h-3" /> Belum Mapping
                                    </span>
                                )}
                              </div>
                           </div>
                           <div className="text-right shrink-0 flex flex-col justify-center">
                              <p className="text-lg font-black text-slate-900 dark:text-white">
                                Rp {(item.product_total).toLocaleString()}
                              </p>
                              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                                HPP: Rp {((item.hpp_at_time || 0) * item.quantity).toLocaleString()}
                              </p>
                           </div>
                        </div>
                      ))}
                   </div>
                </div>

                {/* Financial Summary */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-slate-100 dark:border-slate-800">
                    <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl space-y-2">
                       <div className="flex justify-between text-xs text-slate-500">
                          <span>Total Produk (GMV)</span>
                          <span className="font-bold text-slate-700 dark:text-slate-300">Rp {selectedOrder.product_total.toLocaleString()}</span>
                       </div>
                       <div className="flex justify-between text-xs text-slate-500">
                          <span>Voucher Toko</span>
                          <span className="font-bold text-red-500">- Rp {selectedOrder.seller_voucher.toLocaleString()}</span>
                       </div>
                       <div className="flex justify-between text-xs text-slate-500">
                          <span>Biaya Admin & Layanan</span>
                          <span className="font-bold text-red-500">- Rp {(selectedOrder.admin_fee + selectedOrder.service_fee).toLocaleString()}</span>
                       </div>
                    </div>
                    
                    <div className="bg-orange-50 dark:bg-orange-900/10 p-4 rounded-2xl flex flex-col justify-center border border-orange-100 dark:border-orange-500/20">
                       <span className="text-xs font-black uppercase text-orange-400 tracking-widest mb-1">Net Revenue</span>
                       <span className="text-2xl font-black text-orange-600 dark:text-orange-500">
                          Rp {selectedOrder.net_revenue.toLocaleString()}
                       </span>
                       {selectedOrder.status.includes('Batal') && (
                          <span className="text-[10px] font-bold text-red-500 mt-1">*Pesanan Dibatalkan (Rp 0)</span>
                       )}
                    </div>
                </div>
             </div>
          </div>
        </div>
      )}
    </>
  );
};
