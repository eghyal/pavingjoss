import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { safeFetchJson, apiFetch } from '@/utils/api';
import React, { useEffect, useRef, useState, useMemo } from 'react';
import { cn, useEscapeKey, formatIDR } from '@/lib/utils';
import { CheckSquare, Square, Truck, FileText, ChevronRight, X, Plus, Download, Printer, ClipboardCheck, Share2, Trash2, Archive, CheckCircle2, AlertCircle, AlertTriangle, Upload, QrCode, Lock, ShieldCheck } from 'lucide-react';
import { generatePDF } from '@/lib/pdfGenerator';
import { QRCodeSVG } from 'qrcode.react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/contexts/ToastContext';
import { useShare } from '@/contexts/ShareContext';
import { ConfirmModal } from '@/components/shared/ConfirmModal';
import { Select } from '@/components/ui/Select';
import { Loader } from '@/components/shared/Loader';
import { PageHeader } from '@/components/shared/PageHeader';
import { Action, hasPermission, hasGodMode } from '@/utils/pbac';
import { getDailyAuthKey } from '@/utils/auth';
import { PrintTemplate } from '@/components/erp/PrintTemplate';

interface PendingPR {
  pr_item_id: string;
  pr_id: string;
  item_id: string;
  pr_number: string;
  project_id: string;
  project_name: string;
  item_code: string;
  item_name: string;
  dimension: string;
  spec: string;
  qty: number;
  uom: string;
  unit_price: number | null;
  created_at: string;
  expected_delivery_date?: string;
  drawing_reference?: string;
  status: string;
  urgency?: 'NORMAL' | 'URGENT' | 'CRITICAL';
}

interface PO {
  id: string;
  po_number: string;
  supplier_name: string;
  expected_date: string;
  auth_doc_name?: string;
  status: string;
  urgency?: 'NORMAL' | 'URGENT' | 'CRITICAL';
  created_at: string;
  item_count: number;
  pr_numbers: string;
  pending_qty: number;
  has_cancelled_pr?: number;
  revision_note?: string;
  escalated_to?: string;
}

