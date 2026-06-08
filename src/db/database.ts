import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { seedDummyData } from './dummy.ts';

// Tentukan direktori penyimpanan lokal untuk database (agar data aman dari script/kode)
const dbDirectory = process.env.DB_DIR || path.join(process.cwd(), 'data');
const dbPath = process.env.DB_PATH || path.join(dbDirectory, 'erp.db');
const attendanceDbPath = path.join(dbDirectory, 'hr_attendance.db');

// Pastikan folder penyimpanan lokal sudah dibuat
if (!fs.existsSync(dbDirectory)) {
  fs.mkdirSync(dbDirectory, { recursive: true });
}

const isDev = process.env.NODE_ENV !== 'production';
console.log(`[Database] Menyimpan data di lokal disk pada direktori: ${path.resolve(dbPath)}`);
const db = new Database(dbPath, { timeout: 15000 });

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

// Initialize standalone HR Attendance Database (Sharding for high concurrency writes)
const initAttendanceDb = () => {
  const hrDb = new Database(attendanceDbPath, { timeout: 15000 });
  hrDb.pragma('journal_mode = WAL');
  hrDb.pragma('synchronous = NORMAL');
  hrDb.exec(`
    CREATE TABLE IF NOT EXISTS hr_attendances (
      id TEXT PRIMARY KEY,
      employee_username TEXT NOT NULL,
      date TEXT NOT NULL,
      clock_in TEXT,
      clock_in_location TEXT,
      clock_out TEXT,
      clock_out_location TEXT,
      status TEXT CHECK(status IN ('PRESENT', 'ABSENT', 'LATE', 'LEAVE')) DEFAULT 'PRESENT',
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_attendances_emp ON hr_attendances(employee_username);
    CREATE INDEX IF NOT EXISTS idx_attendances_date ON hr_attendances(date);
  `);
  try { hrDb.exec("ALTER TABLE hr_attendances ADD COLUMN clock_in_location TEXT;"); } catch (e) {}
  try { hrDb.exec("ALTER TABLE hr_attendances ADD COLUMN clock_out_location TEXT;"); } catch (e) {}
  hrDb.close();
};

initAttendanceDb();

// Attach the attendance shard to the main connection so cross-joins (e.g., users) still work elegantly
db.exec(`ATTACH DATABASE '${attendanceDbPath}' AS attendance_db;`);

