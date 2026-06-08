import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { apiFetch } from '@/utils/api';
import { PackageOpen, Truck, X, FileText, Download, Plus, ArrowUpRight, Upload, QrCode, Lock, ShieldCheck, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { generatePDF } from '@/lib/pdfGenerator';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { ConfirmModal } from '@/components/shared/ConfirmModal';
import { QRCodeSVG } from 'qrcode.react';
import { Action, hasPermission, hasGodMode } from '@/utils/pbac';
import { PrintTemplate } from '@/components/erp/PrintTemplate';

export default function Deliveries() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const { t, language } = useLanguage();
  
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [fgItems, setFgItems] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const [showDeliveryModal, setShowDeliveryModal] = useState(false);
  const [showItemSelectModal, setShowItemSelectModal] = useState(false);
  const [deliveryForm, setDeliveryForm] = useState({ customer_id: '', project_id: '', remarks: '', items: [] as any[], police_number: ''});
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const [revisingDn, setRevisingDn] = useState<any>(null);
  const [showReviseModal, setShowReviseModal] = useState(false);
  const [revisionNote, setRevisionNote] = useState('');
  const [selectedDnToRevise, setSelectedDnToRevise] = useState<any>(null);

  const printDocRef = useRef<HTMLDivElement>(null);
  const [previewDn, setPreviewDn] = useState<any>(null);

  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    action: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    action: () => {}
  });

  useEffect(() => {
    fetchDeliveries();
    fetchSupportData();
  }, [user]);

  const fetchDeliveries = async () => {
    setIsLoading(true);
    try {
      const res = await apiFetch(`/api/sales/deliveries`, {}, user?.username);
      if (res.ok) setDeliveries(res.data);
    } catch (err) {}
    setIsLoading(false);
  };

  const fetchSupportData = async () => {
    try {
      const cRes = await apiFetch(`/api/sales/customers`, {}, user?.username);
      if (cRes.ok) setCustomers(cRes.data);

      const pRes = await apiFetch(`/api/projects?archived=all`, {}, user?.username);
      if (pRes.ok) setProjects(pRes.data);

      const itemsRes = await apiFetch(`/api/items`, {}, user?.username);
      if (itemsRes.ok) {
        // Filter for finished goods by category, prefix, or type
        const allFgs = itemsRes.data.filter((i: any) => 
          i.category === 'FINISHED_GOODS' || 
          i.item_code.startsWith('FG-') || 
          i.type === 'FINISHED'
        );
        setFgItems(allFgs);
      }
    } catch (err) {}
  };

  const addItemToDelivery = (item: any) => {
    const pid = deliveryForm.project_id;
    let autoQty = 1;
    if (pid) {
      const proj = projects.find(p => p.id === pid);
      if (proj && (item.item_code === `FG-${pid}` || item.item_code === `FG-${pid}-SUB`)) {
        autoQty = proj.quotation_qty || 1;
      }
    }
    setDeliveryForm(prev => ({
      ...prev,
      items: [...prev.items, { item_id: item.id, item_code: item.item_code, item_name: item.name, qty: autoQty, uom: item.uom }]
    }));
    setShowItemSelectModal(false);
  };

  const handleCreateDelivery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (deliveryForm.items.length === 0) return showToast("Add at least one item", "error");
    setIsSubmitting(true);
    try {
      const url = revisingDn ? `/api/sales/deliveries/${revisingDn.id}` : '/api/sales/deliveries';
      const method = revisingDn ? 'PUT' : 'POST';
      const res = await apiFetch(url, {
        method,
        body: JSON.stringify(deliveryForm)
      }, user?.username);
      if (res.ok) {
        showToast(revisingDn ? "Delivery Note Revised" : "Delivery Note Created", "success");
        setDeliveryForm({ customer_id: '', project_id: '', remarks: '', items: [], police_number: '' });
        setShowDeliveryModal(false);
        setRevisingDn(null);
        fetchDeliveries();
      } else {
        showToast(res.error || "Failed", "error");
      }
    } catch(err) {
      showToast("Error", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReviseDn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!revisionNote.trim()) return showToast('Revision note is required', 'error');
    setIsSubmitting(true);
    try {
      const res = await apiFetch('/api/sales/deliveries/revise-dn', {
        method: 'POST',
        body: JSON.stringify({ dn_id: selectedDnToRevise.id, revision_note: revisionNote })
      }, user?.username);
      if (res.ok) {
        showToast('Delivery marked for revision', 'success');
        setShowReviseModal(false);
        setRevisionNote('');
        fetchDeliveries();
      } else {
        showToast(res.error || 'Failed to revise delivery', 'error');
      }
    } catch {
      showToast('Error', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStartDelivery = (id: string, e?: React.MouseEvent) => {
     if (e) e.stopPropagation();
     setConfirmModal({
       isOpen: true,
       title: "Start Delivery Process",
       message: "Are you sure you want to transition this outbound delivery to 'IN_DELIVERY' status? This signifies materials are physically departing.",
       action: async () => {
         try {
           const res = await apiFetch(`/api/sales/deliveries/${id}/start-delivery`, { method: 'POST' }, user?.username);
           if (res.ok) { 
             showToast("Delivery Started", "success"); 
             fetchDeliveries(); 
           } else { 
             showToast(res.error || "Failed", "error"); 
           }
         } catch (err) {}
         setConfirmModal(prev => ({ ...prev, isOpen: false }));
       }
     });
  };

  const [showFinishModal, setShowFinishModal] = useState(false);
  const [selectedFinishDn, setSelectedFinishDn] = useState<any>(null);
  const [finishDnFile, setFinishDnFile] = useState<File | null>(null);
  const [authDocName, setAuthDocName] = useState('');

  const handleFinishDelivery = async (e: React.FormEvent) => {
     e.preventDefault();
     if (!selectedFinishDn || !finishDnFile) return showToast("Select a scanned document first", "error");
     setIsSubmitting(true);
     try {
        const formData = new FormData();
        formData.append('file', finishDnFile);
        const upRes = await apiFetch('/api/upload', { method: 'POST', body: formData }, user?.username);
        if (!upRes.ok) throw new Error(upRes.error || "Upload failed");

        const res = await apiFetch(`/api/sales/deliveries/${selectedFinishDn.id}/finish-delivery`, { 
            method: 'POST',
            body: JSON.stringify({ file_url: upRes.data.url || upRes.data.fileUrl })
        }, user?.username);
        if (res.ok) {
           showToast("Delivery Completed", "success");
           setShowFinishModal(false);
           setFinishDnFile(null);
           setAuthDocName('');
           setSelectedFinishDn(null);
           fetchDeliveries();
        } else {
           showToast(res.error || "Failed", "error");
        }
     } catch(err) {
        showToast("Error processing delivery signature", "error");
     } finally {
        setIsSubmitting(false);
     }
  };

  const viewDeliveryDoc = async (id: string) => {
    try {
      const res = await apiFetch(`/api/sales/deliveries/${id}`, {}, user?.username);
      if (res.ok) {
        setPreviewDn(res.data);
      }
    } catch (e) {}
  };

  const exportPdf = async () => {
    if (!printDocRef.current || !previewDn) return;
    setIsSubmitting(true);
    try {
      await generatePDF(printDocRef.current, `${previewDn.dn_number}.pdf`);
      showToast("PDF exported successfully", "success");
    } catch (err) {
      console.error(err);
      showToast("Failed to generate PDF", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedCustomer = customers.find(c => c.id === deliveryForm.customer_id);

  return (
    <div className="space-y-12 pb-20 animate-in fade-in duration-500">
      <PageHeader
        title="Delivery Manifests"
        subtitle="Coordinate outbound manifests & authorizations"
        icon={<Truck className="w-6 h-6" />}
        actions={
          hasPermission(user, Action.CREATE_DELIVERY) ? (
            <Button 
              onClick={() => setShowDeliveryModal(true)}
              className="flex items-center gap-2"
            >
              <ArrowUpRight className="w-4 h-4" /> Initiate Delivery
            </Button>
          ) : undefined
        }
      />

      <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden shadow-sm relative">
        <div className="border-b border-stone-100 bg-stone-50/50 p-6 flex justify-between items-center">
            <h3 className="text-sm font-bold text-stone-900 uppercase tracking-widest">Active DN</h3>
            <div className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Pending & In-Delivery</div>
        </div>
        <div className="overflow-x-auto min-h-[400px]">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-stone-50 border-b border-stone-200">
                <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-bold text-stone-500 w-[120px]">DN Ref</th>
                <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-bold text-stone-500">Destination</th>
                <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-bold text-stone-500 w-[140px]">Status</th>
                <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-bold text-stone-500 w-[200px] text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {!isLoading && deliveries.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-sm font-medium text-stone-400">No deliveries registered in the system.</td>
                </tr>
              )}
              {deliveries.map(d => (
                 <tr key={d.id} className="border-b border-stone-100 hover:bg-stone-50/50 transition-colors last:border-0 group cursor-pointer" onClick={() => viewDeliveryDoc(d.id)}>
                    <td className="px-6 py-4">
                      <span className="text-xs font-bold font-mono text-stone-900">{d.dn_number}</span>
                    </td>
                    <td className="px-6 py-4 text-sm font-bold text-stone-800">{d.customer_name}</td>
                    <td className="px-6 py-4">
                       <span className={cn("px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest rounded-lg border", 
                         d.status === 'DRAFT' ? "bg-stone-100 text-stone-600 border-stone-200" :
                         d.status === 'REVISION' ? "bg-rose-50 text-rose-700 border-rose-200" :
                         d.status === 'PENDING_DELIVERY' ? "bg-amber-50 text-amber-700 border-amber-200" :
                         d.status === 'IN_DELIVERY' ? "bg-blue-50 text-blue-700 border-blue-200" :
                         "bg-emerald-50 text-emerald-700 border-emerald-200"
                       )}>
                         {d.status.replace('_', ' ')}
                       </span>
                       {d.status === 'REVISION' && d.revision_note && (
                         <div className="mt-1.5 flex items-start gap-1 p-1.5 bg-rose-50 border border-rose-100 rounded text-[10px] text-rose-700 max-w-[200px]">
                           <span className="italic leading-snug break-words">"{d.revision_note}"</span>
                         </div>
                       )}
                    </td>
                    <td className="px-6 py-4 text-right flex justify-end items-center gap-2" onClick={e => e.stopPropagation()}>
                       {d.status === 'DRAFT' && hasPermission(user, Action.DISPATCH_GOODS) && (
                         <Button
                           size="xs"
                           action="revise"
                           onClick={(e) => { e.stopPropagation(); setSelectedDnToRevise(d); setShowReviseModal(true); }}
                         />
                       )}
                       {d.status === 'REVISION' && hasPermission(user, Action.CREATE_DELIVERY) && (
                         <Button
                           size="xs"
                           action="revise"
                           onClick={async (e) => {
                             e.stopPropagation();
                             const res = await apiFetch(`/api/sales/deliveries/${d.id}`, {}, user?.username);
                             if (res.ok) {
                               setRevisingDn(res.data);
                               setDeliveryForm({
                                 customer_id: res.data.customer_id || '',
                                 project_id: res.data.project_id || '',
                                 police_number: res.data.police_number || '',
                                 remarks: res.data.remarks || '',
                                 items: res.data.items.map((i: any) => ({
                                   item_id: i.item_id, item_code: i.item_code, item_name: i.item_name, qty: i.qty, uom: i.uom || 'Unit'
                                 }))
                               });
                               setShowDeliveryModal(true);
                             }
                           }}
                         />
                       )}
                       {d.status === 'PENDING_DELIVERY' && hasPermission(user, Action.CREATE_DELIVERY) && (
                         <Button 
                           size="xs"
                           onClick={(e) => handleStartDelivery(d.id, e)} 
                         >
                           <Truck className="w-3.5 h-3.5" /> Ship Manifest
                         </Button>
                       )}
                       {d.status === 'IN_DELIVERY' && hasPermission(user, Action.CREATE_DELIVERY) && (
                         <Button 
                           size="xs"
                           variant="success"
                           onClick={(e) => { e.stopPropagation(); setSelectedFinishDn(d); setShowFinishModal(true); }} 
                         >
                           <PackageOpen className="w-3.5 h-3.5" /> Finish Delivery
                         </Button>
                       )}
                       <Button 
                         size="xs"
                         action="view"
                         onClick={(e) => { e.stopPropagation(); viewDeliveryDoc(d.id); }} 
                       />
                    </td>
                 </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Initiate Delivery Modal */}
      <Modal
         isOpen={showDeliveryModal}
         onClose={() => {
           setShowDeliveryModal(false);
           setRevisingDn(null);
         }}
         title={revisingDn ? `Revise Outbound Note: ${revisingDn.dn_number}` : "Initiate Outbound Note"}
         maxWidth="4xl"
         contentClassName="p-0 flex flex-col h-[85vh] border-t border-stone-100"
      >
        <form onSubmit={handleCreateDelivery} className="flex flex-col h-full">
          <div className="p-8 overflow-y-auto space-y-8 bg-stone-50 flex-1">
             <div className="flex flex-col mb-6">
               <label className="block text-[10px] font-bold uppercase tracking-widest text-stone-500 mb-2">Destination / Customer <span className="text-red-500">*</span></label>
               <select 
                 required 
                 value={deliveryForm.customer_id} 
                 onChange={e => {
                   const cid = e.target.value;
                   setDeliveryForm(prev => ({
                     ...prev,
                     customer_id: cid,
                     project_id: '',
                     items: []
                   }));
                 }} 
                 className="w-full px-4 py-3 bg-white border border-stone-200 text-sm font-bold text-stone-900 rounded-xl focus:border-stone-400 outline-none transition-all shadow-sm"
               >
                 <option value="">-- Select Destination --</option>
                 {customers.map(c => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
               </select>
             </div>

             {deliveryForm.customer_id && (
               <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                 <div className="flex flex-col">
                   <label className="block text-[10px] font-bold uppercase tracking-widest text-stone-500 mb-2">Related Project <span className="text-stone-400">(Optional)</span></label>
                   <select 
                     value={deliveryForm.project_id} 
                     onChange={e => {
                       const pid = e.target.value;
                       const selectedCustomerObj = customers.find(c => c.id === deliveryForm.customer_id);
                       const relatedProjectsAll = projects.filter(p => p.customer && selectedCustomerObj && p.customer.toLowerCase().trim() === selectedCustomerObj.name.toLowerCase().trim());
                       const proj = relatedProjectsAll.find(p => p.id === pid);
                       const matchingFg = fgItems.find(i => i.item_code === `FG-${pid}` || i.item_code === `FG-${pid}-SUB`);
                       
                       let newItems = [];
                       if (matchingFg) {
                         newItems = [{
                           item_id: matchingFg.id,
                           item_code: matchingFg.item_code,
                           item_name: matchingFg.name,
                           qty: proj?.quotation_qty || 1,
                           uom: matchingFg.uom || 'Unit'
                         }];
                       }
                       
                       setDeliveryForm(prev => ({
                         ...prev,
                         project_id: pid,
                         items: newItems
                       }));
                     }} 
                     className="w-full px-4 py-3 bg-white border border-stone-200 text-sm font-bold text-stone-900 rounded-xl focus:border-stone-400 outline-none transition-all shadow-sm"
                   >
                     <option value="">-- Select Project --</option>
                     {projects
                       .filter(p => {
                         const selectedCustomerObj = customers.find(c => c.id === deliveryForm.customer_id);
                         return selectedCustomerObj && p.customer && p.customer.toLowerCase().trim() === selectedCustomerObj.name.toLowerCase().trim();
                       })
                       .map(p => (
                         <option key={p.id} value={p.id}>
                           {p.id} - {p.name} ({p.status})
                         </option>
                       ))}
                   </select>
                   {deliveryForm.project_id && deliveryForm.items.length > 0 && (
                     <div className="text-xs text-emerald-650 font-bold mt-2 flex items-center gap-1.5">
                       <span>✓ Auto-loaded Finished Good SKU: <span className="font-mono">{deliveryForm.items[0].item_code}</span> ({deliveryForm.items[0].qty} {deliveryForm.items[0].uom})</span>
                     </div>
                   )}
                 </div>

                 <div className="flex flex-col">
                   <label className="block text-[10px] font-bold uppercase tracking-widest text-stone-500 mb-2">
                     {language === 'id' ? 'Nomor Polisi Kendaraan' : 'Vehicle Police Number'} <span className="text-red-500">*</span>
                   </label>
                   <input 
                     type="text"
                     required
                     placeholder={language === 'id' ? 'Contoh: DK 1234 AB' : 'e.g., DK 1234 AB'}
                     value={deliveryForm.police_number}
                     onChange={e => setDeliveryForm(prev => ({ ...prev, police_number: e.target.value.toUpperCase() }))}
                     className="w-full px-4 py-3 bg-white border border-stone-200 text-sm font-extrabold text-stone-900 rounded-xl focus:border-stone-400 outline-none transition-all shadow-sm"
                   />
                 </div>
               </div>
             )}

             <div className="pt-4 border-t border-stone-200">
                <div className="flex items-center justify-between mb-4 mt-6">
                   <span className="text-sm font-bold text-stone-900 uppercase tracking-wide">Delivery Payload</span>
                   <button type="button" onClick={() => setShowItemSelectModal(true)} className="px-4 py-2 bg-stone-200/50 hover:bg-stone-200 text-[10px] text-stone-900 font-bold uppercase tracking-widest rounded-lg flex gap-1.5 items-center transition-colors">
                     <Plus className="w-3.5 h-3.5" /> Add Items
                   </button>
                </div>

                <div className="border border-stone-200 rounded-xl overflow-hidden bg-white">
                   <table className="w-full text-left text-sm">
                      <thead className="bg-stone-50 border-b border-stone-200 text-[10px] uppercase font-bold tracking-widest text-stone-500">
                         <tr>
                            <th className="px-4 py-3">Item Spec</th>
                            <th className="px-4 py-3 w-32">Qty</th>
                            <th className="px-4 py-3 w-16"></th>
                         </tr>
                      </thead>
                      <tbody>
                         {deliveryForm.items.length === 0 && <tr><td colSpan={3} className="p-6 text-center text-xs font-medium text-stone-400">No products added.</td></tr>}
                         {deliveryForm.items.map((it, idx) => (
                            <tr key={idx} className="border-b border-stone-100 last:border-0 hover:bg-stone-50/50">
                               <td className="px-4 py-3 font-medium text-stone-900">
                                  <div className="font-mono text-[10px] text-stone-400 font-bold mb-1">{it.item_code}</div>
                                  {it.item_name}
                               </td>
                               <td className="px-4 py-3">
                                 <div className="flex items-center gap-2">
                                   <input type="number" min={0.1} step="0.1" value={it.qty} onChange={e => {
                                      const newItems = [...deliveryForm.items];
                                      newItems[idx].qty = parseFloat(e.target.value) || 0;
                                      setDeliveryForm({...deliveryForm, items: newItems});
                                   }} className="w-20 px-2 py-1.5 bg-stone-50 border border-stone-200 rounded-md font-mono text-xs text-center outline-none" />
                                   <span className="text-[10px] font-bold uppercase tracking-widest text-stone-500">{it.uom}</span>
                                  </div>
                               </td>
                               <td className="px-4 py-3 text-right">
                                  <button type="button" onClick={() => {
                                     const n = [...deliveryForm.items];
                                     n.splice(idx, 1);
                                     setDeliveryForm({...deliveryForm, items: n});
                                  }} className="p-2 text-stone-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"><X className="w-4 h-4"/></button>
                               </td>
                            </tr>
                         ))}
                      </tbody>
                   </table>
                </div>
             </div>

             <div>
               <label className="block text-[10px] font-bold uppercase tracking-widest text-stone-500 mb-2 mt-4">Remarks</label>
               <textarea rows={2} value={deliveryForm.remarks} onChange={e => setDeliveryForm({...deliveryForm, remarks: e.target.value})} className="w-full px-4 py-3 bg-white border border-stone-200 text-sm font-medium text-stone-900 rounded-xl focus:border-stone-400 outline-none transition-all shadow-sm" />
             </div>
          </div>
          
          <div className="p-6 border-t border-stone-100 flex justify-end gap-3 bg-white shrink-0">
             <Button type="button" variant="secondary" onClick={() => setShowDeliveryModal(false)}>Cancel</Button>
             <Button type="submit" disabled={isSubmitting}>Create Draft Manifest</Button>
          </div>
        </form>
      </Modal>

      {/* Item Select Modal */}
      <Modal
        isOpen={showItemSelectModal}
        onClose={() => setShowItemSelectModal(false)}
        title="Select Available SKUs (FG)"
        maxWidth="xl"
      >
          <div className="max-h-[60vh] overflow-y-auto space-y-3">
            {fgItems
              .map(item => {
                return (
                  <div 
                    key={item.id} 
                    onClick={() => addItemToDelivery(item)} 
                    className={cn(
                      "p-4 border bg-white rounded-2xl hover:border-stone-400 cursor-pointer transition-all flex justify-between items-center group shadow-sm hover:shadow-md border-stone-200"
                    )}
                  >
                    <div>
                      <div className="flex items-center gap-2 mb-1.5">
                        <div className="text-[10px] font-bold font-mono text-stone-400">{item.item_code}</div>
                      </div>
                      <div className="text-sm font-bold text-stone-900">{item.name}</div>
                    </div>
                    <div className="text-[10px] font-bold uppercase tracking-widest bg-stone-100 text-stone-500 px-3 py-1 rounded-md group-hover:bg-stone-800 group-hover:text-white transition-colors">Select</div>
                  </div>
                );
              })
            }
            {fgItems.length === 0 && (
              <div className="py-12 text-center text-stone-500 text-sm font-medium">No Finish Good SKUs are available in inventory yet. Use the Production/Engineering module to create FINISH_GOODS.</div>
            )}
         </div>
      </Modal>

      {/* Revise Modal */}
      <Modal
         isOpen={showReviseModal && selectedDnToRevise !== null}
         onClose={() => setShowReviseModal(false)}
         maxWidth="2xl"
         title={
           <div>
             <h3 className="text-lg font-bold text-stone-900">Revise Delivery Note</h3>
             <p className="text-[10px] text-stone-400 font-bold uppercase tracking-widest mt-0.5">Return to Sales for Changes</p>
           </div>
         }
      >
         <form onSubmit={handleReviseDn} className="space-y-6 pt-2">
           {selectedDnToRevise && (
             <div className="p-5 bg-stone-50 rounded-2xl border border-stone-100 mb-2">
               <div className="text-[10px] text-stone-400 font-bold uppercase tracking-widest mb-1.5">Draft DN Reference</div>
               <div className="text-base font-bold text-stone-900">{selectedDnToRevise.dn_number}</div>
               <div className="text-xs text-stone-500 mt-1 font-medium italic">Customer: {selectedDnToRevise.customer_name}</div>
             </div>
           )}

           <div className="flex gap-4 p-5 bg-rose-50/50 rounded-2xl border border-rose-100/50">
             <div className="w-10 h-10 rounded-xl bg-rose-100 flex items-center justify-center shrink-0 mt-1">
               <AlertTriangle className="w-5 h-5 text-rose-500" />
             </div>
             <div className="w-full">
               <h4 className="text-xs font-bold text-stone-900 mb-1">Revision Note</h4>
               <p className="text-[10px] text-stone-500 leading-relaxed mb-3">
                 Provide clear instructions on what needs to be changed exactly like adding a note on a field condition. This will be sent back to the sales team.
               </p>
               <textarea
                 required
                 value={revisionNote}
                 onChange={e => setRevisionNote(e.target.value)}
                 placeholder="E.g., Incorrect finish good quantities or wrong project..."
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

      {/* Finish Delivery Modal with standard file upload */}
      <Modal
        isOpen={showFinishModal}
        onClose={() => {
          setShowFinishModal(false);
          setFinishDnFile(null);
          setAuthDocName('');
        }}
        title="Finish Delivery"
        maxWidth="md"
        contentClassName="p-0 border-t border-stone-100"
      >
        {selectedFinishDn && (
          <form onSubmit={handleFinishDelivery} className="p-6 space-y-6">
            <div className="p-5 bg-stone-50 rounded-2xl border border-stone-100 mb-2">
              <div className="text-[10px] text-stone-400 font-bold uppercase tracking-widest mb-1.5">Delivery Reference</div>
              <div className="text-base font-bold text-stone-900">{selectedFinishDn.dn_number}</div>
              <div className="text-xs text-stone-500 mt-1 font-medium italic">Customer: {selectedFinishDn.customer_name}</div>
            </div>

            <div className="space-y-2">
              <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-widest px-1">Upload Customer Signed Manifest</label>
              <div className="relative group">
                <input 
                  required
                  type="file" 
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setFinishDnFile(file);
                      setAuthDocName(file.name);
                    }
                  }}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                />
                <div className="w-full border-2 border-dashed border-stone-100 rounded-3xl px-4 py-8 flex flex-col items-center justify-center bg-stone-50/50 group-hover:border-stone-300 transition-all">
                  <div className="w-10 h-10 bg-white rounded-2xl shadow-sm border border-stone-100 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                    <Upload className="w-5 h-5 text-stone-400" />
                  </div>
                  <span className={cn(
                    "text-[10px] font-bold tracking-widest uppercase text-center break-all px-2",
                    authDocName ? "text-stone-900" : "text-stone-400"
                  )}>
                    {authDocName || "Click or drag scanned manifest signature..."}
                  </span>
                </div>
              </div>
              <p className="text-[8px] text-rose-400 font-medium tracking-wide text-center uppercase mt-2">
                * MANIFEST MUST BE COUNTERSIGNED BY RECIPIENT (CUSTOMER)
              </p>
            </div>

            <div className="pt-2 flex justify-end gap-3 border-t border-stone-100">
              <Button 
                type="button" 
                variant="secondary" 
                onClick={() => {
                  setShowFinishModal(false);
                  setFinishDnFile(null);
                  setAuthDocName('');
                }}
              >
                Cancel
              </Button>
              <Button disabled={isSubmitting || !finishDnFile} type="submit" className="bg-emerald-600 text-white hover:bg-emerald-700">
                {isSubmitting ? "Completing..." : "Confirm Completion"}
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Preview Delivery Note Document - standard layout and export styling */}
      <Modal
         isOpen={!!previewDn}
         onClose={() => setPreviewDn(null)}
         title="Delivery Note Document"
         maxWidth="5xl"
         contentClassName="p-0 flex flex-col h-[85vh] border-t border-stone-100"
      >
         {previewDn && (
            <>

               <div className="flex-1 overflow-y-auto p-8 bg-stone-50 flex justify-center items-start">
                  <PrintTemplate
                    ref={printDocRef}
                    documentTitleId="SURAT JALAN"
                    documentTitleEn="DELIVERY NOTE"
                    documentNameId="surat jalan"
                    documentNameEn="delivery note"
                    date={new Date(previewDn.created_at).toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', year: 'numeric', month: 'short', day: 'numeric' })}
                    referenceNumber={previewDn.dn_number}
                    documentId={previewDn.id}
                    isDraft={previewDn.status === 'DRAFT'}
                    hideDefaultFooter={true}
                  >
                     {/* Grid Info */}
                     <div className="grid grid-cols-2 gap-12 mb-10">
                        <div>
                           <div className="text-[9px] font-bold tracking-widest uppercase text-stone-900 mb-3 border-b border-stone-100 pb-2">Ditujukan Kepada <span className="font-normal text-stone-400">/ Destined To (Consignee)</span></div>
                           <div className="text-base font-bold text-stone-900 mb-1">{previewDn.customer_name}</div>
                           <div className="text-xs font-medium text-stone-600 leading-relaxed whitespace-pre-wrap">{previewDn.customer_address}</div>
                           {previewDn.customer_email && <div className="text-xs font-medium text-stone-600 mt-1">{previewDn.customer_email}</div>}
                           {previewDn.customer_phone && <div className="text-xs font-medium text-stone-600 mt-1">{previewDn.customer_phone}</div>}
                        </div>
                        <div className="text-right">
                           <div className="text-[9px] font-bold tracking-widest uppercase text-stone-900 mb-3 border-b border-stone-100 pb-2">Referensi Logistik <span className="font-normal text-stone-400">/ Logistics Reference</span></div>
                           <div className="flex justify-between items-center text-xs font-medium mb-2.5">
                              <span className="text-stone-900 uppercase tracking-widest font-bold text-[9px]">Status Produk <span className="font-normal text-stone-400">/ Product Status:</span></span>
                              <span className="font-extrabold bg-white text-stone-700 px-2.5 py-0.5 rounded text-[10px] tracking-widest uppercase border border-stone-250">ASSEMBLED</span>
                           </div>
                           <div className="flex justify-between items-center text-xs font-medium mb-2.5">
                              <span className="text-stone-900 uppercase tracking-widest font-bold text-[9px]">Nomor Polisi <span className="font-normal text-stone-400">/ Police Number:</span></span>
                              <span className="font-extrabold bg-white text-stone-850 px-2.5 py-0.5 rounded text-[10px] tracking-widest uppercase border border-stone-200">{previewDn.police_number || '-'}</span>
                           </div>
                        </div>
                     </div>

                     {/* Items Table */}
                     <div className="flex-1 relative">
                        <table className="w-full text-left border-collapse">
                           <thead>
                              <tr className="border-b border-stone-300 bg-white">
                                <th className="py-3 px-4 font-bold text-stone-900 uppercase tracking-wider text-xs w-12 text-center">No</th>
                                <th className="py-3 px-4 font-bold text-stone-900 uppercase tracking-wider text-xs w-28">Kode Barang <span className="font-normal text-stone-500 text-[8px] block mt-0.5">/ ITEM CODE</span></th>
                                <th className="py-3 px-4 font-bold text-stone-900 uppercase tracking-wider text-xs">Deskripsi Produk <span className="font-normal text-stone-500 text-[8px] block mt-0.5">/ PRODUCT DESC</span></th>
                                <th className="py-3 px-4 font-bold text-stone-900 uppercase tracking-wider text-xs text-right">Jumlah <span className="font-normal text-stone-500 text-[8px] block mt-0.5">/ QTY</span></th>
                                <th className="py-3 px-4 font-bold text-stone-900 uppercase tracking-wider text-xs w-20">Sat <span className="font-normal text-stone-500 text-[8px] block mt-0.5">/ UOM</span></th>
                              </tr>
                           </thead>
                           <tbody>
                              {previewDn.items?.map((it: any, i: number) => (
                                <tr key={i} className="border-b border-stone-200">
                                  <td className="py-4 px-4 text-xs font-bold text-center text-stone-400">{String(i+1).padStart(2, '0')}</td>
                                  <td className="py-4 px-4 font-mono text-xs font-bold text-stone-500">{it.item_code}</td>
                                  <td className="py-4 px-4 text-xs font-bold text-stone-900 leading-snug">{it.item_name}</td>
                                  <td className="py-4 px-4 text-sm font-bold text-right font-mono">{it.qty}</td>
                                  <td className="py-4 px-4 text-[10px] tracking-widest uppercase font-bold text-stone-500">{it.uom}</td>
                                </tr>
                              ))}
                           </tbody>
                        </table>

                        {previewDn.remarks && (
                          <div className="mt-8 p-5 bg-white border border-stone-200 rounded-xl">
                            <div className="text-[9px] font-bold uppercase tracking-widest text-stone-900 mb-1.5">Info Pengiriman <span className="font-normal text-stone-400">/ Outbound Remarks</span></div>
                            <div className="text-xs font-medium text-stone-800 leading-relaxed italic">{previewDn.remarks}</div>
                          </div>
                        )}
                     </div>

                     {/* Standardized multi-column logistics signatures for Delivery Note */}
                     <div className="mt-auto grid grid-cols-4 gap-4 pt-8 border-t border-stone-200">
                        <div className="text-center font-sans">
                           <div className="text-[8px] text-stone-900 uppercase tracking-widest font-bold mb-4">Penerima <span className="text-stone-400 font-normal">/ Customer</span></div>
                           <div className="h-12 flex flex-col justify-end items-center mb-1">
                             {previewDn.signatures?.find((s: any) => s.role === 'PARTY_2')?.file_url?.includes('Digitally') ? (
                                <div className="flex flex-col items-center justify-center gap-1.5 border border-emerald-200 bg-emerald-50 min-w-[50px] w-auto px-3 py-1.5 rounded-lg shadow-sm">
                                  <QrCode className="w-8 h-8 text-emerald-600" />
                                </div>
                             ) : previewDn.signatures?.find((s: any) => s.role === 'PARTY_2')?.file_url?.startsWith('/uploads') ? (
                                <div className="text-[7px] font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded w-full uppercase tracking-widest text-center mt-auto">
                                  [EXTERNAL SIG. ON FILE]
                                </div>
                             ) : (
                                <div className="text-[8px] opacity-0">.</div>
                             )}
                           </div>
                           <div className="pt-2 flex flex-col justify-center items-center">
                              <div className="w-28 border-b border-stone-400 mb-1"></div>
                              {previewDn.signatures?.find((s: any) => s.role === 'PARTY_2')?.file_url?.includes('Digitally') ? (
                                  <span className="text-[8px] text-stone-400 font-bold uppercase tracking-wider italic">Auto-Assigned</span>
                              ) : (
                                  <span className="text-[8px] text-stone-400 font-bold uppercase tracking-wider">Date: ____/____/2026</span>
                              )}
                           </div>
                        </div>
                        <div className="text-center font-sans">
                           <div className="text-[8px] text-stone-900 uppercase tracking-widest font-bold mb-4">Pengemudi <span className="text-stone-400 font-normal">/ Driver</span></div>
                           <div className="h-12 flex items-center justify-center">
                             <div className="text-[8px] opacity-0">.</div>
                           </div>
                           <div className="pt-2 flex flex-col justify-center items-center">
                              <div className="w-28 border-b border-stone-400 mb-1"></div>
                              <span className="text-[8px] text-stone-400 font-bold uppercase tracking-wider">Date: ____/____/2026</span>
                           </div>
                        </div>
                        <div className="text-center font-sans">
                           <div className="text-[8px] text-stone-900 uppercase tracking-widest font-bold mb-4">Keamanan <span className="text-stone-400 font-normal">/ Security</span></div>
                           <div className="h-12 flex items-center justify-center">
                             <div className="text-[8px] opacity-0">.</div>
                           </div>
                           <div className="pt-2 flex flex-col justify-center items-center">
                              <div className="w-28 border-b border-stone-400 mb-1"></div>
                              <span className="text-[8px] text-stone-400 font-bold uppercase tracking-wider">Date: ____/____/2026</span>
                           </div>
                        </div>
                        <div className="text-center font-sans flex flex-col items-center">
                           <div className="text-[8px] text-stone-900 uppercase tracking-widest font-bold mb-4">Otoritas Gudang <span className="text-stone-400 font-normal">/ Warehouse Auth</span></div>
                           <div className="h-14 flex items-center justify-center w-full mb-1">
                             {previewDn.signatures?.find((s: any) => s.role === 'DISPATCH_PHASE')?.file_url?.includes('Digitally') ? (
                                <div className="flex flex-col items-center justify-center gap-1.5 border border-emerald-200 bg-emerald-50 min-w-[50px] w-auto px-3 py-1.5 rounded-lg shadow-sm">
                                  <QrCode className="w-8 h-8 text-emerald-600" />
                                </div>
                             ) : (
                                <div className="flex flex-col items-center gap-1 bg-stone-50 border border-dashed border-stone-300 w-24 px-2 py-3 rounded-lg">
                                  
                                  <div className="text-[5.5px] font-bold tracking-widest text-stone-400 uppercase">PENDING PIN</div>
                                </div>
                             )}
                           </div>
                           <p className="text-[10px] font-black text-stone-900 uppercase">{language === 'id' ? 'SMART e-APPROVAL' : 'SMART e-APPROVAL'}</p>
                           <div className="pt-2 flex flex-col justify-center items-center">
                              <div className="w-28 border-b border-stone-100 mb-1"></div>
                              {previewDn.signatures?.find((s: any) => s.role === 'DISPATCH_PHASE')?.file_url?.includes('Digitally') ? (
                                  <span className="text-[7.5px] text-emerald-600 font-bold tracking-widest uppercase flex items-center gap-1">VALIDATED SECURELY</span>
                              ) : (
                                  <span className="text-[8px] text-stone-400 font-bold uppercase tracking-wider">AWAITING AUTHORIZATION</span>
                              )}
                           </div>
                        </div>
                     </div>

                     <div className="mt-8 pt-6 border-t border-stone-105 text-[8.5px] text-center uppercase tracking-widest leading-relaxed font-bold z-10 relative">
                        <span className="text-stone-700">Surat jalan ini sah jika telah ditandatangani oleh penerima, driver, security & petugas gudang yang ditugaskan.</span>
                        <span className="text-stone-400 font-normal block mt-1">/ This Delivery Note is valid when signed off by receiving customer, driver, security, and warehouse agents.</span>
                     </div>
                  </PrintTemplate>
               </div>
               <div className="p-6 border-t border-stone-100 bg-white flex justify-center gap-4 shrink-0">
                  <Button 
                    variant="secondary"
                    onClick={() => setPreviewDn(null)}
                    className="px-6 py-2.5 rounded-xl text-sm"
                  >
                    {language === 'id' ? 'Tutup' : 'Close'}
                  </Button>
                  <Button 
                    variant="primary"
                    onClick={() => exportPdf()} 
                    isLoading={isSubmitting}
                    className="px-6 py-2.5 rounded-xl text-sm shadow-md"
                  >
                     {!isSubmitting && <Download className="w-4 h-4" />} 
                     {language === 'id' ? (isSubmitting ? 'Mengekspor...' : 'Ekspor PDF (A4)') : (isSubmitting ? 'Generating...' : 'Export PDF (A4)')}
                  </Button>
               </div>
            </>
         )}
      </Modal>

      {/* Standard confirmation modal rendering */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        onConfirm={confirmModal.action}
        onCancel={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}
