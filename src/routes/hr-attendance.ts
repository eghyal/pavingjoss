import { Router } from "express";
import db from "../db/database.ts";

export const hrAttendanceRouter = Router();

// A simple write queue to serialize SQLite writes and prevent 'SQLITE_BUSY' concurrency lock errors 
// when thousands of employees clock in at the exact same minute.
type Task<T> = () => T | Promise<T>;
class SQLiteWriteQueue {
  private queue: { task: Task<any>; resolve: (val: any) => void; reject: (err: any) => void }[] = [];
  private isProcessing = false;

  public enqueue<T>(task: Task<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.processQueue();
    });
  }

  private async processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;
    
    // Yield to the event loop so this doesn't strictly block all other requests
    await new Promise(resolve => setImmediate(resolve));

    while (this.queue.length > 0) {
      const { task, resolve, reject } = this.queue.shift()!;
      try {
        const result = await task();
        resolve(result);
      } catch (err) {
        reject(err);
      }
    }

    this.isProcessing = false;
  }
}

const attendanceWriteQueue = new SQLiteWriteQueue();

// Helper function to fetch tamper-proof global synchronized time for Jakarta GMT+7 area
const getSecureJakartaTime = async (): Promise<{ dateStr: string; clockTime: string }> => {
  const endpoints = [
    { url: "https://timeapi.io/api/Time/current/zone?timeZone=Asia/Jakarta", parser: (d: any) => d.dateTime },
    { url: "https://worldtimeapi.org/api/timezone/Asia/Jakarta", parser: (d: any) => d.datetime },
    { url: "http://worldtimeapi.org/api/timezone/Asia/Jakarta", parser: (d: any) => d.datetime }
  ];

  for (const endpoint of endpoints) {
    try {
      const controller = new AbortController();
      const tId = setTimeout(() => controller.abort(), 2000);
      const response = await fetch(endpoint.url, { signal: controller.signal });
      clearTimeout(tId);

      if (response.ok) {
        const data = await response.json();
        const datetimeStr = endpoint.parser(data);
        if (datetimeStr) {
          let parsedStr = datetimeStr;
          // Normalize naive LocalDateTime strings by explicitly appending the Asia/Jakarta offset (+07:00)
          // to prevent JavaScript from incorrectly parsing it as a naive local time (which maps to UTC)
          if (!parsedStr.endsWith('Z') && !parsedStr.includes('+') && !parsedStr.includes('-')) {
            parsedStr = parsedStr + "+07:00";
          } else if (!parsedStr.endsWith('Z') && !/\+\d{2}:?\d{2}$/.test(parsedStr) && !/-\d{2}:?\d{2}$/.test(parsedStr)) {
            parsedStr = parsedStr + "+07:00";
          }

          const dt = new Date(parsedStr);
          if (!isNaN(dt.getTime())) {
            const formatter = new Intl.DateTimeFormat("en-US", {
              timeZone: "Asia/Jakarta",
              year: "numeric",
              month: "2-digit",
              day: "2-digit"
            });
            const parts = formatter.formatToParts(dt);
            const year = parts.find(p => p.type === "year")?.value;
            const month = parts.find(p => p.type === "month")?.value;
            const day = parts.find(p => p.type === "day")?.value;
            return {
              dateStr: `${year}-${month}-${day}`,
              clockTime: dt.toISOString()
            };
          }
        }
      }
    } catch (e) {
      console.warn(`Fallback triggered. Secure Time API source ${endpoint.url} failed:`, e);
    }
  }

  // Safe Server-Side secure timestamp fallback if all public synchronized APIs undergo temporary outage
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = formatter.formatToParts(now);
  const year = parts.find(p => p.type === "year")?.value;
  const month = parts.find(p => p.type === "month")?.value;
  const day = parts.find(p => p.type === "day")?.value;
  return {
    dateStr: `${year}-${month}-${day}`,
    clockTime: now.toISOString()
  };
};

hrAttendanceRouter.get("/api/hr/attendances", (req, res) => {
  try {
    const attendances = db.prepare(`
      SELECT a.*, u.name as employee_name
      FROM attendance_db.hr_attendances a
      JOIN users u ON a.employee_username = u.username
      ORDER BY a.date DESC
    `).all();
    res.json(attendances);
  } catch (e: any) {
    console.error("Fetch attendances failed:", e);
    res.status(500).json({ error: "Failed to fetch attendances" });
  }
});

hrAttendanceRouter.post("/api/hr/attendances/clock-in", async (req, res) => {
  try {
    const username = (req.headers["x-user-email"] || req.headers["remote-user"] || req.body.employee_username) as string;
    if (!username) return res.status(401).json({ error: "Unauthorized" });

    // Resolving Gap: Gap Validasi Server untuk Clock In
    const secureTime = await getSecureJakartaTime();
    const dateStr = secureTime.dateStr;
    const clockTime = secureTime.clockTime;
    const location = req.body.location || null;

    // Phase 2: Serialized DB Write via WriteQueue
    await attendanceWriteQueue.enqueue(() => {
      const existing = db.prepare("SELECT * FROM attendance_db.hr_attendances WHERE employee_username = ? AND date = ?").get(username, dateStr) as any;
      if (existing) {
        throw new Error("Already clocked in today");
      }

      const id = "ATT-" + Math.random().toString(36).substr(2, 9).toUpperCase();
      db.prepare(`
        INSERT INTO attendance_db.hr_attendances (id, employee_username, date, clock_in, clock_in_location)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, username, dateStr, clockTime, location);
    });

    res.json({ success: true });
  } catch (e: any) {
    console.error("Clock In failed:", e);
    if (e.message === "Already clocked in today") {
      res.status(400).json({ error: e.message });
    } else {
      res.status(500).json({ error: "Failed to clock in securely" });
    }
  }
});

hrAttendanceRouter.put("/api/hr/attendances/clock-out", async (req, res) => {
  try {
    const username = (req.headers["x-user-email"] || req.headers["remote-user"] || req.body.employee_username) as string;
    if (!username) return res.status(401).json({ error: "Unauthorized" });

    // Resolving Gap: Gap Validasi Server untuk Clock Out
    const secureTime = await getSecureJakartaTime();
    const dateStr = secureTime.dateStr;
    const clockTime = secureTime.clockTime;
    const location = req.body.location || null;

    // Phase 2: Serialized DB Write via WriteQueue
    await attendanceWriteQueue.enqueue(() => {
      const existing = db.prepare("SELECT * FROM attendance_db.hr_attendances WHERE employee_username = ? AND date = ?").get(username, dateStr) as any;
      if (!existing) {
        throw new Error("Not clocked in today");
      }

      db.prepare(`
        UPDATE attendance_db.hr_attendances
        SET clock_out = ?, clock_out_location = ?
        WHERE id = ?
      `).run(clockTime, location, existing.id);
    });

    res.json({ success: true });
  } catch (e: any) {
    console.error("Clock Out failed:", e);
    if (e.message === "Not clocked in today") {
      res.status(400).json({ error: e.message });
    } else {
      res.status(500).json({ error: "Failed to clock out securely" });
    }
  }
});
