import React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: React.ReactNode;
}

export const Input = React.memo(React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, icon, ...props }, ref) => {
    return (
      <div className="relative flex items-center">
        {icon && (
          <div className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400">
            {icon}
          </div>
        )}
        <input
          ref={ref}
          className={cn(
            "w-full py-3 bg-stone-50/50 border border-stone-200 rounded-xl text-sm outline-none focus:border-stone-400 focus:bg-white transition-all disabled:opacity-50 disabled:cursor-not-allowed",
            icon ? "pl-11 pr-4" : "px-4",
            className
          )}
          {...props}
        />
      </div>
    );
  }
));
Input.displayName = 'Input';
