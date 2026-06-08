import { safeFetchJson, apiFetch } from '@/utils/api';
import React, { useEffect, useState } from 'react';
import { Building2, Plus, Search, Mail, Phone, MapPin, X, Award, TrendingUp, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/shared/PageHeader';
import { Loader } from '@/components/shared/Loader';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { ConfirmModal } from '@/components/shared/ConfirmModal';
import { Action, hasPermission } from '@/utils/pbac';

interface Customer {
  id: string;
  name: string;
  code: string;
  contact_person?: string;
  email: string;
  phone: string;
  address: string;
  delivered_count?: number;
  pending_count?: number;
  total_deliveries?: number;
}

interface Lead {
  id: string;
  name: string;
  contact_info: string;
  intent: string;
  status: string;
  created_at: string;
}

export default function Customers() {
  const { showToast } = useToast();
  const { user } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const canModify = hasPermission(user, Action.MANAGE_CUSTOMERS);

  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<Customer | null>(null);

  const fetchCustomersAndLeads = async () => {
    setIsLoading(true);
    try {
      const [resCust, resLeads] = await Promise.all([
        apiFetch('/api/sales/customers', {}, user?.username),
        apiFetch('/api/sales/leads', {}, user?.username)
      ]);
      
      if (resCust.ok) setCustomers(Array.isArray(resCust.data) ? resCust.data : []);
      if (resLeads.ok) setLeads(Array.isArray(resLeads.data) ? resLeads.data : []);
      
    } catch (err) {
      console.error(err);
      showToast("Error fetching data", "error");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCustomersAndLeads();
  }, [user]);

  const handleConvertLead = async (leadId: string) => {
    setIsSubmitting(true);
    try {
      const res = await apiFetch(`/api/sales/leads/${leadId}/convert`, { method: 'POST' }, user?.username);
      if (res.ok) {
        showToast("Lead successfully converted to Customer!", "success");
        fetchCustomersAndLeads();
      } else {
        showToast(res.error || "Failed to convert lead", "error");
      }
    } catch (err) {
      console.error(err);
      showToast("Error converting lead", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteLead = async (leadId: string) => {
    if (!confirm("Are you sure you want to delete this lead?")) return;
    setIsSubmitting(true);
    try {
      const res = await apiFetch(`/api/sales/leads/${leadId}`, { method: 'DELETE' }, user?.username);
      if (res.ok) {
        showToast("Lead deleted", "success");
        fetchCustomersAndLeads();
      } else {
        showToast(res.error || "Failed to delete lead", "error");
      }
    } catch (err) {
      console.error(err);
      showToast("Error deleting lead", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCustomer) return;
    setIsSubmitting(true);
    try {
      const res = await apiFetch(`/api/sales/customers/${editingCustomer.id}`, {
        method: 'PUT',
        body: JSON.stringify(editingCustomer)
      }, user?.username);
      if (res.ok) {
        setShowEditModal(false);
        setEditingCustomer(null);
        fetchCustomersAndLeads();
        showToast("Customer profile updated successfully", "success");
      } else {
        showToast(res.error || "Failed to update customer", "error");
      }
    } catch (err) {
      console.error(err);
      showToast("Error updating customer", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteCustomer = async (id: string) => {
    setIsSubmitting(true);
    try {
      const res = await apiFetch(`/api/sales/customers/${id}`, { 
        method: 'DELETE'
      }, user?.username);
      if (res.ok) {
        setDeleteConfirm(null);
        fetchCustomersAndLeads();
        showToast("Customer profile deleted successfully", "success");
      } else {
        showToast(res.error || "Failed to delete customer", "error");
      }
    } catch (err) {
      console.error(err);
      showToast("Error deleting customer", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const [newCustomer, setNewCustomer] = useState({ name: '', code: '', contact_person: '', email: '', phone: '', address: '' });

  const handleAddCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const res = await apiFetch('/api/sales/customers', {
        method: 'POST',
        body: JSON.stringify(newCustomer)
      }, user?.username);
      if (res.ok) {
        setShowAddModal(false);
        setNewCustomer({ name: '', code: '', contact_person: '', email: '', phone: '', address: '' });
        fetchCustomersAndLeads();
        showToast("Customer profile added successfully", "success");
      } else {
        showToast(res.error || "Failed to add customer", "error");
      }
    } catch (err) {
      console.error(err);
      showToast("Error adding customer", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredCustomers = customers.filter(c => 
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (c.code && c.code.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const [selectedFilter, setSelectedFilter] = useState<'ALL' | 'VIP' | 'ACTIVE' | 'LEADS'>('ALL');

  const totalCust = customers.length;
  const tierACust = customers.filter(c => {
    const del = c.delivered_count || 0;
    const tot = c.total_deliveries || 0;
    return tot > 0 && (del / tot) >= 0.95;
  }).length;
  const totalCompletedDeliveries = customers.reduce((acc, c) => acc + (c.delivered_count || 0), 0);
  const activePipelines = customers.reduce((acc, c) => acc + (c.pending_count || 0), 0);
  const totalLeads = leads.filter(l => l.status !== 'CONVERTED').length;

  const displayedCustomers = filteredCustomers.filter(c => {
    if (selectedFilter === 'VIP') {
      const del = c.delivered_count || 0;
      const tot = c.total_deliveries || 0;
      return tot > 0 && (del / tot) >= 0.95;
    }
    if (selectedFilter === 'ACTIVE') {
      return (c.pending_count || 0) > 0;
    }
    return true;
  });

  const displayedLeads = leads.filter(l => l.status !== 'CONVERTED' && l.name.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="space-y-10 pb-20 animate-in fade-in duration-500">
      <PageHeader
        title="Customer Relations"
        subtitle="Strategic CRM Client Catalog & Partner Fulfillment Matrix"
        icon={<Building2 className="w-6 h-6" />}
        actions={
          canModify && (
            <button 
              onClick={() => setShowAddModal(true)}
              className="px-8 py-3 bg-stone-900 text-white text-xs font-bold uppercase tracking-widest rounded-2xl hover:bg-stone-800 transition-all active:scale-95 flex items-center gap-2 shadow-sm pointer-events-auto"
            >
              <Plus className="w-4 h-4" /> Add Corporate Client
            </button>
          )
        }
      />

      {/* CRM Dashboard Intelligence Panel */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
         <div className="p-6 bg-white border border-stone-200 rounded-3xl shadow-sm flex items-center gap-5">
            <div className="w-12 h-12 rounded-2xl bg-stone-50 border border-stone-100 flex items-center justify-center text-stone-600 shrink-0">
               <Building2 className="w-5 h-5" />
            </div>
            <div>
               <div className="text-[9px] font-bold text-stone-400 uppercase tracking-widest">Active Directory</div>
               <div className="text-2xl font-black text-stone-900 mt-1">{totalCust}</div>
               <div className="text-[10px] text-stone-500 font-semibold mt-0.5">Corporate Client Accounts</div>
            </div>
         </div>

         <div className="p-6 bg-white border border-stone-200 rounded-3xl shadow-sm flex items-center gap-5">
            <div className="w-12 h-12 rounded-2xl bg-stone-50 border border-stone-100 flex items-center justify-center text-stone-600 shrink-0">
               <Award className="w-5 h-5" />
            </div>
            <div>
               <div className="text-[9px] font-bold text-stone-400 uppercase tracking-widest">VIP Key Partners</div>
               <div className="text-2xl font-black text-stone-900 mt-1">{tierACust}</div>
               <div className="text-[10px] text-stone-500 font-semibold mt-0.5">&gt;95% Fulfillment Rating</div>
            </div>
         </div>

         <div className="p-6 bg-white border border-stone-200 rounded-3xl shadow-sm flex items-center gap-5">
            <div className="w-12 h-12 rounded-2xl bg-stone-50 border border-stone-100 flex items-center justify-center text-stone-600 shrink-0">
               <CheckCircle2 className="w-5 h-5" />
            </div>
            <div>
               <div className="text-[9px] font-bold text-stone-400 uppercase tracking-widest">Total Deliveries</div>
               <div className="text-2xl font-black text-stone-900 mt-1">{totalCompletedDeliveries}</div>
               <div className="text-[10px] text-stone-500 font-semibold mt-0.5">Dispatched Lots</div>
            </div>
         </div>

         <div className="p-6 bg-white border border-stone-200 rounded-3xl shadow-sm flex items-center gap-5">
            <div className="w-12 h-12 rounded-2xl bg-stone-50 border border-stone-100 flex items-center justify-center text-stone-600 shrink-0">
               <TrendingUp className="w-5 h-5" />
            </div>
            <div>
               <div className="text-[9px] font-bold text-stone-400 uppercase tracking-widest">Pipeline Lots</div>
               <div className="text-2xl font-black text-stone-900 mt-1">{activePipelines}</div>
               <div className="text-[10px] text-stone-500 font-semibold mt-0.5">Pending Deliveries Today</div>
            </div>
         </div>
      </div>

      {/* Filter and Workspace Control */}
      <div className="bg-white border border-stone-200 rounded-3xl p-6 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
         <div className="relative max-w-sm w-full">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
            <input 
              type="text"
              placeholder="Filter by customer name or lot reference..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-3 bg-stone-50 border border-stone-200/60 rounded-2xl text-xs font-bold text-stone-900 focus:border-stone-400 focus:bg-white outline-none transition-all shadow-inner"
            />
         </div>

         <div className="flex gap-2 bg-stone-50 border border-stone-200/60 p-1.5 rounded-2xl overflow-x-auto">
            <button 
              onClick={() => setSelectedFilter('LEADS')}
              className={cn(
                "px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap flex items-center gap-1.5",
                selectedFilter === 'LEADS' ? "bg-stone-900 text-white shadow-sm" : "text-stone-400 hover:text-stone-900"
              )}
            >
               CRM Leads ({totalLeads})
            </button>
            <button 
              onClick={() => setSelectedFilter('ALL')}
              className={cn(
                "px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap",
                selectedFilter === 'ALL' ? "bg-white text-stone-900 shadow-sm" : "text-stone-400 hover:text-stone-900"
              )}
            >
               Clients
            </button>
            <button 
              onClick={() => setSelectedFilter('VIP')}
              className={cn(
                "px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap flex items-center gap-1.5",
                selectedFilter === 'VIP' ? "bg-white text-stone-900 shadow-sm" : "text-stone-400 hover:text-stone-900"
              )}
            >
               <Award className="w-3.5 h-3.5" /> VIP ({tierACust})
            </button>
            <button 
              onClick={() => setSelectedFilter('ACTIVE')}
              className={cn(
                "px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-1.5 whitespace-nowrap",
                selectedFilter === 'ACTIVE' ? "bg-white text-stone-900 shadow-sm" : "text-stone-400 hover:text-stone-900"
              )}
            >
               Pending ({activePipelines})
            </button>
         </div>
      </div>

      {/* CRM Customer List Layout (Table) */}
      <div className="bg-white border border-stone-200 rounded-3xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              {selectedFilter === 'LEADS' ? (
              <tr className="border-b border-stone-200 bg-stone-50/50">
                <th className="px-6 py-4 text-[10px] font-bold text-stone-400 uppercase tracking-widest whitespace-nowrap">Lead Info</th>
                <th className="px-6 py-4 text-[10px] font-bold text-stone-400 uppercase tracking-widest whitespace-nowrap">Intent / Status</th>
                <th className="px-6 py-4 text-[10px] font-bold text-stone-400 uppercase tracking-widest whitespace-nowrap">Generated At</th>
                <th className="px-6 py-4 text-[10px] font-bold text-stone-400 uppercase tracking-widest whitespace-nowrap">Contact</th>
                {canModify && <th className="px-6 py-4 text-[10px] font-bold text-stone-400 uppercase tracking-widest text-right whitespace-nowrap">Actions</th>}
              </tr>
              ) : (
              <tr className="border-b border-stone-200 bg-stone-50/50">
                <th className="px-6 py-4 text-[10px] font-bold text-stone-400 uppercase tracking-widest whitespace-nowrap">Customer Info</th>
                <th className="px-6 py-4 text-[10px] font-bold text-stone-400 uppercase tracking-widest whitespace-nowrap">Tier / Code</th>
                <th className="px-6 py-4 text-[10px] font-bold text-stone-400 uppercase tracking-widest whitespace-nowrap">Fulfillment Score</th>
                <th className="px-6 py-4 text-[10px] font-bold text-stone-400 uppercase tracking-widest whitespace-nowrap">Contact & Logistics</th>
                {canModify && <th className="px-6 py-4 text-[10px] font-bold text-stone-400 uppercase tracking-widest text-right whitespace-nowrap">Actions</th>}
              </tr>
              )}
            </thead>
            <tbody className="divide-y divide-stone-100">
              {isLoading ? (
                <tr>
                  <td colSpan={canModify ? 5 : 4} className="py-20 text-center">
                    <Loader text="Loading global registry..." />
                  </td>
                </tr>
              ) : selectedFilter === 'LEADS' ? (
                displayedLeads.length === 0 ? (
                  <tr>
                    <td colSpan={canModify ? 5 : 4} className="py-20 text-center text-stone-400">
                      <Building2 className="w-8 h-8 text-stone-200 mx-auto mb-3" />
                      <div className="text-[10px] font-bold uppercase tracking-widest">No matching leads records</div>
                    </td>
                  </tr>
                ) : (
                  displayedLeads.map((lead) => (
                    <tr key={lead.id} className="hover:bg-stone-50/50 transition-colors group">
                      <td className="px-6 py-5 align-top">
                        <div className="flex items-start gap-3">
                          <div className="w-8 h-8 rounded-xl bg-orange-50 flex items-center justify-center text-orange-400 shrink-0 mt-0.5 border border-orange-100">
                            <Building2 className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="text-sm font-bold text-stone-900">{lead.name}</div>
                            <div className="text-[10px] text-stone-400 uppercase tracking-widest mt-1 font-bold">Unconverted Lead</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-5 align-top">
                         <div className="text-xs font-semibold text-stone-800">{lead.intent}</div>
                      </td>
                      <td className="px-6 py-5 align-top text-xs text-stone-500">
                         {new Date(lead.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-5 align-top text-xs text-stone-600 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <MapPin className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                          <span className="truncate max-w-[200px] font-semibold text-stone-800">{lead.contact_info || '-'}</span>
                        </div>
                      </td>
                      {canModify && (
                        <td className="px-6 py-5 align-top text-right">
                          <div className="flex flex-col items-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button 
                              size="xs"
                              variant="primary"
                              disabled={isSubmitting}
                              onClick={() => handleConvertLead(lead.id)}
                            >
                              Convert to Customer
                            </Button>
                            <Button 
                              size="xs"
                              variant="danger_soft"
                              disabled={isSubmitting}
                              onClick={() => handleDeleteLead(lead.id)}
                            >
                              Delete
                            </Button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))
                )
              ) : displayedCustomers.length === 0 ? (
                <tr>
                  <td colSpan={canModify ? 5 : 4} className="py-20 text-center text-stone-400">
                    <Building2 className="w-8 h-8 text-stone-200 mx-auto mb-3" />
                    <div className="text-[10px] font-bold uppercase tracking-widest">No matching customer records</div>
                  </td>
                </tr>
              ) : (
                displayedCustomers.map((cus) => {
                  const delivered = cus.delivered_count || 0;
                  const pending = cus.pending_count || 0;
                  const totalDeliveries = cus.total_deliveries || 0;
                  
                  let grade = 'NEW';
                  let gradeColor = 'bg-stone-50 text-stone-600 border-stone-200';
                  let rate = 0;

                  if (totalDeliveries > 0) {
                     rate = delivered / totalDeliveries;
                     if (rate >= 0.95) {
                       grade = 'A';
                       gradeColor = 'bg-stone-800 text-stone-100 border-stone-700';
                     } else if (rate >= 0.8) {
                       grade = 'B';
                       gradeColor = 'bg-stone-200 text-stone-800 border-stone-300';
                     } else if (rate >= 0.6) {
                       grade = 'C';
                       gradeColor = 'bg-stone-100 text-stone-600 border-stone-200';
                     } else {
                       grade = 'D';
                       gradeColor = 'bg-red-50 text-red-700 border-red-200';
                     }
                  }

                  const percentFulfill = totalDeliveries > 0 ? Math.round((delivered / totalDeliveries) * 100) : 0;

                  return (
                    <tr key={cus.id} className="hover:bg-stone-50/50 transition-colors group">
                      <td className="px-6 py-5 align-top">
                        <div className="flex items-start gap-3">
                          <div className="w-8 h-8 rounded-xl bg-stone-100 flex items-center justify-center text-stone-400 shrink-0 mt-0.5">
                            <Building2 className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="text-sm font-bold text-stone-900">{cus.name}</div>
                            {cus.contact_person && (
                              <div className="text-xs text-stone-500 mt-1 flex items-center gap-1.5">
                                <span className="w-1 h-1 rounded-full bg-stone-300"></span> {cus.contact_person} (Liaison)
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-5 align-top text-xs font-mono text-stone-500">
                        <div className="flex flex-col items-start gap-1.5">
                          <span className="font-bold">{cus.code || 'NO-REF-GEN'}</span>
                          <span className={cn("px-2 py-0.5 text-[9px] tracking-widest font-black uppercase rounded border font-sans", gradeColor)}>
                            {grade === 'NEW' ? 'Lead' : `Tier ${grade}`}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-5 align-top">
                        <div className="w-40">
                          <div className="flex justify-between items-center text-[10px] font-bold text-stone-500 mb-1.5">
                            <span>{percentFulfill}% Achieved</span>
                            <span>{totalDeliveries} Total</span>
                          </div>
                          <div className="w-full bg-stone-100 h-1.5 rounded-full overflow-hidden">
                            <div 
                              className={cn(
                                "h-full rounded-full transition-all duration-500",
                                percentFulfill >= 95 ? "bg-stone-800" :
                                percentFulfill >= 80 ? "bg-stone-400" :
                                percentFulfill >= 60 ? "bg-stone-300" : "bg-red-400"
                              )}
                              style={{ width: `${totalDeliveries > 0 ? percentFulfill : 10}%` }}
                            ></div>
                          </div>
                          <div className="flex gap-3 text-[10px] font-bold mt-1.5">
                            <span className="text-stone-700">{delivered} OK</span>
                            <span className="text-stone-400">{pending} Pend</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-5 align-top text-xs text-stone-600 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <Mail className="w-3.5 h-3.5 text-stone-400" />
                          <span className="truncate max-w-[180px]">{cus.email || '-'}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Phone className="w-3.5 h-3.5 text-stone-400" />
                          <span>{cus.phone || '-'}</span>
                        </div>
                        <div className="flex items-start gap-2 max-w-[200px]">
                          <MapPin className="w-3.5 h-3.5 text-stone-400 mt-0.5 shrink-0" />
                          <span className="truncate">{cus.address || '-'}</span>
                        </div>
                      </td>
                      {canModify && (
                        <td className="px-6 py-5 align-top text-right">
                          <div className="flex flex-col items-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button 
                              size="xs"
                              variant="secondary"
                              onClick={() => {
                                setEditingCustomer(cus);
                                setShowEditModal(true);
                              }}
                            >
                              Configure
                            </Button>
                            <Button 
                              size="xs"
                              variant="danger_soft"
                              onClick={() => setDeleteConfirm(cus)}
                            >
                              Archive
                            </Button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Customer Modal */}
      <Modal
        isOpen={showEditModal && editingCustomer !== null}
        onClose={() => setShowEditModal(false)}
        title="Edit Customer Profile"
        description="Update external recipient information"
      >
        {editingCustomer && (
          <form onSubmit={handleUpdateCustomer} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Customer Name</label>
                <input 
                  required
                  value={editingCustomer.name}
                  onChange={e => setEditingCustomer({...editingCustomer, name: e.target.value})}
                  className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:border-stone-400 outline-none"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Customer Code</label>
                <input 
                  required
                  value={editingCustomer.code || ''}
                  onChange={e => setEditingCustomer({...editingCustomer, code: e.target.value.toUpperCase()})}
                  className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:border-stone-400 outline-none font-mono font-bold"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Contact Person</label>
              <input 
                value={editingCustomer.contact_person || ''}
                onChange={e => setEditingCustomer({...editingCustomer, contact_person: e.target.value})}
                className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:border-stone-400 outline-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Email</label>
                <input 
                  type="email"
                  value={editingCustomer.email || ''}
                  onChange={e => setEditingCustomer({...editingCustomer, email: e.target.value})}
                  className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:border-stone-400 outline-none"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Phone</label>
                <input 
                  value={editingCustomer.phone || ''}
                  onChange={e => setEditingCustomer({...editingCustomer, phone: e.target.value})}
                  className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:border-stone-400 outline-none"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Address</label>
              <textarea 
                value={editingCustomer.address || ''}
                onChange={e => setEditingCustomer({...editingCustomer, address: e.target.value})}
                className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:border-stone-400 outline-none min-h-[80px]"
              />
            </div>
            <div className="flex justify-end gap-3 pt-4 border-t border-stone-100 font-sans">
              <Button type="button" variant="secondary" onClick={() => setShowEditModal(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={deleteConfirm !== null}
        onCancel={() => setDeleteConfirm(null)}
        onConfirm={() => deleteConfirm && handleDeleteCustomer(deleteConfirm.id)}
        title="Delete Customer Profile?"
        message={`Are you sure you want to delete ${deleteConfirm?.name}? This action cannot be undone and will only succeed if the customer has no active delivery manifests or associated records.`}
        confirmText={isSubmitting ? 'Deleting...' : 'Confirm Delete'}
        isDestructive={true}
      />

      {/* Add Customer Modal */}
      <Modal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="Add New Customer Profile"
        description="Register a new external client in the master data"
      >
        <form onSubmit={handleAddCustomer} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Customer Name</label>
              <input 
                required
                value={newCustomer.name}
                onChange={e => setNewCustomer({...newCustomer, name: e.target.value})}
                className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:border-stone-400 outline-none"
                placeholder="e.g. PT. Paving Nusantara"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Customer Code</label>
              <input 
                value={newCustomer.code}
                onChange={e => setNewCustomer({...newCustomer, code: e.target.value.toUpperCase()})}
                className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:border-stone-400 outline-none font-mono"
                placeholder="e.g. CUS-001"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Contact Person</label>
            <input 
              value={newCustomer.contact_person}
              onChange={e => setNewCustomer({...newCustomer, contact_person: e.target.value})}
              className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:border-stone-400 outline-none"
              placeholder="e.g. Bpk. Ahmad"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Email</label>
              <input 
                type="email"
                value={newCustomer.email}
                onChange={e => setNewCustomer({...newCustomer, email: e.target.value})}
                className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:border-stone-400 outline-none"
                placeholder="procurement@client.com"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Phone</label>
              <input 
                value={newCustomer.phone}
                onChange={e => setNewCustomer({...newCustomer, phone: e.target.value})}
                className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:border-stone-400 outline-none"
                placeholder="0812-xxxx-xxxx"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Address</label>
            <textarea 
              value={newCustomer.address}
              onChange={e => setNewCustomer({...newCustomer, address: e.target.value})}
              className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:border-stone-400 outline-none min-h-[80px]"
              placeholder="Jl. Pahlawan Karya No. 456..."
            />
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t border-stone-100 font-sans">
            <Button type="button" variant="secondary" onClick={() => setShowAddModal(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Save Customer'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
