import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Action, hasPermission } from '@/utils/pbac';
import { ConfirmModal } from '@/components/shared/ConfirmModal';
import { Modal } from '@/components/ui/Modal';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area, Legend
} from 'recharts';
import { 
  Briefcase, 
  Users, 
  Award, 
  Repeat, 
  Plus, 
  Trash2, 
  MapPin, 
  Clock, 
  CalendarDays,
  RefreshCw,
  DollarSign, 
  Download, 
  FileText, 
  CheckCircle, 
  X, 
  ChevronRight, 
  ChevronDown,
  ExternalLink, 
  Send, 
  Sliders, 
  Shield, 
  Globe,
  Loader2,
  CheckSquare,
  Square,
  UserCheck,
  Search,
  ClipboardList,
  ShoppingCart,
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  UserMinus,
  Mail
} from 'lucide-react';
import { apiFetch } from '@/utils/api';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import { motion, AnimatePresence } from 'motion/react';
import { PageHeader } from '@/components/shared/PageHeader';

interface Job {
  id: string;
  title: string;
  department: string;
  location: string;
  status: 'OPEN' | 'CLOSED';
  type: string;
  description: string;
  requirements: string; // JSON Array of strings
  benefits: string; // JSON Array of strings
  salary_string: string;
  pamphlet_bg_color: string;
  pamphlet_accent_color: string;
  created_at: string;
}

interface Application {
  id: string;
  job_id: string;
  job_title?: string;
  job_department?: string;
  name: string;
  email: string;
  phone: string;
  linkedin_url?: string;
  experience?: string;
  resume_text?: string;
  status: 'APPLIED' | 'SCREENING' | 'INTERVIEW' | 'OFFER_MADE' | 'ACCEPTED' | 'REJECTED';
  applied_at: string;
  notes?: string;
}

interface KPI {
  id: string;
  employee_username: string;
  employee_name?: string;
  evaluator_username: string;
  evaluator_name?: string;
  period_name: string;
  score_communication: number;
  score_productivity: number;
  score_reliability: number;
  score_leadership: number;
  score_technical: number;
  overall_score: number;
  evaluation_notes: string;
  created_at: string;
}

interface HandoverItem {
  id: string;
  title: string;
  status: 'PENDING' | 'COMPLETED';
}

interface Handover {
  id: string;
  resigning_username: string;
  resigning_name?: string;
  successor_username: string;
  successor_name?: string;
  target_last_date: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
  handover_notes: string;
  checklist_json: string; // JSON Array of HandoverItem
  created_at: string;
}

interface UserDirectoryItem {
  username: string;
  name: string;
  role: string;
}

