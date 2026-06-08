import React, { memo } from 'react';
import { cn } from '@/lib/utils';

export interface PageHeaderProps {
  title: string;
  subtitle: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export const PageHeader = memo(function PageHeader({ title, subtitle, icon, actions, className }: PageHeaderProps) {
  return (
    <header className={cn("flex flex-col lg:flex-row lg:items-center justify-between pb-8 mb-10 gap-6 lg:gap-8 relative border-b border-stone-200 w-full animate-in fade-in slide-in-from-top-1 duration-500", className)}>
      <div className="flex items-center gap-5 md:gap-6 flex-1 min-w-0">
        <div className="shrink-0 flex items-center justify-center">
          {icon ? (
            <div className="w-12 h-12 md:w-14 md:h-14 rounded-2xl bg-stone-800 border border-stone-800 flex items-center justify-center text-white shadow-xl hover:scale-[1.02] transition-transform duration-300">
              <div className="w-5 h-5 md:w-6 md:h-6 flex items-center justify-center">
                {icon}
              </div>
            </div>
          ) : (
            <div className="w-12 h-12 md:w-14 md:h-14 rounded-2xl bg-stone-50 border border-stone-200" />
          )}
        </div>
        
        <div className="flex flex-col justify-center min-w-0">
          <h2 className="text-xl md:text-xl font-bold tracking-tight text-stone-900 leading-none mb-2 uppercase truncate">
            {title}
          </h2>
          <div className="flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-stone-300 shrink-0" />
            <p className="text-[10px] md:text-[11px] font-bold text-stone-500 uppercase tracking-[0.2em] md:tracking-[0.3em] leading-none truncate">
              {subtitle}
            </p>
          </div>
        </div>
      </div>
      
      {actions && (
        <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto shrink-0 justify-start lg:justify-end">
          {actions}
        </div>
      )}
    </header>
  );
});
