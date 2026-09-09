import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../services/supabase';
import { Store, IklanMingguan, IklanProdukMapping, Product, JenisIklan, IklanKpiTarget } from '../../types';
import { DateRangePicker } from '../Dashboard/DateRangePicker';
import AdsCocokkanProduk from './AdsCocokkanProduk';
import AdsKpiSettings, { DEFAULT_KPI_TARGET } from './AdsKpiSettings';
import AdsRekomendasi from './AdsRekomendasi';
import {
  calcAdsMetrics, sumAdsRows, resolveHpp, calcMargin, calcStatusKesehatan,
  groupIklanMingguanByProduk, iklanGroupKey, AdsAggregate, StatusKesehatan,
} from './adsHelpers';
import {
  Megaphone, Layers, DollarSign, Percent, ChevronLeft, Link2, AlertTriangle, TrendingUp, Target, Sparkles,
} from 'lucide-react';
import toast from 'react-hot-toast';

interface AdsCenterProps {
  store: Store;
}

const getDefaultMonthRange = () => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { start: fmt(start), end: fmt(end) };
};

const formatRupiah = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;

const JENIS_OPTIONS: { value: 'all' | JenisIklan; label: string }[] = [
  { value: 'all', label: 'Semua Jenis Iklan' },
  { value: 'Iklan Pencarian', label: 'Iklan Pencarian' },
  { value: 'Iklan Serba Bisa', label: 'Iklan Serba Bisa' },
  { value: 'Iklan Toko', label: 'Iklan Toko' },
];

