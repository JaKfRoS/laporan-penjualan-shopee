import { z } from 'zod';

// Define the schema based on the raw CSV structure
export const ShopeeRawReportSchema = z.object({
  'No. Pesanan': z.string(),
  'Waktu Pesanan Dibuat': z.string(),
  'Harga Asli Produk': z.number(),
  'Total Diskon Produk': z.number(),
  'Biaya Administrasi': z.number(),
  'Biaya Komisi AMS': z.number(),
  'Biaya Layanan': z.number(),
  'Biaya Proses Pesanan': z.number(),
  'Premi': z.number(),
  'Ongkir yang Diteruskan oleh Shopee ke Jasa Kirim': z.number(),
  'Ongkos Kirim Pengembalian Barang': z.number(),
  'Voucher disponsor oleh Penjual': z.number(),
  'Jumlah Pengembalian Dana ke Pembeli': z.number(),
  'Gratis Ongkir dari Shopee': z.number(),
  'Biaya Transaksi': z.number().optional().default(0),
});

export type ShopeeRawReport = z.infer<typeof ShopeeRawReportSchema>;

export interface FeeBreakdown {
  totalPotongan: number;
  components: {
    adminFee: number;
    amsFee: number;
    serviceFee: number;
    procFee: number;
    premFee: number;
    shippingForwarded: number;
    returnShippingFee: number;
    sellerVoucher: number;
    refundAmount: number;
    transactionFee: number;
    shippingRebate: number;
  };
  formula: string;
}

export const calculateMarketplaceFee = (data: ShopeeRawReport): FeeBreakdown => {
  const adminFee = Math.abs(data['Biaya Administrasi'] || 0);
  const amsFee = Math.abs(data['Biaya Komisi AMS'] || 0);
  const serviceFee = Math.abs(data['Biaya Layanan'] || 0);
  const procFee = Math.abs(data['Biaya Proses Pesanan'] || 0);
  const premFee = Math.abs(data['Premi'] || 0);
  const shippingForwarded = Math.abs(data['Ongkir yang Diteruskan oleh Shopee ke Jasa Kirim'] || 0);
  const returnShippingFee = Math.abs(data['Ongkos Kirim Pengembalian Barang'] || 0);
  const sellerVoucher = Math.abs(data['Voucher disponsor oleh Penjual'] || 0);
  const refundAmount = Math.abs(data['Jumlah Pengembalian Dana ke Pembeli'] || 0);
  const transactionFee = Math.abs(data['Biaya Transaksi'] || 0);
  const shippingRebate = Math.abs(data['Gratis Ongkir dari Shopee'] || 0);

  // Formula as requested by user
  const totalPotongan = adminFee + amsFee + serviceFee + shippingRebate + refundAmount + shippingForwarded + returnShippingFee + premFee + sellerVoucher;

  return {
    totalPotongan,
    components: {
      adminFee,
      amsFee,
      serviceFee,
      procFee,
      premFee,
      shippingForwarded,
      returnShippingFee,
      sellerVoucher,
      refundAmount,
      transactionFee,
      shippingRebate,
    },
    formula: 'adminFee + amsFee + serviceFee + shippingRebate + refundAmount + shippingForwarded + returnShippingFee + premFee + sellerVoucher'
  };
};
