import { apiFetch } from '@/utils/api';
import React, { useEffect, useState, useMemo } from 'react';
import { History, Search, User, Activity, Clock, Shield, Trash2, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/contexts/ToastContext';
import { PageHeader } from '@/components/shared/PageHeader';
import { Loader } from '@/components/shared/Loader';
import { useAuth } from '@/contexts/AuthContext';

interface AuditLog {
  id: string;
  user_email: string;
  action: string;
  resource_type: string;
  resource_id: string;
  details: string;
  created_at: string;
}

export default function Logs() {
  const { showToast } = useToast();
  const { user } = useAuth();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchLogs = async () => {
    setIsLoading(true);
    try {
      const res = await apiFetch('/api/audit-trail', {}, user?.username);
      if (res.ok) {
          setLogs(Array.isArray(res.data) ? res.data : []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const filteredLogs = useMemo(() => logs.filter(log => 
    log.user_email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    log.action.toLowerCase().includes(searchQuery.toLowerCase()) ||
    log.details?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    log.resource_id?.toLowerCase().includes(searchQuery.toLowerCase())
  ), [logs, searchQuery]);

  return (
    <div className="space-y-12 pb-20 animate-in fade-in duration-500">
      <PageHeader
        title="System Logs"
        subtitle="System Activity & Operational History"
        icon={<Activity className="w-6 h-6" />}
        actions={
          <>
            <div className="flex items-center gap-2 px-4 py-2 bg-stone-50/80 rounded-2xl border border-stone-200/50 text-xs font-semibold text-stone-500 tracking-wider shadow-sm">
              <Shield className="w-4 h-4 text-emerald-500" /> Security Monitored
            </div>
          </>
        }
      />


      <div className="border border-stone-100 rounded-2xl overflow-hidden bg-white">
        <div className="p-6 border-b border-stone-100 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="relative max-w-md w-full">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
            <input 
              type="text"
              placeholder="Search logs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-12 pr-4 py-3 bg-stone-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-stone-200 outline-none transition-all"
            />
          </div>
          <button 
            onClick={fetchLogs}
            className="p-3 text-stone-400 hover:text-stone-900 hover:bg-stone-50 rounded-xl transition-colors"
            title="Refresh Logs"
          >
            <Activity className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-stone-100 bg-white">
                <th className="px-6 py-5 text-[10px] font-bold text-stone-400 uppercase tracking-widest">Timestamp</th>
                <th className="px-6 py-5 text-[10px] font-bold text-stone-400 uppercase tracking-widest">User</th>
                <th className="px-6 py-5 text-[10px] font-bold text-stone-400 uppercase tracking-widest">Action</th>
                <th className="px-6 py-5 text-[10px] font-bold text-stone-400 uppercase tracking-widest">Resource</th>
                <th className="px-6 py-5 text-[10px] font-bold text-stone-400 uppercase tracking-widest">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100/60">
              {isLoading ? (
                <tr>
            <td colSpan={5} className="px-6 py-16"><Loader text="Loading audit logs..." /></td>
                </tr>
              ) : filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-16 text-center text-stone-400 text-sm">No activity logs found.</td>
                </tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-stone-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 text-sm text-stone-500">
                        <Clock className="w-3.5 h-3.5" />
                        {new Date(log.created_at).toLocaleString('en-US', { timeZone: 'Asia/Jakarta' })}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 bg-stone-100 rounded-full flex items-center justify-center">
                          <User className="w-3.5 h-3.5 text-stone-400" />
                        </div>
                        <span className="text-sm font-semibold text-stone-900">{log.user_email || 'SYSTEM'}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={cn(
                        "inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider",
                        log.action.includes('CREATE') ? "bg-emerald-50 text-emerald-700" :
                        log.action.includes('DELETE') ? "bg-red-50 text-red-700" :
                        log.action.includes('UPDATE') ? "bg-blue-50 text-blue-700" :
                        "bg-stone-100 text-stone-600"
                      )}>
                        {log.action}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm font-medium text-stone-900">{log.resource_type}</div>
                      <div className="text-xs text-stone-400 font-mono mt-0.5">{log.resource_id}</div>
                    </td>
                    <td className="px-6 py-4 text-sm text-stone-600">
                      {log.details}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
