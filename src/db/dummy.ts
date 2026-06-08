import { Database } from 'better-sqlite3';

export function seedDummyData(db: Database) {
  try {
    // Clean up previously seeded FG items (Finish Goods are not wanted in the trial dummy data)
    db.prepare(`DELETE FROM items WHERE category = 'FG' OR type = 'FINISHED' OR item_code LIKE 'FG-%'`).run();
    db.prepare(`DELETE FROM inventory WHERE item_id NOT IN (SELECT id FROM items)`).run();

    // Customers
    db.prepare(`
      INSERT OR IGNORE INTO customers (id, code, name, email, phone, address)
      VALUES 
      ('CUST-001', 'CUST001', 'PT Maju Bersama', 'info@majubersama.com', '081234567890', 'Jl. Merdeka No 1, Jakarta'),
      ('CUST-002', 'CUST002', 'CV Sejahtera Raya', 'contact@sejahtera.com', '089876543210', 'Jl. Sudirman No 45, Bandung'),
      ('CUST-003', 'CUST003', 'PT Bumi Pertiwi Makmur', 'purchasing@bumipertiwi.co.id', '081122334455', 'Kawasan Industri Cikarang, Bekasi'),
      ('CUST-004', 'CUST004', 'UD Sentosa Baru', 'sales@sentosabaru.com', '087766554433', 'Jl. Diponegoro No 12, Semarang'),
      ('CUST-005', 'CUST005', 'Bina Karya Abadi', 'contact@binakarya.com', '082233445566', 'Jl. Gajah Mada No 99, Surabaya')
    `).run();

    // Suppliers
    db.prepare(`
      INSERT OR IGNORE INTO suppliers (id, code, name, address)
      VALUES 
      ('SUPP-001', 'SUPP001', 'PT Baja Logam Indonesia', 'Surabaya'),
      ('SUPP-002', 'SUPP002', 'CV Sumber Makmur', 'Jakarta'),
      ('SUPP-003', 'SUPP003', 'PT Electro Nusa', 'Tangerang'),
      ('SUPP-004', 'SUPP004', 'Global Steel Corp', 'Batam'),
      ('SUPP-005', 'SUPP005', 'Jaya Teknik Bearings', 'Semarang')
    `).run();

    // Items (Excluding Finish Goods (FG))
    db.prepare(`
      INSERT OR IGNORE INTO items (id, item_code, name, description, category, uom, min_stock, max_stock)
      VALUES 
      ('ITM-001', 'RAW-101', 'Plat Besi 5mm', 'Bahan baku plat besi tebal 5mm standard', 'RAW', 'Sheet', 10, 100),
      ('ITM-002', 'RAW-102', 'Baut M10', 'Baut baja', 'RAW', 'Pcs', 100, 5000),
      ('ITM-003', 'CMP-201', 'Rangka Utama', 'Sub-assembly Rangka', 'COMPONENT', 'Set', 5, 20),
      ('ITM-005', 'RAW-103', 'Besi Siku L 5x5', 'Besi siku struktural L 5x5', 'RAW', 'Lonjor', 20, 200),
      ('ITM-006', 'RAW-104', 'Kabel Tembaga 2.5mm', 'Kabel panel motor', 'RAW', 'Meter', 50, 1000),
      ('ITM-007', 'RAW-105', 'Bearing 6205', 'Bearing untuk shaft mixer', 'RAW', 'Pcs', 20, 100),
      ('ITM-008', 'RAW-106', 'Motor Listrik 3 Phase 5HP', 'Motor penggerak', 'RAW', 'Unit', 2, 10),
      ('ITM-009', 'CMP-202', 'Panel Kontrol', 'Sub-assembly panel', 'COMPONENT', 'Set', 2, 10)
    `).run();

    // Set prices
    try {
      db.prepare(`
        INSERT OR IGNORE INTO item_supplier_prices (item_id, supplier_id, unit_price)
        VALUES 
        ('ITM-001', 'SUPP-001', 450000),
        ('ITM-001', 'SUPP-004', 420000),
        ('ITM-002', 'SUPP-002', 2000),
        ('ITM-005', 'SUPP-001', 85000),
        ('ITM-005', 'SUPP-004', 82000),
        ('ITM-006', 'SUPP-003', 15000),
        ('ITM-007', 'SUPP-005', 45000),
        ('ITM-007', 'SUPP-002', 48000),
        ('ITM-008', 'SUPP-003', 2500000)
      `).run();
    } catch(e) {}

    // Initialize Inventory (Excluding Finish Goods (FG))
    db.prepare(`
      INSERT OR IGNORE INTO inventory (item_id, free_stock, allocated_stock)
      VALUES 
      ('ITM-001', 50, 0),
      ('ITM-002', 1000, 0),
      ('ITM-003', 10, 0),
      ('ITM-005', 100, 0),
      ('ITM-006', 500, 0),
      ('ITM-007', 40, 0),
      ('ITM-008', 5, 0),
      ('ITM-009', 4, 0)
    `).run();

    // Projects
    db.prepare(`
       INSERT OR IGNORE INTO projects (id, name, due_date, customer, remarks, status)
       VALUES 
       ('PROJ-1001', 'Pengadaan Mesin Mixer', '2026-12-31', 'PT Maju Bersama', 'Dummy project for trial error', 'ACTIVE')
    `).run();

    // Seeding HR Jobs
    db.prepare(`
       INSERT OR IGNORE INTO hr_jobs (id, title, department, location, type, description, requirements, benefits, salary_string, pamphlet_bg_color, pamphlet_accent_color)
       VALUES 
       ('JOB-001', 'Production Engineer', 'Production', 'Sidoarjo Factory', 'Full-time', 'Responsible for supervising production lines, conducting QA, and maximizing machinery efficiency Index.', '["Minimal S1 Teknik Mesin/Industri", "Pengalaman 2 tahun di bidang manufacturing", "Dapat membaca flowchart & CAD drawing", "Disiplin dan bertanggung jawab"]', '["Gaji Pokok Kompetitif", "BPJS Kesehatan & Ketenagakerjaan", "Mes Karyawan / Tunjangan Transport", "Bonus Kinerja Akhir Tahun"]', 'Rp 7.000.000 - Rp 9.500.000', '#1c1917', '#ca8a04'),
       ('JOB-002', 'Warehouse Crew', 'Warehouse', 'Surabaya Central Depot', 'Full-time', 'Manages physical materials inventory, counts stocks, and prepares finished goods shipping packages.', '["Minimal SMA/K sederajat", "Sehat jasmani dan rohani", "Nilai tambah jika bisa mengendarai Forklift", "Terbiasa kerja mandiri dan tim"]', '["Uang harian & makan", "Pakaian keselamatan kerja", "Bonus lemburan", "Asuransi kecelakaan"]', 'Rp 4.500.000 - Rp 5.500.000', '#0b0f19', '#2563eb')
    `).run();

    // Seeding HR Applications
    db.prepare(`
       INSERT OR IGNORE INTO hr_applications (id, job_id, name, email, phone, linkedin_url, experience, resume_text, status, notes)
       VALUES 
       ('APP-001', 'JOB-001', 'Ahmad Dhani', 'dhani@example.com', '081299998888', 'linkedin.com/in/dhani', '3 Tahun', 'Saya sangat tertarik dengan posisi Production Engineer karena memiliki latar belakang manufaktur mesin berat di Jawa Timur selama 3 tahun.', 'INTERVIEW', 'Bahasa Inggris aktif, komunikasi taktis dan sangat menguasai basic machinery.'),
       ('APP-002', 'JOB-002', 'Budi Santoso', 'budi@example.com', '087711223344', '', '6 Bulan', 'Saya berpengalaman dalam mengepak barang dan mengecek surat jalan pengiriman Logistik.', 'APPLIED', 'CV terlampir, butuh konfirmasi jadwal walkthrough warehouse.')
    `).run();

    // Seeding Employee Appraisals
    db.prepare(`
       INSERT OR IGNORE INTO hr_kpis (id, employee_username, evaluator_username, period_name, score_communication, score_productivity, score_reliability, score_leadership, score_technical, overall_score, evaluation_notes)
       VALUES
       ('KPI-001', 'Eghy', 'admin', 'Q1 2026', 90, 95, 92, 88, 90, 91.0, 'Kinerja luar biasa dalam mengawal pbac dan pendelegasian otorisasi user.'),
       ('KPI-002', 'Ludy', 'admin', 'Q1 2026', 85, 88, 90, 85, 87, 87.0, 'Konsistensi tinggi pada operasional inventaris barang masuk.')
    `).run();

    // Seeding Resignation Handover Tracker
    db.prepare(`
       INSERT OR IGNORE INTO hr_handovers (id, resigning_username, successor_username, target_last_date, status, handover_notes, checklist_json)
       VALUES
       ('HO-001', 'Ludy', 'Eghy', '2026-06-30', 'IN_PROGRESS', 'Handover kendali inventori gudang utama sehubungan masa transisi penempatan divisi baru.', '[{"id":"1","title":"SOP Logistik dan Gudang","status":"COMPLETED"},{"id":"2","title":"Kredensial Login CMS","status":"PENDING"},{"id":"3","title":"Akses Fisik Brankas Dokumen Jalan","status":"PENDING"}]')
    `).run();

  } catch (error) {
    console.error("Error seeding dummy data:", error);
  }
}
