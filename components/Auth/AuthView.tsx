
import React, { useState } from 'react';
import { supabase } from '../../services/supabase';
import { toast } from 'react-hot-toast';
import { BarChart3, Mail, Lock, Loader2, ArrowRight, LogIn, UserPlus } from 'lucide-react';

export const AuthView: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'login' | 'signup'>('login');

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (password.length < 6) {
      toast.error('Password minimal 6 karakter');
      return;
    }

    setLoading(true);
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          if (error.message.includes('Invalid login credentials')) {
            throw new Error("Akun tidak ditemukan atau password salah. Silakan klik 'Daftar Akun Baru' jika belum punya akun.");
          }
          throw error;
        }
        toast.success('Berhasil masuk!');
      } else {
        const { data, error } = await supabase.auth.signUp({ 
          email, 
          password,
        });
        
        if (error) throw error;
        
        if (data.user && !data.session) {
          toast.success('Pendaftaran berhasil! Silakan cek email Anda untuk konfirmasi (jika diaktifkan) atau coba login.');
        } else if (data.session) {
          toast.success('Pendaftaran berhasil! Selamat datang.');
        }
      }
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
              {mode === 'login' ? 'Login ke Dashboard' : 'Daftar Akun Baru'}
            </h1>
            <p className="text-slate-500 text-sm">
              {mode === 'login' 
                ? 'Kelola data penjualan Shopee Anda dalam satu dashboard' 
                : 'Mulai analisis profit bersih toko Shopee Anda sekarang'}
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
                  placeholder="Minimal 6 karakter"
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
              ) : mode === 'login' ? (
                <>MASUK SEKARANG <LogIn className="w-5 h-5" /></>
              ) : (
                <>DAFTAR SEKARANG <UserPlus className="w-5 h-5" /></>
              )}
            </button>
          </form>

          <div className="mt-10 pt-8 border-t border-slate-100 text-center">
            <p className="text-slate-500 text-sm font-medium">
              {mode === 'login' ? "Belum punya akun?" : "Sudah punya akun?"}
            </p>
            <button 
              onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
              className="mt-2 text-orange-600 font-bold hover:text-orange-700 underline underline-offset-4"
            >
              {mode === 'login' ? 'Klik di sini untuk Daftar' : 'Klik di sini untuk Login'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
