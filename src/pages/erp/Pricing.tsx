import { safeFetchJson, apiFetch } from '@/utils/api';
import React, { useState, useEffect, useMemo } from 'react';
import { useToast } from '@/contexts/ToastContext';
import { Package, CheckCircle2, AlertTriangle, History, Search, Filter, TrendingUp, TrendingDown, RefreshCw, BarChart2, Tag, DollarSign, Maximize, Minimize, Plus, Trash2, Edit } from 'lucide-react';
import { cn, formatCurrency, parseCurrency, formatIDR } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/shared/PageHeader';
import { Select } from '@/components/ui/Select';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from 'recharts';
import { Modal } from '@/components/ui/Modal';
import { ConfirmModal } from '@/components/shared/ConfirmModal';
import { Action, hasPermission, hasGodMode } from '@/utils/pbac';

export default function Pricing() {
  const [items, setItems] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [supplierPrices, setSupplierPrices] = useState<{ [itemId: string]: any[] }>({});
  const [isLoading, setIsLoading] = useState(true);
  const { showToast } = useToast();
  const { user } = useAuth();
  
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'NEEDS_PRICE' | 'HAS_PRICE'>('ALL');
  const [sortBy, setSortBy] = useState<'NAME' | 'CODE'>('CODE');
  
  // Modals
  const [historyModal, setHistoryModal] = useState<{ isOpen: boolean; itemId: string | null; itemName: string; history: any[] }>({ isOpen: false, itemId: null, itemName: '', history: [] });
  const [isHistoryFullscreen, setIsHistoryFullscreen] = useState(false);
  const [manageQuotesModal, setManageQuotesModal] = useState<{ isOpen: boolean; item: any | null }>({ isOpen: false, item: null });
  const [confirmModal, setConfirmModal] = useState<{ isOpen: boolean; title: string; message: string; action: () => void }>({ isOpen: false, title: '', message: '', action: () => {} });

  // Quote Form
  const [newQuoteSupplierId, setNewQuoteSupplierId] = useState('');
  const [newQuotePrice, setNewQuotePrice] = useState('');
  const [isSubmittingQuote, setIsSubmittingQuote] = useState(false);

  const fetchData = async () => {
    try {
      setIsLoading(true);
      const [itemsRes, suppliersRes, pricesRes] = await Promise.all([
        apiFetch('/api/inventory/full', {}, user?.username),
        apiFetch('/api/suppliers', {}, user?.username),
        apiFetch('/api/inventory/supplier-prices', {}, user?.username)
      ]);
      
      if (itemsRes.ok) setItems(itemsRes.data);
      if (suppliersRes.ok) setSuppliers(suppliersRes.data);
      if (pricesRes.ok) {
        const pricesByItem: { [key: string]: any[] } = {};
        pricesRes.data.forEach((p: any) => {
          if (!pricesByItem[p.item_id]) pricesByItem[p.item_id] = [];
          pricesByItem[p.item_id].push(p);
        });
        setSupplierPrices(pricesByItem);
      }
    } catch (err) {
      console.error(err);
      showToast("Error fetching data", "error");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleAddOrUpdateQuote = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!manageQuotesModal.item) return;
    const itemId = manageQuotesModal.item.id;
    const price = parseCurrency(newQuotePrice);
    
    if (!price || price <= 0) {
      showToast("Please enter a valid price", "error");
      return;
    }
    if (!newQuoteSupplierId) {
      showToast("Please select a vendor", "error");
      return;
    }

    setIsSubmittingQuote(true);
    try {
      const res = await apiFetch(`/api/inventory/items/${itemId}/supplier-prices`, {
        method: 'PUT',
        body: JSON.stringify({ unit_price: price, supplier_id: newQuoteSupplierId })
      }, user?.username);
      if (res.ok) {
        showToast("Quote added/updated successfully", "success");
        setNewQuotePrice('');
        setNewQuoteSupplierId('');
        await fetchData(); // Refresh all data to get updated quotes
      } else {
        showToast(res.error || "Failed to update quote", "error");
      }
    } catch (err) {
      console.error(err);
      showToast("Error updating quote", "error");
    } finally {
      setIsSubmittingQuote(false);
    }
  };

  const handleDeleteQuote = async (itemId: string, supplierId: string) => {
    try {
      const res = await apiFetch(`/api/inventory/items/${itemId}/supplier-prices/${supplierId}`, {
        method: 'DELETE'
      }, user?.username);
      if (res.ok) {
        showToast("Quote removed successfully", "success");
        await fetchData();
      } else {
        showToast(res.error || "Failed to remove quote", "error");
      }
    } catch (err) {
      console.error(err);
      showToast("Error removing quote", "error");
    }
  };

  const viewHistory = async (itemId: string, itemName: string) => {
    try {
      const res = await apiFetch(`/api/inventory/items/${itemId}/price-history`, {}, user?.username);
      if (res.ok) {
        setHistoryModal({ isOpen: true, itemId, itemName, history: res.data });
      }
    } catch (err) {
      console.error(err);
      showToast("Error fetching history", "error");
    }
  };

  const filteredItems = useMemo(() => {
    return items.filter(item => {
      const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                            item.item_code.toLowerCase().includes(searchQuery.toLowerCase());
      
      const hasPrices = supplierPrices[item.id] && supplierPrices[item.id].length > 0;
      const matchesFilter = filterStatus === 'ALL' || 
                            (filterStatus === 'NEEDS_PRICE' && !hasPrices) ||
                            (filterStatus === 'HAS_PRICE' && hasPrices);
      return matchesSearch && matchesFilter;
    }).sort((a, b) => {
      if (sortBy === 'NAME') return a.name.localeCompare(b.name);
      return a.item_code.localeCompare(b.item_code);
    });
  }, [items, searchQuery, filterStatus, sortBy, supplierPrices]);

  const itemsNeedingPrice = items.filter(i => {
    const hasAnyPrice = supplierPrices[i.id] && supplierPrices[i.id].length > 0;
    return !hasAnyPrice;
  }).length;

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const bestPrice = payload[0].payload.lowest_price ?? payload[0].value;
      const actualPrice = payload[0].payload.actual_unit_price ?? payload[0].payload.unit_price;
      return (
        <div className="bg-white p-4 border border-stone-100 shadow-xl rounded-xl shrink-0 text-left min-w-[240px]">
          <p className="text-[10px] text-stone-500 font-bold mb-1 uppercase tracking-widest">{new Date(label).toLocaleDateString('en-US', { timeZone: 'Asia/Jakarta' })}</p>
          <div className="space-y-1.5 mt-2">
            <div>
              <div className="text-[9px] text-emerald-600 font-extrabold uppercase tracking-widest">Calculated Best Price</div>
              <div className="text-sm font-bold text-emerald-700">{formatIDR(bestPrice)}</div>
            </div>
            <div className="border-t border-stone-100 pt-1.5">
              <div className="text-[9px] text-stone-400 font-extrabold uppercase tracking-widest">Supplier Update</div>
              <div className="text-xs font-bold text-stone-900">{formatIDR(actualPrice)}</div>
              <p className="text-[10px] text-stone-500 font-medium">{payload[0].payload.supplier_name}</p>
            </div>
          </div>
          <p className="text-[9px] text-stone-400 mt-2.5 pt-1.5 border-t border-stone-100 font-bold uppercase tracking-wider">Auth: {payload[0].payload.recorded_by || 'System'}</p>
        </div>
      );
    }
    return null;
  };

  const openManageQuotes = (item: any) => {
    setManageQuotesModal({ isOpen: true, item });
    setNewQuotePrice('');
    setNewQuoteSupplierId('');
  };

  const closeManageQuotes = () => {
    setManageQuotesModal({ isOpen: false, item: null });
  };

  if (!hasPermission(user, Action.MANAGE_PRICING)) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center min-h-[50vh]">
        <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mb-6">
          <AlertTriangle className="w-8 h-8 text-red-600" />
        </div>
        <h2 className="text-xl font-semibold text-stone-900 mb-2">Access Denied</h2>
        <p className="text-stone-500 max-w-md mx-auto">
          You do not have permission to access the Pricing Matrix.
        </p>
      </div>
    );
  }

  const currentItemQuotes = manageQuotesModal.item ? (supplierPrices[manageQuotesModal.item.id] || []) : [];
  // Sort quotes by price asc
  currentItemQuotes.sort((a, b) => a.unit_price - b.unit_price);

  return (
    <div className="space-y-12 pb-20 animate-in fade-in duration-500">
      <PageHeader
        title="Sourcing & Pricing"
        subtitle="Strategic Supplier Quotes & Market Sourcing"
        icon={<Tag className="w-6 h-6" />}
      />

      <div className="flex flex-col md:flex-row gap-4 items-center mb-8 border-b border-stone-100 pb-8">
        <div className="bg-white p-4 rounded-2xl border border-stone-200 shadow-sm flex items-center gap-4 min-w-[160px] flex-1 md:flex-none">
          <div className="w-10 h-10 rounded-xl bg-stone-50 flex items-center justify-center">
            <Package className="w-5 h-5 text-stone-600" />
          </div>
          <div>
            <div className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Total Items</div>
            <div className="text-lg font-bold text-stone-900">{items.length}</div>
          </div>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-stone-200 shadow-sm flex items-center gap-4 min-w-[160px] flex-1 md:flex-none">
          <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", itemsNeedingPrice > 0 ? "bg-amber-50" : "bg-emerald-50")}>
            <DollarSign className={cn("w-5 h-5", itemsNeedingPrice > 0 ? "text-amber-600" : "text-emerald-600")} />
          </div>
          <div>
            <div className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Action Needed</div>
            <div className={cn("text-lg font-bold", itemsNeedingPrice > 0 ? "text-amber-600" : "text-emerald-600")}>
              {itemsNeedingPrice}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-stone-50 p-4 rounded-2xl border border-stone-100/60">
        <div className="relative w-full md:max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
          <input 
            type="text" 
            placeholder="Search items by code or name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-stone-200 rounded-xl text-sm outline-none focus:border-stone-300 focus:ring-4 focus:ring-stone-100 transition-all font-medium"
          />
        </div>
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          <div className="flex items-center gap-2 bg-white px-3 py-1.5 border border-stone-200 rounded-lg shrink-0">
            <Filter className="w-3.5 h-3.5 text-stone-400" />
            <Select 
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as any)}
              className="text-xs font-bold text-stone-600 bg-transparent outline-none cursor-pointer uppercase tracking-wider border-none h-auto py-1 pl-0 pr-8"
            >
              <option value="ALL">All Items</option>
              <option value="NEEDS_PRICE">Needs Sourcing</option>
              <option value="HAS_PRICE">Sourced</option>
            </Select>
          </div>
          <Select 
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="text-xs font-bold text-stone-600 bg-white px-3 py-2 border border-stone-200 rounded-lg outline-none cursor-pointer uppercase tracking-wider h-auto shrink-0"
          >
            <option value="CODE">Sort: Code</option>
            <option value="NAME">Sort: Name</option>
          </Select>
          <button 
            onClick={fetchData} 
            className="p-2 border border-stone-200 rounded-lg bg-white text-stone-500 hover:text-stone-900 transition-colors shrink-0"
            title="Refresh Data"
          >
            <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin")} />
          </button>
        </div>
      </div>

      <div className="bg-white border border-stone-200 rounded-3xl shadow-sm overflow-hidden flex flex-col">
        {isLoading ? (
          <div className="py-24 text-center text-stone-400 font-medium">Loading pricing matrix...</div>
        ) : filteredItems.length === 0 ? (
          <div className="empty-state m-8 animate-in fade-in duration-300">
             <Package className="w-8 h-8 text-stone-300 mb-4" />
             <div className="text-[10px] text-stone-400 font-bold uppercase tracking-[0.2em]">No Items Found</div>
          </div>
        ) : (
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left border-collapse min-w-[800px]">
              <thead>
                <tr className="bg-stone-50 border-b border-stone-200 text-stone-500 text-[10px] font-bold uppercase tracking-widest">
                  <th className="px-6 py-4 rounded-tl-3xl">Item</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Best Ref. Price</th>
                  <th className="px-6 py-4">Active Quotes</th>
                  <th className="px-6 py-4 text-right rounded-tr-3xl">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100/60">
                {filteredItems.map(item => {
                  const itemQuotes = supplierPrices[item.id] || [];
                  const sortedQuotes = [...itemQuotes].sort((a,b) => a.unit_price - b.unit_price);
                  const bestQuote = sortedQuotes.length > 0 ? sortedQuotes[0] : null;

                  return (
                    <tr key={item.id} className="group hover:bg-stone-50/30 transition-colors">
                      <td className="px-6 py-5">
                        <div className="flex items-center gap-4">
                          <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border border-stone-200/50", bestQuote ? "bg-emerald-50" : "bg-stone-100")}>
                            {bestQuote ? <CheckCircle2 className="w-5 h-5 text-emerald-600" /> : <Package className="w-5 h-5 text-stone-400" />}
                          </div>
                          <div>
                            <div className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-0.5">{item.item_code}</div>
                            <div className="text-sm font-bold text-stone-900 group-hover:text-stone-700 transition-colors">{item.name}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-5 align-middle">
                        {bestQuote ? (
                           <span className="px-2.5 py-1 rounded-md text-[9px] font-bold bg-emerald-100 text-emerald-700 uppercase tracking-widest flex w-fit items-center gap-1.5">
                             <CheckCircle2 className="w-3 h-3" /> Sourced
                           </span>
                        ) : (
                           <span className="px-2.5 py-1 rounded-md text-[9px] font-bold bg-amber-100 text-amber-700 uppercase tracking-widest flex w-fit items-center gap-1.5">
                             <AlertTriangle className="w-3 h-3" /> Needs Attention
                           </span>
                        )}
                      </td>
                      <td className="px-6 py-5 align-middle">
                        {bestQuote ? (
                          <div>
                            <div className="text-sm font-bold text-stone-900">{formatIDR(bestQuote.unit_price)}</div>
                            <div className="text-[10px] text-stone-500 font-bold mt-1 max-w-[150px] truncate">{bestQuote.supplier_name}</div>
                          </div>
                        ) : (
                          <div className="text-sm font-bold text-stone-400 italic">No price set</div>
                        )}
                      </td>
                      <td className="px-6 py-5 align-middle">
                        <div className="text-sm font-bold text-stone-900">{itemQuotes.length} <span className="text-[10px] text-stone-400 uppercase tracking-widest">vendors</span></div>
                      </td>
                      <td className="px-6 py-5 align-middle text-right">
                        <div className="flex items-center justify-end gap-3">
                          <button 
                            onClick={() => viewHistory(item.id, item.name)}
                            className="p-2 text-stone-400 hover:text-stone-900 bg-white border border-stone-200 rounded-lg hover:shadow-sm transition-all"
                            title="Global Price History"
                          >
                            <History className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => openManageQuotes(item)}
                            className="px-4 py-2 bg-stone-800 text-white rounded-lg text-xs font-bold uppercase tracking-wider hover:bg-stone-900 transition-all flex items-center gap-2"
                          >
                            <DollarSign className="w-4 h-4" /> Quotes
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Manage Quotes Modal */}
      <Modal
        isOpen={manageQuotesModal.isOpen}
        onClose={closeManageQuotes}
        title={
          <div>
            <div className="text-xl font-bold text-stone-900 tracking-tight">Manage Vendor Quotes</div>
            <div className="text-sm text-stone-500 font-medium mt-1">
              <span className="font-bold">{manageQuotesModal.item?.item_code}</span> &bull; {manageQuotesModal.item?.name}
            </div>
          </div>
        }
        maxWidth="3xl"
        contentClassName="p-0 border-t border-stone-100"
      >
        <div className="flex flex-col md:flex-row h-full md:max-h-[70vh]">
          {/* Add Quote Form */}
          <div className="w-full md:w-2/5 p-6 bg-stone-50 border-r border-stone-100">
            <h4 className="text-[10px] font-bold text-stone-500 uppercase tracking-widest mb-6 flex items-center gap-2">
              <Plus className="w-3.5 h-3.5" /> Add New Quote
            </h4>
            <form onSubmit={handleAddOrUpdateQuote} className="space-y-5">
              <div>
                <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-2">Vendor / Supplier</label>
                <div className="relative">
                  <Select 
                    value={newQuoteSupplierId}
                    onChange={(e) => setNewQuoteSupplierId(e.target.value)}
                    required
                    className="w-full p-3 bg-white border border-stone-200 rounded-xl text-sm font-semibold outline-none focus:ring-2 focus:ring-stone-200 appearance-none"
                  >
                    <option value="">Select a vendor...</option>
                    {suppliers.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </Select>
                </div>
              </div>
              
              <div>
                <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-2">Unit Price (IDR)</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xs font-bold text-stone-500 uppercase">IDR</span>
                  <input 
                    type="text"
                    required
                    value={formatCurrency(newQuotePrice)}
                    onChange={(e) => setNewQuotePrice(e.target.value.replace(/[^\d]/g, ''))}
                    className="w-full pl-14 pr-4 py-3 bg-white border border-stone-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-stone-200 text-right"
                    placeholder="0"
                  />
                </div>
              </div>

              <button 
                type="submit"
                disabled={isSubmittingQuote || !newQuotePrice || !newQuoteSupplierId}
                className="w-full py-3.5 bg-stone-800 text-white rounded-xl text-xs font-bold uppercase tracking-widest disabled:opacity-50 hover:bg-stone-900 transition-all flex justify-center items-center gap-2"
              >
                {isSubmittingQuote && <RefreshCw className="w-4 h-4 animate-spin" />}
                Save Quote
              </button>
            </form>
          </div>

          {/* Active Quotes List */}
          <div className="w-full md:w-3/5 p-6 bg-white overflow-y-auto custom-scrollbar flex flex-col">
            <h4 className="text-[10px] font-bold text-stone-500 uppercase tracking-widest mb-6 flex items-center gap-2">
              <TrendingUp className="w-3.5 h-3.5" /> Active Quotes ({currentItemQuotes.length})
            </h4>

            {currentItemQuotes.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-stone-400 opacity-60 min-h-[200px]">
                <Package className="w-12 h-12 mb-4" />
                <p className="font-medium text-sm">No active quotes for this item.</p>
              </div>
            ) : (
              <div className="space-y-3 pr-2">
                {currentItemQuotes.map((quote, idx) => {
                  const isBest = idx === 0;
                  return (
                    <div 
                      key={quote.supplier_id} 
                      className={cn(
                        "group relative p-4 rounded-2xl border transition-all flex justify-between items-center",
                        isBest ? "border-emerald-200 bg-emerald-50/30" : "border-stone-100 bg-white hover:border-stone-300 hover:shadow-sm"
                      )}
                    >
                      <div>
                        {isBest && (
                          <div className="mb-2 w-fit px-2 py-0.5 rounded text-[8px] font-bold bg-emerald-100 text-emerald-700 uppercase tracking-widest flex items-center gap-1">
                            <CheckCircle2 className="w-2.5 h-2.5" /> Best Price
                          </div>
                        )}
                        <div className="text-[10px] font-bold text-stone-500 uppercase tracking-widest mb-1 leading-tight">{quote.supplier_name}</div>
                        <div className={cn("text-lg font-bold tracking-tight leading-none", isBest ? "text-emerald-950" : "text-stone-900")}>
                          {formatIDR(quote.unit_price)}
                        </div>
                        {quote.updated_at && (
                           <div className="text-[9px] text-stone-400 mt-2 font-bold">Updated: {new Date(quote.updated_at).toLocaleDateString([], { timeZone: 'Asia/Jakarta' })}</div>
                        )}
                      </div>
                      
                      <div className="flex flex-col items-end gap-2">
                         <button 
                           onClick={() => {
                             setNewQuoteSupplierId(quote.supplier_id);
                             setNewQuotePrice(String(quote.unit_price));
                           }}
                           className="p-2 text-stone-400 hover:text-stone-900 hover:bg-stone-100 rounded-lg transition-colors"
                           title="Edit Quote"
                         >
                           <Edit className="w-4 h-4" />
                         </button>
                         <button 
                           onClick={() => {
                             setConfirmModal({
                               isOpen: true,
                               title: "Remove Quote",
                               message: `Are you sure you want to remove the quote of ${formatIDR(quote.unit_price)} from ${quote.supplier_name}?`,
                               action: () => handleDeleteQuote(manageQuotesModal.item.id, quote.supplier_id)
                             });
                           }}
                           className="p-2 text-stone-300 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                           title="Remove Quote"
                         >
                           <Trash2 className="w-4 h-4" />
                         </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </Modal>

      <ConfirmModal
        isOpen={confirmModal.isOpen}
        onCancel={() => setConfirmModal(prev => ({...prev, isOpen: false}))}
        onConfirm={() => {
          confirmModal.action();
          setConfirmModal(prev => ({...prev, isOpen: false}));
        }}
        title={confirmModal.title}
        message={confirmModal.message}
        confirmText="Confirm"
        isDestructive={true}
      />

      {/* History Modal */}
      <Modal
        isOpen={historyModal.isOpen}
        onClose={() => {
          setHistoryModal({ isOpen: false, itemId: null, itemName: '', history: [] });
          setIsHistoryFullscreen(false);
        }}
        maxWidth={isHistoryFullscreen ? 'full' : '4xl'}
        className={isHistoryFullscreen ? 'max-h-[calc(100vh-2rem)] h-full' : ''}
        contentClassName="p-0 flex flex-col min-h-0"
        title={
          <div className="flex justify-between items-start w-full pr-4">
            <div>
              <h3 className="text-xl font-bold text-stone-900 tracking-tight">Market Price Fluctuation</h3>
              <p className="text-stone-500 font-medium text-sm mt-1 flex items-center gap-2">
                <Package className="w-4 h-4" /> {historyModal.itemName}
              </p>
            </div>
            <button 
              onClick={() => setIsHistoryFullscreen(!isHistoryFullscreen)} 
              className="mt-1 text-stone-500 hover:text-stone-900 bg-white shadow-sm p-2 rounded-xl transition-all hover:scale-105 active:scale-95 border border-stone-200"
              title={isHistoryFullscreen ? "Exit Fullscreen" : "Fullscreen History"}
            >
              {isHistoryFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
            </button>
          </div>
        }
      >
        <div className="p-8 overflow-y-auto bg-stone-50/30 flex-1 min-h-0 custom-scrollbar">
          {historyModal.history.length === 0 ? (
            <div className="text-center text-stone-400 py-20 font-medium flex flex-col items-center">
              <BarChart2 className="w-12 h-12 text-stone-400 mb-4" />
              No historical quotation data available for building trend lines.
            </div>
          ) : (
            <div className="space-y-8 flex flex-col h-full">
              <div className="h-[300px] shrink-0 w-full bg-white p-6 rounded-3xl border border-stone-100 shadow-sm relative overflow-x-auto custom-scrollbar">
                <div className="min-w-[700px] h-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={historyModal.history.slice().reverse()} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E7E5E4" />
                    <XAxis 
                      dataKey="created_at" 
                      tickFormatter={(val) => new Date(val).toLocaleDateString([], { timeZone: 'Asia/Jakarta',  month: 'short', day: 'numeric' })}
                      stroke="#A8A29E" 
                      fontSize={10} 
                      tickLine={false} 
                      axisLine={false} 
                      dy={10}
                    />
                    <YAxis 
                      stroke="#A8A29E" 
                      fontSize={10} 
                      tickLine={false} 
                      axisLine={false} 
                      tickFormatter={(val) => `Rp${(val/1000)}k`}
                      dx={-10}
                    />
                    <RechartsTooltip content={<CustomTooltip />} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: '10px', fontWeight: 'bold' }} />
                    <Line 
                      type="monotone" 
                      name="Best Active Price (IDR)"
                      dataKey="lowest_price" 
                      stroke="#16a34a" 
                      strokeWidth={3} 
                      dot={{ r: 4, fill: '#16a34a', strokeWidth: 2, stroke: '#FFFFFF' }} 
                      activeDot={{ r: 6, strokeWidth: 0 }} 
                    />
                  </LineChart>
                </ResponsiveContainer>
                </div>
              </div>
              
              <div className="flex-1 min-h-0 flex flex-col">
                <h4 className="text-[10px] font-bold text-stone-500 uppercase tracking-widest mb-4 px-2 shrink-0">Detailed Log</h4>
                <div className="overflow-x-auto custom-scrollbar flex-1">
                  <div className="space-y-3 min-w-[700px] px-1 pb-6">
                    {historyModal.history.map((record, idx) => {
                    const isLatest = idx === 0;
                    const actualPrice = record.actual_unit_price ?? record.unit_price;
                    const prevPrice = idx < historyModal.history.length - 1 ? (historyModal.history[idx+1].actual_unit_price ?? historyModal.history[idx+1].unit_price) : null;
                    const diff = prevPrice !== null ? actualPrice - prevPrice : 0;
                    
                    return (
                      <div key={idx} className={cn("bg-white border rounded-2xl p-5 flex items-center justify-between transition-all", isLatest ? "border-stone-400 shadow-md ring-1 ring-stone-900/5" : "border-stone-100 shadow-sm opacity-80")}>
                        <div className="flex gap-4 items-center">
                          <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center font-bold text-[10px]", 
                            prevPrice !== null && diff > 0 ? "bg-red-50 text-red-600" : 
                            prevPrice !== null && diff < 0 ? "bg-emerald-50 text-emerald-600" : "bg-stone-50 text-stone-400"
                          )}>
                            {prevPrice !== null && diff > 0 ? <TrendingUp className="w-5 h-5" /> : 
                             prevPrice !== null && diff < 0 ? <TrendingDown className="w-5 h-5" /> : 
                             <BarChart2 className="w-5 h-5" />}
                          </div>
                          <div>
                            <div className="text-[10px] font-bold text-stone-950 uppercase tracking-widest mb-1">{record.supplier_name}</div>
                            <div className="text-lg font-bold text-stone-900 leading-none">
                              {formatIDR(actualPrice)}
                            </div>
                            {prevPrice !== null && (
                              <div className={cn("text-[9px] font-bold mt-1.5", 
                                diff > 0 ? "text-red-500" : 
                                diff < 0 ? "text-emerald-500" : "text-stone-400"
                              )}>
                                {diff > 0 ? `▲ +${formatIDR(diff)}` : 
                                 diff < 0 ? `▼ -${formatIDR(Math.abs(diff))}` : 
                                 '■ No change'} from last recorded quote
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-stone-500 font-bold">{new Date(record.created_at).toLocaleDateString([], { timeZone: 'Asia/Jakarta',  year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                          <div className="text-[9px] text-stone-500 font-bold uppercase tracking-widest mt-1.5 bg-stone-50 inline-block px-2 py-0.5 rounded-sm">Auth: {record.recorded_by || 'System'}</div>
                        </div>
                      </div>
                    )
                  })}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
