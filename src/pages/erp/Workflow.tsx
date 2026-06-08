import React, { useState, useEffect } from 'react';
import { PageHeader } from '@/components/shared/PageHeader';
import { Workflow, Network, Clock, ShieldAlert, ArrowRight, CheckCircle2, Bot, AlertTriangle, Plus, Trash2, SplitSquareHorizontal, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import { apiFetch } from '@/utils/api';
import { ConfirmModal } from '@/components/shared/ConfirmModal';

import WorkflowVisualizer from '@/components/erp/WorkflowVisualizer';

export default function WorkflowSettings() {
  const [activeTab, setActiveTab] = useState<'MATRIX' | 'SLA' | 'AUDIT' | 'VISUAL' | 'AI_BUILDER'>('MATRIX');
  const { showToast } = useToast();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);

  const [matrices, setMatrices] = useState<any[]>([]);
  const [slas, setSlas] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  const generateWithAi = async () => {
    if (!aiPrompt) return;
    setAiLoading(true);
    try {
      const res = await apiFetch('/api/workflow/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: aiPrompt })
      }, user?.username);
      
      if (res.ok && res.data) {
        showToast("AI successfully generated rules. Please review before applying.", "success");
        if (res.data.matrices) {
          setMatrices(prev => [...res.data.matrices, ...prev]);
        }
        if (res.data.slas) {
          setSlas(prev => [...res.data.slas, ...prev]);
        }
        setAiPrompt('');
        setActiveTab('MATRIX'); 
      } else {
        showToast(res.error || "Failed to generate workflow via AI", "error");
      }
    } catch (e) {
      console.error(e);
      showToast("Error connecting to AI Assistant", "error");
    } finally {
      setAiLoading(false);
    }
  };

  const [confirmModalOptions, setConfirmModalOptions] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  useEffect(() => {
    fetchRules();
    fetchAudit();
  }, []);

  const fetchAudit = async () => {
    try {
      const res = await apiFetch('/api/workflow/audit_logs', {}, user?.username);
      if (res.ok) setAuditLogs(res.data || []);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchRules = async () => {
    try {
      setLoading(true);
      const mRes = await apiFetch('/api/workflow/matrices', {}, user?.username);
      const sRes = await apiFetch('/api/workflow/slas', {}, user?.username);
      if (mRes.ok) setMatrices(mRes.data || []);
      if (sRes.ok) setSlas(sRes.data || []);
    } catch (e) {
      console.error(e);
      showToast("Failed to fetch workflow rules", "error");
    } finally {
      setLoading(false);
    }
  };

  const addMatrix = () => {
    setMatrices([{ id: Date.now().toString(), document_type: 'Purchase Order', min_amount: 0, max_amount: null, roles: [], is_parallel: 0, is_new: true }, ...matrices]);
  };

  const removeMatrix = async (id: string, isNew?: boolean) => {
    setConfirmModalOptions({
      isOpen: true,
      title: "Delete Matrix Rule",
      message: "Are you sure you want to delete this matrix rule?",
      onConfirm: async () => {
        setConfirmModalOptions(prev => ({ ...prev, isOpen: false }));
        if (isNew) {
          setMatrices(matrices.filter(m => m.id !== id));
          return;
        }
        try {
          const res = await apiFetch(`/api/workflow/matrices/${id}`, { method: 'DELETE' }, user?.username);
          if (res.ok) fetchRules();
        } catch (e) {
          console.error(e);
        }
      }
    });
  };

  const addSla = () => {
    setSlas([{ id: Date.now().toString(), document_type: 'Purchase Order', step: 'Pending Approval', sla_hours: 24, escalate_to: 'Director', is_new: true }, ...slas]);
  };

  const removeSla = async (id: string, isNew?: boolean) => {
     setConfirmModalOptions({
       isOpen: true,
       title: "Delete SLA",
       message: "Are you sure you want to delete this SLA?",
       onConfirm: async () => {
         setConfirmModalOptions(prev => ({ ...prev, isOpen: false }));
         if (isNew) {
           setSlas(slas.filter(s => s.id !== id));
           return;
         }
         try {
           const res = await apiFetch(`/api/workflow/slas/${id}`, { method: 'DELETE' }, user?.username);
           if (res.ok) fetchRules();
         } catch (e) {
           console.error(e);
         }
       }
     });
  };

  const saveSettings = async () => {
    // Save matrices
    for (let m of matrices) {
      const res = await apiFetch('/api/workflow/matrices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(m)
      }, user?.username);
      if (!res.ok) {
        showToast(res.error || "Failed to update hierarchy matrix", "error");
        return;
      }
    }
    // Save SLAs
    for (let s of slas) {
      const res = await apiFetch('/api/workflow/slas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(s)
      }, user?.username);
      if (!res.ok) {
        showToast(res.error || "Failed to update SLA", "error");
        return;
      }
    }
    showToast("Workflow automation settings have been successfully updated.", "success");
    fetchRules();
  };

  return (
    <div className="space-y-8 pb-20">
      <PageHeader
        title="Workflow & Automation"
        subtitle="Manage dynamic approval rules and SLA escalations."
        icon={<Workflow className="w-6 h-6" />}
        actions={
          <button onClick={saveSettings} className="px-6 py-3 bg-stone-900 text-white text-sm font-bold rounded-2xl hover:bg-stone-800 transition-all flex items-center gap-2 shadow-sm">
            <CheckCircle2 className="w-5 h-5" />
            <span>Apply Engine Rules</span>
          </button>
        }
      />

      <div className="flex gap-4 border-b border-stone-200 pb-4">
        {[
          { id: 'MATRIX', label: 'Dynamic Approval', icon: Network },
          { id: 'SLA', label: 'SLA & Auto-Escalation', icon: Clock },
          { id: 'AUDIT', label: 'Audit Trail', icon: ShieldAlert },
          { id: 'VISUAL', label: 'Visual Canvas (BPMN)', icon: Network },
          { id: 'AI_BUILDER', label: 'AI Assistant', icon: Bot },
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as 'MATRIX' | 'SLA' | 'AUDIT' | 'VISUAL' | 'AI_BUILDER')}
              className={cn(
                "px-6 py-3 rounded-xl text-sm font-bold flex items-center gap-2 transition-all",
                activeTab === tab.id 
                  ? "bg-stone-900 text-white shadow-sm"
                  : "bg-stone-50 text-stone-500 hover:bg-stone-100 border border-stone-200"
              )}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          )
        })}
      </div>

      <motion.div
        key={activeTab}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.2 }}
      >
        {activeTab === 'MATRIX' ? (
          <div className="space-y-6">
            <div className="bg-emerald-50 border border-emerald-200 p-6 rounded-3xl flex gap-4 items-start">
               <div className="p-3 bg-white rounded-2xl border border-emerald-100 shadow-sm shrink-0">
                  <Bot className="w-6 h-6 text-emerald-600" />
               </div>
               <div>
                  <h3 className="text-sm font-bold text-emerald-900 mb-1">Dynamic Approval Matrix Active</h3>
                  <p className="text-xs text-emerald-700 leading-relaxed font-medium">
                     Transactions will automatically request multi-tier approvals based on the conditions defined below. 
                     If a requirement is matched, the system will block status progression until all required roles have digitally signed the document.
                  </p>
               </div>
            </div>

            <div className="bg-white border border-stone-200 rounded-3xl overflow-hidden shadow-sm">
              <div className="p-6 border-b border-stone-100 flex justify-between items-center bg-stone-50/50">
                 <div>
                    <h4 className="text-sm font-bold text-stone-900">Value-Based Approval Hierarchy</h4>
                    <p className="text-xs text-stone-500 mt-1 font-medium">Configure tier thresholds and required signatures.</p>
                 </div>
                 <button onClick={addMatrix} className="p-2 bg-white border border-stone-200 rounded-xl text-stone-600 hover:text-stone-900 transition-colors shadow-sm">
                   <Plus className="w-5 h-5" />
                 </button>
              </div>

              <div className="p-6 space-y-4">
                 {matrices.map((matrix, idx) => (
                    <div key={matrix.id} className="grid grid-cols-12 gap-4 items-center bg-stone-50 border border-stone-100 p-4 rounded-2xl">
                       <div className="col-span-12 md:col-span-3">
                          <label className="text-[10px] uppercase font-bold tracking-widest text-stone-400 mb-1.5 block">Document Type</label>
                          <select 
                            value={matrix.document_type}
                            onChange={(e) => {
                              const newM = [...matrices];
                              newM[idx] = { ...newM[idx], document_type: e.target.value };
                              setMatrices(newM);
                            }}
                            className="w-full bg-white border border-stone-200 rounded-xl text-sm font-semibold p-2.5 outline-none focus:ring-2 ring-stone-900/10"
                          >
                            <option value="Purchase Order">Purchase Order</option>
                            <option value="Purchase Request">Purchase Request</option>
                            <option value="Quotation">Quotation</option>
                          </select>
                       </div>
                       <div className="col-span-12 md:col-span-4 flex items-center gap-2">
                           <div className="flex-1">
                              <label className="text-[10px] uppercase font-bold tracking-widest text-stone-400 mb-1.5 block">Min Value (Rp)</label>
                              <input 
                                type="number" 
                                value={matrix.min_amount} 
                                onChange={(e) => {
                                  const newM = [...matrices];
                                  newM[idx] = { ...newM[idx], min_amount: parseFloat(e.target.value) || 0 };
                                  setMatrices(newM);
                                }}
                                className="w-full bg-white border border-stone-200 rounded-xl text-sm font-mono p-2.5 outline-none focus:ring-2 ring-stone-900/10" 
                              />
                           </div>
                           <div className="mt-6 text-stone-300">-</div>
                           <div className="flex-1">
                              <label className="text-[10px] uppercase font-bold tracking-widest text-stone-400 mb-1.5 block">Max Value (Rp)</label>
                              <input 
                                type="text" 
                                value={matrix.max_amount === null ? 'Unlimited' : matrix.max_amount} 
                                onChange={(e) => {
                                  const newM = [...matrices];
                                  newM[idx] = { ...newM[idx], max_amount: e.target.value === 'Unlimited' || e.target.value === '' ? null : parseFloat(e.target.value) };
                                  setMatrices(newM);
                                }}
                                className="w-full bg-white border border-stone-200 rounded-xl text-sm font-mono p-2.5 outline-none focus:ring-2 ring-stone-900/10" 
                              />
                           </div>
                       </div>
                       <div className="col-span-12 md:col-span-4">
                           <div className="flex items-center justify-between mb-1.5">
                             <label className="text-[10px] uppercase font-bold tracking-widest text-stone-400 block">Required Signatures</label>
                             <div className="flex items-center gap-2">
                               <input 
                                 type="checkbox" 
                                 checked={matrix.is_parallel === 1}
                                 onChange={(e) => {
                                   const newM = [...matrices];
                                   newM[idx] = { ...newM[idx], is_parallel: e.target.checked ? 1 : 0 };
                                   setMatrices(newM);
                                 }}
                                 id={`parallel-${matrix.id}`}
                               />
                               <label htmlFor={`parallel-${matrix.id}`} className="text-[10px] uppercase font-bold tracking-widest text-emerald-600 cursor-pointer">Parallel (OR)</label>
                             </div>
                           </div>
                           <div className="flex flex-wrap gap-2 items-center">
                             {(matrix.roles || []).map((role: string, rIdx: number) => (
                                <React.Fragment key={`${role}-${rIdx}`}>
                                  <span className="text-[11px] font-bold bg-stone-900 text-white px-2.5 py-1.5 rounded-lg whitespace-nowrap flex items-center gap-2">
                                    {role}
                                    <button onClick={() => {
                                      const newM = [...matrices];
                                      const newRoles = [...newM[idx].roles]; newRoles.splice(rIdx, 1); newM[idx] = { ...newM[idx], roles: newRoles };
                                      setMatrices(newM);
                                    }} className="hover:text-rose-400"><Trash2 className="w-3 h-3" /></button>
                                  </span>
                                  {rIdx !== (matrix.roles || []).length - 1 && (
                                     matrix.is_parallel === 1 ? <SplitSquareHorizontal className="w-4 h-4 text-emerald-500" /> : <ArrowRight className="w-3 h-3 text-stone-300" />
                                  )}
                                </React.Fragment>
                             ))}
                             <select className="w-8 h-8 rounded-lg border border-dashed border-stone-300 text-stone-400 flex items-center justify-center outline-none" onChange={(e) => {
                               if (e.target.value) {
                                 const newM = [...matrices];
                                 newM[idx] = { ...newM[idx], roles: [...(newM[idx].roles || []), e.target.value] };
                                 setMatrices(newM);
                                 e.target.value = '';
                               }
                             }}>
                                <option value="">+</option>
                                <option value="Manager">Manager</option>
                                <option value="FC">FC (Full Control)</option>
                                <option value="Director">Director</option>
                                <option value="Procurement Manager">Procurement Manager</option>
                                <option value="Finance Manager">Finance Manager</option>
                                <option value="Engineering Lead">Engineering Lead</option>
                             </select>
                           </div>
                       </div>
                       <div className="col-span-12 md:col-span-1 flex justify-end">
                          <button onClick={() => removeMatrix(matrix.id, matrix.is_new)} className="p-2 text-stone-400 hover:text-rose-500 transition-colors mt-6">
                            <Trash2 className="w-5 h-5" />
                          </button>
                       </div>
                    </div>
                 ))}
                 {matrices.length === 0 && (
                    <div className="text-center py-12 text-stone-400">
                       <ShieldAlert className="w-8 h-8 opacity-50 mx-auto mb-3" />
                       <p className="text-sm font-bold">No matrix rules defined. Approvals are unrestricted.</p>
                    </div>
                 )}
              </div>
            </div>
          </div>
        ) : activeTab === 'SLA' ? (
          <div className="space-y-6">
             <div className="bg-rose-50 border border-rose-200 p-6 rounded-3xl flex gap-4 items-start">
               <div className="p-3 bg-white rounded-2xl border border-rose-100 shadow-sm shrink-0">
                  <AlertTriangle className="w-6 h-6 text-rose-600" />
               </div>
               <div>
                  <h3 className="text-sm font-bold text-rose-900 mb-1">SLA Monitoring Active</h3>
                  <p className="text-xs text-rose-700 leading-relaxed font-medium">
                     Documents held pending beyond the allocated Service Level Agreement (SLA) hours will be automatically 
                     escalated to higher-tier management to prevent operational bottlenecks.
                  </p>
               </div>
            </div>

            <div className="bg-white border border-stone-200 rounded-3xl overflow-hidden shadow-sm">
              <div className="p-6 border-b border-stone-100 flex justify-between items-center bg-stone-50/50">
                 <div>
                    <h4 className="text-sm font-bold text-stone-900">Auto-Escalation Paths</h4>
                    <p className="text-xs text-stone-500 mt-1 font-medium">Define timeouts for workflow bottleneck prevention.</p>
                 </div>
                 <button onClick={addSla} className="p-2 bg-white border border-stone-200 rounded-xl text-stone-600 hover:text-stone-900 transition-colors shadow-sm">
                   <Plus className="w-5 h-5" />
                 </button>
              </div>

              <div className="p-6">
                 <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm whitespace-nowrap">
                       <thead>
                          <tr className="border-b border-stone-100">
                             <th className="px-4 py-3 text-[10px] font-bold text-stone-400 uppercase tracking-widest">Document Event</th>
                             <th className="px-4 py-3 text-[10px] font-bold text-stone-400 uppercase tracking-widest">Target State</th>
                             <th className="px-4 py-3 text-[10px] font-bold text-stone-400 uppercase tracking-widest">Max Idle (Hours)</th>
                             <th className="px-4 py-3 text-[10px] font-bold text-stone-400 uppercase tracking-widest">Escalate To</th>
                             <th className="px-4 py-3"></th>
                          </tr>
                       </thead>
                       <tbody className="divide-y divide-stone-50">
                          {slas.map((sla, idx) => (
                             <tr key={sla.id} className="hover:bg-stone-50/50 transition-colors">
                                <td className="px-4 py-4 font-bold text-stone-900">
                                   <input className="bg-transparent outline-none w-full" value={sla.document_type} onChange={e => {
                                      const newSlas = [...slas];
                                      newSlas[idx] = { ...newSlas[idx], document_type: e.target.value };
                                      setSlas(newSlas);
                                   }} />
                                </td>
                                <td className="px-4 py-4 font-semibold text-stone-600">
                                   <input className="bg-transparent outline-none w-full" value={sla.step} onChange={e => {
                                      const newSlas = [...slas];
                                      newSlas[idx] = { ...newSlas[idx], step: e.target.value };
                                      setSlas(newSlas);
                                   }} />
                                </td>
                                <td className="px-4 py-4">
                                   <div className="inline-flex items-center gap-2 bg-white border border-stone-200 px-3 py-1.5 rounded-lg shadow-sm">
                                      <Clock className="w-4 h-4 text-stone-400" />
                                      <input type="number" className="font-mono text-stone-900 font-bold bg-transparent outline-none w-12 text-right" value={sla.sla_hours} onChange={e => {
                                         const newSlas = [...slas];
                                         newSlas[idx] = { ...newSlas[idx], sla_hours: parseFloat(e.target.value) || 0 };
                                         setSlas(newSlas);
                                      }} />
                                      <span>h</span>
                                   </div>
                                </td>
                                <td className="px-4 py-4">
                                   <div className="inline-flex items-center gap-2">
                                      <ArrowRight className="w-4 h-4 text-rose-400" />
                                      <input className="text-xs font-bold text-white bg-rose-500 px-2.5 py-1 rounded-md w-32 outline-none" value={sla.escalate_to} onChange={e => {
                                         const newSlas = [...slas];
                                         newSlas[idx] = { ...newSlas[idx], escalate_to: e.target.value };
                                         setSlas(newSlas);
                                      }} />
                                   </div>
                                </td>
                                <td className="px-4 py-4 text-right">
                                   <button onClick={() => removeSla(sla.id, sla.is_new)} className="text-stone-400 hover:text-rose-500 transition-colors"><Trash2 className="w-4 h-4" /></button>
                                </td>
                             </tr>
                          ))}
                       </tbody>
                    </table>
                 </div>
              </div>
            </div>
          </div>
        ) : activeTab === 'VISUAL' ? (
          <div className="space-y-6">
            <div className="bg-white border border-stone-200 rounded-3xl p-6 shadow-sm">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h4 className="text-lg font-bold text-stone-900">BPMN Visualizer</h4>
                  <p className="text-sm text-stone-500 mt-1">Representasi visual interaktif node approval flow berdasarkan matriks data Anda.</p>
                </div>
              </div>
              <WorkflowVisualizer matrices={matrices} />
            </div>
          </div>
        ) : activeTab === 'AI_BUILDER' ? (
          <div className="space-y-6">
            <div className="bg-indigo-50 border border-indigo-200 p-8 rounded-3xl relative overflow-hidden">
               <div className="absolute top-0 right-0 p-8 opacity-10">
                  <Sparkles className="w-48 h-48 text-indigo-600" />
               </div>
               <div className="relative z-10 max-w-2xl">
                  <div className="inline-flex items-center gap-2 px-3 py-1 bg-indigo-100 text-indigo-700 font-bold text-[10px] uppercase tracking-widest rounded-full mb-4">
                     <Sparkles className="w-3 h-3" />
                     Generative AI-Assisted No-Code Builder (BETA)
                  </div>
                  <h3 className="text-2xl font-bold text-indigo-900 mb-2">Hyper-Agile Workflow Configuration</h3>
                  <p className="text-sm border-l-2 border-indigo-300 pl-4 text-indigo-700 leading-relaxed font-medium mb-6">
                     Gunakan bahasa natural untuk merancang matriks approval dan otomatisasi SLA. AI akan secara otomatis memecah permintaan Anda menjadi "Approval Engine Rules" untuk Anda review. <span className="text-indigo-500 text-xs font-semibold block mt-1">(Fitur ini masih dalam tahap uji coba/BETA & pengembangan)</span>
                  </p>
                  
                  <div className="bg-white p-2 rounded-2xl shadow-sm border border-indigo-100 focus-within:ring-4 ring-indigo-500/20 transition-all">
                     <textarea
                       className="w-full bg-transparent border-none outline-none resize-none p-4 text-stone-700 placeholder-stone-400 font-medium h-32"
                       placeholder="Contoh: Buatkan alur persetujuan untuk pengadaan IT di atas Rp 50 juta yang harus melewati IT Manager dan Finance Director, dengan SLA 12 jam."
                       value={aiPrompt}
                       onChange={e => setAiPrompt(e.target.value)}
                     ></textarea>
                     <div className="flex justify-between items-center p-2 border-t border-stone-50">
                        <div className="text-[10px] font-bold text-stone-400 uppercase tracking-widest px-2">NLP Configuration Engine</div>
                        <button 
                          onClick={generateWithAi}
                          disabled={aiLoading || !aiPrompt}
                          className="px-6 py-2 bg-indigo-600 text-white font-bold rounded-xl text-sm hover:bg-indigo-700 transition-colors flex items-center gap-2 disabled:opacity-50"
                        >
                          {aiLoading ? <span className="animate-pulse">Analyzing Business Logic...</span> : (
                             <>
                               <Bot className="w-4 h-4" />
                               Generate Logic Config
                             </>
                          )}
                        </button>
                     </div>
                  </div>
               </div>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="bg-white border border-stone-200 rounded-3xl p-6 shadow-sm">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h4 className="text-lg font-bold text-stone-900">Workflow Rules Audit Trail</h4>
                  <p className="text-sm text-stone-500 mt-1">Ledger historis untuk engine rules workflow automation.</p>
                </div>
              </div>
              <div className="overflow-hidden border border-stone-200 rounded-2xl">
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className="bg-stone-50 border-b border-stone-200 text-stone-500 font-bold uppercase tracking-wider text-[10px]">
                    <tr>
                      <th className="px-4 py-3">Timestamp</th>
                      <th className="px-4 py-3">User</th>
                      <th className="px-4 py-3">Action</th>
                      <th className="px-4 py-3">Target</th>
                      <th className="px-4 py-3">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {auditLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-stone-50 transition-colors">
                        <td className="px-4 py-3 text-stone-500 font-mono text-xs text-wrap">{new Date(log.created_at + 'Z').toLocaleString()}</td>
                        <td className="px-4 py-3 font-bold text-stone-900">{log.username}</td>
                        <td className="px-4 py-3">
                          <span className={cn(
                            "px-2 py-1 rounded-md text-[10px] font-bold uppercase",
                            log.action === "CREATE" ? "bg-emerald-100 text-emerald-800" :
                            log.action === "UPDATE" ? "bg-amber-100 text-amber-800" :
                            "bg-rose-100 text-rose-800"
                          )}>{log.action}</span>
                        </td>
                        <td className="px-4 py-3 text-stone-500 font-mono text-xs truncate max-w-32" title={log.target_id}>{log.target_type} ({log.target_id.split('-').shift()})</td>
                        <td className="px-4 py-3 text-stone-400 font-mono text-[10px] max-w-xs truncate" title={log.changes}>
                          {log.changes}
                        </td>
                      </tr>
                    ))}
                    {auditLogs.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-stone-400 text-sm font-semibold">
                          No audit trails found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </motion.div>

      <ConfirmModal
        isOpen={confirmModalOptions.isOpen}
        title={confirmModalOptions.title}
        message={confirmModalOptions.message}
        onConfirm={confirmModalOptions.onConfirm}
        onCancel={() => setConfirmModalOptions(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}
