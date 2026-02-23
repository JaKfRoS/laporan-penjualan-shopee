
import React, { useState, useRef, useEffect } from 'react';
import { Order, Store } from '../../types';
import { format } from 'date-fns';
import { supabase } from '../../services/supabase';
import { toast } from 'react-hot-toast';
import { Search, Filter, ExternalLink, ChevronDown, Check, ChevronLeft, ChevronRight, Store as StoreIcon, AlertCircle, Link, Eye, X, Package, ShoppingBag, Layers, Tag, Edit3, Save } from 'lucide-react';

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

  const [isEditingMapping, setIsEditingMapping] = useState(false);
  const [mappingTargetItem, setMappingTargetItem] = useState<any>(null);
  const [availableProducts, setAvailableProducts] = useState<any[]>([]);
  const [productSearchTerm, setProductSearchTerm] = useState('');
  const [selectedNewSku, setSelectedNewSku] = useState('');

  const [editingHppItemId, setEditingHppItemId] = useState<string | null>(null);
  const [tempHppValue, setTempHppValue] = useState<number>(0);

  const fetchProductsForMapping = async (storeId: string) => {
    const { data } = await supabase
      .from('products')
      .select('sku, product_name, variation_name, cost_price')
      .eq('store_id', storeId)
      .order('product_name');
    setAvailableProducts(data || []);
  };

  const handleRemapItem = async () => {
    if (!selectedNewSku || !mappingTargetItem || !selectedOrder) return;
    
    const toastId = toast.loading("Updating mapping...");
    try {
        const product = availableProducts.find(p => p.sku === selectedNewSku);
        if (!product) throw new Error("Produk tidak ditemukan");

        // 1. Update Order Item
        const { error } = await supabase
            .from('order_items')
            .update({ 
                final_sku: selectedNewSku, 
                is_sku_mapped: true,
                hpp_at_time: product.cost_price
            })
            .eq('id', mappingTargetItem.id);

        if (error) throw error;

        // 2. Update SKU Mapping (Optional: agar kedepannya otomatis)
        // Cek apakah user ingin update master mapping juga? 
        // Untuk sekarang kita update order item saja agar aman.
        
        toast.success("Mapping diperbarui!", { id: toastId });
        setIsEditingMapping(false);
        setMappingTargetItem(null);
        setSelectedNewSku('');
        
        // Refresh Order Data locally
        const updatedItems = selectedOrder.order_items?.map(item => {
            if (item.id === mappingTargetItem.id) {
                return { 
                    ...item, 
                    final_sku: selectedNewSku, 
                    is_sku_mapped: true, 
                    hpp_at_time: product.cost_price 
                };
            }
            return item;
        });
        
        // Recalculate totals for the selected order locally
        const newNetRevenue = selectedOrder.net_revenue; // Net revenue doesn't change with HPP change, only profit does.
        // But we might want to update the UI to reflect the new HPP immediately.
        
        setSelectedOrder({ ...selectedOrder, order_items: updatedItems });

    } catch (err: any) {
        toast.error("Gagal: " + err.message, { id: toastId });
    }
  };

  const handleUpdateHpp = async (itemId: string) => {
    const toastId = toast.loading("Updating HPP...");
    try {
      // 1. Update the specific order item
      const { error } = await supabase
        .from('order_items')
        .update({ hpp_at_time: tempHppValue })
        .eq('id', itemId);

      if (error) throw error;

      // 2. Update the master product HPP if it's mapped
      if (selectedOrder) {
        const itemToUpdate = selectedOrder.order_items?.find(i => i.id === itemId);
        if (itemToUpdate && itemToUpdate.final_sku) {
          const { error: productError } = await supabase
            .from('products')
            .update({ cost_price: tempHppValue })
            .eq('sku', itemToUpdate.final_sku)
            .eq('store_id', selectedOrder.store_id);
          
          if (productError) {
            console.error("Gagal update master produk:", productError);
            // We don't throw here to allow the order item update to be considered "success" 
            // but we could notify the user.
          }
        }
      }

      toast.success("HPP diperbarui!", { id: toastId });
      setEditingHppItemId(null);

      // Update local state
      if (selectedOrder) {
        const updatedItems = selectedOrder.order_items?.map(item => 
          item.id === itemId ? { ...item, hpp_at_time: tempHppValue } : item
        );
        setSelectedOrder({ ...selectedOrder, order_items: updatedItems });
      }
    } catch (err: any) {
      toast.error("Gagal: " + err.message, { id: toastId });
    }
  };

  const filteredProducts = availableProducts.filter(p => 
      (p.product_name || '').toLowerCase().includes((productSearchTerm || '').toLowerCase()) ||
      (p.sku || '').toLowerCase().includes((productSearchTerm || '').toLowerCase())
  );

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

        <div className="overflow-x-auto custom-scrollbar hidden md:block">
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
                         <span>Rp {(totalHPP || 0).toLocaleString()}</span>
                     ) : (
                         <span className="text-slate-400 dark:text-slate-600 font-bold text-xs">Rp 0</span>
                     )}
                  </td>

                  <td className="px-6 py-4 text-sm font-black text-slate-900 dark:text-white whitespace-nowrap">
                    Rp {(order.net_revenue || 0).toLocaleString()}
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

        {/* MOBILE VIEW: CARD LAYOUT */}
        <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800">
          {currentOrders.map((order) => {
            const items = order.order_items || [];
            const firstItem = items[0];
            const isAllMapped = items.every(i => i.is_sku_mapped);
            const isCancelled = order.status?.toLowerCase().includes('batal') || order.status?.toLowerCase().includes('cancel') || order.status?.toLowerCase().includes('pengembalian');
            const totalHPP = isCancelled ? 0 : items.reduce((sum, item) => sum + ((item.hpp_at_time || 0) * (item.quantity || 1)), 0);

            return (
              <div key={order.id} className="p-4 space-y-3 active:bg-slate-50 dark:active:bg-slate-800/50 transition-colors" onClick={() => setSelectedOrder(order)}>
                <div className="flex justify-between items-start">
                  <div className="flex flex-col">
                    <span className="text-xs font-black text-slate-400 uppercase tracking-tight">{order.order_id}</span>
                    <span className="text-[10px] text-slate-500">{format(new Date(order.order_date), 'dd MMM yyyy')}</span>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                    order.status === 'Selesai' 
                      ? 'bg-green-100 text-green-700 border-green-200' 
                      : order.status?.includes('Batal')
                      ? 'bg-red-100 text-red-700 border-red-200' 
                      : 'bg-blue-100 text-blue-700 border-blue-200'
                  }`}>
                    {order.status}
                  </span>
                </div>

                <div className="flex gap-3">
                  <div className="w-10 h-10 bg-slate-100 dark:bg-slate-800 rounded-lg flex items-center justify-center shrink-0">
                    <ShoppingBag className="w-5 h-5 text-slate-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-800 dark:text-white truncate">{firstItem?.product_name || 'No Items'}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {firstItem?.variation && firstItem.variation !== '-' && (
                        <span className="text-[10px] font-medium text-slate-500 bg-slate-100 dark:bg-slate-800 px-1.5 rounded">
                          {firstItem.variation}
                        </span>
                      )}
                      {items.length > 1 && (
                        <span className="text-[10px] font-bold text-blue-600">+{items.length - 1} lainnya</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-50 dark:border-slate-800/50">
                  <div className="flex flex-col">
                    <span className="text-[9px] font-black text-slate-400 uppercase">HPP</span>
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Rp {totalHPP.toLocaleString()}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[9px] font-black text-slate-400 uppercase">Revenue</span>
                    <span className="text-xs font-black text-slate-900 dark:text-white">Rp {(order.net_revenue || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className="text-[9px] font-black text-slate-400 uppercase text-right">SKU</span>
                    {isAllMapped ? (
                      <span className="text-[10px] font-bold text-green-500 flex items-center gap-0.5"><Check className="w-2.5 h-2.5"/> OK</span>
                    ) : (
                      <span className="text-[10px] font-bold text-red-500 flex items-center gap-0.5"><AlertCircle className="w-2.5 h-2.5"/> Map</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
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
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-2 md:p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-[2rem] md:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[95vh] md:max-h-[90vh]">
             {/* Header */}
             <div className="p-5 md:p-6 border-b border-slate-100 dark:border-slate-800 flex justify-between items-start bg-slate-50/50 dark:bg-slate-800/30 shrink-0">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <h3 className="text-base md:text-xl font-black text-slate-900 dark:text-white tracking-tight truncate">{selectedOrder.order_id}</h3>
                    <span className={`px-2 py-0.5 rounded text-[9px] md:text-[10px] font-bold uppercase border whitespace-nowrap ${
                        selectedOrder.status === 'Selesai' 
                        ? 'bg-green-100 text-green-700 border-green-200' 
                        : selectedOrder.status?.includes('Batal') 
                        ? 'bg-red-100 text-red-700 border-red-200' 
                        : 'bg-blue-100 text-blue-700 border-blue-200'
                    }`}>
                      {selectedOrder.status}
                    </span>
                  </div>
                  <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-1">
                     <span className="font-bold text-slate-700 dark:text-slate-200">{selectedOrder.buyer_username}</span>
                     <span className="hidden md:inline text-slate-300">•</span>
                     <span className="text-[10px] md:text-sm">{format(new Date(selectedOrder.order_date), 'dd MMM yyyy, HH:mm')}</span>
                  </p>
                </div>
                <button 
                  onClick={() => setSelectedOrder(null)}
                  className="p-2 bg-slate-100 dark:bg-slate-800 hover:bg-red-50 dark:hover:bg-red-900/20 text-slate-500 hover:text-red-500 rounded-xl transition-colors shrink-0 ml-2"
                >
                  <X className="w-5 h-5" />
                </button>
             </div>

             {/* Content */}
              <div className="overflow-y-auto p-4 md:p-6 space-y-6 custom-scrollbar">
                {/* Define isCancelled for the modal scope */}
                {(() => {
                  const isCancelled = selectedOrder.status?.toLowerCase().includes('batal') || 
                                     selectedOrder.status?.toLowerCase().includes('cancel') || 
                                     selectedOrder.status?.toLowerCase().includes('pengembalian');
                  
                  return (
                    <>
                      {/* List Produk */}
                      <div>
                         <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                            <Package className="w-4 h-4" /> Rincian Produk
                         </h4>
                         <div className="space-y-3">
                             {selectedOrder.order_items?.map((item, idx) => (
                              <div key={idx} className="flex flex-col sm:flex-row gap-4 p-4 md:p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900/50 transition-colors shadow-sm">
                                 <div className="flex gap-4 flex-1 min-w-0">
                                    <div className="w-14 h-14 md:w-16 md:h-16 bg-slate-200 dark:bg-slate-800 rounded-2xl flex items-center justify-center border border-slate-300 dark:border-slate-700 shrink-0">
                                       <ShoppingBag className="w-7 h-7 md:w-8 md:h-8 text-slate-400 dark:text-slate-500" />
                                    </div>
                                    <div className="flex-1 min-w-0 flex flex-col justify-center">
                                       {/* Product Name */}
                                       <p className="text-xs md:text-sm font-bold text-slate-900 dark:text-white leading-snug mb-1">
                                         {item.product_name}
                                       </p>
                                       
                                       {/* Explicit Variation Display */}
                                       {item.variation && (
                                         <div className="mt-1 mb-2">
                                           <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-orange-50 dark:bg-orange-900/20 border border-orange-100 dark:border-orange-900/30 text-[10px] md:text-xs font-bold text-orange-800 dark:text-orange-300">
                                             <Layers className="w-3 h-3" />
                                             {item.variation}
                                           </span>
                                         </div>
                                       )}
                                       
                                       <div className="flex flex-wrap items-center gap-2 mt-1">
                                         <span className="text-[10px] md:text-xs font-black bg-slate-900 dark:bg-slate-200 text-white dark:text-slate-900 px-2 md:px-3 py-1 rounded-lg border border-slate-900 dark:border-slate-200">
                                            Qty: {item.quantity}
                                         </span>
                                           {item.is_sku_mapped ? (
                                             <div className="flex items-center gap-1.5">
                                                 <span className="text-[10px] md:text-xs font-bold text-green-500 dark:text-green-400 bg-green-500/10 px-2 md:px-3 py-1 rounded-lg flex items-center gap-1 border border-green-500/20">
                                                   <Link className="w-3 h-3" /> {item.final_sku}
                                                 </span>
                                                 <button 
                                                     onClick={() => {
                                                         setMappingTargetItem(item);
                                                         setIsEditingMapping(true);
                                                         fetchProductsForMapping(selectedOrder.store_id);
                                                     }}
                                                     className="p-1.5 text-slate-400 hover:text-orange-500 transition-colors bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700"
                                                     title="Edit Mapping"
                                                 >
                                                     <Edit3 className="w-3.5 h-3.5" />
                                                 </button>
                                             </div>
                                         ) : (
                                             <div className="flex items-center gap-1.5">
                                                 <span className="text-[10px] md:text-xs font-bold text-red-500 dark:text-red-400 bg-red-500/10 px-2 md:px-3 py-1 rounded-lg flex items-center gap-1 border border-red-500/20">
                                                   <AlertCircle className="w-3 h-3" /> Belum Mapping
                                                 </span>
                                                 <button 
                                                     onClick={() => {
                                                         setMappingTargetItem(item);
                                                         setIsEditingMapping(true);
                                                         fetchProductsForMapping(selectedOrder.store_id);
                                                     }}
                                                     className="p-1.5 text-slate-400 hover:text-orange-500 transition-colors bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700"
                                                     title="Manual Mapping"
                                                 >
                                                     <Edit3 className="w-3.5 h-3.5" />
                                                 </button>
                                             </div>
                                         )}
                                       </div>
                                    </div>
                                 </div>
                                 <div className="text-left sm:text-right shrink-0 flex flex-row sm:flex-col justify-between sm:justify-center items-center sm:items-end pt-3 sm:pt-0 border-t sm:border-t-0 border-slate-200 dark:border-slate-800">
                                    <p className="text-base md:text-lg font-black text-slate-900 dark:text-white">
                                      Rp {(item.product_total || 0).toLocaleString()}
                                    </p>
                                    <div className="flex items-center justify-end gap-2 mt-1">
                                      {editingHppItemId === item.id ? (
                                        <div className="flex items-center gap-1">
                                          <input 
                                            type="number"
                                            value={tempHppValue}
                                            onChange={(e) => setTempHppValue(Number(e.target.value))}
                                            className="w-20 px-2 py-1 text-xs font-bold bg-white dark:bg-slate-800 border border-orange-500 rounded-lg outline-none"
                                            autoFocus
                                          />
                                          <button 
                                            onClick={() => handleUpdateHpp(item.id)}
                                            className="p-1 bg-green-600 text-white rounded-lg hover:bg-green-700"
                                          >
                                            <Check className="w-3 h-3" />
                                          </button>
                                          <button 
                                            onClick={() => setEditingHppItemId(null)}
                                            className="p-1 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg"
                                          >
                                            <X className="w-3 h-3" />
                                          </button>
                                        </div>
                                      ) : (
                                        <div className="flex items-center gap-1 group/hpp">
                                          <p className="text-[10px] md:text-xs font-medium text-slate-500 dark:text-slate-400">
                                            HPP: Rp {(isCancelled ? 0 : ((item.hpp_at_time || 0) * (item.quantity || 0))).toLocaleString()}
                                          </p>
                                          <button 
                                            onClick={() => {
                                              setEditingHppItemId(item.id);
                                              setTempHppValue(item.hpp_at_time || 0);
                                            }}
                                            className="p-2 text-orange-500 md:text-slate-300 md:hover:text-orange-500 md:opacity-0 md:group-hover/hpp:opacity-100 transition-all"
                                            title="Edit HPP"
                                          >
                                            <Edit3 className="w-4 h-4 md:w-3.5 md:h-3.5" />
                                          </button>
                                        </div>
                                      )}
                                    </div>
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
                                <span className="font-bold text-slate-700 dark:text-slate-300">Rp {(selectedOrder.product_total || 0).toLocaleString()}</span>
                             </div>
                             <div className="flex justify-between text-xs text-slate-500">
                                <span>Total Potongan Marketplace</span>
                                <span className="font-bold text-red-500">- Rp {((selectedOrder.admin_fee || 0) + (selectedOrder.service_fee || 0)).toLocaleString()}</span>
                             </div>
                             <div className="text-[10px] text-slate-400 italic text-right">
                                (Termasuk Admin, Layanan, Ongkir, Voucher, dll)
                             </div>
                          </div>
                          
                          <div className="bg-orange-50 dark:bg-orange-900/10 p-4 rounded-2xl flex flex-col justify-center border border-orange-100 dark:border-orange-500/20">
                             <span className="text-xs font-black uppercase text-orange-400 tracking-widest mb-1">Net Revenue</span>
                             <span className="text-2xl font-black text-orange-600 dark:text-orange-500">
                                Rp {(selectedOrder.net_revenue || 0).toLocaleString()}
                             </span>
                             {isCancelled && (
                                <span className="text-[10px] font-bold text-red-500 mt-1">*{selectedOrder.status} (HPP Rp 0)</span>
                             )}
                          </div>
                      </div>
                    </>
                  );
                })()}
             </div>
          </div>
        </div>
      )}

      {/* --- EDIT MAPPING MODAL --- */}
      {isEditingMapping && mappingTargetItem && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-2 md:p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
              <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-[2rem] md:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[95vh]">
                  <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-800/30 shrink-0">
                      <h3 className="text-xs md:text-sm font-black uppercase text-slate-900 dark:text-white tracking-widest">Edit Mapping SKU</h3>
                      <button onClick={() => setIsEditingMapping(false)} className="p-2 text-slate-400 hover:text-red-500 transition-colors"><X className="w-5 h-5" /></button>
                  </div>
                  <div className="p-5 space-y-5 overflow-y-auto custom-scrollbar">
                      <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl border border-slate-100 dark:border-slate-800">
                          <p className="text-[10px] text-slate-400 uppercase font-black tracking-widest mb-2">Produk Shopee</p>
                          <p className="text-sm font-bold text-slate-900 dark:text-white leading-tight">{mappingTargetItem.product_name}</p>
                          {mappingTargetItem.variation && (
                            <div className="mt-2">
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-200/50 dark:bg-slate-700 text-[10px] font-bold text-slate-600 dark:text-slate-300">
                                    {mappingTargetItem.variation}
                                </span>
                            </div>
                          )}
                      </div>

                      <div className="space-y-3">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Cari SKU Baru</label>
                          <div className="relative group">
                              <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-orange-500 transition-colors" />
                              <input 
                                  type="text" 
                                  placeholder="Ketik nama produk / SKU..." 
                                  value={productSearchTerm}
                                  onChange={(e) => setProductSearchTerm(e.target.value)}
                                  className="w-full pl-11 pr-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-sm font-bold outline-none focus:ring-4 focus:ring-orange-500/10 focus:border-orange-500 transition-all"
                                  autoFocus
                              />
                          </div>
                          <div className="max-h-56 overflow-y-auto custom-scrollbar border border-slate-200 dark:border-slate-700 rounded-2xl bg-white dark:bg-slate-900 shadow-sm">
                              {filteredProducts.length > 0 ? (
                                  filteredProducts.map(p => (
                                      <button 
                                          key={p.sku}
                                          onClick={() => setSelectedNewSku(p.sku)}
                                          className={`w-full text-left p-4 text-xs font-medium hover:bg-orange-50 dark:hover:bg-orange-500/10 border-b border-slate-50 dark:border-slate-800 last:border-0 transition-colors ${selectedNewSku === p.sku ? 'bg-orange-50 dark:bg-orange-500/20 text-orange-700 dark:text-orange-400' : 'text-slate-600 dark:text-slate-300'}`}
                                      >
                                          <div className="font-bold text-sm mb-1">{p.product_name}</div>
                                          <div className="flex justify-between items-center">
                                              <span className="text-[10px] font-black uppercase tracking-tighter bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">{p.sku}</span>
                                              <span className="text-[10px] font-bold text-slate-400">HPP: Rp {(p.cost_price || 0).toLocaleString()}</span>
                                          </div>
                                      </button>
                                  ))
                              ) : (
                                  <div className="p-8 text-center text-xs text-slate-400 font-medium">Produk tidak ditemukan</div>
                              )}
                          </div>
                      </div>

                      <button 
                          onClick={handleRemapItem}
                          disabled={!selectedNewSku}
                          className="w-full py-4 bg-slate-900 dark:bg-orange-600 text-white font-black rounded-2xl hover:opacity-90 disabled:opacity-50 transition-all flex items-center justify-center gap-3 shadow-xl shadow-slate-900/20 dark:shadow-orange-600/20 uppercase tracking-widest text-sm"
                      >
                          <Save className="w-5 h-5" />
                          Simpan Perubahan
                      </button>
                  </div>
              </div>
          </div>
      )}
    </>
  );
};
