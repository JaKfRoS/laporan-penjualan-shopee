
import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../../services/supabase';
import { Store, Product } from '../../types';
import { toast } from 'react-hot-toast';
import { PackageSearch, Plus, Search, CheckCircle2, Link as LinkIcon, Edit2, Trash2, Save, X, Loader2, ArrowRightLeft, Lightbulb, FileSpreadsheet, CheckSquare, Square, Info, Download, Tag, DollarSign, PenSquare } from 'lucide-react';

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
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [isBulkEditing, setIsBulkEditing] = useState(false);
  const [bulkEditHpp, setBulkEditHpp] = useState<number | ''>('');
  
  // Mapping State
  const [unmappedItems, setUnmappedItems] = useState<{name: string, variation: string, count: number}[]>([]);
  const [loadingMapping, setLoadingMapping] = useState(false);
  
  // Edit/Create State
  const [isAddingProduct, setIsAddingProduct] = useState(false);
  const [newProduct, setNewProduct] = useState({ sku: '', product_name: '', variation_name: '', cost_price: 0 });
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

  // --- SMART SUGGESTION EFFECT V3 (STRICT MODE) ---
  useEffect(() => {
    if (selectedUnmapped && products.length > 0) {
      setMappingSearchTerm(''); 
      
      const clean = (str: string) => str ? str.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim() : '';
      const getTokens = (str: string) => clean(str).split(/\s+/).filter(w => w.length > 1);

      const sName = clean(selectedUnmapped.name);
      const sVar = clean(selectedUnmapped.variation || '');
      const sTokens = getTokens(selectedUnmapped.name);

      let bestScore = -Infinity;
      let bestSku = '';

      products.forEach(p => {
        let score = 0;
        const mName = clean(p.product_name);
        const mVar = clean(p.variation_name || '');
        const mSku = clean(p.sku);

        // 1. SKU Exact Match (Highest Priority) - Jika SKU ada di nama produk Shopee
        if (mSku === sName || mSku === sVar) score += 200;
        if (sName.includes(mSku)) score += 100;

        // 2. VARIATION LOGIC (CRITICAL)
        if (sVar.length > 0) {
            // Kasus A: Master Produk punya data variasi
            if (mVar.length > 0) {
                if (mVar === sVar) {
                    score += 100; // Cocok Sempurna
                } else if (mVar.includes(sVar) || sVar.includes(mVar)) {
                    score += 50; // Cocok Sebagian
                } else {
                    score -= 100; // PENALTI BESAR: Variasi beda (misal: "Merah" vs "Biru")
                }
            } 
            // Kasus B: Master Produk TIDAK punya kolom variasi, cek di nama produk
            else {
                if (mName.includes(sVar)) {
                     score += 60; // Variasi ditemukan di nama produk master
                } else {
                     // Netral, jangan kurangi skor karena mungkin master produk generik
                }
            }
        } else {
            // Shopee tidak punya variasi
            if (mVar.length > 0) {
                // Master punya variasi -> Penalti ringan, kita cari produk induk biasanya
                score -= 20; 
            }
        }

        // 3. NAME SIMILARITY (Token Jaccard)
        const mTokens = getTokens(p.product_name);
        const intersection = sTokens.filter(t => mTokens.includes(t));
        const union = new Set([...sTokens, ...mTokens]);
        
        if (union.size > 0) {
            const jaccard = intersection.length / union.size;
            score += jaccard * 50; // Maksimal 50 poin dari kesamaan nama
        }

        // 4. EXACT NAME MATCH BONUS
        if (sName === mName) score += 30;

        if (score > bestScore) {
          bestScore = score;
          bestSku = p.sku;
        }
      });

      // Threshold: Hanya pilih jika skor positif dan cukup tinggi (>30)
      // Ini menghindari saran ngawur jika tidak ada yang cocok sama sekali
      if (bestScore > 30) {
          setTargetSku(bestSku);
      } else {
          setTargetSku('');
      }
    }
  }, [selectedUnmapped, products]);


  // --- MASTER PRODUCT FUNCTIONS ---

  const fetchProducts = async () => {
    setLoadingProducts(true);
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
        variation_name: newProduct.variation_name || null,
        cost_price: newProduct.cost_price, 
        stock: 0
      }]);

      if (error) throw error;
      
      toast.success("Produk berhasil ditambahkan");
      setIsAddingProduct(false);
      setNewProduct({ sku: '', product_name: '', variation_name: '', cost_price: 0 });
      fetchProducts();
    } catch (err: any) {
      if (err.message.includes('variation_name')) {
        toast.error("Error Database: Kolom 'Variasi' belum ada. Silakan ke Pengaturan > Script Database.", { duration: 5000 });
      } else {
        toast.error(err.message);
      }
    }
  };

  const handleUpdateProduct = async () => {
    if (!editingProduct) return;
    try {
      const { error } = await supabase.from('products')
        .update({ 
            product_name: editingProduct.product_name,
            variation_name: editingProduct.variation_name,
            cost_price: editingProduct.cost_price 
        })
        .eq('sku', editingProduct.sku)
        .eq('store_id', store.id);

      if (error) throw error;
      toast.success("Produk diperbarui");
      setEditingProduct(null);
      fetchProducts();
    } catch (err: any) {
      if (err.message.includes('variation_name')) {
         toast.error("Error Database: Kolom 'Variasi' belum ada. Silakan ke Pengaturan > Script Database.", { duration: 5000 });
      } else {
         toast.error(err.message);
      }
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

  // --- BULK ACTION HANDLERS ---
  const toggleSelectAll = () => {
    if (selectedSkus.size === filteredProducts.length) {
      setSelectedSkus(new Set());
    } else {
      const allSkus = filteredProducts.map(p => p.sku);
      setSelectedSkus(new Set(allSkus));
    }
  };

  const toggleSelectSku = (sku: string) => {
    const newSelected = new Set(selectedSkus);
    if (newSelected.has(sku)) {
      newSelected.delete(sku);
    } else {
      newSelected.add(sku);
    }
    setSelectedSkus(newSelected);
  };

  const handleBulkDelete = async () => {
    if (selectedSkus.size === 0) return;
    if (!window.confirm(`Yakin ingin menghapus ${selectedSkus.size} produk terpilih? Data mapping dan history SKU ini akan ikut terhapus.`)) return;

    setIsBulkDeleting(true);
    const toastId = toast.loading(`Menghapus ${selectedSkus.size} produk...`);

    try {
      // OPTIMIZED: Use single RPC call passing ARRAY of SKUs
      const { error } = await supabase.rpc('delete_products_bulk', { 
        p_skus: Array.from(selectedSkus), 
        p_store_id: store.id 
      });

      if (error) {
        // Fallback if RPC doesnt exist yet
        if (error.code === 'PGRST202' || error.message.includes('function not found')) {
             throw new Error("Update database diperlukan (Script SQL)");
        }
        throw error;
      }

      toast.success("Produk terpilih berhasil dihapus", { id: toastId });
      setSelectedSkus(new Set());
      fetchProducts();
    } catch (err: any) {
      console.error(err);
      if (err.message.includes('Script SQL')) {
         toast.error("Database belum update. Buka Pengaturan -> Script Database", { id: toastId, duration: 5000 });
      } else {
         toast.error("Gagal hapus massal: " + err.message, { id: toastId });
      }
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const handleBulkEditHPP = async () => {
      if (selectedSkus.size === 0) return;
      if (bulkEditHpp === '') {
          toast.error("Masukkan nilai HPP");
          return;
      }
      
      const toastId = toast.loading(`Mengupdate ${selectedSkus.size} produk...`);
      setIsBulkEditing(true);

      try {
        const { error } = await supabase
          .from('products')
          .update({ cost_price: Number(bulkEditHpp) })
          .eq('store_id', store.id)
          .in('sku', Array.from(selectedSkus));

        if (error) throw error;

        toast.success("HPP Berhasil diupdate!", { id: toastId });
        setBulkEditHpp('');
        setIsBulkEditing(false);
        setSelectedSkus(new Set()); // Opsional: clear selection
        fetchProducts();
      } catch (err: any) {
        toast.error("Gagal update: " + err.message, { id: toastId });
      } finally {
        setIsBulkEditing(false);
      }
  };

  // --- IMPORT EXCEL LOGIC ---
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    const toastId = toast.loading("Membaca file Excel...");

    try {
        const reader = new FileReader();
        reader.onload = async (evt) => {
            try {
                const bstr = evt.target?.result;
                const wb = XLSX.read(bstr, { type: 'binary' });
                const wsname = wb.SheetNames[0];
                const ws = wb.Sheets[wsname];
                const data = XLSX.utils.sheet_to_json(ws) as any[];

                if (data.length === 0) {
                    throw new Error("File kosong");
                }

                // Prepare products payload
                const productsToUpsert = [];
                let successCount = 0;

                for (const row of data) {
                    const keys = Object.keys(row);
                    const skuKey = keys.find(k => k.toLowerCase().includes('sku') || k.toLowerCase().includes('kode'));
                    const nameKey = keys.find(k => k.toLowerCase().includes('nama') || k.toLowerCase().includes('produk'));
                    const varKey = keys.find(k => k.toLowerCase().includes('variasi') || k.toLowerCase().includes('variation'));
                    const hppKey = keys.find(k => k.toLowerCase().includes('hpp') || k.toLowerCase().includes('cost') || k.toLowerCase().includes('modal') || k.toLowerCase().includes('harga'));

                    if (skuKey && row[skuKey]) {
                        const rawHpp = hppKey ? row[hppKey] : 0;
                        let cleanHpp = 0;
                        if (typeof rawHpp === 'string') {
                            cleanHpp = parseFloat(rawHpp.replace(/[^0-9.-]+/g, ""));
                        } else {
                            cleanHpp = Number(rawHpp) || 0;
                        }

                        productsToUpsert.push({
                            store_id: store.id,
                            sku: String(row[skuKey]).trim(),
                            product_name: nameKey ? String(row[nameKey]).trim() : 'Imported Product',
                            variation_name: varKey ? String(row[varKey]).trim() : null,
                            cost_price: cleanHpp,
                            stock: 0
                        });
                        successCount++;
                    }
                }

                if (productsToUpsert.length > 0) {
                    toast.loading(`Menyimpan ${productsToUpsert.length} produk...`, { id: toastId });
                    const { error } = await supabase
                        .from('products')
                        .upsert(productsToUpsert, { onConflict: 'sku, store_id' });

                    if (error) throw error;
                    toast.success(`Berhasil import ${productsToUpsert.length} produk!`, { id: toastId });
                    fetchProducts();
                } else {
                    toast.error("Tidak ada kolom SKU yang ditemukan di Excel", { id: toastId });
                }

            } catch (err: any) {
                console.error(err);
                if (err.message.includes('variation_name') || err.message.includes('column')) {
                   toast.error("Database Belum Update: Kolom 'variation_name' hilang. Buka menu Pengaturan -> Script Database.", { id: toastId, duration: 6000 });
                } else {
                   toast.error("Gagal import: " + err.message, { id: toastId });
                }
            } finally {
                setIsImporting(false);
                if (fileInputRef.current) fileInputRef.current.value = '';
            }
        };
        reader.readAsBinaryString(file);
    } catch (err) {
        setIsImporting(false);
        toast.dismiss(toastId);
    }
  };

  const handleDownloadTemplate = () => {
    const ws = XLSX.utils.json_to_sheet([
        { "SKU": "KT-KOL-001", "Nama Produk": "Kolam Terpal Kotak Korea", "nama variasi": "Kolam Saja", "HPP": 150000 },
        { "SKU": "KT+P-002", "Nama Produk": "Kolam Terpal Kotak Korea", "nama variasi": "+ Pembuangan Drat", "HPP": 175000 },
        { "SKU": "TP-A12-005", "Nama Produk": "TERPAL PE A20 KOREA 2X3", "nama variasi": "A12", "HPP": 85000 }
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, "Template_Master_Produk_Lengkap.xlsx");
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
        const { error: mapError } = await supabase.from('sku_mappings').upsert([{
            store_id: store.id,
            shopee_product_name: selectedUnmapped.name,
            shopee_variation_name: selectedUnmapped.variation,
            mapped_sku: targetSku
        }], { onConflict: 'store_id, shopee_product_name, shopee_variation_name'});

        if (mapError) throw mapError;

        const product = products.find(p => p.sku === targetSku);
        if (!product) throw new Error("Produk master tidak ditemukan");

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
            variation_name: newProduct.variation_name || null,
            cost_price: newProduct.cost_price,
            stock: 0
          }]);
          
          if (prodError) throw prodError;

          await fetchProducts();
          setTargetSku(newProduct.sku);
          
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
        setNewProduct({ sku: '', product_name: '', variation_name: '', cost_price: 0 });
        setSelectedUnmapped(null);
        fetchUnmappedItems();

      } catch (err: any) {
          toast.error("Gagal: " + err.message, { id: toastId });
      }
  };

  const filteredProducts = products.filter(p => 
      p.product_name.toLowerCase().includes(searchProduct.toLowerCase()) || 
      (p.variation_name || '').toLowerCase().includes(searchProduct.toLowerCase()) || 
      p.sku.toLowerCase().includes(searchProduct.toLowerCase())
  );

  const mappingOptions = products.filter(p => 
      !mappingSearchTerm || 
      p.product_name.toLowerCase().includes(mappingSearchTerm.toLowerCase()) ||
      p.sku.toLowerCase().includes(mappingSearchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
       
       <div className="flex flex-wrap gap-2 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl w-fit">
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
                                <td className="px-6 py-4 font-medium text-sm dark:text-white">
                                  {item.name}
                                  {/* NEW: Show Suggestion Badge if Smart Logic found match */}
                                  {products.some(p => p.sku === targetSku) && item === selectedUnmapped && (
                                     <span className="block mt-1 text-[10px] text-orange-500 font-bold flex items-center gap-1">
                                       <Lightbulb className="w-3 h-3" /> Auto-Suggest Available
                                     </span>
                                  )}
                                </td>
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
              <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl max-w-lg w-full overflow-hidden flex flex-col max-h-[90vh]">
                 <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex justify-between items-start shrink-0">
                    <div>
                       <h3 className="text-lg font-black uppercase tracking-tight text-slate-900 dark:text-white">Hubungkan SKU</h3>
                       <p className="text-xs text-slate-500 mt-1">Produk Shopee: <span className="font-bold text-orange-600">{selectedUnmapped.name} {selectedUnmapped.variation ? `(${selectedUnmapped.variation})` : ''}</span></p>
                    </div>
                    <button onClick={() => { setSelectedUnmapped(null); setIsQuickCreating(false); }} className="text-slate-400 hover:text-red-500"><X className="w-6 h-6" /></button>
                 </div>
                 
                 <div className="p-6 space-y-6 overflow-y-auto custom-scrollbar">
                    {!isQuickCreating ? (
                        <>
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-slate-500 uppercase flex items-center justify-between">
                                  <span>Cari & Pilih Master SKU</span>
                                  {targetSku && !mappingSearchTerm && (
                                    <span className="text-[10px] text-orange-600 flex items-center gap-1 font-bold animate-pulse">
                                      <Lightbulb className="w-3 h-3" /> Saran AI (Cek Varian)
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
                                    className="w-full p-4 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-orange-500/20"
                                    size={5} 
                                >
                                    <option value="" className="p-2 text-slate-400">-- Pilih SKU Internal --</option>
                                    {mappingOptions.map(p => (
                                        <option key={p.sku} value={p.sku} className="p-2 border-b border-slate-100 dark:border-slate-700/50">
                                            {p.product_name} {p.variation_name ? `[${p.variation_name}]` : ''} ({p.sku})
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
                                        setNewProduct({ 
                                            sku: '', 
                                            product_name: selectedUnmapped.name,
                                            variation_name: selectedUnmapped.variation || '', 
                                            cost_price: 0 
                                        });
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
                                    <label className="text-[10px] font-black uppercase text-slate-400">Variasi (Opsional)</label>
                                    <input 
                                        type="text" 
                                        value={newProduct.variation_name}
                                        onChange={(e) => setNewProduct({...newProduct, variation_name: e.target.value})}
                                        className="w-full p-3 bg-slate-50 dark:bg-slate-800 border rounded-xl font-bold"
                                        placeholder="Contoh: Merah, XL"
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

       {/* BULK EDIT MODAL */}
       {isBulkEditing && (
           <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
               <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl max-w-sm w-full p-6">
                   <div className="flex justify-between items-center mb-4">
                       <h3 className="text-lg font-black uppercase dark:text-white">Edit HPP Massal</h3>
                       <button onClick={() => setIsBulkEditing(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5"/></button>
                   </div>
                   <p className="text-sm text-slate-500 mb-4">
                       Mengupdate HPP untuk <span className="font-bold text-slate-900 dark:text-white">{selectedSkus.size} produk</span> terpilih.
                   </p>
                   
                   <div className="relative mb-6">
                       <DollarSign className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                       <input 
                           type="number" 
                           placeholder="0"
                           autoFocus
                           value={bulkEditHpp}
                           onChange={(e) => setBulkEditHpp(e.target.value === '' ? '' : Number(e.target.value))}
                           className="w-full pl-12 pr-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-lg font-bold outline-none focus:ring-2 focus:ring-orange-500/20"
                       />
                   </div>

                   <div className="flex gap-2">
                       <button onClick={() => setIsBulkEditing(false)} className="flex-1 py-3 bg-slate-100 dark:bg-slate-800 text-slate-500 font-bold rounded-xl hover:bg-slate-200">Batal</button>
                       <button onClick={handleBulkEditHPP} className="flex-1 py-3 bg-orange-600 text-white font-bold rounded-xl hover:bg-orange-700">Simpan</button>
                   </div>
               </div>
           </div>
       )}

       {activeTab === 'master' && (
           <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 p-6 relative">
                
                {/* FLOATING ACTION BAR FOR BULK ACTIONS */}
                {selectedSkus.size > 0 && (
                    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 bg-slate-900 text-white px-4 py-2 rounded-xl shadow-xl animate-in fade-in slide-in-from-top-2">
                        <span className="text-xs font-bold whitespace-nowrap">{selectedSkus.size} terpilih</span>
                        <div className="h-4 w-px bg-slate-700"></div>
                        
                        {/* EDIT BUTTON */}
                        <button 
                            onClick={() => setIsBulkEditing(true)}
                            className="flex items-center gap-1 text-xs font-bold text-blue-400 hover:text-blue-300"
                        >
                            <PenSquare className="w-3 h-3" />
                            Edit HPP
                        </button>
                        
                        <div className="h-4 w-px bg-slate-700"></div>

                        {/* DELETE BUTTON */}
                        <button 
                            onClick={handleBulkDelete}
                            disabled={isBulkDeleting}
                            className="flex items-center gap-1 text-xs font-bold text-red-400 hover:text-red-300"
                        >
                            {isBulkDeleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                            Hapus
                        </button>
                        <button onClick={() => setSelectedSkus(new Set())} className="ml-2 text-slate-500 hover:text-white"><X className="w-3 h-3" /></button>
                    </div>
                )}

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
                    
                    <div className="flex items-center gap-2">
                        {/* INPUT FILE HIDDEN */}
                        <input 
                            type="file" 
                            accept=".xlsx, .xls, .csv" 
                            className="hidden" 
                            ref={fileInputRef} 
                            onChange={handleImportFile}
                        />

                        {/* TOMBOL IMPORT */}
                        <div className="relative group">
                            <button 
                                onClick={() => fileInputRef.current?.click()}
                                disabled={isImporting}
                                className="px-4 py-2 bg-green-600 text-white text-sm font-black rounded-xl hover:bg-green-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                            >
                                {isImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
                                {isImporting ? 'LOADING...' : 'IMPORT EXCEL'}
                            </button>
                            {/* Download Template Tooltip/Action */}
                            <div className="absolute top-full right-0 mt-2 w-48 p-2 bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-xl shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-20">
                                <button 
                                    onClick={handleDownloadTemplate}
                                    className="w-full text-left px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg flex items-center gap-2"
                                >
                                    <Download className="w-3 h-3" /> Download Template
                                </button>
                            </div>
                        </div>

                        <button 
                            onClick={() => setIsAddingProduct(true)}
                            className="px-4 py-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-black rounded-xl hover:opacity-90 transition-all flex items-center justify-center gap-2"
                        >
                            <Plus className="w-4 h-4" />
                            MANUAL
                        </button>
                    </div>
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
                            <div className="sm:col-span-2 grid grid-cols-2 gap-2">
                                <input 
                                    type="text" placeholder="Nama Produk" 
                                    value={newProduct.product_name}
                                    onChange={(e) => setNewProduct({...newProduct, product_name: e.target.value})}
                                    className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-bold w-full"
                                />
                                <input 
                                    type="text" placeholder="Variasi (Opsional)" 
                                    value={newProduct.variation_name}
                                    onChange={(e) => setNewProduct({...newProduct, variation_name: e.target.value})}
                                    className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-bold w-full"
                                />
                            </div>
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
                                {/* CHECKBOX HEADER */}
                                <th className="px-4 py-3 w-10">
                                    <button onClick={toggleSelectAll} className="flex items-center justify-center text-slate-400 hover:text-slate-600">
                                        {selectedSkus.size > 0 && selectedSkus.size === filteredProducts.length 
                                            ? <CheckSquare className="w-5 h-5 text-orange-600" />
                                            : <Square className="w-5 h-5" />
                                        }
                                    </button>
                                </th>
                                <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase">SKU</th>
                                <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase">Nama Produk</th>
                                <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase">Variasi</th>
                                <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase">HPP</th>
                                <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase text-right">Aksi</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {filteredProducts.map(p => {
                                const isSelected = selectedSkus.has(p.sku);
                                return (
                                <tr key={p.sku} className={`hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${isSelected ? 'bg-orange-50/50 dark:bg-orange-900/10' : ''}`}>
                                    {/* CHECKBOX ROW */}
                                    <td className="px-4 py-3">
                                        <button onClick={() => toggleSelectSku(p.sku)} className="flex items-center justify-center">
                                            {isSelected 
                                                ? <CheckSquare className="w-5 h-5 text-orange-600" />
                                                : <Square className="w-5 h-5 text-slate-300" />
                                            }
                                        </button>
                                    </td>
                                    <td className="px-4 py-3 text-xs font-bold font-mono dark:text-orange-300">{p.sku}</td>
                                    
                                    {/* Kolom Produk */}
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

                                    {/* Kolom Variasi (BARU) */}
                                    <td className="px-4 py-3 text-sm font-medium dark:text-white">
                                        {editingProduct?.sku === p.sku ? (
                                            <input 
                                                className="w-full p-1 border rounded bg-white dark:bg-slate-900"
                                                value={editingProduct.variation_name || ''}
                                                onChange={(e) => setEditingProduct({...editingProduct, variation_name: e.target.value})}
                                                placeholder="-"
                                            />
                                        ) : (
                                            p.variation_name ? (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                                                    <Tag className="w-3 h-3" /> {p.variation_name}
                                                </span>
                                            ) : <span className="text-slate-300">-</span>
                                        )}
                                    </td>

                                    {/* Kolom HPP */}
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
