import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { apiFetch } from '@/utils/api';
import { PageHeader } from '@/components/shared/PageHeader';
import { Loader } from '@/components/shared/Loader';
import { 
  Clock, 
  CalendarDays, 
  ReceiptText, 
  Plus, 
  CheckCircle2, 
  X, 
  ArrowRight, 
  AlertCircle, 
  Download, 
  UserCheck, 
  Sliders, 
  FileText, 
  Briefcase, 
  DollarSign,
  User,
  Coffee,
  Check,
  MapPin,
  HelpCircle,
  TrendingUp,
  Printer
} from 'lucide-react';
import { cn } from '@/lib/utils';

export default function EmployeeSelfService() {
  const { user } = useAuth();
  const { showToast } = useToast();
  
  const [activeTab, setActiveTab ] = useState<'ATTENDANCE' | 'LEAVE' | 'PAYSLIP'>('ATTENDANCE');
  const [isLoading, setIsLoading] = useState(true);
  
  const [attendances, setAttendances] = useState<any[]>([]);
  const [leaves, setLeaves] = useState<any[]>([]);
  const [payslips, setPayslips] = useState<any[]>([]);
  
  const [currentLiveTime, setCurrentLiveTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentLiveTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatLiveTimeStr = (d: Date) => {
    try {
      return d.toLocaleTimeString("en-US", {
        timeZone: "Asia/Jakarta",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
      });
    } catch (e) {
      return d.toLocaleTimeString();
    }
  };
  
  // Modals state
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [selectedPayslip, setSelectedPayslip] = useState<any | null>(null);
  
  // Leave request forms state
  const [leaveType, setLeaveType] = useState('Annual Paid Leave');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [isSubmittingLeave, setIsSubmittingLeave] = useState(false);

  // Return formatted current Jakarta time
  const getTodayDateStr = () => {
    const todayStr = new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" });
    const dt = new Date(todayStr);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  const fetchAllData = async () => {
    setIsLoading(true);
    try {
      // Parallel fetches from live ERP backend endpoints
      const [attendancesRes, leavesRes, payslipsRes] = await Promise.all([
        apiFetch('/api/hr/attendances', {}, user?.username),
        apiFetch('/api/hr/leaves', {}, user?.username),
        apiFetch('/api/hr/payslips', {}, user?.username)
      ]);

      if (attendancesRes.ok) {
        setAttendances(Array.isArray(attendancesRes.data) ? attendancesRes.data : []);
      }
      if (leavesRes.ok) {
        setLeaves(Array.isArray(leavesRes.data) ? leavesRes.data : []);
      }
      if (payslipsRes.ok) {
        setPayslips(Array.isArray(payslipsRes.data) ? payslipsRes.data : []);
      }
    } catch (e) {
      console.error("Error loading self service data:", e);
      showToast("Failed to load staff self service data", "error");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (user?.username) {
      fetchAllData();
    }
  }, [user]);

  if (!user) return null;

  // Filter records specifically for active logged-in employee username
  const myAttendances = attendances.filter(a => a.employee_username === user.username);
  const myLeaves = leaves.filter(l => l.employee_username === user.username);
  const myPayslips = payslips.filter(p => p.employee_username === user.username);

  // Determine current daily attendance clock status
  const todayDateStr = getTodayDateStr();
  const todayLog = myAttendances.find(a => a.date === todayDateStr);
  const hasClockIn = !!todayLog;
  const hasClockOut = !!(todayLog && todayLog.clock_out);

  // Format Helper definitions
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

  const formatRupiah = (val: any) => {
    const num = Number(val) || 0;
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "IDR",
      maximumFractionDigits: 0
    }).format(num);
  };

  // Clock In / Clock Out Action Handlers
  const handleClockInOut = async () => {
    if (hasClockIn && hasClockOut) {
      showToast("You have already completed your attendance (In & Out) today.", "info");
      return;
    }

    try {
      showToast('Meminta lokasi GPS...', 'info');
      let location = null;
      if (navigator.geolocation) {
        try {
          location = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(
              (pos) => resolve(`${pos.coords.latitude},${pos.coords.longitude}`),
              (err) => resolve(null), // resolve null if err
              { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
            );
          });
        } catch(e) {}
      }

      if (!location) {
         showToast('Peringatan: Gagal mendapatkan lokasi GPS.', 'error');
      }

      const clientTimeStr = new Date().toISOString();
      if (!hasClockIn) {
        // Clocking In
        const res = await apiFetch('/api/hr/attendances/clock-in', {
          method: 'POST',
          body: JSON.stringify({ 
            employee_username: user.username,
            clientTime: clientTimeStr,
            location
          })
        }, user.username);

        if (res.ok) {
          showToast("Successfully registered Clock In!", "success");
          fetchAllData();
        } else {
          showToast(res.error || "Failed to perform Clock In", "error");
        }
      } else {
        // Clocking Out
        const res = await apiFetch('/api/hr/attendances/clock-out', {
          method: 'PUT',
          body: JSON.stringify({ 
            employee_username: user.username,
            clientTime: clientTimeStr,
            location
          })
        }, user.username);

        if (res.ok) {
          showToast("Successfully registered Clock Out!", "success");
          fetchAllData();
        } else {
          showToast(res.error || "Failed to perform Clock Out", "error");
        }
      }
    } catch (err) {
      console.error(err);
      showToast("Connection failed with attendance server.", "error");
    }
  };

  // Create new Leave Request
  const handleRequestLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!startDate || !endDate) {
      showToast("Leave start and end dates are required", "error");
      return;
    }

    setIsSubmittingLeave(true);
    try {
      const res = await apiFetch('/api/hr/leaves', {
        method: 'POST',
        body: JSON.stringify({
          employee_username: user.username,
          leave_type: leaveType,
          start_date: startDate,
          end_date: endDate,
          reason: reason
        })
      }, user.username);

      if (res.ok) {
        showToast("Leave application successfully submitted to HR!", "success");
        setIsRequestModalOpen(false);
        setStartDate('');
        setEndDate('');
        setReason('');
        fetchAllData();
      } else {
        showToast(res.error || "Failed to submit leave request", "error");
      }
    } catch (err) {
      console.error(err);
      showToast("An error occurred while submitting the leave request", "error");
    } finally {
      setIsSubmittingLeave(false);
    }
  };

  // Computes active standard annual leaves used & left
  const totalApprovedDays = myLeaves
    .filter(l => l.status === 'APPROVED')
    .reduce((acc, current) => {
      const s = new Date(current.start_date);
      const e = new Date(current.end_date);
      const diffTime = Math.abs(e.getTime() - s.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
      return acc + diffDays;
    }, 0);

  const remainingLeaveQuota = Math.max(0, 12 - totalApprovedDays);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Page Header standardizing the visual styling */}
      <PageHeader
        title="Staff Self Service"
        subtitle="Staff Portal: Factory Attendance, Annual Leave Requests & Integrated Payslips"
        icon={<UserCheck className="w-5 h-5 text-white" />}
      />

      {isLoading ? (
        <Loader text="Retrieving fhtbs Staff Portal data..." />
      ) : (
        <div className="space-y-8">
          
          {/* Top Bento Dashboard Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* Kehadiran Hari ini (Clocking state) */}
            <div className="bg-white p-6 rounded-[2rem] border border-stone-200/80 shadow-sm flex flex-col justify-between group relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-stone-50 rounded-full -mr-10 -mt-10 -z-0 group-hover:scale-110 transition-transform duration-500" />
              
              <div className="relative z-10">
                <span className="text-[10px] font-black uppercase tracking-widest text-stone-400 block mb-3">Today's Attendance Status</span>
                <h4 className="text-xl font-black text-stone-900 leading-tight">Attendance Registry</h4>
                
                <div className="mt-4 space-y-1.5">
                  <div className="flex items-center gap-2 text-xs text-stone-600 font-bold">
                    <span className="w-2 h-2 rounded-full bg-stone-300" />
                    <span>Date: {formatLocalDate(todayDateStr)}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs font-bold text-stone-700">
                    <span className={cn("w-2.5 h-2.5 rounded-full inline-block", hasClockIn ? "bg-emerald-500 animate-pulse" : "bg-stone-300")} />
                    <span>
                      Clock In: {todayLog ? formatLocalTime(todayLog.clock_in) : "Not Logged"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs font-bold text-stone-700">
                    <span className={cn("w-2.5 h-2.5 rounded-full inline-block", hasClockOut ? "bg-stone-800" : "bg-stone-200")} />
                    <span>
                      Clock Out: {todayLog && todayLog.clock_out ? formatLocalTime(todayLog.clock_out) : "Not Logged Out"}
                    </span>
                  </div>
                </div>

                <div className="mt-4 p-3 bg-stone-50 border border-stone-200/60 rounded-xl flex flex-col items-center justify-center text-center">
                  <span className="text-[9px] font-black uppercase tracking-widest text-stone-400">Live World Time (UTC+7 / Jakarta)</span>
                  <span className="text-lg font-extrabold text-stone-900 font-mono tracking-tight mt-0.5 animate-pulse">
                    {formatLiveTimeStr(currentLiveTime)}
                  </span>
                  <span className="text-[8px] font-bold text-emerald-600 uppercase tracking-widest mt-0.5">Authoritative Sync Active</span>
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-stone-100 relative z-10">
                <button 
                  onClick={handleClockInOut}
                  disabled={hasClockIn && hasClockOut}
                  className={cn(
                    "w-full py-3 px-5 rounded-2xl text-xs font-black uppercase tracking-widest transition-all hover:-translate-y-0.5",
                    !hasClockIn 
                      ? "bg-stone-900 text-white hover:bg-stone-800 shadow-sm hover:shadow-md" 
                      : !hasClockOut 
                        ? "bg-stone-900 hover:bg-black text-white shadow-sm"
                        : "bg-stone-100 text-stone-400 cursor-not-allowed border border-stone-200"
                  )}
                >
                  {!hasClockIn 
                    ? "Clock In" 
                    : !hasClockOut 
                      ? "Clock Out" 
                      : "Attendance Completed ✓"
                  }
                </button>
              </div>
            </div>

            {/* Sisa Kuota Cuti */}
            <div className="bg-white p-6 rounded-[2rem] border border-stone-200/80 shadow-sm flex flex-col justify-between group relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-stone-50 rounded-full -mr-10 -mt-10 -z-0" />
              
              <div className="relative z-10">
                <span className="text-[10px] font-black uppercase tracking-widest text-stone-400 block mb-3">Annual Leave Entitlement</span>
                <h4 className="text-xl font-black text-stone-900 leading-tight">My Remaining Leave Quota</h4>
                
                <div className="flex items-end gap-3 mt-4">
                  <span className="text-4xl font-extrabold text-emerald-600 font-mono">{remainingLeaveQuota}</span>
                  <span className="text-xs uppercase font-black text-stone-400 tracking-wider pb-1">Days Remaining / <span className="font-mono">12</span> Days</span>
                </div>
                
                {totalApprovedDays > 0 && (
                  <p className="text-[11px] text-stone-500 font-bold mt-2.5">
                     🌴 You have used <span className="text-emerald-600">{totalApprovedDays} days</span> of approved leave.
                  </p>
                )}
              </div>

              <div className="mt-6 pt-4 border-t border-stone-100 relative z-10">
                <button 
                  onClick={() => setIsRequestModalOpen(true)}
                  className="w-full py-3 px-5 bg-white border border-stone-300 hover:border-stone-800 text-stone-800 hover:text-stone-900 rounded-2xl text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                >
                  <Plus className="w-4 h-4 text-stone-500" />
                  Apply for Leave
                </button>
              </div>
            </div>

            {/* Slip Gaji Terbaru */}
            <div className="bg-white p-6 rounded-[2rem] border border-stone-200/80 shadow-sm flex flex-col justify-between group relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-stone-50 rounded-full -mr-10 -mt-10 -z-0" />
              
              <div className="relative z-10">
                <span className="text-[10px] font-black uppercase tracking-widest text-stone-400 block mb-3">Employee Remuneration</span>
                <h4 className="text-xl font-black text-stone-900 leading-tight">Latest Payslip</h4>
                
                {myPayslips.length > 0 ? (
                  <div className="mt-4">
                    <span className="inline-block px-2.5 py-1 bg-emerald-50 text-emerald-700 text-[10px] font-black uppercase tracking-widest rounded mb-2 border border-emerald-150">
                      Issued: {myPayslips[0].period_month}
                    </span>
                    <p className="text-xs font-black text-stone-500">Total Net Salary:</p>
                    <p className="text-xl font-extrabold text-stone-900 font-mono mt-0.5">{formatRupiah(myPayslips[0].net_salary)}</p>
                  </div>
                ) : (
                  <div className="mt-4 py-3 text-stone-400 text-xs italic">
                     No payslip records uploaded by HR yet.
                  </div>
                )}
              </div>

              <div className="mt-6 pt-4 border-t border-stone-100 relative z-10">
                {myPayslips.length > 0 ? (
                  <button 
                    onClick={() => {
                      setSelectedPayslip(myPayslips[0]);
                    }}
                    className="w-full py-3 px-5 bg-stone-900 hover:bg-stone-850 text-white rounded-2xl text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 shadow-sm"
                  >
                    <ReceiptText className="w-4 h-4" />
                    View Payslip Details
                  </button>
                ) : (
                  <button 
                    disabled
                    className="w-full py-3 px-5 bg-stone-50 text-stone-300 border border-stone-200 rounded-2xl text-xs font-bold uppercase tracking-widest cursor-not-allowed"
                  >
                    No Payslips Available
                  </button>
                )}
              </div>
            </div>

          </div>

          {/* Neutral ERP-style Document Tab selectors */}
          <div className="flex border-b border-stone-200 gap-1.5 overflow-x-auto pb-px">
            <button
              onClick={() => setActiveTab('ATTENDANCE')}
              className={cn(
                "px-5 py-3 text-xs tracking-wider font-black uppercase transition-all whitespace-nowrap border-b-2 flex items-center gap-2",
                activeTab === 'ATTENDANCE'
                  ? "border-stone-900 text-stone-900"
                  : "border-transparent text-stone-400 hover:text-stone-700"
              )}
            >
              <Clock className="w-4 h-4" /> Attendance Logs ({myAttendances.length})
            </button>
            <button
              onClick={() => setActiveTab('LEAVE')}
              className={cn(
                "px-5 py-3 text-xs tracking-wider font-black uppercase transition-all whitespace-nowrap border-b-2 flex items-center gap-2",
                activeTab === 'LEAVE'
                  ? "border-stone-900 text-stone-900"
                  : "border-transparent text-stone-400 hover:text-stone-700"
              )}
            >
              <CalendarDays className="w-4 h-4" /> Leave History ({myLeaves.length})
            </button>
            <button
              onClick={() => setActiveTab('PAYSLIP')}
              className={cn(
                "px-5 py-3 text-xs tracking-wider font-black uppercase transition-all whitespace-nowrap border-b-2 flex items-center gap-2",
                activeTab === 'PAYSLIP'
                  ? "border-stone-900 text-stone-900"
                  : "border-transparent text-stone-400 hover:text-stone-700"
              )}
            >
              <ReceiptText className="w-4 h-4" /> Monthly Payslips ({myPayslips.length})
            </button>
          </div>

          {/* TAB 1: ATTENDANCE LOGS */}
          {activeTab === 'ATTENDANCE' && (
            <div className="space-y-6">
              
              <div className="bg-stone-50 border border-stone-200 px-6 py-4 rounded-2xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                  <h3 className="text-sm font-black text-stone-800 uppercase tracking-widest">Your Attendance Records</h3>
                  <p className="text-[11px] text-stone-500 font-medium">Complete daily clock-in and clock-out history recorded in the database.</p>
                </div>

                <div className="flex items-center gap-1.5 text-xs text-stone-600 font-bold bg-white px-3 py-1.5 rounded-xl border border-stone-200/60 shadow-inner">
                  <span>Total Shifts: </span>
                  <span className="px-2 py-0.5 bg-stone-900 rounded font-mono text-white text-[10px]">{myAttendances.length} Days</span>
                </div>
              </div>

              {myAttendances.length === 0 ? (
                <div className="py-20 text-center bg-white rounded-[2.5rem] border border-stone-200 flex flex-col items-center justify-center">
                  <div className="w-14 h-14 bg-stone-50 rounded-full flex items-center justify-center mb-4 text-stone-300">
                    <Clock className="w-6 h-6" />
                  </div>
                  <p className="text-stone-700 font-extrabold text-sm">No attendance logs found.</p>
                  <p className="text-xs text-stone-400 mt-1">Click the "Clock In" button to start recording your shift today.</p>
                </div>
              ) : (
                <div className="bg-white border border-stone-200 rounded-[2.5rem] overflow-hidden shadow-sm">
                  <div className="overflow-x-auto font-bold">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-stone-50/85 border-b border-stone-200 font-black text-stone-500 uppercase tracking-widest select-none">
                          <th className="py-4 px-6 text-stone-500">Log ID</th>
                          <th className="py-4 px-6 text-stone-500">Date</th>
                          <th className="py-4 px-6 text-stone-500">Clock In</th>
                          <th className="py-4 px-6 text-stone-500">Location In</th>
                          <th className="py-4 px-6 text-stone-500">Clock Out</th>
                          <th className="py-4 px-6 text-stone-500">Location Out</th>
                          <th className="py-4 px-6 text-stone-500">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-150 text-stone-700">
                        {myAttendances.map((att) => (
                          <tr key={att.id} className="hover:bg-stone-50/50 transition-colors">
                            <td className="py-4 px-6 font-mono text-stone-500">{att.id}</td>
                            <td className="py-4 px-6 font-bold text-stone-900">{formatLocalDate(att.date)}</td>
                            <td className="py-4 px-6 font-mono text-emerald-600 font-extrabold">{formatLocalTime(att.clock_in)}</td>
                            
                            <td className="py-4 px-6">
                               {att.clock_in_location ? (
                                  <a href={`https://www.google.com/maps/search/?api=1&query=${att.clock_in_location}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-blue-600 hover:underline">
                                     <MapPin className="w-3 h-3" />
                                     <span className="text-[10px] font-mono">{att.clock_in_location}</span>
                                  </a>
                               ) : (
                                  <span className="text-stone-300 text-[10px]">N/A</span>
                               )}
                            </td>

                            <td className="py-4 px-6 font-mono">
                              {att.clock_out ? (
                                <span className="text-stone-600 font-bold">{formatLocalTime(att.clock_out)}</span>
                              ) : (
                                <span className="inline-block px-2 py-0.5 bg-amber-50 text-amber-700 text-[9px] uppercase font-black tracking-widest border border-amber-200 rounded animate-pulse">In Progress</span>
                              )}
                            </td>
                            
                            <td className="py-4 px-6">
                               {att.clock_out_location ? (
                                  <a href={`https://www.google.com/maps/search/?api=1&query=${att.clock_out_location}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-blue-600 hover:underline">
                                     <MapPin className="w-3 h-3" />
                                     <span className="text-[10px] font-mono">{att.clock_out_location}</span>
                                  </a>
                               ) : (
                                  <span className="text-stone-300 text-[10px]">N/A</span>
                               )}
                            </td>

                            <td className="py-4 px-6">
                              <span className="px-2 py-0.5 bg-stone-100 border border-stone-200 text-stone-500 rounded text-[9px] uppercase tracking-wide font-black">
                                {att.clock_out ? "Completed" : "On Duty"}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: LEAVE REQUESTS */}
          {activeTab === 'LEAVE' && (
            <div className="space-y-6">
              
              <div className="flex justify-between items-center bg-stone-50 border border-stone-200 px-6 py-4 rounded-2xl">
                <div>
                  <h3 className="text-sm font-black text-stone-800 uppercase tracking-widest">Leave Requests</h3>
                  <p className="text-[11px] text-stone-500 font-medium">Track leave history, approval status, and feedback from HR.</p>
                </div>
                
                <button
                  onClick={() => setIsRequestModalOpen(true)}
                  className="px-4 py-2 bg-stone-900 hover:bg-stone-850 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-colors flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" /> Apply for Leave
                </button>
              </div>

              {myLeaves.length === 0 ? (
                <div className="py-20 text-center bg-white rounded-[2.5rem] border border-stone-200 flex flex-col items-center justify-center">
                  <div className="w-14 h-14 bg-stone-50 rounded-full flex items-center justify-center mb-4 text-stone-300">
                    <CalendarDays className="w-6 h-6" />
                  </div>
                  <p className="text-stone-700 font-extrabold text-sm">No leave history found.</p>
                  <p className="text-xs text-stone-400 mt-1">Submit a leave request when you plan to be away.</p>
                </div>
              ) : (
                <div className="bg-white border border-stone-200 rounded-[2.5rem] overflow-hidden shadow-sm">
                  <div className="overflow-x-auto font-bold">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-stone-50/85 border-b border-stone-200 font-black text-stone-500 uppercase tracking-widest select-none">
                          <th className="py-4 px-6 text-stone-500">Request ID</th>
                          <th className="py-4 px-6 text-stone-500">Leave Category</th>
                          <th className="py-4 px-6 text-stone-500">Start Date</th>
                          <th className="py-4 px-6 text-stone-500">End Date</th>
                          <th className="py-4 px-6 text-stone-500">Approval Status</th>
                          <th className="py-4 px-6 text-stone-500">Approver / Notes</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-150 font-medium text-stone-700">
                        {myLeaves.map((leave) => {
                          const statusClass = 
                            leave.status === 'APPROVED' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
                            leave.status === 'REJECTED' ? 'bg-rose-50 text-rose-700 border-rose-100' :
                            'bg-amber-50 text-amber-700 border-amber-100';

                          return (
                            <tr key={leave.id} className="hover:bg-stone-50/50 transition-colors">
                              <td className="py-4 px-6 font-mono font-black text-stone-900">{leave.id}</td>
                              <td className="py-4 px-6 font-bold text-stone-800">{leave.leave_type}</td>
                              <td className="py-4 px-6">{formatLocalDate(leave.start_date)}</td>
                              <td className="py-4 px-6">{formatLocalDate(leave.end_date)}</td>
                              <td className="py-4 px-6">
                                <span className={cn("px-2.5 py-0.5 rounded-full text-[10px] uppercase font-black tracking-widest border", statusClass)}>
                                  {leave.status || 'PENDING'}
                                </span>
                              </td>
                              <td className="py-4 px-6">
                                <div className="space-y-1">
                                  {leave.reason ? (
                                    <p className="text-stone-400 italic font-mono">&ldquo;{leave.reason}&rdquo;</p>
                                  ) : (
                                    <span className="text-stone-300 italic">-</span>
                                  )}
                                  {leave.approver_name && (
                                    <p className="text-[10px] text-stone-500 uppercase tracking-widest">
                                      Authorized by: <strong className="text-stone-700">{leave.approver_name}</strong>
                                    </p>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: PAYSLIPS */}
          {activeTab === 'PAYSLIP' && (
            <div className="space-y-6">
              
              <div className="bg-stone-50 border border-stone-200 px-6 py-4 rounded-2xl">
                <span className="text-[10px] font-black text-stone-400 uppercase tracking-widest">Official Financial Records</span>
                <h3 className="text-sm font-black text-stone-800 uppercase tracking-widest mt-0.5 font-bold">Payslip Archive</h3>
                <p className="text-[11px] text-stone-500 font-medium">Monthly salary, allowances, deductions, and system-verified digital receipts.</p>
              </div>

              {myPayslips.length === 0 ? (
                <div className="py-20 text-center bg-white rounded-[2.5rem] border border-stone-200 flex flex-col items-center justify-center">
                  <div className="w-14 h-14 bg-stone-50 rounded-full flex items-center justify-center mb-4 text-stone-300">
                    <ReceiptText className="w-6 h-6" />
                  </div>
                  <p className="text-stone-700 font-extrabold text-sm">No documents available.</p>
                  <p className="text-xs text-stone-400 mt-1">The finance team has not issued your payslips for this period yet.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 font-bold">
                  {myPayslips.map((pay) => (
                    <div 
                      key={pay.id} 
                      className="bg-white border hover:border-stone-400 transition-all shadow-sm rounded-[2rem] p-6 flex flex-col justify-between group cursor-pointer"
                      onClick={() => setSelectedPayslip(pay)}
                    >
                      <div>
                        <div className="flex justify-between items-start mb-6">
                          <div className="w-11 h-11 bg-stone-100 text-stone-700 border border-stone-200 rounded-xl flex items-center justify-center shadow-inner">
                            <ReceiptText className="w-5 h-5" />
                          </div>
                          <span className="px-2 py-0.5 border border-stone-200 bg-stone-50 text-stone-600 text-[9px] uppercase tracking-widest font-black rounded">
                            Official Document
                          </span>
                        </div>
                        
                        <h4 className="text-lg font-black text-stone-900 group-hover:text-stone-700 transition-colors">{pay.period_month}</h4>
                        <p className="text-stone-400 text-[11px] font-mono mt-0.5">ID: {pay.id}</p>
                        
                        <div className="mt-4 pt-4 border-t border-stone-100 space-y-1 bg-stone-50/50 p-3 rounded-xl border border-stone-100">
                          <span className="text-[9px] font-bold uppercase tracking-widest text-stone-400 block">Total Net Salary</span>
                          <span className="text-base font-black text-stone-900 font-mono tracking-tight block">
                            {formatRupiah(pay.net_salary)}
                          </span>
                        </div>
                      </div>

                      <div className="mt-6 pt-4 border-t border-stone-150 flex items-center justify-between text-xs font-bold text-stone-500">
                        <span>View Details</span>
                        <ArrowRight className="w-4 h-4 text-stone-400 group-hover:translate-x-1.5 transition-transform" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>
      )}

      {/* LEAVE REQUEST FORM MODAL */}
      {isRequestModalOpen && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 bg-stone-950/60 backdrop-blur-sm flex items-center justify-center p-4 z-[200] animate-in fade-in duration-300">
          <div className="bg-white rounded-[2rem] border border-stone-200 w-full max-w-lg shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
            
            <div className="bg-stone-50 px-6 py-5 flex justify-between items-center border-b border-stone-200">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-stone-900 text-white rounded-lg">
                  <CalendarDays className="w-4 h-4" />
                </div>
                <h3 className="font-black text-stone-900 text-sm uppercase tracking-wider">Leave Request Form</h3>
              </div>
              <button 
                onClick={() => setIsRequestModalOpen(false)}
                className="text-stone-400 hover:text-stone-600 bg-white border border-stone-100 p-1.5 rounded-full hover:bg-stone-100 transition-colors"
                type="button"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleRequestLeave} className="p-6 space-y-4 font-bold">
              
              <div className="space-y-1.5 flex flex-col">
                <label className="text-[10px] font-black text-stone-500 uppercase tracking-widest block ml-1">Leave Category</label>
                <select 
                  value={leaveType}
                  onChange={e => setLeaveType(e.target.value)}
                  className="w-full px-4 py-3 bg-stone-50 border border-stone-250 rounded-xl outline-none focus:border-stone-800 text-xs font-bold text-stone-800"
                >
                  <option value="Annual Paid Leave">Annual Paid Leave</option>
                  <option value="Sick Leave">Sick Leave</option>
                  <option value="Maternity / Paternity">Maternity / Paternity Leave</option>
                  <option value="Unpaid Leave">Unpaid Leave</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5 flex flex-col">
                  <label className="text-[10px] font-black text-stone-500 uppercase tracking-widest block ml-1">Start Date</label>
                  <input 
                    type="date"
                    required
                    value={startDate}
                    onChange={e => setStartDate(e.target.value)}
                    className="w-full px-4 py-3 bg-stone-50 border border-stone-250 rounded-xl outline-none focus:border-stone-800 text-xs text-stone-800 font-bold"
                  />
                </div>
                <div className="space-y-1.5 flex flex-col">
                  <label className="text-[10px] font-black text-stone-500 uppercase tracking-widest block ml-1">End Date</label>
                  <input 
                    type="date"
                    required
                    value={endDate}
                    onChange={e => setEndDate(e.target.value)}
                    className="w-full px-4 py-3 bg-stone-50 border border-stone-250 rounded-xl outline-none focus:border-stone-800 text-xs text-stone-800 font-bold"
                  />
                </div>
              </div>

              <div className="space-y-1.5 flex flex-col">
                <label className="text-[10px] font-black text-stone-500 uppercase tracking-widest block ml-1">Reason / Notes</label>
                <textarea 
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder="Explain the purpose of your leave request here..."
                  rows={3}
                  required
                  className="w-full px-4 py-3 bg-stone-50 border border-stone-250 rounded-xl outline-none focus:border-stone-800 text-xs text-stone-805 font-bold resize-none"
                />
              </div>

              <div className="bg-stone-50 border border-stone-150 rounded-xl p-3 text-[10px] text-stone-500 leading-relaxed font-medium">
                ℹ️ All leave requests require direct review and approval from General Manager or Human Resources.
              </div>

              <div className="pt-4 border-t border-stone-100 flex justify-end gap-2.5">
                <button 
                  type="button" 
                  onClick={() => setIsRequestModalOpen(false)}
                  className="px-5 py-2.5 bg-stone-100 hover:bg-stone-200 text-stone-600 text-xs font-black uppercase tracking-wider rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={isSubmittingLeave}
                  className="px-6 py-2.5 bg-stone-900 hover:bg-stone-850 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all shadow-md"
                >
                  {isSubmittingLeave ? 'Processing...' : 'Submit Leave Request'}
                </button>
              </div>

            </form>
          </div>
        </div>,
        document.body
      )}

      {/* DETAILED PAYSLIP INVOICE MODAL */}
      {selectedPayslip && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 bg-stone-950/65 backdrop-blur-sm flex items-center justify-center p-4 z-[200] animate-in fade-in duration-300">
          <div className="bg-white rounded-[2.5rem] border border-stone-200 w-full max-w-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
            
            <div className="bg-stone-900 text-white px-8 py-6 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-yellow-400">
                  <ReceiptText className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-sm uppercase tracking-widest text-white leading-none font-bold">Employee Payslip Breakdown</h3>
                  <span className="text-[10px] text-stone-400 uppercase tracking-widest font-mono">Paving Joss Division</span>
                </div>
              </div>
              <button 
                onClick={() => setSelectedPayslip(null)}
                className="text-stone-300 hover:text-white bg-white/10 p-1.5 rounded-full transition-colors"
                type="button"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-8 space-y-6 text-stone-800">
              {/* Header Info */}
              <div className="flex justify-between items-start border-b border-stone-200 pb-5 text-xs font-bold">
                <div>
                  <h4 className="font-mono text-[10px] font-black text-stone-400 uppercase tracking-widest mb-1">Recipient</h4>
                  <p className="font-extrabold text-stone-900 uppercase text-sm">{user.username}</p>
                  <p className="text-stone-500 font-bold">Role: {user.role || 'Staff'}</p>
                </div>
                <div className="text-right text-xs">
                  <h4 className="font-mono text-[10px] font-black text-stone-400 uppercase tracking-widest mb-1">Period</h4>
                  <p className="font-extrabold text-stone-900 text-sm uppercase">{selectedPayslip.period_month}</p>
                  <p className="text-stone-500 font-mono text-[10px]">ID: {selectedPayslip.id}</p>
                </div>
              </div>

              {/* Financial Calculations Table */}
              <div className="space-y-4">
                <span className="text-[10px] font-black text-stone-400 uppercase tracking-widest block font-bold">Financial Components</span>
                
                <div className="bg-stone-50 border border-stone-200/80 rounded-2xl overflow-hidden font-bold">
                  <div className="grid grid-cols-2 bg-stone-150/40 border-b border-stone-200 py-2.5 px-4 text-[10px] font-black text-stone-500 uppercase tracking-wider">
                    <span>Component Type</span>
                    <span className="text-right">Amount (IDR)</span>
                  </div>
                  
                  <div className="divide-y divide-stone-150 font-bold text-xs text-stone-700">
                    <div className="grid grid-cols-2 py-3 px-4">
                      <span>Basic Salary</span>
                      <span className="text-right font-mono text-stone-900">{formatRupiah(selectedPayslip.basic_salary)}</span>
                    </div>
                    <div className="grid grid-cols-2 py-3 px-4">
                      <span className="text-emerald-700 flex items-center gap-1">Operational Allowance (+)</span>
                      <span className="text-right font-mono text-emerald-700">+{formatRupiah(selectedPayslip.allowances)}</span>
                    </div>
                    <div className="grid grid-cols-2 py-3 px-4">
                      <span className="text-rose-700 flex items-center gap-1">Deductions (-)</span>
                      <span className="text-right font-mono text-rose-700">-{formatRupiah(selectedPayslip.deductions)}</span>
                    </div>
                  </div>
                </div>

                {/* Net Income block */}
                <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-2xl flex justify-between items-center font-bold">
                  <div>
                    <span className="text-[10px] font-black text-emerald-800 uppercase tracking-widest block">Total Take Home Pay (THP)</span>
                    <span className="text-xs text-stone-500 font-bold">Net salary transferred to registered account</span>
                  </div>
                  <span className="text-xl font-extrabold text-emerald-700 font-mono tracking-tight">
                    {formatRupiah(selectedPayslip.net_salary)}
                  </span>
                </div>
              </div>

              {/* Legal confirmation seal */}
              <div className="flex justify-between items-end pt-4 border-t border-stone-200/60 text-[10px] text-stone-500 font-medium">
                <div>
                  <p>Validity: <strong>SYSTEM VERIFIED</strong></p>
                  <p>Printed: {new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" })}</p>
                </div>
                <div className="text-right cursor-default select-none font-bold">
                  <p className="uppercase tracking-widest font-black text-stone-400 mb-4">Finance Department</p>
                  <div className="font-mono bg-stone-100 text-stone-600 border border-stone-200 px-2 py-1 rounded inline-block">
                    PAVINGJOSS-ERP-SECURE✓
                  </div>
                </div>
              </div>

            </div>

            <div className="bg-stone-50 px-8 py-5 border-t border-stone-100 flex justify-end gap-3 font-bold">
              <button
                type="button"
                onClick={() => {
                  window.print();
                }}
                className="px-4 py-2.5 bg-stone-250 hover:bg-stone-300 text-stone-700 text-xs font-black uppercase tracking-wider rounded-xl transition-colors flex items-center gap-1.5"
              >
                <Printer className="w-4 h-4" /> Print Slip
              </button>
              <button 
                type="button" 
                onClick={() => setSelectedPayslip(null)} 
                className="px-6 py-2.5 bg-stone-900 hover:bg-stone-850 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-colors"
              >
                Close Document
              </button>
            </div>

          </div>
        </div>,
        document.body
      )}

    </div>
  );
}
