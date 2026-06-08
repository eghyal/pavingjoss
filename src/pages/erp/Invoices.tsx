import { safeFetchJson, apiFetch } from '@/utils/api';
import React, { useState, useEffect, useRef } from 'react';
import { useToast } from '@/contexts/ToastContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { FileText, ArrowRight, DollarSign, CheckCircle2, Download, Eye, X, Trash2, Landmark, Calendar, Briefcase, Percent, Coins } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/shared/PageHeader';
import { cn } from '@/lib/utils';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { generatePDF } from '@/lib/pdfGenerator';
import { QRCodeSVG } from 'qrcode.react';
import { formatIDR, formatNumberWithDots, formatIDRWithDecimals } from '@/lib/utils';
import { PrintTemplate } from '@/components/erp/PrintTemplate';

function angkaKeTerbilang(nilai: number): string {
  if (nilai === 0) return "Nol";
  
  const bilangan = [
    "", "Satu", "Dua", "Tiga", "Empat", "Lima", 
    "Enam", "Tujuh", "Delapan", "Sembilan", "Sepuluh", "Sebelas"
  ];
  
  let temp = "";
  const n = Math.floor(nilai);
  
  if (n < 12) {
    temp = bilangan[n];
  } else if (n < 20) {
    temp = bilangan[n - 10] + " Belas";
  } else if (n < 100) {
    temp = angkaKeTerbilang(Math.floor(n / 10)) + " Puluh " + bilangan[n % 10];
  } else if (n < 200) {
    temp = "Seratus " + angkaKeTerbilang(n - 100);
  } else if (n < 1000) {
    temp = angkaKeTerbilang(Math.floor(n / 100)) + " Ratus " + angkaKeTerbilang(n % 100);
  } else if (n < 2000) {
    temp = "Seribu " + angkaKeTerbilang(n - 1000);
  } else if (n < 1000000) {
    temp = angkaKeTerbilang(Math.floor(n / 1000)) + " Ribu " + angkaKeTerbilang(n % 1000);
  } else if (n < 1000000000) {
    temp = angkaKeTerbilang(Math.floor(n / 1000000)) + " Juta " + angkaKeTerbilang(n % 1000000);
  } else if (n < 1000000000000) {
    temp = angkaKeTerbilang(Math.floor(n / 1000000000)) + " Milyar " + angkaKeTerbilang(n % 1000000000);
  } else if (n < 1000000000000000) {
    temp = angkaKeTerbilang(Math.floor(n / 1000000000000)) + " Triliun " + angkaKeTerbilang(n % 1000000000000);
  }
  
  return temp.replace(/\s+/g, ' ').trim();
}

