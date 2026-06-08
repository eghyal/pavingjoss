import { fileURLToPath } from 'url';
import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { apiFetch } from '@/utils/api';
import { getDailyAuthKey } from '@/utils/auth';
import { FileText, Plus, Search, ChevronRight, CheckCircle2, AlertTriangle, Filter, RefreshCw, Briefcase, TrendingUp, Sparkles, Bot } from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { CreateQuotationModal } from '@/components/erp/CreateQuotationModal';
import { QuotationPreviewModal } from '@/components/erp/QuotationPreviewModal';
import { ConfirmModal } from '@/components/shared/ConfirmModal';
import { HasRole } from '@/components/shared/HasRole';
import { Action, hasPermission, hasGodMode } from '@/utils/pbac';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/lib/utils';
import { formatIDR } from '@/lib/utils';

export default function Quotations() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [quotations, setQuotations] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedQuotation, setSelectedQuotation] = useState<any>(null);
  const [revisingQuotation, setRevisingQuotation] = useState<any>(null);
  const [confirmModal, setConfirmModal] = useState<any>(null);

  const [showAuthorizeModal, setShowAuthorizeModal] = useState(false);
  const [showReviseModal, setShowReviseModal] = useState(false);
  const [revisionNote, setRevisionNote] = useState('');
  const [selectedQuoToAuth, setSelectedQuoToAuth] = useState<any>(null);
  const [authPin, setAuthPin] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [showAiBuilder, setShowAiBuilder] = useState(false);

  const handleDirectAIGenerate = async () => {
    if(!aiPrompt) return;
    setAiLoading(true);
    try {
      const res = await apiFetch("/api/quotations/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: aiPrompt, directCreate: true})
      }, user?.username);
      
      if(res.ok && res.data) {
        showToast("Draft Quotation Created by Engine", "success");
        setAiPrompt("");
        setShowAiBuilder(false);
        fetchQuotations();
      } else {
        showToast(res.error || "Failed to generate quotation", "error");
      }
    } catch(err) {
      showToast("Error processing AI request", "error");
    } finally {
      setAiLoading(false);
    }
  };

  const fetchQuotations = async () => {
    setIsLoading(true);
    try {
      const res = await apiFetch('/api/quotations', {}, user?.username);
      if (res.ok) {
        setQuotations(Array.isArray(res.data) ? res.data : (res.data?.data || []));
      } else {
        showToast("Failed to fetch quotations", "error");
      }
    } catch(err) {
      showToast("Connection error", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteQuotation = (id: string) => {
    setConfirmModal({
      isOpen: true,
      title: "Delete Quotation?",
      message: "Are you sure you want to delete this quotation? This action cannot be undone.",
      action: async () => {
        try {
          const res = await apiFetch(`/api/quotations/${id}`, { method: 'DELETE' }, user?.username);
          if (res.ok) {
            fetchQuotations();
            showToast("Quotation deleted successfully", "success");
          } else {
            showToast(res.error || "Failed to delete quotation", "error");
          }
        } catch (err) {
          console.error(err);
          showToast("Error deleting quotation", "error");
        }
      }
    });
  };

  const handleAuthorize = async (e: React.FormEvent) => {
    e.preventDefault();
    if (authPin !== getDailyAuthKey(user?.username)) {
      showToast('Validation Failed: Invalid Authorization PIN.', 'error');
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await apiFetch(`/api/quotations/${selectedQuoToAuth.id}/authorize`, {
        method: 'POST',
        body: JSON.stringify({ pin: authPin })
      }, user?.username);
      if (res.ok) {
        setShowAuthorizeModal(false);
        setAuthPin('');
        fetchQuotations();
        showToast('Quotation authorized successfully', 'success');
      } else {
        showToast(res.error || 'Failed to authorize quotation', 'error');
      }
    } catch (err) {
       console.error(err);
       showToast('Server error while authorizing', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRevise = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!revisionNote.trim()) {
      showToast('Validation Failed: Revision note is required.', 'error');
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await apiFetch(`/api/quotations/${selectedQuoToAuth.id}/revise`, {
        method: 'POST',
        body: JSON.stringify({ pin: getDailyAuthKey(user?.username), revision_note: revisionNote })
      }, user?.username);
      if (res.ok) {
        setShowReviseModal(false);
        setRevisionNote('');
        fetchQuotations();
        showToast('Quotation marked for revision', 'success');
      } else {
        showToast(res.error || 'Failed to marking quotation for revision', 'error');
      }
    } catch (err) {
       console.error(err);
       showToast('Server error while revising quotation', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    fetchQuotations();
  }, []);

  const filtered = useMemo(() => {
    return quotations.filter(q => {
      const matchesSearch = (q.title || '').toLowerCase().includes(searchQuery.toLowerCase()) || 
        (q.quotation_number || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (q.customer_name || '').toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesFilter = filterStatus === 'ALL' || q.status === filterStatus;
      
      return matchesSearch && matchesFilter;
    });
  }, [quotations, searchQuery, filterStatus]);

  const totalAmount = useMemo(() => quotations.reduce((sum, q) => sum + (q.amount || 0), 0), [quotations]);
  const pendingCount = quotations.filter(q => q.status === 'PENDING').length;

  return (
    <div className="space-y-12 animate-in fade-in duration-500 pb-20">
      <PageHeader 
        title="Quotations" 
        subtitle="Manage sales quotations and proposals"
        icon={<FileText className="w-6 h-6" />}
        actions={
          hasPermission(user, Action.SALES_ACTION) && (
            <button 
              onClick={() => setShowCreateModal(true)}
              className="h-12 px-6 bg-stone-900 text-white text-sm font-bold rounded-2xl hover:bg-stone-800 transition-all shadow-md hover:shadow-lg active:scale-95 flex items-center gap-2"
            >
              <Plus className="w-5 h-5" /> New Quotation
            </button>
          )
        }
      />

      <div className="flex flex-col md:flex-row gap-4 items-center mb-4 border-b border-stone-100 pb-8">
        <div className="flex justify-between items-center bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3 cursor-pointer select-none hover:bg-indigo-100 transition-colors w-full" onClick={() => setShowAiBuilder(!showAiBuilder)}>
          <div className="flex items-center gap-3">
            <div className="bg-indigo-100 p-2 rounded-lg">
              <Sparkles className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <div className="text-xs font-bold text-indigo-900 uppercase tracking-widest block flex items-center gap-1.5">
                Generative AI-Assisted No-Code Builder
                <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-700 text-[8px] font-extrabold rounded-md border border-indigo-200">BETA / TAHAP PENGEMBANGAN</span>
              </div>
              <div className="text-[10px] font-medium text-indigo-700">Hyper-Agility: Create quotation drafts directly via human language (Fitur dalam tahap uji coba)</div>
            </div>
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={(e) => { e.stopPropagation(); setShowAiBuilder(!showAiBuilder); }} className="bg-white border-indigo-200 text-indigo-700 hover:bg-indigo-50">
            {showAiBuilder ? 'Close Engine' : 'Launch Engine'}
          </Button>
        </div>
      </div>

      {showAiBuilder && (
        <div className="bg-indigo-50 border border-indigo-100 p-5 md:p-6 rounded-3xl relative overflow-hidden mb-8 shadow-sm">
           <div className="absolute top-0 right-0 p-8 opacity-5 pointer-events-none">
              <Sparkles className="w-48 h-48 text-indigo-600" />
           </div>
           <div className="relative z-10 w-full">
              <div className="mb-4">
                <h4 className="text-sm font-bold text-indigo-900">Start from a Draft</h4>
                <p className="text-xs text-indigo-700">Describe what you need. AI will map out the items, quantities, and prices, and generate a new Draft Quotation directly into your board.</p>
              </div>
              
              <div className="bg-white p-2 rounded-2xl shadow-sm border border-indigo-200 focus-within:ring-4 ring-indigo-500/20 transition-all flex flex-col pt-3">
                 <textarea
                   className="w-full bg-transparent border-none outline-none resize-none px-4 text-stone-700 placeholder-stone-400 text-sm h-32"
                   placeholder="Example: Tolong buatkan quotation untuk customer 'PT Teknologi Jaya'. Item 1: Jasa Audit Keamanan (20 juta, 1 lot). Item 2: Instalasi Server (5 juta, 2 unit). Diskon 10% dan pajak 12%. Berlaku 30 hari."
                   value={aiPrompt}
                   onChange={e => setAiPrompt(e.target.value)}
                   disabled={aiLoading}
                 ></textarea>
                 <div className="flex justify-between p-3 bg-stone-50/50 border-t border-stone-100 items-center rounded-b-xl">
                    <span className="text-[10px] text-stone-400 font-medium">Shift + Enter to add new line</span>
                    <Button 
                      type="button"
                      onClick={handleDirectAIGenerate}
                      disabled={aiLoading || !aiPrompt}
                      className="bg-indigo-600 text-white hover:bg-indigo-700 font-bold px-6 py-2 shadow-sm"
                    >
                      {aiLoading ? <span className="animate-pulse">Synthesizing Draft...</span> : (
                         <>
                           <Bot className="w-4 h-4 mr-2" />
                           Generate Draft Quotation
                         </>
                      )}
                    </Button>
                 </div>
              </div>
           </div>
        </div>
      )}

      <div className="flex flex-col md:flex-row gap-4 items-center mb-8 border-b border-stone-100 pb-8">
        <div className="bg-white p-4 rounded-2xl border border-stone-200 shadow-sm flex items-center gap-4 min-w-[160px] flex-1 md:flex-none">
          <div className="w-10 h-10 rounded-xl bg-stone-50 flex items-center justify-center">
            <FileText className="w-5 h-5 text-stone-600" />
          </div>
          <div>
            <div className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Total Quotations</div>
            <div className="text-lg font-bold text-stone-900">{quotations.length}</div>
          </div>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-stone-200 shadow-sm flex items-center gap-4 min-w-[160px] flex-1 md:flex-none">
          <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", pendingCount > 0 ? "bg-amber-50" : "bg-emerald-50")}>
            <AlertTriangle className={cn("w-5 h-5", pendingCount > 0 ? "text-amber-600" : "text-emerald-600")} />
          </div>
          <div>
            <div className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Pending Review</div>
            <div className={cn("text-lg font-bold", pendingCount > 0 ? "text-amber-600" : "text-emerald-600")}>
              {pendingCount}
            </div>
          </div>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-stone-200 shadow-sm flex items-center gap-4 min-w-[160px] flex-1 md:flex-none">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <div className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Quoted Volume</div>
            <div className="text-lg font-bold text-emerald-600">
              {formatIDR(totalAmount)}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-stone-50 p-4 rounded-2xl border border-stone-100/60">
        <div className="relative w-full md:max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
          <input 
            type="text" 
            placeholder="Search by quote number, title or customer..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-stone-200 rounded-xl text-sm outline-none focus:border-stone-300 focus:ring-4 focus:ring-stone-100 transition-all font-medium"
          />
        </div>
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          <div className="flex items-center gap-2 bg-white px-3 py-1.5 border border-stone-200 rounded-lg shrink-0">
            <Filter className="w-3.5 h-3.5 text-stone-400" />
            <Select 
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="text-xs font-bold text-stone-600 bg-transparent outline-none cursor-pointer uppercase tracking-wider border-none h-auto py-1 pl-0 pr-8"
            >
              <option value="ALL">All Status</option>
              <option value="DRAFT">Draft</option>
              <option value="PENDING">Pending</option>
              <option value="APPROVED">Approved</option>
              <option value="PROCESSED">Processed</option>
              <option value="REJECTED">Rejected</option>
            </Select>
          </div>
          <button 
            onClick={fetchQuotations} 
            className="p-2 border border-stone-200 rounded-lg bg-white text-stone-500 hover:text-stone-900 transition-colors shrink-0"
            title="Refresh Data"
          >
            <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin")} />
          </button>
        </div>
      </div>

      <div className="bg-white border border-stone-200 rounded-3xl shadow-sm overflow-hidden flex flex-col">
        {isLoading ? (
          <div className="py-24 text-center text-stone-400 font-medium">Loading quotations...</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state m-8 animate-in fade-in duration-300 flex flex-col items-center justify-center p-12">
             <FileText className="w-12 h-12 text-stone-300 mb-4" />
             <div className="text-[10px] text-stone-400 font-bold uppercase tracking-[0.2em]">No Quotations Found</div>
          </div>
        ) : (
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left border-collapse min-w-[800px]">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-200 text-stone-500 text-[10px] font-bold uppercase tracking-widest">
                  <th className="px-6 py-4 rounded-tl-3xl">Quotation</th>
                  <th className="px-6 py-4">Customer</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4 text-right">Amount</th>
                  <th className="px-6 py-4 text-right rounded-tr-3xl">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100/60">
                {filtered.map(q => {
                   const isApproved = q.status === 'APPROVED' || q.status === 'PROCESSED';
                   
                   return (
                  <tr key={q.id} className="group hover:bg-stone-50/30 transition-colors">
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-4">
                        <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border border-stone-200/50", isApproved ? "bg-emerald-50" : "bg-stone-100")}>
                          {isApproved ? <CheckCircle2 className="w-5 h-5 text-emerald-600" /> : <FileText className="w-5 h-5 text-stone-400" />}
                        </div>
                        <div>
                          <div className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-0.5">{q.quotation_number}</div>
                          <div className="text-sm font-bold text-stone-900 group-hover:text-stone-700 transition-colors">{q.title}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-5 align-middle">
                      <div className="text-sm font-bold text-stone-700">{q.customer_name || '-'}</div>
                      <div className="text-[10px] text-stone-400 font-bold uppercase tracking-widest mt-1 w-24 truncate">{q.category || 'General'}</div>
                    </td>
                    <td className="px-6 py-5 align-middle">
                      <span className={cn(
                        "px-2.5 py-1 rounded-md text-[9px] font-bold uppercase tracking-widest flex w-fit items-center gap-1.5",
                        q.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-700 border-none' :
                        q.status === 'PROCESSED' ? 'bg-indigo-100 text-indigo-700 border-none' :
                        q.status === 'PENDING' ? 'bg-amber-100 text-amber-700' :
                        q.status === 'REVISION' ? 'bg-rose-100 text-rose-700' :
                        q.status === 'DRAFT' ? 'bg-stone-200 text-stone-600' :
                        'bg-stone-100 text-stone-500'
                      )}>
                        {q.status === 'APPROVED' || q.status === 'PROCESSED' ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                        {q.status}
                      </span>
                      {q.status === 'REVISION' && q.revision_note && (
                        <div className="mt-1.5 flex items-start gap-1 p-2 bg-rose-50 border border-rose-100 rounded-md text-xs text-rose-700">
                          <FileText className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          <span className="italic">"{q.revision_note}"</span>
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-5 align-middle text-right">
                      <div className="text-sm font-bold text-stone-900">
                        {formatIDR(q.amount || 0)}
                      </div>
                    </td>
                    <td className="px-6 py-5 align-middle text-right">
                      <div className="flex items-center justify-end gap-2">
                        {q.status === 'PENDING' && (user?.role === 'FC' || hasGodMode(user)) && (
                          <>
                            <Button 
                              size="xs"
                              action="authorize"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedQuoToAuth(q);
                                setShowAuthorizeModal(true);
                              }}
                            />
                            <Button 
                              size="xs"
                              action="revise"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedQuoToAuth(q);
                                setShowReviseModal(true);
                              }}
                            />
                          </>
                        )}
                        {(q.status === 'REVISION' || q.status === 'DRAFT') && hasPermission(user, Action.CREATE_QUOTATION) && (
                          <Button 
                            size="xs"
                            action="revise"
                            onClick={(e) => {
                              e.stopPropagation();
                              setRevisingQuotation(q);
                              setShowCreateModal(true);
                            }}
                          />
                        )}
                        <Button 
                          size="xs"
                          action="view"
                          onClick={() => setSelectedQuotation(q)}
                        />
                        {(user?.role === 'FC' || hasGodMode(user) || (user?.role === 'SALES' && hasPermission(user, Action.CREATE_QUOTATION))) && (
                          <Button 
                            size="xs"
                            action="delete"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteQuotation(q.id);
                            }}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                )})}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <CreateQuotationModal 
        isOpen={showCreateModal}
        onClose={() => {
          setShowCreateModal(false);
          setRevisingQuotation(null);
        }}
        revisingData={revisingQuotation}
        onSuccess={(quo) => {
          setShowCreateModal(false);
          setRevisingQuotation(null);
          fetchQuotations();
          setSelectedQuotation(quo);
        }}
      />
      
      <QuotationPreviewModal
        isOpen={!!selectedQuotation}
        onClose={() => setSelectedQuotation(null)}
        quotation={selectedQuotation}
      />

      <Modal
        isOpen={showAuthorizeModal && selectedQuoToAuth !== null}
        onClose={() => setShowAuthorizeModal(false)}
        maxWidth="2xl"
        title={
          <div>
            <h3 className="text-lg font-bold text-stone-900">Authorize Quotation</h3>
            <p className="text-[10px] text-stone-400 font-bold uppercase tracking-widest mt-0.5">Quotation Release</p>
          </div>
        }
      >
        <form onSubmit={handleAuthorize} className="space-y-6 pt-2">
          {selectedQuoToAuth && (
            <div className="p-5 bg-stone-50 rounded-2xl border border-stone-100 mb-2">
              <div className="text-[10px] text-stone-400 font-bold uppercase tracking-widest mb-1.5">Draft Quotation Reference</div>
              <div className="text-base font-bold text-stone-900">{selectedQuoToAuth.quotation_number}</div>
              <div className="text-xs text-stone-500 mt-1 font-medium italic">Customer: {selectedQuoToAuth.customer_name}</div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="flex gap-4 p-5 bg-emerald-50/50 rounded-2xl border border-emerald-100/50 col-span-2">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-5 h-5 text-emerald-500" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-stone-900 mb-1">Embedded Smart e-Approval</h4>
                <p className="text-[10px] text-stone-500 leading-relaxed mb-3">
                  Please enter your 6-digit authorization PIN to digitally sign and authorize this quotation.
                </p>
                <input
                  type="password"
                  maxLength={6}
                  required
                  value={authPin}
                  onChange={e => setAuthPin(e.target.value)}
                  placeholder="------"
                  className="w-32 bg-white border border-stone-200 text-stone-900 text-center tracking-[0.5em] font-mono font-bold rounded-lg px-4 py-2.5 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 outline-none transition-all shadow-sm"
                />
              </div>
            </div>
          </div>

          <div className="pt-2 flex justify-end gap-3 mt-6">
            <Button variant="secondary" type="button" onClick={() => setShowAuthorizeModal(false)}>Cancel</Button>
            <Button 
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Processing...' : 'Authorize Quotation'}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={showReviseModal && selectedQuoToAuth !== null}
        onClose={() => setShowReviseModal(false)}
        maxWidth="2xl"
        title={
          <div>
            <h3 className="text-lg font-bold text-stone-900">Revise Quotation</h3>
            <p className="text-[10px] text-stone-400 font-bold uppercase tracking-widest mt-0.5">Return to Staff for Changes</p>
          </div>
        }
      >
        <form onSubmit={handleRevise} className="space-y-6 pt-2">
          {selectedQuoToAuth && (
            <div className="p-5 bg-stone-50 rounded-2xl border border-stone-100 mb-2">
              <div className="text-[10px] text-stone-400 font-bold uppercase tracking-widest mb-1.5">Draft Quotation Reference</div>
              <div className="text-base font-bold text-stone-900">{selectedQuoToAuth.quotation_number}</div>
              <div className="text-xs text-stone-500 mt-1 font-medium italic">Customer: {selectedQuoToAuth.customer_name}</div>
            </div>
          )}

          <div className="flex gap-4 p-5 bg-rose-50/50 rounded-2xl border border-rose-100/50">
            <div className="w-10 h-10 rounded-xl bg-rose-100 flex items-center justify-center shrink-0 mt-1">
              <AlertTriangle className="w-5 h-5 text-rose-500" />
            </div>
            <div className="w-full">
              <h4 className="text-xs font-bold text-stone-900 mb-1">Revision Note</h4>
              <p className="text-[10px] text-stone-500 leading-relaxed mb-3">
                Provide clear instructions on what needs to be changed exactly like adding a note on a field condition. This will be sent back to staff.
              </p>
              <textarea
                required
                value={revisionNote}
                onChange={e => setRevisionNote(e.target.value)}
                placeholder="E.g., Price is too low, change dimension for item #2..."
                className="w-full h-24 bg-white border border-stone-200 text-stone-900 text-sm rounded-lg px-4 py-3 focus:border-rose-500 focus:ring-4 focus:ring-rose-500/10 outline-none transition-all shadow-sm resize-none"
              />
            </div>
          </div>

          <div className="pt-2 flex justify-end gap-3 mt-6">
            <Button variant="secondary" type="button" onClick={() => setShowReviseModal(false)}>Cancel</Button>
            <Button 
              type="submit"
              disabled={isSubmitting}
              className="bg-rose-600 hover:bg-rose-700 text-white"
            >
              {isSubmitting ? 'Processing...' : 'Submit Revision'}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmModal
        isOpen={confirmModal?.isOpen || false}
        onCancel={() => setConfirmModal(null)}
        title={confirmModal?.title || ''}
        message={confirmModal?.message || ''}
        onConfirm={() => {
          if (confirmModal?.action) {
            confirmModal.action();
          }
          setConfirmModal(null);
        }}
      />
    </div>
  );
}
