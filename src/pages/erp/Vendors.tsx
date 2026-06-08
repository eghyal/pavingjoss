import { safeFetchJson, apiFetch } from '@/utils/api';
import React, { useEffect, useState } from 'react';
import { Users, Plus, Search, Mail, Phone, MapPin, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/shared/PageHeader';
import { Loader } from '@/components/shared/Loader';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { ConfirmModal } from '@/components/shared/ConfirmModal';
import { Action, hasPermission } from '@/utils/pbac';

interface Supplier {
  id: string;
  name: string;
  code: string;
  contact_person: string;
  email: string;
  phone: string;
  address: string;
  passed_count?: number;
  rejected_count?: number;
  total_orders?: number;
}

export default function Vendors() {
  const { showToast } = useToast();
  const { user } = useAuth();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const canModify = hasPermission(user, Action.MANAGE_VENDORS);

  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<Supplier | null>(null);

  const fetchSuppliers = async () => {
    setIsLoading(true);
    try {
      const res = await apiFetch('/api/suppliers', {}, user?.username);
      if (res.ok) {
        setSuppliers(Array.isArray(res.data) ? res.data : []);
      } else {
        showToast(res.error || "Failed to fetch suppliers", "error");
      }
    } catch (err) {
      console.error(err);
      showToast("Error fetching suppliers", "error");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSuppliers();
  }, []);

  const handleUpdateSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSupplier) return;
    setIsSubmitting(true);
    try {
      const res = await apiFetch(`/api/suppliers/${editingSupplier.id}`, {
        method: 'PUT',
        body: JSON.stringify(editingSupplier)
      }, user?.username);
      if (res.ok) {
        setShowEditModal(false);
        setEditingSupplier(null);
        fetchSuppliers();
        showToast("Supplier updated successfully", "success");
      } else {
        showToast(res.error || "Failed to update supplier", "error");
      }
    } catch (err) {
      console.error(err);
      showToast("Error updating supplier", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteSupplier = async (id: string) => {
    setIsSubmitting(true);
    try {
      const res = await apiFetch(`/api/suppliers/${id}`, { 
        method: 'DELETE'
      }, user?.username);
      if (res.ok) {
        setDeleteConfirm(null);
        fetchSuppliers();
        showToast("Supplier deleted successfully", "success");
      } else {
        showToast(res.error || "Failed to delete supplier", "error");
      }
    } catch (err) {
      console.error(err);
      showToast("Error deleting supplier", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const [newSupplier, setNewSupplier] = useState({ name: '', code: '', contact_person: '', email: '', phone: '', address: '' });

  const handleAddSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const res = await apiFetch('/api/suppliers', {
        method: 'POST',
        body: JSON.stringify(newSupplier)
      }, user?.username);
      if (res.ok) {
        setShowAddModal(false);
        setNewSupplier({ name: '', code: '', contact_person: '', email: '', phone: '', address: '' });
        fetchSuppliers();
        showToast("Supplier added successfully", "success");
      } else {
        showToast(res.error || "Failed to add supplier", "error");
      }
    } catch (err) {
      console.error(err);
      showToast("Error adding supplier", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredSuppliers = suppliers.filter(s => 
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (s.code && s.code.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="space-y-12 pb-20 animate-in fade-in duration-500">
      <PageHeader
        title="Supplier Profiles"
        subtitle="Strategic Supplier Directory & Master Data"
        icon={<Users className="w-6 h-6" />}
        actions={
          canModify && (
            <button 
              onClick={() => setShowAddModal(true)}
              className="px-8 py-3 bg-stone-800 text-white text-sm font-bold rounded-2xl hover:bg-stone-900 transition-all active:scale-95 flex items-center gap-2 shadow-sm"
            >
              <Plus className="w-5 h-5" /> Add New Supplier
            </button>
          )
        }
      />

      <div className="bg-white border border-stone-200 rounded-xl shadow-[0_2px_10px_-3px_rgba(6,81,237,0.05)] overflow-hidden">
        <div className="p-5 border-b border-stone-100 flex items-center justify-between">
          <div className="relative max-w-sm w-full">
            <Search className="absolute left-0 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
            <input 
              type="text"
              placeholder="Search vendors..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-7 pr-4 py-1.5 bg-transparent border-b border-stone-200 text-sm focus:border-stone-400 outline-none transition-colors"
            />
          </div>
          <div className="text-xs text-stone-400 font-medium bg-stone-50 px-3 py-1 rounded-full border border-stone-100">
            {filteredSuppliers.length} Total
          </div>
        </div>
      </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {isLoading ? (
            <div className="col-span-full"><Loader text="Loading suppliers..." className="py-20" /></div>
          ) : filteredSuppliers.length === 0 ? (
            <div className="col-span-full empty-state my-8">
               <Users className="w-8 h-8 text-stone-300 mb-4" />
               <div className="text-[10px] text-stone-400 font-bold uppercase tracking-[0.2em]">No Suppliers Found</div>
            </div>
          ) : (
            filteredSuppliers.map((sup) => {
              const passed = sup.passed_count || 0;
              const rejected = sup.rejected_count || 0;
              const totalOrders = sup.total_orders || 0;
              const totalGrns = passed + rejected;
              
              let grade = 'NEW';
              let gradeColor = 'bg-blue-50 text-blue-700 border-blue-200';
              let healthScore = 0;

              if (totalOrders > 0 && totalGrns === 0) {
                 grade = 'PEN';
                 gradeColor = 'bg-stone-50 text-stone-500 border-stone-200';
              } else if (totalGrns > 0) {
                 healthScore = passed / totalGrns;
                 if (healthScore >= 0.95) {
                   grade = 'A';
                   gradeColor = 'bg-emerald-50 text-emerald-700 border-emerald-200';
                 } else if (healthScore >= 0.8) {
                   grade = 'B';
                   gradeColor = 'bg-lime-50 text-lime-700 border-lime-200';
                 } else if (healthScore >= 0.6) {
                   grade = 'C';
                   gradeColor = 'bg-amber-50 text-amber-700 border-amber-200';
                 } else {
                   grade = 'D';
                   gradeColor = 'bg-red-50 text-red-700 border-red-200';
                 }
              }

              return (
              <div key={sup.id} className="bg-white p-6 border border-stone-200 rounded-xl hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 group">
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <h3 className="text-sm font-bold text-stone-900 tracking-tight flex items-center gap-2">
                       {sup.name}
                    </h3>
                    <div className="text-[10px] text-stone-400 font-bold tracking-widest uppercase mt-1 flex items-center gap-2">
                       {sup.code || 'NO CODE'}
                       <span className={cn("px-1.5 py-0.5 text-[9px] rounded-sm font-semibold border", gradeColor)}>
                         {grade === 'NEW' || grade === 'PEN' ? grade : `GRADE ${grade}`}
                       </span>
                    </div>
                  </div>
                  <div className="p-2.5 bg-stone-50 rounded-full text-stone-400 group-hover:text-stone-900 group-hover:bg-stone-100 transition-colors">
                    <Users className="w-4 h-4" />
                  </div>
                </div>
                
                <div className="space-y-3">
                  <div className="flex items-center gap-3 text-sm text-stone-600">
                    <Mail className="w-4 h-4 text-stone-400" />
                    {sup.email || <span className="text-stone-400 italic">No email</span>}
                  </div>
                  <div className="flex items-center gap-3 text-sm text-stone-600">
                    <Phone className="w-4 h-4 text-stone-400" />
                    {sup.phone || <span className="text-stone-400 italic">No phone</span>}
                  </div>
                  <div className="flex items-start gap-3 text-sm text-stone-600">
                    <MapPin className="w-4 h-4 text-stone-400 mt-0.5 shrink-0" />
                    <span className="line-clamp-2">{sup.address || <span className="text-stone-400 italic">No address</span>}</span>
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-stone-50 grid grid-cols-3 gap-2 text-center items-center font-sans">
                  <div className="bg-stone-50/80 p-2 rounded-xl">
                    <div className="text-[9px] font-bold text-stone-400 tracking-widest uppercase">Orders</div>
                    <div className="text-sm font-bold text-stone-900 mt-0.5">{totalOrders}</div>
                  </div>
                  <div className="bg-emerald-50/50 border border-emerald-100 p-2 rounded-xl">
                    <div className="text-[9px] font-bold text-emerald-600 tracking-widest uppercase">Passed</div>
                    <div className="text-sm font-bold text-emerald-700 mt-0.5">{passed}</div>
                  </div>
                  <div className="bg-rose-50/50 border border-rose-100 p-2 rounded-xl">
                    <div className="text-[9px] font-bold text-rose-600 tracking-widest uppercase">Rejected</div>
                    <div className="text-sm font-bold text-rose-700 mt-0.5">{rejected}</div>
                  </div>
                </div>

                {sup.contact_person && (
                  <div className="mt-6 pt-4 border-t border-stone-100 flex items-center justify-between">
                    <div className="text-[10px] text-stone-400 font-bold tracking-widest uppercase">Contact</div>
                    <div className="text-sm font-bold text-stone-800">{sup.contact_person}</div>
                  </div>
                )}

                {canModify && (
                  <div className="mt-4 pt-4 border-t border-stone-50 flex justify-end gap-2">
                    <Button 
                      size="xs"
                      variant="secondary"
                      onClick={() => {
                        setEditingSupplier(sup);
                        setShowEditModal(true);
                      }}
                    >
                      Edit
                    </Button>
                    <Button 
                      size="xs"
                      variant="danger_soft"
                      onClick={() => setDeleteConfirm(sup)}
                    >
                      Delete
                    </Button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Edit Supplier Modal */}
      <Modal
        isOpen={showEditModal && editingSupplier !== null}
        onClose={() => setShowEditModal(false)}
        title="Edit Supplier"
        description="Update vendor information"
      >
        {editingSupplier && (
          <form onSubmit={handleUpdateSupplier} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Supplier Name</label>
                <input 
                  required
                  value={editingSupplier.name}
                  onChange={e => setEditingSupplier({...editingSupplier, name: e.target.value})}
                  className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:border-stone-400 outline-none"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Supplier Code</label>
                <input 
                  value={editingSupplier.code || ''}
                  onChange={e => setEditingSupplier({...editingSupplier, code: e.target.value.toUpperCase()})}
                  className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:border-stone-400 outline-none"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Contact Person</label>
              <input 
                value={editingSupplier.contact_person || ''}
                onChange={e => setEditingSupplier({...editingSupplier, contact_person: e.target.value})}
                className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:border-stone-400 outline-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Email</label>
                <input 
                  type="email"
                  value={editingSupplier.email || ''}
                  onChange={e => setEditingSupplier({...editingSupplier, email: e.target.value})}
                  className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:border-stone-400 outline-none"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Phone</label>
                <input 
                  value={editingSupplier.phone || ''}
                  onChange={e => setEditingSupplier({...editingSupplier, phone: e.target.value})}
                  className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:border-stone-400 outline-none"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Address</label>
              <textarea 
                value={editingSupplier.address || ''}
                onChange={e => setEditingSupplier({...editingSupplier, address: e.target.value})}
                className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:border-stone-400 outline-none min-h-[80px]"
              />
            </div>
            <div className="flex justify-end gap-3 pt-4 border-t border-stone-100">
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
        onConfirm={() => deleteConfirm && handleDeleteSupplier(deleteConfirm.id)}
        title="Delete Supplier?"
        message={`Are you sure you want to delete ${deleteConfirm?.name}? This action cannot be undone and will only succeed if the supplier has no active orders.`}
        confirmText={isSubmitting ? 'Deleting...' : 'Confirm Delete'}
        isDestructive={true}
      />

      {/* Add Supplier Modal */}
      <Modal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="Add New Supplier"
        description="Register a new vendor in the master data"
      >
        <form onSubmit={handleAddSupplier} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Supplier Name</label>
              <input 
                required
                value={newSupplier.name}
                onChange={e => setNewSupplier({...newSupplier, name: e.target.value})}
                className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:border-stone-400 outline-none"
                placeholder="e.g. PT. Steel Indonesia"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Supplier Code</label>
              <input 
                value={newSupplier.code}
                onChange={e => setNewSupplier({...newSupplier, code: e.target.value.toUpperCase()})}
                className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:border-stone-400 outline-none"
                placeholder="e.g. SUP-001"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Contact Person</label>
            <input 
              value={newSupplier.contact_person}
              onChange={e => setNewSupplier({...newSupplier, contact_person: e.target.value})}
              className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:border-stone-400 outline-none"
              placeholder="e.g. Bpk. Budi"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Email</label>
              <input 
                type="email"
                value={newSupplier.email}
                onChange={e => setNewSupplier({...newSupplier, email: e.target.value})}
                className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:border-stone-400 outline-none"
                placeholder="sales@vendor.com"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Phone</label>
              <input 
                value={newSupplier.phone}
                onChange={e => setNewSupplier({...newSupplier, phone: e.target.value})}
                className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:border-stone-400 outline-none"
                placeholder="021-xxxxxx"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Address</label>
            <textarea 
              value={newSupplier.address}
              onChange={e => setNewSupplier({...newSupplier, address: e.target.value})}
              className="w-full px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm focus:border-stone-400 outline-none min-h-[80px]"
              placeholder="Jl. Raya Industri No. 123..."
            />
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t border-stone-100">
            <Button type="button" variant="secondary" onClick={() => setShowAddModal(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Save Supplier'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
