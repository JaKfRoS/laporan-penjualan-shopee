import { IklanMingguan } from '../../types';
import { calcAdsMetrics } from './adsHelpers';

// Rule engine rekomendasi otomatis (spec modul iklan, bagian 6).
//
// CATATAN PENTING soal ambang batas di Rule 4 & 5: spec cuma bilang "klik
// tinggi, konversi rendah" dan "impresi rendah, biaya kecil" tanpa angka
// pasti. KLIK_TINGGI_THRESHOLD / CR_RENDAH_PERSEN / IMPRESI_RENDAH_THRESHOLD /
// BIAYA_KECIL_THRESHOLD di bawah adalah tebakan awal yang masuk akal, BUKAN
// angka yang divalidasi ke data nyata - sebaiknya disesuaikan setelah dipakai
// beberapa minggu dan dibandingkan ke kondisi toko yang sesungguhnya.
const KLIK_TINGGI_THRESHOLD = 20;
const CR_RENDAH_PERSEN = 1;
const IMPRESI_RENDAH_THRESHOLD = 500;
const BIAYA_KECIL_THRESHOLD = 50000;

export type RecommendationLevel = 'stop' | 'turunkan-bid' | 'naikkan-budget' | 'cek-listing' | 'kurang-exposure';

export interface Recommendation {
  level: RecommendationLevel;
  icon: string;
  title: string;
  reason: string;
}

// Prioritas tertinggi -> terendah. Kalau beberapa rule terpenuhi sekaligus
// untuk produk-iklan yang sama, cuma yang prioritas tertinggi ditampilkan -
// mencegah saran yang saling bertentangan (mis. "stop" & "naikkan budget"
// bersamaan). Mitigasi risiko (stop, turunkan bid) didahulukan di atas
// penyebab eksternal (cek listing) dan info netral (kurang exposure), lalu
// saran pertumbuhan (naikkan budget) paling akhir karena tidak mendesak.
const PRIORITY: RecommendationLevel[] = ['stop', 'turunkan-bid', 'cek-listing', 'kurang-exposure', 'naikkan-budget'];

const fmtRupiahSigned = (n: number) => `${n < 0 ? '-' : '+'}Rp ${Math.abs(Math.round(n)).toLocaleString('id-ID')}`;

export interface KpiTargetForRules {
  target_acos: number;
  target_roas: number;
}

/**
 * Evaluasi satu rekomendasi untuk satu produk-iklan, berdasarkan periode
 * rolling 2-3 minggu terakhir (supaya tidak reaktif ke fluktuasi satu
 * minggu). `weeks` harus sudah terurut ascending by periode_mulai, dan
 * `marginPerWeek` mengembalikan margin setelah iklan untuk satu baris minggu
 * (null kalau HPP/harga jual belum lengkap untuk produk itu).
 */
export const evaluateRecommendation = (
  weeks: IklanMingguan[],
  target: KpiTargetForRules,
  marginPerWeek: (week: IklanMingguan) => number | null
): Recommendation | null => {
  if (weeks.length === 0) return null;

  const last = weeks[weeks.length - 1];
  const prev = weeks.length >= 2 ? weeks[weeks.length - 2] : null;
  const metricsLast = calcAdsMetrics(last);
  const marginLast = marginPerWeek(last);

  const candidates: Recommendation[] = [];

  // Rule 1: ACOS > target DAN margin negatif, 2 minggu berturut-turut.
  if (prev) {
    const metricsPrev = calcAdsMetrics(prev);
    const marginPrev = marginPerWeek(prev);
    if (
      metricsLast.acos > target.target_acos && marginLast !== null && marginLast < 0 &&
      metricsPrev.acos > target.target_acos && marginPrev !== null && marginPrev < 0
    ) {
      candidates.push({
        level: 'stop',
        icon: '🔴',
        title: 'Matikan iklan / stop produk',
        reason: `ACOS ${metricsLast.acos.toFixed(0)}% > target ${target.target_acos}% selama 2 minggu berturut-turut, margin setelah iklan ${fmtRupiahSigned(marginLast)} → disarankan stop.`,
      });
    }
  }

  // Rule 2: ACOS > target tapi margin masih positif (atau belum diketahui).
  if (metricsLast.acos > target.target_acos && (marginLast === null || marginLast >= 0)) {
    candidates.push({
      level: 'turunkan-bid',
      icon: '⚠️',
      title: 'Turunkan bid, pantau',
      reason: `ACOS ${metricsLast.acos.toFixed(0)}% > target ${target.target_acos}%, margin setelah iklan ${marginLast !== null ? fmtRupiahSigned(marginLast) : 'belum bisa dihitung (HPP belum lengkap)'}.`,
    });
  }

  // Rule 3: ROAS >= target DAN margin sehat DAN tren naik dibanding minggu lalu.
  if (prev) {
    const metricsPrev = calcAdsMetrics(prev);
    if (metricsLast.roas >= target.target_roas && marginLast !== null && marginLast > 0 && metricsLast.roas > metricsPrev.roas) {
      candidates.push({
        level: 'naikkan-budget',
        icon: '🟢',
        title: 'Naikkan budget',
        reason: `ROAS naik ke ${metricsLast.roas.toFixed(2)}x (target ${target.target_roas}x), margin setelah iklan sehat ${fmtRupiahSigned(marginLast)} → peluang scale up.`,
      });
    }
  }

  // Rule 4: klik tinggi, konversi rendah/0 - kemungkinan masalah listing/harga.
  if (last.klik >= KLIK_TINGGI_THRESHOLD && metricsLast.cr < CR_RENDAH_PERSEN) {
    candidates.push({
      level: 'cek-listing',
      icon: '⚠️',
      title: 'Cek listing/harga (bukan masalah iklan)',
      reason: `${last.klik.toLocaleString()} klik tapi cuma ${last.produk_terjual.toLocaleString()} terkonversi (CR ${metricsLast.cr.toFixed(1)}%) → kemungkinan masalah di listing/harga, bukan di iklannya.`,
    });
  }

  // Rule 5: impresi rendah, biaya kecil - iklan kurang mendapat exposure.
  if (last.impresi < IMPRESI_RENDAH_THRESHOLD && last.biaya < BIAYA_KECIL_THRESHOLD) {
    candidates.push({
      level: 'kurang-exposure',
      icon: 'ℹ️',
      title: 'Kurang exposure, pertimbangkan naikkan bid',
      reason: `Impresi cuma ${last.impresi.toLocaleString()} dan biaya masih kecil (Rp ${last.biaya.toLocaleString()}) → jangkauan iklan ini masih terbatas.`,
    });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => PRIORITY.indexOf(a.level) - PRIORITY.indexOf(b.level));
  return candidates[0];
};
