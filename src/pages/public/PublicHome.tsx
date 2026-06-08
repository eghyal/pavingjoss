import React, { useEffect, useState } from "react";
import { motion, useScroll, useTransform, AnimatePresence } from "motion/react";
import {
  MapPin,
  Phone,
  Mail,
  ArrowRight,
  Star,
  X,
  Download,
} from "lucide-react";
import { PublicHeader, PublicFooter } from "@/components/layouts/PublicLayout";
import { Modal } from "@/components/ui/Modal";
import { apiFetch } from "@/utils/api";

const iconSVGs: { [key: string]: React.ReactNode } = {
  rectangle: (
    <svg fill="currentColor" viewBox="0 0 24 24">
      <path d="M4 6h16v12H4z" />
    </svg>
  ),
  hexagon: (
    <svg fill="currentColor" viewBox="0 0 24 24">
      <path d="M17.2 3H6.8l-5.2 9 5.2 9h10.4l5.2-9z" />
    </svg>
  ),
  square: (
    <svg fill="currentColor" viewBox="0 0 24 24">
      <path d="M3 3h18v18H3z" />
    </svg>
  ),
  brick: (
    <svg fill="currentColor" viewBox="0 0 24 24">
      <path d="M3 3h8v6H3V3zm10 0h8v6h-8V3zM3 11h8v6H3v-6zm10 0h8v6h-8v-6zm-10 8h8v6H3v-6zm10 0h8v6h-8v-6z" />
    </svg>
  ),
  sand: (
    <svg fill="currentColor" viewBox="0 24 24">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM8.5 15c-.83 0-1.5-.67-1.5-1.5S7.67 12 8.5 12s1.5.67 1.5 1.5S9.33 15 8.5 15zm3.5-6c-.83 0-1.5-.67-1.5-1.5S11.17 6 12 6s1.5.67 1.5 1.5S12.83 9 12 9zm3.5 6c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z" />
    </svg>
  ),
  custom: (
    <svg fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 2L4.5 5 12 8l7.5-3L12 2zm-7.5 7L12 12l7.5-3-7.5-3L4.5 9zm0 5L12 17l7.5-3-7.5-3L4.5 14zM12 22l-7.5-3v-5l7.5 3 7.5-3v5l-7.5 3z" />
    </svg>
  ),
};

