import { safeFetchJson, apiFetch } from '@/utils/api';
import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { PageHeader } from '@/components/shared/PageHeader';
import { Loader } from '@/components/shared/Loader';
import { ConfirmModal } from '@/components/shared/ConfirmModal';
import { Select } from '@/components/ui/Select';
import { CheckCircle2, XCircle, Shield, Briefcase, UserCheck, Trash2, Edit2, Save, X, ShieldCheck, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { hasGodMode, getRolePolicies, Action, ACTIONS_REQUIRING_MANAGER } from '@/utils/pbac';
import { Role } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/Button';

interface Account {
  id: string;
  username: string;
  name: string;
  role: string;
  level: string;
  status: string;
  created_at: string;
}

export default function ManageAccounts() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [pendingAccounts, setPendingAccounts] = useState<Account[]>([]);
  const [activeAccounts, setActiveAccounts] = useState<Account[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState<string>('');
  const [editLevel, setEditLevel] = useState<string>('STAFF');
  
  // Confirmation Modal State
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {}
  });

  useEffect(() => {
    if (!hasGodMode(user)) {
      navigate('/');
      return;
    }
    fetchData();
  }, [user, navigate]);

  const fetchData = async () => {
    try {
      const [pendingRes, activeRes] = await Promise.all([
        apiFetch('/api/auth/pending', {}, user?.username),
        apiFetch('/api/users/all', {}, user?.username)
      ]);
      
      if (pendingRes.ok) setPendingAccounts(pendingRes.data || []);
      if (activeRes.ok) setActiveAccounts(activeRes.data || []);
    } catch (err) {
      console.error(err);
      showToast('Failed to fetch accounts', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAction = async (id: string, action: 'approve' | 'reject') => {
    try {
      const endpoint = action === 'approve' ? '/api/auth/approve' : '/api/auth/reject';
      const res = await apiFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify({ id })
      }, user?.username);

      if (res.ok) {
        showToast(`Account ${action === 'approve' ? 'approved' : 'rejected'} successfully`, 'success');
        fetchData();
      } else {
        showToast(res.error || `Failed to ${action} account`, 'error');
      }
    } catch (err) {
      console.error(err);
      showToast(`Error ${action}ing account`, 'error');
    }
  };

  const startEdit = (acc: Account) => {
    setEditingId(acc.id);
    setEditRole(acc.role);
    setEditLevel(acc.level || 'STAFF');
  };

  const saveEdit = async (id: string) => {
    try {
      const res = await apiFetch(`/api/users/${id}/role`, {
        method: 'PUT',
        body: JSON.stringify({ role: editRole, level: editLevel })
      }, user?.username);
      if (res.ok) {
        showToast('Role & Level updated successfully', 'success');
        setEditingId(null);
        fetchData();
      } else {
        showToast(res.error || 'Failed to update credentials', 'error');
      }
    } catch (e) {
      showToast('Error updating credentials', 'error');
    }
  };

  const handleDelete = async (id: string) => {
    setConfirmModal({
      isOpen: true,
      title: 'Delete Account',
      message: 'Are you sure you want to delete this account? This action cannot be undone.',
      onConfirm: async () => {
        try {
          const res = await apiFetch(`/api/users/${id}`, { method: 'DELETE' }, user?.username);
          if (res.ok) {
            showToast('Account deleted successfully', 'success');
            fetchData();
          } else {
            showToast(res.error || 'Failed to delete account', 'error');
          }
        } catch (e) {
          showToast('Error deleting account', 'error');
        } finally {
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
        }
      }
    });
  };

  if (!hasGodMode(user)) return null;

  return (
    <div className="space-y-12 pb-20 animate-in fade-in duration-500">
      <PageHeader
        title="Access Control"
        subtitle="User Permission & Security Control Center"
        icon={<ShieldCheck className="w-6 h-6" />}
      />

      {isLoading ? (
        <Loader text="Loading..." className="py-20" />
      ) : (
        <div className="space-y-12">
          {/* Pending Approval Section */}
          <div>
             <h3 className="text-lg font-bold text-stone-900 mb-4">Pending Approvals</h3>
             {pendingAccounts.length === 0 ? (
                <div className="text-center p-12 bg-stone-50 rounded-3xl border border-stone-100 border-dashed">
                  <Shield className="w-10 h-10 text-stone-400 mx-auto mb-3" />
                  <p className="text-stone-500 text-sm">No pending requests.</p>
                </div>
              ) : (
                <div className="bg-white rounded-3xl border border-stone-100 overflow-hidden shadow-sm">
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-stone-50/50">
                      <tr className="border-b border-stone-100">
                        <th className="py-4 pl-6 pr-4 text-[9px] font-bold text-stone-400 uppercase tracking-[0.2em]">Applicant Details</th>
                        <th className="py-4 px-4 text-[9px] font-bold text-stone-400 uppercase tracking-[0.2em]">Requested Role</th>
                        <th className="py-4 px-4 text-[9px] font-bold text-stone-400 uppercase tracking-[0.2em] text-center">Date</th>
                        <th className="py-4 pl-4 pr-6 text-[9px] font-bold text-stone-400 uppercase tracking-[0.2em] text-right">Decide</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-50">
                      {pendingAccounts.map(account => (
                        <tr key={account.id} className="hover:bg-stone-50/30 transition-colors">
                          <td className="py-4 pl-6 pr-4">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-lg bg-stone-100 flex items-center justify-center text-stone-500">
                                <UserCheck className="w-4 h-4" />
                              </div>
                              <div>
                                <div className="font-bold text-stone-900 text-sm">{account.name}</div>
                                <div className="text-xs text-stone-500">@{account.username}</div>
                              </div>
                            </div>
                          </td>
                          <td className="py-4 px-4">
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center gap-2">
                                <Briefcase className="w-3.5 h-3.5 text-stone-400" />
                                <span className="text-xs font-bold text-stone-700 bg-stone-100 px-2 py-1 rounded-md">{account.role}</span>
                              </div>
                              {account.role !== 'FC' && (
                                <span className="text-[9px] font-bold text-stone-500 uppercase tracking-widest ml-1">[ level: {account.level || 'STAFF'} ]</span>
                              )}
                            </div>
                          </td>
                          <td className="py-4 px-4 text-center text-xs font-medium text-stone-600">
                            {new Date(account.created_at).toLocaleDateString('en-US')}
                          </td>
                          <td className="py-4 pl-4 pr-6">
                            <div className="flex items-center justify-end gap-2">
                              <Button size="xs" variant="danger_soft" onClick={() => handleAction(account.id, 'reject')}>
                                Reject
                              </Button>
                              <Button size="xs" variant="success_soft" onClick={() => handleAction(account.id, 'approve')}>
                                Approve
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </div>

          {/* Active Accounts Section */}
          <div>
             <h3 className="text-lg font-bold text-stone-900 mb-4">Active Users</h3>
             <div className="bg-white rounded-3xl border border-stone-100 overflow-hidden shadow-sm">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-stone-50/50">
                    <tr className="border-b border-stone-100">
                      <th className="py-4 pl-6 pr-4 text-[9px] font-bold text-stone-400 uppercase tracking-[0.2em]">User Details</th>
                      <th className="py-4 px-4 text-[9px] font-bold text-stone-400 uppercase tracking-[0.2em]">Role & Level</th>
                      <th className="py-4 px-4 text-[9px] font-bold text-stone-400 uppercase tracking-[0.2em] text-center">Status</th>
                      <th className="py-4 pl-4 pr-6 text-[9px] font-bold text-stone-400 uppercase tracking-[0.2em] text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-50">
                    {activeAccounts.map(account => (
                      <tr key={account.id} className="hover:bg-stone-50/30 transition-colors">
                        <td className="py-4 pl-6 pr-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-stone-100 flex items-center justify-center text-stone-500">
                              <UserCheck className="w-4 h-4" />
                            </div>
                            <div>
                              <div className="font-bold text-stone-900 text-sm">{account.name}</div>
                              <div className="text-xs text-stone-500">@{account.username}</div>
                            </div>
                          </div>
                        </td>
                        <td className="py-4 px-4">
                          {editingId === account.id ? (
                            <div className="flex flex-col gap-2">
                              <Select
                                value={editRole}
                                onChange={(e) => {
                                  const r = e.target.value;
                                  setEditRole(r);
                                  if (r === 'FC') {
                                    setEditLevel('MANAGER');
                                  }
                                }}
                                className="py-1.5 px-3 text-xs w-full"
                                icon={<Briefcase className="w-3.5 h-3.5" />}
                              >
                                <option value="FC">Full Control (FC)</option>
                                <option value="ENGINEERING">Engineering</option>
                                <option value="PURCHASING">Purchasing</option>
                                <option value="WAREHOUSE">Warehouse</option>
                                <option value="PRODUCTION">Production</option>
                                <option value="SALES">Sales</option>
                              </Select>
                              
                              {editRole !== 'FC' && (
                                <Select
                                  value={editLevel}
                                  onChange={(e) => setEditLevel(e.target.value)}
                                  className="py-1.5 px-3 text-xs w-full"
                                  icon={<ShieldCheck className="w-3.5 h-3.5 text-stone-500" />}
                                >
                                  <option value="STAFF">Staff</option>
                                  <option value="MANAGER">Manager</option>
                                </Select>
                              )}
                              
                              <div className="flex flex-col gap-2 mt-4 p-4 bg-stone-50 rounded-2xl border border-stone-100">
                                <div className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-1 flex items-center justify-between">
                                  <span>Policy Inheritance preview</span>
                                  {editLevel === 'MANAGER' && <span className="text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">Manager Access Active</span>}
                                  {editRole === 'FC' && <span className="text-red-600 bg-red-50 px-2 py-0.5 rounded-full">God Mode</span>}
                                </div>
                                <div className="flex flex-wrap gap-1.5 mt-2">
                                  {(getRolePolicies()[editRole as Role] || []).map((action) => {
                                    const isManagerAction = ACTIONS_REQUIRING_MANAGER.includes(action as Action);
                                    
                                    if (isManagerAction && editLevel !== 'MANAGER' && editRole !== 'FC') {
                                      return null; // Hide manager actions for staff
                                    }

                                    return (
                                      <span 
                                        key={action} 
                                        className={`px-2 py-1 border text-[9px] font-mono rounded-lg uppercase shadow-sm ${
                                          isManagerAction 
                                            ? 'bg-emerald-50 text-emerald-700 border-emerald-100' 
                                            : 'bg-white text-stone-600 border-stone-200'
                                        }`}
                                      >
                                        {action.replace(/_/g, ' ')}
                                      </span>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-col gap-1.5">
                              <div className="flex items-center gap-2">
                                <Briefcase className="w-3.5 h-3.5 text-stone-400" />
                                <span className="text-xs font-bold text-stone-700 bg-stone-100 px-2 py-1 rounded-md">{account.role}</span>
                              </div>
                              {account.role !== 'FC' && (
                                <div className="flex items-center gap-1.5 pl-1.5">
                                  <Shield className="w-3.5 h-3.5 text-stone-400" />
                                  <span className="text-[10px] font-bold text-stone-500 bg-stone-50/50 px-2 py-0.5 rounded border border-stone-100 uppercase tracking-widest">{account.level || 'STAFF'}</span>
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="py-4 px-4 text-center">
                          <span className={cn(
                            "text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-widest",
                            account.status === 'APPROVED' ? "bg-emerald-50 text-emerald-600" : "bg-stone-100 text-stone-500"
                          )}>
                            {account.status}
                          </span>
                        </td>
                        <td className="py-4 pl-4 pr-6">
                          <div className="flex items-center justify-end gap-2">
                            {editingId === account.id ? (
                              <>
                                <Button size="icon" variant="success_soft" onClick={() => saveEdit(account.id)} title="Save">
                                  <Save className="w-4 h-4" />
                                </Button>
                                <Button size="icon" variant="secondary" onClick={() => setEditingId(null)} title="Cancel">
                                  <X className="w-4 h-4" />
                                </Button>
                              </>
                            ) : (
                              <>
                                <Button size="icon" variant="secondary" onClick={() => startEdit(account)} disabled={account.role === 'FC' && account.username !== user?.username && user?.username.toLowerCase() !== 'eghy' && user?.username.toLowerCase() !== 'ludy'} title="Edit Role">
                                  <Edit2 className="w-4 h-4" />
                                </Button>
                                <Button size="icon" variant="danger_soft" onClick={() => handleDelete(account.id)} disabled={account.username === user.username} title="Delete Account">
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
             </div>
          </div>
        </div>
      )}
      {/* Confirmation Modal */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        onConfirm={confirmModal.onConfirm}
        onCancel={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
        confirmText={confirmModal.title.includes('Reset') ? 'Reset' : "Delete"}
      />

      {/* Danger Zone */}
      <div className="pt-24 mt-24 border-t border-stone-100 pb-12">
        <h3 className="text-xl font-bold text-red-600 mb-2">Danger Zone</h3>
        <p className="text-stone-500 text-sm mb-6">These actions are destructive and cannot be undone. Handle with extreme caution.</p>
        
        <div className="space-y-4">
          <div className="bg-red-50/30 border border-red-100 rounded-3xl p-8 flex flex-col md:flex-row items-center justify-between gap-6">
            <div>
              <h4 className="font-bold text-stone-900 mb-1">Factory Data Reset ERP & HRIS</h4>
              <p className="text-stone-500 text-xs">Wipe all projects, tasks, inventory, social, and HRIS/attendance data. User accounts will be preserved.</p>
            </div>
            <Button 
              variant="danger"
              onClick={() => {
                setConfirmModal({
                  isOpen: true,
                  title: 'Factory Data Reset',
                  message: 'CRITICAL: This will permanently delete ALL transactional and master data from the entire system (including ERP projects, inventory, AND HRIS attendance, payroll, metrics). ONLY user accounts will remain. This action is IRREVERSIBLE. Are you absolutely certain?',
                  onConfirm: async () => {
                    try {
                      const res = await apiFetch('/api/admin/reset-factory', { method: 'POST' }, user?.username);
                      if (res.ok) {
                        showToast('Full Factory reset successful. System is now clean.', 'success');
                        // Force reload to clear state
                        setTimeout(() => window.location.reload(), 2000);
                      } else {
                        showToast(res.error || 'Failed to perform reset', 'error');
                      }
                    } catch (e) {
                      showToast('Error performing reset', 'error');
                    } finally {
                      setConfirmModal(prev => ({ ...prev, isOpen: false }));
                    }
                  }
                });
              }}
            >
              <AlertTriangle className="w-4 h-4" /> Reset
            </Button>
          </div>

          <div className="bg-orange-50/30 border border-orange-100 rounded-3xl p-8 flex flex-col md:flex-row items-center justify-between gap-6">
            <div>
              <h4 className="font-bold text-stone-900 mb-1">Factory Reset HRIS & Human Resource Data</h4>
              <p className="text-stone-500 text-xs">Wipe only HRIS data (Attendance records, Performance KPI appraisal reports, Resignation handovers, Leaves, Payroll and Payslips, Recruitment and Careers CMS). All other ERP inventory and projects are preserved.</p>
            </div>
            <Button 
              className="bg-orange-600 hover:bg-orange-700 text-white border-orange-600 rounded-[1.2rem] px-5 py-3 text-xs font-bold transition-all duration-300 flex items-center gap-2"
              onClick={() => {
                setConfirmModal({
                  isOpen: true,
                  title: 'Reset HRIS & HR Data',
                  message: 'WARNING: This will permanently delete all HRIS data including attendance sheets, KPIs, payroll lists, and leave logs. It will NOT affect ERP assets, stock levels, or projects. Are you sure you want to reset the Human Resource data back to default factory clean template?',
                  onConfirm: async () => {
                    try {
                      const res = await apiFetch('/api/admin/reset-hris', { method: 'POST' }, user?.username);
                      if (res.ok) {
                        showToast('HRIS and Human Resource data reset successfully.', 'success');
                        setTimeout(() => window.location.reload(), 2000);
                      } else {
                        showToast(res.error || 'Failed to reset HRIS data', 'error');
                      }
                    } catch (e) {
                      showToast('Error resetting HRIS data', 'error');
                    } finally {
                      setConfirmModal(prev => ({ ...prev, isOpen: false }));
                    }
                  }
                });
              }}
            >
              <AlertTriangle className="w-4 h-4" /> Reset
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
