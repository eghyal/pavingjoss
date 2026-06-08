import { safeFetchJson, apiFetch } from '@/utils/api';
import React, { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { 
  Plus, X, Wrench, Calendar, CheckCircle2, LayoutDashboard, GanttChartSquare, Info,
  Share2, AlertCircle, Library, Factory, TrendingDown, Trash2, FolderKanban, 
  ChevronRight, Package, Clock, ClipboardList, CheckCircle
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useShare } from '@/contexts/ShareContext';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from 'recharts';
import { ConfirmModal } from '@/components/shared/ConfirmModal';
import { PageHeader } from '@/components/shared/PageHeader';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Action, hasPermission } from '@/utils/pbac';

type ViewMode = 'PLANNING' | 'WORKCENTERS' | 'MANPOWER' | 'LIBRARY' | 'PROJECTS';

interface WorkCenter {
  id: string;
  name: string;
  manpower_count: number;
  hours_per_day: number;
  days_per_week: number;
  capacity_per_week: number;
  efficiency_index?: number; // 0.1 to 1.0
  status?: 'ACTIVE' | 'MAINTENANCE' | 'OFFLINE';
}

interface Project {
  id: string;
  name: string;
  due_date: string;
  customer: string;
  remarks: string;
  status: string;
  material_status?: string;
  archived_at?: string;
  tasks: any[];
}

interface Job {
  id: string;
  project: string;
  task: string;
  workCenterId: string;
  workCenterName: string;
  plannedWeek: number;
  requiredHours: number;
  materialStatus: 'READY' | 'PARTIAL' | 'SHORTAGE';
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
}

const getWeekNumber = (d: Date) => {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return weekNo;
};