export default function PublicHome() {
  const [products, setProducts] = useState<any[]>([]);
  const [isLeadModalOpen, setIsLeadModalOpen] = useState(false);
  const [leadForm, setLeadForm] = useState({
    name: "",
    contact_info: "",
    intent: "",
  });
  const [submittingLead, setSubmittingLead] = useState(false);

  const [isCatalogModalOpen, setIsCatalogModalOpen] = useState(false);

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const res = await apiFetch("/api/public/products");
        if (res.ok) setProducts(res.data);
      } catch (e) {}
    };
    fetchProducts();
  }, []);

  const submitLead = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingLead(true);
    try {
      await apiFetch("/api/public/leads", {
        method: "POST",
        body: JSON.stringify(leadForm),
      });
      // Redirect to whatsapp after capturing lead
      const waText = encodeURIComponent(
        `Halo, saya ${leadForm.name}. Saya tertarik dengan ${leadForm.intent}`,
      );
      window.open(`https://wa.me/6281111113993?text=${waText}`, "_blank");
      setIsLeadModalOpen(false);
    } catch (e) {
    } finally {
      setSubmittingLead(false);
    }
  };

  const openLeadModal = (intent: string = "Informasi Umum") => {
    setLeadForm((prev) => ({ ...prev, intent }));
    setIsLeadModalOpen(true);
  };

  return (
    <div className="min-h-screen bg-[#F5F5F4] font-sans text-stone-900 overflow-x-clip selection:bg-[#b02524] selection:text-white">
      <PublicHeader />

      <main className="relative pb-16 lg:pb-24">
        {/* Hero Section - Unconventional layout */}
        <section className="relative pt-8 pb-24 lg:pt-16 lg:pb-40 px-4 lg:px-8 max-w-[1400px] mx-auto z-10">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            <motion.div
              initial={{ opacity: 0, x: -50 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              className="lg:col-span-7 relative z-20"
            >
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-[#b02524]/10 text-[#b02524] rounded-full text-xs font-bold uppercase tracking-widest mb-6 border border-[#b02524]/20">
                <Star className="w-3.5 h-3.5 fill-[#b02524]" />
                Manufaktur Paving Blok & Material
              </div>
              <h1 className="text-5xl md:text-6xl lg:text-7xl font-black text-stone-900 tracking-tighter leading-[1.05] mb-6 relative">
                Fondasi Kuat,
                <br className="hidden md:block" />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#b02524] to-red-600 relative inline-block">
                  Hasil Sempurna.
                  <svg
                    className="absolute w-full h-4 -bottom-1 left-0 text-red-200"
                    viewBox="0 0 100 10"
                    preserveAspectRatio="none"
                  >
                    <path
                      d="M0 5 Q 50 15 100 5"
                      stroke="currentColor"
                      strokeWidth="3"
                      fill="transparent"
                    />
                  </svg>
                </span>
              </h1>
              <p className="text-lg md:text-xl text-stone-600 mb-10 max-w-xl leading-relaxed">
                Kami bukan sekadar pabrik paving. CV Batu Emas Group memadukan
                teknologi cetak presisi dan mutu K300 untuk infrastruktur yang
                bertahan lintas generasi.
              </p>
              <div className="flex flex-wrap items-center gap-4">
                <button
                  onClick={() => openLeadModal("Pesan Sekarang")}
                  className="px-8 py-4 bg-[#b02524] hover:bg-red-800 text-white font-bold rounded-2xl shadow-lg hover:shadow-red-500/30 transition-all hover:-translate-y-1 flex items-center gap-2 group"
                >
                  Pesan Sekarang
                  <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </button>
                <button
                  onClick={() => setIsCatalogModalOpen(true)}
                  className="px-8 py-4 bg-white text-stone-800 hover:text-[#b02524] font-bold rounded-2xl shadow-sm border border-stone-200 hover:border-[#b02524]/30 hover:bg-[#b02524]/5 transition-all"
                >
                  Lihat Katalog
                </button>
              </div>
            </motion.div>

            {/* Asymmetric Floating Elements for Hero Right Side */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 1, delay: 0.2 }}
              className="lg:col-span-5 relative h-[400px] lg:h-full hidden md:block"
            >
              {/* Abstract organic shape */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-red-200/40 rounded-full blur-3xl -z-10"></div>
            </motion.div>
          </div>
        </section>

        {/* Relocated About Info - Overlapping Hero and Next Section */}
        <section className="relative z-30 max-w-[1200px] mx-auto px-4 lg:px-8 -mt-16 md:-mt-24 mb-16 lg:mb-24">
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            className="bg-white rounded-[2.5rem] p-8 md:p-12 shadow-2xl border border-stone-100 flex flex-col md:flex-row gap-8 lg:gap-16 items-center"
          >
            <div className="flex-1 space-y-6">
              <h2 className="text-3xl font-extrabold text-stone-900">
                Tentang Kami
              </h2>
              <p className="text-stone-600 leading-relaxed font-medium">
                Berlokasi strategis di{" "}
                <strong>Dusun Petahunan, Gambiran, Banyuwangi</strong>, CV. Batu
                Emas Group telah menjadi tulang punggung penyediaan material
                konstruksi untuk proyek skala kecil hingga besar di wilayah Jawa
                Timur dan sekitarnya.
              </p>
              <div className="flex flex-col gap-3">
                <a
                  href="tel:081111113993"
                  className="flex items-center gap-3 text-stone-800 font-bold hover:text-[#b02524] transition-colors group w-fit"
                >
                  <div className="w-10 h-10 rounded-full bg-stone-100 group-hover:bg-red-50 flex items-center justify-center transition-colors">
                    <Phone className="w-4 h-4" />
                  </div>
                  0811-1111-3993
                </a>
                <a
                  href="mailto:pavingjoss@gmail.com"
                  className="flex items-center gap-3 text-stone-800 font-bold hover:text-[#b02524] transition-colors group w-fit"
                >
                  <div className="w-10 h-10 rounded-full bg-stone-100 group-hover:bg-red-50 flex items-center justify-center transition-colors">
                    <Mail className="w-4 h-4" />
                  </div>
                  pavingjoss@gmail.com
                </a>
              </div>
            </div>
            <div className="w-full md:w-[45%] h-64 md:h-[400px] bg-stone-100 rounded-3xl overflow-hidden relative group">
              {/* Location Map Preview */}
              {/* Professional Grayscale SVG Map Illustration */}
              <svg
                className="absolute inset-0 w-full h-full object-cover transition-all duration-700 opacity-90 group-hover:opacity-100 group-hover:scale-[1.03]"
                viewBox="0 0 800 600"
                preserveAspectRatio="xMidYMid slice"
                xmlns="http://www.w3.org/2000/svg"
              >
                <defs>
                  <pattern
                    id="grid"
                    x="0"
                    y="0"
                    width="40"
                    height="40"
                    patternUnits="userSpaceOnUse"
                  >
                    <path
                      d="M 40 0 L 0 0 0 40"
                      fill="none"
                      stroke="#e5e5e5"
                      strokeWidth="1"
                    />
                    <path
                      d="M 10 0 L 10 40 M 20 0 L 20 40 M 30 0 L 30 40 M 0 10 L 40 10 M 0 20 L 40 20 M 0 30 L 40 30"
                      fill="none"
                      stroke="#f5f5f5"
                      strokeWidth="0.5"
                    />
                  </pattern>
                  <filter id="shadow">
                    <feDropShadow
                      dx="0"
                      dy="8"
                      stdDeviation="12"
                      floodOpacity="0.05"
                    />
                  </filter>
                  <filter id="shadow-sm">
                    <feDropShadow
                      dx="0"
                      dy="2"
                      stdDeviation="4"
                      floodOpacity="0.05"
                    />
                  </filter>
                </defs>

                <rect width="100%" height="100%" fill="#fafafa" />
                <rect width="100%" height="100%" fill="url(#grid)" />

                {/* Abstract topography / coastline */}
                <path
                  d="M 550,-50 C 580,150 480,300 650,480 C 720,550 780,580 850,650 L 850,-50 Z"
                  fill="#f4f4f5"
                />
                <path
                  d="M 550,-50 C 580,150 480,300 650,480 C 720,550 780,580 850,650"
                  fill="none"
                  stroke="#e4e4e7"
                  strokeWidth="2"
                />

                {/* Industrial / Residential area outline blocks */}
                <g
                  fill="#ffffff"
                  stroke="#e5e5e5"
                  strokeWidth="1"
                  filter="url(#shadow)"
                >
                  <rect x="240" y="240" width="60" height="80" rx="6" />
                  <rect x="320" y="260" width="110" height="60" rx="6" />
                  <rect x="240" y="340" width="190" height="40" rx="6" />
                  <rect x="140" y="240" width="80" height="40" rx="6" />
                  <rect x="140" y="300" width="80" height="80" rx="6" />

                  {/* additional blocks */}
                  <rect x="320" y="180" width="60" height="60" rx="6" />
                  <rect x="400" y="210" width="40" height="30" rx="4" />
                  <rect x="180" y="160" width="120" height="60" rx="6" />
                </g>

                {/* Main structural highways and roads (light gray) */}
                <path
                  d="M -50,150 L 230,230 L 450,230 L 850,100"
                  fill="none"
                  stroke="#d4d4d8"
                  strokeWidth="12"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M 230,230 L 230,650"
                  fill="none"
                  stroke="#d4d4d8"
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M 450,230 L 450,650"
                  fill="none"
                  stroke="#e4e4e7"
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                {/* Local connection roads */}
                <path
                  d="M 100,290 L 230,290"
                  fill="none"
                  stroke="#e4e4e7"
                  strokeWidth="4"
                />
                <path
                  d="M 310,230 L 310,400 L 450,400"
                  fill="none"
                  stroke="#e4e4e7"
                  strokeWidth="4"
                />
                <path
                  d="M 230,400 L -50,400"
                  fill="none"
                  stroke="#e4e4e7"
                  strokeWidth="4"
                />

                {/* Highlighted Focus - The Production Facility */}
                <rect
                  x="320"
                  y="260"
                  width="110"
                  height="60"
                  rx="6"
                  fill="#f4f4f5"
                  stroke="#d4d4d8"
                  strokeWidth="2"
                  filter="url(#shadow-sm)"
                />
                <g stroke="#e4e4e7" strokeWidth="2" strokeLinecap="round">
                  <line x1="335" y1="275" x2="415" y2="275" />
                  <line x1="335" y1="285" x2="415" y2="285" />
                  <line x1="335" y1="295" x2="415" y2="295" />
                  <line x1="335" y1="305" x2="385" y2="305" />
                </g>

                {/* Location Pin Dot with expanding pulse circles */}
                <circle cx="375" cy="290" r="28" fill="#fee2e2" opacity="0.4" />
                <circle cx="375" cy="290" r="16" fill="#fca5a5" opacity="0.5" />
                <circle cx="375" cy="290" r="5" fill="#b02524" />
                <circle cx="375" cy="290" r="2" fill="#ffffff" />
              </svg>
              <div className="absolute inset-0 bg-gradient-to-t from-stone-100/50 via-transparent to-transparent pointer-events-none" />

              <div className="absolute bottom-4 left-4 right-4 bg-white/95 backdrop-blur-xl p-4 rounded-[20px] flex items-center justify-between shadow-2xl border border-white/50 transform translate-y-2 opacity-90 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-500 ease-out z-10">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-red-50 flex items-center justify-center shrink-0 border border-red-100 mt-0.5">
                    <MapPin className="w-4 h-4 text-[#b02524]" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-stone-900 mb-0.5">
                      Berpusat di Banyuwangi
                    </div>
                    <div className="text-[10px] text-stone-500 font-medium leading-tight max-w-[200px]">
                      Dusun Petahunan, Gambiran
                      <br />
                      Jawa Timur 68486
                    </div>
                  </div>
                </div>
                <a
                  href="https://www.google.com/maps/place/PAVING+JOSS/@-8.4492075,114.1783708,1559m/data=!3m2!1e3!4b1!4m6!3m5!1s0x2dd3ff56bde07a6b:0xe5fd54602e96e050!8m2!3d-8.4492128!4d114.1832417!16s%2Fg%2F11h2kbpp_r"
                  target="_blank"
                  rel="noreferrer"
                  className="hidden sm:flex items-center gap-1.5 px-3 py-2 bg-stone-900 text-white rounded-xl text-[10px] font-bold tracking-wide hover:bg-[#b02524] transition-colors shrink-0"
                >
                  Rute <ArrowRight className="w-3 h-3" />
                </a>
              </div>
            </div>
          </motion.div>
        </section>

        {/* Specialist Experts Section */}
        <section className="max-w-[1400px] mx-auto px-4 lg:px-8 py-8 lg:py-16">
          <div className="mb-10 text-center">
            <h2 className="text-3xl font-black text-stone-900 tracking-tight">
              Keahlian & Kepercayaan
            </h2>
            <p className="text-stone-500 mt-3 font-medium max-w-2xl mx-auto leading-relaxed">
              Kualitas material berawal dari tangan-tangan ahli yang
              berdedikasi. Kami menghadirkan spesialis terbaik yang menjamin
              kontrol mutu dan konsistensi di setiap tahap produk yang kami
              ciptakan untuk Anda.
            </p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 max-w-5xl mx-auto xl:max-w-6xl">
            {/* Ludy */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              className="bg-white rounded-[2rem] p-8 lg:p-10 shadow-2xl shadow-stone-200/50 border border-stone-100 flex flex-col md:flex-row gap-6 items-center md:items-start group hover:-translate-y-1 transition-transform"
            >
              <div className="w-24 h-24 lg:w-32 lg:h-32 bg-stone-50 rounded-full flex-shrink-0 flex items-center justify-center border-4 border-white shadow-inner relative overflow-hidden group-hover:border-red-50 transition-colors">
                <span className="text-5xl font-black text-stone-300">L</span>
              </div>
              <div className="text-center md:text-left">
                <h3 className="text-2xl font-black text-stone-900 mb-1">
                  Bachtiar Ludy{" "}
                  <span className="text-sm font-bold text-stone-400">
                    (@Ludy)
                  </span>
                </h3>
                <div className="text-[#b02524] font-bold text-xs uppercase tracking-widest mb-4 inline-block bg-red-50 px-3 py-1 rounded-lg">
                  Product Specialist
                </div>
                <p className="text-stone-600 leading-relaxed font-medium text-sm">
                  Saya adalah penjaga standar mutu sejati yang memastikan tidak
                  ada kompromi pada kualitas akhir produk. Mata telanjang saya
                  memiliki ketajaman analitis yang tak tergantikan dalam
                  mengeleminasi mikrocacat yang tidak terlihat. Fokus obsesif saya
                  terhadap konsistensi mutu standar SNI & K300 menjadikan
                  kualitas material kami sebagai pilihan paling terpercaya untuk
                  para pengembang serta arsitek berstandar tinggi.
                </p>
              </div>
            </motion.div>

            {/* Eghy */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="bg-white rounded-[2rem] p-8 lg:p-10 shadow-2xl shadow-stone-200/50 border border-stone-100 flex flex-col md:flex-row gap-6 items-center md:items-start group hover:-translate-y-1 transition-transform"
            >
              <div className="w-24 h-24 lg:w-32 lg:h-32 bg-stone-50 rounded-full flex-shrink-0 flex items-center justify-center border-4 border-white shadow-inner relative overflow-hidden group-hover:border-red-50 transition-colors">
                <span className="text-5xl font-black text-stone-300">E</span>
              </div>
              <div className="text-center md:text-left">
                <h3 className="text-2xl font-black text-stone-900 mb-1">
                  Eghy Al Vandi{" "}
                  <span className="text-sm font-bold text-stone-400">
                    (@Eghy)
                  </span>
                </h3>
                <div className="text-[#b02524] font-bold text-xs uppercase tracking-widest mb-4 inline-block bg-red-50 px-3 py-1 rounded-lg">
                  Machinery Specialist
                </div>
                <p className="text-stone-600 leading-relaxed font-medium text-sm">
                  Dengan keahlian mendalam dalam konfigurasi dan kalibrasi
                  sistem manufaktur berteknologi tinggi, saya memberikan garansi
                  zero-defect pada proses awal rekayasa fabrikasi kami.
                  Integritas teknis yang saya miliki memastikan bahwa setiap
                  balok beton dan paving dicetak dengan presisi mesin terakurat,
                  mendefinisikan ulang reliabilitas infrastruktur jangka panjang
                  yang bisa selalu Anda andalkan dalam setiap pesanan berat.
                </p>
              </div>
            </motion.div>
          </div>
        </section>



        {/* Staggered / Asymmetric Products Section (Tidak Rapi) */}
        <section
          id="katalog"
          className="max-w-[1400px] mx-auto px-4 lg:px-8 py-8 lg:py-16"
        >
          <div className="mb-8 lg:mb-12">
            <motion.h2
              initial={{ opacity: 0, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="text-4xl md:text-5xl font-black text-stone-900 tracking-tight"
            >
              Katalog <span className="text-[#b02524]">Produk.</span>
            </motion.h2>
            <p className="text-stone-500 mt-4 max-w-md font-medium">
              Bukan hanya paving biasa. Berbagai varian ukuran dan bentuk untuk
              memenuhi standar presisi konstruksi Anda.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {products.map((item, idx) => {
              const bgColors = [
                "bg-red-50 text-[#b02524]",
                "bg-stone-900 text-white",
                "bg-stone-200 text-stone-800",
                "bg-orange-50 text-orange-700",
                "bg-yellow-50 text-yellow-700",
              ];
              const color = bgColors[idx % bgColors.length];
              return (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-50px" }}
                  transition={{ duration: 0.5, delay: idx * 0.1 }}
                  whileHover={{ scale: 1.02 }}
                  onClick={() => openLeadModal(`Tanya produk ${item.name}`)}
                  className={`${color} rounded-[2rem] p-6 lg:p-8 flex flex-col min-h-[260px] justify-between overflow-hidden relative group shadow-sm hover:shadow-xl transition-all cursor-pointer text-left focus:outline-none focus:ring-4 focus:ring-red-200`}
                >
                  <div className="relative z-10">
                    <div className="w-12 h-12 md:w-16 md:h-16 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center mb-6">
                      <div className="w-6 h-6 md:w-8 md:h-8">
                        {iconSVGs["rectangle"]}
                      </div>
                    </div>
                    <h3 className="text-xl md:text-2xl font-extrabold mb-2 leading-tight">
                      {item.name}
                    </h3>
                    <p className="text-sm opacity-80 font-medium leading-relaxed max-w-[250px]">
                      Dimensi: {item.dimension || "Standar"}
                      <br />
                      Satuan: {item.uom}
                      <br />
                      Kategori: {item.category || "-"}
                    </p>
                  </div>

                  {/* Oversized background icon for dynamic feel */}
                  <div className="absolute -right-8 -bottom-8 w-48 h-48 opacity-10 group-hover:scale-125 group-hover:-rotate-12 transition-transform duration-700 pointer-events-none z-0">
                    {iconSVGs["rectangle"]}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </section>

        {/* Visual Break / Call To Action Banner */}
        <section className="mt-16 lg:mt-24 mb-16 lg:mb-24 px-4 lg:px-8">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            className="max-w-[1400px] mx-auto bg-stone-900 rounded-[3rem] p-10 md:p-16 lg:p-20 text-center relative overflow-hidden"
          >
            <div className="absolute top-0 right-1/4 w-[500px] h-[500px] bg-[#b02524] rounded-full blur-[100px] opacity-40 mix-blend-screen pointer-events-none"></div>
            <div className="relative z-10">
              <h2 className="text-3xl md:text-5xl font-black text-white mb-6 tracking-tight">
                Siap Membangun
                <br />
                Bersama Kami?
              </h2>
              <p className="text-stone-400 font-medium mb-10 max-w-lg mx-auto">
                Konsultasikan kebutuhan material proyek Anda, dan dapatkan
                penawaran terbaik langsung dari pabrik.
              </p>
              <a
                href="https://wa.me/6281111113993"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-3 px-8 py-4 bg-white text-stone-900 hover:bg-[#b02524] hover:text-white font-bold rounded-full shadow-xl transition-all hover:scale-105 active:scale-95"
              >
                <svg
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  fill="currentColor"
                >
                  <path d="M16.75 13.96c.25.13.41.2.46.3.06.11.04.61-.21 1.18-.2.56-1.24 1.1-1.7 1.12-.46.02-.47.36-2.96-.73-2.49-1.09-3.99-3.75-4.11-3.92-.12-.17-.96-1.38-.92-2.61.05-1.22.69-1.8.95-2.04.24-.26.51-.29.68-.26h.47c.15 0 .36-.06.55.45l.69 1.87c.06.13.1.28.01.44l-.27.41-.39.42c-.12.12-.26.25-.12.5c.12.26.62 1.09 1.32 1.78c.91.88 1.71 1.17 1.95 1.3c.24.14.39.12.54-.04l.81-.94c.19-.25.35-.19.58-.11l1.67.88M12 2a10 10 0 0 1 10 10a10 10 0 0 1-10 10c-1.97 0-3.8-.57-5.35-1.55L2 22l1.55-4.65A9.969 9.969 0 0 1 2 12A10 10 0 0 1 12 2m0 2a8 8 0 0 0-8 8c0 1.72.54 3.31 1.46 4.61L4.5 19.5l2.89-.96A7.95 7.95 0 0 0 12 20a8 8 0 0 0 8-8a8 8 0 0 0-8-8z" />
                </svg>
                Hubungi via WhatsApp
              </a>
            </div>
          </motion.div>
        </section>
      </main>

      {/* Lead Modal */}
      <AnimatePresence>
        {isLeadModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsLeadModalOpen(false)}
              className="absolute inset-0 bg-stone-900/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-3xl p-6 lg:p-10 w-full max-w-lg relative z-10 shadow-2xl"
            >
              <button
                onClick={() => setIsLeadModalOpen(false)}
                className="absolute top-6 right-6 text-stone-400 hover:text-stone-900 transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
              <h3 className="text-2xl font-black text-stone-900 mb-2">
                Permintaan Penawaran
              </h3>
              <p className="text-stone-500 font-medium mb-6">
                Isi detail Anda, kami akan segera merespons via WhatsApp.
              </p>

              <form onSubmit={submitLead} className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-stone-700 mb-1">
                    Nama / Instansi
                  </label>
                  <input
                    type="text"
                    required
                    value={leadForm.name}
                    onChange={(e) =>
                      setLeadForm({ ...leadForm, name: e.target.value })
                    }
                    className="w-full px-4 py-3 rounded-xl bg-stone-50 border border-stone-200 focus:outline-none focus:ring-2 focus:ring-[#b02524]/20 focus:border-[#b02524] font-medium"
                    placeholder="Nama Lengkap atau Perusahaan"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-stone-700 mb-1">
                    Kontak WhatsApp
                  </label>
                  <input
                    type="text"
                    required
                    value={leadForm.contact_info}
                    onChange={(e) =>
                      setLeadForm({ ...leadForm, contact_info: e.target.value })
                    }
                    className="w-full px-4 py-3 rounded-xl bg-stone-50 border border-stone-200 focus:outline-none focus:ring-2 focus:ring-[#b02524]/20 focus:border-[#b02524] font-medium"
                    placeholder="08xxxxxxxxxxxx"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-stone-700 mb-1">
                    Keperluan
                  </label>
                  <input
                    type="text"
                    required
                    value={leadForm.intent}
                    onChange={(e) =>
                      setLeadForm({ ...leadForm, intent: e.target.value })
                    }
                    className="w-full px-4 py-3 rounded-xl bg-stone-50 border border-stone-200 focus:outline-none focus:ring-2 focus:ring-[#b02524]/20 focus:border-[#b02524] font-medium"
                  />
                </div>
                <button
                  type="submit"
                  disabled={submittingLead}
                  className="w-full flex justify-center items-center gap-2 py-4 mt-6 bg-[#b02524] hover:bg-red-800 text-white font-bold rounded-xl shadow-lg transition-all disabled:opacity-50"
                >
                  {submittingLead ? "Memproses..." : "Lanjut ke WhatsApp"}
                  <ArrowRight className="w-5 h-5" />
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Catalog Modal */}
      <Modal
        isOpen={isCatalogModalOpen}
        onClose={() => setIsCatalogModalOpen(false)}
        maxWidth="5xl"
        title="Katalog Produk & Company Profile"
        className="overflow-hidden rounded-[2rem]"
        contentClassName="p-0 flex flex-col h-[85vh] bg-stone-50 border-t border-stone-100"
      >
        <div className="flex-1 w-full overflow-y-auto bg-stone-100/50 flex flex-col p-6 items-center custom-scrollbar shadow-inner relative">
          <div className="w-full max-w-3xl bg-white rounded-[2rem] shadow-xl border border-stone-200 overflow-hidden relative flex flex-col mb-8 shrink-0">
            {/* Mock PDF Viewer Header */}
            <div className="px-4 py-3 bg-stone-50 border-b border-stone-100 flex items-center justify-between z-10 shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-[#ff5f56]"></div>
                <div className="w-3 h-3 rounded-full bg-[#ffbd2e]"></div>
                <div className="w-3 h-3 rounded-full bg-[#27c93f]"></div>
              </div>
              <div className="text-[10px] font-bold text-stone-500 uppercase tracking-widest flex items-center gap-2">
                compro-batu-emas-group.pdf
              </div>
              <div className="w-12 text-right text-xs font-bold text-stone-400">
                1 / 1
              </div>
            </div>

            {/* Mock PDF Document Page */}
            <div className="flex-1 p-8 md:p-16 flex flex-col items-center text-center bg-white">
              <div className="w-full h-2 bg-[#b02524] rounded-full mb-12"></div>
              <div className="w-24 h-24 mb-8 bg-stone-50 rounded-full flex items-center justify-center border border-stone-100">
                <img
                  src="/logo.png"
                  alt="Logo"
                  className="w-16 h-16 object-contain"
                />
              </div>
              <h1 className="text-4xl font-black text-stone-900 tracking-tighter mb-4 uppercase">
                Company Profile
              </h1>
              <h2 className="text-xl font-bold text-[#b02524] mb-4 tracking-tight">
                CV. Batu Emas Group
              </h2>
              <p className="text-stone-500 font-medium mb-12 max-w-md mx-auto leading-relaxed">
                Penyedia material bangunan dan paving block pracetak berkualitas
                tinggi. Melayani proyek komersial dan residensial dengan standar
                durabilitas maksimum.
              </p>

              <div className="grid grid-cols-2 gap-4 w-full mb-12">
                <div className="aspect-[4/3] bg-stone-50 rounded-xl border border-stone-100 flex items-center justify-center p-4">
                  <div className="w-full h-full border-2 border-dashed border-stone-200 rounded-lg flex items-center justify-center flex-col gap-2">
                    <div className="w-10 h-10 bg-stone-100 rounded-full"></div>
                    <div className="w-2/3 h-2 bg-stone-200 rounded-full"></div>
                  </div>
                </div>
                <div className="aspect-[4/3] bg-stone-50 rounded-xl border border-stone-100 flex items-center justify-center p-4">
                  <div className="w-full h-full border-2 border-dashed border-stone-200 rounded-lg flex items-center justify-center flex-col gap-2">
                    <div className="w-10 h-10 bg-stone-100 rounded-full"></div>
                    <div className="w-2/3 h-2 bg-stone-200 rounded-full"></div>
                  </div>
                </div>
              </div>

              <div className="mt-auto flex items-center justify-center gap-2 text-stone-400 w-full pt-8 border-t border-stone-100">
                <Star className="w-4 h-4" />
                <span className="text-[10px] font-bold uppercase tracking-widest">
                  Katalog Produk 2026
                </span>
              </div>
            </div>
          </div>
        </div>
        <div className="p-6 border-t border-stone-200 bg-white flex justify-center gap-4 shrink-0 rounded-b-[2rem]">
          <button
            onClick={() => setIsCatalogModalOpen(false)}
            className="px-6 py-2.5 rounded-xl text-sm font-bold bg-stone-100 text-stone-700 hover:bg-stone-200 transition-colors"
          >
            Tutup
          </button>
          <a
            href="/compro.pdf"
            download="compro-batu-emas.pdf"
            className="px-6 py-2.5 rounded-xl text-sm font-bold bg-[#b02524] text-white hover:bg-red-800 shadow-md flex items-center gap-2 transition-all"
          >
            <Download className="w-4 h-4" />
            Export PDF (A4)
          </a>
        </div>
      </Modal>

      <PublicFooter />
    </div>
  );
}
