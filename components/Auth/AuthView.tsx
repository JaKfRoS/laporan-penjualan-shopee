
import React, { useState } from 'react';
import { supabase } from '../../services/supabase';
import { toast } from 'react-hot-toast';
import { BarChart3, Mail, Lock, Loader2, LogIn, AlertCircle } from 'lucide-react';

export const AuthView: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Mode di-hardcode ke 'login' karena pendaftaran ditutup sementara
  const mode = 'login'; 

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (password.length < 6) {
      toast.error('Password minimal 6 karakter');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        if (error.message.includes('Invalid login credentials')) {
          throw new Error("Akun tidak ditemukan atau password salah.");
        }
        throw error;
      }
      toast.success('Berhasil masuk!');
    } catch (err: any) {
      toast.error(err.message || "Terjadi kesalahan autentikasi");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 p-6">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden">
        <div className="p-8 sm:p-12">
          <div className="flex items-center gap-2 text-orange-600 mb-8 justify-center">
            <BarChart3 className="w-10 h-10" />
            <span className="text-2xl font-black tracking-tighter uppercase">Shopee Analytics</span>
          </div>

          <div className="text-center mb-10">
            <h1 className="text-2xl font-black text-slate-900 mb-2">
              Login ke Dashboard
            </h1>
            <p className="text-slate-500 text-sm">
              Kelola data penjualan Shopee Anda dalam satu dashboard
            </p>
          </div>

          <form onSubmit={handleAuth} className="space-y-5">
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Alamat Email</label>
              <div className="relative">
                <Mail className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" />
                <input 
                  type="email" 
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="email@tokoanda.com"
                  className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-orange-500/10 focus:border-orange-500 outline-none transition-all font-medium"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Kata Sandi</label>
              <div className="relative">
                <Lock className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" />
                <input 
                  type="password" 
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password akun Anda"
                  className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-orange-500/10 focus:border-orange-500 outline-none transition-all font-medium"
                />
              </div>
            </div>

            <button 
              disabled={loading}
              className="w-full bg-orange-600 text-white py-4 rounded-2xl font-black hover:bg-orange-700 transition-all flex items-center justify-center gap-3 disabled:opacity-50 shadow-xl shadow-orange-500/20 mt-4"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>MASUK SEKARANG <LogIn className="w-5 h-5" /></>
              )}
            </button>
          </form>

          <div className="mt-10 pt-8 border-t border-slate-100 text-center">
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 flex flex-col items-center gap-2">
              <div className="flex items-center gap-2 text-amber-700 font-bold uppercase text-xs tracking-widest">
                <AlertCircle className="w-4 h-4" />
                Info
              </div>
              <p className="text-xs text-amber-600 font-medium leading-relaxed">
                Silakan login jika sudah memiliki akun.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
