import React, { useState, useEffect } from 'react';
import { Modal } from '@/components/ui/Modal';
import { apiFetch } from '@/utils/api';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/contexts/ToastContext';
import { Landmark, Info, Plus, Trash2, FileText, Calendar, Percent, AlertTriangle, CreditCard, Sparkles, Bot } from 'lucide-react';
import { formatIDR, formatNumberWithDots, formatIDRWithDecimals } from '@/lib/utils';
import { Button } from '@/components/ui/Button';

interface CreateQuotationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (quotation: any) => void;
  revisingData?: any;
}

export const CreateQuotationModal: React.FC<CreateQuotationModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  revisingData
}) => {
  const { user } = useAuth();
  const { t } = useLanguage();
  const { showToast } = useToast();

  const [customers, setCustomers] = useState<any[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [validityDays, setValidityDays] = useState('20');
  const [npwpTaxId, setNpwpTaxId] = useState('');
  const [remarks, setRemarks] = useState('');
  const [taxRate, setTaxRate] = useState('12');
  const [pphRate, setPphRate] = useState('0');
  const [discountRate, setDiscountRate] = useState('0');
  const [items, setItems] = useState<{title: string, qty: string, uom: string, price: string}[]>([
    { title: '', qty: '1', uom: 'Unit', price: '' }
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [showAiBlock, setShowAiBlock] = useState(false);

  const generateWithAi = async () => {
    if (!aiPrompt) return;
    setAiLoading(true);
    try {
      const res = await apiFetch('/api/quotations/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: aiPrompt })
      }, user?.username);
      
      if (res.ok && res.data) {
        showToast("Auto-filled Quotation Details", "success");
        const { data } = res;
        
        if (data.client_name) {
          // Attempt fuzzy match for customer
          const matched = customers.find(c => c.name.toLowerCase().includes(data.client_name.toLowerCase()));
          if (matched) setCustomerId(matched.id);
        }
        
        if (data.valid_until_days) setValidityDays(String(data.valid_until_days));
        if (data.remarks) setRemarks(data.remarks);
        if (data.discount_rate !== undefined) setDiscountRate(String(data.discount_rate));
        if (data.tax_rate !== undefined) setTaxRate(String(data.tax_rate));
        
        if (data.items && data.items.length > 0) {
          setItems(data.items.map((i: any) => ({
            title: i.title || '',
            qty: String(i.qty || 1),
            uom: i.uom || 'Unit',
            price: String(i.price || 0)
          })));
        }
        setShowAiBlock(false);
        setAiPrompt('');
      } else {
        showToast(res.error || "Failed to generate AI data", "error");
      }
    } catch (e) {
      console.error(e);
      showToast("Error connecting to AI", "error");
    } finally {
      setAiLoading(false);
    }
  };

  // Derive amounts directly from the items state (reactive, single-source-of-truth)
  const subtotalAmount = items.reduce((sum, item) => {
    const q = parseFloat(item.qty) || 0;
    const p = parseFloat(item.price) || 0;
    return sum + (q * p);
  }, 0);

  const discountAmount = subtotalAmount * (parseFloat(discountRate) || 0) / 100;
  const afterDiscountAmount = subtotalAmount - discountAmount;
  const ppnTaxAmount = afterDiscountAmount * (parseFloat(taxRate) || 0) / 100;
  const pphTaxAmount = afterDiscountAmount * (parseFloat(pphRate) || 0) / 100;
  const grandTotalAmount = afterDiscountAmount + ppnTaxAmount;
  const netEarnings = grandTotalAmount - pphTaxAmount;

  useEffect(() => {
    if (isOpen) {
      // Fetch customers
      const fetchCustomers = async () => {
        try {
          const res = await apiFetch('/api/sales/customers', {}, user?.username);
          if (res.ok && Array.isArray(res.data)) {
            setCustomers(res.data);
          }
        } catch (e) {
          console.error("Failed to load customers for quotation", e);
        }
      };
      fetchCustomers();
      
      if (revisingData) {
        setCustomerId(revisingData.customer_id || '');
        setValidityDays((revisingData.validity_days || 20).toString());
        setNpwpTaxId(revisingData.npwp_tax_id || '');
        setRemarks(revisingData.remarks || '');
        setTaxRate((revisingData.tax_rate || 0).toString());
        setPphRate((revisingData.pph_rate || 0).toString());
        setDiscountRate((revisingData.discount_rate || 0).toString());
        
        if (revisingData.items && revisingData.items.length > 0) {
          setItems(revisingData.items.map((i: any) => ({
            title: i.title,
            qty: String(i.qty),
            uom: i.uom,
            price: String(i.unit_price)
          })));
        } else {
          setItems([{ title: '', qty: '1', uom: 'Unit', price: '' }]);
        }
      } else {
        // Reset form on open
        setCustomerId('');
        setValidityDays('20');
        setNpwpTaxId('');
        setRemarks('');
        setTaxRate('12');
        setPphRate('0');
        setDiscountRate('0');
        setItems([{ title: '', qty: '1', uom: 'Unit', price: '' }]);
      }
    }
  }, [isOpen, user?.username, revisingData]);

  const submitAs = async (status: string) => {
    if (!customerId) {
      showToast("Please select a customer", "error");
      return;
    }

    const validItems = items.filter(i => i.title.trim() !== '');
    if (validItems.length === 0) {
      showToast("Please add at least one item with a description", "error");
      return;
    }

    setIsSubmitting(true);
    try {
      // Standardized Generic Title inherited from the first descriptive item
      const mainProjectTitle = validItems[0]?.title || 'Multiple Items';
      const autoTitle = mainProjectTitle;

      const payload = {
        customer_id: customerId,
        status, // 'DRAFT' or 'PENDING'
        title: autoTitle,
        amount: grandTotalAmount,
        validity_days: parseInt(validityDays) || 20,
        npwp_tax_id: npwpTaxId,
        remarks,
        tax_rate: parseFloat(taxRate) || 0,
        pph_rate: parseFloat(pphRate) || 0,
        discount_rate: parseFloat(discountRate) || 0,
        items: validItems.map(i => ({ 
          title: i.title, 
          qty: Number(i.qty) || 1, 
          uom: i.uom, 
          unit_price: Number(i.price) || 0 
        }))
      };

      const endpoint = revisingData ? `/api/quotations/${revisingData.id}` : '/api/quotations';
      const method = revisingData ? 'PUT' : 'POST';

      const res = await apiFetch(endpoint, {
        method,
        body: JSON.stringify(payload)
      }, user?.username);

      if (res.ok) {
        showToast(revisingData ? "Quotation updated successfully" : "Quotation created successfully", "success");
        onSuccess(res.data?.data || payload);
        onClose();
      } else {
        showToast(res.error || `Failed to ${revisingData ? 'update' : 'create'} quotation`, "error");
      }
    } catch (err: any) {
      console.error(err);
      showToast(`Error ${revisingData ? 'updating' : 'creating'} quotation: ` + (err.message || "Unknown error"), "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    submitAs('PENDING'); // Fallback if submitted via enter
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="5xl"
      title={
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-stone-100 text-stone-900 rounded-2xl">
            <FileText className="w-5 h-5 text-[#006097]" />
          </div>
          <div>
            <h3 className="text-stone-900 font-bold text-lg uppercase tracking-tight">
              {revisingData ? `Revise Quotation: ${revisingData.quotation_number}` : 'Create Quotation'}
            </h3>
            <p className="text-[10px] text-stone-400 font-bold uppercase tracking-widest mt-0.5">
              {revisingData ? 'Update & Resubmit' : 'Initialize sales inquiry and pricing structure'}
            </p>
          </div>
        </div>
      }
      contentClassName="p-0"
    >
      <form onSubmit={handleSubmit} className="p-6 md:p-8 space-y-6">
        {revisingData && revisingData.revision_note && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 flex items-start gap-3 shadow-sm mb-6 w-full col-span-full">
            <AlertTriangle className="w-5 h-5 text-rose-600 mt-0.5 shrink-0" />
            <div>
              <div className="text-xs font-bold text-rose-800 uppercase tracking-widest mb-1.5">Revision Requested</div>
              <div className="text-sm font-medium text-rose-700 leading-relaxed max-w-3xl">"{revisingData.revision_note}"</div>
            </div>
          </div>
        )}
        
        <div className="flex justify-between items-center bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3 cursor-pointer select-none hover:bg-indigo-100 transition-colors" onClick={() => setShowAiBlock(!showAiBlock)}>
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-600" />
            <div>
              <div className="text-xs font-bold text-indigo-900 uppercase tracking-widest hidden sm:flex items-center gap-1.5">
                AI-Assisted No-Code Builder
                <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-700 text-[8px] font-extrabold rounded-md border border-indigo-200">BETA</span>
              </div>
              <div className="text-[10px] font-medium text-indigo-700">Generate configuration via natural language prompt (Tahap Pengembangan / BETA)</div>
            </div>
          </div>
          <Button type="button" variant="secondary" size="xs" onClick={(e) => { e.stopPropagation(); setShowAiBlock(!showAiBlock); }} className="bg-white border-indigo-200 text-indigo-700 hover:bg-indigo-50">
            {showAiBlock ? 'Close' : 'Launch'}
          </Button>
        </div>

        {showAiBlock && (
          <div className="bg-indigo-50/50 border border-indigo-200 p-5 md:p-6 rounded-2xl relative overflow-hidden">
             <div className="absolute top-0 right-0 p-8 opacity-5 pointer-events-none">
                <Sparkles className="w-48 h-48 text-indigo-600" />
             </div>
             <div className="relative z-10 w-full">
                <div className="mb-4">
                  <h4 className="text-sm font-bold text-indigo-900">Hyper-Agile Configuration</h4>
                  <p className="text-[11px] text-indigo-700">Describe the quotation in human language, and our Engine will convert it into actionable parameters for client, validity, structure, and price details.</p>
                </div>
                
                <div className="bg-white p-2 rounded-xl shadow-sm border border-indigo-100 focus-within:ring-2 ring-indigo-500/20 transition-all">
                   <textarea
                     className="w-full bg-transparent border-none outline-none resize-none p-3 text-stone-700 placeholder-stone-400 text-sm h-28"
                     placeholder="Example: Buatkan penawaran untuk project XYZ dengan Client PT Global Makmur. Item: 1) Audit TI (Rp 30 JT, 1 Unit), 2) Implementasi SAP (Rp 150 JT). Diskon 10%. Valid 14 hari."
                     value={aiPrompt}
                     onChange={e => setAiPrompt(e.target.value)}
                     disabled={aiLoading}
                   ></textarea>
                   <div className="flex justify-end p-2 border-t border-stone-50 items-center">
                      <Button 
                        type="button"
                        onClick={generateWithAi}
                        disabled={aiLoading || !aiPrompt}
                        className="bg-indigo-600 text-white hover:bg-indigo-700 font-bold px-4 py-1.5"
                      >
                        {aiLoading ? <span className="animate-pulse">Synthesizing...</span> : (
                           <>
                             <Bot className="w-4 h-4 mr-1" />
                             Auto-Generate
                           </>
                        )}
                      </Button>
                   </div>
                </div>
             </div>
          </div>
        )}

        {/* Top Info Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
          {/* Customer Selection */}
          <div className="md:col-span-2 space-y-1.5">
            <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest ml-1">
              Client / Customer *
            </label>
            <div className="relative">
              <Landmark className="absolute left-4 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-stone-400 pointer-events-none" />
              <select
                required
                value={customerId}
                onChange={e => setCustomerId(e.target.value)}
                className="w-full pl-11 pr-10 py-3.5 bg-white border border-stone-200 rounded-2xl text-xs font-bold text-stone-900 focus:border-stone-900 focus:ring-4 focus:ring-stone-100 outline-none transition-all shadow-xs cursor-pointer appearance-none"
              >
                <option value="">Select Target Customer</option>
                {customers.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-stone-400">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
          </div>

          {/* NPWP Tax ID */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest ml-1">
              NPWP / Tax ID
            </label>
            <div className="relative">
              <CreditCard className="absolute left-4 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-stone-400 pointer-events-none" />
              <input
                type="text"
                value={npwpTaxId}
                onChange={e => setNpwpTaxId(e.target.value)}
                placeholder="Optional NPWP"
                className="w-full pl-11 pr-4 py-3.5 bg-white border border-stone-200 rounded-2xl text-xs font-bold font-mono text-stone-900 focus:border-stone-900 focus:ring-4 focus:ring-stone-100 outline-none transition-all shadow-xs"
              />
            </div>
          </div>

          {/* Validity Days */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest ml-1">
              Validity (Working Days)
            </label>
            <div className="relative">
              <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-stone-400 pointer-events-none" />
              <input
                required
                type="number"
                min="1"
                value={validityDays}
                onChange={e => setValidityDays(e.target.value)}
                placeholder="Default 20 Days"
                className="w-full pl-11 pr-4 py-3.5 bg-white border border-stone-200 rounded-2xl text-xs font-bold font-mono text-stone-900 focus:border-stone-900 focus:ring-4 focus:ring-stone-100 outline-none transition-all shadow-xs"
              />
            </div>
          </div>
        </div>

        {/* Line Items Table Section */}
        <div className="space-y-3">
          <div className="flex justify-between items-center px-1">
            <h4 className="text-[11px] font-black text-stone-800 uppercase tracking-widest">
              Requested Project Lines / Deliverables
            </h4>
            <button 
              type="button"
              onClick={() => setItems([...items, { title: '', qty: '1', uom: 'Unit', price: '' }])}
              className="flex items-center gap-1.5 text-[10px] font-black text-[#006097] uppercase tracking-widest hover:text-[#004e7c] transition-colors bg-blue-50 hover:bg-blue-100/80 px-3 py-1.5 rounded-xl border border-blue-100"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Project Line
            </button>
          </div>

          <div className="border border-stone-200 rounded-2xl overflow-hidden bg-white shadow-xs">
            {/* Headers */}
            <div className="flex gap-3 bg-stone-50 border-b border-stone-200 px-4 py-3 text-[9px] font-black text-stone-500 uppercase tracking-widest select-none">
              <div className="flex-1">Description *</div>
              <div className="w-[75px] text-center">Qty</div>
              <div className="w-[90px] text-center">UOM</div>
              <div className="w-[160px] text-right">Price per Unit</div>
              <div className="w-[130px] text-right pr-2">Subtotal</div>
              <div className="w-9"></div>
            </div>

            {/* List Row Elements */}
            <div className="max-h-[220px] overflow-y-auto divide-y divide-stone-150 custom-scrollbar">
              {items.map((item, idx) => (
                <div key={idx} className="flex gap-3 items-center px-4 py-3 hover:bg-stone-50/50 transition-colors">
                  
                  {/* Title / Description */}
                  <div className="flex-1">
                    <input
                      required
                      type="text"
                      value={item.title}
                      onChange={e => {
                        const newItems = [...items];
                        newItems[idx].title = e.target.value;
                        setItems(newItems);
                      }}
                      placeholder="e.g. Mechanical Machining or Pipe Fabrication"
                      className="w-full px-3 py-2 bg-white border border-stone-200 rounded-xl text-xs font-semibold text-stone-900 shadow-3xs outline-none focus:border-stone-900 focus:ring-2 focus:ring-stone-100 transition-all placeholder:text-stone-300"
                    />
                  </div>

                  {/* Quantity */}
                  <div className="w-[75px]">
                    <input
                      required
                      type="number"
                      min="1"
                      step="any"
                      value={item.qty}
                      onChange={e => {
                        const newItems = [...items];
                        newItems[idx].qty = e.target.value;
                        setItems(newItems);
                      }}
                      placeholder="Qty"
                      className="w-full px-2 py-2 bg-white border border-stone-200 rounded-xl text-xs font-bold font-mono text-stone-900 text-center outline-none focus:border-stone-900 focus:ring-2 focus:ring-stone-100 transition-all"
                    />
                  </div>

                  {/* UOM */}
                  <div className="w-[90px]">
                    <input
                      required
                      type="text"
                      value={item.uom}
                      onChange={e => {
                        const newItems = [...items];
                        newItems[idx].uom = e.target.value;
                        setItems(newItems);
                      }}
                      placeholder="e.g. Unit"
                      className="w-full px-2.5 py-2 bg-white border border-stone-200 rounded-xl text-xs font-semibold text-stone-900 text-center outline-none focus:border-stone-900 focus:ring-2 focus:ring-stone-100 transition-all placeholder:text-stone-300"
                    />
                  </div>

                  {/* Price per Unit */}
                  <div className="w-[160px] relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-bold font-mono text-stone-400 select-none">Rp</span>
                    <input
                      required
                      type="text"
                      value={item.price ? formatNumberWithDots(item.price) : ''}
                      onChange={e => {
                        const newItems = [...items];
                        const val = e.target.value.replace(/[^\d]/g, '');
                        newItems[idx].price = val;
                        setItems(newItems);
                      }}
                      placeholder="0"
                      className="w-full pl-8 pr-3 py-2 bg-white border border-stone-200 rounded-xl text-xs font-bold font-mono text-stone-900 text-right outline-none focus:border-stone-900 focus:ring-2 focus:ring-stone-100 transition-all placeholder:text-stone-300"
                    />
                  </div>

                  {/* Cumulative Subtotal */}
                  <div className="w-[130px] text-right pr-2 text-xs font-mono font-bold text-stone-800 tracking-tight">
                    {formatIDR((Number(item.qty) || 0) * (Number(item.price) || 0))}
                  </div>

                  {/* Action Delete */}
                  <div className="w-9 flex justify-center">
                    <button
                      type="button"
                      onClick={() => setItems(items.filter((_, i) => i !== idx))}
                      disabled={items.length === 1}
                      className="p-1.5 text-stone-450 hover:text-rose-600 disabled:opacity-20 hover:bg-stone-100 rounded-lg transition-all"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Pricing Summary Breakdown and Remarks */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
          {/* Remarks input field */}
          <div className="space-y-1.5 flex flex-col h-full">
            <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest ml-1">
              Operational Terms & Remarks
            </label>
            <textarea
              value={remarks}
              onChange={e => setRemarks(e.target.value)}
              placeholder="Provide specific notes, logistics parameters, payment guidelines, or delivery timelines..."
              className="w-full flex-1 min-h-[140px] px-4 py-3.5 bg-white border border-stone-200 rounded-2xl text-xs font-semibold text-stone-850 focus:border-stone-900 focus:ring-4 focus:ring-stone-100 outline-none transition-all shadow-3xs resize-none"
            />
          </div>

          {/* Calculations Block */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest ml-1">
              Pricing & Tax Breakdown
            </label>
            <div className="bg-stone-50 border border-stone-200/80 rounded-2xl p-4 space-y-3.5 shadow-3xs">
              
              {/* DPP / Subtotal */}
              <div className="flex justify-between items-center text-xs border-b border-stone-100 pb-2">
                <span className="font-semibold text-stone-550 uppercase tracking-wider text-[9px]">
                  Subtotal (DPP)
                </span>
                <span className="font-bold font-mono text-stone-700">
                  {formatIDRWithDecimals(subtotalAmount, 2)}
                </span>
              </div>

              {/* Discount */}
              <div className="flex justify-between items-center text-xs border-b border-stone-100 pb-2">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-stone-550 uppercase tracking-wider text-[9px]">
                    Discount
                  </span>
                  <div className="relative w-16">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={discountRate}
                      onChange={e => setDiscountRate(e.target.value)}
                      className="w-full bg-stone-100 border border-stone-200 rounded px-1.5 py-0.5 text-[10px] font-bold text-stone-700 focus:outline-none focus:border-stone-400"
                    />
                    <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-stone-500">%</span>
                  </div>
                </div>
                <span className="font-bold font-mono text-rose-600">
                  - {formatIDRWithDecimals(discountAmount, 2)}
                </span>
              </div>

              {/* VAT tax rate */}
              <div className="flex justify-between items-center text-xs border-b border-stone-100 pb-2">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-stone-550 uppercase tracking-wider text-[9px]">
                    VAT / PPN
                  </span>
                  <div className="relative w-16">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={taxRate}
                      onChange={e => setTaxRate(e.target.value)}
                      className="w-full bg-stone-100 border border-stone-200 rounded px-1.5 py-0.5 text-[10px] font-bold text-stone-700 focus:outline-none focus:border-stone-400"
                    />
                    <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-stone-500">%</span>
                  </div>
                </div>
                <span className="font-bold font-mono text-stone-700">
                  {formatIDRWithDecimals(ppnTaxAmount, 2)}
                </span>
              </div>

              {/* PPh Withholding */}
              <div className="flex justify-between items-center text-xs border-b border-stone-100 pb-2">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-stone-550 uppercase tracking-wider text-[9px]">
                    Income Tax (WHT/PPh)
                  </span>
                  <div className="relative w-16">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.5"
                      value={pphRate}
                      onChange={e => setPphRate(e.target.value)}
                      className="w-full bg-stone-100 border border-stone-200 rounded px-1.5 py-0.5 text-[10px] font-bold text-stone-700 focus:outline-none focus:border-stone-400"
                    />
                    <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-stone-500">%</span>
                  </div>
                </div>
                <span className="font-bold font-mono text-rose-600">
                  - {formatIDRWithDecimals(pphTaxAmount, 2)}
                </span>
              </div>

              {/* Rounding Factor */}
              <div className="flex justify-between items-center text-xs border-b border-stone-100 pb-2">
                <span className="font-semibold text-stone-550 uppercase tracking-wider text-[9px]">
                  Rounding Factor
                </span>
                <span className="font-bold font-mono text-stone-600">
                  {formatIDRWithDecimals(Math.floor(netEarnings) - netEarnings, 2)}
                </span>
              </div>

              {/* Grand Total */}
              <div className="flex justify-between items-center">
                <span className="font-bold text-stone-950 uppercase tracking-widest text-[10px]">
                  Net Quotation Value
                </span>
                <span className="text-base font-black font-mono text-[#006097] tracking-tight">
                  {formatIDRWithDecimals(Math.floor(netEarnings), 2)}
                </span>
              </div>
              
            </div>
            
            <p className="text-[9px] text-stone-450 font-medium leading-relaxed italic px-1 pt-1">
              * The total figure is comprehensive and ready for legal Contract/SPK generation. All values are calculated automatically.
            </p>
          </div>
        </div>

        {/* Modal Submit and Dismiss Actions */}
        <div className="flex justify-end gap-3 pt-5 border-t border-stone-100 shrink-0">
          <Button
            type="button"
            disabled={isSubmitting}
            onClick={onClose}
            variant="secondary"
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={isSubmitting}
            onClick={() => submitAs('DRAFT')}
            className="bg-stone-100 text-stone-700 hover:bg-stone-200 border-none"
          >
            {isSubmitting ? "Saving..." : "Save as Draft"}
          </Button>
          <Button
            type="button"
            disabled={isSubmitting}
            onClick={() => submitAs('PENDING')}
          >
            {isSubmitting ? "Submitting..." : "Submit for Approval"}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