export default function HumanResource() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();

  const formatRupiah = (val: any) => {
    const num = Number(val) || 0;
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      maximumFractionDigits: 0
    }).format(num);
  };

  const formatLocalDate = (isoOrString: string) => {
    if (!isoOrString) return "-";
    try {
      const d = new Date(isoOrString);
      return d.toLocaleDateString("en-US", {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        timeZone: 'Asia/Jakarta'
      });
    } catch (e) {
      return isoOrString;
    }
  };

  const formatLocalTime = (isoOrString: string) => {
    if (!isoOrString) return "-";
    try {
      const d = new Date(isoOrString);
      return d.toLocaleTimeString("en-US", {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Jakarta'
      });
    } catch (e) {
      return isoOrString;
    }
  };
  
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    action: async () => {},
  });


  
  // Admin Tabs
  const [adminTab, setAdminTab] = useState<'DASHBOARD' | 'DIRECTORY' | 'ATTENDANCE' | 'LEAVE' | 'PAYROLL' | 'VACANCIES' | 'CANDIDATES' | 'KPI' | 'HANDOVER' | 'SETTINGS'>('DASHBOARD');

  // Synchronize URL search params with active tab
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tabParam = params.get('tab')?.toUpperCase();
    if (tabParam && ['DASHBOARD', 'DIRECTORY', 'ATTENDANCE', 'LEAVE', 'PAYROLL', 'VACANCIES', 'CANDIDATES', 'KPI', 'HANDOVER', 'SETTINGS'].includes(tabParam)) {
      setAdminTab(tabParam as any);
    } else if (!tabParam) {
      setAdminTab('DASHBOARD');
    }
  }, [location.search]);

  const handleTabChange = (tab: 'DASHBOARD' | 'DIRECTORY' | 'ATTENDANCE' | 'LEAVE' | 'PAYROLL' | 'VACANCIES' | 'CANDIDATES' | 'KPI' | 'HANDOVER' | 'SETTINGS') => {
    setAdminTab(tab);
    setSearchQuery('');
    const params = new URLSearchParams(location.search);
    params.set('tab', tab.toLowerCase());
    navigate({ search: params.toString() }, { replace: true });
  };

  // Database States
  const [jobs, setJobs] = useState<Job[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [kpis, setKpis] = useState<KPI[]>([]);
  const [handovers, setHandovers] = useState<Handover[]>([]);
  const [users, setUsers] = useState<UserDirectoryItem[]>([]);
  const [attendances, setAttendances] = useState<any[]>([]);
  const [leaves, setLeaves] = useState<any[]>([]);
  const [payslips, setPayslips] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isResettingHris, setIsResettingHris] = useState(false);

  // Form Inputs - Payslips
  const [isPayslipModalOpen, setIsPayslipModalOpen] = useState(false);
  const [payslipEmployee, setPayslipEmployee] = useState('');
  const [payslipMonth, setPayslipMonth] = useState('June 2026');
  const [payslipBasic, setPayslipBasic] = useState(4500000);
  const [payslipAllowances, setPayslipAllowances] = useState(500000);
  const [payslipDeductions, setPayslipDeductions] = useState(100000);
  const [isSubmittingPayslip, setIsSubmittingPayslip] = useState(false);

  // Modal States
  const [isJobModalOpen, setIsJobModalOpen] = useState(false);
  const [isKpiModalOpen, setIsKpiModalOpen] = useState(false);
  const [isHandoverModalOpen, setIsHandoverModalOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [selectedApp, setSelectedApp] = useState<Application | null>(null);

  // Form Inputs - Jobs
  const [jobTitle, setJobTitle] = useState('');
  const [jobDept, setJobDept] = useState('Production');
  const [jobLoc, setJobLoc] = useState('Central Factory');
  const [jobType, setJobType] = useState('Full-time');
  const [jobDesc, setJobDesc] = useState('');
  const [jobReqs, setJobReqs] = useState(''); // Textarea split with lines
  const [jobBens, setJobBens] = useState(''); // Textarea split with lines
  const [jobSalary, setJobSalary] = useState('');
  const [jobBg, setJobBg] = useState('#fafaf9');
  const [jobAccent, setJobAccent] = useState('#006097');

  // Form Inputs - Appraisals (KPI)
  const [kpiEmployee, setKpiEmployee] = useState('');
  const [kpiPeriod, setKpiPeriod] = useState('Q2 2026');
  const [scComm, setScComm] = useState(80);
  const [scProd, setScProd] = useState(80);
  const [scRel, setScRel] = useState(80);
  const [scLead, setScLead] = useState(80);
  const [scTech, setScTech] = useState(80);
  const [kpiNotes, setKpiNotes] = useState('');

  // Form Inputs - Handover
  const [hoResigning, setHoResigning] = useState('');
  const [hoSuccessor, setHoSuccessor] = useState('');
  const [hoDate, setHoDate] = useState('');
  const [hoNotes, setHoNotes] = useState('');
  const [hoItemsText, setHoItemsText] = useState("SOP Operasional Peralatan\nDokumen Serah Terima Kredensial\nInventarisasi Fisik Bahan");

  // CMS Settings
  const [cmsHeroTitle, setCmsHeroTitle] = useState('');
  const [cmsHeroSubtitle, setCmsHeroSubtitle] = useState('');
  const [cmsBenefits, setCmsBenefits] = useState('');
  const [isSavingCms, setIsSavingCms] = useState(false);
  const [isSweeping, setIsSweeping] = useState(false);

  // Candidate review
  const [reviewStatus, setReviewStatus] = useState<Application['status']>('APPLIED');
  const [reviewNotes, setReviewNotes] = useState('');

  // Search filter
  const [searchQuery, setSearchQuery] = useState('');
  const [filterJobId, setFilterJobId] = useState<string>('ALL');
  const [selectedStageFilter, setSelectedStageFilter] = useState<string>('ALL');

  // Canvas Ref for pamphlet rendering
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Fetch all database records
  const fetchAllData = async () => {
    setIsLoading(true);
    try {
      const [resJobs, resApps, resKpis, resHandovers, resUsers, resCms, resAttendances, resLeaves, resPayslips] = await Promise.all([
        apiFetch('/api/hr/jobs', {}, user?.username),
        apiFetch('/api/hr/applications', {}, user?.username),
        apiFetch('/api/hr/kpis', {}, user?.username),
        apiFetch('/api/hr/handovers', {}, user?.username),
        apiFetch('/api/users/directory', {}, user?.username),
        apiFetch('/api/cms/careers', {}, user?.username),
        apiFetch('/api/hr/attendances', {}, user?.username),
        apiFetch('/api/hr/leaves', {}, user?.username),
        apiFetch('/api/hr/payslips', {}, user?.username)
      ]);

      if (resJobs.ok) setJobs(resJobs.data || []);
      if (resApps.ok) setApplications(resApps.data || []);
      if (resKpis.ok) setKpis(resKpis.data || []);
      if (resHandovers.ok) setHandovers(resHandovers.data || []);
      if (resUsers.ok) setUsers(resUsers.data || []);
      if (resAttendances.ok) setAttendances(resAttendances.data || []);
      if (resLeaves.ok) setLeaves(resLeaves.data || []);
      if (resPayslips.ok) setPayslips(resPayslips.data || []);
      if (resCms.ok && resCms.data) {
         setCmsHeroTitle(resCms.data.hero_title || '');
         setCmsHeroSubtitle(resCms.data.hero_subtitle || '');
         setCmsBenefits(Array.isArray(resCms.data.benefits) ? resCms.data.benefits.join('\n') : (resCms.data.benefits || ''));
      }
    } catch (err) {
      console.error(err);
      showToast('Error loading Human Resource records', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const saveCms = async () => {
     try {
       setIsSavingCms(true);
       const res = await apiFetch('/api/cms/careers', {
         method: 'PUT',
         body: JSON.stringify({
           hero_title: cmsHeroTitle,
           hero_subtitle: cmsHeroSubtitle,
           benefits: cmsBenefits.split('\n').map(x => x.trim()).filter(Boolean)
         })
       }, user?.username);
       if (res.ok) {
         showToast("CMS berhasil diperbarui", 'success');
       } else {
         showToast("Gagal memperbarui CMS", 'error');
       }
     } catch (err) {
       showToast("Gagal memperbarui CMS", 'error');
     } finally {
       setIsSavingCms(false);
     }
  };

  const handleSweepData = async () => {
     if (!window.confirm("Aksi ini akan menghapus permanen semua PI (Personal Intelligence) pelamar yang ditolak lebih dari 6 bulan untuk mematuhi regulasi Privacy. Lanjutkan?")) return;
     try {
       setIsSweeping(true);
       const res = await apiFetch('/api/hr/sweep-data', { method: 'POST' }, user?.username);
       if (res.ok) {
         showToast(`Privasi dilindungi: Berhasil me-redact ${res.data?.redacted_count || 0} berkas lawas.`, 'success');
         fetchAllData();
       } else {
         showToast('Gagal melakukan redaction.', 'error');
       }
     } catch (err) {
       showToast('Gagal melakukan redaction.', 'error');
     } finally {
       setIsSweeping(false);
     }
  };

  useEffect(() => {
    fetchAllData();
  }, []);

  // Initial Form resets
  const resetJobForm = (job: Job | null = null) => {
    if (job) {
      setSelectedJob(job);
      setJobTitle(job.title);
      setJobDept(job.department);
      setJobLoc(job.location);
      setJobType(job.type);
      setJobDesc(job.description);
      try {
        setJobReqs(JSON.parse(job.requirements).join('\n'));
        setJobBens(JSON.parse(job.benefits).join('\n'));
      } catch (e) {
        setJobReqs(job.requirements);
        setJobBens(job.benefits);
      }
      setJobSalary(job.salary_string);
      setJobBg(job.pamphlet_bg_color || '#fafaf9');
      setJobAccent(job.pamphlet_accent_color || '#006097');
    } else {
      setSelectedJob(null);
      setJobTitle('');
      setJobDept('Production');
      setJobLoc('Central Factory');
      setJobType('Full-time');
      setJobDesc('');
      setJobReqs("Minimum Bachelor Degree in Engineering or equivalent\nMinimum 1 year of relevant experience\nProficient in computer operations & systems");
      setJobBens("Competitive Basic Salary\nTransport Allowance & Insurance (BPJS)\nPerformance Bonus");
      setJobSalary('Rp 6,000,000 - Rp 8,500,000');
      setJobBg('#fafaf9');
      setJobAccent('#006097');
    }
  };

  // Update Leave request status (Approve / Reject)
  const handleLeaveStatusUpdate = async (id: string, newStatus: 'APPROVED' | 'REJECTED') => {
    try {
      const res = await apiFetch(`/api/hr/leaves/${id}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: newStatus })
      }, user?.username);

      if (res.ok) {
        showToast(`Leave request ${newStatus === 'APPROVED' ? 'approved' : 'rejected'} successfully`, 'success');
        fetchAllData();
      } else {
        showToast(res.error || 'Failed to update leave request status', 'error');
      }
    } catch (e) {
      console.error(e);
      showToast('Error updating leave connection', 'error');
    }
  };

  // Create single payslip (Build Cycle Run item)
  const handleCreatePayslip = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payslipEmployee) {
      showToast('Please select an employee', 'error');
      return;
    }

    setIsSubmittingPayslip(true);
    try {
      const res = await apiFetch('/api/hr/payslips', {
        method: 'POST',
        body: JSON.stringify({
          employee_username: payslipEmployee,
          period_month: payslipMonth,
          basic_salary: Number(payslipBasic),
          allowances: Number(payslipAllowances),
          deductions: Number(payslipDeductions)
        })
      }, user?.username);

      if (res.ok) {
        showToast('Official employee payslip generated successfully', 'success');
        setIsPayslipModalOpen(false);
        fetchAllData();
      } else {
        showToast(res.error || 'Failed to generate payslip', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Error communicating with payroll server', 'error');
    } finally {
      setIsSubmittingPayslip(false);
    }
  };

  // Create or Update Job Vacancy
  const handleSaveJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!jobTitle || !jobDesc) {
      showToast('Please fill out the essential fields', 'error');
      return;
    }

    const reqArray = jobReqs.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const benArray = jobBens.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    const payload = {
      title: jobTitle,
      department: jobDept,
      location: jobLoc,
      type: jobType,
      status: selectedJob ? selectedJob.status : 'OPEN',
      description: jobDesc,
      requirements: JSON.stringify(reqArray),
      benefits: JSON.stringify(benArray),
      salary_string: jobSalary,
      pamphlet_bg_color: jobBg,
      pamphlet_accent_color: jobAccent
    };

    try {
      const url = selectedJob ? `/api/hr/jobs/${selectedJob.id}` : '/api/hr/jobs';
      const method = selectedJob ? 'PUT' : 'POST';
      const res = await apiFetch(url, {
        method,
        body: JSON.stringify(payload)
      }, user?.username);

      if (res.ok) {
        showToast(selectedJob ? 'Job position updated' : 'New job position posted', 'success');
        setIsJobModalOpen(false);
        fetchAllData();
      } else {
        showToast(res.error || 'Failed to save job post', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('Failed to connect to server', 'error');
    }
  };

  // Toggle Job Open/Closed Status
  const handleToggleJobStatus = async (job: Job) => {
    const nextStatus = job.status === 'OPEN' ? 'CLOSED' : 'OPEN';
    
    // Optimistic UI Update
    setJobs(prev => prev.map(j => j.id === job.id ? { ...j, status: nextStatus } : j));
    showToast(`Job recruitment ${nextStatus === 'OPEN' ? 'Opened' : 'Archived'}`, 'success');

    try {
      const res = await apiFetch(`/api/hr/jobs/${job.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          ...job,
          status: nextStatus
        })
      }, user?.username);

      if (res.ok) {
        fetchAllData();
      } else {
        showToast(res.error || 'Failed to toggle status', 'error');
        fetchAllData();
      }
    } catch (err) {
      console.error(err);
      fetchAllData();
    }
  };

  // Delete Job Vacancy
  const handleDeleteJob = async (id: string) => {
    setConfirmModal({
      isOpen: true,
      title: 'Hapus Lowongan',
      message: 'Anda yakin ingin menghapus lowongan ini? Semua kandidat terkait akan terhapus secara permanen.',
      action: async () => {
        try {
          const res = await apiFetch(`/api/hr/jobs/${id}`, { method: 'DELETE' }, user?.username);
          if (res.ok) {
            showToast('Job vacancy permanently deleted.', 'success');
            fetchAllData();
          } else {
            showToast(res.error || 'Failed to delete vacancy', 'error');
          }
        } catch (err) {
          console.error(err);
        }
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
      }
    });
  };



  // Save Candidate review update
  const handleSaveAppReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedApp) return;

    // Optimistic UI Update
    setApplications(prev => prev.map(a => a.id === selectedApp.id ? { ...a, status: reviewStatus, notes: reviewNotes } : a));
    showToast('Candidate evaluation profile updated', 'success');

    try {
      const res = await apiFetch(`/api/hr/applications/${selectedApp.id}/status`, {
        method: 'PUT',
        body: JSON.stringify({
          status: reviewStatus,
          notes: reviewNotes
        })
      }, user?.username);

      if (res.ok) {
        if (adminTab !== 'CANDIDATES') {
          setSelectedApp(null);
        }
        fetchAllData();
      } else {
        showToast(res.error || 'Failed to update candidate state', 'error');
        fetchAllData();
      }
    } catch (e) {
      console.error(e);
      fetchAllData();
    }
  };

  // Quick state movement handler for recruitment workflow cards
  const handleQuickStatusChange = async (app: Application, nextStatus: Application['status']) => {
    // Optimistic UI Update to remove perceived latency
    setApplications(prev => prev.map(a => a.id === app.id ? { ...a, status: nextStatus } : a));
    showToast(`Moved candidate ${app.name} to ${nextStatus.replace('_', ' ')}`, 'success');

    try {
      const res = await apiFetch(`/api/hr/applications/${app.id}/status`, {
        method: 'PUT',
        body: JSON.stringify({
          status: nextStatus,
          notes: app.notes || ''
        })
      }, user?.username);

      if (res.ok) {
        fetchAllData();
      } else {
        showToast(res.error || 'Failed to transition candidate state', 'error');
        fetchAllData();
      }
    } catch (e) {
      console.error(e);
      showToast('Internal communication error transitioning state', 'error');
      fetchAllData();
    }
  };

  // Submit KPI Performance Appraisal Assessment
  const handleSubmitKpi = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!kpiEmployee || !kpiPeriod) {
      showToast('Please specify the Employee and Appraisal period', 'error');
      return;
    }

    try {
      const res = await apiFetch('/api/hr/kpis', {
        method: 'POST',
        body: JSON.stringify({
          employee_username: kpiEmployee,
          period_name: kpiPeriod,
          score_communication: scComm,
          score_productivity: scProd,
          score_reliability: scRel,
          score_leadership: scLead,
          score_technical: scTech,
          evaluation_notes: kpiNotes
        })
      }, user?.username);

      if (res.ok) {
        showToast(`KPI assessment successfully logged. Score: ${res.data.overall_score}`, 'success');
        setIsKpiModalOpen(false);
        // Reset fields
        setKpiEmployee('');
        setKpiNotes('');
        setScComm(80);
        setScProd(80);
        setScRel(80);
        setScLead(80);
        setScTech(80);
        fetchAllData();
      } else {
        showToast(res.error || 'Failed to log KPI scorecard', 'error');
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Submit exit transition Handover sheet
  const handleSubmitHandover = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hoResigning || !hoSuccessor || !hoDate) {
      showToast('Identify leaving staff member, their successor, and the transit last date', 'error');
      return;
    }

    const items = hoItemsText.split('\n').map((item, idx) => ({
      id: `task-${idx + 1}-${Date.now()}`,
      title: item.trim(),
      status: 'PENDING'
    })).filter(t => t.title.length > 0);

    try {
      const res = await apiFetch('/api/hr/handovers', {
        method: 'POST',
        body: JSON.stringify({
          resigning_username: hoResigning,
          successor_username: hoSuccessor,
          target_last_date: hoDate,
          handover_notes: hoNotes,
          checklist_json: JSON.stringify(items)
        })
      }, user?.username);

      if (res.ok) {
        showToast('Exit transit transition initialized successfully', 'success');
        setIsHandoverModalOpen(false);
        setHoResigning('');
        setHoSuccessor('');
        setHoNotes('');
        setHoDate('');
        fetchAllData();
      } else {
        showToast(res.error || 'Failed to create handover transit tracker', 'error');
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Un/check handover items
  const handleToggleHandoverItem = async (handover: Handover, clickedItemId: string) => {
    let checklist: HandoverItem[] = [];
    try {
      checklist = JSON.parse(handover.checklist_json);
    } catch (e) {
      console.error(e);
    }

    const updatedChecklist = checklist.map(item => {
      if (item.id === clickedItemId) {
        return { ...item, status: item.status === 'COMPLETED' ? 'PENDING' : 'COMPLETED' as const };
      }
      return item;
    });

    const totalCount = updatedChecklist.length;
    const completedCount = updatedChecklist.filter(item => item.status === 'COMPLETED').length;
    
    // Auto-update overarching transit phase status
    let nextHandoverStatus = handover.status;
    if (completedCount === totalCount && totalCount > 0) {
      nextHandoverStatus = 'COMPLETED';
    } else if (completedCount > 0) {
      nextHandoverStatus = 'IN_PROGRESS';
    } else {
      nextHandoverStatus = 'PENDING';
    }

    // Optimistic UI Update
    setHandovers(prev => prev.map(h => 
      h.id === handover.id ? { 
        ...h, 
        status: nextHandoverStatus, 
        checklist_json: JSON.stringify(updatedChecklist) 
      } : h
    ));

    try {
      const res = await apiFetch(`/api/hr/handovers/${handover.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          status: nextHandoverStatus,
          handover_notes: handover.handover_notes,
          checklist_json: JSON.stringify(updatedChecklist)
        })
      }, user?.username);

      if (res.ok) {
        fetchAllData();
      } else {
        showToast('Error saving item change', 'error');
        fetchAllData();
      }
    } catch (err) {
      console.error(err);
      fetchAllData();
    }
  };

  // Convert Job details to professional brochure / pamphlet and export PNG
  // Filter systems
  const filteredJobs = React.useMemo(() => jobs.filter(j => 
    j.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    j.department.toLowerCase().includes(searchQuery.toLowerCase())
  ), [jobs, searchQuery]);

  const filteredApps = React.useMemo(() => applications.filter(a => {
    const matchesSearch = 
      a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.job_title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.experience?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesJob = filterJobId === 'ALL' || a.job_id === filterJobId;
    return matchesSearch && matchesJob;
  }), [applications, searchQuery, filterJobId]);

  const filteredKpis = React.useMemo(() => kpis.filter(k => 
    k.employee_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    k.employee_username.toLowerCase().includes(searchQuery.toLowerCase()) ||
    k.period_name.toLowerCase().includes(searchQuery.toLowerCase())
  ), [kpis, searchQuery]);

  const filteredHandovers = React.useMemo(() => handovers.filter(h => 
    h.resigning_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    h.successor_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    h.status.toLowerCase().includes(searchQuery.toLowerCase())
  ), [handovers, searchQuery]);

  const filteredUsers = React.useMemo(() => users.filter(usr =>
    usr.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    usr.username?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    usr.role?.toLowerCase().includes(searchQuery.toLowerCase())
  ), [users, searchQuery]);

  const avgKpi = React.useMemo(() => kpis.length > 0
    ? (kpis.reduce((acc, current) => acc + current.overall_score, 0) / kpis.length).toFixed(1)
    : "87.5", [kpis]);

  const activeTransitions = React.useMemo(() => handovers.filter(h => h.status !== 'COMPLETED').length, [handovers]);

  return (
    <div className="min-h-screen bg-transparent pb-16">
      
      {/* Invisible Canvas for pamphlet Generation */}
      <canvas ref={canvasRef} className="hidden" />

      <div className="w-full flex flex-col gap-8 pb-32">
        
        {/* Playful & Abstract Page Header (Asymmetrical blob design) */}
        <div className="flex flex-col md:flex-row gap-6">
          {/* Main Hero Blob */}
          <div className="flex-1 bg-stone-900 rounded-[3rem] md:rounded-tl-[5rem] md:rounded-br-[6rem] p-8 md:p-12 relative overflow-hidden shadow-xl shadow-stone-200/50 flex flex-col justify-end min-h-[320px]">
            <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-white/5 rounded-full blur-[80px] pointer-events-none -translate-y-1/2 translate-x-1/3" />
            <div className="absolute bottom-0 left-0 w-[300px] h-[300px] bg-[#b02524]/20 rounded-full blur-[60px] pointer-events-none translate-y-1/3 -translate-x-1/4" />
            
            <div className="relative z-10">
              <div className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white/10 backdrop-blur-md shadow-sm border border-white/20 text-white mb-6 w-fit transform -rotate-2">
                <span className="text-xs font-black uppercase tracking-widest">People & Culture</span>
              </div>
              
              <h1 className="text-5xl md:text-7xl font-black text-white tracking-tight mb-4 leading-[0.95]">
                HRIS by<br/>Paving Joss
              </h1>
              <p className="text-stone-300 font-medium max-w-md text-lg leading-relaxed">
                Directory, recruitment, KPI celebration, and culture hub. Where progress happens.
              </p>
            </div>
          </div>

          {/* Action Required Widget */}
          <div className="md:w-[320px] shrink-0 bg-white/80 backdrop-blur-3xl rounded-[3rem] md:rounded-tr-[5rem] p-8 border border-white shadow-xl shadow-stone-200/50 flex flex-col gap-4 relative overflow-hidden h-[320px]">
            <div className="absolute -top-10 -right-10 w-40 h-40 bg-amber-100 rounded-full blur-3xl opacity-50" />
            
            <div className="flex items-center gap-3 z-10 mt-2">
              <div className="p-2 bg-amber-100 text-amber-600 rounded-xl">
                <AlertCircle className="w-5 h-5" />
              </div>
              <h3 className="text-xl font-black text-stone-900 tracking-tight leading-tight">
                Action Required
              </h3>
            </div>
            
            <div className="flex-1 overflow-y-auto space-y-3 custom-scrollbar z-10 mt-1 pb-2">
              {applications.filter(a => a.status === 'APPLIED').length > 0 ? (
                <div onClick={() => handleTabChange('CANDIDATES')} className="bg-stone-50 p-4 rounded-[1.5rem] border border-stone-100 cursor-pointer hover:bg-stone-100 transition-colors flex justify-between items-center group">
                  <div>
                    <p className="font-bold text-stone-900 text-sm">New Candidates</p>
                    <p className="text-[10px] font-medium text-stone-500 mt-0.5">Initial screening</p>
                  </div>
                  <span className="w-8 h-8 rounded-full bg-amber-100 text-amber-700 font-black flex items-center justify-center text-xs shadow-sm group-hover:scale-110 transition-transform">
                    {applications.filter(a => a.status === 'APPLIED').length}
                  </span>
                </div>
              ) : null}

              {applications.filter(a => a.status === 'INTERVIEW').length > 0 ? (
                <div onClick={() => handleTabChange('CANDIDATES')} className="bg-stone-50 p-4 rounded-[1.5rem] border border-stone-100 cursor-pointer hover:bg-stone-100 transition-colors flex justify-between items-center group">
                  <div>
                    <p className="font-bold text-stone-900 text-sm">Interviews</p>
                    <p className="text-[10px] font-medium text-stone-500 mt-0.5">Pending decisions</p>
                  </div>
                  <span className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 font-black flex items-center justify-center text-xs shadow-sm group-hover:scale-110 transition-transform">
                    {applications.filter(a => a.status === 'INTERVIEW').length}
                  </span>
                </div>
              ) : null}

              {jobs.filter(j => j.status === 'CLOSED').length > 0 ? (
                <div onClick={() => handleTabChange('VACANCIES')} className="bg-stone-50 p-4 rounded-[1.5rem] border border-stone-100 cursor-pointer hover:bg-stone-100 transition-colors flex justify-between items-center group">
                  <div>
                    <p className="font-bold text-stone-900 text-sm">Draft Vacancies</p>
                    <p className="text-[10px] font-medium text-stone-500 mt-0.5">Pending publication</p>
                  </div>
                  <span className="w-8 h-8 rounded-full bg-stone-200 text-stone-600 font-black flex items-center justify-center text-xs shadow-sm group-hover:scale-110 transition-transform">
                    {jobs.filter(j => j.status === 'CLOSED').length}
                  </span>
                </div>
              ) : null}
              
              {applications.filter(a => a.status === 'APPLIED' || a.status === 'INTERVIEW').length === 0 && jobs.filter(j => j.status === 'CLOSED').length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-center px-2 py-6">
                  <div className="w-12 h-12 bg-emerald-50 rounded-full flex items-center justify-center mb-3">
                    <CheckSquare className="w-6 h-6 text-emerald-500" />
                  </div>
                  <p className="text-stone-900 font-bold text-sm">All caught up!</p>
                  <p className="text-stone-500 text-xs mt-1">No pending actions required.</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ==================================================== */}
        {/* INTERACTIVE ADMIN CONTROL PANEL */}
        {/* ==================================================== */}
        <div>
          {/* SEARCH AND QUICK ACTIONS BAR (BULBOUS) */}
          <div className="flex flex-col md:flex-row gap-4 mb-4">
            <div className="relative flex-1 group">
              <div className="absolute inset-y-0 left-6 flex items-center pointer-events-none transition-transform group-focus-within:scale-110 group-focus-within:text-stone-800 text-stone-400">
                <Search className="h-6 w-6" />
              </div>
              <input 
                type="text"
                placeholder={`Search ${adminTab.toLowerCase()} records...`}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-16 pr-14 py-5 bg-white backdrop-blur-md border border-stone-200 rounded-[3rem] text-lg font-bold text-stone-800 placeholder-stone-400 outline-none focus:ring-4 focus:ring-red-100 shadow-sm transition-all focus:shadow-md focus:border-red-200"
              />
              {searchQuery && (
                 <button type="button" onClick={() => setSearchQuery('')} className="absolute inset-y-0 right-4 flex items-center justify-center w-10">
                    <div className="w-8 h-8 rounded-full bg-stone-100 hover:bg-stone-200 flex items-center justify-center text-stone-500">
                       <X className="w-4 h-4" />
                    </div>
                 </button>
              )}
            </div>
            
            {/* Contextual Action Button */}
            <div className="shrink-0 flex items-center space-x-3">
              {adminTab === 'VACANCIES' && (
                <button 
                  type="button"
                  onClick={() => { resetJobForm(null); setIsJobModalOpen(true); }}
                  className="h-full px-8 py-5 bg-[#b02524] text-white rounded-[3rem] font-black shadow-lg hover:shadow-xl hover:-translate-y-1 hover:rotate-2 transition-all flex items-center gap-3 text-lg"
                >
                  <Plus className="h-6 w-6" />
                  <span>Create Job</span>
                </button>
              )}
              {adminTab === 'KPI' && (
                <button 
                  type="button"
                  onClick={() => setIsKpiModalOpen(true)}
                  className="h-full px-8 py-5 bg-stone-900 text-white rounded-[3rem] font-black shadow-lg hover:shadow-xl hover:-translate-y-1 hover:rotate-2 transition-all flex items-center gap-3 text-lg"
                >
                  <Award className="h-6 w-6" />
                  <span>Score KPI</span>
                </button>
              )}
              {adminTab === 'HANDOVER' && (
                <button 
                  type="button"
                  onClick={() => setIsHandoverModalOpen(true)}
                  className="h-full px-8 py-5 bg-stone-900 text-white rounded-[3rem] font-black shadow-lg hover:shadow-xl hover:-translate-y-1 hover:-rotate-2 transition-all flex items-center gap-3 text-lg"
                >
                  <Repeat className="h-6 w-6" />
                  <span>Deploy Handover</span>
                </button>
              )}
            </div>
          </div>

          {isLoading ? (
            <div className="py-32 text-center text-slate-400 flex flex-col items-center justify-center bg-white/40 rounded-[3rem] animate-pulse mt-8">
              <Loader2 className="h-12 w-12 animate-spin mb-4 text-violet-400" />
              <p className="font-bold text-lg">Brewing some coffee & loading data...</p>
            </div>
          ) : (
            <div className="min-h-[500px]">
              
              {/* DASHBOARD TAB */}
              {adminTab === 'DASHBOARD' && (
                <div className="space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-500">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-stone-100 flex flex-col justify-between hover:shadow-xl hover:-translate-y-2 transition-all">
                      <div className="flex justify-between items-start">
                        <Users className="w-8 h-8 text-[#b02524]" />
                        <span className="px-3 py-1 bg-stone-100 text-stone-600 rounded-full text-xs font-black uppercase tracking-widest">Active</span>
                      </div>
                      <div className="mt-6">
                        <h4 className="text-stone-500 font-bold mb-1">Total Headcount</h4>
                        <p className="text-4xl font-black text-stone-900">{users.length}</p>
                      </div>
                    </div>
                    <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-stone-100 flex flex-col justify-between hover:shadow-xl hover:-translate-y-2 transition-all">
                      <div className="flex justify-between items-start">
                        <Clock className="w-8 h-8 text-emerald-600" />
                        <span className="px-3 py-1 bg-emerald-50 text-emerald-700 rounded-full text-xs font-black uppercase tracking-widest">Attendance</span>
                      </div>
                      <div className="mt-6">
                        <h4 className="text-stone-500 font-bold mb-1">On Time Today</h4>
                        <p className="text-4xl font-black text-stone-900">{users.length > 0 ? 96 : 0}<span className="text-xl text-stone-400">%</span></p>
                      </div>
                    </div>
                    <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-stone-100 flex flex-col justify-between hover:shadow-xl hover:-translate-y-2 transition-all">
                      <div className="flex justify-between items-start">
                        <CalendarDays className="w-8 h-8 text-amber-500" />
                        <span className="px-3 py-1 bg-amber-50 text-amber-700 rounded-full text-xs font-black uppercase tracking-widest">Time Off</span>
                      </div>
                      <div className="mt-6">
                        <h4 className="text-stone-500 font-bold mb-1">Currently on Leave</h4>
                        <p className="text-4xl font-black text-stone-900">{users.length > 0 ? Math.max(1, Math.floor(users.length * 0.05)) : 0}</p>
                      </div>
                    </div>
                    <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-stone-100 flex flex-col justify-between hover:shadow-xl hover:-translate-y-2 transition-all">
                      <div className="flex justify-between items-start">
                        <Briefcase className="w-8 h-8 text-blue-500" />
                        <span className="px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-black uppercase tracking-widest">Vacancies</span>
                      </div>
                      <div className="mt-6">
                        <h4 className="text-stone-500 font-bold mb-1">Open Positions</h4>
                        <p className="text-4xl font-black text-stone-900">{jobs.filter(j => j.status === 'OPEN').length}</p>
                      </div>
                    </div>
                  </div>

                  {/* Charts Row */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-stone-100 h-[400px] flex flex-col">
                      <div className="mb-6 px-2">
                         <h3 className="font-black text-lg text-stone-800">Recruitment Pipeline</h3>
                         <p className="text-sm font-medium text-stone-500">Funnel progress across all active vacancies.</p>
                      </div>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={[
                          { name: 'Applied', count: applications.filter(a => a.status === 'APPLIED').length },
                          { name: 'Screening', count: applications.filter(a => a.status === 'SCREENING').length },
                          { name: 'Interview', count: applications.filter(a => a.status === 'INTERVIEW').length },
                          { name: 'Offered', count: applications.filter(a => a.status === 'OFFER_MADE').length },
                          { name: 'Hired', count: applications.filter(a => a.status === 'ACCEPTED').length },
                        ]} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                          <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#6B7280', fontSize: 12, fontWeight: 700}} dy={10} />
                          <YAxis axisLine={false} tickLine={false} tick={{fill: '#6B7280', fontSize: 12, fontWeight: 700}} dx={-10} allowDecimals={false} />
                          <RechartsTooltip cursor={{fill: '#F3F4F6'}} contentStyle={{borderRadius: '20px', border: 'none', boxShadow: '0 10px 25px rgba(0,0,0,0.1)', fontWeight: 700}} />
                          <Bar dataKey="count" fill="#b02524" radius={[6, 6, 0, 0]} barSize={40}>
                            {[
                              { name: 'Applied' },
                              { name: 'Screening' },
                              { name: 'Interview' },
                              { name: 'Offered' },
                              { name: 'Hired' },
                            ].map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={['#b02524', '#f59e0b', '#3b82f6', '#10b981', '#ef4444'][index % 5]} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    
                    <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-stone-100 h-[400px] flex flex-col">
                      <div className="mb-6 px-2">
                         <h3 className="font-black text-lg text-stone-800">Headcount by Department</h3>
                         <p className="text-sm font-medium text-stone-500">Distribution of active staff across business units.</p>
                      </div>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={[
                              { name: 'Finance (FC)', value: users.filter(u => u.role === 'FC').length },
                              { name: 'Commercial (Sales)', value: users.filter(u => u.role === 'SALES').length },
                              { name: 'Production', value: users.filter(u => u.role === 'PRODUCTION').length },
                              { name: 'Engineering', value: users.filter(u => u.role === 'ENGINEERING').length },
                              { name: 'Warehouse', value: users.filter(u => u.role === 'WAREHOUSE').length },
                            ].filter(d => d.value > 0)}
                            cx="50%" cy="50%" innerRadius={80} outerRadius={120} paddingAngle={5}
                            dataKey="value" stroke="none"
                          >
                            {[
                              { name: 'FC' },
                              { name: 'Sales' },
                              { name: 'Prod' },
                              { name: 'Eng' },
                              { name: 'Warehouse' },
                            ].map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={['#10b981', '#3b82f6', '#b02524', '#f59e0b', '#8b5cf6'][index % 5]} />
                            ))}
                          </Pie>
                          <RechartsTooltip contentStyle={{borderRadius: '20px', border: 'none', boxShadow: '0 10px 25px rgba(0,0,0,0.1)', fontWeight: 700}} />
                          <Legend iconType="circle" wrapperStyle={{ fontSize: '13px', fontWeight: 600, color: '#4B5563' }} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="bg-white p-8 rounded-[3rem] shadow-sm border border-stone-100 w-full mb-8">
                     <div className="flex flex-col md:flex-row justify-between md:items-end gap-6 mb-8">
                       <div>
                         <h3 className="font-black text-2xl text-stone-900 tracking-tight">Enterprise KPI Trend</h3>
                         <p className="text-stone-500 font-medium">Historical performance metrics across all departments.</p>
                       </div>
                       <div className="flex gap-2">
                         <span className="px-4 py-2 bg-stone-100 text-stone-600 rounded-full text-xs font-black uppercase tracking-widest">Q1 - Q4 2026</span>
                       </div>
                     </div>
                     <div className="h-[300px]">
                       <ResponsiveContainer width="100%" height="100%">
                         <AreaChart data={[
                           { month: 'Jan', score: 72 },
                           { month: 'Feb', score: 75 },
                           { month: 'Mar', score: 81 },
                           { month: 'Apr', score: 80 },
                           { month: 'May', score: 86 },
                           { month: 'Jun', score: kpis.length > 0 ? Math.round(kpis.reduce((acc, kpi) => acc + (kpi.score_communication + kpi.score_productivity + kpi.score_reliability + kpi.score_leadership + kpi.score_technical)/5, 0) / kpis.length) : 89 },
                         ]} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                           <defs>
                             <linearGradient id="colorScore" x1="0" y1="0" x2="0" y2="1">
                               <stop offset="5%" stopColor="#b02524" stopOpacity={0.3}/>
                               <stop offset="95%" stopColor="#b02524" stopOpacity={0}/>
                             </linearGradient>
                           </defs>
                           <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                           <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fill: '#6B7280', fontSize: 12, fontWeight: 700}} dy={10} />
                           <YAxis axisLine={false} tickLine={false} tick={{fill: '#6B7280', fontSize: 12, fontWeight: 700}} dx={-10} domain={[0, 100]} />
                           <RechartsTooltip contentStyle={{borderRadius: '20px', border: 'none', boxShadow: '0 10px 25px rgba(0,0,0,0.1)', fontWeight: 700}} />
                           <Area type="monotone" dataKey="score" stroke="#b02524" strokeWidth={4} fillOpacity={1} fill="url(#colorScore)" />
                         </AreaChart>
                       </ResponsiveContainer>
                     </div>
                  </div>
                </div>
              )}

              {/* 0. TAB: TEAM DIRECTORY */}
              {adminTab === 'DIRECTORY' && (
                <div className="space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-500">
                  {/* Asymmetrical Floating Stats panel cards */}
                  <div className="flex flex-col md:flex-row gap-4 mt-6">
                    {/* Active Staff - Tall Pill */}
                    <div className="flex-1 min-w-[200px] bg-stone-900 p-8 rounded-[3rem] shadow-xl shadow-stone-200/50 flex flex-col items-center justify-center gap-4 relative overflow-hidden group hover:-translate-y-2 transition-transform duration-500 transform md:-rotate-2">
                       <div className="w-full flex justify-center text-stone-300 group-hover:scale-125 transition-transform duration-500">
                         <Users className="w-12 h-12" />
                       </div>
                       <div className="text-center mt-2">
                         <p className="text-5xl font-black text-white leading-none mb-2 tracking-tighter">{users.length}</p>
                         <p className="text-sm font-bold text-stone-400 uppercase tracking-widest leading-tight">Active<br/>Staff</p>
                       </div>
                    </div>

                    {/* Job Positions - Wide Bulb */}
                    <div className="flex-[1.2] min-w-[200px] bg-white p-8 rounded-[3rem] md:rounded-tl-none border border-stone-200 shadow-xl shadow-stone-100 flex flex-col gap-2 group hover:-translate-y-2 transition-transform duration-500">
                      <div className="flex justify-between items-start w-full">
                        <div className="w-16 h-16 rounded-full bg-red-50 text-[#b02524] flex items-center justify-center group-hover:rotate-12 transition-transform">
                          <Briefcase className="w-8 h-8" />
                        </div>
                        <p className="text-5xl font-black text-[#b02524] leading-none tracking-tighter">{jobs.length}</p>
                      </div>
                      <div className="mt-auto pt-8">
                         <p className="text-sm font-bold text-stone-500 uppercase tracking-widest">Open Positions</p>
                      </div>
                    </div>

                    {/* Avg Performance - Wide Bulb 2 */}
                    <div className="flex-[1.5] min-w-[240px] bg-white p-8 rounded-[3rem] md:rounded-tr-none border border-stone-200 shadow-xl shadow-stone-100 flex flex-col gap-2 group hover:-translate-y-2 transition-transform duration-500">
                      <div className="flex justify-between items-start w-full">
                        <div className="w-16 h-16 rounded-full bg-stone-100 text-stone-600 flex items-center justify-center group-hover:rotate-12 transition-transform">
                          <Award className="w-8 h-8" />
                        </div>
                        <p className="text-5xl font-black text-stone-900 leading-none tracking-tighter flex items-end justify-end gap-2 text-right">
                          {avgKpi}
                          <span className="text-xl text-stone-400 font-bold mb-1">/100</span>
                        </p>
                      </div>
                      <div className="mt-auto pt-8">
                         <p className="text-sm font-bold text-stone-500 uppercase tracking-widest">Company KPI Score</p>
                      </div>
                    </div>

                    {/* Transitions - Round Bulb */}
                    <div className="flex-[0.8] min-w-[180px] bg-[#b02524] p-8 rounded-[3rem] shadow-xl shadow-red-200/50 flex flex-col items-center justify-center text-center gap-3 relative group hover:-translate-y-2 transition-transform duration-500 transform md:rotate-2">
                      <div className="w-12 h-12 rounded-full bg-white/20 text-white flex items-center justify-center group-hover:-rotate-45 transition-transform backdrop-blur-md">
                        <Repeat className="w-6 h-6" />
                      </div>
                      <div className="mt-2">
                        <p className="text-5xl font-black text-white leading-none tracking-tighter mb-2">{activeTransitions}</p>
                        <p className="text-xs font-bold text-red-100 uppercase tracking-widest mt-2 px-4 leading-tight">Active<br/>Handovers</p>
                      </div>
                    </div>
                  </div>

                  {/* Staff Directory Grid - scattered styling */}
                  <div className="mt-16">
                    <div className="mb-10 flex items-center gap-5 pl-2">
                      <div className="h-12 w-4 bg-[#b02524] rounded-full rotate-12" />
                      <div>
                        <h3 className="text-3xl font-black text-stone-900 tracking-tight">Meet the Crew</h3>
                        <p className="text-base font-medium text-stone-500 mt-1">Say hi to the people making it happen.</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                      {filteredUsers.length === 0 ? (
                        <div className="col-span-full py-20 text-center bg-white/50 rounded-[4rem] border border-stone-200 border-dashed">
                          <div className="w-20 h-20 bg-stone-100 rounded-[2rem] flex items-center justify-center mx-auto mb-4 text-stone-300 transform -rotate-6">
                            <Users className="w-10 h-10" />
                          </div>
                          <p className="text-stone-500 font-bold text-lg">Nobody found here.</p>
                        </div>
                      ) : (
                        filteredUsers.map((usr, i) => (
                          <div key={usr.username} className={cn(
                            "bg-white/80 backdrop-blur-xl p-8 shadow-lg shadow-stone-200/40 border border-stone-100 hover:shadow-xl hover:-translate-y-2 transition-all duration-300 group flex flex-col items-center text-center relative overflow-hidden",
                            i % 3 === 0 ? "rounded-tl-[3.5rem] rounded-br-[3.5rem] rounded-tr-[1.5rem] rounded-bl-[1.5rem]" :
                            i % 3 === 1 ? "rounded-tr-[3.5rem] rounded-bl-[3.5rem] rounded-tl-[1.5rem] rounded-br-[1.5rem]" :
                            "rounded-[3rem]"
                          )}>
                            <div className="absolute top-0 left-0 w-full h-24 bg-gradient-to-b from-stone-50/50 to-transparent pointer-events-none" />
                            
                            <div className="relative mb-6 mt-2">
                              <div className="w-24 h-24 rounded-[2rem] bg-stone-100 flex items-center justify-center text-4xl font-black text-stone-800 shadow-inner overflow-hidden border-4 border-white transform group-hover:rotate-6 group-hover:scale-110 transition-all duration-300">
                                {usr.name ? usr.name.substring(0, 1).toUpperCase() : usr.username.substring(0, 1).toUpperCase()}
                              </div>
                              {usr.username === user?.username && (
                                <div className="absolute -bottom-3 -right-4 bg-stone-900 text-white text-[10px] items-center justify-center font-black px-3 py-1.5 rounded-full border-2 border-white shadow-md shadow-stone-300 flex gap-1 z-10 animate-bounce">
                                  YOU
                                </div>
                              )}
                            </div>
                            
                            <h4 className="text-xl font-black text-stone-800 line-clamp-1 group-hover:text-[#b02524] transition-colors">{usr.name || "Happy Teammate"}</h4>
                            <p className="text-sm font-bold text-stone-400 mt-1 mb-6">@{usr.username}</p>
                            
                            <div className="mt-auto pt-4 flex w-full justify-center">
                              <span className={cn(
                                "px-4 py-2.5 rounded-full text-[10px] font-black uppercase tracking-widest leading-none inline-flex items-center gap-2 shadow-sm",
                                usr.role === 'FC' ? "bg-red-50 text-[#b02524] border border-red-100" :
                                usr.role === 'GOD_MODE' ? "bg-stone-900 text-white border border-stone-900" :
                                usr.role.includes('HR') ? "bg-stone-100 text-stone-700 border border-stone-200" :
                                "bg-white text-stone-600 border border-stone-200"
                              )}>
                                {usr.role === 'FC' && "Finance"}
                                {usr.role === 'GOD_MODE' && "Super Admin"}
                                {usr.role === 'HR_OFFICER' && "HR"}
                                {usr.role !== 'FC' && usr.role !== 'GOD_MODE' && usr.role !== 'HR_OFFICER' && usr.role}
                              </span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}
              {/* ATTENDANCE TAB */}
              {adminTab === 'ATTENDANCE' && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-500 mt-6">
                  <div className="bg-white/80 backdrop-blur-md rounded-[32px] p-8 border border-stone-200">
                    <div className="flex justify-between items-center mb-6">
                      <h2 className="text-xl font-black text-stone-900">Attendance Timesheets</h2>
                      <div className="text-xs bg-stone-100 px-4 py-2 rounded-xl text-stone-700 font-bold uppercase tracking-wider">
                        {attendances.length} Logs Saved
                      </div>
                    </div>

                    {attendances.length === 0 ? (
                      <div className="col-span-full py-20 text-center bg-stone-50 rounded-[2.5rem] border border-stone-200 border-dashed">
                        <div className="w-16 h-16 bg-stone-250 rounded-full flex items-center justify-center mx-auto mb-4 text-stone-400">
                          <Clock className="w-8 h-8" />
                        </div>
                        <p className="text-stone-500 font-bold mb-1 font-sans">No attendance records found</p>
                        <p className="text-xs text-stone-450">Staff members have not registered any attendance clock-ins yet.</p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto rounded-[1.5rem] border border-stone-150">
                        <table className="w-full text-left font-bold text-xs border-collapse">
                          <thead>
                            <tr className="bg-stone-50 text-stone-500 uppercase tracking-widest border-b border-stone-150">
                              <th className="p-4 pl-6 text-[10px]">Date</th>
                              <th className="p-4 text-[10px]">Staff Name</th>
                              <th className="p-4 text-[10px]">Clock-In Time</th>
                              <th className="p-4 text-[10px]">Clock-In Location</th>
                              <th className="p-4 text-[10px]">Clock-Out Time</th>
                              <th className="p-4 text-[10px]">Clock-Out Location</th>
                              <th className="p-4 text-[10px] text-right pr-6">Duration</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-stone-100 text-stone-705">
                            {attendances.map((att: any) => {
                              let durStr = "-";
                              if (att.clock_in && att.clock_out) {
                                try {
                                  const s = new Date(att.clock_in);
                                  const e = new Date(att.clock_out);
                                  const hrs = Math.abs(e.getTime() - s.getTime()) / 36e5;
                                  durStr = hrs.toFixed(1) + " Hrs";
                                } catch (e) {
                                  durStr = "Error";
                                }
                              } else if (att.clock_in) {
                                durStr = "In Progress";
                              }

                              return (
                                <tr key={att.id || att.date + att.employee_username} className="hover:bg-stone-50/50 transition-colors">
                                  <td className="p-4 pl-6 font-mono font-medium text-stone-500">
                                    {formatLocalDate(att.date)}
                                  </td>
                                  <td className="p-4">
                                    <div className="font-extrabold text-stone-900">{att.employee_name || att.employee_username}</div>
                                    <div className="text-[10px] text-stone-400 font-bold">@{att.employee_username}</div>
                                  </td>
                                  <td className="p-4 font-mono font-medium text-emerald-600">
                                    {formatLocalTime(att.clock_in)}
                                  </td>
                                  <td className="p-4">
                                     {att.clock_in_location ? (
                                        <a href={`https://www.google.com/maps/search/?api=1&query=${att.clock_in_location}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-blue-500 hover:underline">
                                           <MapPin className="w-3 h-3" />
                                           <span className="text-[10px] font-mono">{att.clock_in_location}</span>
                                        </a>
                                     ) : (
                                        <span className="text-stone-300 text-[10px]">N/A</span>
                                     )}
                                  </td>
                                  <td className="p-4 font-mono font-medium text-stone-500">
                                    {att.clock_out ? formatLocalTime(att.clock_out) : <span className="bg-amber-50 text-amber-600 text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider">Active</span>}
                                  </td>
                                  <td className="p-4">
                                     {att.clock_out_location ? (
                                        <a href={`https://www.google.com/maps/search/?api=1&query=${att.clock_out_location}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-blue-500 hover:underline">
                                           <MapPin className="w-3 h-3" />
                                           <span className="text-[10px] font-mono">{att.clock_out_location}</span>
                                        </a>
                                     ) : (
                                        <span className="text-stone-300 text-[10px]">N/A</span>
                                     )}
                                  </td>
                                  <td className="p-4 text-right pr-6 font-mono text-stone-800">
                                    {durStr}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* LEAVE TAB */}
              {adminTab === 'LEAVE' && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-500 mt-6">
                  <div className="bg-white/80 backdrop-blur-md rounded-[32px] p-8 border border-stone-200">
                    <div className="flex justify-between items-center mb-6">
                      <h2 className="text-xl font-black text-stone-900">Leave Approvals & Management</h2>
                      <div className={cn(
                        "px-4 py-2 font-bold text-xs uppercase tracking-wider rounded-xl",
                        leaves.filter(l => l.status === 'PENDING').length > 0 
                          ? "bg-amber-50 text-amber-700 border border-amber-100" 
                          : "bg-emerald-50 text-emerald-700 border border-emerald-100"
                      )}>
                        {leaves.filter(l => l.status === 'PENDING').length} Pending Requests
                      </div>
                    </div>

                    {leaves.length === 0 ? (
                      <div className="col-span-full py-20 text-center bg-stone-50 rounded-[2.5rem] border border-stone-200 border-dashed">
                        <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4 text-emerald-500">
                          <CheckSquare className="w-8 h-8" />
                        </div>
                        <p className="text-stone-500 font-bold mb-1">All caught up!</p>
                        <p className="text-xs text-stone-400">There are no staff leave or out-of-office requests to review.</p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {leaves.map((lv: any) => {
                          const s = new Date(lv.start_date);
                          const e = new Date(lv.end_date);
                          let daysCount = 0;
                          try {
                            const diffTime = Math.abs(e.getTime() - s.getTime());
                            daysCount = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
                          } catch (_) {}

                          return (
                            <div key={lv.id} className="bg-stone-50/50 p-6 rounded-[2rem] border border-stone-200 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-base font-extrabold text-stone-900">{lv.employee_name || lv.employee_username}</span>
                                  <span className="text-xs font-bold text-stone-400">@{lv.employee_username}</span>
                                </div>
                                <div className="flex flex-wrap gap-2 text-xs font-extrabold text-stone-700 items-center">
                                  <span className="bg-stone-150 px-2.5 py-1 rounded-lg text-stone-800 uppercase tracking-wider text-[10px]">{lv.leave_type}</span>
                                  <span>{formatLocalDate(lv.start_date)} - {formatLocalDate(lv.end_date)} ({daysCount} Days)</span>
                                </div>
                                {lv.reason && (
                                  <p className="text-stone-500 font-medium italic text-xs pl-3 border-l-2 border-stone-300 mt-2">
                                    &ldquo;{lv.reason}&rdquo;
                                  </p>
                                )}
                                {lv.status !== 'PENDING' && lv.approver_name && (
                                  <div className="text-[10px] text-stone-400 font-bold mt-1">
                                    Reviewed by: {lv.approver_name} (@{lv.approved_by})
                                  </div>
                                )}
                              </div>

                              <div className="flex items-center gap-3">
                                {lv.status === 'PENDING' ? (
                                  <>
                                    <button 
                                      onClick={() => handleLeaveStatusUpdate(lv.id, 'REJECTED')}
                                      className="px-4 py-2 hover:bg-stone-150 border border-stone-300 bg-white text-stone-700 text-xs font-black uppercase tracking-wider rounded-xl transition-all"
                                    >
                                      Reject
                                    </button>
                                    <button 
                                      onClick={() => handleLeaveStatusUpdate(lv.id, 'APPROVED')}
                                      className="px-4 py-2 bg-[#b02524] text-white hover:bg-[#861d1c] text-xs font-black uppercase tracking-wider rounded-xl transition-all shadow-md"
                                    >
                                      Approve
                                    </button>
                                  </>
                                ) : (
                                  <span className={cn(
                                    "px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest border",
                                    lv.status === 'APPROVED' ? "bg-emerald-50 text-emerald-700 border-emerald-150" : "bg-red-50 text-red-700 border-red-150"
                                  )}>
                                    {lv.status}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* PAYROLL TAB */}
              {adminTab === 'PAYROLL' && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-500 mt-6">
                  <div className="bg-white/80 backdrop-blur-md rounded-[32px] p-8 border border-stone-200">
                    <div className="flex justify-between items-center mb-6">
                      <h2 className="text-xl font-black text-stone-900">Payroll Cycle Management</h2>
                      <button 
                        onClick={() => {
                          setPayslipEmployee(users[0]?.username || '');
                          setPayslipMonth('June 2026');
                          setPayslipBasic(4500000);
                          setPayslipAllowances(500000);
                          setPayslipDeductions(100000);
                          setIsPayslipModalOpen(true);
                        }}
                        className="px-5 py-2.5 bg-[#b02524] text-white rounded-[2rem] font-bold text-sm shadow-md flex items-center gap-2 hover:bg-[#861d1c] transition-all"
                      >
                        <Plus className="w-4 h-4"/> Build Cycle Run
                      </button>
                    </div>
                    
                    <div className="bg-stone-50 p-6 rounded-[2rem] border border-stone-200 flex items-center justify-between mb-6">
                      <div>
                        <h3 className="font-bold text-stone-900">Current Period: June 2026</h3>
                        <p className="text-stone-500 text-sm mt-1">
                          {payslips.length > 0 ? "Payslips generated & active" : "Pending Generation"}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-black text-stone-900">
                          {payslips.filter(p => p.period_month === 'June 2026').length} / {users.length}
                        </p>
                        <p className="text-xs font-bold text-stone-400 uppercase tracking-widest mt-1">Payslips Dispatched</p>
                      </div>
                    </div>

                    {payslips.length === 0 ? (
                      <div className="col-span-full py-12 text-center bg-white rounded-[2.5rem] border border-stone-200 shadow-sm border-dashed">
                        <div className="w-16 h-16 bg-stone-100 rounded-full flex items-center justify-center mx-auto mb-4 text-stone-400">
                          <DollarSign className="w-8 h-8" />
                        </div>
                        <p className="text-stone-500 font-bold">No payslips have been generated yet for this period.</p>
                        <p className="text-sm mt-1 text-stone-400">Clicking 'Build Cycle Run' will open the payslip generator panel for any active users.</p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto rounded-[1.5rem] border border-stone-150">
                        <table className="w-full text-left font-bold text-xs border-collapse">
                          <thead>
                            <tr className="bg-stone-50 text-stone-500 uppercase tracking-widest border-b border-stone-150">
                              <th className="p-4 pl-6 text-[10px]">Payslip ID</th>
                              <th className="p-4 text-[10px]">Staff name</th>
                              <th className="p-4 text-[10px]">Period</th>
                              <th className="p-4 text-right text-[10px]">Basic Salary</th>
                              <th className="p-4 text-right text-[10px]">Allowances</th>
                              <th className="p-4 text-right text-[10px]">Deductions</th>
                              <th className="p-4 text-right pr-6 text-[10px]">Net salary</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-stone-100 text-stone-705">
                            {payslips.map((pay: any) => (
                              <tr key={pay.id} className="hover:bg-stone-50/50 transition-colors">
                                <td className="p-4 pl-6 font-mono font-medium text-stone-500">{pay.id}</td>
                                <td className="p-4">
                                  <div className="font-extrabold text-stone-900">{pay.employee_name || pay.employee_username}</div>
                                  <div className="text-[10px] text-stone-400 font-bold">@{pay.employee_username}</div>
                                </td>
                                <td className="p-4 font-mono font-bold text-stone-700">{pay.period_month}</td>
                                <td className="p-4 text-right font-mono text-stone-500">{formatRupiah(pay.basic_salary)}</td>
                                <td className="p-4 text-right font-mono text-emerald-600">+{formatRupiah(pay.allowances)}</td>
                                <td className="p-4 text-right font-mono text-rose-600">-{formatRupiah(pay.deductions)}</td>
                                <td className="p-4 text-right pr-6 font-mono font-extrabold text-stone-900">{formatRupiah(pay.net_salary)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}
                
                {/* 1. TAB: JOB VACANCIES */}
                {adminTab === 'VACANCIES' && (
                  <div className="mt-8">
                    {filteredJobs.length === 0 ? (
                      <div className="col-span-full py-20 text-center bg-white/50 rounded-[40px] border border-white">
                        <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-300">
                          <Briefcase className="w-8 h-8" />
                        </div>
                        <p className="text-slate-500 font-medium">No active vacancies listed.</p>
                        <p className="text-xs mt-1 text-slate-400">Time to hunt for new talent!</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                        {filteredJobs.map((job) => {
                          let reqs: string[] = [];
                          let bens: string[] = [];
                          try {
                            reqs = JSON.parse(job.requirements);
                            bens = JSON.parse(job.benefits);
                          } catch (e) {
                            reqs = job.requirements ? [job.requirements] : [];
                            bens = job.benefits ? [job.benefits] : [];
                          }

                          return (
                            <div 
                              key={job.id} 
                              className="bg-white/80 backdrop-blur-md rounded-[32px] border border-white shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 flex flex-col justify-between overflow-hidden group"
                            >
                              <div className="p-6">
                                <div className="flex justify-between items-start mb-4">
                                  <div className="flex flex-wrap gap-2">
                                    <span className="px-3 py-1.5 bg-violet-100 text-violet-700 text-xs font-bold rounded-full border border-violet-200">
                                      {job.department}
                                    </span>
                                  </div>
                                  <button 
                                    type="button"
                                    onClick={() => handleToggleJobStatus(job)}
                                    className={`px-3 py-1.5 text-[10px] uppercase tracking-wider font-bold rounded-full transition-all flex items-center gap-1.5 ${job.status === 'OPEN' ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-500 border border-slate-200'}`}
                                  >
                                    <span className={`w-2 h-2 rounded-full ${job.status === 'OPEN' ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`}></span>
                                    {job.status}
                                  </button>
                                </div>

                                <h3 className="text-xl font-bold text-slate-800 leading-tight mb-3 group-hover:text-violet-600 transition-colors">{job.title}</h3>

                                <div className="flex flex-wrap text-xs text-slate-500 gap-3 mb-5 bg-slate-50/50 p-3 rounded-2xl border border-slate-100">
                                  <span className="flex items-center gap-1 font-medium"><MapPin className="h-3.5 w-3.5 text-slate-400" /> {job.location}</span>
                                  <span className="flex items-center gap-1 font-medium"><Clock className="h-3.5 w-3.5 text-slate-400" /> {job.type}</span>
                                  {job.salary_string && <span className="flex items-center gap-1 font-bold text-slate-700"><DollarSign className="h-3.5 w-3.5 text-emerald-500" /> {job.salary_string}</span>}
                                </div>

                                <p className="text-sm text-slate-600 line-clamp-3 mb-5 leading-relaxed">{job.description}</p>

                                <div className="space-y-2 mb-2">
                                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Core Requirements</span>
                                  <ul className="text-xs text-slate-700 space-y-1.5">
                                    {reqs.slice(0, 3).map((r, i) => (
                                      <li key={i} className="flex items-start gap-1.5 font-medium"><ChevronRight className="h-3 w-3 text-violet-400 shrink-0 mt-0.5" /> <span className="line-clamp-1">{r}</span></li>
                                    ))}
                                    {reqs.length > 3 && <li className="text-[10px] text-violet-500 font-bold ml-5">+{reqs.length - 3} MORE SKILLS</li>}
                                  </ul>
                                </div>
                              </div>

                              {/* ACTIONS GRID */}
                              <div className="p-4 bg-slate-50/80 border-t border-slate-100 flex items-center justify-between gap-2 mt-auto">
                                <button 
                                  type="button"
                                  onClick={() => { resetJobForm(job); setIsJobModalOpen(true); }}
                                  className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold rounded-full transition-colors border border-slate-200 shadow-sm w-full"
                                >
                                  Edit Listing
                                </button>
                                <button 
                                  type="button"
                                  onClick={() => handleDeleteJob(job.id)}
                                  className="p-2.5 bg-white hover:bg-rose-50 text-rose-500 rounded-full transition-colors border border-slate-200 shadow-sm shrink-0"
                                  title="Delete Vacancy"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* 2. TAB: CANDIDATES PIPELINE (KANBAN) */}
                {adminTab === 'CANDIDATES' && (
                  <div className="mt-8 space-y-6">
                    {/* Pipeline Info & Quick-Filters Bar */}
                    <div className="bg-white p-6 rounded-[2rem] border border-stone-200/80 shadow-sm flex flex-col md:flex-row justify-between items-stretch md:items-center gap-4">
                      <div>
                        <h3 className="text-lg font-black text-stone-800 flex items-center gap-2">
                          <span>Sourced Talent Pipeline</span>
                          <span className="px-3 py-1 bg-[#b02524]/10 text-[#b02524] text-[10px] rounded-full uppercase tracking-widest font-extrabold font-mono">
                            {filteredApps.length} Candidates
                          </span>
                        </h3>
                        <p className="text-stone-500 text-xs mt-1 font-medium">
                          Evaluate applications, track background screening, arrange panels, and move hires with instant stage controls.
                        </p>
                      </div>

                      {/* Dropdown position selector & statistics summary */}
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="flex items-center gap-2 bg-stone-50 border border-stone-200 rounded-2xl px-3 py-2 shrink-0">
                          <Briefcase className="w-3.5 h-3.5 text-stone-400" />
                          <select
                            value={filterJobId}
                            onChange={(e) => setFilterJobId(e.target.value)}
                            className="bg-transparent border-none text-xs font-black text-stone-700 focus:outline-none cursor-pointer p-0"
                          >
                            <option value="ALL">All Open & Closed Vacancies</option>
                            {jobs.map(j => (
                              <option key={j.id} value={j.id}>{j.title} ({j.department})</option>
                            ))}
                          </select>
                        </div>

                        {filterJobId !== 'ALL' && (
                          <button 
                            onClick={() => setFilterJobId('ALL')}
                            className="text-[10px] font-extrabold text-[#b02524] uppercase tracking-wider hover:underline"
                          >
                            Reset Filter
                          </button>
                        )}
                      </div>
                    </div>

                    {filteredApps.length === 0 ? (
                      <div className="py-24 text-center bg-white/50 rounded-[2.5rem] border border-stone-200 flex flex-col items-center justify-center">
                        <div className="w-16 h-16 bg-stone-100 rounded-full flex items-center justify-center mb-4 text-stone-300">
                          <Users className="w-8 h-8" />
                        </div>
                        <p className="text-stone-600 font-extrabold text-base">No matches found in candidate pool.</p>
                        <p className="text-xs text-stone-400 mt-1 max-w-sm">
                          Try searching for different keywords, clear the search filter, or change the Vacancy target selector.
                        </p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                        
                        {/* LEFT COLUMN: Candidate Directory & Phase Filtering */}
                        <div className="lg:col-span-5 bg-white border border-stone-200 p-5 rounded-[2.5rem] shadow-sm space-y-5 flex flex-col">
                          
                          {/* Mini Header & Stage selection */}
                          <div>
                            <div className="flex justify-between items-center mb-3">
                              <span className="text-[11px] font-black uppercase tracking-widest text-stone-400">Recruitment Stages</span>
                              <span className="px-2.5 py-0.5 bg-stone-100 text-[10px] rounded-full text-stone-600 font-bold border border-stone-150">
                                {filteredApps.length} Total Sourced
                              </span>
                            </div>
                            
                            {/* Colorful stage selection grid */}
                            <div className="grid grid-cols-3 gap-1.5 bg-stone-50 p-2 rounded-2xl border border-stone-150 text-[10px] font-black">
                              {[
                                { key: 'ALL', label: 'All Pool' },
                                { key: 'APPLIED', label: 'Applied' },
                                { key: 'SCREENING', label: 'Screening' },
                                { key: 'INTERVIEW', label: 'Interview' },
                                { key: 'OFFER_MADE', label: 'Proposal' },
                                { key: 'ACCEPTED', label: 'Hired' },
                                { key: 'REJECTED', label: 'Archived' }
                              ].map((stageItem) => {
                                // Count of candidates matching this status
                                const stageCount = stageItem.key === 'ALL' 
                                  ? filteredApps.length 
                                  : filteredApps.filter(a => a.status === stageItem.key).length;
                                
                                const isActive = selectedStageFilter === stageItem.key;
                                
                                return (
                                  <button
                                    key={stageItem.key}
                                    type="button"
                                    onClick={() => setSelectedStageFilter(stageItem.key)}
                                    className={cn(
                                      "px-2 py-2 rounded-xl text-center transition-all flex flex-col items-center justify-between gap-1 border cursor-pointer",
                                      isActive 
                                        ? "bg-stone-900 border-stone-900 text-white shadow-sm font-black" 
                                        : "bg-white border-stone-200 text-stone-500 hover:text-stone-850 hover:border-stone-400"
                                    )}
                                  >
                                    <span className="truncate max-w-full leading-tight">{stageItem.label}</span>
                                    <span className={cn(
                                      "px-1.5 py-0.2 px-1 text-[9px] rounded-full font-mono font-bold",
                                      isActive ? "bg-[#b02524] text-white" : "bg-stone-100 text-stone-500 border border-stone-200"
                                    )}>
                                      {stageCount}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          {/* Candidates Directory Vertical List */}
                          <div className="space-y-3 max-h-[500px] overflow-y-auto custom-scrollbar pr-1.5">
                            <AnimatePresence mode="popLayout">
                              {(() => {
                                const pool = filteredApps.filter(a => selectedStageFilter === 'ALL' || a.status === selectedStageFilter);
                                
                                if (pool.length === 0) {
                                  return (
                                    <motion.div
                                      initial={{ opacity: 0, y: 5 }}
                                      animate={{ opacity: 1, y: 0 }}
                                      exit={{ opacity: 0, y: -5 }}
                                      className="py-20 text-center text-stone-400 italic text-xs bg-stone-50 rounded-2xl border border-stone-150"
                                    >
                                      No candidates currently in this stage.
                                    </motion.div>
                                  );
                                }

                                return pool.map((app) => {
                                  const isSelected = selectedApp?.id === app.id;
                                  
                                  // Color helper for status badget/borders
                                  const colMeta: Record<string, { label: string; text: string; bg: string; dot: string }> = {
                                    APPLIED: { label: 'Applied', text: 'text-stone-700', bg: 'bg-stone-100/80 border-stone-200', dot: 'bg-stone-400' },
                                    SCREENING: { label: 'Screening', text: 'text-indigo-800', bg: 'bg-indigo-50 border-indigo-150', dot: 'bg-indigo-500' },
                                    INTERVIEW: { label: 'Interview', text: 'text-sky-800', bg: 'bg-sky-50 border-sky-150', dot: 'bg-sky-500' },
                                    OFFER_MADE: { label: 'Proposal', text: 'text-amber-800', bg: 'bg-amber-50 border-amber-150', dot: 'bg-amber-500' },
                                    ACCEPTED: { label: 'Hired ✓', text: 'text-emerald-850', bg: 'bg-emerald-50 border-emerald-150', dot: 'bg-emerald-500' },
                                    REJECTED: { label: 'Archived ✕', text: 'text-rose-850', bg: 'bg-rose-50 border-rose-150', dot: 'bg-rose-500' }
                                  };
                                  const meta = colMeta[app.status] || colMeta.APPLIED;

                                  return (
                                    <motion.button
                                      layout
                                      initial={{ opacity: 0, scale: 0.95 }}
                                      animate={{ opacity: 1, scale: 1 }}
                                      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.15 } }}
                                      transition={{ duration: 0.2 }}
                                      key={app.id} 
                                      type="button"
                                      onClick={() => {
                                        setSelectedApp(app);
                                        setReviewStatus(app.status);
                                        setReviewNotes(app.notes || '');
                                      }}
                                      className={cn(
                                        "w-full text-left p-4 rounded-3xl border transition-all duration-300 flex items-start gap-3 group relative overflow-hidden cursor-pointer",
                                        isSelected 
                                          ? "bg-white border-[#b02524] ring-2 ring-[#b02524]/10 shadow-md"
                                          : "bg-stone-50 hover:bg-white border-stone-200 hover:border-stone-400 shadow-sm"
                                      )}
                                    >
                                      {/* Accent colored vertical line marker */}
                                      <div className={cn("absolute top-0 left-0 w-1 h-full", meta.dot)} />

                                      {/* Candidate initials circle */}
                                      <div className={cn(
                                        "w-9 h-9 rounded-full font-black text-xs flex items-center justify-center shrink-0 border",
                                        isSelected ? "bg-[#b02524]/10 border-[#b02524]/20 text-[#b02524]" : "bg-white border-stone-250 text-stone-500"
                                      )}>
                                        {app.name.substring(0, 2).toUpperCase()}
                                      </div>

                                      <div className="flex-1 min-w-0">
                                        <div className="flex justify-between items-start gap-2">
                                          <p className="font-extrabold text-stone-900 text-xs truncate group-hover:text-[#b02524] transition-colors">
                                            {app.name}
                                          </p>
                                          <span className={cn("px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider border shrink-0", meta.bg, meta.text)}>
                                            {meta.label}
                                          </span>
                                        </div>

                                        <p className="text-[10px] text-stone-500 font-extrabold truncate mt-0.5">{app.job_title}</p>
                                        
                                        <div className="flex justify-between items-center text-[10px] text-stone-400 font-bold mt-2 pt-2 border-t border-stone-200/50">
                                          <span className="bg-white px-1.5 py-0.5 rounded border border-stone-150 text-stone-500 text-[9px] shrink-0 font-mono">
                                            Exp: {app.experience || 'None'}
                                          </span>
                                          <span>
                                            {new Date(app.applied_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                                          </span>
                                        </div>
                                      </div>
                                    </motion.button>
                                  );
                                });
                              })()}
                            </AnimatePresence>
                          </div>

                        </div>

                        {/* RIGHT COLUMN: Active Selected Candidate Workspace & Evaluation Panel */}
                        {(() => {
                          const activeApp = selectedApp ? (applications.find(a => a.id === selectedApp.id) || selectedApp) : null;

                          if (!activeApp) {
                            return (
                              <div className="lg:col-span-7 bg-white border border-stone-200 rounded-[2.5rem] p-10 flex flex-col items-center justify-center text-center space-y-4 min-h-[460px]">
                                <div className="w-16 h-16 bg-stone-50 rounded-full flex items-center justify-center text-stone-300 border border-stone-150 shadow-inner">
                                  <ClipboardList className="w-8 h-8" />
                                </div>
                                <div className="max-w-md">
                                  <h4 className="text-sm font-black text-stone-850 uppercase tracking-widest">Select Candidate Dossier</h4>
                                  <p className="text-xs text-stone-500 mt-2 leading-relaxed font-bold">
                                    Click any applicant on the directory list to examine their background, view qualifications, advance recruitment steps, and launch automated follow-up messages inline.
                                  </p>
                                </div>
                                
                                {/* Recruitment overview pipeline funnel metric card */}
                                <div className="grid grid-cols-3 gap-3 w-full max-w-sm pt-6 mt-4 border-t border-stone-200">
                                  <div className="bg-stone-50 p-2.5 rounded-xl border border-stone-150 text-center">
                                    <span className="text-[9px] text-stone-400 uppercase tracking-wider font-extrabold block">Applied</span>
                                    <span className="text-xs font-mono font-black text-stone-700">{filteredApps.filter(a => a.status === 'APPLIED').length}</span>
                                  </div>
                                  <div className="bg-amber-50 border border-amber-200/50 p-2.5 rounded-xl text-center">
                                    <span className="text-[9px] text-amber-700 uppercase tracking-wider font-extrabold block">Interviews</span>
                                    <span className="text-xs font-mono font-black text-amber-800">{filteredApps.filter(a => a.status === 'INTERVIEW').length}</span>
                                  </div>
                                  <div className="bg-emerald-50 border border-emerald-200/50 p-2.5 rounded-xl text-center">
                                    <span className="text-[9px] text-emerald-700 uppercase tracking-wider font-extrabold block">Hired</span>
                                    <span className="text-xs font-mono font-black text-emerald-800">{filteredApps.filter(a => a.status === 'ACCEPTED').length}</span>
                                  </div>
                                </div>
                              </div>
                            );
                          }

                          const STATUS_FLOW = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER_MADE', 'ACCEPTED', 'REJECTED'] as const;
                          const curIdx = STATUS_FLOW.indexOf(activeApp.status);

                          return (
                            <div className="lg:col-span-7 bg-white border border-stone-200 p-6 rounded-[2.5rem] shadow-sm space-y-6">
                              
                              {/* Master Candidate Profile Banner Card */}
                              <div className="p-5 bg-stone-50 border border-stone-200 rounded-[2rem] flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 relative overflow-hidden">
                                <div className="absolute top-0 right-0 w-24 h-24 bg-white/60 rounded-full blur-xl -mr-6 -mt-6 pointer-events-none" />
                                
                                <div className="flex items-center gap-3.5 relative z-10 min-w-0">
                                  <div className="w-11 h-11 rounded-2xl bg-stone-900 border border-stone-850 text-yellow-400 font-extrabold text-xs flex items-center justify-center shrink-0 shadow-sm leading-none">
                                    {activeApp.name.substring(0, 2).toUpperCase()}
                                  </div>
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                      <h4 className="font-black text-stone-900 text-sm leading-none truncate">{activeApp.name}</h4>
                                      <span className="px-2 py-0.5 bg-stone-250 text-stone-600 rounded text-[9px] font-black uppercase tracking-widest font-mono shrink-0">
                                        ID: {activeApp.id}
                                      </span>
                                    </div>
                                    <p className="text-[10px] text-stone-500 font-extrabold mt-1">Sourced: {new Date(activeApp.applied_at).toLocaleDateString('id-ID', { dateStyle: 'long', timeZone: 'Asia/Jakarta' })}</p>
                                  </div>
                                </div>

                                <div className="flex flex-wrap items-center gap-2 relative z-10 sm:self-center">
                                  <a 
                                    href={`mailto:${activeApp.email}`}
                                    className="px-3 py-1.5 bg-white hover:bg-stone-100 border border-stone-250 text-stone-700 hover:text-stone-950 rounded-xl text-xs font-black transition-all shadow-sm flex items-center gap-1 leading-none"
                                    title="Send Direct Email"
                                  >
                                    <Mail className="w-3.5 h-3.5" />
                                    <span>Mail Applicant</span>
                                  </a>
                                  {activeApp.linkedin_url && (
                                    <a 
                                      href={activeApp.linkedin_url.startsWith('http') ? activeApp.linkedin_url : `https://${activeApp.linkedin_url}`} 
                                      target="_blank" 
                                      rel="noopener noreferrer" 
                                      className="p-1.5 bg-white hover:bg-stone-50 border border-stone-250 text-sky-600 rounded-xl transition-all shadow-sm flex items-center justify-center"
                                      title="Open LinkedIn Portfolio"
                                    >
                                      <ExternalLink className="w-4 h-4" />
                                    </a>
                                  )}
                                </div>
                              </div>

                              {/* Target Vacancy & Qualification Snapshot */}
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="p-4 bg-stone-10/50 border border-stone-200 rounded-2xl text-xs font-bold space-y-1">
                                  <span className="text-[9px] uppercase tracking-wider text-stone-400 font-black block">Target Position</span>
                                  <p className="text-stone-850 font-black text-xs leading-none">{activeApp.job_title}</p>
                                  <p className="text-[10px] uppercase tracking-widest font-black text-[#b02524]">{activeApp.job_department || 'Factory'}</p>
                                </div>
                                <div className="p-4 bg-stone-10/50 border border-stone-200 rounded-2xl text-xs font-bold space-y-1">
                                  <span className="text-[9px] uppercase tracking-wider text-stone-400 font-black block">Candidate Background</span>
                                  <p className="text-stone-850 font-black text-xs">{activeApp.experience || 'No Specified Background'}</p>
                                  <p className="text-[10px] text-stone-400 font-mono">Contact: {activeApp.phone}</p>
                                </div>
                              </div>

                              {/* CV / Resume Text and Attached File Viewer */}
                              <div className="space-y-2">
                                <div className="flex justify-between items-center">
                                  <span className="text-[10px] font-black text-stone-400 uppercase tracking-widest">Docs & Motivation Letter</span>
                                </div>
                                <div className="p-4 bg-white border border-stone-200 rounded-2xl max-h-[140px] overflow-y-auto custom-scrollbar text-xs leading-relaxed text-stone-600 font-medium">
                                  {(() => {
                                    const text = activeApp.resume_text;
                                    if (!text) return <p className="italic text-stone-400">No application letters entered.</p>;
                                    
                                    const fileRegex = /\[RESUME FILE\]:\s*(\/uploads\/[^\s\n]+)/;
                                    const match = text.match(fileRegex);
                                    
                                    if (match) {
                                      const fileUrl = match[1];
                                      const cleanText = text.replace(fileRegex, "").trim();
                                      return (
                                        <div className="space-y-3">
                                          <div className="flex items-center justify-between bg-stone-50 border border-stone-200 rounded-xl p-2.5">
                                            <div className="flex items-center gap-2 min-w-0">
                                              <div className="p-1.5 bg-red-50 rounded text-[#b02524] flex-shrink-0 border border-red-100">
                                                <FileText className="w-4 h-4" />
                                              </div>
                                              <div className="min-w-0">
                                                <p className="text-xs font-black text-stone-900 truncate">Resume_Candidate.pdf</p>
                                                <p className="text-[9px] text-stone-400 font-bold uppercase tracking-wider">PDF document</p>
                                              </div>
                                            </div>
                                            <a 
                                              href={fileUrl} 
                                              target="_blank" 
                                              rel="noopener noreferrer" 
                                              className="px-3 py-1.5 bg-stone-900 hover:bg-stone-850 text-white text-[10px] font-black uppercase tracking-wider rounded-lg transition-colors flex items-center gap-1 leading-none shadow-sm shrink-0"
                                            >
                                              <Download className="w-3.5 h-3.5" />
                                              Download
                                            </a>
                                          </div>
                                          {cleanText && (
                                            <p className="whitespace-pre-wrap text-[11px] font-semibold text-stone-500 pt-2 border-t border-stone-100">
                                              {cleanText}
                                            </p>
                                          )}
                                        </div>
                                      );
                                    }
                                    return <p className="whitespace-pre-wrap text-[11px] font-semibold">{text}</p>;
                                  })()}
                                </div>
                              </div>

                              {/* Recruitment MILONES & Progression Panel */}
                              <div className="border-t border-stone-150 pt-4 space-y-3">
                                <div className="flex justify-between items-center">
                                  <span className="text-[10px] font-black text-stone-400 uppercase tracking-widest block font-bold">
                                    Step Milestones Process
                                  </span>
                                  <span className="px-2.5 py-0.5 rounded-full bg-stone-100 border border-stone-200 text-stone-700 text-[10px] uppercase tracking-widest font-black font-mono">
                                    Current: {activeApp.status.replace('_', ' ')}
                                  </span>
                                </div>

                                {/* Timeline Stepper dots */}
                                <div className="bg-stone-50 border border-stone-200/60 p-4 rounded-2xl">
                                  <div className="grid grid-cols-5 gap-1 relative select-none">
                                    <div className="absolute top-[14px] left-[10%] right-[10%] h-0.5 bg-stone-200 -z-0" />
                                    
                                    {[
                                      { key: 'APPLIED', num: 1, label: 'Applied' },
                                      { key: 'SCREENING', num: 2, label: 'Screening' },
                                      { key: 'INTERVIEW', num: 3, label: 'Interview' },
                                      { key: 'OFFER_MADE', num: 4, label: 'Proposal' },
                                      { key: 'ACCEPTED', num: 5, label: 'Hired' }
                                    ].map((step, idx) => {
                                      const statusOrder = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER_MADE', 'ACCEPTED', 'REJECTED'];
                                      const curActiveIdx = statusOrder.indexOf(activeApp.status);
                                      const isCompleted = curActiveIdx >= idx;
                                      const isActive = activeApp.status === step.key;

                                      return (
                                        <div key={step.key} className="flex flex-col items-center text-center relative z-10">
                                          <div className={cn(
                                            "w-7.5 h-7.5 rounded-full flex items-center justify-center font-black text-[11px] transition-all duration-300 border",
                                            isCompleted && !isActive ? "bg-emerald-500 border-emerald-500 text-white shadow-sm" : "",
                                            isActive ? "bg-[#b02524] border-[#b02524] text-white shadow-md scale-105" : "",
                                            !isCompleted && !isActive ? "bg-white text-stone-400 border-stone-250" : ""
                                          )}>
                                            {isCompleted && !isActive ? "✓" : step.num}
                                          </div>
                                          <span className={cn(
                                            "text-[9px] font-extrabold mt-1.5 block tracking-tight line-clamp-1",
                                            isActive ? "text-[#b02524]" : "text-stone-500"
                                          )}>
                                            {step.label}
                                          </span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>

                                {/* Flow-progression quick triggers - Ideal for 1-Screen flow */}
                                <div className="flex flex-wrap items-center gap-2 bg-stone-50 p-2.5 rounded-2xl border border-stone-200/80">
                                  <span className="text-[10px] font-black uppercase text-stone-400 tracking-wider block mr-auto pl-1">
                                    Promote Candidate:
                                  </span>

                                  <div className="flex items-center gap-1.5">
                                    {/* Demote */}
                                    {curIdx > 0 && (
                                      <button 
                                        type="button"
                                        onClick={() => {
                                          const prevStatus = STATUS_FLOW[curIdx - 1];
                                          handleQuickStatusChange(activeApp, prevStatus);
                                        }}
                                        className="px-3 py-1.5 bg-white hover:bg-stone-250 text-stone-700 hover:text-stone-900 rounded-xl border border-stone-250 text-xs font-black transition-all flex items-center gap-1 hover:-translate-y-0.5 shadow-sm active:translate-y-0 leading-none cursor-pointer"
                                        title={`Back to ${STATUS_FLOW[curIdx - 1]}`}
                                      >
                                        <ArrowLeft className="w-3.5 h-3.5" />
                                        <span>Demote</span>
                                      </button>
                                    )}

                                    {/* Advance */}
                                    {curIdx < 4 && (
                                      <button 
                                        type="button"
                                        onClick={() => {
                                          const nextStatus = STATUS_FLOW[curIdx + 1];
                                          handleQuickStatusChange(activeApp, nextStatus);
                                        }}
                                        className="px-3.5 py-1.5 bg-[#b02524] hover:bg-[#8e1d1c] text-white rounded-xl border-none text-xs font-black transition-all flex items-center gap-1 hover:-translate-y-0.5 shadow-md active:translate-y-0 leading-none cursor-pointer"
                                        title={`Advance to ${STATUS_FLOW[curIdx + 1]}`}
                                      >
                                        <span>Advance Stage</span>
                                        <ArrowRight className="w-3.5 h-3.5 font-bold" />
                                      </button>
                                    )}

                                    {/* Reject / Sift Out toggle button */}
                                    {activeApp.status !== 'REJECTED' ? (
                                      <button
                                        type="button"
                                        onClick={() => handleQuickStatusChange(activeApp, 'REJECTED')}
                                        className="px-3.5 py-1.5 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 rounded-xl text-xs font-black transition-all flex items-center gap-1 hover:-translate-y-0.5 shadow-sm cursor-pointer"
                                      >
                                        <UserMinus className="w-3.5 h-3.5" />
                                        <span>Reject</span>
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => handleQuickStatusChange(activeApp, 'APPLIED')}
                                        className="px-3.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 border border-emerald-250 text-emerald-800 rounded-xl text-xs font-black transition-all flex items-center gap-1 cursor-pointer"
                                      >
                                        <Users className="w-3.5 h-3.5" />
                                        <span>Reactivate</span>
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {/* Detailed Score card & Saving Notes Form */}
                              <div className="border-t border-stone-200 pt-4 space-y-3">
                                <span className="text-[10px] font-black text-stone-400 uppercase tracking-widest block font-bold">
                                  Dossier Valuation & Evaluation logs
                                </span>
                                
                                <form 
                                  onSubmit={(e) => {
                                    e.preventDefault();
                                    handleSaveAppReview(e);
                                  }}
                                  className="space-y-4"
                                >
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div className="space-y-1.5 flex flex-col">
                                      <label className="text-[10px] font-black text-stone-500 uppercase tracking-widest block ml-1">Stage Milestones Selector</label>
                                      <select 
                                        value={reviewStatus}
                                        onChange={e => setReviewStatus(e.target.value as any)}
                                        className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-xs font-black text-stone-800 focus:border-stone-400 focus:outline-none cursor-pointer"
                                      >
                                        <option value="APPLIED">APPLIED / SOURCED</option>
                                        <option value="SCREENING">SCREENING / EVALUATION</option>
                                        <option value="INTERVIEW">SCHEDULED INTERVIEW</option>
                                        <option value="OFFER_MADE">PROPOSAL CONTRACT SENT</option>
                                        <option value="ACCEPTED">ACCEPTED / STAFF ONBOARDED</option>
                                        <option value="REJECTED">PASSED OVER / ARCHIVED</option>
                                      </select>
                                    </div>
                                    <div className="space-y-1.5 flex flex-col">
                                      <label className="text-[10px] font-black text-stone-500 uppercase tracking-widest block ml-1">Aprovals & Interviewer Feedback</label>
                                      <textarea 
                                        rows={1}
                                        placeholder="Add notes, candidate background screening, reference check..."
                                        value={reviewNotes}
                                        onChange={e => setReviewNotes(e.target.value)}
                                        className="w-full px-4 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs font-bold text-stone-700 focus:border-stone-400 focus:outline-none resize-none"
                                      />
                                    </div>
                                  </div>

                                  <div className="flex justify-end pt-1">
                                    <button
                                      type="submit"
                                      className="px-5 py-2 bg-stone-900 hover:bg-stone-850 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer shadow-sm hover:-translate-y-0.5"
                                    >
                                      Commit Assessment Data
                                    </button>
                                  </div>
                                </form>
                              </div>

                              {/* AUTOMATIC COMMUNICATIONS templates portal */}
                              {(() => {
                                let subject = '';
                                let bodyTemplate = '';
                                
                                if (reviewStatus === 'INTERVIEW') {
                                  subject = `Undangan Interview Kerja - fhtbs HR Recruitment: ${activeApp.name}`;
                                  bodyTemplate = `Halo ${activeApp.name},\n\nTerima kasih telah melamar pekerjaan untuk posisi ${activeApp.job_title} di perusahaan kami. Portofolio Anda terlihat sangat menarik.\n\nKami mengundang Anda pada tahap Wawancara Teknis (Technical Panel Interview):\n- Hari/Tanggal: [Isi tanggal]\n- Waktu: [Isi jam]\n- Platform: Google Meet\n\nMohon kabari kami jika Anda bersedia hadir.\n\nSalam Hangat,\nHR Recruitment fhtbs ERP`;
                                } else if (reviewStatus === 'OFFER_MADE') {
                                  subject = `Employment Agreement Offer - ${activeApp.job_title}: ${activeApp.name}`;
                                  bodyTemplate = `Halo ${activeApp.name},\n\nSelamat! Berdasarkan hasil evaluasi dari tim, kami dengan senang hati memberikan penawaran kerja (Job Offer) untuk posisi ${activeApp.job_title}.\n\nKami menawarkan paket kompensasi komprehensif termasuk tunjangan operasional pabrik. Syarat dan lampiran detail kontrak kerja dapat diunduh pada portal dashboard.\n\nHarap berikan tanggapan sebelum tanggal [Batas Tanggal].\n\nSalam,\nDirektorat Sumber Daya Manusia fhtbs ERP`;
                                } else if (reviewStatus === 'REJECTED') {
                                  subject = `Update Lamaran Pekerjaan - fhtbs Recruitment: ${activeApp.name}`;
                                  bodyTemplate = `Halo ${activeApp.name},\n\nTerima kasih atas waktu dan minat yang Anda berikan untuk melamar posisi ${activeApp.job_title} di perusahaan kami.\n\nSetelah melakukan pemeriksaan mendalam, saat ini kami memutuskan untuk melanjutkan proses perekrutan dengan kandidat lain yang kualifikasinya lebih cocok dengan tantangan pabrik.\n\nKami akan menyimpan profil Anda di pusat talenta untuk proyeksi posisi baru di masa depan.\n\nSemoga sukses dalam perjalanan karier Anda.\n\nSalam Terbaik,\nHR fhtbs ERP`;
                                } else if (reviewStatus === 'ACCEPTED') {
                                  subject = `Selamat Bergabung di fhtbs ERP! Onboarding Checklist: ${activeApp.name}`;
                                  bodyTemplate = `Halo ${activeApp.name},\n\nSelamat bergabung di tim kami! Mulai hari pertama Anda, harap lengkapi dokumen data diri di Staff Service Center.\n\nJadwal Onboarding Hari Pertama:\n- Waktu: Mulai 08:00 WIB\n- Lokasi: Head Office fhtbs ERP\n\nSelamat menempuh tantangan baru!\n\nSalam,\nHR Operations`;
                                }

                                if (!bodyTemplate) return null;

                                return (
                                  <div className="bg-amber-50/40 rounded-2xl border border-amber-200/60 p-4 space-y-2 animate-in fade-in duration-300">
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-1.5 text-xs font-black text-amber-800">
                                        <Mail className="w-4 h-4 text-amber-600" />
                                        <span>Candidate Communication Automatic Mail Template Draft</span>
                                      </div>
                                      
                                      <button 
                                        type="button"
                                        onClick={() => {
                                          navigator.clipboard.writeText(`Subyek: ${subject}\n\n${bodyTemplate}`);
                                          showToast('Communication template copied to clipboard!', 'success');
                                        }}
                                        className="text-[10px] font-black uppercase text-amber-950 bg-amber-100 hover:bg-amber-250 px-3 py-1 bg-amber-200 border-none rounded-lg transition-colors cursor-pointer"
                                      >
                                        Copy Draft Email
                                      </button>
                                    </div>

                                    <div className="bg-white/85 p-3 rounded-xl border border-amber-100 text-[11px] font-mono whitespace-pre-wrap leading-relaxed max-h-[120px] overflow-y-auto text-stone-700">
                                      <strong>Subject:</strong> {subject}<br/><br/>
                                      {bodyTemplate}
                                    </div>
                                  </div>
                                );
                              })()}

                            </div>
                          );
                        })()}

                      </div>
                    )}
                  </div>
                )}

                {/* 3. TAB: APPRAISAL KPI SCORECARDS */}
                {adminTab === 'KPI' && (
                  <div className="mt-8">
                    {filteredKpis.length === 0 ? (
                      <div className="col-span-full py-20 text-center bg-white/50 rounded-[40px] border border-white">
                        <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-300">
                          <Award className="w-8 h-8" />
                        </div>
                        <p className="text-slate-500 font-medium">No performance reviews recorded yet.</p>
                        <p className="text-xs mt-1 text-slate-400 font-normal">Assess and score standard personnel performance with overall KPI matrixes.</p>
                      </div>
                    ) : (
                      <div className="space-y-6">
                        {filteredKpis.map((k) => (
                          <div key={k.id} className="bg-white/80 backdrop-blur-md rounded-[40px] border border-white p-6 md:p-8 shadow-sm flex flex-col lg:flex-row gap-8 items-center transition-all hover:shadow-md">
                            
                            {/* Summary Gauge Left */}
                            <div className="w-full lg:w-[280px] flex flex-col justify-center items-center p-6 bg-gradient-to-b from-slate-50 to-white rounded-[32px] border border-slate-100 text-center shadow-inner relative overflow-hidden">
                              <div className="absolute -top-10 -right-10 w-32 h-32 bg-emerald-100 rounded-full blur-2xl opacity-60 pointer-events-none" />
                              <span className="px-3 py-1 rounded-full bg-white shadow-sm border border-slate-100 text-[10px] font-bold text-violet-500 uppercase tracking-widest">{k.period_name}</span>
                              <div className="mt-4 mb-1">
                                <h4 className="text-xl font-bold text-slate-800 leading-tight">{k.employee_name}</h4>
                                <p className="text-sm text-slate-400 font-medium font-mono mt-1">@{k.employee_username}</p>
                              </div>
                              
                              <div className="my-6 relative flex items-center justify-center">
                                <span className={`text-[56px] leading-[1] font-black tracking-tight ${
                                  k.overall_score >= 85 ? 'text-emerald-500' :
                                  k.overall_score >= 70 ? 'text-amber-500' :
                                  'text-rose-500'
                                }`}>{k.overall_score}</span>
                              </div>

                              <span className={`px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wider ${
                                k.overall_score >= 85 ? 'bg-emerald-100 text-emerald-700' :
                                k.overall_score >= 70 ? 'bg-amber-100 text-amber-700' :
                                'bg-rose-100 text-rose-700'
                              }`}>
                                {k.overall_score >= 85 ? 'Top Talent' : k.overall_score >= 70 ? 'Consistent' : 'Needs Help'}
                              </span>
                            </div>

                            {/* Scores detail Right */}
                            <div className="flex-1 flex flex-col justify-between w-full h-full">
                              <div>
                                <h4 className="text-sm font-bold text-slate-700 mb-4 px-2">Performance Breakdown</h4>
                                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
                                  
                                  {[
                                    { label: 'Comms', score: k.score_communication, color: 'bg-sky-500', bg: 'bg-sky-50' },
                                    { label: 'Productivity', score: k.score_productivity, color: 'bg-emerald-500', bg: 'bg-emerald-50' },
                                    { label: 'Reliability', score: k.score_reliability, color: 'bg-violet-500', bg: 'bg-violet-50' },
                                    { label: 'Leadership', score: k.score_leadership, color: 'bg-amber-500', bg: 'bg-amber-50' },
                                    { label: 'Technical', score: k.score_technical, color: 'bg-rose-500', bg: 'bg-rose-50' },
                                  ].map((metric, idx) => (
                                    <div key={idx} className={`${metric.bg} p-4 rounded-3xl border border-white shadow-sm flex flex-col justify-center items-center text-center`}>
                                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">{metric.label}</span>
                                      <p className="text-xl font-black text-slate-800 mt-1 mb-2">{metric.score}</p>
                                      <div className="w-full bg-white h-2 rounded-full overflow-hidden shadow-inner">
                                        <div className={`${metric.color} h-2 rounded-full`} style={{ width: `${metric.score}%` }} />
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>

                              <div className="bg-slate-50/80 p-5 rounded-3xl border border-slate-100">
                                <h5 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                                  <span>📝</span> Evaluator Comments
                                </h5>
                                <p className="text-sm text-slate-700 leading-relaxed font-medium">"{k.evaluation_notes || "No additional comments."}"</p>
                                <div className="mt-3 flex items-center justify-between border-t border-slate-200/60 pt-3">
                                  <p className="text-[11px] text-slate-400 font-bold">Evaluator: <span className="text-slate-600">{k.evaluator_name || k.evaluator_username}</span></p>
                                  <p className="text-[11px] text-slate-400 font-bold">{new Date(k.created_at).toLocaleDateString('en-US', { timeZone: 'Asia/Jakarta' })}</p>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 4. TAB: RESIGNATION TRANSITIONS HANDOVER */}
                {adminTab === 'HANDOVER' && (
                  <div>
                    {filteredHandovers.length === 0 ? (
                      <div className="bg-white py-16 text-center border rounded-2xl text-stone-400">
                        <Repeat className="h-10 w-10 mx-auto opacity-30 mb-2" />
                        <p className="text-sm font-medium">No active resignation hand-overs registered.</p>
                        <p className="text-xs mt-1 font-normal">Initiate track sheets to pass tasks / keys from resigning to new personnel easily.</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {filteredHandovers.map((ho) => {
                          let checklist: HandoverItem[] = [];
                          try {
                            checklist = JSON.parse(ho.checklist_json);
                          } catch (e) {
                            checklist = [];
                          }

                          const totalCount = checklist.length;
                          const completedCount = checklist.filter(item => item.status === 'COMPLETED').length;
                          const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

                          return (
                            <div key={ho.id} className="bg-white/80 backdrop-blur-md rounded-[32px] border border-white p-6 shadow-sm flex flex-col justify-between transition-all hover:translate-y-[-2px] hover:shadow-lg">
                              <div>
                                <div className="flex justify-between items-start mb-6">
                                  <div className="flex items-center gap-3">
                                    <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center font-bold border-2 border-white shadow-sm z-10 relative">
                                      {ho.resigning_name?.substring(0, 1).toUpperCase() || "L"}
                                    </div>
                                    <div className="w-8 h-0.5 bg-slate-200 -ml-4 -mr-4 relative z-0">
                                      <div className="absolute inset-0 bg-gradient-to-r from-rose-400 to-emerald-400" style={{ width: `${progressPct}%` }} />
                                    </div>
                                    <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center font-bold border-2 border-white shadow-sm z-10 relative">
                                      {ho.successor_name?.substring(0, 1).toUpperCase() || "N"}
                                    </div>
                                  </div>

                                  <span className={`px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider border shadow-sm ${
                                    ho.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
                                    ho.status === 'IN_PROGRESS' ? 'bg-sky-100 text-sky-700 border-sky-200' :
                                    'bg-amber-100 text-amber-700 border-amber-200'
                                  }`}>
                                    {ho.status}
                                  </span>
                                </div>

                                {/* Resigning -> Successor Flow card */}
                                <div className="grid grid-cols-2 gap-4 mb-6">
                                  <div className="bg-slate-50/50 p-3 rounded-2xl border border-slate-100/50 shadow-inner">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Leaving</p>
                                    <p className="font-bold text-slate-800 line-clamp-1">{ho.resigning_name}</p>
                                    <p className="text-[10px] font-medium text-slate-500">@{ho.resigning_username}</p>
                                  </div>
                                  <div className="bg-slate-50/50 p-3 rounded-2xl border border-slate-100/50 shadow-inner">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Successor</p>
                                    <p className="font-bold text-slate-800 line-clamp-1">{ho.successor_name}</p>
                                    <p className="text-[10px] font-medium text-slate-500">@{ho.successor_username}</p>
                                  </div>
                                </div>

                                <div className="mb-6 bg-violet-50/50 p-4 rounded-3xl border border-violet-100/50">
                                  <div className="flex justify-between items-center mb-2">
                                    <span className="text-xs font-bold text-violet-800 uppercase tracking-widest">Handover Checklists</span>
                                    <span className="text-[10px] font-bold bg-white px-2 py-0.5 rounded-full text-violet-600 shadow-sm">{progressPct}% DONE</span>
                                  </div>
                                  <div className="w-full bg-white h-2 rounded-full overflow-hidden mb-4 shadow-inner border border-slate-100/50">
                                    <div className="bg-gradient-to-r from-violet-400 to-fuchsia-400 h-full transition-all duration-500" style={{ width: `${progressPct}%` }} />
                                  </div>

                                  {/* Checklist details */}
                                  <div className="space-y-2 max-h-40 overflow-y-auto pr-1 mt-4">
                                    {checklist.map((item) => (
                                      <button 
                                        type="button" 
                                        key={item.id}
                                        onClick={() => handleToggleHandoverItem(ho, item.id)}
                                        className={`flex items-center text-left w-full focus:outline-none p-2.5 rounded-xl border shadow-sm transition-all ${
                                          item.status === 'COMPLETED' ? 'bg-white border-white grayscale opacity-50' : 'bg-white border-violet-100 hover:border-violet-300'
                                        }`}
                                      >
                                        <div className={`mr-3 shrink-0 flex items-center justify-center w-5 h-5 rounded border ${item.status === 'COMPLETED' ? 'bg-emerald-500 border-emerald-500 text-white' : 'bg-slate-50 border-slate-300'}`}>
                                          {item.status === 'COMPLETED' && <CheckSquare className="w-3.5 h-3.5" />}
                                        </div>
                                        <span className={`text-xs font-medium ${item.status === 'COMPLETED' ? 'text-slate-500 line-through' : 'text-slate-700'}`}>{item.title}</span>
                                      </button>
                                    ))}
                                  </div>
                                </div>

                                {ho.handover_notes && (
                                  <div className="bg-amber-50/50 p-3 rounded-2xl border border-amber-100/50">
                                    <p className="text-[11px] text-slate-600 leading-relaxed"><span className="font-bold text-amber-600 uppercase tracking-widest text-[9px] block mb-1">Notes</span> {ho.handover_notes}</p>
                                  </div>
                                )}
                              </div>
                              <div className="flex justify-between items-center pt-4 border-t border-slate-100 text-[11px] font-medium text-slate-400 mt-4">
                                <div>Target: <span className="text-slate-600 font-bold">{ho.target_last_date}</span></div>
                                <div>Creator: {user?.username}</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* 5. TAB: HR SETTINGS (CMS & Privasi) */}
                {adminTab === 'SETTINGS' && (
                  <div className="space-y-6">
                     <div className="bg-white p-6 md:p-8 rounded-[2rem] border border-stone-200 shadow-sm relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-8 text-stone-100 pointer-events-none"><Globe className="w-40 h-40"/></div>
                        <h3 className="text-xl font-black text-stone-900 mb-2 relative z-10">Headless CMS - Portal Karir</h3>
                        <p className="text-sm text-stone-500 mb-6 relative z-10">Perbarui konten utama yang ditampilkan pada halaman portal publik.</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative z-10">
                           <div className="space-y-4">
                             <div>
                                <label className="text-[10px] font-black text-stone-500 uppercase tracking-widest block mb-2">Pesan Panggilan (Hero Title)</label>
                                <input type="text" value={cmsHeroTitle} onChange={e => setCmsHeroTitle(e.target.value)} placeholder="Membangun Masa Depan Bersama" className="w-full bg-stone-50 border border-stone-200 p-4 rounded-xl text-sm font-bold focus:outline-none focus:border-red-200"/>
                             </div>
                             <div>
                                <label className="text-[10px] font-black text-stone-500 uppercase tracking-widest block mb-2">Subjudul Panggilan (Hero Subtitle)</label>
                                <textarea rows={3} value={cmsHeroSubtitle} onChange={e => setCmsHeroSubtitle(e.target.value)} placeholder="Kami percaya bahwa kekuatan kami..." className="w-full bg-stone-50 border border-stone-200 p-4 rounded-xl text-sm font-medium focus:outline-none focus:border-red-200 resize-none"/>
                             </div>
                           </div>
                           <div className="space-y-4">
                             <div>
                                <label className="text-[10px] font-black text-stone-500 uppercase tracking-widest block mb-2">Benefits (Satu per baris)</label>
                                <textarea rows={7} value={cmsBenefits} onChange={e => setCmsBenefits(e.target.value)} placeholder="- Gaji Kompetitif\n- Makan Siang" className="w-full bg-stone-50 border border-stone-200 p-4 rounded-xl text-sm font-medium focus:outline-none focus:border-red-200 resize-none"/>
                             </div>
                           </div>
                        </div>
                        <div className="mt-6 flex justify-end relative z-10">
                           <button onClick={saveCms} disabled={isSavingCms} className="bg-stone-900 text-white px-8 py-4 rounded-full font-black text-xs uppercase tracking-widest shadow-md hover:bg-stone-800 disabled:opacity-50">
                              {isSavingCms ? "Menyimpan..." : "Simpan Perubahan CMS"}
                           </button>
                        </div>
                     </div>

                     <div className="bg-white p-6 md:p-8 rounded-[2rem] border border-red-200 shadow-sm relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-8 text-red-50 pointer-events-none"><Shield className="w-40 h-40"/></div>
                        <h3 className="text-xl font-black text-red-900 mb-2 relative z-10">Sweeper Engine (Privasi Data)</h3>
                        <p className="text-sm text-stone-600 mb-6 max-w-2xl relative z-10">Menghapus dan menganonimkan (redact) secara massal data personal kandidat yang statusnya <b>REJECTED</b> dan dokumen lamarannya berusia lebih dari <b>6 bulan</b>. Sesuai dengan GDPR dan Standar Pengelolaan Privasi Pelamar.</p>
                        <div className="relative z-10">
                           <button onClick={handleSweepData} disabled={isSweeping} className="bg-red-600 text-white px-8 py-4 rounded-full font-black text-xs uppercase tracking-widest shadow-md hover:bg-red-700 disabled:opacity-50 flex items-center gap-2">
                              <Trash2 className="w-4 h-4" />
                              {isSweeping ? "Memproses Data Lawas..." : "Musnahkan Dokumen Lawas Eksternal"}
                           </button>
                        </div>
                     </div>

                     <div className="bg-white p-6 md:p-8 rounded-[2rem] border border-orange-200 shadow-sm relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-8 text-orange-50 pointer-events-none"><Trash2 className="w-40 h-40"/></div>
                        <h3 className="text-xl font-black text-orange-900 mb-2 relative z-10">Factory Data Reset - HRIS & HR Portal</h3>
                        <p className="text-sm text-stone-600 mb-6 max-w-2xl relative z-10">Mereset semua data pada modul HRIS kembali ke pengaturan pabrik (default). Tindakan ini akan menghapus semua absensi, klaim cuti, slip gaji, KPI penilai, lamaran masuk, lowongan pekerjaan, dan memulihkan data demo awal secara instan.</p>
                        <div className="relative z-10">
                           <button 
                             onClick={() => {
                               if (window.confirm('PERINGATAN KRITIS: Apakah Anda yakin ingin mereset semua data HRIS dan halaman Human Resource kembali ke pengaturan awal pabrik? Tindakan ini bersifat permanen dan tidak dapat dibatalkan.')) {
                                 setIsResettingHris(true);
                                 apiFetch('/api/admin/reset-hris', { method: 'POST' }, user?.username)
                                   .then(res => {
                                     if (res.ok) {
                                       showToast('Sukses mereset data HRIS ke pengaturan pabrik.', 'success');
                                       setTimeout(() => window.location.reload(), 1500);
                                     } else {
                                       showToast(res.error || 'Gagal mereset data HRIS.', 'error');
                                     }
                                   })
                                   .catch(() => showToast('Gagal menghubungi server untuk reset.', 'error'))
                                   .finally(() => setIsResettingHris(false));
                               }
                             }} 
                             disabled={isResettingHris} 
                             className="bg-orange-600 text-white px-8 py-4 rounded-full font-black text-xs uppercase tracking-widest shadow-md hover:bg-orange-700 disabled:opacity-50 flex items-center gap-2"
                           >
                              <AlertTriangle className="w-4 h-4" />
                              {isResettingHris ? "Reset..." : "Reset"}
                           </button>
                        </div>
                     </div>
                  </div>
                )}
              </div>
            )}
          </div>
      </div>

      {/* ==================================================== */}
      {/* 1. MODAL: CREATE / EDIT VACANCIES */}
      {/* ==================================================== */}
      <Modal
        isOpen={isJobModalOpen}
        onClose={() => setIsJobModalOpen(false)}
        title={selectedJob ? 'Update Vacancy' : 'New Vacancy'}
        description="Define the perfect candidate"
        maxWidth="2xl"
      >
        <form onSubmit={handleSaveJob} className="space-y-6">
              <div className="grid grid-cols-2 gap-5">
                <div className="space-y-2 col-span-2">
                  <label className="text-[10px] font-black text-stone-500 uppercase tracking-widest block ml-2">Job vacancy Title <span className="text-[#b02524]">*</span></label>
                  <input 
                    type="text" required placeholder="e.g. Senior Welding Technician" value={jobTitle} onChange={e => setJobTitle(e.target.value)}
                    className="w-full px-5 py-4 bg-stone-50 border border-stone-200 rounded-[1.5rem] text-sm font-bold focus:border-red-200 focus:ring-4 focus:ring-red-50 transition-all outline-none"
                  />
                </div>
                
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-stone-500 uppercase tracking-widest block ml-2">Department <span className="text-[#b02524]">*</span></label>
                  <select 
                    value={jobDept} onChange={e => setJobDept(e.target.value)}
                    className="w-full px-5 py-4 bg-stone-50 border border-stone-200 rounded-[1.5rem] text-sm font-bold focus:border-red-200 focus:ring-4 focus:ring-red-50 transition-all outline-none cursor-pointer"
                  >
                    <option value="Production">Production</option>
                    <option value="Warehouse">Warehouse</option>
                    <option value="Procurement">Procurement</option>
                    <option value="Engineering">Engineering</option>
                    <option value="Finance">Finance</option>
                    <option value="Sales">Sales</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-stone-500 uppercase tracking-widest block ml-2">Location <span className="text-[#b02524]">*</span></label>
                  <input 
                    type="text" required placeholder="e.g. Central Factory" value={jobLoc} onChange={e => setJobLoc(e.target.value)}
                    className="w-full px-5 py-4 bg-stone-50 border border-stone-200 rounded-[1.5rem] text-sm font-bold focus:border-red-200 focus:ring-4 focus:ring-red-50 transition-all outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-5">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-stone-500 uppercase tracking-widest block ml-2">Job Type <span className="text-[#b02524]">*</span></label>
                  <select 
                    value={jobType} onChange={e => setJobType(e.target.value)}
                    className="w-full px-5 py-4 bg-stone-50 border border-stone-200 rounded-[1.5rem] text-sm font-bold focus:border-red-200 focus:ring-4 focus:ring-red-50 transition-all outline-none cursor-pointer"
                  >
                    <option value="Full-time">Full-time</option>
                    <option value="Internship">Internship</option>
                    <option value="Contract">Contract</option>
                    <option value="Freelance">Freelance</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-stone-500 uppercase tracking-widest block ml-2">Salary Range Info</label>
                  <input 
                    type="text" placeholder="e.g. Rp 5.500.000 - Rp 7.000.000" value={jobSalary} onChange={e => setJobSalary(e.target.value)}
                    className="w-full px-5 py-4 bg-stone-50 border border-stone-200 rounded-[1.5rem] text-sm font-bold focus:border-red-200 focus:ring-4 focus:ring-red-50 transition-all outline-none"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-stone-500 uppercase tracking-widest block ml-2">Brief Description <span className="text-[#b02524]">*</span></label>
                <textarea 
                  required rows={3} placeholder="Describe the responsibilities of this position..." value={jobDesc} onChange={e => setJobDesc(e.target.value)}
                  className="w-full px-5 py-4 bg-stone-50 border border-stone-200 rounded-[1.5rem] text-sm font-bold focus:border-red-200 focus:ring-4 focus:ring-red-50 transition-all outline-none resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-5">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-stone-500 uppercase tracking-widest block ml-2">Requirements</label>
                  <textarea 
                    rows={4} value={jobReqs} onChange={e => setJobReqs(e.target.value)}
                    className="w-full px-5 py-4 bg-stone-50 border border-stone-200 rounded-[1.5rem] text-xs font-bold focus:border-red-200 focus:ring-4 focus:ring-red-50 transition-all outline-none resize-none"
                    placeholder="- Minimal S1&#10;- Pengalaman 1 tahun..."
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-stone-500 uppercase tracking-widest block ml-2">Benefits / Perks</label>
                  <textarea 
                    rows={4} value={jobBens} onChange={e => setJobBens(e.target.value)}
                    className="w-full px-5 py-4 bg-stone-50 border border-stone-200 rounded-[1.5rem] text-xs font-bold focus:border-red-200 focus:ring-4 focus:ring-red-50 transition-all outline-none resize-none"
                    placeholder="- Tunjangan Makan&#10;- BPJS Kesehatan..."
                  />
                </div>
              </div>


              <div className="pt-6 flex space-x-3">
                <button type="button" onClick={() => setIsJobModalOpen(false)} className="flex-1 py-4 px-6 bg-stone-100 hover:bg-stone-200 text-stone-600 rounded-[2rem] text-sm font-black uppercase tracking-wider transition-all">
                  Cancel
                </button>
                <button type="submit" className="flex-1 py-4 px-6 bg-[#b02524] hover:bg-[#921e1d] text-white rounded-[2rem] text-sm font-black uppercase tracking-wider transition-all shadow-lg hover:-translate-y-1">
                  Post Vacancy
                </button>
              </div>
            </form>
      </Modal>

      {/* ==================================================== */}
      {/* 2. MODAL: EVALUATE CANDIDATE APPLICATION */}
      {/* ==================================================== */}
      <Modal
        isOpen={!!selectedApp && adminTab !== 'CANDIDATES'}
        onClose={() => setSelectedApp(null)}
        title="Recruitment Dossier & Evaluation Engine"
        description="Verify qualifications, update progress milestones, log panels feedback, and generate communications templates on-the-fly."
        maxWidth="3xl"
      >
        {selectedApp && (
          <div className="text-stone-900 space-y-6">
            
            {/* Visual Recruitment Workflow Path */}
            <div className="bg-stone-50 border border-stone-200/60 p-5 rounded-[2rem] shadow-inner">
              <span className="text-[10px] font-black text-stone-400 uppercase tracking-widest block mb-4 text-center">Recruitment Timeline Milestones</span>
              
              <div className="grid grid-cols-5 gap-2 relative">
                {/* Horizontal progress bar */}
                <div className="absolute top-[18px] left-[10%] right-[10%] h-0.5 bg-stone-200 -z-0"></div>
                
                {[
                  { key: 'APPLIED', num: 1, label: 'Applied' },
                  { key: 'SCREENING', num: 2, label: 'Screening' },
                  { key: 'INTERVIEW', num: 3, label: 'Interview' },
                  { key: 'OFFER_MADE', num: 4, label: 'Proposal' },
                  { key: 'ACCEPTED', num: 5, label: 'Hired' }
                ].map((step, idx) => {
                  const statusOrder = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER_MADE', 'ACCEPTED', 'REJECTED'];
                  const curActiveIdx = statusOrder.indexOf(reviewStatus);
                  const isCompleted = curActiveIdx >= idx;
                  const isActive = reviewStatus === step.key;

                  return (
                    <div key={step.key} className="flex flex-col items-center text-center relative z-10 select-none">
                      <div className={cn(
                        "w-9 h-9 rounded-full flex items-center justify-center font-black text-xs transition-all duration-300",
                        isCompleted && !isActive ? "bg-emerald-500 text-white shadow-md shadow-emerald-200" : "",
                        isActive ? "bg-[#b02524] text-white ring-4 ring-red-100 shadow-md scale-110" : "",
                        !isCompleted && !isActive ? "bg-white text-stone-400 border border-stone-200" : ""
                      )}>
                        {isCompleted && !isActive ? "✓" : step.num}
                      </div>
                      <span className={cn(
                        "text-[10px] font-black mt-2 transition-colors",
                        isActive ? "text-[#b02524] uppercase tracking-wide" : "text-stone-500"
                      )}>
                        {step.label}
                      </span>
                    </div>
                  );
                })}
              </div>

              {reviewStatus === 'REJECTED' && (
                <div className="mt-4 p-2 bg-rose-50 border border-rose-100 rounded-xl text-center">
                  <span className="text-[11px] font-black text-rose-600 uppercase tracking-widest">⚠️ Candidate Sifted out / Filed to Pool</span>
                </div>
              )}
            </div>

            {/* Split Pane: Candidate Profiling vs. Timeline Notes */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Profile Details Column (Lefthand Pane) */}
              <div className="lg:col-span-5 bg-stone-50 border border-stone-200/80 p-5 rounded-[2rem] space-y-4 text-xs">
                <div>
                  <span className="text-[9px] font-black text-stone-400 uppercase tracking-widest block mb-0.5">Applicant Name</span>
                  <p className="font-black text-stone-900 text-sm">{selectedApp.name}</p>
                </div>

                <div>
                  <span className="text-[9px] font-black text-stone-400 uppercase tracking-widest block mb-0.5">Contact Channels</span>
                  <p className="font-extrabold text-stone-700">{selectedApp.email}</p>
                  <p className="font-bold text-stone-500 mt-0.5">{selectedApp.phone}</p>
                </div>

                <div>
                  <span className="text-[9px] font-black text-stone-400 uppercase tracking-widest block mb-0.5">Target Posting Role</span>
                  <p className="font-extrabold text-stone-800">{selectedApp.job_title}</p>
                </div>

                <div>
                  <span className="text-[9px] font-black text-stone-400 uppercase tracking-widest block mb-0.5">Professional Experience</span>
                  <p className="font-bold text-stone-850 bg-white border border-stone-150 px-2.5 py-1 rounded-lg mt-1 w-max">
                    {selectedApp.experience || 'Not Specified'}
                  </p>
                </div>

                {selectedApp.linkedin_url && (
                  <div>
                    <span className="text-[9px] font-black text-stone-400 uppercase tracking-widest block mb-1">LinkedIn Profile</span>
                    <a 
                      href={selectedApp.linkedin_url.startsWith('http') ? selectedApp.linkedin_url : `https://${selectedApp.linkedin_url}`} 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className="text-[#b02524] font-black hover:underline flex items-center gap-1 bg-white border border-stone-150 p-2 rounded-xl"
                    >
                      <span>Visit Portfolio</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                )}
              </div>

              {/* Cover Letter Panel (Righthand Pane) */}
              <div className="lg:col-span-7 space-y-3">
                <span className="text-[10px] font-black text-stone-400 uppercase tracking-widest block mb-1">Motivation Letter & Attached files</span>
                <div className="bg-white border rounded-[1.5rem] p-5 text-stone-600 leading-relaxed border-stone-200 max-h-[250px] overflow-y-auto text-xs custom-scrollbar">
                  {(() => {
                    const text = selectedApp.resume_text;
                    if (!text) return <p className="italic text-stone-400">No application letters entered.</p>;
                    
                    const fileRegex = /\[RESUME FILE\]:\s*(\/uploads\/[^\s\n]+)/;
                    const match = text.match(fileRegex);
                    
                    if (match) {
                      const fileUrl = match[1];
                      const cleanText = text.replace(fileRegex, "").trim();
                      return (
                        <div className="space-y-4">
                          <div className="flex items-center justify-between bg-stone-50 border border-stone-150 rounded-2xl p-3">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="p-2 bg-red-50 rounded-lg text-[#b02524] flex-shrink-0">
                                <FileText className="w-5 h-5" />
                              </div>
                              <div className="min-w-0">
                                <p className="text-xs font-black text-stone-900 truncate">Dokumen Resume/CV</p>
                                <p className="text-[9px] uppercase tracking-wider text-stone-400 font-bold mt-0.5">PDF Format</p>
                              </div>
                            </div>
                            <a 
                              href={fileUrl} 
                              target="_blank" 
                              rel="noopener noreferrer" 
                              className="px-3.5 py-2.5 bg-stone-900 hover:bg-stone-800 text-white text-[10px] font-black uppercase tracking-wider rounded-xl transition-all shadow-md shrink-0 flex items-center gap-1.5"
                            >
                              <Download className="w-3.5 h-3.5" />
                              Unduh
                            </a>
                          </div>
                          {cleanText && (
                            <div className="pt-3 border-t border-stone-50 whitespace-pre-wrap text-stone-600 text-xs font-medium">
                              {cleanText}
                            </div>
                          )}
                        </div>
                      );
                    }
                    return <p className="whitespace-pre-wrap text-xs font-medium">{text}</p>;
                  })()}
                </div>
              </div>

            </div>

            {/* Updates Form & Selection */}
            <form onSubmit={handleSaveAppReview} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-4 border-t border-stone-200">
                
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-stone-500 uppercase tracking-widest block ml-2">Milestone Phase <span className="text-[#b02524]">*</span></label>
                  <select 
                    value={reviewStatus}
                    onChange={e => setReviewStatus(e.target.value as any)}
                    className="w-full px-5 py-4 bg-stone-50 border border-stone-200 rounded-[1.5rem] text-xs font-black text-stone-800 focus:border-red-200 focus:ring-4 focus:ring-red-50 transition-all outline-none cursor-pointer"
                  >
                    <option value="APPLIED">APPLIED / SOURCED</option>
                    <option value="SCREENING">SCREENING / VERIFYING</option>
                    <option value="INTERVIEW">SCHEDULED INTERVIEW</option>
                    <option value="OFFER_MADE">OFFER PROPOSAL SENT</option>
                    <option value="ACCEPTED">OFFER ACCEPTED / ONBOARDED</option>
                    <option value="REJECTED">PASSED OVER / ARCHIVED</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-stone-500 uppercase tracking-widest block ml-2">HR Valuation Notes</label>
                  <textarea 
                    rows={2}
                    placeholder="Provide technical evaluation core, background results, score card info..."
                    value={reviewNotes}
                    onChange={e => setReviewNotes(e.target.value)}
                    className="w-full px-5 py-3.5 bg-stone-50 border border-stone-200 rounded-[1.5rem] text-xs font-bold focus:border-red-200 focus:ring-4 focus:ring-red-50 transition-all outline-none resize-none"
                  />
                </div>

              </div>

              {/* HIGH VALUE: AUTOMATED CORRESPONDENCE CORNER */}
              {(() => {
                // Draft template based on reviewStatus
                let subject = '';
                let bodyTemplate = '';
                
                if (reviewStatus === 'INTERVIEW') {
                  subject = `Undangan Interview Kerja - fhtbs HR Recruitment: ${selectedApp.name}`;
                  bodyTemplate = `Halo ${selectedApp.name},\n\nTerima kasih telah melamar pekerjaan untuk posisi ${selectedApp.job_title} di perusahaan kami. Portofolio Anda terlihat sangat menarik.\n\nKami mengundang Anda pada tahap Wawancara Teknis (Technical Panel Interview):\n- Hari/Tanggal: [Isi tanggal]\n- Waktu: [Isi jam]\n- Platform: Google Meet\n\nMohon kabari kami jika Anda bersedia hadir.\n\nSalam Hangat,\nHR Recruitment fhtbs ERP`;
                } else if (reviewStatus === 'OFFER_MADE') {
                  subject = `Employment Agreement Offer - ${selectedApp.job_title}: ${selectedApp.name}`;
                  bodyTemplate = `Halo ${selectedApp.name},\n\nSelamat! Berdasarkan hasil evaluasi dari tim, kami dengan senang hati memberikan penawaran kerja (Job Offer) untuk posisi ${selectedApp.job_title}.\n\nKami menawarkan paket kompensasi komprehensif termasuk tunjangan operasional pabrik. Syarat dan lampiran detail kontrak kerja dapat diunduh pada portal dashboard.\n\nHarap berikan tanggapan sebelum tanggal [Batas Tanggal].\n\nSalam,\nDirektorat Sumber Daya Manusia fhtbs ERP`;
                } else if (reviewStatus === 'REJECTED') {
                  subject = `Update Lamaran Pekerjaan - fhtbs Recruitment: ${selectedApp.name}`;
                  bodyTemplate = `Halo ${selectedApp.name},\n\nTerima kasih atas waktu dan minat yang Anda berikan untuk melamar posisi ${selectedApp.job_title} di perusahaan kami.\n\nSetelah melakukan pemeriksaan mendalam, saat ini kami memutuskan untuk melanjutkan proses perekrutan dengan kandidat lain yang kualifikasinya lebih cocok dengan tantangan pabrik.\n\nKami akan menyimpan profil Anda di pusat talenta untuk proyeksi posisi baru di masa depan.\n\nSemoga sukses dalam perjalanan karier Anda.\n\nSalam Terbaik,\nHR fhtbs ERP`;
                } else if (reviewStatus === 'ACCEPTED') {
                  subject = `Selamat Bergabung di fhtbs ERP! Onboarding Checklist: ${selectedApp.name}`;
                  bodyTemplate = `Halo ${selectedApp.name},\n\nSelamat bergabung di tim kami! Mulai hari pertama Anda, harap lengkapi dokumen data diri di Staff Service Center.\n\nJadwal Onboarding Hari Pertama:\n- Waktu: Mulai 08:00 WIB\n- Lokasi: Head Office fhtbs ERP\n\nSelamat menempuh tantangan baru!\n\nSalam,\nHR Operations`;
                }

                if (!bodyTemplate) return null;

                return (
                  <div className="bg-amber-50/50 rounded-2xl border border-amber-200/60 p-4 space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-xs font-black text-amber-800">
                        <Mail className="w-4 h-4 text-amber-600" />
                        <span>Pre-written Professional Email Template Launcher</span>
                      </div>
                      
                      <button 
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(`Subyek: ${subject}\n\n${bodyTemplate}`);
                          showToast('Communication draft template copied to clipboard!', 'success');
                        }}
                        className="text-[10px] font-black uppercase text-amber-900 bg-amber-100 hover:bg-amber-200 px-3 py-1.5 rounded-lg transition-colors border border-amber-300/40"
                      >
                        Copy Mail Draft
                      </button>
                    </div>

                    <div className="bg-white/80 p-3 rounded-lg border border-amber-100 text-[11px] font-mono whitespace-pre-wrap leading-relaxed max-h-[140px] overflow-y-auto text-stone-700">
                      <strong>Subject:</strong> {subject}<br/><br/>
                      {bodyTemplate}
                    </div>
                  </div>
                );
              })()}

              <div className="pt-6 flex space-x-3 border-t border-stone-100">
                <button 
                  type="button" 
                  onClick={() => setSelectedApp(null)} 
                  className="flex-1 py-3.5 px-6 bg-stone-150 hover:bg-stone-200 text-stone-700 rounded-full text-xs font-black uppercase tracking-wider transition-all"
                >
                  Close
                </button>
                <button 
                  type="submit" 
                  className="flex-1 py-3.5 px-6 bg-[#b02524] hover:bg-[#921e1d] text-white rounded-full text-xs font-black uppercase tracking-wider transition-all shadow-lg hover:-translate-y-0.5 active:translate-y-0"
                >
                  Apply & Archive Dossier
                </button>
              </div>
            </form>
          </div>
        )}
      </Modal>

      {/* ==================================================== */}
      {/* 3. MODAL: KPI PERFORMANCE ASSESSMENTS */}
      {/* ==================================================== */}
      <Modal
        isOpen={isKpiModalOpen}
        onClose={() => setIsKpiModalOpen(false)}
        title="Appraise Employee KPIs"
        description="Create structural scorecard appraisal matrices spanning five primary work parameters."
        maxWidth="xl"
      >
        <form onSubmit={handleSubmitKpi} className="space-y-6">
              <div className="grid grid-cols-2 gap-5">
                
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-stone-500 uppercase tracking-widest block ml-2">Target staff Member <span className="text-[#b02524]">*</span></label>
                  <select 
                    value={kpiEmployee}
                    onChange={e => setKpiEmployee(e.target.value)}
                    required
                    className="w-full px-5 py-4 bg-stone-50 border border-stone-200 rounded-[1.5rem] text-xs font-black text-stone-800 focus:border-red-200 focus:ring-4 focus:ring-red-50 transition-all outline-none cursor-pointer"
                  >
                    <option value="">-- Choose Employee --</option>
                    {users.map(u => (
                      <option key={u.username} value={u.username}>{u.name} (@{u.username})</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-stone-500 uppercase tracking-widest block ml-2">Appraisal Period <span className="text-[#b02524]">*</span></label>
                  <input 
                    type="text" required placeholder="e.g. Q1 2026, Mid-Year 2026" value={kpiPeriod} onChange={e => setKpiPeriod(e.target.value)}
                    className="w-full px-5 py-4 bg-stone-50 border border-stone-200 rounded-[1.5rem] text-sm font-black focus:border-red-200 focus:ring-4 focus:ring-red-50 transition-all outline-none"
                  />
                </div>
              </div>

              {/* SLIDERS SCOREBOARD CONFIGS */}
              <div className="space-y-6 border border-stone-200 p-6 rounded-[2rem] bg-stone-50/50">
                <span className="text-[10px] font-black text-stone-500 uppercase tracking-widest block mb-4 ml-1">Metrics Scoring (1 - 100)</span>
                
                <div className="space-y-3">
                  <div className="flex justify-between items-center text-xs font-black text-stone-900">
                    <span className="text-stone-700">Communication Metrics</span>
                    <span className="text-amber-600 bg-amber-50 px-3 py-1 rounded-xl shadow-sm border border-amber-100">{scComm} / 100</span>
                  </div>
                  <input 
                    type="range" min={1} max={100} value={scComm} onChange={e => setScComm(Number(e.target.value))}
                    className="w-full accent-amber-500 h-2 rounded-lg bg-stone-200 appearance-none cursor-pointer"
                  />
                </div>

                <div className="space-y-3">
                  <div className="flex justify-between items-center text-xs font-black text-stone-900">
                    <span className="text-stone-700">Productivity & Output Delivery</span>
                    <span className="text-emerald-600 bg-emerald-50 px-3 py-1 rounded-xl shadow-sm border border-emerald-100">{scProd} / 100</span>
                  </div>
                  <input 
                    type="range" min={1} max={100} value={scProd} onChange={e => setScProd(Number(e.target.value))}
                    className="w-full accent-emerald-500 h-2 rounded-lg bg-stone-200 appearance-none cursor-pointer"
                  />
                </div>

                <div className="space-y-3">
                  <div className="flex justify-between items-center text-xs font-black text-stone-900">
                    <span className="text-stone-700">Reliability & Work Attendance</span>
                    <span className="text-blue-600 bg-blue-50 px-3 py-1 rounded-xl shadow-sm border border-blue-100">{scRel} / 100</span>
                  </div>
                  <input 
                    type="range" min={1} max={100} value={scRel} onChange={e => setScRel(Number(e.target.value))}
                    className="w-full accent-blue-500 h-2 rounded-lg bg-stone-200 appearance-none cursor-pointer"
                  />
                </div>

                <div className="space-y-3">
                  <div className="flex justify-between items-center text-xs font-black text-stone-900">
                    <span className="text-stone-700">Leadership & Coordination Capacity</span>
                    <span className="text-purple-600 bg-purple-50 px-3 py-1 rounded-xl shadow-sm border border-purple-100">{scLead} / 100</span>
                  </div>
                  <input 
                    type="range" min={1} max={100} value={scLead} onChange={e => setScLead(Number(e.target.value))}
                    className="w-full accent-purple-500 h-2 rounded-lg bg-stone-200 appearance-none cursor-pointer"
                  />
                </div>

                <div className="space-y-3">
                  <div className="flex justify-between items-center text-xs font-black text-stone-900">
                    <span className="text-stone-700">Technical Knowledge & Equipment Safety</span>
                    <span className="text-[#b02524] bg-red-50 px-3 py-1 rounded-xl shadow-sm border border-red-100">{scTech} / 100</span>
                  </div>
                  <input 
                    type="range" min={1} max={100} value={scTech} onChange={e => setScTech(Number(e.target.value))}
                    className="w-full accent-[#b02524] h-2 rounded-lg bg-stone-200 appearance-none cursor-pointer"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-stone-500 uppercase tracking-widest block ml-2">Evaluation appraisal Notes</label>
                <textarea 
                  rows={4} placeholder="Provide descriptive feedback regarding achievements or areas for improvement..." value={kpiNotes} onChange={e => setKpiNotes(e.target.value)}
                  className="w-full px-5 py-4 bg-stone-50 border border-stone-200 rounded-[1.5rem] text-xs font-bold focus:border-red-200 focus:ring-4 focus:ring-red-50 transition-all outline-none resize-none"
                />
              </div>

              <div className="pt-6 flex space-x-3">
                <button type="button" onClick={() => setIsKpiModalOpen(false)} className="flex-1 py-4 px-6 bg-stone-100 hover:bg-stone-200 text-stone-600 rounded-[2rem] text-sm font-black uppercase tracking-wider transition-all">
                  Cancel
                </button>
                <button type="submit" className="flex-1 py-4 px-6 bg-stone-900 hover:bg-stone-800 text-white rounded-[2rem] text-sm font-black uppercase tracking-wider transition-all shadow-lg hover:-translate-y-1">
                  Save Appraisal Entry
                </button>
              </div>
            </form>
      </Modal>

      {/* ==================================================== */}
      {/* 4. MODAL: CREATE HANDOVER TRANSIT SHEET */}
      {/* ==================================================== */}
      <Modal
        isOpen={isHandoverModalOpen}
        onClose={() => setIsHandoverModalOpen(false)}
        title="Resignation Handover Track"
        description="Map resigning employees to successors with customizable checklists."
        maxWidth="xl"
      >
        <form onSubmit={handleSubmitHandover} className="space-y-6">
              <div className="grid grid-cols-2 gap-5">
                
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-stone-500 uppercase tracking-widest block ml-2">Resigning Staff <span className="text-[#b02524]">*</span></label>
                  <select 
                    value={hoResigning}
                    onChange={e => setHoResigning(e.target.value)}
                    required
                    className="w-full px-5 py-4 bg-stone-50 border border-stone-200 rounded-[1.5rem] text-xs font-black text-stone-800 focus:border-red-200 focus:ring-4 focus:ring-red-50 transition-all outline-none cursor-pointer"
                  >
                    <option value="">-- Choose Leaving Staff --</option>
                    {users.map(u => (
                      <option key={u.username} value={u.username}>{u.name} (@{u.username})</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-stone-500 uppercase tracking-widest block ml-2">Successor <span className="text-[#b02524]">*</span></label>
                  <select 
                    value={hoSuccessor}
                    onChange={e => setHoSuccessor(e.target.value)}
                    required
                    className="w-full px-5 py-4 bg-stone-50 border border-stone-200 rounded-[1.5rem] text-xs font-black text-stone-800 focus:border-red-200 focus:ring-4 focus:ring-red-50 transition-all outline-none cursor-pointer"
                  >
                    <option value="">-- Choose New Handle --</option>
                    {users.map(u => (
                      <option key={u.username} value={u.username}>{u.name} (@{u.username})</option>
                    ))}
                  </select>
                </div>

              </div>

              <div className="grid grid-cols-2 gap-5">
                <div className="space-y-2 col-span-2">
                  <label className="text-[10px] font-black text-stone-500 uppercase tracking-widest block ml-2">Target Finish Date <span className="text-[#b02524]">*</span></label>
                  <input 
                    type="date" required value={hoDate} onChange={e => setHoDate(e.target.value)}
                    className="w-full px-5 py-4 bg-stone-50 border border-stone-200 rounded-[1.5rem] text-sm font-black text-stone-800 focus:border-red-200 focus:ring-4 focus:ring-red-50 transition-all outline-none"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-stone-500 uppercase tracking-widest block ml-2">Handover Checklist Items (one task per line) <span className="text-[#b02524]">*</span></label>
                <textarea 
                  required rows={4} value={hoItemsText} onChange={e => setHoItemsText(e.target.value)}
                  className="w-full px-5 py-4 bg-stone-50 border border-stone-200 rounded-[1.5rem] text-xs font-bold focus:border-red-200 focus:ring-4 focus:ring-red-50 transition-all outline-none resize-none"
                  placeholder="- SOP operasional&#10;- Serah kunci lemari&#10;- Pemindahan akses server..."
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-stone-500 uppercase tracking-widest block ml-2">Notes</label>
                <textarea 
                  rows={3} placeholder="Explain background transitions or coordination details..." value={hoNotes} onChange={e => setHoNotes(e.target.value)}
                  className="w-full px-5 py-4 bg-stone-50 border border-stone-200 rounded-[1.5rem] text-xs font-bold focus:border-red-200 focus:ring-4 focus:ring-red-50 transition-all outline-none resize-none"
                />
              </div>

              <div className="pt-6 flex space-x-3">
                <button type="button" onClick={() => setIsHandoverModalOpen(false)} className="flex-1 py-4 px-6 bg-stone-100 hover:bg-stone-200 text-stone-600 rounded-[2rem] text-sm font-black uppercase tracking-wider transition-all">
                  Cancel
                </button>
                <button type="submit" className="flex-1 py-4 px-6 bg-stone-900 hover:bg-stone-800 text-white rounded-[2rem] text-sm font-black uppercase tracking-wider transition-all shadow-lg hover:-translate-y-1">
                  Start Transition
                </button>
              </div>
            </form>
      </Modal>

      {/* ==================================================== */}
      {/* 5. MODAL: PAYROLL GENERATOR */}
      {/* ==================================================== */}
      <Modal
        isOpen={isPayslipModalOpen}
        onClose={() => setIsPayslipModalOpen(false)}
        title="Generate Employee Payslip"
        description="Draft custom basic salaries, benefits and custom deductions for this month"
        maxWidth="lg"
      >
        <form onSubmit={handleCreatePayslip} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-left">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-stone-500 uppercase tracking-widest block ml-2">Employee <span className="text-[#b02524]">*</span></label>
              <select 
                value={payslipEmployee}
                onChange={e => {
                  setPayslipEmployee(e.target.value);
                }}
                className="w-full px-5 py-4 bg-stone-50 border border-stone-200 rounded-[1.5rem] text-sm font-bold focus:border-red-200 focus:ring-4 focus:ring-red-50 transition-all outline-none cursor-pointer"
                required
              >
                <option value="">Select Employee...</option>
                {users.map(u => (
                  <option key={u.username} value={u.username}>
                    {u.name} (@{u.username})
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-stone-500 uppercase tracking-widest block ml-2">Payroll Month <span className="text-[#b02524]">*</span></label>
              <input 
                type="text"
                required
                placeholder="e.g. June 2026"
                value={payslipMonth}
                onChange={e => setPayslipMonth(e.target.value)}
                className="w-full px-5 py-4 bg-stone-50 border border-stone-200 rounded-[1.5rem] text-sm font-bold focus:border-red-200 focus:ring-4 focus:ring-red-50 transition-all outline-none"
              />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-stone-500 uppercase tracking-widest block ml-2">Basic Salary (IDR) <span className="text-[#b02524]">*</span></label>
              <input 
                type="number"
                required
                value={payslipBasic}
                onChange={e => setPayslipBasic(Number(e.target.value))}
                className="w-full px-5 py-4 bg-stone-50 border border-stone-200 rounded-[1.5rem] text-sm font-bold focus:border-red-200 focus:ring-4 focus:ring-red-50 transition-all outline-none"
              />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-stone-500 uppercase tracking-widest block ml-2">Allowances & Bonuses (IDR)</label>
              <input 
                type="number"
                required
                value={payslipAllowances}
                onChange={e => setPayslipAllowances(Number(e.target.value))}
                className="w-full px-5 py-4 bg-stone-50 border border-stone-200 rounded-[1.5rem] text-sm font-bold focus:border-red-200 focus:ring-4 focus:ring-red-50 transition-all outline-none"
              />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-stone-500 uppercase tracking-widest block ml-2">Deductions & BPJS (IDR)</label>
              <input 
                type="number"
                required
                value={payslipDeductions}
                onChange={e => setPayslipDeductions(Number(e.target.value))}
                className="w-full px-5 py-4 bg-stone-50 border border-stone-200 rounded-[1.5rem] text-sm font-bold focus:border-red-200 focus:ring-4 focus:ring-red-50 transition-all outline-none"
              />
            </div>

            <div className="bg-stone-50 border border-stone-150 rounded-[1.5rem] p-5 flex flex-col justify-center">
              <span className="text-[10px] font-black uppercase tracking-widest text-stone-400">Total Net Salary Formula</span>
              <span className="text-xl font-mono font-black text-stone-900 mt-1">
                {formatRupiah(Number(payslipBasic) + Number(payslipAllowances) - Number(payslipDeductions))}
              </span>
              <span className="text-[10px] text-stone-400 font-medium mt-1">Basic + Allowances - Deductions</span>
            </div>
          </div>

          <div className="pt-6 border-t border-stone-100 flex justify-end gap-3">
            <button 
              type="button" 
              onClick={() => setIsPayslipModalOpen(false)}
              className="px-6 py-3 bg-stone-100 hover:bg-stone-200 text-stone-750 text-xs font-black uppercase tracking-widest rounded-xl transition-all"
            >
              Cancel
            </button>
            <button 
              type="submit" 
              disabled={isSubmittingPayslip}
              className="px-8 py-3 bg-[#b02524] text-white rounded-[1.5rem] font-bold text-xs uppercase tracking-widest shadow-lg shadow-red-100 hover:bg-[#861d1c] transition-all disabled:opacity-50"
            >
              {isSubmittingPayslip ? 'Generating...' : 'Confirm & Dispatch'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal Confirm */}
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
