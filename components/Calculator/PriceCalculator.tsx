
import React, { useState, useMemo, useEffect } from 'react';
import { ShoppingBag, DollarSign, Package, Activity, TrendingUp, TriangleAlert, BarChart3, Info, Sparkles, Layers, Briefcase, Search, CheckCircle2 } from 'lucide-react';
import { supabase } from '../../services/supabase';
import { Store, Product } from '../../types';

// --- Utilities ---
const formatRupiah = (value: number) => {
  if (isNaN(value) || !isFinite(value)) return 'Rp 0';
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
};

const formatDecimal = (value: number, digits = 2) => {
  if (isNaN(value) || !isFinite(value)) return '0';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(value);
};

// --- Sub-components ---

const InputGroup: React.FC<{
  label: string;
  id: string;
  value: number | '';
  onChange: (val: number | '') => void;
  prefix?: string;
  suffix?: string;
  step?: string;
  placeholder?: string;
}> = ({ label, id, value, onChange, prefix, suffix, step, placeholder = "0" }) => {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-[10px] md:text-xs font-black text-slate-500 uppercase tracking-widest ml-1">{label}</label>
      <div className="relative group">
        {prefix && (
          <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm group-focus-within:text-orange-500 transition-colors pointer-events-none">
            {prefix}
          </div>
        )}
        <input
          type="number"
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          step={step}
          onWheel={(e) => e.currentTarget.blur()} // PREVENT SCROLL CHANGE
          className={`w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl py-3.5 md:py-4 font-bold text-slate-900 dark:text-white outline-none focus:ring-4 focus:ring-orange-500/10 focus:border-orange-500 transition-all text-sm md:text-base ${
            prefix ? 'pl-12' : 'pl-4'
          } ${suffix ? 'pr-12' : 'pr-4'}`}
          placeholder={placeholder}
        />
        {suffix && (
          <div className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm pointer-events-none">
            {suffix}
          </div>
        )}
      </div>
    </div>
  );
};

