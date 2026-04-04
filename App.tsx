
import React, { useState, useEffect } from 'react';
import { supabase, isSupabaseConfigured } from './services/supabase';
import { AuthView } from './components/Auth/AuthView';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './components/Dashboard/Dashboard';
import { ImportWizard } from './components/Import/ImportWizard';
import { PriceCalculator } from './components/Calculator/PriceCalculator';
import { ProductManager } from './components/Product/ProductManager';
import { StoreSelector } from './components/StoreSelector';
import { Layout } from './components/Layout';
import AdsCenter from './components/Ads/AdsCenter';
import { CashflowPage } from './components/Cashflow/CashflowPage';
import { Toaster, toast } from 'react-hot-toast';

// Intercept toast.error globally to suppress refresh token errors
const originalToastError = toast.error;
(toast as any).error = (message: any, options?: any) => {
  if (typeof message === 'string' && (message.toLowerCase().includes('refresh token') || message.includes('refresh_token_not_found') || message.toLowerCase().includes('invalid refresh token'))) {
    return '';
  }
  return originalToastError(message, options);
};
import { Store } from './types';
import { AlertCircle, Loader2, Trash2, AlertTriangle, RefreshCcw, UserCircle, ShieldAlert, Pencil, Check, X, Code, Layers, Megaphone, Calculator, LayoutDashboard, UploadCloud, Settings, PackageSearch, Database, Wallet } from 'lucide-react';

