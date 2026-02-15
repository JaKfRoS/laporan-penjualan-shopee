
import React, { useState, useEffect } from 'react';
import { supabase, isSupabaseConfigured } from './services/supabase';
import { AuthView } from './components/Auth/AuthView';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './components/Dashboard/Dashboard';
import { ImportWizard } from './components/Import/ImportWizard';
import { StoreSelector } from './components/StoreSelector';
import { Layout } from './components/Layout';
import { Toaster, toast } from 'react-hot-toast';
import { Store } from './types';
import { AlertCircle, Loader2, Trash2, AlertTriangle, RefreshCcw, UserCircle, ShieldAlert, Pencil, Check, X, Code } from 'lucide-react';

export default function App() {
  const [session, setSession] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'import' | 'settings'>('dashboard');
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

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return;
    }

    const initSession = async () => {
      try {
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        setSession(currentSession);
        if (currentSession) {
          await fetchStores(currentSession.user.id);
        }
      } catch (err) {
        console.error("Auth Error:", err);
      } finally {
        setLoading(false);
      }
    };

    initSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (newSession) {
        fetchStores(newSession.user.id);
      } else {
        setStores([]);
        setCurrentStore(null);
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
        if (!currentStore || !data.find(s => s.id === currentStore.id)) {
          setCurrentStore(data[0]);
        }
      } else {
        await createDefaultStore(userId);
      }
    } catch (err: any) {
      toast.error("Gagal memuat toko: " + err.message);
    }
  };

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
      toast.error("Gagal menambah toko: " + err.message);
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
      toast.error("Gagal: " + err.message);
    }
  };

  const handleClearStoreData = async () => {
    console.log("Trigger: handleClearStoreData");
    if (!currentStore) {
      console.log("Error: currentStore is null");
      toast.error("Pilih toko terlebih dahulu.");
      return;
    }

    // Step 1: Confirmation
    if (!isConfirmingClear) {
      console.log("Status: Waiting for confirmation");
      setIsConfirmingClear(true);
      return;
    }

    console.log("Status: Starting deletion process");
    setIsDeleting(true);
    const loadingToast = toast.loading("Mengirim perintah hapus ke database...");

    try {
      // 1. Mencoba dengan RPC (Rekomendasi)
      console.log("Action: Calling RPC 'delete_all_store_orders'...");
      const { data, error: rpcError } = await supabase.rpc('delete_all_store_orders', { 
        target_store_id: currentStore.id 
      });

      if (rpcError) {
        console.warn("RPC Error:", rpcError);
        // Jika fungsi tidak ditemukan
        if (rpcError.code === 'PGRST202' || rpcError.message.includes('not found')) {
          console.log("Action: RPC not found. Showing SQL guide.");
          setShowSqlGuide(true);
          
          // 2. Fallback: Mencoba Direct Delete (Jika RLS mengizinkan)
          console.log("Action: Attempting fallback direct delete...");
          const { error: deleteError } = await supabase
            .from('orders')
            .delete()
            .eq('store_id', currentStore.id);
            
          if (deleteError) {
            console.error("Direct Delete Fallback Error:", deleteError);
            throw new Error("Izin hapus ditolak oleh database. Anda harus menjalankan kode SQL di dashboard Supabase.");
          }
        } else {
          throw rpcError;
        }
      }

      console.log("Status: Deletion successful");
      toast.success("Berhasil! Data telah dikosongkan.", { id: loadingToast });
      
      // Reset state
      setIsConfirmingClear(false);
      setRefreshKey(Date.now());
      setActiveTab('dashboard');

    } catch (err: any) {
      console.error("Final Catch Error:", err);
      toast.error(err.message || "Gagal menghapus data.", { id: loadingToast, duration: 6000 });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleResetEverything = async () => {
    if (!session?.user?.id) return;
    setIsDeleting(true);
    try {
      const { error } = await supabase
        .from('stores')
        .delete()
        .eq('user_id', session.user.id);

      if (error) throw error;
      toast.success(`Akun direset.`);
      window.location.reload(); 
    } catch (err: any) {
      toast.error("Gagal: " + err.message);
    } finally {
      setIsDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <Loader2 className="w-10 h-10 text-orange-500 animate-spin" />
      </div>
    );
  }

  if (!session) return <AuthView />;

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors">
      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        isDarkMode={isDarkMode} 
        toggleDarkMode={() => setIsDarkMode(!isDarkMode)} 
      />
      <main className="flex-1 overflow-auto custom-scrollbar">
        <Layout>
          <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 mb-10">
            <div>
              <h1 className="text-3xl font-black tracking-tighter uppercase">
                {activeTab === 'dashboard' ? `Toko: ${currentStore?.name}` : activeTab}
              </h1>
              <div className="flex items-center gap-2 mt-1">
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                <p className="text-slate-500 text-xs font-bold uppercase tracking-widest">Database Aktif</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <StoreSelector 
                stores={stores} 
                currentStore={currentStore} 
                onSelect={setCurrentStore}
                onAddStore={handleAddStore}
              />
              <button 
                onClick={() => supabase.auth.signOut()}
                className="px-5 py-2.5 text-xs font-black bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl hover:text-red-600 transition-all uppercase tracking-widest"
              >
                Logout
              </button>
            </div>
          </header>

          {/* SQL GUIDE */}
          {showSqlGuide && (
            <div className="mb-10 p-6 bg-amber-50 dark:bg-amber-900/20 border-2 border-amber-200 dark:border-amber-800 rounded-3xl animate-in fade-in zoom-in duration-300">
              <div className="flex items-start gap-4">
                <div className="p-3 bg-amber-200 dark:bg-amber-800 rounded-2xl shrink-0">
                  <Code className="w-6 h-6 text-amber-700 dark:text-amber-200" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-black uppercase tracking-tight text-amber-900 dark:text-amber-100">Penting: Izin Database Dibutuhkan</h3>
                  <p className="text-sm text-amber-800 dark:text-amber-300 mt-1 mb-4">
                    Untuk menghapus data dalam jumlah besar, database memerlukan fungsi khusus. Salin kode ini ke <b>SQL Editor Supabase</b> dan klik <b>RUN</b>:
                  </p>
                  <pre className="bg-slate-900 text-orange-400 p-4 rounded-xl text-xs overflow-x-auto font-mono mb-4 border border-slate-800 select-all">
{`CREATE OR REPLACE FUNCTION delete_all_store_orders(target_store_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM stores WHERE id = target_store_id AND user_id = auth.uid()) THEN
    DELETE FROM orders WHERE store_id = target_store_id;
    RETURN true;
  END IF;
  RETURN false;
END; $$;
GRANT EXECUTE ON FUNCTION delete_all_store_orders(uuid) TO authenticated;`}
                  </pre>
                  <div className="flex gap-3">
                    <button 
                      onClick={() => setShowSqlGuide(false)}
                      className="px-6 py-2 bg-amber-600 text-white text-xs font-bold rounded-xl hover:bg-amber-700 transition-all"
                    >
                      OKE, SAYA SUDAH RUN
                    </button>
                    <button 
                      onClick={() => window.open('https://app.supabase.com', '_blank')}
                      className="px-6 py-2 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs font-bold rounded-xl border border-amber-200 dark:border-amber-700"
                    >
                      BUKA SUPABASE DASHBOARD
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'dashboard' && currentStore && (
            <Dashboard 
              store={currentStore} 
              key={`dash-${currentStore.id}-${refreshKey}`} 
            />
          )}
          
          {activeTab === 'import' && currentStore && (
            <ImportWizard 
              store={currentStore} 
              onComplete={() => {
                setRefreshKey(Date.now());
                setActiveTab('dashboard');
              }} 
            />
          )}
          
          {activeTab === 'settings' && (
            <div className="max-w-4xl space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-24">
              <div className="bg-white dark:bg-slate-900 p-8 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm">
                <div className="flex items-center gap-4 mb-10">
                  <div className="w-14 h-14 bg-orange-100 dark:bg-orange-500/10 rounded-2xl flex items-center justify-center">
                    <UserCircle className="w-8 h-8 text-orange-600" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-black uppercase tracking-tight">Akun Saya</h2>
                    <p className="text-sm text-slate-500 font-medium">{session.user.email}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4">
                  {stores.map(s => (
                    <div key={s.id} className="p-6 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-100 dark:border-slate-800 flex justify-between items-center group transition-all">
                      <div className="flex-1">
                        {editingStoreId === s.id ? (
                          <div className="flex items-center gap-2">
                            <input 
                              autoFocus
                              type="text"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              className="px-4 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-sm font-bold outline-none w-full max-w-xs"
                            />
                            <button onClick={() => handleUpdateStoreName(s.id)} className="p-2.5 bg-green-600 text-white rounded-xl"><Check className="w-5 h-5" /></button>
                            <button onClick={() => setEditingStoreId(null)} className="p-2.5 bg-slate-200 dark:bg-slate-700 rounded-xl"><X className="w-5 h-5" /></button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-4">
                            <span className="text-lg font-black tracking-tight">{s.name}</span>
                            <button 
                              onClick={() => { setEditingStoreId(s.id); setEditName(s.name); }}
                              className="p-2 text-slate-400 hover:text-orange-600 transition-all opacity-0 group-hover:opacity-100"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-red-50/30 dark:bg-red-950/5 rounded-[2.5rem] border border-red-100 dark:border-red-900/20 p-10">
                <div className="flex items-center gap-3 text-red-600 font-black mb-10 uppercase text-sm tracking-widest">
                  <ShieldAlert className="w-6 h-6" />
                  Management Data (Bahaya)
                </div>
                
                <div className="grid grid-cols-1 gap-8">
                  <div className="bg-white dark:bg-slate-900/60 p-8 rounded-3xl border border-red-100 dark:border-red-900/10 flex flex-col lg:flex-row items-center justify-between gap-8">
                    <div className="flex-1 text-center lg:text-left">
                      <h4 className="font-black flex items-center justify-center lg:justify-start gap-2 text-lg uppercase">
                        <RefreshCcw className={`w-5 h-5 text-orange-500 ${isDeleting ? 'animate-spin' : ''}`} />
                        Hapus Data: {currentStore?.name}
                      </h4>
                      <p className="text-sm text-slate-500 mt-2 font-medium">
                        Ini akan menghapus semua riwayat pesanan dari toko ini secara permanen.
                      </p>
                    </div>
                    
                    <div className="flex flex-col gap-2">
                      <button 
                        onClick={handleClearStoreData}
                        disabled={isDeleting || !currentStore}
                        className={`w-full lg:w-auto px-10 py-5 font-black rounded-2xl text-xs transition-all flex items-center justify-center gap-3 disabled:opacity-50 uppercase tracking-widest shadow-xl ${
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

                  <div className="bg-gradient-to-br from-red-600 to-red-700 p-8 rounded-3xl shadow-2xl flex flex-col lg:flex-row items-center justify-between gap-8">
                    <div className="text-white text-center lg:text-left flex-1">
                      <h4 className="font-black text-2xl uppercase tracking-tighter">RESET TOTAL</h4>
                      <p className="text-sm text-red-100 mt-1 font-medium">Hapus akun dan semua toko secara permanen.</p>
                    </div>
                    <button 
                      onClick={handleResetEverything}
                      disabled={isDeleting}
                      className="w-full lg:w-auto px-12 py-5 bg-white text-red-600 font-black rounded-2xl text-sm hover:bg-red-50 transition-all uppercase tracking-widest shadow-xl"
                    >
                      RESET AKUN
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </Layout>
      </main>
      <Toaster position="bottom-right" />
    </div>
  );
}