const STATUS_BADGE: Record<StatusKesehatan, { label: string; className: string }> = {
  'sehat': { label: '✅ Sehat', className: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
  'waspada': { label: '⚠️ Waspada', className: 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  'perlu-aksi': { label: '🔴 Perlu Aksi', className: 'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400' },
};

type Tab = 'ringkasan' | 'rekomendasi' | 'cocokkan' | 'kpi';

export default function AdsCenter({ store }: AdsCenterProps) {
  const [activeTab, setActiveTab] = useState<Tab>('ringkasan');
  const [dateRange, setDateRange] = useState(getDefaultMonthRange);
  const [jenisFilter, setJenisFilter] = useState<'all' | JenisIklan>('all');
  const [rows, setRows] = useState<IklanMingguan[]>([]);
  const [mappings, setMappings] = useState<IklanProdukMapping[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [kpiTargets, setKpiTargets] = useState<IklanKpiTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const isMultiple = (store as any).is_multiple || store.id === 'all';

  useEffect(() => {
    fetchData();
  }, [store.id, dateRange.start, dateRange.end]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const isMulti = (store as any).is_multiple;
      const targetIds = isMulti ? (store as any).selected_ids : [store.id];

      let mingguanQuery = supabase
        .from('iklan_mingguan')
        .select('*')
        // overlap: baris ikut kalau rentang periodenya beririsan dengan filter tanggal
        .lte('periode_mulai', dateRange.end)
        .gte('periode_akhir', dateRange.start);

      let mappingQuery = supabase.from('iklan_produk_mapping').select('*');
      let productsQuery = supabase.from('products').select('*');
      let kpiQuery = supabase.from('iklan_kpi_target').select('*');

      if (store.id !== 'all') {
        if (isMulti) {
          mingguanQuery = mingguanQuery.in('store_id', targetIds);
          mappingQuery = mappingQuery.in('store_id', targetIds);
          productsQuery = productsQuery.in('store_id', targetIds);
          kpiQuery = kpiQuery.in('store_id', targetIds);
        } else {
          mingguanQuery = mingguanQuery.eq('store_id', store.id);
          mappingQuery = mappingQuery.eq('store_id', store.id);
          productsQuery = productsQuery.eq('store_id', store.id);
          kpiQuery = kpiQuery.eq('store_id', store.id);
        }
      }

      const [
        { data: mData, error: mErr },
        { data: mapData, error: mapErr },
        { data: pData, error: pErr },
        { data: kData, error: kErr },
      ] = await Promise.all([mingguanQuery, mappingQuery, productsQuery, kpiQuery]);

      if (mErr) throw mErr;
      if (mapErr) throw mapErr;
      if (pErr) throw pErr;
      if (kErr) throw kErr;

      setRows(mData || []);
      setMappings(mapData || []);
      setProducts(pData || []);
      setKpiTargets(kData || []);
    } catch (err: any) {
      console.error(err);
      toast.error('Gagal memuat data iklan: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const filteredRows = useMemo(
    () => (jenisFilter === 'all' ? rows : rows.filter(r => r.jenis_iklan === jenisFilter)),
    [rows, jenisFilter]
  );

  // Kunci store_id::nama_iklan_raw - dua toko berbeda bisa kebetulan punya nama
  // iklan yang identik, jadi tidak cukup dikunci nama_iklan_raw saja saat
  // beberapa toko digabung (mode "Semua"/"Multiple Toko").
  const mappingByKey = useMemo(() => new Map(mappings.map(m => [`${m.store_id}::${m.nama_iklan_raw}`, m])), [mappings]);
  const productByKey = useMemo(() => new Map(products.map(p => [`${p.store_id}::${p.sku}`, p])), [products]);
  const targetByStore = useMemo(() => new Map(kpiTargets.map(t => [t.store_id, t])), [kpiTargets]);

  const overall = sumAdsRows(filteredRows);
  const overallMetrics = calcAdsMetrics(overall);

  const grouped = useMemo(() => groupIklanMingguanByProduk(filteredRows), [filteredRows]);

  const productRows = useMemo(() => {
    return Array.from(grouped.entries()).map(([key, weekRows]) => {
      const namaIklanRaw = weekRows[0].nama_iklan_raw;
      const storeId = weekRows[0].store_id;
      const agg: AdsAggregate = sumAdsRows(weekRows);
      const metrics = calcAdsMetrics(agg);
      const mapping = mappingByKey.get(key) || null;
      const product = mapping?.product_sku ? productByKey.get(`${storeId}::${mapping.product_sku}`) : undefined;
      const hpp = resolveHpp(mapping, product || null);
      const margin = calcMargin(
        hpp.value,
        mapping?.harga_jual_override ?? null,
        mapping?.proses_pesanan ?? 1250,
        mapping?.pot_admin_persen ?? 0,
        mapping?.operasional_persen ?? 0,
        agg
      );
      const target = targetByStore.get(storeId) || DEFAULT_KPI_TARGET;
      const status = calcStatusKesehatan(metrics.acos, target.target_acos, margin.marginSetelahIklan);
      const jenisIklan = weekRows.find(w => w.jenis_iklan)?.jenis_iklan ?? null;
      return { key, namaIklanRaw, storeId, jenisIklan, agg, metrics, mapping, product, hpp, margin, status };
    }).sort((a, b) => b.agg.biaya - a.agg.biaya);
  }, [grouped, mappingByKey, productByKey, targetByStore]);

  const selectedDetail = selectedKey ? productRows.find(p => p.key === selectedKey) : null;
  const selectedWeeks = selectedKey
    ? (grouped.get(selectedKey) || []).slice().sort((a, b) => a.periode_mulai.localeCompare(b.periode_mulai))
    : [];

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'ringkasan', label: 'Ringkasan', icon: null },
    { id: 'rekomendasi', label: 'Rekomendasi', icon: <Sparkles className="w-4 h-4" /> },
    { id: 'cocokkan', label: 'Upload & Cocokkan', icon: <Link2 className="w-4 h-4" /> },
    { id: 'kpi', label: 'Setup KPI', icon: <Target className="w-4 h-4" /> },
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm">
        <div>
          <h2 className="text-xl md:text-2xl font-black uppercase tracking-tight flex items-center gap-3">
            <Megaphone className="w-6 h-6 md:w-8 md:h-8 text-blue-600" />
            Ads Center
          </h2>
          <p className="text-sm text-slate-500 mt-1">Rekap &amp; analisa performa Shopee Ads Anda</p>
        </div>

        <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl w-full md:w-auto overflow-x-auto">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex-1 md:flex-none px-4 py-2 rounded-lg text-sm font-bold transition-colors flex items-center justify-center gap-2 whitespace-nowrap ${activeTab === t.id ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
            >
              {t.icon}{t.label}
            </button>
          ))}
        </div>
      </div>

      {isMultiple && (
        <div className="px-4 py-2 bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs font-bold rounded-xl border border-blue-100 dark:border-blue-500/20 flex items-center gap-2 w-fit">
          <Layers className="w-4 h-4" />
          <span>Mode Agregasi {store.id === 'all' ? 'Semua' : 'Multiple'} Toko</span>
        </div>
      )}

      {activeTab === 'cocokkan' ? (
        <AdsCocokkanProduk store={store} onImported={fetchData} />
      ) : activeTab === 'kpi' ? (
        <AdsKpiSettings store={store} />
      ) : activeTab === 'rekomendasi' ? (
        <AdsRekomendasi store={store} />
      ) : selectedKey && selectedDetail ? (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <button
            onClick={() => setSelectedKey(null)}
            className="flex items-center gap-2 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors font-medium text-sm"
          >
            <ChevronLeft className="w-4 h-4" /> Kembali ke Ringkasan
          </button>

          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800 p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-lg font-black text-slate-800 dark:text-slate-100">{selectedDetail.namaIklanRaw}</h3>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${STATUS_BADGE[selectedDetail.status].className}`}>
                {STATUS_BADGE[selectedDetail.status].label}
              </span>
            </div>
            <p className="text-sm text-slate-500 mb-4">
              {selectedDetail.product ? `Terhubung ke: ${selectedDetail.product.product_name} (${selectedDetail.product.sku})` : 'Belum dicocokkan ke Master Produk'}
            </p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <Metric label="Biaya" value={formatRupiah(selectedDetail.agg.biaya)} color="text-red-600" />
              <Metric label="Omzet" value={formatRupiah(selectedDetail.agg.omzet)} color="text-green-600" />
              <Metric label="ACOS" value={`${selectedDetail.metrics.acos.toFixed(1)}%`} />
              <Metric label="ROAS" value={`${selectedDetail.metrics.roas.toFixed(2)}x`} />
              <Metric
                label="Margin Setelah Iklan"
                value={selectedDetail.margin.marginSetelahIklan !== null ? formatRupiah(selectedDetail.margin.marginSetelahIklan) : 'Data HPP belum lengkap'}
                color={selectedDetail.margin.marginSetelahIklan !== null ? (selectedDetail.margin.marginSetelahIklan >= 0 ? 'text-emerald-600' : 'text-red-600') : 'text-amber-500'}
              />
            </div>
          </div>

          <h4 className="text-sm font-black text-slate-500 uppercase tracking-widest">Tren Mingguan</h4>
          <div className="space-y-3">
            {selectedWeeks.map(w => {
              const m = calcAdsMetrics(w);
              return (
                <div key={w.id} className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 p-4 grid grid-cols-2 md:grid-cols-6 gap-4">
                  <div className="col-span-2 md:col-span-1">
                    <p className="text-[10px] font-bold text-slate-400 uppercase">Periode</p>
                    <p className="text-xs font-black text-slate-700 dark:text-slate-300">{w.periode_mulai} — {w.periode_akhir}</p>
                  </div>
                  <Metric small label="Impresi" value={w.impresi.toLocaleString()} />
                  <Metric small label="Klik" value={w.klik.toLocaleString()} />
                  <Metric small label="Biaya" value={formatRupiah(w.biaya)} color="text-red-600" />
                  <Metric small label="Omzet" value={formatRupiah(w.omzet)} color="text-green-600" />
                  <Metric small label="ROAS" value={`${m.roas.toFixed(2)}x`} />
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-col md:flex-row items-center gap-3 bg-white dark:bg-slate-900 p-3 rounded-2xl border border-slate-100 dark:border-slate-800">
            <div className="w-full md:flex-1">
              <DateRangePicker start={dateRange.start} end={dateRange.end} onChange={setDateRange} />
            </div>
            <select
              value={jenisFilter}
              onChange={e => setJenisFilter(e.target.value as any)}
              className="w-full md:w-auto px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-bold text-slate-700 dark:text-slate-300 outline-none focus:ring-2 focus:ring-blue-500"
            >
              {JENIS_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {loading ? (
            <div className="flex justify-center py-20">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800 p-12 text-center">
              <div className="w-20 h-20 bg-slate-50 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4">
                <Megaphone className="w-10 h-10 text-slate-400" />
              </div>
              <h3 className="text-lg font-bold mb-2">Belum ada data iklan di periode ini</h3>
              <p className="text-slate-500 max-w-md mx-auto">
                Upload file laporan iklan dari Shopee Ads Manager di tab "Upload & Cocokkan", atau ubah rentang tanggal.
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <SummaryCard icon={<DollarSign className="w-4 h-4" />} label="Total Biaya Iklan" value={formatRupiah(overall.biaya)} color="text-red-600" />
                <SummaryCard icon={<TrendingUp className="w-4 h-4" />} label="Total Omzet Iklan" value={formatRupiah(overall.omzet)} color="text-green-600" />
                <SummaryCard icon={<Percent className="w-4 h-4" />} label="ACOS Gabungan" value={`${overallMetrics.acos.toFixed(1)}%`} />
                <SummaryCard icon={<DollarSign className="w-4 h-4" />} label="ROAS Gabungan" value={`${overallMetrics.roas.toFixed(2)}x`} />
              </div>

              <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left min-w-[900px]">
                    <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500">
                      <tr>
                        <th className="px-6 py-3 font-bold uppercase tracking-wider text-[10px]">Nama Iklan / Produk</th>
                        <th className="px-6 py-3 font-bold uppercase tracking-wider text-[10px] text-right">Biaya</th>
                        <th className="px-6 py-3 font-bold uppercase tracking-wider text-[10px] text-right">Omzet</th>
                        <th className="px-6 py-3 font-bold uppercase tracking-wider text-[10px] text-right">ACOS</th>
                        <th className="px-6 py-3 font-bold uppercase tracking-wider text-[10px] text-right">ROAS</th>
                        <th className="px-6 py-3 font-bold uppercase tracking-wider text-[10px] text-right">HPP</th>
                        <th className="px-6 py-3 font-bold uppercase tracking-wider text-[10px] text-right">Margin Setelah Iklan</th>
                        <th className="px-6 py-3 font-bold uppercase tracking-wider text-[10px] text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {productRows.map(pr => (
                        <tr
                          key={pr.key}
                          onClick={() => setSelectedKey(pr.key)}
                          className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer"
                        >
                          <td className="px-6 py-4">
                            <p className="font-bold text-slate-800 dark:text-slate-200 truncate max-w-xs" title={pr.namaIklanRaw}>{pr.namaIklanRaw}</p>
                            <div className="flex items-center gap-1.5 mt-1">
                              {pr.product ? (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded text-[9px] font-bold">
                                  ✅ Terhubung
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded text-[9px] font-bold">
                                  ⚠️ Belum dicocokkan
                                </span>
                              )}
                              {pr.jenisIklan && <span className="text-[9px] text-slate-400">{pr.jenisIklan}</span>}
                            </div>
                          </td>
                          <td className="px-6 py-4 text-right font-bold text-red-600">{formatRupiah(pr.agg.biaya)}</td>
                          <td className="px-6 py-4 text-right font-bold text-green-600">{formatRupiah(pr.agg.omzet)}</td>
                          <td className="px-6 py-4 text-right font-bold">{pr.metrics.acos.toFixed(1)}%</td>
                          <td className="px-6 py-4 text-right font-bold">{pr.metrics.roas.toFixed(2)}x</td>
                          <td className="px-6 py-4 text-right">
                            {pr.hpp.value !== null ? (
                              <span className="inline-flex items-center gap-1 font-bold text-slate-700 dark:text-slate-300">
                                {pr.hpp.source === 'master' ? '🔗' : '✏️'} {formatRupiah(pr.hpp.value)}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-amber-500 font-bold text-xs">
                                <AlertTriangle className="w-3 h-3" /> Belum diisi
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-right font-bold">
                            {pr.margin.marginSetelahIklan !== null ? (
                              <span className={pr.margin.marginSetelahIklan >= 0 ? 'text-emerald-600' : 'text-red-600'}>
                                {formatRupiah(pr.margin.marginSetelahIklan)}
                              </span>
                            ) : (
                              <span className="text-slate-400 text-xs italic">Data HPP belum lengkap</span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-center">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${STATUS_BADGE[pr.status].className}`}>
                              {STATUS_BADGE[pr.status].label}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const SummaryCard: React.FC<{ icon: React.ReactNode; label: string; value: string; color?: string }> = ({ icon, label, value, color = 'text-slate-900 dark:text-white' }) => (
  <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 p-4 shadow-sm">
    <div className="flex items-center gap-1.5 text-slate-400 mb-1.5">
      {icon}
      <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
    </div>
    <p className={`text-xl font-black ${color}`}>{value}</p>
  </div>
);

const Metric: React.FC<{ label: string; value: string; color?: string; small?: boolean }> = ({ label, value, color = 'text-slate-900 dark:text-white', small }) => (
  <div>
    <p className={`font-bold text-slate-400 uppercase tracking-wider ${small ? 'text-[9px]' : 'text-[10px]'}`}>{label}</p>
    <p className={`font-black ${color} ${small ? 'text-sm' : 'text-lg'}`}>{value}</p>
  </div>
);
