import { safeFetchJson, apiFetch } from '@/utils/api';
import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useParams, Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Calendar, CheckCircle2, FileText, Download, Clock, X, Share2, History, Info, Trash2, Package, Maximize, Minimize, Layers, AlertCircle, AlertTriangle, ArrowDownRight, ClipboardList, Archive, PackageOpen, QrCode, Lock, ShieldCheck } from 'lucide-react';
import { cn, formatIDR } from '@/lib/utils';
import { useToast } from '@/contexts/ToastContext';
import { useShare } from '@/contexts/ShareContext';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { Loader } from '@/components/shared/Loader';
import { ConfirmModal } from '@/components/shared/ConfirmModal';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { generatePDF } from '@/lib/pdfGenerator';
import { QRCodeSVG } from 'qrcode.react';
import { Action, hasGodMode, hasPermission } from '@/utils/pbac';
import { PrintTemplate } from '@/components/erp/PrintTemplate';

interface Task {
  id: string;
  task_name: string;
  start_date: string;
  end_date: string;
  actual_start_date?: string;
  actual_end_date?: string;
  progress: number;
  status: string;
  work_center_id?: string;
  required_hours?: number;
  pr_id?: string;
  po_id?: string;
}

import { PageHeader } from '@/components/shared/PageHeader';
import { AuditTimeline } from '@/components/erp/AuditTimeline';

interface Project {
  id: string;
  name: string;
  due_date: string;
  customer: string;
  remarks: string;
  status: string;
  urgency: string;
  bq_updated_at?: string;
  parent_project_id?: string;
}

interface PR {
  pr_number: string;
  status: string;
  created_at: string;
  item_count: number;
}

interface BOMItem {
  id: string;
  item_id: string;
  item_code: string;
  item_name: string;
  uom: string;
  required_qty: number;
  qty_consumed: number;
  free_stock: number;
}

interface ShortageItem extends BOMItem {
  bom_id: string;
  allocated: number;
  ordered: number;
  consumed: number;
  pr_numbers: string[];
  free_stock: number;
  shortage: number;
  can_allocate: number;
  qty_to_order?: number;
}

interface WorkOrder {
  id: string;
  wo_number: string;
  status: string;
  created_at: string;
  item_count: number;
}

const getShortCode = (rawCode: string | null): string => {
  if (!rawCode) return '';
  const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const match = rawCode.match(uuidRegex);
  if (match) {
    const fullUuid = match[0];
    const shortUuid = fullUuid.split('-')[0].toUpperCase();
    return rawCode.replace(fullUuid, shortUuid).toUpperCase();
  }
  const hexRegex = /[0-9a-f]{32}/i;
  const hexMatch = rawCode.match(hexRegex);
  if (hexMatch) {
    return rawCode.replace(hexMatch[0], hexMatch[0].substring(0, 8).toUpperCase()).toUpperCase();
  }
  if (rawCode.length > 18 && rawCode.includes('-')) {
    const parts = rawCode.split('-');
    if (parts.length > 2) {
      const prefix = parts.slice(0, 2).map(p => p.toUpperCase()).join('-');
      const value = parts[2].substring(0, 8).toUpperCase();
      return `${prefix}-${value}`;
    }
  }
  return rawCode.toUpperCase();
};

