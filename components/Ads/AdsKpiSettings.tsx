import React, { useState, useEffect } from 'react';
import { supabase } from '../../services/supabase';
import { Store, IklanKpiTarget } from '../../types';
import toast from 'react-hot-toast';
import { Loader2, Save, Target, AlertCircle } from 'lucide-react';

interface AdsKpiSettingsProps {
  store: Store;
}

export const DEFAULT_KPI_TARGET: Pick<IklanKpiTarget, 'target_acos' | 'target_roas' | 'target_ctr' | 'target_konversi' | 'rekomendasi_aktif'> = {
  target_acos: 30,
  target_roas: 3,
  target_ctr: null,
  target_konversi: null,
  rekomendasi_aktif: true,
};

export default function AdsKpiSettings({ store }: AdsKpiSettingsProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<typeof DEFAULT_KPI_TARGET>(DEFAULT_KPI_TARGET);
  const [existingId, setExistingId] = useState<string | null>(null);

  const isMultiStoreView = (store as any).is_multiple || store.id === 'all';

  useEffect(() => {
    if (isMultiStoreView) {
      setLoading(false);
      return;
    }
    fetchTarget();
  }, [store.id]);

  const fetchTarget = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.from('iklan_kpi_target').select('*').eq('store_id', store.id).maybeSingle();
      if (error) throw error;
      if (data) {
        setExistingId(data.id);
        setForm({
          target_acos: data.target_acos,
          target_roas: data.target_roas,
          target_ctr: data.target_ctr,
          target_konversi: data.target_konversi,
          rekomendasi_aktif: data.rekomendasi_aktif,
        });
      } else {
        setExistingId(null);
        setForm(DEFAULT_KPI_TARGET);
      }
    } catch (err: any) {
      toast.error('Gagal memuat target KPI: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (form.target_acos <= 0 || form.target_roas <= 0) {
      toast.error('Target ACOS dan ROAS harus lebih dari 0');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from('iklan_kpi_target')
        .upsert({ store_id: store.id, ...form, updated_at: new Date().toISOString() }, { onConflict: 'store_id' });
      if (error) throw error;
      toast.success('Target KPI berhasil disimpan');
      fetchTarget();
    } catch (err: any) {
      toast.error('Gagal menyimpan: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  if (isMultiStoreView) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800 p-10 text-center">
        <AlertCircle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
        <h3 className="font-bold text-slate-800 dark:text-slate-100 mb-1">Pilih Toko Spesifik</h3>
        <p className="text-sm text-slate-500">Target KPI diatur per toko. Pilih satu toko untuk mengatur target ACOS/ROAS-nya.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800 p-6 shadow-sm max-w-2xl">
      <div className="flex items-center gap-3 mb-1">
        <Target className="w-5 h-5 text-blue-600" />
        <h3 className="font-black text-slate-800 dark:text-slate-100">Target KPI Evaluasi Iklan</h3>
      </div>
      <p className="text-sm text-slate-500 mb-6">
        Dipakai untuk badge status di Ringkasan dan rekomendasi otomatis. Nilai default sudah masuk akal untuk kebanyakan toko - sesuaikan kalau perlu.
        {!existingId && <span className="block mt-1 text-amber-600 dark:text-amber-400 font-medium">Belum pernah diatur - menampilkan nilai default.</span>}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Target ACOS Maksimal (%)</label>
          <input
            type="number"
            value={form.target_acos}
            onChange={e => setForm({ ...form, target_acos: Number(e.target.value) })}
            className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-[10px] text-slate-400 mt-1">Iklan dianggap boros kalau ACOS di atas angka ini.</p>
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Target ROAS Minimal (x)</label>
          <input
            type="number"
            step="0.1"
            value={form.target_roas}
            onChange={e => setForm({ ...form, target_roas: Number(e.target.value) })}
            className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-[10px] text-slate-400 mt-1">Iklan dianggap sehat kalau ROAS minimal segini.</p>
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Target CTR Minimal (%) <span className="text-slate-400 font-normal normal-case">- opsional</span></label>
          <input
            type="number"
            step="0.1"
            value={form.target_ctr ?? ''}
            onChange={e => setForm({ ...form, target_ctr: e.target.value === '' ? null : Number(e.target.value) })}
            placeholder="Tidak diatur"
            className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Target Konversi Minimal (%) <span className="text-slate-400 font-normal normal-case">- opsional</span></label>
          <input
            type="number"
            step="0.1"
            value={form.target_konversi ?? ''}
            onChange={e => setForm({ ...form, target_konversi: e.target.value === '' ? null : Number(e.target.value) })}
            placeholder="Tidak diatur"
            className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl">
        <div>
          <p className="text-sm font-bold text-slate-800 dark:text-slate-200">Aktifkan Rekomendasi Otomatis</p>
          <p className="text-[10px] text-slate-500">Kalau dimatikan, halaman Rekomendasi tidak akan mengevaluasi toko ini.</p>
        </div>
        <button
          onClick={() => setForm({ ...form, rekomendasi_aktif: !form.rekomendasi_aktif })}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${form.rekomendasi_aktif ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'}`}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${form.rekomendasi_aktif ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </div>

      <div className="mt-6 flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl font-black text-sm shadow-lg shadow-blue-500/20 transition-all"
        >
          <Save className="w-4 h-4" /> {saving ? 'Menyimpan...' : 'Simpan Target'}
        </button>
      </div>
    </div>
  );
}
