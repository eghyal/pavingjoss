import React, { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/shared/PageHeader';
import { WalletCards, Clock, CheckCircle2, TrendingUp, KeyRound, Search, FileText, ChevronRight, Trash2 } from 'lucide-react';
import { apiFetch } from '@/utils/api';
import { useToast } from '@/contexts/ToastContext';
import { Modal } from '@/components/ui/Modal';
import { formatIDR } from '@/lib/utils';
import { motion, AnimatePresence } from 'motion/react';

export default function Payroll() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [payrolls, setPayrolls] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  
  // Modals Flow
  const [isGenerateModalOpen, setIsGenerateModalOpen] = useState(false);
  const [generateMonth, setGenerateMonth] = useState((new Date().getMonth() + 1).toString());
  const [generateYear, setGenerateYear] = useState(new Date().getFullYear().toString());

  const [selectedPayrollToPay, setSelectedPayrollToPay] = useState<any>(null);
  const [viewDetailsData, setViewDetailsData] = useState<any[]>([]);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);

  const [authPin, setAuthPin] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const years = [new Date().getFullYear().toString(), (new Date().getFullYear() - 1).toString(), (new Date().getFullYear() - 2).toString()];

  const fetchPayrolls = async () => {
    setIsLoading(true);
    try {
      const res = await apiFetch('/api/finance/payrolls', {}, user?.username);
      if (res.ok) {
        setPayrolls(res.data);
      }
    } catch (err) {
      showToast("Error fetching payroll data", "error");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPayrolls();
  }, []);

  const handleOpenGenerateModal = () => setIsGenerateModalOpen(true);

  const handleGeneratePayroll = async (e: React.FormEvent) => {
    e.preventDefault();
    const periodName = `${months[parseInt(generateMonth) - 1]} ${generateYear}`;
    setIsGenerating(true);
    try {
      const res = await apiFetch('/api/hr/generate-payroll', {
        method: 'POST',
        body: JSON.stringify({ period_name: periodName })
      }, user?.username);
      
      if (res.ok) {
        showToast(t("Payroll generated successfully based on HRIS data."), "success");
        setIsGenerateModalOpen(false);
        fetchPayrolls();
      } else {
        showToast(res.error || t("Failed to generate payroll"), "error");
      }
    } catch (err) {
      showToast(t("An error occurred while generating payroll"), "error");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDeletePayroll = async (id: string) => {
    if (!confirm(t("Are you sure you want to delete this drafted payroll?"))) return;
    try {
      const res = await apiFetch(`/api/finance/payrolls/${id}`, { method: 'DELETE' }, user?.username);
      if (res.ok) {
        showToast(t("Drafted payroll deleted successfully."), "success");
        fetchPayrolls();
      } else {
        showToast(res.error || t("Failed to delete payroll"), "error");
      }
    } catch (error) {
      showToast(t("An error occurred computing request"), "error");
    }
  };

  const handleClearDrafts = async () => {
    if (!confirm(t("Are you sure you want to clear all drafted payrolls?"))) return;
    try {
      const res = await apiFetch(`/api/finance/payrolls`, { method: 'DELETE' }, user?.username);
      if (res.ok) {
        showToast(t("All drafted payrolls cleared successfully."), "success");
        fetchPayrolls();
      } else {
        showToast(res.error || t("Failed to clear drafts"), "error");
      }
    } catch (error) {
      showToast(t("An error occurred computing request"), "error");
    }
  };

  const handleViewBreakdown = (payroll: any) => {
    try {
      const parsed = JSON.parse(payroll.details_json || '[]');
      setViewDetailsData(parsed);
      setIsDetailsModalOpen(true);
    } catch (e) {
      setViewDetailsData([]);
      showToast("Error parsing payroll details", "error");
    }
  };

  const handlePay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authPin || authPin.length !== 6) {
      showToast(t("Please enter a valid 6-character authorization key"), "error");
      return;
    }
    
    setIsSubmitting(true);
    try {
      const res = await apiFetch(`/api/finance/payrolls/${selectedPayrollToPay.id}/pay`, {
        method: 'PUT',
        body: JSON.stringify({ pin: authPin })
      }, user?.username);
      
      if (res.ok) {
        showToast(t("Payroll disbursed successfully"), "success");
        setSelectedPayrollToPay(null);
        setAuthPin('');
        fetchPayrolls();
      } else {
        showToast(res.error || t("Authorization failed"), "error");
      }
    } catch (err) {
      showToast(t("An error occurred during disbursement"), "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredPayrolls = payrolls.filter(p => 
    (p.period_name || '').toLowerCase().includes(searchTerm.toLowerCase()) || 
    (p.id || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  const pendingPayrolls = filteredPayrolls.filter(p => p.status === 'DRAFTED' || p.status === 'AUTHORIZED');
  const paidPayrolls = filteredPayrolls.filter(p => p.status === 'PAID');

  return (
    <div className="space-y-8 pb-20 animate-in fade-in duration-500">
      <PageHeader
        title={t("Payroll Distribution")}
        subtitle={t("Automated Salary & KPI Disbursement tied directly to HRIS")}
        icon={<WalletCards className="w-6 h-6" />}
      />

       <div className="flex flex-col md:flex-row justify-between gap-4 sticky top-0 bg-stone-50/80 backdrop-blur-md z-10 py-4 -mx-4 px-4 sm:mx-0 sm:px-0">
         <div className="relative flex-1 max-w-md">
           <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-stone-400" />
           <input
             type="text"
             placeholder={t("Search Period / Document ID...")}
             value={searchTerm}
             onChange={e => setSearchTerm(e.target.value)}
             className="w-full pl-12 pr-4 py-3 bg-white border border-stone-200 rounded-2xl text-sm focus:outline-none focus:border-stone-400"
           />
         </div>
         <div className="flex gap-3">
           {pendingPayrolls.length > 0 && (
             <button 
               onClick={handleClearDrafts}
               className="px-4 py-3 bg-red-50 text-red-600 border border-red-200 rounded-2xl text-sm font-bold shadow-sm hover:bg-red-100 transition-colors tracking-wider flex items-center gap-2"
             >
               <Trash2 className="w-4 h-4" />
             </button>
           )}
           <button 
             onClick={handleOpenGenerateModal}
             className="px-6 py-3 bg-stone-900 text-white rounded-2xl text-sm font-bold shadow-sm hover:bg-stone-800 transition-colors uppercase tracking-wider flex items-center gap-2"
           >
             <TrendingUp className="w-4 h-4" />
             {t("Generate Payroll")}
           </button>
         </div>
       </div>

       {isLoading ? (
          <div className="flex justify-center p-12"><div className="w-8 h-8 rounded-full border-4 border-stone-200 border-t-stone-800 animate-spin"></div></div>
       ) : (
         <>
         <div className="space-y-6">
            <div className="border-b border-stone-200 pb-4 flex justify-between items-end">
               <div>
                 <h2 className="text-xl font-bold text-stone-900 tracking-tight">{t("Awaiting Payout Authorization")}</h2>
                 <p className="text-sm font-medium text-stone-500 mt-1">{t("Payrolls awaiting finance disbursement validation")}</p>
               </div>
               <div className="px-3 py-1 bg-amber-50 text-amber-600 rounded-lg text-xs font-bold font-mono">
                 {pendingPayrolls.length} {t("PENDING")}
               </div>
            </div>

            {pendingPayrolls.length === 0 ? (
               <div className="p-12 text-center border border-stone-200 border-dashed rounded-[2rem] bg-stone-50/50">
                  <CheckCircle2 className="w-12 h-12 text-stone-300 mx-auto mb-4" />
                  <div className="font-bold text-stone-600">{t("All payroll pipelines have been disbursed.")}</div>
               </div>
            ) : (
               <div className="space-y-4">
                  <AnimatePresence>
                  {pendingPayrolls.map((payroll) => (
                     <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, height: 0, overflow: 'hidden' }}
                        key={payroll.id} 
                        className="bg-white border md:border-l-4 md:border-l-amber-500 border-stone-200 p-6 rounded-2xl md:rounded-r-2xl md:rounded-l-none shadow-sm flex flex-col sm:flex-row gap-6 items-start sm:items-center justify-between"
                     >
                        <div className="space-y-2 flex-1">
                           <div className="flex items-center gap-3">
                              <span className="text-xl font-bold text-stone-900">{payroll.period_name}</span>
                              <span className="px-2 py-1 bg-stone-100 text-stone-600 rounded text-[10px] font-bold tracking-wider font-mono uppercase">{payroll.id}</span>
                           </div>
                           <div className="text-xs text-stone-500 flex flex-wrap gap-4">
                              <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> Generated: {new Date(payroll.created_at).toLocaleDateString()}</span>
                           </div>
                           <button 
                             onClick={() => handleViewBreakdown(payroll)}
                             className="text-amber-600 hover:text-amber-700 text-xs font-bold uppercase tracking-wider flex items-center gap-1 mt-2 focus:outline-none cursor-pointer"
                           >
                             <FileText className="w-3.5 h-3.5" /> {t("View Salary Breakdown")}
                           </button>
                        </div>
                        <div className="flex items-center gap-6 w-full sm:w-auto mt-4 sm:mt-0 pt-4 sm:pt-0 border-t border-stone-100 sm:border-0 justify-between sm:justify-end">
                           <button
                             title="Delete Draft"
                             onClick={() => handleDeletePayroll(payroll.id)}
                             className="w-10 h-10 rounded-xl bg-red-50 text-red-500 hover:bg-red-500 hover:text-white transition-colors flex items-center justify-center shrink-0"
                           >
                             <Trash2 className="w-4 h-4" />
                           </button>
                           <div className="text-right flex flex-col px-4 border-r border-stone-100">
                             <span className="text-[10px] uppercase font-bold text-amber-600 tracking-wider relative -top-1">Global Amount</span>
                             <span className="text-xl font-bold font-mono text-stone-900">{formatIDR(payroll.total_amount)}</span>
                           </div>
                           <button 
                             onClick={() => setSelectedPayrollToPay(payroll)}
                             className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-stone-900 text-white text-xs font-bold uppercase tracking-wider hover:bg-stone-800 transition-colors shrink-0 flex items-center gap-2 justify-center"
                           >
                             {t("Disburse")} <ChevronRight className="w-4 h-4" />
                           </button>
                        </div>
                     </motion.div>
                  ))}
                  </AnimatePresence>
               </div>
            )}
         </div>

         <div className="space-y-6">
            <div className="border-b border-stone-200 pb-4 flex justify-between items-end">
               <div>
                 <h2 className="text-xl font-bold text-stone-900 tracking-tight">{t("Payout Registry Ledger")}</h2>
                 <p className="text-sm font-medium text-stone-500 mt-1">{t("Completed payroll disbursements (PAID and Synced to HRIS)")}</p>
               </div>
            </div>
            
            <div className="bg-white border border-stone-200 rounded-3xl overflow-hidden shadow-sm">
               {paidPayrolls.length === 0 ? (
                 <div className="p-12 text-center">
                    <WalletCards className="w-12 h-12 text-stone-300 mx-auto mb-4" />
                    <div className="font-bold text-stone-600">{t("No payment history yet")}</div>
                 </div>
               ) : (
                 <table className="w-full text-left max-w-full overflow-x-auto block md:table">
                   <thead className="bg-stone-50/80 border-b border-stone-200 hidden md:table-header-group">
                     <tr>
                       <th className="p-4 text-xs font-bold text-stone-500 uppercase tracking-widest">{t("Period / Record")}</th>
                       <th className="p-4 text-xs font-bold text-stone-500 uppercase tracking-widest">{t("Amount (IDR)")}</th>
                       <th className="p-4 text-xs font-bold text-stone-500 uppercase tracking-widest">{t("Chronology")}</th>
                       <th className="p-4 text-xs font-bold text-stone-500 uppercase tracking-widest">{t("Status")}</th>
                     </tr>
                   </thead>
                   <tbody className="divide-y divide-stone-100 flex flex-col md:table-row-group">
                     {paidPayrolls.map(payroll => (
                         <tr key={payroll.id} className="hover:bg-stone-50/50 transition-colors text-sm flex flex-col md:table-row p-4 md:p-0">
                           <td className="p-0 md:p-4 mb-2 md:mb-0">
                             <div className="font-bold text-stone-900">{payroll.period_name}</div>
                             <div className="flex gap-2 items-center mt-1">
                               <div className="text-xs font-mono text-stone-400">{payroll.id}</div>
                               <button onClick={() => handleViewBreakdown(payroll)} className="text-[10px] uppercase font-bold text-amber-600 tracking-wider hover:underline">{t("View Details")}</button>
                             </div>
                           </td>
                           <td className="p-0 md:p-4 font-mono font-bold text-stone-800 mb-2 md:mb-0">{formatIDR(payroll.total_amount)}</td>
                           <td className="p-0 md:p-4 text-stone-500 text-xs mb-2 md:mb-0">
                             {payroll.paid_at ? new Date(payroll.paid_at).toLocaleString() : '-'}
                           </td>
                           <td className="p-0 md:p-4">
                             <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-full text-[10px] font-bold uppercase tracking-widest border border-emerald-200/50">
                               AUTHORIZED
                             </span>
                           </td>
                         </tr>
                     ))}
                   </tbody>
                 </table>
               )}
            </div>
         </div>
         </>
       )}

      {/* Generate Payroll Form Modal */}
      <Modal
         isOpen={isGenerateModalOpen}
         onClose={() => setIsGenerateModalOpen(false)}
         title={t("Generate Automated Payroll")}
         description={t("Pulls records from users, attendance, and KPIs to compile global amount.")}
      >
         <form onSubmit={handleGeneratePayroll} className="space-y-6 pt-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-bold text-stone-500 uppercase tracking-wider block mb-2">{t("Select Month")}</label>
                <select 
                  value={generateMonth}
                  onChange={(e) => setGenerateMonth(e.target.value)}
                  className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none focus:border-stone-400"
                >
                  {months.map((m, idx) => (
                    <option key={idx} value={idx + 1}>{m}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-stone-500 uppercase tracking-wider block mb-2">{t("Select Year")}</label>
                <select 
                  value={generateYear}
                  onChange={(e) => setGenerateYear(e.target.value)}
                  className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl text-sm focus:outline-none focus:border-stone-400"
                >
                  {years.map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-6">
              <button type="button" onClick={() => setIsGenerateModalOpen(false)} className="px-5 py-2.5 text-xs font-bold uppercase tracking-widest text-stone-500 hover:text-stone-900">{t("Cancel")}</button>
              <button disabled={isGenerating} type="submit" className="px-5 py-2.5 bg-stone-900 text-white rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-stone-800 shadow-sm cursor-pointer disabled:opacity-50 flex items-center gap-2">
                {isGenerating ? t("Crunching Data...") : t("Synthesize Now")}
              </button>
            </div>
         </form>
      </Modal>

      {/* Breakdown Details Modal (UX fix) */}
      <Modal
        isOpen={isDetailsModalOpen}
        onClose={() => setIsDetailsModalOpen(false)}
        title={t("Calculated Salary Breakdown")}
        description={t("Detailed list of employee components generated by the HR system.")}
        maxWidth="2xl"
      >
        <div className="mt-4 max-h-[60vh] overflow-y-auto">
          {viewDetailsData.length === 0 ? (
            <div className="text-center p-8 text-stone-500 text-sm">No details available (System error or legacy format).</div>
          ) : (
            <div className="divide-y divide-stone-100">
              {viewDetailsData.map((d, i) => (
                <div key={i} className="py-4 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 hover:bg-stone-50/50 p-2 rounded-lg transition-colors">
                  <div>
                    <div className="font-bold text-sm text-stone-900">{d.name || d.username}</div>
                    <div className="text-xs text-stone-500 mt-1 font-mono">{d.username} &bull; {d.present_days ? `${d.present_days} Days Present` : ''}</div>
                  </div>
                  <div className="flex gap-6 sm:text-right text-sm">
                    <div>
                      <div className="text-[10px] text-stone-400 uppercase tracking-widest mb-1">Base</div>
                      <div className="font-mono text-stone-700">{formatIDR(d.base_salary)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-emerald-600 uppercase tracking-widest mb-1">KPI Bonus</div>
                      <div className="font-mono text-emerald-700">{formatIDR(d.kpi_bonus)}</div>
                    </div>
                    <div className="bg-stone-100 px-3 py-1.5 rounded-lg border border-stone-200 shadow-inner">
                      <div className="text-[10px] text-black font-bold uppercase tracking-widest mb-0.5">Net</div>
                      <div className="font-mono font-bold text-stone-900">{formatIDR(d.total_pay)}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>

      {/* Authorization Modal */}
      <Modal
        isOpen={!!selectedPayrollToPay}
        onClose={() => {
          setAuthPin('');
          setSelectedPayrollToPay(null);
        }}
        title={t("Confirm Finance Validation")}
        description={t("Authorize the global amount. Once validated, this will instantly generate individual e-payslips directly in down-stream employees' Self-Service portals.")}
        maxWidth="md"
        contentClassName="p-0 border-t border-stone-100"
      >
        {selectedPayrollToPay && (
          <form onSubmit={handlePay} className="font-sans text-stone-900 bg-white">
            <div className="p-6 md:p-8 space-y-6 text-sm">
              <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 flex flex-col gap-1 items-center justify-center text-center">
                <span className="text-[10px] font-bold text-amber-600 uppercase tracking-widest">{t("Global Amount Validator")}</span>
                <span className="text-xl font-bold font-mono text-amber-950">{formatIDR(selectedPayrollToPay.total_amount)}</span>
                <span className="text-xs font-medium text-amber-800">{selectedPayrollToPay.period_name}</span>
              </div>

              <div>
                <label className="text-[10px] font-bold text-stone-500 uppercase tracking-wider block">
                   {t("FC Digital Security Key")}
                </label>
                <p className="text-xs text-stone-600 mb-3 leading-relaxed mt-1">
                  {t("Please enter your 6-character daily authorization key to confirm this outgoing cash flow and synchronize Payslips.")}
                </p>
                <input
                  type="password"
                  maxLength={6}
                  placeholder="••••••"
                  className="w-full p-4 bg-stone-50 border border-stone-200 rounded-xl text-center text-2xl font-mono tracking-[0.5em] focus:outline-none focus:border-stone-400 focus:bg-white transition-all uppercase"
                  value={authPin}
                  onChange={(e) => setAuthPin(e.target.value.toUpperCase())}
                  required
                />
              </div>
            </div>

            <div className="bg-stone-50 p-4 md:p-6 border-t border-stone-200 flex justify-end gap-3 rounded-b-3xl">
              <button
                type="button"
                onClick={() => {
                  setSelectedPayrollToPay(null);
                  setAuthPin('');
                }}
                className="px-5 py-2.5 text-stone-500 hover:text-stone-900 text-[10px] font-bold uppercase tracking-widest rounded-xl transition-colors cursor-pointer"
              >
                {t("Cancel")}
              </button>
              <button
                type="submit"
                disabled={isSubmitting || authPin.length !== 6}
                className="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:bg-stone-300 disabled:text-stone-500 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest transition-colors shadow-sm cursor-pointer flex items-center gap-2"
              >
                <KeyRound className="w-3.5 h-3.5" />
                {isSubmitting ? t('Signing ledger...') : t('Sign & Disburse')}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

