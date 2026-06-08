import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, FileText, User, Package, Box, ShoppingCart, Truck, CreditCard, ChevronRight, CornerDownLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '@/utils/api';
import { cn } from '@/lib/utils';
import { useEscapeKey } from '@/lib/utils';

export function Omnisearch() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEscapeKey(() => setIsOpen(false));

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
    }
  }, [isOpen]);

  useEffect(() => {
    const searchData = async () => {
      if (!query || query.length < 2) {
        setResults([]);
        return;
      }
      try {
        const [projects, items, suppliers, customers, prs, pos] = await Promise.all([
          apiFetch('/api/projects'),
          apiFetch('/api/items'),
          apiFetch('/api/suppliers'),
          apiFetch('/api/customers'),
          apiFetch('/api/purchase-requests'),
          apiFetch('/api/purchase-orders')
        ]);
        
        let allResults: any[] = [];
        
        if (projects.data) {
          allResults.push(...projects.data.filter((p: any) => p.name.toLowerCase().includes(query.toLowerCase()) || (p.customer && p.customer.toLowerCase().includes(query.toLowerCase()))).map((p: any) => ({ ...p, _type: 'PROJECT', _icon: FileText, _path: `/projects/${p.id}` })));
        }
        if (items.data) {
          allResults.push(...items.data.filter((i: any) => i.name.toLowerCase().includes(query.toLowerCase()) || i.item_code.toLowerCase().includes(query.toLowerCase())).map((i: any) => ({ ...i, _type: 'ITEM', _icon: Package, _path: `/datacenter` })));
        }
        if (suppliers.data) {
          allResults.push(...suppliers.data.filter((s: any) => s.name.toLowerCase().includes(query.toLowerCase())).map((s: any) => ({ ...s, _type: 'SUPPLIER', _icon: Box, _path: `/datacenter` })));
        }
        if (customers.data) {
          allResults.push(...customers.data.filter((c: any) => c.name.toLowerCase().includes(query.toLowerCase())).map((c: any) => ({ ...c, _type: 'CUSTOMER', _icon: User, _path: `/customers` })));
        }
        if (prs.data) {
          allResults.push(...prs.data.filter((p: any) => p.pr_number.toLowerCase().includes(query.toLowerCase())).map((p: any) => ({ ...p, _type: 'PR', name: p.pr_number, _icon: ShoppingCart, _path: `/requests` })));
        }
        if (pos.data) {
          allResults.push(...pos.data.filter((p: any) => p.po_number.toLowerCase().includes(query.toLowerCase())).map((p: any) => ({ ...p, _type: 'PO', name: p.po_number, _icon: Truck, _path: `/procurement` })));
        }
        
        setResults(allResults.slice(0, 10)); // Limit to top 10 results
        setSelectedIndex(0);
      } catch (err) {
        console.error(err);
      }
    };
    
    const timeout = setTimeout(searchData, 300);
    return () => clearTimeout(timeout);
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev < results.length - 1 ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[selectedIndex]) {
        handleSelect(results[selectedIndex]);
      }
    }
  };

  const handleSelect = (item: any) => {
    setIsOpen(false);
    navigate(item._path);
  };

  return (
    <>
      {/* Search Trigger Button for Mobile / Mouse users */}
      <button 
        onClick={() => setIsOpen(true)}
        className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-stone-100 hover:bg-stone-200 border border-stone-200/60 rounded-lg text-[10px] uppercase font-bold tracking-widest text-stone-500 transition-colors mx-4"
      >
        <Search className="w-3.5 h-3.5" />
        <span>Search</span>
        <kbd className="font-sans bg-white px-1.5 py-0.5 rounded border border-stone-200 shadow-sm ml-2">⌘K</kbd>
      </button>

      <AnimatePresence>
        {isOpen && (
          <div className="fixed inset-0 z-[100] flex items-start justify-center pt-24 px-4 sm:px-0">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }} 
              className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm"
              onClick={() => setIsOpen(false)}
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: -10 }} 
              animate={{ opacity: 1, scale: 1, y: 0 }} 
              exit={{ opacity: 0, scale: 0.95, y: -10 }} 
              className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-stone-200 overflow-hidden"
            >
               <div className="flex items-center px-4 py-4 border-b border-stone-100">
                  <Search className="w-5 h-5 text-stone-400 mr-3" />
                  <input 
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Search projects, items, PRs, POs..."
                    className="w-full bg-transparent text-sm font-semibold text-stone-900 outline-none placeholder:text-stone-300"
                  />
                  <button onClick={() => setIsOpen(false)} className="text-[10px] font-bold text-stone-400 uppercase tracking-widest bg-stone-100 px-2 py-1 rounded">Esc</button>
               </div>
               
               <div className="max-h-[60vh] overflow-y-auto">
                 {results.length > 0 ? (
                   <div className="p-2 space-y-1">
                     {results.map((item, index) => {
                       const Icon = item._icon;
                       const isSelected = index === selectedIndex;
                       return (
                         <div 
                           key={index + item.id}
                           onClick={() => handleSelect(item)}
                           onMouseEnter={() => setSelectedIndex(index)}
                           className={cn(
                             "flex items-center justify-between p-3 rounded-xl cursor-pointer transition-colors",
                             isSelected ? "bg-stone-100" : "hover:bg-stone-50"
                           )}
                         >
                           <div className="flex items-center gap-3">
                             <div className={cn(
                               "w-8 h-8 rounded-lg flex items-center justify-center border",
                               isSelected ? "bg-white border-stone-200 shadow-sm text-emerald-600" : "bg-stone-50 border-stone-100 text-stone-500"
                             )}>
                               <Icon className="w-4 h-4" />
                             </div>
                             <div>
                               <div className="text-sm font-bold text-stone-900">{item.name}</div>
                               <div className="text-[10px] font-bold uppercase tracking-widest text-stone-400 mt-0.5">{item._type} {item.item_code || ''}</div>
                             </div>
                           </div>
                           <div className={cn(
                             "flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest transition-opacity",
                             isSelected ? "opacity-100 text-emerald-600" : "opacity-0 text-stone-400"
                           )}>
                              Jump to <CornerDownLeft className="w-3 h-3 ml-1" />
                           </div>
                         </div>
                       )
                     })}
                   </div>
                 ) : query.length > 1 ? (
                   <div className="px-4 py-12 text-center">
                     <p className="text-sm font-semibold text-stone-500">No results found for "{query}"</p>
                   </div>
                 ) : (
                    <div className="px-4 py-8 text-center bg-stone-50/50">
                       <p className="text-xs font-bold uppercase tracking-wider text-stone-400">Type to start searching</p>
                    </div>
                 )}
               </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