// Initialize Core Tables
export function initDb() {
  // Temporarily disable foreign keys to allow schema creation with dependencies
  db.pragma('foreign_keys = OFF');

  // Performance and Safety Pragmas
  db.pragma('synchronous = NORMAL');
  db.pragma('temp_store = MEMORY');
  db.pragma('cache_size = -64000'); // 64 MB of page cache

  db.transaction(() => {
    // Migrate existing attendances from main DB to shard if necessary
    try {
      db.exec(`
        INSERT OR IGNORE INTO attendance_db.hr_attendances
        SELECT * FROM main.hr_attendances;
        DROP TABLE IF EXISTS main.hr_attendances;
      `);
    } catch (e) {
      // Ignored if migration already done or table doesn't exist
    }

    // 1. Schema Migrations (Add missing columns to existing tables)
    try { db.exec("ALTER TABLE projects ADD COLUMN urgency TEXT DEFAULT 'NORMAL';"); } catch (e) {}
    try {
      db.exec("ALTER TABLE purchase_requests ADD COLUMN cancelled_at DATETIME;");
      db.exec("ALTER TABLE purchase_requests ADD COLUMN archived INTEGER DEFAULT 0;");
      db.exec("ALTER TABLE purchase_requests ADD COLUMN urgency TEXT DEFAULT 'NORMAL';");
    } catch (e) {}
    try {
      db.exec("ALTER TABLE purchase_orders ADD COLUMN cancelled_at DATETIME;");
      db.exec("ALTER TABLE purchase_orders ADD COLUMN archived INTEGER DEFAULT 0;");
      db.exec("ALTER TABLE purchase_orders ADD COLUMN urgency TEXT DEFAULT 'NORMAL';");
    } catch (e) {}
    try {
      db.exec("ALTER TABLE grns ADD COLUMN rejected_grn_doc TEXT;");
      db.exec("ALTER TABLE grns ADD COLUMN is_reissue BOOLEAN DEFAULT 0;");
      db.exec("ALTER TABLE grns ADD COLUMN inventory_updated_at DATETIME;");
    } catch (e) {}
    try { db.exec("ALTER TABLE users ADD COLUMN is_approved INTEGER DEFAULT 0;"); } catch (e) {}
    try { db.exec("ALTER TABLE users ADD COLUMN level TEXT DEFAULT 'STAFF';"); } catch (e) {}
    try { db.exec("ALTER TABLE users ADD COLUMN last_seen_at TEXT;"); } catch (e) {}
    try { db.exec("ALTER TABLE users ADD COLUMN device_type TEXT DEFAULT 'Desktop';"); } catch (e) {}
    try { db.exec("UPDATE users SET is_approved = 1 WHERE status = 'APPROVED';"); } catch (e) {}
    try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_bom_consumption_unique ON bom_item_consumption(bom_id);"); } catch (e) {}
    try {
      db.exec("ALTER TABLE work_centers ADD COLUMN efficiency_index REAL DEFAULT 1.0;");
      db.exec("ALTER TABLE work_centers ADD COLUMN status TEXT DEFAULT 'ACTIVE';");
    } catch (e) {}
    try { db.exec("ALTER TABLE pr_items ADD COLUMN expected_delivery_date TEXT;"); } catch (e) {}
    try { db.exec("ALTER TABLE project_tasks ADD COLUMN pr_id TEXT;"); } catch (e) {}
    try { db.exec("ALTER TABLE project_tasks ADD COLUMN po_id TEXT;"); } catch (e) {}
    try { db.exec("ALTER TABLE quotation_items ADD COLUMN unit_price REAL DEFAULT 0;"); } catch (e) {}
    
    // Add revision notes for Revise feature
    try { db.exec("ALTER TABLE purchase_requests ADD COLUMN revision_note TEXT;"); } catch (e) {}
    try { db.exec("ALTER TABLE purchase_requests ADD COLUMN remarks TEXT;"); } catch (e) {}
    try { db.exec("ALTER TABLE purchase_requests ADD COLUMN escalated_to TEXT;"); } catch (e) {}
    try { db.exec("ALTER TABLE purchase_orders ADD COLUMN revision_note TEXT;"); } catch (e) {}
    try { db.exec("ALTER TABLE purchase_orders ADD COLUMN escalated_to TEXT;"); } catch (e) {}
    try { db.exec("ALTER TABLE quotations ADD COLUMN revision_note TEXT;"); } catch (e) {}
    try { db.exec("ALTER TABLE quotation_items ADD COLUMN revision_note TEXT;"); } catch (e) {}
    try { db.exec("ALTER TABLE pr_items ADD COLUMN revision_note TEXT;"); } catch (e) {}
    try { db.exec("ALTER TABLE quotations ADD COLUMN tax_rate REAL DEFAULT 0;"); } catch (e) {}
    try { db.exec("ALTER TABLE quotations ADD COLUMN discount_rate REAL DEFAULT 0;"); } catch (e) {}

    // NTP Migrations (Renaming NTC to NTP)
    try { db.exec("ALTER TABLE ntcs RENAME TO ntps;"); } catch (e) {}
    try { db.exec("ALTER TABLE ntps RENAME COLUMN ntc_number TO ntp_number;"); } catch (e) {}
    try { db.exec("ALTER TABLE projects RENAME COLUMN ntc_id TO ntp_id;"); } catch (e) {}

    // Items Column Migrations
    try { db.exec("ALTER TABLE items ADD COLUMN category TEXT;"); } catch (e) {}
    try { db.exec("ALTER TABLE items ADD COLUMN description TEXT;"); } catch (e) {}
    try { db.exec("ALTER TABLE items ADD COLUMN min_stock REAL DEFAULT 0;"); } catch (e) {}
    try { db.exec("ALTER TABLE items ADD COLUMN max_stock REAL DEFAULT 0;"); } catch (e) {}

    // 2. Main Table Creations
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL,
        level TEXT DEFAULT 'STAFF',
        name TEXT NOT NULL,
        status TEXT DEFAULT 'PENDING',
        is_approved INTEGER DEFAULT 0,
        last_seen_at TEXT,
        device_type TEXT DEFAULT 'Desktop',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS work_centers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        manpower_count INTEGER DEFAULT 1,
        hours_per_day REAL DEFAULT 8,
        days_per_week INTEGER DEFAULT 5,
        capacity_per_week REAL DEFAULT 40,
        efficiency_index REAL DEFAULT 1.0,
        status TEXT DEFAULT 'ACTIVE'
      );

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        due_date TEXT NOT NULL,
        customer TEXT,
        remarks TEXT,
        status TEXT DEFAULT 'DRAFT',
        urgency TEXT DEFAULT 'NORMAL',
        bq_updated_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        archived_at DATETIME,
        deleted_at DATETIME,
        parent_project_id TEXT,
        FOREIGN KEY (parent_project_id) REFERENCES projects(id)
      );

      CREATE TABLE IF NOT EXISTS bom_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS bom_template_items (
        id TEXT PRIMARY KEY,
        template_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        dimension TEXT,
        spec TEXT,
        required_qty REAL NOT NULL,
        unit_price REAL DEFAULT 0,
        FOREIGN KEY (template_id) REFERENCES bom_templates(id),
        FOREIGN KEY (item_id) REFERENCES items(id)
      );

      CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY,
        item_code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        dimension TEXT,
        spec TEXT,
        type TEXT CHECK (type IN ('RAW', 'WIP', 'FINISHED', 'TOOL')),
        uom TEXT NOT NULL,
        unit_price REAL DEFAULT 0,
        lead_time_days INTEGER DEFAULT 0,
        category TEXT,
        description TEXT,
        min_stock REAL DEFAULT 0,
        max_stock REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        deleted_at DATETIME
      );

      CREATE TABLE IF NOT EXISTS suppliers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        code TEXT UNIQUE,
        contact_person TEXT,
        email TEXT,
        phone TEXT,
        address TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS inventory (
        item_id TEXT PRIMARY KEY,
        free_stock REAL DEFAULT 0,
        allocated_stock REAL DEFAULT 0,
        FOREIGN KEY (item_id) REFERENCES items(id)
      );

      CREATE TABLE IF NOT EXISTS boms (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        dimension TEXT,
        spec TEXT,
        required_qty REAL NOT NULL,
        unit_price REAL DEFAULT 0,
        reference TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects(id),
        FOREIGN KEY (item_id) REFERENCES items(id)
      );

      CREATE TABLE IF NOT EXISTS purchase_requests (
        id TEXT PRIMARY KEY,
        pr_number TEXT UNIQUE NOT NULL,
        project_id TEXT NOT NULL,
        expected_delivery_date TEXT,
        drawing_reference TEXT,
        total_estimated_cost REAL DEFAULT 0,
        status TEXT DEFAULT 'DRAFTED',
        authorized_at DATETIME,
        authorized_doc TEXT,
        cancelled_at DATETIME,
        archived INTEGER DEFAULT 0,
        urgency TEXT DEFAULT 'NORMAL',
        revision_note TEXT,
        remarks TEXT,
        escalated_to TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects(id)
      );

      CREATE TABLE IF NOT EXISTS purchase_orders (
        id TEXT PRIMARY KEY,
        po_number TEXT UNIQUE NOT NULL,
        supplier_id TEXT,
        supplier_name TEXT NOT NULL,
        expected_date TEXT,
        auth_doc_name TEXT,
        total_amount REAL DEFAULT 0,
        status TEXT DEFAULT 'DRAFTED',
        authorized_at DATETIME,
        cancelled_at DATETIME,
        archived INTEGER DEFAULT 0,
        urgency TEXT DEFAULT 'NORMAL',
        revision_note TEXT,
        escalated_to TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
      );

      CREATE TABLE IF NOT EXISTS project_tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        task_name TEXT NOT NULL,
        work_center_id TEXT,
        required_hours REAL DEFAULT 0,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        actual_start_date TEXT,
        actual_end_date TEXT,
        progress INTEGER DEFAULT 0,
        status TEXT DEFAULT 'PENDING',
        pr_id TEXT,
        po_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects(id),
        FOREIGN KEY (work_center_id) REFERENCES work_centers(id)
      );

      CREATE TABLE IF NOT EXISTS pr_items (
        id TEXT PRIMARY KEY,
        pr_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        dimension TEXT,
        spec TEXT,
        expected_delivery_date TEXT,
        qty REAL NOT NULL,
        unit_price REAL DEFAULT 0,
        po_id TEXT,
        revision_note TEXT,
        FOREIGN KEY (pr_id) REFERENCES purchase_requests(id),
        FOREIGN KEY (item_id) REFERENCES items(id),
        FOREIGN KEY (po_id) REFERENCES purchase_orders(id)
      );

      CREATE TABLE IF NOT EXISTS grns (
        id TEXT PRIMARY KEY,
        po_id TEXT NOT NULL,
        received_date TEXT NOT NULL,
        engineering_user TEXT,
        qc_user TEXT,
        qc_status TEXT CHECK (qc_status IN ('PASSED', 'REJECTED', 'CONDITIONAL')),
        remarks TEXT,
        rejected_grn_doc TEXT,
        is_reissue BOOLEAN DEFAULT 0,
        inventory_updated_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (po_id) REFERENCES purchase_orders(id)
      );

      CREATE TABLE IF NOT EXISTS grn_items (
        id TEXT PRIMARY KEY,
        grn_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        dimension TEXT,
        spec TEXT,
        qty_received REAL NOT NULL,
        FOREIGN KEY (grn_id) REFERENCES grns(id),
        FOREIGN KEY (item_id) REFERENCES items(id)
      );

      CREATE TABLE IF NOT EXISTS stock_movements (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL,
        project_id TEXT,
        type TEXT CHECK (type IN ('ALLOCATION', 'GRN', 'CONSUMPTION', 'ADJUSTMENT', 'RELEASE', 'GRN_ALLOCATION', 'RETURN')),
        qty REAL NOT NULL,
        reference_id TEXT,
        recorded_by TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (item_id) REFERENCES items(id),
        FOREIGN KEY (project_id) REFERENCES projects(id)
      );

      CREATE TABLE IF NOT EXISTS bom_item_consumption (
        id TEXT PRIMARY KEY,
        bom_id TEXT UNIQUE NOT NULL,
        qty_consumed REAL DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (bom_id) REFERENCES boms(id)
      );

      CREATE TABLE IF NOT EXISTS work_orders (
        id TEXT PRIMARY KEY,
        wo_number TEXT UNIQUE NOT NULL,
        project_id TEXT NOT NULL,
        status TEXT DEFAULT 'DRAFT',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME,
        FOREIGN KEY (project_id) REFERENCES projects(id)
      );

      CREATE TABLE IF NOT EXISTS work_order_items (
        id TEXT PRIMARY KEY,
        wo_id TEXT NOT NULL,
        bom_id TEXT NOT NULL,
        qty_to_consume REAL NOT NULL,
        qty_actually_consumed REAL DEFAULT 0,
        FOREIGN KEY (wo_id) REFERENCES work_orders(id),
        FOREIGN KEY (bom_id) REFERENCES boms(id)
      );

      CREATE TABLE IF NOT EXISTS audit_trail (
        id TEXT PRIMARY KEY,
        user_email TEXT,
        action TEXT NOT NULL,
        resource_type TEXT,
        resource_id TEXT,
        details TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS forum_posts (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        author_username TEXT NOT NULL,
        author_role TEXT NOT NULL,
        category TEXT NOT NULL,
        pinned_until DATETIME,
        shared_resource_type TEXT, -- 'PROJECT', 'PR', 'PO'
        shared_resource_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS forum_comments (
        id TEXT PRIMARY KEY,
        post_id TEXT NOT NULL,
        content TEXT NOT NULL,
        author_username TEXT NOT NULL,
        author_role TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (post_id) REFERENCES forum_posts(id)
      );

      CREATE TABLE IF NOT EXISTS chat_threads (
        id TEXT PRIMARY KEY,
        name TEXT,
        is_group BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_by TEXT 
      );

      CREATE TABLE IF NOT EXISTS chat_participants (
        thread_id TEXT NOT NULL,
        username TEXT NOT NULL,
        joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (thread_id, username)
      );

      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        sender_username TEXT NOT NULL,
        content TEXT,
        file_url TEXT,
        file_name TEXT,
        file_size INTEGER,
        file_type TEXT,
        read_by TEXT DEFAULT '',
        is_deleted BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (thread_id) REFERENCES chat_threads(id)
      );

      CREATE TABLE IF NOT EXISTS user_drafts (
        key TEXT NOT NULL,
        username TEXT NOT NULL,
        data TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (key, username)
      );

      CREATE TABLE IF NOT EXISTS inventory_labels (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL,
        grn_id TEXT,
        original_qty REAL NOT NULL,
        current_qty REAL NOT NULL,
        project_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (item_id) REFERENCES items(id)
      );

      CREATE TABLE IF NOT EXISTS item_price_history (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL,
        supplier_id TEXT NOT NULL,
        unit_price REAL NOT NULL,
        recorded_by TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (item_id) REFERENCES items(id),
        FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
      );
      CREATE TABLE IF NOT EXISTS item_supplier_prices (
        item_id TEXT NOT NULL,
        supplier_id TEXT NOT NULL,
        unit_price REAL NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (item_id, supplier_id),
        FOREIGN KEY (item_id) REFERENCES items(id),
        FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
      );

      CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        address TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS delivery_notes (
        id TEXT PRIMARY KEY,
        dn_number TEXT UNIQUE NOT NULL,
        customer_id TEXT NOT NULL,
        project_id TEXT,
        status TEXT DEFAULT 'DRAFT', -- DRAFT, PENDING_DELIVERY, IN_DELIVERY, DELIVERED
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        authorized_by TEXT,
        police_number TEXT,
        shipped_at DATETIME,
        delivered_at DATETIME,
        invoiced_at DATETIME,
        remarks TEXT,
        FOREIGN KEY (customer_id) REFERENCES customers(id),
        FOREIGN KEY (project_id) REFERENCES projects(id)
      );

      CREATE TABLE IF NOT EXISTS delivery_items (
        id TEXT PRIMARY KEY,
        dn_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        qty REAL NOT NULL,
        uom TEXT NOT NULL,
        remarks TEXT,
        FOREIGN KEY (dn_id) REFERENCES delivery_notes(id),
        FOREIGN KEY (item_id) REFERENCES items(id)
      );

      CREATE TABLE IF NOT EXISTS dn_signatures (
        id TEXT PRIMARY KEY,
        dn_id TEXT NOT NULL,
        role TEXT NOT NULL,
        signer_name TEXT,
        file_url TEXT,
        uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (dn_id) REFERENCES delivery_notes(id)
      );

      CREATE TABLE IF NOT EXISTS commercial_invoices (
        id TEXT PRIMARY KEY,
        ci_number TEXT UNIQUE NOT NULL,
        dn_id TEXT NOT NULL UNIQUE,
        customer_id TEXT NOT NULL,
        project_id TEXT,
        amount REAL NOT NULL,
        status TEXT DEFAULT 'UNPAID', -- UNPAID, PAID
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        paid_at DATETIME,
        FOREIGN KEY (dn_id) REFERENCES delivery_notes(id),
        FOREIGN KEY (customer_id) REFERENCES customers(id),
        FOREIGN KEY (project_id) REFERENCES projects(id)
      );
    `);

    // 2.1 Human Resource Tables
    db.prepare(`
      CREATE TABLE IF NOT EXISTS hr_jobs (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        department TEXT NOT NULL,
        location TEXT DEFAULT 'Head Office',
        status TEXT CHECK(status IN ('OPEN', 'CLOSED')) DEFAULT 'OPEN',
        type TEXT DEFAULT 'Full-time',
        description TEXT NOT NULL,
        requirements TEXT,
        benefits TEXT,
        salary_string TEXT,
        pamphlet_bg_color TEXT DEFAULT '#1c1917',
        pamphlet_accent_color TEXT DEFAULT '#ca8a04',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `).run();

    db.prepare(`
      CREATE TABLE IF NOT EXISTS hr_applications (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT NOT NULL,
        linkedin_url TEXT,
        experience TEXT,
        resume_text TEXT,
        status TEXT CHECK(status IN ('APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER_MADE', 'ACCEPTED', 'REJECTED')) DEFAULT 'APPLIED',
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        notes TEXT,
        FOREIGN KEY (job_id) REFERENCES hr_jobs(id) ON DELETE CASCADE
      );
    `).run();

    db.prepare(`
      CREATE TABLE IF NOT EXISTS hr_kpis (
        id TEXT PRIMARY KEY,
        employee_username TEXT NOT NULL,
        evaluator_username TEXT NOT NULL,
        period_name TEXT NOT NULL,
        score_communication INTEGER DEFAULT 0,
        score_productivity INTEGER DEFAULT 0,
        score_reliability INTEGER DEFAULT 0,
        score_leadership INTEGER DEFAULT 0,
        score_technical INTEGER DEFAULT 0,
        overall_score REAL DEFAULT 0,
        evaluation_notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (employee_username) REFERENCES users(username),
        FOREIGN KEY (evaluator_username) REFERENCES users(username)
      );
    `).run();

    db.prepare(`
      CREATE TABLE IF NOT EXISTS finance_payroll (
        id TEXT PRIMARY KEY,
        period_name TEXT NOT NULL,
        total_amount REAL NOT NULL,
        status TEXT CHECK(status IN ('DRAFTED', 'AUTHORIZED', 'PAID')) DEFAULT 'DRAFTED',
        details_json TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        paid_at DATETIME
      );
    `).run();

    db.prepare(`
      CREATE TABLE IF NOT EXISTS hr_handovers (
        id TEXT PRIMARY KEY,
        resigning_username TEXT NOT NULL,
        successor_username TEXT NOT NULL,
        target_last_date TEXT NOT NULL,
        status TEXT CHECK(status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED')) DEFAULT 'PENDING',
        handover_notes TEXT,
        checklist_json TEXT DEFAULT '[]',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (resigning_username) REFERENCES users(username),
        FOREIGN KEY (successor_username) REFERENCES users(username)
      );
    `).run();

    db.prepare(`
      CREATE TABLE IF NOT EXISTS hr_leaves (
        id TEXT PRIMARY KEY,
        employee_username TEXT NOT NULL,
        leave_type TEXT NOT NULL, -- SICK, ANNUAL, MATERNITY, UNPAID
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        reason TEXT,
        status TEXT CHECK(status IN ('PENDING', 'APPROVED', 'REJECTED')) DEFAULT 'PENDING',
        approved_by TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (employee_username) REFERENCES users(username),
        FOREIGN KEY (approved_by) REFERENCES users(username)
      );
    `).run();

    db.prepare(`
      CREATE TABLE IF NOT EXISTS hr_payslips (
        id TEXT PRIMARY KEY,
        employee_username TEXT NOT NULL,
        period_month TEXT NOT NULL, -- YYYY-MM
        basic_salary REAL DEFAULT 0,
        allowances REAL DEFAULT 0,
        deductions REAL DEFAULT 0,
        net_salary REAL DEFAULT 0,
        status TEXT CHECK(status IN ('DRAFT', 'PUBLISHED', 'PAID')) DEFAULT 'DRAFT',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (employee_username) REFERENCES users(username)
      );
    `).run();

    db.prepare(`
      CREATE TABLE IF NOT EXISTS cms_settings (
        page TEXT PRIMARY KEY,
        content_json TEXT NOT NULL
      );
    `).run();

    // Default CMS content
    try {
      const existingCms = db.prepare("SELECT * FROM cms_settings WHERE page = 'careers'").get();
      if (!existingCms) {
        db.prepare("INSERT INTO cms_settings (page, content_json) VALUES (?, ?)").run('careers', JSON.stringify({
           hero_title: "Join Our Innovative Team",
           hero_subtitle: "Build the future with us. We are looking for passionate individuals.",
           benefits: ["Flexible Hours", "Health Insurance", "Remote Work Options", "Continuous Learning"]
        }));
      }
    } catch(e) {}

    // Create quotations, spks, and ntps tables
    db.prepare(`
      CREATE TABLE IF NOT EXISTS quotations (
        id TEXT PRIMARY KEY,
        quotation_number TEXT UNIQUE NOT NULL,
        customer_id TEXT NOT NULL,
        title TEXT NOT NULL,
        amount REAL NOT NULL,
        validity_days INTEGER DEFAULT 20,
        status TEXT DEFAULT 'APPROVED', -- APPROVED, PROCESSED, EXPIRED
        revision_note TEXT,
        tax_rate REAL DEFAULT 0,
        discount_rate REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        remarks TEXT,
        FOREIGN KEY (customer_id) REFERENCES customers(id)
      );
    `).run();

    db.prepare(`
      CREATE TABLE IF NOT EXISTS quotation_items (
        id TEXT PRIMARY KEY,
        quotation_id TEXT NOT NULL,
        title TEXT NOT NULL,
        qty REAL DEFAULT 1,
        uom TEXT DEFAULT 'Unit',
        unit_price REAL DEFAULT 0,
        revision_note TEXT,
        FOREIGN KEY (quotation_id) REFERENCES quotations(id)
      );
    `).run();

    db.prepare(`
      CREATE TABLE IF NOT EXISTS spks (
        id TEXT PRIMARY KEY,
        spk_number TEXT UNIQUE NOT NULL,
        project_id TEXT,
        quotation_id TEXT,
        title TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        status TEXT DEFAULT 'APPROVED',
        FOREIGN KEY (project_id) REFERENCES projects(id),
        FOREIGN KEY (quotation_id) REFERENCES quotations(id)
      );
    `).run();

    db.prepare(`
      CREATE TABLE IF NOT EXISTS ntps (
        id TEXT PRIMARY KEY,
        ntp_number TEXT UNIQUE NOT NULL,
        project_id TEXT NOT NULL,
        quotation_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        status TEXT DEFAULT 'ISSUED',
        FOREIGN KEY (project_id) REFERENCES projects(id),
        FOREIGN KEY (quotation_id) REFERENCES quotations(id)
      );
    `).run();

    db.prepare(`
      CREATE TABLE IF NOT EXISTS crm_leads (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        contact_info TEXT NOT NULL,
        intent TEXT,
        status TEXT DEFAULT 'NEW',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `).run();

    // Migrate existing projects table to add quotation_id, spk_id, and ntp_id columns
    try {
      db.prepare("ALTER TABLE projects ADD COLUMN quotation_id TEXT").run();
    } catch (e) {}
    try {
      db.prepare("ALTER TABLE projects ADD COLUMN spk_id TEXT").run();
    } catch (e) {}
    try {
      db.prepare("ALTER TABLE projects ADD COLUMN ntp_id TEXT").run();
    } catch (e) {}
    try {
      db.prepare("ALTER TABLE projects ADD COLUMN qty REAL DEFAULT 1").run();
    } catch (e) {}
    try {
      db.prepare("ALTER TABLE projects ADD COLUMN uom TEXT DEFAULT 'Unit'").run();
    } catch (e) {}
    try {
      db.prepare("ALTER TABLE delivery_notes ADD COLUMN police_number TEXT").run();
    } catch (e) {}
    try {
      db.prepare("ALTER TABLE delivery_notes ADD COLUMN revision_note TEXT").run();
    } catch (e) {}

    // Post-creation fallback schema checks to guarantee columns exist
    try { db.exec("ALTER TABLE purchase_requests ADD COLUMN cancelled_at DATETIME;"); } catch (e) {}
    try { db.exec("ALTER TABLE purchase_requests ADD COLUMN archived INTEGER DEFAULT 0;"); } catch (e) {}
    try { db.exec("ALTER TABLE purchase_requests ADD COLUMN urgency TEXT DEFAULT 'NORMAL';"); } catch (e) {}
    try { db.exec("ALTER TABLE purchase_requests ADD COLUMN revision_note TEXT;"); } catch (e) {}
    try { db.exec("ALTER TABLE purchase_requests ADD COLUMN remarks TEXT;"); } catch (e) {}
    try { db.exec("ALTER TABLE purchase_requests ADD COLUMN escalated_to TEXT;"); } catch (e) {}

    try { db.exec("ALTER TABLE purchase_orders ADD COLUMN cancelled_at DATETIME;"); } catch (e) {}
    try { db.exec("ALTER TABLE purchase_orders ADD COLUMN archived INTEGER DEFAULT 0;"); } catch (e) {}
    try { db.exec("ALTER TABLE purchase_orders ADD COLUMN urgency TEXT DEFAULT 'NORMAL';"); } catch (e) {}
    try { db.exec("ALTER TABLE purchase_orders ADD COLUMN revision_note TEXT;"); } catch (e) {}
    try { db.exec("ALTER TABLE purchase_orders ADD COLUMN escalated_to TEXT;"); } catch (e) {}

    try { db.exec("ALTER TABLE quotations ADD COLUMN revision_note TEXT;"); } catch (e) {}
    try { db.exec("ALTER TABLE quotations ADD COLUMN tax_rate REAL DEFAULT 0;"); } catch (e) {}
    try { db.exec("ALTER TABLE quotations ADD COLUMN discount_rate REAL DEFAULT 0;"); } catch (e) {}

    try { db.exec("ALTER TABLE quotation_items ADD COLUMN revision_note TEXT;"); } catch (e) {}
    try { db.exec("ALTER TABLE pr_items ADD COLUMN revision_note TEXT;"); } catch (e) {}

    // Workflow Rules Engine Tables
    db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_matrices (
        id TEXT PRIMARY KEY,
        document_type TEXT NOT NULL,
        min_amount REAL DEFAULT 0,
        max_amount REAL,
        roles TEXT NOT NULL,
        is_parallel INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS workflow_slas (
        id TEXT PRIMARY KEY,
        document_type TEXT NOT NULL,
        step TEXT NOT NULL,
        sla_hours REAL NOT NULL,
        escalate_to TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS workflow_audit_logs (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        changes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- Index Optimizations for SLA and Workflow
      CREATE INDEX IF NOT EXISTS idx_po_status_date ON purchase_orders(status, created_at);
      CREATE INDEX IF NOT EXISTS idx_pr_status_date ON purchase_requests(status, created_at);
      CREATE INDEX IF NOT EXISTS idx_workflow_matrices_type ON workflow_matrices(document_type);
      CREATE INDEX IF NOT EXISTS idx_workflow_slas_type ON workflow_slas(document_type);
    `);

    // 3. Seed data
    db.prepare(`
        INSERT OR IGNORE INTO projects (id, name, due_date, customer, remarks, status)
        VALUES ('GENERAL', 'General Procurement', '2099-12-31', 'Internal', 'Adhoc/General items without specific project', 'ACTIVE')
    `).run();

    // Default Workflow Seed
    db.prepare(`
      INSERT OR IGNORE INTO workflow_matrices (id, document_type, min_amount, max_amount, roles, is_parallel)
      VALUES ('MATRIX-1', 'Purchase Order', 0, 10000000, '["Procurement Manager"]', 0)
    `).run();

    db.prepare(`
      INSERT OR IGNORE INTO workflow_matrices (id, document_type, min_amount, max_amount, roles, is_parallel)
      VALUES ('MATRIX-2', 'Purchase Order', 10000000, 50000000, '["Procurement Manager", "Finance Manager"]', 0)
    `).run();

    db.prepare(`
      INSERT OR IGNORE INTO workflow_matrices (id, document_type, min_amount, max_amount, roles, is_parallel)
      VALUES ('MATRIX-3', 'Purchase Order', 50000000, NULL, '["Procurement Manager", "Finance Manager", "Director"]', 1)
    `).run();

    db.prepare(`
      INSERT OR IGNORE INTO workflow_slas (id, document_type, step, sla_hours, escalate_to)
      VALUES ('SLA-1', 'Purchase Order', 'Pending Approval', 24, 'Director')
    `).run();

    const stmt = db.prepare(`
        INSERT INTO users (id, username, password, role, level, name, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(username) DO UPDATE SET
          password = excluded.password,
          role = excluded.role,
          level = excluded.level,
          name = excluded.name,
          status = excluded.status
    `);
    stmt.run('MASTER-1', 'Eghy', 'eghyalvandi', 'FC', 'MANAGER', 'Eghy Al Vandi', 'APPROVED');
    stmt.run('MASTER-2', 'Ludy', 'bachtiarludy', 'FC', 'MANAGER', 'Bachtiar Ludy', 'APPROVED');
    stmt.run('admin', 'admin', 'admin', 'FC', 'MANAGER', 'System Admin', 'APPROVED');

    // Setup Forum Group
    const generalThreadId = 'THREAD-GENERAL';
    db.prepare(`
    INSERT OR IGNORE INTO chat_threads (id, name, is_group, created_by)
    VALUES (?, ?, 1, 'system')
    `).run(generalThreadId, 'Forum');
    
    // Migration: Update existing name to Forum
    db.prepare("UPDATE chat_threads SET name = 'Forum' WHERE id = 'THREAD-GENERAL'").run();

    // Auto-assign existing users to general discussion
    db.prepare(`
    INSERT OR IGNORE INTO chat_participants (thread_id, username)
    SELECT ?, username FROM users
    `).run(generalThreadId);

    // Create Indices
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_inventory_labels_item ON inventory_labels(item_id);
      CREATE INDEX IF NOT EXISTS idx_inventory_labels_grn ON inventory_labels(grn_id);
      CREATE INDEX IF NOT EXISTS idx_inventory_labels_project ON inventory_labels(project_id);
      CREATE INDEX IF NOT EXISTS idx_items_code ON items(item_code);
      CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
      CREATE INDEX IF NOT EXISTS idx_projects_deleted ON projects(deleted_at);
      CREATE INDEX IF NOT EXISTS idx_boms_project ON boms(project_id);
      CREATE INDEX IF NOT EXISTS idx_boms_item ON boms(item_id);
      CREATE INDEX IF NOT EXISTS idx_pr_project ON purchase_requests(project_id);
      CREATE INDEX IF NOT EXISTS idx_pr_status ON purchase_requests(status);
      CREATE INDEX IF NOT EXISTS idx_pr_items_pr ON pr_items(pr_id);
      CREATE INDEX IF NOT EXISTS idx_po_items_po ON pr_items(po_id);
      CREATE INDEX IF NOT EXISTS idx_po_status ON purchase_orders(status);
      CREATE INDEX IF NOT EXISTS idx_grns_po ON grns(po_id);
      CREATE INDEX IF NOT EXISTS idx_grn_items_grn ON grn_items(grn_id);
      CREATE INDEX IF NOT EXISTS idx_grn_items_item ON grn_items(item_id);
      CREATE INDEX IF NOT EXISTS idx_movements_item ON stock_movements(item_id);
      CREATE INDEX IF NOT EXISTS idx_movements_project ON stock_movements(project_id);
      CREATE INDEX IF NOT EXISTS idx_project_tasks_project ON project_tasks(project_id);
      CREATE INDEX IF NOT EXISTS idx_wo_project ON work_orders(project_id);
      CREATE INDEX IF NOT EXISTS idx_wo_items_wo ON work_order_items(wo_id);
      CREATE INDEX IF NOT EXISTS idx_inventory_item ON inventory(item_id);
      CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_trail(resource_type, resource_id);
      CREATE INDEX IF NOT EXISTS idx_forum_comments_post ON forum_comments(post_id);
      CREATE INDEX IF NOT EXISTS idx_project_tasks_wc ON project_tasks(work_center_id);
      CREATE INDEX IF NOT EXISTS idx_chat_messages_thread ON chat_messages(thread_id);
      CREATE INDEX IF NOT EXISTS idx_chat_participants_username ON chat_participants(username);
      CREATE INDEX IF NOT EXISTS idx_item_price_history ON item_price_history(item_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
      CREATE INDEX IF NOT EXISTS idx_bom_template_items_template ON bom_template_items(template_id);
      CREATE INDEX IF NOT EXISTS idx_bom_template_items_item ON bom_template_items(item_id);
    `);
  })();

  seedDummyData(db);

  // Re-enable foreign keys
  db.pragma('foreign_keys = ON');
}

// Factory Reset Helper
export function resetFactoryData() {
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      // Delete data from all tables except users and the general project
      // We also preserve the THREAD-GENERAL chat
      
      // 1. Wipe all users except standard accounts
      db.prepare("DELETE FROM users WHERE LOWER(username) NOT IN ('eghy', 'ludy', 'admin')").run();

      // Clear transactional sales & deliveries & billing & contracting data
      try { db.prepare("DELETE FROM ntps").run(); } catch(e) {}
      try { db.prepare("DELETE FROM spks").run(); } catch(e) {}
      try { db.prepare("DELETE FROM quotation_items").run(); } catch(e) {}
      try { db.prepare("DELETE FROM quotations").run(); } catch(e) {}
      try { db.prepare("DELETE FROM commercial_invoices").run(); } catch(e) {}
      try { db.prepare("DELETE FROM dn_signatures").run(); } catch(e) {}
      try { db.prepare("DELETE FROM delivery_items").run(); } catch(e) {}
      try { db.prepare("DELETE FROM delivery_notes").run(); } catch(e) {}
      try { db.prepare("DELETE FROM customers").run(); } catch(e) {}
      try { db.prepare("DELETE FROM bank_accounts").run(); } catch(e) {}

      // 2. Clear transactional procurement & production & movements data
      db.prepare("DELETE FROM stock_movements").run();
      db.prepare("DELETE FROM grn_items").run();
      db.prepare("DELETE FROM grns").run();
      db.prepare("DELETE FROM pr_items").run();
      db.prepare("DELETE FROM purchase_orders").run();
      db.prepare("DELETE FROM purchase_requests").run();
      db.prepare("DELETE FROM work_order_items").run();
      db.prepare("DELETE FROM work_orders").run();
      db.prepare("DELETE FROM bom_item_consumption").run();
      db.prepare("DELETE FROM boms").run();
      
      // 3. Clear project data (keeping GENERAL)
      db.prepare("DELETE FROM project_tasks WHERE project_id != 'GENERAL'").run();
      db.prepare("DELETE FROM projects WHERE id != 'GENERAL'").run();
      
      // 4. Clear master data
      try { db.prepare("DELETE FROM item_supplier_prices").run(); } catch(e) {}
      db.prepare("DELETE FROM item_price_history").run();
      db.prepare("DELETE FROM inventory_labels").run();
      db.prepare("DELETE FROM inventory").run();
      db.prepare("DELETE FROM items").run();
      db.prepare("DELETE FROM suppliers").run();
      db.prepare("DELETE FROM bom_template_items").run();
      db.prepare("DELETE FROM bom_templates").run();
      db.prepare("DELETE FROM work_centers").run();
      
      // 5. Clear Social/Forum data (keeping GENERAL thread)
      db.prepare("DELETE FROM chat_messages").run();
      db.prepare("DELETE FROM chat_participants WHERE thread_id != 'THREAD-GENERAL'").run();
      db.prepare("DELETE FROM chat_threads WHERE id != 'THREAD-GENERAL'").run();
      db.prepare("DELETE FROM forum_comments").run();
      db.prepare("DELETE FROM forum_posts").run();
      db.prepare("DELETE FROM user_drafts").run();
      db.prepare("DELETE FROM audit_trail").run();

      // 5.1. Clear HRIS and Human Resource Data
      try { db.prepare("DELETE FROM attendance_db.hr_attendances").run(); } catch(e) {}
      try { db.prepare("DELETE FROM hr_jobs").run(); } catch(e) {}
      try { db.prepare("DELETE FROM hr_applications").run(); } catch(e) {}
      try { db.prepare("DELETE FROM hr_kpis").run(); } catch(e) {}
      try { db.prepare("DELETE FROM finance_payroll").run(); } catch(e) {}
      try { db.prepare("DELETE FROM hr_handovers").run(); } catch(e) {}
      try { db.prepare("DELETE FROM hr_leaves").run(); } catch(e) {}
      try { db.prepare("DELETE FROM hr_payslips").run(); } catch(e) {}
      try { db.prepare("DELETE FROM cms_settings").run(); } catch(e) {}
      try {
        db.prepare("INSERT INTO cms_settings (page, content_json) VALUES (?, ?)").run('careers', JSON.stringify({
           hero_title: "Join Our Innovative Team",
           hero_subtitle: "Build the future with us. We are looking for passionate individuals.",
           benefits: ["Flexible Hours", "Health Insurance", "Remote Work Options", "Continuous Learning"]
        }));
      } catch(e) {}
      
      // 6. Re-initialize minimal state
      db.prepare(`
          INSERT OR IGNORE INTO projects (id, name, due_date, customer, remarks, status)
          VALUES ('GENERAL', 'General Procurement', '2099-12-31', 'Internal', 'Adhoc/General items without specific project', 'ACTIVE')
      `).run();

      const generalThreadId = 'THREAD-GENERAL';
      db.prepare(`
        INSERT OR IGNORE INTO chat_threads (id, name, is_group, created_by)
        VALUES (?, ?, 1, 'system')
      `).run(generalThreadId, 'Forum');

      db.prepare(`
        INSERT OR IGNORE INTO chat_participants (thread_id, username)
        SELECT ?, username FROM users
      `).run(generalThreadId);

      db.prepare(`
          INSERT OR IGNORE INTO inventory (item_id, free_stock, allocated_stock)
          SELECT id, 0, 0 FROM items
      `).run();

      try {
        db.prepare(`
            INSERT OR IGNORE INTO bank_accounts (id, bank_name, account_number, account_holder, branch)
            VALUES ('BNK-DEFAULT', 'BANK MANDIRI', '1240009876543', 'CV BATU EMAS GROUP', 'Sudirman Jakarta')
        `).run();
      } catch (err) {}
      
      console.log("Factory reset completed successfully.");
    })();

    seedDummyData(db);

  } finally {
    db.pragma('foreign_keys = ON');
  }
}

export function resetHrData() {
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      // Clear HRIS and Human Resource Data
      try { db.prepare("DELETE FROM attendance_db.hr_attendances").run(); } catch(e) {}
      try { db.prepare("DELETE FROM hr_jobs").run(); } catch(e) {}
      try { db.prepare("DELETE FROM hr_applications").run(); } catch(e) {}
      try { db.prepare("DELETE FROM hr_kpis").run(); } catch(e) {}
      try { db.prepare("DELETE FROM finance_payroll").run(); } catch(e) {}
      try { db.prepare("DELETE FROM hr_handovers").run(); } catch(e) {}
      try { db.prepare("DELETE FROM hr_leaves").run(); } catch(e) {}
      try { db.prepare("DELETE FROM hr_payslips").run(); } catch(e) {}
      try { db.prepare("DELETE FROM cms_settings").run(); } catch(e) {}
      try {
        db.prepare("INSERT INTO cms_settings (page, content_json) VALUES (?, ?)").run('careers', JSON.stringify({
           hero_title: "Join Our Innovative Team",
           hero_subtitle: "Build the future with us. We are looking for passionate individuals.",
           benefits: ["Flexible Hours", "Health Insurance", "Remote Work Options", "Continuous Learning"]
        }));
      } catch(e) {}
    })();

    // Re-seed HR Dummy Data
    try {
      db.prepare(`
         INSERT OR IGNORE INTO hr_jobs (id, title, department, location, type, description, requirements, benefits, salary_string, pamphlet_bg_color, pamphlet_accent_color)
         VALUES 
         ('JOB-001', 'Production Engineer', 'Production', 'Sidoarjo Factory', 'Full-time', 'Responsible for supervising production lines, conducting QA, and maximizing machinery efficiency Index.', '["Minimal S1 Teknik Mesin/Industri", "Pengalaman 2 tahun di bidang manufacturing", "Dapat membaca flowchart & CAD drawing", "Disiplin dan bertanggung jawab"]', '["Gaji Pokok Kompetitif", "BPJS Kesehatan & Ketenagakerjaan", "Mes Karyawan / Tunjangan Transport", "Bonus Kinerja Akhir Tahun"]', 'Rp 7.000.000 - Rp 9.500.000', '#1c1917', '#ca8a04'),
         ('JOB-002', 'Warehouse Crew', 'Warehouse', 'Surabaya Central Depot', 'Full-time', 'Manages physical materials inventory, counts stocks, and prepares finished goods shipping packages.', '["Minimal SMA/K sederajat", "Sehat jasmani dan rohani", "Nilai tambah jika bisa mengendarai Forklift", "Terbiasa kerja mandiri dan tim"]', '["Uang harian & makan", "Pakaian keselamatan kerja", "Bonus lemburan", "Asuransi kecelakaan"]', 'Rp 4.500.000 - Rp 5.500.000', '#0b0f19', '#2563eb')
      `).run();
      db.prepare(`
         INSERT OR IGNORE INTO hr_applications (id, job_id, name, email, phone, linkedin_url, experience, resume_text, status, notes)
         VALUES 
         ('APP-001', 'JOB-001', 'Ahmad Dhani', 'dhani@example.com', '081299998888', 'linkedin.com/in/dhani', '3 Tahun', 'Saya sangat tertarik dengan posisi Production Engineer karena memiliki latar belakang manufaktur mesin berat di Jawa Timur selama 3 tahun.', 'INTERVIEW', 'Bahasa Inggris aktif, komunikasi taktis dan sangat menguasai basic machinery.'),
         ('APP-002', 'JOB-002', 'Budi Santoso', 'budi@example.com', '087711223344', '', '6 Bulan', 'Saya berpengalaman dalam mengepak barang dan mengecek surat jalan pengiriman Logistik.', 'APPLIED', 'CV terlampir, butuh konfirmasi jadwal walkthrough warehouse.')
      `).run();
      db.prepare(`
         INSERT OR IGNORE INTO hr_kpis (id, employee_username, evaluator_username, period_name, score_communication, score_productivity, score_reliability, score_leadership, score_technical, overall_score, evaluation_notes)
         VALUES
         ('KPI-001', 'Eghy', 'admin', 'Q1 2026', 90, 95, 92, 88, 90, 91.0, 'Kinerja luar biasa dalam mengawal pbac dan pendelegasian otorisasi user.'),
         ('KPI-002', 'Ludy', 'admin', 'Q1 2026', 85, 88, 90, 85, 87, 87.0, 'Konsistensi tinggi pada operasional inventaris barang masuk.')
      `).run();
      db.prepare(`
         INSERT OR IGNORE INTO hr_handovers (id, resigning_username, successor_username, target_last_date, status, handover_notes, checklist_json)
         VALUES
         ('HO-001', 'Ludy', 'Eghy', '2026-06-30', 'IN_PROGRESS', 'Handover kendali inventori gudang utama sehubungan masa transisi penempatan divisi baru.', '[{"id":"1","title":"SOP Logistik dan Gudang","status":"COMPLETED"},{"id":"2","title":"Kredensial Login CMS","status":"PENDING"},{"id":"3","title":"Akses Fisik Brankas Dokumen Jalan","status":"PENDING"}]')
      `).run();
    } catch(e) {}
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

export default db;
