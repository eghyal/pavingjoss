import React, { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { motion, AnimatePresence } from 'motion/react';
import { Clock, MapPin, X } from 'lucide-react';

export function AttendanceReminder() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [show, setShow] = useState(false);
  const [type, setType] = useState<'CLOCK_IN' | 'CLOCK_OUT' | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    if (!user) return;

    const checkAttendance = async () => {
      try {
        const d = new Date();
        const hr = d.getHours();
        
        // Cek jika jam 07:00 - 09:00 (Waktunya Clock In)
        const isClockInTime = hr >= 7 && hr < 9;
        // Cek jika jam 16:00 - 18:00 (Waktunya Clock Out)
        const isClockOutTime = hr >= 16 && hr < 18;

        if (!isClockInTime && !isClockOutTime) return;

        // Format date string for today respecting local time roughly
        const offset = d.getTimezoneOffset() * 60000;
        const localISOTime = (new Date(d.getTime() - offset)).toISOString().split('T')[0];

        // Cek history absen hari ini
        const res = await fetch('/api/hr/attendances?date=' + localISOTime, {
          headers: { 'x-user-email': user.username }
        });
        const records = await res.json();
        const todayRecord = records.find((r: any) => r.employee_username === user.username && r.date === localISOTime);


        if (isClockInTime && !todayRecord) {
          setType('CLOCK_IN');
          setShow(true);
        } else if (isClockOutTime && todayRecord && !todayRecord.clock_out) {
          setType('CLOCK_OUT');
          setShow(true);
        }
      } catch (e) {
        console.error("Failed to check attendance status", e);
      }
    };

    // Check once on load
    checkAttendance();
    
    // Check every 10 minutes
    const interval = setInterval(checkAttendance, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, [user]);

  const getLocation = (): Promise<string | null> => {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve(null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          resolve(`${pos.coords.latitude},${pos.coords.longitude}`);
        },
        (err) => {
          console.error("Gagal mendapatkan lokasi GPS:", err);
          resolve(null); // Continue even if failed
        },
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
      );
    });
  };

  const handleAction = async () => {
    setIsProcessing(true);
    try {
      showToast('Mandapatkan lokasi (GPS)...', 'success');
      const location = await getLocation();
      if (!location) {
        showToast('Peringatan: Lokasi GPS tidak dapat direkam. Pastikan izin lokasi aktif.', 'error');
      }

      const endpoint = type === 'CLOCK_IN' ? '/api/hr/attendances/clock-in' : '/api/hr/attendances/clock-out';
      const method = type === 'CLOCK_IN' ? 'POST' : 'PUT';

      const res = await fetch(endpoint, {
        method,
        headers: { 
          'Content-Type': 'application/json',
          'x-user-email': user?.username || ''
        },
        body: JSON.stringify({ employee_username: user?.username, location })
      });

      if (res.ok) {
        showToast(type === 'CLOCK_IN' ? 'Clock In Berhasil!' : 'Clock Out Berhasil!', 'success');
        setShow(false);
      } else {
        const err = await res.json();
        showToast(err.error || 'Gagal melakukan absensi', 'error');
      }
    } catch (e) {
      showToast('Koneksi bermasalah', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  if (!show || !user) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 50, scale: 0.9 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        className="fixed bottom-6 right-6 z-50 bg-white rounded-2xl shadow-2xl border border-blue-100 p-6 md:w-96"
        style={{ boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)' }}
      >
        <button 
          onClick={() => setShow(false)}
          className="absolute top-4 right-4 text-stone-400 hover:text-stone-600 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
        
        <div className="flex items-center gap-4 mb-4">
          <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center flex-shrink-0">
            <Clock className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <h3 className="font-bold text-stone-900">
              {type === 'CLOCK_IN' ? 'Waktunya Masuk Kerja!' : 'Waktunya Pulang!'}
            </h3>
            <p className="text-xs text-stone-500 mt-0.5">
              {type === 'CLOCK_IN' ? 'Jangan lupa absen (Jam Masuk: 08.00)' : 'Saatnya clock out (Jam Pulang: 16.00)'}
            </p>
          </div>
        </div>

        <div className="bg-stone-50 rounded-xl p-3 mb-4 flex items-center gap-2 text-xs text-stone-600">
          <MapPin className="w-4 h-4 text-stone-400 flex-shrink-0" />
          <span>Lokasi Anda ({navigator.geolocation ? 'GPS Akses Diminta' : 'Tidak Didukung'}) akan otomatis direkam untuk log absen.</span>
        </div>

        <button
          onClick={handleAction}
          disabled={isProcessing}
          className="w-full bg-stone-900 hover:bg-black text-white font-bold py-3 px-4 rounded-xl shadow-md transition-all text-sm flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {isProcessing ? 'Memproses...' : type === 'CLOCK_IN' ? 'Clock In Sekarang' : 'Clock Out Sekarang'}
        </button>
      </motion.div>
    </AnimatePresence>
  );
}
