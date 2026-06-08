import React, { forwardRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';

export interface PrintTemplateProps {
  documentTitleId: string;
  documentTitleEn: string;
  documentNameId: string;
  documentNameEn: string;
  date: string;
  referenceNumber: string;
  documentId: string;
  isDraft?: boolean;
  hideDefaultFooter?: boolean;
  children: React.ReactNode;
}

export const PrintTemplate = forwardRef<HTMLDivElement, PrintTemplateProps>(
  ({ 
    documentTitleId, 
    documentTitleEn, 
    documentNameId, 
    documentNameEn, 
    date, 
    referenceNumber, 
    documentId, 
    isDraft = false, 
    hideDefaultFooter = false,
    children 
  }, ref) => {
    return (
        <div 
          ref={ref}
          className="print-area bg-white relative p-[15mm] mx-auto w-[794px] h-[1123px] overflow-hidden flex flex-col shadow-2xl shrink-0"
        >
        {isDraft && (
          <div className="absolute inset-0 flex items-center justify-center opacity-[0.03] pointer-events-none rotate-[-45deg] select-none text-[150px] font-black uppercase tracking-tighter text-stone-900 z-0">
            DRAFT
          </div>
        )}
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;700&display=swap');
          .print-area {
            font-family: 'Plus Jakarta Sans', sans-serif !important;
            color: #000000 !important;
            background-color: #ffffff !important;
            box-sizing: border-box !important;
            /* Normalize all text sizes to be smaller and denser to perfectly fit 1 page */
          }
          .print-area * {
            font-family: 'Plus Jakarta Sans', sans-serif;
            color: #000000; 
          }
          /* Enforce EN translation color (Gray/Abu-abu) strictly */
          .print-area .text-stone-400,
          .print-area .text-stone-500,
          .print-area .text-stone-600,
          .print-area .en-text { 
            color: #6b7280 !important; 
            font-weight: 500 !important;
          }
          .print-area .text-stone-900,
          .print-area .text-stone-800,
          .print-area .id-text {
            color: #000000 !important;
          }

          /* Force compact scaling for standard Tailwind text classes inside this tree */
          .print-area .text-xs { font-size: 9px !important; line-height: 12px !important; }
          .print-area .text-sm { font-size: 10px !important; line-height: 14px !important; }
          .print-area .text-base { font-size: 11px !important; line-height: 16px !important; }
          .print-area .text-lg { font-size: 12px !important; line-height: 16px !important; }
          .print-area .text-xl { font-size: 14px !important; line-height: 20px !important; }
          .print-area .text-2xl { font-size: 16px !important; line-height: 22px !important; }
          .print-area .text-3xl { font-size: 20px !important; line-height: 24px !important; }
          .print-area .text-4xl { font-size: 24px !important; line-height: 28px !important; }
          
          .print-area .font-mono { font-family: 'JetBrains Mono', monospace !important; }
          
          /* Colors for specifics */
          .print-area .text-emerald-600, .print-area .text-emerald-700 { color: #000000 !important; } /* Force to black to maintain clean B/W formal document look, except where strictly needed */
          .print-area .text-rose-600 { color: #000000 !important; }

          .print-area .border-stone-100, .print-area .border-stone-150, .print-area .border-stone-200, .print-area .border-stone-300 {
            border-color: #d1d5db !important;
          }

          /* Tighter margins for compact fit */
          .print-area .mb-12 { margin-bottom: 24px !important; }
          .print-area .mb-10 { margin-bottom: 20px !important; }
          .print-area .mb-8 { margin-bottom: 16px !important; }
          .print-area .mb-6 { margin-bottom: 12px !important; }
          .print-area .mb-4 { margin-bottom: 8px !important; }
          .print-area .py-4 { padding-top: 8px !important; padding-bottom: 8px !important; }
          .print-area .py-3 { padding-top: 6px !important; padding-bottom: 6px !important; }
          .print-area .px-4 { padding-left: 8px !important; padding-right: 8px !important; }
          .print-area .px-3 { padding-left: 6px !important; padding-right: 6px !important; }
          .print-area .p-4 { padding: 8px !important; }

          .print-area tr, .print-area table {
            page-break-inside: avoid;
            break-inside: avoid;
          }
        `}</style>

        {/* --- HEADER --- */}
        <div className="w-full border-b-[3px] border-black pb-4 mb-6 bg-white relative z-10 flex items-center gap-5 shrink-0">
          {/* Minimal Logo (Black & White standard or simple format) */}
          <div className="w-16 h-16 shrink-0 flex items-center justify-center">
            <img 
              src="/logo.png" 
              alt="Logo" 
              className="w-full h-full object-contain" 
              referrerPolicy="no-referrer" 
              crossOrigin="anonymous" 
            />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-black text-black tracking-tight uppercase leading-none mb-1.5">CV. BATU EMAS GROUP</h1>
            <div className="text-xs font-semibold en-text leading-tight max-w-xl">
              Dusun Petahunan, Jajag, Gambiran, Banyuwangi Regency, East Java 68486<br/>
              Phone: 0811-1111-3993 &nbsp;|&nbsp; Email: pavingjoss@gmail.com
            </div>
          </div>
          {/* Top Right: QR Code for Data Center Camera Integration */}
          <div className="flex items-center gap-4 text-right">
             <div className="flex flex-col items-end">
               <div className="text-[9px] font-bold en-text tracking-widest uppercase mb-0.5">Valid Doc ID:</div>
               <div className="text-[10px] font-mono font-bold text-black border border-gray-300 px-2 py-1 bg-gray-50">{documentId || referenceNumber}</div>
             </div>
             <div className="w-16 h-16 bg-white border border-gray-300 p-1 flex items-center justify-center shrink-0">
                <QRCodeSVG 
                  value={`https://fhtbs-erp.shared/doc/${documentId || referenceNumber}`} 
                  size={54} 
                  level="M" 
                  fgColor="#000000" 
                />
             </div>
          </div>
        </div>

        {/* --- DOC TITLE & META --- */}
        <div className="flex justify-between items-end mb-6 w-full shrink-0 border-b border-gray-200 pb-4">
            <div className="flex-1 pr-6">
               <h2 className="text-xl font-black text-black uppercase tracking-widest leading-none mb-1.5">{documentTitleId}</h2>
               <p className="text-xs font-bold en-text uppercase tracking-widest leading-none">{documentTitleEn}</p>
            </div>
            
            <div className="flex gap-8 shrink-0 text-right">
              <div>
                <div className="text-[9px] font-bold en-text uppercase tracking-widest mb-0.5">TANGGAL / DATE</div>
                <div className="text-sm font-black text-black">{date}</div>
              </div>
              <div>
                <div className="text-[9px] font-bold en-text uppercase tracking-widest mb-0.5">REFERENSI / REF.</div>
                <div className="text-sm font-black text-black font-mono tracking-tight">{referenceNumber}</div>
              </div>
            </div>
        </div>

        {/* --- DYNAMIC BODY CONTENT --- */}
        {/* Uses flex-1 and min-h-0 so it expands to fill space, but doesn't blow out parents. */}
        <div className="flex-1 min-h-0 w-full z-10 relative flex flex-col text-sm overflow-hidden pb-4">
          {children}
        </div>

        {/* --- FOOTER --- */}
        {!hideDefaultFooter && (
          <div className="mt-auto pt-3 border-t-2 border-black z-20 bg-white shrink-0">
            <div className="flex justify-between items-end">
              <div className="max-w-[70%]">
                <div className="text-[10px] text-black font-bold uppercase tracking-wide leading-tight mb-1">
                  Dokumen ini diterbitkan dan divalidasi secara komputasi. Sah tanpa tanda tangan fisik.
                </div>
                <div className="text-[9px] en-text uppercase tracking-wide leading-tight">
                  This document is computationally validated. Valid without physical signature under registry ref: {referenceNumber}.
                </div>
              </div>

              <div className="text-right max-w-[30%]">
                <span className="text-[10px] text-black block font-bold uppercase tracking-wide">
                  {documentNameId}
                </span>
                <span className="text-[9px] en-text block uppercase tracking-wide">
                  {documentNameEn}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
);

PrintTemplate.displayName = 'PrintTemplate';
