import React, { useRef, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/contexts/ToastContext';
import { generatePDF } from '@/lib/pdfGenerator';
import { Download } from 'lucide-react';
import { formatIDR, formatIDRWithDecimals } from '@/lib/utils';
import { PrintTemplate } from '@/components/erp/PrintTemplate';

interface QuotationPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  quotation: any;
}

// Precise business helper to calculate offset with Saturday & Sunday skipping
export const calculateWorkingDaysLimit = (startDateStr: string, workingDays: number): string => {
  const date = startDateStr ? new Date(startDateStr) : new Date();
  let daysToAdd = workingDays;
  while (daysToAdd > 0) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) { // Sunday=0, Saturday=6
      daysToAdd--;
    }
  }
  return date.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
};

export const QuotationPreviewModal: React.FC<QuotationPreviewModalProps> = ({
  isOpen,
  onClose,
  quotation,
}) => {
  const { language } = useLanguage();
  const { showToast } = useToast();
  const printDocRef = useRef<HTMLDivElement>(null);
  const [isExporting, setIsExporting] = useState(false);

  if (!quotation) return null;

  // Simple localized translations
  const dict: Record<string, Record<string, string>> = {
    en: {
      quotation: "OFFICIAL QUOTATION",
      validity: "Validity period",
      preparedFor: "PREPARED FOR",
      date: "Date Issued",
      refNo: "Quotation Reference",
      subject: "PROJECT TITLE",
      grandTotal: "Grand Total (IDR)",
      officialHeader: "Official Document - Validated online",
      officialFooter: "This document is an official price quotation. Confidential information for recipient.",
      terms: "Terms & Additional Remarks",
      businessDays: "working days",
      termsTitle: "GENERAL TERMS & CONDITIONS",
      validityDays: "Validity",
      status: "Status"
    },
    id: {
      quotation: "SURAT PENAWARAN RESMI",
      validity: "Masa berlaku",
      preparedFor: "DITUJUKAN KEPADA",
      date: "Tanggal Terbit",
      refNo: "Referensi Penawaran",
      subject: "DESKRIPSI PEKERJAAN",
      grandTotal: "Total Nominal (IDR)",
      officialHeader: "Dokumen Resmi - Tervalidasi sistem online",
      officialFooter: "Dokumen ini adalah penawaran harga resmi. Informasi rahasia untuk penerima.",
      terms: "Ketentuan & Syarat Tambahan",
      businessDays: "hari kerja",
      termsTitle: "SYARAT & KETENTUAN UMUM",
      validityDays: "Validitas",
      status: "Status"
    }
  };

  const tLocal = (key: string) => {
    return dict[language]?.[key] || dict['en'][key];
  };

  const handleExportPdf = async () => {
    if (!printDocRef.current) return;
    setIsExporting(true);
    try {
      await generatePDF(printDocRef.current, `Quotation_${quotation.quotation_number}.pdf`);
      showToast("Quotation PDF generated successfully", "success");
    } catch (err) {
      console.error(err);
      showToast("PDF generation failed", "error");
    } finally {
      setIsExporting(false);
    }
  };

  const rawSubtotal = quotation.items?.reduce((sum: number, item: any) => sum + (item.qty * item.unit_price), 0) || 0;
  const discountRateMultiplier = 1 - ((quotation.discount_rate || 0) / 100);
  const taxRateMultiplier = 1 + ((quotation.tax_rate ?? 12) / 100);
  
  // Fallback to calculation if no items
  const baseSubtotal = rawSubtotal > 0 
    ? rawSubtotal 
    : (quotation.amount / (discountRateMultiplier * taxRateMultiplier));
    
  const discountDisp = baseSubtotal * (quotation.discount_rate || 0) / 100;
  const subtotalDisp = baseSubtotal - discountDisp;
  const taxDisp = subtotalDisp * (quotation.tax_rate ?? 12) / 100;
  const sumDisp = subtotalDisp + taxDisp;
  const roundedTotal = Math.floor(sumDisp);
  const roundingFactor = roundedTotal - sumDisp;
  const formattedAmount = formatIDRWithDecimals(roundedTotal, 2);
  const issueDateStr = quotation.created_at ? new Date(quotation.created_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' }) : new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
  const validityLimit = calculateWorkingDaysLimit(quotation.created_at || new Date().toISOString(), quotation.validity_days || 20);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="5xl"
      title="Quotation Document"
      contentClassName="p-0 flex flex-col h-[85vh] bg-stone-100 border-t border-stone-100"
    >
      <div className="flex-1 overflow-auto p-8 bg-stone-50 flex justify-center items-start custom-scrollbar">
        <PrintTemplate
          ref={printDocRef}
          documentTitleId="SURAT PENAWARAN RESMI"
          documentTitleEn="OFFICIAL QUOTATION"
          documentNameId="penawaran harga resmi"
          documentNameEn="official price quotation"
          date={issueDateStr}
          referenceNumber={quotation.quotation_number}
          documentId={quotation.id}
          isDraft={quotation.status !== 'APPROVED' && quotation.status !== 'PROCESSED'}
        >
          <div className="grid grid-cols-2 gap-6 mb-10">
            <div>
              <div className="text-sm text-stone-900 uppercase tracking-widest font-black mb-3">Ditujukan Kepada <span className="text-stone-500 font-normal">/ Prepared For</span></div>
              <div className="text-xl font-black text-stone-900 uppercase">{quotation.customer_name}</div>
              <div className="text-sm text-stone-600 mt-3 font-bold">Corporate Entity - Project Intake Unit</div>
            </div>
            <div className="text-right">
              <div className="text-sm text-stone-900 uppercase tracking-widest font-black mb-3">Masa Berlaku <span className="text-stone-500 font-normal">/ Validity</span></div>
              <div className="text-lg font-black text-stone-900">{validityLimit}</div>
              <div className="text-sm text-stone-950 mt-2 uppercase tracking-widest font-black">({quotation.validity_days} Hari Kerja <span className="text-stone-500 font-normal">/ Business Days</span>)</div>
            </div>
          </div>

          {/* Subject Area */}
          <div className="mb-6 p-4 bg-white rounded-lg border border-stone-200">
            <div className="text-sm text-stone-900 uppercase tracking-widest font-black mb-2">Deskripsi Pekerjaan <span className="text-stone-500 font-normal">/ Project Title</span></div>
            <div className="text-base font-black text-stone-900 tracking-tight leading-tight uppercase">
              {quotation.title}
            </div>
          </div>

          {/* Items Table */}
          <div className="flex-1">
            <div className="text-xl text-stone-900 uppercase tracking-widest font-black mb-4 ml-1">Cakupan Pengiriman Proyek <span className="text-sm text-stone-500 font-normal">/ Scope of Project Delivery</span></div>
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-stone-300 bg-white">
                  <th className="py-3 px-3 font-extrabold text-stone-900 uppercase tracking-wider text-sm">
                    Deskripsi
                    <div className="text-[10px] font-bold text-stone-500 tracking-widest mt-1">DESCRIPTION</div>
                  </th>
                  <th className="py-3 px-3 font-extrabold text-stone-900 text-center uppercase tracking-wider text-sm w-16">
                    Jml
                    <div className="text-[10px] font-bold text-stone-500 tracking-widest mt-1">QTY</div>
                  </th>
                  <th className="py-3 px-3 font-extrabold text-stone-900 text-center uppercase tracking-wider text-sm w-20">
                    Sat
                    <div className="text-[10px] font-bold text-stone-500 tracking-widest mt-1">UOM</div>
                  </th>
                  <th className="py-3 px-3 font-extrabold text-stone-900 text-right uppercase tracking-wider text-sm w-32">
                    Harga / Unit
                    <div className="text-[10px] font-bold text-stone-500 tracking-widest mt-1">PRICE / UNIT</div>
                  </th>
                  <th className="py-3 px-3 font-extrabold text-stone-900 text-right uppercase tracking-wider text-sm w-36">
                    Subtotal
                    <div className="text-[10px] font-bold text-stone-500 tracking-widest mt-1">AMOUNT</div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-150">
                {quotation.items?.map((item: any, i: number) => {
                  const itemPrice = Number(item.unit_price || 0);
                  const itemQty = Number(item.qty || 1);
                  const itemSubtotal = itemPrice * itemQty;
                  return (
                    <tr key={i}>
                      <td className="py-4 px-3 text-base font-black text-stone-900 uppercase tracking-tight">
                        {item.title}
                      </td>
                      <td className="py-4 px-3 text-center font-bold text-stone-900 text-sm tabular-nums">
                        {itemQty}
                      </td>
                      <td className="py-4 px-3 text-center text-stone-600 font-extrabold uppercase tracking-wider text-xs">
                        {item.uom || 'Unit'}
                      </td>
                      <td className="py-4 px-3 text-right text-stone-800 font-mono font-bold text-sm">
                        {itemPrice > 0 ? formatIDR(itemPrice) : 'Rp 0'}
                      </td>
                      <td className="py-4 px-3 text-right text-stone-900 font-mono font-black text-sm">
                        {itemSubtotal > 0 ? formatIDR(itemSubtotal) : 'Rp 0'}
                      </td>
                    </tr>
                  );
                })}
                {(!quotation.items || quotation.items.length === 0) && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-sm text-stone-400 font-medium italic">No detailed scope provided.</td>
                  </tr>
                )}
              </tbody>
            </table>

            <div className="mt-4 flex justify-end">
              <div className="w-96 space-y-2">
                <div className="flex justify-between items-center text-xs uppercase tracking-wider px-3 font-bold">
                  <span className="text-stone-900">Subtotal DPP <span className="font-semibold text-[10px] text-stone-500">/ Gross</span></span>
                  <span className="font-mono text-stone-950 font-bold">{formatIDRWithDecimals(baseSubtotal, 2)}</span>
                </div>
                {quotation.discount_rate > 0 && (
                  <div className="flex justify-between items-center text-xs uppercase tracking-wider px-3 font-bold">
                    <span className="text-stone-900 font-bold">DISCOUNT ({quotation.discount_rate}%)</span>
                    <span className="font-mono text-rose-600 font-bold">- {formatIDRWithDecimals(discountDisp, 2)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center text-xs uppercase tracking-wider px-3 font-bold">
                  <span className="text-stone-900">PPN <span className="font-semibold text-[10px] text-stone-500">/ VAT ({quotation.tax_rate ?? 12}%)</span></span>
                  <span className="font-mono text-stone-950 font-bold">+ {formatIDRWithDecimals(taxDisp, 2)}</span>
                </div>
                <div className="flex justify-between items-center text-xs uppercase tracking-wider px-3 pb-2 border-b border-stone-200 font-bold">
                  <span className="text-stone-900 font-bold">FACTOR PEMBULATAN <span className="font-semibold text-[10px] text-stone-500">/ ROUNDING FACTOR</span></span>
                  <span className="font-mono text-stone-950 font-bold">{formatIDRWithDecimals(roundingFactor, 2)}</span>
                </div>
                <div className="flex justify-between items-center bg-white text-stone-900 p-4 rounded-xl border border-stone-200 mt-2 shadow-xs font-bold">
                  <span className="text-sm font-black uppercase tracking-wider text-stone-900">GRAND TOTAL <span className="font-bold text-[10px] text-stone-500 font-normal">/ TOTAL</span></span>
                  <span className="text-lg font-black tracking-tight font-mono text-stone-900">{formattedAmount}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Terms & Conditions */}
          <div className="mt-12 pt-6 border-t border-stone-200">
            <div className="grid grid-cols-2 gap-6 mt-4">
              <div>
                <div className="text-sm text-stone-900 uppercase tracking-widest font-black mb-2">Syarat & Ketentuan Umum <span className="text-stone-500 font-normal">/ General Terms & Conditions</span></div>
                <div className="text-xs text-stone-800 font-semibold space-y-2 uppercase leading-relaxed tracking-tight">
                  <div>
                    <span className="text-stone-900 block font-bold">• Harga sudah termasuk pengiriman standar ke lokasi gudang.</span>
                    <span className="text-stone-500 font-semibold text-[10.5px] block">/ Prices include standard delivery to warehouse site.</span>
                  </div>
                  <div>
                    <span className="text-stone-900 block font-bold">• Perhitungan garis waktu dimulai setelah otorisasi SPK/NTP.</span>
                    <span className="text-stone-500 font-semibold text-[10.5px] block">/ All timeline calculations begin after NTP authorization.</span>
                  </div>
                  <div>
                    <span className="text-stone-900 block font-bold">• Penawaran berlaku untuk barang dan jumlah yang tercantum.</span>
                    <span className="text-stone-500 font-semibold text-[10.5px] block">/ Quotation valid strictly for the stated items and quantities.</span>
                  </div>
                </div>
              </div>
              <div>
                <div className="text-sm text-stone-900 uppercase tracking-widest font-black mb-2">Keterangan Tambahan <span className="text-stone-500 font-normal">/ Additional Remarks</span></div>
                <div className="text-xs text-stone-800 font-bold italic leading-relaxed border-l-2 border-stone-300 pl-4 bg-white py-3 rounded-r-lg">
                  {quotation.remarks ? (
                    quotation.remarks
                  ) : (
                    <div>
                      <span className="text-stone-900 block">Syarat komersial baku berlaku.</span>
                      <span className="text-stone-500 font-semibold text-xs block mt-1">/ Standard commercial terms apply.</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </PrintTemplate>
      </div>
      <div className="p-6 border-t border-stone-100 bg-white flex justify-center gap-4">
        <Button 
          variant="secondary"
          onClick={onClose}
          className="px-6 py-2.5 rounded-xl text-sm"
        >
          {language === 'id' ? 'Tutup' : 'Close'}
        </Button>
        <Button 
          variant="primary"
          onClick={handleExportPdf}
          isLoading={isExporting}
          className="px-6 py-2.5 rounded-xl text-sm shadow-md"
        >
          {!isExporting && <Download className="w-4 h-4" />} 
          {language === 'id' ? (isExporting ? 'Mengekspor...' : 'Ekspor PDF (A4)') : (isExporting ? 'Generating...' : 'Export PDF (A4)')}
        </Button>
      </div>
    </Modal>
  );
};

