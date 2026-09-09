import { IklanMingguan, IklanProdukMapping, Product } from '../../types';

// Rumus metrik & margin dipusatkan di sini supaya dashboard, halaman per-produk,
// dan rule engine rekomendasi (fase berikutnya) semuanya membaca angka yang
// sama persis - tidak ada risiko drift rumus antar tempat seperti yang beberapa
// kali terjadi di fitur lain aplikasi ini.

export interface AdsAggregate {
  biaya: number;
  impresi: number;
  klik: number;
  produk_terjual: number;
  omzet: number;
}

export const sumAdsRows = (rows: AdsAggregate[]): AdsAggregate =>
  rows.reduce(
    (acc, r) => ({
      biaya: acc.biaya + (r.biaya || 0),
      impresi: acc.impresi + (r.impresi || 0),
      klik: acc.klik + (r.klik || 0),
      produk_terjual: acc.produk_terjual + (r.produk_terjual || 0),
      omzet: acc.omzet + (r.omzet || 0),
    }),
    { biaya: 0, impresi: 0, klik: 0, produk_terjual: 0, omzet: 0 }
  );

export interface AdsMetrics {
  ctr: number; // %
  cr: number; // % dari klik
  roas: number; // x
  acos: number; // %
  cpc: number; // Rp
}

export const calcAdsMetrics = (row: AdsAggregate): AdsMetrics => ({
  ctr: row.impresi > 0 ? (row.klik / row.impresi) * 100 : 0,
  cr: row.klik > 0 ? (row.produk_terjual / row.klik) * 100 : 0,
  roas: row.biaya > 0 ? row.omzet / row.biaya : 0,
  acos: row.omzet > 0 ? (row.biaya / row.omzet) * 100 : 0,
  cpc: row.klik > 0 ? row.biaya / row.klik : 0,
});

// Biaya di file export Shopee Ads Manager tidak termasuk PPN 11% - biaya yang
// benar-benar keluar dari saldo lebih tinggi dari angka yang diupload. Dipakai
// lewat toggle per toko (iklan_kpi_target.biaya_termasuk_ppn) supaya seller
// yang datanya kebetulan sudah termasuk PPN tidak salah dihitung dobel.
export const PPN_IKLAN_RATE = 0.11;

export const applyPpnAdjustment = (agg: AdsAggregate, biayaTermasukPpn: boolean): AdsAggregate =>
  biayaTermasukPpn ? agg : { ...agg, biaya: agg.biaya * (1 + PPN_IKLAN_RATE) };

export type HppSource = 'master' | 'manual' | 'none';

export interface HppResolution {
  value: number | null;
  source: HppSource;
  masterValue: number | null;
  berbedaDariMaster: boolean;
}

// Logika HPP opsional & fleksibel (spec modul iklan, bagian 3):
// override manual > Master Produk > tidak ada sama sekali.
export const resolveHpp = (
  mapping: Pick<IklanProdukMapping, 'hpp_override'> | null | undefined,
  masterProduct: Pick<Product, 'cost_price'> | null | undefined
): HppResolution => {
  const masterValue = masterProduct && masterProduct.cost_price > 0 ? masterProduct.cost_price : null;
  const override = mapping?.hpp_override ?? null;

  if (override !== null) {
    return {
      value: override,
      source: 'manual',
      masterValue,
      berbedaDariMaster: masterValue !== null && override !== masterValue,
    };
  }
  if (masterValue !== null) {
    return { value: masterValue, source: 'master', masterValue, berbedaDariMaster: false };
  }
  return { value: null, source: 'none', masterValue: null, berbedaDariMaster: false };
};

export type MarginGapReason = 'hpp-belum-lengkap' | 'belum-ada-penjualan' | null;

export interface MarginResult {
  grossMarginRatio: number | null; // margin kotor (sebelum iklan) sebagai rasio dari omzet, mis. 0.25 = 25%
  bepRoas: number | null; // ROAS titik impas: di bawah ini iklan menggerus margin kotor
  marginSetelahIklan: number | null; // omzet - HPP - biaya proses/admin/operasional - biaya iklan
  gapReason: MarginGapReason;
}

// Margin dihitung langsung dari omzet & unit terjual AKTUAL periode ini (dari
// laporan iklan), bukan dari "harga jual" yang diasumsikan/diketik manual -
// jadi tidak butuh setup harga jual terpisah, dan otomatis mengikuti harga
// jual sesungguhnya termasuk diskon/promo yang sedang berjalan. Hanya HPP
// (dari Master Produk atau override) dan biaya proses/admin%/operasional%
// yang perlu diketahui.
export const calcMargin = (
  hpp: number | null,
  prosesPesanan: number,
  potAdminPersen: number,
  operasionalPersen: number,
  ads: AdsAggregate
): MarginResult => {
  if (hpp === null) {
    return { grossMarginRatio: null, bepRoas: null, marginSetelahIklan: null, gapReason: 'hpp-belum-lengkap' };
  }
  if (ads.omzet <= 0 || ads.produk_terjual <= 0) {
    return { grossMarginRatio: null, bepRoas: null, marginSetelahIklan: null, gapReason: 'belum-ada-penjualan' };
  }

  const hppTotal = hpp * ads.produk_terjual;
  const prosesTotal = prosesPesanan * ads.produk_terjual;
  const potAdminTotal = ads.omzet * (potAdminPersen / 100);
  const operasionalTotal = ads.omzet * (operasionalPersen / 100);
  const grossMarginTotal = ads.omzet - hppTotal - prosesTotal - potAdminTotal - operasionalTotal;
  const grossMarginRatio = grossMarginTotal / ads.omzet;
  const bepRoas = grossMarginRatio > 0 ? 1 / grossMarginRatio : 0;
  const marginSetelahIklan = grossMarginTotal - ads.biaya;

  return { grossMarginRatio, bepRoas, marginSetelahIklan, gapReason: null };
};

export type StatusKesehatan = 'sehat' | 'waspada' | 'perlu-aksi';

// Status badge dashboard (spec bagian 5) berdasarkan ACOS vs target & margin
// setelah iklan - dipakai sebelum rule engine rekomendasi penuh (fase 6) ada.
export const calcStatusKesehatan = (
  acos: number,
  targetAcos: number,
  marginSetelahIklan: number | null
): StatusKesehatan => {
  if (marginSetelahIklan !== null && marginSetelahIklan < 0) return 'perlu-aksi';
  if (acos > targetAcos) return 'waspada';
  return 'sehat';
};

// Kunci komposit store_id+nama_iklan_raw - dua toko berbeda bisa kebetulan
// punya nama iklan yang identik, dan itu bukan iklan yang sama.
export const iklanGroupKey = (row: Pick<IklanMingguan, 'store_id' | 'nama_iklan_raw'>) => `${row.store_id}::${row.nama_iklan_raw}`;

export const groupIklanMingguanByProduk = (rows: IklanMingguan[]): Map<string, IklanMingguan[]> => {
  const map = new Map<string, IklanMingguan[]>();
  rows.forEach(row => {
    const key = iklanGroupKey(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(row);
  });
  return map;
};
