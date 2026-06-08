import { safeFetchJson } from '@/utils/api';
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useInterval } from '@/hooks/useInterval';
import { useAuth } from '@/contexts/AuthContext';
import { LogOut, User, ChevronLeft, ChevronRight, MessageSquare, Bell, Package, CheckCircle2, AlertCircle, Info, Clock, ExternalLink, Trash2, Briefcase, ClipboardList, ShoppingCart, ChevronDown, Key, Eye, EyeOff, Copy } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useNotifications } from '@/contexts/NotificationContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/contexts/ToastContext';
import { Action, hasPermission, hasGodMode } from '@/utils/pbac';
import { getDailyAuthKey } from '@/utils/auth';
import { Omnisearch } from '@/components/erp/Omnisearch';

const NAV_GROUPS = [
  {
    group: 'Sales & Business',
    items: [
      { name: 'Customer Profiles', path: '/customers', action: Action.VIEW_CUSTOMERS },
      { name: 'Quotations', path: '/quotations', action: Action.VIEW_QUOTATIONS }
    ]
  },
  {
    group: 'Engineering',
    items: [
      { name: 'Design Requests', path: '/requests', action: Action.VIEW_DESIGN_REQUESTS },
      { name: 'Bill of Materials', path: '/engineering', action: Action.VIEW_BOM }
    ]
  },
  {
    group: 'Procurement',
    items: [
      { name: 'Supplier Profiles', path: '/vendors', action: Action.VIEW_VENDORS },
      { name: 'Sourcing & Pricing', path: '/pricing', action: Action.VIEW_PRICING },
      { name: 'Purchase Orders', path: '/procurement', action: Action.VIEW_PROCUREMENT }
    ]
  },
  {
    group: 'Manufacturing',
    items: [
      { name: 'Production Hub', path: '/production', action: Action.VIEW_PRODUCTION }
    ]
  },
  {
    group: 'Logistics & Inventory',
    items: [
      { name: 'Warehouse', path: '/warehouse', action: Action.VIEW_WAREHOUSE },
      { name: 'Delivery Manifests', path: '/deliveries', action: Action.VIEW_DELIVERIES }
    ]
  },
  {
    group: 'Finance',
    items: [
      { name: 'Commercial Invoices', path: '/invoices', action: Action.VIEW_INVOICES },
      { name: 'Account Payables', path: '/payables', action: Action.VIEW_FINANCE },
      { name: 'Payroll', path: '/payroll', action: Action.VIEW_FINANCE },
      { name: 'Financial Hub', path: '/finance', action: Action.VIEW_FINANCE }
    ]
  },
  {
    group: 'Human Resources',
    items: [
      { name: 'Staff Self Service', path: '/ess' }
    ]
  },
  {
    group: 'System & Master Data',
    items: [
      { name: 'Master Data Hub', path: '/data-center', action: Action.VIEW_MASTER_DATA },
      { name: 'Workflow & Automation', path: '/workflow', action: Action.MANAGE_ACCOUNTS },
      { name: 'Access Control', path: '/manage-accounts', action: Action.MANAGE_ACCOUNTS },
      { name: 'System Logs', path: '/logs', fcOnly: true }
    ]
  }
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [time, setTime] = useState('');
  const { user, logout } = useAuth();
  const { language, t } = useLanguage();
  const { showToast } = useToast();
  const { notifications, unreadCount: historyCount, addNotification, markAsRead, markAllAsRead, clearAll } = useNotifications();
  const [unreadCount, setUnreadCount] = useState(0);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showAuthKey, setShowAuthKey] = useState(false);
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const [chatNotification, setChatNotification] = useState<{id: string, sender: string, content: string, visible: boolean} | null>(null);
  const lastNotifiedRef = React.useRef<string | null>(null);
  const hideNotifTimeoutRef = React.useRef<any>(null);

  const desktopNavRef = useRef<HTMLElement>(null);
  const mobileNavRef = useRef<HTMLDivElement>(null);
  const isFirstMountRef = useRef(true);
  const [canScrollDesktopLeft, setCanScrollDesktopLeft] = useState(false);
  const [canScrollDesktopRight, setCanScrollDesktopRight] = useState(false);
  const [canScrollMobileLeft, setCanScrollMobileLeft] = useState(false);
  const [canScrollMobileRight, setCanScrollMobileRight] = useState(false);

  const buttonRefs = useRef<{ [key: string]: HTMLButtonElement | HTMLAnchorElement | null }>({});
  const [dropdownLeft, setDropdownLeft] = useState<number | null>(null);

  const updateDropdownPosition = useCallback(() => {
    if (activeDropdown && buttonRefs.current[activeDropdown] && desktopNavRef.current) {
      const btn = buttonRefs.current[activeDropdown];
      if (btn) {
        const rect = btn.getBoundingClientRect();
        const navContainer = desktopNavRef.current;
        const parentRect = navContainer.parentElement?.getBoundingClientRect();
        if (parentRect) {
          setDropdownLeft(rect.left - parentRect.left);
        }
      }
    } else {
      setDropdownLeft(null);
    }
  }, [activeDropdown]);

  useEffect(() => {
    updateDropdownPosition();
  }, [activeDropdown, updateDropdownPosition]);

  const checkScroll = () => {
    if (desktopNavRef.current) {
      setCanScrollDesktopLeft(desktopNavRef.current.scrollLeft > 0);
      setCanScrollDesktopRight(
        desktopNavRef.current.scrollLeft < desktopNavRef.current.scrollWidth - desktopNavRef.current.clientWidth - 1
      );
    }
    if (mobileNavRef.current) {
      setCanScrollMobileLeft(mobileNavRef.current.scrollLeft > 0);
      setCanScrollMobileRight(
        mobileNavRef.current.scrollLeft < mobileNavRef.current.scrollWidth - mobileNavRef.current.clientWidth - 1
      );
    }
    updateDropdownPosition();
  };

  useEffect(() => {
    checkScroll();
    window.addEventListener('resize', checkScroll);
    
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      window.removeEventListener('resize', checkScroll);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [user]);

  useEffect(() => {
    let animationFrameId: number | null = null;

    const scrollContainerToElement = (container: HTMLElement, activeEl: HTMLElement, isInstant: boolean) => {
      const containerWidth = container.clientWidth;
      const activeWidth = activeEl.clientWidth;
      const activeOffsetLeft = activeEl.offsetLeft;
      
      let targetLeft = activeOffsetLeft - (containerWidth / 2) + (activeWidth / 2);
      const maxScroll = container.scrollWidth - containerWidth;
      targetLeft = Math.max(0, Math.min(targetLeft, maxScroll));

      if (isInstant) {
        container.scrollLeft = targetLeft;
        checkScroll();
      } else {
        const startLeft = container.scrollLeft;
        const change = targetLeft - startLeft;
        
        // Skip animating if scroll position change is negligible
        if (Math.abs(change) <= 1) {
          return;
        }

        const startTime = performance.now();
        const duration = 380; // beautiful, ultra-smooth and premium duration for human eyes

        const easeInOutCubic = (t: number) => {
          return t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1;
        };

        const animate = (currentTime: number) => {
          const elapsed = currentTime - startTime;
          const progress = Math.min(elapsed / duration, 1);
          const ease = easeInOutCubic(progress);

          container.scrollLeft = startLeft + change * ease;
          checkScroll();

          if (progress < 1) {
            animationFrameId = requestAnimationFrame(animate);
          }
        };

        if (animationFrameId) {
          cancelAnimationFrame(animationFrameId);
        }
        animationFrameId = requestAnimationFrame(animate);
      }
    };

    const scrollToActive = (isInstant: boolean) => {
      // Desktop Nav alignment
      if (desktopNavRef.current) {
        const container = desktopNavRef.current;
        const activeEl = container.querySelector('.bg-stone-100') as HTMLElement;
        if (activeEl) {
          scrollContainerToElement(container, activeEl, isInstant);
        }
      }
      // Mobile Nav alignment
      if (mobileNavRef.current) {
        const container = mobileNavRef.current;
        const activeEl = container.querySelector('.bg-stone-100') as HTMLElement;
        if (activeEl) {
          scrollContainerToElement(container, activeEl, isInstant);
        }
      }
      checkScroll();
    };

    // Attempt immediately
    scrollToActive(isFirstMountRef.current);

    // Also run inside a micro-timeout to ensure dynamic widths are resolved perfectly
    const timer = setTimeout(() => {
      scrollToActive(isFirstMountRef.current);
      isFirstMountRef.current = false;
    }, 50);

    return () => {
      clearTimeout(timer);
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [location.pathname]);

  const sendHeartbeat = useCallback(() => {
    if (!user) return;
    const isMobile = window.innerWidth < 768;
    const isTablet = window.innerWidth >= 768 && window.innerWidth < 1024;
    const deviceType = isMobile ? 'Mobile' : (isTablet ? 'Tablet' : 'Desktop');
    
    fetch('/api/users/heartbeat', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'remote-user': user.username,
        'x-user-email': user.username
      },
      body: JSON.stringify({ 
        device_type: deviceType,
        username: user.username
      })
    }).catch(e => {
        // Silently ignore network disconnections or aborts
        if (e.message !== 'Failed to fetch' && e.name !== 'AbortError') {
             console.error("Heartbeat failed", e);
        }
    });
  }, [user]);

  useEffect(() => {
    sendHeartbeat();
  }, [sendHeartbeat]);

  useInterval(sendHeartbeat, user ? 20000 : null);

  const scrollNav = (ref: React.RefObject<HTMLElement>, amount: number) => {
    if (ref.current) {
      ref.current.scrollBy({ left: amount, behavior: 'smooth' });
    }
  };

  const playNotificationSound = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const playTone = (freq: number, type: OscillatorType, duration: number, vol: number, startTime: number) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, startTime);
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(vol, startTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(startTime);
        osc.stop(startTime + duration);
      };
      playTone(1174.66, 'sine', 0.4, 0.3, audioCtx.currentTime);
      playTone(1760.00, 'sine', 0.6, 0.3, audioCtx.currentTime + 0.15);
    } catch(e) {}
  };

  const fetchUnreadCount = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch('/api/chat/unread', {
        headers: { 
          'x-user-email': user.username,
          'remote-user': user.username
        }
      });
      if (res.ok) {
        const response = await safeFetchJson(res);
        const data = response.data;
        setUnreadCount(data?.unread_count || 0);

        if (data?.latest_message && data.latest_message.id !== lastNotifiedRef.current) {
           const msgId = data.latest_message.id;
           if (lastNotifiedRef.current !== null) {
             playNotificationSound();
             setChatNotification({
               id: msgId,
               sender: data.latest_message.sender_username,
               content: data.latest_message.content || 'Sent an attachment',
               visible: true
             });
             
             addNotification(
               'CHAT',
               `New Message: ${data.latest_message.sender_username}`,
               data.latest_message.content || 'Sent an attachment',
               '/forum'
             );

             if (hideNotifTimeoutRef.current) clearTimeout(hideNotifTimeoutRef.current);
             hideNotifTimeoutRef.current = setTimeout(() => {
               setChatNotification(prev => prev ? { ...prev, visible: false } : null);
             }, 5000);
           }
           lastNotifiedRef.current = msgId;
        }
      }
    } catch (e) {}
  }, [user, addNotification]);

  useEffect(() => {
    fetchUnreadCount();
  }, [fetchUnreadCount]);

  useInterval(fetchUnreadCount, user ? 5000 : null);

  const updateTime = useCallback(() => {
    const now = new Date();
    const options: Intl.DateTimeFormatOptions = { 
      timeZone: 'Asia/Jakarta',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false
    };
    const formatter = new Intl.DateTimeFormat('en-GB', options);
    const parts = formatter.formatToParts(now);
    const dateObj: any = {};
    parts.forEach(({ type, value }) => {
      dateObj[type] = value;
    });
    setTime(`${dateObj.year}-${dateObj.month}-${dateObj.day} ${dateObj.hour}:${dateObj.minute}:${dateObj.second} WIB`);
  }, []);

  useEffect(() => {
    updateTime();
  }, [updateTime]);

  useInterval(updateTime, 1000);

  const activeNavGroupsSource = NAV_GROUPS;

  // Group filter based on roles
  const filteredNavGroups = activeNavGroupsSource.map(group => ({
    group: group.group,
    translatedGroup: t(group.group),
    items: group.items.filter((item: any) => {
      if (hasGodMode(user)) return true;
      if (item.fcOnly) return user?.role === 'FC';
      if (item.action) return hasPermission(user, item.action);
      if (item.roles) return item.roles.includes(user?.role || '');
      return true;
    }).map((item: any) => ({ ...item, translatedName: t(item.name) }))
  })).filter(g => g.items.length > 0);

  return (
    <div className="h-screen bg-stone-50 text-stone-900 font-sans selection:bg-stone-200 selection:text-stone-900 flex flex-col overflow-hidden">
      <header className="shrink-0 border-b border-stone-200 bg-white/90 backdrop-blur-xl z-50 sticky top-0 relative shadow-sm">
        <div className="w-full px-6 md:px-10 h-[72px] grid grid-cols-[auto_1fr_auto] items-center relative z-10">
          {/* Column 1: Brand Logo */}
          <div className="flex items-center shrink-0">
            <Link to="/erp" className="flex items-center gap-3 shrink-0 group">
              <div className="w-9 h-9 rounded-xl bg-white border border-stone-100 flex items-center justify-center shadow-sm transition-all">
                <img src="/logo.png" alt="Paving Joss Logo" className="w-6 h-6 object-contain drop-shadow-sm group-hover:scale-105 transition-transform" referrerPolicy="no-referrer" crossOrigin="anonymous" />
              </div>
              <div className="flex items-center gap-1.5">
                <h1 className="text-[17px] font-bold tracking-tight text-stone-900 transition-colors">
                  Paving Joss
                </h1>
                <span className="px-1.5 py-0.5 rounded border border-stone-200/60 bg-stone-50 text-stone-500 text-[9px] uppercase tracking-widest font-bold">ERP</span>
              </div>
            </Link>
          </div>

          {/* Column 2: Sliding Dropdown Nav (In the center) */}
          <div 
            className="hidden xl:flex items-center justify-center flex-1 h-full overflow-visible relative px-6 mx-4 min-w-0"
            onMouseLeave={() => setActiveDropdown(null)}
          >
              <AnimatePresence>
                {canScrollDesktopLeft && (
                  <motion.button 
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    onClick={() => scrollNav(desktopNavRef, -185)}
                    className="absolute left-1 top-1/2 -translate-y-1/2 z-30 w-7 h-7 bg-white/95 border border-stone-150 rounded-lg flex items-center justify-center shadow-md text-stone-500 hover:text-stone-900 transition-colors cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </motion.button>
                )}
              </AnimatePresence>

              <nav 
                ref={desktopNavRef}
                onScroll={checkScroll}
                className="flex items-center justify-start gap-1 lg:gap-1.5 overflow-x-auto scrollbar-hide py-2 relative px-1 w-fit max-w-full"
              >
                {/* Prepend Dashboard Link */}
                <Link
                  to="/erp"
                  onMouseEnter={() => setActiveDropdown(null)}
                  className={cn(
                    "text-[10px] uppercase tracking-[0.1em] transition-all px-2.5 xl:px-3 py-2 rounded-xl font-bold whitespace-nowrap shrink-0",
                    location.pathname === '/erp'
                      ? "text-stone-900 bg-stone-100 border border-stone-200/40 shadow-sm" 
                      : "text-stone-500 hover:text-stone-900 hover:bg-stone-50/80"
                  )}
                >
                  Dashboard
                </Link>

                {/* Prepend Messages Link */}
                <Link
                  to="/forum"
                  onMouseEnter={() => setActiveDropdown(null)}
                  className={cn(
                    "text-[10px] uppercase tracking-[0.1em] transition-all px-2.5 xl:px-3 py-2 rounded-xl font-bold whitespace-nowrap shrink-0 flex items-center gap-1.5",
                    location.pathname === '/forum'
                      ? "text-stone-900 bg-stone-100 border border-stone-200/40 shadow-sm" 
                      : "text-stone-500 hover:text-stone-900 hover:bg-stone-50/80"
                  )}
                >
                  <MessageSquare className="w-3.5 h-3.5 text-stone-400 group-hover:text-stone-900" />
                  Messages
                  {unreadCount > 0 && (
                     <span className="flex items-center justify-center bg-stone-800 text-white text-[9px] font-bold h-4 min-w-[16px] px-1.5 rounded-md shadow-sm">
                       {unreadCount > 99 ? '99+' : unreadCount}
                     </span>
                  )}
                </Link>

                {/* Aesthetic Spacer Divider */}
                <div className="h-4 w-[1px] bg-stone-200/65 shrink-0 mx-1 xl:mx-1.5" />
                {filteredNavGroups.map((group) => {
                  const isActiveGroup = group.items.some(it => location.pathname === it.path);
                  
                  if (group.items.length === 1) {
                     const isMessages = group.group === 'Messages' || group.items.some(it => it.name === 'Collaboration Forum' || it.name === 'Messages');
                     return (
                       <Link
                         key={group.group}
                         to={group.items[0].path}
                         ref={el => { buttonRefs.current[group.group] = el; }}
                         onMouseEnter={() => setActiveDropdown(null)}
                         className={cn(
                           "text-[10px] uppercase tracking-[0.1em] transition-all px-2.5 xl:px-3 py-2 rounded-xl font-bold whitespace-nowrap shrink-0 flex items-center gap-1.5",
                           isActiveGroup 
                             ? "text-stone-900 bg-stone-100 border border-stone-200/40 shadow-sm" 
                             : "text-stone-500 hover:text-stone-900 hover:bg-stone-50/80"
                          )}
                       >
                         {group.translatedGroup}
                         {isMessages && unreadCount > 0 && (
                            <span className="flex items-center justify-center bg-stone-800 text-white text-[9px] font-bold h-4 min-w-[16px] px-1.5 rounded-md shadow-sm">
                              {unreadCount > 99 ? '99+' : unreadCount}
                            </span>
                         )}
                       </Link>
                     );
                  }

                  return (
                    <button 
                      key={group.group}
                      ref={el => { buttonRefs.current[group.group] = el; }}
                      onMouseEnter={() => setActiveDropdown(group.group)}
                      className={cn(
                         "text-[10px] uppercase tracking-[0.1em] transition-all px-2.5 xl:px-3 py-2 rounded-xl font-bold flex items-center gap-1.5 whitespace-nowrap outline-none cursor-pointer shrink-0",
                         isActiveGroup 
                           ? "text-stone-900 bg-stone-100 border border-stone-200/40 shadow-sm" 
                           : "text-stone-500 hover:text-stone-900 hover:bg-stone-50/80"
                       )}
                    >
                       {group.translatedGroup}
                       <ChevronDown className={cn("w-3.5 h-3.5 transition-transform duration-300", activeDropdown === group.group ? "-rotate-180 text-stone-850" : "text-stone-400")} />
                       {group.items.some(it => it.name === 'Collaboration Forum' || it.name === 'Messages') && unreadCount > 0 && (
                          <span className="flex items-center justify-center bg-stone-800 text-white text-[9px] font-bold h-4 min-w-[16px] px-1.5 rounded-md ml-1 shadow-sm">
                            {unreadCount > 99 ? '99+' : unreadCount}
                          </span>
                       )}
                    </button>
                  );
                })}
              </nav>

              <AnimatePresence>
                {canScrollDesktopRight && (
                  <motion.button 
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    onClick={() => scrollNav(desktopNavRef, 185)}
                    className="absolute right-1 top-1/2 -translate-y-1/2 z-30 w-7 h-7 bg-white/95 border border-stone-250 rounded-lg flex items-center justify-center shadow-md text-stone-500 hover:text-stone-900 transition-colors cursor-pointer"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </motion.button>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {activeDropdown && filteredNavGroups.find(g => g.group === activeDropdown) && (
                  <motion.div 
                    initial={{ opacity: 0, y: 8, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.95 }}
                    transition={{ duration: 0.15 }}
                    className="absolute top-full mt-1 z-[100] w-56 origin-top-left"
                    style={{ left: dropdownLeft !== null ? dropdownLeft : 'auto' }}
                  >
                    {/* Hover spacer to close gap */}
                    <div className="absolute -top-3 left-0 right-0 h-3 bg-transparent" />
                    <div className="bg-white rounded-xl shadow-lg border border-stone-200/50 py-1.5 flex flex-col relative">
                       {filteredNavGroups.find(g => g.group === activeDropdown)?.items.map(item => {
                         const isItemActive = location.pathname === item.path;
                         return (
                           <Link 
                             key={item.path} 
                             to={item.path}
                             onClick={() => setActiveDropdown(null)}
                             className={cn(
                               "px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider transition-all flex items-center justify-between",
                               isItemActive 
                                 ? "text-stone-900 bg-stone-50 font-bold border-l-2 border-stone-800 pl-3" 
                                 : "text-stone-500 hover:text-stone-900 hover:bg-stone-50/50"
                             )}
                           >
                              {item.translatedName}
                              {(item.name === 'Collaboration Forum' || item.name === 'Messages') && unreadCount > 0 && (
                                 <span className="flex items-center justify-center bg-stone-800 text-white text-[9px] font-bold h-4 min-w-[16px] px-1.5 rounded-md">
                                   {unreadCount > 99 ? '99+' : unreadCount}
                                 </span>
                              )}
                           </Link>
                         );
                       })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

          {/* Column 3: Stats, Timer & User Profile */}
          <div className="flex items-center gap-4 shrink-0 justify-end">
            <Omnisearch />
            
            <div className="flex items-center gap-2 text-[11px] text-stone-500 font-medium hidden lg:flex">
              <div className="flex items-center gap-1.5 bg-stone-50 px-3 py-1.5 rounded-full border border-stone-100 shadow-inner">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.5)]" />
                <span className="font-mono text-stone-600">{time.split(' ')[1]}</span>
              </div>
            </div>

            {user && (
              <div className="relative" ref={userMenuRef}>
                <button 
                  onClick={() => setShowUserMenu(!showUserMenu)}
                  className={cn(
                    "flex items-center gap-3 px-2 py-1.5 transition-all rounded-full group",
                    showUserMenu ? "bg-stone-100 ring-4 ring-stone-50" : "hover:bg-stone-50"
                  )}
                >
                  <div className="w-9 h-9 rounded-full bg-white border border-stone-200/60 flex items-center justify-center shadow-sm relative z-10 overflow-hidden">
                    <div className="absolute inset-0 bg-stone-800 opacity-0 group-hover:opacity-5 transition-opacity" />
                    <span className="text-[11px] font-bold text-stone-800 tracking-tight relative z-20">
                      {user.username.substring(0, 2).toUpperCase()}
                    </span>
                    {historyCount > 0 && (
                      <span className="absolute top-0 right-0 w-3 h-3 bg-red-500 border-2 border-white rounded-full" />
                    )}
                  </div>
                  <div className="hidden md:block pr-4">
                    <span className="text-[11px] font-bold text-stone-900 uppercase tracking-[0.1em]">{user.username}</span>
                  </div>
                </button>

                <AnimatePresence>
                  {showUserMenu && (
                    <motion.div
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
                      transition={{ duration: 0.2, ease: "easeOut" }}
                      className="absolute right-0 mt-3 w-80 bg-white rounded-3xl border border-stone-100 shadow-[0_20px_50px_rgba(0,0,0,0.12)] z-[100] overflow-hidden"
                    >
                      <div className="p-5 border-b border-stone-50 bg-stone-50/30">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-stone-400">{t('Activity & Notifications')}</h3>
                          <div className="flex items-center gap-3">
                            {historyCount > 0 && (
                              <button 
                                onClick={markAllAsRead}
                                className="text-[9px] font-bold text-stone-900 hover:text-stone-700 uppercase tracking-wider transition-colors"
                              >
                                {t('Mark all Read')}
                              </button>
                            )}
                            <button 
                              onClick={clearAll}
                              className="flex items-center gap-1.5 text-[9px] font-bold text-stone-400 hover:text-stone-900 uppercase tracking-widest transition-colors"
                            >
                              <Trash2 className="w-3 h-3" /> {t('Clear All')}
                            </button>
                          </div>
                        </div>
                        
                        <div className="max-h-[320px] overflow-y-auto space-y-3 pr-1 custom-scrollbar">
                          {notifications.length === 0 ? (
                            <div className="text-center py-10">
                              <Bell className="w-8 h-8 text-stone-200 mx-auto mb-3" />
                              <p className="text-[11px] font-bold text-stone-400 uppercase tracking-widest">{t('No activity history')}</p>
                            </div>
                          ) : (
                            notifications.map((notif) => (
                              <div 
                                key={notif.id}
                                onClick={() => markAsRead(notif.id)}
                                className={cn(
                                  "p-3 rounded-2xl border transition-all flex gap-3 group relative cursor-default",
                                  notif.isRead 
                                    ? "bg-transparent border-transparent grayscale-[0.5] opacity-60" 
                                    : "bg-white border-stone-100 shadow-sm ring-1 ring-stone-900/5"
                                )}
                              >
                                {!notif.isRead && (
                                  <div className="absolute top-3 right-3 w-1.5 h-1.5 bg-stone-800 rounded-full" />
                                )}
                                <div className={cn(
                                  "w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border",
                                  notif.type === 'SUCCESS' ? "bg-emerald-50 border-emerald-100 text-emerald-600" :
                                  notif.type === 'ERROR' ? "bg-red-50 border-red-100 text-red-600" :
                                  notif.type === 'CHAT' ? "bg-amber-50 border-amber-100 text-amber-600" :
                                  "bg-blue-50 border-blue-100 text-blue-600"
                                )}>
                                  {notif.type === 'SUCCESS' && <CheckCircle2 className="w-4 h-4" />}
                                  {notif.type === 'ERROR' && <AlertCircle className="w-4 h-4" />}
                                  {notif.type === 'CHAT' && <MessageSquare className="w-4 h-4" />}
                                  {notif.type === 'INFO' && <Info className="w-4 h-4" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-[11px] font-bold text-stone-900 mb-0.5">{notif.title}</p>
                                  <div className="text-[10px] text-stone-500 line-clamp-2 leading-relaxed mb-2" title={notif.message}>
                                    {(() => {
                                      let contentToParse = notif.message || "";
                                      const sharedMatch = contentToParse.match(/🔗 \*Shared Resource: (.*)\* \((PROJECT|PR|PO)\) #(.*)$/s);
                                      if (sharedMatch) {
                                        const [fullMatch, title, type, itemId] = sharedMatch;
                                        const textBefore = contentToParse.replace(fullMatch, '').trim();
                                        return (
                                          <div className="flex flex-col gap-0.5 mt-0.5">
                                            {textBefore && <span className="truncate">{textBefore}</span>}
                                            <span className="flex items-center gap-1 font-medium bg-stone-100 text-stone-700 px-1.5 py-0.5 rounded w-fit text-[9px] uppercase tracking-widest">
                                              {type === 'PROJECT' && <Briefcase className="w-2.5 h-2.5" />}
                                              {type === 'PR' && <ClipboardList className="w-2.5 h-2.5" />}
                                              {type === 'PO' && <ShoppingCart className="w-2.5 h-2.5" />}
                                              Attached {type}
                                            </span>
                                          </div>
                                        );
                                      }
                                      return contentToParse;
                                    })()}
                                  </div>
                                  <div className="flex items-center justify-between">
                                    <span className="text-[9px] text-stone-400 font-bold uppercase tracking-tight">
                                      {new Date(notif.timestamp).toLocaleTimeString('en-US', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                    {notif.link && (
                                      <Link to={notif.link} className="text-[9px] text-stone-900 font-bold uppercase tracking-widest hover:underline flex items-center gap-1">
                                        View <ExternalLink className="w-2.5 h-2.5" />
                                      </Link>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>

                      <div className="p-5 border-t border-stone-50 bg-stone-50/50">
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-stone-400">Security</h3>
                          <span className="text-[9px] font-bold uppercase tracking-wider text-stone-500 bg-stone-200/50 px-2 py-0.5 rounded">Daily Internal Auth</span>
                        </div>
                        <div className="bg-white border border-stone-200 rounded-2xl p-4 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-xl bg-stone-100 flex items-center justify-center text-stone-600">
                              <Key className="w-4 h-4" />
                            </div>
                            <div>
                              <div className="text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-1">Your Key</div>
                              <div className="font-mono font-bold tracking-[0.2em] text-stone-900 group">
                                {showAuthKey ? getDailyAuthKey(user.username) : '••••••'}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            {showAuthKey && (
                                <button
                                  onClick={() => {
                                    navigator.clipboard.writeText(getDailyAuthKey(user.username));
                                    showToast("Auth Key copied to clipboard", "success");
                                  }}
                                  className="w-8 h-8 rounded-xl bg-stone-50 hover:bg-stone-100 flex items-center justify-center transition-colors text-stone-500"
                                  title="Copy PIN"
                                >
                                  <Copy className="w-4 h-4" />
                                </button>
                            )}
                            <button
                              onClick={() => setShowAuthKey(!showAuthKey)}
                              className="w-8 h-8 rounded-xl bg-stone-50 hover:bg-stone-100 flex items-center justify-center transition-colors text-stone-500"
                            >
                              {showAuthKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="p-2 border-t border-stone-50">
                        <button 
                          onClick={logout}
                          className="w-full flex items-center justify-between px-4 py-3 hover:bg-red-50 text-stone-600 hover:text-red-600 transition-all rounded-2xl group"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-xl bg-stone-50 border border-stone-100 flex items-center justify-center group-hover:bg-red-100 group-hover:border-red-200 transition-colors">
                              <LogOut className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
                            </div>
                            <span className="text-[13px] font-bold tracking-tight">Sign Out</span>
                          </div>
                          <span className="text-[10px] uppercase font-bold tracking-[0.2em] opacity-30 group-hover:opacity-100 transition-opacity">Session Exit</span>
                        </button>
                      </div>


                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>
        </div>
      </header>

      <nav className="xl:hidden bg-white border-b border-stone-100 px-4 py-3 relative overflow-hidden group">
        <AnimatePresence>
          {canScrollMobileLeft && (
            <motion.button 
              initial={{ opacity: 0, x: -5 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -5 }}
              onClick={() => scrollNav(mobileNavRef, -150)}
              className="absolute left-1 top-1/2 -translate-y-1/2 z-20 w-8 h-8 bg-white/95 border border-stone-200 rounded-lg flex items-center justify-center shadow-lg text-stone-400"
            >
              <ChevronLeft className="w-4 h-4" />
            </motion.button>
          )}
        </AnimatePresence>

        <div 
          ref={mobileNavRef}
          onScroll={checkScroll}
          className="flex items-center gap-2 overflow-x-auto scrollbar-hide px-2 pb-1"
        >
          {/* Dashboard Standalone Link for mobile */}
          <Link
            to="/erp"
            className={cn(
              "text-[10px] uppercase tracking-[0.15em] transition-all px-4 py-2.5 rounded-xl font-bold whitespace-nowrap outline-none",
              location.pathname === '/erp'
                ? "text-stone-950 bg-stone-100 ring-1 ring-stone-200" 
                : "text-stone-500 hover:text-stone-900"
            )}
          >
            Dashboard
          </Link>

          {/* Messages Standalone Link for mobile */}
          <Link
            to="/forum"
            className={cn(
              "text-[10px] uppercase tracking-[0.15em] transition-all px-4 py-2.5 rounded-xl font-bold whitespace-nowrap outline-none flex items-center gap-1.5",
              location.pathname === '/forum'
                ? "text-stone-950 bg-stone-100 ring-1 ring-stone-200" 
                : "text-stone-500 hover:text-stone-900"
            )}
          >
            Messages
            {unreadCount > 0 && (
              <span className="flex items-center justify-center bg-stone-800 text-white text-[9px] font-bold h-4 min-w-[16px] px-1.5 rounded-md shadow-sm">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </Link>

          {filteredNavGroups.map((group) => {
             const isActiveGroup = group.items.some(it => location.pathname === it.path);

             return (
                <div key={group.group} className="relative">
                  <button 
                    onClick={() => setActiveDropdown(activeDropdown === group.group ? null : group.group)}
                    className={cn(
                       "text-[10px] uppercase tracking-[0.15em] transition-all px-4 py-2.5 rounded-xl font-bold whitespace-nowrap outline-none flex items-center gap-1.5 focus:bg-stone-50",
                       isActiveGroup 
                         ? "text-stone-900 bg-stone-100 ring-1 ring-stone-200" 
                         : "text-stone-500 hover:text-stone-800"
                     )}>
                     {group.translatedGroup}
                     <ChevronDown className={cn("w-3 h-3 transition-transform duration-200", activeDropdown === group.group ? "-rotate-180 text-stone-800" : "text-stone-400")} />
                  </button>
                </div>
             );
          })}
        </div>

        <AnimatePresence>
          {canScrollMobileRight && (
            <motion.button 
              initial={{ opacity: 0, x: 5 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 5 }}
              onClick={() => scrollNav(mobileNavRef, 150)}
              className="absolute right-1 top-1/2 -translate-y-1/2 z-20 w-8 h-8 bg-white/95 border border-stone-200 rounded-lg flex items-center justify-center shadow-lg text-stone-400"
            >
              <ChevronRight className="w-4 h-4" />
            </motion.button>
          )}
        </AnimatePresence>
      </nav>

      <AnimatePresence>
        {activeDropdown && filteredNavGroups.find(g => g.group === activeDropdown) && (
          <>
            <motion.div 
               initial={{ opacity: 0 }}
               animate={{ opacity: 1 }}
               exit={{ opacity: 0 }}
               className="fixed inset-0 bg-stone-900/10 backdrop-blur-[2px] z-[80] xl:hidden"
               onClick={() => setActiveDropdown(null)}
            />
            <motion.div 
               initial={{ opacity: 0, scale: 0.95, y: -10 }}
               animate={{ opacity: 1, scale: 1, y: 0 }}
               exit={{ opacity: 0, scale: 0.95, y: -10 }}
               className="fixed top-[130px] left-4 right-4 bg-white border border-stone-200 rounded-2xl shadow-xl z-[90] overflow-hidden xl:hidden pb-2 pt-2"
            >
               <div className="text-[10px] font-bold uppercase tracking-widest text-stone-400 py-3 px-6 border-b border-stone-100 mb-2">
                 {activeDropdown}
               </div>
               {filteredNavGroups.find(g => g.group === activeDropdown)?.items.map((item) => (
                 <Link 
                   key={item.path} 
                   to={item.path} 
                   onClick={() => setActiveDropdown(null)}
                   className="block w-full py-4 px-6 text-[11px] font-bold text-stone-700 hover:bg-stone-50 hover:text-stone-900 active:bg-stone-100 transition-colors uppercase tracking-widest flex items-center justify-between"
                 >
                    {item.translatedName}
                    {(item.name === 'Collaboration Forum' || item.name === 'Messages') && unreadCount > 0 && (
                       <span className="flex items-center justify-center bg-stone-800 text-white text-[9px] font-bold h-4 min-w-[16px] px-1.5 rounded-md shadow-sm">
                         {unreadCount > 99 ? '99+' : unreadCount}
                       </span>
                    )}
                 </Link>
               ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <main className="flex-1 overflow-y-auto w-full" onClick={() => setActiveDropdown(null)}>
        <div className="max-w-7xl mx-auto w-full px-4 md:px-8 py-4 md:py-10">
          {children}
        </div>
      </main>

      <footer className="shrink-0 border-t border-stone-100 bg-white py-4">
        <div className="w-full px-6 md:px-10 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-4">
            <span className="text-xs text-stone-400 font-medium tracking-wide">
              Paving Joss / ERP
            </span>
            <div className="h-3 w-[1px] bg-stone-200" />
            <span className="text-xs text-stone-400">
              Engineered by Eghy Al Vandi
            </span>
          </div>
          <div className="flex items-center gap-6">
            <span className="text-[10px] text-stone-400 uppercase tracking-widest font-semibold flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Systems Operational</span>
            <span className="text-[10px] text-stone-300 font-mono tracking-tighter">
              {time}
            </span>
          </div>
        </div>
      </footer>

      {chatNotification && chatNotification.visible && (
        <div 
          className="fixed bottom-6 right-6 z-[100] w-80 bg-white border border-stone-200 rounded-2xl shadow-2xl p-4 animate-in slide-in-from-bottom-5 fade-in duration-300 flex items-start gap-4 hover:shadow-xl transition-shadow cursor-pointer" 
          onClick={() => setChatNotification(prev => prev ? { ...prev, visible: false } : null)}
        >
           <div className="w-10 h-10 rounded-full bg-stone-100 flex items-center justify-center shrink-0 border border-stone-200">
              <span className="text-stone-500 font-semibold text-sm">
                {chatNotification.sender.substring(0, 2).toUpperCase()}
              </span>
           </div>
           <div className="flex-1 min-w-0 pt-0.5">
             <div className="flex items-center justify-between mb-1">
               <h4 className="font-semibold text-stone-900 text-sm truncate">{chatNotification.sender}</h4>
               <span className="text-[9px] text-emerald-500 font-bold uppercase tracking-widest">New</span>
             </div>
             <p className="text-xs text-stone-500 truncate mt-0.5" title={chatNotification.content}>
               {(() => {
                 let contentToParse = chatNotification.content || "";
                 const sharedMatch = contentToParse.match(/🔗 \*Shared Resource: (.*)\* \((PROJECT|PR|PO)\) #(.*)$/s);
                 if (sharedMatch) {
                   const [fullMatch, title, type, itemId] = sharedMatch;
                   const textBefore = contentToParse.replace(fullMatch, '').trim();
                   return (
                     <span className="flex items-center gap-1.5 font-medium">
                       {textBefore && <span className="truncate max-w-[100px]">{textBefore}</span>}
                       <span className="shrink-0 flex items-center gap-1 bg-stone-100 text-stone-700 px-1.5 py-0.5 rounded text-[10px]">
                         {type === 'PROJECT' && <Briefcase className="w-3 h-3" />}
                         {type === 'PR' && <ClipboardList className="w-3 h-3" />}
                         {type === 'PO' && <ShoppingCart className="w-3 h-3" />}
                         Shared {type}
                       </span>
                     </span>
                   );
                 }
                 return contentToParse.replace(/\n/g, ' ');
               })()}
             </p>
           </div>
        </div>
      )}
    </div>
  );
}