const ToggleSwitch: React.FC<{
    label: string;
    enabled: boolean;
    setEnabled: (val: boolean) => void;
}> = ({ label, enabled, setEnabled }) => {
    return (
        <div className="flex items-center justify-between p-1">
            <span className="text-[10px] md:text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide">{label}</span>
            <button
                onClick={() => setEnabled(!enabled)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 focus:ring-offset-slate-900 ${
                    enabled ? 'bg-orange-500' : 'bg-slate-300 dark:bg-slate-700'
                }`}
            >
                <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        enabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                />
            </button>
        </div>
    );
};

const ResultCard: React.FC<{
  label: string;
  value: string;
  colorClass?: string;
  subValue?: string;
}> = ({ label, value, colorClass = "text-slate-900 dark:text-white", subValue }) => {
  return (
    <div className="bg-slate-50 dark:bg-slate-800/50 p-5 md:p-6 rounded-2xl border border-slate-200 dark:border-slate-700 flex flex-col justify-center min-h-[100px] md:min-h-[120px]">
      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 md:mb-2">{label}</span>
      <div>
        <span className={`text-2xl md:text-3xl font-black tracking-tight ${colorClass}`}>{value}</span>
        {subValue && <p className="text-[10px] text-slate-500 font-bold mt-1">{subValue}</p>}
      </div>
    </div>
  );
};

// --- Main Calculator Component ---

interface PriceCalculatorProps {
  store: Store;
}

export const PriceCalculator: React.FC<PriceCalculatorProps> = ({ store }) => {
  // Master Products State
  const [products, setProducts] = useState<Product[]>([]);
  const [searchSku, setSearchSku] = useState('');
  const [showSkuDropdown, setShowSkuDropdown] = useState(false);

  // Input States
  const [price, setPrice] = useState<number | ''>(''); 
  const [voucher, setVoucher] = useState<number | ''>(''); 
  const [adminFee, setAdminFee] = useState<number | ''>(''); 
  const [hpp, setHpp] = useState<number | ''>(''); 
  const [processingCost, setProcessingCost] = useState<number | ''>(''); 
  const [overheadPercent, setOverheadPercent] = useState<number | ''>(''); 
  const [adsProfitPercent, setAdsProfitPercent] = useState<number | ''>(''); 
  
  // Fetch Products
  useEffect(() => {
    const fetchProducts = async () => {
      const { data } = await supabase
        .from('products')
        .select('*')
        .eq('store_id', store.id)
        .order('product_name');
      if (data) setProducts(data);
    };
    fetchProducts();
  }, [store.id]);

  const filteredProducts = useMemo(() => {
    if (!searchSku) return [];
    return products.filter(p => 
      p.sku.toLowerCase().includes(searchSku.toLowerCase()) ||
      p.product_name.toLowerCase().includes(searchSku.toLowerCase())
    ).slice(0, 5);
  }, [searchSku, products]);

  const handleSelectProduct = async (product: Product) => {
    setHpp(product.cost_price);
    setProcessingCost(product.processing_fee || 1250);
    setSearchSku(`${product.sku} - ${product.product_name}`);
    setShowSkuDropdown(false);

    // Fetch last selling price from order_items
    try {
      const { data, error } = await supabase
        .from('order_items')
        .select('unit_price')
        .eq('final_sku', product.sku)
        .eq('store_id', store.id)
        .order('created_at', { ascending: false })
        .limit(1);

      if (data && data.length > 0) {
        setPrice(data[0].unit_price);
      }
    } catch (err) {
      console.error("Error fetching last selling price:", err);
    }
  };

  // Toggle State
  const [accelerationMode, setAccelerationMode] = useState<boolean>(false);

  // Calculations
  const results = useMemo(() => {
    const A = Number(price) || 0;
    const B = Number(voucher) || 0;
    const C = Number(adminFee) || 0;
    const E = Number(hpp) || 0;
    const F = Number(processingCost) || 0;
    const O_Pct = Number(overheadPercent) || 0;
    const I = Number(adsProfitPercent) || 0;

    // 1. Potongan Marketplace
    const adminFeeAmount = (A - B) * (C / 100);
    
    // 2. Omzet Bersih (Net Sales)
    const D = (A - B) - adminFeeAmount;
    
    // 3. Biaya Produksi Langsung
    const G = E + F;

    // 4. Overhead (Opsional, % dari Harga Jual)
    const overheadAmount = A * (O_Pct / 100);

    // 5. Laba Kotor (Gross Profit) available for Ads & Net Profit
    // Rumus: Omzet Bersih - HPP Total - Overhead
    const H = D - G - overheadAmount;

    // LOGIKA KHUSUS USER: SAFETY FACTOR 0.11
    const PLATFORM_SAFETY_FACTOR = 0.11; 
    const adBudget = H > 0 ? (H / (1 - PLATFORM_SAFETY_FACTOR)) * (I / 100) : 0;

    let J = 0; // Target ROAS
    if (adBudget > 0) J = A / adBudget;
    
    // BEP ROAS Produk (Harga / Gross Margin)
    const bepRoas = H > 0 ? A / H : 0;

    // Target ROAS Recommendations
    const accelFactor = accelerationMode ? 0.7 : 1.0;

    const targetBroad = bepRoas > 0 ? (bepRoas * 1.7) * accelFactor : 0;
    const targetOptimal = bepRoas > 0 ? (bepRoas * 2.0) * accelFactor : 0;
    const targetMax = targetOptimal > 0 ? targetOptimal * 2.0 : 0;

    const netProfitFinal = H - adBudget;
    const netProfitPercent = D > 0 ? (netProfitFinal / D) * 100 : 0;

    const priceRatio = G > 0 ? (A / G) : 0;
    const priceRatioText = `Faktor Pengali Harga: ${formatDecimal(priceRatio, 1)}x`;

    // Gross Margin Percentage (Laba Kotor / Harga Jual)
    const grossMarginPercent = A > 0 ? (H / A) * 100 : 0;

    return { 
      A, B, C, D, G, H, J, 
      targetBroad, targetOptimal, targetMax,
      adminFeeAmount,
      overheadAmount,
      adBudget, 
      netProfitFinal, 
      netProfitPercent, 
      grossMarginPercent,
      bepRoas, 
      priceRatioText 
    };
  }, [price, voucher, adminFee, hpp, processingCost, overheadPercent, adsProfitPercent, accelerationMode]);

  const isGrossLoss = results.H < 0;

  const getPercentage = (val: number) => {
    if (results.A === 0) return 0;
    return Math.max(0, (val / results.A) * 100);
  };

  const breakdownData = [
    { label: "HPP Produk", val: results.G, color: "bg-slate-400", dotColor: "bg-slate-400", icon: <Package size={14}/> },
    { label: "Biaya Admin", val: results.adminFeeAmount, color: "bg-amber-500", dotColor: "bg-amber-500", icon: <Layers size={14}/> },
    { label: "Overhead", val: results.overheadAmount, color: "bg-pink-500", dotColor: "bg-pink-500", icon: <Briefcase size={14}/> },
    { label: "Voucher Toko", val: results.B, color: "bg-orange-500", dotColor: "bg-orange-500", icon: <DollarSign size={14}/> },
    { label: "Budget Iklan", val: results.adBudget, color: "bg-indigo-500", dotColor: "bg-indigo-500", icon: <TrendingUp size={14}/> },
    { 
      label: results.netProfitFinal >= 0 ? "Profit Bersih" : "Defisit", 
      val: Math.abs(results.netProfitFinal), 
      color: results.netProfitFinal >= 0 ? "bg-emerald-500" : "bg-red-500",
      dotColor: results.netProfitFinal >= 0 ? "bg-emerald-500" : "bg-red-500",
      icon: <Activity size={14}/> 
    },
  ];

  return (
    <div className="space-y-6 md:space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-4">
      
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-900 to-slate-800 rounded-[2rem] md:rounded-[2.5rem] p-6 md:p-12 text-center text-white relative overflow-hidden shadow-2xl">
         <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-lg h-64 bg-orange-500/20 blur-[120px] rounded-full pointer-events-none"></div>
         <h2 className="text-2xl md:text-5xl font-black uppercase tracking-tighter italic relative z-10">KalkulAsik</h2>
         <p className="text-orange-200/80 font-bold uppercase tracking-widest text-[10px] md:text-xs mt-3 relative z-10">
            HARGA AKURAT, JUALAN MAKIN MANTAP
         </p>
      </div>

      <div className="grid gap-4 md:gap-6">
          
        {/* SECTION 1: OMZET */}
        <section className="bg-white dark:bg-slate-900 rounded-[2rem] md:rounded-[2.5rem] p-6 md:p-10 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center gap-3 md:gap-4 mb-6 md:mb-8">
            <div className="w-10 h-10 md:w-12 md:h-12 rounded-2xl bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center border border-emerald-200 dark:border-emerald-500/20">
              <DollarSign className="w-5 h-5 md:w-6 md:h-6" />
            </div>
            <h2 className="text-lg md:text-xl font-black text-slate-900 dark:text-white tracking-tight uppercase">Analisis Omzet</h2>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 md:gap-8">
            <div className="md:col-span-3">
              <div className="relative">
                <label className="text-[10px] md:text-xs font-black text-slate-500 uppercase tracking-widest ml-1 mb-2 block">Cari Produk Master (Auto-Fill HPP)</label>
                <div className="relative group">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5 group-focus-within:text-orange-500 transition-colors" />
                  <input
                    type="text"
                    placeholder="Ketik SKU atau Nama Produk..."
                    value={searchSku}
                    onChange={(e) => {
                      setSearchSku(e.target.value);
                      setShowSkuDropdown(true);
                    }}
                    onFocus={() => setShowSkuDropdown(true)}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl py-4 pl-12 pr-4 font-bold text-slate-900 dark:text-white outline-none focus:ring-4 focus:ring-orange-500/10 focus:border-orange-500 transition-all"
                  />
                  {showSkuDropdown && filteredProducts.length > 0 && (
                    <div className="absolute z-50 left-0 right-0 mt-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                      {filteredProducts.map((p) => (
                        <button
                          key={p.sku}
                          onClick={() => handleSelectProduct(p)}
                          className="w-full text-left p-4 hover:bg-slate-50 dark:hover:bg-slate-800 border-b border-slate-100 dark:border-slate-800 last:border-0 transition-colors"
                        >
                          <div className="flex justify-between items-center">
                            <div>
                              <p className="font-black text-slate-900 dark:text-white text-sm">{p.sku}</p>
                              <p className="text-xs text-slate-500 font-medium">{p.product_name} {p.variation_name ? `(${p.variation_name})` : ''}</p>
                            </div>
                            <div className="text-right">
                              <p className="text-xs font-black text-emerald-500">HPP: {formatRupiah(p.cost_price)}</p>
                              <p className="text-[10px] text-slate-400 font-bold">Proses: {formatRupiah(p.processing_fee || 0)}</p>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <InputGroup label="Harga Jual Final" id="inputA" value={price} onChange={setPrice} prefix="Rp" />
            <InputGroup label="Voucher Seller" id="inputB" value={voucher} onChange={setVoucher} prefix="Rp" />
            <InputGroup label="Biaya Admin (%)" id="inputC" value={adminFee} onChange={setAdminFee} suffix="%" step="0.1" />
          </div>

          <div className="mt-8 md:mt-12">
            <div className="relative overflow-hidden rounded-[1.5rem] md:rounded-[2rem] bg-slate-900 text-white p-6 md:p-8 border border-slate-800">
              <div className="absolute top-0 right-0 -mt-8 -mr-8 w-32 h-32 bg-emerald-500/10 rounded-full blur-3xl"></div>
              <div className="relative flex flex-col md:flex-row md:items-end justify-between gap-6">
                <div>
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] block mb-2 md:mb-3">Estimasi Omzet Real (Net)</span>
                  <span className="text-3xl md:text-5xl font-black text-emerald-400 tracking-tighter tabular-nums">
                    {formatRupiah(results.D)}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-[10px] font-black uppercase tracking-widest text-slate-400 bg-white/5 px-4 py-2 md:px-5 md:py-2.5 rounded-xl md:rounded-2xl border border-white/5 w-fit">
                  <Info size={14} className="text-emerald-500" />
                  Admin Fee: {formatRupiah(results.adminFeeAmount)}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 2: COSTS & MARGIN */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
          
          {/* INPUT BIAYA */}
          <section className="bg-white dark:bg-slate-900 rounded-[2rem] md:rounded-[2.5rem] p-6 md:p-8 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col h-full">
            <div className="flex items-center gap-3 md:gap-4 mb-6 md:mb-8">
              <div className="w-10 h-10 md:w-12 md:h-12 rounded-2xl bg-blue-100 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center border border-blue-200 dark:border-blue-500/20"><Package className="w-5 h-5 md:w-6 md:h-6" /></div>
              <h2 className="text-base md:text-lg font-black text-slate-900 dark:text-white tracking-tight uppercase">Biaya & Beban</h2>
            </div>
            
            <div className="space-y-5 md:space-y-6 flex-1">
              <InputGroup label="HPP Produk" id="inputE" value={hpp} onChange={setHpp} prefix="Rp" />
              <div className="grid grid-cols-2 gap-4">
                <InputGroup label="Biaya Proses" id="inputF" value={processingCost} onChange={setProcessingCost} prefix="Rp" />
                <InputGroup label="Overhead (%)" id="inputOverhead" value={overheadPercent} onChange={setOverheadPercent} suffix="%" step="0.1" />
              </div>
            </div>

            <div className="mt-6 md:mt-8 pt-6 border-t border-slate-100 dark:border-slate-800">
                <div className="w-full py-3 bg-slate-50 dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 text-center text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                  {results.priceRatioText}
                </div>
            </div>
          </section>

          {/* HASIL LABA KOTOR */}
          <section className="bg-white dark:bg-slate-900 rounded-[2rem] md:rounded-[2.5rem] p-6 md:p-8 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col h-full">
            <div className="flex items-center gap-3 md:gap-4 mb-6 md:mb-8">
              <div className="w-10 h-10 md:w-12 md:h-12 rounded-2xl bg-indigo-100 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center border border-indigo-200 dark:border-indigo-500/20"><Activity className="w-5 h-5 md:w-6 md:h-6" /></div>
              <h2 className="text-base md:text-lg font-black text-slate-900 dark:text-white tracking-tight uppercase">Laba Kotor</h2>
            </div>
            
            <div className="flex flex-col gap-4 md:gap-6 flex-1">
              <div className="bg-slate-50 dark:bg-slate-800 rounded-[1.5rem] md:rounded-[2rem] p-6 md:p-8 border border-slate-200 dark:border-slate-700 space-y-4">
                <div className="flex justify-between items-center text-xs font-bold text-slate-500">
                  <span>Omzet Real</span>
                  <span className="text-emerald-500 tabular-nums">{formatRupiah(results.D)}</span>
                </div>
                <div className="flex justify-between items-center text-xs font-bold text-slate-500">
                  <span>HPP & Biaya Proses</span>
                  <span className="text-slate-400 tabular-nums">- {formatRupiah(results.G)}</span>
                </div>
                {results.overheadAmount > 0 && (
                  <div className="flex justify-between items-center text-xs font-bold text-slate-500">
                    <span>Overhead ({formatDecimal(Number(overheadPercent))}%)</span>
                    <span className="text-pink-400 tabular-nums">- {formatRupiah(results.overheadAmount)}</span>
                  </div>
                )}
                <div className="h-px bg-slate-200 dark:bg-slate-700 my-2"></div>
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-black text-slate-900 dark:text-white uppercase tracking-widest">Gross Margin</span>
                  <span className={`text-xl md:text-2xl font-black tabular-nums ${results.H >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                    {formatRupiah(results.H)}
                  </span>
                </div>
              </div>
              
              <ResultCard 
                label="Laba Kotor (%)" 
                value={results.A > 0 ? formatDecimal(results.grossMarginPercent, 1) + "%" : "0%"}
                colorClass={results.H >= 0 ? "text-emerald-500" : "text-red-500"}
                subValue="Dari Harga Jual"
              />
            </div>
          </section>
        </div>

        {/* SECTION 3: ADS STRATEGY */}
        <section className="bg-slate-900 rounded-[2rem] md:rounded-[2.5rem] p-6 md:p-10 border border-slate-800 relative overflow-hidden shadow-2xl">
          <div className="flex items-center gap-3 md:gap-4 mb-8 md:mb-10 relative z-10">
            <div className="w-10 h-10 md:w-12 md:h-12 rounded-2xl bg-orange-500/10 text-orange-500 flex items-center justify-center border border-orange-500/20"><TrendingUp className="w-5 h-5 md:w-6 md:h-6" /></div>
            <h2 className="text-lg md:text-xl font-black text-white tracking-tight uppercase">Iklan & ROAS</h2>
          </div>

          <div className="relative z-10">
            {isGrossLoss && (
              <div className="absolute inset-0 z-50 bg-slate-900/95 backdrop-blur-xl rounded-3xl flex flex-col items-center justify-center text-center p-6 md:p-12 border border-red-500/10 animate-in fade-in zoom-in duration-500">
                <div className="p-4 md:p-6 bg-red-500/10 rounded-full mb-4 md:mb-6">
                  <TriangleAlert className="w-8 h-8 md:w-12 md:h-12 text-red-500 animate-pulse" />
                </div>
                <h3 className="text-xl md:text-3xl font-black text-white mb-2 md:mb-4 uppercase italic text-red-500">Margin Negatif!</h3>
                <p className="text-slate-500 max-w-sm text-xs md:text-sm font-medium leading-relaxed uppercase tracking-tighter">
                   Iklan tidak disarankan jika laba kotor Anda belum menutup biaya dasar.
                </p>
              </div>
            )}

            <div className={`grid md:grid-cols-2 gap-8 md:gap-12 ${isGrossLoss ? 'filter blur-lg opacity-10 pointer-events-none' : ''}`}>
              <div className="space-y-6 md:space-y-8">
                <div className="p-4 md:p-6 bg-slate-800/50 rounded-3xl border border-slate-700">
                    <InputGroup 
                        label="% Alokasi Profit ke Iklan" 
                        id="adsAlloc" 
                        value={adsProfitPercent} 
                        onChange={setAdsProfitPercent} 
                        suffix="%" 
                        placeholder="Misal: 30"
                    />
                    
                    <div className="mt-6 p-4 bg-slate-900 rounded-2xl border border-slate-700">
                      <ToggleSwitch label="Mode Akselerasi (on/off)" enabled={accelerationMode} setEnabled={setAccelerationMode} />
                      <p className="text-[10px] text-slate-500 mt-2 leading-relaxed font-medium">
                        Fungsi: Meningkatkan jangkauan iklan dengan mengurangi target ROAS sebesar 30%.
                      </p>
                    </div>
                </div>

                <div className="bg-indigo-500/10 p-5 md:p-6 rounded-3xl border border-indigo-500/20 flex flex-col justify-between">
                    <span className="text-[10px] font-black text-indigo-300 uppercase tracking-widest mb-2">Maksimal CPA</span>
                    <div>
                        <span className="text-2xl md:text-3xl font-black tracking-tight text-indigo-400">{formatRupiah(results.adBudget)}</span>
                        <p className="text-[10px] text-indigo-300/60 font-bold mt-1">
                            Budget maksimal per penjualan.
                        </p>
                    </div>
                </div>
              </div>

              <div className="flex flex-col gap-4 md:gap-6">
                
                <div className="grid grid-cols-2 gap-3 md:gap-4">
                  <div className="p-4 bg-blue-900/20 rounded-2xl border border-blue-500/10">
                    <span className="text-[10px] font-black text-blue-300 uppercase tracking-widest">Target ROAS</span>
                    <p className="text-xl md:text-2xl font-black text-blue-400 mt-2">{results.J ? formatDecimal(results.J, 1) : "-"}</p>
                    <p className="text-[9px] text-blue-400/50 font-bold mt-1">Sesuai Alokasi</p>
                  </div>
                  <div className="p-4 bg-emerald-900/20 rounded-2xl border border-emerald-500/10">
                    <span className="text-[10px] font-black text-emerald-300 uppercase tracking-widest">BEP ROAS</span>
                    <p className="text-xl md:text-2xl font-black text-emerald-400 mt-2">{results.bepRoas ? formatDecimal(results.bepRoas, 1) : "-"}</p>
                    <p className="text-[9px] text-emerald-400/50 font-bold mt-1">Titik Balik Modal</p>
                  </div>
                </div>

                <div className="flex-grow p-5 md:p-6 rounded-[2rem] md:rounded-[2.5rem] bg-orange-500/5 border border-orange-500/20 flex flex-col justify-center shadow-inner relative overflow-hidden min-h-[250px] md:min-h-[300px]">
                  <div className="absolute top-0 right-0 p-4 opacity-10">
                      <Sparkles className="text-orange-500 w-24 h-24 md:w-32 md:h-32" />
                  </div>
                  <span className="text-[10px] font-black text-orange-500 uppercase tracking-[0.3em] mb-6 md:mb-8 text-center bg-orange-500/10 py-2 rounded-full mx-auto px-4 md:px-6">Rekomendasi Target ROAS</span>
                  
                  <div className="space-y-3 md:space-y-4 relative z-10 px-1 md:px-2">
                      <div className="flex justify-between items-center p-3 md:p-4 bg-slate-800/80 rounded-2xl border border-orange-500/10 hover:bg-slate-800 transition-colors">
                          <div className="flex flex-col text-left">
                              <span className="text-xs md:text-sm font-bold text-slate-300">Kompetitif</span>
                              <span className="text-[9px] md:text-[10px] text-slate-500 uppercase">Skala Luas</span>
                          </div>
                          <span className="text-xl md:text-2xl font-black text-orange-400 tabular-nums">{results.targetBroad ? formatDecimal(results.targetBroad, 1) : "-"}</span>
                      </div>
                      
                      <div className="flex justify-between items-center p-3 md:p-4 bg-gradient-to-r from-orange-600 to-orange-500 rounded-2xl shadow-xl transform scale-105 border border-orange-400">
                          <div className="flex flex-col text-left">
                              <span className="text-xs md:text-sm font-bold text-white">Profit Optimal</span>
                              <span className="text-[9px] md:text-[10px] text-orange-100 uppercase">2x BEP</span>
                          </div>
                          <span className="text-2xl md:text-4xl font-black text-white tabular-nums">{results.targetOptimal ? formatDecimal(results.targetOptimal, 1) : "-"}</span>
                      </div>

                      <div className="flex justify-between items-center p-3 md:p-4 bg-slate-800/80 rounded-2xl border border-orange-500/10 hover:bg-slate-800 transition-colors">
                          <div className="flex flex-col text-left">
                              <span className="text-xs md:text-sm font-bold text-slate-300">Profit Maksimal</span>
                              <span className="text-[9px] md:text-[10px] text-slate-500 uppercase">Volume Rendah</span>
                          </div>
                          <span className="text-xl md:text-2xl font-black text-emerald-500 tabular-nums">{results.targetMax ? formatDecimal(results.targetMax, 1) : "-"}</span>
                      </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 4: UNIFIED PRICE CANDLE */}
        <section className="bg-white dark:bg-slate-900 rounded-[2rem] md:rounded-[2.5rem] p-6 md:p-12 border border-slate-200 dark:border-slate-800 shadow-xl relative overflow-hidden">
          {results.A > 0 ? (
            <div className="space-y-8 md:space-y-10">
              <div className="flex items-center justify-between">
                <h2 className="text-xl md:text-2xl font-black text-slate-900 dark:text-white tracking-tight uppercase">Struktur Harga</h2>
              </div>

              <div className="relative group overflow-x-auto custom-scrollbar pb-2 md:pb-0">
                <div className="h-12 md:h-16 w-full min-w-[500px] bg-slate-100 dark:bg-slate-800 rounded-2xl overflow-hidden flex shadow-inner border border-slate-200 dark:border-slate-700/50">
                  {breakdownData.map((item, idx) => {
                    const width = getPercentage(item.val);
                    if (width <= 0) return null;
                    return (
                      <div 
                        key={idx} 
                        style={{ width: `${width}%` }}
                        className={`${item.color} h-full transition-all duration-1000 ease-in-out border-r border-black/10 relative group/segment`}
                        title={`${item.label}: ${formatRupiah(item.val)}`}
                      >
                         {width > 10 && (
                            <div className="absolute inset-0 flex items-center justify-center text-[9px] md:text-[10px] font-black text-white/90 opacity-0 group-hover/segment:opacity-100 transition-opacity">
                                {formatDecimal(width, 0)}%
                            </div>
                         )}
                      </div>
                    );
                  })}
                  {results.netProfitFinal < 0 && (
                    <div className="absolute inset-y-0 right-0 bg-red-600/20 w-full animate-pulse pointer-events-none" />
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-y-4 md:gap-y-6 gap-x-2 md:gap-x-4">
                {breakdownData.map((item, idx) => (
                  <div key={idx} className="flex flex-col gap-1 md:gap-1.5 p-2 md:p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                    <div className="flex items-center gap-2 mb-1">
                      <div className={`w-2.5 h-2.5 md:w-3 md:h-3 rounded-full ${item.dotColor} flex-shrink-0 ring-2 ring-white dark:ring-slate-900`} />
                      <span className="text-[10px] md:text-xs font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">{item.label}</span>
                    </div>
                    <span className="text-xs md:text-sm font-black text-slate-900 dark:text-white pl-4 md:pl-5">
                      {formatRupiah(item.val)} <span className="text-slate-400 font-bold ml-1 text-[9px] md:text-[10px]">({formatDecimal(getPercentage(item.val), 1)}%)</span>
                    </span>
                  </div>
                ))}
              </div>

              <div className="mt-6 md:mt-8 pt-6 md:pt-8 border-t border-slate-100 dark:border-slate-800 flex flex-col md:flex-row items-center md:justify-between gap-6">
                <div className="flex items-center gap-4 w-full md:w-auto">
                  <div className={`p-4 rounded-2xl ${results.netProfitFinal >= 0 ? "bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-500" : "bg-red-100 dark:bg-red-500/10 text-red-600 dark:text-red-500"} border border-transparent dark:border-white/5`}>
                    <Activity size={24} />
                  </div>
                  <div>
                    <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1">Laba Bersih Final</h4>
                    <p className={`text-3xl md:text-4xl font-black ${results.netProfitFinal >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                      {formatRupiah(results.netProfitFinal)}
                    </p>
                  </div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800 px-8 py-6 rounded-[2rem] border border-slate-200 dark:border-slate-700 flex flex-col items-center min-w-[180px] w-full md:w-auto">
                  <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-2">Total Profitability</span>
                  <span className={`text-3xl font-black ${results.netProfitFinal >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                    {formatDecimal(results.netProfitPercent, 1)}%
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="py-24 md:py-32 flex flex-col items-center justify-center text-slate-300 dark:text-slate-700 border-4 border-dashed border-slate-100 dark:border-slate-800 rounded-[3rem] bg-slate-50 dark:bg-slate-900/50 group">
              <BarChart3 size={60} className="mb-4 md:mb-6 opacity-20 group-hover:opacity-40 transition-all duration-700" />
              <p className="font-black text-[10px] md:text-xs tracking-[0.5em] uppercase opacity-40 group-hover:opacity-60 transition-opacity">Masukan Data</p>
            </div>
          )}
        </section>

      </div>
    </div>
  );
};
