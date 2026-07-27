import { Router } from "express";
import { db } from "./db.js";
import {
  clearSidCookie, createSession, getUserBySession, hashPassword,
  parseSidCookie, safeUser, setSidCookie, verifyPassword, UserRow,
} from "./auth.js";

export const authRouter = Router();

const wrap =
  (fn: (req: any, res: any) => Promise<void> | void) => async (req: any, res: any) => {
    try {
      await fn(req, res);
    } catch (e: any) {
      res.status(e.status || 500).json({ error: e.message || String(e) });
    }
  };

function userCount(): number {
  return (db.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number }).c;
}

authRouter.get("/bootstrap-status", wrap((_req, res) => {
  res.json({ needsSetup: userCount() === 0 });
}));

authRouter.post("/setup", wrap((req, res) => {
  if (userCount() > 0) throw Object.assign(new Error("Setup already completed"), { status: 409 });
  const { email, password, display_name } = req.body;
  if (!email || !password) throw Object.assign(new Error("email and password are required"), { status: 400 });
  const r = db.prepare(
    `INSERT INTO users (email, password_hash, display_name, role, status) VALUES (?, ?, ?, 'admin', 'approved')`
  ).run(String(email).toLowerCase().trim(), hashPassword(password), display_name || "");
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(r.lastInsertRowid) as UserRow;
  setSidCookie(res, createSession(user.id));
  res.json({ user: safeUser(user) });
}));

authRouter.post("/signup", wrap((req, res) => {
  const { email, password, display_name } = req.body;
  if (!email || !password) throw Object.assign(new Error("email and password are required"), { status: 400 });
  if (String(password).length < 8) throw Object.assign(new Error("Password must be at least 8 characters"), { status: 400 });
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(String(email).toLowerCase().trim());
  if (existing) throw Object.assign(new Error("An account with this email already exists"), { status: 409 });
  db.prepare(
    `INSERT INTO users (email, password_hash, display_name, role, status) VALUES (?, ?, ?, 'user', 'pending')`
  ).run(String(email).toLowerCase().trim(), hashPassword(password), display_name || "");
  res.json({ ok: true });
}));

authRouter.post("/login", wrap((req, res) => {
  const { email, password } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(String(email || "").toLowerCase().trim()) as UserRow | undefined;
  if (!user || !verifyPassword(password || "", user.password_hash)) {
    throw Object.assign(new Error("Invalid email or password"), { status: 401 });
  }
  if (user.status === "pending") {
    throw Object.assign(new Error("Your account is awaiting admin approval"), { status: 403 });
  }
  if (user.status === "rejected") {
    throw Object.assign(new Error("Invalid email or password"), { status: 401 });
  }
  setSidCookie(res, createSession(user.id));
  res.json({ user: safeUser(user) });
}));

authRouter.post("/logout", wrap((req, res) => {
  const token = parseSidCookie(req);
  if (token) db.prepare("DELETE FROM sessions WHERE id = ?").run(token);
  clearSidCookie(res);
  res.json({ ok: true });
}));

authRouter.get("/me", wrap((req, res) => {
  const token = parseSidCookie(req);
  const user = token ? getUserBySession(token) : null;
  res.json({ user: user ? safeUser(user) : null });
}));
