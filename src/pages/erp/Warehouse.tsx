import React, { useEffect, useState, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/Button';
import { apiFetch, safeFetchJson } from '@/utils/api';
import { toPng } from 'html-to-image';
import { QRCodeSVG } from 'qrcode.react';
import { 
  Package, Search, Filter, Plus, ArrowUpRight, AlertCircle, ArrowDownRight, 
  History, Settings2, X, CheckCircle2, AlertTriangle, Trash2, Info, QrCode, Download,
  ClipboardCheck, Printer, ScanLine, ArrowRight, Clock, TrendingUp, TrendingDown, Camera,
  ChevronDown, ShieldCheck, Truck, Upload
} from 'lucide-react';
import { cn, formatCurrency, parseCurrency } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { PageHeader } from '@/components/shared/PageHeader';
import { ConfirmModal } from '@/components/shared/ConfirmModal';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { ScannerModal } from '@/components/shared/ScannerModal';
import { Loader } from '@/components/shared/Loader';
import { Action, hasPermission, hasGodMode } from '@/utils/pbac';
import { getDailyAuthKey } from '@/utils/auth';



interface InventoryItem {
  id: string;
  item_code: string;
  name: string;
  dimension: string;
  spec: string;
  uom: string;
  type: string;
  unit_price: number;
  free_stock: number;
  allocated_stock: number;
  reserved_stock?: number;
}

export default function Warehouse() {
  const [activeTab, setActiveTab] = useState<'STOCK' | 'HISTORY' | 'TERMINAL' | 'PENDING'>('STOCK');
  const [terminalMenu, setTerminalMenu] = useState<'CONSUMPTION' | 'DISPATCH'>('CONSUMPTION');
  const [draftDeliveries, setDraftDeliveries] = useState<any[]>([]);
  const [showUploadDnModal, setShowUploadDnModal] = useState(false);
  const [selectedDn, setSelectedDn] = useState<any>(null);
  const [dnUploadFile, setDnUploadFile] = useState<File | null>(null);

  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [movements, setMovements] = useState<any[]>([]);
  const [movementPage, setMovementPage] = useState(0);
  const [totalMovements, setTotalMovements] = useState(0);
  const [pendingGrns, setPendingGrns] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);

  // Confirm Modal States
  const [confirmModal, setConfirmModal] = useState<{isOpen: boolean, title: string, message: string, action: () => void}>({
    isOpen: false, title: '', message: '', action: () => {}
  });
  
  // Consumption State (Merged from Operations)
  const [consumeStep, setConsumeStep] = useState<'IDLE' | 'SELECT_ITEM' | 'CONSUME' | 'SUCCESS'>('IDLE');
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [consumeQty, setConsumeQty] = useState('1');
  const [transactionDirection, setTransactionDirection] = useState<'WITHDRAW' | 'RETURN'>('WITHDRAW');
  const [scanInput, setScanInput] = useState('');
  const [scannedInfo, setScannedInfo] = useState<any>(null);
  const [recordedBy, setRecordedBy] = useState('');
  const [activeProjectBOM, setActiveProjectBOM] = useState<any[]>([]);
  
  // GRN State
  const [pos, setPos] = useState<any[]>([]);
  const [showGrnModal, setShowGrnModal] = useState(false);
  const [selectedPoDetails, setSelectedPoDetails] = useState<any>(null);

  const [grnItems, setGrnItems] = useState<any[]>([]);
  const [grnForm, setGrnForm] = useState({
    received_date: new Date().toISOString().split('T')[0],
    engineering_user: '',
    qc_user: '',
    qc_status: 'PASSED',
    remarks: ''
  });
  
  // Labels State
  const [showItemLabelsModal, setShowItemLabelsModal] = useState(false);
  const labelsRef = useRef<HTMLDivElement>(null);
  const [newItem, setNewItem] = useState({
    item_code: '',
    name: '',
    uom: 'PCS',
    type: 'RAW',
    unit_price: '' as string | number
  });
  
  const [editItem, setEditItem] = useState({
    item_code: '',
    name: '',
    uom: '',
    type: '',
    unit_price: 0
  });
  
  const [adjustQty, setAdjustQty] = useState('');
  const [adjustReason, setAdjustReason] = useState('STOCK_TAKE');
  const { showToast } = useToast();
  const { user } = useAuth();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showLabelModal, setShowLabelModal] = useState(false);
  const [selectedLabelItem, setSelectedLabelItem] = useState<any>(null);
  const exportSingleLabelPng = async () => {
    if (!labelsRef.current) return;
    setIsSubmitting(true);
    try {
      const element = labelsRef.current;
      // Force exact bounding dimensions in options & style so that the exported
      // PNG label is always perfectly formatted and never squished or clipped.
      const imgData = await toPng(element, {
        pixelRatio: 4,
        style: {
          transform: 'scale(1)',
          transformOrigin: 'top left',
          width: '420px',
        }
      });
      
      const link = document.createElement('a');
      link.download = `LABEL_${selectedLabelItem?.item_code || 'Item'}.png`;
      link.href = imgData;
      link.click();
      showToast('Label exported as PNG', 'success');
    } catch (err) {
      console.error(err);
      showToast('Export failed', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const exportLabelsPng = async () => {
    if (!labelsRef.current) return;
    setIsSubmitting(true);
    try {
      const element = labelsRef.current;
      // Force optimal design width for batch printing, letting height fit naturally.
      const imgData = await toPng(element, {
        pixelRatio: 4,
        style: {
          transform: 'scale(1)',
          transformOrigin: 'top left',
          width: '420px',
        }
      });
      
      const link = document.createElement('a');
      link.download = `LABELS_BATCH_${intakePoNumber || 'Batch'}.png`;
      link.href = imgData;
      link.click();
      showToast('Batch labels exported as PNG', 'success');
    } catch (err) {
      console.error(err);
      showToast('Export failed', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const [isScannerOpen, setIsScannerOpen] = useState(false);

  const [pendingInventoryActions, setPendingInventoryActions] = useState<any[]>([]);

  const handleScanSuccess = async (val: string) => {
    try {
      let parsed: any;
      try {
        parsed = JSON.parse(val);
      } catch (e) {
        // Not JSON, try as a raw item code or ID
        const found = inventory.find(i => i.item_code === val.trim().toUpperCase() || i.id === val.trim());
        if (found) {
          parsed = { id: found.id, code: found.item_code };
        } else {
          showToast(`Unknown code: ${val.trim()}`, "error");
          return;
        }
      }

      if (parsed && (parsed.id || parsed.code)) {
        const item = inventory.find(i => i.id === parsed.id || i.item_code === parsed.code);
        if (item) {
          setSelectedItem(item);
          setConsumeStep('CONSUME');
          setConsumeQty(parsed.qty ? parsed.qty.toString() : '1');
          setSearchQuery('');
          setIsScannerOpen(false);
          if (parsed.po) {
            try {
              const response = await apiFetch(`/api/warehouse/item-allocation-info?po_number=${encodeURIComponent(parsed.po)}&item_id=${item.id}`, {}, user?.username);
              const data = response.data;
              if (data?.projects?.length > 0) setSelectedProject(data.projects[0]);
            } catch (err) {
              console.error(err);
            }
          }
        } else {
          showToast("Item not found in inventory.", "error");
        }
      }
    } catch (err) {
      showToast("Scan error.", "error");
    }
  };

  const fetchInventory = async () => {
    setIsLoading(true);
    try {
      const [invData, movData, posData, projData, pendingData, draftDnData] = await Promise.all([
        apiFetch('/api/inventory/full', {}, user?.username),
        apiFetch(`/api/inventory/movements?limit=100&offset=${movementPage * 100}`, {}, user?.username),
        apiFetch('/api/purchasing/pos', {}, user?.username),
        apiFetch('/api/projects', {}, user?.username),
        apiFetch('/api/warehouse/pending-incoming', {}, user?.username),
        apiFetch('/api/sales/deliveries?status=DRAFT', {}, user?.username)
      ]);

      if (invData.ok) setInventory(Array.isArray(invData.data) ? invData.data : []);
      if (movData.ok) {
        if (movData.data?.movements) {
           setMovements(movData.data.movements);
           setTotalMovements(movData.data.total || 0);
        } else if (Array.isArray(movData.data)) {
           setMovements(movData.data);
           setTotalMovements(movData.data.length);
        }
      }
      if (posData.ok) setPos(Array.isArray(posData.data) ? posData.data.filter((p: any) => p.status === 'ISSUED' || p.status === 'PARTIAL') : []);
      if (projData.ok) setProjects(Array.isArray(projData.data) ? projData.data : []);
      if (pendingData.ok) setPendingGrns(Array.isArray(pendingData.data) ? pendingData.data : []);
      if (draftDnData.ok) setDraftDeliveries(Array.isArray(draftDnData.data) ? draftDnData.data : []);
    } catch (err) {
      console.error(err);
      showToast("Error fetching inventory data", "error");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (selectedProject) {
      apiFetch(`/api/projects/${selectedProject}`, {}, user?.username)
        .then(res => {
          if (res.ok) setActiveProjectBOM(res.data.bom || []);
        });
    } else {
      setActiveProjectBOM([]);
    }
  }, [selectedProject]);

  const fetchPoDetails = async (poId: string) => {
    try {
      const res = await apiFetch(`/api/purchasing/po/${poId}`, {}, user?.username);
      if (!res.ok || !res.data?.items) {
        throw new Error(res.error || 'Failed to fetch PO details');
      }
      setSelectedPoDetails(res.data);
      setGrnItems(res.data.items.map((it: any) => ({ 
        ...it, 
        qty_received: Math.max(0, it.qty - (it.received_qty || 0)) 
      })));
      setShowGrnModal(true);
    } catch (err) {
      console.error(err);
      showToast('Failed to fetch PO details', 'error');
    }
  };



  const [intakeLabels, setIntakeLabels] = useState<any[]>([]);
  const [intakePoNumber, setIntakePoNumber] = useState('');

  const handleIntakeGrn = async (grnId: string) => {
    setIsSubmitting(true);
    try {
      const res = await apiFetch('/api/warehouse/intake-grn', {
        method: 'POST',
        body: JSON.stringify({ grn_id: grnId, recorded_by: user?.username || 'SYSTEM' })
      }, user?.username);
      if (res.ok) {
        const data = res.data;
        showToast("GRN items successfully intaken into inventory!", "success");
        fetchInventory();
        if (data.labels && data.labels.length > 0) {
           setIntakeLabels(data.labels);
           setIntakePoNumber(data.po_number);
           setShowItemLabelsModal(true);
        }
      } else {
        showToast(res.error || "Failed to intake GRN", "error");
      }
    } catch (err) {
      console.error(err);
      showToast("Error processing intake", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    fetchInventory();
  }, [movementPage]);

  useEffect(() => {
    if (user?.username) setRecordedBy(user.username);
  }, [user]);

  const [adjustName, setAdjustName] = useState('');
  const [adjustUom, setAdjustUom] = useState('');
  // NO NEED FOR showQrScan AND showCameraScanner, use isScannerOpen

  // REMOVED useEffect(scanner logic) block that was here

  const handleRawScan = (text: string) => {
    if (!text) return;
    try {
      let data: any;
      try {
        data = JSON.parse(text);
      } catch (e) {
        // Not JSON, check if it's a code
        const clean = text.trim();
        const found = inventory.find(i => i.item_code === clean.toUpperCase() || i.id === clean);
        if (found) {
          data = { id: found.id, code: found.item_code };
        } else {
          showToast(`Unrecognized scan: ${clean}`, 'error');
          return;
        }
      }

      if (data && (data.id || data.label_id)) {
        const item = inventory.find(i => i.id === data.id);
        if (item) {
          setSelectedItem(item);
          setScannedInfo(data);
          setConsumeStep('CONSUME');
          setScanInput('');
          showToast(`Scanned: ${item.item_code}`, 'success');
        } else {
          showToast("Item not found in inventory list.", 'error');
        }
      }
    } catch (err) {
      showToast("Scan processing failed", 'error');
    }
  };

  const handleScan = (e: React.FormEvent) => {
    e.preventDefault();
    handleRawScan(scanInput);
  };

  const [isUploadingDn, setIsUploadingDn] = useState(false);
  const [authPin, setAuthPin] = useState('');

  const handleUploadDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDn) return showToast("Select a delivery note first", "error");
    if (authPin !== getDailyAuthKey(user?.username)) return showToast("Validation Failed: Invalid Authorization PIN.", "error");

    setIsUploadingDn(true);
    try {
      const digitalSignature = `Digitally Authorized for Dispatch by ${user?.name || user?.username} (${user?.role}) on ${new Date().toISOString()}`;

      const res = await apiFetch(`/api/sales/deliveries/${selectedDn.id}/upload-dispatch`, {
         method: 'POST',
         body: JSON.stringify({ file_url: digitalSignature })
      }, user?.username);

      if (res.ok) {
         showToast("Dispatch confirmed. Digital authorization complete.", "success");
         setShowUploadDnModal(false);
         setAuthPin('');
         setDnUploadFile(null);
         setSelectedDn(null);
         fetchInventory();
      } else {
         showToast(res.error || "Failed", "error");
      }
    } catch(err) {
      showToast("Error processing digital authorization", "error");
    } finally {
      setIsUploadingDn(false);
    }
  };

  const handleConsume = async () => {
    if (!selectedItem || !consumeQty) return;
    setIsSubmitting(true);
    try {
      const endpoint = transactionDirection === 'RETURN' ? '/api/inventory/return' : '/api/inventory/consume';
      const res = await apiFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify({
          item_id: selectedItem.id,
          qty: Number(consumeQty),
          project_id: selectedProject || null,
          recorded_by: recordedBy || user?.username || 'WAREHOUSE_STAFF'
        })
      }, user?.username);
      if (res.ok) {
        setConsumeStep('SUCCESS');
        fetchInventory();
        showToast(`Item ${transactionDirection === 'RETURN' ? 'returned' : 'consumed'} successfully`, "success");
      } else {
        showToast(res.error || `Failed to ${transactionDirection === 'RETURN' ? 'return' : 'consume'} item. Check stock level.`, 'error');
      }
    } catch (err) {
      console.error(err);
      showToast(`Error ${transactionDirection === 'RETURN' ? 'returning' : 'consuming'} item`, "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  // UX Improvement: Auto-reset scanner on Enter when in success state
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && consumeStep === 'SUCCESS') {
        setConsumeStep('IDLE');
        setSelectedItem(null);
        setScanInput('');
        setConsumeQty('1');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [consumeStep]);

  const handleDeleteItem = (id: string, itemCode: string) => {
    setConfirmModal({
      isOpen: true,
      title: "Delete Item?",
      message: `Are you sure you want to delete item ${itemCode}? This will fail if the item is used in any BOMs or has stock history.`,
      action: async () => {
        try {
          const res = await apiFetch(`/api/items/${id}`, { method: 'DELETE' }, user?.username);
          if (res.ok) {
            showToast(`Item ${itemCode} deleted successfully`, "success");
            fetchInventory();
          } else {
            showToast(res.error || "Failed to delete item", "error");
          }
        } catch (err) {
          console.error(err);
          showToast("Error deleting item", "error");
        }
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const price = typeof newItem.unit_price === 'string' ? parseCurrency(newItem.unit_price) : newItem.unit_price;
      const res = await apiFetch('/api/items', {
        method: 'POST',
        body: JSON.stringify({
          ...newItem,
          unit_price: price || 0
        })
      }, user?.username);
      if (res.ok) {
        showToast("Item added successfully", "success");
        setShowAddModal(false);
        setNewItem({ item_code: '', name: '', uom: 'PCS', type: 'RAW', unit_price: '' });
        fetchInventory();
      } else {
        showToast(res.error || "Failed to add item", "error");
      }
    } catch (err) {
      console.error(err);
      showToast("Error adding item", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReturnGrn = (grnId: string) => {
    setConfirmModal({
      isOpen: true,
      title: "Return GRN?",
      message: "Confirm returning these REJECTED items back to the supplier? This will clear them from your pending queue.",
      action: async () => {
        try {
          const res = await apiFetch('/api/warehouse/return-grn', {
            method: 'POST',
            body: JSON.stringify({ grn_id: grnId })
          }, user?.username);
          if (res.ok) {
            showToast("Rejected GRN processed and returned.", "success");
            fetchInventory();
          } else {
            showToast(res.error || "Failed to return GRN", "error");
          }
        } catch (err) {
          console.error(err);
          showToast("Error returning GRN", "error");
        }
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const handleAdjustStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem) return;
    setIsSubmitting(true);
    try {
      const res = await apiFetch('/api/inventory/adjust-v2', {
        method: 'POST',
        body: JSON.stringify({
          item_id: selectedItem.id,
          new_free_stock: Number(adjustQty),
          reason: adjustReason,
          username: user?.username || 'Warehouse Staff',
          item_name: adjustName || undefined,
          uom: adjustUom || undefined
        })
      }, user?.username);
      if (res.ok) {
        showToast("Stock & Metadata updated", "success");
        setShowAdjustModal(false);
        setAdjustQty('');
        setAdjustReason('STOCK_TAKE');
        setAdjustName('');
        setAdjustUom('');
        setSelectedItem(null);
        fetchInventory();
      } else {
        showToast(res.error || "Failed to adjust stock", "error");
      }
    } catch (err) {
      console.error(err);
      showToast("Error adjusting stock", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredInventory = useMemo(() => inventory.filter(item => 
    item.item_code.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.name.toLowerCase().includes(searchQuery.toLowerCase())
  ), [inventory, searchQuery]);

  return (
    <div className="space-y-12 pb-20 animate-in fade-in duration-500">
      <PageHeader
        title="Warehouse"
        subtitle="Inventory Monitoring & Physical Receipt Ledger"
        icon={<Package className="w-6 h-6" />}
        actions={
          <button
            disabled={!hasPermission(user, Action.WAREHOUSE_ACTION)}
            onClick={() => setShowAddModal(true)}
            className="px-8 py-3 bg-stone-800 text-white text-sm font-bold rounded-2xl hover:bg-stone-900 transition-all active:scale-95 flex items-center gap-2 shadow-sm disabled:opacity-50"
          >
            <Plus className="w-5 h-5" /> Register Item
          </button>
        }
      />

      {/* Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="card-elegant p-8 rounded-[2rem]">
          <div className="flex items-start justify-between mb-6">
            <div className="p-3 bg-stone-50 rounded-2xl flex items-center justify-center">
              <Package className="w-5 h-5 text-stone-600" />
            </div>
            <span className="text-[10px] font-bold text-stone-400 tracking-[0.2em] font-mono">01</span>
          </div>
          <div className="text-[10px] text-stone-400 font-bold mb-1 uppercase tracking-[0.2em]">Active SKUs</div>
          <div className="text-xl font-light text-stone-900 tracking-tighter leading-none">
            {inventory.length}
            <span className="text-sm font-bold text-stone-400 ml-3 uppercase tracking-widest">items</span>
          </div>
        </div>
        <div className="card-elegant p-8 rounded-[2rem]">
          <div className="flex items-start justify-between mb-6">
            <div className={cn(
              "p-3 rounded-2xl flex items-center justify-center", 
              inventory.filter(i => i.free_stock < 5).length > 0 ? "bg-rose-50" : "bg-stone-50"
            )}>
              <AlertTriangle className={cn("w-5 h-5", inventory.filter(i => i.free_stock < 5).length > 0 ? "text-rose-600" : "text-stone-400")} />
            </div>
            <span className="text-[10px] font-bold text-stone-400 tracking-[0.2em] font-mono">02</span>
          </div>
          <div className="text-[10px] text-stone-400 font-bold mb-1 uppercase tracking-[0.2em]">Critical Alerts</div>
          <div className="flex items-baseline gap-3">
            <div className={cn(
              "text-xl font-light tracking-tighter leading-none", 
              inventory.filter(i => i.free_stock < 5).length > 0 ? "text-rose-600" : "text-stone-900"
            )}>
              {inventory.filter(i => i.free_stock < 5).length}
            </div>
            <span className="text-xs font-bold text-stone-400 uppercase tracking-widest leading-none mt-2">skus needs attention</span>
          </div>
        </div>
      </div>

      {/* Search & Tabs */}
      <div className="card-elegant rounded-[2rem] overflow-hidden">
        <div className="px-8 py-8 flex flex-col xl:flex-row xl:items-center justify-between gap-6 bg-white">
          <div className="flex gap-2">
            {[
              { id: 'STOCK', label: 'Current Inventory' },
              { id: 'PENDING', label: 'QC & Intake' },
              { id: 'TERMINAL', label: 'Terminal OPS' },
              { id: 'HISTORY', label: 'Movement Logs' }
            ].filter(tab => {
              if (!hasGodMode(user) && !hasPermission(user, Action.WAREHOUSE_ACTION)) {
                return tab.id === 'STOCK';
              }
              return true;
            }).map(tab => (
              <button  
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={cn(
                  "px-5 py-3 text-[10px] font-bold transition-all rounded-xl relative tracking-[0.2em] uppercase",
                  activeTab === tab.id ? "bg-white shadow-sm border-stone-200 text-stone-900 ring-1 ring-stone-900/5" : "text-stone-500 hover:bg-stone-100 border-transparent"
                )}
              >
                {tab.label}
                {tab.id === 'PENDING' && pendingGrns.length > 0 && (
                  <span className="ml-2 bg-rose-500 text-white rounded-lg px-2 py-0.5 text-[8px] font-bold italic">
                    {pendingGrns.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="flex gap-2 relative max-w-sm w-full">
            <div className="relative flex-1 group">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
              <input 
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-11 pr-4 py-3 bg-stone-50 border border-stone-100 rounded-xl text-[12px] font-bold text-stone-900 focus:bg-white focus:border-stone-900/20 outline-none transition-all"
              />
            </div>
            <button
              onClick={fetchInventory}
              className="w-10 h-10 bg-stone-50 border border-stone-100 flex items-center justify-center rounded-xl text-stone-400 hover:text-stone-900 transition-all active:scale-95"
              title="Refresh"
            >
              <History className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div>
            {activeTab === 'STOCK' ? (
            <div className="px-10 pb-12">
              <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-stone-100">
                      <th className="py-8 pr-10 text-[9px] text-stone-400 font-bold uppercase tracking-[0.2em]">Product Intelligence</th>
                      <th className="py-8 px-10 text-[9px] text-stone-400 font-bold uppercase tracking-[0.2em]">Asset Class</th>
                      <th className="py-8 px-10 text-[9px] text-stone-400 font-bold uppercase tracking-[0.2em] text-right">Physical Reserves</th>
                      <th className="py-8 pl-10 text-[9px] text-stone-400 font-bold uppercase tracking-[0.2em] text-center">Protocol</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100/60">
                    {isLoading ? (
                      <tr>
                        <td colSpan={4}><Loader text="Syncing logistics network..." className="py-32" /></td>
                      </tr>
                    ) : filteredInventory.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-32 text-center text-stone-400 font-bold uppercase tracking-[0.2em]" style={{ fontSize: '10px' }}>Repository empty or no matches.</td>
                      </tr>
                    ) : (
                      filteredInventory.map((item) => (
                        <tr key={item.id} className="hover:bg-stone-50/50 transition-colors group">
                          <td className="py-8 pr-10">
                            <div className="text-[10px] font-bold font-mono text-stone-400 mb-2 tracking-[0.1em]">{item.item_code}</div>
                            <div className="text-lg font-bold text-stone-950 tracking-tighter uppercase">{item.name}</div>
                            <div className="text-[10px] text-stone-400 mt-2 tracking-wide font-bold uppercase flex items-center gap-2">
                              <span>{item.dimension || 'Variable'}</span>
                              <div className="w-1 h-1 rounded-full bg-stone-200" />
                              <span>{item.spec || 'Standard Spec'}</span>
                            </div>
                          </td>
                          <td className="py-8 px-10">
                            <span className="inline-flex items-center px-2.5 py-1 rounded-xl text-[9px] font-bold bg-white ring-1 ring-stone-100 text-stone-400 tracking-[0.2em] uppercase">
                              {item.type}
                            </span>
                          </td>
                          <td className="py-8 px-10 text-right">
                            <div className="flex flex-col items-end">
                              <div className={cn(
                                "text-xl font-light tabular-nums leading-none",
                                item.free_stock < 5 ? "text-rose-500" : "text-stone-900"
                              )}>
                                {item.free_stock.toLocaleString('id-ID')}
                              </div>
                              <span className="text-[9px] text-stone-400 font-bold uppercase tracking-[0.3em] mt-2 leading-none">{item.uom}</span>
                            </div>
                          </td>
                          <td className="py-8 pl-10 text-center">
                            <div className="flex items-center justify-center gap-3 transition-all">
                              <Button 
                                size="icon"
                                variant="secondary"
                                disabled={!hasPermission(user, Action.WAREHOUSE_ACTION)}
                                onClick={() => {
                                  setSelectedItem(item);
                                  setAdjustQty(item.free_stock.toString());
                                  setShowAdjustModal(true);
                                }}
                                title="Adjust Inventory"
                              >
                                <Settings2 className="w-4 h-4" />
                              </Button>
                              <Button 
                                size="icon"
                                variant="danger_soft"
                                disabled={!hasPermission(user, Action.WAREHOUSE_ACTION)}
                                onClick={() => handleDeleteItem(item.id, item.item_code)}
                                title="Delete SKU"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : activeTab === 'HISTORY' ? (
            <div className="px-10 pb-12">
              <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-stone-100">
                    <th className="py-8 pr-6 text-[9px] font-bold text-stone-400 uppercase tracking-[0.2em]">Temporal Marker</th>
                    <th className="py-8 px-6 text-[9px] font-bold text-stone-400 uppercase tracking-[0.2em]">Material Asset</th>
                    <th className="py-8 px-6 text-[9px] font-bold text-stone-400 uppercase tracking-[0.2em] text-center">Movement Type</th>
                    <th className="py-8 px-6 text-[9px] font-bold text-stone-400 uppercase tracking-[0.2em]">Operational Nexus</th>
                    <th className="py-8 px-6 text-[9px] font-bold text-stone-400 uppercase tracking-[0.2em]">Initiator</th>
                    <th className="py-8 pl-6 text-[9px] font-bold text-stone-400 uppercase tracking-[0.2em] text-right">Delta</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100/60">
                  {movements.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-32 text-center text-stone-400 font-bold uppercase tracking-[0.2em]" style={{ fontSize: '10px' }}>No logistical records detected in the local repository.</td>
                    </tr>
                  ) : movements.map((mov) => (
                    <tr key={mov.id} className="hover:bg-stone-50/50 transition-colors">
                      <td className="py-8 pr-6">
                        <div className="text-sm font-bold text-stone-900 tracking-tight uppercase">{new Date(mov.created_at).toLocaleDateString('en-US', { timeZone: 'Asia/Jakarta', month: 'short', day: 'numeric', year: 'numeric' })}</div>
                        <div className="text-[10px] font-bold text-stone-400 tracking-[0.2em] uppercase mt-2 tabular-nums">{new Date(mov.created_at).toLocaleTimeString([], { timeZone: 'Asia/Jakarta', hour: '2-digit', minute:'2-digit'})}</div>
                      </td>
                      <td className="py-8 px-6">
                        <div className="text-sm font-bold text-stone-900 tracking-tight uppercase mb-1">{mov.item_code}</div>
                        <div className="text-[10px] text-stone-400 font-bold tracking-tight uppercase truncate max-w-[180px]">{mov.item_name}</div>
                      </td>
                      <td className="py-8 px-6 text-center">
                        <span className={cn(
                          "inline-flex items-center px-3 py-1 rounded-xl text-[9px] font-bold tracking-[0.2em] uppercase ring-1 ring-inset",
                          mov.type === 'ALLOCATION' ? "bg-stone-100 text-stone-900 ring-stone-900/10" :
                          mov.type === 'GRN' ? "bg-emerald-50 text-emerald-600 ring-emerald-100" :
                          mov.type === 'CONSUMPTION' ? "bg-amber-50 text-amber-600 ring-amber-100" :
                          mov.type === 'RECLAIM' ? "bg-rose-50 text-rose-600 ring-rose-100" :
                          "bg-stone-50 text-stone-500 ring-stone-100"
                        )}>
                          {mov.type}
                        </span>
                      </td>
                      <td className="py-8 px-6">
                        <div className="flex flex-col">
                          <span className="text-sm font-bold text-stone-700 tracking-tight uppercase mb-1">{mov.project_name || 'CENTRAL REPOSITORY'}</span>
                          <span className="text-[10px] text-stone-400 font-bold tracking-widest uppercase font-mono">{mov.id.slice(0, 8)}</span>
                        </div>
                      </td>
                      <td className="py-8 px-6">
                        <div className="flex items-center gap-4">
                           <div className="w-9 h-9 rounded-xl bg-white ring-1 ring-stone-100 flex items-center justify-center text-stone-900 font-bold text-xs uppercase shadow-sm">
                              {(mov.recorded_by || 'S').charAt(0)}
                           </div>
                           <span className="text-xs font-bold text-stone-900 tracking-tight uppercase leading-none">{mov.recorded_by || 'SYSTEM AUTH'}</span>
                        </div>
                      </td>
                      <td className="py-8 pl-6 text-right">
                        <div className="flex items-center justify-end gap-4">
                          <div className="flex flex-col items-end">
                            <div className={cn(
                              "text-xl font-light tabular-nums leading-none",
                              mov.qty > 0 ? "text-emerald-500" : "text-stone-900"
                            )}>
                              {mov.qty > 0 ? '+' : ''}{mov.qty}
                            </div>
                             <span className="text-[9px] font-bold tracking-[0.2em] uppercase text-stone-400 mt-2 leading-none">{mov.uom}</span>
                          </div>
                          {mov.type === 'GRN' && (
                            <button 
                              onClick={() => {
                                setSelectedLabelItem(mov);
                                setShowLabelModal(true);
                              }}
                              className="w-9 h-9 flex items-center justify-center text-stone-400 hover:text-stone-900 hover:bg-white rounded-xl transition-all shadow-sm ring-1 ring-transparent hover:ring-stone-100"
                              title="Print QR Label"
                            >
                              <QrCode className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              
              <div className="flex items-center justify-between mt-8 border-t border-stone-100 pt-6">
                <div className="text-[10px] font-bold tracking-widest text-stone-400 uppercase">
                  Showing {movements.length > 0 ? movementPage * 100 + 1 : 0} to {Math.min((movementPage + 1) * 100, totalMovements)} of {totalMovements}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setMovementPage(p => Math.max(0, p - 1))}
                    disabled={movementPage === 0}
                    className="px-4 py-2 border border-stone-200 rounded-xl text-[10px] uppercase font-bold tracking-widest disabled:opacity-30 disabled:cursor-not-allowed hover:bg-stone-50 transition-colors bg-white shadow-sm"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setMovementPage(p => p + 1)}
                    disabled={(movementPage + 1) * 100 >= totalMovements}
                    className="px-4 py-2 border border-stone-200 rounded-xl text-[10px] uppercase font-bold tracking-widest disabled:opacity-30 disabled:cursor-not-allowed hover:bg-stone-50 transition-colors bg-white shadow-sm"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
        ) : activeTab === 'TERMINAL' ? (
            <div className="flex flex-col lg:flex-row min-h-[700px] bg-white grow pattern-grid-lg">
              {/* Left Panel: Entry Terminal (70%) */}
              <div className="lg:w-[70%] p-8 lg:p-14 border-b lg:border-b-0 lg:border-r border-stone-100 bg-white/80 backdrop-blur-3xl overflow-y-auto">
                <div className="max-w-3xl mx-auto space-y-12">
                  <header className="flex items-center justify-between text-left border-b border-stone-100 pb-10">
                    <div className="flex items-center gap-6">
                      <div className="w-16 h-16 bg-stone-800 text-white rounded-[1.25rem] flex items-center justify-center shadow-2xl shadow-stone-950/20">
                        <ScanLine className="w-7 h-7" />
                      </div>
                      <div>
                        <h3 className="text-xl font-bold text-stone-900 tracking-tighter uppercase">Physical Terminal</h3>
                        <p className="text-[10px] text-stone-400 font-bold mt-2 uppercase tracking-[0.2em] flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          Unified OPS Gatekeeper
                        </p>
                      </div>
                    </div>
                  </header>
                  
                  <div className="flex justify-center gap-2 border-b border-stone-100 pb-8">
                     <button onClick={() => setTerminalMenu('CONSUMPTION')} className={cn("px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-colors", terminalMenu === 'CONSUMPTION' ? "bg-stone-800 text-white" : "bg-stone-100 text-stone-500 hover:bg-stone-200 text-stone-900")}>Part Consumption</button>
                     <button onClick={() => setTerminalMenu('DISPATCH')} className={cn("px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-colors", terminalMenu === 'DISPATCH' ? "bg-stone-800 text-white" : "bg-stone-100 text-stone-500 hover:bg-stone-200 text-stone-900")}>Dispatch Sign-Off</button>
                  </div>

                  <div className="space-y-8">
                      {terminalMenu === 'CONSUMPTION' ? (
                        <div className="space-y-8">
                          {consumeStep === 'IDLE' ? (
                          <div className="space-y-6 text-center max-w-xl mx-auto mt-12">
                            <div className="p-12 border border-dashed border-stone-200 rounded-3xl bg-stone-50/50 space-y-6 hover:bg-stone-50 hover:border-stone-300 transition-all group">
                              <div className="w-20 h-20 bg-white rounded-3xl flex items-center justify-center shadow-sm mx-auto group-hover:scale-105 transition-transform duration-500">
                                <Package className="w-8 h-8 text-stone-400 group-hover:text-stone-900 transition-colors" />
                              </div>
                              <div className="space-y-2">
                                <div className="text-lg font-bold text-stone-900">Initiate Withdrawal</div>
                                <div className="text-sm text-stone-400 font-medium">Select an item from the warehouse inventory to record physical consumption or project allocation.</div>
                              </div>
                              <button 
                                onClick={() => setConsumeStep('SELECT_ITEM')}
                                className="px-8 py-3.5 bg-stone-800 text-white text-xs font-bold rounded-2xl hover:bg-stone-900 transition-all tracking-wider uppercase shadow-xl shadow-stone-900/20 active:scale-95"
                              >
                                Browse Directory
                              </button>
                            </div>
                          </div>
                        ) : consumeStep === 'SELECT_ITEM' ? (
                          <div className="space-y-6 max-w-xl mx-auto">
                            <div className="flex gap-3">
                              <div className="relative group flex-1">
                                <Search className="absolute left-6 top-1/2 -translate-y-1/2 w-5 h-5 text-stone-400 group-focus-within:text-stone-900 transition-colors" />
                                <input 
                                  type="text"
                                  placeholder="Type SKU or use USB scanner..."
                                  autoFocus
                                  value={searchQuery}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setSearchQuery(val);
                                    if(val.includes('{') && val.includes('}')) {
                                       handleScanSuccess(val);
                                    }
                                  }}
                                  className="w-full pl-14 pr-6 py-4 bg-stone-50 border border-stone-200/50 hover:bg-white hover:border-stone-300 rounded-2xl text-sm font-bold text-stone-900 focus:bg-white focus:border-stone-300 focus:ring-4 focus:ring-stone-100 outline-none transition-all shadow-sm"
                                />
                              </div>
                              <button
                                onClick={() => {
                                  const hasPermission = localStorage.getItem('CAMERA_PERMISSION_GRANTED');
                                  if (hasPermission === 'true') {
                                    setIsScannerOpen(true);
                                  } else {
                                    setConfirmModal({
                                      isOpen: true,
                                      title: "Camera Access Permission",
                                      message: "The system needs access to your device's camera to scan QR codes and Barcodes. Do you allow camera usage? This preference will be saved.",
                                      action: () => {
                                        localStorage.setItem('CAMERA_PERMISSION_GRANTED', 'true');
                                        setIsScannerOpen(true);
                                        setConfirmModal(prev => ({ ...prev, isOpen: false }));
                                      }
                                    });
                                  }
                                }}
                                className="px-6 py-4 bg-stone-800 text-white rounded-2xl flex items-center gap-2 hover:bg-stone-900 transition-colors shadow-xl shadow-stone-900/20 active:scale-95"
                              >
                                <Camera className="w-5 h-5" />
                                <span className="font-bold text-xs uppercase tracking-widest hidden md:inline">Camera</span>
                              </button>
                            </div>
                            
                            <div className="max-h-[400px] overflow-y-auto border border-stone-100 rounded-3xl divide-y divide-stone-100 bg-white shadow-xl shadow-stone-200/20">
                              {inventory.filter(i => i && i.name && (i.name.toLowerCase().includes(searchQuery.toLowerCase()) || i.item_code.toLowerCase().includes(searchQuery.toLowerCase()))).map(item => (
                                <button 
                                  key={item.id}
                                  onClick={() => {
                                    setSelectedItem(item);
                                    setConsumeStep('CONSUME');
                                    setSearchQuery('');
                                  }}
                                  className="w-full p-5 text-left hover:bg-stone-50 transition-colors flex justify-between items-center group"
                                >
                                  <div className="flex items-center gap-4">
                                     <div className="w-10 h-10 rounded-xl bg-stone-100 flex items-center justify-center shrink-0">
                                       <Package className="w-5 h-5 text-stone-400 group-hover:text-stone-900 transition-colors" />
                                     </div>
                                    <div>
                                      <div className="text-[10px] font-bold text-stone-400 font-mono tracking-widest">{item.item_code}</div>
                                      <div className="text-base font-bold text-stone-900">{item.name}</div>
                                    </div>
                                  </div>
                                  <div className="text-right flex flex-col justify-center items-end">
                                    <div className="text-xl font-semibold text-stone-900 tracking-tight">{item.free_stock} <span className="text-[10px] uppercase font-bold text-stone-400">{item.uom}</span></div>
                                    <div className="text-[9px] text-emerald-600 font-bold uppercase tracking-widest mt-0.5">Available</div>
                                  </div>
                                </button>
                              ))}
                            </div>
                            <button onClick={() => setConsumeStep('IDLE')} className="text-[10px] text-stone-400 hover:text-stone-900 font-bold uppercase tracking-wider w-full text-center py-4 transition-colors">Abort Selection Sequence</button>
                          </div>
                        ) : consumeStep === 'CONSUME' && selectedItem ? (
                          <div className="space-y-10 max-w-2xl mx-auto mt-8">
                            <div className="p-8 bg-white border border-stone-100 rounded-[2rem] shadow-2xl shadow-stone-200/30 text-left relative overflow-hidden">
                              {/* Background Pattern */}
                              <div className="absolute top-0 right-0 p-8 opacity-5">
                                 <ScanLine className="w-64 h-64 rotate-12 translate-x-1/4 -translate-y-1/4" />
                              </div>

                              <div className="relative">
                                <div className="flex justify-between items-start mb-8">
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-2">
                                       <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                                       <div className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">Active Target Acquired</div>
                                    </div>
                                    <h4 className="text-xl font-semibold text-stone-900 tracking-tight mb-1">{selectedItem?.item_code}</h4>
                                    <p className="text-lg text-stone-500 font-medium">{selectedItem?.name}</p>
                                  </div>
                                  <button onClick={() => setConsumeStep('SELECT_ITEM')} className="p-3 border border-stone-200 hover:border-stone-400 hover:bg-stone-50 rounded-2xl transition-all shadow-sm group">
                                    <Search className="w-5 h-5 text-stone-400 group-hover:text-stone-900" />
                                  </button>
                                </div>
                                
                                <div className="grid grid-cols-3 gap-4 border-t border-stone-100 pt-8">
                                   <div className="p-4 bg-stone-50 rounded-2xl border border-stone-100/50">
                                      <div className="text-[9px] font-bold text-stone-400 uppercase tracking-widest mb-1">Physical Stock</div>
                                      <div className="text-lg font-semibold text-stone-900 tracking-tighter hover:text-stone-700 transition-colors">
                                        {((selectedItem?.free_stock || 0) + (selectedItem?.allocated_stock || 0)).toLocaleString('id-ID')} <span className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">{selectedItem?.uom}</span>
                                      </div>
                                   </div>
                                   <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100/50">
                                      <div className="text-[9px] font-bold text-emerald-600/70 uppercase tracking-widest mb-1">Free/Avail.</div>
                                      <div className="text-lg font-semibold text-emerald-700 tracking-tighter">
                                        {selectedItem?.free_stock.toLocaleString('id-ID')} <span className="text-[10px] font-bold text-emerald-600/70 uppercase tracking-widest">{selectedItem?.uom}</span>
                                      </div>
                                   </div>
                                   <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100/50">
                                      <div className="text-[9px] font-bold text-amber-600/70 uppercase tracking-widest mb-1">Allocated</div>
                                      <div className="text-lg font-semibold text-amber-700 tracking-tighter">
                                        {selectedItem?.allocated_stock.toLocaleString('id-ID')} <span className="text-[10px] font-bold text-amber-600/70 uppercase tracking-widest">{selectedItem?.uom}</span>
                                      </div>
                                   </div>
                                </div>
                              </div>
                            </div>

                            <div className="space-y-6 text-left p-2">
                              <div className="grid grid-cols-2 gap-6">
                                <div className="space-y-2">
                                  <label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider ml-1">Volume Required</label>
                                  <div className="relative group">
                                    <input 
                                      type="number"
                                      value={consumeQty}
                                      onChange={(e) => setConsumeQty(e.target.value)}
                                      className="w-full pl-6 pr-16 py-4 bg-stone-50 border border-stone-200/50 hover:bg-white hover:border-stone-300 rounded-2xl text-xl font-semibold text-stone-900 focus:bg-white focus:border-stone-300 focus:ring-4 focus:ring-stone-100 outline-none transition-all shadow-sm"
                                    />
                                    <span className="absolute right-6 top-1/2 -translate-y-1/2 text-xs font-bold text-stone-400 uppercase tracking-widest">{selectedItem?.uom}</span>
                                  </div>
                                </div>
                                <div className="space-y-2">
                                  <label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider ml-1">Authorized Personnel</label>
                                  <input 
                                    type="text"
                                    value={recordedBy}
                                    placeholder="ID or Name"
                                    onChange={(e) => setRecordedBy(e.target.value)}
                                    className="w-full px-6 py-4 bg-stone-50 border border-stone-200/50 hover:bg-white hover:border-stone-300 rounded-2xl text-base font-bold text-stone-900 focus:bg-white focus:border-stone-300 focus:ring-4 focus:ring-stone-100 outline-none transition-all shadow-sm"
                                  />
                                </div>
                              </div>
                              
                              <div className="space-y-2">
                                <label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider ml-1">Transaction Type</label>
                                <div className="flex gap-4">
                                  <button
                                    onClick={() => setTransactionDirection('WITHDRAW')}
                                    className={cn(
                                      "flex-1 py-4 px-6 rounded-2xl text-sm font-bold uppercase tracking-widest border transition-all text-center",
                                      transactionDirection === 'WITHDRAW' ? "bg-white border-2 border-stone-900 text-stone-900 shadow-xl shadow-stone-900/10 ring-4 ring-stone-900/5" : "bg-white border-2 border-stone-100 text-stone-400 hover:border-stone-200 hover:text-stone-600"
                                    )}
                                  >
                                    Withdraw
                                  </button>
                                  <button
                                    onClick={() => setTransactionDirection('RETURN')}
                                    className={cn(
                                      "flex-1 py-4 px-6 rounded-2xl text-sm font-bold uppercase tracking-widest border transition-all text-center",
                                      transactionDirection === 'RETURN' ? "bg-white border-2 border-emerald-600 text-emerald-700 shadow-xl shadow-emerald-600/10 ring-4 ring-emerald-50" : "bg-white border-2 border-stone-100 text-stone-400 hover:border-stone-200 hover:text-stone-600"
                                    )}
                                  >
                                    Return
                                  </button>
                                </div>
                              </div>

                              <div className="space-y-2">
                                <label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider ml-1">Operational Attribution (Project)</label>
                                <Select 
                                  value={selectedProject}
                                  onChange={(e) => setSelectedProject(e.target.value)}
                                  className="w-full px-6 py-4 bg-stone-50 border border-stone-200/50 hover:bg-white hover:border-stone-300 rounded-2xl text-base font-bold text-stone-900 focus:bg-white focus:border-stone-300 focus:ring-4 focus:ring-stone-100 outline-none transition-all appearance-none shadow-sm cursor-pointer"
                                >
                                  <option value="">-- Unassigned (General Protocol) --</option>
                                  {projects.map(p => (
                                    <option key={p.id} value={p.id}>{p.id} - {p?.name}</option>
                                  ))}
                                </Select>
                              </div>

                              {selectedProject && activeProjectBOM.length > 0 && selectedItem && (
                                <div className={cn(
                                  "p-6 rounded-3xl border transition-all",
                                  activeProjectBOM.some(b => b.item_id === selectedItem?.id) 
                                    ? "bg-emerald-50/50 border-emerald-200 shadow-sm shadow-emerald-100/50" 
                                    : "bg-amber-50/50 border-amber-200 shadow-sm shadow-amber-100/50"
                                )}>
                                  <div className="flex items-center gap-5">
                                    <div className={cn(
                                      "w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-sm",
                                      activeProjectBOM.some(b => b.item_id === selectedItem?.id) ? "bg-emerald-500 text-white" : "bg-amber-500 text-white"
                                    )}>
                                      {activeProjectBOM.some(b => b.item_id === selectedItem?.id) ? <CheckCircle2 className="w-6 h-6" /> : <AlertTriangle className="w-6 h-6" />}
                                    </div>
                                    <div className="text-left">
                                      <div className={cn(
                                        "text-[10px] font-bold uppercase tracking-wider mb-1.5 flex items-center gap-1.5",
                                         activeProjectBOM.some(b => b.item_id === selectedItem?.id) ? "text-emerald-700" : "text-amber-700"
                                      )}>
                                        <ShieldCheck className="w-3 h-3" /> Engineering Constraints check
                                      </div>
                                      <p className="text-sm font-bold text-stone-900 leading-snug">
                                        {activeProjectBOM.some(b => b.item_id === selectedItem?.id) 
                                          ? `Verified Match. Engineered Volume Requirement: ${activeProjectBOM.find(b => b.item_id === selectedItem?.id)?.required_qty}`
                                          : `Warning: Element explicitly missing from ${selectedProject} engineering parameters.`
                                        }
                                      </p>
                                    </div>
                                  </div>
                                </div>
                              )}
                              
                              <div className="pt-4">
                                <button 
                                  onClick={handleConsume}
                                  disabled={isSubmitting || !consumeQty || !recordedBy}
                                  className={cn("w-full py-5 text-white rounded-2xl font-bold text-sm uppercase tracking-wider shadow-2xl hover:-translate-y-0.5 transition-all active:translate-y-0 active:scale-[0.99] disabled:opacity-30 disabled:pointer-events-none disabled:transform-none border", transactionDirection === 'RETURN' ? "bg-emerald-600 border-emerald-600 shadow-emerald-600/20 hover:bg-emerald-700" : "bg-stone-800 border-stone-900 shadow-stone-900/20 hover:bg-stone-900")}
                                >
                                  {isSubmitting ? 'Processing Transaction...' : transactionDirection === 'RETURN' ? 'Execute Return' : 'Execute Checkout'}
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : consumeStep === 'SUCCESS' && (
                           <div className="text-center py-20 max-w-md mx-auto">
                             <div className="w-28 h-28 bg-emerald-50 text-emerald-500 rounded-[2.5rem] flex items-center justify-center mx-auto mb-8 shadow-xl shadow-emerald-500/10 rotate-3">
                               <CheckCircle2 className="w-14 h-14" />
                             </div>
                             <h4 className="text-xl font-semibold text-stone-900 uppercase tracking-tight">Checkout Cleared</h4>
                             <p className="text-base text-stone-500 mt-3 font-medium">Logistics network seamlessly updated.</p>
                             <div className="mt-12 flex flex-col gap-4">
                               <button 
                                 onClick={() => {
                                   setConsumeStep('IDLE');
                                   setSelectedItem(null);
                                   setConsumeQty('1');
                                 }}
                                 className="px-8 py-4 bg-stone-800 text-white rounded-2xl text-xs font-semibold uppercase tracking-wider shadow-xl shadow-stone-900/20 hover:bg-stone-900 transition-all hover:-translate-y-0.5 active:translate-y-0"
                               >
                                 Process Next Entity
                               </button>
                             </div>
                           </div>
                        )}
                      </div>
                    ) : terminalMenu === 'DISPATCH' ? (
                      <div className="space-y-8">
                         {draftDeliveries.length === 0 ? (
                            <div className="text-center py-20">
                               <div className="w-20 h-20 bg-stone-50 rounded-[2rem] flex items-center justify-center mx-auto mb-6">
                                 <Truck className="w-8 h-8 text-stone-300" />
                               </div>
                               <h4 className="text-sm font-bold text-stone-900 uppercase tracking-widest">No Active Dispatch Drafts</h4>
                               <p className="text-xs text-stone-500 font-medium mt-2">Finish Good deliveries waiting for logistics sign-off will appear here.</p>
                            </div>
                         ) : (
                            <div className="space-y-4">
                               {draftDeliveries.map(d => (
                                  <div key={d.id} className="p-6 bg-white border border-stone-200 rounded-3xl flex justify-between items-center shadow-sm">
                                     <div>
                                        <div className="text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-1">DRAFT DN</div>
                                        <div className="text-lg font-bold text-stone-900 font-mono tracking-tight">{d.dn_number}</div>
                                        <div className="text-xs font-bold text-stone-500 mt-1">Dest: {d.customer_name}</div>
                                     </div>
                                     {hasPermission(user, Action.DISPATCH_GOODS) && (
                                       <button 
                                          onClick={() => { setSelectedDn(d); setShowUploadDnModal(true); }} 
                                          className="px-3 py-1.5 bg-amber-50 text-amber-700 text-xs font-medium rounded-lg hover:bg-amber-100 transition-colors flex items-center gap-1.5 font-sans"
                                       >
                                          <Download className="w-3.5 h-3.5" /> Authorize
                                       </button>
                                     )}
                                  </div>
                               ))}
                            </div>
                         )}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              {/* Right Panel: Monitor & Intelligence (30%) */}
              <div className="lg:w-[30%] p-8 lg:p-12 overflow-y-auto bg-stone-50 border-l border-stone-100 relative">
                <div className="max-w-md mx-auto space-y-12">
                  <header className="text-left">
                    <h3 className="text-sm font-semibold text-stone-900 tracking-tight mb-4">Operations Monitor</h3>
                    <div className="h-[1px] w-full bg-stone-100" />
                  </header>                  {/* Profile View (Contextual) */}
                  {consumeStep === 'CONSUME' && selectedItem ? (
                    <div className="bg-white rounded-[2rem] p-8 shadow-xl shadow-stone-200/20 space-y-8 text-left border border-white">
                      <div className="flex items-center gap-6">
                        <div className="w-16 h-16 bg-stone-50 border border-stone-100 rounded-2xl flex items-center justify-center shrink-0">
                          <Package className="w-8 h-8 text-stone-400" />
                        </div>                        <div>
                          <div className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-1.5">Asset Intelligence</div>
                          <h4 className="text-xl font-semibold text-stone-900 tracking-tight leading-none">{selectedItem?.name}</h4>
                        </div>
                      </div>
 
                      <div className="grid grid-cols-2 gap-y-8 gap-x-4 pt-6 border-t border-stone-100/60">
                        <div>
                          <div className="text-[9px] font-bold text-stone-400 uppercase tracking-widest mb-1.5">Specification</div>
                          <div className="text-sm font-bold text-stone-700">{selectedItem?.spec || 'Variable'}</div>
                        </div>
                        <div>
                          <div className="text-[9px] font-bold text-stone-400 uppercase tracking-widest mb-1.5">Dimension</div>
                          <div className="text-sm font-bold text-stone-700">{selectedItem?.dimension || 'N/A'}</div>
                        </div>
                        <div>
                          <div className="text-[9px] font-bold text-stone-400 uppercase tracking-widest mb-1.5">Handling Unit</div>
                          <div className="text-xs font-bold text-stone-700 uppercase tracking-widest bg-stone-100 px-3 py-1 rounded-lg w-fit">{selectedItem?.uom}</div>
                        </div>
                        <div>
                          <div className="text-[9px] font-bold text-stone-400 uppercase tracking-widest mb-1.5">Logical Branch</div>
                          <div className="text-xs font-bold text-stone-700 uppercase tracking-widest bg-stone-100 px-3 py-1 rounded-lg w-fit">{selectedItem?.type}</div>
                        </div>
                      </div>
 
                      {/* Systematic Traceability Notice */}
                      <div className="p-5 bg-emerald-50/80 rounded-3xl flex items-start gap-5">
                        <div className="w-10 h-10 bg-white rounded-2xl shadow-sm flex items-center justify-center shrink-0"><QrCode className="w-5 h-5 text-emerald-500" /></div>
                        <div className="flex-1">
                          <div className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider mb-1">Traceability Tracked</div>
                          <div className="text-xs text-emerald-600/80 font-medium leading-relaxed">Systematic lineage active. This unit is mathematically cleared for processing and strictly tied to its upstream origin.</div>
                        </div>
                      </div>
 
                    </div>
                  ) : (
                    <div className="space-y-10">
                      {/* Productivity Stats (Visual context) */}
                       <div className="grid grid-cols-2 gap-4">
                          <div className="p-6 bg-white border border-stone-100/50 rounded-3xl text-left shadow-sm hover:border-stone-200 hover:shadow-md transition-all">
                             <div className="text-[9px] font-bold text-stone-400 uppercase tracking-wider mb-2">Total Disposals</div>
                             <div className="text-xl font-semibold text-stone-900 tracking-tighter">{movements.filter(m => Number(m.qty) < 0).length}</div>
                          </div>
                          <div className="p-6 bg-white border border-stone-100/50 rounded-3xl text-left shadow-sm hover:border-stone-200 hover:shadow-md transition-all">
                             <div className="text-[9px] font-bold text-stone-400 uppercase tracking-wider mb-2">Purchasing Received</div>
                             <div className="text-xl font-semibold text-stone-900 tracking-tighter">{movements.filter(m => Number(m.qty) > 0).length}</div>
                          </div>
                       </div>

                      {/* Recent Activity Feed */}
                      <div className="space-y-6 text-left">
                        <label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider px-2 flex items-center gap-3">
                           <div className="w-1.5 h-1.5 rounded-full bg-stone-300" />
                           Realtime Feed
                        </label>
                        <div className="space-y-4">
                          {movements.slice(0, 5).map((log, i) => (
                            <div key={i} className="flex items-center gap-5 group p-3 bg-white rounded-2xl shadow-sm border border-stone-100/50 hover:border-stone-200 transition-all">
                              <div className={cn(
                                "w-12 h-12 rounded-xl flex items-center justify-center transition-all bg-stone-50 shrink-0",
                                Number(log.qty) > 0 ? "text-emerald-500" : "text-stone-400 group-hover:text-stone-900"
                              )}>
                                {Number(log.qty) > 0 ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
                              </div>
                              <div className="flex-1 pr-2 min-w-0">
                                <div className="flex justify-between items-center mb-1 gap-2">
                                  <div className="text-sm font-bold text-stone-900 tracking-tight truncate">{log.item_code || log.item_id}</div>
                                  <div className={cn("text-xs font-semibold shrink-0", Number(log.qty) > 0 ? "text-emerald-500" : "text-stone-900")}>
                                    {Number(log.qty) > 0 ? '+' : ''}{log.qty} <span className="text-[9px] uppercase tracking-widest text-stone-400 font-bold">{log.uom}</span>
                                  </div>
                                </div>
                                <div className="flex justify-between items-center text-[9px] font-bold tracking-wider uppercase text-stone-400 mt-1.5">
                                  <span className="truncate pr-2">{log.type}</span>
                                  <span className="shrink-0">{new Date(log.created_at).toLocaleTimeString([], { timeZone: 'Asia/Jakarta',  hour: '2-digit', minute: '2-digit' })}</span>
                                </div>
                              </div>
                            </div>
                          ))}
                          {movements.length === 0 && (
                             <div className="text-center py-12 border-2 border-stone-100 border-dashed rounded-3xl text-xs text-stone-400 font-medium">No logistical history found.</div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : activeTab === 'PENDING' ? (
            <div className="px-10 pb-12">
              <div className="bg-white rounded-[2rem] border border-stone-100 overflow-hidden shadow-sm">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-stone-100 bg-stone-50/30">
                      <th className="py-8 px-10 text-[9px] font-bold text-stone-400 uppercase tracking-[0.2em]">Logistics Arrival</th>
                      <th className="py-8 px-10 text-[9px] font-bold text-stone-400 uppercase tracking-[0.2em]">Origin / Document</th>
                      <th className="py-8 px-10 text-[9px] font-bold text-stone-400 uppercase tracking-[0.2em]">Authorization</th>
                      <th className="py-8 px-10 text-[9px] font-bold text-stone-400 uppercase tracking-[0.2em]">QC Gating</th>
                      <th className="py-8 px-10 text-[9px] font-bold text-stone-400 uppercase tracking-[0.2em] text-right">Protocol</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100/60 transition-all">
                    {pendingGrns.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-32 text-center text-stone-400 font-bold uppercase tracking-[0.2em]" style={{ fontSize: '10px' }}>All purchasing material logistics are currently dispositioned.</td>
                      </tr>
                    ) : pendingGrns.map((grn) => (
                      <tr key={grn.id} className="hover:bg-stone-50/50 transition-colors">
                        <td className="py-8 px-10">
                          <div className="text-sm font-bold text-stone-950 tracking-tight uppercase">{new Date(grn.received_date).toLocaleDateString('en-US', { timeZone: 'Asia/Jakarta', month: 'long', day: 'numeric' })}</div>
                        </td>
                        <td className="py-8 px-10">
                          <div className="text-sm font-bold text-stone-900 tracking-tight uppercase mb-1">{grn.po_number}</div>
                          <div className="text-[10px] uppercase font-bold tracking-[0.15em] text-stone-400 mt-1">{grn.supplier_name}</div>
                        </td>
                        <td className="py-8 px-10">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-stone-100 flex items-center justify-center text-stone-900 font-bold text-[10px] uppercase">{grn.engineering_user.charAt(0)}</div>
                            <div>
                              <div className="text-xs font-bold text-stone-800 uppercase tracking-tight leading-none">{grn.engineering_user}</div>
                              {grn.qc_user && <div className="text-[9px] text-stone-400 font-bold uppercase tracking-widest mt-1.5 opacity-60">Verified by {grn.qc_user}</div>}
                            </div>
                          </div>
                        </td>
                        <td className="py-8 px-10">
                          <span className={cn(
                            "inline-flex items-center px-3 py-1 rounded-xl text-[9px] font-bold tracking-[0.2em] border shadow-sm uppercase ring-1 ring-inset",
                            grn.qc_status === 'PASSED' ? "bg-emerald-50 text-emerald-600 ring-emerald-100" :
                            grn.qc_status === 'CONDITIONAL' ? "bg-amber-50 text-amber-600 ring-amber-100" :
                            "bg-rose-50 text-rose-600 ring-rose-100"
                          )}>
                            {grn.qc_status}
                          </span>
                        </td>
                        <td className="py-8 px-10 text-right">
                          {grn.qc_status === 'REJECTED' ? (
                            <button 
                              onClick={() => handleReturnGrn(grn.id)}
                              className="bg-rose-50 text-rose-600 ring-1 ring-rose-200 px-6 py-2.5 rounded-2xl text-[10px] font-bold uppercase tracking-[0.1em] shadow-sm hover:bg-rose-100 transition-all active:scale-95"
                            >
                              Dispatch Reject
                            </button>
                          ) : (
                            <button 
                              onClick={() => handleIntakeGrn(grn.id)}
                              className="bg-stone-800 text-white px-8 py-3 rounded-2xl text-[10px] font-bold uppercase tracking-[0.1em] shadow-xl shadow-stone-900/10 hover:bg-stone-900 transition-all hover:-translate-y-0.5 active:translate-y-0"
                            >
                              Commit Intake
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
    </div>



      {/* Item Labels Modal */}
      <Modal
        isOpen={showItemLabelsModal && intakeLabels.length > 0}
        onClose={() => setShowItemLabelsModal(false)}
        maxWidth="2xl"
        contentClassName="p-0 flex flex-col h-[80vh]"
        title={
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-stone-100 rounded-lg flex items-center justify-center">
              <Printer className="w-4 h-4 text-stone-900" />
            </div>
            <div>
              <h3 className="text-sm font-medium text-stone-900 tracking-tight">Inventory Labels</h3>
              <p className="text-[10px] text-stone-500 font-medium tracking-widest">{intakePoNumber}</p>
            </div>
          </div>
        }
      >
        <div className="flex-1 overflow-y-auto p-4 md:p-10 bg-stone-50 flex flex-col items-center">
              <div className="space-y-8 flex flex-col items-center w-full" ref={labelsRef} data-label-root>
                {intakeLabels.map((item, idx) => (
                  <div key={idx} className="bg-white p-8 border-2 border-stone-200 rounded-none flex items-center gap-10 shadow-none w-full max-w-[420px] min-h-[240px] shrink-0">
                    <div className="p-2 border border-stone-100 shrink-0 bg-white">
                      <QRCodeSVG 
                        value={JSON.stringify({
                          id: item.item_id,
                          label: item.id,
                          code: item.item_code,
                          po: intakePoNumber,
                          qty: item.qty
                        })} 
                        size={120}
                        level="H"
                        includeMargin={false}
                      />
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col justify-between h-full py-1">
                      <div className="mb-2">
                        <div className="text-[10px] font-bold text-stone-900 uppercase mb-2">Aset Inventaris <span className="font-normal text-[8px] text-stone-500">/ INVENTORY ASSET</span></div>
                        <div className="text-xl font-bold text-stone-900 leading-none mb-1 break-all">{item.item_code}</div>
                        <div className="text-[11px] font-bold text-stone-600 break-words leading-tight">{item.name}</div>
                      </div>
                      
                       <div className="space-y-1.5 pt-3 border-t-2 border-stone-900 mt-auto">
                        <div className="flex justify-between items-end">
                           <div className="space-y-0.5">
                              <div className="text-[9px] font-bold text-stone-900 uppercase tracking-widest leading-none">Ref PO <span className="font-normal text-[7px] text-stone-400">/ REF PO</span></div>
                              <div className="text-[11px] font-bold text-stone-900 break-all">{intakePoNumber}</div>
                           </div>
                           <div className="space-y-0.5 text-center">
                              <div className="text-[9px] font-bold text-stone-900 uppercase tracking-widest leading-none">ID Proyek <span className="font-normal text-[7px] text-stone-400">/ PROJECT ID</span></div>
                              <div className="text-[11px] font-bold text-stone-900 break-all">{(item.project_id && item.project_id !== 'GENERAL') ? item.project_id : 'STOCK'}</div>
                           </div>
                           <div className="text-right">
                              <div className="text-[9px] font-bold text-stone-900 uppercase tracking-widest leading-none">Jumlah <span className="font-normal text-[7px] text-stone-400">/ QTY</span></div>
                              <div className="text-sm font-bold text-stone-900 whitespace-nowrap">{item.qty} {item.uom}</div>
                           </div>
                        </div>
                        <div className="flex justify-between items-center text-[8px] font-bold text-stone-400 uppercase tracking-widest pt-1">
                          <span>{new Date().toLocaleDateString('en-US', { timeZone: 'Asia/Jakarta' })}</span>
                          <span className="font-mono">{item.id.slice(0, 8)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-6 border-t border-stone-100 bg-white flex justify-end gap-3 sticky bottom-0">
              <button 
                onClick={() => setShowItemLabelsModal(false)}
                className="px-6 py-2.5 text-stone-500 hover:text-stone-900 text-[10px] font-medium tracking-widest transition-colors uppercase font-bold"
              >
                Close
              </button>
              <button 
                onClick={() => exportLabelsPng()}
                disabled={isSubmitting}
                className="px-8 py-3 bg-stone-800 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-stone-900 transition-all active:scale-[0.98] shadow-xl shadow-stone-900/10 disabled:opacity-50 flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                {isSubmitting ? 'Capturing...' : 'Export PNG Sheet'}
              </button>
            </div>
      </Modal>

      {/* Add Item Modal */}
      <Modal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="Register New Item"
        description="Add a new SKU to the master inventory list"
        maxWidth="2xl"
        contentClassName="p-0 border-t border-stone-100"
      >
        <form onSubmit={handleAddItem} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest ml-1">Item Code</label>
                  <input 
                    required
                    value={newItem.item_code}
                    onChange={e => setNewItem({...newItem, item_code: e.target.value.toUpperCase()})}
                    className="w-full px-6 py-4 bg-stone-50 border border-stone-200/50 hover:bg-white hover:border-stone-300 rounded-2xl text-sm font-bold text-stone-900 focus:bg-white focus:border-stone-300 focus:ring-4 focus:ring-stone-100 outline-none transition-all shadow-sm"
                    placeholder="e.g. RM-001"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest ml-1">Unit (UOM)</label>
                  <input 
                    required
                    value={newItem.uom}
                    onChange={e => setNewItem({...newItem, uom: e.target.value.toUpperCase()})}
                    className="w-full px-6 py-4 bg-stone-50 border border-stone-200/50 hover:bg-white hover:border-stone-300 rounded-2xl text-sm font-bold text-stone-900 focus:bg-white focus:border-stone-300 focus:ring-4 focus:ring-stone-100 outline-none transition-all shadow-sm"
                    placeholder="e.g. PCS, KG"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest ml-1">Item Name</label>
                  <input 
                    required
                    value={newItem.name}
                    onChange={e => setNewItem({...newItem, name: e.target.value})}
                    className="w-full px-6 py-4 bg-stone-50 border border-stone-200/50 hover:bg-white hover:border-stone-300 rounded-2xl text-sm font-bold text-stone-900 focus:bg-white focus:border-stone-300 focus:ring-4 focus:ring-stone-100 outline-none transition-all shadow-sm"
                    placeholder="e.g. Mild Steel Plate"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest ml-1">Type of item</label>
                  <Select 
                    required
                    value={newItem.type}
                    onChange={e => setNewItem({...newItem, type: e.target.value})}
                    className="w-full px-6 py-4 bg-stone-50 border border-stone-200/50 hover:bg-white hover:border-stone-300 rounded-2xl text-sm font-bold text-stone-900 focus:bg-white focus:border-stone-300 focus:ring-4 focus:ring-stone-100 outline-none transition-all shadow-sm appearance-none"
                  >
                    <option value="RAW">Raw</option>
                    <option value="FINISH_GOOD">Finish Good</option>
                    <option value="CONSUMABLE">Consumable</option>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest ml-1">Dimension (Optional)</label>
                  <input 
                    value={(newItem as any).dimension || ''}
                    onChange={e => setNewItem({...newItem, dimension: e.target.value} as any)}
                    className="w-full px-6 py-4 bg-stone-50 border border-stone-200/50 hover:bg-white hover:border-stone-300 rounded-2xl text-sm font-bold text-stone-900 focus:bg-white focus:border-stone-300 focus:ring-4 focus:ring-stone-100 outline-none transition-all shadow-sm"
                    placeholder="e.g. 1200x2400mm"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest ml-1">Specification (Optional)</label>
                  <input 
                    value={(newItem as any).spec || ''}
                    onChange={e => setNewItem({...newItem, spec: e.target.value} as any)}
                    className="w-full px-6 py-4 bg-stone-50 border border-stone-200/50 hover:bg-white hover:border-stone-300 rounded-2xl text-sm font-bold text-stone-900 focus:bg-white focus:border-stone-300 focus:ring-4 focus:ring-stone-100 outline-none transition-all shadow-sm"
                    placeholder="e.g. ASTM A36"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-6">
                <button 
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-6 py-3 text-stone-400 hover:text-stone-900 hover:bg-stone-50 rounded-2xl transition-colors font-bold text-xs uppercase tracking-wider border border-transparent hover:border-stone-200"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  disabled={isSubmitting}
                  className="px-8 py-3 bg-stone-800 text-white rounded-2xl hover:bg-stone-900 transition-colors font-bold text-xs uppercase tracking-wider shadow-xl shadow-stone-900/10 active:scale-95 disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving...' : 'Register Item'}
                </button>
              </div>
            </form>
      </Modal>

      {/* Upload DN Modal - Styled consistent with PR and PO upload format */}
      <Modal
        isOpen={showUploadDnModal && !!selectedDn}
        onClose={() => setShowUploadDnModal(false)}
        title={
          <div>
            <h3 className="text-lg font-bold text-stone-900">Upload Dispatch Logistics Note</h3>
            <p className="text-[10px] text-stone-400 font-bold uppercase tracking-widest mt-0.5">Terminal OPS Dispatch Validation</p>
          </div>
        }
        maxWidth="md"
        contentClassName="p-0 border-t border-stone-100"
      >
        <form onSubmit={handleUploadDispatch} className="p-8 space-y-6">
           <div className="p-5 bg-stone-50 rounded-2xl border border-stone-100 mb-2">
              <div className="text-[10px] text-stone-400 font-bold uppercase tracking-widest mb-1.5">Dispatch Note Reference</div>
              <div className="text-base font-bold text-stone-900 font-mono">{selectedDn?.dn_number}</div>
              <div className="text-xs text-stone-500 mt-1 font-medium italic">Customer: {selectedDn?.customer_name} | {selectedDn?.project_name || 'Non-Project'}</div>
           </div>
           
           <div className="space-y-4">
              <div className="p-4 bg-emerald-50/50 border border-emerald-100 rounded-2xl flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-white border border-emerald-100 flex items-center justify-center shrink-0 shadow-sm mt-0.5">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-stone-900 mb-1">Embedded Smart e-Approval</h4>
                  <p className="text-[10px] text-stone-500 leading-relaxed mb-3">
                    Please enter your 6-digit authorization PIN to digitally sign and release this Dispatch Manifest to the Fleet. This action will embed a validation QR code to the document.
                  </p>
                  <input
                    type="password"
                    maxLength={6}
                    required
                    value={authPin}
                    onChange={(e) => setAuthPin(e.target.value.toUpperCase())}
                    placeholder="Enter 6-digit PIN"
                    className="w-full text-sm placeholder:text-stone-400 font-mono tracking-[0.5em] px-4 py-2.5 rounded-xl border-stone-200 focus:border-emerald-500 focus:ring-emerald-500 transition-shadow bg-white"
                  />
                </div>
              </div>
           </div>

           <div className="flex justify-end gap-3 pt-2">
              <Button variant="secondary" type="button" onClick={() => setShowUploadDnModal(false)}>Cancel</Button>
              <Button disabled={isUploadingDn || !authPin} type="submit">
                 {isUploadingDn ? 'Processing...' : 'Authorize & Release'}
              </Button>
           </div>
        </form>
      </Modal>

      {/* Stock Adjustment Modal */}
      <Modal
        isOpen={showAdjustModal && !!selectedItem}
        onClose={() => setShowAdjustModal(false)}
        title="Stock Adjustment"
        description={`Perform a physical stock correction for ${selectedItem?.item_code}`}
        maxWidth="2xl"
        contentClassName="p-0 border-t border-stone-100"
      >
        <form onSubmit={handleAdjustStock} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5 col-span-2">
                  <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest ml-1">Correction: Item Name</label>
                  <input 
                    value={adjustName}
                    onChange={e => setAdjustName(e.target.value)}
                    className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl text-sm font-medium text-stone-900 focus:border-stone-400 outline-none transition-all"
                    placeholder={selectedItem?.name}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest ml-1">Correction: UOM</label>
                  <input 
                    value={adjustUom}
                    onChange={e => setAdjustUom(e.target.value)}
                    className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl text-sm font-bold text-stone-900 focus:border-stone-400 outline-none transition-all"
                    placeholder={selectedItem?.uom}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest ml-1">New Physical Count</label>
                  <input 
                    required
                    type="number"
                    value={adjustQty}
                    onChange={e => setAdjustQty(e.target.value)}
                    className="w-full px-4 py-3 bg-stone-50 border border-stone-200 text-stone-900 rounded-xl text-lg font-bold outline-none focus:border-stone-400 transition-all shadow-inner"
                    placeholder="0"
                  />
                </div>
              </div>

              <div className="bg-stone-50 p-4 rounded-xl border border-stone-100 flex justify-between items-center">
                <span className="text-[10px] text-stone-400 font-bold uppercase tracking-widest">System Record</span>
                <span className="text-xs font-bold text-stone-600">{selectedItem?.free_stock} {selectedItem?.uom}</span>
              </div>

              <div className="space-y-2 pt-2">
                <label className="text-[10px] font-bold text-stone-400 uppercase tracking-wider ml-1">Adjustment Reason</label>
                <Select 
                  value={adjustReason}
                  onChange={e => setAdjustReason(e.target.value)}
                  className="w-full px-6 py-4 bg-white border border-stone-200 hover:border-stone-300 rounded-2xl text-sm font-bold text-stone-900 focus:border-stone-400 focus:ring-4 focus:ring-stone-100 outline-none transition-all appearance-none shadow-sm cursor-pointer"
                >
                  <option value="STOCK_TAKE">Periodic Stock Take</option>
                  <option value="DAMAGE">Damaged / Scrapped</option>
                  <option value="CORRECTION">Data Entry Correction</option>
                  <option value="RETURN">Customer Return</option>
                </Select>
              </div>

              <div className="flex gap-4 pt-6">
                <button 
                  type="button"
                  onClick={() => setShowAdjustModal(false)}
                  className="w-1/3 px-6 py-4 border border-transparent hover:border-stone-200 hover:bg-stone-50 text-stone-400 hover:text-stone-900 text-[10px] font-bold tracking-wider uppercase rounded-2xl transition-all"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  disabled={isSubmitting || !adjustQty}
                  className="flex-1 px-6 py-4 bg-stone-800 border border-stone-900 text-white text-xs font-bold uppercase tracking-wider rounded-2xl hover:bg-stone-900 hover:border-stone-800 transition-all active:scale-[0.98] shadow-xl shadow-stone-900/20 disabled:opacity-50"
                >
                  {isSubmitting ? 'Processing Document...' : 'Confirm Adjustment'}
                </button>
              </div>
            </form>
      </Modal>

      {/* Item QR Label Modal */}
      <Modal
        isOpen={showLabelModal && !!selectedLabelItem}
        onClose={() => setShowLabelModal(false)}
        title="QR Label Preview"
        description={`Item identification for GRN: ${selectedLabelItem?.reference_id}`}
        maxWidth="lg"
        contentClassName="p-0 border-t border-stone-100 flex flex-col h-[60vh]"
      >
        <div className="flex-1 overflow-y-auto p-4 md:p-10 bg-stone-50 flex flex-col items-center justify-center">
          <div 
            data-label-root
            className="bg-white p-8 border-2 border-stone-200 rounded-none flex items-center gap-10 shadow-none w-full max-w-[420px] min-h-[240px] shrink-0" 
            ref={labelsRef}
          >
            <div className="p-2 border border-stone-100 shrink-0 bg-white">
              <QRCodeSVG 
                value={JSON.stringify({
                  id: selectedLabelItem?.item_id,
                  code: selectedLabelItem?.item_code,
                  po: selectedLabelItem?.po_number,
                  sup: selectedLabelItem?.supplier_name
                })} 
                size={120}
                level="H"
                includeMargin={false}
              />
            </div>
            <div className="flex-1 min-w-0 flex flex-col justify-between h-full py-1">
              <div className="mb-2">
                <div className="text-[10px] font-bold text-stone-900 uppercase mb-2">Identifikasi Benda <span className="font-normal text-[8px] text-stone-400">/ Item ID</span></div>
                <div className="text-xl font-bold text-stone-900 leading-none mb-1 break-all">{selectedLabelItem?.item_code}</div>
                <div className="text-[11px] font-bold text-stone-600 break-words leading-tight">{selectedLabelItem?.item_name}</div>
              </div>
              
              <div className="space-y-1.5 pt-3 border-t-2 border-stone-900 mt-auto">
                <div className="flex justify-between items-end">
                   <div className="space-y-0.5">
                      <div className="text-[9px] font-bold text-stone-900 uppercase tracking-widest leading-none">Referensi PO <span className="font-normal text-[7px] text-stone-400">/ PO REF</span></div>
                      <div className="text-[11px] font-bold text-stone-900 break-all">{selectedLabelItem?.po_number}</div>
                   </div>
                   <div className="text-right">
                      <div className="text-[9px] font-bold text-stone-900 uppercase tracking-widest leading-none">Jml Datang <span className="font-normal text-[7px] text-stone-400">/ RECV QTY</span></div>
                      <div className="text-sm font-bold text-stone-900 whitespace-nowrap">{Math.abs(selectedLabelItem?.qty || 0)} {selectedLabelItem?.uom}</div>
                   </div>
                </div>
                <div className="text-[8px] text-stone-500 font-bold uppercase tracking-[0.1em] mt-1 break-words">
                  SPL: {selectedLabelItem?.supplier_name || 'Generic Intake'}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="p-8 border-t border-stone-100 bg-white flex justify-end gap-3 shadow-[0_-10px_40px_rgba(0,0,0,0.03)] sticky bottom-0">
          <button 
            onClick={() => setShowLabelModal(false)}
            className="px-6 py-2.5 text-stone-400 hover:text-stone-900 border border-transparent hover:border-stone-200 hover:bg-stone-50 rounded-xl font-bold text-[10px] uppercase tracking-widest transition-all"
          >
            Close
          </button>
          <button 
            onClick={() => exportSingleLabelPng()}
            disabled={isSubmitting}
            className="px-10 py-3.5 bg-stone-800 text-white rounded-2xl hover:bg-stone-900 transition-all flex items-center gap-3 font-bold text-[10px] uppercase tracking-widest shadow-xl shadow-stone-900/10 active:scale-[0.98] disabled:opacity-50"
          >
            <Download className="w-4 h-4" /> 
            {isSubmitting ? 'In Process...' : 'Export High-Res PNG'}
          </button>
        </div>
      </Modal>
      {/* ConfirmModal rendering */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        onConfirm={confirmModal.action}
        onCancel={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
      />

      {isScannerOpen && (
        <ScannerModal 
          isOpen={isScannerOpen}
          onScan={(text) => {
            handleScanSuccess(text);
          }} 
          onClose={() => setIsScannerOpen(false)} 
        />
      )}
    </div>
  );
}
