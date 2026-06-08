import { safeFetchJson, apiFetch } from '@/utils/api';
import React, { useState, useEffect } from 'react';
import { useToast } from '@/contexts/ToastContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { Landmark, TrendingUp, TrendingDown, DollarSign, Wallet, FileText, ShieldCheck, FileBarChart, Download } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/shared/PageHeader';
import { cn } from '@/lib/utils';
import { motion } from 'motion/react';
import { formatIDR } from '@/lib/utils';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';

export default function Finance() {
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { showToast } = useToast();
  const { user } = useAuth();
  const { t } = useLanguage();

  const fetchAnalytics = async () => {
    setIsLoading(true);
    try {
      const res = await apiFetch('/api/finance/analytics', {}, user?.username);
      if (res.ok) {
        setData(res.data);
      } else {
        showToast("Error fetching finance analytics", "error");
      }
    } catch (err) {
      showToast("Error connecting to server", "error");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const handleExportCSV = () => {
    if (!data?.chartData) return;
    const headers = ['Month', 'Revenue (IDR)', 'COGS (IDR)', 'Gross Margin (IDR)'];
    const rows = data.chartData.map((row: any) => [
       row.name,
       row.revenue,
       row.cogs,
       row.profit
    ]);
    
    const csvContent = [
      headers.join(','),
      ...rows.map((e: any[]) => e.join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `General_Ledger_Export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("Export successful!", "success");
  };

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center h-[50vh]">
        <div className="w-8 h-8 border-4 border-stone-200 border-t-stone-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  const { total_billed, total_received, total_receivable, total_cogs, gross_margin, chartData } = data;
  const isProfitable = gross_margin >= 0;

  return (
    <div className="space-y-8 pb-20 animate-in fade-in duration-500">
      <PageHeader
        title={t("Financial Hub")}
        subtitle={t("Realized revenue, accounts receivable, and cost structures")}
        icon={<Landmark className="w-6 h-6" />}
      />

      {/* Hero Financial Banner */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <motion.div
           initial={{ opacity: 0, y: 10 }}
           animate={{ opacity: 1, y: 0 }}
           transition={{ delay: 0.1 }}
           className="bg-white border border-stone-200 rounded-3xl p-8 flex flex-col justify-between shadow-sm relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-50 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3"></div>
          <div className="relative z-10 flex justify-between items-start mb-12">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 flex items-center justify-center shrink-0 border border-emerald-100">
              <DollarSign className="w-6 h-6 text-emerald-600" />
            </div>
            <span className="text-[10px] uppercase font-bold tracking-[0.2em] text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-100/50">
              Overall Ledger
            </span>
          </div>
          <div className="relative z-10">
            <h3 className="text-[11px] uppercase font-bold tracking-widest text-stone-500 mb-2">{t("Gross Margin")}</h3>
            <div className="text-4xl font-black font-mono tracking-tighter text-stone-900">
              {formatIDR(gross_margin)}
            </div>
            <div className={cn("text-xs font-bold uppercase tracking-wider mt-4 flex items-center gap-1.5", isProfitable ? "text-emerald-500" : "text-rose-500")}>
              {isProfitable ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
              {isProfitable ? "Operating Profit" : "Operating Loss"}
            </div>
          </div>
        </motion.div>

        {/* Secondary Metric - Billed */}
        <motion.div 
           initial={{ opacity: 0, y: 10 }}
           animate={{ opacity: 1, y: 0 }}
           transition={{ delay: 0.2 }}
           className="bg-white border border-stone-200 rounded-3xl p-8 shadow-sm flex flex-col justify-between"
        >
           <div className="flex justify-between items-start mb-12">
            <div className="w-12 h-12 rounded-2xl bg-stone-50 flex items-center justify-center shrink-0 border border-stone-100">
              <FileText className="w-6 h-6 text-stone-600" />
            </div>
            <span className="text-[10px] uppercase font-bold tracking-[0.2em] text-stone-500 bg-stone-50 px-3 py-1.5 rounded-full border border-stone-200/50">
              Revenue
            </span>
          </div>
          <div>
            <h3 className="text-[11px] uppercase font-bold tracking-widest text-stone-500 mb-2">{t("Total Billed (AR)")}</h3>
            <div className="text-3xl font-black font-mono tracking-tighter text-stone-900">
              {formatIDR(total_billed)}
            </div>
            <div className="text-xs font-bold uppercase tracking-wider mt-4 flex items-center gap-2 text-stone-500">
               <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-stone-400"></span> {formatIDR(total_received)} Paid</span>
               <span className="text-stone-300">|</span>
               <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-stone-700"></span> {formatIDR(total_receivable)} Unpaid</span>
            </div>
          </div>
        </motion.div>

        {/* Third Metric - COGS */}
        <motion.div 
           initial={{ opacity: 0, y: 10 }}
           animate={{ opacity: 1, y: 0 }}
           transition={{ delay: 0.3 }}
           className="bg-white border border-stone-200 rounded-3xl p-8 shadow-sm flex flex-col justify-between"
        >
           <div className="flex justify-between items-start mb-12">
            <div className="w-12 h-12 rounded-2xl bg-stone-50 flex items-center justify-center shrink-0 border border-stone-100">
              <Wallet className="w-6 h-6 text-stone-600" />
            </div>
            <span className="text-[10px] uppercase font-bold tracking-[0.2em] text-stone-500 bg-stone-50 px-3 py-1.5 rounded-full border border-stone-200/50">
              Expense
            </span>
          </div>
          <div>
            <h3 className="text-[11px] uppercase font-bold tracking-widest text-stone-500 mb-2">{t("Total COGS (Procurement)")}</h3>
            <div className="text-3xl font-black font-mono tracking-tighter text-stone-900">
              {formatIDR(total_cogs)}
            </div>
            <div className="text-[11px] font-bold text-stone-400 mt-4 leading-relaxed max-w-[200px]">
               Value of all finalized Purchase Orders issued.
            </div>
          </div>
        </motion.div>
      </div>
      
      {/* Chart Section */}
      {chartData && chartData.length > 0 && (
         <motion.div
           initial={{ opacity: 0, y: 10 }}
           animate={{ opacity: 1, y: 0 }}
           transition={{ delay: 0.4 }}
           className="p-8 border border-stone-200 rounded-3xl bg-white shadow-sm"
         >
           <div className="flex justify-between items-center mb-8">
              <div>
                <h3 className="text-sm font-bold uppercase tracking-widest text-stone-900 mb-2">Financial Performance</h3>
                <p className="text-xs font-semibold text-stone-500 leading-relaxed max-w-sm">
                  Monthly aggregated view of revenue, COGS, and gross margin trends.
                </p>
              </div>
           </div>
           
           <div className="h-[300px] w-full">
             <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f5f5f4" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#78716c', fontWeight: 600 }} />
                  <YAxis tickFormatter={(val) => `Rp${(val / 1000000).toFixed(0)}M`} axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#78716c', fontWeight: 600 }} />
                  <Tooltip 
                     formatter={(value: number) => formatIDR(value)}
                     contentStyle={{ borderRadius: '16px', border: '1px solid #e7e5e4', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05)', padding: '12px' }}
                     labelStyle={{ fontWeight: 'bold', color: '#1c1917', marginBottom: '8px' }}
                  />
                  <Legend wrapperStyle={{ paddingTop: '20px', fontSize: '12px', fontWeight: 600 }} />
                  <Bar dataKey="revenue" name="Revenue" fill="#292524" radius={[4, 4, 0, 0]} barSize={40} />
                  <Bar dataKey="cogs" name="COGS" fill="#a8a29e" radius={[4, 4, 0, 0]} barSize={40} />
                </BarChart>
             </ResponsiveContainer>
           </div>
         </motion.div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-4">
         <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="p-8 border border-stone-200 rounded-3xl bg-white shadow-sm flex items-center gap-6"
         >
            <div className="w-14 h-14 rounded-2xl bg-stone-50 flex items-center justify-center border border-stone-200 shrink-0">
               <ShieldCheck className="w-6 h-6 text-stone-700" />
            </div>
            <div>
              <h3 className="text-sm font-bold uppercase tracking-widest text-stone-900 mb-2">Audit Ready Data</h3>
              <p className="text-xs font-semibold text-stone-500 leading-relaxed max-w-sm">
                These figures are automatically derived from Commercial Invoices generated by Outbound logistics, mapped dynamically against Purchase Orders. 
              </p>
            </div>
         </motion.div>

         <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
            className="p-8 border border-stone-200 rounded-3xl bg-white shadow-sm flex flex-col justify-center"
         >
            <div className="flex justify-between items-center bg-stone-50 p-6 rounded-2xl border border-stone-100">
               <div className="flex items-center gap-5">
                  <div className="w-12 h-12 bg-white border border-stone-200 text-stone-700 rounded-2xl flex items-center justify-center shrink-0 shadow-sm">
                     <Download className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-stone-900 mb-1">Export General Ledger</h4>
                    <span className="text-[11px] text-stone-500 font-semibold uppercase tracking-wider">CSV Data file for External ERP</span>
                  </div>
               </div>
               <button 
                 onClick={handleExportCSV}
                 className="px-5 py-2.5 bg-stone-900 text-white rounded-xl text-xs font-bold shadow-sm hover:bg-stone-800 active:scale-95 transition-all uppercase tracking-widest flex items-center gap-2"
               >
                  Export CSV
               </button>
            </div>
         </motion.div>
      </div>
    </div>
  );
}
