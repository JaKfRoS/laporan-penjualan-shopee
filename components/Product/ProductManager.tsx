
import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../../services/supabase';
import { Store, Product } from '../../types';
import { toast } from 'react-hot-toast';
import { PackageSearch, Plus, Search, CheckCircle2, Link as LinkIcon, Edit2, Trash2, Save, X, Loader2, ArrowRightLeft, Lightbulb, FileSpreadsheet, CheckSquare, Info } from 'lucide-react';

interface ProductManagerProps {
  store: Store;
}

export const ProductManager: React.FC<ProductManagerProps> = ({ store }) => {
  const [activeTab, setActiveTab] = useState<'mapping' | 'master'>('mapping');
  
  // Master Products State
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [searchProduct, setSearchProduct] = useState('');
  
  // Selection & Bulk Actions
  const [selectedSkus, setSelectedSkus] = useState<Set<string>>(new Set());
  const [isBulkEditingHpp, setIsBulkEditingHpp] = useState(false);
  const [bulkHppValue, setBulkHppValue] = useState<number | ''>('');
  
  // Mapping State
  const [unmappedItems, setUnmappedItems] = useState<{name: string, variation: string, count: number}[]>([]);
  const [loadingMapping, setLoadingMapping] = useState(false);
  
  // Edit/Create State
  const [isAddingProduct, setIsAddingProduct] = useState(false);
  const [newProduct, setNewProduct] = useState({ sku: '', product_name: '', cost_price: 0 });
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  // Mapping Selection State
  const [selectedUnmapped, setSelectedUnmapped] = useState<{name: string, variation: string} | null>(null);
  const [targetSku, setTargetSku] = useState('');
  const [mappingSearchTerm, setMappingSearchTerm] = useState('');
  
  // Quick Create State (in Mapping)
  const [isQuickCreating, setIsQuickCreating] = useState(false);

  // Import State
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);

  useEffect(() => {
    fetchProducts();
    if (activeTab === 'mapping') fetchUnmappedItems();
  }, [store, activeTab]);

  // --- SMART SUGGESTION EFFECT ---
  useEffect(() => {
    if (selectedUnmapped && products.length > 0) {
      setMappingSearchTerm(''); 
      const clean = (str: string) => str.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
      const shopeeName = clean(selectedUnmapped.name);
      const shopeeVar = clean(selectedUnmapped.variation || '');
      const shopeeTokens = `${shopeeName} ${shopeeVar}`.split(/\s+/).filter(w => w.length > 2);

      let bestScore = 0;
      let bestSku = '';

      products.forEach(p => {
        const internalSku = clean(p.sku);
        if (internalSku === shopeeName || internalSku.includes(shopeeName)) {
            bestScore = 1000;
            bestSku = p.sku;
            return;
        }
        let matches = 0;
        const internalName = clean(p.product_name);
        shopeeTokens.forEach(token => {
            if (internalName.includes(token)) matches += 1;
        });
        if (matches > bestScore) {
          bestScore = matches;
          bestSku = p.sku;
        }
      });

      if (bestScore >= 1) setTargetSku(bestSku);
      else setTargetSku('');
    }
  }, [selectedUnmapped, products]);


  // --- MASTER PRODUCT FUNCTIONS ---

  const fetchProducts = async () => {
    setLoadingProducts(true);
    // Note: mapped DB column `cost_price` to `cost_price` in types, renaming from hpp
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('store_id', store.id)
      .order('product_name');
    
    if (error) toast.error("Gagal memuat produk: " + error.message);
    else setProducts(data || []);
    
    setSelectedSkus(new Set()); 
    setLoadingProducts(false);
  };

  const handleSaveProduct = async () => {
    if (!newProduct.sku || !newProduct.product_name) {
      toast.error("SKU dan Nama Produk wajib diisi");
      return;
    }

    try {
      const { error } = await supabase.from('products').insert([{
        store_id: store.id,
        sku: newProduct.sku,
        product_name: newProduct.product_name,
        cost_price: newProduct.cost_price, // Changed from hpp
        stock: 0
      }]);

      if (error) throw error;
      
      toast.success("Produk berhasil ditambahkan");
      setIsAddingProduct(false);
      setNewProduct({ sku: '', product_name: '', cost_price: 0 });
      fetchProducts();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleUpdateProduct = async () => {
    if (!editingProduct) return;
    try {
      const { error } = await supabase.from('products')
        .update({ 
            product_name: editingProduct.product_name,
            cost_price: editingProduct.cost_price 
        })
        .eq('sku', editingProduct.sku)
        .eq('store_id', store.id);

      if (error) throw error;
      toast.success("Produk diperbarui");
      setEditingProduct(null);
      fetchProducts();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleDeleteProduct = async (sku: string) => {
    if(!window.confirm("Hapus produk ini?")) return;
    const toastId = toast.loading("Menghapus produk...");
    try {
        const { error } = await supabase.rpc('delete_product_safely', { p_sku: sku, p_store_id: store.id });
        if(error) throw error;
        toast.success("Produk dihapus", { id: toastId });
        setProducts(prev => prev.filter(p => p.sku !== sku));
    } catch (err: any) {
        toast.error("Gagal hapus: " + err.message, { id: toastId });
    }
  };

  // --- MAPPING FUNCTIONS ---

  const fetchUnmappedItems = async () => {
    setLoadingMapping(true);
    const { data, error } = await supabase
      .from('order_items')
      .select('product_name, variation')
      .eq('store_id', store.id)
      .eq('is_sku_mapped', false);

    if (error) {
        setLoadingMapping(false);
        return;
    }

    const groups: Record<string, number> = {};
    data?.forEach(item => {
        // Use a delimiter unlikely to be in product name
        const key = `${item.product_name}|||${item.variation || ''}`;
        groups[key] = (groups[key] || 0) + 1;
    });

    const result = Object.entries(groups).map(([key, count]) => {
        const [name, variation] = key.split('|||');
        return { name, variation, count };
    });

    setUnmappedItems(result);
    setLoadingMapping(false);
  };

  const handleApplyMapping = async () => {
     if (!selectedUnmapped || !targetSku) return;
     const toastId = toast.loading("Menyimpan mapping...");

     try {
        // 1. Insert ke table sku_mappings (Source of Truth)
        const { error: mapError } = await supabase.from('sku_mappings').upsert([{
            store_id: store.id,
            shopee_product_name: selectedUnmapped.name,
            shopee_variation_name: selectedUnmapped.variation,
            mapped_sku: targetSku
        }], { onConflict: 'store_id, shopee_product_name, shopee_variation_name'});

        if (mapError) throw mapError;

        // 2. Fetch data produk master untuk dapat harga
        const product = products.find(p => p.sku === targetSku);
        if (!product) throw new Error("Produk master tidak ditemukan");

        // 3. Update Existing Orders (Bulk Update)
        const { error: updateError } = await supabase
            .from('order_items')
            .update({ 
                final_sku: targetSku, 
                is_sku_mapped: true, 
                hpp_at_time: product.cost_price 
            })
            .eq('store_id', store.id)
            .eq('product_name', selectedUnmapped.name)
            .eq('variation', selectedUnmapped.variation);

        if (updateError) throw updateError;

        toast.success("Mapping berhasil & pesanan diperbarui!", { id: toastId });
        setSelectedUnmapped(null);
        setTargetSku('');
        fetchUnmappedItems(); 

     } catch (err: any) {
        console.error(err);
        toast.error("Gagal: " + err.message, { id: toastId });
     }
  };

  const handleQuickCreateAndMap = async () => {
      if (!newProduct.sku || !newProduct.product_name) return;
      
      const toastId = toast.loading("Membuat produk & mapping...");
      try {
          const { error: prodError } = await supabase.from('products').insert([{
            store_id: store.id,
            sku: newProduct.sku,
            product_name: newProduct.product_name,
            cost_price: newProduct.cost_price,
            stock: 0
          }]);
          
          if (prodError) throw prodError;

          await fetchProducts();
          setTargetSku(newProduct.sku);
          
          // Re-use logic above
          const { error: mapError } = await supabase.from('sku_mappings').insert([{
            store_id: store.id,
            shopee_product_name: selectedUnmapped!.name,
            shopee_variation_name: selectedUnmapped!.variation,
            mapped_sku: newProduct.sku
          }]);

        if (mapError) throw mapError;

        const { error: updateError } = await supabase
            .from('order_items')
            .update({ 
                final_sku: newProduct.sku, 
                is_sku_mapped: true, 
                hpp_at_time: newProduct.cost_price 
            })
            .eq('store_id', store.id)
            .eq('product_name', selectedUnmapped!.name)
            .eq('variation', selectedUnmapped!.variation);

        if (updateError) throw updateError;

        toast.success("Produk dibuat & di-mapping!", { id: toastId });
        setIsQuickCreating(false);
        setNewProduct({ sku: '', product_name: '', cost_price: 0 });
        setSelectedUnmapped(null);
        fetchUnmappedItems();

      } catch (err: any) {
          toast.error("Gagal: " + err.message, { id: toastId });
      }
  };

  const filteredProducts = products.filter(p => 
      p.product_name.toLowerCase().includes(searchProduct.toLowerCase()) || 
      p.sku.toLowerCase().includes(searchProduct.toLowerCase())
  );

  const mappingOptions = products.filter(p => 
      !mappingSearchTerm || 
      p.product_name.toLowerCase().includes(mappingSearchTerm.toLowerCase()) ||
      p.sku.toLowerCase().includes(mappingSearchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
       
       <div className="flex p-1 bg-slate-100 dark:bg-slate-800 rounded-xl w-fit">
          <button 
             onClick={() => setActiveTab('mapping')}
             className={`px-6 py-2.5 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${
                activeTab === 'mapping' 
                ? 'bg-white dark:bg-slate-700 text-orange-600 dark:text-orange-400 shadow-sm' 
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
             }`}
          >
             <LinkIcon className="w-4 h-4" />
             Mapping SKU
             {unmappedItems.length > 0 && (
                <span className="bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full">{unmappedItems.length}</span>
             )}
          </button>
          <button 
             onClick={() => setActiveTab('master')}
             className={`px-6 py-2.5 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${
                activeTab === 'master' 
                ? 'bg-white dark:bg-slate-700 text-orange-600 dark:text-orange-400 shadow-sm' 
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
             }`}
          >
             <PackageSearch className="w-4 h-4" />
             Master Produk (HPP)
          </button>
       </div>

       {activeTab === 'mapping' && (
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 p-6">
             <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-orange-100 dark:bg-orange-500/10 rounded-lg text-orange-600">
                   <ArrowRightLeft className="w-6 h-6" />
                </div>
                <div>
                   <h2 className="text-lg font-black uppercase tracking-tight dark:text-white">Mapping Produk Shopee</h2>
                   <p className="text-xs text-slate-500">Hubungkan produk Shopee dengan Master SKU untuk mendapatkan data HPP.</p>
                </div>
             </div>

             {loadingMapping ? (
                 <div className="py-20 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-orange-500" /></div>
             ) : unmappedItems.length === 0 ? (
                 <div className="py-20 text-center flex flex-col items-center">
                    <CheckCircle2 className="w-16 h-16 text-green-500 mb-4" />
                    <h3 className="text-xl font-bold text-slate-800 dark:text-white">Semua Aman!</h3>
                    <p className="text-slate-500">Semua produk dalam pesanan sudah terhubung ke Master SKU.</p>
                 </div>
             ) : (
                 <div className="overflow-x-auto">
                    <table className="w-full text-left">
                       <thead className="bg-slate-50 dark:bg-slate-800">
                          <tr>
                             <th className="px-6 py-4 text-xs font-black text-slate-400 uppercase">Nama Produk (Shopee)</th>
                             <th className="px-6 py-4 text-xs font-black text-slate-400 uppercase">Variasi</th>
                             <th className="px-6 py-4 text-xs font-black text-slate-400 uppercase text-center">Jml Transaksi</th>
                             <th className="px-6 py-4 text-xs font-black text-slate-400 uppercase">Aksi</th>
                          </tr>
                       </thead>
                       <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {unmappedItems.map((item, idx) => (
                             <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                <td className="px-6 py-4 font-medium text-sm dark:text-white">{item.name}</td>
                                <td className="px-6 py-4 text-sm text-slate-500 dark:text-slate-400">{item.variation || '-'}</td>
                                <td className="px-6 py-4 text-center font-bold text-slate-700 dark:text-slate-300">{item.count}</td>
                                <td className="px-6 py-4">
                                   <button 
                                      onClick={() => setSelectedUnmapped(item)}
                                      className="px-4 py-2 bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 text-xs font-bold rounded-lg border border-orange-200 dark:border-orange-800 hover:bg-orange-100 transition-all"
                                   >
                                      Connect SKU
                                   </button>
                                </td>
                             </tr>
                          ))}
                       </tbody>
                    </table>
                 </div>
             )}
          </div>
       )}

       {selectedUnmapped && (
           <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
              <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl max-w-lg w-full overflow-hidden">
                 <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex justify-between items-start">
                    <div>
                       <h3 className="text-lg font-black uppercase tracking-tight text-slate-900 dark:text-white">Hubungkan SKU</h3>
                       <p className="text-xs text-slate-500 mt-1">Produk Shopee: <span className="font-bold text-orange-600">{selectedUnmapped.name} {selectedUnmapped.variation ? `(${selectedUnmapped.variation})` : ''}</span></p>
                    </div>
                    <button onClick={() => { setSelectedUnmapped(null); setIsQuickCreating(false); }} className="text-slate-400 hover:text-red-500"><X className="w-6 h-6" /></button>
                 </div>
                 
                 <div className="p-6 space-y-6">
                    {!isQuickCreating ? (
                        <>
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-slate-500 uppercase flex items-center justify-between">
                                  <span>Cari & Pilih Master SKU</span>
                                  {targetSku && !mappingSearchTerm && (
                                    <span className="text-[10px] text-orange-600 flex items-center gap-1">
                                      <Lightbulb className="w-3 h-3" /> Saran Sistem
                                    </span>
                                  )}
                                </label>
                                
                                <div className="relative mb-2">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                    <input 
                                        type="text"
                                        placeholder="Ketik untuk mencari produk..."
                                        value={mappingSearchTerm}
                                        onChange={(e) => setMappingSearchTerm(e.target.value)}
                                        className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-orange-500/20"
                                    />
                                </div>

                                <select 
                                    value={targetSku}
                                    onChange={(e) => setTargetSku(e.target.value)}
                                    className="w-full p-4 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-orange-500/20 max-h-48"
                                    size={5} 
                                >
                                    <option value="" className="p-2 text-slate-400">-- Pilih SKU Internal --</option>
                                    {mappingOptions.map(p => (
                                        <option key={p.sku} value={p.sku} className="p-2 border-b border-slate-100 dark:border-slate-700/50">
                                            {p.product_name} ({p.sku}) - Rp {p.cost_price.toLocaleString()}
                                        </option>
                                    ))}
                                </select>
                                <p className="text-[10px] text-slate-400 text-right">Menampilkan {mappingOptions.length} produk</p>
                            </div>
                            
                            <div className="flex items-center justify-between">
                                <span className="text-xs text-slate-400 font-bold">Produk belum ada di database?</span>
                                <button 
                                    onClick={() => {
                                        setIsQuickCreating(true);
                                        setNewProduct({ sku: '', product_name: selectedUnmapped.name + (selectedUnmapped.variation ? ` - ${selectedUnmapped.variation}` : ''), cost_price: 0 });
                                    }}
                                    className="text-xs font-black text-orange-600 uppercase hover:underline"
                                >
                                    + Buat Produk Baru
                                </button>
                            </div>

                            <button 
                                onClick={handleApplyMapping}
                                disabled={!targetSku}
                                className="w-full py-4 bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-black rounded-xl hover:opacity-90 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                            >
                                <LinkIcon className="w-4 h-4" />
                                SIMPAN MAPPING
                            </button>
                        </>
                    ) : (
                        <div className="animate-in slide-in-from-right duration-300">
                             <div className="p-3 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 rounded-xl text-xs font-medium mb-4 flex gap-2">
                                <Info className="w-4 h-4 shrink-0" />
                                Produk ini akan disimpan ke Master Data dan otomatis terhubung.
                             </div>
                             <div className="space-y-4">
                                <div className="space-y-1">
                                    <label className="text-[10px] font-black uppercase text-slate-400">SKU (Kode Unik)</label>
                                    <input 
                                        type="text" 
                                        value={newProduct.sku}
                                        onChange={(e) => setNewProduct({...newProduct, sku: e.target.value.toUpperCase()})}
                                        className="w-full p-3 bg-slate-50 dark:bg-slate-800 border rounded-xl font-bold uppercase"
                                        placeholder="CONTOH-SKU-001"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[10px] font-black uppercase text-slate-400">Nama Produk Internal</label>
                                    <input 
                                        type="text" 
                                        value={newProduct.product_name}
                                        onChange={(e) => setNewProduct({...newProduct, product_name: e.target.value})}
                                        className="w-full p-3 bg-slate-50 dark:bg-slate-800 border rounded-xl font-bold"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[10px] font-black uppercase text-slate-400">HPP (Harga Modal)</label>
                                    <input 
                                        type="number" 
                                        value={newProduct.cost_price}
                                        onWheel={(e) => e.currentTarget.blur()}
                                        onChange={(e) => setNewProduct({...newProduct, cost_price: Number(e.target.value)})}
                                        className="w-full p-3 bg-slate-50 dark:bg-slate-800 border rounded-xl font-bold"
                                    />
                                </div>
                                <div className="flex gap-2 pt-2">
                                    <button onClick={() => setIsQuickCreating(false)} className="flex-1 py-3 text-slate-500 font-bold hover:bg-slate-50 rounded-xl">Kembali</button>
                                    <button onClick={handleQuickCreateAndMap} className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700">Simpan & Map</button>
                                </div>
                             </div>
                        </div>
                    )}
                 </div>
              </div>
           </div>
       )}

       {activeTab === 'master' && (
           <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 p-6 relative">
                
                <div className="flex flex-col xl:flex-row items-center justify-between gap-4 mb-6 mt-2">
                    <div className="relative w-full xl:w-64">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input 
                            type="text"
                            placeholder="Cari SKU / Nama..." 
                            value={searchProduct}
                            onChange={(e) => setSearchProduct(e.target.value)}
                            className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-bold outline-none"
                        />
                    </div>
                    
                    <button 
                        onClick={() => setIsAddingProduct(true)}
                        className="px-4 py-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-black rounded-xl hover:opacity-90 transition-all flex items-center justify-center gap-2"
                    >
                        <Plus className="w-4 h-4" />
                        MANUAL
                    </button>
                </div>
                
                {isAddingProduct && (
                    <div className="mb-6 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-700 animate-in slide-in-from-top-2">
                        <h4 className="text-xs font-black uppercase text-slate-500 mb-3">Input Produk Baru</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                            <input 
                                type="text" placeholder="SKU (Unik)" 
                                value={newProduct.sku}
                                onChange={(e) => setNewProduct({...newProduct, sku: e.target.value.toUpperCase()})}
                                className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-bold uppercase"
                            />
                            <input 
                                type="text" placeholder="Nama Produk" 
                                value={newProduct.product_name}
                                onChange={(e) => setNewProduct({...newProduct, product_name: e.target.value})}
                                className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-bold sm:col-span-2"
                            />
                            <input 
                                type="number" placeholder="HPP" 
                                value={newProduct.cost_price || ''}
                                onWheel={(e) => e.currentTarget.blur()}
                                onChange={(e) => setNewProduct({...newProduct, cost_price: Number(e.target.value)})}
                                className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-bold"
                            />
                        </div>
                        <div className="flex justify-end gap-2 mt-3">
                            <button onClick={() => setIsAddingProduct(false)} className="px-4 py-2 text-xs font-bold text-slate-500 hover:bg-white rounded-lg">Batal</button>
                            <button onClick={handleSaveProduct} className="px-4 py-2 bg-green-600 text-white text-xs font-bold rounded-lg hover:bg-green-700">Simpan Produk</button>
                        </div>
                    </div>
                )}

                <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
                    <table className="w-full text-left">
                        <thead className="bg-slate-50 dark:bg-slate-800">
                            <tr>
                                <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase">SKU</th>
                                <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase">Nama Produk</th>
                                <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase">HPP</th>
                                <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase text-right">Aksi</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {filteredProducts.map(p => {
                                const isSelected = selectedSkus.has(p.sku);
                                return (
                                <tr key={p.sku} className={`hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${isSelected ? 'bg-orange-50/50 dark:bg-orange-900/10' : ''}`}>
                                    <td className="px-4 py-3 text-xs font-bold font-mono dark:text-orange-300">{p.sku}</td>
                                    <td className="px-4 py-3 text-sm font-medium dark:text-white">
                                        {editingProduct?.sku === p.sku ? (
                                            <input 
                                                autoFocus
                                                className="w-full p-1 border rounded bg-white dark:bg-slate-900"
                                                value={editingProduct.product_name}
                                                onChange={(e) => setEditingProduct({...editingProduct, product_name: e.target.value})}
                                            />
                                        ) : p.product_name}
                                    </td>
                                    <td className="px-4 py-3 text-sm font-medium dark:text-slate-300">
                                        {editingProduct?.sku === p.sku ? (
                                            <input 
                                                type="number"
                                                className="w-full p-1 border rounded bg-white dark:bg-slate-900"
                                                value={editingProduct.cost_price}
                                                onWheel={(e) => e.currentTarget.blur()}
                                                onChange={(e) => setEditingProduct({...editingProduct, cost_price: Number(e.target.value)})}
                                            />
                                        ) : (
                                            <span className={p.cost_price === 0 ? "text-red-500 font-bold" : ""}>
                                                {p.cost_price === 0 ? "Set HPP!" : `Rp ${p.cost_price.toLocaleString()}`}
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 text-right flex justify-end gap-2">
                                        {editingProduct?.sku === p.sku ? (
                                            <>
                                                <button onClick={handleUpdateProduct} className="p-1.5 bg-green-100 text-green-600 rounded-lg hover:bg-green-200"><Save className="w-4 h-4" /></button>
                                                <button onClick={() => setEditingProduct(null)} className="p-1.5 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200"><X className="w-4 h-4" /></button>
                                            </>
                                        ) : (
                                            <>
                                                <button onClick={() => setEditingProduct(p)} className="p-1.5 text-slate-400 hover:text-orange-600"><Edit2 className="w-4 h-4" /></button>
                                                <button onClick={() => handleDeleteProduct(p.sku)} className="p-1.5 text-slate-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                                            </>
                                        )}
                                    </td>
                                </tr>
                            )})}
                        </tbody>
                    </table>
                </div>
           </div>
       )}

    </div>
  );
};