export default function Production() {
  const [viewMode, setViewMode] = useState<ViewMode>('PROJECTS');
  const [projects, setProjects] = useState<Project[]>([]);
  const [workCenters, setWorkCenters] = useState<WorkCenter[]>([]);
  const [archivedProjects, setArchivedProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Task Modal State
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [selectedTaskProject, setSelectedTaskProject] = useState<string>('');
  const [taskForm, setTaskForm] = useState({
    task_name: '',
    start_date: '',
    end_date: '',
    progress: 0,
    status: 'PENDING',
    work_center_id: '',
    required_hours: 0
  });
  
  // Modals
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [configForm, setConfigForm] = useState<WorkCenter[]>([]);
  const [confirmModal, setConfirmModal] = useState<{isOpen: boolean, title: string, message: string, action: () => void}>({
    isOpen: false, title: '', message: '', action: () => {}
  });

  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTaskProject) return;
    
    if (new Date(taskForm.start_date) > new Date(taskForm.end_date)) {
      return showToast("End date cannot be earlier than start date", "error");
    }

    setIsSubmitting(true);
    try {
      const res = await apiFetch(`/api/projects/${selectedTaskProject}/tasks`, {
        method: 'POST',
        body: JSON.stringify(taskForm)
      }, user?.username);
      if (res.ok) {
        setShowTaskModal(false);
        setTaskForm({ task_name: '', start_date: '', end_date: '', progress: 0, status: 'PENDING', work_center_id: '', required_hours: 0 });
        fetchData();
        showToast("Task added successfully", 'success');
      } else {
        showToast(res.error || "Failed to add task", 'error');
      }
    } catch (err) {
      console.error(err);
      showToast("Failed to add task", 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const { user } = useAuth();
  const { showToast } = useToast();
  const { shareToForum } = useShare();

  const [selectedCenterId, setSelectedCenterId] = useState<string>('');
  const weeks = useMemo(() => {
    const currentWeek = getWeekNumber(new Date());
    return [
      { num: currentWeek, label: 'This Week', sub: `W${currentWeek}` },
      { num: currentWeek + 1, label: 'Next Week', sub: `W${currentWeek + 1}` },
      { num: currentWeek + 2, label: 'Week +2', sub: `W${currentWeek + 2}` },
      { num: currentWeek + 3, label: 'Week +3', sub: `W${currentWeek + 3}` },
      { num: currentWeek + 4, label: 'Week +4', sub: `W${currentWeek + 4}` },
    ];
  }, []);
  const [selectedWeek, setSelectedWeek] = useState<number>(weeks[0].num);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [projRes, archRes, wcRes] = await Promise.all([
        apiFetch('/api/gantt', {}, user?.username),
        apiFetch('/api/projects?archived=true', {}, user?.username),
        apiFetch('/api/work-centers', {}, user?.username)
      ]);
      
      if (projRes.ok) setProjects(Array.isArray(projRes.data) ? projRes.data.filter((p: any) => p && p.id !== 'GENERAL') : []);
      if (archRes.ok) setArchivedProjects(Array.isArray(archRes.data) ? archRes.data.filter((p: any) => p && p.id !== 'GENERAL') : []);
      if (wcRes.ok) {
        const wcData = wcRes.data;
        setWorkCenters(Array.isArray(wcData) ? wcData : []);
        if (Array.isArray(wcData) && wcData.length > 0 && !selectedCenterId) {
          setSelectedCenterId(wcData[0].id);
        }
      }
    } catch (err) {
      console.error(err);
      showToast("Failed to fetch production data", "error");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleUpdateConfig = async () => {
    setIsSubmitting(true);
    try {
      const res = await apiFetch('/api/work-centers/bulk', {
        method: 'POST',
        body: JSON.stringify({ centers: configForm })
      }, user?.username);
      if (res.ok) {
        setShowConfigModal(false);
        fetchData();
        showToast("Configuration updated", "success");
      } else {
        showToast(res.error || "Failed to update config", "error");
      }
    } catch (err) {
      showToast("Error updating config", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Capacity & Jobs (Improved logic for better load distribution)
  const capacityData = useMemo(() => {
    return weeks.map(w => {
      const weekStart = new Date();
      // Simple logic to find the first day of the week for current week index
      const d = new Date();
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
      weekStart.setDate(diff + (weeks.indexOf(w) * 7));
      weekStart.setHours(0,0,0,0);
      
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      weekEnd.setHours(23,59,59,999);

      const data: any = { week: w.label, weekNum: w.num, sub: w.sub };
      
      workCenters.forEach(wc => {
        const load = projects.reduce((acc, p) => {
          const projectTasks = (p?.tasks || []).filter((t: any) => !!t);
          const taskLoad = projectTasks.filter(t => t.work_center_id === wc.id).reduce((sum, t) => {
            const tStart = new Date(t.start_date);
            const tEnd = new Date(t.end_date);
            
            // Overlap check
            if (tStart > weekEnd || tEnd < weekStart) return sum;
            
            // Calculate overlap days
            const overlapStart = new Date(Math.max(tStart.getTime(), weekStart.getTime()));
            const overlapEnd = new Date(Math.min(tEnd.getTime(), weekEnd.getTime()));
            const overlapDays = Math.max(0, Math.ceil((overlapEnd.getTime() - overlapStart.getTime()) / (1000 * 60 * 60 * 24)) + 1);
            
            const totalDays = Math.max(1, Math.ceil((tEnd.getTime() - tStart.getTime()) / (1000 * 60 * 60 * 24)) + 1);
            const hoursPerDay = (t.required_hours || 0) / totalDays;
            
            return sum + (hoursPerDay * overlapDays);
          }, 0);
          return acc + taskLoad;
        }, 0);
        
        data[wc.name] = Math.round(load * 10) / 10;
        const isOperational = (wc.status || 'ACTIVE') === 'ACTIVE';
        data[`${wc.name}_cap`] = isOperational ? (wc.capacity_per_week * (wc.efficiency_index || 1.0)) : 0;
      });
      return data;
    });
  }, [projects, workCenters, weeks]);

  const jobs = useMemo(() => {
    const allJobs: Job[] = [];
    projects.forEach(p => {
      (p?.tasks || []).filter((t: any) => !!t).forEach(t => {
        // Calculate weeks this task spans
        const tStart = new Date(t.start_date);
        const tEnd = new Date(t.end_date);
        
        weeks.forEach(w => {
           const weekStart = new Date();
           const d = new Date();
           const day = d.getDay();
           const diff = d.getDate() - day + (day === 0 ? -6 : 1);
           weekStart.setDate(diff + (weeks.indexOf(w) * 7));
           weekStart.setHours(0,0,0,0);
           const weekEnd = new Date(weekStart);
           weekEnd.setDate(weekStart.getDate() + 6);
           weekEnd.setHours(23,59,59,999);

           if (tStart <= weekEnd && tEnd >= weekStart) {
              const overlapStart = new Date(Math.max(tStart.getTime(), weekStart.getTime()));
              const overlapEnd = new Date(Math.min(tEnd.getTime(), weekEnd.getTime()));
              const overlapDays = Math.max(0, Math.ceil((overlapEnd.getTime() - overlapStart.getTime()) / (1000 * 60 * 60 * 24)) + 1);
              const totalDays = Math.max(1, Math.ceil((tEnd.getTime() - tStart.getTime()) / (1000 * 60 * 60 * 24)) + 1);
              const distributedHours = Math.round(((t.required_hours || 0) / totalDays * overlapDays) * 10) / 10;

              if (distributedHours > 0) {
                allJobs.push({
                  id: `${t.id}-${w.num}`,
                  project: p.name,
                  task: t.task_name,
                  workCenterId: t.work_center_id || '',
                  workCenterName: t.work_center_name || 'N/A',
                  plannedWeek: w.num,
                  requiredHours: distributedHours,
                  materialStatus: (p.material_status as any) || 'READY',
                  status: t.status as any
                });
              }
           }
        });
      });
    });
    return allJobs;
  }, [projects, weeks]);

  const activeJobs = useMemo(() => {
    return jobs.filter(j => j.plannedWeek === selectedWeek && j.workCenterId === selectedCenterId);
  }, [jobs, selectedWeek, selectedCenterId]);

  const selectedCenter = workCenters.find(wc => wc.id === selectedCenterId);
  const currentLoad = capacityData.find(d => d.weekNum === selectedWeek)?.[selectedCenter?.name || ''] || 0;
  const maxCapacity = selectedCenter?.capacity_per_week || 0;

  return (
    <div className="space-y-12 pb-20 animate-in fade-in duration-500">
      <PageHeader
        title="Production Hub"
        subtitle="Resource Capacity & Timeline Workflow"
        icon={<Factory className="w-6 h-6" />}
        actions={
          <div className="flex gap-2">
            <Button 
               size="sm"
               variant="secondary"
               onClick={() => { setConfigForm([...workCenters]); setShowConfigModal(true); }}
               disabled={!hasPermission(user, Action.MANAGE_PRODUCTION_CONFIG)}
               title="Resource Config"
            >
              <Wrench className="w-4 h-4" /> Config
            </Button>
            <Button
              size="icon"
              variant="secondary"
              onClick={fetchData}
              title="Refresh Data"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
            </Button>
          </div>
        }
      />

      {/* Tabs Layout */}
      <div className="flex gap-8 border-b border-stone-100">
        {(['PROJECTS', 'PLANNING'] as ViewMode[]).map((mode) => (
          <button 
            key={mode}
            onClick={() => setViewMode(mode)}
            className={cn(
              "pb-3 text-xs font-bold transition-colors border-b-2 relative -bottom-[1px] tracking-widest uppercase",
              viewMode === mode ? "border-stone-900 text-stone-900" : "border-transparent text-stone-400 hover:text-stone-700"
            )}
          >
            {mode === 'PROJECTS' ? 'Active Projects' : 'Capacity Planning'}
          </button>
        ))}
      </div>

      {viewMode === 'PROJECTS' ? (
        <div className="space-y-8">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-stone-900 uppercase tracking-wide">Live Projects</h3>
              <p className="text-[10px] text-stone-400 mt-1 uppercase font-bold tracking-widest">Ongoing engineering & production cycles</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="px-3 py-1 bg-emerald-50 text-emerald-700 rounded-full text-[10px] font-bold uppercase tracking-wider">{projects.length} Active</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {projects.filter(p => p.status === 'ACTIVE' || p.status === 'HOLD' || p.status === 'FINISHED').map((project) => {
              const completedTasks = project.tasks?.filter(t => t.status === 'COMPLETED').length || 0;
              const totalTasks = project.tasks?.length || 0;
              const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
              const isUrgent = new Date(project.due_date) < new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

              return (
                <div key={project.id} className="bg-white border border-stone-100 rounded-2xl p-6 shadow-sm hover:shadow-md transition-all group flex flex-col h-full">
                  <div className="flex justify-between items-start mb-6">
                    <div className="w-10 h-10 bg-stone-50 rounded-xl flex items-center justify-center group-hover:bg-stone-800 group-hover:text-white transition-colors duration-300">
                      <FolderKanban className="w-5 h-5" />
                    </div>
                    {isUrgent && (
                      <span className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-widest text-red-600 bg-red-50 px-2 py-1 rounded-lg">
                        <Clock className="w-3 h-3" /> Urgent
                      </span>
                    )}
                  </div>

                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[10px] font-mono text-stone-400 font-bold uppercase tracking-tighter bg-stone-50 px-2 py-0.5 rounded">
                        {project.id}
                      </span>
                      <span className="text-[10px] font-bold text-stone-500 uppercase tracking-widest">
                        {project.customer || 'Internal'}
                      </span>
                    </div>
                    <h4 className="text-base font-bold text-stone-900 group-hover:text-stone-900 transition-colors line-clamp-1">{project.name}</h4>
                    <p className="text-xs text-stone-500 mt-2 line-clamp-2 italic leading-relaxed">
                      {project.remarks || "Standard production sequence."}
                    </p>
                  </div>

                  <div className="mt-8 space-y-4">
                    <div className="space-y-2">
                      <div className="flex justify-between text-[10px] font-bold text-stone-400 uppercase tracking-widest">
                        <span>Production Progress</span>
                        <span>{progress}%</span>
                      </div>
                      <div className="h-1.5 w-full bg-stone-50 rounded-full overflow-hidden border border-stone-100">
                        <div 
                          className={cn(
                            "h-full transition-all duration-1000",
                            progress === 100 ? "bg-emerald-500" : "bg-stone-800"
                          )}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 pt-4 border-t border-stone-50">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-stone-50 rounded-lg">
                          <ClipboardList className="w-3 h-3 text-stone-400" />
                        </div>
                        <div className="text-[10px]">
                          <div className="font-bold text-stone-900 leading-none">{totalTasks}</div>
                          <div className="text-stone-400 font-medium uppercase tracking-tighter mt-1">Total Tasks</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-stone-50 rounded-lg">
                          <Clock className="w-3 h-3 text-emerald-500" />
                        </div>
                        <div className="text-[10px]">
                          <div className="font-bold text-stone-900 leading-none">{new Date(project.due_date).toLocaleDateString(undefined, { timeZone: 'Asia/Jakarta' })}</div>
                          <div className="text-stone-400 font-medium uppercase tracking-tighter mt-1">Target Date</div>
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-2 w-full mt-2">
                       <Link 
                        to={`/project/${project.id}`}
                        state={{ from: 'production' }}
                        className="flex-1 py-2.5 bg-white border border-stone-200 text-stone-900 rounded-xl text-xs font-bold hover:bg-stone-800 hover:text-white transition-all duration-300 flex items-center justify-center gap-2 shadow-sm"
                      >
                        Details <ChevronRight className="w-3 h-3" />
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
            {projects.length === 0 && (
              <div className="col-span-full py-20 text-center border-2 border-dashed border-stone-100 rounded-3xl bg-stone-50/50">
                <Package className="w-10 h-10 text-stone-400 mx-auto mb-4" />
                <div className="text-stone-400 font-bold uppercase tracking-widest text-xs">No active production projects</div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-8">
           <div className="bg-white rounded-3xl border border-stone-100 p-8 shadow-sm">
             <h3 className="text-sm font-bold uppercase tracking-widest mb-6">Aggregate Shop Floor Capacity</h3>
             <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={capacityData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                    <XAxis dataKey="week" tick={{ fontSize: 12, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 12, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                    <Tooltip cursor={{ fill: '#F3F4F6' }} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                    {workCenters.map((wc, i) => (
                      <Bar key={wc.id} dataKey={wc.name} stackId="a" fill={['#1c1917', '#44403c', '#78716c', '#a8a29e'][i % 4]} radius={i === workCenters.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
             </div>
           </div>
           
           {/* Bottleneck Analysis */}
           <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {workCenters.map(wc => {
                const totalLoad = capacityData.reduce((acc, d) => acc + (d[wc.name] || 0), 0);
                const totalCap = capacityData.reduce((acc, d) => acc + (d[`${wc.name}_cap`] || 0), 0);
                const avgSaturation = totalCap > 0 ? (totalLoad / totalCap) * 100 : 0;
                const isOverloaded = capacityData.some(d => (d[wc.name] || 0) > (d[`${wc.name}_cap`] || 0));

                return (
                  <div key={wc.id} className={cn(
                    "p-5 rounded-2xl border transition-all shadow-sm flex flex-col justify-between h-36",
                    isOverloaded ? "bg-rose-50 border-rose-100" : "bg-white border-stone-100"
                  )}>
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="text-[10px] font-bold text-stone-400 uppercase tracking-widest leading-none mb-1">Health Indicator</div>
                        <h4 className="text-sm font-bold text-stone-900 uppercase tracking-tight">{wc.name}</h4>
                      </div>
                      {isOverloaded ? (
                        <div className="p-2 bg-rose-500 rounded-lg animate-pulse shadow-lg shadow-rose-200">
                          <AlertCircle className="w-4 h-4 text-white" />
                        </div>
                      ) : (
                        <div className="p-2 bg-emerald-50 rounded-lg">
                          <CheckCircle className="w-4 h-4 text-emerald-500" />
                        </div>
                      )}
                    </div>
                    
                    <div className="mt-4">
                       <div className="flex justify-between items-end mb-1.5">
                          <span className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Saturation Avg.</span>
                          <span className={cn("text-lg font-bold tracking-tight", isOverloaded ? "text-rose-600" : "text-stone-900")}>
                            {Math.round(avgSaturation)}%
                          </span>
                       </div>
                       <div className="h-1.5 w-full bg-stone-100 rounded-full overflow-hidden border border-stone-200/30">
                         <div 
                           className={cn("h-full transition-all duration-1000", isOverloaded ? "bg-rose-500" : "bg-stone-800")} 
                           style={{ width: `${Math.min(avgSaturation, 100)}%` }} 
                         />
                       </div>
                    </div>
                  </div>
                );
              })}
           </div>

           {/* Detailed Week Planning */}
           <div className="grid lg:grid-cols-3 gap-8">
              <div className="lg:col-span-1 border border-stone-100 rounded-3xl p-6 bg-white shadow-sm space-y-6">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-stone-400">Timeline Scope</h3>
                <div className="space-y-2 flex flex-col">
                  {weeks.map(w => (
                    <button
                      key={w.num}
                      onClick={() => setSelectedWeek(w.num)}
                      className={cn("px-4 py-3 rounded-xl text-left border transition-all font-semibold flex justify-between items-center group", selectedWeek === w.num ? "bg-stone-800 border-stone-900 text-white shadow-md active:scale-95" : "bg-stone-50 border-stone-100 text-stone-600 hover:bg-stone-100")}
                    >
                       <span>{w.label}</span>
                       <span className={cn("text-[10px] uppercase", selectedWeek === w.num ? "text-stone-400" : "text-stone-400")}>{w.sub}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="lg:col-span-2 border border-stone-100 rounded-3xl p-6 bg-white shadow-sm flex flex-col">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-[10px] font-bold uppercase tracking-widest text-stone-400">Active Work Center</h3>
                  <select 
                    value={selectedCenterId} 
                    onChange={e => setSelectedCenterId(e.target.value)}
                    className="bg-stone-50 border border-stone-200 rounded-xl px-4 py-2 text-sm font-bold outline-none"
                  >
                    {workCenters.map(wc => <option key={wc.id} value={wc.id}>{wc.name}</option>)}
                  </select>
                </div>
                
                <div className="mb-6 p-6 rounded-2xl bg-[#F9F9F8] border border-stone-100 text-center">
                   <div className="text-[10px] uppercase font-bold text-stone-400 tracking-widest mb-2">Available Capacity (Hours)</div>
                   <div className="text-xl font-bold tracking-tight text-stone-900">
                      {currentLoad} <span className="text-xl text-stone-400">/ {maxCapacity}</span>
                   </div>
                   <div className="w-full bg-stone-200 rounded-full h-1.5 mt-4 overflow-hidden">
                     <div 
                       className={cn("h-full transition-all duration-500", (currentLoad/maxCapacity) > 0.9 ? "bg-red-500" : (currentLoad/maxCapacity) > 0.7 ? "bg-amber-500" : "bg-emerald-500")}
                       style={{ width: `${Math.min((currentLoad/maxCapacity)*100, 100)}%` }}
                     />
                   </div>
                </div>

                <div className="flex-1 overflow-y-auto min-h-[250px]">
                  <div className="space-y-3">
                    {activeJobs.map(job => (
                      <div key={job.id} className="p-4 border border-stone-100 rounded-2xl flex items-center justify-between hover:bg-stone-50 transition-colors">
                        <div>
                          <div className="text-xs font-bold text-stone-900">{job.project}</div>
                          <div className="text-[10px] text-stone-500 uppercase mt-1 tracking-widest">{job.task}</div>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className={cn(
                            "px-2 py-1 text-[8px] font-bold uppercase tracking-widest rounded-md",
                            job.materialStatus === 'READY' ? "bg-emerald-50 text-emerald-600" :
                            job.materialStatus === 'PARTIAL' ? "bg-amber-50 text-amber-600" :
                            "bg-rose-50 text-rose-600"
                          )}>
                            MAT: {job.materialStatus}
                          </span>
                          <div className="text-sm font-bold text-stone-900 bg-stone-100 px-3 py-1 rounded-full">{job.requiredHours}h</div>
                        </div>
                      </div>
                    ))}
                    {activeJobs.length === 0 && (
                      <div className="text-center py-12 text-stone-400 text-sm font-medium">No tasks scheduled for this center in this period.</div>
                    )}
                  </div>
                </div>
              </div>
           </div>
        </div>
      )}

      {/* Config Modal */}
      <Modal
        isOpen={showTaskModal}
        onClose={() => setShowTaskModal(false)}
        maxWidth="lg"
        title={
          <div>
            <h3 className="text-xl font-bold text-stone-900 tracking-tight">Create Production Task</h3>
            <p className="text-xs text-stone-500 mt-1 uppercase tracking-widest font-bold">Project: {selectedTaskProject}</p>
          </div>
        }
      >
        <form onSubmit={handleAddTask} className="space-y-6 pt-2">
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest px-1">Task Name</label>
            <input 
              autoFocus
              required
                  type="text" 
                  value={taskForm.task_name}
                  onChange={e => setTaskForm({...taskForm, task_name: e.target.value})}
                  className="w-full bg-stone-50 hover:bg-white border border-stone-200/50 rounded-xl px-4 py-3 text-sm font-bold text-stone-900 outline-none focus:ring-4 focus:ring-stone-100 focus:border-stone-400 transition-all shadow-sm"
                  placeholder="e.g., Fabrication, Assembly Phase 1"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest px-1">Start Date</label>
                  <input 
                    required
                    type="date" 
                    value={taskForm.start_date}
                    onChange={e => setTaskForm({...taskForm, start_date: e.target.value})}
                    className="w-full bg-stone-50 hover:bg-white border border-stone-200/50 rounded-xl px-4 py-3 text-sm font-bold text-stone-900 outline-none focus:ring-4 focus:ring-stone-100 focus:border-stone-400 transition-all shadow-sm"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest px-1">End Date</label>
                  <input 
                    required
                    type="date" 
                    value={taskForm.end_date}
                    onChange={e => setTaskForm({...taskForm, end_date: e.target.value})}
                    className="w-full bg-stone-50 hover:bg-white border border-stone-200/50 rounded-xl px-4 py-3 text-sm font-bold text-stone-900 outline-none focus:ring-4 focus:ring-stone-100 focus:border-stone-400 transition-all shadow-sm"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest px-1">Work Center</label>
                <Select 
                  required
                  value={taskForm.work_center_id}
                  onChange={e => setTaskForm({...taskForm, work_center_id: e.target.value})}
                  className="w-full bg-stone-50 hover:bg-white border border-stone-200/50 rounded-xl px-4 py-3 text-sm font-bold text-stone-900 outline-none focus:ring-4 focus:ring-stone-100 focus:border-stone-400 transition-all shadow-sm appearance-none cursor-pointer"
                >
                  <option value="">Select Work Center...</option>
                  {workCenters.map(wc => (
                    <option key={wc.id} value={wc.id}>{wc.name} ({wc.capacity_per_week}h/wk)</option>
                  ))}
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest px-1">Required Hours</label>
                <input 
                  required
                  type="number" 
                  min="0.5"
                  step="0.5"
                  value={taskForm.required_hours}
                  onChange={e => setTaskForm({...taskForm, required_hours: parseFloat(e.target.value)})}
                  className="w-full bg-stone-50 hover:bg-white border border-stone-200/50 rounded-xl px-4 py-3 text-sm font-bold text-stone-900 outline-none focus:ring-4 focus:ring-stone-100 focus:border-stone-400 transition-all shadow-sm"
                  placeholder="Estimated hours to complete"
                />
              </div>

              <div className="pt-6 border-t border-stone-100 flex justify-end gap-3 mt-6">
                <Button variant="secondary" type="button" onClick={() => setShowTaskModal(false)}>Cancel</Button>
                <Button 
                  type="submit"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Saving...' : 'Add Task'}
                </Button>
              </div>
        </form>
      </Modal>

      {/* Config Modal */}
      <Modal
        isOpen={showConfigModal}
        onClose={() => setShowConfigModal(false)}
        maxWidth="3xl"
        title="Resource Configuration"
      >
        <div className="space-y-6 max-h-[60vh] overflow-y-auto custom-scrollbar pt-2 pr-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {configForm.map((wc, index) => (
                  <div key={wc.id} className="p-6 bg-stone-50 rounded-2xl border border-stone-200/50">
                    <div className="flex justify-between items-center mb-4">
                       <input 
                         className="bg-transparent border-none text-base font-bold text-stone-900 outline-none w-2/3" 
                         value={wc.name} 
                         onChange={(e) => {
                           const newForm = [...configForm];
                           newForm[index].name = e.target.value;
                           setConfigForm(newForm);
                         }}
                       />
                       <Button 
                         size="icon"
                         variant="danger_soft"
                         onClick={() => {
                           setConfirmModal({
                             isOpen: true,
                             title: "Remove Work Center",
                             message: "Are you sure you want to remove this work center config?",
                             action: () => {
                               setConfigForm(configForm.filter((_, i) => i !== index));
                               setConfirmModal(prev => ({ ...prev, isOpen: false }));
                             }
                           });
                         }}
                       >
                         <Trash2 className="w-5 h-5" />
                       </Button>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <label className="text-[9px] font-bold text-stone-400 uppercase tracking-widest block mb-1">Manpower</label>
                        <input 
                          type="number" 
                          value={wc.manpower_count} 
                          onChange={e => { 
                            const n = [...configForm]; 
                            const val = parseInt(e.target.value) || 0;
                            n[index].manpower_count = val; 
                            n[index].capacity_per_week = val * n[index].hours_per_day * n[index].days_per_week;
                            setConfigForm(n); 
                          }} 
                          className="w-full bg-white border border-stone-200 rounded-lg px-2 py-1.5 text-xs text-center font-bold" 
                        />
                      </div>
                      <div>
                        <label className="text-[9px] font-bold text-stone-400 uppercase tracking-widest block mb-1">H/Day</label>
                        <input 
                          type="number" 
                          value={wc.hours_per_day} 
                          onChange={e => { 
                            const n = [...configForm]; 
                            const val = parseInt(e.target.value) || 0;
                            n[index].hours_per_day = val; 
                            n[index].capacity_per_week = n[index].manpower_count * val * n[index].days_per_week;
                            setConfigForm(n); 
                          }} 
                          className="w-full bg-white border border-stone-200 rounded-lg px-2 py-1.5 text-xs text-center font-bold" 
                        />
                      </div>
                      <div>
                        <label className="text-[9px] font-bold text-stone-400 uppercase tracking-widest block mb-1">D/Week</label>
                        <input 
                          type="number" 
                          value={wc.days_per_week} 
                          onChange={e => { 
                            const n = [...configForm]; 
                            const val = parseInt(e.target.value) || 0;
                            n[index].days_per_week = val; 
                            n[index].capacity_per_week = n[index].manpower_count * n[index].hours_per_day * val;
                            setConfigForm(n); 
                          }} 
                          className="w-full bg-white border border-stone-200 rounded-lg px-2 py-1.5 text-xs text-center font-bold" 
                        />
                      </div>
                    </div>
                    <div className="mt-4 space-y-3">
                      <div>
                        <div className="flex justify-between items-center mb-1">
                          <label className="text-[9px] font-bold text-stone-400 uppercase tracking-widest">Efficiency Rate</label>
                          <span className="text-[10px] font-bold text-stone-900">{(wc.efficiency_index || 1.0) * 100}%</span>
                        </div>
                        <input 
                          type="range" 
                          min="0.1" 
                          max="1.0" 
                          step="0.05"
                          value={wc.efficiency_index || 1.0}
                          onChange={e => {
                            const n = [...configForm];
                            n[index].efficiency_index = parseFloat(e.target.value);
                            setConfigForm(n);
                          }}
                          className="w-full h-1.5 bg-stone-200 rounded-lg appearance-none cursor-pointer accent-stone-900"
                        />
                      </div>
                      <div className="flex gap-2">
                        {(['ACTIVE', 'MAINTENANCE', 'OFFLINE'] as const).map(status => (
                          <button
                            key={status}
                            type="button"
                            onClick={() => {
                              const n = [...configForm];
                              n[index].status = status;
                              setConfigForm(n);
                            }}
                            className={cn(
                              "flex-1 py-1.5 rounded-lg text-[8px] font-bold uppercase tracking-widest border transition-all",
                              wc.status === status || (!wc.status && status === 'ACTIVE')
                                ? "bg-stone-800 text-white border-stone-900"
                                : "bg-white text-stone-400 border-stone-100 hover:border-stone-200"
                            )}
                          >
                            {status}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="mt-4 pt-4 border-t border-stone-200/50 flex justify-between items-center">
                       <span className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Effective Cap:</span>
                       <span className="text-xs font-bold text-stone-900 bg-white px-3 py-1 rounded-full border border-stone-200">
                         {Math.round(wc.capacity_per_week * (wc.efficiency_index || 1.0))} Hours/Week
                       </span>
                    </div>
                  </div>
                ))}
              </div>
              <button 
                onClick={() => setConfigForm([...configForm, { id: 'WC-' + Math.random().toString(36).substr(2,9), name: 'New Shop', manpower_count: 5, hours_per_day: 8, days_per_week: 5, capacity_per_week: 200 }])}
                className="w-full py-4 border-2 border-dashed border-stone-200 rounded-2xl text-stone-400 font-medium hover:bg-stone-50 transition-all flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" /> Add Work Center
              </button>
            </div>
            <div className="p-8 border-t border-stone-100 flex justify-end gap-3 mt-6">
              <Button variant="secondary" onClick={() => setShowConfigModal(false)}>Discard</Button>
              <Button 
                onClick={handleUpdateConfig}
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Saving...' : 'Confirm Calibration'}
              </Button>
            </div>
      </Modal>
      {/* Confirm Modal */}
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

const Maximize2 = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>;