export default function ProjectDetails() {
  const { id } = useParams();
  const { showToast } = useToast();
  const { shareToForum } = useShare();
  const { user } = useAuth();
  const { language, t } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();
  const fromOverview = location.state?.from === 'overview';
  
  const [project, setProject] = useState<any | null>(null);
  const [fgs, setFgs] = useState<any[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [prs, setPrs] = useState<PR[]>([]);
  const [bom, setBom] = useState<BOMItem[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [shortageAnalysis, setShortageAnalysis] = useState<ShortageItem[]>([]);
  const [costSummary, setCostSummary] = useState({ budget: 0, actual: 0 });
  const [hasPO, setHasPO] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  
  const [isSubmitting, setIsSubmitting] = useState(false);

  const materialsToConsume = useMemo(() => {
    return shortageAnalysis.filter(item => item.allocated > item.consumed);
  }, [shortageAnalysis]);
  const [showFgDocModal, setShowFgDocModal] = useState<{ visible: boolean; itemId: string | null; fgCode: string | null }>({ visible: false, itemId: null, fgCode: null });
  const printDocRef = useRef<HTMLDivElement>(null);
  
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [showUpdateTaskModal, setShowUpdateTaskModal] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showFinishModal, setShowFinishModal] = useState(false);
  const [showShortageModal, setShowShortageModal] = useState(false);
  const [showWOModal, setShowWOModal] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [showConsumeModal, setShowConsumeModal] = useState(false);
  const [selectedBOMItem, setSelectedBOMItem] = useState<BOMItem | null>(null);
  const [consumeQty, setConsumeQty] = useState(0);
  const [templateForm, setTemplateForm] = useState({ name: '', description: '' });

  // Confirm Modal States
  const [confirmModal, setConfirmModal] = useState<{isOpen: boolean, title: string, message: string, action: () => void}>({
    isOpen: false, title: '', message: '', action: () => {}
  });

  const [taskForm, setTaskForm] = useState({
    task_name: '',
    start_date: '',
    end_date: '',
    progress: 0,
    status: 'PENDING',
    work_center_id: '',
    required_hours: 0
  });



  const exportPdf = async () => {
    if (!printDocRef.current || !project) return;
    setIsSubmitting(true);
    try {
      await generatePDF(printDocRef.current, `FG_Documentation_${project.id}.pdf`);
      showToast("PDF exported successfully", "success");
    } catch (err) {
      console.error(err);
      showToast("Failed to generate PDF", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const fetchProjectData = async () => {
    try {
      const res = await apiFetch(`/api/projects/${id}`, {}, user?.username);
      if (res.ok) {
        const data = res.data;
        setProject(data.project);
        setTasks(data.tasks || []);
        setPrs(data.prs || []);
        setBom(data.bom || []);
        setFgs(data.fgs || []);
        setHasPO(data.prs?.some((pr: any) => pr.has_po) || false);

        // Fetch Work Orders
        const woRes = await apiFetch(`/api/projects/${id}/work-orders`, {}, user?.username);
        if (woRes.ok) {
          setWorkOrders(woRes.data);
        }
      } else {
        showToast(res.error || "Failed to fetch project details", 'error');
      }
    } catch (err) {
      console.error("Failed to fetch project details", err);
      showToast("Failed to fetch project details", 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchShortageAnalysis = async () => {
    try {
      const res = await apiFetch(`/api/projects/${id}/shortage-analysis`, {}, user?.username);
      if (res.ok) {
        setShortageAnalysis(res.data.map((item: any) => ({
          ...item,
          qty_to_order: item.shortage
        })));
      } else {
        showToast(res.error || "Failed to fetch shortage analysis", 'error');
      }
    } catch (err) {
      console.error(err);
      showToast("Failed to fetch shortage analysis", 'error');
    }
  };

  const [workCenters, setWorkCenters] = useState<any[]>([]);

  const fetchWorkCenters = async () => {
    try {
      const res = await apiFetch('/api/work-centers', {}, user?.username);
      if (res.ok) {
        setWorkCenters(res.data);
      }
    } catch(err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchProjectData();
    fetchWorkCenters();
  }, [id]);

  const handleGeneratePRs = async () => {
    const itemsToPr = shortageAnalysis.filter(it => it.qty_to_order && it.qty_to_order > 0);
    if (itemsToPr.length === 0) {
      showToast('No items selected for PR generation.', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await apiFetch(`/api/projects/${id}/generate-prs`, { 
        method: 'POST',
        body: JSON.stringify({ items: itemsToPr })
      }, user?.username);
      
      const data = res.data;
      if (res.ok) {
        if (data.pr_created) {
          showToast(`Successfully generated new PR: ${data.pr_number}`, 'success');
        } else {
          showToast('No PR generated. Check quantities.', 'info');
        }
        setShowShortageModal(false);
        fetchProjectData();
      } else {
        showToast(res.error || 'Failed to generate PRs', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Failed to generate PRs', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateWorkOrder = async () => {
    const itemsToConsume = materialsToConsume
      .map(item => ({
        bom_id: item.bom_id,
        qty_to_consume: item.allocated - item.consumed
      }));

    if (itemsToConsume.length === 0) {
      showToast("No allocated stock available to consume. Please allocate or receive items first.", 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await apiFetch(`/api/projects/${id}/work-orders`, {
        method: 'POST',
        body: JSON.stringify({ items: itemsToConsume })
      }, user?.username);
      if (res.ok) {
        showToast("Work Order created successfully. You can now release it to consume materials.", 'success');
        setShowWOModal(false);
        fetchProjectData();
      } else {
        showToast(res.error || "Failed to create Work Order", 'error');
      }
    } catch (err) {
      console.error(err);
      showToast("Failed to create Work Order", 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReleaseWO = (woId: string) => {
    setConfirmModal({
      isOpen: true,
      title: "Release Work Order?",
      message: "Are you sure you want to release this Work Order? This will permanently consume materials from inventory.",
      action: async () => {
        setIsSubmitting(true);
        try {
          const res = await apiFetch(`/api/work-orders/${woId}/release`, { method: 'POST' }, user?.username);
          if (res.ok) {
            fetchProjectData();
            showToast("Work Order released successfully", 'success');
          } else {
            showToast(res.error || "Failed to release Work Order", 'error');
          }
        } catch (err) {
          console.error(err);
          showToast("Failed to release Work Order", 'error');
        } finally {
          setIsSubmitting(false);
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
        }
      }
    });
  };

  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (new Date(taskForm.start_date) > new Date(taskForm.end_date)) {
      return showToast("End date cannot be earlier than start date", "error");
    }

    try {
      const res = await apiFetch(`/api/projects/${id}/tasks`, {
        method: 'POST',
        body: JSON.stringify(taskForm)
      }, user?.username);
      if (res.ok) {
        setShowTaskModal(false);
        setTaskForm({ task_name: '', start_date: '', end_date: '', progress: 0, status: 'PENDING', work_center_id: '', required_hours: 0 });
        fetchProjectData();
        showToast("Task added successfully", 'success');
      } else {
        showToast(res.error || "Failed to add task", 'error');
      }
    } catch (err) {
      console.error(err);
      showToast("Failed to add task", 'error');
    }
  };

  const handleDeleteTask = (taskId: string) => {
    setConfirmModal({
      isOpen: true,
      title: "Delete Task?",
      message: "Are you sure you want to delete this task? This cannot be undone.",
      action: async () => {
        try {
          const res = await apiFetch(`/api/projects/${id}/tasks/${taskId}`, { method: 'DELETE' }, user?.username);
          if (res.ok) {
            fetchProjectData();
            showToast("Task deleted successfully", 'success');
          } else {
            showToast(res.error || "Failed to delete task", 'error');
          }
        } catch (err) {
          console.error(err);
          showToast("Failed to delete task", 'error');
        }
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const handleDeleteBOMItem = (bomId: string) => {
    setConfirmModal({
      isOpen: true,
      title: "Remove BOM Item?",
      message: "Are you sure you want to remove this item from the BOM? This cannot be undone.",
      action: async () => {
        try {
          const res = await apiFetch(`/api/projects/${id}/bom/${bomId}`, { method: 'DELETE' }, user?.username);
          if (res.ok) {
            fetchProjectData();
            showToast("Item deleted successfully", 'success');
          } else {
            showToast(res.error || "Failed to delete item", 'error');
          }
        } catch (err) {
          console.error(err);
          showToast("Error deleting BOM item", "error");
        }
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const handleUpdateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTask) return;

    if (selectedTask.actual_start_date && selectedTask.actual_end_date) {
      if (new Date(selectedTask.actual_start_date) > new Date(selectedTask.actual_end_date)) {
        return showToast("Actual End date cannot be earlier than start date", "error");
      }
    }

    // Smart Material Interlock Check (Bypass for Procurement Tasks)
    const isProcurementTask = selectedTask.pr_id || selectedTask.po_id || selectedTask.task_name.toLowerCase().includes('procurement');
    if (!isProcurementTask && selectedTask.progress > 0 && bom.length > 0) {
      const totalConsumed = bom.reduce((acc, match) => acc + (match.qty_consumed || 0), 0);
      if (totalConsumed <= 0) {
        return showToast("Cannot start task. Warehouse has not issued any materials for this project.", "error");
      }
    }

    try {
      const res = await apiFetch(`/api/tasks/${selectedTask.id}`, {
        method: 'POST',
        body: JSON.stringify({
          progress: selectedTask.progress,
          status: selectedTask.progress === 100 ? 'COMPLETED' : selectedTask.progress === 0 ? 'PENDING' : 'IN_PROGRESS',
          actual_start_date: selectedTask.actual_start_date,
          actual_end_date: selectedTask.actual_end_date,
          work_center_id: selectedTask.work_center_id,
          required_hours: selectedTask.required_hours
        })
      }, user?.username);
      if (res.ok) {
        setShowUpdateTaskModal(false);
        setSelectedTask(null);
        fetchProjectData();
        showToast("Task updated successfully", 'success');
      } else {
        showToast(res.error || "Failed to update task", 'error');
      }
    } catch (err) {
      console.error(err);
      showToast("Failed to update task", 'error');
    }
  };

  const calculateDuration = (start: string, end: string) => {
    const s = new Date(start);
    const e = new Date(end);
    const diffTime = Math.abs(e.getTime() - s.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // inclusive
  };

  const handleConsume = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBOMItem || consumeQty <= 0) return;

    setIsSubmitting(true);
    try {
      const res = await apiFetch('/api/production/consume', {
        method: 'POST',
        body: JSON.stringify({
          bom_id: selectedBOMItem.id,
          qty: consumeQty,
          project_id: id,
          item_id: selectedBOMItem.item_id
        })
      }, user?.username);

      if (res.ok) {
        showToast(`Consumed ${consumeQty} ${selectedBOMItem.uom} of ${selectedBOMItem.item_code}`, 'success');
        setShowConsumeModal(false);
        setConsumeQty(0);
        setSelectedBOMItem(null);
        fetchProjectData(); // Refresh data
      } else {
        showToast(res.error || "Failed to record consumption", 'error');
      }
    } catch (err) {
      console.error(err);
      showToast("Error recording consumption", 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFinishProject = async () => {
    setIsSubmitting(true);
    try {
      const res = await apiFetch(`/api/projects/${id}/finish`, { method: 'POST' }, user?.username);
      if (res.ok) {
        setShowFinishModal(false);
        fetchProjectData();
        showToast("Project finished successfully.", 'success');
      } else {
        showToast(res.error || "Failed to finish project", 'error');
      }
    } catch (err) {
      console.error(err);
      showToast("Failed to finish project", 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);

  const handleArchiveProject = async () => {
    try {
      const res = await apiFetch(`/api/projects/${id}/archive`, { method: 'POST' }, user?.username);
      if (res.ok) {
        showToast("Project archived successfully.", 'success');
        navigate('/'); // Go back to dashboard as it's archived
      } else {
        showToast(res.error || "Failed to archive project", 'error');
      }
    } catch (err) {
      console.error(err);
      showToast("Failed to archive project", 'error');
    }
  };

  if (isLoading) return <Loader text="Loading project details..." />;
  if (!project) return <div className="p-10 text-red-500">Project not found.</div>;

  return (
    <div className="space-y-12 pb-20 animate-in fade-in duration-500">
      <Link to="/erp" className="text-[10px] text-stone-500 hover:text-stone-900 flex items-center gap-2 mb-2 transition-all font-bold uppercase tracking-widest w-fit px-3 py-1 rounded-full border border-stone-200">
        <ArrowLeft className="w-3 h-3" /> Back to Dashboard
      </Link>
      
      <PageHeader
        title={project.name}
        subtitle={project.id}
        icon={<Layers className="w-6 h-6" />}
        actions={
          <>
            {(hasGodMode(user) || hasPermission(user, Action.VIEW_PRODUCTION_ACTION)) && !fromOverview && (
              <>
                <Button 
                  size="sm"
                  variant="secondary"
                  onClick={() => shareToForum('PROJECT', project.id, `Project Update: ${project.name}`, `Latest update for project ${project.name}. Status: ${project.status}. Due Date: ${project.due_date}`)}
                >
                  <Share2 className="w-3.5 h-3.5" /> Share
                </Button>
                {project.status !== 'FINISHED' && (
                  <Button 
                    size="sm"
                    variant="success_soft"
                    onClick={() => setShowFinishModal(true)}
                    disabled={isSubmitting}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" /> Finish
                  </Button>
                )}
                {project.status === 'FINISHED' && (
                  <Button 
                    size="sm"
                    variant="danger_soft"
                    onClick={() => setShowArchiveConfirm(true)}
                    disabled={isSubmitting}
                  >
                    <Archive className="w-3.5 h-3.5" /> Archive
                  </Button>
                )}
                {project.status === 'FINISHED' && project.id !== 'GENERAL' && (hasGodMode(user) || hasPermission(user, Action.WAREHOUSE_ACTION) || hasPermission(user, Action.VIEW_PRODUCTION_ACTION)) && (
                  fgs && fgs.length > 0 ? (
                    <Button 
                      size="sm"
                      variant="secondary"
                      onClick={() => setShowFgDocModal({ visible: true, itemId: fgs[0].id, fgCode: fgs[0].item_code })}
                    >
                      <PackageOpen className="w-3.5 h-3.5" /> View FGR
                    </Button>
                  ) : (
                    <Button 
                      size="sm"
                      variant="secondary"
                      onClick={async () => {
                         setIsSubmitting(true);
                         try {
                           const res = await apiFetch(`/api/projects/${project.id}/create-fg-sku`, { method: 'POST'}, user?.username);
                           if (res.ok) {
                               showToast("Converted to FG SKU. Document active.", "success");
                               setShowFgDocModal({ visible: true, itemId: res.data?.item_id || `ITM-FG-${project.id}`, fgCode: `FG-${project.id}` });
                               fetchProjectData();
                           } else {
                               showToast(res.error || "Failed", "error");
                           }
                         } catch (e) {
                           showToast("Network error", "error");
                         } finally {
                           setIsSubmitting(false);
                         }
                      }}
                      disabled={isSubmitting}
                    >
                      <PackageOpen className="w-3.5 h-3.5" /> To Finish Good
                    </Button>
                  )
                )}
                <Button 
                  size="sm"
                  action="create"
                  onClick={() => setShowTaskModal(true)}
                >
                  Add Task
                </Button>
              </>
            )}
          </>
        }
      />
      
      {/* Project Meta Info row */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-xl border border-stone-100 bg-stone-50/50">
        <div className="flex flex-wrap items-center gap-6 text-sm text-stone-500 font-medium">
          <div className="flex items-center gap-2"><Calendar className="w-4 h-4 text-stone-400" /> <span className="text-stone-400 uppercase text-[10px] font-bold">Due</span> {project.due_date}</div>
          <div className="flex items-center gap-2"><Package className="w-4 h-4 text-stone-400" /> <span className="text-stone-400 uppercase text-[10px] font-bold">Client</span> {project.customer || '-'}</div>
          {project.urgency && project.urgency !== 'NORMAL' && (
            <div className={cn(
              "flex items-center gap-2 font-bold text-[10px] uppercase px-3 py-1 rounded-full tracking-widest",
              project.urgency === 'CRITICAL' ? "bg-rose-600 text-white shadow-lg shadow-rose-200" : "bg-orange-500 text-white shadow-lg shadow-orange-100"
            )}>
              <Info className="w-3.5 h-3.5" /> {project.urgency} Project
            </div>
          )}
          {hasPO ? (
            <div className="flex items-center gap-2 text-emerald-600 font-bold text-[10px] uppercase bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100 tracking-widest">
              <CheckCircle2 className="w-3.5 h-3.5" /> PO Issued
            </div>
          ) : (
            <div className="flex items-center gap-2 text-amber-600 font-bold text-[10px] uppercase bg-amber-50 px-2 py-0.5 rounded border border-amber-100 tracking-widest">
              <Clock className="w-3.5 h-3.5" /> Awaiting PO
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-4">
          {project.bq_updated_at && (
            <div className="flex items-center gap-2 text-[10px] text-stone-400 font-bold uppercase tracking-tight">
              <Clock className="w-3.5 h-3.5" /> 
              BOM Sync: {new Date(project.bq_updated_at).toLocaleString('en-US', { timeZone: 'Asia/Jakarta' })}
            </div>
          )}
          {project.parent_project_id && (
            <Link to={`/project/${project.parent_project_id}`} className="flex items-center gap-1.5 text-[10px] text-stone-900 font-bold uppercase tracking-tight hover:text-stone-600 transition-colors bg-stone-100 px-2 py-0.5 rounded">
              <History className="w-3.5 h-3.5" /> 
              Repeat of: {project.parent_project_id}
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Column: Project Tasks List instead of Gantt Chart */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-xs text-stone-500 tracking-wider flex items-center gap-2 font-semibold uppercase">
              <span className="w-2 h-2 bg-stone-800 rounded-full"></span>
              PROJECT TASKS
            </div>
            {tasks.length > 0 && (
              <span className="text-[10px] font-mono font-bold bg-stone-100 text-stone-600 px-2.5 py-1 rounded-full border border-stone-200/50">
                {tasks.filter(t => t.status === 'COMPLETED').length} / {tasks.length} COMPLETED
              </span>
            )}
          </div>
          
          <div className="bg-white border border-stone-200 rounded-2xl shadow-sm overflow-hidden">
            {tasks.length === 0 ? (
              <div className="text-center py-20 text-stone-500 text-sm flex-1 flex flex-col items-center justify-center">
                <Calendar className="w-8 h-8 text-stone-400 mb-3" />
                No tasks defined yet. Click "Add Task" to start building the timeline.
              </div>
            ) : (
              <div className="divide-y divide-stone-150">
                {tasks.filter(t => !!t).map(task => {
                  const wc = workCenters.find(w => w.id === task.work_center_id);
                  const isDelayed = task.status !== 'COMPLETED' && task.status !== 'CANCELLED' && new Date(task.end_date) < new Date();
                  const materialAlert = shortageAnalysis.some(it => it.shortage > 0);

                  return (
                    <div 
                      key={task.id} 
                      className={cn(
                        "p-5 hover:bg-stone-50/50 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4 group",
                        selectedTask?.id === task.id && "bg-stone-50/50",
                        task.status === 'CANCELLED' && "opacity-60 grayscale"
                      )}
                    >
                      {/* Left side: Status badge & Name & Details */}
                      <div className="flex-1 min-w-0 flex items-start gap-4">
                        <div className="pt-0.5">
                          {task.status === 'COMPLETED' ? (
                            <span className="w-6 h-6 rounded-full bg-emerald-100 border border-emerald-200 flex items-center justify-center text-emerald-700 shrink-0">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            </span>
                          ) : task.status === 'IN_PROGRESS' ? (
                            <span className="w-6 h-6 rounded-full bg-amber-100 border border-amber-200 flex items-center justify-center text-amber-700 shrink-0 relative">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping absolute" />
                              <Clock className="w-3.5 h-3.5" />
                            </span>
                          ) : task.status === 'REJECTED' ? (
                            <span className="w-6 h-6 rounded-full bg-rose-100 border border-rose-200 flex items-center justify-center text-rose-700 shrink-0">
                              <AlertTriangle className="w-3.5 h-3.5" />
                            </span>
                          ) : task.status === 'CANCELLED' ? (
                            <span className="w-6 h-6 rounded-full bg-stone-100 border border-stone-200 flex items-center justify-center text-stone-400 shrink-0">
                              <X className="w-3.5 h-3.5" />
                            </span>
                          ) : (
                            <span className="w-6 h-6 rounded-full bg-stone-100 border border-stone-200 flex items-center justify-center text-stone-500 shrink-0">
                              <div className="w-1.5 h-1.5 rounded-full bg-stone-400" />
                            </span>
                          )}
                        </div>

                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 
                              onClick={() => {
                                setSelectedTask(task);
                                setShowUpdateTaskModal(true);
                              }}
                              className={cn(
                                "text-sm font-bold text-stone-900 uppercase tracking-tight hover:underline cursor-pointer",
                                task.status === 'CANCELLED' && "line-through text-stone-400"
                              )}
                            >
                              {task.task_name}
                            </h4>
                            
                            {wc && (
                              <span className="text-[9px] text-stone-500 font-extrabold bg-stone-100 border border-stone-200/50 px-2 py-0.5 rounded-md uppercase tracking-wider">
                                {wc.name}
                              </span>
                            )}

                            {materialAlert && task.status === 'PENDING' && (
                              <span className="inline-flex items-center gap-1 text-[8px] font-bold text-red-650 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded uppercase tracking-wider animate-pulse">
                                <AlertCircle className="w-2.5 h-2.5" /> Shortage
                              </span>
                            )}

                            {task.status === 'REJECTED' && (
                              <span className="inline-flex items-center gap-1 text-[8px] font-bold text-rose-650 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded uppercase tracking-wider animate-pulse">
                                <AlertTriangle className="w-2.5 h-2.5" /> QC Failed
                              </span>
                            )}

                            {isDelayed && (
                              <span className="inline-flex items-center gap-1 text-[8px] font-bold text-rose-650 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded uppercase tracking-wider">
                                OVERDUE
                              </span>
                            )}
                          </div>
                          
                          <div className="flex flex-wrap items-center gap-y-1 gap-x-4 text-[10px] text-stone-400 font-semibold uppercase tracking-wider">
                            <div className="flex items-center gap-1.5">
                              <Calendar className="w-3 h-3 text-stone-300" />
                              <span>{task.start_date}</span>
                              <span className="text-stone-300">to</span>
                              <span>{task.end_date}</span>
                            </div>
                            {task.required_hours && (
                              <div className="flex items-center gap-1">
                                <Clock className="w-3 h-3 text-stone-300" />
                                <span>{task.required_hours} Hours</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Right side: Progress visualizer & actions */}
                      <div className="flex items-center justify-between sm:justify-end gap-6 shrink-0 border-t sm:border-t-0 border-stone-100 pt-3 sm:pt-0 w-full sm:w-auto overflow-hidden">
                        <div className="w-40 space-y-1.5">
                          <div className="flex justify-between items-center text-[10px] font-extrabold uppercase tracking-widest">
                            <span className="text-stone-400">Progress</span>
                            <span className="text-stone-850">{task.progress}%</span>
                          </div>
                          <div className="h-2 w-full bg-stone-100 rounded-full overflow-hidden border border-stone-200/20">
                            <div 
                              className={cn(
                                "h-full transition-all duration-500",
                                task.status === 'COMPLETED' ? "bg-emerald-500" :
                                task.status === 'IN_PROGRESS' ? "bg-amber-500" :
                                task.status === 'REJECTED' ? "bg-rose-500 animate-pulse" :
                                task.status === 'CANCELLED' ? "bg-stone-300" : "bg-stone-400"
                              )}
                              style={{ width: `${task.progress}%` }}
                            />
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <Button 
                            size="xs"
                            variant="secondary"
                            onClick={() => {
                              setSelectedTask(task);
                              setShowUpdateTaskModal(true);
                            }}
                          >
                            Edit
                          </Button>
                          <Button 
                            size="icon"
                            variant="danger_soft"
                            onClick={(e) => { e.stopPropagation(); handleDeleteTask(task.id); }}
                            title="Delete Task"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: PRs & Info */}
        <div className="space-y-8">
          <div className="space-y-4">
            <div className="text-xs text-stone-500 tracking-wider flex items-center gap-2 font-medium">
              <span className="w-2 h-2 bg-amber-500 rounded-full"></span>
              MATERIAL PROGRESS
            </div>
            <div className="bg-white border border-stone-200">
              {bom.length === 0 ? (
                <div className="p-6 text-center text-sm text-stone-500">No BOM defined for this project.</div>
              ) : (
                <div className="divide-y divide-stone-100">
                  {bom.map(item => {
                    const progress = (item.qty_consumed / item.required_qty) * 100;
                    return (
                      <div key={item.id} className="p-4 group">
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-stone-100 flex items-center justify-center shrink-0">
                              <Package className="w-4 h-4 text-stone-400" />
                            </div>
                            <div>
                              <div className="text-sm font-medium text-stone-900">{item.item_code}</div>
                              <div className="text-[10px] text-stone-400">{item.item_name}</div>
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <div className="text-[10px] font-bold text-stone-600">
                              {item.qty_consumed} / {item.required_qty} {item.uom}
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              {item.qty_consumed < item.required_qty && hasPermission(user, Action.CONSUME_MATERIAL) && (
                                <Button
                                  size="xs"
                                  variant="success_soft"
                                  onClick={() => {
                                    setSelectedBOMItem(item);
                                    setConsumeQty(Math.min(item.required_qty - item.qty_consumed, item.free_stock));
                                    setShowConsumeModal(true);
                                  }}
                                >
                                  Consume
                                </Button>
                              )}
                              <Button 
                                size="icon"
                                variant="danger_soft"
                                onClick={() => handleDeleteBOMItem(item.id)}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-widest leading-none">
                            <span className="text-stone-400">Available Stock: {item.free_stock || 0}</span>
                            <span className={cn(
                              "flex items-center gap-1.5",
                              (item.free_stock || 0) < (item.required_qty - item.qty_consumed) ? "text-amber-500" : "text-emerald-500"
                            )}>
                              {(item.free_stock || 0) < (item.required_qty - item.qty_consumed) ? (
                                <><AlertTriangle className="w-3 h-3" /> Shortage Detected</>
                              ) : (
                                <><CheckCircle2 className="w-3 h-3" /> In Stock</>
                              )}
                            </span>
                          </div>
                          <div className="h-1.5 w-full bg-stone-100 rounded-full overflow-hidden">
                            <div 
                              className={cn(
                                "h-full transition-all duration-500",
                                progress >= 100 ? "bg-emerald-500" : "bg-amber-500"
                              )}
                              style={{ width: `${Math.min(100, progress)}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <div className="text-xs text-stone-500 tracking-wider flex items-center gap-2 font-medium">
                <span className="w-2 h-2 bg-emerald-500 rounded-full"></span>
                PURCHASE REQUESTS
              </div>
            </div>
            <div className="bg-white border border-stone-200">
              {prs.length === 0 ? (
                <div className="p-6 text-center text-sm text-stone-500">No PRs generated yet.</div>
              ) : (
                <div className="divide-y divide-stone-100">
                  {prs.map(pr => (
                    <div key={pr.pr_number} className="p-4 hover:bg-stone-50 transition-colors">
                      <div className="flex justify-between items-start mb-1">
                        <div className="text-sm font-medium text-stone-900">{pr.pr_number}</div>
                        <div className={cn(
                          "text-[9px] uppercase font-bold tracking-wider px-2 py-0.5 rounded border shadow-sm transition-all flex items-center gap-1",
                          pr.status === 'RECEIVED' ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                          pr.status === 'PARTIAL' ? "bg-amber-50 text-amber-700 border-amber-200 animate-pulse" :
                          pr.status === 'REJECTED' ? "bg-rose-50 text-rose-700 border-rose-200 animate-pulse" :
                          pr.status === 'CANCELLED' ? "bg-stone-50 text-stone-400 border-stone-200 line-through" :
                          pr.status === 'DRAFTED' ? "bg-stone-100 text-stone-600 border-stone-200" :
                          pr.status === 'AUTHORIZED' ? "bg-blue-50 text-blue-700 border-blue-200" :
                          pr.status === 'PARTIAL_ORDERED' ? "bg-cyan-50 text-cyan-700 border-cyan-200" :
                          pr.status === 'ORDERED' ? "bg-stone-100 text-stone-900 border-stone-300" : "bg-stone-100 text-stone-600 border-stone-200"
                        )}>
                          {pr.status === 'REJECTED' && <AlertTriangle className="w-2.5 h-2.5 text-rose-500" />}
                          {pr.status}
                        </div>
                      </div>
                      <div className="text-xs text-stone-500 flex justify-between items-center">
                        <span>{pr.item_count} Items</span>
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => shareToForum('PR', pr.pr_number, `Purchase Request: ${pr.pr_number}`, `PR ${pr.pr_number} for project ${project.name} has been created. Status: ${pr.status}`)}
                            className="text-[10px] font-bold text-stone-400 hover:text-blue-600 uppercase tracking-wider flex items-center gap-1"
                          >
                            <Share2 className="w-3 h-3" /> Share
                          </button>
                          <span>{new Date(pr.created_at).toLocaleDateString('en-US', { timeZone: 'Asia/Jakarta' })}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div className="text-xs text-stone-500 tracking-wider flex items-center gap-2 font-medium">
              <span className="w-2 h-2 bg-stone-300 rounded-full"></span>
              PROJECT DETAILS
            </div>
            <div className="bg-white border border-stone-200 p-5 text-sm space-y-3">
              <div>
                <span className="text-stone-500 block text-xs mb-0.5">Remarks</span>
                <p className="text-stone-900">{project.remarks || 'No remarks provided.'}</p>
              </div>
              <div className="pt-3 border-t border-stone-100">
                <span className="text-stone-500 block text-xs mb-0.5">Status</span>
                <p className="text-stone-900 font-medium">{project.status}</p>
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* Audit Timeline Section */}
      <div className="mt-8 border-t border-stone-200 pt-8">
        <AuditTimeline resourceType="PROJECT" resourceId={id} />
      </div>

      {/* Logistics & Outbound Commercial tracking */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 border-t border-stone-200 pt-8 mt-8">
        <div className="space-y-4">
           <div className="text-xs text-stone-500 tracking-wider flex items-center gap-2 font-medium">
              <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
              LOGISTICS / DELIVERIES
           </div>
           <div className="bg-white border border-stone-200 shadow-sm rounded-xl overflow-hidden p-1">
              {!project.deliveries || project.deliveries.length === 0 ? (
                 <div className="p-8 text-center text-sm font-medium text-stone-400">No delivery manifests generated yet.</div>
              ) : (
                 <div className="divide-y divide-stone-100">
                    {project.deliveries.map((dn: any) => (
                       <div key={dn.id} className="p-4 flex items-center justify-between hover:bg-stone-50 transition-colors">
                          <div>
                             <div className="text-xs font-bold font-mono text-stone-900">{dn.dn_number}</div>
                             <div className="text-[10px] font-bold uppercase tracking-widest text-stone-500 mt-1">{new Date(dn.created_at).toLocaleDateString('en-US', {timeZone: 'Asia/Jakarta'})}</div>
                          </div>
                          <div>
                             <span className={cn("px-2 py-1 text-[9px] font-bold uppercase tracking-widest rounded-md border",
                               dn.status === 'DRAFT' ? "bg-stone-100 border-stone-200 text-stone-600" :
                               dn.status === 'DELIVERED' ? "bg-emerald-50 border-emerald-200 text-emerald-700" :
                               "bg-amber-50 border-amber-200 text-amber-700"
                             )}>{dn.status.replace('_', ' ')}</span>
                          </div>
                       </div>
                    ))}
                 </div>
              )}
           </div>
        </div>

        <div className="space-y-4">
           <div className="text-xs text-stone-500 tracking-wider flex items-center gap-2 font-medium">
              <span className="w-2 h-2 bg-emerald-500 rounded-full"></span>
              COMMERCIAL INVOICES
           </div>
           <div className="bg-white border border-stone-200 shadow-sm rounded-xl overflow-hidden p-1">
              {!project.invoices || project.invoices.length === 0 ? (
                 <div className="p-8 text-center text-sm font-medium text-stone-400">No issued commercial invoices.</div>
              ) : (
                 <div className="divide-y divide-stone-100">
                    {project.invoices.map((inv: any) => (
                       <div key={inv.id} className="p-4 flex items-center justify-between hover:bg-stone-50 transition-colors">
                          <div>
                             <div className="text-xs font-bold font-mono text-stone-900">{inv.ci_number}</div>
                             <div className="text-[10px] font-bold uppercase tracking-widest text-stone-500 mt-1">{new Date(inv.created_at).toLocaleDateString('en-US', {timeZone: 'Asia/Jakarta'})}</div>
                          </div>
                          <div className="text-right">
                             <div className="text-sm font-bold font-mono text-stone-900">{formatIDR(inv.amount)}</div>
                             <span className={cn("inline-block mt-1 px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest rounded border",
                               inv.status === 'PAID' ? "bg-emerald-50 border-emerald-200 text-emerald-700" :
                               "bg-rose-50 border-rose-200 text-rose-700"
                             )}>{inv.status}</span>
                          </div>
                       </div>
                    ))}
                 </div>
              )}
           </div>
        </div>
      </div>

      {/* Modals go here */}

      {/* Shortage Analysis Modal */}
      <Modal
        isOpen={showShortageModal}
        onClose={() => setShowShortageModal(false)}
        maxWidth="4xl"
        contentClassName="p-0 flex flex-col"
        title={
          <div>
            <h3 className="text-xl font-bold tracking-tight text-stone-900">BOM Shortage Analysis & PR Generation</h3>
            <p className="text-xs font-semibold text-stone-500 mt-1 uppercase tracking-wider">Exploding BOM to identify procurement needs</p>
          </div>
        }
      >
        <div className="flex-1 overflow-auto p-6 md:p-8">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-stone-200">
                <th className="py-3 text-[10px] font-bold text-stone-400 uppercase tracking-widest flex items-center gap-2">
                  <Package className="w-3 h-3" /> Item
                </th>
                <th className="py-3 text-[10px] font-bold text-stone-400 uppercase tracking-widest text-center">
                  <span className="flex items-center justify-center gap-2">
                    <ArrowDownRight className="w-3 h-3" /> Required
                  </span>
                </th>
                <th className="py-3 text-[10px] font-bold text-stone-400 uppercase tracking-widest text-center">
                   <span className="flex items-center justify-center gap-2">
                    <ClipboardList className="w-3 h-3" /> Allocated
                  </span>
                </th>
                <th className="py-3 text-[10px] font-bold text-stone-400 uppercase tracking-widest text-center">
                  <span className="flex items-center justify-center gap-2">
                    <Clock className="w-3 h-3" /> On Order
                  </span>
                </th>
                <th className="py-3 text-[10px] font-bold text-stone-400 uppercase tracking-widest text-center">
                   <span className="flex items-center justify-center gap-2">
                    <AlertTriangle className="w-3 h-3" /> Shortage
                  </span>
                </th>
                <th className="py-3 text-[10px] font-bold text-stone-400 uppercase tracking-widest text-center">
                  <span className="flex items-center justify-center gap-2">
                    <Archive className="w-3 h-3" /> Stock
                  </span>
                </th>
                <th className="py-3 text-[10px] font-bold text-stone-900 uppercase tracking-widest text-center bg-stone-100/50">
                   <span className="flex items-center justify-center gap-2">
                    <Plus className="w-3 h-3" /> Qty to Order
                  </span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {shortageAnalysis.map((item, idx) => (
                <tr key={item.bom_id} className="text-sm">
                  <td className="py-4">
                    <div className="font-medium text-stone-900">{item.item_code}</div>
                    <div className="text-[10px] text-stone-400">{item.item_name}</div>
                  </td>
                  <td className="py-4 text-center font-medium">{item.required_qty} {item.uom}</td>
                  <td className="py-4 text-center text-stone-900 font-medium">{item.allocated}</td>
                  <td className="py-4 text-center text-stone-500">
                    {item.ordered}
                    {item.pr_numbers && item.pr_numbers.length > 0 && (
                      <div className="text-[9px] text-stone-900 mt-1 font-medium">
                        {item.pr_numbers.join(', ')}
                      </div>
                    )}
                  </td>
                  <td className="py-4 text-center">
                    <span className={cn(
                      "font-bold",
                      item.shortage > 0 ? "text-red-600" : "text-emerald-600"
                    )}>
                      {item.shortage}
                    </span>
                  </td>
                  <td className="py-4 text-center">
                    <div className="text-xs font-medium text-stone-900">{item.free_stock}</div>
                  </td>
                  <td className="py-4 text-center bg-stone-50/50">
                    <input 
                      type="number"
                      value={item.qty_to_order}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        const newAnalysis = [...shortageAnalysis];
                        newAnalysis[idx] = { ...item, qty_to_order: val };
                        setShortageAnalysis(newAnalysis);
                      }}
                      className="w-20 text-center border border-stone-200 rounded px-2 py-1 text-sm outline-none focus:border-stone-400 font-bold text-stone-900"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="p-6 md:p-8 bg-stone-50 border-t border-stone-100 flex justify-between items-center">
          <div className="text-xs text-stone-500">
            <span className="font-bold text-stone-900">Note:</span> PR will be generated for the total shortage after auto-allocating available free stock.
          </div>
          <div className="flex gap-3">
            <Button 
              variant="secondary"
              onClick={() => setShowShortageModal(false)}
            >
              Cancel
            </Button>
            <Button 
              onClick={handleGeneratePRs}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Processing...' : 'Generate PRs'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Work Order Modal */}
      <Modal
        isOpen={showWOModal}
        onClose={() => setShowWOModal(false)}
        maxWidth="2xl"
        title={
          <div>
            <h3 className="text-xl font-bold tracking-tight text-stone-900">Create Work Order</h3>
            <p className="text-xs font-semibold text-stone-500 mt-1 uppercase tracking-wider">Requesting material release for production</p>
          </div>
        }
      >
        <div className="bg-amber-50 border border-amber-100 p-4 rounded-xl mb-6 flex items-start gap-3">
          <Clock className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800 leading-relaxed font-medium">
            This will create a Work Order for all <span className="font-bold">allocated but unconsumed</span> materials. Releasing the Work Order will deduct stock and update project progress.
          </p>
        </div>

        <div className="space-y-4 max-h-[40vh] overflow-auto pr-2 custom-scrollbar">
          {materialsToConsume.map(item => (
            <div key={item.bom_id} className="flex items-center justify-between p-4 border border-stone-100 rounded-xl bg-stone-50/50">
              <div>
                <div className="text-sm font-bold text-stone-900">{item.item_code}</div>
                <div className="text-[10px] uppercase tracking-wider font-bold text-stone-400 mt-1">{item.item_name}</div>
              </div>
              <div className="text-right">
                <div className="text-sm font-bold text-stone-900">{item.allocated - item.consumed} {item.uom}</div>
                <div className="text-[10px] text-stone-400 uppercase tracking-widest font-bold mt-1">To Release</div>
              </div>
            </div>
          ))}
          {materialsToConsume.length === 0 && (
            <div className="text-center py-10 text-stone-400 text-sm font-medium italic border border-dashed rounded-xl border-stone-200">
              No materials are currently allocated for this project.
            </div>
          )}
        </div>

        <div className="mt-8 flex justify-end gap-3">
          <Button 
            variant="secondary"
            onClick={() => setShowWOModal(false)}
          >
            Cancel
          </Button>
          <Button 
            onClick={handleCreateWorkOrder}
            disabled={isSubmitting || materialsToConsume.length === 0}
          >
            {isSubmitting ? 'Creating...' : 'Create Work Order'}
          </Button>
        </div>
      </Modal>

      {/* Update Task Modal */}
      <Modal
        isOpen={showUpdateTaskModal && selectedTask !== null}
        onClose={() => {
          setShowUpdateTaskModal(false);
          setSelectedTask(null);
        }}
        maxWidth="2xl"
        title="Update Task Progress"
      >
        {selectedTask && (
          <form onSubmit={handleUpdateTask} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-stone-400 uppercase tracking-widest mb-1.5 ml-1">Task Name</label>
              <div className="text-sm font-bold text-stone-900 border border-stone-100 bg-stone-50 rounded-2xl px-6 py-4">{selectedTask.task_name}</div>
            </div>
            
            <div>
              <label className="block text-xs font-bold text-stone-400 uppercase tracking-widest mb-2 ml-1">Progress (%)</label>
              <input 
                type="number" 
                min="0" max="100"
                value={selectedTask.progress}
                onChange={e => setSelectedTask({...selectedTask, progress: Number(e.target.value)})}
                className="w-full px-6 py-4 bg-stone-50 border border-stone-200/50 hover:bg-white hover:border-stone-300 rounded-2xl text-sm font-bold text-stone-900 focus:bg-white focus:border-stone-300 focus:ring-4 focus:ring-stone-100 outline-none transition-all shadow-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-stone-400 uppercase tracking-widest mb-2 ml-1">Actual Start Date</label>
                <input 
                  type="date" 
                  value={selectedTask.actual_start_date ? selectedTask.actual_start_date.split('T')[0] : ''}
                  onChange={e => setSelectedTask({...selectedTask, actual_start_date: e.target.value ? new Date(e.target.value).toISOString() : undefined})}
                  className="w-full px-6 py-4 bg-stone-50 border border-stone-200/50 hover:bg-white hover:border-stone-300 rounded-2xl text-sm font-bold text-stone-900 focus:bg-white focus:border-stone-300 focus:ring-4 focus:ring-stone-100 outline-none transition-all shadow-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-stone-400 uppercase tracking-widest mb-2 ml-1">Actual End Date</label>
                <input 
                  type="date" 
                  value={selectedTask.actual_end_date ? selectedTask.actual_end_date.split('T')[0] : ''}
                  onChange={e => setSelectedTask({...selectedTask, actual_end_date: e.target.value ? new Date(e.target.value).toISOString() : undefined})}
                  className="w-full px-6 py-4 bg-stone-50 border border-stone-200/50 hover:bg-white hover:border-stone-300 rounded-2xl text-sm font-bold text-stone-900 focus:bg-white focus:border-stone-300 focus:ring-4 focus:ring-stone-100 outline-none transition-all shadow-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-stone-400 uppercase tracking-widest mb-2 ml-1">Work Center</label>
                <Select
                  value={selectedTask.work_center_id || ''}
                  onChange={e => setSelectedTask({...selectedTask, work_center_id: e.target.value})}
                  className="w-full px-6 py-4 bg-stone-50 border border-stone-200/50 hover:bg-white hover:border-stone-300 rounded-2xl text-sm font-bold text-stone-900 focus:bg-white focus:border-stone-300 focus:ring-4 focus:ring-stone-100 outline-none transition-all shadow-sm appearance-none cursor-pointer"
                >
                  <option value="">No Work Center</option>
                  {workCenters.map(wc => (
                    <option key={wc.id} value={wc.id}>{wc.name}</option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="block text-xs font-bold text-stone-400 uppercase tracking-widest mb-2 ml-1">Required Hours</label>
                <input 
                  type="number" 
                  min="0"
                  value={selectedTask.required_hours || 0}
                  onChange={e => setSelectedTask({...selectedTask, required_hours: Number(e.target.value)})}
                  className="w-full px-6 py-4 bg-stone-50 border border-stone-200/50 hover:bg-white hover:border-stone-300 rounded-2xl text-sm font-bold text-stone-900 focus:bg-white focus:border-stone-300 focus:ring-4 focus:ring-stone-100 outline-none transition-all shadow-sm"
                />
              </div>
            </div>

            <div className="pt-6 flex justify-end gap-3">
              <button 
                type="button"
                className="px-6 py-2 text-sm font-bold text-stone-500 hover:text-stone-700 transition-colors"
                onClick={() => {
                  setShowUpdateTaskModal(false);
                  setSelectedTask(null);
                }}
              >
                Cancel
              </button>
              <Button 
                type="submit"
              >
                Update Progress
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Add Task Modal */}
      <Modal
        isOpen={showTaskModal}
        onClose={() => setShowTaskModal(false)}
        maxWidth="2xl"
        title="Add Timeline Task"
      >
        <form onSubmit={handleAddTask} className="space-y-4 pt-2">
          <div>
            <label className="block text-xs font-bold text-stone-400 uppercase tracking-widest mb-2 ml-1">Task Name</label>
            <input 
              required
              type="text" 
              value={taskForm.task_name}
              onChange={e => setTaskForm({...taskForm, task_name: e.target.value})}
              placeholder="e.g. Engineering Design"
              className="w-full px-6 py-4 bg-stone-50 border border-stone-200/50 hover:bg-white hover:border-stone-300 rounded-2xl text-sm font-bold text-stone-900 focus:bg-white focus:border-stone-300 focus:ring-4 focus:ring-stone-100 outline-none transition-all shadow-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-stone-400 uppercase tracking-widest mb-2 ml-1">Start Date</label>
              <input 
                required
                type="date" 
                value={taskForm.start_date}
                onChange={e => setTaskForm({...taskForm, start_date: e.target.value})}
                className="w-full px-6 py-4 bg-stone-50 border border-stone-200/50 hover:bg-white hover:border-stone-300 rounded-2xl text-sm font-bold text-stone-900 focus:bg-white focus:border-stone-300 focus:ring-4 focus:ring-stone-100 outline-none transition-all shadow-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-stone-400 uppercase tracking-widest mb-2 ml-1">End Date</label>
              <input 
                required
                type="date" 
                value={taskForm.end_date}
                onChange={e => setTaskForm({...taskForm, end_date: e.target.value})}
                className="w-full px-6 py-4 bg-stone-50 border border-stone-200/50 hover:bg-white hover:border-stone-300 rounded-2xl text-sm font-bold text-stone-900 focus:bg-white focus:border-stone-300 focus:ring-4 focus:ring-stone-100 outline-none transition-all shadow-sm"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-stone-400 uppercase tracking-widest mb-2 ml-1">Work Center</label>
              <select
                value={taskForm.work_center_id}
                onChange={e => setTaskForm({...taskForm, work_center_id: e.target.value})}
                className="w-full px-6 py-4 bg-stone-50 border border-stone-200/50 hover:bg-white hover:border-stone-300 rounded-2xl text-sm font-bold text-stone-900 focus:bg-white focus:border-stone-300 focus:ring-4 focus:ring-stone-100 outline-none transition-all shadow-sm appearance-none cursor-pointer"
              >
                <option value="">No Work Center</option>
                {workCenters.map(wc => (
                  <option key={wc.id} value={wc.id}>{wc.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-stone-400 uppercase tracking-widest mb-2 ml-1">Required Hours</label>
              <input 
                type="number" 
                min="0"
                value={taskForm.required_hours}
                onChange={e => setTaskForm({...taskForm, required_hours: Number(e.target.value)})}
                className="w-full px-6 py-4 bg-stone-50 border border-stone-200/50 hover:bg-white hover:border-stone-300 rounded-2xl text-sm font-bold text-stone-900 focus:bg-white focus:border-stone-300 focus:ring-4 focus:ring-stone-100 outline-none transition-all shadow-sm"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-stone-400 uppercase tracking-widest mb-2 ml-1">Initial Progress (%)</label>
            <input 
              type="number" 
              min="0" max="100"
              value={taskForm.progress}
              onChange={e => setTaskForm({...taskForm, progress: Number(e.target.value)})}
              className="w-full px-6 py-4 bg-stone-50 border border-stone-200/50 hover:bg-white hover:border-stone-300 rounded-2xl text-sm font-bold text-stone-900 focus:bg-white focus:border-stone-300 focus:ring-4 focus:ring-stone-100 outline-none transition-all shadow-sm"
            />
          </div>

          <div className="pt-6 flex justify-end gap-3">
            <Button 
              type="button"
              variant="secondary"
              onClick={() => setShowTaskModal(false)}
            >
              Cancel
            </Button>
            <Button 
              type="submit"
            >
              Save Task
            </Button>
          </div>
        </form>
      </Modal>


      {/* Consume Material Modal */}
      <Modal
        isOpen={showConsumeModal && selectedBOMItem !== null}
        onClose={() => setShowConsumeModal(false)}
        maxWidth="2xl"
        title="Record Material Consumption"
      >
        {selectedBOMItem && (
          <form onSubmit={handleConsume} className="space-y-6 pt-2">
            <div className="p-4 bg-stone-50 rounded-xl space-y-2">
              <div className="text-xs font-bold text-stone-900">{selectedBOMItem.item_code}</div>
              <div className="text-[10px] text-stone-500 uppercase tracking-widest">{selectedBOMItem.item_name}</div>
              <div className="flex justify-between text-[10px] font-bold pt-2 border-t border-stone-200">
                <span className="text-stone-400">Remaining Need</span>
                <span className="text-stone-900">{selectedBOMItem.required_qty - selectedBOMItem.qty_consumed} {selectedBOMItem.uom}</span>
              </div>
              <div className="flex justify-between text-[10px] font-bold text-emerald-600">
                <span>Available in Warehouse</span>
                <span>{selectedBOMItem.free_stock} {selectedBOMItem.uom}</span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-widest ml-1">Quantity Consumed</label>
              <div className="relative">
                <input 
                  autoFocus
                  required
                  type="number" 
                  step="0.01"
                  min="0.01"
                  max={selectedBOMItem.free_stock}
                  value={consumeQty}
                  onChange={e => setConsumeQty(Number(e.target.value))}
                  className="w-full px-6 py-4 bg-white border border-stone-200 rounded-2xl text-lg font-bold text-stone-900 outline-none focus:ring-4 focus:ring-stone-100 focus:border-stone-400 transition-all"
                />
                <div className="absolute right-6 top-1/2 -translate-y-1/2 text-stone-400 font-bold uppercase text-xs">
                  {selectedBOMItem.uom}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <Button 
                type="button"
                variant="secondary"
                onClick={() => setShowConsumeModal(false)}
              >
                Cancel
              </Button>
              <Button 
                type="submit"
                disabled={isSubmitting || consumeQty <= 0 || consumeQty > selectedBOMItem.free_stock}
              >
                {isSubmitting ? 'Recording...' : 'Confirm'}
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Finish Project Modal using standard ConfirmModal design */}
      <ConfirmModal
        isOpen={showFinishModal}
        title="Finish Project"
        message="Are you sure you want to mark this project as finished? This will release any unconsumed allocated stock back to free stock."
        confirmText="Confirm Finish"
        onConfirm={handleFinishProject}
        onCancel={() => setShowFinishModal(false)}
      />

      {/* Standardized FG Document Modal UI matching PR/PO A4 structure */}
      <Modal
        isOpen={showFgDocModal.visible}
        onClose={() => setShowFgDocModal({ visible: false, itemId: null, fgCode: null })}
        title={t("Finished Goods Certificate / Record")}
        maxWidth="5xl"
        contentClassName="p-0 flex flex-col h-[85vh] border-t border-stone-100"
      >
        {showFgDocModal.visible && (
          <>

            <div className="flex-1 overflow-y-auto p-8 bg-stone-50 flex justify-center items-start">
                  <PrintTemplate
                    ref={printDocRef}
                    documentTitleId="REKAMAN BARANG JADI"
                    documentTitleEn="FINISH GOOD RECORD"
                    documentNameId="rekaman barang jadi"
                    documentNameEn="finish good record"
                    date={new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', year: 'numeric', month: 'short', day: 'numeric' })}
                    referenceNumber={getShortCode(showFgDocModal.fgCode)}
                    documentId={getShortCode(showFgDocModal.fgCode)}
                    hideDefaultFooter={true}
                  >
                {/* Grid Metadata */}
                <div className="grid grid-cols-2 gap-6 mb-6 border-b border-stone-100 pb-4">
                  <div>
                    <div className="text-[8px] font-bold tracking-widest uppercase text-stone-900 mb-2 border-b border-stone-100 pb-1">Identifikasi Item <span className="font-normal text-[7px] text-stone-400">/ ITEM IDENTIFICATION</span></div>
                    <div className="text-2xl font-black text-stone-900 mb-1 font-mono tracking-tighter leading-none">{getShortCode(showFgDocModal.itemId)}</div>
                    <div className="text-[9px] font-medium text-stone-500 uppercase tracking-widest flex items-center gap-2">
                      <span>LOT: {getShortCode(showFgDocModal.fgCode)}</span>
                      <span className="w-1 h-1 rounded-full bg-stone-300"></span>
                      <span>SKU: {getShortCode(showFgDocModal.itemId)}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[8px] font-bold tracking-widest uppercase text-stone-900 mb-2 border-b border-stone-100 pb-1">Konteks Produksi <span className="font-normal text-[7px] text-stone-400">/ Production Context</span></div>
                    <div className="flex justify-between items-center text-[10px] font-medium mb-1"><span className="text-stone-900 uppercase tracking-widest font-bold text-[8px]">Aliran Proyek <span className="font-normal text-stone-400">/ Project Stream:</span></span> <span className="font-bold text-stone-900 uppercase">{project?.name || '-'}</span></div>
                    <div className="flex justify-between items-center text-[10px] font-medium mb-1"><span className="text-stone-900 uppercase tracking-widest font-bold text-[8px]">Kategori Pengambilan <span className="font-normal text-stone-400">/ Uptake Category:</span></span> <span className="font-bold bg-white border border-stone-200 px-1.5 py-0.5 rounded text-[8px] tracking-widest">FINISHED_GOODS</span></div>
                    <div className="flex justify-between items-center text-[10px] font-medium mb-1"><span className="text-stone-900 uppercase tracking-widest font-bold text-[8px]">Diperiksa Oleh <span className="font-normal text-stone-400">/ Inspected By:</span></span> <span className="font-bold uppercase">{user?.name || user?.username}</span></div>
                  </div>
                </div>

                {/* Description Text */}
                <div className="p-4 bg-white rounded-xl border border-stone-100 mb-6 w-full">
                   <div className="text-[8px] font-bold uppercase tracking-widest text-stone-900 mb-1">Klausul Sertifikasi & Ketertelusuran <span className="font-normal text-stone-400">/ Certification Clause & Traceability</span></div>
                   <p className="text-[10px] text-stone-650 italic leading-relaxed">
                     Sertifikat Barang Jadi ini diverifikasi secara elektronik. Ini menandakan bahwa unit kerja yang dirujuk telah berhasil melewati kontrol kualitas, inspeksi fisik, dan sign-off produksi internal. Kode lot yang terkait terikat ke registri silsilah QR untuk pelacakan asal-usul.
                   </p>
                   <p className="text-[10px] text-stone-400 italic leading-relaxed mt-1">
                     This certificate of Finished Goods is electronically verified. It signifies that the referenced work units have successfully passed quality control, physical inspection, and internal production sign-off. The associated lot code is bound to the QR lineage registry for provenance tracking.
                   </p>
                </div>

                {/* Lot Table */}
                <div className="flex-1 relative w-full">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-stone-300 bg-white">
                        <th className="py-2 px-3 font-bold text-stone-900 uppercase tracking-wider text-[9px] w-12 text-center">No</th>
                        <th className="py-2 px-3 font-bold text-stone-900 uppercase tracking-wider text-[9px] w-28">ID Barang <span className="font-normal text-stone-500 text-[8px] block mt-0.5">/ ITEM ID</span></th>
                        <th className="py-2 px-3 font-bold text-stone-900 uppercase tracking-wider text-[9px]">Deskripsi Lot <span className="font-normal text-stone-500 text-[8px] block mt-0.5">/ LOT DESC</span></th>
                        <th className="py-2 px-3 font-bold text-stone-900 uppercase tracking-wider text-[9px] text-right w-32">Hasil Produksi <span className="font-normal text-stone-500 text-[8px] block mt-0.5">/ YIELD YIELDED</span></th>
                        <th className="py-2 px-3 font-bold text-stone-900 uppercase tracking-wider text-[9px] w-20">UOM</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-stone-200">
                        <td className="py-2.5 px-3 text-[10px] font-bold text-center text-stone-400">01</td>
                        <td className="py-2.5 px-3 font-mono text-[10px] font-bold text-stone-500">{getShortCode(showFgDocModal.itemId)}</td>
                        <td className="py-2.5 px-3 text-[10px] font-bold text-stone-900 leading-snug uppercase">Barang Jadi untuk / Finished Good Lot for {project?.name}</td>
                        <td className="py-2.5 px-3 text-[10px] font-bold text-right font-mono text-stone-900">1</td>
                        <td className="py-2.5 px-3 text-[8px] tracking-widest uppercase font-bold text-stone-500">UNIT</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Centered System Clearance for FGR without sign & stamp */}
                <div className="mt-auto pt-4 border-t border-stone-150 flex justify-center items-center px-4 w-full relative z-10">
                  <div className="text-center max-w-lg font-sans">
                    
                    <div className="text-[7.5px] text-stone-900 font-extrabold uppercase tracking-widest leading-relaxed mb-0.5">
                      Dokumen FGR ini diterbitkan secara resmi dari sistem. Sah menurut registri perusahaan tanpa tanda tangan & stempel manual.
                    </div>
                    <div className="text-[7.5px] text-stone-400 font-normal uppercase tracking-widest leading-relaxed">
                      / This FGR document is officially issued and computationally validated in system. It is valid without physical manual signature & stamp under live corporate registry.
                    </div>
                    <div className="mt-2 text-[7px] font-mono text-emerald-600/70 tracking-widest">
                       AUTH REF: FGR-{project?.id}-{new Date().getTime().toString().slice(-6)} | {new Date().toLocaleDateString('id-ID')}
                    </div>
                  </div>
                </div>

                  </PrintTemplate>
            </div>
            <div className="p-6 border-t border-stone-100 bg-white flex justify-center gap-4 shrink-0">
              <Button 
                variant="secondary"
                onClick={() => setShowFgDocModal({ visible: false, itemId: null, fgCode: null })}
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

      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        onConfirm={confirmModal.action}
        onCancel={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
      />
      
      <ConfirmModal
        isOpen={showArchiveConfirm}
        title="Archive Project"
        message="Are you sure you want to archive this project? It will no longer appear in the active projects list."
        onConfirm={handleArchiveProject}
        onCancel={() => setShowArchiveConfirm(false)}
      />
    </div>
  );
}
