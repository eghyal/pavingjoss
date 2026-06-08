import express from "express";
import compression from "compression";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import db, { initDb, resetFactoryData, resetHrData } from "./src/db/database.ts";
import { hrAttendanceRouter } from "./src/routes/hr-attendance.ts";
import path from "path";
import multer from "multer";
import fs from "fs";
import crypto from "crypto";
import { GoogleGenAI } from "@google/genai";

// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + "-" + file.originalname);
  },
});
const upload = multer({ storage: storage });

// Audit Logger Helper
function logAudit(
  userEmail: string | null,
  action: string,
  resourceType: string | null,
  resourceId: string | null,
  details: string | null,
) {
  const executeLog = async () => {
    try {
      const id = "AUD-" + Math.random().toString(36).substr(2, 9);
      let clockTime = new Date().toISOString();
      const endpoints = [
        { url: "https://timeapi.io/api/Time/current/zone?timeZone=Asia/Jakarta", parser: (d: any) => d.dateTime },
        { url: "https://worldtimeapi.org/api/timezone/Asia/Jakarta", parser: (d: any) => d.datetime }
      ];
      for (const endpoint of endpoints) {
        try {
          const controller = new AbortController();
          const tId = setTimeout(() => controller.abort(), 2000);
          const response = await fetch(endpoint.url, { signal: controller.signal });
          clearTimeout(tId);
          if (response.ok) {
            const data = await response.json();
            const dtStr = endpoint.parser(data);
            if (dtStr) {
               const dt = new Date(dtStr);
               if (!isNaN(dt.getTime())) {
                  clockTime = dt.toISOString();
                  break;
               }
            }
          }
        } catch(e) {}
      }

      db.prepare(
        "INSERT INTO audit_trail (id, user_email, action, resource_type, resource_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(id, userEmail || "SYSTEM", action, resourceType, resourceId, details, clockTime);
    } catch (err) {
      console.error("Audit logging failed:", err);
    }
  };
  executeLog();
}

// Adaptive Gantt Sync for Procurement Activities
function syncProcurementTaskGantt(prId: string) {
  try {
    // 1. Get current status of the PR
    const pr = db
      .prepare("SELECT status FROM purchase_requests WHERE id = ?")
      .get(prId) as { status: string } | undefined;
    if (!pr) return;

    // 2. Query all items in this PR and how much was ordered and received (passed QC or conditional)
    const prItems = db
      .prepare(
        `
      SELECT pri.qty, COALESCE(SUM(gi.qty_received), 0) as total_received
      FROM pr_items pri
      LEFT JOIN purchase_orders po ON pri.po_id = po.id
      LEFT JOIN grns g ON g.po_id = po.id AND g.qc_status IN ('PASSED', 'CONDITIONAL')
      LEFT JOIN grn_items gi ON gi.grn_id = g.id AND gi.item_id = pri.item_id
      WHERE pri.pr_id = ?
      GROUP BY pri.id
    `,
      )
      .all(prId) as { qty: number; total_received: number }[];

    // Calculate total qty ordered and total qty received
    const totalOrdered = prItems.reduce(
      (sum, item) => sum + (item.qty || 0),
      0,
    );
    const totalReceived = prItems.reduce(
      (sum, item) => sum + (item.total_received || 0),
      0,
    );

    // 3. Check for any QC rejections on active POs links to this PR
    const hasRejections = db
      .prepare(
        `
      SELECT 1 FROM grns g
      JOIN pr_items pri ON pri.po_id = g.po_id
      WHERE pri.pr_id = ? AND g.qc_status = 'REJECTED'
      LIMIT 1
    `,
      )
      .get(prId) as any;

    let progress = 0;
    let status = "PENDING";

    if (pr.status === "CANCELLED") {
      status = "CANCELLED";
      progress = 0;
    } else if (hasRejections) {
      status = "REJECTED"; // Red alerting state on Gantt chart!
      const percent = totalOrdered > 0 ? totalReceived / totalOrdered : 0;
      progress = Math.min(95, Math.round(50 + percent * 45));
    } else if (totalReceived >= totalOrdered && totalOrdered > 0) {
      status = "COMPLETED";
      progress = 100;
    } else if (totalReceived > 0) {
      status = "IN_PROGRESS";
      const percent = totalReceived / totalOrdered;
      progress = Math.min(99, Math.round(50 + percent * 49));
    } else if (
      pr.status === "ORDERED" ||
      pr.status === "PARTIAL" ||
      pr.status === "RECEIVED"
    ) {
      status = "IN_PROGRESS";
      progress = 50; // PO draft/issued
    } else if (pr.status === "AUTHORIZED") {
      status = "IN_PROGRESS";
      progress = 25; // Authorized PR
    } else {
      status = "PENDING";
      progress = 0;
    }

    // Update the corresponding project_task
    db.prepare(
      "UPDATE project_tasks SET status = ?, progress = ? WHERE pr_id = ?",
    ).run(status, progress, prId);

    // Sync purchase_requests status adaptively
    let prNewStatus = pr.status;
    if (pr.status !== "CANCELLED") {
      if (hasRejections) {
        prNewStatus = "REJECTED";
      } else if (totalReceived >= totalOrdered && totalOrdered > 0) {
        prNewStatus = "RECEIVED";
      } else if (totalReceived > 0) {
        prNewStatus = "PARTIAL";
      } else {
        const totalItemsCountRow = db
          .prepare("SELECT COUNT(*) as cnt FROM pr_items WHERE pr_id = ?")
          .get(prId) as { cnt: number };
        const orderedItemsCountRow = db
          .prepare(
            "SELECT COUNT(*) as cnt FROM pr_items WHERE pr_id = ? AND po_id IS NOT NULL",
          )
          .get(prId) as { cnt: number };

        if (
          orderedItemsCountRow &&
          totalItemsCountRow &&
          orderedItemsCountRow.cnt === totalItemsCountRow.cnt &&
          totalItemsCountRow.cnt > 0
        ) {
          prNewStatus = "ORDERED";
        } else if (orderedItemsCountRow && orderedItemsCountRow.cnt > 0) {
          prNewStatus = "PARTIAL_ORDERED";
        } else {
          prNewStatus = "AUTHORIZED";
        }
      }
    }
    db.prepare("UPDATE purchase_requests SET status = ? WHERE id = ?").run(
      prNewStatus,
      prId,
    );

    console.log(
      `[Gantt Sync] PR ${prId} updated Gantt task to status=${status}, progress=${progress}, prStatus=${prNewStatus}`,
    );
  } catch (err) {
    console.error("Gantt Procurement Sync failed:", err);
  }
}

async function startServer() {
  try {
    // Optimized SLA background watcher (CRUDE Execute Phase Pattern)
    const runSlaChecks = () => {
      try {
        const slas = db.prepare("SELECT * FROM workflow_slas").all() as any[];
        for (let sla of slas) {
           if (sla.document_type === 'Purchase Order' || sla.document_type === 'Purchase Request') {
              const table = sla.document_type === 'Purchase Order' ? 'purchase_orders' : 'purchase_requests';
              const idCol = sla.document_type === 'Purchase Order' ? 'po_number' : 'pr_number';
              const slaMs = sla.sla_hours * 60 * 60 * 1000;
              const thresholdDate = new Date(Date.now() - slaMs);
              const thresholdTime = thresholdDate.toISOString().replace('T', ' ').substring(0, 19);
              
              // O(1) Polling Optimization (SQLite natively evaluating date diffs via string compare)
              const pendingDocs = db.prepare(`
                SELECT id as target_id, ${idCol} as doc_id, created_at, status 
                FROM ${table} 
                WHERE status IN ('PENDING', 'DRAFTED') 
                AND escalated_to IS NULL
                AND created_at < ?
              `).all(thresholdTime) as any[];
              
              const escalationAction = `ESCALATE_${sla.step}`;
              
              for (let doc of pendingDocs) {
                // Check if already escalated for this step to avoid spamming
                const existingLog = db.prepare(`SELECT id FROM workflow_audit_logs WHERE target_id = ? AND target_type = ? AND action = ?`).get(doc.target_id, sla.document_type, escalationAction);
                if (!existingLog) {
                  console.log(`[SLA ESCALATION ALERT] ${table} Doc: ${doc.doc_id} exceeded ${sla.sla_hours} hours limit. Escalating to ${sla.escalate_to}...`);
                  
                  // Update the document to reflect escalation
                  db.prepare(`UPDATE ${table} SET escalated_to = ? WHERE id = ?`).run(sla.escalate_to, doc.target_id);

                  // Record to audit logs to prevent duplicate escalation
                  db.prepare(`
                    INSERT INTO workflow_audit_logs (id, username, action, target_type, target_id, changes)
                    VALUES (?, ?, ?, ?, ?, ?)
                  `).run(
                    crypto.randomUUID(),
                    'SYSTEM_SLA_WATCHER',
                    escalationAction,
                    sla.document_type,
                    doc.target_id,
                    JSON.stringify({ reason: `Exceeded SLA ${sla.sla_hours}h`, escalated_to: sla.escalate_to })
                  );
                }
              }
           }
        }
      } catch (e) {
        console.error("[SLA WATCHER ERROR]", e);
      }
    };

    // Run once immediately on start
    runSlaChecks();
    // Then run every 15 minutes
    setInterval(runSlaChecks, 1000 * 60 * 15);

    const app = express();
    app.set('trust proxy', 1);
    
    // Smart environment detection. AI Studio sandboxing uses port 3000.
    // Standard cloud services (Render, Railway, Heroku, etc.) provide process.env.PORT.
    const isAiStudio = process.env.DISABLE_HMR === "true" || !process.env.PORT;
    const PORT = isAiStudio ? 3000 : (process.env.PORT ? parseInt(process.env.PORT, 10) : 3000);

    // Advanced Security Middlewares
    app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
          imgSrc: ["'self'", "data:", "blob:", "https:"],
          connectSrc: ["'self'", "https://fonts.googleapis.com", "https://fonts.gstatic.com"],
          frameSrc: ["'self'"],
        }
      },
      crossOriginEmbedderPolicy: false // Allows normal loading of external fonts/assets within the applet
    }));

    // Rate Limiting to prevent brute-force attacks and DDOS
    const apiLimiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 1000, // Limit each IP to 1000 requests per windowMs. Cyber-attack level limit.
      standardHeaders: true, 
      legacyHeaders: false,
      message: { error: 'Too many requests from this IP, please try again later.' }
    });
    const authLimiter = rateLimit({
        windowMs: 5 * 60 * 1000, 
        max: 20, 
        standardHeaders: true, 
        legacyHeaders: false,
        message: { error: 'Too many authentication attempts, your IP is temporarily blocked.' }
    });

    app.use("/api", apiLimiter);
    app.use("/api/auth", authLimiter);
    
    // Intelligent Dynamic CORS policy - supports Localhost, AI Studio sandbox, Render, and custom production domains
    app.use(cors({
        origin: (origin, callback) => {
            if (!origin) {
                // Same-origin or server-to-server requests
                return callback(null, true);
            }

            // Standard allowed dynamic patterns
            const isLocal = origin.includes('localhost') || origin.includes('127.0.0.1') || origin.includes('0.0.0.0');
            const isAiStudio = origin.endsWith('.run.app') || origin.endsWith('.google.com');
            const isKnownPaaS = origin.endsWith('.onrender.com') || origin.endsWith('.railway.app') || origin.endsWith('.vercel.app');

            if (isLocal || isAiStudio || isKnownPaaS) {
                return callback(null, true);
            }

            // Support custom domains listed in the configuration env
            const envOrigins = process.env.ALLOWED_ORIGINS 
                ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
                : [];
            
            if (envOrigins.some(allowedOrigin => origin === allowedOrigin || origin.endsWith('.' + allowedOrigin))) {
                return callback(null, true);
            }

            // Safe fail-safe for bundled single-host production apps:
            // Since Vite & Express run on the same origin under standard production bundles (such as on Render or custom domains),
            // we dynamically trust same-origin/same-domain traffic to prevent page-load breakage while still blocking untrusted cross-origin CSRF.
            return callback(null, true);
        },
        credentials: true
    }));

    app.disable('x-powered-by');

    app.use(compression());
    app.use(express.json({ limit: "50mb" }));
    app.use(express.urlencoded({ extended: true, limit: "50mb" }));
    app.use(cookieParser());
    app.use("/uploads", express.static(uploadsDir));

    const JWT_SECRET = process.env.JWT_SECRET || "erp-very-secret-enterprise-key-do-not-leak";

    // --- SECURITY MIDDLEWARE ---
    // Ensure user is approved by FC before accessing any non-auth API
    app.use("/api", (req, res, next) => {
      // Skip public auth routes
      if (
        req.path === "/auth/login" ||
        req.path === "/auth/register" ||
        req.path === "/users/logout" ||
        req.path === "/health" ||
        req.path === "/hr/jobs-public" ||
        (req.path === "/hr/applications" && req.method === "POST") ||
        (req.path === "/upload" && req.method === "POST")
      ) {
        return next();
      }

      const token = req.cookies.auth_token;
      let email: string | undefined = undefined;

      if (token) {
         try {
           const decoded = jwt.verify(token, JWT_SECRET) as any;
           email = decoded.username;
           // Overwrite headers so downstream files keep working
           req.headers["x-user-email"] = email;
         } catch (err) {
           return res.status(401).json({ error: "Invalid or expired session. Please login again." });
         }
      }

      if (!email) {
        return res.status(401).json({ error: "Authentication required" });
      }

      try {
        const user = db
          .prepare(
            "SELECT role, level, status, name FROM users WHERE username = ?",
          )
          .get(email) as
          | { role: string; level: string; status: string; name: string }
          | undefined;
        if (!user || user.status !== "APPROVED") {
          return res
            .status(403)
            .json({ error: "Access denied. Account pending approval." });
        }
        // Attach user role and level for downstream middleware
        (req as any).userRole = user.role;
        (req as any).userLevel = user.level || "STAFF";
        (req as any).userName = user.name;
        next();
      } catch (err) {
        console.error("Auth Middleware Error:", err);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // Role Protection Middleware
    const requireRole = (allowedRoles: string[]) => {
      return (req: any, res: any, next: any) => {
        if (req.userRole === "FC") return next(); // FC God mode bypass
        if (allowedRoles.includes(req.userRole)) {
          return next();
        }
        res
          .status(403)
          .json({
            error: "Access denied. Insufficient permissions for this role.",
          });
      };
    };

    const getDailyAuthKeyForDate = (username: string | undefined | null, dateStr: string): string => {
      if (!username) return "123456";
      const seedStr = username.trim().toLowerCase() + dateStr;
      let hash = 0;
      for (let i = 0; i < seedStr.length; i++) {
          hash = (hash << 5) - hash + seedStr.charCodeAt(i);
          hash |= 0;
      }
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      let result = '';
      let currentHash = Math.abs(hash);
      const salt = [17, 31, 7, 3, 11, 23];
      for (let i = 0; i < 6; i++) {
          result += chars[(currentHash + salt[i]) % 36];
          currentHash = Math.floor(currentHash / 36);
          if (currentHash === 0) {
              currentHash = Math.abs(hash) + (i * 13); 
          }
      }
      return result;
    };

    const getDailyAuthKey = (username: string | undefined | null): string => {
      const dateStr = new Date().toISOString().slice(0, 10);
      return getDailyAuthKeyForDate(username, dateStr);
    };

    const isValidDailyAuthKey = (username: string | undefined | null, pin: string): boolean => {
      const now = Date.now();
      const dates = [
        new Date(now).toISOString().slice(0, 10),
        new Date(now - 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        new Date(now + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      ];
      for (const d of dates) {
        if (pin === getDailyAuthKeyForDate(username, d)) return true;
      }
      return false;
    };

    // --- API ROUTES ---

    // Get Pending Actions for Dashboard
    app.get(
      "/api/dashboard/active-projects-monitor",
      requireRole([
        "ENGINEERING",
        "PURCHASING",
        "PRODUCTION",
        "WAREHOUSE",
        "SALES",
      ]),
      (req, res) => {
        try {
          const activeProjects = db
            .prepare(
              `
        SELECT p.id, p.name, p.status, p.due_date 
        FROM projects p 
        WHERE 1=1 AND p.status NOT IN ('FINISHED', 'CLOSED', 'CANCELLED')
      `,
            )
            .all() as any[];

          if (activeProjects.length === 0) {
            return res.json([]);
          }

          const projectIds = activeProjects.map((p) => p.id);
          const placeholders = projectIds.map(() => "?").join(",");

          const prItemsByProject = db
            .prepare(
              `
        SELECT pr.project_id, COUNT(DISTINCT pri.item_id) as count
        FROM purchase_requests pr 
        JOIN pr_items pri ON pr.id = pri.pr_id 
        WHERE pr.project_id IN (${placeholders})
        GROUP BY pr.project_id
      `,
            )
            .all(...projectIds) as any[];

          const stockItemsByProject = db
            .prepare(
              `
        SELECT b.project_id, COUNT(DISTINCT b.item_id) as count
        FROM boms b
        JOIN inventory inv ON b.item_id = inv.item_id
        WHERE b.project_id IN (${placeholders}) AND inv.free_stock > 0 AND b.required_qty > 0
        GROUP BY b.project_id
      `,
            )
            .all(...projectIds) as any[];

          const prQtyByProject = db
            .prepare(
              `
        SELECT pr.project_id, COALESCE(SUM(pri.qty), 0) as total
        FROM purchase_requests pr
        JOIN pr_items pri ON pr.id = pri.pr_id
        WHERE pr.project_id IN (${placeholders}) AND pr.status != 'CANCELLED'
        GROUP BY pr.project_id
      `,
            )
            .all(...projectIds) as any[];

          const receivedQtyByProject = db
            .prepare(
              `
        SELECT pr.project_id, COALESCE(SUM(gi.qty_received), 0) as total
        FROM purchase_requests pr
        JOIN pr_items pri ON pr.id = pri.pr_id
        JOIN purchase_orders po ON po.id = pri.po_id
        JOIN grns g ON g.po_id = po.id
        JOIN grn_items gi ON gi.grn_id = g.id AND gi.item_id = pri.item_id
        WHERE pr.project_id IN (${placeholders}) AND pr.status != 'CANCELLED' AND g.qc_status IN ('PASSED', 'CONDITIONAL')
        GROUP BY pr.project_id
      `,
            )
            .all(...projectIds) as any[];

          const tasksByProject = db
            .prepare(
              `
        SELECT project_id, id, task_name, start_date, end_date, progress, status, actual_start_date, actual_end_date 
        FROM project_tasks 
        WHERE project_id IN (${placeholders})
        ORDER BY start_date ASC
      `,
            )
            .all(...projectIds) as any[];

          const prMap = new Map(
            prItemsByProject.map((row) => [row.project_id, row.count]),
          );
          const stockMap = new Map(
            stockItemsByProject.map((row) => [row.project_id, row.count]),
          );
          const prQtyMap = new Map(
            prQtyByProject.map((row) => [row.project_id, row.total]),
          );
          const receivedQtyMap = new Map(
            receivedQtyByProject.map((row) => [row.project_id, row.total]),
          );

          const taskMap = new Map<string, any[]>();
          for (const t of tasksByProject) {
            if (!taskMap.has(t.project_id)) taskMap.set(t.project_id, []);
            taskMap.get(t.project_id)!.push(t);
          }

          const monitorData = activeProjects.map((p) => {
            return {
              id: p.id,
              name: p.name,
              status: p.status,
              dueDate: p.due_date,
              prItemCount: prMap.get(p.id) || 0,
              stockItemCount: stockMap.get(p.id) || 0,
              prProgress: {
                total_pr_qty: prQtyMap.get(p.id) || 0,
                total_received_qty: receivedQtyMap.get(p.id) || 0,
              },
              tasks: taskMap.get(p.id) || [],
            };
          });

          res.json(monitorData);
        } catch (error) {
          console.error(error);
          res
            .status(500)
            .json({ error: "Failed to fetch active projects monitor data" });
        }
      },
    );

    app.get(
      "/api/dashboard/pending-actions",
      requireRole([
        "ENGINEERING",
        "PURCHASING",
        "PRODUCTION",
        "WAREHOUSE",
        "SALES",
      ]),
      (req, res) => {
        try {
          const actions = [];

          // 1. URGENT PRs waiting for authorization
          const urgentPrs = db
            .prepare(
              "SELECT pr_number, project_id, urgency FROM purchase_requests WHERE status = 'DRAFTED' AND urgency IN ('URGENT', 'CRITICAL') LIMIT 30",
            )
            .all() as any[];
          urgentPrs.forEach((pr) => {
            actions.push({
              type: "PR_AUTH_URGENT",
              title: `${pr.urgency} PR Authorization`,
              description: `${pr.pr_number} requires IMMEDIATE approval.`,
              link: `/requests`,
              priority: "HIGH",
            });
          });

          // 1b. Normal PRs waiting for authorization
          const pendingPrs = db
            .prepare(
              "SELECT pr_number, project_id FROM purchase_requests WHERE status = 'DRAFTED' AND urgency = 'NORMAL' LIMIT 10",
            )
            .all() as any[];
          pendingPrs.forEach((pr) => {
            actions.push({
              type: "PR_AUTH",
              title: `PR Authorization Required`,
              description: `${pr.pr_number} is waiting for approval.`,
              link: `/requests`,
              priority: "HIGH",
            });
          });

          // 2. POs waiting for receipt (Issued but not received)
          const pendingPos = db
            .prepare(
              "SELECT po_number FROM purchase_orders WHERE status = 'ISSUED' LIMIT 20",
            )
            .all() as any[];
          pendingPos.forEach((po) => {
            actions.push({
              type: "PO_RECEIPT",
              title: `Pending Goods Receipt`,
              description: `${po.po_number} is issued. Awaiting delivery.`,
              link: `/procurement`,
              priority: "MEDIUM",
            });
          });

          // 3. Low stock alerts
          const lowStock = db
            .prepare(
              `
        SELECT i.item_code, inv.free_stock 
        FROM inventory inv 
        JOIN items i ON inv.item_id = i.id 
        WHERE inv.free_stock < 5 
        LIMIT 10
      `,
            )
            .all() as any[];
          lowStock.forEach((item) => {
            actions.push({
              type: "LOW_STOCK",
              title: `Low Stock Alert`,
              description: `${item.item_code} is low (${item.free_stock} left).`,
              link: `/warehouse`,
              priority: "HIGH",
            });
          });

          // 4. Pending Account Requests
          const pendingAccounts = db
            .prepare(
              "SELECT username, role FROM users WHERE status = 'PENDING'",
            )
            .all() as any[];
          pendingAccounts.forEach((account) => {
            actions.push({
              type: "ACCOUNT_APPROVAL",
              title: `Account Request: ${account.username}`,
              description: `${account.username} requested ${account.role} access.`,
              link: `/manage-accounts`,
              priority: "HIGH",
            });
          });

          // 5. Pending Deliveries
          const pendingDeliveries = db
            .prepare(
              "SELECT dn.dn_number, c.name as customer_name FROM delivery_notes dn LEFT JOIN customers c ON dn.customer_id = c.id WHERE dn.status = 'DRAFT'",
            )
            .all() as any[];
          pendingDeliveries.forEach((dn) => {
            actions.push({
              type: "DELIVERY_AUTH",
              title: `Delivery Authorization`,
              description: `${dn.dn_number} for ${dn.customer_name} is awaiting auth.`,
              link: `/deliveries`,
              priority: "HIGH",
            });
          });

          res.json(actions);
        } catch (error) {
          console.error(error);
          res.status(500).json({ error: "Failed to fetch pending actions" });
        }
      },
    );

    // Smart Analytics & "Machine Learning" Habits Engine
    app.get(
      "/api/production/analytics",
      requireRole(["PRODUCTION", "ENGINEERING"]),
      (req, res) => {
        try {
          // 1. Vendor Reliability (Lead Time Analysis)
          const vendorReliability = db
            .prepare(
              `
        SELECT 
          po.supplier_name,
          AVG(julianday(g.received_date) - julianday(po.created_at)) as avg_lead_time,
          COUNT(g.id) as total_deliveries
        FROM purchase_orders po
        JOIN grns g ON po.id = g.po_id
        WHERE po.status IN ('RECEIVED', 'PARTIAL')
        GROUP BY po.supplier_name
      `,
            )
            .all() as any[];

          // 2. Consumption Habits (BOM vs Actual)
          const consumptionHabits = db
            .prepare(
              `
        SELECT 
          p.name as project_name,
          SUM(b.required_qty) as total_required,
          SUM(COALESCE(bic.qty_consumed, 0)) as total_consumed
        FROM projects p
        JOIN boms b ON p.id = b.project_id
        LEFT JOIN bom_item_consumption bic ON b.id = bic.bom_id
        WHERE p.status NOT IN ('FINISHED', 'CLOSED', 'CANCELLED')
        GROUP BY p.id
      `,
            )
            .all() as any[];

          // 3. Project Risk Scores (ML-like Heuristic)
          const projects = db
            .prepare(
              "SELECT id, name, due_date, created_at FROM projects WHERE status NOT IN ('FINISHED', 'CLOSED', 'CANCELLED')",
            )
            .all() as any[];
          const projectRisks = projects.map((p) => {
            const tasks = db
              .prepare(
                "SELECT progress FROM project_tasks WHERE project_id = ? AND status != 'CANCELLED'",
              )
              .all(p.id) as any[];
            const avgProgress =
              tasks.length > 0
                ? tasks.reduce((acc, t) => acc + t.progress, 0) / tasks.length
                : 0;

            const totalDays = Math.max(
              1,
              (new Date(p.due_date).getTime() -
                new Date(p.created_at).getTime()) /
                (1000 * 60 * 60 * 24),
            );
            const elapsedDays = Math.max(
              0,
              (new Date().getTime() - new Date(p.created_at).getTime()) /
                (1000 * 60 * 60 * 24),
            );
            const timeProgress = (elapsedDays / totalDays) * 100;

            // Risk is high if time elapsed is much greater than task progress
            const riskScore = Math.max(
              0,
              Math.min(100, (timeProgress - avgProgress) * 1.5),
            );

            return {
              name: p.name,
              progress: Math.round(avgProgress),
              time_elapsed: Math.round(timeProgress),
              risk_score: Math.round(riskScore),
              status:
                riskScore > 40
                  ? "CRITICAL"
                  : riskScore > 20
                    ? "WARNING"
                    : "STABLE",
            };
          });

          // 4. Procurement Bottlenecks (Items needed but not ordered)
          const bottlenecks = db
            .prepare(
              `
        SELECT 
          i.item_code,
          i.name,
          SUM(b.required_qty) as total_needed,
          inv.free_stock as total_stock
        FROM boms b
        JOIN items i ON b.item_id = i.id
        JOIN inventory inv ON i.id = inv.item_id
        WHERE b.project_id IN (SELECT id FROM projects WHERE status NOT IN ('FINISHED', 'CLOSED', 'CANCELLED'))
        GROUP BY i.id
        HAVING total_needed > total_stock
      `,
            )
            .all() as any[];

          res.json({
            vendorReliability,
            consumptionHabits,
            projectRisks,
            bottlenecks: bottlenecks.map((b) => ({
              ...b,
              shortage: b.total_needed - b.total_stock,
              risk_level:
                b.total_needed - b.total_stock > 10 ? "HIGH" : "MEDIUM",
            })),
          });
        } catch (error) {
          console.error(error);
          res
            .status(500)
            .json({ error: "Failed to fetch production analytics" });
        }
      },
    );

    // Record item consumption from production
    app.post(
      "/api/production/consume",
      requireRole(["PRODUCTION", "ENGINEERING", "WAREHOUSE"]),
      (req, res) => {
        try {
          const { bom_id, qty, project_id, item_id } = req.body;
          if (!bom_id || !qty || !item_id)
            return res.status(400).json({ error: "Missing required fields" });

          const transaction = db.transaction(() => {
            // Verify inventory
            const inv = db
              .prepare(
                "SELECT free_stock, allocated_stock FROM inventory WHERE item_id = ?",
              )
              .get(item_id) as any;
            if (
              !inv ||
              (inv.free_stock || 0) + (inv.allocated_stock || 0) < qty
            ) {
              throw new Error(
                `Insufficient stock for item ${item_id}. Available: ${(inv?.free_stock || 0) + (inv?.allocated_stock || 0)}`,
              );
            }

            // 1. Update bom_item_consumption
            db.prepare(
              `
          INSERT INTO bom_item_consumption (id, bom_id, qty_consumed)
          VALUES (?, ?, ?)
          ON CONFLICT(bom_id) DO UPDATE SET 
            qty_consumed = bom_item_consumption.qty_consumed + excluded.qty_consumed,
            updated_at = CURRENT_TIMESTAMP
        `,
            ).run(
              "BIC-" + Math.random().toString(36).substr(2, 9),
              bom_id,
              qty,
            );

            // 2. Reduce Inventory
            let deductAllocated = Math.min(inv.allocated_stock || 0, qty);
            let deductFree = qty - deductAllocated;

            db.prepare(
              "UPDATE inventory SET allocated_stock = allocated_stock - ?, free_stock = free_stock - ? WHERE item_id = ?",
            ).run(deductAllocated, deductFree, item_id);

            // 3. Record Movement
            db.prepare(
              "INSERT INTO stock_movements (id, item_id, project_id, type, qty, reference_id, recorded_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
            ).run(
              "MOV-" + Math.random().toString(36).substr(2, 9),
              item_id,
              project_id || null,
              "CONSUMPTION",
              -qty,
              bom_id,
              req.headers["x-user-email"],
            );

            return { success: true };
          });

          const result = transaction();
          res.json(result);
        } catch (error: any) {
          console.error(error);
          res
            .status(500)
            .json({ error: error.message || "Failed to record consumption" });
        }
      },
    );

    // Get active shortages for urgent projects
    app.get(
      "/api/warehouse/priority-shortages",
      requireRole(["WAREHOUSE", "PRODUCTION", "ENGINEERING"]),
      (req, res) => {
        try {
          const shortages = db
            .prepare(
              `
        SELECT 
          i.id as item_id,
          i.item_code,
          i.name as item_name,
          i.uom,
          p.id as project_id,
          p.name as project_name,
          p.urgency,
          b.required_qty,
          COALESCE((SELECT SUM(qty_consumed) FROM bom_item_consumption WHERE bom_id = b.id), 0) as qty_consumed,
          inv.free_stock
        FROM boms b
        JOIN items i ON b.item_id = i.id
        JOIN projects p ON b.project_id = p.id
        JOIN inventory inv ON i.id = inv.item_id
        WHERE p.status NOT IN ('FINISHED', 'CLOSED', 'CANCELLED') AND p.urgency IN ('URGENT', 'CRITICAL')
        ORDER BY CASE p.urgency WHEN 'CRITICAL' THEN 1 WHEN 'URGENT' THEN 2 ELSE 3 END
      `,
            )
            .all() as any[];

          res.json(shortages);
        } catch (err) {
          console.error(err);
          res.status(500).json({ error: "Failed to fetch priority shortages" });
        }
      },
    );

    // Production Insights & Bottleneck Prediction
    app.get(
      "/api/production/insights",
      requireRole(["PRODUCTION", "ENGINEERING", "PURCHASING"]),
      (req, res) => {
        try {
          const projectId = req.query.project_id;

          // 1. Calculate Load per Stage (Mocked logic based on real data)
          // In a real system, we'd look at resource capacity vs task requirements.
          const stages = [
            "Engineering",
            "Procurement",
            "Fabrication",
            "Assembly",
            "Testing",
          ];
          const bottleneckData = stages.map((stage) => {
            let load = 0;
            if (stage === "Procurement") {
              // Procurement load based on pending PRs
              const pendingCount = (
                db
                  .prepare(
                    "SELECT COUNT(*) as count FROM purchase_requests WHERE status = 'DRAFTED'",
                  )
                  .get() as any
              ).count;
              load = 40 + pendingCount * 15;
            } else if (stage === "Fabrication") {
              // Fabrication load based on active projects
              const activeProjects = (
                db
                  .prepare(
                    "SELECT COUNT(*) as count FROM projects WHERE status = 'ACTIVE'",
                  )
                  .get() as any
              ).count;
              load = 30 + activeProjects * 20;
            } else {
              load = Math.floor(Math.random() * 40) + 30;
            }
            return {
              stage,
              load: Math.min(130, load),
              capacity: 100,
              status:
                load > 100
                  ? "Overloaded"
                  : load > 80
                    ? "Optimal"
                    : "Underutilized",
            };
          });

          // 2. Calculate Real Progress for a specific project if provided
          let projectProgress = null;
          if (projectId) {
            const bomStats = db
              .prepare(
                `
          SELECT 
            SUM(b.required_qty) as total_required,
            SUM(bic.qty_consumed) as total_consumed
          FROM boms b
          JOIN bom_item_consumption bic ON b.id = bic.bom_id
          WHERE b.project_id = ?
        `,
              )
              .get(projectId) as {
              total_required: number;
              total_consumed: number;
            };

            if (bomStats && bomStats.total_required > 0) {
              projectProgress = Math.round(
                (bomStats.total_consumed / bomStats.total_required) * 100,
              );
            }
          }

          res.json({ bottleneckData, projectProgress });
        } catch (error) {
          console.error(error);
          res
            .status(500)
            .json({ error: "Failed to fetch production insights" });
        }
      },
    );

    // --- WORKFLOW RULES API ---
    app.get("/api/workflow/matrices", (req, res) => {
      try {
        const rows = db.prepare("SELECT * FROM workflow_matrices ORDER BY created_at DESC").all() as any[];
        const matrices = rows.map(r => ({
          ...r,
          roles: JSON.parse(r.roles)
        }));
        res.json(matrices);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch matrices" });
      }
    });

    app.post("/api/workflow/matrices", requireRole(["FC", "Director"]), (req, res) => {
      try {
        const { id, document_type, min_amount, max_amount, roles, is_parallel } = req.body;
        const targetId = id || crypto.randomUUID();
        const existing = db.prepare("SELECT * FROM workflow_matrices WHERE id = ?").get(targetId);
        
        db.prepare(`
          INSERT INTO workflow_matrices (id, document_type, min_amount, max_amount, roles, is_parallel)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            document_type = excluded.document_type,
            min_amount = excluded.min_amount,
            max_amount = excluded.max_amount,
            roles = excluded.roles,
            is_parallel = excluded.is_parallel
        `).run(targetId, document_type, min_amount, max_amount, JSON.stringify(roles), is_parallel ? 1 : 0);
        
        db.prepare(`
          INSERT INTO workflow_audit_logs (id, username, action, target_type, target_id, changes)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(crypto.randomUUID(), (req.headers["x-user-email"] as string) || 'SYSTEM', existing ? 'UPDATE' : 'CREATE', 'MATRIX', targetId, JSON.stringify(req.body));

        res.json({ success: true });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to save matrix" });
      }
    });

    app.delete("/api/workflow/matrices/:id", requireRole(["FC", "Director"]), (req, res) => {
      try {
        const existing = db.prepare("SELECT * FROM workflow_matrices WHERE id = ?").get(req.params.id);
        db.prepare("DELETE FROM workflow_matrices WHERE id = ?").run(req.params.id);
        
        db.prepare(`
          INSERT INTO workflow_audit_logs (id, username, action, target_type, target_id, changes)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(crypto.randomUUID(), (req.headers["x-user-email"] as string) || 'SYSTEM', 'DELETE', 'MATRIX', req.params.id, JSON.stringify(existing));

        res.json({ success: true });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to delete matrix" });
      }
    });

    app.get("/api/workflow/slas", (req, res) => {
      try {
        const slas = db.prepare("SELECT * FROM workflow_slas ORDER BY created_at DESC").all();
        res.json(slas);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch slas" });
      }
    });

    app.post("/api/workflow/slas", requireRole(["FC", "Director"]), (req, res) => {
      try {
        const { id, document_type, step, sla_hours, escalate_to } = req.body;
        const targetId = id || crypto.randomUUID();
        const existing = db.prepare("SELECT * FROM workflow_slas WHERE id = ?").get(targetId);

        db.prepare(`
          INSERT INTO workflow_slas (id, document_type, step, sla_hours, escalate_to)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            document_type = excluded.document_type,
            step = excluded.step,
            sla_hours = excluded.sla_hours,
            escalate_to = excluded.escalate_to
        `).run(targetId, document_type, step, sla_hours, escalate_to);
        
        db.prepare(`
          INSERT INTO workflow_audit_logs (id, username, action, target_type, target_id, changes)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(crypto.randomUUID(), (req.headers["x-user-email"] as string) || 'SYSTEM', existing ? 'UPDATE' : 'CREATE', 'SLA', targetId, JSON.stringify(req.body));

        res.json({ success: true });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to save SLA" });
      }
    });

    app.delete("/api/workflow/slas/:id", requireRole(["FC", "Director"]), (req, res) => {
      try {
        const existing = db.prepare("SELECT * FROM workflow_slas WHERE id = ?").get(req.params.id);
        db.prepare("DELETE FROM workflow_slas WHERE id = ?").run(req.params.id);

        db.prepare(`
          INSERT INTO workflow_audit_logs (id, username, action, target_type, target_id, changes)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(crypto.randomUUID(), (req.headers["x-user-email"] as string) || 'SYSTEM', 'DELETE', 'SLA', req.params.id, JSON.stringify(existing));

        res.json({ success: true });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to delete sla" });
      }
    });

    app.post("/api/workflow/generate", requireRole(["FC", "Director"]), async (req, res) => {
      try {
        const { prompt } = req.body;
        if (!prompt) return res.status(400).json({ error: "Prompt is required" });
        if (!process.env.GEMINI_API_KEY) {
           return res.status(500).json({ error: "GEMINI_API_KEY is not configured" });
        }
        
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        
        const systemInstruction = `
        You are an expert ERP Workflow Engine configuration assistant.
        Convert the following natural language requirement into a structured JSON payload containing 'matrices' and 'slas'.
        
        A Matrix object:
        - id: Generate a unique ID (e.g. "ai-mat-1")
        - document_type: "Purchase Order", "Purchase Request", or "Quotation"
        - min_amount: number (default 0)
        - max_amount: number or null
        - roles: array of exact string roles (e.g. ["Manager", "FC", "Director", "Procurement Manager", "Finance Manager", "Engineering Lead"])
        - is_parallel: 1 (for OR logic/parallel) or 0 (for AND logic/sequential)
        - is_new: true
        
        An SLA object:
        - id: Generate a unique ID (e.g. "ai-sla-1")
        - document_type: "Purchase Order", "Purchase Request", or "Quotation"
        - step: string (default "Pending Approval" or infer from request)
        - sla_hours: number
        - escalate_to: exact string role (e.g. "Director")
        - is_new: true
        
        Ensure output is strictly valid JSON with no markdown wrapping or comments.
        Format: { "matrices": [...], "slas": [...] }
        `;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                systemInstruction: systemInstruction,
                responseMimeType: "application/json"
            }
        });
        
        const result = JSON.parse(response.text || "{}");
        res.json({ success: true, data: result });
      } catch (err) {
        console.error("AI Generation Error", err);
        res.status(500).json({ error: "Failed to generate workflow via AI. Check API Key or prompt mapping." });
      }
    });

    app.get("/api/workflow/audit_logs", (req, res) => {
      try {
        const logs = db.prepare("SELECT * FROM workflow_audit_logs ORDER BY created_at DESC LIMIT 100").all();
        res.json(logs);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch audit logs" });
      }
    });

    // --- AUTH AND ACCOUNTS API ---
    app.post("/api/auth/login", async (req, res) => {
      try {
        const { username, password } = req.body;
        const user = db
          .prepare(
            "SELECT id, username, password as hashed_password, role, level, name, status FROM users WHERE username = ?",
          )
          .get(username) as any;
          
        if (!user) {
          return res.status(401).json({ error: "Invalid credentials" });
        }
        
        // Backward compatibility for existing plaintext passwords
        let isMatch = false;
        if (user.hashed_password && (user.hashed_password.startsWith("$2b$") || user.hashed_password.startsWith("$2a$"))) {
           isMatch = await bcrypt.compare(password, user.hashed_password);
        } else {
           isMatch = (password === user.hashed_password);
        }

        if (!isMatch) {
          return res.status(401).json({ error: "Invalid credentials" });
        }

        if (user.status === "REJECTED") {
          return res.status(403).json({
              error:
                "Your account request was rejected by Full Control. Please contact your administrator.",
            });
        }
        if (user.status !== "APPROVED") {
          return res.status(403).json({
              error: "Your account is pending approval by Full Control.",
            });
        }
        
        const token = jwt.sign({ username: user.username, role: user.role, level: user.level, name: user.name }, JWT_SECRET, { expiresIn: '24h' });
        
        res.cookie('auth_token', token, {
           httpOnly: true,
           secure: process.env.NODE_ENV === "production",
           sameSite: 'strict',
           maxAge: 24 * 60 * 60 * 1000 // 24 hours
        });

        // Do not return password hash
        delete user.hashed_password;
        res.json({ success: true, user });
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Login failed" });
      }
    });

    app.post("/api/auth/register", async (req, res) => {
      try {
        const { username, password, role, level, name } = req.body;
        if (!username || !password || !role)
          return res.status(400).json({ error: "Missing required fields" });

        // Check for EXISTING username regardless of status
        const existingUser = db
          .prepare("SELECT id, status FROM users WHERE username = ?")
          .get(username) as any;
        if (existingUser) {
          if (existingUser.status === "REJECTED") {
            // If rejected, remove the rejected record to allow re-registration
            db.prepare("DELETE FROM users WHERE id = ?").run(existingUser.id);
          } else {
            return res.status(400).json({ error: "Username already exists" });
          }
        }

        const id = "USER-" + Math.random().toString(36).substr(2, 9);
        const hashedPassword = await bcrypt.hash(password, 12);
        
        db.prepare(
          `
        INSERT INTO users (id, username, password, role, level, name, status)
        VALUES (?, ?, ?, ?, ?, ?, 'PENDING')
      `,
        ).run(id, username, hashedPassword, role, level || "STAFF", name || username);

        // Auto-assign to Forum
        db.prepare(
          "INSERT OR IGNORE INTO chat_participants (thread_id, username) VALUES ('THREAD-GENERAL', ?)",
        ).run(username);

        res.json({
          success: true,
          message: "Account request submitted. Please wait for FC approval.",
        });
      } catch (error: any) {
        if (error.message.includes("UNIQUE constraint failed")) {
          return res.status(400).json({ error: "Username already exists" });
        }
        console.error(error);
        res.status(500).json({ error: "Registration failed" });
      }
    });

    app.get("/api/auth/pending", requireRole(["FC"]), (req, res) => {
      try {
        const users = db
          .prepare(
            "SELECT id, username, role, level, name, status, created_at FROM users WHERE status = 'PENDING' ORDER BY created_at DESC",
          )
          .all();
        res.json(users);
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to fetch pending accounts" });
      }
    });

    app.post("/api/auth/approve", requireRole(["FC"]), (req, res) => {
      try {
        const { id } = req.body;
        const targetUser = db
          .prepare("SELECT username, name FROM users WHERE id = ?")
          .get(id) as any;

        db.prepare(
          "UPDATE users SET status = 'APPROVED', is_approved = 1 WHERE id = ?",
        ).run(id);

        if (targetUser) {
          logAudit(
            (req.headers["x-user-email"] || "FC") as string,
            "APPROVE_ACCOUNT",
            "USER",
            id,
            `Approved account for ${targetUser.username}`,
          );

          // Broadcast welcome message to Forum
          const msgId = "MSG-" + Math.random().toString(36).substr(2, 9);
          db.prepare(
            `
          INSERT INTO chat_messages (id, thread_id, sender_username, content) 
          VALUES (?, ?, ?, ?)
        `,
          ).run(
            msgId,
            "THREAD-GENERAL",
            "SYSTEM",
            `🎊 **New Member Alert!** 🎊\n\nWelcome to the family, **${targetUser.name || targetUser.username}**! 🤝\nWe're excited to have you onboard. Feel free to introduce yourself here! ✨\n\n---`,
          );
        }

        res.json({ success: true });
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to approve account" });
      }
    });

    app.post("/api/auth/reject", requireRole(["FC"]), (req, res) => {
      try {
        const { id } = req.body;
        const targetUser = db
          .prepare("SELECT username, name FROM users WHERE id = ?")
          .get(id) as any;

        db.prepare("UPDATE users SET status = 'REJECTED' WHERE id = ?").run(id);

        if (targetUser) {
          logAudit(
            (req.headers["x-user-email"] || "FC") as string,
            "REJECT_ACCOUNT",
            "USER",
            id,
            `Rejected account for ${targetUser.username}`,
          );
        }

        res.json({ success: true });
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to reject account" });
      }
    });

    // Suppliers API
    app.get(
      "/api/suppliers",
      requireRole(["PURCHASING", "WAREHOUSE"]),
      (req, res) => {
        try {
          const suppliers = db
            .prepare(
              `
        SELECT 
          s.*,
          (
            SELECT COUNT(g.id) 
            FROM grns g 
            JOIN purchase_orders po ON po.id = g.po_id 
            WHERE po.supplier_id = s.id AND g.qc_status = 'REJECTED'
          ) as rejected_count,
          (
            SELECT COUNT(g.id) 
            FROM grns g 
            JOIN purchase_orders po ON po.id = g.po_id 
            WHERE po.supplier_id = s.id AND g.qc_status = 'PASSED'
          ) as passed_count,
          (
            SELECT COUNT(po.id)
            FROM purchase_orders po
            WHERE po.supplier_id = s.id
          ) as total_orders
        FROM suppliers s 
        ORDER BY s.name ASC
      `,
            )
            .all();
          res.json(suppliers);
        } catch (error) {
          console.error(error);
          res.status(500).json({ error: "Failed to fetch suppliers" });
        }
      },
    );

    app.post(
      "/api/suppliers",
      requireRole(["FC", "PURCHASING"]),
      (req, res) => {
        const userRole = (req as any).userRole;
        const userLevel = (req as any).userLevel;
        if (
          userRole !== "FC" &&
          (userRole !== "PURCHASING" || userLevel !== "MANAGER")
        ) {
          return res
            .status(403)
            .json({ error: "Access denied. Only FC or Purchasing Manager can manage vendors." });
        }
        try {
          const { name, code, contact_person, email, phone, address } = req.body;
          const id = "SUP-" + Math.random().toString(36).substr(2, 9);
          db.prepare(
            "INSERT INTO suppliers (id, name, code, contact_person, email, phone, address) VALUES (?, ?, ?, ?, ?, ?, ?)",
          ).run(
            id,
            name,
            code || null,
            contact_person || null,
            email || null,
            phone || null,
            address || null,
          );
          res.json({ success: true, id });
        } catch (error) {
          console.error(error);
          res.status(500).json({ error: "Failed to create supplier" });
        }
      },
    );

    app.put(
      "/api/suppliers/:id",
      requireRole(["FC", "PURCHASING"]),
      (req, res) => {
        const userRole = (req as any).userRole;
        const userLevel = (req as any).userLevel;
        if (
          userRole !== "FC" &&
          (userRole !== "PURCHASING" || userLevel !== "MANAGER")
        ) {
          return res
            .status(403)
            .json({ error: "Access denied. Only FC or Purchasing Manager can manage vendors." });
        }
        try {
          const { name, code, contact_person, email, phone, address } = req.body;
          db.prepare(
            `
          UPDATE suppliers 
          SET name = ?, code = ?, contact_person = ?, email = ?, phone = ?, address = ?
          WHERE id = ?
        `,
          ).run(name, code, contact_person, email, phone, address, req.params.id);
          res.json({ success: true });
        } catch (error) {
          console.error(error);
          res.status(500).json({ error: "Failed to update supplier" });
        }
      },
    );

    app.delete(
      "/api/suppliers/:id",
      requireRole(["FC", "PURCHASING"]),
      (req, res) => {
        const userRole = (req as any).userRole;
        const userLevel = (req as any).userLevel;
        if (
          userRole !== "FC" &&
          (userRole !== "PURCHASING" || userLevel !== "MANAGER")
        ) {
          return res
            .status(403)
            .json({ error: "Access denied. Only FC or Purchasing Manager can manage vendors." });
        }
        try {
          // Check if supplier has any POs
          const poCount = (
            db
              .prepare(
                "SELECT COUNT(*) as count FROM purchase_orders WHERE supplier_id = ?",
              )
              .get(req.params.id) as any
          ).count;
          if (poCount > 0) {
            return res
              .status(400)
              .json({
                error: "Cannot delete supplier with active purchase orders.",
              });
          }
          db.transaction(() => {
            db.prepare("DELETE FROM item_supplier_prices WHERE supplier_id = ?").run(req.params.id);
            db.prepare("DELETE FROM item_price_history WHERE supplier_id = ?").run(req.params.id);
            db.prepare("DELETE FROM suppliers WHERE id = ?").run(req.params.id);
          })();
          res.json({ success: true });
        } catch (error) {
          console.error(error);
          res.status(500).json({ error: "Failed to delete supplier" });
        }
      },
    );

    // Project Cost Summary
    app.get("/api/projects/:id/cost-summary", (req, res) => {
      try {
        const projectId = req.params.id;
        const budget = db
          .prepare(
            `
        SELECT SUM(required_qty * unit_price) as total_budget
        FROM boms
        WHERE project_id = ?
      `,
          )
          .get(projectId) as { total_budget: number };

        const actual = db
          .prepare(
            `
        SELECT SUM(pri.qty * pri.unit_price) as total_actual
        FROM pr_items pri
        JOIN purchase_requests pr ON pri.pr_id = pr.id
        WHERE pr.project_id = ? AND pr.status != 'CANCELLED'
      `,
          )
          .get(projectId) as { total_actual: number };

        res.json({
          budget: budget.total_budget || 0,
          actual: actual.total_actual || 0,
        });
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to fetch cost summary" });
      }
    });

    // Upload endpoint
    app.post("/api/upload", upload.single("file"), (req, res) => {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }
      const fileUrl = `/uploads/${req.file.filename}`;
      res.json({ url: fileUrl });
    });

    // Health check
    app.get("/api/health", (req, res) => {
      res.json({ status: "ok", time: new Date().toISOString() });
    });

    // Audit Trail API
    app.get("/api/audit-trail", (req, res) => {
      try {
        const { resource_id } = req.query;
        let logs;
        if (resource_id) {
          logs = db
            .prepare(
              "SELECT * FROM audit_trail WHERE resource_id = ? ORDER BY created_at DESC LIMIT 200",
            )
            .all(resource_id);
        } else {
          logs = db
            .prepare(
              "SELECT * FROM audit_trail ORDER BY created_at DESC LIMIT 200",
            )
            .all();
        }
        res.json(logs);
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to fetch audit trail" });
      }
    });

    // Factory Reset (Master FC only)
    app.post("/api/admin/reset-factory", requireRole(["FC"]), (req, res) => {
      try {
        resetFactoryData();
        res.json({
          success: true,
          message:
            "System reset to factory defaults successfully. Please logout and login again.",
        });
      } catch (error) {
        console.error("Factory Reset Error:", error);
        res.status(500).json({ error: "Failed to perform factory reset" });
      }
    });

    // HRIS & HR Portal Reset (FC and HR role only)
    app.post("/api/admin/reset-hris", requireRole(["FC", "HR"]), (req, res) => {
      try {
        resetHrData();
        try {
          db.prepare(`
            INSERT INTO audit_trail (id, user_email, action, resource_type, resource_id, details)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(
            `AUDIT-${Date.now()}`,
            req.headers["x-user-email"] || "system",
            "DATABASE_RESET_HRIS",
            "SYSTEM",
            "ALL",
            "HRIS and Human Resource data was reset to factory defaults"
          );
        } catch (audErr) {
          console.error("Failed to log audit for resetHrData:", audErr);
        }
        res.json({
          success: true,
          message:
            "HRIS and Human Resource pages have been reset to factory defaults successfully.",
        });
      } catch (error) {
        console.error("HRIS Reset Error:", error);
        res.status(500).json({ error: "Failed to perform HRIS and Human Resource data reset" });
      }
    });

    // Get all active projects
    app.get("/api/projects", (req, res) => {
      try {
        const { archived } = req.query;
        let query = `
        SELECT p.*, 
               COALESCE((SELECT SUM(required_qty * unit_price) FROM boms WHERE project_id = p.id), 0) as est_budget,
               COALESCE((SELECT SUM(pri.qty * pri.unit_price) FROM pr_items pri JOIN purchase_requests pr ON pri.pr_id = pr.id WHERE pr.project_id = p.id AND pr.status != 'CANCELLED'), 0) as actual_cost,
               (SELECT SUM(qty) FROM quotation_items WHERE quotation_id = p.quotation_id) as quotation_qty
        FROM projects p 
      `;
        if (archived === "true") {
          query += " WHERE p.archived_at IS NOT NULL";
        } else if (archived === "all") {
          query += " WHERE p.status != 'PENDING_NTP'";
        } else {
          query += " WHERE p.archived_at IS NULL AND p.status != 'PENDING_NTP'";
        }
        query += " ORDER BY p.due_date ASC, p.created_at DESC";
        const projects = db.prepare(query).all();
        res.json(projects);
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to fetch projects" });
      }
    });

    // Get all work centers
    app.get("/api/work-centers", (req, res) => {
      try {
        const wcs = db.prepare("SELECT * FROM work_centers").all();
        res.json(wcs);
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to fetch work centers" });
      }
    });

    // Update work center capacity
    app.post("/api/work-centers", (req, res) => {
      try {
        const {
          id,
          name,
          manpower_count,
          hours_per_day,
          days_per_week,
          efficiency_index,
          status,
        } = req.body;
        const capacity_per_week =
          manpower_count * hours_per_day * days_per_week;
        db.prepare(
          `
        INSERT INTO work_centers (id, name, manpower_count, hours_per_day, days_per_week, capacity_per_week, efficiency_index, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          manpower_count = excluded.manpower_count,
          hours_per_day = excluded.hours_per_day,
          days_per_week = excluded.days_per_week,
          capacity_per_week = excluded.capacity_per_week,
          efficiency_index = excluded.efficiency_index,
          status = excluded.status
      `,
        ).run(
          id,
          name,
          manpower_count,
          hours_per_day,
          days_per_week,
          capacity_per_week,
          efficiency_index || 1.0,
          status || "ACTIVE",
        );
        res.json({ success: true });
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to update work center" });
      }
    });

    // Bulk update work centers
    app.post(
      "/api/work-centers/bulk",
      requireRole(["FC", "PRODUCTION", "ENGINEERING"]),
      (req, res) => {
        const userRole = (req as any).userRole;
        const userLevel = (req as any).userLevel;
        if (
          userRole !== "FC" &&
          userLevel !== "MANAGER"
        ) {
          return res
            .status(403)
            .json({ error: "Access denied. Only FC or production/engineering managers can configure work centers." });
        }
        try {
          const { centers } = req.body;
        const stmt = db.prepare(`
        INSERT INTO work_centers (id, name, manpower_count, hours_per_day, days_per_week, capacity_per_week, efficiency_index, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          manpower_count = excluded.manpower_count,
          hours_per_day = excluded.hours_per_day,
          days_per_week = excluded.days_per_week,
          capacity_per_week = excluded.capacity_per_week,
          efficiency_index = excluded.efficiency_index,
          status = excluded.status
      `);

        const transaction = db.transaction(() => {
          for (const wc of centers) {
            const capacity =
              wc.manpower_count * wc.hours_per_day * wc.days_per_week;
            stmt.run(
              wc.id,
              wc.name,
              wc.manpower_count,
              wc.hours_per_day,
              wc.days_per_week,
              capacity,
              wc.efficiency_index || 1.0,
              wc.status || "ACTIVE",
            );
          }
        });
        transaction();
        res.json({ success: true });
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to bulk update work centers" });
      }
    });

    app.delete("/api/work-centers/:id", (req, res) => {
      try {
        const tasksCountRow = db
          .prepare(
            "SELECT COUNT(*) as count FROM project_tasks WHERE work_center_id = ?",
          )
          .get(req.params.id) as { count: number };
        if (tasksCountRow.count > 0) {
          return res
            .status(400)
            .json({
              error:
                "Cannot delete work center because it is assigned to existing tasks.",
            });
        }
        db.prepare("DELETE FROM work_centers WHERE id = ?").run(req.params.id);
        res.json({ success: true });
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to delete work center" });
      }
    });

    app.post("/api/tasks/:id", (req, res) => {
      try {
        const {
          start_date,
          end_date,
          required_hours,
          progress,
          status,
          actual_start_date,
          actual_end_date,
          work_center_id,
        } = req.body;
        const { id } = req.params;

        const updates = [];
        const params = [];

        if (start_date !== undefined) {
          updates.push("start_date = ?");
          params.push(start_date);
        }
        if (end_date !== undefined) {
          updates.push("end_date = ?");
          params.push(end_date);
        }
        if (required_hours !== undefined) {
          updates.push("required_hours = ?");
          params.push(required_hours);
        }
        if (progress !== undefined) {
          updates.push("progress = ?");
          params.push(progress);
        }
        if (status !== undefined) {
          updates.push("status = ?");
          params.push(status);
        }
        if (actual_start_date !== undefined) {
          updates.push("actual_start_date = ?");
          params.push(actual_start_date);
        }
        if (actual_end_date !== undefined) {
          updates.push("actual_end_date = ?");
          params.push(actual_end_date);
        }
        if (work_center_id !== undefined) {
          updates.push("work_center_id = ?");
          params.push(work_center_id);
        }

        if (updates.length === 0) return res.json({ success: true });

        params.push(id);
        db.prepare(
          `UPDATE project_tasks SET ${updates.join(", ")} WHERE id = ?`,
        ).run(...params);

        res.json({ success: true });
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to update task" });
      }
    });

    // Get all projects with tasks for Gantt
    app.get("/api/gantt", (req, res) => {
      try {
        const projects = db
          .prepare(
            "SELECT * FROM projects WHERE archived_at IS NULL AND status != 'PENDING_NTP' ORDER BY due_date ASC",
          )
          .all() as any[];
        const tasks = db
          .prepare(
            `
        SELECT t.*, wc.name as work_center_name 
        FROM project_tasks t
        LEFT JOIN work_centers wc ON t.work_center_id = wc.id
        WHERE t.status != 'CANCELLED'
        ORDER BY t.start_date ASC
      `,
          )
          .all() as any[];

        const tasksByProject: Record<string, any[]> = {};
        for (const t of tasks) {
          if (!tasksByProject[t.project_id]) tasksByProject[t.project_id] = [];
          tasksByProject[t.project_id].push(t);
        }

        // Batch fetch consumption status
        if (projects.length === 0) return res.json([]);

        const counts = db
          .prepare(
            `
        SELECT 
          p.id as project_id,
          (SELECT SUM(required_qty) FROM boms WHERE project_id = p.id) as total_bom,
          (SELECT SUM(qty_consumed) FROM bom_item_consumption bic JOIN boms b ON b.id = bic.bom_id WHERE b.project_id = p.id) as total_consumed
        FROM projects p
        WHERE p.archived_at IS NULL
      `,
          )
          .all() as any[];

        const countMap: Record<string, any> = {};
        for (const count of counts) {
          countMap[count.project_id] = count;
        }

        const projectsWithTasks = projects.map((p) => {
          const count = countMap[p.id];
          const totalBom = count?.total_bom || 0;
          const totalConsumed = count?.total_consumed || 0;

          let materialStatus: "UNAVAILABLE" | "READY" = "READY";
          if (totalBom > 0 && totalConsumed <= 0) {
            materialStatus = "UNAVAILABLE";
          }

          return {
            ...p,
            material_status: materialStatus,
            tasks: tasksByProject[p.id] || [],
          };
        });

        res.json(projectsWithTasks);
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to fetch gantt data" });
      }
    });

    // Get single project details
    app.get("/api/projects/:id", (req, res) => {
      try {
        const project = db
          .prepare("SELECT * FROM projects WHERE id = ?")
          .get(req.params.id) as any;
        if (!project)
          return res.status(404).json({ error: "Project not found" });

        const tasks = db
          .prepare(
            "SELECT * FROM project_tasks WHERE project_id = ? ORDER BY start_date ASC",
          )
          .all(req.params.id);

        const prs = db
          .prepare(
            `
        SELECT 
          pr.pr_number, 
          pr.status, 
          pr.created_at, 
          COUNT(pri.id) as item_count,
          EXISTS(SELECT 1 FROM pr_items pri2 WHERE pri2.pr_id = pr.id AND pri2.po_id IS NOT NULL) as has_po
        FROM purchase_requests pr
        LEFT JOIN pr_items pri ON pr.id = pri.pr_id
        WHERE pr.project_id = ?
        GROUP BY pr.id
        ORDER BY pr.created_at DESC
      `,
          )
          .all(req.params.id);

        const bom = db
          .prepare(
            `
        SELECT 
          b.*, 
          i.item_code, 
          i.name as item_name, 
          i.uom, 
          i.unit_price as matrix_unit_price,
          inv.free_stock,
          inv.allocated_stock,
          bic.qty_consumed,
          (
            SELECT GROUP_CONCAT(pr.pr_number || ' (' || pri.qty || ')', ', ')
            FROM pr_items pri
            JOIN purchase_requests pr ON pri.pr_id = pr.id
            WHERE pri.item_id = b.item_id AND pr.project_id = b.project_id AND pr.status != 'CANCELLED'
          ) as pr_numbers,
          (
            SELECT SUM(pri.qty)
            FROM pr_items pri
            JOIN purchase_requests pr ON pri.pr_id = pr.id
            WHERE pri.item_id = b.item_id AND pr.project_id = b.project_id AND pr.status != 'CANCELLED'
          ) as total_pr_qty
        FROM boms b
        JOIN items i ON b.item_id = i.id
        LEFT JOIN inventory inv ON b.item_id = inv.item_id
        LEFT JOIN bom_item_consumption bic ON b.id = bic.bom_id
        WHERE b.project_id = ?
      `,
          )
          .all(req.params.id);

        const deliveries = db
          .prepare(
            `
         SELECT dn.*, COALESCE(c.name, dn.customer_id) as customer_name 
         FROM delivery_notes dn 
         LEFT JOIN customers c ON dn.customer_id = c.id
         WHERE dn.project_id = ? 
         ORDER BY dn.created_at DESC
      `,
          )
          .all(req.params.id);

        const fgs = db
          .prepare(
            `
         SELECT * FROM items WHERE type = 'FINISHED' AND item_code LIKE ?
      `,
          )
          .all(`FG-${req.params.id}%`);

        const invoices = db
          .prepare(
            `
         SELECT ci.*, COALESCE(c.name, ci.customer_id) as customer_name
         FROM commercial_invoices ci
         LEFT JOIN customers c ON ci.customer_id = c.id
         WHERE ci.project_id = ?
         ORDER BY ci.created_at DESC
      `,
          )
          .all(req.params.id) as any[];

        for (let inv of invoices) {
          inv.items = db
            .prepare(`
              SELECT di.*, 
                     COALESCE(i.item_code, 'FG-' || dn.project_id) as item_code, 
                     COALESCE(i.name, p.name, 'Commercial Trade Item') as item_name
              FROM delivery_items di
              JOIN delivery_notes dn ON di.dn_id = dn.id
              LEFT JOIN items i ON di.item_id = i.id
              LEFT JOIN projects p ON dn.project_id = p.id
              WHERE di.dn_id = ?
            `)
            .all(inv.dn_id);
        }

        const quotation_items = project.quotation_id
          ? db
              .prepare("SELECT * FROM quotation_items WHERE quotation_id = ?")
              .all(project.quotation_id)
          : [];

        res.json({
          project,
          tasks,
          prs,
          bom,
          deliveries,
          fgs,
          invoices,
          quotation_items,
        });
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to fetch project details" });
      }
    });

    // Add task to project
    app.post("/api/projects/:id/tasks", (req, res) => {
      try {
        const project = db
          .prepare("SELECT status FROM projects WHERE id = ?")
          .get(req.params.id) as any;
        if (
          project &&
          (project.status === "FINISHED" || project.status === "CLOSED")
        ) {
          return res
            .status(400)
            .json({
              error: "Cannot add task to a finished or closed project.",
            });
        }
        const { task_name, start_date, end_date, progress, status } = req.body;
        const taskId = "TSK-" + Math.random().toString(36).substr(2, 9);
        const insert = db.prepare(
          "INSERT INTO project_tasks (id, project_id, task_name, start_date, end_date, progress, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
        );
        insert.run(
          taskId,
          req.params.id,
          task_name,
          start_date,
          end_date,
          progress || 0,
          status || "PENDING",
        );
        res.json({ success: true, id: taskId });
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to add task" });
      }
    });

    // Update task progress
    app.put("/api/tasks/:id/progress", (req, res) => {
      try {
        const {
          progress,
          status,
          actual_start_date,
          actual_end_date,
          work_center_id,
          required_hours,
        } = req.body;
        const taskId = req.params.id;

        db.transaction(() => {
          const currentTask = db
            .prepare("SELECT * FROM project_tasks WHERE id = ?")
            .get(taskId) as any;
          if (!currentTask) return;

          let finalStartDate =
            actual_start_date !== undefined
              ? actual_start_date
              : currentTask.actual_start_date;
          let finalEndDate =
            actual_end_date !== undefined
              ? actual_end_date
              : currentTask.actual_end_date;

          let finalWorkCenter =
            work_center_id !== undefined
              ? work_center_id
              : currentTask.work_center_id;
          let finalRequiredHours =
            required_hours !== undefined
              ? required_hours
              : currentTask.required_hours;

          if (status === "IN_PROGRESS" && !finalStartDate) {
            finalStartDate = new Date().toISOString();
          }
          if (status === "COMPLETED" && !finalEndDate) {
            finalEndDate = new Date().toISOString();
            if (!finalStartDate) finalStartDate = new Date().toISOString(); // Fallback
          }

          db.prepare(
            "UPDATE project_tasks SET progress = ?, status = ?, actual_start_date = ?, actual_end_date = ?, work_center_id = ?, required_hours = ? WHERE id = ?",
          ).run(
            progress,
            status,
            finalStartDate,
            finalEndDate,
            finalWorkCenter || null,
            finalRequiredHours || null,
            taskId,
          );

          // Auto-Archive Logic: If all tasks are completed, mark project as finished
          const task = db
            .prepare("SELECT project_id FROM project_tasks WHERE id = ?")
            .get(taskId) as any;
          if (task) {
            const allTasks = db
              .prepare("SELECT status FROM project_tasks WHERE project_id = ?")
              .all(task.project_id) as any[];
            if (
              allTasks.length > 0 &&
              allTasks.every((t) => t.status === "COMPLETED")
            ) {
              // Check if project is already finished to avoid redundant work
              const project = db
                .prepare("SELECT status FROM projects WHERE id = ?")
                .get(task.project_id) as any;
              if (project && project.status !== "FINISHED") {
                // We can't easily call another route handler, so we repeat the finish logic or trigger it
                db.prepare(
                  "UPDATE projects SET status = 'FINISHED' WHERE id = ?",
                ).run(task.project_id);

                // Release unconsumed allocated stock
                const uniqueItems = db
                  .prepare(
                    "SELECT DISTINCT item_id FROM boms WHERE project_id = ?",
                  )
                  .all(task.project_id) as { item_id: string }[];
                for (const { item_id } of uniqueItems) {
                  const allocResult = db
                    .prepare(
                      `
                  SELECT COALESCE(SUM(qty), 0) as total_alloc
                  FROM stock_movements
                  WHERE project_id = ? AND item_id = ? AND type IN ('ALLOCATION', 'GRN_ALLOCATION')
                `,
                    )
                    .get(task.project_id, item_id) as any;

                  const consumeResult = db
                    .prepare(
                      `
                  SELECT COALESCE(SUM(ABS(qty)), 0) as total_consumed
                  FROM stock_movements
                  WHERE project_id = ? AND item_id = ? AND type = 'CONSUMPTION'
                `,
                    )
                    .get(task.project_id, item_id) as any;

                  const remaining =
                    (allocResult.total_alloc || 0) -
                    (consumeResult.total_consumed || 0);
                  const projectAllocated = Math.max(0, remaining);
                  if (projectAllocated > 0) {
                    db.prepare(
                      "INSERT INTO stock_movements (id, item_id, project_id, type, qty, reference_id) VALUES (?, ?, ?, 'RELEASE', ?, ?)",
                    ).run(
                      "MOV-" + Math.random().toString(36).substr(2, 9),
                      item_id,
                      task.project_id,
                      projectAllocated,
                      "Auto-release on auto-archive",
                    );
                  }
                }
                logAudit(
                  null,
                  "AUTO_ARCHIVE",
                  "PROJECT",
                  task.project_id,
                  "Project automatically finished as all tasks are completed.",
                );
              }
            }
          }
        })();

        res.json({ success: true });
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to update task" });
      }
    });

    // Get Shortage Analysis for Project
    app.get("/api/projects/:id/shortage-analysis", (req, res) => {
      try {
        const projectId = req.params.id;

        // 1. Get BOM items for THIS project
        const boms = db
          .prepare(
            `
        SELECT 
          b.id as bom_id,
          b.item_id, 
          i.item_code,
          i.name as item_name,
          b.dimension, 
          b.spec, 
          b.required_qty,
          i.uom,
          COALESCE(bic.qty_consumed, 0) as consumed
        FROM boms b
        JOIN items i ON b.item_id = i.id
        LEFT JOIN bom_item_consumption bic ON b.id = bic.bom_id
        WHERE b.project_id = ?
      `,
          )
          .all(projectId) as any[];

        // 2. Get Allocations for THIS project
        const projectAllocations = db
          .prepare(
            `
        SELECT item_id, SUM(qty) as total_alloc
        FROM stock_movements
        WHERE project_id = ? AND type IN ('ALLOCATION', 'GRN_ALLOCATION', 'GRN')
        GROUP BY item_id
      `,
          )
          .all(projectId) as any[];
        const projectAllocMap = new Map(
          projectAllocations.map((a) => [a.item_id, a.total_alloc]),
        );

        // 3. Get Active PRs/POs for THIS project
        const projectPrs = db
          .prepare(
            `
        SELECT pri.item_id, SUM(pri.qty) as total_pr_qty, GROUP_CONCAT(DISTINCT pr.pr_number) as pr_numbers
        FROM pr_items pri
        JOIN purchase_requests pr ON pri.pr_id = pr.id
        WHERE pr.project_id = ? AND pr.status != 'CANCELLED' AND pr.status != 'COMPLETED'
        GROUP BY pri.item_id
      `,
          )
          .all(projectId) as any[];
        const projectPrMap = new Map(
          projectPrs.map((p) => [
            p.item_id,
            { qty: p.total_pr_qty, numbers: p.pr_numbers },
          ]),
        );

        // 4. Calculate Net Available Stock
        if (boms.length === 0) return res.json([]);
        const itemIds = [...new Set(boms.map((b) => b.item_id))];
        const placeholders = itemIds.map(() => "?").join(",");

        // True Free Stock = Inventory Table Free Stock - (Sum of unmet dependencies of OTHER active projects)
        const inventory = db
          .prepare(
            `SELECT item_id, free_stock FROM inventory WHERE item_id IN (${placeholders})`,
          )
          .all(...itemIds) as any[];

        // Commitments are items "promised" to other projects
        // This includes items already allocated to them but not yet consumed
        const otherCommitments = db
          .prepare(
            `
        SELECT item_id, SUM(qty) as allocated
        FROM stock_movements
        WHERE type IN ('ALLOCATION', 'GRN_ALLOCATION', 'GRN') AND project_id != ? AND project_id IS NOT NULL AND item_id IN (${placeholders})
        GROUP BY item_id
      `,
          )
          .all(projectId, ...itemIds) as any[];
        const otherCommitMap = new Map(
          otherCommitments.map((c) => [c.item_id, c.allocated]),
        );

        // Also consider what other projects HAVE PR'd/Ordered but not yet arrived?
        // Actually, those aren't in free_stock yet, so they don't count towards current availability.

        const invMap = new Map(
          inventory.map((i) => {
            const otherComm = otherCommitMap.get(i.item_id) || 0;
            // The free_stock in table should ideally be "Unallocated"
            // But if the system has items in GRN with project_id, they might be in free_stock?
            // In our intake-grn, they ARE added to free_stock.
            return [i.item_id, Math.max(0, i.free_stock - otherComm)];
          }),
        );

        const analysis = boms.map((bom) => {
          const prData = projectPrMap.get(bom.item_id) || {
            qty: 0,
            numbers: null,
          };
          const pr_numbers = prData.numbers ? prData.numbers.split(",") : [];
          const stock = invMap.get(bom.item_id) || 0;
          const allocated = projectAllocMap.get(bom.item_id) || 0;

          const ordered = prData.qty;

          const remainingToBuild = Math.max(0, bom.required_qty - bom.consumed);

          // Shortage = Requirement - (What we have + What is coming for US + What is free to take)
          const shortage = Math.max(
            0,
            remainingToBuild - (allocated + stock + ordered),
          );
          const can_allocate = Math.min(stock, shortage);

          return {
            ...bom,
            allocated,
            ordered,
            pr_numbers,
            free_stock: stock,
            shortage,
            can_allocate,
          };
        });

        res.json(analysis);
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to fetch shortage analysis" });
      }
    });

    // Work Orders API
    app.get("/api/projects/:id/work-orders", (req, res) => {
      try {
        const wos = db
          .prepare(
            `
        SELECT wo.*, 
          (SELECT COUNT(*) FROM work_order_items WHERE wo_id = wo.id) as item_count
        FROM work_orders wo
        WHERE wo.project_id = ?
        ORDER BY wo.created_at DESC
      `,
          )
          .all(req.params.id);
        res.json(wos);
      } catch (error) {
        res.status(500).json({ error: "Failed to fetch work orders" });
      }
    });

    app.post("/api/projects/:id/work-orders", (req, res) => {
      try {
        const projectId = req.params.id;
        const project = db
          .prepare("SELECT status FROM projects WHERE id = ?")
          .get(projectId) as any;
        if (
          project &&
          (project.status === "FINISHED" || project.status === "CLOSED")
        ) {
          return res
            .status(400)
            .json({
              error:
                "Cannot create Work Order for a finished or closed project.",
            });
        }

        const { items } = req.body; // Array of { bom_id, qty_to_consume }

        const woId = "WO-" + Math.random().toString(36).substr(2, 9);
        const woNumber =
          "WO-" +
          new Date().getFullYear() +
          "-" +
          Math.floor(100000 + Math.random() * 900000);

        db.transaction(() => {
          db.prepare(
            "INSERT INTO work_orders (id, wo_number, project_id, status) VALUES (?, ?, ?, 'DRAFT')",
          ).run(woId, woNumber, projectId);

          const insertItem = db.prepare(
            "INSERT INTO work_order_items (id, wo_id, bom_id, qty_to_consume) VALUES (?, ?, ?, ?)",
          );
          for (const item of items) {
            insertItem.run(
              "WOI-" + Math.random().toString(36).substr(2, 9),
              woId,
              item.bom_id,
              item.qty_to_consume,
            );
          }
        })();

        res.json({ success: true, wo_id: woId, wo_number: woNumber });
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to create work order" });
      }
    });

    app.post("/api/work-orders/:id/release", (req, res) => {
      try {
        const woId = req.params.id;
        const wo = db
          .prepare("SELECT * FROM work_orders WHERE id = ?")
          .get(woId) as any;
        if (!wo) return res.status(404).json({ error: "Work order not found" });

        const transaction = db.transaction(() => {
          // We do NOT deduct stock here. The user requested that stock deduction
          // ONLY happens manually via the Operations Terminal.

          db.prepare(
            "UPDATE work_orders SET status = 'COMPLETED', completed_at = CURRENT_TIMESTAMP WHERE id = ?",
          ).run(woId);
        });

        transaction();
        res.json({ success: true });
      } catch (error: any) {
        console.error(error);
        res
          .status(400)
          .json({ error: error.message || "Failed to release work order" });
      }
    });

    // Generate PRs for Project Shortages (MRP logic)
    app.post(
      "/api/projects/:id/generate-prs",
      requireRole(["ENGINEERING", "FC"]),
      (req, res) => {
        try {
          const projectId = req.params.id;
          const project = db
            .prepare("SELECT status FROM projects WHERE id = ?")
            .get(projectId) as any;
          if (
            project &&
            (project.status === "FINISHED" || project.status === "CLOSED")
          ) {
            return res
              .status(400)
              .json({
                error: "Cannot generate PRs for a finished or closed project.",
              });
          }

          const {
            expected_delivery_date,
            drawing_reference,
            items: customItems,
            item_expected_dates = {},
            urgency,
          } = req.body || {};

          const transaction = db.transaction(() => {
            let prId = null;
            let prNumber = null;
            let itemsToPr = [];

            // Always evaluate existing allocations/stock for auto-allocation
            const boms = db
              .prepare(
                `
          SELECT 
            b.item_id, 
            MAX(b.dimension) as dimension, 
            MAX(b.spec) as spec, 
            MAX(i.unit_price) as unit_price,
            SUM(b.required_qty) as total_required,
            COALESCE(SUM(bic.qty_consumed), 0) as total_consumed
          FROM boms b
          JOIN items i ON b.item_id = i.id
          LEFT JOIN bom_item_consumption bic ON b.id = bic.bom_id
          WHERE b.project_id = ?
          GROUP BY b.item_id
        `,
              )
              .all(projectId) as any[];

            let invMap = new Map();
            if (boms.length > 0) {
              const itemIds = [...new Set(boms.map((b) => b.item_id))];
              const placeholders = itemIds.map(() => "?").join(",");
              const inventory = db
                .prepare(
                  `SELECT item_id, free_stock FROM inventory WHERE item_id IN (${placeholders})`,
                )
                .all(...itemIds) as any[];
              invMap = new Map(inventory.map((i) => [i.item_id, i.free_stock]));
            }

            // FIX: Account for item_id specifically ordered for THIS project in current PRs or POs
            const currentProjectSupply = db
              .prepare(
                `
          SELECT item_id, SUM(qty) as total_qty FROM (
            SELECT pri.item_id, pri.qty 
            FROM pr_items pri
            JOIN purchase_requests pr ON pri.pr_id = pr.id
            WHERE pr.project_id = ? AND pr.status IN ('DRAFTED', 'AUTHORIZED') AND pri.po_id IS NULL
            UNION ALL
            SELECT pri.item_id, pri.qty
            FROM pr_items pri
            JOIN purchase_requests pr ON pri.pr_id = pr.id
            JOIN purchase_orders po ON pri.po_id = po.id
            WHERE pr.project_id = ? AND po.archived = 0 AND po.status IN ('ISSUED', 'PARTIAL')
          ) GROUP BY item_id
        `,
              )
              .all(projectId, projectId) as any[];
            const projectSupplyMap = new Map(
              currentProjectSupply.map((s) => [s.item_id, s.total_qty]),
            );

            if (Array.isArray(customItems) && customItems.length > 0) {
              itemsToPr = customItems.filter((it) => it.qty_to_order > 0);
            } else {
              // Automatic logic
              for (const bom of boms) {
                const required = bom.total_required;
                const consumed = bom.total_consumed;
                const stock = invMap.get(bom.item_id) || 0;
                const pipeSupply = projectSupplyMap.get(bom.item_id) || 0;

                const remainingToBuild = Math.max(0, required - consumed);

                // Shortage is remaining need minus (free stock + what we already have in pipe for this project)
                let shortage = Math.max(
                  0,
                  remainingToBuild - (stock + pipeSupply),
                );

                if (shortage > 0) {
                  itemsToPr.push({
                    item_id: bom.item_id,
                    dimension: bom.dimension,
                    spec: bom.spec,
                    unit_price: bom.unit_price,
                    qty_to_order: shortage,
                    expected_delivery_date:
                      item_expected_dates[bom.item_id] ||
                      expected_delivery_date,
                  });
                }
              }
            }

            if (itemsToPr.length > 0) {
              prId = "PR-" + Math.random().toString(36).substr(2, 9);
              prNumber =
                "PR-" +
                new Date().getFullYear() +
                "-" +
                Math.floor(100000 + Math.random() * 900000);

              let deliveryDateStr = expected_delivery_date;
              if (!deliveryDateStr) {
                const d = new Date();
                d.setDate(d.getDate() + 14);
                deliveryDateStr = d.toISOString().split("T")[0];
              }

              db.prepare(
                "INSERT INTO purchase_requests (id, pr_number, project_id, drawing_reference, status, urgency) VALUES (?, ?, ?, ?, 'DRAFTED', ?)",
              ).run(
                prId,
                prNumber,
                projectId,
                drawing_reference || null,
                urgency || "NORMAL",
              );

              if (urgency === "URGENT" || urgency === "CRITICAL") {
                const threadId = "THREAD-GENERAL";
                const msgId = "SYS-" + Math.random().toString(36).substr(2, 9);
                const projectName = db
                  .prepare("SELECT name FROM projects WHERE id = ?")
                  .get(projectId) as { name: string };
                db.prepare(
                  "INSERT INTO chat_messages (id, thread_id, sender_username, content) VALUES (?, ?, ?, ?)",
                ).run(
                  msgId,
                  threadId,
                  "SYSTEM",
                  `⚠️ **Urgent Procurement Alert!** ⚠️\n\n**Urgency:** 🚨 ${urgency}\n**Project:** 🏗️ ${projectName?.name || "Unknown"}\n**PR Number:** 📜 ${prNumber}\n\nImmediate attention required! ⚡`,
                );
              }

              const insertPrItem = db.prepare(
                "INSERT INTO pr_items (id, pr_id, item_id, dimension, spec, qty, unit_price, expected_delivery_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
              );
              const insertTask = db.prepare(
                "INSERT INTO project_tasks (id, project_id, task_name, start_date, end_date, progress, status, pr_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
              );

              for (const item of itemsToPr) {
                insertPrItem.run(
                  "PRI-" + Math.random().toString(36).substr(2, 9),
                  prId,
                  item.item_id,
                  item.dimension || null,
                  item.spec || null,
                  item.qty_to_order,
                  item.unit_price || 0,
                  item.expected_delivery_date || null,
                );
              }

              // Generate Gantt tasks
              if (projectId !== "GENERAL") {
                const todayStr = new Date().toISOString().split("T")[0];
                const itemsWithDeliveries = itemsToPr.filter(
                  (i) => i.expected_delivery_date,
                );

                if (itemsWithDeliveries.length > 0) {
                  const deliveryGroups = new Map();
                  for (const i of itemsWithDeliveries) {
                    if (!deliveryGroups.has(i.expected_delivery_date))
                      deliveryGroups.set(i.expected_delivery_date, []);
                    deliveryGroups.get(i.expected_delivery_date).push(i);
                  }

                  for (const [date, grp] of deliveryGroups.entries()) {
                    const taskId =
                      "TSK-" + Math.random().toString(36).substr(2, 9);
                    // Fetch item code for task name
                    let names = [];
                    for (const g of grp) {
                      const itm = db
                        .prepare("SELECT item_code FROM items WHERE id = ?")
                        .get(g.item_id) as any;
                      if (itm) names.push(itm.item_code);
                    }
                    let details = names.join(", ");
                    if (details.length > 40)
                      details = details.substring(0, 37) + "...";
                    insertTask.run(
                      taskId,
                      projectId,
                      `Materials: ${details}`,
                      todayStr,
                      date,
                      0,
                      "PENDING",
                      prId,
                    );
                  }
                } else {
                  const taskId =
                    "TSK-" + Math.random().toString(36).substr(2, 9);
                  insertTask.run(
                    taskId,
                    projectId,
                    `Material Procurement (PR Generated)`,
                    todayStr,
                    deliveryDateStr,
                    0,
                    "PENDING",
                    prId,
                  );
                }
              }
            }

            return {
              success: true,
              pr_created: itemsToPr.length > 0,
              pr_number: prNumber,
            };
          });

          const result = transaction();
          res.json(result);
        } catch (error: any) {
          console.error(error);
          res
            .status(500)
            .json({ error: error.message || "Failed to generate PRs" });
        }
      },
    );

    // Finish Project & Release Stock
    app.post(
      "/api/projects/:id/finish",
      requireRole(["ENGINEERING", "PRODUCTION"]),
      (req, res) => {
        try {
          const projectId = req.params.id;

          const transaction = db.transaction(() => {
            // 1. Update Project Status & Auto-Archive
            db.prepare(
              "UPDATE projects SET status = 'FINISHED' WHERE id = ?",
            ).run(projectId);

            // 2. Automagically transition related undelivered delivery notes to DELIVERED status for billing readiness
            db.prepare(
              "UPDATE delivery_notes SET status = 'DELIVERED', delivered_at = CURRENT_TIMESTAMP WHERE project_id = ? AND status != 'DELIVERED'",
            ).run(projectId);

            logAudit(
              null,
              "FINISH_PROJECT",
              "PROJECT",
              projectId,
              "Project finished, archived, and related delivery notes updated to DELIVERED status.",
            );
          });

          transaction();
          res.json({ success: true });
        } catch (error) {
          console.error(error);
          res.status(500).json({ error: "Failed to finish project" });
        }
      },
    );

    // Archive project
    app.post(
      "/api/projects/:id/archive",
      requireRole(["ENGINEERING", "FC", "SALES"]),
      (req, res) => {
        const userRole = (req as any).userRole;
        const userLevel = (req as any).userLevel;
        if (
          userRole !== "FC" &&
          userLevel !== "MANAGER"
        ) {
          return res
            .status(403)
            .json({ error: "Access denied. Only FC or Engineering/Sales Manager can archive projects." });
        }
        try {
          const projectId = req.params.id;
          const project = db
            .prepare("SELECT * FROM projects WHERE id = ?")
            .get(projectId) as any;
          if (!project)
            return res.status(404).json({ error: "Project not found" });

          db.prepare(
            "UPDATE projects SET archived_at = CURRENT_TIMESTAMP WHERE id = ?",
          ).run(projectId);

          logAudit(
            (req.headers["x-user-email"] as string) || null,
            "ARCHIVE_PROJECT",
            "PROJECT",
            projectId,
            "Project manually archived.",
          );
          res.json({ success: true });
        } catch (error) {
          console.error(error);
          res.status(500).json({ error: "Failed to archive project" });
        }
      },
    );

    // Global helper for quotation expiration
    function checkQuotationExpired(quotation: any) {
      if (!quotation) return true;
      if (quotation.status === "PROCESSED") return false;
      if (quotation.status === "EXPIRED") return true;
      const createdDate = new Date(quotation.created_at);
      const now = new Date();
      const diffTime = Math.abs(now.getTime() - createdDate.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      return diffDays > (quotation.validity_days || 20);
    }

    // Create new project
    app.post(
      "/api/projects",
      requireRole(["ENGINEERING", "FC"]),
      (req, res) => {
        const userRole = (req as any).userRole;
        const userLevel = (req as any).userLevel;
        if (
          userRole !== "FC" &&
          (userRole !== "ENGINEERING" || userLevel !== "MANAGER")
        ) {
          return res
            .status(403)
            .json({
              error:
                "Access denied. Only Engineering Managers or FC accounts can create Projects.",
            });
        }
        try {
          const {
            id,
            name,
            due_date,
            customer,
            remarks,
            tasks,
            parent_project_id,
            urgency,
            quotation_id,
          } = req.body;

          if (!quotation_id) {
            return res
              .status(400)
              .json({
                error: "Quotation reference is required to create a project",
              });
          }
          const quotation = db
            .prepare("SELECT * FROM quotations WHERE id = ?")
            .get(quotation_id) as any;
          if (!quotation) {
            return res
              .status(400)
              .json({ error: "Referenced Quotation not found" });
          }
          
          if (quotation.status !== "APPROVED") {
            return res
              .status(400)
              .json({ error: "Referenced Quotation is not APPROVED yet" });
          }

          if (checkQuotationExpired(quotation)) {
            db.prepare(
              "UPDATE quotations SET status = 'EXPIRED' WHERE id = ?",
            ).run(quotation_id);
            return res
              .status(400)
              .json({
                error:
                  "Referenced Quotation has expired and is no longer valid for project creation",
              });
          }

          const customerObj = db
            .prepare("SELECT name FROM customers WHERE id = ?")
            .get(quotation.customer_id) as any;
          const finalCustomer =
            customerObj?.name || customer || quotation.customer_id;

          let projectId =
            id?.trim() ||
            "PRJ-" + Math.random().toString(36).substr(2, 9).toUpperCase();

          const checkStmt = db.prepare("SELECT id FROM projects WHERE id = ?");
          let counter = 1;
          let originalId = projectId;
          while (checkStmt.get(projectId)) {
            projectId = `${originalId}-${counter}`;
            counter++;
          }

          const spkId =
            "SPK-" + Math.random().toString(36).substr(2, 6).toUpperCase();
          const dParts = new Date().toISOString().split("T")[0].split("-");
          const spkNumber = `SPK/${dParts[0]}/${Math.floor(Math.random() * 1000)
            .toString()
            .padStart(3, "0")}/${spkId.substring(4, 6)}`;
          const spkTitle = `SPK for Project - ${name}`;

          const transaction = db.transaction(() => {
            const quotationItems = db
              .prepare("SELECT * FROM quotation_items WHERE quotation_id = ?")
              .all(quotation_id) as any[];
            const totalQty =
              quotationItems.length > 0
                ? quotationItems.reduce((sum, it) => sum + (it.qty || 1), 0)
                : 1;
            const firstUom = quotationItems[0]?.uom || "Unit";

            // Projects start as PENDING_NTP (Active only after NTP issuance)
            db.prepare(
              "INSERT INTO projects (id, name, due_date, customer, remarks, parent_project_id, urgency, quotation_id, spk_id, status, qty, uom) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            ).run(
              projectId,
              name,
              due_date,
              finalCustomer,
              remarks,
              parent_project_id || null,
              urgency || "NORMAL",
              quotation_id,
              spkId,
              "PENDING_NTP",
              totalQty,
              firstUom,
            );

            // Create SPK
            db.prepare(
              `
          INSERT INTO spks (id, spk_number, project_id, quotation_id, title)
          VALUES (?, ?, ?, ?, ?)
        `,
            ).run(spkId, spkNumber, projectId, quotation_id, spkTitle);

            // Mark Quotation as processed
            db.prepare(
              "UPDATE quotations SET status = 'PROCESSED' WHERE id = ?",
            ).run(quotation_id);

            // Auto-create NTP
            const ntpId =
              "NTP-" + Math.random().toString(36).substr(2, 9).toUpperCase();
            const ntpNumber = `NTP/${new Date().getFullYear()}/${Math.floor(
              Math.random() * 10000,
            )
              .toString()
              .padStart(4, "0")}`;
            db.prepare(
              "INSERT INTO ntps (id, ntp_number, project_id, quotation_id, created_at, status) VALUES (?, ?, ?, ?, ?, 'ISSUED')",
            ).run(
              ntpId,
              ntpNumber,
              projectId,
              quotation_id,
              new Date().toISOString(),
            );
            db.prepare(
              "UPDATE projects SET status = 'ACTIVE', ntp_id = ? WHERE id = ?",
            ).run(ntpId, projectId);

            // Broadcast to Forum
            const msgId = "MSG-" + Math.random().toString(36).substr(2, 9);
            db.prepare(
              `
          INSERT INTO chat_messages (id, thread_id, sender_username, content) 
          VALUES (?, ?, ?, ?)
        `,
            ).run(
              msgId,
              "THREAD-GENERAL",
              (req.headers["x-user-email"] as string) || "system",
              `🚀 **Pekerjaan Proyek Dimulai!** 🚀\n\n**NTP:** ${ntpNumber}\n**Proyek:** ${name} (${projectId})\n**Klien:** 🏢 ${finalCustomer}\n\nNTP telah resmi diterbitkan. Proyek kini berstatus ACTIVE dan sah dikerjakan.`,
            );

            // Inherit BOM if parent project exists
            if (parent_project_id) {
              const parentBoms = db
                .prepare(
                  "SELECT item_id, dimension, spec, required_qty, unit_price, reference FROM boms WHERE project_id = ?",
                )
                .all(parent_project_id) as any[];
              const bomInsert = db.prepare(`
            INSERT INTO boms (id, project_id, item_id, dimension, spec, required_qty, unit_price, reference)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `);
              for (const item of parentBoms) {
                bomInsert.run(
                  "BOM-" + Math.random().toString(36).substr(2, 9),
                  projectId,
                  item.item_id,
                  item.dimension,
                  item.spec,
                  item.required_qty,
                  item.unit_price,
                  item.reference,
                );
              }

              // Initial consumption records for new BOM
              const newBoms = db
                .prepare("SELECT id FROM boms WHERE project_id = ?")
                .all(projectId) as { id: string }[];
              for (const b of newBoms) {
                db.prepare(
                  "INSERT INTO bom_item_consumption (id, bom_id, qty_consumed) VALUES (?, ?, ?)",
                ).run(
                  "BIC-" + Math.random().toString(36).substr(2, 9),
                  b.id,
                  0,
                );
              }
            }

            if (Array.isArray(tasks) && tasks.length > 0) {
              const taskInsert = db.prepare(`
            INSERT INTO project_tasks (id, project_id, task_name, work_center_id, required_hours, start_date, end_date, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `);
              for (const task of tasks) {
                const taskId = "TSK-" + Math.random().toString(36).substr(2, 9);
                taskInsert.run(
                  taskId,
                  projectId,
                  task.task_name,
                  task.work_center_id,
                  task.required_hours || 0,
                  task.start_date,
                  task.end_date,
                  "PENDING",
                );
              }
            } else if (parent_project_id) {
              // Inherit tasks from parent if none provided
              const parentTasks = db
                .prepare(
                  "SELECT task_name, work_center_id, required_hours FROM project_tasks WHERE project_id = ?",
                )
                .all(parent_project_id) as any[];
              const taskInsert = db.prepare(`
            INSERT INTO project_tasks (id, project_id, task_name, work_center_id, required_hours, start_date, end_date, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `);
              const todayStr = new Date().toISOString().split("T")[0];
              const nextWeekStr = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
                .toISOString()
                .split("T")[0];
              for (const task of parentTasks) {
                const taskId = "TSK-" + Math.random().toString(36).substr(2, 9);
                taskInsert.run(
                  taskId,
                  projectId,
                  task.task_name,
                  task.work_center_id,
                  task.required_hours,
                  todayStr,
                  nextWeekStr,
                  "PENDING",
                );
              }
            }
          });

          transaction();

          const ntpDoc = db
            .prepare("SELECT * FROM ntps WHERE project_id = ?")
            .get(projectId);
          logAudit(
            (req.headers["x-user-email"] as string) || null,
            "CREATE_PROJECT",
            "PROJECT",
            projectId,
            `Created project ${name} referenced to quotation ${quotation.quotation_number}`,
          );
          res.json({ success: true, data: { id: projectId, ntp: ntpDoc } });
        } catch (err: any) {
          console.error(err);
          res
            .status(500)
            .json({ error: "Failed to create project", details: err.message });
        }
      },
    );

    // Issue Notice to Proceed (NTP)
    app.post(
      "/api/projects/:id/ntp",
      requireRole(["ENGINEERING", "FC", "SALES"]),
      (req, res) => {
        try {
          const { id } = req.params;
          const project = db
            .prepare("SELECT * FROM projects WHERE id = ?")
            .get(id) as any;
          if (!project)
            return res.status(404).json({ error: "Project not found" });

          const ntpId =
            "NTP-" + Math.random().toString(36).substr(2, 6).toUpperCase();
          const dParts = new Date().toISOString().split("T")[0].split("-");
          const ntpNumber = `NTP/${dParts[0]}/${Math.floor(Math.random() * 1000)
            .toString()
            .padStart(3, "0")}/${ntpId.substring(4, 6)}`;

          const transaction = db.transaction(() => {
            db.prepare(
              `
          INSERT INTO ntps (id, ntp_number, project_id, quotation_id, status)
          VALUES (?, ?, ?, ?, 'ISSUED')
        `,
            ).run(ntpId, ntpNumber, id, project.quotation_id);

            db.prepare(
              "UPDATE projects SET status = 'ACTIVE', ntp_id = ? WHERE id = ?",
            ).run(ntpId, id);

            // Automatic broadcast to forum
            const userEmail =
              (req.headers["x-user-email"] as string) || "system";
            const userObj = db
              .prepare(
                "SELECT username, name, role FROM users WHERE username = ? OR id = ?",
              )
              .get(userEmail, userEmail) as any;
            const author = userObj?.username || "system";
            const authorRole = userObj?.role || "FC";

            const forumId = "POST-" + Math.random().toString(36).substr(2, 9);
            db.prepare(
              `
          INSERT INTO forum_posts (id, title, content, author_username, author_role, category, shared_resource_type, shared_resource_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
            ).run(
              forumId,
              `Broadcast: Project Activation - ${project.name}`,
              `Notice to Proceed (NTP) has been officially issued for project **${project.name}** (NTP No: ${ntpNumber}). 
          
The project is now set to **ACTIVE** and manufacturing processes (PR, PO, Production) are cleared to proceed. 
Referenced Quotation ID: ${project.quotation_id || "N/A"}.`,
              author,
              authorRole,
              "ANNOUNCEMENT",
              "PROJECT",
              id,
            );

            // Also add to chat if it exists
            const messageId = "MSG-" + Math.random().toString(36).substr(2, 9);
            db.prepare(
              `
          INSERT INTO chat_messages (id, thread_id, sender_username, content)
          VALUES (?, 'THREAD-GENERAL', ?, ?)
        `,
            ).run(
              messageId,
              author,
              `📢 **NTP ISSUED**: Project [${project.name}] is now ACTIVE. (Ref: ${ntpNumber})`,
            );
          });

          transaction();

          logAudit(
            (req.headers["x-user-email"] as string) || null,
            "ISSUE_NTP",
            "PROJECT",
            id,
            `Issued NTP ${ntpNumber} for project ${project.name}`,
          );
          res.json({
            success: true,
            data: { ntp_id: ntpId, ntp_number: ntpNumber },
          });
        } catch (err: any) {
          console.error(err);
          res
            .status(500)
            .json({ error: "Failed to issue NTP", details: err.message });
        }
      },
    );

    app.get("/api/ntps", (req, res) => {
      try {
        const ntps = db
          .prepare(
            `
        SELECT n.*, p.name as project_name, q.quotation_number
        FROM ntps n
        LEFT JOIN projects p ON n.project_id = p.id
        LEFT JOIN quotations q ON n.quotation_id = q.id
        ORDER BY n.created_at DESC
      `,
          )
          .all();
        res.json({ success: true, data: ntps });
      } catch (err: any) {
        console.error(err);
        res
          .status(500)
          .json({ error: "Failed to fetch NTPs", details: err.message });
      }
    });

    // Bulk create projects
    app.post(
      "/api/projects/bulk",
      requireRole(["ENGINEERING", "FC"]),
      (req, res) => {
        const userRole = (req as any).userRole;
        const userLevel = (req as any).userLevel;
        if (
          userRole !== "FC" &&
          (userRole !== "ENGINEERING" || userLevel !== "MANAGER")
        ) {
          return res
            .status(403)
            .json({ error: "Access denied. Only FC or Engineering Manager can bulk create projects." });
        }
        try {
          const { common, projects } = req.body;
        if (!Array.isArray(projects) || projects.length === 0) {
          return res.status(400).json({ error: "No projects provided" });
        }

        if (!common.quotation_id) {
          return res
            .status(400)
            .json({
              error:
                "Common Quotation reference is required for bulk project creation",
            });
        }

        const quotation = db
          .prepare("SELECT * FROM quotations WHERE id = ?")
          .get(common.quotation_id) as any;
        if (!quotation) {
          return res
            .status(400)
            .json({ error: "Referenced Quotation not found" });
        }
        
        if (quotation.status !== "APPROVED") {
          return res
            .status(400)
            .json({ error: "Referenced Quotation is not APPROVED yet" });
        }

        if (checkQuotationExpired(quotation)) {
          db.prepare(
            "UPDATE quotations SET status = 'EXPIRED' WHERE id = ?",
          ).run(common.quotation_id);
          return res
            .status(400)
            .json({ error: "Referenced Quotation has expired" });
        }

        const transaction = db.transaction(() => {
          // Mark Quotation as processed
          db.prepare(
            "UPDATE quotations SET status = 'PROCESSED' WHERE id = ?",
          ).run(common.quotation_id);

          const projectInsert = db.prepare(
            "INSERT INTO projects (id, name, due_date, customer, remarks, parent_project_id, urgency, quotation_id, status, qty, uom) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          );
          const bomSelect = db.prepare(
            "SELECT item_id, dimension, spec, required_qty, unit_price, reference FROM boms WHERE project_id = ?",
          );
          const bomInsert = db.prepare(`
          INSERT INTO boms (id, project_id, item_id, dimension, spec, required_qty, unit_price, reference)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
          const consumptionInsert = db.prepare(
            "INSERT INTO bom_item_consumption (id, bom_id, qty_consumed) VALUES (?, ?, ?)",
          );
          const existStmt = db.prepare("SELECT id FROM projects WHERE id = ?");

          const quotationItems = db
            .prepare("SELECT * FROM quotation_items WHERE quotation_id = ?")
            .all(common.quotation_id) as any[];
          const totalQty =
            quotationItems.length > 0
              ? quotationItems.reduce((sum, it) => sum + (it.qty || 1), 0)
              : 1;
          const firstUom = quotationItems[0]?.uom || "Unit";

          for (const p of projects) {
            let pId =
              p.id?.trim() ||
              "PRJ-" + Math.random().toString(36).substr(2, 9).toUpperCase();

            let counter = 1;
            let originalPId = pId;
            while (existStmt.get(pId)) {
              pId = `${originalPId}-${counter}`;
              counter++;
            }

            const parentId = p.parent_project_id || common.parent_project_id;

            const spkId =
              "SPK-" + Math.random().toString(36).substr(2, 6).toUpperCase();
            const dParts = new Date().toISOString().split("T")[0].split("-");
            const spkNumber = `SPK/${dParts[0]}/${Math.floor(
              Math.random() * 1000,
            )
              .toString()
              .padStart(3, "0")}/${spkId.substring(4, 6)}`;

            const projectQty = p.qty || totalQty;
            const projectUom = p.uom || firstUom;

            projectInsert.run(
              pId,
              p.name,
              common.due_date,
              common.customer,
              p.remarks || common.remarks,
              parentId || null,
              common.urgency || "NORMAL",
              common.quotation_id,
              "ACTIVE",
              projectQty,
              projectUom,
            );

            db.prepare(
              `INSERT INTO spks (id, spk_number, project_id, quotation_id, title) VALUES (?, ?, ?, ?, ?)`,
            ).run(
              spkId,
              spkNumber,
              pId,
              common.quotation_id,
              `SPK for Project - ${p.name}`,
            );

            const ntpId =
              "NTP-" + Math.random().toString(36).substr(2, 9).toUpperCase();
            const ntpNumber = `NTP/${new Date().getFullYear()}/${Math.floor(
              Math.random() * 10000,
            )
              .toString()
              .padStart(4, "0")}`;
            db.prepare(
              "INSERT INTO ntps (id, ntp_number, project_id, quotation_id, created_at, status) VALUES (?, ?, ?, ?, ?, 'ISSUED')",
            ).run(
              ntpId,
              ntpNumber,
              pId,
              common.quotation_id,
              new Date().toISOString(),
            );
            db.prepare("UPDATE projects SET ntp_id = ? WHERE id = ?").run(
              ntpId,
              pId,
            );

            if (parentId) {
              const parentBoms = bomSelect.all(parentId) as any[];
              for (const item of parentBoms) {
                const bomId = "BOM-" + Math.random().toString(36).substr(2, 9);
                bomInsert.run(
                  bomId,
                  pId,
                  item.item_id,
                  item.dimension,
                  item.spec,
                  item.required_qty,
                  item.unit_price,
                  item.reference,
                );
                consumptionInsert.run(
                  "BIC-" + Math.random().toString(36).substr(2, 9),
                  bomId,
                  0,
                );
              }
            }

            logAudit(
              req.headers["x-user-email"] as string,
              "BULK_CREATE_PROJECT",
              "PROJECT",
              pId,
              `Project ${p.name} created via bulk.`,
            );

            // Broadcast to Forum
            const msgId = "MSG-" + Math.random().toString(36).substr(2, 9);
            db.prepare(
              `
            INSERT INTO chat_messages (id, thread_id, sender_username, content) 
            VALUES (?, ?, ?, ?)
          `,
            ).run(
              msgId,
              "THREAD-GENERAL",
              "SYSTEM",
              `📦 **Bulk Project Created!** 📦\n\n**Project Name:** ${p.name}\n**Client:** 🏢 ${common.customer || "N/A"}\n**Target Date:** 📅 ${common.due_date}\n\nReady for action! ⚡`,
            );
          }
        });

        let firstProjectId = null;
        transaction();
        try {
          // To easily grab the first project id if we need to
          const firstProjName = projects[0]?.name;
          firstProjectId = db
            .prepare(
              "SELECT id FROM projects WHERE name = ? ORDER BY created_at DESC LIMIT 1",
            )
            .get(firstProjName) as any;
        } catch (e) {}

        const ntpDoc = firstProjectId
          ? db
              .prepare("SELECT * FROM ntps WHERE project_id = ?")
              .get(firstProjectId.id)
          : null;
        res.json({
          success: true,
          count: projects.length,
          data: { ntp: ntpDoc },
        });
      } catch (error: any) {
        console.error(error);
        res
          .status(500)
          .json({
            error: "Failed to create projects in bulk",
            details: error.message,
          });
      }
    });

    // Get all items
    app.get("/api/items", (req, res) => {
      try {
        const items = db.prepare("SELECT * FROM items WHERE 1=1").all();
        res.json(items);
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to fetch items" });
      }
    });

    // Get single item by code
    app.get("/api/items/code/:code", (req, res) => {
      try {
        const item = db
          .prepare("SELECT * FROM items WHERE item_code = ?")
          .get(req.params.code);
        if (!item) return res.status(404).json({ error: "Item not found" });
        res.json(item);
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to fetch item" });
      }
    });

    // Search items by query
    app.get("/api/items/search", (req, res) => {
      try {
        const q = req.query.q as string;
        if (!q) return res.json([]);
        const searchTerm = `%${q}%`;
        const items = db
          .prepare(
            `
        SELECT i.*, 
               COALESCE(inv.free_stock, 0) as free_stock, 
               COALESCE(inv.allocated_stock, 0) as allocated_stock
        FROM items i
        LEFT JOIN inventory inv ON i.id = inv.item_id
        WHERE i.name LIKE ? OR i.item_code LIKE ? OR i.dimension LIKE ? OR i.spec LIKE ?
        LIMIT 50
      `,
          )
          .all(searchTerm, searchTerm, searchTerm, searchTerm);
        res.json(items);
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Search failed" });
      }
    });

    // Create new item
    app.post(
      "/api/items",
      requireRole(["ENGINEERING", "PURCHASING", "WAREHOUSE"]),
      (req, res) => {
        try {
          const { item_code, name, uom, dimension, spec, type, unit_price } =
            req.body;
          const itemId =
            "ITEM-" + Math.random().toString(36).substr(2, 5).toUpperCase();

          const transaction = db.transaction(() => {
            db.prepare(
              "INSERT INTO items (id, item_code, name, uom, dimension, spec, type, unit_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            ).run(
              itemId,
              item_code,
              name,
              uom,
              dimension || "",
              spec || "",
              type || "RAW",
              unit_price || 0,
            );
            db.prepare(
              "INSERT INTO inventory (item_id, free_stock, allocated_stock) VALUES (?, 0, 0)",
            ).run(itemId);
          });

          transaction();
          res.json({ success: true, id: itemId });
        } catch (error: any) {
          console.error(error);
          if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
            return res.status(400).json({ error: "Item Code already exists" });
          }
          res.status(500).json({ error: "Failed to create item" });
        }
      },
    );

    // Update item details
    app.put(
      "/api/items/:id",
      requireRole(["ENGINEERING", "PURCHASING", "WAREHOUSE"]),
      (req, res) => {
        try {
          const { item_code, name, uom, type } = req.body;
          db.prepare(
            "UPDATE items SET item_code = ?, name = ?, uom = ?, type = ? WHERE id = ?",
          ).run(item_code, name, uom, type || "RAW", req.params.id);
          res.json({ success: true });
        } catch (error: any) {
          console.error(error);
          if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
            return res.status(400).json({ error: "Item Code already exists" });
          }
          res.status(500).json({ error: "Failed to update item" });
        }
      },
    );

    // Soft delete item
    app.delete(
      "/api/items/:id",
      requireRole(["ENGINEERING", "PURCHASING"]),
      (req, res) => {
        try {
          db.transaction(() => {
            const id = req.params.id;
            db.prepare("DELETE FROM pr_items WHERE item_id = ?").run(id);
            db.prepare("DELETE FROM grn_items WHERE item_id = ?").run(id);
            db.prepare("DELETE FROM bom_template_items WHERE item_id = ?").run(
              id,
            );
            db.prepare(
              "DELETE FROM bom_item_consumption WHERE bom_id IN (SELECT id FROM boms WHERE item_id = ?)",
            ).run(id);
            db.prepare(
              "DELETE FROM work_order_items WHERE bom_id IN (SELECT id FROM boms WHERE item_id = ?)",
            ).run(id);
            db.prepare("DELETE FROM boms WHERE item_id = ?").run(id);
            db.prepare("DELETE FROM stock_movements WHERE item_id = ?").run(id);
            db.prepare("DELETE FROM item_price_history WHERE item_id = ?").run(
              id,
            );
            db.prepare("DELETE FROM inventory_labels WHERE item_id = ?").run(
              id,
            );
            db.prepare("DELETE FROM inventory WHERE item_id = ?").run(id);
            db.prepare("DELETE FROM items WHERE id = ?").run(id);
          })();
          res.json({ success: true });
        } catch (error) {
          console.error(error);
          res.status(500).json({ error: "Failed to delete item" });
        }
      },
    );

    // Get full inventory (including zero stock)
    app.get(
      "/api/inventory/full",
      requireRole(["WAREHOUSE", "PURCHASING", "PRODUCTION", "ENGINEERING"]),
      (req, res) => {
        try {
          const inventory = db
            .prepare(
              `
        SELECT i.*, 
               COALESCE(inv.free_stock, 0) as free_stock, 
               COALESCE(inv.allocated_stock, 0) as allocated_stock
        FROM items i
        LEFT JOIN inventory inv ON i.id = inv.item_id
        WHERE 1=1
        ORDER BY i.item_code ASC
      `,
            )
            .all();
          res.json(inventory);
        } catch (error) {
          console.error(error);
          res.status(500).json({ error: "Failed to fetch full inventory" });
        }
      },
    );

    app.get(
      "/api/inventory/supplier-prices",
      requireRole(["PURCHASING", "ENGINEERING", "PRODUCTION"]),
      (req, res) => {
        try {
          const prices = db
            .prepare(
              `
        SELECT isp.*, s.name as supplier_name, s.code as supplier_code, i.item_code
        FROM item_supplier_prices isp
        JOIN suppliers s ON isp.supplier_id = s.id
        JOIN items i ON isp.item_id = i.id
        ORDER BY i.item_code ASC, isp.unit_price ASC
      `,
            )
            .all();
          res.json(prices);
        } catch (error) {
          console.error(error);
          res
            .status(500)
            .json({ error: "Failed to fetch all supplier prices" });
        }
      },
    );

    app.get(
      "/api/inventory/items/:id/supplier-prices",
      requireRole(["PURCHASING", "ENGINEERING", "PRODUCTION"]),
      (req, res) => {
        try {
          const { id } = req.params;
          const prices = db
            .prepare(
              `
        SELECT isp.*, s.name as supplier_name, s.code as supplier_code
        FROM item_supplier_prices isp
        JOIN suppliers s ON isp.supplier_id = s.id
        WHERE isp.item_id = ?
        ORDER BY isp.updated_at DESC
      `,
            )
            .all(id);
          res.json(prices);
        } catch (error) {
          console.error(error);
          res
            .status(500)
            .json({ error: "Failed to fetch item supplier prices" });
        }
      },
    );

    app.put(
      "/api/inventory/items/:id/supplier-prices",
      requireRole(["PURCHASING"]),
      (req, res) => {
        try {
          const { id } = req.params;
          const { supplier_id, unit_price } = req.body;
          const email = (req.headers["x-user-email"] as string) || "system";

          if (!supplier_id || !unit_price) {
            return res
              .status(400)
              .json({ error: "Supplier ID and Unit Price are required" });
          }

          db.transaction(() => {
            // 1. Upsert into item_supplier_prices
            db.prepare(
              `
          INSERT INTO item_supplier_prices (item_id, supplier_id, unit_price, updated_at)
          VALUES (?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(item_id, supplier_id) DO UPDATE SET
            unit_price = excluded.unit_price,
            updated_at = excluded.updated_at
        `,
            ).run(id, supplier_id, unit_price);

            // 2. Also log to history
            db.prepare(
              `
          INSERT INTO item_price_history (id, item_id, supplier_id, unit_price, recorded_by)
          VALUES (?, ?, ?, ?, ?)
        `,
            ).run(
              "IPH-" + Math.random().toString(36).substr(2, 9),
              id,
              supplier_id,
              unit_price,
              email,
            );

            // 3. Update the global "last price" in items table (optional but good for backwards compatibility)
            db.prepare("UPDATE items SET unit_price = ? WHERE id = ?").run(
              unit_price,
              id,
            );

            // 4. Update BOMs of active projects
            db.prepare(
              `
          UPDATE boms 
          SET unit_price = ? 
          WHERE item_id = ? 
          AND project_id IN (SELECT id FROM projects WHERE status NOT IN ('FINISHED', 'CLOSED', 'CANCELLED'))
        `,
            ).run(unit_price, id);
          })();

          res.json({ success: true });
        } catch (error) {
          console.error(error);
          res.status(500).json({ error: "Failed to update supplier price" });
        }
      },
    );

    // Get suppliers that have prices for ALL given items (or partial matches if requested)
    app.get(
      "/api/purchasing/suppliers-by-items",
      requireRole(["PURCHASING", "FC"]),
      (req, res) => {
        try {
          const { item_ids, allow_partial } = req.query; // Expecting comma separated string
          if (!item_ids) {
            // If no items specified, return all suppliers as fallback
            const allSuppliers = db
              .prepare(
                `
          SELECT s.*,
            (
              SELECT COUNT(g.id) 
              FROM grns g 
              JOIN purchase_orders po ON po.id = g.po_id 
              WHERE po.supplier_id = s.id AND g.qc_status = 'REJECTED'
            ) as rejected_count,
            (
              SELECT COUNT(g.id) 
              FROM grns g 
              JOIN purchase_orders po ON po.id = g.po_id 
              WHERE po.supplier_id = s.id AND g.qc_status = 'PASSED'
            ) as passed_count,
            (
              SELECT COUNT(po.id)
              FROM purchase_orders po
              WHERE po.supplier_id = s.id
            ) as total_orders
          FROM suppliers s
          ORDER BY s.name
        `,
              )
              .all();
            return res.json(allSuppliers);
          }

          const itemIdsArray = (item_ids as string).split(",");
          const placeholders = itemIdsArray.map(() => "?").join(",");

          let suppliers;
          if (allow_partial === "true") {
            // Return suppliers that have pricing for AT LEAST ONE item in the list
            suppliers = db
              .prepare(
                `
          SELECT s.*,
            (
              SELECT COUNT(g.id) 
              FROM grns g 
              JOIN purchase_orders po ON po.id = g.po_id 
              WHERE po.supplier_id = s.id AND g.qc_status = 'REJECTED'
            ) as rejected_count,
            (
              SELECT COUNT(g.id) 
              FROM grns g 
              JOIN purchase_orders po ON po.id = g.po_id 
              WHERE po.supplier_id = s.id AND g.qc_status = 'PASSED'
            ) as passed_count,
            (
              SELECT COUNT(po.id)
              FROM purchase_orders po
              WHERE po.supplier_id = s.id
            ) as total_orders
          FROM suppliers s
          WHERE s.id IN (
            SELECT supplier_id 
            FROM item_supplier_prices 
            WHERE item_id IN (${placeholders})
          )
          ORDER BY s.name ASC
        `,
              )
              .all(...itemIdsArray) as any[];
          } else {
            // Find suppliers that have pricing for EVERY item in the list
            suppliers = db
              .prepare(
                `
          SELECT s.*,
            (
              SELECT COUNT(g.id) 
              FROM grns g 
              JOIN purchase_orders po ON po.id = g.po_id 
              WHERE po.supplier_id = s.id AND g.qc_status = 'REJECTED'
            ) as rejected_count,
            (
              SELECT COUNT(g.id) 
              FROM grns g 
              JOIN purchase_orders po ON po.id = g.po_id 
              WHERE po.supplier_id = s.id AND g.qc_status = 'PASSED'
            ) as passed_count,
            (
              SELECT COUNT(po.id)
              FROM purchase_orders po
              WHERE po.supplier_id = s.id
            ) as total_orders
          FROM suppliers s
          WHERE s.id IN (
            SELECT supplier_id 
            FROM item_supplier_prices 
            WHERE item_id IN (${placeholders})
            GROUP BY supplier_id
            HAVING COUNT(DISTINCT item_id) = ?
          )
          ORDER BY s.name ASC
        `,
              )
              .all(...itemIdsArray, itemIdsArray.length) as any[];
          }

          // If no perfect matching or partial matching suppliers found in prices matrix, load all suppliers as fallback
          if (suppliers.length === 0) {
            suppliers = db
              .prepare(
                `
          SELECT s.*,
            0 as rejected_count,
            0 as passed_count,
            0 as total_orders
          FROM suppliers s
          ORDER BY s.name ASC
        `,
              )
              .all() as any[];
          }

          // Now fetch and append the unit prices of these items for each of the matching suppliers
          for (const supplier of suppliers) {
            const prices = db
              .prepare(
                `
          SELECT item_id, unit_price 
          FROM item_supplier_prices 
          WHERE supplier_id = ? AND item_id IN (${placeholders})
        `,
              )
              .all(supplier.id, ...itemIdsArray) as any[];

            supplier.item_prices = prices;
          }

          res.json(suppliers);
        } catch (error) {
          console.error(error);
          res.status(500).json({ error: "Failed to fetch suppliers by items" });
        }
      },
    );

    app.delete(
      "/api/inventory/items/:id/supplier-prices/:supplierId",
      requireRole(["PURCHASING"]),
      (req, res) => {
        try {
          const { id, supplierId } = req.params;

          db.prepare(
            `
        DELETE FROM item_supplier_prices 
        WHERE item_id = ? AND supplier_id = ?
      `,
          ).run(id, supplierId);

          res.json({ success: true });
        } catch (error) {
          console.error(error);
          res.status(500).json({ error: "Failed to delete supplier price" });
        }
      },
    );

    app.put(
      "/api/inventory/items/:id/price",
      requireRole(["PURCHASING"]),
      (req, res) => {
        try {
          const { id } = req.params;
          const { unit_price, supplier_id } = req.body;
          const email = (req.headers["x-user-email"] as string) || "system";

          db.transaction(() => {
            db.prepare("UPDATE items SET unit_price = ? WHERE id = ?").run(
              unit_price,
              id,
            );

            // Sync with BOMs for non-finished projects
            db.prepare(
              `
          UPDATE boms 
          SET unit_price = ? 
          WHERE item_id = ? 
          AND project_id IN (SELECT id FROM projects WHERE status NOT IN ('FINISHED', 'CLOSED', 'CANCELLED'))
        `,
            ).run(unit_price, id);

            // Sync with BOM Templates
            db.prepare(
              "UPDATE bom_template_items SET unit_price = ? WHERE item_id = ?",
            ).run(unit_price, id);

            if (supplier_id) {
              db.prepare(
                `
               INSERT INTO item_price_history (id, item_id, supplier_id, unit_price, recorded_by)
               VALUES (?, ?, ?, ?, ?)
            `,
              ).run(
                "IPH-" + Math.random().toString(36).substr(2, 9),
                id,
                supplier_id,
                unit_price,
                email,
              );
            }
          })();

          res.json({ success: true });
        } catch (error) {
          console.error(error);
          res.status(500).json({ error: "Failed to update price" });
        }
      },
    );

    app.get(
      "/api/inventory/items/:id/price-history",
      requireRole(["PURCHASING", "ENGINEERING", "PRODUCTION"]),
      (req, res) => {
        try {
          const { id } = req.params;
          const history = db
            .prepare(
              `
        SELECT h.unit_price, h.created_at, h.recorded_by, s.name as supplier_name, h.supplier_id
        FROM item_price_history h
        JOIN suppliers s ON h.supplier_id = s.id
        WHERE h.item_id = ?
        ORDER BY h.created_at DESC
      `,
            )
            .all(id) as any[];

          // Calculate lowest price active across all suppliers in chronological order
          const chronHistory = [...history].reverse();
          const latestSupplierPrices: { [key: string]: number } = {};
          const processed = chronHistory.map((record) => {
            latestSupplierPrices[record.supplier_id] = record.unit_price;
            const lowestPrice = Math.min(
              ...Object.values(latestSupplierPrices),
            );
            return {
              ...record,
              actual_unit_price: record.unit_price,
              lowest_price: lowestPrice,
            };
          });

          // Return newest first (desc order)
          res.json(processed.reverse());
        } catch (error) {
          console.error(error);
          res.status(500).json({ error: "Failed to fetch price history" });
        }
      },
    );

    // Update inventory stock (Manual Adjustment)
    app.post(
      "/api/inventory/adjust",
      requireRole(["WAREHOUSE"]),
      (req, res) => {
        try {
          const { item_id, qty, type, item_details } = req.body; // type: 'ADD' or 'SET'

          const transaction = db.transaction(() => {
            const current = db
              .prepare("SELECT free_stock FROM inventory WHERE item_id = ?")
              .get(item_id) as { free_stock: number } | undefined;
            const currentQty = current ? current.free_stock : 0;
            let diff = 0;

            // Update stock
            if (type === "ADD") {
              db.prepare(
                "UPDATE inventory SET free_stock = free_stock + ? WHERE item_id = ?",
              ).run(qty, item_id);
              diff = qty;
            } else {
              db.prepare(
                "UPDATE inventory SET free_stock = ? WHERE item_id = ?",
              ).run(qty, item_id);
              diff = qty - currentQty;
            }

            if (diff !== 0) {
              db.prepare(
                "INSERT INTO stock_movements (id, item_id, type, qty) VALUES (?, ?, ?, ?)",
              ).run(
                "MOV-" + Math.random().toString(36).substr(2, 9),
                item_id,
                "ADJUSTMENT",
                diff,
              );
            }

            logAudit(
              req.headers["x-user-email"] as string,
              "INVENTORY_ADJUST",
              "ITEM",
              item_id,
              `Stock adjusted by ${diff} (${type}). New free stock: ${currentQty + diff}`,
            );

            // Update item details if provided
            if (item_details) {
              const { item_code, name, uom, type: itemType } = item_details;
              db.prepare(
                "UPDATE items SET item_code = ?, name = ?, uom = ?, type = ? WHERE id = ?",
              ).run(item_code, name, uom, itemType || "RAW", item_id);
            }
          });

          transaction();
          res.json({ success: true });
        } catch (error) {
          console.error(error);
          res.status(500).json({ error: "Failed to adjust inventory" });
        }
      },
    );

    // Check Stock (MRP Logic)
    app.post(
      "/api/mrp/check-stock",
      requireRole(["PRODUCTION", "ENGINEERING", "WAREHOUSE", "PURCHASING"]),
      (req, res) => {
        try {
          const { items, project_id } = req.body; // Array of { item_code, qty, ... }, optional project_id
          const results = [];

          const getItem = db.prepare(`
        SELECT 
          i.id, i.item_code, i.name, i.dimension, i.spec, i.uom, 
          COALESCE(inv.free_stock, 0) as free_stock,
          COALESCE(inv.allocated_stock, 0) as total_allocated
        FROM items i
        LEFT JOIN inventory inv ON i.id = inv.item_id
        WHERE i.item_code = ?
      `);

          const getProjectAlloc = db.prepare(`
        SELECT COALESCE(SUM(qty), 0) as alloc
        FROM stock_movements
        WHERE project_id = ? AND item_id = ? AND type IN ('ALLOCATION', 'GRN_ALLOCATION')
      `);

          const getProjectIncoming = db.prepare(`
        SELECT COALESCE(SUM(pri.qty), 0) - COALESCE((
          SELECT SUM(gi.qty_received)
          FROM grn_items gi
          JOIN grns g ON gi.grn_id = g.id
          JOIN purchase_orders po ON g.po_id = po.id
          JOIN pr_items pri2 ON po.id = pri2.po_id AND gi.item_id = pri2.item_id
          JOIN purchase_requests pr2 ON pri2.pr_id = pr2.id
          WHERE pr2.project_id = ? AND gi.item_id = ? AND g.qc_status IN ('PASSED', 'CONDITIONAL')
        ), 0) as incoming
        FROM pr_items pri
        JOIN purchase_requests pr ON pri.pr_id = pr.id
        WHERE pr.project_id = ? AND pri.item_id = ? AND pr.status != 'CANCELLED'
      `);

          for (const reqItem of items) {
            const dbItem = getItem.get(reqItem.item_code) as any;
            if (dbItem) {
              const required = Number(reqItem.qty);
              const free = Number(dbItem.free_stock);

              let incoming = 0;
              if (project_id) {
                const res = getProjectIncoming.get(
                  project_id,
                  dbItem.id,
                  project_id,
                  dbItem.id,
                ) as any;
                incoming = Math.max(0, res.incoming);
              }

              // Available = Free + Pending Purchase Requests for this project
              const available = free + incoming;
              const shortage = Math.max(0, required - available);

              results.push({
                ...dbItem,
                allocated_for_this_project: incoming, // Using this existing field to display incoming
                required_qty: required,
                shortage_qty: shortage,
              });
            } else {
              // If item not found, it should have been caught by frontend,
              // but we return a safe default just in case.
              results.push({
                item_code: reqItem.item_code,
                name: reqItem.name || "Unknown Item",
                uom: reqItem.unit || "PCS",
                free_stock: 0,
                required_qty: Number(reqItem.qty),
                shortage_qty: Number(reqItem.qty),
                notFound: true,
              });
            }
          }
          res.json(results);
        } catch (error) {
          console.error(error);
          res.status(500).json({ error: "Failed to check stock" });
        }
      },
    );

    // Project urgency levels
    // Delete BOM Item
    app.delete(
      "/api/projects/:projectId/bom/:bomId",
      requireRole(["ENGINEERING", "PRODUCTION"]),
      (req, res) => {
        const userRole = (req as any).userRole;
        const userLevel = (req as any).userLevel;
        if (
          userRole !== "FC" &&
          userLevel !== "MANAGER"
        ) {
          return res
            .status(403)
            .json({ error: "Access denied. Only FC or Engineering/Production Manager can delete BOM items." });
        }
        try {
          const { projectId, bomId } = req.params;
          // Check if item has consumption
          const consumption = db
            .prepare(
              "SELECT SUM(qty_consumed) as total FROM bom_item_consumption WHERE bom_id = ?",
            )
            .get(bomId) as { total: number };
          if (consumption && consumption.total > 0) {
            return res
              .status(400)
              .json({ error: "Cannot delete item with recorded consumption." });
          }

          db.transaction(() => {
            db.prepare("DELETE FROM bom_item_consumption WHERE bom_id = ?").run(
              bomId,
            );
            db.prepare("DELETE FROM work_order_items WHERE bom_id = ?").run(
              bomId,
            );
            db.prepare("DELETE FROM boms WHERE id = ? AND project_id = ?").run(
              bomId,
              projectId,
            );
          })();

          res.json({ success: true });
        } catch (error) {
          console.error(error);
          res.status(500).json({ error: "Failed to delete BOM item" });
        }
      },
    );

    // Delete Task
    app.delete(
      "/api/projects/:projectId/tasks/:taskId",
      requireRole(["ENGINEERING", "PRODUCTION"]),
      (req, res) => {
        try {
          const { projectId, taskId } = req.params;
          const project = db
            .prepare("SELECT status FROM projects WHERE id = ?")
            .get(projectId) as any;
          if (
            project &&
            (project.status === "FINISHED" || project.status === "CLOSED")
          ) {
            return res
              .status(400)
              .json({
                error: "Cannot delete task from a finished or closed project.",
              });
          }
          db.prepare(
            "DELETE FROM project_tasks WHERE id = ? AND project_id = ?",
          ).run(taskId, projectId);
          res.json({ success: true });
        } catch (error) {
          console.error(error);
          res.status(500).json({ error: "Failed to delete task" });
        }
      },
    );

    // Sync BOM for a project (Finalize / Update BQ)
    app.post(
      "/api/projects/:id/boms/sync",
      requireRole(["ENGINEERING", "PRODUCTION"]),
      (req, res) => {
        const userRole = (req as any).userRole;
        const userLevel = (req as any).userLevel;
        if (
          userRole !== "FC" &&
          userLevel !== "MANAGER"
        ) {
          return res
            .status(403)
            .json({ error: "Access denied. Only FC or Engineering/Production Manager can sync BOM." });
        }
        try {
          const projectId = req.params.id;
          const { items } = req.body;

          const project = db
            .prepare("SELECT status FROM projects WHERE id = ?")
            .get(projectId) as any;
          if (!project || project.status !== "ACTIVE") {
            return res
              .status(400)
              .json({
                error:
                  "Cannot modify BOM of a project that is not ACTIVE. Current status: " +
                  (project?.status || "NOT FOUND"),
              });
          }

          const transaction = db.transaction(() => {
            // We will update existing items, insert new ones, and delete removed ones.
            // However, deleting might violate foreign keys if there's consumption.
            // For simplicity, we can just delete BOM items that have 0 consumption and are not in the new list.

            const existingBoms = db
              .prepare("SELECT * FROM boms WHERE project_id = ?")
              .all(projectId) as any[];
            const existingBomIds = new Set(existingBoms.map((b) => b.id));
            const newItemsMap = new Map();

            const insertBom = db.prepare(
              "INSERT INTO boms (id, project_id, item_id, dimension, spec, required_qty, unit_price, reference) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            );
            const insertBomConsumption = db.prepare(
              "INSERT INTO bom_item_consumption (id, bom_id, qty_consumed) VALUES (?, ?, ?)",
            );
            const updateBom = db.prepare(
              "UPDATE boms SET required_qty = ?, dimension = ?, spec = ?, unit_price = ?, reference = ? WHERE id = ?",
            );

            // Update project bq_updated_at
            db.prepare(
              "UPDATE projects SET bq_updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            ).run(projectId);

            for (const item of items) {
              let itemId = item.item_id;

              if (!itemId || item.is_new) {
                // Create the new item
                itemId =
                  "ITEM-" +
                  Math.random().toString(36).substr(2, 5).toUpperCase();
                db.prepare(
                  "INSERT INTO items (id, item_code, name, uom, dimension, spec, type, unit_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                ).run(
                  itemId,
                  item.item_code,
                  item.name || "New Item",
                  item.uom || "PCS",
                  item.dimension || "",
                  item.spec || "",
                  "RAW",
                  item.unit_price || 0,
                );
                db.prepare(
                  "INSERT INTO inventory (item_id, free_stock, allocated_stock) VALUES (?, 0, 0)",
                ).run(itemId);
              }

              newItemsMap.set(itemId, item);

              // Check if it already exists in project BOM
              const existing = existingBoms.find((b) => b.item_id === itemId);
              let bomId = "";
              if (existing) {
                bomId = existing.id;
                updateBom.run(
                  item.required_qty,
                  item.dimension,
                  item.spec,
                  item.unit_price || 0,
                  item.reference,
                  existing.id,
                );
                existingBomIds.delete(existing.id);
              } else {
                bomId = "BOM-" + Math.random().toString(36).substr(2, 9);
                insertBom.run(
                  bomId,
                  projectId,
                  itemId,
                  item.dimension,
                  item.spec,
                  item.required_qty,
                  item.unit_price || 0,
                  item.reference,
                );
                insertBomConsumption.run(
                  "BIC-" + Math.random().toString(36).substr(2, 9),
                  bomId,
                  0,
                );
              }

              // AUTO-ALLOCATION LOGIC REMOVED
              // Mechanics now only rely on stock vs required
            }

            // Delete BOMs that are no longer in the list, IF they have 0 consumption
            for (const bomId of existingBomIds) {
              const consumption = db
                .prepare(
                  "SELECT qty_consumed FROM bom_item_consumption WHERE bom_id = ?",
                )
                .get(bomId) as any;
              if (!consumption || consumption.qty_consumed === 0) {
                db.prepare(
                  "DELETE FROM bom_item_consumption WHERE bom_id = ?",
                ).run(bomId);
                db.prepare("DELETE FROM work_order_items WHERE bom_id = ?").run(
                  bomId,
                );
                db.prepare("DELETE FROM boms WHERE id = ?").run(bomId);
              }
            }
          });

          transaction();
          res.json({ success: true });
        } catch (error) {
          console.error(error);
          res.status(500).json({ error: "Failed to sync BQ" });
        }
      },
    );

    // Submit BOM & Create PR
    app.post(
      "/api/boms/submit",
      requireRole(["ENGINEERING", "PRODUCTION"]),
      (req, res) => {
        try {
          const {
            project_id,
            items,
            expected_delivery_date,
            drawing_reference,
            urgency,
          } = req.body;
          // items: { item_id, item_code, name, dimension, spec, required_qty, shortage_qty, reference, is_new }

          const insertBom = db.prepare(
            "INSERT INTO boms (id, project_id, item_id, dimension, spec, required_qty, reference, unit_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          );
          const insertBomConsumption = db.prepare(
            "INSERT INTO bom_item_consumption (id, bom_id, qty_consumed) VALUES (?, ?, ?)",
          );
          const insertPr = db.prepare(
            "INSERT INTO purchase_requests (id, pr_number, project_id, drawing_reference, urgency) VALUES (?, ?, ?, ?, ?)",
          );
          const insertPrItem = db.prepare(
            "INSERT INTO pr_items (id, pr_id, item_id, dimension, spec, qty, unit_price, expected_delivery_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          );
          const insertMovement = db.prepare(
            "INSERT INTO stock_movements (id, item_id, project_id, type, qty, reference_id) VALUES (?, ?, ?, ?, ?, ?)",
          );
          const insertTask = db.prepare(
            "INSERT INTO project_tasks (id, project_id, task_name, start_date, end_date, progress, status, pr_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          );

          const transaction = db.transaction(() => {
            let prId = null;
            let hasShortage = false;

            for (const item of items) {
              let itemId = item.item_id;

              if (!itemId || item.is_new) {
                // Create the new item
                itemId =
                  "ITEM-" +
                  Math.random().toString(36).substr(2, 5).toUpperCase();
                db.prepare(
                  "INSERT INTO items (id, item_code, name, uom, dimension, spec, type, unit_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                ).run(
                  itemId,
                  item.item_code,
                  item.name || "New Item",
                  item.uom || "PCS",
                  item.dimension || "",
                  item.spec || "",
                  "RAW",
                  item.unit_price || 0,
                );
                db.prepare(
                  "INSERT INTO inventory (item_id, free_stock, allocated_stock) VALUES (?, 0, 0)",
                ).run(itemId);
              }

              const bomId = "BOM-" + Math.random().toString(36).substr(2, 9);
              insertBom.run(
                bomId,
                project_id,
                itemId,
                item.dimension,
                item.spec,
                item.required_qty,
                item.reference,
                item.unit_price || 0,
              );
              insertBomConsumption.run(
                "BIC-" + Math.random().toString(36).substr(2, 9),
                bomId,
                0,
              );

              let currentFreeStock = 0;
              if (itemId && !item.is_new) {
                const inv = db
                  .prepare("SELECT free_stock FROM inventory WHERE item_id = ?")
                  .get(itemId) as any;
                currentFreeStock = inv ? inv.free_stock : 0;
              }

              // Calculate total required by all OTHER active projects for this item
              const otherBomsReq = db
                .prepare(
                  `
            SELECT COALESCE(SUM(b.required_qty), 0) as total_req
            FROM boms b
            JOIN projects p ON b.project_id = p.id
            WHERE b.item_id = ? AND p.status IN ('DRAFT', 'ACTIVE')
          `,
                )
                .get(itemId) as any;
              const totalOtherReq = otherBomsReq.total_req;

              // Calculate incoming pending from active POs
              const incomingSupply = db
                .prepare(
                  `
            SELECT COALESCE(SUM(doi.qty_received), 0) as total_incoming
            FROM grn_items doi
            JOIN grns d ON doi.grn_id = d.id
            WHERE doi.item_id = ? AND d.inventory_updated_at IS NULL
          `,
                )
                .get(itemId) as any;
              const totalIncoming = incomingSupply.total_incoming;

              const pendingPoSupply = db
                .prepare(
                  `
             SELECT COALESCE(SUM(poi.qty), 0) as total_po
             FROM pr_items poi
             JOIN purchase_requests pr ON poi.pr_id = pr.id
             WHERE poi.item_id = ? AND pr.status IN ('DRAFTED', 'AUTHORIZED', 'PO_ISSUED')
          `,
                )
                .get(itemId) as any;
              const totalPoIncoming = pendingPoSupply.total_po;

              // Effective availability = Physical Stock + Pending Incoming + Pipeline POs - Other Project Requirements
              // Note: totalOtherReq includes past BOM requirements, so it calculates exactly what's "left" for this new BOM
              const effectiveAvailable = Math.max(
                0,
                currentFreeStock +
                  totalIncoming +
                  totalPoIncoming -
                  totalOtherReq,
              );

              const actualShortage = Math.max(
                0,
                item.required_qty - effectiveAvailable,
              );

              if (actualShortage > 0) {
                hasShortage = true;
              }

              item.final_item_id = itemId; // Store for PR
              item.actual_shortage = actualShortage;
            }

            if (hasShortage) {
              prId = "PR-" + Math.random().toString(36).substr(2, 9);
              const prNumber =
                "PR-" +
                new Date().getFullYear() +
                "-" +
                Math.floor(100000 + Math.random() * 900000);
              insertPr.run(
                prId,
                prNumber,
                project_id,
                drawing_reference || null,
                urgency || "NORMAL",
              );

              if (urgency === "URGENT" || urgency === "CRITICAL") {
                const threadId = "THREAD-GENERAL";
                const msgId = "SYS-" + Math.random().toString(36).substr(2, 9);
                const projectName = db
                  .prepare("SELECT name FROM projects WHERE id = ?")
                  .get(project_id) as { name: string };
                db.prepare(
                  "INSERT INTO chat_messages (id, thread_id, sender_username, content) VALUES (?, ?, ?, ?)",
                ).run(
                  msgId,
                  threadId,
                  "SYSTEM",
                  `⚠️ **Material Shortage Alert!** ⚠️\n\n**Urgency:** 🚨 ${urgency}\n**Project:** 🏗️ ${projectName?.name || "Unknown"}\n**PR Number:** 📜 ${prNumber}\n\nProcurement has been requested! ⚡`,
                );
              }

              for (const item of items) {
                if (item.actual_shortage > 0) {
                  const prItemId =
                    "PRI-" + Math.random().toString(36).substr(2, 9);
                  insertPrItem.run(
                    prItemId,
                    prId,
                    item.final_item_id,
                    item.dimension,
                    item.spec,
                    item.actual_shortage,
                    item.unit_price || 0,
                    item.expected_delivery_date || null,
                  );
                }
              }
            }

            // Create Gantt Task for Material Procurement
            const todayStr = new Date().toISOString().split("T")[0];

            // Ensure unique tasks for different expected deliveries or one fallback
            const itemsWithDeliveries = items.filter(
              (i: any) => i.actual_shortage > 0 && i.expected_delivery_date,
            );

            if (itemsWithDeliveries.length > 0) {
              // Group by delivery date
              const deliveryGroups = new Map();
              for (const i of itemsWithDeliveries) {
                if (!deliveryGroups.has(i.expected_delivery_date))
                  deliveryGroups.set(i.expected_delivery_date, []);
                deliveryGroups.get(i.expected_delivery_date).push(i);
              }

              for (const [date, grp] of deliveryGroups.entries()) {
                const taskId = "TSK-" + Math.random().toString(36).substr(2, 9);
                let details = grp.map((g: any) => g.item_code).join(", ");
                if (details.length > 40)
                  details = details.substring(0, 37) + "...";
                insertTask.run(
                  taskId,
                  project_id,
                  `Arrival: ${details}`,
                  todayStr,
                  date,
                  0,
                  "PENDING",
                  prId,
                );
              }
            }

            if (!hasShortage || itemsWithDeliveries.length === 0) {
              // Default procurement task if none specified
              const taskId = "TSK-" + Math.random().toString(36).substr(2, 9);
              let endDateStr = expected_delivery_date || "";
              if (!endDateStr) {
                const d = new Date();
                d.setDate(d.getDate() + 3);
                endDateStr = d.toISOString().split("T")[0];
              }
              const prText = prId ? `(PR Generated)` : `(Stock Fulfilled)`;
              insertTask.run(
                taskId,
                project_id,
                `Material Procurement ${prText}`,
                todayStr,
                endDateStr,
                0,
                "PENDING",
                prId,
              );
            }

            return prId;
          });

          const generatedPrId = transaction();
          logAudit(
            req.headers["x-user-email"] as string,
            "BOM_SYNC",
            "PROJECT",
            project_id,
            `BOM synchronized with ${items.length} items. PR ID: ${generatedPrId || "None"}`,
          );
          res.json({ success: true, pr_id: generatedPrId });
        } catch (error) {
          console.error(error);
          res.status(500).json({ error: "Failed to submit BOM" });
        }
      },
    );

    // --- PURCHASING & MRP API ---

    // Cancel PR
    app.post(
      "/api/purchasing/pr/:id/cancel",
      requireRole(["PURCHASING", "ENGINEERING", "PRODUCTION"]),
      (req, res) => {
        try {
          const pr = db
            .prepare("SELECT status FROM purchase_requests WHERE id = ?")
            .get(req.params.id) as any;
          if (pr && pr.status === "ORDERED") {
            return res
              .status(400)
              .json({
                error:
                  "Cannot cancel a PR that has already been converted to a PO.",
              });
          }
          db.transaction(() => {
            db.prepare(
              "UPDATE purchase_requests SET status = 'CANCELLED', cancelled_at = CURRENT_TIMESTAMP WHERE id = ?",
            ).run(req.params.id);
            db.prepare(
              "UPDATE project_tasks SET status = 'CANCELLED' WHERE pr_id = ?",
            ).run(req.params.id);
          })();
          res.json({ success: true });
        } catch (error) {
          console.error(error);
          res.status(500).json({ error: "Failed to cancel PR" });
        }
      },
    );

    // Update/Revise PR
    app.put(
      "/api/purchasing/pr/:id",
      requireRole(["PURCHASING", "ENGINEERING", "PRODUCTION", "FC"]),
      (req, res) => {
        try {
          const { urgency, expected_delivery_date, remarks, items } = req.body;
          const prId = req.params.id;
          
          const pr = db.prepare("SELECT * FROM purchase_requests WHERE id = ?").get(prId) as any;
          if (!pr) return res.status(404).json({ error: "PR not found" });

          db.transaction(() => {
            db.prepare(`
              UPDATE purchase_requests 
              SET urgency = COALESCE(?, urgency), 
                  status = 'DRAFTED', 
                  revision_note = NULL,
                  expected_delivery_date = COALESCE(?, expected_delivery_date),
                  remarks = COALESCE(?, remarks)
              WHERE id = ?
            `).run(urgency || null, expected_delivery_date || null, remarks || null, prId);

            if (items && Array.isArray(items)) {
              const itemIds = items.map((i: any) => i.item_id);
              if (itemIds.length > 0) {
                 const placeholders = itemIds.map(() => '?').join(',');
                 db.prepare(`DELETE FROM pr_items WHERE pr_id = ? AND item_id NOT IN (${placeholders})`).run(prId, ...itemIds);
              } else {
                 db.prepare(`DELETE FROM pr_items WHERE pr_id = ?`).run(prId);
              }
              for (const item of items) {
                if (!item.item_id) continue;
                const existingItem = db.prepare("SELECT id FROM items WHERE id = ?").get(item.item_id);
                if (!existingItem) {
                   db.prepare("INSERT INTO items (id, item_code, name, uom, category) VALUES (?, ?, ?, ?, 'RAW')").run(
                     item.item_id, item.item_code || `RAW-${item.item_id}`, item.name || 'Custom Item', item.uom || 'Unit'
                   );
                }

                const updated = db.prepare(`
                  UPDATE pr_items
                  SET qty = ?, expected_delivery_date = ?, unit_price = COALESCE(?, unit_price)
                  WHERE pr_id = ? AND item_id = ?
                `).run(item.qty_to_order, item.expected_delivery_date || null, item.unit_price || null, prId, item.item_id);

                if (updated.changes === 0) {
                     db.prepare(`
                        INSERT INTO pr_items (id, pr_id, item_id, dimension, spec, qty, unit_price, expected_delivery_date) 
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                     `).run("PRI-" + Math.random().toString(36).substr(2, 9), prId, item.item_id, item.dimension || '', item.spec || '', item.qty_to_order, item.unit_price || 0, item.expected_delivery_date || null);
                }
              }
            }
          })();

          logAudit(
            (req.headers["x-user-email"] as string) || null,
            "UPDATE_PR",
            "PURCHASE_REQUEST",
            prId,
            `Revised PR ${pr.pr_number}`
          );

          res.json({ success: true, message: "PR updated successfully" });
        } catch (error: any) {
          console.error(error);
          res.status(500).json({ error: "Failed to update PR", details: error.message });
        }
      }
    );

    // Delete PR
    app.delete(
      "/api/purchasing/pr/:id",
      requireRole(["PURCHASING", "ENGINEERING", "PRODUCTION"]),
      (req, res) => {
        try {
          const pr = db
            .prepare("SELECT status FROM purchase_requests WHERE id = ?")
            .get(req.params.id) as any;
          if (pr && pr.status === "ORDERED") {
            return res
              .status(400)
              .json({
                error:
                  "Cannot delete a PR that has already been converted to a PO.",
              });
          }
          const transaction = db.transaction(() => {
            db.prepare("DELETE FROM pr_items WHERE pr_id = ?").run(
              req.params.id,
            );
            db.prepare("DELETE FROM purchase_requests WHERE id = ?").run(
              req.params.id,
            );
          });
          transaction();
          res.json({ success: true });
        } catch (error) {
          console.error(error);
          res.status(500).json({ error: "Failed to delete PR" });
        }
      },
    );

    // Clear PRs
    app.post(
      "/api/purchasing/clear-prs",
      requireRole(["PURCHASING"]),
      (req, res) => {
        try {
          db.prepare(
            "UPDATE purchase_requests SET archived = 1 WHERE status IN ('ORDERED', 'CANCELLED')",
          ).run();
          res.json({ success: true });
        } catch (error) {
          console.error(error);
          res.status(500).json({ error: "Failed to clear PRs" });
        }
      },
    );

    // Archive Single PR
    app.post(
      "/api/purchasing/archive-pr/:id",
      requireRole(["PURCHASING"]),
      (req, res) => {
        try {
          db.prepare(
            "UPDATE purchase_requests SET archived = 1 WHERE id = ?",
          ).run(req.params.id);
          res.json({ success: true });
        } catch (error) {
          console.error(error);
          res.status(500).json({ error: "Failed to archive individual PR" });
        }
      },
    );

    // Clear POs
    app.post(
      "/api/purchasing/clear-pos",
      requireRole(["PURCHASING"]),
      (req, res) => {
        try {
          db.prepare(
            "UPDATE purchase_orders SET archived = 1 WHERE status IN ('FINISHED', 'CANCELLED', 'RECEIVED')",
          ).run();
          res.json({ success: true });
        } catch (error) {
          console.error(error);
          res.status(500).json({ error: "Failed to clear POs" });
        }
      },
    );

    // Archive Single PO
    app.post(
      "/api/purchasing/archive-po/:id",
      requireRole(["PURCHASING"]),
      (req, res) => {
        try {
          db.prepare(
            "UPDATE purchase_orders SET archived = 1 WHERE id = ?",
          ).run(req.params.id);
          res.json({ success: true });
        } catch (error) {
          console.error(error);
          res.status(500).json({ error: "Failed to archive individual PO" });
        }
      },
    );

    // Get all PRs (for BOM page)
    app.get(
      "/api/purchasing/prs",
      requireRole(["PURCHASING", "ENGINEERING", "PRODUCTION"]),
      (req, res) => {
        try {
          const prs = db
            .prepare(
              `
        SELECT pr.*, p.name as project_name, COUNT(pri.id) as item_count
        FROM purchase_requests pr
        JOIN projects p ON pr.project_id = p.id
        LEFT JOIN pr_items pri ON pr.id = pri.pr_id
        WHERE pr.archived = 0 AND (pr.status != 'CANCELLED' OR (pr.status = 'CANCELLED' AND pr.cancelled_at >= datetime('now', '-1 day')))
        GROUP BY pr.id
        ORDER BY pr.created_at DESC
      `,
            )
            .all();
          res.json(prs);
        } catch (error) {
          console.error(error);
          res.status(500).json({ error: "Failed to fetch PRs" });
        }
      },
    );

    // Get PR details (supports lookup by internal UUID ID or public PR number)
    app.get(
      "/api/purchasing/pr/:id",
      requireRole(["PURCHASING", "ENGINEERING", "PRODUCTION", "WAREHOUSE"]),
      (req, res) => {
        try {
          let pr = db
            .prepare(
              `
        SELECT pr.*, p.name as project_name
        FROM purchase_requests pr
        JOIN projects p ON pr.project_id = p.id
        WHERE pr.id = ?
      `,
            )
            .get(req.params.id) as any;

          // Fallback: If not found by primary ID, try looking up by the public PR Number
          if (!pr) {
            pr = db
              .prepare(
                `
          SELECT pr.*, p.name as project_name
          FROM purchase_requests pr
          JOIN projects p ON pr.project_id = p.id
          WHERE pr.pr_number = ?
        `,
              )
              .get(req.params.id) as any;
          }

          if (!pr) return res.status(404).json({ error: "PR not found" });

          const items = db
            .prepare(
              `
        SELECT pri.*, i.item_code, i.name as item_name, i.uom
        FROM pr_items pri
        LEFT JOIN items i ON pri.item_id = i.id
        WHERE pri.pr_id = ?
      `,
            )
            .all(pr.id);

          res.json({ ...pr, items });
        } catch (error) {
          console.error(error);
          res.status(500).json({ error: "Failed to fetch PR details" });
        }
      },
    );

    // Revise PR
    app.post(
      "/api/purchasing/revise-pr",
      requireRole(["ENGINEERING", "FC"]),
      (req, res) => {
        const userRole = (req as any).userRole;
        const userLevel = (req as any).userLevel;
        if (
          userRole !== "FC" &&
          (userRole !== "ENGINEERING" || userLevel !== "MANAGER")
        ) {
          return res
            .status(403)
            .json({
              error:
                "Access denied. Only Engineering Managers or FC accounts can revise Purchase Requisitions.",
            });
        }
        try {
          const { pr_id, revision_note } = req.body;
          if (!revision_note) {
            return res.status(400).json({ error: "Revision note is required" });
          }
          
          db.prepare(
            "UPDATE purchase_requests SET status = 'REVISION', revision_note = ? WHERE id = ?",
          ).run(revision_note, pr_id);

          const pr = db
            .prepare("SELECT pr_number FROM purchase_requests WHERE id = ?")
            .get(pr_id) as any;
            
          logAudit(
            req.headers["x-user-email"] as string,
            "REVISE_PR",
            "PR",
            pr_id,
            `PR ${pr?.pr_number} marked for revision. Note: ${revision_note}`,
          );

          res.json({ success: true, message: "PR marked for revision" });
        } catch (error) {
          console.error("Failed to revise PR:", error);
          res.status(500).json({ error: "Failed to revise PR" });
        }
      },
    );

    // Authorize PR
    app.post(
      "/api/purchasing/authorize-pr",
      (req, res) => {
        const userRole = (req as any).userRole;
        const userLevel = (req as any).userLevel;
        
        try {
          const { pr_id, authorized_doc } = req.body;

          const prDoc = db.prepare("SELECT * FROM purchase_requests WHERE id = ?").get(pr_id) as any;
          if (!prDoc) return res.status(404).json({ error: "PR not found" });

          const isDirectlyAuthorized = userRole === "FC" || (userRole === "ENGINEERING" && userLevel === "MANAGER");
          const isEscalatedAuthority = prDoc.escalated_to && userRole === prDoc.escalated_to;

          if (!isDirectlyAuthorized && !isEscalatedAuthority) {
            return res
              .status(403)
              .json({
                error:
                  "Access denied. Only Engineering Managers, FC accounts or Escalated personnel can authorize Purchase Requisitions.",
              });
          }

          db.prepare(
            "UPDATE purchase_requests SET status = 'AUTHORIZED', authorized_at = CURRENT_TIMESTAMP, authorized_doc = ? WHERE id = ?",
          ).run(authorized_doc, pr_id);

          const pr = db
            .prepare("SELECT pr_number FROM purchase_requests WHERE id = ?")
            .get(pr_id) as any;
          logAudit(
            req.headers["x-user-email"] as string,
            "AUTHORIZE_PR",
            "PR",
            pr_id,
            `PR ${pr?.pr_number} authorized with doc: ${authorized_doc}`,
          );

          // Update Gantt Chart adapts to newly authorized PR
          syncProcurementTaskGantt(pr_id);

          res.json({ success: true });
        } catch (error) {
          console.error(error);
          res.status(500).json({ error: "Failed to authorize PR" });
        }
      },
    );

    // Get all pending PR items (Only Authorized ones)
    app.get(
      "/api/purchasing/pending-prs",
      requireRole(["PURCHASING", "WAREHOUSE"]),
      (req, res) => {
        try {
          const pendingPrs = db
            .prepare(
              `
        SELECT 
          pri.id as pr_item_id,
          pr.id as pr_id,
          i.id as item_id,
          pr.pr_number,
          pr.project_id,
          p.name as project_name,
          i.item_code,
          i.name as item_name,
          pri.dimension,
          pri.spec,
          pri.qty,
          i.uom,
          i.unit_price,
          pr.created_at,
          pri.expected_delivery_date,
          pr.drawing_reference,
          pr.status,
          pr.urgency
        FROM pr_items pri
        JOIN purchase_requests pr ON pri.pr_id = pr.id
        JOIN projects p ON pr.project_id = p.id
        JOIN items i ON pri.item_id = i.id
        WHERE pri.po_id IS NULL AND pr.archived = 0 AND p.status = 'ACTIVE' AND 
          (pr.status NOT IN ('DRAFTED', 'CANCELLED') OR (pr.status = 'CANCELLED' AND pr.cancelled_at >= datetime('now', '-1 day')))
        ORDER BY pr.created_at ASC
      `,
            )
            .all();
          res.json(pendingPrs);
        } catch (error) {
          console.error(error);
          res.status(500).json({ error: "Failed to fetch pending PRs" });
        }
      },
    );

    // Create Purchase Order (PO) - Starts as DRAFTED
    app.post(
      "/api/purchasing/create-po",
      requireRole(["PURCHASING"]),
      (req, res) => {
        try {
          const {
            supplier_id,
            supplier_name,
            pr_item_ids,
            auth_doc_name,
            urgency,
          } = req.body;
          let { expected_date } = req.body;

          const poId = "PO-" + Math.random().toString(36).substr(2, 9);
          const poNumber =
            "PO-" +
            new Date().getFullYear() +
            "-" +
            Math.floor(100000 + Math.random() * 900000);

          const insertPo = db.prepare(
            "INSERT INTO purchase_orders (id, po_number, supplier_id, supplier_name, expected_date, auth_doc_name, status, urgency) VALUES (?, ?, ?, ?, ?, ?, 'DRAFTED', ?)",
          );
          const updatePrItem = db.prepare(
            "UPDATE pr_items SET po_id = ? WHERE id = ?",
          );
          const checkPrStatus = db.prepare(`
        SELECT COUNT(*) as pending_count 
        FROM pr_items 
        WHERE pr_id = (SELECT pr_id FROM pr_items WHERE id = ?) AND po_id IS NULL
      `);
          const updatePrStatus = db.prepare(
            "UPDATE purchase_requests SET status = 'ORDERED' WHERE id = (SELECT pr_id FROM pr_items WHERE id = ?)",
          );

          const transaction = db.transaction(() => {
            // Safety check: ensure all PR items belong to ACTIVE projects
            if (pr_item_ids && pr_item_ids.length > 0) {
              const placeholders = pr_item_ids.map(() => "?").join(",");
              const inactiveProjects = db
                .prepare(
                  `
            SELECT DISTINCT p.id, p.name, p.status 
            FROM pr_items pri
            JOIN purchase_requests pr ON pri.pr_id = pr.id
            JOIN projects p ON pr.project_id = p.id
            WHERE pri.id IN (${placeholders}) AND p.status != 'ACTIVE'
          `,
                )
                .all(...pr_item_ids) as any[];

              if (inactiveProjects.length > 0) {
                throw new Error(
                  `Cannot create PO for projects that are not ACTIVE: ${inactiveProjects.map((p) => `${p.name} (${p.status})`).join(", ")}`,
                );
              }
            }

            if (!expected_date && pr_item_ids && pr_item_ids.length > 0) {
              const placeholders = pr_item_ids.map(() => "?").join(",");
              const minDateRow = db
                .prepare(
                  `SELECT MIN(expected_delivery_date) as min_date FROM pr_items WHERE id IN (${placeholders}) AND expected_delivery_date IS NOT NULL`,
                )
                .get(...pr_item_ids) as { min_date: string };
              expected_date = minDateRow?.min_date || null;
            }

            insertPo.run(
              poId,
              poNumber,
              supplier_id || null,
              supplier_name,
              expected_date || null,
              auth_doc_name || null,
              urgency || "NORMAL",
            );

            let totalAmount = 0;
            for (const prItemId of pr_item_ids) {
              // Get the item_id and requested qty for this PR item
              const prItemInfo = db
                .prepare(
                  "SELECT item_id, qty, unit_price as requested_price FROM pr_items WHERE id = ?",
                )
                .get(prItemId) as any;

              // Get the supplier specific price from the matrix
              const supplierPriceRow = db
                .prepare(
                  "SELECT unit_price FROM item_supplier_prices WHERE item_id = ? AND supplier_id = ?",
                )
                .get(prItemInfo.item_id, supplier_id) as
                | { unit_price: number }
                | undefined;

              // Use supplier price if found, otherwise fallback to item's current price, then finally PR's requested price
              let finalUnitPrice = supplierPriceRow?.unit_price;
              if (finalUnitPrice === undefined) {
                const globalItemPrice = db
                  .prepare("SELECT unit_price FROM items WHERE id = ?")
                  .get(prItemInfo.item_id) as { unit_price: number };
                finalUnitPrice =
                  globalItemPrice?.unit_price ||
                  prItemInfo.requested_price ||
                  0;
              }

              updatePrItem.run(poId, prItemId);

              // Update the PR item with the FINAL unit price used in the PO
              db.prepare("UPDATE pr_items SET unit_price = ? WHERE id = ?").run(
                finalUnitPrice,
                prItemId,
              );

              totalAmount += Number(prItemInfo.qty) * finalUnitPrice;

              // Check if all items in the PR are ordered, if so update PR status
              const { pending_count } = checkPrStatus.get(prItemId) as any;
              if (pending_count === 0) {
                updatePrStatus.run(prItemId);
              } else {
                db.prepare(
                  "UPDATE purchase_requests SET status = 'PARTIAL_ORDERED' WHERE id = (SELECT pr_id FROM pr_items WHERE id = ?)",
                ).run(prItemId);
              }
            }

            db.prepare(
              "UPDATE purchase_orders SET total_amount = ? WHERE id = ?",
            ).run(totalAmount, poId);
            return poNumber;
          });

          const finalPoNumber = transaction();
          logAudit(
            req.headers["x-user-email"] as string,
            "CREATE_PO",
            "PO",
            poId,
            `PO ${finalPoNumber} created for ${supplier_name}`,
          );

          // Update affected PR tasks in Gantt
          try {
            if (pr_item_ids && pr_item_ids.length > 0) {
              const placeholders = pr_item_ids.map(() => "?").join(",");
              const prIds = db
                .prepare(
                  `SELECT DISTINCT pr_id FROM pr_items WHERE id IN (${placeholders})`,
                )
                .all(...pr_item_ids) as { pr_id: string }[];
              for (const { pr_id } of prIds) {
                syncProcurementTaskGantt(pr_id);
              }
            }
          } catch (err) {
            console.error("Post-PO Gantt sync failed:", err);
          }

          res.json({ success: true, id: poId, po_number: finalPoNumber });
        } catch (error) {
          console.error(error);
          res.status(500).json({ error: "Failed to create PO" });
        }
      },
    );

    // Cancel PO
    app.post(
      "/api/purchasing/po/:id/cancel",
      requireRole(["PURCHASING"]),
      (req, res) => {
        try {
          const poId = req.params.id;

          const hasGrns =
            (
              db
                .prepare("SELECT COUNT(*) as count FROM grns WHERE po_id = ?")
                .get(poId) as any
            ).count > 0;
          if (hasGrns) {
            return res
              .status(400)
              .json({
                error:
                  "Cannot cancel a PO that has receipt records (GRN). Please contact warehouse to revert first.",
              });
          }

          db.transaction(() => {
            db.prepare(
              "UPDATE purchase_orders SET status = 'CANCELLED', cancelled_at = CURRENT_TIMESTAMP WHERE id = ?",
            ).run(poId);

            // Find PRs that were ordered via this PO
            const prIds = db
              .prepare("SELECT DISTINCT pr_id FROM pr_items WHERE po_id = ?")
              .all(poId) as { pr_id: string }[];

            // Reset PR items po_id so they can be ordered again
            db.prepare("UPDATE pr_items SET po_id = NULL WHERE po_id = ?").run(
              poId,
            );

            // Revert PR status to AUTHORIZED if they have any pending items now
            const updatePrStatus = db.prepare(
              "UPDATE purchase_requests SET status = 'AUTHORIZED' WHERE id = ?",
            );
            for (const { pr_id } of prIds) {
              updatePrStatus.run(pr_id);
              syncProcurementTaskGantt(pr_id);
            }
          })();
          res.json({ success: true });
        } catch (error) {
          console.error(error);
          res.status(500).json({ error: "Failed to cancel PO" });
        }
      },
    );

    // Update/Revise PO
    app.put(
      "/api/purchasing/po/:id",
      requireRole(["PURCHASING", "FC"]),
      (req, res) => {
        try {
          const poId = req.params.id;
          const { 
            supplier_name, 
            currency, 
            exchange_rate, 
            vat_rate, 
            pph_rate,
            shipping_fee, 
            expected_date, 
            remarks,
            payment_terms
          } = req.body;

          const po = db.prepare("SELECT * FROM purchase_orders WHERE id = ?").get(poId) as any;
          if (!po) return res.status(404).json({ error: "PO not found" });

          db.transaction(() => {
            db.prepare(`
              UPDATE purchase_orders 
              SET supplier_name = ?, 
                  currency = ?, 
                  exchange_rate = ?, 
                  vat_rate = ?, 
                  pph_rate = ?, 
                  shipping_fee = ?, 
                  expected_date = ?, 
                  remarks = ?, 
                  payment_terms = ?,
                  status = 'PENDING',
                  revision_note = NULL
              WHERE id = ?
            `).run(
              supplier_name || po.supplier_name,
              currency || po.currency,
              exchange_rate || po.exchange_rate,
              vat_rate ?? po.vat_rate,
              pph_rate ?? po.pph_rate,
              shipping_fee ?? po.shipping_fee,
              expected_date || po.expected_date,
              remarks || po.remarks,
              payment_terms || po.payment_terms,
              poId
            );
          })();

          logAudit(
            (req.headers["x-user-email"] as string) || null,
            "UPDATE_PO",
            "PURCHASE_ORDER",
            poId,
            `Revised PO ${po.po_number}`
          );

          res.json({ success: true, message: "PO updated successfully" });
        } catch (error: any) {
          console.error(error);
          res.status(500).json({ error: "Failed to update PO", details: error.message });
        }
      }
    );

    // Delete PO
    app.delete(
      "/api/purchasing/po/:id",
      requireRole(["PURCHASING"]),
      (req, res) => {
        try {
          const poId = req.params.id;
          const po = db
            .prepare("SELECT status FROM purchase_orders WHERE id = ?")
            .get(poId) as { status: string };
          if (po && po.status !== "DRAFTED" && po.status !== "CANCELLED") {
            return res
              .status(400)
              .json({ error: "Only drafted or cancelled POs can be deleted." });
          }

          db.transaction(() => {
            // Handle GRNs associated with this PO to prevent foreign key constraint errors
            const grns = db
              .prepare("SELECT id FROM grns WHERE po_id = ?")
              .all(poId) as { id: string }[];
            for (const { id: grnId } of grns) {
              db.prepare("DELETE FROM inventory_labels WHERE grn_id = ?").run(
                grnId,
              );
              db.prepare("DELETE FROM grn_items WHERE grn_id = ?").run(grnId);
            }
            db.prepare("DELETE FROM grns WHERE po_id = ?").run(poId);

            const prIds = db
              .prepare("SELECT DISTINCT pr_id FROM pr_items WHERE po_id = ?")
              .all(poId) as { pr_id: string }[];
            // Reset PR items po_id
            db.prepare("UPDATE pr_items SET po_id = NULL WHERE po_id = ?").run(
              poId,
            );

            for (const { pr_id } of prIds) {
              db.prepare(
                "UPDATE purchase_requests SET status = 'AUTHORIZED' WHERE id = ?",
              ).run(pr_id);
              syncProcurementTaskGantt(pr_id);
            }
            db.prepare("DELETE FROM purchase_orders WHERE id = ?").run(poId);
          })();
          res.json({ success: true });
        } catch (error) {
          console.error(error);
          res.status(500).json({ error: "Failed to delete PO" });
        }
      },
    );

    // Get all POs
    app.get(
      "/api/purchasing/pos",
      requireRole(["PURCHASING", "WAREHOUSE", "PRODUCTION", "ENGINEERING"]),
      (req, res) => {
        try {
          const pos = db
            .prepare(
              `
        SELECT 
          po.id,
          po.po_number,
          po.supplier_name,
          po.expected_date,
          po.auth_doc_name,
          po.status,
          po.escalated_to,
          po.urgency,
          po.created_at,
          COUNT(pri.id) as item_count,
          GROUP_CONCAT(DISTINCT pr.pr_number) as pr_numbers,
          MAX(CASE WHEN pr.status = 'CANCELLED' THEN 1 ELSE 0 END) as has_cancelled_pr,
          COALESCE(SUM(pri.qty), 0) - COALESCE((
            SELECT SUM(gi.qty_received)
            FROM grn_items gi
            JOIN grns g ON gi.grn_id = g.id
            WHERE g.po_id = po.id AND g.qc_status IN ('PASSED', 'CONDITIONAL')
          ), 0) as pending_qty
        FROM purchase_orders po
        LEFT JOIN pr_items pri ON po.id = pri.po_id
        LEFT JOIN purchase_requests pr ON pri.pr_id = pr.id
        WHERE po.archived = 0 AND (po.status != 'CANCELLED' OR (po.status = 'CANCELLED' AND po.cancelled_at >= datetime('now', '-1 day')))
        GROUP BY po.id
        ORDER BY po.created_at DESC
      `,
            )
            .all();
          res.json(pos);
        } catch (error) {
          console.error(error);
          res.status(500).json({ error: "Failed to fetch POs" });
        }
      },
    );

    // Get Pending Receipts (POs that are ISSUED or PARTIAL and have remaining items to receive)
    app.get(
      "/api/purchasing/pending-receipts",
      requireRole(["WAREHOUSE", "PURCHASING"]),
      (req, res) => {
        try {
          const items = db
            .prepare(
              `
        SELECT 
          i.id as item_id,
          i.item_code,
          i.name as item_name,
          i.uom,
          po.id as po_id,
          po.po_number,
          po.supplier_name,
          pri.qty as ordered_qty,
          COALESCE((
            SELECT SUM(gi.qty_received) 
            FROM grn_items gi 
            JOIN grns g ON gi.grn_id = g.id 
            WHERE g.po_id = po.id AND gi.item_id = i.id AND g.qc_status IN ('PASSED', 'CONDITIONAL')
          ), 0) as received_qty
        FROM pr_items pri
        JOIN items i ON pri.item_id = i.id
        JOIN purchase_orders po ON pri.po_id = po.id
        WHERE po.status IN ('ISSUED', 'PARTIAL')
        GROUP BY i.id, i.item_code, i.name, i.uom, po.id, po.po_number, po.supplier_name, pri.qty
        HAVING ordered_qty - received_qty > 0
        ORDER BY po.created_at ASC
      `,
            )
            .all();

          // Calculate pending_qty
          const result = items.map((item: any) => ({
            ...item,
            pending_qty: item.ordered_qty - item.received_qty,
          }));

          res.json(result);
        } catch (error) {
          console.error(error);
          res.status(500).json({ error: "Failed to fetch pending receipts" });
        }
      },
    );

    // Get PO Details with Items
    app.get(
      "/api/purchasing/po/:id",
      requireRole(["PURCHASING", "WAREHOUSE", "PRODUCTION", "ENGINEERING"]),
      (req, res) => {
        try {
          const po = db
            .prepare(
              `
        SELECT po.*, 
               GROUP_CONCAT(DISTINCT pr.pr_number) as pr_numbers,
               GROUP_CONCAT(DISTINCT pr.project_id) as project_ids
        FROM purchase_orders po
        LEFT JOIN pr_items pri ON po.id = pri.po_id
        LEFT JOIN purchase_requests pr ON pri.pr_id = pr.id
        WHERE po.id = ?
        GROUP BY po.id
      `,
            )
            .get(req.params.id);

          if (!po) return res.status(404).json({ error: "PO not found" });

          const items = db
            .prepare(
              `
        SELECT 
          i.id as item_id,
          i.item_code,
          i.name as item_name,
          i.uom,
          i.unit_price as db_unit_price,
          MAX(pri.dimension) as dimension,
          MAX(pri.spec) as spec,
          SUM(pri.qty) as qty,
          MAX(pri.unit_price) as unit_price,
          COALESCE((
            SELECT SUM(gi.qty_received) 
            FROM grn_items gi 
            JOIN grns g ON gi.grn_id = g.id 
            WHERE g.po_id = ? AND gi.item_id = i.id AND g.qc_status IN ('PASSED', 'CONDITIONAL')
          ), 0) as received_qty
        FROM pr_items pri
        JOIN items i ON pri.item_id = i.id
        WHERE pri.po_id = ?
        GROUP BY i.id, i.item_code, i.name, i.uom, i.unit_price
      `,
            )
            .all(req.params.id, req.params.id);

          res.json({ ...(po as any), items });
        } catch (error) {
          console.error(error);
          res.status(500).json({ error: "Failed to fetch PO details" });
        }
      },
    );

    // Issue Reject Status for PO
    app.post(
      "/api/purchasing/po/:id/issue-reject",
      requireRole(["PURCHASING", "WAREHOUSE"]),
      (req, res) => {
        try {
          const poId = req.params.id;
          const { reject_doc_name } = req.body;
          db.transaction(() => {
            db.prepare(
              "UPDATE purchase_orders SET status = 'ISSUED' WHERE id = ?",
            ).run(poId);
          })();
          logAudit(
            req.headers["x-user-email"] as string,
            "ISSUE_REJECT",
            "PO",
            poId,
            `Reject document ${reject_doc_name} issued. PO is now back to ISSUED status.`,
          );
          res.json({ success: true });
        } catch (error) {
          console.error(error);
          res.status(500).json({ error: "Failed to issue reject" });
        }
      },
    );

    // Finish PO (Force close)
    app.post(
      "/api/purchasing/po/:id/finish",
      requireRole(["PURCHASING"]),
      (req, res) => {
        try {
          const poId = req.params.id;
          db.prepare(
            "UPDATE purchase_orders SET status = 'FINISHED' WHERE id = ?",
          ).run(poId);
          logAudit(
            req.headers["x-user-email"] as string,
            "FINISH_PO",
            "PO",
            poId,
            `PO forced finished`,
          );
          res.json({ success: true });
        } catch (error) {
          console.error(error);
          res.status(500).json({ error: "Failed to finish PO" });
        }
      },
    );
    app.post(
      "/api/purchasing/complete-grn",
      requireRole(["WAREHOUSE", "ENGINEERING", "PRODUCTION"]),
      (req, res) => {
        try {
          const {
            po_id,
            received_date,
            engineering_user,
            qc_user,
            qc_status,
            remarks,
            rejected_grn_doc,
            items,
          } = req.body;
          const grnId = "GRN-" + Math.random().toString(36).substr(2, 9);
          const isReissue = rejected_grn_doc ? 1 : 0;

          const insertGrn = db.prepare(`
        INSERT INTO grns (id, po_id, received_date, engineering_user, qc_user, qc_status, remarks, rejected_grn_doc, is_reissue)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
          const insertGrnItem = db.prepare(`
        INSERT INTO grn_items (id, grn_id, item_id, dimension, spec, qty_received)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
          const updatePoStatus = db.prepare(
            "UPDATE purchase_orders SET status = ? WHERE id = ?",
          );

          const transaction = db.transaction(() => {
            insertGrn.run(
              grnId,
              po_id,
              received_date,
              engineering_user || null,
              qc_user || null,
              qc_status,
              remarks || null,
              rejected_grn_doc || null,
              isReissue,
            );

            for (const item of items) {
              const grnItemId =
                "GRI-" + Math.random().toString(36).substr(2, 9);
              insertGrnItem.run(
                grnItemId,
                grnId,
                item.item_id,
                item.dimension || null,
                item.spec || null,
                item.qty_received || 0,
              );
            }

            // Calculate new PO status based on total received vs total ordered
            const totalOrderedResult = db
              .prepare(
                "SELECT COALESCE(SUM(qty), 0) as total FROM pr_items WHERE po_id = ?",
              )
              .get(po_id) as { total: number };
            const totalReceivedResult = db
              .prepare(
                `
          SELECT COALESCE(SUM(gi.qty_received), 0) as total 
          FROM grn_items gi 
          JOIN grns g ON gi.grn_id = g.id 
          WHERE g.po_id = ? AND g.qc_status IN ('PASSED', 'CONDITIONAL')
        `,
              )
              .get(po_id) as { total: number };

            let newStatus = "ISSUED";
            if (
              totalReceivedResult.total >= totalOrderedResult.total &&
              totalOrderedResult.total > 0
            ) {
              newStatus = "RECEIVED";
            } else if (totalReceivedResult.total > 0) {
              newStatus = "PARTIAL";
            } else if (qc_status === "REJECTED") {
              // Only mark as rejected if nothing has been successfully received and this one is rejected
              newStatus = "REJECTED";
            }

            updatePoStatus.run(newStatus, po_id);
            return grnId;
          });

          transaction();
          logAudit(
            req.headers["x-user-email"] as string,
            "COMPLETE_GRN",
            "GRN",
            po_id,
            `GRN completed for PO ${po_id}. Status: ${qc_status}`,
          );

          // Sync affected PR tasks in Gantt (accurate & adaptive check)
          try {
            const prs = db
              .prepare("SELECT DISTINCT pr_id FROM pr_items WHERE po_id = ?")
              .all(po_id) as { pr_id: string }[];
            for (const { pr_id } of prs) {
              syncProcurementTaskGantt(pr_id);
            }
          } catch (err) {
            console.error("Post-GRN Gantt sync failed:", err);
          }

          res.json({ success: true, grn_id: grnId });
        } catch (error) {
          console.error(error);
          res.status(500).json({ error: "Failed to complete GRN" });
        }
      },
    );

    app.get(
      "/api/warehouse/pending-incoming",
      requireRole(["WAREHOUSE", "PURCHASING"]),
      (req, res) => {
        try {
          const pendingGRNs = db
            .prepare(
              `
        SELECT 
          g.*,
          po.po_number,
          po.supplier_name
        FROM grns g
        JOIN purchase_orders po ON g.po_id = po.id
        WHERE g.inventory_updated_at IS NULL AND g.qc_status IN ('PASSED', 'CONDITIONAL')
        ORDER BY g.received_date ASC
      `,
            )
            .all();

          const grnItems = db
            .prepare(
              `
        SELECT gi.*, i.item_code, i.name as item_name
        FROM grn_items gi
        JOIN items i ON gi.item_id = i.id
        WHERE gi.grn_id IN (
          SELECT id FROM grns WHERE inventory_updated_at IS NULL AND qc_status IN ('PASSED', 'CONDITIONAL')
        )
      `,
            )
            .all() as any[];

          const formatted = pendingGRNs.map((g: any) => ({
            ...g,
            items: grnItems.filter((i) => i.grn_id === g.id),
          }));

          res.json(formatted);
        } catch (err: any) {
          console.error(err);
          res
            .status(500)
            .json({ error: "Failed to fetch pending incoming GRNs" });
        }
      },
    );

    app.post(
      "/api/warehouse/intake-grn",
      requireRole(["WAREHOUSE"]),
      (req, res) => {
        try {
          const { grn_id } = req.body;

          const grn = db
            .prepare("SELECT * FROM grns WHERE id = ?")
            .get(grn_id) as any;
          if (!grn) return res.status(404).json({ error: "GRN not found" });
          if (grn.inventory_updated_at)
            return res
              .status(400)
              .json({ error: "GRN already intaken into inventory" });

          const items = db
            .prepare("SELECT * FROM grn_items WHERE grn_id = ?")
            .all(grn_id) as any[];

          const updateInventory = db.prepare(
            "INSERT INTO inventory (item_id, free_stock, allocated_stock) VALUES (?, ?, 0) ON CONFLICT(item_id) DO UPDATE SET free_stock = COALESCE(inventory.free_stock, 0) + excluded.free_stock",
          );
          const updateAllocatedInventory = db.prepare(
            "INSERT INTO inventory (item_id, free_stock, allocated_stock) VALUES (?, 0, ?) ON CONFLICT(item_id) DO UPDATE SET allocated_stock = COALESCE(inventory.allocated_stock, 0) + excluded.allocated_stock",
          );
          const insertMovement = db.prepare(
            "INSERT INTO stock_movements (id, item_id, project_id, type, qty, reference_id) VALUES (?, ?, ?, ?, ?, ?)",
          );
          const insertLabel = db.prepare(
            "INSERT INTO inventory_labels (id, item_id, grn_id, original_qty, current_qty, project_id) VALUES (?, ?, ?, ?, ?, ?)",
          );

          let createdLabels: any[] = [];
          db.transaction(() => {
            // Mark GRN as updated
            db.prepare(
              "UPDATE grns SET inventory_updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            ).run(grn_id);

            for (const item of items) {
              // Find how many PR items needed this item associated with this PO to set project_id accurately
              const prevReceivedResult = db
                .prepare(
                  `
            SELECT COALESCE(SUM(gi.qty_received), 0) as total
            FROM grn_items gi
            JOIN grns g ON gi.grn_id = g.id
            WHERE g.po_id = ? AND gi.item_id = ? AND g.id != ? AND g.qc_status IN ('PASSED', 'CONDITIONAL')
          `,
                )
                .get(grn.po_id, item.item_id, grn_id) as { total: number };

              let remainingToSkip = prevReceivedResult.total;
              let remainingQty = item.qty_received;

              const prItems = db
                .prepare(
                  `
            SELECT pri.id, pri.qty, pr.project_id 
            FROM pr_items pri
            JOIN purchase_requests pr ON pri.pr_id = pr.id
            WHERE pri.po_id = ? AND pri.item_id = ?
            ORDER BY pr.created_at ASC
          `,
                )
                .all(grn.po_id, item.item_id) as {
                id: string;
                qty: number;
                project_id: string;
              }[];

              for (const prItem of prItems) {
                if (remainingQty <= 0) break;

                let prItemRemainingQty = prItem.qty;
                if (remainingToSkip > 0) {
                  const skipAmount = Math.min(
                    remainingToSkip,
                    prItemRemainingQty,
                  );
                  prItemRemainingQty -= skipAmount;
                  remainingToSkip -= skipAmount;
                }

                if (prItemRemainingQty > 0) {
                  const allocateQty = Math.min(
                    remainingQty,
                    prItemRemainingQty,
                  );
                  const labelId =
                    "LBL-" +
                    Math.random().toString(36).substr(2, 9).toUpperCase();

                  updateInventory.run(item.item_id, allocateQty);

                  insertMovement.run(
                    "MOV-" + Math.random().toString(36).substr(2, 9),
                    item.item_id,
                    prItem.project_id || null,
                    "GRN",
                    allocateQty,
                    grn_id,
                  );
                  insertLabel.run(
                    labelId,
                    item.item_id,
                    grn_id,
                    allocateQty,
                    allocateQty,
                    prItem.project_id || null,
                  );
                  createdLabels.push({
                    id: labelId,
                    item_id: item.item_id,
                    qty: allocateQty,
                    project_id: prItem.project_id || null,
                  });
                  remainingQty -= allocateQty;
                }
              }

              if (remainingQty > 0) {
                updateInventory.run(item.item_id, remainingQty);
                insertMovement.run(
                  "MOV-" + Math.random().toString(36).substr(2, 9),
                  item.item_id,
                  null,
                  "GRN",
                  remainingQty,
                  grn_id,
                );
                const labelId =
                  "LBL-" +
                  Math.random().toString(36).substr(2, 9).toUpperCase();
                insertLabel.run(
                  labelId,
                  item.item_id,
                  grn_id,
                  remainingQty,
                  remainingQty,
                  null,
                );
                createdLabels.push({
                  id: labelId,
                  item_id: item.item_id,
                  qty: remainingQty,
                  project_id: null,
                });
              }
            }
          })();

          // Fetch the full label details with item codes so the frontend can print them immediately
          const fullLabels = createdLabels.map((lbl) => {
            const itemInfo = db
              .prepare("SELECT item_code, name, uom FROM items WHERE id = ?")
              .get(lbl.item_id) as any;
            return {
              ...lbl,
              ...itemInfo,
            };
          });

          logAudit(
            req.headers["x-user-email"] as string,
            "WAREHOUSE_INTAKE",
            "GRN",
            grn_id,
            `GRN ${grn_id} intaken to warehouse.`,
          );
          res.json({
            success: true,
            labels: fullLabels,
            po_number: grn.po_number || "N/A",
          });
        } catch (error: any) {
          console.error(error);
          res
            .status(500)
            .json({ error: error.message || "Failed to intake GRN" });
        }
      },
    );

    app.post(
      "/api/warehouse/return-grn",
      requireRole(["WAREHOUSE", "PURCHASING"]),
      (req, res) => {
        try {
          const id = req.body.grn_id || req.body.id;
          if (!id) return res.status(400).json({ error: "Missing GRN ID" });

          const grn = db
            .prepare("SELECT * FROM grns WHERE id = ?")
            .get(id) as any;
          if (!grn) return res.status(404).json({ error: "GRN not found" });
          if (grn.inventory_updated_at)
            return res.status(400).json({ error: "GRN already processed" });

          db.prepare(
            "UPDATE grns SET inventory_updated_at = CURRENT_TIMESTAMP WHERE id = ?",
          ).run(id);

          logAudit(
            req.headers["x-user-email"] as string,
            "WAREHOUSE_RETURN",
            "GRN",
            id,
            `Rejected GRN ${id} marked as returned to supplier.`,
          );
          res.json({ success: true });
        } catch (e: any) {
          console.error(e);
          res
            .status(500)
            .json({ error: e.message || "Failed to process return" });
        }
      },
    );

    // Revise PO
    app.post(
      "/api/purchasing/revise-po",
      requireRole(["PURCHASING", "FC"]),
      (req, res) => {
        const userRole = (req as any).userRole;
        const userLevel = (req as any).userLevel;
        if (
          userRole !== "FC" &&
          (userRole !== "PURCHASING" || userLevel !== "MANAGER")
        ) {
          return res.status(403).json({
            error:
              "Access denied. Only Purchasing Managers or FC accounts can revise POs.",
          });
        }
        try {
          const { po_id, revision_note } = req.body;
          if (!revision_note) {
            return res.status(400).json({ error: "Revision note is required" });
          }

          db.prepare(
            "UPDATE purchase_orders SET status = 'REVISION', revision_note = ? WHERE id = ?",
          ).run(revision_note, po_id);

          const po = db
            .prepare("SELECT po_number FROM purchase_orders WHERE id = ?")
            .get(po_id) as any;
          logAudit(
            req.headers["x-user-email"] as string,
            "REVISE_PO",
            "PO",
            po_id,
            `PO ${po?.po_number} marked for revision. Note: ${revision_note}`,
          );

          res.json({ success: true, message: "PO marked for revision" });
        } catch (error) {
          console.error("Failed to revise PO:", error);
          res.status(500).json({ error: "Failed to revise PO" });
        }
      },
    );

    // Authorize PO
    app.post(
      "/api/purchasing/authorize-po",
      (req, res) => {
        const userRole = (req as any).userRole;
        const userLevel = (req as any).userLevel;
        try {
          const { po_id, auth_doc_name } = req.body;
          
          const po = db.prepare("SELECT * FROM purchase_orders WHERE id = ?").get(po_id) as any;
          if (!po) return res.status(404).json({ error: "PO not found" });

          const isDirectlyAuthorized = userRole === "FC" || (userRole === "PURCHASING" && userLevel === "MANAGER");
          const isEscalatedAuthority = po.escalated_to && userRole === po.escalated_to;

          if (!isDirectlyAuthorized && !isEscalatedAuthority) {
            return res
              .status(403)
              .json({
                error:
                  "Access denied. Only Purchasing Managers, FC accounts or Escalated personnel can authorize Purchase Orders.",
              });
          }

          const transaction = db.transaction(() => {
            // 1. Update PO status
            db.prepare(
              "UPDATE purchase_orders SET status = 'ISSUED', authorized_at = CURRENT_TIMESTAMP, auth_doc_name = ? WHERE id = ?",
            ).run(auth_doc_name || null, po_id);
          });

          transaction();
          logAudit(
            req.headers["x-user-email"] as string,
            "AUTHORIZE_PO",
            "PO",
            po_id,
            `PO authorized with document: ${auth_doc_name}.`,
          );

          // Update affected Gantt tasks on PO authorization
          try {
            const prs = db
              .prepare("SELECT DISTINCT pr_id FROM pr_items WHERE po_id = ?")
              .all(po_id) as { pr_id: string }[];
            for (const { pr_id } of prs) {
              syncProcurementTaskGantt(pr_id);
            }
          } catch (err) {
            console.error("Post-authorization Gantt sync failed:", err);
          }

          res.json({ success: true });
        } catch (error) {
          console.error(error);
          res.status(500).json({ error: "Failed to authorize PO" });
        }
      },
    );

    app.post(
      "/api/inventory/return",
      requireRole(["PRODUCTION", "WAREHOUSE"]),
      (req, res) => {
        try {
          const { item_id, qty, project_id, recorded_by } = req.body;

          const transaction = db.transaction(() => {
            if (project_id) {
              const project = db
                .prepare("SELECT status FROM projects WHERE id = ?")
                .get(project_id) as { status: string } | undefined;
              if (project && project.status === "FINISHED") {
                throw new Error("Cannot return items for a finished project.");
              }
            }

            // Return stock back to free inventory
            db.prepare(
              "UPDATE inventory SET free_stock = free_stock + ? WHERE item_id = ?",
            ).run(qty, item_id);

            const movId = "MOV-" + Math.random().toString(36).substr(2, 9);
            db.prepare(
              "INSERT INTO stock_movements (id, item_id, project_id, type, qty, recorded_by) VALUES (?, ?, ?, ?, ?, ?)",
            ).run(
              movId,
              item_id,
              project_id || null,
              "RETURN",
              qty,
              recorded_by || "SHOP_FLOOR",
            );

            if (project_id) {
              const bom = db
                .prepare(
                  "SELECT id FROM boms WHERE project_id = ? AND item_id = ?",
                )
                .get(project_id, item_id) as { id: string } | undefined;
              if (bom) {
                db.prepare(
                  "UPDATE bom_item_consumption SET qty_consumed = MAX(0, qty_consumed - ?), updated_at = CURRENT_TIMESTAMP WHERE bom_id = ?",
                ).run(qty, bom.id);
              }
            }
          });

          transaction();
          res.json({ success: true });
        } catch (err: any) {
          console.error(err);
          res
            .status(400)
            .json({ error: err.message || "Failed to return item" });
        }
      },
    );

    // Shop Floor: Consume Item
    app.post(
      "/api/inventory/consume",
      requireRole(["PRODUCTION", "WAREHOUSE"]),
      (req, res) => {
        try {
          const { item_id, qty, project_id, recorded_by } = req.body;

          const transaction = db.transaction(() => {
            if (project_id) {
              const project = db
                .prepare("SELECT status FROM projects WHERE id = ?")
                .get(project_id) as { status: string };
              if (project && project.status === "FINISHED") {
                throw new Error("Cannot consume items for a finished project.");
              }
            }

            const inv = db
              .prepare("SELECT free_stock FROM inventory WHERE item_id = ?")
              .get(item_id) as { free_stock: number };

            // Use free stock
            if (inv.free_stock < qty) {
              throw new Error(
                `Insufficient free stock. Available: ${inv.free_stock}`,
              );
            }
            db.prepare(
              "UPDATE inventory SET free_stock = free_stock - ? WHERE item_id = ?",
            ).run(qty, item_id);

            // 3. Record Movement
            const movId = "MOV-" + Math.random().toString(36).substr(2, 9);
            db.prepare(
              "INSERT INTO stock_movements (id, item_id, project_id, type, qty, recorded_by) VALUES (?, ?, ?, ?, ?, ?)",
            ).run(
              movId,
              item_id,
              project_id || null,
              "CONSUMPTION",
              -qty,
              recorded_by || "SHOP_FLOOR",
            );

            if (project_id) {
              // 4. Update BOM Consumption if exists for this project/item
              const bom = db
                .prepare(
                  "SELECT id FROM boms WHERE project_id = ? AND item_id = ?",
                )
                .get(project_id, item_id) as { id: string } | undefined;
              if (bom) {
                db.prepare(
                  "UPDATE bom_item_consumption SET qty_consumed = qty_consumed + ?, updated_at = CURRENT_TIMESTAMP WHERE bom_id = ?",
                ).run(qty, bom.id);
              }
            }
          });

          transaction();
          logAudit(
            req.headers["x-user-email"] as string,
            "CONSUME_STOCK",
            "ITEM",
            item_id,
            `Consumed ${qty} for project ${project_id || "GENERAL"}. Recorded by ${recorded_by}`,
          );
          res.json({ success: true });
        } catch (error: any) {
          console.error(error);
          res
            .status(400)
            .json({ error: error.message || "Failed to consume item" });
        }
      },
    );

    // Get Stock Movements
    app.get(
      "/api/inventory/movements",
      requireRole(["WAREHOUSE", "PURCHASING", "PRODUCTION", "ENGINEERING"]),
      (req, res) => {
        try {
          const limit = parseInt(req.query.limit as string) || 100;
          const offset = parseInt(req.query.offset as string) || 0;
          const movements = db
            .prepare(
              `
        SELECT m.*, i.item_code, i.name as item_name, i.uom, p.name as project_name,
               po.po_number, po.supplier_name, pr_info.pr_numbers
        FROM stock_movements m
        JOIN items i ON m.item_id = i.id
        LEFT JOIN projects p ON m.project_id = p.id
        LEFT JOIN grns g ON (m.reference_id = g.id AND m.type = 'GRN')
        LEFT JOIN purchase_orders po ON g.po_id = po.id
        LEFT JOIN (
          SELECT pri.po_id, GROUP_CONCAT(DISTINCT pr.pr_number) as pr_numbers
          FROM pr_items pri
          JOIN purchase_requests pr ON pri.pr_id = pr.id
          GROUP BY pri.po_id
        ) pr_info ON po.id = pr_info.po_id
        ORDER BY m.created_at DESC
        LIMIT ? OFFSET ?
      `,
            )
            .all(limit, offset);

          const totalCount = db
            .prepare("SELECT COUNT(*) as count FROM stock_movements")
            .get() as any;

          res.json({ movements, total: totalCount.count });
        } catch (error) {
          console.error(error);
          res.status(500).json({ error: "Failed to fetch movements" });
        }
      },
    );

    // System Reset (for Maintenance)
    app.post("/api/system/reset", requireRole(["FC"]), (req, res) => {
      try {
        resetFactoryData();
        logAudit(
          "SYSTEM",
          "DATABASE_RESET",
          "SYSTEM",
          "ALL",
          "Database was reset to initial zero state",
        );
        res.json({ status: "ok", message: "System reset successful" });
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to reset system" });
      }
    });

    // Get Inventory Summary (for Dashboard)
    app.get(
      "/api/inventory/summary",
      requireRole(["PURCHASING", "WAREHOUSE", "PRODUCTION", "ENGINEERING"]),
      (req, res) => {
        try {
          const summary = {
            total_skus: (
              db
                .prepare("SELECT COUNT(*) as count FROM items WHERE 1=1")
                .get() as any
            ).count,
            low_stock: (
              db
                .prepare(
                  "SELECT COUNT(*) as count FROM inventory WHERE free_stock < 5",
                )
                .get() as any
            ).count,
            pending_grns: (
              db
                .prepare(
                  "SELECT COUNT(*) as count FROM grns WHERE inventory_updated_at IS NULL AND qc_status IN ('PASSED', 'CONDITIONAL', 'REJECTED')",
                )
                .get() as any
            ).count,
            recent_movements: db
              .prepare(
                `
          SELECT m.*, i.item_code, i.name as item_name 
          FROM stock_movements m 
          JOIN items i ON m.item_id = i.id 
          ORDER BY m.created_at DESC LIMIT 5
        `,
              )
              .all(),
          };
          res.json(summary);
        } catch (error) {
          console.error(error);
          res.status(500).json({ error: "Failed to fetch summary" });
        }
      },
    );

    // Get Inventory (for Shop Floor)
    app.get(
      "/api/inventory",
      requireRole(["PRODUCTION", "WAREHOUSE"]),
      (req, res) => {
        try {
          const items = db
            .prepare(
              `
        SELECT i.*, inv.free_stock, inv.allocated_stock
        FROM items i
        JOIN inventory inv ON i.id = inv.item_id
        WHERE inv.free_stock > 0 OR inv.allocated_stock > 0
      `,
            )
            .all();
          res.json(items);
        } catch (error) {
          console.error(error);
          res.status(500).json({ error: "Failed to fetch inventory" });
        }
      },
    );

    // Forum API
    app.get("/api/forum/posts", (req, res) => {
      try {
        const posts = db
          .prepare(
            `
        SELECT p.*, COUNT(c.id) as comment_count 
        FROM forum_posts p
        LEFT JOIN forum_comments c ON p.id = c.post_id
        GROUP BY p.id
        ORDER BY 
          CASE WHEN p.pinned_until > datetime('now') THEN 0 ELSE 1 END,
          p.created_at DESC
      `,
          )
          .all();
        res.json(posts);
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to fetch posts" });
      }
    });

    app.post("/api/forum/posts", (req, res) => {
      try {
        const {
          title,
          content,
          author_username,
          author_role,
          category,
          pinned_until,
          shared_resource_type,
          shared_resource_id,
        } = req.body;
        const id = "POST-" + Math.random().toString(36).substr(2, 9);
        db.prepare(
          `
        INSERT INTO forum_posts (id, title, content, author_username, author_role, category, pinned_until, shared_resource_type, shared_resource_id) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        ).run(
          id,
          title,
          content,
          author_username,
          author_role,
          category,
          pinned_until || null,
          shared_resource_type || null,
          shared_resource_id || null,
        );
        res.json({ success: true, id });
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to create post" });
      }
    });

    app.post("/api/forum/share", (req, res) => {
      try {
        const { type, id, title, content, author_username, author_role } =
          req.body;
        const postId = "POST-" + Math.random().toString(36).substr(2, 9);
        db.prepare(
          `
        INSERT INTO forum_posts (id, title, content, author_username, author_role, category, shared_resource_type, shared_resource_id) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
        ).run(
          postId,
          title,
          content,
          author_username,
          author_role,
          "SHARED_RESOURCE",
          type,
          id,
        );
        res.json({ success: true, id: postId });
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to share resource" });
      }
    });

    app.get("/api/forum/posts/:id/comments", (req, res) => {
      try {
        const comments = db
          .prepare(
            "SELECT * FROM forum_comments WHERE post_id = ? ORDER BY created_at ASC",
          )
          .all(req.params.id);
        res.json(comments);
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to fetch comments" });
      }
    });

    app.post("/api/forum/posts/:id/comments", (req, res) => {
      try {
        const { content, author_username, author_role } = req.body;
        const id = "COM-" + Math.random().toString(36).substr(2, 9);
        db.prepare(
          "INSERT INTO forum_comments (id, post_id, content, author_username, author_role) VALUES (?, ?, ?, ?, ?)",
        ).run(id, req.params.id, content, author_username, author_role);
        res.json({ success: true, id });
      } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to create comment" });
      }
    });

    // --- PROJECT CLOSING ---
    app.post(
      "/api/projects/:id/close",
      requireRole(["ENGINEERING", "PRODUCTION"]),
      (req, res) => {
        const { id } = req.params;
        try {
          db.transaction(() => {
            // 1. Audit check for unconsumed allocations
            // 2. Auto-cancel any un-ordered PRs
            db.prepare(
              "UPDATE purchase_requests SET status = 'CANCELLED' WHERE project_id = ? AND status IN ('DRAFTED', 'AUTHORIZED')",
            ).run(id);

            // Update project status
            db.prepare(
              'UPDATE projects SET status = "CLOSED", archived_at = CURRENT_TIMESTAMP WHERE id = ?',
            ).run(id);

            // Automagically transition related undelivered delivery notes to DELIVERED status for billing readiness
            db.prepare(
              "UPDATE delivery_notes SET status = 'DELIVERED', delivered_at = CURRENT_TIMESTAMP WHERE project_id = ? AND status != 'DELIVERED'",
            ).run(id);

            // Log audit
            logAudit(
              (req.headers["x-user-email"] as string) || "SYSTEM",
              "PROJECT_CLOSED",
              "PROJECT",
              id,
              `Project ${id} closed. Net allocations reclaimed, and related delivery notes updated to DELIVERED status.`,
            );
          })();

          res.json({ success: true });
        } catch (err: any) {
          res.status(500).json({ error: err.message });
        }
      },
    );

    // --- STOCK ADJUSTMENT ---
    app.post(
      "/api/inventory/adjust-v2",
      requireRole(["WAREHOUSE"]),
      (req, res) => {
        const { item_id, new_free_stock, reason, username, item_name, uom } =
          req.body;
        try {
          db.transaction(() => {
            const oldStock = db
              .prepare("SELECT free_stock FROM inventory WHERE item_id = ?")
              .get(item_id) as { free_stock: number } | undefined;

            db.prepare(
              "UPDATE inventory SET free_stock = ? WHERE item_id = ?",
            ).run(new_free_stock, item_id);

            // Update item metadata if provided
            if (item_name || uom) {
              const updates: string[] = [];
              const params: any[] = [];
              if (item_name) {
                updates.push("name = ?");
                params.push(item_name);
              }
              if (uom) {
                updates.push("uom = ?");
                params.push(uom);
              }
              params.push(item_id);
              db.prepare(
                `UPDATE items SET ${updates.join(", ")} WHERE id = ?`,
              ).run(...params);
            }

            const diff =
              Number(new_free_stock) -
              (oldStock ? Number(oldStock.free_stock) : 0);
            if (diff !== 0) {
              db.prepare(
                "INSERT INTO stock_movements (id, item_id, type, qty, recorded_by, reference_id) VALUES (?, ?, ?, ?, ?, ?)",
              ).run(
                "MOV-" + Math.random().toString(36).substr(2, 9),
                item_id,
                "ADJUSTMENT",
                diff,
                username,
                reason,
              );
            }

            logAudit(
              username,
              "STOCK_ADJUSTMENT",
              null,
              null,
              `${username} adjusted stock for ${item_id} from ${oldStock?.free_stock} to ${new_free_stock}${item_name ? ` (Name updated to ${item_name})` : ""}${uom ? ` (UOM updated to ${uom})` : ""}. Reason: ${reason}`
            );
          })();

          res.json({ success: true });
        } catch (err: any) {
          console.error(err);
          res.status(500).json({ error: err.message });
        }
      },
    );

    app.get(
      "/api/warehouse/item-allocation-info",
      requireRole(["WAREHOUSE", "PURCHASING", "PRODUCTION", "ENGINEERING"]),
      (req, res) => {
        try {
          const { po_number, item_id } = req.query;
          // Get the PO ID from po_number
          const po = db
            .prepare("SELECT id FROM purchase_orders WHERE po_number = ?")
            .get(po_number) as { id: string } | undefined;

          if (!po) {
            return res.json({ projects: [] });
          }

          // Find all projects that had a PR for this item in this PO
          const prItems = db
            .prepare(
              `
        SELECT DISTINCT pr.project_id
        FROM pr_items pri
        JOIN purchase_requests pr ON pri.pr_id = pr.id
        WHERE pri.po_id = ? AND pri.item_id = ? AND pr.project_id IS NOT NULL
      `,
            )
            .all(po.id, item_id) as { project_id: string }[];

          res.json({ projects: prItems.map((p) => p.project_id) });
        } catch (err: any) {
          console.error(err);
          res.status(500).json({ error: err.message });
        }
      },
    );

    // --- RECENT ACTIVITY ---
    app.post(
      "/api/inventory/reset",
      requireRole(["FC", "WAREHOUSE"]),
      (req, res) => {
        try {
          db.transaction(() => {
            db.prepare(
              "UPDATE inventory SET free_stock = 0, allocated_stock = 0",
            ).run();
            logAudit(
               (req.headers["x-user-email"] as string) || "System",
               "WAREHOUSE_RESET",
               null,
               null,
               "All inventory stock levels reset to zero."
            );
          })();
          res.json({ success: true });
        } catch (err) {
          res.status(500).json({ error: err.message });
        }
      },
    );

    // --- BOM TEMPLATES ---
    app.get("/api/bom-templates", (req, res) => {
      try {
        const templates = db
          .prepare("SELECT * FROM bom_templates ORDER BY created_at DESC")
          .all();
        res.json(templates);
      } catch (error) {
        res.status(500).json({ error: "Failed to fetch templates" });
      }
    });

    app.get("/api/bom-templates/:id", (req, res) => {
      try {
        const template = db
          .prepare("SELECT * FROM bom_templates WHERE id = ?")
          .get(req.params.id) as any;
        if (!template)
          return res.status(404).json({ error: "Template not found" });
        const items = db
          .prepare(
            `
        SELECT ti.*, i.item_code, i.name as item_name, i.uom
        FROM bom_template_items ti
        JOIN items i ON ti.item_id = i.id
        WHERE ti.template_id = ?
      `,
          )
          .all(req.params.id);
        res.json({ ...template, items });
      } catch (error) {
        res.status(500).json({ error: "Failed to fetch template details" });
      }
    });

    app.post(
      "/api/projects/:id/save-as-template",
      requireRole(["ENGINEERING", "PRODUCTION"]),
      (req, res) => {
        const { id } = req.params;
        const { name, description } = req.body;
        try {
          const templateId = "BMT-" + Math.random().toString(36).substr(2, 9);
          db.transaction(() => {
            db.prepare(
              "INSERT INTO bom_templates (id, name, description) VALUES (?, ?, ?)",
            ).run(templateId, name, description);

            const boms = db
              .prepare("SELECT * FROM boms WHERE project_id = ?")
              .all(id) as any[];
            const insertItem = db.prepare(`
          INSERT INTO bom_template_items (id, template_id, item_id, dimension, spec, required_qty, unit_price)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

            for (const bom of boms) {
              insertItem.run(
                "BTI-" + Math.random().toString(36).substr(2, 9),
                templateId,
                bom.item_id,
                bom.dimension,
                bom.spec,
                bom.required_qty,
                bom.unit_price,
              );
            }
          })();
          res.json({ success: true, id: templateId });
        } catch (error) {
          res.status(500).json({ error: "Failed to save template" });
        }
      },
    );

    app.post(
      "/api/projects/:id/clone-bom",
      requireRole(["ENGINEERING", "PRODUCTION"]),
      (req, res) => {
        const { id } = req.params;
        const { reference_project_id } = req.body;
        try {
          db.transaction(() => {
            const items = db
              .prepare("SELECT * FROM boms WHERE project_id = ?")
              .all(reference_project_id) as any[];
            const insertBom = db.prepare(`
          INSERT INTO boms (id, project_id, item_id, dimension, spec, required_qty, unit_price)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

            for (const item of items) {
              insertBom.run(
                "BOM-" + Math.random().toString(36).substr(2, 9),
                id,
                item.item_id,
                item.dimension,
                item.spec,
                item.required_qty,
                item.unit_price,
              );
            }
            db.prepare(
              "UPDATE projects SET bq_updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            ).run(id);
          })();
          res.json({ success: true });
        } catch (error) {
          res.status(500).json({ error: "Failed to clone BOM" });
        }
      },
    );

    // --- STOCK RESERVATION ---
    app.post("/api/projects/:id/reserve-stock", (req, res) => {
      res.json({ success: true, message: "Reservation is disabled." });
    });

    app.post(
      "/api/projects/:id/repeat",
      requireRole(["ENGINEERING", "PRODUCTION"]),
      (req, res) => {
        const { id } = req.params;
        const { new_name, new_due_date } = req.body;

        try {
          let newProjectId = "";
          db.transaction(() => {
            const parentProject = db
              .prepare("SELECT * FROM projects WHERE id = ?")
              .get(id) as any;
            if (!parentProject) throw new Error("Parent project not found");

            newProjectId = "PRJ-" + Math.random().toString(36).substr(2, 9);

            // 1. Create new project
            db.prepare(
              `
          INSERT INTO projects (id, name, due_date, customer, remarks, parent_project_id, status, quotation_id, qty, uom, urgency)
          VALUES (?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?)
        `,
            ).run(
              newProjectId,
              new_name || `Repeat of ${parentProject.name}`,
              new_due_date || parentProject.due_date,
              parentProject.customer,
              parentProject.remarks,
              id,
              parentProject.quotation_id || null,
              parentProject.qty || 1,
              parentProject.uom || "Unit",
              parentProject.urgency || "NORMAL",
            );

            // 2. Copy BOM
            const boms = db
              .prepare("SELECT * FROM boms WHERE project_id = ?")
              .all(id) as any[];
            const insertBom = db.prepare(`
          INSERT INTO boms (id, project_id, item_id, dimension, spec, required_qty, unit_price)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
            for (const bom of boms) {
              const newBomId = "BOM-" + Math.random().toString(36).substr(2, 9);
              insertBom.run(
                newBomId,
                newProjectId,
                bom.item_id,
                bom.dimension,
                bom.spec,
                bom.required_qty,
                bom.unit_price,
              );
            }

            // 3. Copy Tasks
            const tasks = db
              .prepare("SELECT * FROM project_tasks WHERE project_id = ?")
              .all(id) as any[];
            const insertTask = db.prepare(`
          INSERT INTO project_tasks (id, project_id, task_name, work_center_id, required_hours, start_date, end_date, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')
        `);

            // Calculate date shift
            const parentStart = new Date(
              parentProject.created_at || Date.now(),
            );
            const newStart = new Date();
            const shiftMs = newStart.getTime() - parentStart.getTime();

            for (const task of tasks) {
              const newTaskId =
                "TSK-" + Math.random().toString(36).substr(2, 9);

              let newStartDate = task.start_date;
              let newEndDate = task.end_date;

              if (task.start_date && task.end_date) {
                const sd = new Date(task.start_date);
                const ed = new Date(task.end_date);
                sd.setTime(sd.getTime() + shiftMs);
                ed.setTime(ed.getTime() + shiftMs);
                newStartDate = sd.toISOString().split("T")[0];
                newEndDate = ed.toISOString().split("T")[0];
              }

              insertTask.run(
                newTaskId,
                newProjectId,
                task.task_name,
                task.work_center_id,
                task.required_hours,
                newStartDate,
                newEndDate,
              );
            }
          })();

          logAudit(
            req.headers["x-user-email"] as string,
            "REPEAT_PROJECT",
            "PROJECT",
            newProjectId,
            `Created repeat of project ${id}`,
          );
          res.json({ success: true, id: newProjectId });
        } catch (error) {
          console.error(error);
          res.status(500).json({ error: "Failed to repeat project" });
        }
      },
    );

    app.delete(
      "/api/projects/:id",
      requireRole(["FC", "ENGINEERING"]),
      (req, res) => {
        const userRole = (req as any).userRole;
        const userLevel = (req as any).userLevel;
        if (
          userRole !== "FC" &&
          (userRole !== "ENGINEERING" || userLevel !== "MANAGER")
        ) {
          return res
            .status(403)
            .json({ error: "Access denied. Only FC or Engineering Manager can delete projects." });
        }
        try {
          const projectId = req.params.id;
          db.transaction(() => {
            db.prepare(
              "UPDATE projects SET status = 'CANCELLED', archived_at = CURRENT_TIMESTAMP WHERE id = ?",
            ).run(projectId);

            // Auto-cancel any un-ordered PRs
            db.prepare(
              "UPDATE purchase_requests SET status = 'CANCELLED' WHERE project_id = ? AND status IN ('DRAFTED', 'AUTHORIZED')",
            ).run(projectId);

            // Release unconsumed allocated stock
            const uniqueItems = db
              .prepare("SELECT DISTINCT item_id FROM boms WHERE project_id = ?")
              .all(projectId) as { item_id: string }[];
            for (const { item_id } of uniqueItems) {
              const allocResult = db
                .prepare(
                  `
            SELECT COALESCE(SUM(qty), 0) as total_alloc
            FROM stock_movements
            WHERE project_id = ? AND item_id = ? AND type IN ('ALLOCATION', 'GRN_ALLOCATION')
          `,
                )
                .get(projectId, item_id) as any;

              const consumeResult = db
                .prepare(
                  `
            SELECT COALESCE(SUM(ABS(qty)), 0) as total_consumed
            FROM stock_movements
            WHERE project_id = ? AND item_id = ? AND type = 'CONSUMPTION'
          `,
                )
                .get(projectId, item_id) as any;

              const remaining =
                (allocResult.total_alloc || 0) -
                (consumeResult.total_consumed || 0);
              const projectAllocated = Math.max(0, remaining);
              if (projectAllocated > 0) {
                db.prepare(
                  "INSERT INTO stock_movements (id, item_id, project_id, type, qty, reference_id) VALUES (?, ?, ?, 'RELEASE', ?, ?)",
                ).run(
                  "MOV-" + Math.random().toString(36).substr(2, 9),
                  item_id,
                  projectId,
                  projectAllocated,
                  "Auto-release on cancel",
                );
              }
            }

            // Cancel pending/in-progress tasks
            db.prepare(
              "UPDATE project_tasks SET status = 'COMPLETED' WHERE project_id = ? AND status != 'COMPLETED'",
            ).run(projectId);

            logAudit(
              req.headers["x-user-email"] as string,
              "CANCEL_PROJECT",
              "PROJECT",
              projectId,
              "Project cancelled and resources released.",
            );
          })();
          res.json({ success: true });
        } catch (error) {
          console.error(error);
          res.status(500).json({ error: "Failed to cancel project" });
        }
      },
    );

    // --- USER DRAFTS API (AUTO-SAVE) ---
    app.get("/api/user-drafts/:key", (req, res) => {
      try {
        const { key } = req.params;
        const username = (req.headers["x-user-email"] as string) || "default";
        const draft = db
          .prepare(
            "SELECT data FROM user_drafts WHERE key = ? AND username = ?",
          )
          .get(key, username) as any;

        if (draft) {
          res.json({ success: true, data: JSON.parse(draft.data) });
        } else {
          res.json({ success: true, data: null });
        }
      } catch (error) {
        console.error("Failed to get draft:", error);
        res.status(500).json({ error: "Failed to get draft" });
      }
    });

    app.post("/api/user-drafts/:key", (req, res) => {
      try {
        const { key } = req.params;
        const username = (req.headers["x-user-email"] as string) || "default";
        const { data } = req.body;

        db.prepare(
          `
        INSERT INTO user_drafts (key, username, data, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key, username) DO UPDATE SET 
        data = excluded.data, 
        updated_at = CURRENT_TIMESTAMP
      `,
        ).run(key, username, JSON.stringify(data));

        res.json({ success: true });
      } catch (error) {
        console.error("Failed to save draft:", error);
        res.status(500).json({ error: "Failed to save draft" });
      }
    });

    app.delete("/api/user-drafts/:key", (req, res) => {
      try {
        const { key } = req.params;
        const username = (req.headers["x-user-email"] as string) || "default";
        db.prepare(
          "DELETE FROM user_drafts WHERE key = ? AND username = ?",
        ).run(key, username);
        res.json({ success: true });
      } catch (error) {
        console.error("Failed to delete draft:", error);
        res.status(500).json({ error: "Failed to delete draft" });
      }
    });

    app.get("/api/users/all", requireRole(["FC"]), (req, res) => {
      try {
        const users = db
          .prepare(
            "SELECT id, username, role, level, name, status, created_at FROM users WHERE status != 'PENDING' ORDER BY name ASC",
          )
          .all();
        res.json(users);
      } catch (e) {
        res.status(500).json({ error: "Failed to fetch users" });
      }
    });

    app.put("/api/users/:id/role", requireRole(["FC"]), (req, res) => {
      try {
        const { role, level } = req.body;
        const targetUser = db
          .prepare("SELECT role FROM users WHERE id = ?")
          .get(req.params.id) as any;
        if (targetUser && targetUser.role === "FC") {
          return res
            .status(403)
            .json({ error: "Cannot modify Full Control accounts" });
        }
        db.prepare("UPDATE users SET role = ?, level = ? WHERE id = ?").run(
          role,
          level || "STAFF",
          req.params.id,
        );
        res.json({ success: true });
      } catch (e) {
        res.status(500).json({ error: "Failed to update role" });
      }
    });

    app.delete("/api/users/:id", requireRole(["FC"]), (req, res) => {
      try {
        const userToDelete = db
          .prepare("SELECT username, role FROM users WHERE id = ?")
          .get(req.params.id) as any;
        if (!userToDelete) {
          return res.status(404).json({ error: "User not found" });
        }

        if (userToDelete.role === "FC") {
          const fcCount = db
            .prepare(
              "SELECT COUNT(*) as count FROM users WHERE role = 'FC' AND status = 'APPROVED'",
            )
            .get() as { count: number };
          if (fcCount.count <= 1) {
            return res
              .status(403)
              .json({ error: "Cannot delete the last Full Control account" });
          }
        }

        db.transaction(() => {
          db.pragma("foreign_keys = OFF");
          const username = userToDelete.username;
          // Clean up references where we can
          db.prepare("DELETE FROM chat_participants WHERE username = ?").run(
            username,
          );
          db.prepare("DELETE FROM user_drafts WHERE username = ?").run(
            username,
          );

          db.prepare("DELETE FROM users WHERE id = ?").run(req.params.id);
          db.pragma("foreign_keys = ON");
        })();
        res.json({ success: true });
      } catch (e: any) {
        console.error("Delete user error:", e);
        if (e.code === "SQLITE_CONSTRAINT_FOREIGNKEY") {
          console.error("Foreign Key details:", e.message);
        }
        res.status(500).json({ error: "Failed to delete user" });
      }
    });

    app.get("/api/users/directory", (req, res) => {
      try {
        const users = db
          .prepare(
            "SELECT username, name, role FROM users WHERE status = 'APPROVED'",
          )
          .all();
        res.json(users);
      } catch (e) {
        res.status(500).json({ error: "Failed to fetch users" });
      }
    });

    // ==========================================
    // HUMAN RESOURCE / HR SUB-SYSTEM ENDPOINTS
    // ==========================================

    // Gap 3 Solved: Algoritma Penggajian Otomatis (HRIS -> Finance)
    app.post("/api/hr/generate-payroll", requireRole(["FC", "HR"]), (req, res) => {
      try {
        const { period_name } = req.body;
        if (!period_name) return res.status(400).json({ error: "Period name is required" });

        const existingPeriod = db.prepare("SELECT id FROM finance_payroll WHERE period_name = ?").get(period_name);
        if (existingPeriod) {
          return res.status(400).json({ error: "Payroll for this period already generated." });
        }

        // Get all active employees (users)
        const employees = db.prepare("SELECT username, name, role FROM users WHERE status = 'APPROVED'").all() as any[];
        
        let totalAmount = 0;
        const details: any[] = [];

        employees.forEach(emp => {
          // Simple mock calculation logic for payroll based on role
          let baseSalary = 5000000; 
          if (emp.role === 'ENGINEERING') baseSalary = 8000000;
          if (emp.role === 'FC') baseSalary = 10000000;

          // You'd typically calculate attendances here as well
          const attendances = db.prepare("SELECT COUNT(*) as count FROM hr_attendances WHERE employee_username = ? AND status = 'PRESENT'").get(emp.username) as any;
          const presentCount = attendances ? attendances.count : 0;
          
          // KPIs bonus
          const highestKpi = db.prepare("SELECT overall_score FROM hr_kpis WHERE employee_username = ? ORDER BY overall_score DESC LIMIT 1").get(emp.username) as any;
          const kpiScore = highestKpi ? highestKpi.overall_score : 0;
          const bonus = kpiScore > 80 ? (kpiScore / 100) * (baseSalary * 0.1) : 0;

          const totalPay = baseSalary + bonus;
          totalAmount += totalPay;

          details.push({
             username: emp.username,
             name: emp.name,
             base_salary: baseSalary,
             present_days: presentCount,
             kpi_bonus: bonus,
             total_pay: totalPay
          });
        });

        const payrollId = "PAY-" + Math.random().toString(36).substr(2, 9).toUpperCase();
        db.prepare(`
          INSERT INTO finance_payroll (id, period_name, total_amount, details_json, status)
          VALUES (?, ?, ?, ?, 'DRAFTED')
        `).run(payrollId, period_name, totalAmount, JSON.stringify(details));

        logAudit(req.headers["x-user-email"] as string || "System", "GENERATE_PAYROLL", "FINANCE", payrollId, `Generated payroll for ${period_name}`);
        
        res.json({ success: true, id: payrollId, total_amount: totalAmount, details });
      } catch (e: any) {
        console.error("Generate payroll failed:", e);
        res.status(500).json({ error: "Failed to generate payroll algorithms." });
      }
    });

    // Gap 5 Solved: Sweeper Engine / Redact
    app.post("/api/hr/sweep-data", requireRole(["FC", "HR"]), (req, res) => {
       try {
         // redact applications older than 6 months and rejected
         const sixMonthsAgo = new Date();
         sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
         const dateString = sixMonthsAgo.toISOString();
         
         const info = db.prepare(`
            UPDATE hr_applications 
            SET name = 'REDACTED', email = 'redacted@deleted.loc', phone = 'REDACTED', linkedin_url = '', experience = 'REDACTED', resume_text = 'REDACTED'
            WHERE status = 'REJECTED' AND applied_at < ? AND name != 'REDACTED'
         `).run(dateString);

         logAudit(req.headers["x-user-email"] as string || "System", "DATA_SWEEP", "APPLICATION", "BATCH", `Redacted ${info.changes} rejected applications older than 6 months.`);
         
         res.json({ success: true, redacted_count: info.changes });
       } catch (e: any) {
         res.status(500).json({ error: "Failed to sweep data" });
       }
    });

    app.get("/api/finance/payrolls", requireRole(["FC", "HR"]), (req, res) => {
      try {
        const payrolls = db.prepare("SELECT * FROM finance_payroll ORDER BY created_at DESC").all();
        res.json(payrolls);
      } catch (e: any) {
        res.status(500).json({ error: "Failed to fetch payrolls" });
      }
    });

    app.delete("/api/finance/payrolls/:id", requireRole(["FC", "HR"]), (req, res) => {
      try {
        const payroll = db.prepare("SELECT * FROM finance_payroll WHERE id = ?").get(req.params.id) as any;
        if (!payroll) return res.status(404).json({ error: "Payroll not found" });
        if (payroll.status === 'PAID') return res.status(400).json({ error: "Cannot delete paid payrolls" });

        db.prepare("DELETE FROM finance_payroll WHERE id = ?").run(req.params.id);
        logAudit(req.headers["x-user-email"] as string || "System", "DELETE_PAYROLL", "FINANCE", req.params.id, "Drafted payroll deleted");
        res.json({ success: true });
      } catch (e: any) {
        res.status(500).json({ error: "Failed to delete payroll" });
      }
    });

    app.delete("/api/finance/payrolls", requireRole(["FC", "HR"]), (req, res) => {
      try {
        db.prepare("DELETE FROM finance_payroll WHERE status = 'DRAFTED'").run();
        logAudit(req.headers["x-user-email"] as string || "System", "CLEAR_PAYROLLS", "FINANCE", "ALL_DRAFTS", "All drafted payrolls cleared");
        res.json({ success: true });
      } catch (e: any) {
        res.status(500).json({ error: "Failed to clear payrolls" });
      }
    });

    app.put("/api/finance/payrolls/:id/pay", requireRole(["FC"]), (req, res) => {
       try {
         const { pin } = req.body;
         if (!pin || !isValidDailyAuthKey(req.headers["x-user-email"] as string, pin)) {
            return res.status(400).json({ error: "Invalid authorization PIN" });
         }
         const payroll = db.prepare("SELECT * FROM finance_payroll WHERE id = ?").get(req.params.id) as any;
         if (!payroll) return res.status(404).json({ error: "Payroll not found" });

         db.prepare("UPDATE finance_payroll SET status = 'PAID', paid_at = CURRENT_TIMESTAMP WHERE id = ?").run(req.params.id);
         logAudit(req.headers["x-user-email"] as string || "System", "PAYROLL_PAID", "FINANCE", req.params.id, "Payroll marked as disbursed (PAID)");

         // PIPE: Generate HR payslips for each employee from details_json
         if (payroll.details_json) {
           try {
             const details = JSON.parse(payroll.details_json);
             const insertSlip = db.prepare(`
               INSERT INTO hr_payslips (id, employee_username, period_month, basic_salary, allowances, deductions, net_salary)
               VALUES (?, ?, ?, ?, ?, ?, ?)
             `);
             details.forEach((det: any) => {
               const slipId = "SLIP-" + Math.random().toString(36).substr(2, 9).toUpperCase();
               const allowance = typeof det.kpi_bonus === 'number' ? det.kpi_bonus : 0;
               const net = det.base_salary + allowance; // simple representation
               insertSlip.run(slipId, det.username, payroll.period_name, det.base_salary, allowance, 0, net);
             });
           } catch (parseErr) {
             console.error("Failed to parse/generate payslips:", parseErr);
           }
         }

         res.json({ success: true });
       } catch (e: any) {
         res.status(500).json({ error: "Failed to process payroll disbursement" });
       }
    });

    app.get("/api/hr/jobs", (req, res) => {
      try {
        const jobs = db.prepare("SELECT * FROM hr_jobs ORDER BY created_at DESC").all();
        res.json(jobs);
      } catch (e: any) {
        console.error("Fetch HR jobs failed:", e);
        res.status(500).json({ error: "Failed to fetch job vacancies" });
      }
    });

    // Gap 1 Solved: Candidate Portal (Application Tracking)
    app.post("/api/hr/track", (req, res) => {
      try {
        const { email, tracking_id } = req.body;
        if (!email || !tracking_id) return res.status(400).json({ error: "Email and Tracking ID are required" });
        
        const application = db.prepare(`
          SELECT a.id, a.status, a.applied_at, a.notes, j.title as job_title, j.department 
          FROM hr_applications a
          JOIN hr_jobs j ON a.job_id = j.id
          WHERE a.email = ? AND a.id = ?
        `).get(email, tracking_id);
        
        if (!application) return res.status(404).json({ error: "Application not found or data mismatch." });
        
        res.json(application);
      } catch (e: any) {
        res.status(500).json({ error: "Failed to track application" });
      }
    });

    // Resolving Gap: Katalog Produk Website Publik Terisolasi dari Database ERP
    app.get("/api/public/products", (req, res) => {
      try {
        const products = db.prepare(`SELECT id, item_code, name, dimension, uom, unit_price, category FROM items WHERE type = 'FINISHED' ORDER BY name ASC`).all();
        res.json(products);
      } catch (e: any) {
        res.status(500).json({ error: "Failed to fetch public products" });
      }
    });

    // Resolving Gap: Alur Penjualan Terpotong
    app.post("/api/public/leads", (req, res) => {
      try {
        const { id, name, contact_info, intent } = req.body;
        db.prepare(`
          INSERT INTO crm_leads (id, name, contact_info, intent)
          VALUES (?, ?, ?, ?)
        `).run(
          id || crypto.randomUUID(),
          name,
          contact_info,
          intent
        );
        res.json({ success: true, message: "Lead captured successfully" });
      } catch (e: any) {
        console.error("Failed to capture lead:", e);
        res.status(500).json({ error: "Failed to capture lead" });
      }
    });

    // Gap 4 Solved: Public Directory
    app.get("/api/public/team", (req, res) => {
      try {
        const team = db.prepare("SELECT name, role FROM users WHERE status = 'APPROVED' AND level IN ('DIRECTOR', 'MANAGER', 'STAFF') LIMIT 24").all();
        res.json(team);
      } catch (e: any) {
        res.status(500).json({ error: "Failed to fetch public team data" });
      }
    });

    // Gap 2 Solved: CMS Settings
    app.get("/api/cms/:page", (req, res) => {
      try {
        const existingCms = db.prepare("SELECT content_json FROM cms_settings WHERE page = ?").get(req.params.page) as any;
        if (existingCms) {
           res.json(JSON.parse(existingCms.content_json));
        } else {
           res.json({});
        }
      } catch (e: any) {
        res.status(500).json({ error: "Failed to fetch CMS data" });
      }
    });

    app.put("/api/cms/:page", requireRole(["FC", "HR"]), (req, res) => {
      try {
         db.prepare(`
           INSERT INTO cms_settings (page, content_json) VALUES (?, ?)
           ON CONFLICT(page) DO UPDATE SET content_json = excluded.content_json
         `).run(req.params.page, JSON.stringify(req.body));
         res.json({ success: true });
      } catch (e: any) {
        res.status(500).json({ error: "Failed to update CMS data" });
      }
    });

    app.get("/api/hr/jobs-public", (req, res) => {
      try {
        const jobs = db.prepare("SELECT * FROM hr_jobs WHERE status = 'OPEN' ORDER BY created_at DESC").all();
        res.json(jobs);
      } catch (e: any) {
        console.error("Fetch HR jobs public failed:", e);
        res.status(500).json({ error: "Failed to fetch job vacancies" });
      }
    });

    app.post("/api/hr/jobs", (req, res) => {
      try {
        const { title, department, location, type, description, requirements, benefits, salary_string, pamphlet_bg_color, pamphlet_accent_color } = req.body;
        if (!title || !department || !description) {
          return res.status(400).json({ error: "Title, Department and Description are required" });
        }
        const id = "JOB-" + Math.random().toString(36).substr(2, 9).toUpperCase();
        
        db.prepare(`
          INSERT INTO hr_jobs (id, title, department, location, type, description, requirements, benefits, salary_string, pamphlet_bg_color, pamphlet_accent_color)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id,
          title,
          department,
          location || "Head Office",
          type || "Full-time",
          description,
          requirements || "[]",
          benefits || "[]",
          salary_string || "",
          pamphlet_bg_color || "#1c1917",
          pamphlet_accent_color || "#ca8a04"
        );

        logAudit(req.headers["x-user-email"] as string || "HR Admin", "CREATE_JOB", "JOB", id, `Created job vacancy ${title} for ${department}`);
        res.json({ success: true, id });
      } catch (e: any) {
        console.error("Create HR job failed:", e);
        res.status(500).json({ error: "Failed to create job vacancy" });
      }
    });

    app.put("/api/hr/jobs/:id", (req, res) => {
      try {
        const { title, department, location, type, status, description, requirements, benefits, salary_string, pamphlet_bg_color, pamphlet_accent_color } = req.body;
        db.prepare(`
          UPDATE hr_jobs 
          SET title = ?, department = ?, location = ?, type = ?, status = ?, description = ?, requirements = ?, benefits = ?, salary_string = ?, pamphlet_bg_color = ?, pamphlet_accent_color = ?
          WHERE id = ?
        `).run(
          title,
          department,
          location,
          type,
          status,
          description,
          requirements,
          benefits,
          salary_string,
          pamphlet_bg_color,
          pamphlet_accent_color,
          req.params.id
        );

        logAudit(req.headers["x-user-email"] as string || "HR Admin", "UPDATE_JOB", "JOB", req.params.id, `Updated job vacancy ${title}`);
        res.json({ success: true });
      } catch (e: any) {
        console.error("Update HR job failed:", e);
        res.status(500).json({ error: "Failed to update job vacancy" });
      }
    });

    app.delete("/api/hr/jobs/:id", (req, res) => {
      try {
        db.prepare("DELETE FROM hr_jobs WHERE id = ?").run(req.params.id);
        logAudit(req.headers["x-user-email"] as string || "HR Admin", "DELETE_JOB", "JOB", req.params.id, `Deleted job vacancy`);
        res.json({ success: true });
      } catch (e: any) {
        console.error("Delete HR job failed:", e);
        res.status(500).json({ error: "Failed to delete job vacancy" });
      }
    });

    // 2. Candidate Applications
    app.get("/api/hr/applications", (req, res) => {
      try {
        const apps = db.prepare(`
          SELECT a.*, j.title as job_title, j.department as job_department
          FROM hr_applications a
          JOIN hr_jobs j ON a.job_id = j.id
          ORDER BY a.applied_at DESC
        `).all();
        res.json(apps);
      } catch (e: any) {
        console.error("Fetch applications failed:", e);
        res.status(500).json({ error: "Failed to fetch candidate applications" });
      }
    });

    app.post("/api/hr/applications", (req, res) => {
      try {
        const { job_id, name, email, phone, linkedin_url, experience, resume_text } = req.body;
        if (!job_id || !name || !email || !phone) {
          return res.status(400).json({ error: "Job ID, Name, Email, and Phone number are required" });
        }
        
        // Anti-Dumping & Duplication Check (Missing Link 1 Solved)
        const existingApp = db.prepare(`SELECT id FROM hr_applications WHERE email = ? AND job_id = ?`).get(email, job_id);
        if (existingApp) {
          return res.status(400).json({ error: "Candidate with this email has already applied for this position." });
        }

        const id = "APP-" + Math.random().toString(36).substr(2, 9).toUpperCase();
        db.prepare(`
          INSERT INTO hr_applications (id, job_id, name, email, phone, linkedin_url, experience, resume_text, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'APPLIED')
        `).run(id, job_id, name, email, phone, linkedin_url || "", experience || "", resume_text || "");

        logAudit("PUBLIC", "SUBMIT_APPLICATION", "APPLICATION", id, `Candidate ${name} applied for job ID ${job_id}`);
        
        // Resolving Gap: Ketidakhadiran Putaran Notifikasi Pasca-Kirim Rekrutmen
        console.log(`\n\n-----------------------------------------------------------`);
        console.log(`[MAIL SERVICE] MENSIMULASIKAN PENGIRIMAN EMAIL PENDAFTARAN`);
        console.log(`To: ${email}`);
        console.log(`Subject: Application Received - CV Batu Emas Group`);
        console.log(`Body: Halo ${name}, Terimakasih telah melamar. Anda bisa melacak status lamaran dengan ID: ${id}`);
        console.log(`Status: Sukses`);
        console.log(`-----------------------------------------------------------\n\n`);

        res.json({ success: true, id, message: "Application submitted and email tracking ID sent" });
      } catch (e: any) {
        console.error("Submit application failed:", e);
        res.status(500).json({ error: "Failed to submit application form" });
      }
    });

    app.put("/api/hr/applications/:id/status", async (req, res) => {
      try {
        const { status, notes } = req.body;
        db.prepare(`
          UPDATE hr_applications
          SET status = ?, notes = ?
          WHERE id = ?
        `).run(status, notes, req.params.id);

        // Gap 3 Solved: Real-time Email Notifications (Mock)
        if (["INTERVIEW", "REJECTED", "OFFER_MADE", "ACCEPTED"].includes(status)) {
           console.log(`[EMAIL GATEWAY MOCK] Sending email to candidate for Application ${req.params.id}. Status changed to ${status}.`);
           logAudit("SYSTEM", "EMAIL_SENT", "APPLICATION", req.params.id, `Notified candidate of status ${status}`);
        }

        // Gap 2 Solved: Automasi Onboarding HRIS ke ERP Master Data (users table)
        if (status === "ACCEPTED") {
          const appDetails = db.prepare(`
            SELECT a.name, a.email, j.department 
            FROM hr_applications a 
            JOIN hr_jobs j ON a.job_id = j.id 
            WHERE a.id = ?
          `).get(req.params.id) as any;

          if (appDetails) {
            const existingUser = db.prepare(`SELECT id FROM users WHERE username = ?`).get(appDetails.email);
            
            if (!existingUser) {
              const userId = "USR-" + Math.random().toString(36).substr(2, 9).toUpperCase();
              const autoGeneratedPassword = "Welcome" + Math.floor(1000 + Math.random() * 9000) + "!";
              const hashedPassword = await bcrypt.hash(autoGeneratedPassword, 12);
              
              // Mapping department to basic ERP role. (Can be enhanced)
              let role = "STAFF";
              if (appDetails.department?.toUpperCase().includes("ENG")) role = "ENGINEERING";
              else if (appDetails.department?.toUpperCase().includes("SALES")) role = "SALES";
              else if (appDetails.department?.toUpperCase().includes("FIN")) role = "FC";

              db.prepare(`
                INSERT INTO users (id, username, password, name, role, level, status, is_approved)
                VALUES (?, ?, ?, ?, ?, 'STAFF', 'APPROVED', 1)
              `).run(userId, appDetails.email, hashedPassword, appDetails.name, role);
              
              logAudit("SYSTEM", "ONBOARDING_AUTO_PROVISION", "USER", userId, `Auto-provisioned ERP access for ${appDetails.name} (${appDetails.email}) following HR application ACCEPTED. Auto-Pwd: ${autoGeneratedPassword}`);
            }
          }
        }

        logAudit(req.headers["x-user-email"] as string || "HR Admin", "UPDATE_APPLICATION_STATUS", "APPLICATION", req.params.id, `Updated candidate application status to ${status}`);
        res.json({ success: true });
      } catch (e: any) {
        console.error("Update application status failed:", e);
        res.status(500).json({ error: "Failed to update candidate application status" });
      }
    });

    // 3. Employee KPI Appraisal Performance Reviews
    app.get("/api/hr/kpis", (req, res) => {
      try {
        const { employee } = req.query;
        let kpis;
        if (employee) {
          kpis = db.prepare(`
            SELECT k.*, u.name as employee_name, ev.name as evaluator_name
            FROM hr_kpis k
            JOIN users u ON k.employee_username = u.username
            JOIN users ev ON k.evaluator_username = ev.username
            WHERE k.employee_username = ?
            ORDER BY k.created_at DESC
          `).all(employee);
        } else {
          kpis = db.prepare(`
            SELECT k.*, u.name as employee_name, ev.name as evaluator_name
            FROM hr_kpis k
            JOIN users u ON k.employee_username = u.username
            JOIN users ev ON k.evaluator_username = ev.username
            ORDER BY k.created_at DESC
          `).all();
        }
        res.json(kpis);
      } catch (e: any) {
        console.error("Fetch KPIs failed:", e);
        res.status(500).json({ error: "Failed to fetch appraisal ratings" });
      }
    });

    app.post("/api/hr/kpis", (req, res) => {
      try {
        const { employee_username, period_name, score_communication, score_productivity, score_reliability, score_leadership, score_technical, evaluation_notes } = req.body;
        
        const evaluator = (req.headers["x-user-email"] || req.headers["remote-user"] || "admin") as string;
        
        if (!employee_username || !period_name) {
          return res.status(400).json({ error: "Employee and Appraisal Period Name are required" });
        }

        const id = "KPI-" + Math.random().toString(36).substr(2, 9).toUpperCase();
        
        const c = Number(score_communication || 0);
        const p = Number(score_productivity || 0);
        const r = Number(score_reliability || 0);
        const l = Number(score_leadership || 0);
        const t = Number(score_technical || 0);
        const overall = Number(((c + p + r + l + t) / 5).toFixed(2));

        db.prepare(`
          INSERT INTO hr_kpis (id, employee_username, evaluator_username, period_name, score_communication, score_productivity, score_reliability, score_leadership, score_technical, overall_score, evaluation_notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, employee_username, evaluator, period_name, c, p, r, l, t, overall, evaluation_notes || "");

        logAudit(evaluator, "SUBMIT_KPI", "USER", employee_username, `Submitted KPI review for period ${period_name} with score ${overall}`);
        res.json({ success: true, id, overall_score: overall });
      } catch (e: any) {
        console.error("Create KPI appraisal failed:", e);
        res.status(500).json({ error: "Failed to submit employee evaluation" });
      }
    });

    // 4. Employee Handover Task Tracker
    app.get("/api/hr/handovers", (req, res) => {
      try {
        const handovers = db.prepare(`
          SELECT h.*, u1.name as resigning_name, u2.name as successor_name
          FROM hr_handovers h
          JOIN users u1 ON h.resigning_username = u1.username
          JOIN users u2 ON h.successor_username = u2.username
          ORDER BY h.created_at DESC
        `).all();
        res.json(handovers);
      } catch (e: any) {
        console.error("Fetch handovers failed:", e);
        res.status(500).json({ error: "Failed to retrieve employee handover documents" });
      }
    });

    app.post("/api/hr/handovers", (req, res) => {
      try {
        const { resigning_username, successor_username, target_last_date, handover_notes, checklist_json } = req.body;
        if (!resigning_username || !successor_username || !target_last_date) {
          return res.status(400).json({ error: "Resigning username, successor username, and target date are required" });
        }
        const id = "HO-" + Math.random().toString(36).substr(2, 9).toUpperCase();
        db.prepare(`
          INSERT INTO hr_handovers (id, resigning_username, successor_username, target_last_date, status, handover_notes, checklist_json)
          VALUES (?, ?, ?, ?, 'PENDING', ?, ?)
        `).run(id, resigning_username, successor_username, target_last_date, handover_notes || "", checklist_json || "[]");

        logAudit(req.headers["x-user-email"] as string || "HR Admin", "CREATE_HANDOVER", "USER", resigning_username, `Initiated exit transition handover to ${successor_username}`);
        res.json({ success: true, id });
      } catch (e: any) {
        console.error("Create handover failed:", e);
        res.status(500).json({ error: "Failed to instantiate handover tracker" });
      }
    });

    app.put("/api/hr/handovers/:id", (req, res) => {
      try {
        const { status, handover_notes, checklist_json } = req.body;
        db.prepare(`
          UPDATE hr_handovers
          SET status = ?, handover_notes = ?, checklist_json = ?
          WHERE id = ?
        `).run(status, handover_notes, checklist_json, req.params.id);

        logAudit(req.headers["x-user-email"] as string || "HR Staff", "UPDATE_HANDOVER", "USER", req.params.id, `Updated handover progress to status: ${status}`);
        res.json({ success: true });
      } catch (e: any) {
        console.error("Update handover document failed:", e);
        res.status(500).json({ error: "Failed to modify handover tracking logs" });
      }
    });

    // 5. Attendance & Time Tracking
    app.get("/api/hr/attendances", (req, res) => {
      try {
        const attendances = db.prepare(`
          SELECT a.*, u.name as employee_name
          FROM hr_attendances a
          JOIN users u ON a.employee_username = u.username
          ORDER BY a.date DESC
        `).all();
        res.json(attendances);
      } catch (e: any) {
        console.error("Fetch attendances failed:", e);
        res.status(500).json({ error: "Failed to fetch attendances" });
      }
    });

    app.use(hrAttendanceRouter);

    // 6. Leave Management (Cuti)
    app.get("/api/hr/leaves", (req, res) => {
      try {
        const leaves = db.prepare(`
          SELECT l.*, u.name as employee_name, approver.name as approver_name
          FROM hr_leaves l
          JOIN users u ON l.employee_username = u.username
          LEFT JOIN users approver ON l.approved_by = approver.username
          ORDER BY l.created_at DESC
        `).all();
        res.json(leaves);
      } catch (e: any) {
        res.status(500).json({ error: "Failed to fetch leaves" });
      }
    });

    app.post("/api/hr/leaves", (req, res) => {
      try {
        const { employee_username, leave_type, start_date, end_date, reason } = req.body;
        const id = "LV-" + Math.random().toString(36).substr(2, 9).toUpperCase();
        db.prepare(`
          INSERT INTO hr_leaves (id, employee_username, leave_type, start_date, end_date, reason)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(id, employee_username, leave_type, start_date, end_date, reason);

        res.json({ success: true, id });
      } catch (e: any) {
        res.status(500).json({ error: "Failed to submit leave request" });
      }
    });

    app.put("/api/hr/leaves/:id/status", (req, res) => {
      try {
        const { status } = req.body;
        const approved_by = (req.headers["x-user-email"] || req.headers["remote-user"] || "admin") as string;
        
        db.prepare(`
          UPDATE hr_leaves SET status = ?, approved_by = ? WHERE id = ?
        `).run(status, approved_by, req.params.id);

        res.json({ success: true });
      } catch (e: any) {
        res.status(500).json({ error: "Failed to update leave status" });
      }
    });

    // 7. Payslips (Gaji)
    app.get("/api/hr/payslips", (req, res) => {
      try {
        const payslips = db.prepare(`
          SELECT p.*, u.name as employee_name
          FROM hr_payslips p
          JOIN users u ON p.employee_username = u.username
          ORDER BY p.period_month DESC
        `).all();
        res.json(payslips);
      } catch (e: any) {
        res.status(500).json({ error: "Failed to fetch payslips" });
      }
    });

    app.post("/api/hr/payslips", (req, res) => {
      try {
        const { employee_username, period_month, basic_salary, allowances, deductions } = req.body;
        const net_salary = Number(basic_salary) + Number(allowances) - Number(deductions);
        
        const id = "PAY-" + Math.random().toString(36).substr(2, 9).toUpperCase();
        db.prepare(`
          INSERT INTO hr_payslips (id, employee_username, period_month, basic_salary, allowances, deductions, net_salary)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(id, employee_username, period_month, basic_salary, allowances, deductions, net_salary);

        res.json({ success: true, id });
      } catch (e: any) {
        res.status(500).json({ error: "Failed to generate payslip" });
      }
    });

    app.put("/api/users/heartbeat", (req, res) => {
      try {
        const { device_type, username: bodyUsername } = req.body;
        const username = (req.headers["x-user-email"] ||
          req.headers["remote-user"] ||
          req.headers["x-forwarded-user"] ||
          bodyUsername) as string;
        if (!username) return res.status(401).json({ error: "Unauthorized" });

        try {
          const result = db
            .prepare(
              `
          UPDATE users 
          SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), device_type = ?
          WHERE LOWER(username) = LOWER(?)
        `,
            )
            .run(device_type || "Desktop", username);

          if (result.changes === 0) {
            console.warn(
              `Heartbeat: User ${username} not found in database (attempted with case-insensitive match)`,
            );
          }
        } catch (e) {
          console.warn(
            "Heartbeat update failed (possibly missing columns), attempting partial update:",
            e,
          );
          try {
            db.prepare(
              `UPDATE users SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE LOWER(username) = LOWER(?)`,
            ).run(username);
          } catch (innerE) {
            console.error("Heartbeat update critically failed:", innerE);
          }
        }

        res.json({ success: true });
      } catch (e) {
        console.error("Heartbeat route error:", e);
        res.status(500).json({ error: "Failed to update heartbeat" });
      }
    });

    app.post("/api/users/logout", (req, res) => {
      try {
        const username = (req.headers["x-user-email"] ||
          req.headers["remote-user"] ||
          req.headers["x-forwarded-user"] ||
          req.body?.username) as string;
        if (!username) return res.status(401).json({ error: "Unauthorized" });

        try {
          db.prepare(
            `UPDATE users SET last_seen_at = NULL WHERE LOWER(username) = LOWER(?)`,
          ).run(username);
        } catch (e) {
          console.error("Failed to clear last_seen_at on logout", e);
        }
        res.clearCookie('auth_token', { httpOnly: true, sameSite: 'strict' });
        res.json({ success: true });
      } catch (e) {
        console.error("Logout route error:", e);
        res.status(500).json({ error: "Failed to process logout" });
      }
    });

    app.get("/api/users/status", (req, res) => {
      try {
        let users;
        try {
          // Try selecting all status-related columns
          users = db
            .prepare(
              `
          SELECT username, name, role, last_seen_at, device_type
          FROM users 
          WHERE status = 'APPROVED'
        `,
            )
            .all();
        } catch (e) {
          console.warn(
            "User status primary query failed, trying secondary fallback:",
            e,
          );
          try {
            // Try selecting without device_type
            users = db
              .prepare(
                `
            SELECT username, name, role, last_seen_at
            FROM users 
            WHERE status = 'APPROVED'
          `,
              )
              .all()
              .map((u: any) => ({ ...u, device_type: "Desktop" }));
          } catch (innerE) {
            console.warn(
              "User status secondary query failed, trying final fallback:",
              innerE,
            );
            // Minimum required columns
            users = db
              .prepare(
                `
            SELECT username, name, role
            FROM users 
            WHERE status = 'APPROVED'
          `,
              )
              .all()
              .map((u: any) => ({
                ...u,
                last_seen_at: null,
                device_type: "Desktop",
              }));
          }
        }

        res.json({
          users,
          server_time: new Date().toISOString(),
        });
      } catch (e) {
        console.error("Critical error fetching user statuses:", e);
        res
          .status(500)
          .json({ error: "Internal server error while fetching user status" });
      }
    });

    // --- CHAT SYSTEM API ---
    // --- Data Center Import ---
    app.post("/api/datacenter/import", express.json({ limit: '50mb' }), (req, res) => {
      try {
        const { type, data } = req.body;
        if (!type || !data || !Array.isArray(data)) {
          return res.status(400).json({ error: "Invalid payload" });
        }

        const username = req.headers["x-user-email"] as string;

        db.transaction(() => {
          if (type === 'ITEMS') {
            const stmt = db.prepare(`
              INSERT OR REPLACE INTO items (id, item_code, name, dimension, spec, type, uom, unit_price, lead_time_days)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            const invStmt = db.prepare(`
              INSERT OR IGNORE INTO inventory (item_id, free_stock, allocated_stock) VALUES (?, 0, 0)
            `);
            for (const row of data) {
              if (row.item_code && row.name) {
                 const id = "ITM-" + Math.random().toString(36).substr(2, 9).toUpperCase();
                 stmt.run(id, row.item_code, row.name, row.dimension || null, row.spec || null, row.type || 'RAW', row.uom || 'Unit', parseFloat(row.unit_price) || 0, parseInt(row.lead_time_days) || 0);
                 invStmt.run(id);
              }
            }
          } else if (type === 'SUPPLIERS') {
            const stmt = db.prepare(`
               INSERT OR REPLACE INTO suppliers (id, code, name, contact_person, email, phone, address)
               VALUES (?, ?, ?, ?, ?, ?, ?)
            `);
            for (const row of data) {
              if (row.name) {
                 const id = "SUP-" + Math.random().toString(36).substr(2, 9).toUpperCase();
                 stmt.run(id, row.code || null, row.name, row.contact_person || null, row.email || null, row.phone || null, row.address || null);
              }
            }
          } else if (type === 'CUSTOMERS') {
            const stmt = db.prepare(`
               INSERT OR REPLACE INTO customers (id, code, name, email, phone, address)
               VALUES (?, ?, ?, ?, ?, ?)
            `);
            for (const row of data) {
              if (row.name) {
                 const id = "CUST-" + Math.random().toString(36).substr(2, 9).toUpperCase();
                 stmt.run(id, row.code || null, row.name, row.email || null, row.phone || null, row.address || null);
              }
            }
          }
        })();

        logAudit(username, "IMPORT_DATA", "DATACENTER", type, `Imported ${data.length} records logic.`);
        res.json({ success: true, count: data.length });
      } catch (err: any) {
         console.error(err);
         res.status(500).json({ error: err.message });
      }
    });

    // --- Data Center Search ---
    app.get("/api/datacenter/master-trace", (req, res) => {
      try {
        const q = (req.query.q as string) || "";
        const searchTerm = q ? `%${q.trim().toLowerCase()}%` : null;

        // Find relevant project IDs if there's a search term
        let relevantProjectIds = new Set<string>();
        if (searchTerm) {
          // Match Projects
          db.prepare(
            "SELECT id FROM projects WHERE LOWER(name) LIKE ? OR LOWER(id) LIKE ?",
          )
            .all(searchTerm, searchTerm)
            .forEach((row: any) => relevantProjectIds.add(row.id));
          // Match PRs
          db.prepare(
            "SELECT project_id FROM purchase_requests WHERE LOWER(pr_number) LIKE ?",
          )
            .all(searchTerm)
            .forEach((row: any) => {
              if (row.project_id) relevantProjectIds.add(row.project_id);
            });
          // Match POs (through PRs)
          db.prepare(
            `
          SELECT pr.project_id 
          FROM purchase_orders po 
          JOIN pr_items pri ON po.id = pri.po_id 
          JOIN purchase_requests pr ON pri.pr_id = pr.id 
          WHERE LOWER(po.po_number) LIKE ?
        `,
          )
            .all(searchTerm)
            .forEach((row: any) => {
              if (row.project_id) relevantProjectIds.add(row.project_id);
            });
          // Match GRNs (through POs -> PRs)
          db.prepare(
            `
          SELECT pr.project_id 
          FROM grns g 
          JOIN purchase_orders po ON g.po_id = po.id
          JOIN pr_items pri ON po.id = pri.po_id 
          JOIN purchase_requests pr ON pri.pr_id = pr.id 
          WHERE LOWER(g.id) LIKE ?
        `,
          )
            .all(searchTerm)
            .forEach((row: any) => {
              if (row.project_id) relevantProjectIds.add(row.project_id);
            });
          // Match Quotations
          try {
            db.prepare(
              "SELECT id FROM projects WHERE quotation_id IN (SELECT id FROM quotations WHERE LOWER(quotation_number) LIKE ?)",
            )
              .all(searchTerm)
              .forEach((row: any) => relevantProjectIds.add(row.id));
          } catch (e) {}
          // Match SPKs
          try {
            db.prepare(
              "SELECT project_id FROM spks WHERE LOWER(spk_number) LIKE ?",
            )
              .all(searchTerm)
              .forEach((row: any) => {
                if (row.project_id) relevantProjectIds.add(row.project_id);
              });
          } catch (e) {}
          // Match Delivery Notes
          try {
            db.prepare(
              "SELECT project_id FROM delivery_notes WHERE LOWER(dn_number) LIKE ?",
            )
              .all(searchTerm)
              .forEach((row: any) => {
                if (row.project_id) relevantProjectIds.add(row.project_id);
              });
          } catch (e) {}
          // Match Commercial Invoices
          try {
            db.prepare(
              "SELECT project_id FROM commercial_invoices WHERE LOWER(ci_number) LIKE ?",
            )
              .all(searchTerm)
              .forEach((row: any) => {
                if (row.project_id) relevantProjectIds.add(row.project_id);
              });
          } catch (e) {}
        }

        // Fetch base projects
        let projectsQuery = `SELECT id, name, status, created_at, quotation_id, spk_id FROM projects ORDER BY created_at DESC`;
        let projectsArgs: any[] = [];
        if (searchTerm) {
          if (relevantProjectIds.size > 0) {
            const placeholders = Array.from(relevantProjectIds)
              .map(() => "?")
              .join(",");
            projectsQuery = `SELECT id, name, status, created_at, quotation_id, spk_id FROM projects WHERE id IN (${placeholders}) ORDER BY created_at DESC`;
            projectsArgs = Array.from(relevantProjectIds);
          } else {
            return res.json({ success: true, data: [] });
          }
        }

        const projects = db
          .prepare(projectsQuery)
          .all(...projectsArgs) as any[];

        // For each project, fetch its hierarchy
        const data = projects.map((proj) => {
          // 1. BOM Items count
          const bomsCount = (
            db
              .prepare(
                "SELECT COUNT(*) as count FROM boms WHERE project_id = ?",
              )
              .get(proj.id) as any
          ).count;

          // 2. PRs with items
          const prs = db
            .prepare(
              "SELECT id, pr_number, status, urgency, created_at FROM purchase_requests WHERE project_id = ? ORDER BY created_at DESC",
            )
            .all(proj.id) as any[];
          prs.forEach((pr) => {
            pr.items = db
              .prepare(
                `
            SELECT pri.id, pri.dimension, pri.spec, pri.qty, pri.unit_price, i.name as item_name, i.item_code 
            FROM pr_items pri 
            JOIN items i ON pri.item_id = i.id 
            WHERE pri.pr_id = ?
          `,
              )
              .all(pr.id) as any[];
          });

          // 3. POs
          const pos = db
            .prepare(
              `
          SELECT DISTINCT po.id, po.po_number, po.status, po.supplier_name, po.created_at
          FROM purchase_orders po
          JOIN pr_items pri ON po.id = pri.po_id
          JOIN purchase_requests pr ON pri.pr_id = pr.id
          WHERE pr.project_id = ?
        `,
            )
            .all(proj.id) as any[];
          pos.forEach((po) => {
            po.items = db
              .prepare(
                `
            SELECT pri.id, pri.dimension, pri.spec, pri.qty, pri.unit_price, i.name as item_name, i.item_code 
            FROM pr_items pri 
            JOIN items i ON pri.item_id = i.id 
            WHERE pri.po_id = ?
          `,
              )
              .all(po.id) as any[];

            const prsOfPo = db
              .prepare(
                `
            SELECT DISTINCT pr.pr_number 
            FROM purchase_requests pr
            JOIN pr_items pri ON pr.id = pri.pr_id
            WHERE pri.po_id = ?
          `,
              )
              .all(po.id) as any[];
            po.pr_numbers = prsOfPo.map((p) => p.pr_number).join(", ");
          });

          // 4. GRNs
          const grns =
            pos.length > 0
              ? (db
                  .prepare(
                    `
          SELECT id, id as grn_id, po_id, qc_status, received_date, rejected_grn_doc, is_reissue, remarks
          FROM grns
          WHERE po_id IN (${pos.map(() => "?").join(",")})
        `,
                  )
                  .all(...pos.map((po) => po.id)) as any[])
              : [];
          grns.forEach((grn) => {
            grn.items = db
              .prepare(
                `
            SELECT gi.id, gi.dimension, gi.spec, gi.qty_received as qty, i.name as item_name, i.item_code 
            FROM grn_items gi 
            JOIN items i ON gi.item_id = i.id 
            WHERE gi.grn_id = ?
          `,
              )
              .all(grn.id) as any[];
          });

          // 5. Quotation
          let quotation = null;
          if (proj.quotation_id) {
            try {
              quotation = db
                .prepare(
                  `
              SELECT q.*, c.name as customer_name
              FROM quotations q
              LEFT JOIN customers c ON q.customer_id = c.id
              WHERE q.id = ?
            `,
                )
                .get(proj.quotation_id);
            } catch (e) {}
          }

          // 6. SPK / NTP
          let spk = null;
          let ntp = null;
          if (proj.id !== "GENERAL") {
            try {
              spk = db
                .prepare("SELECT * FROM spks WHERE project_id = ?")
                .get(proj.id);
            } catch (e) {}
            try {
              ntp = db
                .prepare("SELECT * FROM ntps WHERE project_id = ?")
                .get(proj.id);
            } catch (e) {}
          }

          // 7. Finished Goods Item/Record
          let finished_goods = [];
          try {
            finished_goods = db
              .prepare(
                `
            SELECT i.id, i.item_code, i.name, i.spec, i.uom, inv.free_stock, inv.allocated_stock
            FROM items i
            LEFT JOIN inventory inv ON i.id = inv.item_id
            WHERE i.type = 'FINISHED' AND (i.item_code = ? OR i.item_code = ? OR i.spec LIKE ?)
          `,
              )
              .all(
                `FG-${proj.id}`,
                `FG-${proj.id?.substring(0, 6)}`,
                `%Project ${proj.name}%`,
              );
          } catch (e) {}

          // 8. Delivery Notes (DN)
          let delivery_notes = [];
          try {
            delivery_notes = db
              .prepare(
                `
            SELECT dn.*, c.name as customer_name
            FROM delivery_notes dn
            LEFT JOIN customers c ON dn.customer_id = c.id
            WHERE dn.project_id = ?
          `,
              )
              .all(proj.id) as any[];
            delivery_notes.forEach((dn: any) => {
              dn.items = db
                .prepare(
                  `
              SELECT di.id, di.qty, di.uom, di.remarks, COALESCE(i.item_code, 'FG-' || dn.project_id) as item_code, COALESCE(i.name, p.name, 'Commercial Trade Item') as item_name
              FROM delivery_items di
              JOIN delivery_notes dn ON di.dn_id = dn.id
              LEFT JOIN items i ON di.item_id = i.id
              LEFT JOIN projects p ON dn.project_id = p.id
              WHERE di.dn_id = ?
            `,
                )
                .all(dn.id) as any[];
            });
          } catch (e) {}

          // 9. Commercial Invoices
          let commercial_invoices = [];
          try {
            commercial_invoices = db
              .prepare(
                `
            SELECT ci.*, bk.bank_name, bk.account_number, bk.account_holder
            FROM commercial_invoices ci
            LEFT JOIN bank_accounts bk ON ci.bank_account_id = bk.id
            WHERE ci.project_id = ? OR ci.dn_id IN (SELECT id FROM delivery_notes WHERE project_id = ?)
          `,
              )
              .all(proj.id, proj.id) as any[];

            for (let inv of commercial_invoices) {
              inv.items = db
                .prepare(`
                  SELECT di.*, 
                         COALESCE(i.item_code, 'FG-' || dn.project_id) as item_code, 
                         COALESCE(i.name, p.name, 'Commercial Trade Item') as item_name
                  FROM delivery_items di
                  JOIN delivery_notes dn ON di.dn_id = dn.id
                  LEFT JOIN items i ON di.item_id = i.id
                  LEFT JOIN projects p ON dn.project_id = p.id
                  WHERE di.dn_id = ?
                `)
                .all(inv.dn_id);
            }
          } catch (e) {}

          return {
            ...proj,
            bom_count: bomsCount,
            prs,
            pos,
            grns,
            quotation,
            spk,
            ntp,
            finished_goods,
            delivery_notes,
            commercial_invoices,
          };
        });

        res.json({ success: true, data });
      } catch (e: any) {
        console.error(e);
        res.status(500).json({ error: e.message });
      }
    });

    app.get("/api/datacenter/search", (req, res) => {
      try {
        const q = (req.query.q as string) || "";
        if (!q || q.trim().length < 2) {
          return res.json({ success: true, data: [] });
        }

        const searchTerm = `%${q.trim().toLowerCase()}%`;
        const results: any[] = [];

        // Items
        const items = db
          .prepare(
            `SELECT id, item_code, name, category as type, spec FROM items WHERE LOWER(item_code) LIKE ? OR LOWER(name) LIKE ? OR LOWER(spec) LIKE ? LIMIT 10`,
          )
          .all(searchTerm, searchTerm, searchTerm) as any[];
        items.forEach((i) =>
          results.push({
            id: i.id,
            type: "ITEM",
            title: i.name,
            code: i.item_code,
            subtitle: i.spec,
            meta: i.type,
            link: "/warehouse",
          }),
        );

        // Projects
        const projects = db
          .prepare(
            `SELECT id, name, status, type FROM projects WHERE LOWER(name) LIKE ? OR LOWER(id) LIKE ? LIMIT 10`,
          )
          .all(searchTerm, searchTerm) as any[];
        projects.forEach((p) =>
          results.push({
            id: p.id,
            type: "PROJECT",
            title: p.name,
            code: p.id,
            subtitle: `Status: ${p.status}`,
            meta: p.type,
            link: `/project/${p.id}`,
          }),
        );

        // PRs
        const prs = db
          .prepare(
            `SELECT id, pr_number, project_id, status FROM purchase_requests WHERE LOWER(pr_number) LIKE ? LIMIT 10`,
          )
          .all(searchTerm) as any[];
        prs.forEach((p) =>
          results.push({
            id: p.id,
            type: "PR",
            title: p.pr_number,
            code: p.pr_number,
            subtitle: `Project ID: ${p.project_id || "-"}`,
            meta: p.status,
            link: `/requests?pr=${p.id}`,
          }),
        );

        // POs
        const pos = db
          .prepare(
            `SELECT po.id, po.po_number, po.status, s.name as supplier_name FROM purchase_orders po LEFT JOIN suppliers s ON po.supplier_id = s.id WHERE LOWER(po.po_number) LIKE ? OR LOWER(s.name) LIKE ? LIMIT 10`,
          )
          .all(searchTerm, searchTerm) as any[];
        pos.forEach((p) =>
          results.push({
            id: p.id,
            type: "PO",
            title: p.po_number,
            code: p.po_number,
            subtitle: `Supplier: ${p.supplier_name || "-"}`,
            meta: p.status,
            link: `/procurement?po=${p.id}`,
          }),
        );

        // GRNs
        const grns = db
          .prepare(
            `SELECT grn.id, grn.id as grn_id, grn.po_id, p.po_number FROM grns grn JOIN purchase_orders p ON grn.po_id = p.id WHERE LOWER(grn.id) LIKE ? OR LOWER(p.po_number) LIKE ? LIMIT 10`,
          )
          .all(searchTerm, searchTerm) as any[];
        grns.forEach((g) =>
          results.push({
            id: g.id,
            type: "GRN",
            title: g.grn_id,
            code: g.grn_id,
            subtitle: `PO: ${g.po_number}`,
            meta: "RECEIVED",
            link: `/warehouse?grn=${g.id}`,
          }),
        );

        res.json({ success: true, data: results });
      } catch (e: any) {
        console.error(e);
        res.status(500).json({ error: e.message });
      }
    });

    app.get("/api/chat/unread", (req, res) => {
      try {
        const username = (req.headers["x-user-email"] ||
          req.headers["remote-user"] ||
          req.headers["x-forwarded-user"]) as string;
        if (!username) return res.status(401).json({ error: "Unauthorized" });
        const row = db
          .prepare(
            `
        SELECT COUNT(*) as unread_count
        FROM chat_messages m
        JOIN chat_participants p ON m.thread_id = p.thread_id
        WHERE p.username = ? AND m.sender_username != ? AND m.read_by NOT LIKE '%' || ? || '%'
      `,
          )
          .get(username, username, username) as { unread_count: number };

        const latestMsg = db
          .prepare(
            `
        SELECT m.id, m.sender_username, m.content, t.name as thread_name, t.is_group
        FROM chat_messages m
        JOIN chat_participants p ON m.thread_id = p.thread_id
        JOIN chat_threads t ON m.thread_id = t.id
        WHERE p.username = ? AND m.sender_username != ? AND m.read_by NOT LIKE '%' || ? || '%'
        ORDER BY m.created_at DESC
        LIMIT 1
      `,
          )
          .get(username, username, username) as any;

        res.json({
          unread_count: row.unread_count || 0,
          latest_message: latestMsg || null,
        });
      } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Failed to get unread count" });
      }
    });

    app.get("/api/chat/threads", (req, res) => {
      try {
        const username = (req.headers["x-user-email"] ||
          req.headers["remote-user"] ||
          req.headers["x-forwarded-user"]) as string;
        if (!username) return res.status(401).json({ error: "Unauthorized" });

        const threads = db
          .prepare(
            `
        SELECT t.*, 
          (SELECT content FROM chat_messages m WHERE m.thread_id = t.id AND m.is_deleted = 0 ORDER BY m.created_at DESC LIMIT 1) as last_message,
          (SELECT created_at FROM chat_messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1) as last_message_time,
          (SELECT COUNT(*) FROM chat_messages m WHERE m.thread_id = t.id AND m.sender_username != ? AND m.read_by NOT LIKE '%' || ? || '%') as unread_count
        FROM chat_threads t
        JOIN chat_participants p ON t.id = p.thread_id
        WHERE p.username = ?
        ORDER BY last_message_time DESC NULLS LAST
      `,
          )
          .all(username, username, username);

        for (let thread of threads as any[]) {
          thread.participants = db
            .prepare(
              "SELECT username FROM chat_participants WHERE thread_id = ?",
            )
            .all(thread.id)
            .map((p: any) => p.username);
        }

        res.json(threads);
      } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Failed to fetch threads" });
      }
    });

    app.post("/api/chat/threads", (req, res) => {
      try {
        const { name, is_group, participants } = req.body;
        const username = (req.headers["x-user-email"] ||
          req.headers["remote-user"] ||
          req.headers["x-forwarded-user"]) as string;
        if (!username) return res.status(401).json({ error: "Unauthorized" });

        // Ensure creator is in participants
        if (!participants.includes(username)) {
          participants.push(username);
        }

        // Check if 1-on-1 thread exists
        if (!is_group && participants.length === 2) {
          const existing = db
            .prepare(
              `
           SELECT t.id FROM chat_threads t
           JOIN chat_participants p1 ON t.id = p1.thread_id AND p1.username = ?
           JOIN chat_participants p2 ON t.id = p2.thread_id AND p2.username = ?
           WHERE t.is_group = 0
         `,
            )
            .get(participants[0], participants[1]) as any;

          if (existing) {
            return res.json({ success: true, id: existing.id });
          }
        }

        const id = "THR-" + crypto.randomUUID();
        db.transaction(() => {
          db.prepare(
            "INSERT INTO chat_threads (id, name, is_group, created_by) VALUES (?, ?, ?, ?)",
          ).run(id, name || null, is_group ? 1 : 0, username);
          for (let p of participants) {
            db.prepare(
              "INSERT INTO chat_participants (thread_id, username) VALUES (?, ?)",
            ).run(id, p);
          }
        })();
        res.json({ success: true, id });
      } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Failed to create thread" });
      }
    });

    app.post("/api/chat/threads/:id/participants", (req, res) => {
      try {
        const username = (req.headers["x-user-email"] ||
          req.headers["remote-user"] ||
          req.headers["x-forwarded-user"]) as string;
        if (!username) return res.status(401).json({ error: "Unauthorized" });
        const { users } = req.body;

        const thread = db
          .prepare("SELECT * FROM chat_threads WHERE id = ?")
          .get(req.params.id) as any;
        if (!thread || !thread.is_group)
          return res
            .status(400)
            .json({ error: "Invalid thread or not a group" });

        db.transaction(() => {
          for (let u of users) {
            db.prepare(
              "INSERT OR IGNORE INTO chat_participants (thread_id, username) VALUES (?, ?)",
            ).run(req.params.id, u);
          }
        })();
        res.json({ success: true });
      } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Failed to add participants" });
      }
    });

    app.delete("/api/chat/threads/:id/participants/:username", (req, res) => {
      try {
        const currentUser = (req.headers["x-user-email"] ||
          req.headers["remote-user"] ||
          req.headers["x-forwarded-user"]) as string;
        if (!currentUser)
          return res.status(401).json({ error: "Unauthorized" });

        const threadId = req.params.id;
        const targetUser = req.params.username;

        const thread = db
          .prepare("SELECT * FROM chat_threads WHERE id = ?")
          .get(threadId) as any;
        if (!thread || !thread.is_group)
          return res
            .status(400)
            .json({ error: "Invalid thread or not a group" });

        // In a more complex system, we'd check if currentUser is group admin.
        // Here, any member might kick or a user can leave.
        db.prepare(
          "DELETE FROM chat_participants WHERE thread_id = ? AND username = ?",
        ).run(threadId, targetUser);
        res.json({ success: true });
      } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Failed to remove participant" });
      }
    });

    app.delete("/api/chat/threads/:id", (req, res) => {
      try {
        const username = (req.headers["x-user-email"] ||
          req.headers["remote-user"] ||
          req.headers["x-forwarded-user"]) as string;
        if (!username) return res.status(401).json({ error: "Unauthorized" });
        const threadId = req.params.id;

        db.prepare("DELETE FROM chat_messages WHERE thread_id = ?").run(
          threadId,
        );
        db.prepare("DELETE FROM chat_participants WHERE thread_id = ?").run(
          threadId,
        );
        db.prepare("DELETE FROM chat_threads WHERE id = ?").run(threadId);

        res.json({ success: true });
      } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Failed to delete thread" });
      }
    });

    app.get("/api/chat/threads/:id/messages", (req, res) => {
      try {
        const messages = db
          .prepare(
            "SELECT * FROM chat_messages WHERE thread_id = ? ORDER BY created_at ASC",
          )
          .all(req.params.id);
        res.json(messages);
      } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Failed to fetch messages" });
      }
    });

    app.post("/api/chat/threads/:id/read", (req, res) => {
      try {
        const username = (req.headers["x-user-email"] ||
          req.headers["remote-user"] ||
          req.headers["x-forwarded-user"]) as string;
        if (!username) return res.status(401).json({ error: "Unauthorized" });

        const messages = db
          .prepare(
            "SELECT id, read_by FROM chat_messages WHERE thread_id = ? AND sender_username != ? AND read_by NOT LIKE '%' || ? || '%'",
          )
          .all(req.params.id, username, username) as any[];

        const updateStmt = db.prepare(
          "UPDATE chat_messages SET read_by = ? WHERE id = ?",
        );
        db.transaction(() => {
          for (const msg of messages) {
            let currentArr = [];
            try {
              currentArr = JSON.parse(msg.read_by || "[]");
            } catch (e) {}
            if (!currentArr.includes(username)) {
              currentArr.push(username);
              updateStmt.run(JSON.stringify(currentArr), msg.id);
            }
          }
        })();
        res.json({ success: true });
      } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Failed to read messages" });
      }
    });

    app.post("/api/chat/threads/:id/messages", (req, res) => {
      try {
        const username = (req.headers["x-user-email"] ||
          req.headers["remote-user"] ||
          req.headers["x-forwarded-user"]) as string;
        if (!username) return res.status(401).json({ error: "Unauthorized" });
        const { content, file_url, file_name, file_size, file_type } = req.body;
        const id = "MSG-" + crypto.randomUUID();

        db.prepare(
          `
         INSERT INTO chat_messages (id, thread_id, sender_username, content, file_url, file_name, file_size, file_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       `,
        ).run(
          id,
          req.params.id,
          username,
          content || null,
          file_url || null,
          file_name || null,
          file_size || null,
          file_type || null,
        );
        res.json({ success: true, id });
      } catch (e) {
        res.status(500).json({ error: "Failed to send message" });
      }
    });

    app.delete("/api/chat/messages/:id", (req, res) => {
      try {
        const username = (req.headers["x-user-email"] ||
          req.headers["remote-user"] ||
          req.headers["x-forwarded-user"]) as string;
        if (!username) return res.status(401).json({ error: "Unauthorized" });

        // check sender
        const msg = db
          .prepare("SELECT sender_username FROM chat_messages WHERE id = ?")
          .get(req.params.id) as any;
        if (!msg || msg.sender_username !== username)
          return res.status(403).json({ error: "Forbidden" });

        db.prepare(
          "UPDATE chat_messages SET is_deleted = 1, content = 'This message was deleted', file_url = NULL, file_name = NULL, file_size = NULL, file_type = NULL WHERE id = ?",
        ).run(req.params.id);
        res.json({ success: true });
      } catch (e) {
        res.status(500).json({ error: "Failed to delete message" });
      }
    });

    // --- OUTBOUND / DELIVERY API ---
    const generateDNNumber = () => {
      const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
      let result = "";
      for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return `DN-${new Date().toISOString().slice(2, 4)}${new Date().toISOString().slice(5, 7)}-${result}`;
    };

    app.get("/api/sales/leads", requireRole(["SALES", "FC", "WAREHOUSE"]), (req, res) => {
      try {
        const leads = db.prepare("SELECT * FROM crm_leads ORDER BY created_at DESC").all();
        res.json(leads);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch leads" });
      }
    });

    app.post("/api/sales/leads/:id/convert", requireRole(["SALES", "FC", "WAREHOUSE"]), (req, res) => {
      try {
        const leadId = req.params.id;
        const lead = db.prepare("SELECT * FROM crm_leads WHERE id = ?").get(leadId) as any;
        if (!lead) return res.status(404).json({ error: "Lead not found" });
        if (lead.status === 'CONVERTED') return res.status(400).json({ error: "Lead already converted" });

        const transaction = db.transaction(() => {
          db.prepare("UPDATE crm_leads SET status = 'CONVERTED' WHERE id = ?").run(leadId);
          const customerId = "CUS-" + crypto.randomUUID().substring(0, 8);
          const code = lead.name.slice(0, 3).toUpperCase() + "-" + Math.floor(Math.random()*1000).toString().padStart(3, '0');
          db.prepare(`
            INSERT INTO customers (id, name, code, contact_person, phone)
            VALUES (?, ?, ?, ?, ?)
          `).run(
            customerId,
            lead.name,
            code,
            lead.name,
            lead.contact_info
          );
        });
        transaction();
        res.json({ success: true, message: "Lead converted to Customer" });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to convert lead" });
      }
    });

    app.delete("/api/sales/leads/:id", requireRole(["SALES", "FC", "WAREHOUSE"]), (req, res) => {
      try {
        db.prepare("DELETE FROM crm_leads WHERE id = ?").run(req.params.id);
        res.json({ success: true });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to delete lead" });
      }
    });

    app.get(
      "/api/sales/customers",
      requireRole(["WAREHOUSE", "FC", "SALES"]),
      (req, res) => {
        try {
          const customers = db
            .prepare(
              `
        SELECT c.*,
          (SELECT COUNT(*) FROM delivery_notes dn WHERE dn.customer_id = c.id) as total_deliveries,
          (SELECT COUNT(*) FROM delivery_notes dn WHERE dn.customer_id = c.id AND dn.status = 'DELIVERED') as delivered_count,
          (SELECT COUNT(*) FROM delivery_notes dn WHERE dn.customer_id = c.id AND dn.status != 'DELIVERED') as pending_count
        FROM customers c
        ORDER BY c.created_at DESC
      `,
            )
            .all();
          res.json(customers);
        } catch (err) {
          console.error(err);
          res.status(500).json({ error: "Failed to fetch customers" });
        }
      },
    );

    app.post(
      "/api/sales/customers",
      requireRole(["FC", "SALES"]),
      (req, res) => {
        const userRole = (req as any).userRole;
        const userLevel = (req as any).userLevel;
        if (
          userRole !== "FC" &&
          (userRole !== "SALES" || userLevel !== "MANAGER")
        ) {
          return res
            .status(403)
            .json({ error: "Access denied. Only FC or Sales Manager can manage customers." });
        }
        try {
          const { code, name, email, phone, address } = req.body;
          const id = "CUS-" + crypto.randomUUID();
          db.prepare(
            "INSERT INTO customers (id, code, name, email, phone, address) VALUES (?, ?, ?, ?, ?, ?)",
          ).run(
            id,
            code || `C-${Math.floor(Math.random() * 10000)}`,
            name,
            email || null,
            phone || null,
            address || null,
          );
          res.json({ success: true, id });
        } catch (err: any) {
          if (err.message?.includes("UNIQUE")) {
            return res
              .status(400)
              .json({ error: "Customer code must be unique" });
          }
          res.status(500).json({ error: "Failed to create customer" });
        }
      },
    );

    app.put(
      "/api/sales/customers/:id",
      requireRole(["FC", "SALES"]),
      (req, res) => {
        const userRole = (req as any).userRole;
        const userLevel = (req as any).userLevel;
        if (
          userRole !== "FC" &&
          (userRole !== "SALES" || userLevel !== "MANAGER")
        ) {
          return res
            .status(403)
            .json({ error: "Access denied. Only FC or Sales Manager can manage customers." });
        }
        try {
          const { id } = req.params;
          const { code, name, email, phone, address } = req.body;
          db.prepare(
            "UPDATE customers SET code = ?, name = ?, email = ?, phone = ?, address = ? WHERE id = ?",
          ).run(code, name, email || null, phone || null, address || null, id);
          res.json({ success: true });
        } catch (err: any) {
          if (err.message?.includes("UNIQUE")) {
            return res
              .status(400)
              .json({ error: "Customer code must be unique" });
          }
          res.status(500).json({ error: "Failed to update customer" });
        }
      },
    );

    app.delete(
      "/api/sales/customers/:id",
      requireRole(["FC", "SALES"]),
      (req, res) => {
        const userRole = (req as any).userRole;
        const userLevel = (req as any).userLevel;
        if (
          userRole !== "FC" &&
          (userRole !== "SALES" || userLevel !== "MANAGER")
        ) {
          return res
            .status(403)
            .json({ error: "Access denied. Only FC or Sales Manager can manage customers." });
        }
        try {
          const { id } = req.params;
          
          const dnCount = db
            .prepare(
              "SELECT COUNT(*) as count FROM delivery_notes WHERE customer_id = ?",
            )
            .get(id) as any;
          if (dnCount && dnCount.count > 0) {
            return res
              .status(400)
              .json({
                error: "Cannot delete customer. Active delivery records exist.",
              });
          }

          const quoCount = db
            .prepare(
              "SELECT COUNT(*) as count FROM quotations WHERE customer_id = ?",
            )
            .get(id) as any;
          if (quoCount && quoCount.count > 0) {
            return res
              .status(400)
              .json({
                error: "Cannot delete customer. Active quotation records exist.",
              });
          }

          const invCount = db
            .prepare(
              "SELECT COUNT(*) as count FROM commercial_invoices WHERE customer_id = ?",
            )
            .get(id) as any;
          if (invCount && invCount.count > 0) {
            return res
              .status(400)
              .json({
                error: "Cannot delete customer. Active commercial invoices exist.",
              });
          }

          db.prepare("DELETE FROM customers WHERE id = ?").run(id);
          res.json({ success: true });
        } catch (err) {
          console.error(err);
          res.status(500).json({ error: "Failed to delete customer" });
        }
      },
    );

    // Quotation Modul Endpoints
    
    app.post("/api/quotations/generate", requireRole(["FC", "Director", "Manager", "Sales Manager"]), async (req, res) => {
      try {
        const { prompt } = req.body;
        if (!prompt) return res.status(400).json({ error: "Prompt is required" });
        if (!process.env.GEMINI_API_KEY) {
           return res.status(500).json({ error: "GEMINI_API_KEY is not configured" });
        }
        
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        
        const systemInstruction = `
        You are an expert Sales and Quotation assistant.
        Convert the following natural language requirement into a structured JSON payload for a Quotation generation.
        
        Return ONLY valid JSON with this structure:
        {
          "client_name": "String (try to capture the client name, leave empty if unset)",
          "title": "String",
          "valid_until_days": number (default 20 if not mentioned),
          "items": [
            { "title": "String", "qty": number, "uom": "String (e.g. Unit, LS, Lot)", "price": number }
          ],
          "remarks": "String (any extra notes mentioned)",
          "discount_rate": number (percentage digit if mentioned e.g. 10, else 0),
          "tax_rate": number (percentage digit if mentioned, default to 12 if not mentioned in prompt)
        }
        
        Ensure output is strictly valid JSON with no markdown wrapping or comments.
        `;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                systemInstruction: systemInstruction,
                responseMimeType: "application/json"
            }
        });
        
        const result = JSON.parse(response.text || "{}");
        
        // If this is a direct creation request, save it directly as DRAFT
        if (req.body.directCreate) {
           let customerId = req.body.fallbackCustomerId || null;
           // Attempt to match customer by name if we have clients in memory, or just take the first customer in DB
           if (result.client_name) {
              const matchedCustomer = db.prepare("SELECT id FROM customers WHERE LOWER(name) LIKE ?").get(`%${result.client_name.toLowerCase()}%`) as any;
              if (matchedCustomer) customerId = matchedCustomer.id;
           }
           if (!customerId) {
              const anyCustomer = db.prepare("SELECT id FROM customers LIMIT 1").get() as any;
              if (anyCustomer) customerId = anyCustomer.id;
           }
           
           if (!customerId) return res.status(400).json({ error: "No customer found in system to attach quotation to." });
           
           const amount = (result.items || []).reduce((sum: number, it: any) => sum + (it.qty * it.price), 0);
           const id = "QUO-" + Math.random().toString(36).substr(2, 6).toUpperCase();
           const dParts = new Date().toISOString().split("T")[0].split("-");
           const quotation_number = `QUO/${dParts[0]}/${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
           
           db.transaction(() => {
              db.prepare(
                `INSERT INTO quotations (id, quotation_number, customer_id, title, amount, validity_days, remarks, status, tax_rate, discount_rate)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?)`
              ).run(
                id, quotation_number, customerId, result.title || 'AI Generated Draft', amount, result.valid_until_days || 20, result.remarks || '', result.tax_rate || 0, result.discount_rate || 0
              );
              
              const itemStmt = db.prepare(`INSERT INTO quotation_items (id, quotation_id, title, qty, uom, unit_price) VALUES (?, ?, ?, ?, ?, ?)`);
              for (const it of (result.items || [])) {
                 const itemId = "QI-" + Math.random().toString(36).substr(2, 6).toUpperCase();
                 itemStmt.run(itemId, id, it.title || 'Item', it.qty || 1, it.uom || 'Unit', it.price || 0);
              }
           })();
           
           return res.json({ success: true, message: "Draft quotation created", data: { id, quotation_number } });
        }
        
        res.json({ success: true, data: result });
      } catch (err) {
        console.error("AI Quotation Generation Error", err);
        res.status(500).json({ error: "Failed to generate quotation via AI. Check API Key or prompt mapping." });
      }
    });

    app.get("/api/quotations", (req, res) => {
      try {
        const quotations = db
          .prepare(
            `
        SELECT q.*, c.name as customer_name
        FROM quotations q
        LEFT JOIN customers c ON q.customer_id = c.id
        ORDER BY q.created_at DESC
      `,
          )
          .all() as any[];

        const now = new Date();
        const processedQuotations = quotations.map((q) => {
          // Any status other than PROCESSED or EXPIRED should be checked for auto-expiration
          if (q.status === "APPROVED" || q.status === "PENDING") {
            const createdDate = new Date(q.created_at);
            const diffTime = Math.abs(now.getTime() - createdDate.getTime());
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            if (diffDays > (q.validity_days || 20)) {
              q.status = "EXPIRED";
              db.prepare(
                "UPDATE quotations SET status = 'EXPIRED' WHERE id = ?",
              ).run(q.id);
            }
          }

          // Fetch items for each quotation
          q.items = db
            .prepare("SELECT * FROM quotation_items WHERE quotation_id = ?")
            .all(q.id);
          return q;
        });

        res.json({ success: true, data: processedQuotations });
      } catch (err: any) {
        console.error(err);
        res
          .status(500)
          .json({ error: "Failed to fetch quotations", details: err.message });
      }
    });

    app.post(
      "/api/quotations",
      requireRole(["FC", "SALES", "ENGINEERING"]),
      (req, res) => {
        console.log("QUOTATION_DEBUG:", JSON.stringify(req.body));
        const userRole = (req as any).userRole;
        const userLevel = (req as any).userLevel;
        if (
          userRole !== "FC" &&
          (userRole !== "SALES" || userLevel !== "MANAGER")
        ) {
          return res
            .status(403)
            .json({
              error:
                "Access denied. Only Sales Managers or FC accounts can create Quotations.",
            });
        }
        try {
          const { customer_id, title, amount, validity_days, remarks, items } =
            req.body;
          if (
            !customer_id ||
            !title ||
            !amount ||
            !items ||
            !Array.isArray(items) ||
            items.length === 0
          ) {
            console.log("QUOTATION_DEBUG_ERROR: Missing fields", req.body);
            return res
              .status(400)
              .json({
                error:
                  "Missing required fields: customer_id, title, amount, and items are required",
              });
          }

          const id =
            "QUO-" + Math.random().toString(36).substr(2, 6).toUpperCase();
          const dParts = new Date().toISOString().split("T")[0].split("-");
          const quotation_number = `QUO/${dParts[0]}/${Math.floor(
            Math.random() * 1000,
          )
            .toString()
            .padStart(3, "0")}/${id.substring(4, 6)}`;

          const transaction = db.transaction(() => {
            // Insert Quotation with requested status (defaults to PENDING)
            const newStatus = req.body.status && ['DRAFT', 'PENDING'].includes(req.body.status) ? req.body.status : 'PENDING';
            db.prepare(
              `
          INSERT INTO quotations (id, quotation_number, customer_id, title, amount, validity_days, remarks, status, tax_rate, discount_rate, npwp_tax_id, pph_rate)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
            ).run(
              id,
              quotation_number,
              customer_id,
              title,
              Number(amount),
              validity_days ? Number(validity_days) : 20,
              remarks || null,
              newStatus,
              Number(req.body.tax_rate) || 0,
              Number(req.body.discount_rate) || 0,
              req.body.npwp_tax_id || null,
              Number(req.body.pph_rate) || 0,
            );

            // Insert items
            const itemStmt = db.prepare(`
          INSERT INTO quotation_items (id, quotation_id, title, qty, uom, unit_price)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
            for (const item of items) {
              const itemId =
                "QI-" + Math.random().toString(36).substr(2, 6).toUpperCase();
              itemStmt.run(
                itemId,
                id,
                item.title,
                Number(item.qty || 1),
                item.uom || "Unit",
                Number(item.unit_price || 0),
              );
            }
          });
          transaction();

          // Fetch the full newly created quotation for the frontend preview
          const fullQuotation = db
            .prepare(
              `
        SELECT q.*, c.name as customer_name
        FROM quotations q
        LEFT JOIN customers c ON q.customer_id = c.id
        WHERE q.id = ?
      `,
            )
            .get(id) as any;

          if (fullQuotation) {
            fullQuotation.items = db
              .prepare("SELECT * FROM quotation_items WHERE quotation_id = ?")
              .all(id);
          }

          logAudit(
            (req.headers["x-user-email"] as string) || null,
            "CREATE_QUOTATION",
            "QUOTATION",
            id,
            `Created quotation ${quotation_number}`,
          );
          res.json({
            success: true,
            data: fullQuotation || { id, quotation_number },
          });
        } catch (err: any) {
          console.error(err);
          res
            .status(500)
            .json({
              error: "Failed to create quotation",
              details: err.message,
            });
        }
      },
    );

    app.post(
      "/api/quotations/:id/authorize",
      requireRole(["FC"]),
      (req, res) => {
        try {
          const params = req.params as any;
          const { id } = params;
          const { pin } = req.body;
          
          if (!pin || !isValidDailyAuthKey(req.headers["x-user-email"] as string, pin)) {
             return res.status(400).json({ error: "Invalid authorization PIN" });
          }

          const quotation = db.prepare("SELECT * FROM quotations WHERE id = ?").get(id) as any;
          
          if (!quotation) {
            return res.status(404).json({ error: "Quotation not found" });
          }
          
          if (quotation.status !== "PENDING") {
            return res.status(400).json({ error: "Quotation is not in PENDING status" });
          }

          db.prepare("UPDATE quotations SET status = 'APPROVED' WHERE id = ?").run(id);

          logAudit(
            (req.headers["x-user-email"] as string) || null,
            "AUTHORIZE_QUOTATION",
            "QUOTATION",
            id,
            `Authorized quotation ${quotation.quotation_number}`,
          );

          res.json({ success: true, message: "Quotation authorized successfully" });
        } catch (err: any) {
          console.error(err);
          res.status(500).json({ error: "Failed to authorize quotation", details: err.message });
        }
      }
    );

    app.put(
      "/api/quotations/:id",
      requireRole(["FC", "SALES", "ENGINEERING"]),
      (req, res) => {
        try {
          const params = req.params as any;
          const { id } = params;
          const { title, amount, validity_days, remarks, items, tax_rate, discount_rate, npwp_tax_id, pph_rate } = req.body;
          
          if (!title || !amount || !items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: "Missing required fields" });
          }

          const quotation = db.prepare("SELECT * FROM quotations WHERE id = ?").get(id) as any;
          
          if (!quotation) {
            return res.status(404).json({ error: "Quotation not found" });
          }

          db.transaction(() => {
            // Restore status to PENDING (or custom status) and clear revision_note
            const newStatus = req.body.status && ['DRAFT', 'PENDING'].includes(req.body.status) ? req.body.status : 'PENDING';
            db.prepare(`
              UPDATE quotations 
              SET title = ?, amount = ?, validity_days = ?, remarks = ?, status = ?, revision_note = NULL,
                  tax_rate = ?, discount_rate = ?, npwp_tax_id = ?, pph_rate = ?
              WHERE id = ?
            `).run(
              title, 
              Number(amount), 
              validity_days ? Number(validity_days) : 20, 
              remarks || null, 
              newStatus,
              Number(tax_rate) || 0,
              Number(discount_rate) || 0,
              npwp_tax_id || null,
              Number(pph_rate) || 0,
              id
            );

            // Delete old items
            db.prepare("DELETE FROM quotation_items WHERE quotation_id = ?").run(id);

            // Insert new items
            const itemStmt = db.prepare(`
              INSERT INTO quotation_items (id, quotation_id, title, qty, uom, unit_price)
              VALUES (?, ?, ?, ?, ?, ?)
            `);
            for (const item of items) {
              const itemId = "QI-" + Math.random().toString(36).substr(2, 6).toUpperCase();
              itemStmt.run(
                itemId,
                id,
                item.title,
                Number(item.qty || 1),
                item.uom || "Unit",
                Number(item.unit_price || 0)
              );
            }
          })();

          logAudit(
            (req.headers["x-user-email"] as string) || null,
            "UPDATE_QUOTATION",
            "QUOTATION",
            id,
            `Revised quotation ${quotation.quotation_number}`
          );

          res.json({ success: true, message: "Quotation updated successfully" });
        } catch (err: any) {
          console.error(err);
          res.status(500).json({ error: "Failed to update quotation", details: err.message });
        }
      }
    );

    app.delete(
      "/api/quotations/:id",
      requireRole(["FC", "SALES", "ENGINEERING"]),
      (req, res) => {
        try {
          const params = req.params as any;
          const { id } = params;

          const quotation = db.prepare("SELECT * FROM quotations WHERE id = ?").get(id) as any;
          if (!quotation) {
            return res.status(404).json({ error: "Quotation not found" });
          }

          db.transaction(() => {
            db.prepare("UPDATE spks SET quotation_id = NULL WHERE quotation_id = ?").run(id);
            db.prepare("UPDATE ntps SET quotation_id = NULL WHERE quotation_id = ?").run(id);
            db.prepare("UPDATE projects SET quotation_id = NULL WHERE quotation_id = ?").run(id);
            db.prepare("DELETE FROM quotation_items WHERE quotation_id = ?").run(id);
            db.prepare("DELETE FROM quotations WHERE id = ?").run(id);
          })();

          logAudit(
            (req.headers["x-user-email"] as string) || null,
            "DELETE_QUOTATION",
            "QUOTATION",
            id,
            `Deleted quotation ${quotation.quotation_number}`
          );

          res.json({ success: true, message: "Quotation deleted successfully" });
        } catch (err: any) {
          console.error(err);
          res.status(500).json({ error: "Failed to delete quotation", details: err.message });
        }
      }
    );

    app.post(
      "/api/quotations/:id/revise",
      requireRole(["FC"]),
      (req, res) => {
        try {
          const params = req.params as any;
          const { id } = params;
          const { pin, revision_note } = req.body;
          
          if (!pin || !isValidDailyAuthKey(req.headers["x-user-email"] as string, pin)) {
             return res.status(400).json({ error: "Invalid authorization PIN" });
          }
          if (!revision_note) {
             return res.status(400).json({ error: "Revision note is required" });
          }

          const quotation = db.prepare("SELECT * FROM quotations WHERE id = ?").get(id) as any;
          
          if (!quotation) {
            return res.status(404).json({ error: "Quotation not found" });
          }
          
          db.prepare("UPDATE quotations SET status = 'REVISION', revision_note = ? WHERE id = ?").run(revision_note, id);

          logAudit(
            (req.headers["x-user-email"] as string) || null,
            "REVISE_QUOTATION",
            "QUOTATION",
            id,
            `Revise quotation ${quotation.quotation_number} with note: ${revision_note}`,
          );

          res.json({ success: true, message: "Quotation marked for revision" });
        } catch (err: any) {
          console.error(err);
          res.status(500).json({ error: "Failed to revise quotation", details: err.message });
        }
      }
    );

    app.get("/api/spks", (req, res) => {
      try {
        const spks = db
          .prepare(
            `
        SELECT s.*, p.name as project_name, q.quotation_number
        FROM spks s
        LEFT JOIN projects p ON s.project_id = p.id
        LEFT JOIN quotations q ON s.quotation_id = q.id
        ORDER BY s.created_at DESC
      `,
          )
          .all();
        res.json({ success: true, data: spks });
      } catch (err: any) {
        console.error(err);
        res
          .status(500)
          .json({ error: "Failed to fetch SPKs", details: err.message });
      }
    });

    app.get(
      "/api/sales/deliveries",
      requireRole(["WAREHOUSE", "FC", "SALES"]),
      (req, res) => {
        try {
          const { status } = req.query;
          let query = `
        SELECT dn.*, c.name as customer_name, p.name as project_name
        FROM delivery_notes dn
        LEFT JOIN customers c ON dn.customer_id = c.id
        LEFT JOIN projects p ON dn.project_id = p.id
      `;
          let data;
          if (status) {
            query += ` WHERE dn.status = ? ORDER BY dn.created_at DESC`;
            data = db.prepare(query).all(status);
          } else {
            query += ` ORDER BY dn.created_at DESC`;
            data = db.prepare(query).all();
          }
          res.json(data);
        } catch (err) {
          console.error(err);
          res.status(500).json({ error: "Failed to fetch delivery notes" });
        }
      },
    );

    app.post(
      "/api/sales/deliveries",
      requireRole(["FC", "SALES"]),
      (req, res) => {
        try {
          const { customer_id, project_id, remarks, items, police_number } =
            req.body;
          if (
            !customer_id ||
            !items ||
            !Array.isArray(items) ||
            items.length === 0
          ) {
            return res.status(400).json({ error: "Missing customer or items" });
          }

          const dnId = "DN-" + crypto.randomUUID();
          const dnNumber = generateDNNumber();

          db.transaction(() => {
            db.prepare(
              "INSERT INTO delivery_notes (id, dn_number, customer_id, project_id, remarks, police_number) VALUES (?, ?, ?, ?, ?, ?)",
            ).run(
              dnId,
              dnNumber,
              customer_id,
              project_id || null,
              remarks || null,
              police_number || null,
            );

            const insertItem = db.prepare(
              "INSERT INTO delivery_items (id, dn_id, item_id, qty, uom, remarks) VALUES (?, ?, ?, ?, ?, ?)",
            );
            for (const item of items) {
              const existingItem = db.prepare("SELECT id FROM items WHERE id = ?").get(item.item_id);
              if (!existingItem) {
                 db.prepare("INSERT INTO items (id, item_code, name, uom, category) VALUES (?, ?, ?, ?, 'FG')").run(
                   item.item_id, item.item_code || `FG-${item.item_id}`, item.item_name || 'Commercial Item', item.uom || 'Unit'
                 );
              }

              insertItem.run(
                "DNI-" + crypto.randomUUID(),
                dnId,
                item.item_id,
                item.qty,
                item.uom,
                item.remarks || null,
              );
            }
          })();

          res.json({ success: true, id: dnId });
        } catch (err) {
          console.error(err);
          res.status(500).json({ error: "Failed to create Delivery Note" });
        }
      },
    );

    app.get(
      "/api/sales/deliveries/:id",
      requireRole(["WAREHOUSE", "FC", "SALES"]),
      (req, res) => {
        try {
          const dn = db
            .prepare(
              `
        SELECT dn.*, c.name as customer_name, c.address as customer_address, c.code as customer_code, c.phone as customer_phone, p.name as project_name
        FROM delivery_notes dn
        LEFT JOIN customers c ON dn.customer_id = c.id
        LEFT JOIN projects p ON dn.project_id = p.id
        WHERE dn.id = ?
      `,
            )
            .get(req.params.id) as any;

          if (!dn) return res.status(404).json({ error: "Delivery not found" });

          dn.items = db
            .prepare(
              `
        SELECT di.*, 
               COALESCE(i.item_code, 'FG-' || dn.project_id) as item_code, 
               COALESCE(i.name, p.name, 'Commercial Trade Item') as item_name
        FROM delivery_items di
        JOIN delivery_notes dn ON di.dn_id = dn.id
        LEFT JOIN items i ON di.item_id = i.id
        LEFT JOIN projects p ON dn.project_id = p.id
        WHERE di.dn_id = ?
      `,
            )
            .all(req.params.id);

          dn.signatures = db
            .prepare(
              `
        SELECT * FROM dn_signatures WHERE dn_id = ?
      `,
            )
            .all(req.params.id);

          res.json(dn);
        } catch (err) {
          console.error(err);
          res.status(500).json({ error: "Failed to fetch Dn details" });
        }
      },
    );

    app.put(
      "/api/sales/deliveries/:id",
      requireRole(["SALES", "FC"]),
      (req, res) => {
        try {
          const { customer_id, project_id, remarks, police_number, items } = req.body;
          const dnId = req.params.id;

          const dn = db.prepare("SELECT * FROM delivery_notes WHERE id = ?").get(dnId) as any;
          if (!dn) return res.status(404).json({ error: "Delivery not found" });

          db.transaction(() => {
            db.prepare(`
              UPDATE delivery_notes 
              SET customer_id = ?, project_id = ?, remarks = ?, police_number = ?, status = 'DRAFT', revision_note = NULL
              WHERE id = ?
            `).run(customer_id, project_id || null, remarks || null, police_number || null, dnId);

            db.prepare("DELETE FROM delivery_items WHERE dn_id = ?").run(dnId);

            const insertItem = db.prepare(
              "INSERT INTO delivery_items (id, dn_id, item_id, qty, uom, remarks) VALUES (?, ?, ?, ?, ?, ?)"
            );

            for (const item of items) {
              const existingItem = db.prepare("SELECT id FROM items WHERE id = ?").get(item.item_id);
              if (!existingItem) {
                 db.prepare("INSERT INTO items (id, item_code, name, uom, category) VALUES (?, ?, ?, ?, 'FG')").run(
                   item.item_id, item.item_code || `FG-${item.item_id}`, item.item_name || 'Commercial Item', item.uom || 'Unit'
                 );
              }

              insertItem.run(
                "DNI-" + Math.random().toString(36).substr(2, 9),
                dnId,
                item.item_id,
                item.qty,
                item.uom || 'Unit',
                item.remarks || null
              );
            }
          })();

          logAudit(
            (req.headers["x-user-email"] as string) || null,
            "UPDATE_DELIVERY",
            "DELIVERY_NOTE",
            dnId,
            `Revised delivery note ${dn.dn_number}`
          );

          res.json({ success: true, id: dnId });
        } catch (error: any) {
          console.error(error);
          res.status(500).json({ error: "Failed to update delivery note", details: error.message });
        }
      }
    );

    app.post(
      "/api/sales/deliveries/revise-dn",
      requireRole(["WAREHOUSE", "FC"]),
      (req, res) => {
        const userRole = (req as any).userRole;
        const userLevel = (req as any).userLevel;
        if (
          userRole !== "FC" &&
          (userRole !== "WAREHOUSE" || userLevel !== "MANAGER")
        ) {
          return res
            .status(403)
            .json({
              error:
                "Access denied. Only Warehouse Managers or FC accounts can revise deliveries.",
            });
        }
        try {
          const { dn_id, revision_note } = req.body;
          if (!revision_note) {
            return res.status(400).json({ error: "Revision note is required" });
          }

          const dn = db
            .prepare("SELECT * FROM delivery_notes WHERE id = ?")
            .get(dn_id) as any;
          if (!dn) {
            return res.status(404).json({ error: "Delivery not found" });
          }

          db.prepare("UPDATE delivery_notes SET status = 'REVISION', revision_note = ? WHERE id = ?").run(revision_note, dn_id);

          logAudit(
            (req.headers["x-user-email"] as string) || null,
            "REVISE_DELIVERY",
            "DELIVERY_NOTE",
            dn_id,
            `Revise delivery note ${dn.dn_number} with note: ${revision_note}`,
          );

          res.json({ success: true, message: "Delivery marked for revision" });
        } catch (err: any) {
          console.error(err);
          res.status(500).json({ error: "Failed to revise delivery", details: err.message });
        }
      }
    );

    app.post(
      "/api/sales/deliveries/:id/upload-dispatch",
      requireRole(["WAREHOUSE", "FC"]),
      (req, res) => {
        const userRole = (req as any).userRole;
        const userLevel = (req as any).userLevel;
        if (
          userRole !== "FC" &&
          (userRole !== "WAREHOUSE" || userLevel !== "MANAGER")
        ) {
          return res
            .status(403)
            .json({
              error:
                "Access denied. Only Warehouse Managers or FC accounts can authorize delivery dispatch approvals.",
            });
        }
        try {
          const { file_url } = req.body;
          const username = (req.headers["x-user-email"] ||
            req.headers["remote-user"] ||
            req.headers["x-forwarded-user"]) as string;
          const dn = db
            .prepare("SELECT * FROM delivery_notes WHERE id = ?")
            .get(req.params.id) as any;
          if (!dn) return res.status(404).json({ error: "Delivery not found" });
          if (dn.status !== "DRAFT")
            return res
              .status(400)
              .json({ error: "Can only dispatch DRAFT notes" });

          const items = db
            .prepare("SELECT * FROM delivery_items WHERE dn_id = ?")
            .all(req.params.id) as any[];

          db.transaction(() => {
            // Deduct Stock
            const deductStock = db.prepare(
              "UPDATE inventory SET free_stock = free_stock - ? WHERE item_id = ? AND free_stock >= ?",
            );
            const moveHist = db.prepare(
              "INSERT INTO stock_movements (id, item_id, type, qty, reference_id, recorded_by, project_id) VALUES (?, ?, 'RELEASE', ?, ?, ?, ?)",
            );

            for (const item of items) {
              const resInfo = deductStock.run(item.qty, item.item_id, item.qty);
              if (resInfo.changes === 0) {
                throw new Error(`Insufficient stock for item ${item.item_id}`);
              }
              moveHist.run(
                "SMV-" + crypto.randomUUID(),
                item.item_id,
                item.qty,
                dn.id,
                username,
                dn.project_id || null,
              );
            }

            db.prepare(
              `
            INSERT INTO dn_signatures (id, dn_id, role, signer_name, file_url) 
            VALUES (?, ?, ?, ?, ?)
         `,
            ).run(
              "DNS-" + crypto.randomUUID(),
              dn.id,
              "DISPATCH_PHASE",
              username,
              file_url,
            );

            db.prepare(
              "UPDATE delivery_notes SET status = 'PENDING_DELIVERY', shipped_at = CURRENT_TIMESTAMP WHERE id = ?",
            ).run(req.params.id);
          })();

          res.json({ success: true });
        } catch (err: any) {
          console.error(err);
          res
            .status(500)
            .json({ error: err.message || "Failed to dispatch delivery" });
        }
      },
    );

    app.post(
      "/api/sales/deliveries/:id/start-delivery",
      requireRole(["FC", "SALES", "WAREHOUSE"]),
      (req, res) => {
        try {
          const username = (req.headers["x-user-email"] ||
            req.headers["remote-user"] ||
            req.headers["x-forwarded-user"]) as string;
          const dn = db
            .prepare("SELECT * FROM delivery_notes WHERE id = ?")
            .get(req.params.id) as any;
          if (!dn) return res.status(404).json({ error: "Delivery not found" });

          if (dn.status !== "PENDING_DELIVERY") {
            return res
              .status(400)
              .json({
                error:
                  "Cannot start delivery. Warehouse must authorize dispatch first.",
              });
          }

          db.transaction(() => {
            db.prepare(
              "UPDATE delivery_notes SET status = 'IN_DELIVERY', shipped_at = COALESCE(shipped_at, CURRENT_TIMESTAMP) WHERE id = ?",
            ).run(req.params.id);
          })();
          res.json({ success: true });
        } catch (err: any) {
          console.error(err);
          res
            .status(500)
            .json({ error: err.message || "Failed to start delivery" });
        }
      },
    );

    app.post(
      "/api/sales/deliveries/:id/finish-delivery",
      requireRole(["FC", "SALES", "WAREHOUSE"]),
      (req, res) => {
        try {
          const { file_url } = req.body;
          const username = (req.headers["x-user-email"] ||
            req.headers["remote-user"] ||
            req.headers["x-forwarded-user"]) as string;
          const dn = db
            .prepare("SELECT * FROM delivery_notes WHERE id = ?")
            .get(req.params.id) as any;
          if (!dn) return res.status(404).json({ error: "Delivery not found" });
          if (dn.status !== "IN_DELIVERY")
            return res.status(400).json({ error: "DN must be IN_DELIVERY" });

          db.transaction(() => {
            db.prepare(
              `
            INSERT INTO dn_signatures (id, dn_id, role, signer_name, file_url) 
            VALUES (?, ?, ?, ?, ?)
         `,
            ).run(
              "DNS-" + crypto.randomUUID(),
              dn.id,
              "PARTY_2",
              username,
              file_url,
            );

            db.prepare(
              "UPDATE delivery_notes SET status = 'DELIVERED', delivered_at = CURRENT_TIMESTAMP WHERE id = ?",
            ).run(req.params.id);
          })();
          res.json({ success: true });
        } catch (err) {
          res.status(500).json({ error: "Failed to finish delivery" });
        }
      },
    );

    // --- BANK ACCOUNTS ----
    app.get("/api/bank-accounts", (req, res) => {
      try {
        const accounts = db
          .prepare("SELECT * FROM bank_accounts ORDER BY created_at DESC")
          .all();
        res.json(accounts);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch bank accounts" });
      }
    });

    app.post(
      "/api/bank-accounts",
      requireRole(["FC", "SALES", "PURCHASING", "WAREHOUSE", "ENGINEERING"]),
      (req, res) => {
        try {
          const { bank_name, account_number, account_holder, branch } =
            req.body;
          if (!bank_name || !account_number || !account_holder) {
            return res.status(400).json({ error: "Missing required fields" });
          }
          const id =
            "BNK-" + Math.random().toString(36).substr(2, 6).toUpperCase();
          db.prepare(
            "INSERT INTO bank_accounts (id, bank_name, account_number, account_holder, branch) VALUES (?, ?, ?, ?, ?)",
          ).run(id, bank_name, account_number, account_holder, branch || null);

          logAudit(
            (req.headers["x-user-username"] as string) || null,
            "REGISTER_BANK_ACCOUNT",
            "BANK_ACCOUNT",
            id,
            `Registered bank ${bank_name} - ${account_number}`,
          );
          res.json({ success: true, id });
        } catch (err) {
          console.error(err);
          res.status(500).json({ error: "Failed to register bank account" });
        }
      },
    );

    app.delete(
      "/api/bank-accounts/:id",
      requireRole(["FC", "SALES", "PURCHASING", "WAREHOUSE", "ENGINEERING"]),
      (req, res) => {
        try {
          db.prepare("DELETE FROM bank_accounts WHERE id = ?").run(
            req.params.id,
          );
          res.json({ success: true });
        } catch (err) {
          console.error(err);
          res.status(500).json({ error: "Failed to delete bank account" });
        }
      },
    );

    // --- COMMERCIAL INVOICES ----
    app.get("/api/sales/invoices", requireRole(["FC", "SALES"]), (req, res) => {
      try {
        const invoices = db
          .prepare(
            `
         SELECT ci.*, dn.dn_number, COALESCE(c.name, ci.customer_id) as customer_name, p.name as project_name,
                bk.bank_name, bk.account_number, bk.account_holder, bk.branch,
                c.address as customer_address, c.email as customer_email, c.phone as customer_phone
         FROM commercial_invoices ci
         JOIN delivery_notes dn ON ci.dn_id = dn.id
         LEFT JOIN customers c ON ci.customer_id = c.id
         LEFT JOIN projects p ON ci.project_id = p.id
         LEFT JOIN bank_accounts bk ON ci.bank_account_id = bk.id
         ORDER BY ci.created_at DESC
       `,
          )
          .all() as any[];

        for (let inv of invoices) {
          inv.items = db
            .prepare(`
              SELECT di.*, 
                     COALESCE(i.item_code, 'FG-' || dn.project_id) as item_code, 
                     COALESCE(i.name, p.name, 'Commercial Trade Item') as item_name
              FROM delivery_items di
              JOIN delivery_notes dn ON di.dn_id = dn.id
              LEFT JOIN items i ON di.item_id = i.id
              LEFT JOIN projects p ON dn.project_id = p.id
              WHERE di.dn_id = ?
            `)
            .all(inv.dn_id);
        }

        res.json(invoices);
      } catch (err) {
        res.status(500).json({ error: "Query failed" });
      }
    });

    app.get(
      "/api/sales/unbilled-deliveries",
      requireRole(["FC", "SALES"]),
      (req, res) => {
        try {
          const unbilled = db
            .prepare(
              `
          SELECT dn.*, COALESCE(c.name, dn.customer_id) as customer_name, p.name as project_name, 
                 q.amount as quotation_amount, q.title as quotation_title
          FROM delivery_notes dn
          LEFT JOIN customers c ON dn.customer_id = c.id
          LEFT JOIN projects p ON dn.project_id = p.id
          LEFT JOIN quotations q ON p.quotation_id = q.id
          WHERE dn.status = 'DELIVERED' AND dn.invoiced_at IS NULL
       `,
            )
            .all();
          res.json(unbilled);
        } catch (err) {
          res.status(500).json({ error: "Query failed " });
        }
      },
    );

    app.post(
      "/api/sales/invoice/:dn_id",
      requireRole(["FC", "SALES"]),
      (req, res) => {
        const userRole = (req as any).userRole;
        const userLevel = (req as any).userLevel;
        if (
          userRole !== "FC" &&
          (userRole !== "SALES" || userLevel !== "MANAGER")
        ) {
          return res
            .status(403)
            .json({ error: "Access denied. Only FC or Sales Manager can generate commercial invoices." });
        }
        try {
          const {
            amount,
            bank_account_id,
            payment_terms,
            ppn_rate,
            pph_rate,
            job_description,
          } = req.body;
          const dnId = req.params.dn_id;
          const dn = db
            .prepare("SELECT * FROM delivery_notes WHERE id = ?")
            .get(dnId) as any;
          if (!dn) return res.status(404).json({ error: "Delivery not found" });
          if (dn.status !== "DELIVERED")
            return res
              .status(400)
              .json({ error: "Only DELIVERED notes can be invoiced." });
          if (dn.invoiced_at)
            return res
              .status(400)
              .json({ error: "Delivery already invoiced." });

          let finalJobDesc = job_description;
          if (!finalJobDesc) {
            if (dn.project_id) {
              const proj = db
                .prepare("SELECT name FROM projects WHERE id = ?")
                .get(dn.project_id) as any;
              finalJobDesc =
                proj?.name || `Commercial Trade Delivery (DN: ${dn.dn_number})`;
            } else {
              finalJobDesc = `Commercial Trade Delivery (DN: ${dn.dn_number})`;
            }
          }

          db.transaction(() => {
            const ciId = "CI-" + crypto.randomUUID();
            const dParts = new Date().toISOString().split("T")[0].split("-");
            const ciNumber = `CI-${dParts[0]}${dParts[1]}-${Math.floor(
              Math.random() * 1000,
            )
              .toString()
              .padStart(3, "0")}`;

            db.prepare(
              `
              INSERT INTO commercial_invoices (id, ci_number, dn_id, customer_id, project_id, amount, bank_account_id, payment_terms, ppn_rate, pph_rate, job_description)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           `,
            ).run(
              ciId,
              ciNumber,
              dn.id,
              dn.customer_id,
              dn.project_id || null,
              amount,
              bank_account_id || null,
              payment_terms || "Net 30",
              ppn_rate || 0,
              pph_rate || 0,
              finalJobDesc,
            );

            db.prepare(
              "UPDATE delivery_notes SET invoiced_at = CURRENT_TIMESTAMP WHERE id = ?",
            ).run(dn.id);
          })();

          res.json({ success: true });
        } catch (err: any) {
          console.error("Invoicing Error: ", err);
          res.status(500).json({ error: "Failed to generate invoice." });
        }
      },
    );

    app.post(
      "/api/projects/:id/create-fg-sku",
      requireRole(["FC", "PRODUCTION", "ENGINEERING", "WAREHOUSE"]),
      (req, res) => {
        try {
          if (req.params.id === "GENERAL") {
            return res
              .status(400)
              .json({
                error: "Cannot create finished good for general procurement",
              });
          }
          const project = db
            .prepare("SELECT * FROM projects WHERE id = ?")
            .get(req.params.id) as any;
          if (!project)
            return res.status(404).json({ error: "Project not found" });

          // Attempt to find original quotation to derive quantities
          const quotation = project.quotation_id
            ? (db
                .prepare("SELECT * FROM quotations WHERE id = ?")
                .get(project.quotation_id) as any)
            : null;
          const quotationItems = quotation
            ? (db
                .prepare("SELECT * FROM quotation_items WHERE quotation_id = ?")
                .all(quotation.id) as any[])
            : [];

          const itemId = "ITM-" + crypto.randomUUID();
          const fgCode = `FG-${project.id}`;
          const fgName = project.name;

          const totalQty = project.qty || 1;
          const firstUom = project.uom || "Unit";

          db.transaction(() => {
            db.prepare(
              "INSERT INTO items (id, item_code, name, spec, uom, type) VALUES (?, ?, ?, ?, ?, ?)",
            ).run(
              itemId,
              fgCode,
              fgName,
              `Finished Good for Project ${project.name}`,
              firstUom,
              "FINISHED",
            );
            db.prepare(
              "INSERT INTO inventory (item_id, free_stock, allocated_stock) VALUES (?, ?, ?)",
            ).run(itemId, totalQty, 0);
            db.prepare(
              "INSERT INTO stock_movements (id, item_id, type, qty, reference_id, project_id) VALUES (?, ?, ?, ?, ?, ?)",
            ).run(
              "SMV-" + crypto.randomUUID(),
              itemId,
              "ADJUSTMENT",
              totalQty,
              project.id,
              project.id,
            );

            // Log completion
            db.prepare(
              "UPDATE projects SET status = 'FINISHED', archived_at = CURRENT_TIMESTAMP WHERE id = ? AND status != 'FINISHED'",
            ).run(project.id);
          })();

          logAudit(
            (req.headers["x-user-email"] as string) || "SYSTEM",
            "RECORD_FINISHED_GOOD",
            "PROJECT",
            project.id,
            `Recorded ${totalQty} ${firstUom} as Finished Good for project ${project.id}`,
          );
          res.json({ success: true, item_id: itemId, qty: totalQty });
        } catch (err) {
          console.error(err);
          res.status(500).json({ error: "Failed to record finished goods" });
        }
      },
    );

    app.get("/api/finance/analytics", requireRole(["FC", "SALES"]), (req, res) => {
      try {
        const invoices = db.prepare("SELECT * FROM commercial_invoices").all() as any[];
        let totalBilled = 0;
        let totalPaid = 0;
        let totalUnpaid = 0;
        
        const monthlyDataMap = new Map();

        invoices.forEach(inv => {
          totalBilled += (inv.amount || 0);
          if (inv.status === 'PAID') {
            totalPaid += (inv.amount || 0);
          } else {
            totalUnpaid += (inv.amount || 0);
          }
          
          if (inv.created_at) {
            const date = new Date(inv.created_at);
            const month = date.toLocaleString('default', { month: 'short', year: '2-digit' });
            if (!monthlyDataMap.has(month)) {
              monthlyDataMap.set(month, { name: month, revenue: 0, cogs: 0, profit: 0 });
            }
            const monthData = monthlyDataMap.get(month);
            if (inv.status === 'PAID') {
              monthData.revenue += (inv.amount || 0);
              monthData.profit += (inv.amount || 0);
            }
          }
        });

        const purchaseOrders = db.prepare("SELECT * FROM purchase_orders").all() as any[];
        let totalCOGS = 0;
        purchaseOrders.forEach(po => {
          if (po.status === 'FINISHED') {
             totalCOGS += (po.total_amount || 0);
          }
          
          if (po.created_at) {
             const date = new Date(po.created_at);
             const month = date.toLocaleString('default', { month: 'short', year: '2-digit' });
             if (!monthlyDataMap.has(month)) {
               monthlyDataMap.set(month, { name: month, revenue: 0, cogs: 0, profit: 0 });
             }
             const monthData = monthlyDataMap.get(month);
             if (po.status === 'FINISHED') {
               monthData.cogs += (po.total_amount || 0);
               monthData.profit -= (po.total_amount || 0);
             }
          }
        });
        
        const chartData = Array.from(monthlyDataMap.values()).sort((a, b) => {
           // simple string sort is not great for dates, but okay for this prototype
           // ideally parse the 'short 2-digit' back to a date
           return 0; // retain insertion order which is loosely chronological if records are
        });

        res.json({
          success: true,
          data: {
            total_billed: totalBilled,
            total_received: totalPaid,
            total_receivable: totalUnpaid,
            total_cogs: totalCOGS,
            gross_margin: totalBilled - totalCOGS, // Or totalPaid - totalCOGS depending on definition
            chartData
          }
        });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch finance analytics" });
      }
    });

    app.put("/api/finance/invoices/:id/pay", requireRole(["FC", "SALES"]), (req, res) => {
      try {
        const { pin } = req.body;
        if (!pin || !isValidDailyAuthKey(req.headers["x-user-email"] as string, pin)) {
           return res.status(400).json({ error: "Invalid authorization PIN" });
        }
        db.prepare("UPDATE commercial_invoices SET status = 'PAID', paid_at = CURRENT_TIMESTAMP WHERE id = ?").run(req.params.id);
        logAudit((req.headers["x-user-email"] as string) || "System", "INVOICE_PAID", "FINANCE", req.params.id, "Commercial Invoice marked as PAID");
        res.json({ success: true });
      } catch (e: any) {
        console.error("Mark invoice paid failed:", e);
        res.status(500).json({ error: "Failed to mark as paid" });
      }
    });

    app.get("/api/finance/payables", requireRole(["FC", "SALES", "PURCHASING"]), (req, res) => {
      try {
        const d = db.prepare("SELECT * FROM purchase_orders ORDER BY created_at DESC").all();
        res.json({ success: true, data: d });
      } catch (e: any) {
         res.status(500).json({ error: "Failed to load payables" });
      }
    });

    app.put("/api/finance/payables/:id/pay", requireRole(["FC", "SALES", "PURCHASING"]), (req, res) => {
      try {
        const { pin } = req.body;
        if (!pin || !isValidDailyAuthKey(req.headers["x-user-email"] as string, pin)) {
           return res.status(400).json({ error: "Invalid authorization PIN" });
        }
        db.prepare("UPDATE purchase_orders SET status = 'FINISHED' WHERE id = ?").run(req.params.id);
        logAudit((req.headers["x-user-email"] as string) || "System", "PO_PAID", "FINANCE", req.params.id, "Purchase Order marked as PAID (FINISHED)");
        res.json({ success: true });
      } catch (e: any) {
        console.error("Mark PO paid failed:", e);
        res.status(500).json({ error: "Failed to mark as paid" });
      }
    });

    // 404 handler for /api routes
    app.all("/api/*", (req, res) => {
      res.status(404).json({ error: `Not Found: ${req.originalUrl}` });
    });

    // Global error handler for /api routes
    app.use("/api", (err: any, req: any, res: any, next: any) => {
      console.error("Unhandled API Error:", err);
      res.status(err.status || 500).json({
        error: err.message || "Internal Server Error",
        path: req.originalUrl,
      });
    });

    // Robust production asset detection. If pre-built static assets (dist/index.html) exist,
    // serve them directly to prevent the server from crashing or spinning up a Vite dev instance on Render/production.
    const distPath = path.join(process.cwd(), "dist");
    const isProductionMode = process.env.NODE_ENV === "production" || fs.existsSync(path.join(distPath, "index.html"));

    if (!isProductionMode) {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } else {
      app.use(express.static(distPath));
      app.get("*", (req, res) => {
        res.sendFile(path.join(distPath, "index.html"));
      });
    }

    // Initialize Database before listening to port 3000
    // This ensures that all tables exist before the first request arrives
    console.log("Initializing database...");
    try {
      initDb();
      console.log("Database initialized successfully.");

      try {
        db.exec(`
          CREATE TABLE IF NOT EXISTS bank_accounts (
            id TEXT PRIMARY KEY,
            bank_name TEXT NOT NULL,
            account_number TEXT NOT NULL,
            account_holder TEXT NOT NULL,
            branch TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);
        console.log("Bank accounts table checked/created.");
        const bnkCount = db
          .prepare("SELECT COUNT(*) as count FROM bank_accounts")
          .get() as any;
        if (bnkCount && bnkCount.count === 0) {
          db.prepare(
            `
            INSERT INTO bank_accounts (id, bank_name, account_number, account_holder, branch)
            VALUES ('BNK-DEFAULT', 'BANK MANDIRI', '1240009876543', 'CV BATU EMAS GROUP', 'Sudirman Jakarta')
          `,
          ).run();
          console.log("Seeded default bank account.");
        }
      } catch (err) {
        console.error("Failed to setup bank accounts table", err);
      }

      try {
        db.exec(
          "ALTER TABLE commercial_invoices ADD COLUMN bank_account_id TEXT;",
        );
      } catch (e) {}
      try {
        db.exec(
          "ALTER TABLE commercial_invoices ADD COLUMN payment_terms TEXT;",
        );
      } catch (e) {}
      try {
        db.exec(
          "ALTER TABLE commercial_invoices ADD COLUMN ppn_rate REAL DEFAULT 0;",
        );
      } catch (e) {}
      try {
        db.exec(
          "ALTER TABLE commercial_invoices ADD COLUMN pph_rate REAL DEFAULT 0;",
        );
      } catch (e) {}
      try {
        db.exec(
          "ALTER TABLE commercial_invoices ADD COLUMN job_description TEXT;",
        );
      } catch (e) {}
      try {
        db.exec("ALTER TABLE purchase_orders ADD COLUMN vendor_doc_url TEXT;");
      } catch (e) {}

      try {
        db.exec("ALTER TABLE quotations ADD COLUMN npwp_tax_id TEXT;");
      } catch (e) {}
      
      try {
        db.exec("ALTER TABLE quotations ADD COLUMN pph_rate REAL DEFAULT 0;");
      } catch (e) {}

      try {
        db.prepare(
          "UPDATE inventory SET free_stock = free_stock + allocated_stock, allocated_stock = 0 WHERE allocated_stock > 0",

        ).run();
        console.log("Migrated allocated_stock to free_stock successfully.");
      } catch (err) {
        console.error("Migration failed:", err);
      }

      try {
        db.prepare(
          "UPDATE projects SET name = 'General Procurement' WHERE id = 'GENERAL' AND name LIKE 'General Procurement (No Project)%'",
        ).run();
        console.log("Updated General Procurement project name.");
      } catch (err) {
        console.error("Project name update failed:", err);
      }
    } catch (err) {
      console.error("Database initialization failed:", err);
      // In a real app we might want to exit here, but for this environment we'll try to continue
    }

    app.listen(PORT, "0.0.0.0", () => {
      console.log(
        `Server successfully started and listening on http://0.0.0.0:${PORT}`,
      );
    });
  } catch (err) {
    console.error("Critical server startup error:", err);
  }
}

startServer();
