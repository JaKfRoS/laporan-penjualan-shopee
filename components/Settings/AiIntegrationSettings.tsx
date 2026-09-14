
import React, { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Sparkles, Loader2, Eye, EyeOff, Save, Trash2, CheckCircle2, PlugZap, Pencil } from 'lucide-react';
import { AiProvider, AiSettings } from '../../types';
import { getAiSettings, saveAiSettings, deleteAiSettings, maskApiKey } from '../../services/aiSettings';
import { getSalesInsights, DEFAULT_MODELS, PROVIDER_LABELS } from '../../services/aiInsights';

const PROVIDER_OPTIONS: { value: AiProvider; label: string; helper: string }[] = [
  { value: 'gemini', label: 'Google Gemini', helper: 'Dapatkan API key gratis di aistudio.google.com/apikey' },
  { value: 'openai', label: 'OpenAI', helper: 'API key dari platform.openai.com/api-keys' },
  { value: 'anthropic', label: 'Anthropic Claude', helper: 'API key dari console.anthropic.com' },
  { value: 'openai_compatible', label: 'Lainnya (kompatibel OpenAI)', helper: 'DeepSeek, Groq, OpenRouter, Ollama, atau server sendiri - isi Base URL di bawah' },
];

export const AiIntegrationSettings: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [savedSettings, setSavedSettings] = useState<AiSettings | null>(null);
  const [editing, setEditing] = useState(false);

  const [provider, setProvider] = useState<AiProvider>('gemini');
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');

  useEffect(() => {
    getAiSettings()
      .then(s => {
        setSavedSettings(s);
        if (s) {
          setProvider(s.provider);
          setModel(s.model || '');
          setBaseUrl(s.base_url || '');
        } else {
          setEditing(true);
        }
      })
      .catch(err => toast.error('Gagal memuat pengaturan AI: ' + err.message))
      .finally(() => setLoading(false));
  }, []);

  const resetFormToSaved = () => {
    if (savedSettings) {
      setProvider(savedSettings.provider);
      setModel(savedSettings.model || '');
      setBaseUrl(savedSettings.base_url || '');
    }
    setApiKey('');
    setShowApiKey(false);
    setEditing(false);
  };

  const handleSave = async () => {
    if (!apiKey.trim()) {
      toast.error('API key wajib diisi.');
      return;
    }
    if (provider === 'openai_compatible' && !baseUrl.trim()) {
      toast.error('Base URL wajib diisi untuk provider "Lainnya".');
      return;
    }

    setSaving(true);
    try {
      await saveAiSettings({
        provider,
        api_key: apiKey.trim(),
        model: model.trim() || null,
        base_url: provider === 'openai_compatible' ? baseUrl.trim() : null,
      });
      const refreshed = await getAiSettings();
      setSavedSettings(refreshed);
      setApiKey('');
      setShowApiKey(false);
      setEditing(false);
      toast.success('Pengaturan AI berhasil disimpan.');
    } catch (err: any) {
      toast.error('Gagal menyimpan: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    const keyToTest = apiKey.trim() || (savedSettings && !editing ? undefined : undefined);
    const settingsToTest: AiSettings | null = apiKey.trim()
      ? { user_id: '', provider, api_key: apiKey.trim(), model: model.trim() || null, base_url: baseUrl.trim() || null, updated_at: '' }
      : savedSettings;

    if (!settingsToTest) {
      toast.error('Isi API key terlebih dahulu.');
      return;
    }

    setTesting(true);
    const toastId = toast.loading('Menguji koneksi AI...');
    try {
      await getSalesInsights({ contoh: 'tes koneksi', omzet: 1000000, jumlah_pesanan: 10 }, settingsToTest);
      toast.success('Berhasil! API key valid dan bisa dipakai.', { id: toastId });
    } catch (err: any) {
      toast.error('Gagal: ' + (err.message || 'API key tidak valid.'), { id: toastId });
    } finally {
      setTesting(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Hapus pengaturan AI? Fitur AI Insights di Dashboard akan nonaktif sampai diatur ulang.')) return;
    setDeleting(true);
    try {
      await deleteAiSettings();
      setSavedSettings(null);
      setApiKey('');
      setModel('');
      setBaseUrl('');
      setProvider('gemini');
      setEditing(true);
      toast.success('Pengaturan AI dihapus.');
    } catch (err: any) {
      toast.error('Gagal menghapus: ' + err.message);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-slate-900 p-6 md:p-8 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 text-purple-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-900 p-6 md:p-8 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm">
      <div className="flex items-center gap-4 mb-6 md:mb-8">
        <div className="w-12 h-12 md:w-14 md:h-14 bg-purple-100 dark:bg-purple-500/10 rounded-2xl flex items-center justify-center shrink-0">
          <Sparkles className="w-6 h-6 md:w-8 md:h-8 text-purple-600" />
        </div>
        <div>
          <h2 className="text-xl md:text-2xl font-black uppercase tracking-tight">Integrasi AI</h2>
          <p className="text-xs md:text-sm text-slate-500 font-medium">Aktifkan fitur "AI Insights" di Dashboard dengan API key model AI pilihan Anda.</p>
        </div>
      </div>

      {savedSettings && !editing ? (
        <div className="p-4 md:p-6 bg-emerald-50/60 dark:bg-emerald-950/10 rounded-2xl border border-emerald-100 dark:border-emerald-900/20 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm font-black text-slate-800 dark:text-slate-100">{PROVIDER_LABELS[savedSettings.provider]}</p>
              <p className="text-xs text-slate-500 font-mono mt-0.5 truncate">{maskApiKey(savedSettings.api_key)}</p>
              <p className="text-[11px] text-slate-400 mt-1">Model: {savedSettings.model || DEFAULT_MODELS[savedSettings.provider]}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleTest}
              disabled={testing}
              className="flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-black uppercase hover:bg-slate-50 dark:hover:bg-slate-700 transition-all disabled:opacity-50"
            >
              {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlugZap className="w-3.5 h-3.5" />}
              Tes
            </button>
            <button
              onClick={() => setEditing(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-black uppercase hover:bg-slate-50 dark:hover:bg-slate-700 transition-all"
            >
              <Pencil className="w-3.5 h-3.5" />
              Ganti
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="p-2.5 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-all disabled:opacity-50"
              title="Hapus"
            >
              {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <div>
            <label className="text-xs font-black text-slate-500 uppercase tracking-widest mb-2 block">Provider AI</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {PROVIDER_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setProvider(opt.value)}
                  className={`text-left p-3.5 rounded-xl border transition-all ${
                    provider === opt.value
                      ? 'border-purple-500 bg-purple-50 dark:bg-purple-500/10 ring-1 ring-purple-500'
                      : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <p className="text-sm font-black text-slate-800 dark:text-slate-100">{opt.label}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">{opt.helper}</p>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-black text-slate-500 uppercase tracking-widest mb-2 block">API Key</label>
            <div className="relative">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder={savedSettings ? 'Masukkan API key baru untuk mengganti' : 'Tempel API key di sini'}
                className="w-full px-4 py-3 pr-11 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-mono outline-none focus:ring-2 focus:ring-purple-500"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {provider === 'openai_compatible' && (
            <div>
              <label className="text-xs font-black text-slate-500 uppercase tracking-widest mb-2 block">Base URL</label>
              <input
                type="text"
                value={baseUrl}
                onChange={e => setBaseUrl(e.target.value)}
                placeholder="https://api.deepseek.com/v1"
                className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-mono outline-none focus:ring-2 focus:ring-purple-500"
              />
              <p className="text-[11px] text-slate-400 mt-1.5">URL endpoint yang kompatibel dengan format Chat Completions OpenAI (tanpa akhiran "/chat/completions").</p>
            </div>
          )}

          <div>
            <label className="text-xs font-black text-slate-500 uppercase tracking-widest mb-2 block">Model (opsional)</label>
            <input
              type="text"
              value={model}
              onChange={e => setModel(e.target.value)}
              placeholder={`Default: ${DEFAULT_MODELS[provider]}`}
              className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all disabled:opacity-50 shadow-lg shadow-purple-500/20"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Simpan
            </button>
            <button
              onClick={handleTest}
              disabled={testing || !apiKey.trim()}
              className="flex items-center gap-2 px-6 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-slate-50 dark:hover:bg-slate-700 transition-all disabled:opacity-50"
            >
              {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlugZap className="w-4 h-4" />}
              Tes Koneksi
            </button>
            {savedSettings && (
              <button
                onClick={resetFormToSaved}
                className="text-xs font-black text-slate-400 uppercase tracking-widest hover:text-slate-600"
              >
                Batal
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