export default function Procurement() {
  const [pendingPrs, setPendingPrs] = useState<PendingPR[]>([]);
  const [pos, setPos] = useState<PO[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const { user } = useAuth();
  const { language, t } = useLanguage();
  const { showToast } = useToast();
  const { shareToForum } = useShare();
  const [isLoading, setIsLoading] = useState(true);
  const [selectedPrItems, setSelectedPrItems] = useState<Set<string>>(new Set());
  
  const selectablePrs = useMemo(() => pendingPrs.filter(p => p.status !== 'CANCELLED'), [pendingPrs]);
  const selectedItemsDetails = useMemo(() => pendingPrs.filter(p => selectedPrItems.has(p.pr_item_id)), [pendingPrs, selectedPrItems]);

  const [validSuppliers, setValidSuppliers] = useState<any[]>([]);
  const [isFetchingSuppliers, setIsFetchingSuppliers] = useState(false);

  const getSupplierTotalAndPrices = (supplier: any, selectedItems: any[]) => {
    let total = 0;
    const breakdown: { [itemId: string]: number } = {};
    
    supplier.item_prices?.forEach((ip: any) => {
      breakdown[ip.item_id] = ip.unit_price;
    });

    selectedItems.forEach(p => {
      const price = breakdown[p.item_id] ?? p.unit_price ?? 0;
      total += p.qty * price;
    });

    return { total, breakdown };
  };

  const sortedSuppliers = useMemo(() => {
    const selectedItems = selectedItemsDetails;
    const totalItemsInBatch = new Set(selectedItems.map(p => p.item_id)).size;
    const globalEstimatedCost = selectedItems.reduce((sum, p) => sum + (p.qty * (p.unit_price || 0)), 0);

    const scored = validSuppliers.map(supplier => {
      const { total, breakdown } = getSupplierTotalAndPrices(supplier, selectedItems);
      
      let fulfilledCount = 0;
      selectedItems.forEach(p => {
        if (breakdown[p.item_id] !== undefined && breakdown[p.item_id] > 0) {
          fulfilledCount++;
        }
      });

      const matchPercent = totalItemsInBatch > 0 ? (fulfilledCount / totalItemsInBatch) * 100 : 0;
      
      const totalPast = supplier.total_orders || 0;
      const passedPast = supplier.passed_count || 0;
      const rejectedPast = supplier.rejected_count || 0;
      
      let deliveryRate = 0.95; // default rating for new vendors
      if (totalPast > 0) {
        const completedGrns = passedPast + rejectedPast;
        if (completedGrns > 0) {
          deliveryRate = passedPast / completedGrns;
        }
      }
      
      const onTimeScore = Math.round(deliveryRate * 100);
      const proximityKm = Math.floor(3 + (supplier.name.charCodeAt(0) % 25) * 3);
      const leadTimeDays = Math.floor(1 + (supplier.name.charCodeAt(1) % 4));
      
      let costRatioModifier = total > 0 ? globalEstimatedCost / total : 1;
      if (costRatioModifier > 1.5) costRatioModifier = 1.5;
      if (costRatioModifier < 0.5) costRatioModifier = 0.5;
      const costSavingsScore = costRatioModifier * 100;
      
      const compositeScore = Math.round(
        (matchPercent * 0.45) + 
        (costSavingsScore * 0.25) + 
        (onTimeScore * 0.20) + 
        ((80 - proximityKm) / 80 * 100 * 0.10)
      );

      return {
        ...supplier,
        total,
        breakdown,
        matchPercent,
        fulfilledCount,
        totalItemsInBatch,
        onTimeScore,
        proximityKm,
        leadTimeDays,
        compositeScore: Math.max(15, Math.min(100, compositeScore))
      };
    });

    return scored.sort((a, b) => b.compositeScore - a.compositeScore);
  }, [validSuppliers, pendingPrs, selectedPrItems]);
  
  // Confirm Modal States
  const [confirmModal, setConfirmModal] = useState<{isOpen: boolean, title: string, message: string, action: () => void}>({
    isOpen: false, title: '', message: '', action: () => {}
  });

  const [showPoModal, setShowPoModal] = useState(false);
  const [revisingPo, setRevisingPo] = useState<any>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [poForm, setPoForm] = useState({
    supplier_id: '',
    supplier_name: '',
    urgency: 'NORMAL'
  });

  const [selectedPoDetails, setSelectedPoDetails] = useState<any>(null);
  const [showPoDocModal, setShowPoDocModal] = useState(false);
  const [showPrDetailsModal, setShowPrDetailsModal] = useState(false);
  const [selectedPrDetails, setSelectedPrDetails] = useState<any>(null);
  const [showAuthorizePoModal, setShowAuthorizePoModal] = useState(false);
  const [showRevisePoModal, setShowRevisePoModal] = useState(false);
  const [poRevisionNote, setPoRevisionNote] = useState('');
  const [selectedPoToAuth, setSelectedPoToAuth] = useState<any>(null);
  // We will change poAuthDocName to be used for the PIN instead
  const [poAuthPin, setPoAuthPin] = useState('');

  // (Legacy intelligent batching states and hooks removed, integrated into Generation Modal)

  // GRN State
  const [showGrnModal, setShowGrnModal] = useState(false);
  const [grnAuthPin, setGrnAuthPin] = useState('');
  const [grnItems, setGrnItems] = useState<any[]>([]);
  const [grnForm, setGrnForm] = useState({
    received_date: new Date().toISOString().split('T')[0],
    engineering_user: '',
    qc_user: '',
    qc_status: 'PASSED',
    remarks: ''
  });

  // GRN Report State
  const [showGrnReportModal, setShowGrnReportModal] = useState(false);
  const [completedGrnData, setCompletedGrnData] = useState<any>(null);
  const grnReportRef = useRef<HTMLDivElement>(null);

  // Re-issue Rejected GRN State
  const [showReissueGrnModal, setShowReissueGrnModal] = useState(false);
  const [reissueGrnItems, setReissueGrnItems] = useState<any[]>([]);
  const [reissueGrnForm, setReissueGrnForm] = useState({
    received_date: new Date().toISOString().split('T')[0],
    engineering_user: '',
    qc_user: '',
    qc_status: 'PASSED',
    remarks: '',
    rejected_grn_doc: ''
  });

  useEscapeKey(() => {
    setShowPoModal(false);
    setShowPoDocModal(false);
    setShowPrDetailsModal(false);
    setShowAuthorizePoModal(false);
    setShowGrnModal(false);
    setShowGrnReportModal(false);
    setShowReissueGrnModal(false);
    setConfirmModal(prev => ({...prev, isOpen: false}));
  });

  useEffect(() => {
    const fetchValidSuppliers = async () => {
      if (selectedPrItems.size === 0 || !showPoModal) return;
      
      setIsFetchingSuppliers(true);
      try {
        const selectedItems = selectedItemsDetails;
        const itemIds = Array.from(new Set(selectedItems.map(p => p.item_id))).join(',');
        
        const res = await apiFetch(`/api/purchasing/suppliers-by-items?item_ids=${itemIds}`, {}, user?.username);
        if (res.ok) {
          setValidSuppliers(res.data);
        }
      } catch (err) {
        console.error("Error fetching valid suppliers:", err);
      } finally {
        setIsFetchingSuppliers(false);
      }
    };

    fetchValidSuppliers();
  }, [showPoModal, selectedPrItems, pendingPrs, user?.username]);

  const fetchPoDetailsForGrn = async (poid: string) => {
    try {
      const res = await apiFetch(`/api/purchasing/po/${poid}`, {}, user?.username);
      if (res.ok) {
        const data = res.data;
        if (!data?.items) return;
        const itemMap = new Map();
        data.items.forEach((item: any) => {
          if (!itemMap.has(item.item_id)) {
            const pending = Math.max(0, item.qty - (item.received_qty || 0));
            itemMap.set(item.item_id, {
              ...item,
              qty: item.qty,
              qty_received: pending, // Default intake to remaining
              received_qty: item.received_qty || 0 // Previously received
            });
          } else {
            const existing = itemMap.get(item.item_id);
            existing.qty += item.qty;
            const newPending = Math.max(0, existing.qty - existing.received_qty);
            existing.qty_received = newPending;
          }
        });
        setGrnItems(Array.from(itemMap.values()));
      }
    } catch (err) {
      console.error(err);
      showToast('Failed to fetch PO details', 'error');
    }
  };

  const fetchPoDetailsForReissue = async (poid: string) => {
    try {
      const res = await apiFetch(`/api/purchasing/po/${poid}`, {}, user?.username);
      if (res.ok) {
        const data = res.data;
        if (!data?.items) return;
        const itemMap = new Map();
        data.items.forEach((item: any) => {
          if (!itemMap.has(item.item_id)) {
            itemMap.set(item.item_id, {
              ...item,
              qty: item.qty,
              qty_received: item.qty, // Default to full re-delivery
              received_qty: item.received_qty || 0
            });
          } else {
            const existing = itemMap.get(item.item_id);
            existing.qty += item.qty;
            existing.qty_received = existing.qty;
          }
        });
        setReissueGrnItems(Array.from(itemMap.values()));
      }
    } catch (err) {
      console.error(err);
      showToast('Failed to fetch PO details', 'error');
    }
  };

  const handleCompleteGrn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (grnAuthPin !== getDailyAuthKey(user?.username)) {
      showToast('Validation Failed: Invalid Authorization PIN.', 'error');
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await apiFetch('/api/purchasing/complete-grn', {
        method: 'POST',
        body: JSON.stringify({
          po_id: selectedPoDetails.id,
          ...grnForm,
          items: grnItems
        })
      }, user?.username);
      if (res.ok) {
        const data = res.data;
        setShowGrnModal(false);
        setGrnAuthPin('');
        // Show GRN Report
        setCompletedGrnData({
          po_number: selectedPoDetails.po_number,
          supplier_name: selectedPoDetails.supplier_name,
          pr_numbers: selectedPoDetails.pr_numbers,
          project_ids: selectedPoDetails.project_ids,
          ...grnForm,
          items: grnItems,
          grn_id: data.grn_id,
          created_at: new Date().toISOString()
        });
        setShowGrnReportModal(true);
        fetchData();
        showToast("GRN Complete. Item waiting for Warehouse Intake.", 'success');
      } else {
        showToast(res.error || "Failed to complete GRN", 'error');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReissueGrn = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const res = await apiFetch('/api/purchasing/complete-grn', {
        method: 'POST',
        body: JSON.stringify({
          po_id: selectedPoDetails.id,
          received_date: reissueGrnForm.received_date,
          engineering_user: reissueGrnForm.engineering_user,
          qc_user: reissueGrnForm.qc_user,
          qc_status: reissueGrnForm.qc_status,
          remarks: reissueGrnForm.remarks,
          rejected_grn_doc: reissueGrnForm.rejected_grn_doc,
          items: reissueGrnItems
        })
      }, user?.username);
      if (res.ok) {
        const data = res.data;
        setShowReissueGrnModal(false);
        // Show GRN Report for re-issue too
        setCompletedGrnData({
          po_number: selectedPoDetails.po_number,
          supplier_name: selectedPoDetails.supplier_name,
          pr_numbers: selectedPoDetails.pr_numbers,
          project_ids: selectedPoDetails.project_ids,
          ...reissueGrnForm,
          items: reissueGrnItems,
          grn_id: data.grn_id,
          created_at: new Date().toISOString(),
          is_reissue: true
        });
        setShowGrnReportModal(true);
        fetchData();
        showToast("Re-issue GRN Complete. Item waiting for Warehouse Intake.", 'success');
      } else {
        showToast(res.error || "Failed to re-issue GRN", 'error');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const exportGrnPdf = async () => {
    if (!grnReportRef.current) return;
    setIsSubmitting(true);
    try {
      await generatePDF(grnReportRef.current, `GRN-${completedGrnData?.grn_id || 'Report'}.pdf`);
      showToast('Crisp A4 Portrait GRN document exported successfully', 'success');
    } catch (err) {
      console.error(err);
      showToast('Export failed', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };


  const poDocRef = useRef<HTMLDivElement>(null);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [prsData, posData, supData] = await Promise.all([
        apiFetch('/api/purchasing/pending-prs', {}, user?.username),
        apiFetch('/api/purchasing/pos', {}, user?.username),
        apiFetch('/api/suppliers', {}, user?.username)
      ]);
      
      const sortedPrs = Array.isArray(prsData.data) ? prsData.data.sort((a: any, b: any) => {
        if (!a.expected_delivery_date && !b.expected_delivery_date) return 0;
        if (!a.expected_delivery_date) return 1;
        if (!b.expected_delivery_date) return -1;
        return new Date(a.expected_delivery_date).getTime() - new Date(b.expected_delivery_date).getTime();
      }) : [];

      setPendingPrs(sortedPrs);
      setPos(Array.isArray(posData.data) ? posData.data : []);
      setSuppliers(Array.isArray(supData.data) ? supData.data : []);
    } catch (err) {
      console.error("Purchasing: Failed to fetch data", err);
      showToast("Error fetching purchasing data", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const fetchPoDetails = async (poId: string, type: 'DOC') => {
    try {
      const res = await apiFetch(`/api/purchasing/po/${poId}`, {}, user?.username);
      if (!res.ok || !res.data?.items) {
        throw new Error(res.error || 'Failed to fetch PO details');
      }
      setSelectedPoDetails(res.data);
      if (type === 'DOC') {
        setShowPoDocModal(true);
      }
    } catch (err) {
      console.error(err);
      showToast('Failed to fetch PO details', 'error');
    }
  };

  const fetchPrDetails = async (prNumber: string) => {
    try {
      const res = await apiFetch(`/api/purchasing/pr/${prNumber}`, {}, user?.username);
      if (!res.ok || !res.data?.items) {
        throw new Error(res.error || 'Failed to fetch PR details');
      }
      setSelectedPrDetails(res.data);
      setShowPrDetailsModal(true);
    } catch (err) {
      console.error(err);
      showToast('Failed to fetch PR details', 'error');
    }
  };

  const handleAuthorizePo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (poAuthPin !== getDailyAuthKey(user?.username)) {
      showToast('Validation Failed: Invalid Authorization PIN.', 'error');
      return;
    }
    setIsSubmitting(true);
    try {
      const digitalSignature = `Digitally Authorized by ${user?.name || user?.username} (${user?.role}) on ${new Date().toISOString()}`;
      const res = await apiFetch('/api/purchasing/authorize-po', {
        method: 'POST',
        body: JSON.stringify({ po_id: selectedPoToAuth.id, auth_doc_name: digitalSignature })
      }, user?.username);
      if (res.ok) {
        setShowAuthorizePoModal(false);
        setPoAuthPin('');
        fetchData();
        showToast('PO digitally authorized successfully', 'success');
      } else {
        showToast(res.error || 'Failed to authorize PO', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Error authorizing PO', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRevisePo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!poRevisionNote.trim()) {
      showToast('Validation Failed: Revision note is required.', 'error');
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await apiFetch('/api/purchasing/revise-po', {
        method: 'POST',
        body: JSON.stringify({ po_id: selectedPoToAuth.id, revision_note: poRevisionNote })
      }, user?.username);
      if (res.ok) {
        setShowRevisePoModal(false);
        setPoRevisionNote('');
        fetchData();
        showToast('PO marked for revision', 'success');
      } else {
        showToast(res.error || 'Failed to revise PO', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Error revising PO', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelPo = (id: string) => {
    setConfirmModal({
      isOpen: true,
      title: "Cancel Purchase Order?",
      message: "Are you sure you want to cancel this PO? The internally linked Purchase Requests will be returned to their Authorized state.",
      action: async () => {
        try {
          const res = await apiFetch(`/api/purchasing/po/${id}/cancel`, { method: 'POST' }, user?.username);
          if (res.ok) {
            fetchData();
            showToast("PO cancelled successfully!", 'success');
          }
        } catch (err) {
          console.error(err);
        }
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const handleDeletePo = (id: string) => {
    setConfirmModal({
      isOpen: true,
      title: "Delete Purchase Order?",
      message: "Are you sure you want to delete this PO? This will permanently remove it from the system.",
      action: async () => {
        try {
          const res = await apiFetch(`/api/purchasing/po/${id}`, { method: 'DELETE' }, user?.username);
          if (res.ok) {
            fetchData();
            showToast("PO deleted successfully!", 'success');
          } else {
            showToast(res.error || "Failed to delete PO", 'error');
          }
        } catch (err) {
          console.error(err);
          showToast("Error deleting PO", 'error');
        }
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const handleArchivePr = (id: string) => {
    setConfirmModal({
      isOpen: true,
      title: "Archive Purchase Request?",
      message: "Are you sure you want to archive this Purchase Request? It will be safely moved to cold-storage and hidden from the active list, while remaining available in history for audits.",
      action: async () => {
        try {
          const res = await apiFetch(`/api/purchasing/archive-pr/${id}`, { method: 'POST' }, user?.username);
          if (res.ok) {
            showToast("Purchase Request successfully archived.", "success");
            fetchData();
          } else {
            showToast(res.error || "Failed to archive Purchase Request", "error");
          }
        } catch (err) {
          console.error(err);
          showToast("Failed to archive Purchase Request", "error");
        }
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const handleArchivePo = (id: string) => {
    setConfirmModal({
      isOpen: true,
      title: "Archive Purchase Order?",
      message: "Are you sure you want to archive this Purchase Order? Correct historical records remain intact and fully auditable in historic logs.",
      action: async () => {
        try {
          const res = await apiFetch(`/api/purchasing/archive-po/${id}`, { method: 'POST' }, user?.username);
          if (res.ok) {
            showToast("Purchase Order successfully archived.", "success");
            fetchData();
          } else {
            showToast(res.error || "Failed to archive Purchase Order", "error");
          }
        } catch (err) {
          console.error(err);
          showToast("Failed to archive Purchase Order", "error");
        }
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const handleArchiveFinishedPos = async () => {
    setConfirmModal({
      isOpen: true,
      title: "Archive Finished Purchase Orders?",
      message: "This will archive all FINISHED, CANCELLED, and RECEIVED Purchase Orders from the active workspace. This keeps your queue clean while maintaining flawless audit capability.",
      action: async () => {
        try {
          const res = await apiFetch('/api/purchasing/clear-pos', {
            method: 'POST'
          }, user?.username);
          if (res.ok) {
            fetchData();
            showToast("Finished Purchase Orders archived successfully.", "success");
          } else {
            showToast(res.error || "Failed to archive purchase orders", "error");
          }
        } catch (err) {
          console.error(err);
          showToast("Error archiving purchase orders", "error");
        }
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const exportPoPdf = async () => {
    if (!poDocRef.current) return;
    setIsSubmitting(true);
    try {
      await generatePDF(poDocRef.current, `PO_${selectedPoDetails?.po_number || 'Doc'}.pdf`);
    } catch (err) {
      console.error(err);
      showToast('Export failed', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };


  useEffect(() => {
    fetchData();
    
    // Support deep linking for shared resources
    const params = new URLSearchParams(window.location.search);
    const prParam = params.get('pr');
    const poParam = params.get('po');
    
    if (prParam) {
      fetchPrDetails(prParam);
    } else if (poParam) {
      fetchPoDetails(poParam, 'DOC');
    }
  }, []);

  const toggleSelection = (id: string) => {
    const newSet = new Set(selectedPrItems);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedPrItems(newSet);
  };



  const handleCreatePo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!revisingPo && selectedPrItems.size === 0) return;
    
    if (!revisingPo) {
      // Check if any selected item is missing a price
      const selectedItemsList = pendingPrs.filter(p => selectedPrItems.has(p.pr_item_id));
      const missingPriceItems = selectedItemsList.filter(p => !p.unit_price || p.unit_price <= 0);
      
      if (missingPriceItems.length > 0) {
        showToast(`Cannot issue PO. ${missingPriceItems.length} items missing price. Please update via RFQ.`, 'error');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      if (revisingPo) {
        const res = await apiFetch(`/api/purchasing/po/${revisingPo.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            supplier_name: poForm.supplier_name,
            urgency: poForm.urgency
          })
        }, user?.username);
        if (res.ok) {
          setShowPoModal(false);
          setRevisingPo(null);
          setPoForm({ supplier_id: '', supplier_name: '', urgency: 'NORMAL' });
          fetchData();
          showToast("PO Revised successfully!", 'success');
        } else {
          showToast(res.error || "Failed to revise PO", 'error');
        }
      } else {
        const res = await apiFetch('/api/purchasing/create-po', {
          method: 'POST',
          body: JSON.stringify({
            supplier_id: poForm.supplier_id,
            supplier_name: poForm.supplier_name,
            urgency: poForm.urgency,
            pr_item_ids: Array.from(selectedPrItems)
          })
        }, user?.username);
        
        if (res.ok) {
          const data = res.data;
          setShowPoModal(false);
          setSelectedPrItems(new Set());
          setPoForm({ supplier_id: '', supplier_name: '', urgency: 'NORMAL' });
          fetchData();
          
          // Automatically show the preview for the newly created PO
          if (data.id) {
            fetchPoDetails(data.id, 'DOC');
          }
          showToast("PO created successfully!", 'success');
        } else {
          showToast(res.error || "Failed to create PO", 'error');
        }
      }
    } catch (err) {
      console.error(err);
      showToast(revisingPo ? "Error revising PO" : "Error creating PO", 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const suggestions = useMemo(() => {
    const suggestions: { [itemCode: string]: PendingPR[] } = {};
    pendingPrs.filter(p => p.status !== 'CANCELLED').forEach(pr => {
      if (!suggestions[pr.item_code]) suggestions[pr.item_code] = [];
      suggestions[pr.item_code].push(pr);
    });
    return Object.entries(suggestions)
      .filter(([_, group]) => group.length > 1)
      .map(([code, group]) => ({
        itemCode: code,
        name: group[0].item_name,
        count: group.length,
        totalQty: group.reduce((acc, curr) => acc + curr.qty, 0),
        ids: group.map(g => g.pr_item_id)
      }));
  }, [pendingPrs]);

  return (
    <div className="space-y-12 pb-20 animate-in fade-in duration-500">
      <PageHeader
        title="Purchase Orders"
        subtitle="Purchase Orders & Multi-Supplier Fulfillment"
        icon={<Truck className="w-6 h-6 -scale-x-100" />}
        actions={
          <Button 
            onClick={() => {
              if (selectedPrItems.size === 0) return;
              setShowPoModal(true);
            }}
            disabled={selectedPrItems.size === 0 || !hasPermission(user, Action.CREATE_PO)}
            className="flex items-center gap-2 bg-stone-800 hover:bg-stone-900 text-white shadow-sm"
            title={!hasPermission(user, Action.CREATE_PO) ? "Only authorized personnel can generate POs" : ""}
          >
            <FileText className="w-5 h-5" /> Generate PO ({selectedPrItems.size})
          </Button>
        }
      />



      <div className="grid grid-cols-1 lg:grid-cols-5 gap-12">
        
        {/* Left Panel: Pending PRs */}
        <div className="lg:col-span-3 space-y-6">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-bold text-stone-400 uppercase tracking-widest flex items-center gap-2">
              Authorized PRs
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setConfirmModal({
                    isOpen: true,
                    title: "Archive Finished Requests?",
                    message: "Are you sure you want to archive all ORDERED and CANCELLED Purchase Requests? Archived items remain fully traceable under historical logs.",
                    action: async () => {
                      try {
                        const res = await apiFetch('/api/purchasing/clear-prs', { method: 'POST' }, user?.username);
                        if (res.ok) {
                          showToast("Finished requests successfully archived.", "success");
                          fetchData();
                        } else {
                          showToast(res.error || "Failed to archive requests", "error");
                        }
                      } catch (err) {
                        showToast("Action failed", "error");
                      }
                      setConfirmModal(prev => ({ ...prev, isOpen: false }));
                    }
                  });
                }}
                className="p-1 px-2 flex items-center gap-1.5 hover:bg-amber-50 hover:text-amber-800 text-stone-500 rounded-lg border border-transparent hover:border-amber-100/60 transition"
                title="Archive Finished Requests"
              >
                <Archive className="w-3.5 h-3.5 text-amber-600" />
              </Button>
              <Button
                variant="ghost"
                onClick={fetchData}
                className="p-1"
                title="Refresh Data"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
              </Button>
            </div>
          </div>
          
          <div className="bg-white border border-stone-100 rounded-2xl overflow-hidden">
            {isLoading ? (
              <Loader text="Loading data..." className="py-12" />
            ) : pendingPrs.length === 0 ? (
              <div className="p-12 text-center">
                <div className="w-12 h-12 bg-stone-50 text-stone-400 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <CheckSquare className="w-5 h-5 text-stone-400" />
                </div>
                <div className="text-sm font-bold text-stone-900 uppercase tracking-tighter">All Caught Up</div>
                <div className="text-[10px] text-stone-400 mt-1 font-bold uppercase tracking-widest">No pending purchase requests found.</div>
              </div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-stone-100/60 bg-white">
                    <th className="w-12 px-5 py-4 text-center">
                      <button 
                        onClick={() => {
                          if (selectedPrItems.size === selectablePrs.length && selectablePrs.length > 0) {
                            setSelectedPrItems(new Set());
                          } else {
                            setSelectedPrItems(new Set(selectablePrs.map(p => p.pr_item_id)));
                          }
                        }}
                        className="text-stone-400 hover:text-stone-900"
                      >
                        {selectablePrs.length > 0 && selectedPrItems.size === selectablePrs.length ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                      </button>
                    </th>
                    <th className="px-5 py-4 text-[10px] font-bold text-stone-400 uppercase tracking-widest">Document</th>
                    <th className="px-5 py-4 text-[10px] font-bold text-stone-400 uppercase tracking-widest">Details</th>
                    <th className="px-5 py-4 text-[10px] font-bold text-stone-400 uppercase tracking-widest text-right">Qty</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100/60">
                  {pendingPrs.map(pr => {
                    const isSelected = selectedPrItems.has(pr.pr_item_id);
                    const isCancelled = pr.status === 'CANCELLED';
                    return (
                      <tr 
                        key={pr.pr_item_id} 
                        className={cn(
                          "hover:bg-[#F9F9F8]/50 transition-colors",
                          isSelected && "bg-stone-50",
                          isCancelled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
                        )}
                        onClick={() => !isCancelled && toggleSelection(pr.pr_item_id)}
                      >
                        <td className="px-4 py-4 text-center">
                          <div className={cn("inline-flex", isSelected ? "text-stone-900" : "text-stone-400", isCancelled && "opacity-50")}>
                            {isSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <div className={cn("text-xs font-medium flex items-center gap-2 flex-wrap", isCancelled ? "line-through text-stone-400" : "text-stone-900")}>
                                {pr.pr_number}
                                {Math.random() > -1 && (pr.urgency === 'URGENT' || pr.urgency === 'CRITICAL') && (
                                  <span className={cn(
                                    "px-1.5 py-0.5 text-[8px] font-bold rounded uppercase tracking-wider no-underline",
                                    pr.urgency === 'CRITICAL' ? "bg-rose-500 text-white" : "bg-amber-500 text-amber-50"
                                  )}>
                                    {pr.urgency}
                                  </span>
                                )}
                                {isCancelled && (
                                  <span className="px-1.5 py-0.5 text-[8px] font-bold bg-stone-100 text-stone-500 border border-stone-200 rounded uppercase tracking-wider no-underline">
                                    Cancelled
                                  </span>
                                )}
                              </div>
                      <div className="text-[10px] text-stone-500 mt-1" title={pr.project_name}>
                                {pr.project_id}
                              </div>
                              {pr.expected_delivery_date && (
                                <div className="text-[10px] text-emerald-600 font-medium mt-1">
                                  Exp: {pr.expected_delivery_date}
                                </div>
                              )}
                              {pr.drawing_reference && (
                                <a 
                                  href={pr.drawing_reference} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="mt-1.5 inline-flex items-center gap-1.5 px-2 py-1 bg-stone-100 text-stone-900 hover:bg-stone-200 rounded text-[10px] font-medium transition-colors max-w-[150px]"
                                  title={pr.drawing_reference.split('/').pop()}
                                >
                                  <FileText className="w-3 h-3 shrink-0" /> 
                                  <span className="truncate">View Drawing Ref</span>
                                </a>
                              )}
                            </div>
                            <div className="flex gap-1.5">
                              <Button 
                                size="xs"
                                variant="secondary"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  shareToForum('PR', pr.pr_number, `Purchase Request: ${pr.pr_number}`, `New purchase request ${pr.pr_number} for project ${pr.project_name}. Item: ${pr.item_name} (${pr.qty} ${pr.uom}). Status: ${pr.status}`);
                                }}
                                title="Share to Forum"
                              >
                                <Share2 className="w-3.5 h-3.5" /> Share
                              </Button>
                              <Button 
                                size="xs"
                                action="view"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  fetchPrDetails(pr.pr_id);
                                }}
                              />
                              {(pr.status === 'ORDERED' || pr.status === 'RECEIVED' || pr.status === 'CANCELLED') && (
                                <Button 
                                  size="xs"
                                  variant="secondary"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleArchivePr(pr.pr_id);
                                  }}
                                  title="Archive Purchase Request"
                                  className="flex items-center gap-1.5 border border-stone-200/80 bg-stone-50 hover:bg-stone-100 text-stone-700 font-bold"
                                >
                                  <Archive className="w-3 h-3 text-stone-500" /> Archive
                                </Button>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4 min-w-[200px]">
                          <div className="text-sm font-medium text-stone-900">{pr.item_code}</div>
                          <div className="text-xs text-stone-500 mt-0.5 leading-relaxed">{pr.item_name}</div>
                          {(pr.dimension || pr.spec) && (
                            <div className="text-[10px] text-stone-400 mt-1">
                              {pr.dimension} {pr.spec && `| ${pr.spec}`}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-4 text-right">
                          <div className="text-sm font-medium text-stone-900">{pr.qty}</div>
                          <div className="text-[10px] text-stone-400 mt-0.5">{pr.uom}</div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Right Panel: Active POs */}
        <div className="lg:col-span-2 space-y-6">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-bold text-stone-400 uppercase tracking-widest flex items-center gap-2">
              Active Purchase Orders
            </div>
            <button
              onClick={handleArchiveFinishedPos}
              className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100/80 border border-amber-200/80 rounded-xl text-amber-800 transition-all active:scale-95 flex items-center gap-2 shadow-sm"
              title="Archive Finished Purchase Orders"
            >
              <Archive className="w-3.5 h-3.5 text-amber-600" />
              <span className="text-[10px] font-bold uppercase tracking-widest hidden xl:inline">Archive Finished</span>
            </button>
          </div>
          
          <div className="bg-white border border-stone-100 rounded-2xl overflow-hidden">
            {isLoading ? (
              <Loader text="Loading..." className="py-12" />
            ) : pos.length === 0 ? (
              <div className="p-12 text-center text-sm text-stone-500">No active POs.</div>
            ) : (
              <div className="divide-y divide-stone-100/60">
                {pos.map(po => {
                  const isCancelled = po.status === 'CANCELLED';
                  const todayDate = new Date();
                  todayDate.setHours(0,0,0,0);
                  const isLate = po.expected_date && new Date(po.expected_date) < todayDate && (po.status === 'ISSUED' || po.status === 'PARTIAL');

                  return (
                  <div key={po.id} onClick={() => fetchPoDetails(po.id, 'DOC')} className={cn(
                    "p-6 transition-colors group cursor-pointer border-l-4",
                    isCancelled ? "opacity-60 bg-stone-50/50 border-stone-200" : "hover:bg-stone-50 border-transparent"
                  )}>
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex items-center gap-2 flex-wrap">
                         <div className={cn("text-sm font-semibold uppercase tracking-widest", isCancelled ? "line-through text-stone-400" : "text-stone-900")}>
                           {po.po_number}
                         </div>
                         {po.has_cancelled_pr === 1 && !isCancelled && (
                           <span className="bg-rose-50 text-rose-600 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-widest inline-flex items-center gap-1" title="One or more associated PRs have been cancelled">
                             <AlertCircle className="w-3 h-3" /> PR Cancelled
                           </span>
                         )}
                          {(po.urgency === 'URGENT' || po.urgency === 'CRITICAL') && (
                            <span className={cn(
                              "px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-widest",
                              po.urgency === 'CRITICAL' ? "bg-rose-500 text-white" : "bg-amber-500 text-amber-50"
                            )}>
                              {po.urgency}
                            </span>
                          )}
                      </div>
                      <div className={cn(
                        "text-[10px] tracking-wider px-2.5 py-1 rounded-full font-semibold uppercase",
                        po.status === 'DRAFTED' ? "bg-amber-50 text-amber-700" :
                        po.status === 'REVISION' ? "bg-rose-50 text-rose-700" :
                        po.status === 'CANCELLED' ? "bg-stone-100 text-stone-500" :
                        isLate ? "bg-red-50 text-red-700" :
                        po.status === 'REJECTED' ? "bg-red-50 text-red-700" :
                        (po.status === 'ISSUED' || po.status === 'PARTIAL') ? "bg-blue-50 text-blue-700" :
                        "bg-emerald-50 text-emerald-700"
                      )}>
                        {
                          isLate ? 'LATE' :
                          po.status === 'RECEIVED' ? 'PASSED' :
                          po.status === 'ISSUED' ? 'ORDERS' :
                          po.status
                        }
                      </div>
                      {(po.status === 'DRAFTED' || po.status === 'PENDING') && po.escalated_to && (
                         <div className="text-[10px] tracking-wider px-2.5 py-1 rounded-full font-bold uppercase bg-rose-500 text-white flex items-center gap-1 shadow-sm">
                           <AlertTriangle className="w-2.5 h-2.5" /> ESCALATED TO {po.escalated_to}
                         </div>
                      )}
                    </div>
                    {po.status === 'REVISION' && po.revision_note && (
                       <div className="mt-1.5 flex items-start gap-1 p-2 bg-rose-50 border border-rose-100 rounded text-[10px] text-rose-700 max-w-[300px]">
                         <FileText className="w-3 h-3 shrink-0 mt-0.5" />
                         <span className="italic leading-snug break-words">"{po.revision_note}"</span>
                       </div>
                    )}
                    <div className={cn("text-sm font-medium mb-1.5 mt-1 flex items-center gap-2", isCancelled ? "text-stone-400" : "text-stone-600")}>
                      <Truck className="w-4 h-4 text-stone-400" /> {po.supplier_name}
                    </div>
                    <div className="text-xs text-stone-500 mt-3 flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5" /> PR: <span className={cn("font-medium", isCancelled ? "text-stone-400" : "text-stone-900")}>{po.pr_numbers || '-'}</span>
                    </div>
                    {po.auth_doc_name && (
                      <div className="text-xs text-emerald-600 mt-1 flex items-center gap-1.5 font-medium">
                        <CheckSquare className="w-3.5 h-3.5" /> PR Auth: {po.auth_doc_name}
                      </div>
                    )}
                    <div className="flex justify-between items-end mt-4">
                      <div className="text-xs text-stone-500 flex flex-col gap-1">
                        <div className="flex items-center gap-1.5">
                          ETA: <span className={cn("font-medium", isCancelled ? "text-stone-400" : "text-stone-900")}>{po.expected_date || 'TBD'}</span>
                        </div>
                        {po.expected_date && !isCancelled && po.status !== 'RECEIVED' && (
                          (() => {
                            const eta = new Date(po.expected_date);
                            const today = new Date();
                            today.setHours(0,0,0,0);
                            if (eta < today) {
                              return (
                                <span className="bg-red-50 text-red-600 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-widest inline-flex items-center gap-1 w-fit">
                                  <AlertCircle className="w-3 h-3" /> Overdue
                                </span>
                              );
                            }
                            return null;
                          })()
                        )}
                      </div>
                      <div className="flex gap-2 text-right">
                        <Button 
                          size="xs"
                          variant="secondary"
                          onClick={(e) => {
                            e.stopPropagation();
                            shareToForum('PO', po.id, `Purchase Order: ${po.po_number}`, `New purchase order ${po.po_number} issued to ${po.supplier_name}. Expected delivery: ${po.expected_date || 'TBD'}`);
                          }}
                          title="Share to Forum"
                        >
                          <Share2 className="w-3.5 h-3.5" /> Share
                        </Button>
                        {(po.status === 'RECEIVED' || po.status === 'PARTIAL') && (
                          <div className="px-3 py-1.5 bg-stone-50 text-stone-400 text-[10px] font-bold rounded-lg flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Materials at Warehouse
                          </div>
                        )}
                        {po.status === 'REJECTED' && (
                          <Button 
                            size="xs"
                            variant="danger_soft"
                            onClick={async (e) => { 
                              e.stopPropagation(); 
                              setSelectedPoDetails(po);
                              await fetchPoDetailsForReissue(po.id);
                              setShowReissueGrnModal(true);
                            }}
                            disabled={!hasPermission(user, Action.RECEIVE_PO)}
                            title="Re-issue GRN for rejected delivery"
                          >
                            <AlertCircle className="w-3.5 h-3.5" /> Issue Reject Status
                          </Button>
                        )}
                        {po.status === 'REVISION' && hasPermission(user, Action.CREATE_PO) && (
                          <Button 
                            size="xs"
                            action="revise"
                            onClick={async (e) => {
                              e.stopPropagation();
                              const res = await apiFetch(`/api/purchasing/po/${po.id}`, {}, user?.username);
                              if (res.ok) {
                                setRevisingPo(res.data);
                                setPoForm({
                                  supplier_id: res.data.supplier_id || '',
                                  supplier_name: res.data.supplier_name || '',
                                  urgency: res.data.urgency || 'NORMAL'
                                });
                                setShowPoModal(true);
                              }
                            }}
                          />
                        )}
                        {po.status === 'DRAFTED' && (
                          <>
                            <Button 
                              size="xs"
                              action="authorize"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedPoToAuth(po);
                                setShowAuthorizePoModal(true);
                              }}
                              disabled={!(hasPermission(user, Action.CREATE_PO) || po.escalated_to === user?.role)}
                            />
                            <Button 
                              size="xs"
                              action="revise"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedPoToAuth(po);
                                setShowRevisePoModal(true);
                              }}
                              disabled={!hasPermission(user, Action.CREATE_PO)}
                            />
                          </>
                        )}
                        {(po.status === 'ISSUED' || (po.status === 'PARTIAL' && po.pending_qty > 0)) && (
                          <Button 
                            size="xs"
                            variant="success_soft"
                            onClick={async (e) => { 
                              e.stopPropagation(); 
                              setSelectedPoDetails(po);
                              await fetchPoDetailsForGrn(po.id);
                              setShowGrnModal(true);
                            }}
                            disabled={!hasPermission(user, Action.RECEIVE_PO)}
                            title="Complete Goods Receipt Note"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" /> Complete GRN
                          </Button>
                        )}
                        {(po.status === 'DRAFTED' || po.status === 'ISSUED') && (
                          <Button 
                            size="xs"
                            action="cancel"
                            onClick={(e) => { e.stopPropagation(); handleCancelPo(po.id); }}
                            disabled={!hasPermission(user, Action.CREATE_PO)}
                          />
                        )}
                        {(po.status === 'CANCELLED' || po.status === 'DRAFTED') && (
                          <Button 
                            size="xs"
                            action="delete"
                            onClick={(e) => { e.stopPropagation(); handleDeletePo(po.id); }}
                            disabled={!hasPermission(user, Action.CREATE_PO)}
                          />
                        )}
                        {(po.status === 'COMPLETED' || po.status === 'CANCELLED') && (
                          <Button 
                            size="xs"
                            variant="secondary"
                            onClick={(e) => { 
                              e.stopPropagation(); 
                              handleArchivePo(po.id);
                            }}
                            title="Archive Purchase Order"
                            className="flex items-center gap-1.5 border border-stone-200/80 bg-stone-50 hover:bg-stone-100 text-stone-700 font-bold"
                          >
                            <Archive className="w-3 h-3 text-stone-500" /> Archive
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>



      </div>

      {/* PO Document Modal */}
      <Modal
        isOpen={showPoDocModal && selectedPoDetails !== null}
        onClose={() => setShowPoDocModal(false)}
        title={selectedPoDetails ? `Purchase Order Document: ${selectedPoDetails.po_number}` : "Purchase Order Document"}
        maxWidth="5xl"
        contentClassName="p-0 flex flex-col h-[85vh] border-t border-stone-100"
      >

            
            <div className="flex-1 overflow-y-auto p-8 bg-stone-50 flex justify-center items-start">
                  <PrintTemplate
                    ref={poDocRef}
                    documentTitleId="Pesanan Pembelian"
                    documentTitleEn="PURCHASE ORDER"
                    documentNameId="pesanan pembelian"
                    documentNameEn="purchase order"
                    date={selectedPoDetails && selectedPoDetails.created_at ? new Date(selectedPoDetails.created_at).toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', year: 'numeric', month: 'short', day: 'numeric' }) : ''}
                    referenceNumber={selectedPoDetails?.po_number}
                    documentId={selectedPoDetails?.po_number}
                    isDraft={selectedPoDetails && selectedPoDetails.status === 'DRAFTED'}
                  >
                <div className="grid grid-cols-2 gap-12 mb-12 w-full z-10 relative">
                  <div>
                    <div className="text-[10px] text-stone-900 uppercase tracking-wider font-bold mb-2">Pemasok <span className="font-normal text-stone-400">/ Supplier</span></div>
                    <div className="text-sm font-bold">{selectedPoDetails?.supplier_name}</div>
                    <div className="text-xs text-stone-900 mt-1">Perkiraan Pengiriman <span className="text-stone-400 text-[10px]">/ Expected Delivery</span>: <span className="font-bold underline">{selectedPoDetails?.expected_date}</span></div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] text-stone-900 uppercase tracking-wider font-bold mb-2">Referensi <span className="font-normal text-stone-400">/ References</span></div>
                    <div className="text-xs font-medium">PR: {selectedPoDetails?.pr_numbers}</div>
                    <div className="text-xs text-stone-900 mt-1">Proyek <span className="text-stone-400 text-[10px]">/ Project</span>: <span className="font-bold">{selectedPoDetails?.project_ids || selectedPoDetails?.project_name || '-'}</span></div>
                    {selectedPoDetails?.auth_doc_name && (
                      <div className="text-[10px] text-stone-500 mt-1 italic">Auth: {selectedPoDetails.auth_doc_name}</div>
                    )}
                    {selectedPoDetails?.urgency && selectedPoDetails.urgency !== 'NORMAL' && (
                      <div className="text-[10px] font-bold text-rose-600 mt-1 uppercase tracking-widest">{selectedPoDetails.urgency}</div>
                    )}
                  </div>
                </div>

                <div className="flex-1 w-full relative z-10">
                  <table className="w-full text-sm text-left">
                    <thead>
                      <tr className="border-b border-stone-300 bg-white">
                        <th className="py-3 px-4 font-bold text-stone-900">
                          Kode Barang
                          <div className="text-[8px] font-semibold text-stone-500 tracking-widest mt-0.5">ITEM CODE</div>
                        </th>
                        <th className="py-3 px-4 font-bold text-stone-900">
                          Deskripsi
                          <div className="text-[8px] font-semibold text-stone-500 tracking-widest mt-0.5">DESCRIPTION</div>
                        </th>
                        <th className="py-3 px-4 font-bold text-stone-900 text-right">
                          Jumlah
                          <div className="text-[8px] font-semibold text-stone-500 tracking-widest mt-0.5">QTY</div>
                        </th>
                        <th className="py-3 px-4 font-bold text-stone-900 text-right">
                          Satuan
                          <div className="text-[8px] font-semibold text-stone-500 tracking-widest mt-0.5">UOM</div>
                        </th>
                        <th className="py-3 px-4 font-bold text-stone-900 text-right">
                          Harga Satuan
                          <div className="text-[8px] font-semibold text-stone-500 tracking-widest mt-0.5">UNIT PRICE</div>
                        </th>
                        <th className="py-3 px-4 font-bold text-stone-900 text-right">
                          Total
                          <div className="text-[8px] font-semibold text-stone-500 tracking-widest mt-0.5">TOTAL</div>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-200">
                      {selectedPoDetails && selectedPoDetails.items && selectedPoDetails.items.map((item: any, idx: number) => {
                        const unitPrice = item.unit_price > 0 ? item.unit_price : (item.db_unit_price || 0);
                        return (
                          <tr key={item.id || idx}>
                            <td className="py-4 px-4 font-medium text-stone-900">{item.item_code}</td>
                            <td className="py-4 px-4">
                              <div className="font-bold">{item.item_name}</div>
                              {(item.dimension || item.spec) && (
                                <div className="text-xs text-stone-500 mt-0.5">
                                  {[item.dimension, item.spec].filter(Boolean).join(' | ')}
                                </div>
                              )}
                            </td>
                            <td className="py-4 px-4 text-right font-bold text-stone-900">{item.qty}</td>
                            <td className="py-4 px-4 text-right text-stone-500">{item.uom}</td>
                            <td className="py-4 px-4 text-right text-stone-900 font-mono">{formatIDR(unitPrice || 0)}</td>
                            <td className="py-4 px-4 text-right font-bold text-stone-900 font-mono">{formatIDR(item.qty * unitPrice)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-stone-900 bg-white">
                        <td colSpan={5} className="py-4 px-4 text-right font-bold text-stone-900 uppercase tracking-wider">Grand Total <span className="font-normal text-[8px] text-stone-500">/ TOTAL</span></td>
                        <td className="py-4 px-4 text-right font-bold text-stone-900 text-lg font-mono">
                          {formatIDR((selectedPoDetails && selectedPoDetails.items && selectedPoDetails.items.reduce((sum: number, item: any) => sum + (Number(item.qty) * (Number(item.unit_price) || Number(item.db_unit_price) || 0)), 0)) || 0)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* Authorized Signatures for PO */}
                <div className="mt-auto grid grid-cols-2 gap-12 pt-8 border-t border-stone-200 w-full relative z-10 bg-white">
                  <div className="text-center font-sans flex flex-col items-center">
                    <div className="text-[9px] text-stone-900 uppercase tracking-widest font-bold mb-4">Dibuat Oleh <span className="text-stone-400 font-normal">/ Drafted By</span></div>
                    <div className="h-14 flex items-center justify-center w-full mb-1">
                      <div className="flex flex-col items-center justify-center gap-1.5 border border-emerald-200 bg-emerald-50 min-w-[50px] w-auto px-3 py-1.5 rounded-lg shadow-sm">
                        <QrCode className="w-8 h-8 text-emerald-600" />
                      </div>
                    </div>
                    <p className="text-[9px] font-black text-stone-900 uppercase mt-auto">Kantor Pengadaan <span className="text-stone-400 font-normal">/ Procurement Office</span></p>
                    <div className="pt-2 flex flex-col justify-center items-center w-full">
                      <div className="w-48 border-b border-stone-100 mb-1"></div>
                      <span className="text-[8.5px] text-emerald-600 font-bold tracking-widest uppercase flex items-center gap-1">TANGGAL / DATE: {new Date(selectedPoDetails?.created_at || Date.now()).toLocaleDateString('id-ID')}</span>
                    </div>
                  </div>
                  <div className="text-center font-sans flex flex-col items-center">
                    <div className="text-[9px] text-stone-900 uppercase tracking-widest font-bold mb-4">Otorisasi Internal <span className="text-stone-400 font-normal">/ Internal Authorization</span></div>
                    <div className="h-14 flex items-center justify-center w-full mb-1">
                       {selectedPoDetails?.auth_doc_name?.includes('Digitally') ? (
                          <div className="flex flex-col items-center justify-center gap-1.5 border border-emerald-200 bg-emerald-50 min-w-[50px] w-auto px-3 py-1.5 rounded-lg shadow-sm">
                            <QrCode className="w-8 h-8 text-emerald-600" />
                          </div>
                       ) : (
                          <div className="flex flex-col items-center gap-1 bg-white border border-dashed border-stone-300 w-32 px-2 py-3 rounded-lg">
                            
                            <div className="text-[7.5px] font-bold tracking-widest text-stone-400 uppercase">PENDING PIN</div>
                          </div>
                       )}
                    </div>
                    <p className="text-[10px] font-black text-stone-900 uppercase">{language === 'id' ? 'SMART e-APPROVAL' : 'SMART e-APPROVAL'}</p>
                    <div className="pt-2 flex flex-col justify-center items-center">
                      <div className="w-48 border-b border-stone-100 mb-1"></div>
                      {selectedPoDetails?.auth_doc_name?.includes('Digitally') ? (
                          <span className="text-[8.5px] text-emerald-600 font-bold tracking-widest uppercase flex items-center gap-1">VALIDATED SECURELY</span>
                      ) : (
                          <span className="text-[9px] text-stone-400 font-bold uppercase tracking-wider">AWAITING AUTHORIZATION</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-24 pt-8 border-t border-stone-105 text-[8.5px] text-center uppercase tracking-widest leading-relaxed font-bold hidden">
                  <span className="text-stone-700">Dokumen ini adalah Pesanan Pembelian yang dibuat oleh sistem. Semua barang tunduk pada inspeksi QC saat tiba di Gudang.</span>
                  <span className="text-stone-400 font-normal block mt-1">/ This document is a system-generated Purchase Order. All items are subject to QC inspection upon arrival at Warehouse.</span>
                </div>
              </PrintTemplate>
            </div>

            <div className="p-6 border-t border-stone-100 bg-white flex justify-center gap-4">
              <Button 
                variant="secondary"
                onClick={() => setShowPoDocModal(false)}
                className="px-6 py-2.5 rounded-xl text-sm"
              >
                {language === 'id' ? 'Tutup' : 'Close'}
              </Button>
              <Button 
                variant="primary"
                onClick={() => exportPoPdf()} 
                isLoading={isSubmitting}
                className="px-6 py-2.5 rounded-xl text-sm shadow-md"
              >
                {!isSubmitting && <Download className="w-4 h-4" />} 
                {language === 'id' ? (isSubmitting ? 'Mengekspor...' : 'Ekspor PDF (A4)') : (isSubmitting ? 'Generating...' : 'Export PDF (A4)')}
              </Button>
            </div>
      </Modal>

      {/* PR Details Modal */}
      <Modal
        isOpen={showPrDetailsModal && selectedPrDetails !== null}
        onClose={() => setShowPrDetailsModal(false)}
        maxWidth="2xl"
        contentClassName="p-0 flex flex-col h-[90vh]"
      >
        <div className="p-4 border-b border-stone-100 flex justify-between items-center bg-white shrink-0">
          <div>
            <h3 className="text-sm font-medium text-stone-900">Purchase Request Details</h3>
            <p className="text-[10px] text-stone-500 mt-0.5">{selectedPrDetails?.pr_number} • {selectedPrDetails?.project_name}</p>
          </div>
          <button onClick={() => setShowPrDetailsModal(false)} className="p-1.5 text-stone-400 hover:text-stone-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-3 gap-6 mb-8">
            <div>
              <div className="text-[10px] text-stone-400 uppercase tracking-wider font-bold mb-1">Expected Delivery</div>
              <div className="text-sm font-medium text-emerald-600">{selectedPrDetails?.expected_delivery_date || 'Not specified'}</div>
            </div>
            <div>
              <div className="text-[10px] text-stone-400 uppercase tracking-wider font-bold mb-1">Drawing Reference</div>
              <div className="text-sm font-medium text-stone-900">
                {selectedPrDetails?.drawing_reference ? (
                  <a href={selectedPrDetails.drawing_reference} target="_blank" rel="noopener noreferrer" className="text-stone-900 hover:text-stone-700 flex items-center gap-1">
                    <FileText className="w-3 h-3" /> View Drawing
                  </a>
                ) : 'None'}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-stone-400 uppercase tracking-wider font-bold mb-1">Status</div>
              <div className="text-sm font-medium text-stone-900">{selectedPrDetails?.status}</div>
            </div>
          </div>

          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b border-stone-200 bg-stone-50">
                <th className="py-2 px-3 font-medium text-stone-900">Item</th>
                <th className="py-2 px-3 font-medium text-stone-900">Expected</th>
                <th className="py-2 px-3 font-medium text-stone-900 text-right">Qty</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {selectedPrDetails && selectedPrDetails.items && selectedPrDetails.items.map((item: any) => (
                <tr key={item.id}>
                  <td className="py-3 px-3">
                    <div className="font-medium text-stone-900">{item.item_code}</div>
                    <div className="text-xs text-stone-500">{item.item_name}</div>
                    {(item.dimension || item.spec) && (
                      <div className="text-[10px] text-stone-400 mt-0.5">
                        {[item.dimension, item.spec].filter(Boolean).join(' | ')}
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-3">
                     <div className="text-xs text-stone-500">{item.expected_delivery_date || 'Auto'}</div>
                  </td>
                  <td className="py-3 px-3 text-right font-medium text-stone-900">
                    {item.qty} {item.uom}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        <div className="p-4 border-t border-stone-100 flex justify-end bg-white shrink-0">
          <Button onClick={() => setShowPrDetailsModal(false)}>Close</Button>
        </div>
      </Modal>

      {/* Authorize PO Modal */}
      <Modal
        isOpen={showAuthorizePoModal && selectedPoToAuth !== null}
        onClose={() => setShowAuthorizePoModal(false)}
        maxWidth="2xl"
        title={
          <div>
            <h3 className="text-lg font-bold text-stone-900">Authorize Purchase Order</h3>
            <p className="text-[10px] text-stone-400 font-bold uppercase tracking-widest mt-0.5">PO Production Release</p>
          </div>
        }
      >
        <form onSubmit={handleAuthorizePo} className="space-y-6 pt-2">
          {selectedPoToAuth && (
            <div className="p-5 bg-stone-50 rounded-2xl border border-stone-100 mb-2">
              <div className="text-[10px] text-stone-400 font-bold uppercase tracking-widest mb-1.5">Draft PO Reference</div>
              <div className="text-base font-bold text-stone-900">{selectedPoToAuth.po_number}</div>
              <div className="text-xs text-stone-500 mt-1 font-medium italic">Supplier: {selectedPoToAuth.supplier_name}</div>
            </div>
          )}

          <div className="space-y-4">
            <div className="p-4 bg-emerald-50/50 border border-emerald-100 rounded-2xl flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-white border border-emerald-100 flex items-center justify-center shrink-0 shadow-sm mt-0.5">
                <CheckCircle2 className="w-5 h-5 text-emerald-500" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-stone-900 mb-1">Embedded Smart e-Approval</h4>
                <p className="text-[10px] text-stone-500 leading-relaxed mb-3">
                  Please enter your 6-digit authorization PIN to digitally sign and release this Purchase Order. This action will embed a validation QR code to the document.
                </p>
                <input
                  type="password"
                  maxLength={6}
                  required
                  value={poAuthPin}
                  onChange={(e) => setPoAuthPin(e.target.value.toUpperCase())}
                  placeholder="Enter 6-digit PIN"
                  className="w-full text-sm placeholder:text-stone-400 font-mono tracking-[0.5em] px-4 py-2.5 rounded-xl border-stone-200 focus:border-emerald-500 focus:ring-emerald-500 transition-shadow bg-white"
                />
              </div>
            </div>
          </div>

          <div className="pt-2 flex justify-end gap-3 mt-6">
            <Button variant="secondary" type="button" onClick={() => setShowAuthorizePoModal(false)}>Cancel</Button>
            <Button 
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Processing...' : 'Authorize & Release'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Revise PO Modal */}
      <Modal
        isOpen={showRevisePoModal && selectedPoToAuth !== null}
        onClose={() => setShowRevisePoModal(false)}
        maxWidth="2xl"
        title={
          <div>
            <h3 className="text-lg font-bold text-stone-900">Revise Purchase Order</h3>
            <p className="text-[10px] text-stone-400 font-bold uppercase tracking-widest mt-0.5">Return to Staff for Changes</p>
          </div>
        }
      >
        <form onSubmit={handleRevisePo} className="space-y-6 pt-2">
          {selectedPoToAuth && (
            <div className="p-5 bg-stone-50 rounded-2xl border border-stone-100 mb-2">
              <div className="text-[10px] text-stone-400 font-bold uppercase tracking-widest mb-1.5">Draft PO Reference</div>
              <div className="text-base font-bold text-stone-900">{selectedPoToAuth.po_number}</div>
              <div className="text-xs text-stone-500 mt-1 font-medium italic">Supplier: {selectedPoToAuth.supplier_name}</div>
            </div>
          )}

          <div className="space-y-4">
            <div className="p-4 bg-rose-50/50 border border-rose-100 rounded-2xl flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-white border border-rose-100 flex items-center justify-center shrink-0 shadow-sm mt-0.5">
                <AlertTriangle className="w-5 h-5 text-rose-500" />
              </div>
              <div className="w-full">
                <h4 className="text-xs font-bold text-stone-900 mb-1">Revision Note</h4>
                <p className="text-[10px] text-stone-500 leading-relaxed mb-3">
                  Provide clear instructions exactly like a spreadsheet cell note to notify the staff what to fix on this PO.
                </p>
                <textarea
                  required
                  value={poRevisionNote}
                  onChange={(e) => setPoRevisionNote(e.target.value)}
                  placeholder="E.g., Expected date is wrong, or change supplier..."
                  className="w-full h-24 text-sm bg-white border border-stone-200 resize-none px-4 py-2.5 rounded-xl text-stone-900 focus:border-rose-500 focus:ring-rose-500/20 transition-all outline-none"
                />
              </div>
            </div>
          </div>

          <div className="pt-2 flex justify-end gap-3 mt-6">
            <Button variant="secondary" type="button" onClick={() => setShowRevisePoModal(false)}>Cancel</Button>
            <Button 
              type="submit"
              disabled={isSubmitting || !poRevisionNote.trim()}
              className="bg-rose-600 hover:bg-rose-700 text-white"
            >
              {isSubmitting ? 'Processing...' : 'Submit Revision'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Create PO Modal */}
      <Modal
        isOpen={showPoModal}
        onClose={() => {
          setShowPoModal(false);
          setRevisingPo(null);
        }}
        maxWidth="2xl"
        title={
          <div>
            <h3 className="text-lg font-bold text-stone-900">{revisingPo ? `Revise Purchase Order: ${revisingPo.po_number}` : 'Generate Purchase Order'}</h3>
            <p className="text-[10px] text-stone-400 font-bold uppercase tracking-widest mt-0.5">Supplier Procurement Batch</p>
          </div>
        }
      >
        {revisingPo && revisingPo.revision_note && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 flex items-start gap-3 shadow-sm mb-6 w-full -mt-2">
            <AlertTriangle className="w-5 h-5 text-rose-600 mt-0.5 shrink-0" />
            <div>
              <div className="text-xs font-bold text-rose-800 uppercase tracking-widest mb-1.5">Revision Requested</div>
              <div className="text-sm font-medium text-rose-700 leading-relaxed max-w-3xl">"{revisingPo.revision_note}"</div>
            </div>
          </div>
        )}
        <div className="px-6 py-5 bg-stone-50 border-b border-stone-100 -mx-6 -mt-2 mb-4">
          <div className="flex justify-between items-start mb-1.5">
            <div>
              <div className="text-[10px] text-stone-400 font-bold uppercase tracking-widest mb-1.5">Bundling Summary</div>
              <div className="text-sm font-bold text-stone-900 leading-tight">
                Batch creation for <span className="text-stone-900 uppercase tracking-widest">{revisingPo ? revisingPo.items?.length : selectedPrItems.size} items</span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-stone-400 font-bold uppercase tracking-widest mb-1.5 text-right">Est. Aggregate Value</div>
              <div className="text-sm font-bold text-emerald-600 font-mono">
                {formatIDR(revisingPo ? 
                  (revisingPo.items || []).reduce((sum: number, i: any) => sum + (i.qty * (i.unit_price || 0)), 0) :
                  pendingPrs
                    .filter(p => selectedPrItems.has(p.pr_item_id))
                    .reduce((sum, p) => sum + (p.qty * (p.unit_price || 0)), 0)
                )}
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {revisingPo ? (
              (revisingPo.pr_numbers || '').split(', ').map((prNum: string) => (
                <span key={prNum} className="text-[9px] bg-stone-200/60 px-2 py-0.5 rounded text-stone-700 font-bold tracking-tight">
                  {prNum}
                </span>
              ))
            ) : (
              Array.from(new Set(pendingPrs.filter(p => selectedPrItems.has(p.pr_item_id)).map(p => p.pr_number))).map(prNum => (
                <span key={prNum} className="text-[9px] bg-stone-200/60 px-2 py-0.5 rounded text-stone-700 font-bold tracking-tight">
                  {prNum}
                </span>
              ))
            )}
          </div>
        </div>

        <form onSubmit={handleCreatePo} className="space-y-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-mono font-bold text-stone-450 uppercase tracking-widest">Optimization Matrix</span>
              <span className="h-1.5 w-1.5 rounded-full bg-stone-450"></span>
            </div>
            <label className="block text-xs font-medium text-stone-900 uppercase tracking-wider mb-2">
              Vendor Proposals (Ranked by Matrix Score)
            </label>
            
            {isFetchingSuppliers ? (
              <div className="py-8 text-center bg-stone-50 border border-stone-200 rounded-xl">
                <span className="inline-block animate-spin rounded-full h-4 w-4 border-2 border-dashed border-stone-400 mr-2 align-middle"></span>
                <span className="text-[10px] text-stone-500 align-middle font-mono">Processing matrix algorithm scores...</span>
              </div>
            ) : sortedSuppliers.length === 0 ? (
              <div className="p-6 text-center bg-stone-50 border border-stone-200 rounded-xl">
                <AlertCircle className="w-5 h-5 text-stone-400 mx-auto mb-2" />
                <div className="text-[10px] font-bold text-stone-500 uppercase tracking-widest font-mono">No Active Suppliers Configured</div>
                <p className="text-[9px] text-stone-400 mt-1 font-sans">To configure recommendations, add supplier unit costs to catalog items under Master Data.</p>
              </div>
            ) : (
              <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-2 scrollbar-thin">
                {sortedSuppliers.map((rec, index) => {
                  const isSelected = poForm.supplier_id === rec.id;
                  const { total } = getSupplierTotalAndPrices(rec, selectedItemsDetails);
                  return (
                    <div
                      key={rec.id}
                      onClick={() => setPoForm({...poForm, supplier_id: rec.id, supplier_name: rec.name})}
                      className={cn(
                        "p-3 rounded-xl border cursor-pointer transition-all flex flex-col md:flex-row md:items-center justify-between gap-3 text-left relative overflow-hidden",
                        isSelected 
                          ? "bg-white text-stone-900 border-stone-800 shadow-sm ring-1 ring-stone-800" 
                          : "bg-white hover:bg-stone-50 border-stone-200 text-stone-600"
                      )}
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-bold text-stone-900">{rec.name}</span>
                          <span className="text-[9px] font-mono text-stone-400">({rec.code || 'CODE'})</span>
                          {index === 0 && (
                            <span className="px-1.5 py-0.5 rounded text-[7px] font-bold tracking-widest bg-emerald-100 text-emerald-700 uppercase border border-emerald-200 font-mono">
                              Rank 1: Optimal Cost
                            </span>
                          )}
                          {(rec as any).compositeScore >= 80 && index > 0 && (
                            <span className="px-1.5 py-0.5 rounded text-[7px] font-bold tracking-widest bg-stone-100 text-stone-600 uppercase border border-stone-200 font-mono">
                              Highly Compatible
                            </span>
                          )}
                        </div>

                        <div className="grid grid-cols-3 gap-3 mt-2.5 pt-2.5 border-t border-stone-100 text-[9px] leading-none text-stone-500 font-mono">
                          <div>
                            <span className="block text-[7px] uppercase tracking-widest text-stone-400 font-sans mb-1 font-bold">Catalog Compliance</span>
                            <span className="font-bold text-stone-700">{Math.round((rec as any).matchPercent)}% Catalog Match</span>{" "}
                            <span className="text-[8px] text-stone-400">({(rec as any).fulfilledCount}/{(rec as any).totalItemsInBatch})</span>
                          </div>
                          <div>
                            <span className="block text-[7px] uppercase tracking-widest text-stone-400 font-sans mb-1 font-bold">Logistics & Lead-Time</span>
                            <span className="font-bold text-stone-700">{(rec as any).proximityKm} km dist</span>{" "}
                            <span className="text-[8px] text-stone-400">(~{(rec as any).leadTimeDays}d ETA)</span>
                          </div>
                          <div>
                            <span className="block text-[7px] uppercase tracking-widest text-stone-400 font-sans mb-1 font-bold">QA On-Time Rate</span>
                            <span className="font-bold text-stone-700">{(rec as any).onTimeScore}% Performance</span>
                          </div>
                        </div>
                      </div>

                      <div className="md:text-right flex md:flex-col justify-between items-center md:items-end shrink-0 md:pl-3 border-t md:border-t-0 md:border-l border-stone-100 p-1 md:p-0 font-mono">
                        <div>
                          <span className="block text-[7px] uppercase tracking-widest text-stone-400 font-bold mb-1 font-sans text-left md:text-right">Index Coefficient</span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold font-mono text-stone-800">
                              {(rec as any).compositeScore}
                            </span>
                            <div className="w-10 h-1 bg-stone-100 rounded-full overflow-hidden shrink-0 border border-stone-200">
                              <div 
                                className="h-full rounded-full transition-all bg-stone-700"
                                style={{ width: `${(rec as any).compositeScore}%` }}
                              />
                            </div>
                          </div>
                        </div>

                        <div className="mt-2.5 leading-none text-left md:text-right">
                          <span className="block text-[7px] uppercase tracking-widest text-stone-400 font-bold mb-1 font-sans text-left md:text-right">Est. Aggregate Cost</span>
                          <div className="text-xs font-bold text-stone-900 font-mono">
                            {formatIDR(total)}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {poForm.supplier_id && (
              <div className="mt-3 bg-stone-50 border border-stone-200/60 rounded-xl p-4 transition-all">
                <div className="text-[10px] text-stone-500 font-extrabold uppercase tracking-widest mb-2.5">
                  Selected Supplier Itemized Prices
                </div>
                <div className="space-y-2">
                  {revisingPo ? (
                    (revisingPo.items || []).map((p: any) => {
                      const sup = validSuppliers.find(s => s.id === poForm.supplier_id);
                      const breakdown = sup ? getSupplierTotalAndPrices(sup, revisingPo.items || []).breakdown : {};
                      const unitPrice = breakdown[p.item_id] ?? p.unit_price ?? 0;
                      return (
                        <div key={p.id} className="flex justify-between items-center text-xs">
                          <span className="text-stone-600 font-medium">
                            {p.item_name} <span className="font-mono text-stone-400 text-[10px]">({p.qty} {p.uom || 'qty'})</span>
                          </span>
                          <div className="text-right">
                            <span className="font-mono font-bold text-stone-900">
                              {formatIDR(unitPrice)} / {p.uom || 'unit'}
                            </span>
                            <span className="block text-[10px] text-stone-400 font-medium font-mono">
                              Subtotal: {formatIDR(p.qty * unitPrice)}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    pendingPrs
                      .filter(p => selectedPrItems.has(p.pr_item_id))
                      .map(p => {
                        const sup = validSuppliers.find(s => s.id === poForm.supplier_id);
                        const breakdown = sup ? getSupplierTotalAndPrices(sup, selectedItemsDetails).breakdown : {};
                        const unitPrice = breakdown[p.item_id] ?? p.unit_price ?? 0;
                        return (
                          <div key={p.pr_item_id} className="flex justify-between items-center text-xs">
                            <span className="text-stone-600 font-medium">
                              {p.item_name} <span className="font-mono text-stone-400 text-[10px]">({p.qty} {p.uom || 'qty'})</span>
                            </span>
                            <div className="text-right">
                              <span className="font-mono font-bold text-stone-900">
                                {formatIDR(unitPrice)} / {p.uom || 'unit'}
                              </span>
                              <span className="block text-[10px] text-stone-400 font-medium font-mono">
                                Subtotal: {formatIDR(p.qty * unitPrice)}
                              </span>
                            </div>
                          </div>
                        );
                      })
                  )}
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-stone-500 uppercase tracking-wider mb-1.5">Urgency Level</label>
            <select 
              value={poForm.urgency}
              onChange={e => setPoForm({ ...poForm, urgency: e.target.value as any })}
              className="w-full border border-stone-200 rounded-lg px-4 py-2.5 text-sm focus:border-stone-400 outline-none"
            >
              <option value="NORMAL">Normal</option>
              <option value="URGENT">Urgent</option>
              <option value="CRITICAL">Critical</option>
            </select>
            <p className="mt-2 text-[10px] text-emerald-600 font-bold uppercase tracking-wider">
              Note: Expected delivery date will be inherited from the selected PR items.
            </p>
          </div>

          <div className="pt-4 flex justify-end gap-3 mt-4">
            <Button variant="secondary" type="button" onClick={() => setShowPoModal(false)}>Cancel</Button>
            <Button 
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Processing...' : 'Issue PO'}
            </Button>
          </div>
        </form>
      </Modal>
      
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        onConfirm={confirmModal.action}
        onCancel={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
      />



      {/* GRN Modal (Engineering Confirmation) */}
      <Modal
        isOpen={showGrnModal && selectedPoDetails !== null}
        onClose={() => setShowGrnModal(false)}
        maxWidth="4xl"
        contentClassName="p-0 flex flex-col h-[90vh]"
      >
        <div className="p-4 border-b border-stone-100 flex justify-between items-center bg-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-stone-100 rounded-lg flex items-center justify-center">
              <ClipboardCheck className="w-4 h-4 text-stone-900" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-stone-900 tracking-tight">Material Receiving Confirmation (GRN)</h3>
              <p className="text-xs text-stone-500 font-medium tracking-widest uppercase mt-1">{selectedPoDetails?.po_number || 'N/A'}</p>
            </div>
          </div>
          <button onClick={() => setShowGrnModal(false)} className="p-1.5 text-stone-400 hover:text-stone-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-8 bg-stone-50/30">
          <form id="grn-form" onSubmit={handleCompleteGrn} className="space-y-6">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-[0.2em] mb-2 px-1">Received Date</label>
                <input 
                  required
                  type="date" 
                  value={grnForm.received_date}
                  onChange={e => setGrnForm({...grnForm, received_date: e.target.value})}
                  className="w-full px-6 py-4 bg-white border border-stone-200/50 hover:border-stone-300 rounded-2xl text-sm font-bold focus:bg-white focus:border-stone-300 focus:ring-4 focus:ring-stone-100 outline-none transition-all shadow-sm"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-[0.2em] mb-2 px-1">Engineering Decision</label>
                <Select 
                  value={grnForm.qc_status}
                  onChange={e => setGrnForm({...grnForm, qc_status: e.target.value})}
                  className="w-full px-6 py-4 bg-white border border-stone-200/50 hover:border-stone-300 rounded-2xl text-sm font-bold focus:bg-white focus:border-stone-300 focus:ring-4 focus:ring-stone-100 outline-none transition-all appearance-none shadow-sm cursor-pointer"
                >
                  <option value="PASSED">Passed</option>
                  <option value="REJECTED">Rejected</option>
                  <option value="CONDITIONAL">Conditional</option>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-[0.2em] mb-2 px-1">Engineering Request User (Name)</label>
                <input 
                  required
                  type="text" 
                  placeholder="Engineer ID or Name"
                  value={grnForm.engineering_user}
                  onChange={e => setGrnForm({...grnForm, engineering_user: e.target.value})}
                  className="w-full px-6 py-4 bg-white border border-stone-200/50 hover:border-stone-300 rounded-2xl text-sm font-bold focus:bg-white focus:border-stone-300 focus:ring-4 focus:ring-stone-100 outline-none transition-all shadow-sm"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-[0.2em] mb-2 px-1">QC Inspector Rep (Optional)</label>
                <input 
                  type="text" 
                  placeholder="QC Identifier (optional)"
                  value={grnForm.qc_user}
                  onChange={e => setGrnForm({...grnForm, qc_user: e.target.value})}
                  className="w-full px-6 py-4 bg-white border border-stone-200/50 hover:border-stone-300 rounded-2xl text-sm font-bold focus:bg-white focus:border-stone-300 focus:ring-4 focus:ring-stone-100 outline-none transition-all shadow-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-[0.2em] mb-2 px-1">Item Confirmations (Engineering Verification)</label>
              <div className="border border-stone-200/50 rounded-2xl overflow-hidden shadow-sm">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-stone-50 border-b border-stone-100">
                    <tr className="text-[9px] font-bold text-stone-400 uppercase tracking-[0.2em]">
                      <th className="px-5 py-4">Item Target</th>
                      <th className="px-5 py-4 text-center">Pending Volume</th>
                      <th className="px-5 py-4 text-right w-40">Count Received</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100 bg-white">
                    {grnItems.map((item, idx) => (
                      <tr key={idx} className="hover:bg-stone-50/50 transition-colors">
                        <td className="px-5 py-4">
                          <div className="text-sm font-bold text-stone-900 tracking-tight">{item.item_code}</div>
                          <div className="text-[10px] uppercase tracking-widest text-stone-400 truncate max-w-[200px] mt-1">{item.item_name}</div>
                        </td>
                        <td className="px-5 py-4 text-center text-xs font-medium text-stone-600">
                          <span className="text-sm font-semibold text-stone-900">{item.qty - (item.received_qty || 0)}</span>
                          <span className="text-[9px] font-bold uppercase tracking-widest text-stone-400 ml-1">{item.uom}</span>
                        </td>
                        <td className="px-5 py-4">
                          <div className="relative">
                          <input 
                            type="number"
                            min="0"
                            max={item.qty - (item.received_qty || 0)}
                            value={item.qty_received}
                            onChange={e => {
                              const newItems = [...grnItems];
                              newItems[idx].qty_received = Number(e.target.value);
                              setGrnItems(newItems);
                            }}
                            className="w-full bg-stone-50 border border-stone-200/50 hover:bg-white hover:border-stone-300 rounded-xl px-3 py-2.5 pr-8 text-right text-base font-bold text-stone-900 focus:bg-white focus:border-stone-400 focus:ring-4 focus:ring-stone-100 outline-none transition-all shadow-sm"
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-bold text-stone-400 uppercase tracking-widest leading-none pointer-events-none mt-px">{item.uom}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>                
            
            <div>
              <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-[0.2em] mb-2 px-1">Smart e-Approval PIN</label>
              <div className="p-4 bg-emerald-50/50 border border-emerald-100 rounded-2xl flex items-start gap-4 mb-6">
                <div className="w-10 h-10 rounded-xl bg-white border border-emerald-100 flex items-center justify-center shrink-0 shadow-sm mt-0.5">
                  <ShieldCheck className="w-5 h-5 text-emerald-600" />
                </div>
                <div className="w-full">
                  <h4 className="text-xs font-bold text-stone-900 mb-1">Embedded Smart e-Approval</h4>
                  <p className="text-[10px] text-stone-500 leading-relaxed mb-3">
                    Please enter your 6-digit authorization PIN to digitally sign and release this Goods Receiving Note (GRN).
                  </p>
                  <input
                    type="password"
                    maxLength={6}
                    required
                    value={grnAuthPin}
                    onChange={(e) => setGrnAuthPin(e.target.value.toUpperCase())}
                    placeholder="Enter 6-digit PIN"
                    className="w-full text-sm placeholder:text-stone-400 font-mono tracking-[0.5em] px-4 py-2.5 rounded-xl border-stone-200 focus:border-emerald-500 focus:ring-emerald-500 transition-shadow bg-white"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-[0.2em] mb-2 px-1">Notes / Syarat / Physical Observations</label>
              <textarea 
                placeholder="Physical condition, missing parts, why conditionally accepted..."
                value={grnForm.remarks}
                onChange={e => setGrnForm({...grnForm, remarks: e.target.value})}
                className="w-full px-6 py-4 bg-white border border-stone-200/50 hover:border-stone-300 rounded-2xl text-sm font-medium focus:bg-white focus:border-stone-300 focus:ring-4 focus:ring-stone-100 outline-none transition-all shadow-sm h-32 resize-none"
              />
            </div>
          </form>
        </div>

        <div className="p-8 border-t border-stone-100 bg-white flex justify-between items-center shrink-0">
          <Button 
            variant="secondary"
            type="button"
            onClick={() => {
              const updated = grnItems.map(item => ({...item, qty_received: item.qty - (item.received_qty || 0)}));
              setGrnItems(updated);
            }}
          >
            Auto-Fill All Pending 
          </Button>
          <div className="flex gap-4">
            <Button variant="secondary" onClick={() => setShowGrnModal(false)}>Cancel</Button>
            <Button 
              form="grn-form"
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Processing...' : 'Confirm Receipt'}
            </Button>
          </div>
        </div>
      </Modal>
      {/* Re-issue Rejected GRN Modal */}
      <Modal
        isOpen={showReissueGrnModal && selectedPoDetails !== null}
        onClose={() => setShowReissueGrnModal(false)}
        maxWidth="4xl"
        contentClassName="p-0 flex flex-col h-[90vh]"
      >
        <div className="p-4 border-b border-stone-100 flex justify-between items-center bg-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center">
              <AlertCircle className="w-4 h-4 text-red-700" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-stone-900 tracking-tight">Re-issue Rejected Delivery (GRN)</h3>
              <p className="text-xs text-stone-500 font-medium tracking-widest uppercase mt-1">{selectedPoDetails?.po_number || 'N/A'} &bull; Status: REJECTED</p>
            </div>
          </div>
          <button onClick={() => setShowReissueGrnModal(false)} className="p-1.5 text-stone-400 hover:text-stone-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-8 bg-stone-50/30">
          <form id="reissue-grn-form" onSubmit={handleReissueGrn} className="space-y-6">
            <div className="p-4 bg-red-50 border border-red-100 rounded-xl mb-2">
              <p className="text-xs text-red-700 font-medium">
                This PO was previously rejected. Use this form to process the corrected/re-delivered items from the supplier.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-[0.2em] mb-2 px-1">Received Date</label>
                <input 
                  required
                  type="date" 
                  value={reissueGrnForm.received_date}
                  onChange={e => setReissueGrnForm({...reissueGrnForm, received_date: e.target.value})}
                  className="w-full px-6 py-4 bg-white border border-stone-200/50 hover:border-stone-300 rounded-2xl text-sm font-bold focus:bg-white focus:border-stone-300 focus:ring-4 focus:ring-stone-100 outline-none transition-all shadow-sm"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-[0.2em] mb-2 px-1">Engineering Decision</label>
                <select 
                  value={reissueGrnForm.qc_status}
                  onChange={e => setReissueGrnForm({...reissueGrnForm, qc_status: e.target.value})}
                  className="w-full px-6 py-4 bg-white border border-stone-200/50 hover:border-stone-300 rounded-2xl text-sm font-bold focus:bg-white focus:border-stone-300 focus:ring-4 focus:ring-stone-100 outline-none transition-all appearance-none shadow-sm cursor-pointer"
                >
                  <option value="PASSED">Passed</option>
                  <option value="REJECTED">Rejected</option>
                  <option value="CONDITIONAL">Conditional</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-[0.2em] mb-2 px-1">Engineering Request User (Name)</label>
                <input 
                  required
                  type="text" 
                  placeholder="Engineer ID or Name"
                  value={reissueGrnForm.engineering_user}
                  onChange={e => setReissueGrnForm({...reissueGrnForm, engineering_user: e.target.value})}
                  className="w-full px-6 py-4 bg-white border border-stone-200/50 hover:border-stone-300 rounded-2xl text-sm font-bold focus:bg-white focus:border-stone-300 focus:ring-4 focus:ring-stone-100 outline-none transition-all shadow-sm"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-[0.2em] mb-2 px-1">QC Inspector Rep (Optional)</label>
                <input 
                  type="text" 
                  placeholder="QC Identifier (optional)"
                  value={reissueGrnForm.qc_user}
                  onChange={e => setReissueGrnForm({...reissueGrnForm, qc_user: e.target.value})}
                  className="w-full px-6 py-4 bg-white border border-stone-200/50 hover:border-stone-300 rounded-2xl text-sm font-bold focus:bg-white focus:border-stone-300 focus:ring-4 focus:ring-stone-100 outline-none transition-all shadow-sm"
                />
              </div>
            </div>

            {/* Rejected GRN Document Upload */}
            <div>
              <label className="block text-[10px] font-bold text-red-400 uppercase tracking-[0.2em] mb-2 px-1">
                Previous Rejected GRN Document *
              </label>
              <div className="relative group">
                <input 
                  required
                  type="file" 
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) setReissueGrnForm({...reissueGrnForm, rejected_grn_doc: file.name});
                  }}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                />
                <div className="w-full border-2 border-dashed border-red-200 rounded-2xl px-4 py-6 flex flex-col items-center justify-center bg-red-50/30 group-hover:border-red-300 transition-all">
                  <div className="w-10 h-10 bg-white rounded-2xl shadow-sm border border-red-100 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                    <Download className="w-5 h-5 text-red-400" />
                  </div>
                  <span className={cn(
                    "text-[10px] font-bold tracking-widest uppercase",
                    reissueGrnForm.rejected_grn_doc ? "text-stone-900" : "text-stone-400"
                  )}>
                    {reissueGrnForm.rejected_grn_doc || "Upload previously rejected GRN document..."}
                  </span>
                </div>
              </div>
              <p className="text-[9px] text-red-500 font-medium tracking-wide mt-2">
                * Required: Attach the document of the GRN that was previously rejected for this PO.
              </p>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-[0.2em] mb-2 px-1">Item Confirmations (Engineering Verification)</label>
              <div className="border border-stone-200/50 rounded-2xl overflow-hidden shadow-sm">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-stone-50 border-b border-stone-100">
                    <tr className="text-[9px] font-bold text-stone-400 uppercase tracking-[0.2em]">
                      <th className="px-5 py-4">Item Target</th>
                      <th className="px-5 py-4 text-center">Ordered Volume</th>
                      <th className="px-5 py-4 text-right w-40">Count Received</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100 bg-white">
                    {reissueGrnItems.map((item, idx) => (
                      <tr key={idx} className="hover:bg-stone-50/50 transition-colors">
                        <td className="px-5 py-4">
                          <div className="text-sm font-bold text-stone-900 tracking-tight">{item.item_code}</div>
                          <div className="text-[10px] uppercase tracking-widest text-stone-400 truncate max-w-[200px] mt-1">{item.item_name}</div>
                        </td>
                        <td className="px-5 py-4 text-center text-xs font-medium text-stone-600">
                          <span className="text-sm font-bold text-stone-900">{item.qty}</span>
                          <span className="text-[9px] font-bold uppercase tracking-widest text-stone-400 ml-1">{item.uom}</span>
                        </td>
                        <td className="px-5 py-4">
                          <div className="relative">
                          <input 
                            type="number"
                            min="0"
                            value={item.qty_received}
                            onChange={e => {
                              const newItems = [...reissueGrnItems];
                              newItems[idx].qty_received = Number(e.target.value);
                              setReissueGrnItems(newItems);
                            }}
                            className="w-full bg-stone-50 border border-stone-200/50 hover:bg-white hover:border-stone-300 rounded-xl px-3 py-2.5 pr-8 text-right text-base font-bold text-stone-900 focus:bg-white focus:border-stone-400 focus:ring-4 focus:ring-stone-100 outline-none transition-all shadow-sm"
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-bold text-stone-400 uppercase tracking-widest leading-none pointer-events-none mt-px">{item.uom}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>                
            
            <div>
              <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-[0.2em] mb-2 px-1">Notes / Syarat / Physical Observations</label>
              <textarea 
                placeholder="Physical condition, missing parts, corrective actions taken by supplier..."
                value={reissueGrnForm.remarks}
                onChange={e => setReissueGrnForm({...reissueGrnForm, remarks: e.target.value})}
                className="w-full px-6 py-4 bg-white border border-stone-200/50 hover:border-stone-300 rounded-2xl text-sm font-medium focus:bg-white focus:border-stone-300 focus:ring-4 focus:ring-stone-100 outline-none transition-all shadow-sm h-32 resize-none"
              />
            </div>
          </form>
        </div>

        <div className="p-8 border-t border-stone-100 bg-white flex justify-between items-center shrink-0 shadow-[0_-10px_40px_rgba(0,0,0,0.03)]">
          <Button 
            variant="secondary"
            type="button"
            onClick={() => {
              const updated = reissueGrnItems.map(item => ({...item, qty_received: item.qty}));
              setReissueGrnItems(updated);
            }}
          >
            Auto-Fill All Ordered 
          </Button>
          <div className="flex gap-4">
            <Button variant="secondary" onClick={() => setShowReissueGrnModal(false)}>Cancel</Button>
            <Button 
              form="reissue-grn-form"
              type="submit"
              disabled={isSubmitting || !reissueGrnForm.rejected_grn_doc}
              className="bg-red-700 hover:bg-red-800 text-white"
            >
              {isSubmitting ? 'Processing...' : 'Confirm Re-issue Receipt'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* GRN Report Modal */}
      <Modal
        isOpen={showGrnReportModal && completedGrnData !== null}
        onClose={() => setShowGrnReportModal(false)}
        title={completedGrnData?.is_reissue ? 'GRN Re-issue Report' : 'Goods Receive Note (GRN) Report'}
        maxWidth="5xl"
        contentClassName="p-0 flex flex-col h-[85vh] border-t border-stone-100"
      >

        
        <div className="flex-1 overflow-y-auto p-8 bg-stone-50 flex justify-center items-start">
          <PrintTemplate
            ref={grnReportRef}
            documentTitleId="NOTA PENERIMAAN BARANG"
            documentTitleEn="GOODS RECEIVING NOTE"
            documentNameId="nota penerimaan barang"
            documentNameEn="goods receiving note"
            date={new Date(completedGrnData?.created_at || Date.now()).toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', year: 'numeric', month: 'short', day: 'numeric' })}
            referenceNumber={completedGrnData?.grn_id}
            documentId={completedGrnData?.grn_id}
            hideDefaultFooter={true}
          >
              
              {/* PO & Supplier Core Info */}
              <div className="grid grid-cols-2 gap-6 bg-white rounded-2xl p-5 border border-stone-100 mb-6 font-sans">
                <div className="flex flex-col gap-1.5">
                  <div className="text-[10px] text-stone-900 uppercase tracking-widest font-bold">Pesanan Pembelian <span className="font-normal text-stone-400">/ Purchase Order</span></div>
                  <div className="text-base font-bold text-stone-900">{completedGrnData?.po_number}</div>
                  <div className="text-[11px] text-stone-500 font-bold">PR Ref: {completedGrnData?.pr_numbers || '-'}</div>
                  <div className="text-[10px] text-stone-900 font-bold uppercase tracking-widest">Proyek / Project: <span className="font-normal text-stone-500">{completedGrnData?.project_ids || completedGrnData?.project_name || '-'}</span></div>
                </div>
                <div className="flex flex-col gap-1.5 text-right items-end">
                  <div className="text-[10px] text-stone-900 uppercase tracking-widest font-bold">Pemasok <span className="font-normal text-stone-400">/ Supplier Partner</span></div>
                  <div className="text-base font-bold text-stone-800 line-clamp-1">{completedGrnData?.supplier_name}</div>
                  <div className="text-[10px] font-bold text-emerald-700 bg-white px-2.5 py-1 rounded-md mt-0.5 border border-emerald-150">SUMBER TERVERIFIKASI / VERIFIED SOURCING</div>
                </div>
              </div>

              {/* Transaction Specifics Grid */}
              <div className="grid grid-cols-2 gap-x-8 gap-y-4 mb-6 font-sans w-full relative z-10">
                <div className="flex flex-col gap-1">
                  <span className="text-[9px] text-stone-900 uppercase tracking-widest font-bold">Tanggal Diterima <span className="font-normal text-stone-400">/ Received Date</span></span>
                  <span className="text-sm font-bold text-stone-900">{completedGrnData?.received_date}</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[9px] text-stone-900 uppercase tracking-widest font-bold">Laporan Status QC <span className="font-normal text-stone-400">/ QC Status Report</span></span>
                  <div>
                    <span className={cn(
                      "inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-bold tracking-widest uppercase border",
                      completedGrnData?.qc_status === 'PASSED' ? "bg-white text-emerald-700 border-emerald-200" :
                      completedGrnData?.qc_status === 'REJECTED' ? "bg-white text-red-700 border-red-200" :
                      "bg-white text-amber-700 border-amber-200"
                    )}>
                      <span className={cn(
                        "w-1.5 h-1.5 rounded-full",
                        completedGrnData?.qc_status === 'PASSED' ? "bg-emerald-500" :
                        completedGrnData?.qc_status === 'REJECTED' ? "bg-red-500" :
                        "bg-amber-500"
                      )} />
                      {completedGrnData?.qc_status}
                    </span>
                  </div>
                </div>
              </div>

              {completedGrnData?.rejected_grn_doc && (
                <div className="p-3 bg-rose-50/50 border border-rose-100 rounded-xl mb-6 w-full relative z-10">
                  <div className="text-[9px] text-rose-500 uppercase tracking-widest font-bold mb-1">Referensi Dokumen Ditolak Sebelumnya <span className="font-normal text-rose-400">/ Previous Rejected Document Ref</span></div>
                  <div className="text-[11px] font-mono font-bold text-rose-700 truncate">{completedGrnData.rejected_grn_doc}</div>
                </div>
              )}

              {/* Divider */}
              <div className="border-t border-dashed border-stone-200 mb-6 w-full" />

              {/* Items Section */}
              <div className="flex-1 min-h-0 flex flex-col justify-start gap-4 mb-6 w-full relative z-10">
                <div>
                  <div className="text-[10px] text-stone-900 uppercase tracking-[0.2em] font-bold mb-2.5">Komponen Yang Diserahkan <span className="font-normal text-stone-400">/ CONSIGNED COMPONENTS</span></div>
                  <div className="divide-y divide-stone-100 border border-stone-100 rounded-2xl overflow-hidden bg-white">
                    {completedGrnData && completedGrnData.items && completedGrnData.items.map((item: any, idx: number) => (
                      <div key={item.id || idx} className="p-4 flex justify-between items-center gap-4 hover:bg-stone-50/40 transition-colors">
                        <div className="min-w-0 flex-1">
                          <div className="text-[10px] font-mono font-bold bg-white text-stone-600 px-1.5 py-0.5 rounded inline-block mb-1">
                            {item.item_code}
                          </div>
                          <div className="text-xs font-bold text-stone-900 truncate">{item.item_name}</div>
                          {(item.dimension || item.spec) && (
                            <div className="text-[10px] text-stone-500 mt-0.5 font-medium truncate">
                              {[item.dimension, item.spec].filter(Boolean).join(' | ')}
                            </div>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-sm font-bold text-stone-950 tabular-nums">
                            {item.qty_received}
                          </div>
                          <div className="text-[10px] uppercase font-bold text-stone-400 mt-0.5">
                            {item.uom}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Remarks */}
                {completedGrnData?.remarks && (
                  <div className="p-4 bg-white border border-stone-100 rounded-xl">
                    <div className="text-[9px] text-stone-400 uppercase tracking-widest font-bold mb-1">Consignment Notes</div>
                    <div className="text-xs text-stone-600 font-medium italic line-clamp-3 leading-relaxed">
                      "{completedGrnData.remarks}"
                    </div>
                  </div>
                )}
              </div>

              {/* Centered System Clearance for GRN without sign & stamp */}
              <div className="mt-auto pt-4 border-t border-stone-150 flex justify-center items-center px-4 w-full relative z-10">
                <div className="text-center max-w-lg font-sans">
                  <ShieldCheck className="w-5 h-5 text-emerald-600/50 mx-auto mb-2" />
                  <div className="text-[7.5px] text-stone-500 font-bold uppercase tracking-widest leading-relaxed mb-0.5">
                     Dokumen GRN ini diterbitkan secara resmi dari sistem. Sah menurut registri perusahaan tanpa tanda tangan & stempel manual.
                  </div>
                  <div className="text-[7.5px] text-stone-400 font-bold uppercase tracking-widest leading-relaxed">
                     This GRN document is officially issued and computationally validated in system. It is valid without physical manual signature & stamp under live corporate registry.
                  </div>
                  <div className="mt-2 text-[7px] font-mono text-emerald-600/70 tracking-widest">
                       AUTH REF: {completedGrnData?.grn_id} | {new Date(completedGrnData?.created_at || Date.now()).toLocaleDateString('id-ID')}
                  </div>
                </div>
              </div>

              {/* Final footer */}
              <div className="text-center pt-6 mt-8 border-t border-stone-100 w-full relative z-10 hidden">
                <span className="text-[7.5px] text-stone-400 uppercase tracking-[0.15em] font-bold">
                  * SYSTEM-GENERATED CONSORTIUM CONTRACT LOGISTICS DIRECTIVE *
                </span>
              </div>
          </PrintTemplate>
        </div>

        <div className="p-6 border-t border-stone-100 bg-white flex justify-center gap-4 shrink-0">
          <Button 
            variant="secondary"
            onClick={() => setShowGrnReportModal(false)}
            className="px-6 py-2.5 rounded-xl text-sm"
          >
            {language === 'id' ? 'Tutup' : 'Close'}
          </Button>
          <Button 
            variant="primary"
            onClick={() => exportGrnPdf()} 
            isLoading={isSubmitting}
            className="px-6 py-2.5 rounded-xl text-sm shadow-md"
          >
            {!isSubmitting && <Download className="w-4 h-4" />} 
            {language === 'id' ? (isSubmitting ? 'Mengekspor...' : 'Ekspor PDF (A4)') : (isSubmitting ? 'Generating...' : 'Export PDF (A4)')}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
