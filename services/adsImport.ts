import * as XLSX from 'xlsx';

// Parser untuk file export Shopee Ads Manager (.xlsx/.csv).
// Dipisah dari komponen React (beda dengan parser lama di AdsCenter.tsx) supaya
// bisa dites langsung tanpa DOM/Supabase, dan dipakai ulang oleh halaman
// "Cocokkan Produk" di fase berikutnya.

export const JENIS_IKLAN_VALUES = ['Iklan Pencarian', 'Iklan Serba Bisa', 'Iklan Toko'] as const;
export type JenisIklan = typeof JENIS_IKLAN_VALUES[number];

export interface AdsImportRow {
  namaIklanRaw: string;
  jenisIklan: JenisIklan | null;
  impresi: number;
  klik: number;
  produkTerjual: number;
  biaya: number;
  omzet: number;
}

export interface ParsedAdsReport {
  periodeMulai: string; // yyyy-MM-dd
  periodeAkhir: string; // yyyy-MM-dd
  rows: AdsImportRow[];
}

const stripQuotes = (s: string) => s.trim().replace(/^["']|["']$/g, '');

const parseNumber = (val: any): number => {
  if (typeof val === 'number') return val;
  if (typeof val !== 'string') return 0;
  const cleaned = stripQuotes(val).replace(/\./g, '').replace(/,/g, '.');
  // Kolom numerik Shopee kadang pakai titik ribuan + koma desimal (format ID);
  // coba parse versi "dibersihkan" itu dulu, fallback ke parseFloat polos
  // kalau hasilnya bukan angka (mis. file sudah pakai titik sebagai desimal).
  const parsedId = parseFloat(cleaned);
  if (!isNaN(parsedId)) return parsedId;
  const parsedPlain = parseFloat(stripQuotes(val));
  return isNaN(parsedPlain) ? 0 : parsedPlain;
};

const toIsoDate = (day: string, month: string, year: string) =>
  `${year.padStart(4, '20')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;

// Coba ekstrak SATU tanggal dari sebuah token teks, menerima beberapa format
// umum yang dipakai Shopee (dan variasi lokal lain).
const extractOneDate = (token: string): string | null => {
  const t = token.trim();
  let m = t.match(/^(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})$/);
  if (m) return toIsoDate(m[3], m[2], m[1]);
  m = t.match(/^(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{4})$/);
  if (m) return toIsoDate(m[1], m[2], m[3]);
  return null;
};

const MONTHS_ID: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', mei: '05', may: '05', jun: '06',
  jul: '07', agu: '08', aug: '08', sep: '09', okt: '10', oct: '10', nov: '11', des: '12', dec: '12',
};

const extractDateWithMonthName = (token: string): string | null => {
  const m = token.trim().match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/);
  if (!m) return null;
  const mon = MONTHS_ID[m[2].toLowerCase().slice(0, 3)];
  if (!mon) return null;
  return toIsoDate(m[1], mon, m[3]);
};

/**
 * Ekstrak rentang tanggal (mulai & akhir) dari string periode bebas, mis.:
 * "2024-03-01 s/d 2024-03-07", "01/03/2024 - 07/03/2024", "1 Mar 2024 - 7 Mar 2024".
 * Kalau cuma ketemu satu tanggal, anggap laporan mingguan (akhir = mulai + 6 hari).
 * Kalau tidak ketemu sama sekali, kembalikan null (biar caller pakai fallback lain).
 */
export const parsePeriodeRange = (periodeText: string): { start: string; end: string } | null => {
  const cleaned = stripQuotes(periodeText);
  // Pisah dua sisi rentang dengan delimiter umum: "s/d", "sampai", "-", "–", "to"
  const parts = cleaned.split(/\s+s\/d\s+|\s+sampai\s+|\s+to\s+|\s*[-–]\s*/i).map(p => p.trim()).filter(Boolean);

  const tryParse = (s: string) => extractOneDate(s) || extractDateWithMonthName(s);

  if (parts.length >= 2) {
    const start = tryParse(parts[0]);
    const end = tryParse(parts[parts.length - 1]);
    if (start && end) return { start, end };
  }

  const single = tryParse(cleaned);
  if (single) {
    const startDate = new Date(single + 'T00:00:00');
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 6);
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { start: single, end: fmt(endDate) };
  }

  return null;
};

const splitCsvLine = (str: string, delimiter: string): string[] => {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
};

// Kandidat nama kolom per field - Shopee sesekali mengganti label kolom antar
// versi export, jadi tiap field dicoba beberapa alias sebelum dianggap tidak ada.
const HEADER_ALIASES: Record<string, string[]> = {
  namaIklan: ['Nama Iklan', 'Nama Produk'],
  jenisIklan: ['Jenis Iklan', 'Tipe Iklan', 'Ad Type'],
  impresi: ['Dilihat', 'Jumlah Dilihat', 'Impresi', 'Impressions'],
  klik: ['Jumlah Klik', 'Klik', 'Clicks'],
  konversi: ['Konversi', 'Jumlah Konversi', 'Produk Terjual', 'Pesanan'],
  biaya: ['Biaya', 'Biaya Iklan'],
  omzet: ['Omzet Penjualan', 'Penjualan dari Iklan', 'Omzet'],
  reportDate: ['Tanggal Laporan'],
};

const findColIndex = (headers: any[], aliases: string[]): number => {
  for (const alias of aliases) {
    const idx = headers.findIndex(h => typeof h === 'string' && stripQuotes(h) === alias);
    if (idx !== -1) return idx;
  }
  return -1;
};

const normalizeJenisIklan = (raw: string): JenisIklan | null => {
  const v = stripQuotes(raw);
  const match = JENIS_IKLAN_VALUES.find(j => j.toLowerCase() === v.toLowerCase());
  return match || null;
};

/**
 * Parse file export Shopee Ads Manager (dibaca sebagai ArrayBuffer) menjadi
 * baris-baris siap simpan ke tabel iklan_mingguan. Melempar Error dengan pesan
 * yang jelas kalau format file tidak dikenali, supaya UI bisa tampilkan
 * toast.error(err.message) langsung.
 */
export const parseAdsManagerFile = (buffer: ArrayBuffer): ParsedAdsReport => {
  const wb = XLSX.read(buffer, { type: 'array' });
  const wsname = wb.SheetNames[0];
  const ws = wb.Sheets[wsname];
  const rawData = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1 });

  let periodeText = '';
  let reportDate: string | null = null;
  let headerRowIndex = -1;

  for (let i = 0; i < Math.min(20, rawData.length); i++) {
    const row = rawData[i];
    if (!row || row.length === 0) continue;

    const firstCellRaw = typeof row[0] === 'string' ? row[0] : String(row[0] || '');
    const firstCell = stripQuotes(firstCellRaw);
    const firstCellLower = firstCell.toLowerCase();

    if (firstCellLower === 'periode') {
      periodeText = row[1] ? stripQuotes(String(row[1])) : '';
    } else if (firstCellLower.startsWith('periode')) {
      const delimiter = firstCell.includes(';') ? ';' : firstCell.includes(',') ? ',' : ':';
      const parts = firstCell.split(delimiter);
      if (parts.length > 1) periodeText = stripQuotes(parts.slice(1).join(delimiter) || '');
    }

    if (row.some(cell => typeof cell === 'string' && HEADER_ALIASES.namaIklan.includes(stripQuotes(cell)))) {
      headerRowIndex = i;
    }
  }

  if (!periodeText) {
    throw new Error("Format file tidak valid: Kolom 'Periode' tidak ditemukan di 20 baris pertama.");
  }
  if (headerRowIndex === -1) {
    throw new Error("Format file tidak valid: Header tabel iklan (kolom 'Nama Iklan') tidak ditemukan.");
  }

  let headers = rawData[headerRowIndex];
  let dataRows = rawData.slice(headerRowIndex + 1);

  // CSV yang ke-parse jadi satu kolom string tunggal (mis. dari file .csv
  // dengan delimiter yang tidak dikenali XLSX) perlu dipecah manual dulu.
  if (headers.length === 1 && typeof headers[0] === 'string' && (headers[0].includes(',') || headers[0].includes(';'))) {
    const delimiter = headers[0].includes(';') ? ';' : ',';
    headers = splitCsvLine(headers[0], delimiter);
    dataRows = dataRows.map(r => (r.length === 1 && typeof r[0] === 'string' ? splitCsvLine(r[0], delimiter) : r));
  }

  const idx = {
    namaIklan: findColIndex(headers, HEADER_ALIASES.namaIklan),
    jenisIklan: findColIndex(headers, HEADER_ALIASES.jenisIklan),
    impresi: findColIndex(headers, HEADER_ALIASES.impresi),
    klik: findColIndex(headers, HEADER_ALIASES.klik),
    konversi: findColIndex(headers, HEADER_ALIASES.konversi),
    biaya: findColIndex(headers, HEADER_ALIASES.biaya),
    omzet: findColIndex(headers, HEADER_ALIASES.omzet),
    reportDate: findColIndex(headers, HEADER_ALIASES.reportDate),
  };

  if (idx.namaIklan === -1 || idx.impresi === -1 || idx.klik === -1 || idx.biaya === -1 || idx.omzet === -1) {
    throw new Error("Format file tidak valid: kolom Nama Iklan/Dilihat/Jumlah Klik/Biaya/Omzet Penjualan tidak lengkap.");
  }

  const rowsByName = new Map<string, AdsImportRow>();

  dataRows.forEach(row => {
    if (!row || row.length === 0 || !row[idx.namaIklan]) return;
    const namaIklanRaw = stripQuotes(String(row[idx.namaIklan]));
    if (!namaIklanRaw) return;

    if (idx.reportDate !== -1 && row[idx.reportDate] && !reportDate) {
      reportDate = extractOneDate(stripQuotes(String(row[idx.reportDate])));
    }

    const jenisIklan = idx.jenisIklan !== -1 && row[idx.jenisIklan]
      ? normalizeJenisIklan(String(row[idx.jenisIklan]))
      : null;

    if (!rowsByName.has(namaIklanRaw)) {
      rowsByName.set(namaIklanRaw, {
        namaIklanRaw,
        jenisIklan,
        impresi: 0, klik: 0, produkTerjual: 0, biaya: 0, omzet: 0,
      });
    }
    const acc = rowsByName.get(namaIklanRaw)!;
    acc.impresi += parseNumber(row[idx.impresi]);
    acc.klik += parseNumber(row[idx.klik]);
    acc.produkTerjual += idx.konversi !== -1 ? parseNumber(row[idx.konversi]) : 0;
    acc.biaya += parseNumber(row[idx.biaya]);
    acc.omzet += parseNumber(row[idx.omzet]);
    if (!acc.jenisIklan && jenisIklan) acc.jenisIklan = jenisIklan;
  });

  if (rowsByName.size === 0) {
    throw new Error("Tidak ada baris data iklan yang bisa dibaca dari file ini.");
  }

  const range = parsePeriodeRange(periodeText) || (reportDate ? parsePeriodeRange(reportDate) : null);
  if (!range) {
    throw new Error(`Format file tidak valid: rentang tanggal pada "Periode: ${periodeText}" tidak bisa dibaca.`);
  }

  return {
    periodeMulai: range.start,
    periodeAkhir: range.end,
    rows: Array.from(rowsByName.values()),
  };
};
