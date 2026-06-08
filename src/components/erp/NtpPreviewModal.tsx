import React, { useRef, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/contexts/ToastContext';
import { generatePDF } from '@/lib/pdfGenerator';
import { Download, ShieldCheck } from 'lucide-react';
import { PrintTemplate } from '@/components/erp/PrintTemplate';

interface NtpPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: any;
  ntp: any;
}

export const NtpPreviewModal: React.FC<NtpPreviewModalProps> = ({
  isOpen,
  onClose,
  project,
  ntp,
}) => {
  const { language } = useLanguage();
  const { showToast } = useToast();
  const printDocRef = useRef<HTMLDivElement>(null);
  const [isExporting, setIsExporting] = useState(false);

  if (!project || !ntp) return null;

  const handleExportPdf = async () => {
    if (!printDocRef.current) return;
    setIsExporting(true);
    try {
      await generatePDF(printDocRef.current, `NTP_${ntp.ntp_number || project.id}.pdf`);
      showToast("Notice to Proceed PDF generated", "success");
    } catch (err) {
      console.error(err);
      showToast("PDF generation failed", "error");
    } finally {
      setIsExporting(false);
    }
  };

  const issueDateStr = ntp.created_at ? new Date(ntp.created_at).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' }) : new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="5xl"
      title="Notice to Proceed (NTP)"
      contentClassName="p-0 flex flex-col h-[85vh] bg-stone-100 border-t border-stone-100"
    >
      <div className="flex-1 overflow-auto p-8 bg-stone-50 flex justify-center items-start custom-scrollbar">
        <PrintTemplate
          ref={printDocRef}
          documentTitleId="SURAT PERINTAH KERJA (SPK)"
          documentTitleEn="NOTICE TO PROCEED & PROJECT CHARTER"
          documentNameId="surat perintah kerja resmi"
          documentNameEn="formal notice to proceed"
          date={issueDateStr}
          referenceNumber={ntp.ntp_number || 'SPK/NTP-DRAFT'}
          documentId={ntp.id || 'draft'}
          isDraft={!ntp.ntp_number || ntp.status === 'DRAFT' || ntp.status === 'DRAFTED' || ntp.status === 'PENDING'}
        >
          <div className="grid grid-cols-2 gap-6 mb-10">
            <div>
              <div className="text-sm text-stone-900 uppercase tracking-widest font-black mb-3">Unit Penerima Target <span className="text-stone-500 font-normal">/ Target Recipient Unit</span></div>
              <div className="text-base font-black text-stone-900 uppercase">DIVISI OPERASIONAL & LOGISTIK <span className="text-stone-500 font-bold text-xs block mt-1">/ OPERATIONAL & LOGISTICS DIVISION</span></div>
              <div className="text-sm text-stone-500 mt-3 font-bold">Digital Facility - Production Control Unit</div>
            </div>
            <div className="text-right">
              <div className="text-sm text-stone-900 uppercase tracking-widest font-black mb-3">Subjek Proyek <span className="text-stone-500 font-normal">/ Subject Project</span></div>
              <div className="text-xl font-black text-stone-900 uppercase">{project.name}</div>
              <div className="text-sm text-stone-900 mt-3 uppercase tracking-widest font-bold">PROJECT ID: <span className="font-mono text-stone-600">{project.id}</span></div>
            </div>
          </div>

          {/* Authorization Declaration */}
          <div className="mb-6 p-4 bg-white text-stone-900 rounded-xl border border-stone-200 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-stone-100/10 -mr-12 -mt-12 rounded-full" />
            <div className="flex items-center gap-3 mb-3 relative z-10">
               
               <span className="text-sm font-black uppercase tracking-widest text-stone-900">Persetujuan Operasional Resmi <span className="font-bold text-stone-500">/ Formal Operational Clearance</span></span>
            </div>
            <h2 className="text-lg font-black tracking-tight leading-tight uppercase max-w-lg relative z-10">
              Eksekusi Wajib Untuk Proyek <span className="text-stone-500 font-normal">/ Mandatory Execution for Project</span>: {project.id}
            </h2>
            <div className="text-sm mt-3 leading-relaxed relative z-10 font-bold">
              <span className="text-stone-900 block font-bold">• Tim operasional dengan ini diberi wewenang untuk memulai aktivitas manufaktur, pengadaan, dan logistik. Semua protokol harus mematuhi penawaran harga dan spesifikasi proyek yang dirujuk.</span>
              <span className="text-stone-500 font-bold text-xs block mt-1.5">/ Operational teams are authorized to initiate manufacturing, procurement, and logistics activities. All protocols must adhere strictly to the referenced project specifications.</span>
            </div>
          </div>

          {/* Workflow Guidelines */}
          <div className="flex-1 space-y-4">
            <div className="text-sm text-stone-900 uppercase tracking-widest font-black ml-1">Arahan Alur Kerja & Protokol Standar <span className="font-bold text-stone-500">/ Workflow Directives & Standard Protocols</span></div>
            <div className="grid grid-cols-1 gap-3">
               {[
                 { step: 1, title: 'ALOKASI SUMBER DAYA / RESOURCE ALLOCATION', desc: 'Tim pengadaan memulai Permintaan Pembelian untuk semua item di BOM. / Procurement teams to initiate Purchase Requests for all items listed in approved BOM.' },
                 { step: 2, title: 'PENJADWALAN PRODUKSI / PRODUCTION SCHEDULING', desc: 'Manajer produksi menentukan lini prioritas dan jadwal shift. / Manufacturing Floor Managers to designate priority lines and labor shifts.' },
                 { step: 3, title: 'SINKRONISASI KONTROL KUALITAS / QUALITY CONTROL SYNC', desc: 'Protokol inspeksi harus disinkronkan dengan toleransi proyek. / Inspection protocols must be synced with specific project tolerances and standards.' }
               ].map((d) => (
                 <div key={d.step} className="flex gap-4 p-4 bg-white rounded-xl border border-stone-100">
                    <div className="w-10 h-10 rounded-lg bg-white border border-stone-300 text-stone-900 flex items-center justify-center text-sm font-black shrink-0">{d.step}</div>
                    <div>
                      <h5 className="text-sm font-black text-stone-900 uppercase tracking-wider">
                        {d.title.split(' / ')[0]} <span className="text-stone-500 font-normal">/ {d.title.split(' / ')[1]}</span>
                      </h5>
                      <p className="text-xs text-stone-800 font-extrabold mt-1 leading-relaxed uppercase">{d.desc.split(' / ')[0]}</p>
                      <p className="text-xs text-stone-500 font-bold mt-1 leading-relaxed uppercase">/ {d.desc.split(' / ')[1]}</p>
                    </div>
                 </div>
               ))}
            </div>
          </div>

          <div className="mt-12 pt-6">
            <div className="p-5 bg-white rounded-xl border border-stone-100">
               <h4 className="text-sm font-black text-stone-900 uppercase tracking-widest mb-2">Catatan Kepatuhan <span className="font-bold text-stone-500">/ Compliance Remarks</span></h4>
               <p className="text-sm text-stone-800 font-bold italic leading-relaxed">
                 "{project.remarks || 'Standard operating procedures (SOP) apply throughout the project lifecycle. No additional operational constraints noted.'}"
               </p>
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
