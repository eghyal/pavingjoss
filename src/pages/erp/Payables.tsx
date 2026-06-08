import React, { useState, useEffect } from 'react';
import { apiFetch } from '@/utils/api';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { PageHeader } from '@/components/shared/PageHeader';
import { Landmark, ArrowRight, CheckCircle2, FileText, CheckCircle, Search } from 'lucide-react';
import { formatIDR, cn } from '@/lib/utils';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

export default function Payables() {
  const [payables, setPayables] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showPayModal, setShowPayModal] = useState(false);
  const [selectedPO, setSelectedPO] = useState<any>(null);
  const [authPin, setAuthPin] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const { showToast } = useToast();
  const { user } = useAuth();
  const { t } = useLanguage();

  const fetchPayables = async () => {
    setIsLoading(true);
    try {
      const res = await apiFetch('/api/finance/payables', {}, user?.username);
      if (res.ok) {
        setPayables(Array.isArray(res.data) ? res.data : (res.data?.data || []));
      }
    } catch (err) {
      showToast("Error fetching payables", "error");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPayables();
  }, []);

  const handlePayPO = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPO || !authPin) return;
    setIsSubmitting(true);
    try {
      const res = await apiFetch(`/api/finance/payables/${selectedPO.id}/pay`, {
        method: 'PUT',
        body: JSON.stringify({ pin: authPin })
      }, user?.username);
      if (res.ok) {
        showToast("Purchase Order marked as PAID (FINISHED)", "success");
        setShowPayModal(false);
        setAuthPin('');
        setSelectedPO(null);
        fetchPayables();
      } else {
        showToast(res.error || "Failed", "error");
      }
    } catch (err) {
      showToast("Error processing payment", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredPayables = payables.filter(po => 
    (po.po_number || '').toLowerCase().includes(searchTerm.toLowerCase()) || 
    (po.supplier_name || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  const pendingPayables = filteredPayables.filter(p => p.status === 'ISSUED' || p.status === 'DRAFTED' || p.status === 'AUTHORIZED');
  const paidPayables = filteredPayables.filter(p => p.status === 'FINISHED');

  return (
    <div className="space-y-12 pb-20 animate-in fade-in duration-500">
      <PageHeader
        title="Account Payables"
        subtitle="Manage and execute payments for Purchase Orders to Suppliers."
        icon={<Landmark className="w-6 h-6" />}
      />

      <div className="flex gap-4 items-center">
        <div className="relative flex-1 max-w-lg">
           <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-stone-400" />
           <input
             type="text"
             placeholder={t("Search by PO / Supplier...")}
             value={searchTerm}
             onChange={e => setSearchTerm(e.target.value)}
             className="w-full pl-12 pr-4 py-3 bg-white border border-stone-200 rounded-2xl text-sm focus:outline-none focus:border-stone-400"
           />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left Column: Pending Payables */}
         <div className="space-y-6">
            <div className="border-b border-stone-200 pb-4 flex justify-between items-end">
               <div>
                 <h2 className="text-xl font-bold text-stone-900 tracking-tight">{t("Awaiting Payment")}</h2>
                 <p className="text-sm font-medium text-stone-500 mt-1">{t("Active supplier purchase order bills")}</p>
               </div>
               <div className="px-3 py-1 bg-amber-50 text-amber-600 rounded-lg text-xs font-bold font-mono">
                 {pendingPayables.length} {t("PENDING")}
               </div>
            </div>

            {pendingPayables.length === 0 ? (
               <div className="p-12 text-center border border-stone-200 border-dashed rounded-[2rem] bg-stone-50/50">
                  <CheckCircle2 className="w-12 h-12 text-stone-300 mx-auto mb-4" />
                  <div className="font-bold text-stone-600">{t("All POs have been paid.")}</div>
               </div>
            ) : (
               <div className="space-y-4">
                  {pendingPayables.map(po => (
                     <div key={po.id} className="p-6 bg-white border border-stone-200 rounded-3xl shadow-sm flex flex-col sm:flex-row justify-between items-center group hover:border-stone-300 transition-all gap-4">
                        <div className="flex-1 w-full">
                           <div className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-1.5 flex justify-between">
                             <span>PO NUMBER: {po.po_number}</span>
                             <span className="text-amber-500">{po.status}</span>
                           </div>
                           <div className="text-lg font-bold text-stone-900 tracking-tight">{po.supplier_name}</div>
                           <div className="text-sm font-black font-mono text-stone-700 mt-0.5">{formatIDR(po.total_amount)}</div>
                        </div>
                        <button 
                           onClick={() => {
                             setSelectedPO(po);
                             setShowPayModal(true);
                           }} 
                           className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-stone-900 text-white text-xs font-bold uppercase tracking-wider hover:bg-stone-800 transition-colors shrink-0"
                        >
                           {t("Pay")}
                        </button>
                     </div>
                  ))}
               </div>
            )}
         </div>

        {/* Right Column: Paid / Finished POs */}
        <div className="space-y-6">
            <div className="border-b border-stone-200 pb-4 flex justify-between items-end">
               <div>
                 <h2 className="text-xl font-bold text-stone-900 tracking-tight">{t("Outbound Payment History")}</h2>
                 <p className="text-sm font-medium text-stone-500 mt-1">{t("Completed Purchase Orders (FINISHED)")}</p>
               </div>
            </div>
            
            <div className="border border-stone-200 rounded-[2rem] bg-white overflow-hidden shadow-sm">
               {paidPayables.length === 0 ? (
                 <div className="p-12 text-center">
                    <FileText className="w-12 h-12 text-stone-300 mx-auto mb-4" />
                    <div className="font-bold text-stone-600">{t("No payment history yet")}</div>
                 </div>
               ) : (
                 <table className="w-full text-left">
                    <thead>
                       <tr className="bg-stone-50 border-b border-stone-200 text-[10px] font-bold uppercase tracking-widest text-stone-500">
                          <th className="px-6 py-4 flex-1">Details</th>
                          <th className="px-6 py-4 text-right shrink-0">Amount</th>
                       </tr>
                    </thead>
                    <tbody>
                       {paidPayables.map((po, index) => (
                          <tr key={po.id} className="border-b border-stone-100 last:border-0 hover:bg-stone-50/50">
                             <td className="px-6 py-5">
                                <div className="text-sm font-bold font-mono text-stone-900 flex items-center gap-2">
                                  {po.po_number}
                                  <CheckCircle className="w-3 h-3 text-emerald-500" />
                                </div>
                                <div className="text-[10px] font-bold text-stone-500 mt-1 tracking-wider uppercase">{po.supplier_name}</div>
                             </td>
                             <td className="px-6 py-5 text-right font-mono font-bold text-stone-900">
                                <div className="font-bold">{formatIDR(po.total_amount)}</div>
                                <div className="text-[9px] text-emerald-600 mt-0.5 font-sans font-bold">PAID (FINISHED)</div>
                             </td>
                          </tr>
                       ))}
                    </tbody>
                 </table>
               )}
            </div>
         </div>
      </div>

      {/* Pay PO Modal */}
      <Modal
        isOpen={showPayModal && !!selectedPO}
        onClose={() => {
          setShowPayModal(false);
          setAuthPin('');
          setSelectedPO(null);
        }}
        title={t("Confirm PO Payment")}
        description={t("Centrally record company expenses for PO costs.")}
        maxWidth="md"
        contentClassName="p-0 border-t border-stone-100"
      >
        {selectedPO && (
          <form onSubmit={handlePayPO} className="font-sans text-stone-900 bg-white">
            <div className="p-6 md:p-8 space-y-6 text-sm">
              <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 flex flex-col gap-1 items-center justify-center text-center">
                <span className="text-[10px] font-bold text-amber-600 uppercase tracking-widest">{t("Total Expense")}</span>
                <span className="text-xl font-bold font-mono text-amber-950">{formatIDR(selectedPO.total_amount)}</span>
                <span className="text-xs font-medium text-amber-800">{selectedPO.supplier_name} - {selectedPO.po_number}</span>
              </div>
              <div className="space-y-2 pt-2 border-t border-stone-100">
                <label className="text-[10px] font-bold text-stone-500 uppercase tracking-wider block">
                   {t("Digital Authorization (PIN)")}
                </label>
                <p className="text-xs text-stone-600 mb-3 leading-relaxed">
                  {t("Please enter your 6-digit PIN to authorize this expense. Once confirmed, the PO status will be set to FINISHED and recorded in the Finance Hub.")}
                </p>
                <input
                  type="password"
                  maxLength={6}
                  required
                  placeholder="••••••"
                  value={authPin}
                  onChange={(e) => setAuthPin(e.target.value.replace(/[^\d]/g, ''))}
                  className="w-full text-center tracking-[0.5em] px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl text-lg font-bold font-mono text-stone-900 focus:bg-white focus:outline-none focus:border-stone-400 focus:ring-4 focus:ring-stone-100 transition-all placeholder:tracking-normal"
                />
              </div>
            </div>
            <div className="p-4 border-t border-stone-100 bg-stone-50 flex justify-end gap-3 rounded-b-2xl">
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => {
                  setShowPayModal(false);
                  setAuthPin('');
                }}
                className="px-5 py-2.5 text-stone-500 hover:text-stone-900 text-[10px] font-bold uppercase tracking-widest rounded-xl transition-colors cursor-pointer"
              >
                {t("Cancel")}
              </button>
              <button
                type="submit"
                disabled={isSubmitting || authPin.length !== 6}
                className="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:bg-stone-300 disabled:text-stone-500 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest transition-colors shadow-sm cursor-pointer"
              >
                {isSubmitting ? t('Processing...') : t('Confirm Payment')}
              </button>
            </div>
          </form>
        )}
      </Modal>

    </div>
  );
}
