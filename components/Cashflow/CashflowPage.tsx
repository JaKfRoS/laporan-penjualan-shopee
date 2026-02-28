import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../services/supabase';
import { Store, Order } from '../../types';
import { DateRangePicker } from '../Dashboard/DateRangePicker';
import { Loader2, FileText, Wallet, Upload, Plus, Trash2, Save, CheckCircle2, AlertCircle } from 'lucide-react';
import { toast } from 'react-hot-toast';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format } from 'date-fns';

interface CashflowPageProps {
  store: Store;
  allStores?: Store[];
}

interface ManualTransaction {
  id?: string;
  storeId: string;
  storeName?: string;
  date: string;
  category: string;
  amount: number;
  description: string;
  affectOmzet: boolean;
}

export const CashflowPage: React.FC<CashflowPageProps> = ({ store, allStores }) => {
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [activeTab, setActiveTab] = useState<'summary' | 'upload' | 'manual'>('summary');
  
  // Metrics
  const [netRevenueSelesai, setNetRevenueSelesai] = useState(0);
  const [totalHPPSelesai, setTotalHPPSelesai] = useState(0);
  const [adsTotal, setAdsTotal] = useState(0);
  const [withdrawalsTotal, setWithdrawalsTotal] = useState(0);
  const [escrowBalance, setEscrowBalance] = useState(0);
  const [manualTransactions, setManualTransactions] = useState<ManualTransaction[]>([]);
  const [allOrders, setAllOrders] = useState<Order[]>([]);
  
  // Form State
  const [txType, setTxType] = useState<'income' | 'expense'>('expense');
  const [newTx, setNewTx] = useState<ManualTransaction>({
    storeId: store.id,
    date: new Date().toISOString().split('T')[0],
    category: 'Operasional',
    amount: 0,
    description: '',
    affectOmzet: false
  });

  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setNewTx(prev => ({ ...prev, storeId: store.id }));
    fetchData();
    fetchManualTransactions();
    return () => {
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, [store, dateRange]);

  const fetchData = async () => {
    if (abortControllerRef.current) abortControllerRef.current.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);

    try {
      let query = supabase
        .from('orders')
        .select('*, order_items(*)')
        .order('release_date', { ascending: false });

      if (store.id === 'all') {
        if (allStores && allStores.length > 0) {
           const storeIds = allStores.map(s => s.id);
           query = query.in('store_id', storeIds);
        } else {
           setNetRevenueSelesai(0);
           setTotalHPPSelesai(0);
           setLoading(false);
           return;
        }
      } else {
        query = query.eq('store_id', store.id);
      }

      // Filter by Release Date (Cashflow Basis)
      if (dateRange.start) {
        query = query.gte('release_date', `${dateRange.start}T00:00:00`);
      }
      if (dateRange.end) {
        query = query.lte('release_date', `${dateRange.end}T23:59:59`);
      }

      const { data, error } = await query;
      
      if (controller.signal.aborted) return;
      if (error) throw error;

      const orders = data || [];
      setAllOrders(orders);
      
      // Calculate Metrics
      // 1. Filter Settled Orders
      const settledOrders = orders.filter(o => {
        const s = (o.status || '').toLowerCase();
        return s === 'selesai' || s === 'pengembalian';
      });

      // 2. Net Revenue (Uang Cair)
      const revenue = settledOrders.reduce((acc, o) => acc + (o.net_revenue || 0), 0);
      
      // 3. Total HPP
      const hpp = settledOrders.reduce((acc, o) => {
        const isReturned = (o.status || '').toLowerCase().includes('pengembalian') || (o.status || '').toLowerCase().includes('retur');
        if (isReturned) return acc;

        const orderHpp = o.order_items?.reduce((h: number, item: any) => {
          return h + ((item.hpp_at_time || 0) * item.quantity);
        }, 0) || 0;
        return acc + orderHpp;
      }, 0);

      setNetRevenueSelesai(revenue);
      setTotalHPPSelesai(hpp);

    } catch (err: any) {
      if (err.name !== 'AbortError') {
        toast.error('Gagal memuat data: ' + err.message);
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  };

  const fetchManualTransactions = async () => {
    try {
      let query = supabase
        .from('adjustments')
        .select('*');

      if (store.id === 'all' && allStores) {
        query = query.in('store_id', allStores.map(s => s.id));
      } else {
        query = query.eq('store_id', store.id);
      }

      // Filter by Date Range if set
      if (dateRange.start) {
        query = query.gte('adjustment_date', dateRange.start);
      }
      if (dateRange.end) {
        query = query.lte('adjustment_date', dateRange.end);
      }

      const { data, error } = await query;

      if (error) throw error;

      let latestBalance = 0;
      let latestBalanceDate = '';

      const parsed = data.map((item: any) => {
        const reason = item.reason || '';
        const categoryMatch = reason.match(/Category: ([^|]+)/);
        const descMatch = reason.match(/Desc: (.*)/);
        
        let category = 'General';
        let description = reason;

        if (reason.includes('[MANUAL_EXPENSE]')) {
           category = categoryMatch ? categoryMatch[1].trim() : 'General';
           description = descMatch ? descMatch[1].trim() : reason.replace('[MANUAL_EXPENSE]', '').trim();
        } else if (reason.includes('[AUTO_UPLOAD]')) {
           const typeMatch = reason.match(/Type: ([^|]+)/);
           const type = typeMatch ? typeMatch[1].trim() : '';
           
           if (type === 'Income') category = 'Penghasilan dari Pesanan';
           else if (type === 'Ads') category = 'Iklan Shopee';
           else if (type === 'Withdrawal') category = 'Penarikan Dana';
           else category = 'Transaksi Shopee Otomatis';

           description = descMatch ? descMatch[1].trim() : reason.replace('[AUTO_UPLOAD]', '').trim();
        } else if (reason.includes('[BALANCE_SNAPSHOT]')) {
           const balMatch = reason.match(/Balance: ([\d.-]+)/);
           if (balMatch) {
              const bal = parseFloat(balMatch[1]);
              if (!latestBalanceDate || item.adjustment_date >= latestBalanceDate) {
                 latestBalance = bal;
                 latestBalanceDate = item.adjustment_date;
              }
           }
           return null; // Exclude from transactions list
        } else {
           // Other types of adjustments (e.g. from orders table)
           if (reason.toLowerCase().includes('iklan') || reason.toLowerCase().includes('ads')) {
              category = 'Isi Ulang Saldo Iklan/Koin Penjual';
           }
        }
        
        const storeInfo = allStores?.find(s => s.id === item.store_id);

        return {
          id: item.id,
          storeId: item.store_id,
          storeName: storeInfo?.name || 'Unknown Store',
          date: item.adjustment_date,
          amount: item.amount, // Keep original sign
          category,
          description,
          affectOmzet: false
        };
      }).filter(Boolean) as ManualTransaction[];

      // Update summary metrics based on fetched data
      const ads = parsed
        .filter(tx => tx.category === 'Iklan Shopee')
        .reduce((acc, tx) => acc + Math.abs(tx.amount), 0);
      
      const withdrawals = parsed
        .filter(tx => tx.category === 'Penarikan Dana')
        .reduce((acc, tx) => acc + Math.abs(tx.amount), 0);
      
      setAdsTotal(ads);
      setWithdrawalsTotal(withdrawals);
      setManualTransactions(parsed);
      if (latestBalanceDate) {
         setEscrowBalance(latestBalance);
      }
    } catch (err) {
      console.error("Error fetching transactions:", err);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const bstr = evt.target?.result;
      const wb = XLSX.read(bstr, { type: 'binary' });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];

      parseBalanceReport(data);
    };
    reader.readAsBinaryString(file);
  };

  const parseBalanceReport = async (rows: any[][]) => {
    let totalAds = 0;
    let lastBalance = 0;
    let balanceFound = false;
    let foundHeader = false;
    let balanceColIdx = -1;
    let amountColIdx = -1;
    let descColIdx = -1;
    let dateColIdx = -1;
    let orderIdColIdx = -1;
    let latestDate = '';
    
    const transactionsToSave: any[] = [];

    const parseShopeeNumber = (val: any) => {
      if (val === undefined || val === null) return 0;
      if (typeof val === 'number') return val;
      let s = String(val).trim();
      if (!s) return 0;
      
      // Remove currency symbols and spaces
      s = s.replace(/[Rp\s]/g, '');

      // Handle IDR style: 1.234.567,89 -> remove dots, replace comma with dot
      // Check if it has both dot and comma
      if (s.includes('.') && s.includes(',')) {
        if (s.lastIndexOf('.') < s.lastIndexOf(',')) {
          // 1.234.567,89
          s = s.replace(/\./g, '').replace(',', '.');
        } else {
          // 1,234,567.89
          s = s.replace(/,/g, '');
        }
      } else if (s.includes(',')) {
        // Could be 1.234 (thousands) or 1,234 (decimal)
        // In Shopee ID, comma is usually decimal. 
        // But if it's 1.234.567, it's thousands.
        const parts = s.split(',');
        if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
          s = s.replace(/,/g, '');
        } else {
          s = s.replace(',', '.');
        }
      } else if (s.includes('.')) {
        // Could be 1.234 (thousands) or 1.23 (decimal)
        const parts = s.split('.');
        if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
          s = s.replace(/\./g, '');
        }
      }
      
      return parseFloat(s);
    };

    // Sort rows by date if possible to ensure we get the LATEST balance first
    // But usually the CSV is already sorted descending. 
    // Let's just process and keep track of the first valid balance we find.

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      if (!foundHeader) {
        const rowStr = row.join(' ').toLowerCase();
        // Detect header row based on common Shopee columns
        if (rowStr.includes('tanggal') && rowStr.includes('deskripsi') && (rowStr.includes('jumlah') || rowStr.includes('amount'))) {
            foundHeader = true;
            row.forEach((cell: any, idx: number) => {
                const c = String(cell).toLowerCase();
                if (c.includes('saldo') && !c.includes('awal')) balanceColIdx = idx;
                if (c === 'jumlah' || c === 'amount' || (c.includes('jumlah') && !c.includes('transaksi'))) amountColIdx = idx;
                if (c.includes('deskripsi') || c.includes('description')) descColIdx = idx;
                if (c.includes('tanggal') || c.includes('date')) dateColIdx = idx;
                if (c.includes('pesanan') || c.includes('order')) orderIdColIdx = idx;
            });
            continue;
        }
      }

      if (foundHeader && amountColIdx !== -1 && descColIdx !== -1) {
          const desc = String(row[descColIdx] || '').toLowerCase();
          const amount = parseShopeeNumber(row[amountColIdx]);
          const dateStr = row[dateColIdx];
          const orderNo = orderIdColIdx !== -1 ? String(row[orderIdColIdx] || '-') : '-';
          
          if (isNaN(amount) || !dateStr) continue;

          // Robust Date Parsing
          let formattedDate = '';
          const datePart = String(dateStr).split(' ')[0];
          const parts = datePart.split(/[-/]/);
          
          if (parts.length === 3) {
              if (parts[0].length === 4) {
                  formattedDate = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
              } else if (parts[2].length === 4) {
                  formattedDate = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
              }
          }

          if (!formattedDate) {
              const d = new Date(dateStr);
              if (!isNaN(d.getTime())) {
                  const y = d.getFullYear();
                  const m = String(d.getMonth() + 1).padStart(2, '0');
                  const day = String(d.getDate()).padStart(2, '0');
                  formattedDate = `${y}-${m}-${day}`;
              } else {
                  continue;
              }
          }

          if (!latestDate || formattedDate > latestDate) {
             latestDate = formattedDate;
          }

          const isAds = desc.includes('iklan') || 
                        desc.includes('ads') || 
                        desc.includes('top up') || 
                        desc.includes('isi ulang') ||
                        desc.includes('spend') ||
                        desc.includes('biaya');
          
          const isWithdrawal = desc.includes('penarikan') || desc.includes('withdrawal');
          const isIncome = desc.includes('penghasilan') || desc.includes('income') || desc.includes('order');

          let type = 'Other';
          if (isAds) type = 'Ads';
          else if (isWithdrawal) type = 'Withdrawal';
          else if (isIncome) type = 'Income';

          if (isAds || isWithdrawal || isIncome) {
              if (isAds) totalAds += Math.abs(amount);
              
              const uniqueId = orderNo !== '-' ? orderNo : `UPLOAD-${formattedDate}-${Math.abs(amount)}-${i}`;
              const originalDesc = String(row[descColIdx]);

              transactionsToSave.push({
                  store_id: store.id,
                  adjustment_date: formattedDate,
                  amount: amount,
                  reason: `[AUTO_UPLOAD] Type: ${type} | Desc: ${originalDesc}`,
                  order_id: uniqueId
              });
          }

          // Get the latest balance (first row after header assuming descending order)
          if (balanceColIdx !== -1 && !balanceFound) {
              const bal = parseShopeeNumber(row[balanceColIdx]);
              if (!isNaN(bal)) {
                 lastBalance = bal;
                 balanceFound = true;
              }
          }
      }
    }

    setAdsTotal(totalAds);
    setEscrowBalance(lastBalance);
    
    if (balanceFound && latestDate) {
       // Persist balance snapshot
       transactionsToSave.push({
          store_id: store.id,
          adjustment_date: latestDate,
          amount: 0,
          reason: `[BALANCE_SNAPSHOT] Balance: ${lastBalance}`,
          order_id: `BAL-SNAP-${latestDate}`
       });
    }

    if (transactionsToSave.length > 0) {
        await saveUploadedTransactions(transactionsToSave);
    } else {
        toast.success(`Berhasil memproses! Ditemukan Biaya Iklan: Rp ${totalAds.toLocaleString()}`);
    }
  };

  const saveUploadedTransactions = async (transactions: any[]) => {
      const toastId = toast.loading('Menyimpan data ke database...');
      try {
          // Use upsert to handle duplicates based on unique constraint (store_id, order_id, adjustment_date, amount)
          const { error } = await supabase
              .from('adjustments')
              .upsert(transactions, { onConflict: 'store_id, order_id, adjustment_date, amount' });
          
          if (error) throw error;
          
          toast.success(`Berhasil menyimpan ${transactions.length} transaksi iklan!`, { id: toastId });
          fetchManualTransactions(); // Refresh list
      } catch (err: any) {
          console.error(err);
          toast.error("Gagal menyimpan data: " + err.message, { id: toastId });
      }
  };

  const saveManualTransaction = async () => {
    if (!newTx.amount || !newTx.description) {
      toast.error("Mohon lengkapi data transaksi");
      return;
    }

    try {
      const reasonStr = `[MANUAL_EXPENSE] Category: ${newTx.category} | Desc: ${newTx.description}`;
      // Apply sign based on txType
      const finalAmount = txType === 'expense' ? -Math.abs(newTx.amount) : Math.abs(newTx.amount);

      const { error } = await supabase.from('adjustments').insert({
        store_id: store.id,
        adjustment_date: newTx.date,
        amount: finalAmount,
        reason: reasonStr,
        order_id: `MANUAL-${Date.now()}`
      });

      if (error) throw error;

      toast.success("Transaksi berhasil disimpan");
      fetchManualTransactions();
      setNewTx({ ...newTx, amount: 0, description: '' });
    } catch (err: any) {
      toast.error("Gagal menyimpan: " + err.message);
    }
  };

  const deleteTransaction = async (id: string) => {
    try {
      const { error } = await supabase.from('adjustments').delete().eq('id', id);
      if (error) throw error;
      toast.success("Transaksi dihapus");
      fetchManualTransactions();
    } catch (err: any) {
      toast.error("Gagal menghapus: " + err.message);
    }
  };

  const deleteUploadedData = async () => {
    if (store.id === 'all') return;
    
    if (!confirm('Apakah Anda yakin ingin menghapus semua data biaya iklan hasil upload untuk toko ini?')) {
      return;
    }

    const toastId = toast.loading('Menghapus data...');
    try {
      const { error } = await supabase
        .from('adjustments')
        .delete()
        .eq('store_id', store.id)
        .ilike('reason', '%[AUTO_UPLOAD]%');

      if (error) throw error;

      toast.success("Data upload berhasil dihapus", { id: toastId });
      fetchManualTransactions();
    } catch (err: any) {
      toast.error("Gagal menghapus data: " + err.message, { id: toastId });
    }
  };

  const totalManualExpenses = manualTransactions
    .filter(tx => tx.category !== 'Penghasilan dari Pesanan' && tx.category !== 'Iklan Shopee' && tx.category !== 'Penarikan Dana')
    .reduce((acc, tx) => acc + tx.amount, 0);
  
  const labaBersihRiil = netRevenueSelesai - adsTotal + totalManualExpenses - totalHPPSelesai;

  const generatePDF = () => {
    const doc = new jsPDF();
    const isAllStores = store.id === 'all';
    
    doc.setFontSize(18);
    doc.text(isAllStores ? "Laporan Konsolidasi Arus Kas (Semua Toko)" : `Laporan Audit Arus Kas - ${store.name}`, 14, 20);
    doc.setFontSize(10);
    doc.text(`Periode: ${dateRange.start || '-'} s/d ${dateRange.end || '-'}`, 14, 28);
    doc.text(`Tanggal Cetak: ${new Date().toLocaleString('id-ID')}`, 14, 34);

    const tableBody = [
      ['1. Total Dana Masuk (Penghasilan Pesanan)', `Rp ${netRevenueSelesai.toLocaleString()}`, 'Dari Laporan Income Shopee'],
      ['2. Total Potongan Saldo (Iklan/Koin)', `(Rp ${adsTotal.toLocaleString()})`, 'Dari Laporan Saldo (Topup Iklan)'],
      ['3. Total Penarikan Dana (Withdrawal)', `(Rp ${withdrawalsTotal.toLocaleString()})`, 'Dana yang sudah masuk rekening'],
      ['4. Total Penyesuaian Manual', `${totalManualExpenses < 0 ? '-' : '+'}Rp ${Math.abs(totalManualExpenses).toLocaleString()}`, 'Input Manual (Biaya/Pemasukan)'],
      ['5. Total HPP (Modal Produk)', `(Rp ${totalHPPSelesai.toLocaleString()})`, 'Dari Master Produk'],
      ['LABA BERSIH RIIL', `Rp ${labaBersihRiil.toLocaleString()}`, 'Net Profit Final'],
    ];

    autoTable(doc, {
      startY: 45,
      head: [['Komponen', 'Nilai', 'Keterangan']],
      body: tableBody,
      theme: 'grid',
      headStyles: { fillColor: [41, 128, 185] },
      columnStyles: {
        1: { halign: 'right', fontStyle: 'bold' }
      },
      didParseCell: function(data) {
        if (data.row.index === 5) {
            data.cell.styles.fillColor = [46, 204, 113];
            data.cell.styles.textColor = [255, 255, 255];
            data.cell.styles.fontStyle = 'bold';
        }
      }
    });

    let currentY = (doc as any).lastAutoTable.finalY + 10;
    
    if (!isAllStores) {
      doc.setFontSize(12);
      doc.text(`Total Dana Tersedia (Escrow): Rp ${escrowBalance.toLocaleString()}`, 14, currentY);
      doc.setFontSize(10);
      doc.text("*Saldo mengambang di Shopee yang belum ditarik", 14, currentY + 6);
      currentY += 20;
    }

    // Breakdown Per Toko (Only for All Stores)
    if (isAllStores && allStores) {
      doc.addPage();
      doc.setFontSize(16);
      doc.text("Breakdown Per Toko", 14, 20);
      doc.setFontSize(10);
      doc.text("Ringkasan performa keuangan untuk setiap toko", 14, 28);

      const storeBreakdown = allStores.map(s => {
        const storeOrders = allOrders.filter(o => o.store_id === s.id && (o.status?.toLowerCase() === 'selesai' || o.status?.toLowerCase() === 'pengembalian'));
        const storeRevenue = storeOrders.reduce((acc, o) => acc + (o.net_revenue || 0), 0);
        const storeHpp = storeOrders.reduce((acc, o) => {
          if (o.status?.toLowerCase().includes('pengembalian')) return acc;
          return acc + (o.order_items?.reduce((h: number, item: any) => h + ((item.hpp_at_time || 0) * item.quantity), 0) || 0);
        }, 0);
        
        const storeTxs = manualTransactions.filter(tx => tx.storeId === s.id);
        const storeAds = storeTxs.filter(tx => tx.category === 'Isi Ulang Saldo Iklan/Koin Penjual').reduce((acc, tx) => acc + Math.abs(tx.amount), 0);
        const storeManual = storeTxs.filter(tx => tx.category !== 'Isi Ulang Saldo Iklan/Koin Penjual').reduce((acc, tx) => acc + tx.amount, 0);
        
        const storeProfit = storeRevenue - storeAds + storeManual - storeHpp;

        return [
          s.name,
          `Rp ${storeRevenue.toLocaleString()}`,
          `Rp ${storeAds.toLocaleString()}`,
          `${storeManual < 0 ? '-' : '+'}Rp ${Math.abs(storeManual).toLocaleString()}`,
          `Rp ${storeHpp.toLocaleString()}`,
          `Rp ${storeProfit.toLocaleString()}`
        ];
      });

      autoTable(doc, {
        startY: 35,
        head: [['Toko', 'Revenue', 'Ads', 'Manual', 'HPP', 'Profit']],
        body: storeBreakdown,
        theme: 'grid',
        headStyles: { fillColor: [52, 73, 94] },
        columnStyles: {
          1: { halign: 'right' },
          2: { halign: 'right' },
          3: { halign: 'right' },
          4: { halign: 'right' },
          5: { halign: 'right', fontStyle: 'bold' }
        }
      });
    }

    // Add Detailed Transactions Table (Only for Single Store)
    if (!isAllStores && manualTransactions.length > 0) {
      doc.addPage();
      doc.setFontSize(16);
      doc.text("Rincian Transaksi Penyesuaian", 14, 20);
      doc.setFontSize(10);
      doc.text("Daftar seluruh penyesuaian manual dan biaya iklan hasil upload", 14, 28);

      const detailBody = manualTransactions.map(tx => [
        format(new Date(tx.date), 'dd/MM/yyyy'),
        tx.category,
        tx.description,
        `${tx.amount < 0 ? '-' : '+'}Rp ${Math.abs(tx.amount).toLocaleString()}`
      ]);

      autoTable(doc, {
        startY: 35,
        head: [['Tanggal', 'Kategori', 'Deskripsi', 'Nominal']],
        body: detailBody,
        theme: 'striped',
        headStyles: { fillColor: [52, 73, 94] },
        columnStyles: {
          3: { halign: 'right', fontStyle: 'bold' }
        },
        didParseCell: function(data) {
          if (data.column.index === 3 && data.cell.section === 'body') {
            const val = data.cell.raw as string;
            if (val.startsWith('-')) {
              data.cell.styles.textColor = [192, 57, 43]; // Red for negative
            } else {
              data.cell.styles.textColor = [39, 174, 96]; // Green for positive
            }
          }
        }
      });
    }

    doc.save(`Audit_Cashflow_${new Date().toISOString().split('T')[0]}.pdf`);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header & Controls */}
      <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between gap-4">
        <DateRangePicker onChange={setDateRange} />
        <div className="flex gap-2 w-full xl:w-auto justify-end">
           <button 
             onClick={generatePDF}
             className="flex items-center justify-center gap-2 px-4 py-3 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl font-bold hover:opacity-90 transition-opacity shadow-lg text-xs uppercase w-full sm:w-auto"
           >
             <FileText className="w-4 h-4" />
             Download Laporan PDF
           </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 p-1 flex overflow-x-auto">
        <button 
          onClick={() => setActiveTab('summary')}
          className={`flex-1 py-3 px-4 rounded-xl text-sm font-bold transition-all whitespace-nowrap ${activeTab === 'summary' ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
        >
          Ringkasan Audit
        </button>
        <button 
          onClick={() => setActiveTab('upload')}
          className={`flex-1 py-3 px-4 rounded-xl text-sm font-bold transition-all whitespace-nowrap ${activeTab === 'upload' ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
        >
          Upload Saldo (Iklan)
        </button>
        <button 
          onClick={() => setActiveTab('manual')}
          className={`flex-1 py-3 px-4 rounded-xl text-sm font-bold transition-all whitespace-nowrap ${activeTab === 'manual' ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
        >
          Penyesuaian Manual
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
        </div>
      ) : (
        <div className="space-y-6">
          
          {/* SUMMARY TAB */}
          {activeTab === 'summary' && (
            <div className="space-y-6">
              <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500">
                    <tr>
                      <th className="px-6 py-4 font-medium">Komponen</th>
                      <th className="px-6 py-4 font-medium text-right">Nilai</th>
                      <th className="px-6 py-4 font-medium text-right">Sumber</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                    <tr>
                      <td className="px-6 py-4 font-medium text-slate-900 dark:text-white">1. Total Dana Masuk</td>
                      <td className="px-6 py-4 text-right text-green-600 font-bold">Rp {netRevenueSelesai.toLocaleString()}</td>
                      <td className="px-6 py-4 text-right text-slate-400">Penghasilan Pesanan</td>
                    </tr>
                    <tr>
                      <td className="px-6 py-4 font-medium text-slate-900 dark:text-white">2. Total Potongan Saldo</td>
                      <td className="px-6 py-4 text-right text-red-600 font-bold">-Rp {adsTotal.toLocaleString()}</td>
                      <td className="px-6 py-4 text-right text-slate-400">Iklan/Koin (Upload)</td>
                    </tr>
                    <tr>
                      <td className="px-6 py-4 font-medium text-slate-900 dark:text-white">3. Total Penarikan Dana</td>
                      <td className="px-6 py-4 text-right text-red-600 font-bold">-Rp {withdrawalsTotal.toLocaleString()}</td>
                      <td className="px-6 py-4 text-right text-slate-400">Withdrawal (Upload)</td>
                    </tr>
                    <tr>
                      <td className="px-6 py-4 font-medium text-slate-900 dark:text-white">4. Total Penyesuaian Manual</td>
                      <td className={`px-6 py-4 text-right font-bold ${totalManualExpenses < 0 ? 'text-red-600' : 'text-green-600'}`}>
                        {totalManualExpenses < 0 ? '-' : '+'}Rp {Math.abs(totalManualExpenses).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 text-right text-slate-400">Manual (Biaya/Pemasukan)</td>
                    </tr>
                    <tr>
                      <td className="px-6 py-4 font-medium text-slate-900 dark:text-white">5. Total HPP</td>
                      <td className="px-6 py-4 text-right text-orange-600 font-bold">-Rp {totalHPPSelesai.toLocaleString()}</td>
                      <td className="px-6 py-4 text-right text-slate-400">Modal Produk</td>
                    </tr>
                    <tr className="bg-blue-50/50 dark:bg-blue-900/20">
                      <td className="px-6 py-4 font-black text-blue-700 dark:text-blue-400 text-lg">LABA BERSIH RIIL</td>
                      <td className="px-6 py-4 text-right text-blue-700 dark:text-blue-400 font-black text-lg">Rp {labaBersihRiil.toLocaleString()}</td>
                      <td className="px-6 py-4 text-right text-blue-500 font-medium">Final Profit</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between bg-yellow-50 dark:bg-yellow-900/20 p-6 rounded-xl border border-yellow-100 dark:border-yellow-800">
                 <div className="flex items-center gap-4">
                    <div className="p-3 bg-yellow-100 dark:bg-yellow-900/40 rounded-full">
                       <Wallet className="w-6 h-6 text-yellow-600" />
                    </div>
                    <div>
                      <h4 className="font-bold text-yellow-800 dark:text-yellow-500 text-lg">Total Dana Tersedia (Escrow)</h4>
                      <p className="text-sm text-yellow-600 dark:text-yellow-400">Saldo mengambang di Shopee yang belum ditarik</p>
                    </div>
                 </div>
                 <div className="text-3xl font-black text-yellow-700 dark:text-yellow-400">
                    Rp {escrowBalance.toLocaleString()}
                 </div>
              </div>

              {/* Detailed Transaction List in Summary */}
              <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden mt-6">
                <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
                  <h3 className="font-bold text-slate-900 dark:text-white">Rincian Transaksi Terakhir</h3>
                  <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Kronologis</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500">
                      <tr>
                        <th className="px-6 py-3 font-bold uppercase tracking-wider text-[10px]">Tanggal</th>
                        <th className="px-6 py-3 font-bold uppercase tracking-wider text-[10px]">Kategori</th>
                        <th className="px-6 py-3 font-bold uppercase tracking-wider text-[10px]">Deskripsi</th>
                        <th className="px-6 py-3 font-bold uppercase tracking-wider text-[10px] text-right">Nominal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                      {[...manualTransactions]
                        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                        .slice(0, 20)
                        .map((tx) => (
                        <tr key={tx.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                          <td className="px-6 py-4 font-medium whitespace-nowrap">{format(new Date(tx.date), 'dd/MM/yyyy')}</td>
                          <td className="px-6 py-4">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              tx.category === 'Penghasilan dari Pesanan' ? 'bg-green-100 text-green-700' :
                              tx.category === 'Iklan Shopee' ? 'bg-red-100 text-red-700' :
                              tx.category === 'Penarikan Dana' ? 'bg-blue-100 text-blue-700' :
                              'bg-slate-100 text-slate-700'
                            }`}>
                              {tx.category}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-slate-600 dark:text-slate-400 max-w-xs truncate">{tx.description}</td>
                          <td className={`px-6 py-4 text-right font-bold ${tx.amount < 0 ? 'text-red-600' : 'text-green-600'}`}>
                            {tx.amount < 0 ? '-' : '+'}Rp {Math.abs(tx.amount).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                      {manualTransactions.length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-6 py-12 text-center text-slate-400 italic">
                            Belum ada data transaksi untuk ditampilkan
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* UPLOAD TAB */}
          {activeTab === 'upload' && (
            <div className="space-y-6 max-w-2xl mx-auto text-center py-8">
              {store.id === 'all' ? (
                <div className="bg-white dark:bg-slate-800 p-10 rounded-3xl border-2 border-dashed border-red-300 dark:border-red-900/30">
                   <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
                   <h3 className="text-xl font-bold text-slate-900 dark:text-white">Pilih Toko Spesifik</h3>
                   <p className="text-slate-500 mt-2">Anda harus memilih satu toko spesifik untuk mengupload laporan saldo agar data tidak tercampur.</p>
                </div>
              ) : (
                <div className="bg-white dark:bg-slate-800 p-10 rounded-3xl border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-blue-500 transition-colors cursor-pointer relative group">
                  <input 
                    type="file" 
                    accept=".xlsx, .csv" 
                    onChange={handleFileUpload}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  />
                  <div className="flex flex-col items-center gap-4 group-hover:scale-105 transition-transform">
                    <div className="p-5 bg-blue-50 dark:bg-blue-900/30 rounded-full">
                      <Upload className="w-10 h-10 text-blue-600" />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-slate-900 dark:text-white">Upload Laporan Saldo</h3>
                      <p className="text-slate-500 mt-2">Format Excel/CSV dari Shopee (Rincian Saldo)</p>
                    </div>
                  </div>
                </div>
              )}

              {adsTotal > 0 && (
                <div className="bg-green-50 dark:bg-green-900/20 p-6 rounded-2xl border border-green-100 dark:border-green-800 animate-in fade-in slide-in-from-bottom-4">
                  <h4 className="text-green-800 dark:text-green-400 font-bold mb-4">Hasil Scan File:</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-white dark:bg-slate-900 p-5 rounded-xl shadow-sm">
                      <p className="text-xs text-slate-500 uppercase tracking-wider font-bold">Total Biaya Iklan</p>
                      <p className="text-2xl font-black text-red-600 mt-2">-Rp {adsTotal.toLocaleString()}</p>
                    </div>
                    <div className="bg-white dark:bg-slate-900 p-5 rounded-xl shadow-sm">
                      <p className="text-xs text-slate-500 uppercase tracking-wider font-bold">Saldo Akhir (Escrow)</p>
                      <p className="text-2xl font-black text-slate-900 dark:text-white mt-2">Rp {escrowBalance.toLocaleString()}</p>
                    </div>
                  </div>
                  <p className="text-sm text-green-700 dark:text-green-500 mt-4 flex items-center justify-center gap-2 font-medium">
                    <CheckCircle2 className="w-5 h-5" />
                    Data berhasil disimpan ke database
                  </p>
                </div>
              )}

              {store.id !== 'all' && (
                <div className="mt-12 p-6 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-700">
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-2">Manajemen Data</h4>
                  <p className="text-xs text-slate-500 mb-4">Hapus semua data biaya iklan hasil upload untuk toko ini jika terjadi kesalahan input.</p>
                  <button 
                    onClick={deleteUploadedData}
                    className="flex items-center justify-center gap-2 px-4 py-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-xl hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors text-xs font-bold mx-auto"
                  >
                    <Trash2 className="w-4 h-4" />
                    Hapus Semua Data Upload Toko Ini
                  </button>
                </div>
              )}
            </div>
          )}

          {/* MANUAL TAB */}
          {activeTab === 'manual' && (
            <div className="space-y-6">
              <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
                <h3 className="font-bold text-slate-900 dark:text-white mb-6 flex items-center gap-2 text-lg">
                  <Plus className="w-6 h-6 text-blue-600" />
                  Tambah Penyesuaian Manual
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-2 uppercase tracking-wider">Tanggal</label>
                    <input 
                      type="date" 
                      value={newTx.date}
                      onChange={e => setNewTx({...newTx, date: e.target.value})}
                      className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-transparent font-medium"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-2 uppercase tracking-wider">Tipe Transaksi</label>
                    <div className="flex bg-slate-100 dark:bg-slate-700 rounded-xl p-1">
                        <button 
                            onClick={() => setTxType('expense')}
                            className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${txType === 'expense' ? 'bg-white dark:bg-slate-600 text-red-600 shadow-sm' : 'text-slate-500'}`}
                        >
                            Pengeluaran
                        </button>
                        <button 
                            onClick={() => setTxType('income')}
                            className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${txType === 'income' ? 'bg-white dark:bg-slate-600 text-green-600 shadow-sm' : 'text-slate-500'}`}
                        >
                            Pemasukan
                        </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-2 uppercase tracking-wider">Kategori</label>
                    <select 
                      value={newTx.category}
                      onChange={e => setNewTx({...newTx, category: e.target.value})}
                      className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-transparent font-medium"
                    >
                      <option value="Operasional">Operasional</option>
                      <option value="Isi Ulang Saldo Iklan/Koin Penjual">Isi Ulang Saldo Iklan/Koin Penjual</option>
                      <option value="Gaji">Gaji Karyawan</option>
                      <option value="Packing">Packing Material</option>
                      <option value="Marketing">Marketing Luar</option>
                      <option value="Lainnya">Lainnya</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-2 uppercase tracking-wider">Nominal (Rp)</label>
                    <input 
                      type="number" 
                      value={newTx.amount === 0 ? '' : Math.abs(newTx.amount)}
                      onChange={e => {
                          const val = parseFloat(e.target.value) || 0;
                          setNewTx({...newTx, amount: val});
                      }}
                      className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-transparent font-medium"
                      placeholder="0"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs font-bold text-slate-500 mb-2 uppercase tracking-wider">Deskripsi</label>
                    <input 
                      type="text" 
                      value={newTx.description}
                      onChange={e => setNewTx({...newTx, description: e.target.value})}
                      className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-transparent font-medium"
                      placeholder="Contoh: Transfer bank untuk iklan"
                    />
                  </div>
                </div>
                <div className="mt-6 flex items-center justify-between pt-6 border-t border-slate-100 dark:border-slate-700">
                   <label className="flex items-center gap-3 cursor-pointer group">
                      <input 
                        type="checkbox" 
                        checked={newTx.affectOmzet}
                        onChange={e => setNewTx({...newTx, affectOmzet: e.target.checked})}
                        className="w-5 h-5 rounded text-blue-600 focus:ring-blue-500 border-slate-300"
                      />
                      <span className="text-sm text-slate-600 dark:text-slate-400 font-medium group-hover:text-slate-900 transition-colors">Pengaruhi Omzet Dashboard?</span>
                   </label>
                   {store.id === 'all' ? (
                     <span className="text-xs text-red-500 font-bold bg-red-50 px-3 py-2 rounded-lg">Pilih toko spesifik untuk tambah data</span>
                   ) : (
                     <button 
                        onClick={saveManualTransaction}
                        className="bg-blue-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-blue-700 transition-colors flex items-center gap-2 shadow-lg shadow-blue-500/20"
                     >
                        <Save className="w-5 h-5" />
                        Simpan Transaksi
                     </button>
                   )}
                </div>
              </div>

              <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm">
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500">
                    <tr>
                      <th className="px-6 py-4 font-bold uppercase tracking-wider text-xs">Tanggal</th>
                      {store.id === 'all' && <th className="px-6 py-4 font-bold uppercase tracking-wider text-xs">Toko</th>}
                      <th className="px-6 py-4 font-bold uppercase tracking-wider text-xs">Kategori</th>
                      <th className="px-6 py-4 font-bold uppercase tracking-wider text-xs">Deskripsi</th>
                      <th className="px-6 py-4 font-bold uppercase tracking-wider text-xs text-right">Nominal</th>
                      <th className="px-6 py-4 font-bold uppercase tracking-wider text-xs text-center">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                    {manualTransactions
                      .filter(tx => tx.category !== 'Penghasilan dari Pesanan' && tx.category !== 'Iklan Shopee' && tx.category !== 'Penarikan Dana')
                      .map((tx) => (
                      <tr key={tx.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                        <td className="px-6 py-4 font-medium">{format(new Date(tx.date), 'dd/MM/yyyy')}</td>
                        {store.id === 'all' && (
                          <td className="px-6 py-4">
                            <span className="text-xs font-medium text-slate-500">{tx.storeName}</span>
                          </td>
                        )}
                        <td className="px-6 py-4">
                          <span className="px-3 py-1 bg-slate-100 dark:bg-slate-700 rounded-lg text-xs font-bold text-slate-600 dark:text-slate-300">
                            {tx.category}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-slate-600 dark:text-slate-400">{tx.description}</td>
                        <td className={`px-6 py-4 text-right font-bold ${tx.amount < 0 ? 'text-red-600' : 'text-green-600'}`}>
                          {tx.amount < 0 ? '-' : '+'}Rp {Math.abs(tx.amount).toLocaleString()}
                        </td>
                        <td className="px-6 py-4 text-center">
                          <button 
                            onClick={() => tx.id && deleteTransaction(tx.id)}
                            className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {manualTransactions.filter(tx => tx.category !== 'Penghasilan dari Pesanan' && tx.category !== 'Iklan Shopee' && tx.category !== 'Penarikan Dana').length === 0 && (
                      <tr>
                        <td colSpan={store.id === 'all' ? 6 : 5} className="px-6 py-12 text-center text-slate-400 italic">
                          <div className="flex flex-col items-center gap-2">
                            <AlertCircle className="w-8 h-8 opacity-20" />
                            <p>Belum ada transaksi manual</p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