export default function Invoices() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [unbilled, setUnbilled] = useState<any[]>([]);
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [quotations, setQuotations] = useState<any[]>([]);
  const [selectedQuoId, setSelectedQuoId] = useState('');
  const { showToast } = useToast();
  const { user } = useAuth();

  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [showRegisterBankModal, setShowRegisterBankModal] = useState(false);
  const [selectedDn, setSelectedDn] = useState<any>(null);
  const [amount, setAmount] = useState('');
  const [displayAmount, setDisplayAmount] = useState('');
  const [bankAccountId, setBankAccountId] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('Net 30');
  const [ppnRate, setPpnRate] = useState('12');

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value.replace(/[^\d]/g, '');
    setAmount(rawValue);
    setDisplayAmount(formatNumberWithDots(rawValue));
  };
  const [pphRate, setPphRate] = useState('2');
  const [jobDescription, setJobDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { t, language } = useLanguage();

  const [newBank, setNewBank] = useState({
    bank_name: '',
    account_number: '',
    account_holder: '',
    branch: ''
  });

  const [deletingBankId, setDeletingBankId] = useState<string | null>(null);

  const [previewInvoice, setPreviewInvoice] = useState<any>(null);
  const [showPayModal, setShowPayModal] = useState(false);
  const [selectedInvoiceForPay, setSelectedInvoiceForPay] = useState<any>(null);
  const [authPin, setAuthPin] = useState('');
  
  const handlePayInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedInvoiceForPay || !authPin) return;
    setIsSubmitting(true);
    try {
      const res = await apiFetch(`/api/finance/invoices/${selectedInvoiceForPay.id}/pay`, {
        method: 'PUT',
        body: JSON.stringify({ pin: authPin })
      }, user?.username);
      if (res.ok) {
        showToast("Invoice marked as PAID. Revenue recorded.", "success");
        setShowPayModal(false);
        setAuthPin('');
        setSelectedInvoiceForPay(null);
        fetchData();
      } else {
        showToast(res.error || "Failed to mark as paid", "error");
      }
    } catch (err) {
      showToast("Error processing payment", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const [isSubmittingPdf, setIsSubmittingPdf] = useState(false);
  const printDocRef = useRef<HTMLDivElement>(null);

  const exportInvoicePdf = async () => {
    if (!printDocRef.current || !previewInvoice) return;
    setIsSubmittingPdf(true);
    try {
      await generatePDF(printDocRef.current, `Invoice_Resmi_${previewInvoice.ci_number}.pdf`);
      showToast("Invoice exported as PDF", "success");
    } catch (err) {
      console.error(err);
      showToast("PDF generation failed", "error");
    } finally {
      setIsSubmittingPdf(false);
    }
  };

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [invRes, unbRes, bankRes, quoRes] = await Promise.all([
        apiFetch('/api/sales/invoices', {}, user?.username),
        apiFetch('/api/sales/unbilled-deliveries', {}, user?.username),
        apiFetch('/api/bank-accounts', {}, user?.username),
        apiFetch('/api/quotations', {}, user?.username)
      ]);
      if (invRes.ok) setInvoices(invRes.data);
      if (unbRes.ok) setUnbilled(unbRes.data);
      if (bankRes.ok) setBankAccounts(bankRes.data);
      if (quoRes.ok) setQuotations(quoRes.data.data || quoRes.data);
    } catch (err) {
      showToast("Error fetching invoices", "error");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleSelectDn = async (dn: any) => {
    setSelectedDn(dn);
    
    // Auto-fill from connected Quotation if available
    const initialAmount = dn.quotation_amount ? dn.quotation_amount.toString() : '';
    setAmount(initialAmount);
    setDisplayAmount(dn.quotation_amount ? formatNumberWithDots(dn.quotation_amount.toString()) : '');
    
    setBankAccountId(bankAccounts[0]?.id || 'BNK-DEFAULT');
    setPaymentTerms('Net 30');
    setPpnRate('12');
    setPphRate('2');
    
    const initialDesc = dn.quotation_title || dn.project_name || `Commercial Trade Delivery (DN: ${dn.dn_number})`;
    setJobDescription(initialDesc);

    // Auto-detect matching Quotation object
    const matchedQuo = quotations.find(q => q.customer_id === dn.customer_id && (q.title === dn.quotation_title || q.amount === dn.quotation_amount));
    if (matchedQuo) {
      setSelectedQuoId(matchedQuo.id);
    } else {
      setSelectedQuoId('');
    }

    setShowInvoiceModal(true);

    // Fetch delivery note details async to put in more precise job description / items
    try {
      const res = await apiFetch(`/api/sales/deliveries/${dn.id}`, {}, user?.username);
      if (res.ok && res.data && res.data.items && res.data.items.length > 0) {
        const itemDetails = res.data.items.map((i: any) => `${i.item_name} (${i.qty} ${i.uom})`).join(', ');
        const baseTitle = dn.quotation_title || dn.project_name || 'Pengiriman Niaga';
        const updatedDesc = `${baseTitle} - No. SJ: ${dn.dn_number} [Item: ${itemDetails}]`;
        setJobDescription(updatedDesc);
      }
    } catch (err) {
      console.error("Failed to load DN details for job description", err);
    }
  };

  const handleCreateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDn || !amount || !bankAccountId) {
      showToast("Please fill in all required fields", "error");
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await apiFetch(`/api/sales/invoice/${selectedDn.id}`, {
        method: 'POST',
        body: JSON.stringify({
          amount: parseFloat(amount),
          bank_account_id: bankAccountId,
          payment_terms: paymentTerms,
          ppn_rate: parseFloat(ppnRate || '0'),
          pph_rate: parseFloat(pphRate || '0'),
          job_description: jobDescription
        })
      }, user?.username);

      if (res.ok) {
        showToast("Commercial Invoice Generated", "success");
        setShowInvoiceModal(false);
        setAmount('');
        setDisplayAmount('');
        setJobDescription('');
        setSelectedDn(null);
        fetchData();
      } else {
        showToast(res.error || "Failed", "error");
      }
    } catch (err) {
       showToast("Failed to generate", "error");
    } finally {
       setIsSubmitting(false);
    }
  };

  const handleDeleteBank = async (id: string) => {
    try {
       const res = await apiFetch(`/api/bank-accounts/${id}`, { method: 'DELETE' }, user?.username);
       if (res.ok) {
           showToast(t("Bank account deleted"), "success");
           const bankRes = await apiFetch('/api/bank-accounts', {}, user?.username);
           if (bankRes.ok) setBankAccounts(bankRes.data);
       } else {
           showToast(res.error || "Failed to delete bank account", "error");
       }
    } catch (e) {
       console.error("Delete bank account error:", e);
       showToast("Failed to delete", "error");
    }
  };

  const handleRegisterBank = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBank.bank_name || !newBank.account_number || !newBank.account_holder) {
      showToast("Please fill in all required fields", "error");
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await apiFetch('/api/bank-accounts', {
        method: 'POST',
        body: JSON.stringify(newBank)
      }, user?.username);
      if (res.ok) {
        showToast("Bank Account registered successfully", "success");
        setShowRegisterBankModal(false);
        setNewBank({ bank_name: '', account_number: '', account_holder: '', branch: '' });
        
        // Refresh bank accounts list
        const bankRes = await apiFetch('/api/bank-accounts', {}, user?.username);
        if (bankRes.ok) {
          const acts = bankRes.data;
          setBankAccounts(acts);
          if (acts.length > 0) {
            setBankAccountId(acts[0].id);
          }
        }
      } else {
        showToast(res.error || "Failed to register bank account", "error");
      }
    } catch (err) {
      showToast("Error registering bank account", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Helper calculation
  const subtotalVal = parseFloat(amount || '0') || 0;
  const ppnVal = subtotalVal * (parseFloat(ppnRate || '0') / 100);
  const pphVal = subtotalVal * (parseFloat(pphRate || '0') / 100);
  const grandTotalValUnrounded = subtotalVal + ppnVal - pphVal;
  const grandTotalVal = Math.floor(grandTotalValUnrounded);
  const roundingFactorVal = grandTotalVal - grandTotalValUnrounded;

  return (
    <div className="space-y-12 pb-20 animate-in fade-in duration-500">
      <PageHeader
        title={t("Commercial Invoices")}
        subtitle={t("Transform completed logistics into financial billing")}
        icon={<FileText className="w-6 h-6" />}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
         <div className="space-y-6">
            <div className="border-b border-stone-200 pb-4 flex justify-between items-end">
               <div>
                 <h2 className="text-xl font-bold text-stone-900 tracking-tight">{t("Unbilled Deliveries")}</h2>
                 <p className="text-sm font-medium text-stone-500 mt-1">{t("Ready for commercial invoicing")}</p>
               </div>
               <div className="px-3 py-1 bg-blue-50 text-blue-600 rounded-lg text-xs font-bold font-mono">
                 {unbilled.length} {t("PENDING")}
               </div>
            </div>

            {unbilled.length === 0 ? (
               <div className="p-12 text-center border border-stone-200 border-dashed rounded-[2rem] bg-stone-50/50">
                  <CheckCircle2 className="w-12 h-12 text-stone-300 mx-auto mb-4" />
                  <div className="font-bold text-stone-600">{t("All deliveries are billed")}</div>
               </div>
            ) : (
               <div className="space-y-4">
                  {unbilled.map(dn => (
                     <div key={dn.id} className="p-6 bg-white border border-stone-200 rounded-3xl shadow-sm hover:shadow-md hover:border-stone-300 transition-all flex justify-between items-center group">
                        <div>
                           <div className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-1.5 flex gap-2">
                             <span>DN: {dn.dn_number}</span>
                             <span className="text-emerald-500">{t("DELIVERED")}</span>
                           </div>
                           <div className="text-lg font-bold text-stone-900 tracking-tight">{dn.customer_name}</div>
                           <div className="text-sm font-medium text-stone-500 mt-0.5">{dn.project_name || 'Non-Project'}</div>
                        </div>
                        <button onClick={() => handleSelectDn(dn)} className="w-10 h-10 rounded-xl bg-stone-100 flex items-center justify-center text-stone-600 group-hover:bg-stone-800 group-hover:text-white transition-colors animate-none">
                           <ArrowRight className="w-5 h-5" />
                        </button>
                     </div>
                  ))}
               </div>
            )}
         </div>

         <div className="space-y-6">
            <div className="border-b border-stone-200 pb-4 flex justify-between items-center">
               <div>
                  <h2 className="text-xl font-bold text-stone-900 tracking-tight">{t("Commercial Invoices")}</h2>
                  <p className="text-sm font-medium text-stone-500 mt-1">{t("Issued billing records")}</p>
               </div>
               <Button 
                  onClick={() => setShowRegisterBankModal(true)}
                  variant="secondary"
                  className="text-xs py-2 px-4 flex items-center gap-2 rounded-xl border border-stone-200"
               >
                  {t("Register Account Bank")}
               </Button>
            </div>
            
            <div className="border border-stone-200 rounded-[2rem] bg-white overflow-hidden shadow-sm">
               {invoices.length === 0 ? (
                 <div className="p-12 text-center">
                    <FileText className="w-12 h-12 text-stone-300 mx-auto mb-4" />
                    <div className="font-bold text-stone-600">{t("No invoices issued yet")}</div>
                 </div>
               ) : (
                 <table className="w-full text-left">
                    <thead>
                       <tr className="bg-stone-50 border-b border-stone-200 text-[10px] font-bold uppercase tracking-widest text-stone-500">
                          <th className="px-6 py-4">{t("Invoice Ref")}</th>
                          <th className="px-6 py-4 text-right">{t("Amount (IDR)")}</th>
                          <th className="px-6 py-4 w-20 text-center">{t("Action")}</th>
                       </tr>
                    </thead>
                    <tbody>
                       {invoices.map(inv => (
                          <tr key={inv.id} className="border-b border-stone-100 last:border-0 hover:bg-stone-50/50">
                             <td className="px-6 py-5">
                                <div className="text-sm font-bold font-mono text-stone-900">{inv.ci_number}</div>
                                <div className="text-[10px] font-bold text-stone-400 mt-1 uppercase tracking-wider">{inv.customer_name}</div>
                             </td>
                             <td className="px-6 py-5 text-right font-mono font-bold text-stone-900">
                                <b>{formatIDR(inv.amount)}</b>
                                {inv.status === 'PAID' ? (
                                   <div className="text-[10px] text-emerald-600 font-bold font-sans mt-0.5">PAID</div>
                                ) : (
                                   <div className="text-[10px] text-amber-600 font-bold font-sans mt-0.5">UNPAID</div>
                                )}
                             </td>
                             <td className="px-6 py-5 text-center">
                                <div className="flex items-center justify-center gap-2">
                                  <Button 
                                     size="xs"
                                     action="view"
                                     onClick={() => setPreviewInvoice(inv)}
                                  />
                                  {inv.status !== 'PAID' && (
                                     <Button 
                                        size="xs"
                                        variant="primary"
                                        onClick={() => {
                                          setSelectedInvoiceForPay(inv);
                                          setShowPayModal(true);
                                        }}
                                        title={t("Mark as Paid")}
                                     >
                                        <Coins className="w-3.5 h-3.5" />
                                     </Button>
                                  )}
                                </div>
                             </td>
                          </tr>
                       ))}
                    </tbody>
                 </table>
               )}
            </div>

            {/* Added Bank Accounts Table */}
            <div className="border border-stone-200 rounded-[2rem] bg-white overflow-hidden shadow-sm mt-8">
               <h3 className="px-6 py-4 bg-stone-50 border-b border-stone-200 text-[10px] font-bold uppercase tracking-widest text-stone-500">Bank Accounts Registry</h3>
               {bankAccounts.length === 0 ? (
                 <div className="p-6 text-center">
                    <div className="font-bold text-stone-600 text-sm">No banks registered</div>
                 </div>
               ) : (
                 <table className="w-full text-left text-sm">
                    <tbody>
                       {bankAccounts.map(b => (
                          <tr key={b.id} className="border-b border-stone-100 last:border-0 hover:bg-stone-50/50">
                             <td className="px-6 py-4">
                               <div className="font-bold text-stone-900">{b.bank_name}</div>
                               <div className="text-xs text-stone-500 font-mono mt-0.5">{b.account_number}</div>
                             </td>
                             <td className="px-6 py-4">
                               <div className="font-semibold text-stone-700">{b.account_holder}</div>
                               {b.branch && <div className="text-xs text-stone-400 mt-0.5">{b.branch}</div>}
                             </td>
                             <td className="px-6 py-4 text-right">
                               {deletingBankId === b.id ? (
                                 <div className="flex items-center gap-2 justify-end">
                                   <Button 
                                     size="xs"
                                     action="cancel"
                                     onClick={() => setDeletingBankId(null)}
                                   />
                                   <Button 
                                     size="xs"
                                     action="delete"
                                     onClick={() => {
                                       handleDeleteBank(b.id);
                                       setDeletingBankId(null);
                                     }}
                                   />
                                 </div>
                               ) : (
                                 <Button 
                                   size="xs"
                                   variant="danger_soft"
                                   onClick={() => setDeletingBankId(b.id)} 
                                   title={t('Hapus')}
                                 >
                                   <Trash2 className="w-3.5 h-3.5" />
                                 </Button>
                               )}
                             </td>
                          </tr>
                       ))}
                    </tbody>
                 </table>
               )}
            </div>
         </div>
      </div>

      {/* Confirmation & Generation Modal */}
      <Modal
        isOpen={showInvoiceModal && !!selectedDn}
        onClose={() => setShowInvoiceModal(false)}
        title={t("Konfirmasi Pembuatan Invoice")}
        description={t("Silakan tinjau dan lengkapi rincian komersial di bawah untuk menerbitkan tagihan resmi.")}
        maxWidth="4xl"
        contentClassName="p-0 border-t border-stone-100 overflow-hidden"
      >
        <form onSubmit={handleCreateInvoice} className="p-6 md:p-8 bg-white font-sans text-stone-900">
           <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              
              {/* Left Column: Input Panel (7 of 12 Cols) */}
              <div className="col-span-12 lg:col-span-7 space-y-6">
                 <div className="pb-3 border-b border-stone-200">
                    <h3 className="text-xs font-bold uppercase text-stone-850 tracking-wider">
                       {t("Rincian Parameter Invoice")}
                    </h3>
                 </div>

                 {/* Base Logistics Info Document Card - Extremely clean minimalist border style */}
                 <div className="bg-stone-50 border border-stone-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 font-sans">
                    <div>
                       <div className="text-[8px] uppercase font-bold text-stone-400 tracking-wider">{t("Surat Jalan Asal")}</div>
                       <div className="text-xs font-bold font-mono text-stone-850 mt-1">{selectedDn?.dn_number}</div>
                    </div>
                    <div className="text-left sm:text-right pt-2 sm:pt-0 border-t sm:border-t-0 border-stone-200">
                       <div className="text-[8px] uppercase font-bold text-stone-400 tracking-wider">{t("Nama Pelanggan")}</div>
                       <div className="text-xs font-bold text-stone-800 uppercase mt-1 truncate max-w-[200px]" title={selectedDn?.customer_name}>
                          {selectedDn?.customer_name}
                       </div>
                    </div>
                 </div>

                 {/* Linked Quotation Selector */}
                 <div className="space-y-1.5">
                    <div className="flex justify-between items-center">
                       <label className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">
                          {t("Tautkan Penawaran Harga (Link Quotation)")}
                       </label>
                       <span className="text-[8px] text-stone-400 font-bold uppercase tracking-wider">{t("Opsional")}</span>
                    </div>
                    <div className="relative">
                       <select
                          value={selectedQuoId}
                          onChange={e => {
                             const quoId = e.target.value;
                             setSelectedQuoId(quoId);
                             const matched = quotations.find(q => q.id === quoId);
                             if (matched) {
                                setAmount(matched.amount.toString());
                                setDisplayAmount(formatNumberWithDots(matched.amount.toString()));
                                setJobDescription(matched.title);
                             }
                          }}
                          className="w-full px-3 py-2.5 bg-white border border-stone-250 text-xs text-stone-900 rounded-md focus:border-stone-800 outline-none transition-all appearance-none cursor-pointer"
                       >
                          <option value="" className="text-stone-400 font-sans font-medium">-- {t("Pilih Penawaran Terhubung")} --</option>
                          {quotations
                             .filter(q => q.customer_id === selectedDn?.customer_id)
                             .map(q => (
                                <option key={q.id} value={q.id} className="font-sans font-bold text-stone-800">
                                   [{q.quotation_number}] {q.title} - {formatIDR(Number(q.amount || 0))}
                                </option>
                             ))
                          }
                       </select>
                       <div className="absolute inset-y-0 right-3.5 flex items-center pointer-events-none text-stone-400">
                          <span className="text-[9px]">▼</span>
                       </div>
                    </div>
                 </div>

                 {/* Job Description (Full Width) */}
                 <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">
                       {t("Deskripsi Pekerjaan (Job Description)")} <span className="text-stone-400">*</span>
                    </label>
                    <input 
                       type="text" 
                       required
                       value={jobDescription}
                       onChange={e => setJobDescription(e.target.value)}
                       className="w-full px-3 py-2.5 bg-white border border-stone-250 text-xs text-stone-900 rounded-md focus:border-stone-800 outline-none transition-all placeholder-stone-400"
                       placeholder={t("e.g. Nama Proyek / Deskripsi Pekerjaan")}
                    />
                 </div>

                 {/* Financial Details & Terms (Grid 2-column) */}
                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                       <label className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">
                          {t("Nilai Tagihan Pokok (Rp)")} <span className="text-stone-400">*</span>
                       </label>
                       <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-stone-400 font-mono">Rp</span>
                          <input 
                             type="text" 
                             required
                             value={displayAmount}
                             onChange={handleAmountChange}
                             className="w-full pl-8 pr-3 py-2.5 bg-white border border-stone-250 text-xs font-bold font-mono text-stone-900 rounded-md focus:border-stone-800 outline-none transition-all"
                             placeholder="0"
                          />
                       </div>
                    </div>

                    <div className="space-y-1.5">
                       <label className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">
                          {t("Syarat Pembayaran")} <span className="text-stone-400">*</span>
                       </label>
                       <input 
                          type="text" 
                          required
                          value={paymentTerms}
                          onChange={e => setPaymentTerms(e.target.value)}
                          className="w-full px-3 py-2.5 bg-white border border-stone-250 text-xs text-stone-900 rounded-md focus:border-stone-800 outline-none transition-all"
                          placeholder="e.g. Net 30, COD"
                       />
                    </div>
                 </div>

                 {/* Taxes Matrix (Grid 2-column) */}
                 <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                       <label className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">
                          {t("Tarif PPN (%)")}
                       </label>
                       <div className="relative">
                          <input 
                             type="number" 
                             min="0"
                             max="100"
                             required
                             value={ppnRate}
                             onChange={e => setPpnRate(e.target.value)}
                             className="w-full pl-3 pr-8 py-2.5 bg-white border border-stone-250 text-xs font-bold font-mono text-stone-900 rounded-md focus:border-stone-800 outline-none transition-all"
                             placeholder="12"
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-stone-400 font-mono">%</span>
                       </div>
                    </div>
                    
                    <div className="space-y-1.5">
                       <label className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">
                          {t("Tarif PPh (%)")}
                       </label>
                       <div className="relative">
                          <input 
                             type="number" 
                             min="0"
                             max="100"
                             required
                             value={pphRate}
                             onChange={e => setPphRate(e.target.value)}
                             className="w-full pl-3 pr-8 py-2.5 bg-white border border-stone-250 text-xs font-bold font-mono text-stone-900 rounded-md focus:border-stone-800 outline-none transition-all"
                             placeholder="2"
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-stone-400 font-mono">%</span>
                       </div>
                    </div>
                 </div>

                 {/* Destination Bank Select Field */}
                 <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">
                       {t("Tujuan Rekening Bank")} <span className="text-stone-400">*</span>
                    </label>
                    <div className="relative">
                       <select
                          required
                          value={bankAccountId}
                          onChange={e => setBankAccountId(e.target.value)}
                          className="w-full px-3 py-2.5 bg-white border border-stone-250 text-xs font-bold text-stone-900 rounded-md focus:border-stone-800 outline-none transition-all appearance-none cursor-pointer"
                       >
                          {bankAccounts.length === 0 ? (
                             <option value="BNK-DEFAULT" className="font-mono">MANDIRI 1240009876543</option>
                          ) : (
                             bankAccounts.map(b => (
                                <option key={b.id} value={b.id} className="font-mono">
                                   {b.bank_name} - {b.account_number} ({b.account_holder})
                                </option>
                             ))
                          )}
                       </select>
                       <div className="absolute inset-y-0 right-3.5 flex items-center pointer-events-none text-stone-400">
                          <span className="text-[9px]">▼</span>
                       </div>
                    </div>
                 </div>
              </div>

              {/* Right Column: Calculations & Submission Actions (5 of 12 Cols) */}
              <div className="col-span-12 lg:col-span-5 space-y-6">
                 <div className="pb-3 border-b border-stone-200">
                    <h3 className="text-xs font-bold uppercase text-stone-850 tracking-wider">
                       {t("Lembar Kalkulasi")}
                    </h3>
                 </div>

                 {/* Receipt simulation canvas - purely stone grayscale */}
                 <div className="bg-stone-50 border border-stone-200 rounded-lg p-5 space-y-4">
                    <div className="flex justify-between items-center pb-2 border-b border-stone-200">
                       <span className="text-[9px] font-bold uppercase tracking-wider text-stone-400">{t("Rincian Pajak & Tagihan")}</span>
                       <span className="text-[8px] bg-stone-200 text-stone-700 font-mono font-bold px-2 py-0.5 rounded tracking-wider">
                          LIVE
                       </span>
                    </div>

                    <div className="space-y-2 pt-1 text-[11px]">
                       <div className="flex justify-between items-center text-stone-450">
                          <span>{t("Subtotal DPP:")}</span>
                          <span className="font-medium font-mono text-stone-600">{formatIDRWithDecimals(subtotalVal, 2)}</span>
                       </div>
                       <div className="flex justify-between items-center text-stone-450">
                          <span>PPN ({ppnRate || 0}%)</span>
                          <span className="font-medium font-mono text-stone-600">+ {formatIDRWithDecimals(ppnVal, 2)}</span>
                       </div>
                       <div className="flex justify-between items-center text-stone-450">
                          <span>PPh ({pphRate || 0}%)</span>
                          <span className="font-medium font-mono text-stone-600">- {formatIDRWithDecimals(pphVal, 2)}</span>
                       </div>

                        <div className="flex justify-between items-center text-stone-450">
                           <span>{language === 'id' ? 'Factor Pembulatan' : 'Rounding Factor'}</span>
                           <span className="font-medium font-mono text-stone-600">{formatIDRWithDecimals(roundingFactorVal, 2)}</span>
                        </div>

                        <div className="h-px border-t border-stone-200 my-2"></div>

                       <div className="flex justify-between items-center pt-1">
                          <span className="text-[9px] font-bold uppercase tracking-wider text-stone-500">{t("Total Tagihan")}</span>
                          <span className="text-sm font-extrabold font-mono text-stone-900">{formatIDRWithDecimals(grandTotalVal, 2)}</span>
                       </div>
                    </div>
                 </div>

                 {/* Helpful Instruction Details Container - Extremely minimalist bullet list */}
                 <div className="bg-stone-50 border border-stone-200 rounded-lg p-4 text-[10px] text-stone-500 leading-relaxed space-y-2">
                    <div className="flex items-start gap-2">
                       <span className="text-stone-400 font-bold">•</span>
                       <div>
                          <span className="font-bold text-stone-750">{t("Nomor Seri Otomatis")}</span>: {t("Faktur komersial yang diterbitkan akan memiliki nomor urut otomatis berdasarkan standard akuntansi.")}
                       </div>
                    </div>

                    {selectedQuoId && (
                       <div className="flex items-start gap-2 border-t border-stone-200/60 pt-2">
                          <span className="text-stone-400 font-bold">•</span>
                          <div>
                             <span className="font-bold text-stone-750">{t("Penawaran Terhubung")}</span>: {t("Data jumlah tagihan dan deskripsi proyek telah disinkronisasikan langsung dari Quotation.")}
                          </div>
                       </div>
                    )}
                 </div>

                 {/* Action and Triggers Sidebar Footer block */}
                 <div className="flex items-center gap-3 pt-2">
                    <button 
                       disabled={isSubmitting} 
                       onClick={() => setShowInvoiceModal(false)} 
                       type="button" 
                       className="flex-1 py-2.5 bg-white hover:bg-stone-50 border border-stone-250 text-stone-500 hover:text-stone-800 text-[10px] uppercase font-bold tracking-wider rounded-md transition-all cursor-pointer text-center"
                    >
                       {t("Cancel")}
                    </button>
                    <button 
                       disabled={isSubmitting || !amount} 
                       type="submit" 
                       className="flex-[2] py-2.5 bg-stone-900 hover:bg-stone-800 text-white text-[10px] uppercase font-bold tracking-wider rounded-md transition-all cursor-pointer shadow-sm text-center disabled:opacity-50"
                    >
                       {isSubmitting ? t('Generating...') : t('Buat Invoice Resmi')}
                    </button>
                 </div>
              </div>

           </div>
        </form>
      </Modal>

      {/* Register Bank Account Modal */}
      <Modal
         isOpen={showRegisterBankModal}
         onClose={() => setShowRegisterBankModal(false)}
         title={t("Register Account Bank")}
         description={t("Daftarkan rekening bank tujuan sebagai media transfer pembayaran invoice resmi Anda.")}
         maxWidth="md"
         contentClassName="p-0 border-t border-stone-100"
      >
         <form onSubmit={handleRegisterBank} className="p-8 space-y-4">
            <div className="space-y-1.5">
               <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest ml-1">{t("Nama Bank (Bank Name)")}</label>
               <input 
                  type="text" 
                  required
                  placeholder="e.g. BANK MANDIRI, BCA, BNI"
                  value={newBank.bank_name}
                  onChange={e => setNewBank({ ...newBank, bank_name: e.target.value.toUpperCase() })}
                  className="w-full px-5 py-3.5 bg-stone-50 border border-stone-200 hover:bg-white hover:border-stone-300 rounded-2xl text-sm font-bold text-stone-900 focus:bg-white outline-none focus:border-stone-400 focus:ring-4 focus:ring-stone-100 transition-all shadow-sm"
               />
            </div>

            <div className="space-y-1.5">
               <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest ml-1">{t("Nomor Rekening (Account Number)")}</label>
               <input 
                  type="text" 
                  required
                  placeholder="e.g. 1240009876543"
                  value={newBank.account_number}
                  onChange={e => setNewBank({ ...newBank, account_number: e.target.value.replace(/[^\d]/g, '') })}
                  className="w-full px-5 py-3.5 bg-stone-50 border border-stone-200 hover:bg-white hover:border-stone-300 rounded-2xl text-sm font-bold font-mono text-stone-900 focus:bg-white outline-none focus:border-stone-400 focus:ring-4 focus:ring-stone-100 transition-all shadow-sm"
               />
            </div>

            <div className="space-y-1.5">
               <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest ml-1">{t("Nama Pemilik Rekening (Account Holder)")}</label>
               <input 
                  type="text" 
                  required
                  placeholder="e.g. CV BATU EMAS GROUP"
                  value={newBank.account_holder}
                  onChange={e => setNewBank({ ...newBank, account_holder: e.target.value.toUpperCase() })}
                  className="w-full px-5 py-3.5 bg-stone-50 border border-stone-200 hover:bg-white hover:border-stone-300 rounded-2xl text-sm font-bold text-stone-900 focus:bg-white outline-none focus:border-stone-400 focus:ring-4 focus:ring-stone-100 transition-all shadow-sm"
               />
            </div>

            <div className="space-y-1.5">
               <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest ml-1">{t("Kantor Cabang (Branch - Optional)")}</label>
               <input 
                  type="text" 
                  placeholder="e.g. Cabang Sudirman Jakarta"
                  value={newBank.branch}
                  onChange={e => setNewBank({ ...newBank, branch: e.target.value })}
                  className="w-full px-5 py-3.5 bg-stone-50 border border-stone-200 hover:bg-white hover:border-stone-300 rounded-2xl text-sm font-bold text-stone-900 focus:bg-white outline-none focus:border-stone-400 focus:ring-4 focus:ring-stone-100 transition-all shadow-sm"
               />
            </div>

            <div className="flex justify-end gap-3 pt-4">
               <button disabled={isSubmitting} onClick={() => setShowRegisterBankModal(false)} type="button" className="px-5 py-3 text-stone-400 hover:text-stone-900 text-xs font-bold uppercase tracking-widest rounded-xl transition-colors">{t("Batal")}</button>
               <button disabled={isSubmitting} type="submit" className="px-5 py-3 bg-stone-800 hover:bg-stone-900 text-white rounded-2xl text-xs font-bold uppercase tracking-widest transition-colors shadow-md">
                  {isSubmitting ? t('Mendaftarkan...') : t('Daftarkan Account')}
               </button>
            </div>
         </form>
      </Modal>

      {/* Premium Standardized Commercial Invoice PDF Preview Modal */}
      <Modal
         isOpen={!!previewInvoice}
         onClose={() => setPreviewInvoice(null)}
         title={t("Official Commercial Invoice")}
         maxWidth="5xl"
         contentClassName="p-0 flex flex-col h-[85vh] border-t border-stone-100 animate-none"
      >
         {previewInvoice && (
            <>
              <div className="flex-1 overflow-y-auto p-8 bg-stone-50 flex justify-center items-start">
                  <PrintTemplate
                     ref={printDocRef}
                     documentTitleId="FAKTUR PENAGIHAN"
                     documentTitleEn="COMMERCIAL INVOICE"
                     documentNameId="faktur penagihan"
                     documentNameEn="commercial invoice"
                     date={new Date(previewInvoice.created_at || Date.now()).toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', year: 'numeric', month: 'short', day: 'numeric' })}
                     referenceNumber={previewInvoice.ci_number}
                     documentId={previewInvoice.id}
                     hideDefaultFooter={true}
                  >
                     <div className="flex flex-col">
                        {/* Symmetric Info Grid */}
                        <div className="grid grid-cols-2 gap-6 mb-5">
                           {/* Left: Customer Info */}
                           <div className="p-3 bg-white border border-stone-200/50 rounded-lg space-y-1">
                              <div className="text-[9.5px] font-black tracking-widest uppercase text-stone-900 border-b border-stone-200/70 pb-1.5 mb-1.5">Ditujukan Kepada <span className="font-bold text-[8.5px] text-stone-400">/ BILLED TO</span></div>
                              <div className="text-sm font-black text-stone-900 leading-snug">{previewInvoice.customer_name}</div>
                              <div className="text-xs font-bold text-stone-600 leading-relaxed whitespace-pre-wrap">{previewInvoice.customer_address || "Pelanggan Umum"}</div>
                              {(previewInvoice.customer_phone || previewInvoice.customer_email) && (
                                 <div className="text-[10.5px] text-stone-500 font-bold pt-1.5 border-t border-stone-200/30 flex flex-wrap gap-x-2">
                                    {previewInvoice.customer_phone && <span>Telp: {previewInvoice.customer_phone}</span>}
                                    {previewInvoice.customer_email && <span>Email: {previewInvoice.customer_email}</span>}
                                 </div>
                              )}
                           </div>

                           {/* Right: Invoice Metadata */}
                           <div className="p-3 bg-white border border-stone-200/50 rounded-lg space-y-1">
                              <div className="text-[9.5px] font-black tracking-widest uppercase text-stone-900 border-b border-stone-200/70 pb-1.5 mb-1.5">Detail Rujukan <span className="font-bold text-[8.5px] text-stone-400">/ INVOICE METADATA</span></div>
                              
                              <div className="grid grid-cols-2 gap-y-1.5 gap-x-2 text-xs font-sans">
                                 <span className="text-stone-900 font-black uppercase tracking-wide">No. Invoice <span className="font-bold text-stone-400">/ Inv No</span></span>
                                 <span className="font-black font-mono text-stone-800 text-right">{previewInvoice.ci_number}</span>
                                 
                                 <span className="text-stone-900 font-black uppercase tracking-wide">Surat Jalan Ref <span className="font-bold text-stone-400">/ DN Ref</span></span>
                                 <span className="font-black text-stone-800 underline underline-offset-1 text-right">{previewInvoice.dn_number || '-'}</span>
                                 
                                 <span className="text-stone-900 font-black uppercase tracking-wide">Syarat Pembayaran <span className="font-bold text-stone-400">/ PO Terms</span></span>
                                 <span className="font-black text-stone-800 text-right">{previewInvoice.payment_terms || 'Net 30'}</span>
                                 
                                 <span className="text-stone-900 font-black uppercase tracking-wide">NPWP Pelanggan <span className="font-bold text-stone-400">/ Tax ID</span></span>
                                 <span className="font-black text-stone-805 text-right">-</span>
                              </div>
                           </div>
                        </div>

                        {/* Itemised Transactions Table */}
                        <div className="mb-5">
                           <table className="w-full text-left border-collapse">
                              <thead>
                                 <tr className="border-y border-stone-300 bg-white">
                                    <th className="py-2.5 px-3 font-extrabold text-stone-900 uppercase tracking-wider text-[9px] w-10 text-center">No</th>
                                    <th className="py-2.5 px-3 font-extrabold text-stone-900 uppercase tracking-wider text-[9px] w-32">Kode <span className="font-bold text-[7.5px] text-stone-500 block">/ CODE</span></th>
                                    <th className="py-2.5 px-3 font-extrabold text-stone-900 uppercase tracking-wider text-[9px]">Deskripsi Transaksi Pekerjaan <span className="font-bold text-[7.5px] text-stone-500 block">/ DESCRIPTION</span></th>
                                    <th className="py-2.5 px-3 font-extrabold text-stone-900 uppercase tracking-wider text-[9px] text-right w-16">Jumlah <span className="font-bold text-[7.5px] text-stone-500 block">/ QTY</span></th>
                                    <th className="py-2.5 px-3 font-extrabold text-stone-900 uppercase tracking-wider text-[9px] w-20">Satuan <span className="font-bold text-[7.5px] text-stone-500 block">/ UOM</span></th>
                                 </tr>
                              </thead>
                              <tbody>
                                 {previewInvoice.items && previewInvoice.items.length > 0 ? (
                                    previewInvoice.items.map((item: any, idx: number) => (
                                       <tr key={idx} className="border-b border-stone-200">
                                          <td className="py-2.5 px-3 text-[10px] font-bold text-center text-stone-500">{String(idx + 1).padStart(2, '0')}</td>
                                          <td className="py-2.5 px-3 font-mono text-[10px] font-black text-stone-600">{item.item_code}</td>
                                          <td className="py-2.5 px-3 text-[10px] font-black text-stone-900 leading-snug">{item.item_name}</td>
                                          <td className="py-2.5 px-3 text-[10px] font-black text-right font-mono text-stone-900">{item.qty}</td>
                                          <td className="py-2.5 px-3 text-[9px] tracking-widest uppercase font-black text-stone-500">{item.uom}</td>
                                       </tr>
                                    ))
                                 ) : (
                                    <tr className="border-b border-stone-200">
                                       <td className="py-3 px-3 text-xs font-bold text-center text-stone-400">01</td>
                                       <td className="py-3 px-3 font-mono text-xs font-bold text-stone-500">-</td>
                                       <td className="py-3 px-3 text-xs font-medium text-stone-900 leading-relaxed">
                                          {previewInvoice.job_description || previewInvoice.project_name || `Pengiriman Komoditas Niaga (Surat Jalan: ${previewInvoice.dn_number}) / Commercial Trade Delivery (DN: ${previewInvoice.dn_number})`}
                                       </td>
                                       <td className="py-3 px-3 text-xs font-bold text-right font-mono text-stone-900">1</td>
                                       <td className="py-3 px-3 text-[10.5px] font-bold text-stone-500 uppercase">Unit</td>
                                    </tr>
                                 )}
                              </tbody>
                           </table>
                        </div>

                        {/* Invoice Summary and Tax Calculations */}
                        {(() => {
                           const dppVal = previewInvoice.amount || 0;
                           const ppnReal = dppVal * ((previewInvoice.ppn_rate || 0) / 100);
                           const pphReal = dppVal * ((previewInvoice.pph_rate || 0) / 100);
                           const unroundedInvoiceTotal = dppVal + ppnReal - pphReal;
                           const roundedInvoiceTotal = Math.floor(unroundedInvoiceTotal);
                           const invoiceRoundingFactor = roundedInvoiceTotal - unroundedInvoiceTotal;

                           return (
                              <div className="mt-4 flex justify-between items-start gap-4 mb-5 w-full">
                                 {/* Dynamic Terbilang Row on the left */}
                                 <div className="flex-1 bg-white p-2.5 rounded-xl border border-stone-200/50">
                                    <span className="text-[6.5px] font-extrabold uppercase tracking-wider text-stone-900 mr-2 block mb-1">Terbilang <span className="font-normal text-[6px] text-stone-400">/ IN WORDS:</span></span>
                                    <span className="text-[7.2px] font-semibold text-stone-600 italic uppercase">
                                       {angkaKeTerbilang(roundedInvoiceTotal)} Rupiah
                                    </span>
                                 </div>

                                 <div className="w-72 space-y-1.5">
                                    <div className="flex justify-between items-center text-[7px] text-stone-900 font-bold uppercase tracking-widest px-2">
                                       <span>Subtotal DPP <span className="font-normal text-[6px] text-stone-400">/ Gross</span></span>
                                       <span className="font-mono text-stone-600">{formatIDRWithDecimals(dppVal, 2)}</span>
                                    </div>
                                    <div className="flex justify-between items-center text-[7px] text-stone-900 font-bold uppercase tracking-widest px-2">
                                       <span>PPN <span className="font-normal text-[6px] text-stone-400">/ VAT (12%)</span></span>
                                       <span className="font-mono text-stone-600">+ {formatIDRWithDecimals(ppnReal, 2)}</span>
                                     </div>
                                    <div className="flex justify-between items-center text-[7px] text-stone-900 font-bold uppercase tracking-widest px-2">
                                       <span>PPH <span className="font-normal text-[6px] text-stone-400">/ INC TAX (2%)</span></span>
                                       <span className="font-mono text-stone-600">- {formatIDRWithDecimals(pphReal, 2)}</span>
                                    </div>
                                    <div className="flex justify-between items-center text-[7px] text-stone-900 font-bold uppercase tracking-widest px-2 pb-1.5 border-b border-stone-150">
                                       <span>FACTOR PEMBULATAN <span className="font-normal text-[6px] text-stone-400">/ ROUNDING FACTOR</span></span>
                                       <span className="font-mono text-stone-600">{formatIDRWithDecimals(invoiceRoundingFactor, 2)}</span>
                                    </div>
                                    <div className="flex justify-between items-center bg-white text-stone-900 p-2.5 rounded-xl border border-stone-200/80 shadow-xs">
                                       <span className="text-[7.5px] font-extrabold uppercase tracking-wider text-stone-900">GRAND TOTAL <span className="font-normal text-[6px] text-stone-400">/ TOTAL</span></span>
                                       <span className="text-xs font-black tracking-tight font-mono text-stone-900">
                                          {formatIDRWithDecimals(roundedInvoiceTotal, 2)}
                                       </span>
                                    </div>
                                 </div>
                              </div>
                           );
                        })()}

                        {/* Payment Instructions Card */}
                        <div className="p-3 bg-white border border-stone-200/60 rounded-lg space-y-1.5 mt-auto">
                           <div className="text-[8px] font-bold uppercase tracking-widest text-[#006097] flex items-center gap-1">
                              
                              {t("REKENING TUJUAN TRANSFER / BANKING DETAILS")}
                           </div>
                           <div className="grid grid-cols-3 gap-2 text-[9px] font-medium text-stone-700 bg-white/75 p-2 rounded-md border border-stone-200/40">
                              <div>
                                 <span className="text-stone-400 block text-[7.5px] font-bold uppercase">{t("NAMA BANK / BANK")}</span>
                                 <span className="font-bold text-stone-900">{previewInvoice.bank_name || 'BANK MANDIRI'}</span>
                                 {previewInvoice.branch && <span className="text-stone-500 text-[8px] block mt-0.5 font-medium">({previewInvoice.branch})</span>}
                              </div>
                              <div>
                                 <span className="text-stone-400 block text-[7.5px] font-bold uppercase">{t("NOMOR REKENING / ACCOUNT")}</span>
                                 <span className="font-bold font-mono text-stone-900 tracking-wider text-[9.5px]">{previewInvoice.account_number || '1240009876543'}</span>
                              </div>
                              <div>
                                 <span className="text-stone-400 block text-[7.5px] font-bold uppercase">{t("ATAS NAMA / BENEFICIARY")}</span>
                                 <span className="font-bold text-stone-900 truncate block" title={previewInvoice.account_holder || 'CV BATU EMAS GROUP'}>
                                    {previewInvoice.account_holder || 'CV BATU EMAS GROUP'}
                                 </span>
                              </div>
                           </div>
                           <div className="text-[8.5px] leading-relaxed italic px-1 font-bold">
                              <span className="text-stone-700 block">* Harap cantumkan nomor invoice <span className="font-extrabold text-stone-900 underline">{previewInvoice.ci_number}</span> dalam rincian keterangan transfer. Faktur ini sah diproses secara elektronik sesuai ketentuan perpajakan.</span>
                              <span className="text-stone-400 font-normal block mt-1">/ Please specify reference invoice number <span className="font-semibold text-stone-500">{previewInvoice.ci_number}</span> in transfer remarks. Document generated and verified officially.</span>
                           </div>
                        </div>
                     </div>

                     <div className="mt-auto space-y-4 pt-6">
                       {/* Standardized Signatures Block */}
                       <div className="flex justify-end pt-4 border-t border-stone-200">
                           <div className="text-center font-sans w-64">
                              <div className="text-[8px] text-stone-900 uppercase tracking-widest font-bold mb-4">Disetujui Oleh <span className="text-stone-400 font-normal">/ Approved By</span></div>
                              <div className="flex justify-center gap-4 mb-2">
                                 <div className="w-16 h-16 bg-white font-mono text-[7px] text-stone-300 flex items-center justify-center border border-dashed border-stone-200">[SIGN]</div>
                              </div>
                              <p className="text-[9px] font-bold text-stone-950 uppercase">Manager Keuangan <span className="text-stone-400 font-normal">/ Finance Manager</span></p>
                              <div className="pt-1.5 flex flex-col justify-center items-center">
                                 <div className="w-48 border-b border-stone-300 mb-0.5"></div>
                                 <span className="text-[7.5px] text-stone-500 font-bold uppercase tracking-wider">TANGGAL / DATE: ____/____/2026</span>
                              </div>
                           </div>
                       </div>

                        {/* Legal Note Footer Disclaimer */}
                        <div className="pt-3 border-t border-stone-105 text-[8px] text-center uppercase tracking-widest leading-relaxed font-bold shrink-0">
                           <span className="text-stone-700">Invoice ini adalah dokumen penagihan resmi yang wajib diverifikasi dan dibubuhi cap basah perusahaan.</span>
                           <span className="text-stone-400 font-normal block mt-1">/ This invoice is an official billing instrument requiring physical verification and company stamp.</span>
                        </div>
                     </div>
                  </PrintTemplate>
               </div>
               <div className="p-6 border-t border-stone-100 bg-white flex justify-center gap-4 shrink-0">
                  <Button 
                    variant="secondary"
                    onClick={() => setPreviewInvoice(null)}
                    className="px-6 py-2.5 rounded-xl text-sm"
                  >
                     {t("Close")}
                  </Button>
                  <Button 
                    variant="primary"
                    onClick={() => exportInvoicePdf()} 
                    isLoading={isSubmittingPdf}
                    className="px-6 py-2.5 rounded-xl text-sm shadow-md"
                  >
                     {!isSubmittingPdf && <Download className="w-4 h-4" />} 
                     {isSubmittingPdf ? t("Exporting...") : t("Export PDF (A4)")}
                  </Button>
               </div>
            </>
         )}
      </Modal>

      {/* Pay Invoice Modal */}
      <Modal
        isOpen={showPayModal && !!selectedInvoiceForPay}
        onClose={() => {
          setShowPayModal(false);
          setAuthPin('');
          setSelectedInvoiceForPay(null);
        }}
        title={t("Confirm Invoice Payment")}
        description={t("Log payment receipt and centrally record revenue in the Finance Hub.")}
        maxWidth="md"
        contentClassName="p-0 border-t border-stone-100"
      >
        {selectedInvoiceForPay && (
          <form onSubmit={handlePayInvoice} className="font-sans text-stone-900 bg-white">
            <div className="p-6 md:p-8 space-y-6 text-sm">
              <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 flex flex-col gap-1 items-center justify-center text-center">
                <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">{t("Total Billed (Customer Payment)")}</span>
                <span className="text-xl font-bold font-mono text-emerald-950">{formatIDR(selectedInvoiceForPay.amount)}</span>
                <span className="text-xs font-medium text-emerald-800">{selectedInvoiceForPay.customer_name} - {selectedInvoiceForPay.ci_number}</span>
              </div>
              <div className="space-y-2 pt-2 border-t border-stone-100">
                <label className="text-[10px] font-bold text-stone-500 uppercase tracking-wider block">
                   {t("Digital Authorization (PIN)")}
                </label>
                <p className="text-xs text-stone-600 mb-3 leading-relaxed">
                  {t("Please enter your 6-digit PIN to authorize this revenue. Once confirmed, the invoice status will be set to PAID and entered into the Finance Hub Revenue log.")}
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
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-stone-300 disabled:text-stone-500 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest transition-colors shadow-sm cursor-pointer"
              >
                {isSubmitting ? t('Processing...') : t('Confirm Paid')}
              </button>
            </div>
          </form>
        )}
      </Modal>

    </div>
  );
}
