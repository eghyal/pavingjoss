import React, { useState, useRef } from 'react';
import { PageHeader } from '@/components/shared/PageHeader';
import { Database, Upload, FileText, CheckCircle2, AlertCircle, ArrowLeft, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '@/utils/api';
import { useToast } from '@/contexts/ToastContext';
import Papa from 'papaparse';

export default function ImportData() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<'ITEMS' | 'SUPPLIERS' | 'CUSTOMERS'>('ITEMS');
  const [mappedData, setMappedData] = useState<any[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const CsvTemplates = {
    ITEMS: "item_code,name,dimension,spec,type(RAW/WIP/FINISHED),uom,unit_price,lead_time_days",
    SUPPLIERS: "code,name,contact_person,email,phone,address",
    CUSTOMERS: "code,name,email,phone,address"
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        setMappedData(results.data);
      },
      error: (error) => {
        showToast(`Failed to parse CSV: ${error.message}`, "error");
      }
    });

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const downloadTemplate = () => {
    const content = CsvTemplates[activeTab];
    const blob = new Blob([content], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `template_${activeTab.toLowerCase()}.csv`;
    a.click();
  };

  const submitImport = async () => {
    if (!mappedData.length) return;
    setIsProcessing(true);
    try {
      const payload = {
        type: activeTab,
        data: mappedData
      };
      const res = await apiFetch('/api/datacenter/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.data) {
        showToast(`Successfully imported ${mappedData.length} records.`, "success");
        setMappedData([]);
      }
    } catch (e: any) {
      showToast(e.message || 'Import failed.', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-8 pb-20 animate-in fade-in duration-500">
      <PageHeader 
        title="Master Data Import"
        subtitle="Bulk Upload via CSV"
        icon={<Database className="w-6 h-6" />}
        actions={
          <button 
            onClick={() => navigate('/data-center')}
            className="px-6 py-3 bg-stone-100 border border-stone-200 text-stone-700 text-sm font-bold rounded-2xl hover:bg-stone-200 transition-all flex items-center gap-2"
          >
            <ArrowLeft className="w-5 h-5" /> 
            Back to Data Center
          </button>
        }
      />

      <div className="flex gap-4 border-b border-stone-200 pb-4">
        {['ITEMS', 'SUPPLIERS', 'CUSTOMERS'].map(tab => (
           <button
             key={tab}
             onClick={() => { setActiveTab(tab as any); setMappedData([]); }}
             className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${
               activeTab === tab 
               ? 'bg-stone-900 text-white shadow-sm' 
               : 'bg-stone-50 text-stone-500 hover:bg-stone-100 border border-stone-200'
             }`}
           >
             {tab.charAt(0) + tab.slice(1).toLowerCase()}
           </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-1 space-y-6">
           <div className="bg-white p-8 rounded-3xl border border-stone-200 shadow-sm text-center">
              <div className="w-16 h-16 bg-stone-50 rounded-full border border-stone-100 flex items-center justify-center mx-auto mb-4">
                 <FileText className="w-8 h-8 text-stone-400" />
              </div>
              <h3 className="text-sm font-bold text-stone-900 mb-2">1. Download Template</h3>
              <p className="text-xs text-stone-500 mb-6 leading-relaxed">Download the official CSV structure for {activeTab.toLowerCase()}. Missing columns may cause import failures.</p>
              <button 
                onClick={downloadTemplate}
                className="w-full py-3 bg-stone-100 text-stone-700 text-xs font-bold uppercase tracking-wider rounded-xl hover:bg-stone-200 transition-colors"
              >
                Download CSV Template
              </button>
           </div>
           
           <div className="bg-white p-8 rounded-3xl border border-stone-200 shadow-sm text-center">
             <input type="file" accept=".csv" className="hidden" ref={fileInputRef} onChange={handleFileUpload} />
             <div className="w-16 h-16 bg-stone-50 rounded-full border border-stone-100 flex items-center justify-center mx-auto mb-4">
                 <Upload className="w-8 h-8 text-emerald-600" />
              </div>
              <h3 className="text-sm font-bold text-stone-900 mb-2">2. Upload Filled CSV</h3>
              <p className="text-xs text-stone-500 mb-6 leading-relaxed">Select your populated CSV file. The system will preview the records before finalizing the bulk insertion.</p>
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-3 bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold uppercase tracking-wider rounded-xl hover:bg-emerald-100 transition-colors"
              >
                Select CSV File
              </button>
           </div>
        </div>

        <div className="md:col-span-2">
           <div className="bg-white p-8 rounded-3xl border border-stone-200 shadow-sm min-h-[500px]">
             <h3 className="text-sm font-bold text-stone-900 mb-6 font-mono border-b border-stone-100 pb-4">Data Preview ({mappedData.length} Records)</h3>
             {mappedData.length > 0 ? (
                <div className="space-y-4">
                  <div className="overflow-x-auto max-h-[400px] border border-stone-100 rounded-xl">
                    <table className="w-full text-left text-xs whitespace-nowrap">
                      <thead className="bg-stone-50 sticky top-0 border-b border-stone-200">
                        <tr>
                           {Object.keys(mappedData[0]).map(k => (
                             <th key={k} className="px-4 py-3 font-bold text-stone-500 uppercase tracking-wider">{k}</th>
                           ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-100">
                        {mappedData.slice(0, 50).map((row, i) => (
                          <tr key={i} className="hover:bg-stone-50">
                            {Object.values(row).map((val: any, j) => (
                               <td key={j} className="px-4 py-2 text-stone-600">{val}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {mappedData.length > 50 && <div className="text-[10px] text-stone-400 font-bold uppercase tracking-widest text-center mt-2">Showing first 50 rows only</div>}
                  
                  <div className="pt-4 flex justify-end">
                    <button 
                      onClick={submitImport}
                      disabled={isProcessing}
                      className="px-8 py-3 bg-stone-900 text-white rounded-xl text-xs font-bold uppercase tracking-widest flex items-center gap-2 hover:bg-stone-800 transition-all shadow-sm disabled:opacity-50"
                    >
                      {isProcessing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                      {isProcessing ? 'Importing...' : 'Finalize Import'}
                    </button>
                  </div>
                </div>
             ) : (
               <div className="flex flex-col items-center justify-center h-[300px] text-stone-400">
                 <AlertCircle className="w-8 h-8 mb-4 opacity-50" />
                 <p className="text-sm font-semibold max-w-xs text-center">No data loaded. Upload a CSV file to preview the mapped contents and begin the import.</p>
               </div>
             )}
           </div>
        </div>
      </div>
    </div>
  );
}
