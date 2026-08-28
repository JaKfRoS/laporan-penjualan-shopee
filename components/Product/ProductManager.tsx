
import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
import Fuse from 'fuse.js';
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
  const [manualProductBase, setManualProductBase] = useState({ parent_sku: '', product_name: '' });
  const [manualProductVariations, setManualProductVariations] = useState([{ sku: '', variation_name: '', cost_price: 0, processing_fee: 1250 }]);
  const [newProduct, setNewProduct] = useState({ sku: '', parent_sku: '', product_name: '', variation_name: '', cost_price: 0, processing_fee: 1250 });
  const [editingProductGroup, setEditingProductGroup] = useState<Product[] | null>(null);

  // Mapping Selection State
  const [selectedUnmapped, setSelectedUnmapped] = useState<{name: string, variation: string} | null>(null);
  const [targetSku, setTargetSku] = useState('');
  const [mappingSearchTerm, setMappingSearchTerm] = useState('');
  const [suggestedMatches, setSuggestedMatches] = useState<(Product & { matchScore: number })[]>([]);
  
  // Quick Create State (in Mapping)
  const [isQuickCreating, setIsQuickCreating] = useState(false);

  // Import State
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);

  // Tracks the currently-shown "Berhasil terhubung..." toast (with Urungkan)
  // so a new mapping dismisses the previous one instead of stacking up.
  const lastMappingToastId = useRef<string | null>(null);

  useEffect(() => {
    fetchProducts();
    if (activeTab === 'mapping') fetchUnmappedItems();
  }, [store, activeTab]);

  // --- SMART SUGGESTION EFFECT V4 (RANKED CANDIDATES) ---
  useEffect(() => {
    if (selectedUnmapped && products.length > 0) {
      setMappingSearchTerm('');

      // Treat common separators (, / - _ ( ) |) as word breaks instead of deleting
      // them, so e.g. "Coklat,XL" tokenizes as ["coklat", "xl"] rather than "coklatxl".
      const clean = (str: string) => str
        ? str.toLowerCase().replace(/[,/\-_()|]+/g, ' ').replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim()
        : '';
      const getTokens = (str: string) => clean(str).split(/\s+/).filter(w => w.length > 1);

      const sName = clean(selectedUnmapped.name);
      const sVar = clean(selectedUnmapped.variation || '');
      const sTokens = getTokens(selectedUnmapped.name);

      const scored = products.map(p => {
        let score = 0;
        const mName = clean(p.product_name);
        const mVar = clean(p.variation_name || '');
        const mSku = clean(p.sku);

        // 1. SKU Exact Match (Highest Priority)
        if (mSku && (mSku === sName || mSku === sVar)) score += 200;
        else if (mSku && (sName.includes(mSku) || sVar.includes(mSku))) score += 100;

        // 2. VARIATION LOGIC (CRITICAL)
        if (sVar.length > 0) {
            if (mVar.length > 0) {
                if (mVar === sVar) {
                    score += 100; // Exact match
                } else if (mVar.includes(sVar) || sVar.includes(mVar)) {
                    score += 50; // Partial match
                } else {
                    // Check token overlap for variations
                    const sVarTokens = getTokens(selectedUnmapped.variation || '');
                    const mVarTokens = getTokens(p.variation_name || '');
                    const varIntersection = sVarTokens.filter(t => mVarTokens.includes(t));
                    if (varIntersection.length > 0) {
                        score += (varIntersection.length / Math.max(sVarTokens.length, mVarTokens.length)) * 50;
                    } else {
                        score -= 100; // Penalty for completely different variations
                    }
                }
            } else {
                if (mName.includes(sVar)) {
                     score += 60;
                }
            }
        } else {
            if (mVar.length > 0) {
                if (sName.includes(mVar)) {
                    score += 60;
                } else {
                    score -= 20;
                }
            }
        }

        // 3. NAME SIMILARITY (Token Jaccard)
        const mTokens = getTokens(p.product_name);
        const intersection = sTokens.filter(t => mTokens.includes(t));
        const union = new Set([...sTokens, ...mTokens]);

        if (union.size > 0) {
            const jaccard = intersection.length / union.size;
            score += jaccard * 50;
        }

        // 4. EXACT NAME MATCH BONUS
        if (sName === mName) score += 30;
        else if (sName.includes(mName) || mName.includes(sName)) score += 15;

        return { ...p, matchScore: score };
      }).sort((a, b) => b.matchScore - a.matchScore);

      const best = scored[0];

      // Threshold: Hanya pilih jika skor positif dan cukup tinggi (>30)
      // Ini menghindari saran ngawur jika tidak ada yang cocok sama sekali
      setTargetSku(best && best.matchScore > 30 ? best.sku : '');

      // Show a handful of runner-up candidates too (lower bar than auto-select)
      // so users mapping hundreds of near-identical variants can just click the
      // right one instead of hunting through the whole product list.
      setSuggestedMatches(scored.filter(p => p.matchScore > 15).slice(0, 5));
    } else {
      setSuggestedMatches([]);
    }
  }, [selectedUnmapped, products]);


  // --- MASTER PRODUCT FUNCTIONS ---

  const fetchProducts = async () => {
    setLoadingProducts(true);

    // Paginate: a single request caps at 1000 rows, and stores can have more
    // master SKUs than that — without this, products past the first 1000 would
    // silently be invisible to search, mapping suggestions, and the list itself.
    let allProducts: Product[] = [];
    let from = 0;
    const pageSize = 1000;
    let fetchError: any = null;
    while (true) {
        const { data, error } = await supabase
          .from('products')
          .select('*')
          .eq('store_id', store.id)
          .order('product_name')
          .range(from, from + pageSize - 1);

        if (error) { fetchError = error; break; }

        allProducts = allProducts.concat(data || []);
        if (!data || data.length < pageSize) break;
        from += pageSize;
    }

    if (fetchError) toast.error("Gagal memuat produk: " + fetchError.message);
    else setProducts(allProducts);
    
    setSelectedSkus(new Set()); 
    setLoadingProducts(false);
  };

  const handleSaveProduct = async () => {
    if (!manualProductBase.product_name) {
      toast.error("Nama Produk wajib diisi");
      return;
    }

    const invalidVariations = manualProductVariations.filter(v => !v.sku);
    if (invalidVariations.length > 0) {
      toast.error("Semua variasi harus memiliki SKU");
      return;
    }

    try {
      const productsToInsert = manualProductVariations.map(v => ({
        store_id: store.id,
        sku: v.sku,
        parent_sku: manualProductBase.parent_sku || null,
        product_name: manualProductBase.product_name,
        variation_name: v.variation_name || null,
        cost_price: v.cost_price, 
        processing_fee: v.processing_fee,
        stock: 0
      }));

      const { error } = await supabase.from('products').insert(productsToInsert);

      if (error) throw error;
      
      toast.success("Produk berhasil ditambahkan");
      setIsAddingProduct(false);
      setManualProductBase({ parent_sku: '', product_name: '' });
      setManualProductVariations([{ sku: '', variation_name: '', cost_price: 0, processing_fee: 1250 }]);
      fetchProducts();
    } catch (err: any) {
      if (err.message.includes('variation_name')) {
        toast.error("Error Database: Kolom 'Variasi' belum ada. Silakan ke Pengaturan > Script Database.", { duration: 5000 });
      } else {
        toast.error(err.message);
      }
    }
  };

  const handleEditGroup = (product: Product) => {
    const group = products.filter(p => 
        (p.product_name || '').trim().toLowerCase() === (product.product_name || '').trim().toLowerCase()
    );
    // Deep copy to avoid mutating state directly
    setEditingProductGroup(JSON.parse(JSON.stringify(group.length > 0 ? group : [product])));
  };

  const handleSaveGroup = async () => {
    if (!editingProductGroup) return;
    
    const toastId = toast.loading("Menyimpan perubahan...");
    try {
        const updates = editingProductGroup.map(p => 
            supabase.from('products')
            .update({
                product_name: p.product_name,
                parent_sku: p.parent_sku || null,
                variation_name: p.variation_name,
                cost_price: p.cost_price,
                processing_fee: p.processing_fee
            })
            .eq('sku', p.sku)
            .eq('store_id', store.id)
        );

        const results = await Promise.all(updates);
        const errors = results.filter(r => r.error).map(r => r.error);
        
        if (errors.length > 0) throw errors[0];

        toast.success("Produk berhasil diupdate", { id: toastId });
        setEditingProductGroup(null);
        fetchProducts();
    } catch (err: any) {
        toast.error("Gagal update: " + err.message, { id: toastId });
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
                    const skuKey = keys.find(k => k.toLowerCase() === 'sku' || k.toLowerCase() === 'kode');
                    const parentSkuKey = keys.find(k => k.toLowerCase().includes('induk') || k.toLowerCase() === 'parent sku' || k.toLowerCase() === 'sku induk');
                    const nameKey = keys.find(k => k.toLowerCase().includes('nama') || k.toLowerCase().includes('produk'));
                    const varKey = keys.find(k => k.toLowerCase().includes('variasi') || k.toLowerCase().includes('variation'));
                    const hppKey = keys.find(k => k.toLowerCase().includes('hpp') || k.toLowerCase().includes('cost') || k.toLowerCase().includes('modal') || k.toLowerCase().includes('harga'));
                    const procKey = keys.find(k => k.toLowerCase().includes('proses') || k.toLowerCase().includes('processing') || k.toLowerCase().includes('fee'));

                    if (skuKey && row[skuKey]) {
                        const rawHpp = hppKey ? row[hppKey] : 0;
                        let cleanHpp = 0;
                        if (typeof rawHpp === 'string') {
                            cleanHpp = parseFloat(rawHpp.replace(/[^0-9.-]+/g, ""));
                        } else {
                            cleanHpp = Number(rawHpp) || 0;
                        }

                        const rawProc = procKey ? row[procKey] : 0;
                        let cleanProc = 0;
                        if (typeof rawProc === 'string') {
                            cleanProc = parseFloat(rawProc.replace(/[^0-9.-]+/g, ""));
                        } else {
                            cleanProc = Number(rawProc) || 0;
                        }

                        productsToUpsert.push({
                            store_id: store.id,
                            sku: String(row[skuKey]).trim(),
                            parent_sku: parentSkuKey && row[parentSkuKey] ? String(row[parentSkuKey]).trim() : null,
                            product_name: nameKey ? String(row[nameKey]).trim() : 'Imported Product',
                            variation_name: varKey ? String(row[varKey]).trim() : null,
                            cost_price: cleanHpp,
                            processing_fee: cleanProc,
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
        { "SKU INDUK": "KT-KOL", "SKU": "KT-KOL-001", "Nama Produk": "Kolam Terpal Kotak Korea", "nama variasi": "Kolam Saja", "HPP": 150000, "Biaya Proses": 5000 },
        { "SKU INDUK": "KT-KOL", "SKU": "KT+P-002", "Nama Produk": "Kolam Terpal Kotak Korea", "nama variasi": "+ Pembuangan Drat", "HPP": 175000, "Biaya Proses": 5000 },
        { "SKU INDUK": "TP-A12", "SKU": "TP-A12-005", "Nama Produk": "TERPAL PE A20 KOREA 2X3", "nama variasi": "A12", "HPP": 85000, "Biaya Proses": 2000 }
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, "Template_Master_Produk_Lengkap.xlsx");
  };

  const handleBackupHPP = () => {
    if (products.length === 0) {
        toast.error("Tidak ada data produk untuk dibackup");
        return;
    }

    const exportData = products.map(p => ({
        "SKU INDUK": p.parent_sku || "",
        "SKU": p.sku,
        "Nama Produk": p.product_name,
        "Variasi": p.variation_name || "",
        "HPP": p.cost_price,
        "Biaya Proses": p.processing_fee || 0
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Backup HPP");
    XLSX.writeFile(wb, `Backup_HPP_${store.name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`);
    toast.success("Backup HPP berhasil didownload!");
  };


  // --- MAPPING FUNCTIONS ---

  const fetchUnmappedItems = async () => {
    setLoadingMapping(true);

    // Supabase caps a single request at 1000 rows by default. Without pagination,
    // stores with more than 1000 unmapped order_items would only ever see a
    // partial, arbitrarily-ordered slice — so the "unmapped" count and list could
    // look stuck even after mapping many items, since each refetch samples a
    // different subset instead of the full remaining backlog.
    let allItems: { product_name: string; variation: string | null }[] = [];
    let from = 0;
    const pageSize = 1000;
    while (true) {
        const { data, error } = await supabase
          .from('order_items')
          .select('product_name, variation')
          .eq('store_id', store.id)
          .eq('is_sku_mapped', false)
          .range(from, from + pageSize - 1);

        if (error) {
            toast.error("Gagal memuat produk belum ter-mapping: " + error.message);
            setLoadingMapping(false);
            return;
        }

        allItems = allItems.concat(data || []);
        if (!data || data.length < pageSize) break;
        from += pageSize;
    }

    const groups: Record<string, number> = {};
    allItems.forEach(item => {
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

  // Reverts a just-applied mapping: unmaps the affected order_items and removes
  // the saved sku_mapping so it doesn't silently re-apply on the next import.
  const handleUndoMapping = async (name: string, variation: string) => {
     const undoToastId = toast.loading("Membatalkan mapping...");
     try {
        const { error: revertError } = await supabase
            .from('order_items')
            .update({ final_sku: null, is_sku_mapped: false, hpp_at_time: 0 })
            .eq('store_id', store.id)
            .eq('product_name', name)
            .eq('variation', variation);

        if (revertError) throw revertError;

        const { error: deleteMapError } = await supabase
            .from('sku_mappings')
            .delete()
            .eq('store_id', store.id)
            .eq('shopee_product_name', name)
            .eq('shopee_variation_name', variation);

        if (deleteMapError) throw deleteMapError;

        toast.success("Mapping dibatalkan", { id: undoToastId });
        fetchUnmappedItems();
     } catch (err: any) {
        console.error(err);
        toast.error("Gagal membatalkan mapping: " + err.message, { id: undoToastId });
     }
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

        const undoName = selectedUnmapped.name;
        const undoVariation = selectedUnmapped.variation;
        if (lastMappingToastId.current) toast.dismiss(lastMappingToastId.current);
        toast.success((t) => (
            <span className="flex items-center gap-3">
                <span>Berhasil terhubung ke <b>{targetSku}</b></span>
                <button
                    onClick={() => { toast.dismiss(t.id); handleUndoMapping(undoName, undoVariation); }}
                    className="shrink-0 px-2 py-1 text-xs font-black text-orange-600 hover:text-orange-700 underline uppercase tracking-wide"
                >
                    Urungkan
                </button>
            </span>
        ), { id: toastId, duration: 5000 });
        lastMappingToastId.current = toastId;
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
            processing_fee: newProduct.processing_fee,
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

        const undoName = selectedUnmapped!.name;
        const undoVariation = selectedUnmapped!.variation;
        const createdSku = newProduct.sku;
        if (lastMappingToastId.current) toast.dismiss(lastMappingToastId.current);
        toast.success((t) => (
            <span className="flex items-center gap-3">
                <span>Produk dibuat & berhasil terhubung ke <b>{createdSku}</b></span>
                <button
                    onClick={() => { toast.dismiss(t.id); handleUndoMapping(undoName, undoVariation); }}
                    className="shrink-0 px-2 py-1 text-xs font-black text-orange-600 hover:text-orange-700 underline uppercase tracking-wide"
                >
                    Urungkan
                </button>
            </span>
        ), { id: toastId, duration: 5000 });
        lastMappingToastId.current = toastId;
        setIsQuickCreating(false);
        setNewProduct({ sku: '', parent_sku: '', product_name: '', variation_name: '', cost_price: 0, processing_fee: 1250 });
        setSelectedUnmapped(null);
        fetchUnmappedItems();

      } catch (err: any) {
          toast.error("Gagal: " + err.message, { id: toastId });
      }
  };

  // Fuzzy search so a typo, missing letter, or different word order still finds the
  // right master product (previously required an exact substring match).
  const productsFuse = useMemo(() => new Fuse(products, {
      keys: [
          { name: 'product_name', weight: 0.5 },
          { name: 'sku', weight: 0.3 },
          { name: 'variation_name', weight: 0.2 },
      ],
      threshold: 0.4,
      ignoreLocation: true,
      minMatchCharLength: 2,
  }), [products]);

  const filteredProducts = searchProduct.trim()
      ? productsFuse.search(searchProduct.trim()).map(r => r.item)
      : products;

  const mappingOptions = mappingSearchTerm.trim()
      ? productsFuse.search(mappingSearchTerm.trim()).map(r => r.item)
      : products;

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
           <div className="fixed inset-0 z-[110] flex items-center justify-center p-2 md:p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
              <div className="bg-white dark:bg-slate-900 rounded-[2rem] md:rounded-[2.5rem] shadow-2xl max-w-lg w-full overflow-hidden flex flex-col max-h-[95vh]">
                 <div className="p-5 md:p-6 border-b border-slate-100 dark:border-slate-800 flex justify-between items-start shrink-0 bg-slate-50/50 dark:bg-slate-800/30">
                    <div>
                       <h3 className="text-base md:text-lg font-black uppercase tracking-tight text-slate-900 dark:text-white">Hubungkan SKU</h3>
                       <p className="text-[10px] md:text-xs text-slate-500 mt-1">Produk Shopee: <span className="font-bold text-orange-600">{selectedUnmapped.name} {selectedUnmapped.variation ? `(${selectedUnmapped.variation})` : ''}</span></p>
                    </div>
                    <button onClick={() => { setSelectedUnmapped(null); setIsQuickCreating(false); }} className="p-2 text-slate-400 hover:text-red-500 transition-colors"><X className="w-6 h-6" /></button>
                 </div>
                 
                 <div className="p-5 md:p-6 space-y-6 overflow-y-auto custom-scrollbar">
                    {!isQuickCreating ? (
                        <>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center justify-between ml-1">
                                  <span>Cari & Pilih Master SKU</span>
                                  {targetSku && !mappingSearchTerm && (
                                    <span className="text-[9px] text-orange-600 flex items-center gap-1 font-bold animate-pulse">
                                      <Lightbulb className="w-3 h-3" /> Saran AI
                                    </span>
                                  )}
                                </label>
                                
                                <div className="relative group">
                                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-orange-500 transition-colors" />
                                    <input
                                        type="text"
                                        placeholder="Ketik untuk mencari produk..."
                                        value={mappingSearchTerm}
                                        onChange={(e) => setMappingSearchTerm(e.target.value)}
                                        className="w-full pl-11 pr-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-sm font-bold outline-none focus:ring-4 focus:ring-orange-500/10 focus:border-orange-500 transition-all"
                                    />
                                </div>

                                {!mappingSearchTerm && suggestedMatches.length > 0 && (
                                    <div className="space-y-1.5">
                                        <p className="text-[10px] font-black text-orange-500 uppercase tracking-widest flex items-center gap-1">
                                            <Lightbulb className="w-3 h-3" /> Saran SKU Mirip
                                        </p>
                                        <div className="flex flex-col gap-1.5">
                                            {suggestedMatches.map((p, idx) => (
                                                <button
                                                    key={p.sku}
                                                    type="button"
                                                    onClick={() => setTargetSku(p.sku)}
                                                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl border text-left transition-all ${
                                                        targetSku === p.sku
                                                            ? 'border-orange-500 bg-orange-50 dark:bg-orange-500/10'
                                                            : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-orange-300'
                                                    }`}
                                                >
                                                    <span className="shrink-0 font-mono text-[11px] font-black px-2 py-1 rounded-lg bg-slate-900 text-white dark:bg-orange-600">
                                                        {p.sku}
                                                    </span>
                                                    <span className="min-w-0 flex-1 text-xs font-bold text-slate-700 dark:text-slate-300 truncate">
                                                        {p.product_name} {p.variation_name ? `- ${p.variation_name}` : ''}
                                                    </span>
                                                    {idx === 0 && (
                                                        <span className="shrink-0 text-[9px] font-black text-orange-500 uppercase">Terbaik</span>
                                                    )}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                 <div className="border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden shadow-sm bg-slate-50 dark:bg-slate-800/50">
                                    <select 
                                        value={targetSku}
                                        onChange={(e) => setTargetSku(e.target.value)}
                                        className="w-full p-2 bg-transparent outline-none font-bold text-slate-700 dark:text-white text-sm"
                                        size={5} 
                                    >
                                        <option value="" className="p-3 text-slate-400">-- Pilih SKU Internal --</option>
                                        {mappingOptions.map(p => (
                                            <option key={p.sku} value={p.sku} className="p-3 border-b border-slate-100 dark:border-slate-700/50 hover:bg-orange-50 dark:hover:bg-orange-500/10 cursor-pointer">
                                                [{p.sku}] {p.product_name} {p.variation_name ? `- ${p.variation_name}` : ''}
                                            </option>
                                        ))}
                                    </select>
                                 </div>
                                <p className="text-[10px] text-slate-400 text-right font-bold uppercase tracking-widest">Menampilkan {mappingOptions.length} produk</p>
                            </div>
                            
                            <div className="flex items-center justify-between p-4 bg-orange-50 dark:bg-orange-500/10 rounded-2xl border border-orange-100 dark:border-orange-500/20">
                                <span className="text-[10px] md:text-xs text-slate-500 font-bold uppercase tracking-wide">Produk belum ada?</span>
                                <button 
                                    onClick={() => {
                                        setIsQuickCreating(true);
                                        setNewProduct({
                                            sku: '',
                                            parent_sku: '',
                                            product_name: selectedUnmapped.name,
                                            variation_name: selectedUnmapped.variation || '',
                                            cost_price: 0,
                                            processing_fee: 1250
                                        });
                                    }}
                                    className="text-xs font-black text-orange-600 uppercase hover:underline tracking-widest"
                                >
                                    + Buat Baru
                                </button>
                            </div>

                            <button 
                                onClick={handleApplyMapping}
                                disabled={!targetSku}
                                className="w-full py-4 bg-slate-900 dark:bg-orange-600 text-white font-black rounded-2xl hover:opacity-90 disabled:opacity-50 transition-all flex items-center justify-center gap-3 shadow-xl shadow-slate-900/20 dark:shadow-orange-600/20 uppercase tracking-widest text-sm"
                            >
                                <LinkIcon className="w-5 h-5" />
                                SIMPAN MAPPING
                            </button>
                        </>
                    ) : (
                        <div className="animate-in slide-in-from-right duration-300 space-y-6">
                             <div className="p-4 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 rounded-2xl text-xs font-bold flex gap-3 border border-blue-100 dark:border-blue-900/30">
                                <Info className="w-5 h-5 shrink-0" />
                                Produk ini akan disimpan ke Master Data dan otomatis terhubung.
                             </div>
                             <div className="space-y-4">
                                <div className="space-y-1">
                                    <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest ml-1">SKU (Kode Unik)</label>
                                    <input 
                                        type="text" 
                                        value={newProduct.sku}
                                        onChange={(e) => setNewProduct({...newProduct, sku: e.target.value.toUpperCase()})}
                                        className="w-full p-4 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl font-black uppercase text-sm outline-none focus:ring-4 focus:ring-orange-500/10 focus:border-orange-500 transition-all"
                                        placeholder="CONTOH-SKU-001"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest ml-1">Nama Produk Internal</label>
                                    <input 
                                        type="text" 
                                        value={newProduct.product_name}
                                        onChange={(e) => setNewProduct({...newProduct, product_name: e.target.value})}
                                        className="w-full p-4 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl font-bold text-sm outline-none focus:ring-4 focus:ring-orange-500/10 focus:border-orange-500 transition-all"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest ml-1">Variasi (Opsional)</label>
                                    <input 
                                        type="text" 
                                        value={newProduct.variation_name}
                                        onChange={(e) => setNewProduct({...newProduct, variation_name: e.target.value})}
                                        className="w-full p-4 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl font-bold text-sm outline-none focus:ring-4 focus:ring-orange-500/10 focus:border-orange-500 transition-all"
                                        placeholder="Contoh: Merah, XL"
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                   <div className="space-y-1">
                                       <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest ml-1">HPP (Modal)</label>
                                       <input 
                                           type="number" 
                                           value={newProduct.cost_price}
                                           onWheel={(e) => e.currentTarget.blur()}
                                           onChange={(e) => setNewProduct({...newProduct, cost_price: Number(e.target.value)})}
                                           className="w-full p-4 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl font-black text-sm outline-none focus:ring-4 focus:ring-orange-500/10 focus:border-orange-500 transition-all"
                                       />
                                   </div>
                                   <div className="space-y-1">
                                       <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest ml-1">Biaya Proses</label>
                                       <input 
                                           type="number" 
                                           value={newProduct.processing_fee ?? ''}
                                           onWheel={(e) => e.currentTarget.blur()}
                                           onChange={(e) => setNewProduct({...newProduct, processing_fee: Number(e.target.value)})}
                                           className="w-full p-4 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl font-black text-sm outline-none focus:ring-4 focus:ring-orange-500/10 focus:border-orange-500 transition-all"
                                       />
                                   </div>
                                </div>
                                <div className="flex flex-col sm:flex-row gap-3 pt-4">
                                    <button onClick={() => setIsQuickCreating(false)} className="order-2 sm:order-1 flex-1 py-4 text-slate-500 font-bold hover:bg-slate-50 dark:hover:bg-slate-800 rounded-2xl transition-all text-sm">Kembali</button>
                                    <button onClick={handleQuickCreateAndMap} className="order-1 sm:order-2 flex-1 py-4 bg-blue-600 text-white font-black rounded-2xl hover:bg-blue-700 shadow-xl shadow-blue-600/20 transition-all text-sm uppercase tracking-widest">Simpan & Map</button>
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
           <div className="fixed inset-0 z-[110] flex items-center justify-center p-2 md:p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
               <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-2xl max-w-sm w-full p-6 md:p-8">
                   <div className="flex justify-between items-center mb-6">
                       <h3 className="text-lg font-black uppercase dark:text-white tracking-tight">Edit HPP Massal</h3>
                       <button onClick={() => setIsBulkEditing(false)} className="p-2 text-slate-400 hover:text-slate-600 transition-colors"><X className="w-5 h-5"/></button>
                   </div>
                   <p className="text-sm text-slate-500 mb-6 leading-relaxed">
                       Mengupdate HPP untuk <span className="font-black text-slate-900 dark:text-white">{selectedSkus.size} produk</span> terpilih secara sekaligus.
                   </p>
                   
                   <div className="relative mb-8 group">
                       <DollarSign className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-orange-500 transition-colors" />
                       <input 
                           type="number" 
                           placeholder="0"
                           autoFocus
                           value={bulkEditHpp}
                           onWheel={(e) => e.currentTarget.blur()}
                           onChange={(e) => setBulkEditHpp(e.target.value === '' ? '' : Number(e.target.value))}
                           className="w-full pl-12 pr-4 py-4 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-xl font-black outline-none focus:ring-4 focus:ring-orange-500/10 focus:border-orange-500 transition-all"
                       />
                   </div>

                   <div className="flex gap-3">
                       <button onClick={() => setIsBulkEditing(false)} className="flex-1 py-4 bg-slate-100 dark:bg-slate-800 text-slate-500 font-bold rounded-2xl hover:bg-slate-200 transition-all">Batal</button>
                       <button onClick={handleBulkEditHPP} className="flex-1 py-4 bg-orange-600 text-white font-black rounded-2xl hover:bg-orange-700 shadow-lg shadow-orange-600/20 transition-all uppercase tracking-wider text-sm">Simpan</button>
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
                                <button 
                                    onClick={handleBackupHPP}
                                    className="w-full text-left px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg flex items-center gap-2"
                                >
                                    <Save className="w-3 h-3" /> Backup Data HPP
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
                        <div className="flex justify-between items-center mb-4">
                            <h4 className="text-xs font-black uppercase text-slate-500">Input Produk Baru</h4>
                            <button onClick={() => setIsAddingProduct(false)} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg text-slate-400">
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        
                        <div className="space-y-4">
                            {/* Base Product Info */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-800">
                                <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Nama Produk</label>
                                    <input 
                                        type="text" placeholder="Nama Produk" 
                                        value={manualProductBase.product_name}
                                        onChange={(e) => setManualProductBase({...manualProductBase, product_name: e.target.value})}
                                        className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-bold bg-slate-50 dark:bg-slate-800"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">SKU Induk</label>
                                    <input 
                                        type="text" placeholder="SKU INDUK" 
                                        value={manualProductBase.parent_sku}
                                        onChange={(e) => setManualProductBase({...manualProductBase, parent_sku: e.target.value.toUpperCase()})}
                                        className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-bold uppercase bg-slate-50 dark:bg-slate-800"
                                    />
                                </div>
                            </div>

                            {/* Variations */}
                            <div className="space-y-2">
                                <div className="flex justify-between items-center px-1">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase">Daftar Variasi</label>
                                    <button 
                                        onClick={() => setManualProductVariations([...manualProductVariations, { sku: '', variation_name: '', cost_price: 0, processing_fee: 1250 }])}
                                        className="text-[10px] font-bold text-orange-600 hover:text-orange-700 flex items-center gap-1"
                                    >
                                        <Plus className="w-3 h-3" /> Tambah Variasi
                                    </button>
                                </div>
                                
                                {manualProductVariations.map((variation, index) => (
                                    <div key={index} className="grid grid-cols-1 sm:grid-cols-10 gap-2 items-start p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-800 relative group">
                                        <div className="sm:col-span-3">
                                            <input 
                                                type="text" placeholder="SKU (Unik)" 
                                                value={variation.sku}
                                                onChange={(e) => {
                                                    const newVars = [...manualProductVariations];
                                                    newVars[index].sku = e.target.value.toUpperCase();
                                                    setManualProductVariations(newVars);
                                                }}
                                                className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold uppercase"
                                            />
                                        </div>
                                        <div className="sm:col-span-3">
                                            <input 
                                                type="text" placeholder="Nama Variasi" 
                                                value={variation.variation_name}
                                                onChange={(e) => {
                                                    const newVars = [...manualProductVariations];
                                                    newVars[index].variation_name = e.target.value;
                                                    setManualProductVariations(newVars);
                                                }}
                                                className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold"
                                            />
                                        </div>
                                        <div className="sm:col-span-3">
                                            <div className="relative">
                                                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400">Rp</span>
                                                <input 
                                                    type="number" placeholder="HPP" 
                                                    value={variation.cost_price || ''}
                                                    onWheel={(e) => e.currentTarget.blur()}
                                                    onChange={(e) => {
                                                        const newVars = [...manualProductVariations];
                                                        newVars[index].cost_price = Number(e.target.value);
                                                        setManualProductVariations(newVars);
                                                    }}
                                                    className="w-full pl-7 pr-2 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold"
                                                />
                                            </div>
                                        </div>
                                        <div className="sm:col-span-1 flex justify-end">
                                            {manualProductVariations.length > 1 && (
                                                <button 
                                                    onClick={() => {
                                                        const newVars = manualProductVariations.filter((_, i) => i !== index);
                                                        setManualProductVariations(newVars);
                                                    }}
                                                    className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
                            <button onClick={() => setIsAddingProduct(false)} className="px-4 py-2 text-xs font-bold text-slate-500 hover:bg-white rounded-lg">Batal</button>
                            <button onClick={handleSaveProduct} className="px-6 py-2 bg-slate-900 dark:bg-orange-600 text-white text-xs font-bold rounded-xl hover:opacity-90 shadow-lg shadow-slate-900/20 dark:shadow-orange-600/20">Simpan Produk</button>
                        </div>
                    </div>
                )}

                {/* GROUP EDIT MODAL */}
                {editingProductGroup && (
                    <div className="fixed inset-0 z-[110] flex items-center justify-center p-2 md:p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
                        <div className="bg-white dark:bg-slate-900 rounded-[2rem] md:rounded-[2.5rem] shadow-2xl max-w-2xl w-full flex flex-col max-h-[95vh] overflow-hidden">
                            <div className="p-5 md:p-6 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-800/30">
                                <div>
                                    <h3 className="text-base md:text-lg font-black uppercase dark:text-white tracking-tight">Set HPP Produk</h3>
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Atur HPP untuk semua variasi produk ini.</p>
                                </div>
                                <button onClick={() => setEditingProductGroup(null)} className="p-2 text-slate-400 hover:text-red-500 transition-colors"><X className="w-6 h-6"/></button>
                            </div>
                            
                            <div className="p-5 md:p-6 overflow-y-auto custom-scrollbar space-y-6">
                                {/* Shared Product Name */}
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block ml-1">Nama Produk (Berlaku untuk semua variasi)</label>
                                    <input 
                                        type="text" 
                                        value={editingProductGroup[0].product_name || ''}
                                        onChange={(e) => {
                                            const newName = e.target.value;
                                            setEditingProductGroup(prev => prev ? prev.map(p => ({ ...p, product_name: newName })) : null);
                                        }}
                                        className="w-full p-4 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl font-bold text-sm outline-none focus:ring-4 focus:ring-orange-500/10 focus:border-orange-500 transition-all"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block ml-1">SKU Induk (Berlaku untuk semua variasi)</label>
                                    <input 
                                        type="text" 
                                        value={editingProductGroup[0].parent_sku || ''}
                                        onChange={(e) => {
                                            const newParentSku = e.target.value.toUpperCase();
                                            setEditingProductGroup(prev => prev ? prev.map(p => ({ ...p, parent_sku: newParentSku })) : null);
                                        }}
                                        className="w-full p-4 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl font-bold text-sm outline-none focus:ring-4 focus:ring-orange-500/10 focus:border-orange-500 transition-all uppercase"
                                        placeholder="Opsional"
                                    />
                                </div>

                                <div className="space-y-4">
                                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block ml-1">Daftar Variasi & HPP</label>
                                    <div className="space-y-3">
                                        {editingProductGroup.map((product, idx) => (
                                            <div key={product.sku} className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-700/50 flex flex-col sm:flex-row sm:items-center gap-4">
                                                <div className="flex-1">
                                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{product.sku}</p>
                                                    <p className="text-sm font-bold text-slate-700 dark:text-white">{product.variation_name || 'No Variation'}</p>
                                                </div>
                                                <div className="flex gap-2">
                                                    <div className="relative flex-1 sm:w-32">
                                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400">Rp</span>
                                                        <input 
                                                            type="number" 
                                                            value={product.cost_price ?? ''}
                                                            onWheel={(e) => e.currentTarget.blur()}
                                                            onChange={(e) => {
                                                                const newVal = Number(e.target.value);
                                                                setEditingProductGroup(prev => prev ? prev.map((p, i) => i === idx ? { ...p, cost_price: newVal } : p) : null);
                                                            }}
                                                            className="w-full pl-8 pr-3 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-black outline-none focus:ring-2 focus:ring-orange-500/20"
                                                            placeholder="HPP"
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <div className="p-5 md:p-6 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row gap-3 bg-slate-50/50 dark:bg-slate-800/30">
                                <button onClick={() => setEditingProductGroup(null)} className="order-2 sm:order-1 flex-1 py-4 text-slate-500 font-bold hover:bg-slate-100 dark:hover:bg-slate-800 rounded-2xl transition-all text-sm">Batal</button>
                                <button onClick={handleSaveGroup} className="order-1 sm:order-2 flex-1 py-4 bg-slate-900 dark:bg-orange-600 text-white font-black rounded-2xl hover:opacity-90 shadow-xl shadow-slate-900/20 dark:shadow-orange-600/20 transition-all text-sm uppercase tracking-widest">Simpan Perubahan</button>
                            </div>
                        </div>
                    </div>
                )}

                <div className="hidden md:block overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
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
                                <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase">SKU Induk</th>
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
                                    <td className="px-4 py-3 text-xs font-bold font-mono dark:text-orange-300 max-w-[150px] break-all">{p.sku}</td>
                                    
                                    {/* Kolom SKU Induk */}
                                    <td className="px-4 py-3 text-xs font-medium text-slate-500 dark:text-slate-400 max-w-[150px] break-all">
                                        {p.parent_sku || '-'}
                                    </td>

                                    {/* Kolom Produk */}
                                    <td className="px-4 py-3 text-sm font-medium dark:text-white">
                                        {p.product_name}
                                    </td>

                                    {/* Kolom Variasi (BARU) */}
                                    <td className="px-4 py-3 text-sm font-medium dark:text-white">
                                        {p.variation_name ? (
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                                                <Tag className="w-3 h-3" /> {p.variation_name}
                                            </span>
                                        ) : <span className="text-slate-300">-</span>}
                                    </td>

                                    {/* Kolom HPP */}
                                    <td className="px-4 py-3 text-sm font-medium dark:text-slate-300">
                                        <span className={p.cost_price === 0 ? "text-red-500 font-bold" : ""}>
                                            {p.cost_price === 0 ? "Set HPP!" : `Rp ${(p.cost_price || 0).toLocaleString()}`}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-right flex justify-end gap-2">
                                        <button onClick={() => handleEditGroup(p)} className="p-1.5 text-slate-400 hover:text-orange-600 bg-slate-50 dark:bg-slate-800 rounded-lg border border-transparent hover:border-orange-200 transition-all">
                                            <Edit2 className="w-4 h-4" />
                                        </button>
                                        <button onClick={() => handleDeleteProduct(p.sku)} className="p-1.5 text-slate-400 hover:text-red-600 bg-slate-50 dark:bg-slate-800 rounded-lg border border-transparent hover:border-red-200 transition-all">
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </td>
                                </tr>
                            )})}
                        </tbody>
                    </table>
                </div>

                {/* MOBILE VIEW: CARD LAYOUT */}
                <div className="md:hidden space-y-3">
                    {filteredProducts.map(p => {
                        const isSelected = selectedSkus.has(p.sku);
                        return (
                            <div key={p.sku} className={`p-4 rounded-2xl border transition-all ${isSelected ? 'bg-orange-50 border-orange-200 dark:bg-orange-900/10 dark:border-orange-800' : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700'}`}>
                                <div className="flex justify-between items-start mb-2">
                                    <div className="flex items-center gap-2">
                                        <button onClick={() => toggleSelectSku(p.sku)} className="flex items-center justify-center">
                                            {isSelected 
                                                ? <CheckSquare className="w-5 h-5 text-orange-600" />
                                                : <Square className="w-5 h-5 text-slate-300" />
                                            }
                                        </button>
                                        <span className="text-[10px] font-bold font-mono text-slate-400 uppercase max-w-[120px] break-all">{p.sku}</span>
                                        {p.parent_sku && (
                                            <span className="text-[10px] font-medium text-slate-500 bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 rounded max-w-[120px] break-all">
                                                Induk: {p.parent_sku}
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex gap-1">
                                        <button onClick={() => handleEditGroup(p)} className="p-2 text-orange-600 bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700">
                                            <Edit2 className="w-4 h-4" />
                                        </button>
                                        <button onClick={() => handleDeleteProduct(p.sku)} className="p-2 text-red-600 bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700">
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                                <p className="text-sm font-bold text-slate-900 dark:text-white mb-1">{p.product_name}</p>
                                <div className="flex items-center justify-between mt-2">
                                    {p.variation_name ? (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white dark:bg-slate-900 text-[10px] text-slate-500 border border-slate-200 dark:border-slate-700">
                                            <Tag className="w-3 h-3" /> {p.variation_name}
                                        </span>
                                    ) : <span className="text-slate-300">-</span>}
                                    <span className={`text-sm font-black ${p.cost_price === 0 ? "text-red-500" : "text-slate-900 dark:text-orange-400"}`}>
                                        {p.cost_price === 0 ? "Set HPP!" : `Rp ${(p.cost_price || 0).toLocaleString()}`}
                                    </span>
                                </div>
                            </div>
                        )
                    })}
                </div>
           </div>
       )}

    </div>
  );
};
