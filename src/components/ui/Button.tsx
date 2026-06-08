import React, { memo } from 'react';
import { cn } from '@/lib/utils';
import { Loader2, ShieldCheck, FileEdit, XCircle, Trash2, Edit2, Plus, Eye, CheckCircle2, Download, AlertCircle } from 'lucide-react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger_soft' | 'success' | 'success_soft' | 'warning' | 'warning_soft' | 'info' | 'info_soft';
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'icon';
    action?: 'authorize' | 'revise' | 'cancel' | 'delete' | 'edit' | 'create' | 'view' | 'approve' | 'reject';
    isLoading?: boolean;
}

const actionMap: Record<string, { variant: any, icon: any, text: string }> = {
    authorize: { variant: 'success', icon: Download, text: 'Authorize' },
    approve: { variant: 'success', icon: ShieldCheck, text: 'Approve' },
    revise: { variant: 'danger', icon: FileEdit, text: 'Revise' },
    cancel: { variant: 'secondary', icon: null, text: 'Cancel' },
    delete: { variant: 'danger_soft', icon: Trash2, text: 'Delete' },
    edit: { variant: 'secondary', icon: Edit2, text: 'Edit' },
    create: { variant: 'primary', icon: Plus, text: 'Create' },
    view: { variant: 'secondary', icon: Eye, text: 'View Details' },
    reject: { variant: 'danger_soft', icon: XCircle, text: 'Reject' },
};

const variants: Record<string, string> = {
    primary: 'bg-stone-800 text-white hover:bg-stone-900 shadow-xl shadow-stone-900/10 hover:-translate-y-0.5 border border-transparent',
    secondary: 'bg-white border border-stone-200 text-stone-900 hover:bg-stone-50 shadow-sm',
    ghost: 'bg-transparent text-stone-400 hover:text-stone-900 hover:bg-stone-50 border border-transparent',
    danger: 'bg-rose-600 text-white hover:bg-rose-700 shadow-xl shadow-rose-900/10 hover:-translate-y-0.5 border border-transparent',
    danger_soft: 'bg-rose-50 text-rose-700 hover:bg-rose-100 border border-transparent',
    success: 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-xl shadow-emerald-900/10 hover:-translate-y-0.5 border border-transparent',
    success_soft: 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-transparent',
    warning: 'bg-orange-600 text-white hover:bg-orange-700 shadow-xl shadow-orange-900/10 hover:-translate-y-0.5 border border-transparent',
    warning_soft: 'bg-orange-50 text-orange-700 hover:bg-orange-100 border border-transparent',
    info: 'bg-blue-600 text-white hover:bg-blue-700 shadow-xl shadow-blue-900/10 hover:-translate-y-0.5 border border-transparent',
    info_soft: 'bg-blue-50 text-blue-700 hover:bg-blue-100 border border-transparent',
};

const sizes: Record<string, string> = {
    xs: 'px-3 py-1.5 rounded-lg text-[9px] tracking-wider',
    sm: 'px-4 py-2 rounded-xl text-[9px] tracking-widest',
    md: 'px-8 py-3 rounded-[1.25rem] text-[10px] tracking-[0.2em]',
    lg: 'px-10 py-4 rounded-[1.5rem] text-[12px] tracking-[0.2em]',
    icon: 'p-2 rounded-xl'
};

export const Button = memo(function Button({ 
    className, 
    variant, 
    size = 'md', 
    type = 'button', 
    action,
    isLoading, 
    children, 
    disabled, 
    ...props 
}: ButtonProps) {
    const activeMapping = action ? actionMap[action] : null;
    const finalVariant = variant || activeMapping?.variant || 'primary';
    const Icon = activeMapping?.icon;
    const defaultText = activeMapping?.text;

    return (
        <button 
            type={type} 
            disabled={disabled || isLoading}
            className={cn('transition-all font-bold uppercase active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2', variants[finalVariant], sizes[size], className)} 
            {...props}
        >
            {isLoading && <Loader2 className={cn("animate-spin shrink-0", size === 'xs' ? 'w-3 h-3' : 'w-4 h-4')} />}
            {!isLoading && Icon && <Icon className={cn("shrink-0", size === 'xs' ? 'w-3 h-3' : size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4')} />}
            {(children ?? defaultText)}
        </button>
    );
});
