import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../services/supabase';
import { Store, IklanMingguan, IklanProdukMapping, Product, IklanKpiTarget } from '../../types';
import { resolveHpp, calcMargin, iklanGroupKey, applyPpnAdjustment, resolveKpiTarget } from './adsHelpers';
import { evaluateRecommendation, Recommendation, RecommendationLevel } from './adsRules';
import { DEFAULT_KPI_TARGET } from './AdsKpiSettings';
import { Loader2, Sparkles, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';

interface AdsRekomendasiProps {
  store: Store;
}

interface RecommendationCard {
  key: string;
  namaIklanRaw: string;
  storeName: string;
  productName: string | null;
  recommendation: Recommendation;
}

const LEVEL_STYLE: Record<RecommendationLevel, { bg: string; border: string }> = {
  'stop': { bg: 'bg-red-50 dark:bg-red-500/10', border: 'border-red-200 dark:border-red-500/20' },
  'turunkan-bid': { bg: 'bg-amber-50 dark:bg-amber-500/10', border: 'border-amber-200 dark:border-amber-500/20' },
  'cek-listing': { bg: 'bg-amber-50 dark:bg-amber-500/10', border: 'border-amber-200 dark:border-amber-500/20' },
  'kurang-exposure': { bg: 'bg-slate-50 dark:bg-slate-800/50', border: 'border-slate-200 dark:border-slate-700' },
  'naikkan-budget': { bg: 'bg-emerald-50 dark:bg-emerald-500/10', border: 'border-emerald-200 dark:border-emerald-500/20' },
};

// N minggu terakhir yang diambil untuk evaluasi rolling (spec: 2-3 minggu).
const ROLLING_WEEKS = 3;

export default function AdsRekomendasi({ store }: AdsRekomendasiProps) {
  const [loading, setLoading] = useState(true);
  const [cards, setCards] = useState<RecommendationCard[]>([]);

  useEffect(() => {
    fetchAndEvaluate();
  }, [store.id]);

  const fetchAndEvaluate = async () => {
    setLoading(true);
    try {
      const isMulti = (store as any).is_multiple;
      const targetIds = isMulti ? (store as any).selected_ids : [store.id];

      let mingguanQuery = supabase.from('iklan_mingguan').select('*').order('periode_mulai', { ascending: true });
      let mappingQuery = supabase.from('iklan_produk_mapping').select('*');
      let productsQuery = supabase.from('products').select('*');
      let targetQuery = supabase.from('iklan_kpi_target').select('*');
      let storesQuery = supabase.from('stores').select('id, name');

      if (store.id !== 'all') {
        if (isMulti) {
          mingguanQuery = mingguanQuery.in('store_id', targetIds);
          mappingQuery = mappingQuery.in('store_id', targetIds);
          productsQuery = productsQuery.in('store_id', targetIds);
          targetQuery = targetQuery.in('store_id', targetIds);
          storesQuery = storesQuery.in('id', targetIds);
        } else {
          mingguanQuery = mingguanQuery.eq('store_id', store.id);
          mappingQuery = mappingQuery.eq('store_id', store.id);
          productsQuery = productsQuery.eq('store_id', store.id);
          targetQuery = targetQuery.eq('store_id', store.id);
          storesQuery = storesQuery.eq('id', store.id);
        }
      }

      const [
        { data: mData, error: mErr },
        { data: mapData, error: mapErr },
        { data: pData, error: pErr },
        { data: tData, error: tErr },
        { data: sData, error: sErr },
      ] = await Promise.all([mingguanQuery, mappingQuery, productsQuery, targetQuery, storesQuery]);

      if (mErr) throw mErr;
      if (mapErr) throw mapErr;
      if (pErr) throw pErr;
      if (tErr) throw tErr;
      if (sErr) throw sErr;

      const mappingByKey = new Map((mapData || []).map((m: IklanProdukMapping) => [`${m.store_id}::${m.nama_iklan_raw}`, m]));
      const productByKey = new Map((pData || []).map((p: Product) => [`${p.store_id}::${p.sku}`, p]));
      const targetByStore = new Map((tData || []).map((t: IklanKpiTarget) => [t.store_id, t]));
      const storeNameById = new Map((sData || []).map((s: any) => [s.id, s.name]));

      // Biaya di file export belum termasuk PPN 11% (kecuali toko menyatakan
      // sudah lewat Setup KPI) - disesuaikan sebelum masuk ke rule engine,
      // supaya ACOS/margin yang dievaluasi mencerminkan biaya riil.
      const grouped = new Map<string, IklanMingguan[]>();
      (mData || []).forEach((row: IklanMingguan) => {
        const target = targetByStore.get(row.store_id) || { ...DEFAULT_KPI_TARGET, store_id: row.store_id, id: '' };
        const adjustedRow = { ...row, biaya: applyPpnAdjustment(row, target.biaya_termasuk_ppn).biaya };
        const key = iklanGroupKey(adjustedRow);
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(adjustedRow);
      });

      const results: RecommendationCard[] = [];

      grouped.forEach((allWeeks, key) => {
        const storeId = allWeeks[0].store_id;
        const target = targetByStore.get(storeId) || { ...DEFAULT_KPI_TARGET, store_id: storeId, id: '' };
        if (!target.rekomendasi_aktif) return;

        const recentWeeks = allWeeks.slice(-ROLLING_WEEKS);
        const namaIklanRaw = recentWeeks[0].nama_iklan_raw;
        const mapping = mappingByKey.get(key) || null;
        const product = mapping?.product_sku ? productByKey.get(`${storeId}::${mapping.product_sku}`) : undefined;
        const hpp = resolveHpp(mapping, product || null);
        // Target ACOS/ROAS per produk (kalau diatur) menang di atas target toko.
        const resolvedTarget = resolveKpiTarget(mapping, target);

        const marginPerWeek = (week: IklanMingguan): number | null => {
          const m = calcMargin(
            hpp.value,
            mapping?.proses_pesanan ?? 1250,
            mapping?.pot_admin_persen ?? 0,
            mapping?.operasional_persen ?? 0,
            week
          );
          return m.marginSetelahIklan;
        };

        const rec = evaluateRecommendation(
          recentWeeks,
          { target_acos: resolvedTarget.targetAcos, target_roas: resolvedTarget.targetRoas },
          marginPerWeek
        );
        if (rec) {
          results.push({
            key,
            namaIklanRaw,
            storeName: storeNameById.get(storeId) || '-',
            productName: product?.product_name || null,
            recommendation: rec,
          });
        }
      });

      const priorityOrder: RecommendationLevel[] = ['stop', 'turunkan-bid', 'cek-listing', 'kurang-exposure', 'naikkan-budget'];
      results.sort((a, b) => priorityOrder.indexOf(a.recommendation.level) - priorityOrder.indexOf(b.recommendation.level));

      setCards(results);
    } catch (err: any) {
      console.error(err);
      toast.error('Gagal mengevaluasi rekomendasi: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800 p-12 text-center">
        <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-4" />
        <h3 className="text-lg font-bold mb-2">Tidak ada rekomendasi mendesak saat ini</h3>
        <p className="text-slate-500 max-w-md mx-auto text-sm">
          Belum ada produk-iklan yang memenuhi aturan rekomendasi (butuh minimal 1-2 minggu data). Kalau toko baru diaktifkan atau rekomendasi dimatikan di Setup KPI, itu juga bisa jadi sebabnya.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-slate-500 text-sm">
        <Sparkles className="w-4 h-4" />
        <span>{cards.length} rekomendasi, diurutkan dari yang paling perlu aksi.</span>
      </div>
      {cards.map(card => {
        const style = LEVEL_STYLE[card.recommendation.level];
        return (
          <div key={card.key} className={`rounded-2xl border p-5 ${style.bg} ${style.border}`}>
            <div className="flex items-start gap-3">
              <span className="text-2xl leading-none">{card.recommendation.icon}</span>
              <div className="min-w-0 flex-1">
                <p className="font-black text-slate-900 dark:text-white">{card.recommendation.title}</p>
                <p className="text-sm font-bold text-slate-700 dark:text-slate-300 truncate mt-0.5">
                  {card.namaIklanRaw}
                  {card.productName && <span className="text-slate-400 font-medium"> — {card.productName}</span>}
                </p>
                <p className="text-xs text-slate-500 mt-1">{card.storeName}</p>
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-2 leading-relaxed">{card.recommendation.reason}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