export default function App() {
  const [session, setSession] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'import' | 'settings' | 'ads' | 'calculator' | 'products' | 'keuangan'>('dashboard');
  const [currentStore, setCurrentStore] = useState<Store | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isConfirmingClear, setIsConfirmingClear] = useState(false);
  const [refreshKey, setRefreshKey] = useState(Date.now()); 
  
  const [editingStoreId, setEditingStoreId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [showSqlGuide, setShowSqlGuide] = useState(false);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  const isRefreshTokenError = (err: any) => {
    const msg = err?.message?.toLowerCase() || '';
    return msg.includes('refresh token') || msg.includes('refresh_token_not_found') || msg.includes('invalid refresh token');
  };

  const handleSupabaseError = async (err: any) => {
    if (isRefreshTokenError(err)) {
        try {
          await supabase.auth.signOut();
        } catch (e) {
          // Suppress sign out errors if it's already a refresh token issue
        }
        Object.keys(localStorage).forEach(key => {
          if (key.startsWith('sb-') && key.endsWith('-auth-token')) {
            localStorage.removeItem(key);
          }
        });
        setSession(null);
        toast.error("Sesi Anda telah berakhir. Silakan login kembali.");
        return true;
    }
    return false;
  };

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return;
    }

    const initSession = async () => {
      try {
        const { data: { session: currentSession }, error } = await supabase.auth.getSession();
        
        if (error) {
          if (!isRefreshTokenError(error)) {
            console.error("Auth Error:", error);
          }
          await handleSupabaseError(error);
        } else {
          setSession(currentSession);
          if (currentSession) {
            await fetchStores(currentSession.user.id);
          }
        }
      } catch (err: any) {
        if (!isRefreshTokenError(err)) {
          console.error("Auth Exception:", err);
        }
        await handleSupabaseError(err);
      } finally {
        setLoading(false);
      }
    };

    initSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      if (event === 'TOKEN_REFRESHED') {
        console.log('Token refreshed successfully');
      }
      
      if (event === 'SIGNED_OUT') {
        Object.keys(localStorage).forEach(key => {
          if (key.startsWith('sb-') && key.endsWith('-auth-token')) {
            localStorage.removeItem(key);
          }
        });
        setStores([]);
        setCurrentStore(null);
        setSession(null);
      } else if (newSession) {
        setSession(newSession);
        fetchStores(newSession.user.id);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchStores = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('stores')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });

      if (error) throw error;

      if (data && data.length > 0) {
        setStores(data);
        
        // Check for saved store in localStorage
        const savedStoreId = localStorage.getItem('lastSelectedStoreId');
        const savedStore = data.find(s => s.id === savedStoreId);

        if (savedStore) {
             setCurrentStore(savedStore);
        } else if (!currentStore || (currentStore.id !== 'all' && !data.find(s => s.id === currentStore.id))) {
          setCurrentStore(data[0]);
        }
      } else {
        await createDefaultStore(userId);
      }
    } catch (err: any) {
      if (!(await handleSupabaseError(err))) {
        toast.error("Gagal memuat toko: " + err.message);
      }
    }
  };

  // Persist selected store
  useEffect(() => {
    if (currentStore?.id) {
      localStorage.setItem('lastSelectedStoreId', currentStore.id);
    }
  }, [currentStore]);

  const createDefaultStore = async (userId: string) => {
    const { data: newStore, error } = await supabase
      .from('stores')
      .insert([{ user_id: userId, name: 'Toko Utama' }])
      .select()
      .single();

    if (error) throw error;
    setStores([newStore]);
    setCurrentStore(newStore);
  };

  const handleAddStore = async (name: string) => {
    if (!session?.user?.id) return;
    try {
      const { data, error } = await supabase
        .from('stores')
        .insert([{ user_id: session.user.id, name }])
        .select()
        .single();
      
      if (error) throw error;
      setStores([...stores, data]);
      setCurrentStore(data);
      toast.success(`Toko "${name}" berhasil dibuat!`);
    } catch (err: any) {
      if (!(await handleSupabaseError(err))) {
        toast.error("Gagal menambah toko: " + err.message);
      }
    }
  };

  const handleUpdateStoreName = async (id: string) => {
    if (!editName.trim()) return;
    try {
      const { error } = await supabase
        .from('stores')
        .update({ name: editName.trim() })
        .eq('id', id);

      if (error) throw error;
      
      setStores(stores.map(s => s.id === id ? { ...s, name: editName.trim() } : s));
      if (currentStore?.id === id) {
        setCurrentStore({ ...currentStore, name: editName.trim() });
      }
      setEditingStoreId(null);
      toast.success("Nama toko diubah!");
    } catch (err: any) {
      if (!(await handleSupabaseError(err))) {
        toast.error("Gagal: " + err.message);
      }
    }
  };

  const handleDeleteSpecificStore = async (id: string, name: string) => {
    if (!window.confirm(`PERINGATAN: Toko "${name}" akan dihapus secara permanen.\n\nSemua data pesanan terkait toko ini juga akan hilang.\nLanjutkan?`)) {
      return;
    }

    const toastId = toast.loading('Menghapus toko...');
    try {
      const { error } = await supabase
        .from('stores')
        .delete()
        .eq('id', id);

      if (error) throw error;

      const updatedStores = stores.filter(s => s.id !== id);
      setStores(updatedStores);

      // Logika switch toko jika yang dihapus adalah toko aktif
      if (currentStore?.id === id) {
        if (updatedStores.length > 0) {
          setCurrentStore(updatedStores[0]);
        } else {
          // Jika tidak ada toko tersisa, buat toko default
          if (session?.user?.id) await createDefaultStore(session.user.id);
        }
      }

      toast.success(`Toko "${name}" berhasil dihapus.`, { id: toastId });
    } catch (err: any) {
      console.error(err);
      if (await handleSupabaseError(err)) return;
      // Jika error foreign key constraint, tampilkan panduan SQL
      if (err.code === '23503') {
         toast.error("Gagal: Database menolak penghapusan. Jalankan script SQL Update.", { id: toastId });
         setShowSqlGuide(true);
      } else {
         toast.error("Gagal hapus toko: " + err.message, { id: toastId });
      }
    }
  };

  const handleClearStoreData = async () => {
    if (!currentStore) {
      toast.error("Pilih toko terlebih dahulu.");
      return;
    }
    
    if (currentStore.id === 'all') {
      toast.error("Pilih toko spesifik untuk menghapus data.");
      return;
    }

    if (!isConfirmingClear) {
      setIsConfirmingClear(true);
      return;
    }

    setIsDeleting(true);
    const loadingToast = toast.loading("Menghapus data toko...");

    try {
      // Hapus orders (akan cascade ke order_items)
      const { error: deleteOrders } = await supabase
        .from('orders')
        .delete()
        .eq('store_id', currentStore.id);
        
      // Hapus data iklan juga jika ada
      const { error: deleteAds } = await supabase
        .from('ads_performance')
        .delete()
        .eq('store_id', currentStore.id);
        
      // Also clear mappings? Optional. Let's keep mappings for convenience, only clear transactions.

      if (deleteOrders) throw deleteOrders;

      toast.success("Data pesanan & iklan berhasil dikosongkan.", { id: loadingToast });
      setIsConfirmingClear(false);
      setRefreshKey(Date.now());
      setActiveTab('dashboard');
    } catch (err: any) {
      console.error(err);
      if (await handleSupabaseError(err)) return;
      toast.error("Gagal hapus data: " + err.message, { id: loadingToast });
      setShowSqlGuide(true);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleResetEverything = async () => {
    if (!session?.user?.id) return;
    
    if (!window.confirm("PERINGATAN KERAS: Akun Anda akan dihapus permanen beserta seluruh data toko.")) {
      return;
    }

    setIsDeleting(true);
    const loadingToast = toast.loading("Menghapus akun...");

    try {
      const { error } = await supabase.rpc('delete_user_account');

      if (error) {
        if (error.code === 'PGRST202' || error.message.includes('function not found')) {
            toast.error("Update database diperlukan. Menghapus data manual...", { id: loadingToast });
            await supabase.from('stores').delete().eq('user_id', session.user.id);
            await handleLogout();
            window.location.reload();
            return;
        }
        throw error;
      }

      toast.success(`Akun dihapus.`, { id: loadingToast });
      await handleLogout();
      window.location.reload(); 
    } catch (err: any) {
      console.error(err);
      if (await handleSupabaseError(err)) return;
      toast.error("Gagal: " + err.message, { id: loadingToast });
      setShowSqlGuide(true);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      // Ignore sign out errors
    } finally {
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith('sb-') && key.endsWith('-auth-token')) {
          localStorage.removeItem(key);
        }
      });
      setSession(null);
    }
  };

  // --- Mobile Navigation Components ---
  const MobileNavItem = ({ id, label, icon: Icon }: any) => (
    <button
      onClick={() => setActiveTab(id)}
      className={`flex flex-col items-center justify-center p-2 rounded-xl transition-all ${
        activeTab === id 
          ? 'text-orange-600 dark:text-orange-500 bg-orange-50 dark:bg-orange-500/10' 
          : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
      }`}
    >
      <Icon className={`w-5 h-5 ${activeTab === id ? 'fill-current' : 'stroke-[2px]'}`} />
      <span className="text-[10px] font-bold mt-1">{label}</span>
    </button>
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <Loader2 className="w-10 h-10 text-orange-500 animate-spin" />
      </div>
    );
  }

  if (!session) return <AuthView />;

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors">
      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        isDarkMode={isDarkMode} 
        toggleDarkMode={() => setIsDarkMode(!isDarkMode)} 
      />
      
      {/* Main Content Area - Added pb-24 for mobile nav spacing */}
      <main className="flex-1 overflow-auto custom-scrollbar pb-28 md:pb-0">
        <Layout>
          <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8 md:mb-10">
            <div>
              <h1 className="text-2xl md:text-3xl font-black tracking-tighter uppercase flex items-center gap-3">
                {currentStore?.id === 'all' ? (
                  <>
                    <Layers className="w-6 h-6 md:w-8 md:h-8 text-purple-600" />
                    Semua Toko
                  </>
                ) : (
                  activeTab === 'dashboard' ? (
                     <span className="truncate max-w-[200px] md:max-w-none">Toko: {currentStore?.name}</span>
                  ) : 
                  activeTab === 'ads' ? 'Ads & Marketing' : 
                  activeTab === 'calculator' ? 'Kalkulator Harga' :
                  activeTab === 'import' ? 'Import Data' :
                  activeTab === 'products' ? 'Produk & HPP' :
                  activeTab === 'keuangan' ? 'Keuangan' :
                  'Pengaturan'
                )}
              </h1>
              <div className="flex items-center gap-2 mt-1">
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                <p className="text-slate-500 text-[10px] md:text-xs font-bold uppercase tracking-widest">Database Aktif</p>
              </div>
            </div>
            <div className="flex items-center gap-3 self-end md:self-auto">
              <StoreSelector 
                stores={stores} 
                currentStore={currentStore} 
                onSelect={setCurrentStore}
                onAddStore={handleAddStore}
              />
              <button 
                onClick={handleLogout}
                className="hidden md:block px-5 py-2.5 text-xs font-black bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl hover:text-red-600 transition-all uppercase tracking-widest"
              >
                Logout
              </button>
               {/* Mobile Dark Mode Toggle */}
               <button 
                  onClick={() => setIsDarkMode(!isDarkMode)}
                  className="md:hidden p-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl"
                >
                  {isDarkMode ? <div className="w-4 h-4 rounded-full bg-slate-200" /> : <div className="w-4 h-4 rounded-full bg-slate-900" />}
               </button>
            </div>
          </header>



          {activeTab === 'dashboard' && currentStore && (
            <Dashboard 
              store={currentStore} 
              allStores={stores} 
              key={`dash-${currentStore.id}-${refreshKey}`} 
            />
          )}

          {activeTab === 'keuangan' && currentStore && (
             <CashflowPage 
               store={currentStore} 
               allStores={stores} 
             />
          )}

          {activeTab === 'calculator' && currentStore && (
             <PriceCalculator store={currentStore} />
          )}

          {activeTab === 'products' && currentStore && (
             <ProductManager store={currentStore} />
          )}

          {activeTab === 'ads' && currentStore && (
            currentStore.id === 'all' ? (
              <div className="flex flex-col items-center justify-center py-20 text-center px-4">
                 <div className="w-20 h-20 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mb-4">
                    <Layers className="w-10 h-10 text-slate-400" />
                 </div>
                 <h2 className="text-xl font-bold mb-2">Pilih Toko Spesifik</h2>
                 <p className="text-slate-500 max-w-md text-sm">Anda tidak dapat melihat data iklan untuk "Semua Toko" sekaligus. Silakan pilih toko spesifik melalui menu di pojok kanan atas.</p>
              </div>
            ) : (
              <AdsCenter store={currentStore} />
            )
          )}
          
          {activeTab === 'import' && currentStore && (
            currentStore.id === 'all' ? (
              <div className="flex flex-col items-center justify-center py-20 text-center px-4">
                 <div className="w-20 h-20 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mb-4">
                    <Layers className="w-10 h-10 text-slate-400" />
                 </div>
                 <h2 className="text-xl font-bold mb-2">Pilih Toko Spesifik</h2>
                 <p className="text-slate-500 max-w-md text-sm">Anda tidak dapat mengimpor data ke "Semua Toko" sekaligus. Silakan pilih toko spesifik melalui menu di pojok kanan atas.</p>
              </div>
            ) : (
              <ImportWizard 
                key={currentStore.id}
                store={currentStore} 
                onComplete={() => {
                  setRefreshKey(Date.now());
                  // Optionally redirect to dashboard or products page
                  // setActiveTab('dashboard'); 
                }} 
              />
            )
          )}
          
          {activeTab === 'settings' && (
             <div className="max-w-4xl space-y-6 md:space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-24">
              <div className="bg-white dark:bg-slate-900 p-6 md:p-8 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm">
                <div className="flex items-center justify-between mb-8 md:mb-10">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 md:w-14 md:h-14 bg-orange-100 dark:bg-orange-500/10 rounded-2xl flex items-center justify-center">
                      <UserCircle className="w-6 h-6 md:w-8 md:h-8 text-orange-600" />
                    </div>
                    <div>
                      <h2 className="text-xl md:text-2xl font-black uppercase tracking-tight">Akun Saya</h2>
                      <p className="text-xs md:text-sm text-slate-500 font-medium break-all">{session.user.email}</p>
                    </div>
                  </div>
                  

                </div>

                <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4 ml-1">Daftar Toko & Pengaturan</h3>
                <div className="grid grid-cols-1 gap-4">
                  {stores.map(s => (
                    <div key={s.id} className="p-4 md:p-6 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-100 dark:border-slate-800 flex justify-between items-center group transition-all hover:bg-slate-100 dark:hover:bg-slate-800/80">
                      <div className="flex-1 mr-4">
                        {editingStoreId === s.id ? (
                          <div className="flex items-center gap-2">
                            <input 
                              autoFocus
                              type="text"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              className="px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-sm font-bold outline-none w-full min-w-[100px]"
                            />
                            <button onClick={() => handleUpdateStoreName(s.id)} className="p-2 bg-green-600 text-white rounded-xl shrink-0"><Check className="w-4 h-4" /></button>
                            <button onClick={() => setEditingStoreId(null)} className="p-2 bg-slate-200 dark:bg-slate-700 rounded-xl shrink-0"><X className="w-4 h-4" /></button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-4">
                            <span className="text-sm md:text-lg font-black tracking-tight dark:text-slate-200 truncate">{s.name}</span>
                          </div>
                        )}
                      </div>
                      
                      {/* Action Buttons */}
                      <div className="flex items-center gap-2">
                        {editingStoreId !== s.id && (
                          <button 
                            onClick={() => { setEditingStoreId(s.id); setEditName(s.name); }}
                            className="p-2 md:p-2.5 text-slate-400 hover:text-orange-600 hover:bg-white dark:hover:bg-slate-700 rounded-xl transition-all"
                            title="Ubah Nama"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                        )}
                        <button 
                          onClick={() => handleDeleteSpecificStore(s.id, s.name)}
                          className="p-2 md:p-2.5 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-all"
                          title="Hapus Toko"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="md:hidden">
                  <button 
                    onClick={handleLogout}
                    className="w-full mt-4 px-5 py-3 text-sm font-black bg-red-500 text-white rounded-xl hover:bg-red-600 transition-all uppercase tracking-widest"
                  >
                    Logout
                  </button>
                </div>
              </div>
              
              {currentStore?.id !== 'all' && (
              <div className="bg-red-50/30 dark:bg-red-950/5 rounded-[2.5rem] border border-red-100 dark:border-red-900/20 p-6 md:p-10">
                <div className="flex items-center gap-3 text-red-600 font-black mb-6 md:mb-10 uppercase text-xs md:text-sm tracking-widest">
                  <ShieldAlert className="w-5 h-5 md:w-6 md:h-6" />
                  Zona Bahaya
                </div>
                
                <div className="grid grid-cols-1 gap-6 md:gap-8">
                  <div className="bg-white dark:bg-slate-900/60 p-6 md:p-8 rounded-3xl border border-red-100 dark:border-red-900/10 flex flex-col lg:flex-row items-center justify-between gap-6 md:gap-8">
                    <div className="flex-1 text-center lg:text-left">
                      <h4 className="font-black flex items-center justify-center lg:justify-start gap-2 text-base md:text-lg uppercase dark:text-slate-200">
                        <RefreshCcw className={`w-5 h-5 text-orange-500 ${isDeleting ? 'animate-spin' : ''}`} />
                        KOSONGKAN DATA TOKO
                      </h4>
                      <p className="text-xs md:text-sm text-slate-500 mt-2 font-medium">
                        Menghapus SEMUA Riwayat Pesanan & Data Iklan untuk toko ini.
                      </p>
                    </div>
                    
                    <div className="flex flex-col gap-2 w-full lg:w-auto">
                      <button 
                        onClick={handleClearStoreData}
                        disabled={isDeleting || !currentStore}
                        className={`w-full lg:w-auto px-6 md:px-10 py-4 md:py-5 font-black rounded-2xl text-xs transition-all flex items-center justify-center gap-3 disabled:opacity-50 uppercase tracking-widest shadow-xl ${
                          isConfirmingClear 
                            ? 'bg-amber-500 hover:bg-amber-600 text-white shadow-amber-500/20' 
                            : 'bg-red-600 hover:bg-red-700 text-white shadow-red-500/20'
                        }`}
                      >
                        {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                        {isConfirmingClear ? 'YAKIN INGIN HAPUS?' : 'KOSONGKAN DATA'}
                      </button>
                      
                      {isConfirmingClear && !isDeleting && (
                        <button 
                          onClick={() => setIsConfirmingClear(false)}
                          className="text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-slate-600 text-center"
                        >
                          Batal
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="bg-gradient-to-br from-red-600 to-red-700 p-6 md:p-8 rounded-3xl shadow-2xl flex flex-col lg:flex-row items-center justify-between gap-6 md:gap-8">
                    <div className="text-white text-center lg:text-left flex-1">
                      <h4 className="font-black text-xl md:text-2xl uppercase tracking-tighter">HAPUS AKUN SAYA</h4>
                      <p className="text-xs md:text-sm text-red-100 mt-1 font-medium">Data yang dihapus tidak dapat dikembalikan.</p>
                    </div>
                    <button 
                      onClick={handleResetEverything}
                      disabled={isDeleting}
                      className="w-full lg:w-auto px-10 py-5 bg-white text-red-600 font-black rounded-2xl text-sm hover:bg-red-50 transition-all uppercase tracking-widest shadow-xl"
                    >
                      RESET AKUN
                    </button>
                  </div>
                </div>
              </div>
              )}
            </div>
          )}
        </Layout>
      </main>

      {/* Mobile Bottom Navigation (Glassmorphism) */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-[100] bg-white/90 dark:bg-slate-900/90 backdrop-blur-lg border-t border-slate-200 dark:border-slate-800 pb-safe">
        <div className="grid grid-cols-7 gap-0.5 p-2 max-w-md mx-auto">
          <MobileNavItem id="dashboard" label="Home" icon={LayoutDashboard} />
          <MobileNavItem id="keuangan" label="Keuangan" icon={Wallet} />
          <MobileNavItem id="products" label="Produk" icon={PackageSearch} />
          <MobileNavItem id="ads" label="Ads" icon={Megaphone} />
          <MobileNavItem id="calculator" label="Harga" icon={Calculator} />
          <MobileNavItem id="import" label="Import" icon={UploadCloud} />
          <MobileNavItem id="settings" label="Menu" icon={Settings} />
        </div>
      </div>

      <Toaster position="bottom-center" toastOptions={{ className: 'mb-16 md:mb-0' }} />
    </div>
  );
}
