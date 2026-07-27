import crypto from "node:crypto";
import { db } from "./db.js";

export type UserRow = {
  id: number;
  email: string;
  password_hash: string;
  display_name: string;
  role: "admin" | "user";
  status: "pending" | "approved" | "rejected";
  created_at: string;
};

declare global {
  namespace Express {
    interface Request {
      user?: UserRow;
    }
  }
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hashHex] = stored.split(":");
  if (scheme !== "scrypt" || !salt || !hashHex) return false;
  const hash = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hashHex, "hex");
  if (hash.length !== expected.length) return false;
  return crypto.timingSafeEqual(hash, expected);
}

export function createSession(userId: number): string {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare(`INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)`).run(token, userId, expiresAt);
  return token;
}

export function parseSidCookie(req: { headers: { cookie?: string } }): string | null {
  const cookie = req.headers.cookie;
  if (!cookie) return null;
  const match = cookie.split(";").map((c) => c.trim()).find((c) => c.startsWith("sid="));
  return match ? decodeURIComponent(match.slice(4)) : null;
}

export function setSidCookie(res: { setHeader: (name: string, value: string) => void }, token: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `sid=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${secure}`
  );
}

export function clearSidCookie(res: { setHeader: (name: string, value: string) => void }) {
  res.setHeader("Set-Cookie", "sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
}

export function getUserBySession(token: string): UserRow | null {
  const row = db.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > datetime('now')`
  ).get(token) as UserRow | undefined;
  return row ?? null;
}

export function requireUser(req: any, res: any, next: any) {
  const token = parseSidCookie(req);
  const user = token ? getUserBySession(token) : null;
  if (!user || user.status !== "approved") {
    return void res.status(401).json({ error: "Not authenticated" });
  }
  req.user = user;
  next();
}

export function requireAdmin(req: any, res: any, next: any) {
  if (req.user?.role !== "admin") return void res.status(403).json({ error: "Admin access required" });
  next();
}

/** Strips password_hash and masks the LLM key, same convention GET /settings already used. */
export function safeUser(u: UserRow & Record<string, any>) {
  const { password_hash, ...rest } = u;
  if (rest.llm_api_key) rest.llm_api_key = `saved:${rest.llm_api_key.slice(0, 6)}…${rest.llm_api_key.slice(-4)}`;
  return rest;
}
