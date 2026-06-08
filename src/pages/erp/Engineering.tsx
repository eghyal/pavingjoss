import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, formatIDR, formatNumberWithDots } from '@/lib/utils';
import { Plus, X, AlertCircle, Maximize2, Info, Wrench, Download, FileText, RotateCcw, Package, AlertTriangle, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { ConfirmModal } from '@/components/shared/ConfirmModal';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { useAutoSave } from '@/hooks/useAutoSave';
import { safeFetchJson, apiFetch } from '@/utils/api';
import { BomPreviewModal } from '@/components/erp/BomPreviewModal';
import { Action, hasPermission } from '@/utils/pbac';

interface BomRow {
  id: string;
  item_code: string;
  name: string;
  dimension: string;
  spec: string;
  qty: string;
  unit: string;
  unit_price: string;
  matrix_unit_price?: string; // Current price from pricing matrix
  reference: string;
  // MRP Results
  item_id?: string;
  uom?: string;
  free_stock?: number;
  allocated_stock?: number;
  shortage_qty?: number;
  notFound?: boolean;
  pr_numbers?: string;
  total_pr_qty?: number;
}

export default function Engineering() {
  const [projects, setProjects] = useState<any[]>([]);
  const { data: selectedProject, setData: setSelectedProject } = useAutoSave<string>('engineering_selected_project', '');
  
  const draftKey = selectedProject ? `engineering_bom_rows_${selectedProject}` : 'engineering_bom_rows';
  const { data: rows, setData: setRows, clearDraft, isLoaded } = useAutoSave<BomRow[]>(draftKey, [
    { id: '1', item_code: '', name: '', dimension: '', spec: '', qty: '', unit: '', unit_price: '', reference: '' }
  ]);
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [urgency, setUrgency] = useState<'NORMAL' | 'URGENT' | 'CRITICAL'>('NORMAL');
  const { showToast } = useToast();
  const { user } = useAuth();
  const { language } = useLanguage();
  const [projectBomUpdatedAt, setProjectBomUpdatedAt] = useState<string | null>(null);
  const [showBomPreview, setShowBomPreview] = useState(false);
  const [quotationItems, setQuotationItems] = useState<any[]>([]);

  // Confirm Modal States
  const [confirmModal, setConfirmModal] = useState<{isOpen: boolean, title: string, message: string, action: () => void}>({
    isOpen: false, title: '', message: '', action: () => {}
  });

  const isEngineering = hasPermission(user, Action.MANAGE_BOM);

  const loadFromQuotation = () => {
    if (quotationItems.length === 0) return;
    setConfirmModal({
      isOpen: true,
      title: language === 'id' ? 'Impor dr Penawaran' : 'Import from Quotation',
      message: language === 'id' 
        ? 'Mekanisme ini akan menggantikan rancangan BOM saat ini dengan item deliverables dari Quotation.' 
        : 'This will replace your current BOM draft with the approved deliverables and quantities from the referenced Customer Quotation. Proceed?',
      action: () => {
        setRows(quotationItems.map((itm: any) => ({
          id: Math.random().toString(),
          item_id: '',
          item_code: `COMP-${itm.id.slice(-5).toUpperCase()}`,
          name: itm.title || '',
          dimension: '',
          spec: itm.remarks || '',
          qty: (itm.qty || 1).toString(),
          unit: itm.uom || 'PCS',
          unit_price: (itm.unit_price || 0).toString(),
          matrix_unit_price: (itm.unit_price || 0).toString(),
          reference: 'Quotation Ref'
        })));
        showToast(language === 'id' ? "Deliverables berhasil diimpor" : "Successfully imported quotation lines into BOM", "success");
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const fetchProjects = async () => {
    try {
      const res = await apiFetch('/api/projects', {}, user?.username);
      if (res.ok) {
        setProjects(Array.isArray(res.data) ? res.data : []);
      }
    } catch (err) {
      console.error("Engineering: Failed to fetch projects", err);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    setQuotationItems([]);

    if (selectedProject) {
      // Check if current rows are just the default empty state
      const isDefault = rows.length === 1 && !rows[0].item_code && !rows[0].item_id;

      apiFetch(`/api/projects/${selectedProject}`, {}, user?.username)
        .then(res => {
          const data = res.data;
          if (data) {
            setProjectBomUpdatedAt(data.project?.bq_updated_at || null);
            setQuotationItems(data.quotation_items || []);
            
            // Only overwrite rows if they are the default empty state
            // This preserves unsaved drafts in local storage
            if (isDefault) {
              if (data.bom && data.bom.length > 0) {
                setRows(data.bom.map((b: any) => ({
                  id: Math.random().toString(),
                  item_id: b.item_id,
                  item_code: b.item_code,
                  name: b.name || b.item_name,
                  dimension: b.dimension || '',
                  spec: b.spec || '',
                  qty: b.required_qty.toString(),
                  unit: b.uom || '',
                  unit_price: (b.unit_price || 0).toString(),
                  matrix_unit_price: (b.matrix_unit_price || b.unit_price || 0).toString(),
                  reference: b.reference || '',
                  
                  pr_numbers: b.pr_numbers,
                  total_pr_qty: b.total_pr_qty,
                  free_stock: b.free_stock || 0
                })));
              } else {
                setRows([{ id: '1', item_code: '', name: '', dimension: '', spec: '', qty: '', unit: '', unit_price: '', reference: '' }]);
              }
            }
          }
        })
        .catch(err => {
          console.error("Failed to load project BOM", err);
          showToast("Failed to load project BOM", "error");
        });
    } else {
      // If no project selected, check if we need to reset to default or keep generic draft
      const isDefault = rows.length === 1 && !rows[0].item_code && !rows[0].item_id;
      if (isDefault) {
        setRows([{ id: '1', item_code: '', name: '', dimension: '', spec: '', qty: '', unit: '', unit_price: '', reference: '' }]);
      }
    }
  }, [selectedProject, isLoaded]);

  const addRow = () => {
    setRows([...rows, { id: Math.random().toString(), item_code: '', name: '', dimension: '', spec: '', qty: '', unit: '', unit_price: '', reference: '' }]);
  };

  const removeRow = (id: string) => {
    setConfirmModal({
      isOpen: true,
      title: "Remove BOM Item?",
      message: "Are you sure you want to remove this item from the BOM?",
      action: () => {
        setRows(rows.filter(r => r.id !== id));
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const updateRow = async (id: string, field: keyof BomRow, value: string) => {
    const val = field === 'item_code' ? value.toUpperCase() : value;
    
    // When changing item_code, reset item-related fields and notFound
    if (field === 'item_code') {
      setRows(rows.map(r => r.id === id ? { ...r, [field]: val, item_id: undefined, notFound: false, free_stock: 0 } : r));
    } else {
      setRows(rows.map(r => r.id === id ? { ...r, [field]: val } : r));
    }

    if (field === 'item_code' && val.length >= 2) {
      try {
        const res = await apiFetch(`/api/items/code/${val}`, {}, user?.username);
        if (res.ok && res.data) {
          const item = res.data;
          setRows(prev => prev.map(r => r.id === id ? { 
            ...r, 
            name: item.name, 
            unit: item.uom,
            dimension: item.dimension,
            spec: item.spec,
            unit_price: (item.unit_price || 0).toString(),
            matrix_unit_price: (item.unit_price || 0).toString(),
            item_id: item.id,
            free_stock: item.free_stock || 0,
            notFound: false
          } : r));
        } else {
          setRows(prev => prev.map(r => r.id === id ? { ...r, notFound: true } : r));
        }
      } catch (err) {
        console.error(err);
        showToast("Error fetching item details", "error");
      }
    }
  };

  const handleSyncBom = async () => {
    if (!selectedProject) return showToast("Please select a project first.", "error");
    const validRows = rows.filter(r => r.item_code && r.qty);
    if (validRows.length === 0) return showToast("Please enter at least one valid item code and quantity.", "error");

    setIsSubmitting(true);
    try {
      const payload = {
        urgency,
        items: validRows.map(r => ({
          item_id: r.item_id || null,
          item_code: r.item_code,
          name: r.name,
          dimension: r.dimension,
          spec: r.spec,
          uom: r.unit || r.uom || 'pcs',
          required_qty: Number(r.qty),
          unit_price: Number(r.unit_price || 0),
          reference: r.reference,
          
          is_new: !r.item_id
        }))
      };
      const res = await apiFetch(`/api/projects/${selectedProject}/boms/sync`, {
        method: 'POST',
        body: JSON.stringify(payload)
      }, user?.username);
      
      const data = res.data;
      if (res.ok && data?.success) {
        showToast("BOM successfully saved/updated!", "success");
        clearDraft(false); // Clear draft without resetting data from UI
        
        // Refresh project data
        apiFetch(`/api/projects/${selectedProject}`, {}, user?.username)
          .then(res => {
             const data = res.data;
             if (data) setProjectBomUpdatedAt(data.project?.bq_updated_at || null);
          });
      } else {
        showToast(data?.error || "Failed to save BOM", "error");
      }
    } catch (err) {
      console.error(err);
      showToast("Failed to save BOM", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const summary = useMemo(() => {
    let stocked = 0;
    let pending = 0;
    let critical = 0;
    let totalItems = 0;
    let totalCost = 0;

    rows.forEach(r => {
      const itemCode = r.item_code?.trim();
      if (!itemCode) return;
      
      totalItems++;
      const needed = Number(r.qty) || 0;
      const onHand = (r.free_stock || 0);
      const inPR = (r.total_pr_qty || 0);
      const cost = needed * (Number(r.unit_price) || 0);
      totalCost += cost;

      if (r.notFound) {
        critical++;
      } else if (onHand >= needed) {
        stocked++;
      } else if ((onHand + inPR) >= needed) {
        pending++;
      } else {
        critical++;
      }
    });

    const readiness = totalItems > 0 ? Math.round((stocked / totalItems) * 100) : 0;
    return { stocked, pending, critical, totalItems, totalCost, readiness };
  }, [rows]);

  const currentProject = projects.find(p => p.id === selectedProject);

  const [searchModal, setSearchModal] = useState<{isOpen: boolean, rowId: string | null}>({ isOpen: false, rowId: null });
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    if (searchTerm.length < 2) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await apiFetch(`/api/items/search?q=${encodeURIComponent(searchTerm)}`, {}, user?.username);
        if (res.ok) setSearchResults(res.data || []);
      } catch (err) {
        console.error(err);
      } finally {
        setIsSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const selectItemFromSearch = (item: any) => {
    if (!searchModal.rowId) return;
    setRows(rows.map(r => r.id === searchModal.rowId ? { 
      ...r, 
      item_id: item.id,
      item_code: item.item_code,
      name: item.name,
      dimension: item.dimension || '',
      spec: item.spec || '',
      unit: item.uom || '',
      unit_price: (item.unit_price || 0).toString(),
      matrix_unit_price: (item.unit_price || 0).toString(),
      free_stock: item.free_stock || 0,
      notFound: false
    } : r));
    setSearchModal({ isOpen: false, rowId: null });
    setSearchTerm('');
  };

  const syncAllPricesWithMatrix = () => {
    const outOfSyncCount = rows.filter(r => r.item_id && r.matrix_unit_price && r.unit_price !== r.matrix_unit_price).length;
    if (outOfSyncCount === 0) {
      showToast("All prices are already synchronized with the pricing matrix.", "info");
      return;
    }

    setConfirmModal({
      isOpen: true,
      title: "Sync with Pricing Matrix?",
      message: `Syncing will update ${outOfSyncCount} items to their latest market prices. This will refresh your total cost estimate. Proceed?`,
      action: () => {
        setRows(rows.map(r => r.matrix_unit_price ? { ...r, unit_price: r.matrix_unit_price } : r));
        showToast("BOM prices updated to latest matrix rates.", "success");
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
      }
    });
  };



  const handleManualSaveDraft = () => {
    // useAutoSave handles persistence automatically, 
    // but we can explicitly setRows to ensure it's written and provide feedback
    setRows([...rows]);
    showToast("BOM draft and prices saved manually to local storage.", "success");
  };

  const resetFromServer = () => {
    if (!selectedProject) return;
    setConfirmModal({
      isOpen: true,
      title: "Discard Draft?",
      message: "This will discard your current unsaved changes and reload the official BOM from the server. Proceed?",
      action: async () => {
        try {
          const res = await apiFetch(`/api/projects/${selectedProject}`, {}, user?.username);
          const data = res.data;
          if (data && data.bom) {
            setRows(data.bom.map((b: any) => ({
              id: Math.random().toString(),
              item_id: b.item_id,
              item_code: b.item_code,
              name: b.name || b.item_name,
              dimension: b.dimension || '',
              spec: b.spec || '',
              qty: b.required_qty.toString(),
              unit: b.uom || '',
              unit_price: (b.unit_price || 0).toString(),
              matrix_unit_price: (b.matrix_unit_price || b.unit_price || 0).toString(),
              reference: b.reference || '',
              pr_numbers: b.pr_numbers,
              total_pr_qty: b.total_pr_qty,
              free_stock: b.free_stock || 0
            })));
            showToast("Reloaded from server.", "info");
          }
        } catch (err) {
          showToast("Failed to reload", "error");
        }
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
      }
    });
  };


  return (
    <div className="space-y-12 pb-20 animate-in fade-in duration-500">
      <PageHeader
        title="Bill of Materials"
        subtitle="Precision Project BOM & Technical Definition"
        icon={<Wrench className="w-6 h-6" />}
        actions={
          <>
            {projectBomUpdatedAt && (
              <div className="text-[10px] text-stone-400 font-semibold uppercase tracking-wider px-2">
                {language === 'id' ? 'Update Terakhir:' : 'Last Sync:'} {new Date(projectBomUpdatedAt).toLocaleString(language === 'id' ? 'id-ID' : 'en-US', { timeZone: 'Asia/Jakarta' })}
              </div>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-12 relative">
        <div className="xl:col-span-3 space-y-8">
           {/* Primary Controls */}
           <div className="bg-white border border-stone-200 rounded-3xl p-8 shadow-sm flex items-center justify-between gap-8 transition-all">
              <div className="flex-1">
                <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-[0.2em] mb-3">Active Project Engineering Instance</label>
                  <Select 
                    value={selectedProject} 
                    onChange={(e) => setSelectedProject(e.target.value)} 
                    className="w-full border border-stone-200 bg-stone-50/30 rounded-2xl pr-6 py-3.5 text-sm font-bold text-stone-950 focus:ring-4 focus:ring-stone-900/5 focus:border-stone-900 focus:bg-white outline-none transition-all cursor-pointer appearance-none uppercase tracking-tight shadow-sm group-hover:bg-stone-50"
                    icon={<Wrench className="w-4 h-4" />}
                  >
                  <option value="">-- UNASSIGNED --</option>
                  {projects.filter(p => p.status === 'ACTIVE' || p.status === 'HOLD' || p.status === 'FINISHED').map(p => <option key={p.id} value={p.id}>{p.id} - {p.name}</option>)}
                </Select>
              </div>
           </div>

          {selectedProject && currentProject && currentProject.id !== 'GENERAL' && (
              <div className="bg-white border border-stone-200 rounded-3xl p-8 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 divide-y xl:divide-y-0 xl:divide-x divide-stone-100">
                
                {/* SYSTEM IDENTITY */}
                <div className="flex flex-col justify-between pb-6 md:pb-8 xl:pb-0 xl:pr-8">
                  <div>
                    <div className="text-[10px] text-stone-400 font-bold uppercase tracking-widest mb-3 flex items-center gap-1.5">
                      <Wrench className="w-3.5 h-3.5 text-stone-400" />
                      System Identity
                    </div>
                    <div className="text-xl font-bold tracking-tight text-stone-900 leading-none">
                      {currentProject.id}
                    </div>
                    <div className="text-[10px] text-stone-500 font-semibold uppercase tracking-wider mt-2 leading-relaxed">
                      {currentProject.name}
                    </div>
                  </div>
                </div>

              {/* CONTROL PHASE */}
              <div className="flex flex-col justify-start pt-6 md:pt-0 md:pl-8 pb-6 md:pb-8 xl:pb-0 xl:px-8">
                <div>
                  <div className="text-[10px] text-stone-400 font-bold uppercase tracking-widest mb-4">
                    Phase Control
                  </div>
                  <div>
                    <span className={cn(
                      "inline-flex items-center gap-2 px-3.5 py-1.5 text-[9px] font-bold rounded-full uppercase tracking-widest border",
                      currentProject.status === 'DRAFT' ? "border-amber-200 text-amber-700 bg-amber-50/40" : 
                      currentProject.status === 'CLOSED' ? "border-stone-200 text-stone-500 bg-stone-50" :
                      "border-emerald-250 text-emerald-700 bg-emerald-50/20"
                    )}>
                      <span className={cn(
                        "w-1.5 h-1.5 rounded-full",
                        currentProject.status === 'DRAFT' ? "bg-amber-400" :
                        currentProject.status === 'CLOSED' ? "bg-stone-400" :
                        "bg-emerald-500"
                      )} />
                      {currentProject.status} CONTROL
                    </span>
                  </div>
                </div>
              </div>

              {/* REAL-TIME BUDGET */}
              <div className="flex flex-col justify-start pt-6 xl:pt-0 pb-6 md:pb-0 xl:px-8">
                <div>
                  <div className="text-[10px] text-stone-400 font-bold uppercase tracking-widest mb-3">
                    Real-time Budget
                  </div>
                  <div className="text-xl font-bold text-stone-900 tracking-tight">
                    {formatIDR(summary.totalCost)}
                  </div>
                  <div className="text-[10px] text-stone-500 font-medium mt-2 uppercase tracking-wider">
                    Total Sourced Cost
                  </div>
                </div>
              </div>

              {/* READINESS */}
              <div className="flex flex-col justify-start pt-6 xl:pt-0 xl:pl-8">
                <div>
                  <div className="text-[10px] text-stone-400 font-bold uppercase tracking-widest mb-3">
                    Material Readiness
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-xl font-bold text-stone-900">
                      {summary.readiness}%
                    </span>
                    <span className="text-[10px] text-stone-400 font-semibold uppercase tracking-wider">
                      Stocked
                    </span>
                  </div>
                  <div className="w-full h-2 bg-stone-100 border border-stone-200/55 rounded-full mt-3 overflow-hidden">
                    <div 
                      className={cn(
                        "h-full transition-all duration-1000 ease-out", 
                        summary.readiness === 100 ? "bg-emerald-500" : "bg-stone-800"
                      )}
                      style={{ width: `${summary.readiness}%` }}
                    />
                  </div>
                </div>
              </div>

            </div>
          )}

          <div className="border border-stone-200 rounded-2xl bg-white shadow-sm overflow-hidden">
            <div className="flex items-center justify-between bg-stone-100/50 px-6 py-4 border-b border-stone-200">
               <div className="flex items-center gap-3">
                 <Package className="w-4 h-4 text-stone-400" />
                 <h3 className="text-xs font-bold text-stone-600 uppercase tracking-wider">Material Components</h3>
               </div>
            </div>

            <div className="divide-y divide-stone-100">
              {rows.map((row, index) => (
                <div key={row.id} className="px-8 py-6 hover:bg-stone-50 transition-colors group relative flex gap-6 items-start">
                  <div className="text-[10px] font-bold text-stone-400 w-10 pt-4 text-center shrink-0 font-mono">
                    {String(index + 1).padStart(2, '0')}
                  </div>
                  
                  <div className="flex-1 space-y-5">
                    {/* Row 1: Primary Identification */}
                    <div className="grid grid-cols-12 gap-5">
                      <div className="col-span-4 space-y-1.5">
                        <label className="text-[9px] font-bold text-stone-400 uppercase tracking-[0.15em] px-1">Item Code</label>
                        <div className="relative group/input">
                          <input 
                            type="text" 
                            value={row.item_code} 
                            readOnly={!isEngineering}
                            onChange={(e) => updateRow(row.id, 'item_code', e.target.value)} 
                            className={cn(
                              "w-full bg-white border border-stone-200 rounded-xl px-4 py-3 text-sm uppercase outline-none focus:border-stone-900 focus:ring-4 focus:ring-stone-900/5 transition-all font-bold tracking-tight",
                              row.notFound ? "text-rose-600 border-rose-300 bg-rose-50" : "text-stone-950",
                              !isEngineering && "border-transparent bg-transparent"
                            )} 
                            placeholder="SKU-XXXXX"
                          />
                          <button 
                            onClick={() => setSearchModal({ isOpen: true, rowId: row.id })}
                            className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 hover:bg-stone-100 rounded-lg text-stone-400 transition-all"
                          >
                            <Search className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        {row.notFound && (
                          <Link 
                            to="/warehouse" 
                            className="text-[9px] text-rose-600 font-bold uppercase mt-1 flex items-center gap-1 hover:underline ml-1"
                          >
                            <AlertCircle className="w-3 h-3" /> Create New Items
                          </Link>
                        )}
                      </div>

                      <div className="col-span-8 space-y-1.5">
                        <label className="text-[9px] font-bold text-stone-400 uppercase tracking-[0.15em] px-1">Component Name & Description</label>
                        <input 
                          type="text" 
                          value={row.name} 
                          readOnly={!!row.item_id || !isEngineering} 
                          onChange={(e) => updateRow(row.id, 'name', e.target.value)} 
                          className={cn(
                            "w-full bg-white border border-stone-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-stone-900 focus:ring-4 focus:ring-stone-900/5 font-bold text-stone-900",
                            (!!row.item_id || !isEngineering) && "border-transparent bg-transparent"
                          )} 
                          placeholder="Internal System Component Name"
                        />
                      </div>
                    </div>

                    {/* Row 2: Specifications & Logistics */}
                    <div className="grid grid-cols-12 gap-5 py-3 px-4 bg-stone-50/50 rounded-2xl border border-stone-100/50">
                      <div className="col-span-3 space-y-1.5">
                        <label className="text-[8px] font-bold text-stone-400 uppercase tracking-widest px-1">Dimensions</label>
                        <input 
                          type="text" 
                          value={row.dimension}
                          readOnly={!isEngineering}
                          onChange={(e) => updateRow(row.id, 'dimension', e.target.value)} 
                          className={cn(
                            "w-full bg-white border border-stone-100 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-stone-400 font-medium text-stone-900",
                            !isEngineering && "border-transparent bg-transparent"
                          )} 
                          placeholder="L x W x H"
                        />
                      </div>

                      <div className="col-span-3 space-y-1.5">
                        <label className="text-[8px] font-bold text-stone-400 uppercase tracking-widest px-1">Technical Spec</label>
                        <input 
                          type="text" 
                          value={row.spec}
                          readOnly={!isEngineering}
                          onChange={(e) => updateRow(row.id, 'spec', e.target.value)} 
                          className={cn(
                            "w-full bg-white border border-stone-100 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-stone-400 font-medium text-stone-900",
                            !isEngineering && "border-transparent bg-transparent"
                          )} 
                          placeholder="Standard Configuration"
                        />
                      </div>

                      <div className="col-span-2 space-y-1.5">
                        <label className="text-[8px] font-bold text-stone-400 uppercase tracking-widest px-1">Quantity</label>
                        <input 
                          type="number" 
                          value={row.qty} 
                          readOnly={!isEngineering}
                          onChange={(e) => updateRow(row.id, 'qty', e.target.value)} 
                          className={cn(
                            "w-full bg-white border border-stone-100 rounded-lg px-3 py-2 text-sm text-stone-950 outline-none focus:border-stone-900 font-bold text-center",
                            !isEngineering && "border-transparent bg-transparent"
                          )} 
                        />
                      </div>

                      <div className="col-span-2 space-y-1.5">
                         <label className="text-[8px] font-bold text-stone-400 uppercase tracking-widest px-1">Uom</label>
                         <input 
                          type="text" 
                          value={row.unit || row.uom || ''} 
                          readOnly={!!row.item_id || !isEngineering} 
                          onChange={(e) => updateRow(row.id, 'unit', e.target.value)} 
                          className="w-full bg-white border border-stone-100 rounded-lg px-3 py-2 text-[13px] text-stone-900 outline-none focus:border-stone-400 font-bold text-center uppercase"
                          placeholder="PCS"
                        />
                      </div>

                      <div className="col-span-2 space-y-1.5">
                         <label className="text-[8px] font-bold text-stone-400 uppercase tracking-widest px-1 text-center block">Stock</label>
                         <div className={cn(
                           "w-full border rounded-lg px-3 py-2 text-center text-xs font-bold font-mono",
                           (row.free_stock || 0) > 0 ? "bg-emerald-50 border-emerald-100 text-emerald-600" : "bg-stone-100 border-stone-200 text-stone-400"
                         )}>
                           {row.free_stock || 0}
                         </div>
                      </div>
                    </div>

                    {/* Row 3: Financials & Reference */}
                    <div className="grid grid-cols-12 gap-5 px-1">
                      <div className="col-span-4 space-y-1.5 opacity-80">
                        <label className="text-[9px] font-bold text-stone-400 uppercase tracking-[0.15em] px-1 flex justify-between">
                          Matrix Unit Price (IDR)
                          {row.item_id && row.matrix_unit_price && row.unit_price !== row.matrix_unit_price && (
                            <span className="text-amber-600 animate-pulse lowercase font-bold tracking-normal italic flex items-center gap-1.5 font-mono">
                              <AlertTriangle className="w-3.5 h-3.5" /> Out of Sync
                            </span>
                          )}
                        </label>
                        <div className={cn(
                          "w-full bg-stone-50 border border-stone-200 rounded-xl px-4 py-3 text-sm font-bold text-stone-900 flex items-center justify-between",
                          row.item_id && row.matrix_unit_price && row.unit_price !== row.matrix_unit_price && "border-amber-300 bg-amber-50/50"
                        )}>
                          <span>{formatNumberWithDots(Number(row.unit_price || 0))}</span>
                          {row.item_id && (
                            <span className="text-[8px] text-stone-400 font-bold uppercase tracking-widest bg-white px-2 py-1 rounded-lg border border-stone-100">
                              Fixed Matrix
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="col-span-8 space-y-1.5">
                        <label className="text-[9px] font-bold text-stone-400 uppercase tracking-[0.15em] px-1">Reference / Remarks</label>
                        <input 
                          type="text" 
                          value={row.reference} 
                          readOnly={!isEngineering}
                          onChange={(e) => updateRow(row.id, 'reference', e.target.value)} 
                          className={cn(
                            "w-full bg-white border border-stone-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-stone-900 focus:ring-4 focus:ring-stone-900/5 font-bold text-stone-900 placeholder:text-stone-400",
                            !isEngineering && "border-transparent bg-transparent"
                          )} 
                          placeholder="Drawing Ref, Revision, or Note"
                        />
                      </div>
                    </div>
                  </div>
                  
                  <div className="w-10 shrink-0 pt-10 flex justify-end">
                    {isEngineering && (
                      <Button 
                        onClick={() => removeRow(row.id)} 
                        variant="ghost"
                        className="w-10 h-10 rounded-xl p-0 text-stone-400 hover:text-rose-500 hover:bg-rose-50 transition-all focus:opacity-100"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="px-6 py-4 bg-stone-50 border-t border-stone-200">
              <Button 
                disabled={!isEngineering}
                onClick={addRow}
                variant="secondary"
                className="w-full flex items-center justify-center gap-2 py-3 text-xs uppercase"
              >
                  <Plus className="w-4 h-4" /> Add Component
              </Button>
            </div>
          </div>
        </div>

        {/* Global Summary Column (Desktop Sticky) */}
        <div className="space-y-6">
           <div className="xl:sticky xl:top-6 space-y-6">
              <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-sm space-y-6">
                 <div>
                    <h4 className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-4">Supply Chain Distribution</h4>

                 </div>

                 <div className="pt-6 border-t border-stone-100">
                    <div className="flex justify-between items-end mb-2">
                       <span className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Readiness</span>
                       <span className="text-xl font-bold text-stone-900">{summary.readiness}%</span>
                    </div>
                 </div>

                 <div className="pt-6 border-t border-stone-100">
                    <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest block mb-2">Budget</label>
                    <div className="text-lg font-bold text-stone-900">
                       {formatIDR(summary.totalCost)}
                    </div>
                 </div>

                  <div className="pt-6 border-t border-stone-100 space-y-3">
                    <Button 
                      variant="secondary"
                      onClick={handleManualSaveDraft}
                      className="w-full flex items-center justify-center gap-2"
                      disabled={!isEngineering}
                    >
                      SAVE DRAFT
                    </Button>
                    <Button 
                      onClick={handleSyncBom} 
                      disabled={isSubmitting || rows.some(r => r.notFound || (r.item_code && r.item_code.trim() === '')) || !isEngineering} 
                      className="w-full"
                    >
                      {isSubmitting ? 'SAVING...' : 'COMMIT BOM'}
                    </Button>

                    {quotationItems.length > 0 && (
                      <Button
                        onClick={loadFromQuotation}
                        variant="secondary"
                        className="w-full flex items-center justify-center gap-2 border-dashed border-stone-300 bg-amber-50/20 text-stone-900 hover:bg-amber-50/50"
                      >
                        <Plus className="w-4 h-4 text-amber-600" />
                        {language === 'id' ? 'IMPOR DR PENAWARAN' : 'IMPORT FROM QUOTATION'}
                      </Button>
                    )}

                    <div className="flex flex-col gap-2 pt-2">
                      <button
                        onClick={() => setShowBomPreview(true)}
                        className="text-[10px] text-stone-400 font-bold uppercase tracking-widest hover:text-stone-900 transition-colors flex items-center justify-center gap-2 py-2 border border-transparent hover:border-stone-100 rounded-lg hover:bg-stone-50"
                      >
                        <FileText className="w-3.5 h-3.5 text-stone-400" /> Export Est Price PDF
                      </button>
                      
                      {selectedProject && rows.length > 0 && rows.some(r => r.item_code) && (
                        <button
                          onClick={resetFromServer}
                          className="text-[9px] text-stone-400 font-bold uppercase tracking-widest hover:text-rose-600 transition-colors flex items-center justify-center gap-2 py-1.5 opacity-60 hover:opacity-100"
                        >
                          <RotateCcw className="w-3 h-3" /> Reset from Server
                        </button>
                      )}
                    </div>

                    {rows.some(r => r.item_id && r.matrix_unit_price && r.unit_price !== r.matrix_unit_price) && (
                      <Button
                        onClick={syncAllPricesWithMatrix}
                        variant="secondary"
                        className="w-full border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100 uppercase text-[10px] tracking-widest font-bold flex items-center justify-center gap-2 py-3"
                      >
                         Sync Pricing Matrix
                      </Button>
                    )}
                    {rows.some(r => r.notFound) && (
                      <p className="mt-3 text-center text-[10px] text-rose-500 font-bold uppercase">
                         UNRESOLVED SKU DETECTED
                      </p>
                    )}
                 </div>
              </div>

              <div className="bg-stone-100 text-stone-600 rounded-2xl p-6 flex items-start gap-4 border border-stone-200">
                 <div className="w-10 h-10 bg-stone-200 rounded-xl flex items-center justify-center shrink-0">
                    <Info className="w-5 h-5 text-stone-500" />
                 </div>
                 <p className="text-xs font-medium leading-relaxed uppercase tracking-tight">
                    Engineering master data is synchronized upon <span className="text-stone-900 font-semibold">COMMIT</span>.
                 </p>
              </div>
           </div>
        </div>
      </div>

      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        onConfirm={confirmModal.action}
        onCancel={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
      />

      {/* Item Search Modal */}
      <Modal
         isOpen={searchModal.isOpen}
         onClose={() => setSearchModal({ isOpen: false, rowId: null })}
         title="Registry Database Search"
         maxWidth="2xl"
         contentClassName="p-0 flex flex-col h-[75vh]"
      >
        <div className="p-6 border-b border-stone-100 shrink-0">
           <div className="relative group">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
              <input 
                type="text" 
                autoFocus
                placeholder="Search items by code, name or dimensions..." 
                className="w-full bg-stone-50 border border-stone-200 rounded-xl pl-10 pr-4 py-4 text-sm font-bold text-stone-900 outline-none focus:border-stone-900 focus:ring-4 focus:ring-stone-100 transition-all font-sans"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
           </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-stone-50/50">
           {isSearching ? (
             <div className="text-center py-16 animate-pulse">
                <div className="text-[10px] font-bold text-stone-400 uppercase tracking-[0.2em] flex flex-col items-center gap-3">
                   <div className="w-8 h-8 rounded-full border-2 border-stone-200 border-t-stone-900 animate-spin"></div>
                   Scanning Registry...
                </div>
             </div>
           ) : searchResults.length > 0 ? (
             searchResults.map(item => (
               <button 
                key={item.id} 
                onClick={() => selectItemFromSearch(item)}
                className="w-full text-left p-6 rounded-3xl border border-stone-200 hover:border-stone-900 bg-white hover:bg-stone-50 transition-all group flex justify-between items-center shadow-sm hover:shadow-md"
               >
                 <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3 mb-2">
                       <span className="px-3 py-1 bg-stone-100 rounded-lg text-[10px] font-bold text-stone-600 font-mono tracking-widest uppercase border border-stone-200/50">{item.item_code}</span>
                       <h5 className="text-base font-black text-stone-900 truncate tracking-tight">{item.name}</h5>
                    </div>
                    <div className="text-[10px] text-stone-500 font-bold uppercase tracking-widest flex gap-4">
                       {item.dimension && <span>DIM: {item.dimension}</span>}
                       {item.spec && <span>SPEC: {item.spec}</span>}
                    </div>
                 </div>
                 <div className="text-right shrink-0 ml-8 border-l border-stone-100 pl-8 transition-all group-hover:border-stone-200">
                    <div className="text-[9px] font-bold text-stone-400 uppercase tracking-widest mb-1.5">AVAIL_STOCK</div>
                    <div className={cn("text-xl font-black font-mono tracking-tighter", item.free_stock > 0 ? "text-emerald-600" : "text-stone-400")}>{item.free_stock || 0} <span className="text-[10px] text-stone-500 font-sans tracking-widest ml-1 uppercase">{item.uom}</span></div>
                 </div>
               </button>
             ))
           ) : searchTerm.trim().length > 0 ? (
              <div className="text-center py-20">
                 <Package className="w-12 h-12 text-stone-300 mx-auto mb-4" />
                 <div className="text-xs font-bold text-stone-400 uppercase tracking-widest">
                    No matching specs found.
                 </div>
              </div>
           ) : (
              <div className="text-center py-20 flex flex-col items-center">
                 <Search className="w-12 h-12 text-stone-200 mb-4" />
                 <div className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">
                    Enter parameters to begin
                 </div>
              </div>
           )}
        </div>
      </Modal>
       {selectedProject && (
         <BomPreviewModal 
           isOpen={showBomPreview}
           onClose={() => setShowBomPreview(false)}
           project={projects.find(p => p.id === selectedProject) || { id: selectedProject, name: selectedProject, status: 'ACTIVE' }}
           bomRows={rows}
           totalCost={summary.totalCost}
         />
       )}
    </div>
  );
}
