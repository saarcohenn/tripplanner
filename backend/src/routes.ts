import { Router } from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { db, bumpPlanVersion, getSetting, setSetting, seedDemoIfEmpty, DATA_DIR } from "./db.js";
import { complete, extractJson, listModels, loadLlmConfig, DEFAULT_MODELS } from "./llm.js";
import {
  planPrompt, advisorPrompt, dayAdvicePrompt, dayChatPrompt, importPrompt, insightPrompt, mergePrompt,
  DEFAULT_PLAN_SYSTEM_PROMPT, TripBundle,
} from "./prompts.js";
import { requireUser, requireAdmin, safeUser } from "./auth.js";
import { assertTripAccess, assertTripWrite, ensurePersonalRoom, roomIdsForUser } from "./rooms.js";
import { fetchSharedList } from "./gmapsList.js";
import { sanitizeProposal, searchQueries, type Candidate } from "./dayChat.js";

export const api = Router();
api.use(requireUser);

// Place photos are fetched once from Google and cached to disk (inside the same persisted
// DATA_DIR volume as the SQLite DB) — there are never many places, so nothing evicts this.
const PHOTOS_DIR = path.join(DATA_DIR, "photos");
fs.mkdirSync(PHOTOS_DIR, { recursive: true });
const PHOTO_MIME_EXT: Record<string, string> = { "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
const PHOTO_EXTS = ["jpg", "png", "webp", "gif"];

function photoHash(photoRef: string): string {
  return crypto.createHash("sha256").update(photoRef).digest("hex");
}

/** Any already-cached file for this photo ref, regardless of which extension it landed on. */
function findCachedPhoto(photoRef: string): string | null {
  const hash = photoHash(photoRef);
  for (const ext of PHOTO_EXTS) {
    const p = path.join(PHOTOS_DIR, `${hash}.${ext}`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function photoWritePath(photoRef: string, contentType: string): string {
  const ext = PHOTO_MIME_EXT[contentType] || "jpg";
  return path.join(PHOTOS_DIR, `${photoHash(photoRef)}.${ext}`);
}

function mimeForPath(p: string): string {
  const ext = path.extname(p).slice(1);
  return Object.entries(PHOTO_MIME_EXT).find(([, e]) => e === ext)?.[0] || "image/jpeg";
}

const wrap =
  (fn: (req: any, res: any) => Promise<void> | void) => async (req: any, res: any) => {
    try {
      await fn(req, res);
    } catch (e: any) {
      res.status(e.status || 500).json({ error: e.message || String(e) });
    }
  };

// ---------- admin: approve/reject signups, manage roles ----------
api.get("/admin/users", requireAdmin, wrap((_req, res) => {
  const users = db.prepare("SELECT * FROM users ORDER BY created_at DESC").all() as any[];
  res.json(users.map(safeUser));
}));

api.post("/admin/users/:id/approve", requireAdmin, wrap((req, res) => {
  const id = Number(req.params.id);
  db.prepare("UPDATE users SET status = 'approved' WHERE id = ?").run(id);
  const user = db.prepare("SELECT display_name, email FROM users WHERE id = ?").get(id) as { display_name: string; email: string };
  ensurePersonalRoom(id, user.display_name, user.email);
  res.json({ ok: true });
}));

api.post("/admin/users/:id/reject", requireAdmin, wrap((req, res) => {
  db.prepare("UPDATE users SET status = 'rejected' WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
}));

api.post("/admin/users/:id/role", requireAdmin, wrap((req, res) => {
  const id = Number(req.params.id);
  const role = req.body.role === "admin" ? "admin" : "user";
  if (role === "user") {
    const admins = (db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get() as { c: number }).c;
    const target = db.prepare("SELECT role FROM users WHERE id = ?").get(id) as { role: string } | undefined;
    if (target?.role === "admin" && admins <= 1) {
      throw Object.assign(new Error("Can't demote the last remaining admin"), { status: 400 });
    }
  }
  db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, id);
  res.json({ ok: true });
}));

// Approved-user lookup for the room-invite autocomplete (mirrors the Places name-search UX).
api.get("/users/search", wrap((req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) return res.json([]);
  const rows = db.prepare(
    `SELECT id, email, display_name FROM users
     WHERE status = 'approved' AND (email LIKE ? OR display_name LIKE ?)
     LIMIT 8`
  ).all(`${q}%`, `${q}%`);
  res.json(rows);
}));

// ---------- rooms: shared containers for trips, invite-only ----------
api.get("/rooms", wrap((req, res) => {
  const rooms = db.prepare(
    `SELECT r.* FROM rooms r JOIN room_members m ON m.room_id = r.id WHERE m.user_id = ? ORDER BY r.id`
  ).all(req.user.id);
  res.json(rooms);
}));

api.post("/rooms", wrap((req, res) => {
  const name = String(req.body.name || "").trim();
  if (!name) throw Object.assign(new Error("name is required"), { status: 400 });
  const r = db.prepare("INSERT INTO rooms (name, owner_id) VALUES (?, ?)").run(name, req.user.id);
  db.prepare("INSERT INTO room_members (room_id, user_id, role) VALUES (?, ?, 'owner')").run(r.lastInsertRowid, req.user.id);
  res.json(db.prepare("SELECT * FROM rooms WHERE id = ?").get(r.lastInsertRowid));
}));

function assertRoomMember(userId: number, roomId: number) {
  const member = db.prepare("SELECT role FROM room_members WHERE room_id = ? AND user_id = ?").get(roomId, userId) as { role: string } | undefined;
  if (!member) throw Object.assign(new Error("Room not found"), { status: 404 });
  return member;
}

api.get("/rooms/:id/members", wrap((req, res) => {
  const roomId = Number(req.params.id);
  assertRoomMember(req.user.id, roomId);
  const members = db.prepare(
    `SELECT u.id, u.email, u.display_name, m.role FROM room_members m JOIN users u ON u.id = m.user_id
     WHERE m.room_id = ? ORDER BY m.role, u.display_name`
  ).all(roomId);
  res.json(members);
}));

api.post("/rooms/:id/invite", wrap((req, res) => {
  const roomId = Number(req.params.id);
  const me = assertRoomMember(req.user.id, roomId);
  if (me.role !== "owner") throw Object.assign(new Error("Only the room owner can invite members"), { status: 403 });
  const role = req.body.role === "viewer" ? "viewer" : "editor";
  let target: { id: number } | undefined;
  if (req.body.user_id) {
    target = db.prepare("SELECT id FROM users WHERE id = ? AND status = 'approved'").get(Number(req.body.user_id)) as any;
  } else {
    // Accept either an email or a display name (username) — whichever the invite box was typed with.
    const identifier = String(req.body.identifier ?? req.body.email ?? "").trim();
    if (!identifier) throw Object.assign(new Error("Enter an email or username"), { status: 400 });
    target = db.prepare(
      `SELECT id FROM users WHERE status = 'approved' AND (LOWER(email) = LOWER(?) OR LOWER(display_name) = LOWER(?))`
    ).get(identifier, identifier) as any;
  }
  if (!target) throw Object.assign(new Error("No approved user found with that email or username"), { status: 404 });
  const already = db.prepare("SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?").get(roomId, target.id);
  if (already) throw Object.assign(new Error("Already a member of this room"), { status: 409 });
  db.prepare("INSERT INTO room_members (room_id, user_id, role) VALUES (?, ?, ?)").run(roomId, target.id, role);
  const room = db.prepare("SELECT name FROM rooms WHERE id = ?").get(roomId) as { name: string };
  const inviter = req.user.display_name || req.user.email;
  db.prepare("INSERT INTO notifications (user_id, message) VALUES (?, ?)").run(
    target.id, `${inviter} added you to "${room.name}" as ${role === "viewer" ? "a viewer" : "an editor"}.`
  );
  res.json({ ok: true });
}));

// ---------- in-app notifications ----------
api.get("/notifications", wrap((req, res) => {
  const items = db.prepare(
    "SELECT id, message, created_at, read_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 20"
  ).all(req.user.id);
  const unread = (db.prepare("SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL").get(req.user.id) as { c: number }).c;
  res.json({ items, unread });
}));

api.post("/notifications/read-all", wrap((req, res) => {
  db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL").run(req.user.id);
  res.json({ ok: true });
}));

api.put("/rooms/:id/members/:userId/role", wrap((req, res) => {
  const roomId = Number(req.params.id);
  const targetId = Number(req.params.userId);
  const me = assertRoomMember(req.user.id, roomId);
  if (me.role !== "owner") throw Object.assign(new Error("Only the room owner can change roles"), { status: 403 });
  const room = db.prepare("SELECT owner_id FROM rooms WHERE id = ?").get(roomId) as { owner_id: number };
  if (targetId === room.owner_id) throw Object.assign(new Error("Can't change the owner's role"), { status: 400 });
  const role = req.body.role === "viewer" ? "viewer" : "editor";
  db.prepare("UPDATE room_members SET role = ? WHERE room_id = ? AND user_id = ?").run(role, roomId, targetId);
  res.json({ ok: true });
}));

api.delete("/rooms/:id/members/:userId", wrap((req, res) => {
  const roomId = Number(req.params.id);
  const targetId = Number(req.params.userId);
  const me = assertRoomMember(req.user.id, roomId);
  if (targetId !== req.user.id && me.role !== "owner") {
    throw Object.assign(new Error("Only the room owner can remove other members"), { status: 403 });
  }
  const room = db.prepare("SELECT owner_id FROM rooms WHERE id = ?").get(roomId) as { owner_id: number };
  if (targetId === room.owner_id) throw Object.assign(new Error("Can't remove the room's owner"), { status: 400 });
  db.prepare("DELETE FROM room_members WHERE room_id = ? AND user_id = ?").run(roomId, targetId);
  res.json({ ok: true });
}));

function getBundle(tripId: number): TripBundle {
  const trip = db.prepare("SELECT * FROM trips WHERE id = ?").get(tripId);
  if (!trip) {
    const err: any = new Error("Trip not found");
    err.status = 404;
    throw err;
  }
  const legs = db.prepare("SELECT * FROM legs WHERE trip_id = ? ORDER BY seq, id").all(tripId);
  const places = db.prepare("SELECT * FROM places WHERE trip_id = ? ORDER BY id").all(tripId);
  const bookings = db.prepare("SELECT * FROM bookings WHERE trip_id = ? ORDER BY date, id").all(tripId);
  return { trip, legs, places, bookings };
}

/** Keeps only a well-formed local "HH:MM"; anything else becomes blank rather than a guess. */
function hhmm(v: unknown): string {
  const s = String(v ?? "").trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? s : "";
}

/** The room a new trip/import lands in when the caller doesn't pick one: their own personal room. */
function defaultRoomId(userId: number): number {
  const room = db.prepare("SELECT room_id FROM room_members WHERE user_id = ? ORDER BY room_id LIMIT 1").get(userId) as { room_id: number } | undefined;
  if (!room) throw Object.assign(new Error("No room available for this account"), { status: 400 });
  return room.room_id;
}

// ---------- trips (scoped to rooms the caller belongs to) ----------
api.get("/trips", wrap((req, res) => {
  const rooms = roomIdsForUser(req.user.id);
  if (rooms.length === 0) return res.json([]);
  seedDemoIfEmpty(rooms[0]);
  const placeholders = rooms.map(() => "?").join(",");
  // my_role rides along so the client can tell a read-only trip apart before it tries to write
  // to one. Every mutating route still checks for itself — this only spares the pointless 403.
  res.json(db.prepare(
    `SELECT t.*, r.name AS room_name, r.owner_id AS room_owner_id, ou.display_name AS room_owner_name,
       (SELECT COUNT(*) FROM room_members WHERE room_id = r.id) AS room_member_count,
       (SELECT role FROM room_members WHERE room_id = r.id AND user_id = ?) AS my_role
     FROM trips t
     JOIN rooms r ON r.id = t.room_id
     LEFT JOIN users ou ON ou.id = r.owner_id
     WHERE t.room_id IN (${placeholders}) ORDER BY t.created_at DESC`
  ).all(req.user.id, ...rooms));
}));

api.post("/trips", wrap((req, res) => {
  const { name, trip_type = "round", start_date = null, end_date = null, home_city = "", budget = null, currency = "USD", notes = "" } = req.body;
  if (!name) throw Object.assign(new Error("name is required"), { status: 400 });
  const roomId = req.body.room_id ? Number(req.body.room_id) : defaultRoomId(req.user.id);
  if (!roomIdsForUser(req.user.id).includes(roomId)) throw Object.assign(new Error("Not a member of that room"), { status: 403 });
  const r = db.prepare(
    `INSERT INTO trips (name, trip_type, start_date, end_date, home_city, budget, currency, notes, room_id) VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(name, trip_type, start_date, end_date, home_city, budget, currency, notes, roomId);
  res.json(db.prepare("SELECT * FROM trips WHERE id = ?").get(r.lastInsertRowid));
}));

api.get("/trips/:id", wrap((req, res) => {
  assertTripAccess(req.user.id, Number(req.params.id));
  const b = getBundle(Number(req.params.id));
  const todos = db.prepare("SELECT * FROM todos WHERE trip_id = ? ORDER BY done, due_date, id").all(req.params.id);
  const expenses = db.prepare("SELECT * FROM expenses WHERE trip_id = ? ORDER BY date, id").all(req.params.id);
  const plan = db.prepare("SELECT * FROM plans WHERE trip_id = ? ORDER BY id DESC LIMIT 1").get(req.params.id);
  res.json({ ...b, todos, expenses, plan: plan ?? null });
}));

api.put("/trips/:id", wrap((req, res) => {
  const id = Number(req.params.id);
  assertTripWrite(req.user.id, id);
  const fields = ["name", "trip_type", "start_date", "end_date", "home_city", "home_airport", "budget", "currency", "notes", "stage"];
  const sets = fields.filter((f) => f in req.body);
  if (sets.length) {
    db.prepare(`UPDATE trips SET ${sets.map((f) => `${f} = ?`).join(", ")} WHERE id = ?`)
      .run(...sets.map((f) => req.body[f]), id);
    bumpPlanVersion(id);
  }
  res.json(db.prepare("SELECT * FROM trips WHERE id = ?").get(id));
}));

api.delete("/trips/:id", wrap((req, res) => {
  assertTripWrite(req.user.id, Number(req.params.id));
  db.prepare("DELETE FROM trips WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
}));

// Moves a trip into a different room the caller can edit in — this is how a trip actually gets
// shared: create/import it normally (lands in your personal room), then move it into a shared room.
api.put("/trips/:id/room", wrap((req, res) => {
  const id = Number(req.params.id);
  assertTripWrite(req.user.id, id);
  const targetRoomId = Number(req.body.room_id);
  if (!targetRoomId) throw Object.assign(new Error("room_id is required"), { status: 400 });
  const role = db.prepare("SELECT role FROM room_members WHERE room_id = ? AND user_id = ?").get(targetRoomId, req.user.id) as
    | { role: string }
    | undefined;
  if (!role || role.role === "viewer") throw Object.assign(new Error("You need edit access in the destination room"), { status: 403 });
  db.prepare("UPDATE trips SET room_id = ? WHERE id = ?").run(targetRoomId, id);
  res.json(db.prepare("SELECT * FROM trips WHERE id = ?").get(id));
}));

// ---------- generic child-collection CRUD (legs, places, todos, bookings) ----------
type ChildSpec = { table: string; fields: string[]; affectsPlan: boolean };
/** Fields normalised through hhmm() on the way in, so a bad clock value lands as blank. */
const TIME_FIELDS = new Set(["arrive_time", "depart_time"]);
const cellValue = (col: string, v: unknown) => (TIME_FIELDS.has(col) ? hhmm(v) : v);
const children: Record<string, ChildSpec> = {
  legs: { table: "legs", fields: ["seq", "city", "country", "airport", "arrive_date", "arrive_time", "depart_date", "depart_time", "transport", "lat", "lng", "notes"], affectsPlan: true },
  places: { table: "places", fields: ["leg_id", "name", "category", "lat", "lng", "duration_min", "priority", "status", "notes", "gmaps_url", "google_place_id", "photo_ref"], affectsPlan: true },
  todos: { table: "todos", fields: ["text", "category", "due_date", "done"], affectsPlan: false },
  expenses: { table: "expenses", fields: ["leg_id", "category", "title", "amount", "currency", "date", "notes"], affectsPlan: false },
  bookings: { table: "bookings", fields: ["leg_id", "kind", "title", "ref", "url", "date", "end_date", "cost", "currency", "notes"], affectsPlan: true },
};

for (const [name, spec] of Object.entries(children)) {
  api.post(`/trips/:tripId/${name}`, wrap((req, res) => {
    const tripId = Number(req.params.tripId);
    assertTripWrite(req.user.id, tripId);
    const cols = spec.fields.filter((f) => f in req.body);
    const r = db.prepare(
      `INSERT INTO ${spec.table} (trip_id${cols.map((c) => `, ${c}`).join("")}) VALUES (?${", ?".repeat(cols.length)})`
    ).run(tripId, ...cols.map((c) => cellValue(c, req.body[c])));
    if (spec.affectsPlan) bumpPlanVersion(tripId);
    res.json(db.prepare(`SELECT * FROM ${spec.table} WHERE id = ?`).get(r.lastInsertRowid));
  }));

  api.put(`/${name}/:id`, wrap((req, res) => {
    const id = Number(req.params.id);
    const row: any = db.prepare(`SELECT * FROM ${spec.table} WHERE id = ?`).get(id);
    if (!row) throw Object.assign(new Error("not found"), { status: 404 });
    assertTripWrite(req.user.id, row.trip_id);
    const cols = spec.fields.filter((f) => f in req.body);
    if (cols.length) {
      db.prepare(`UPDATE ${spec.table} SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`)
        .run(...cols.map((c) => cellValue(c, req.body[c])), id);
      if (spec.affectsPlan) bumpPlanVersion(row.trip_id);
    }
    res.json(db.prepare(`SELECT * FROM ${spec.table} WHERE id = ?`).get(id));
  }));

  api.delete(`/${name}/:id`, wrap((req, res) => {
    const row: any = db.prepare(`SELECT * FROM ${spec.table} WHERE id = ?`).get(Number(req.params.id));
    if (row) {
      assertTripWrite(req.user.id, row.trip_id);
      db.prepare(`DELETE FROM ${spec.table} WHERE id = ?`).run(row.id);
      if (spec.affectsPlan) bumpPlanVersion(row.trip_id);
    }
    res.json({ ok: true });
  }));
}

// ---------- plan generation + advisor (background jobs, pushed to clients over SSE) ----------
// LLM calls can take minutes on slow/high-end models — the route returns as soon as the job is
// queued, the work runs detached, and /trips/:id/events streams the result when it lands. This is
// what actually fixes the "Generate Plan" request dying mid-flight on slow models: the browser's
// HTTP request to us completes in milliseconds, so it has nothing left to time out on.
const jobListeners = new Map<number, Set<(job: any) => void>>();

function notifyJob(tripId: number, job: any) {
  for (const fn of jobListeners.get(tripId) || []) fn(job);
}

function latestJob(tripId: number) {
  return db.prepare("SELECT * FROM plan_jobs WHERE trip_id = ? ORDER BY id DESC LIMIT 1").get(tripId) ?? null;
}

// Only one plan/advisor job may run per trip at a time — starts a plan_jobs row, runs `work` in the
// background, and records done/error on completion. Returns the freshly-inserted row immediately.
function startJob(tripId: number, kind: "plan" | "advisor", work: () => Promise<{ planId: number }>) {
  const r = db.prepare(`INSERT INTO plan_jobs (trip_id, kind, status) VALUES (?, ?, 'running')`).run(tripId, kind);
  const job = latestJob(tripId);
  void (async () => {
    try {
      const { planId } = await work();
      db.prepare("UPDATE plan_jobs SET status = 'done', plan_id = ?, finished_at = datetime('now') WHERE id = ?")
        .run(planId, r.lastInsertRowid);
    } catch (e: any) {
      db.prepare("UPDATE plan_jobs SET status = 'error', error = ?, finished_at = datetime('now') WHERE id = ?")
        .run(String(e.message || e).slice(0, 2000), r.lastInsertRowid);
    }
    notifyJob(tripId, latestJob(tripId));
  })();
  return job;
}

api.post("/trips/:id/generate-plan", wrap(async (req, res) => {
  const tripId = Number(req.params.id);
  assertTripWrite(req.user.id, tripId);
  const b = getBundle(tripId);
  const existing: any = latestJob(tripId);
  if (existing?.status === "running") return void res.status(202).json(existing);
  const user = req.user;
  const cfg = loadLlmConfig(user);

  const version = (b.trip as any).plan_version;
  const job = startJob(tripId, "plan", async () => {
    const p = planPrompt(b, user.plan_system_prompt);
    const raw = await complete(p.system, p.user, cfg, "plan", user.id);
    const plan = extractJson(raw);

    // The advisor review is a separate, best-effort LLM call. A slow or failing advisor must never
    // throw away a plan that already took real time/money to generate — it's re-triggerable via /advise.
    let advisorJson: string | null = null;
    try {
      const a = advisorPrompt(b, JSON.stringify(plan));
      const advRaw = await complete(a.system, a.user, cfg, "advisor", user.id);
      advisorJson = JSON.stringify(extractJson(advRaw));
    } catch (e: any) {
      console.error(`Advisor review failed for trip ${tripId} (plan was still saved):`, e.message || e);
    }

    const r = db.prepare(
      `INSERT INTO plans (trip_id, plan_version, plan_json, advisor_json) VALUES (?,?,?,?)`
    ).run(tripId, version, JSON.stringify(plan), advisorJson);
    // A generated plan moves the trip into the "planned" (green) stage.
    db.prepare("UPDATE trips SET stage = 'planned' WHERE id = ?").run(tripId);
    return { planId: Number(r.lastInsertRowid) };
  });
  res.status(202).json(job);
}));

api.post("/trips/:id/advise", wrap(async (req, res) => {
  const tripId = Number(req.params.id);
  assertTripWrite(req.user.id, tripId);
  const b = getBundle(tripId);
  const plan: any = db.prepare("SELECT * FROM plans WHERE trip_id = ? ORDER BY id DESC LIMIT 1").get(tripId);
  if (!plan) throw Object.assign(new Error("Generate a plan first"), { status: 400 });
  const existing: any = latestJob(tripId);
  if (existing?.status === "running") return void res.status(202).json(existing);
  const user = req.user;
  const cfg = loadLlmConfig(user);

  const job = startJob(tripId, "advisor", async () => {
    const a = advisorPrompt(b, plan.plan_json);
    const advRaw = await complete(a.system, a.user, cfg, "advisor", user.id);
    const advisor = extractJson(advRaw);
    db.prepare("UPDATE plans SET advisor_json = ? WHERE id = ?").run(JSON.stringify(advisor), plan.id);
    return { planId: plan.id };
  });
  res.status(202).json(job);
}));

// ---------- hand-built / hand-edited plans ----------
// The plan document is written whole rather than patched item by item: it's a few KB, every edit
// (drag, retime, delete) is one save, and an LLM plan and a hand-built one stay the exact same
// shape — so the advisor, the day cards and everything downstream work on either without caring.
api.put("/trips/:id/plan", wrap((req, res) => {
  const tripId = Number(req.params.id);
  assertTripWrite(req.user.id, tripId);
  const doc = req.body.plan;
  if (!doc || !Array.isArray(doc.days)) {
    throw Object.assign(new Error("plan.days is required"), { status: 400 });
  }
  const trip: any = db.prepare("SELECT plan_version FROM trips WHERE id = ?").get(tripId);
  if (!trip) throw Object.assign(new Error("Trip not found"), { status: 404 });
  const mode = req.body.mode === "llm" ? "llm" : "manual";
  const json = JSON.stringify(doc);
  const existing: any = db.prepare("SELECT id FROM plans WHERE trip_id = ? ORDER BY id DESC LIMIT 1").get(tripId);

  // Saving by hand re-marks the plan as current: the user just reconciled it with whatever
  // changed, so the "plan is out of date" banner has nothing left to complain about.
  if (existing) {
    db.prepare(
      `UPDATE plans SET plan_json = ?, mode = ?, plan_version = ?, edited_at = datetime('now') WHERE id = ?`
    ).run(json, mode, trip.plan_version, existing.id);
  } else {
    db.prepare(
      `INSERT INTO plans (trip_id, plan_version, plan_json, mode, edited_at) VALUES (?,?,?,?,datetime('now'))`
    ).run(tripId, trip.plan_version, json, mode);
  }
  db.prepare("UPDATE trips SET stage = 'planned' WHERE id = ?").run(tripId);
  res.json(db.prepare("SELECT * FROM plans WHERE trip_id = ? ORDER BY id DESC LIMIT 1").get(tripId));
}));

// ---------- per-day chat ----------
// The only part of the app that puts a place in front of you that you didn't pick — and it still
// cannot invent one. Everything schedulable is either already in the trip or was fetched here this
// turn (a real Places search, or a Maps list the traveller pasted). The model refers to candidates
// by an opaque ref and the server materialises them from its own record, so there is no field for
// a made-up restaurant to arrive in.

const MAPS_LIST_RE = /https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|(?:www\.)?google\.[a-z.]+\/maps)\S*/gi;
const MAX_CANDIDATES = 60;

api.get("/trips/:id/plan/chat", wrap((req, res) => {
  const tripId = Number(req.params.id);
  assertTripAccess(req.user.id, tripId);
  const dayId = String(req.query.day_id || "");
  if (!dayId) throw Object.assign(new Error("day_id is required"), { status: 400 });
  res.json({
    messages: db.prepare(
      "SELECT id, role, content, created_at FROM plan_chat WHERE trip_id = ? AND day_id = ? ORDER BY id"
    ).all(tripId, dayId),
  });
}));

api.delete("/trips/:id/plan/chat", wrap((req, res) => {
  const tripId = Number(req.params.id);
  assertTripWrite(req.user.id, tripId);
  const dayId = String(req.query.day_id || "");
  if (!dayId) throw Object.assign(new Error("day_id is required"), { status: 400 });
  db.prepare("DELETE FROM plan_chat WHERE trip_id = ? AND day_id = ?").run(tripId, dayId);
  res.json({ ok: true });
}));

api.post("/trips/:id/plan/chat", wrap(async (req, res) => {
  const tripId = Number(req.params.id);
  assertTripWrite(req.user.id, tripId);
  const dayId = String(req.body.day_id || "");
  const message = String(req.body.message || "").trim();
  if (!dayId) throw Object.assign(new Error("day_id is required"), { status: 400 });
  if (!message) throw Object.assign(new Error("Say something first"), { status: 400 });

  const planRow: any = db.prepare("SELECT * FROM plans WHERE trip_id = ? ORDER BY id DESC LIMIT 1").get(tripId);
  if (!planRow) throw Object.assign(new Error("This trip has no plan yet"), { status: 400 });
  let doc: any;
  try { doc = JSON.parse(planRow.plan_json); } catch { doc = null; }
  const day = (doc?.days || []).find((d: any) => d.id === dayId);
  if (!day) throw Object.assign(new Error("That day is no longer in the plan"), { status: 404 });

  const bundle = getBundle(tripId);
  const dayPlaces = (bundle.places as any[]).filter((p) => p.status === "active");
  const cfg = loadLlmConfig(req.user);

  const candidates: Candidate[] = [];
  const addCandidates = (rows: Omit<Candidate, "ref">[], prefix: string) => {
    for (const r of rows) {
      if (candidates.length >= MAX_CANDIDATES) return;
      candidates.push({ ...r, ref: `${prefix}${candidates.length + 1}` });
    }
  };

  // A Maps list pasted into the message is fetched before the model sees anything, so "replan the
  // day from this list" works on the actual list rather than on the model's idea of it.
  const listUrls = message.match(MAPS_LIST_RE) || [];
  for (const url of listUrls.slice(0, 2)) {
    try {
      const { listName, items } = await fetchSharedList(url);
      addCandidates(
        items.map((it) => ({
          name: it.name, address: it.address, lat: it.lat, lng: it.lng,
          google_place_id: "", gmaps_url: it.gmaps_url, via: listName ? `list "${listName}"` : "your list",
        })),
        "l"
      );
    } catch (e: any) {
      // A bad link shouldn't kill the turn — the model is told what came back, which is nothing.
      console.error(`Chat list fetch failed for trip ${tripId}:`, e.message || e);
    }
  }

  const history = db.prepare(
    "SELECT role, content FROM plan_chat WHERE trip_id = ? AND day_id = ? ORDER BY id DESC LIMIT 8"
  ).all(tripId, dayId).reverse() as { role: string; content: string }[];

  const mapsKey = effectiveGmapsKey();
  const searched: string[] = [];

  const ask = async (searchesUsed: boolean) => {
    const p = dayChatPrompt({
      bundle, day, dayPlaces, history, message,
      candidates: candidates.map((c) => ({ ref: c.ref, name: c.name, address: c.address, via: c.via })),
      canSearch: !!mapsKey,
      searchesUsed,
    });
    return extractJson<any>(await complete(p.system, p.user, cfg, "chat", req.user.id));
  };

  let out = await ask(false);

  // One search round, then it must answer. The model names the query; Google names the places.
  const wanted = mapsKey ? searchQueries(out?.searches) : [];
  if (wanted.length) {
    for (const query of wanted) {
      searched.push(query);
      try {
        const hits = await gplacesSearch(query, mapsKey!);
        addCandidates(
          hits.map((h) => ({
            name: h.name, address: h.address, lat: h.lat, lng: h.lng,
            google_place_id: h.place_id, gmaps_url: "", via: `search "${query}"`,
          })),
          "c"
        );
      } catch (e: any) {
        console.error(`Chat search failed for trip ${tripId} (${query}):`, e.message || e);
      }
    }
    out = await ask(true);
  }

  const reply = String(out?.reply || "").trim() || "(no reply)";
  const proposal = sanitizeProposal(
    out?.proposal,
    candidates,
    new Set((bundle.places as any[]).map((p) => p.id)),
    day
  );

  const ins = db.prepare("INSERT INTO plan_chat (trip_id, day_id, role, content) VALUES (?,?,?,?)");
  ins.run(tripId, dayId, "user", message);
  ins.run(tripId, dayId, "assistant", reply);
  const messages = db.prepare(
    "SELECT id, role, content, created_at FROM plan_chat WHERE trip_id = ? AND day_id = ? ORDER BY id"
  ).all(tripId, dayId);

  res.json({ reply, proposal, searched, messages });
}));

// ---------- the advisor, one day at a time ----------
// Cached against a hash of the day itself rather than a timestamp, so "is this still about what
// I'm looking at" is a fact instead of an inference.

/** Only the parts of a day that could change the advice — a retitled summary shouldn't invalidate it. */
export function dayFingerprint(day: any, transport: string): string {
  const shape = {
    date: day.date, city: day.city, wake: day.wake_time, transport,
    items: (day.items || []).map((it: any) => [it.time, it.kind, it.title, it.duration_min, it.place_id]),
  };
  return crypto.createHash("sha256").update(JSON.stringify(shape)).digest("hex").slice(0, 32);
}

/** The day, its neighbours and how that city is crossed — everything the day prompt needs. */
function dayContext(tripId: number, dayId: string) {
  const planRow: any = db.prepare("SELECT * FROM plans WHERE trip_id = ? ORDER BY id DESC LIMIT 1").get(tripId);
  if (!planRow) throw Object.assign(new Error("This trip has no plan yet"), { status: 400 });
  let doc: any = null;
  try { doc = JSON.parse(planRow.plan_json); } catch { /* handled below */ }
  const days: any[] = doc?.days || [];
  const i = days.findIndex((d) => d.id === dayId);
  if (i < 0) throw Object.assign(new Error("That day is no longer in the plan"), { status: 404 });
  const day = days[i];
  const bundle = getBundle(tripId);
  const leg = (bundle.legs as any[]).find(
    (l) => l.arrive_date && l.depart_date && l.arrive_date <= day.date && day.date <= l.depart_date
  );
  return { bundle, day, before: days[i - 1] ?? null, after: days[i + 1] ?? null, transport: leg?.transport || "" };
}

api.get("/trips/:id/plan/day-advice", wrap((req, res) => {
  const tripId = Number(req.params.id);
  assertTripAccess(req.user.id, tripId);
  const dayId = String(req.query.day_id || "");
  if (!dayId) throw Object.assign(new Error("day_id is required"), { status: 400 });
  const row = db.prepare("SELECT json, content_hash, generated_at FROM day_advice WHERE day_id = ?").get(dayId) as
    | { json: string; content_hash: string; generated_at: string }
    | undefined;
  if (!row) return void res.json({ advice: null, stale: false, generated_at: null });
  const { day, transport } = dayContext(tripId, dayId);
  res.json({
    advice: JSON.parse(row.json),
    // Kept and shown rather than dropped: yesterday's read on a day you have since nudged is
    // still worth something, as long as it says it is out of date.
    stale: row.content_hash !== dayFingerprint(day, transport),
    generated_at: row.generated_at,
  });
}));

api.post("/trips/:id/plan/day-advice", wrap(async (req, res) => {
  const tripId = Number(req.params.id);
  assertTripWrite(req.user.id, tripId);
  const dayId = String(req.body.day_id || "");
  if (!dayId) throw Object.assign(new Error("day_id is required"), { status: 400 });

  const { bundle, day, before, after, transport } = dayContext(tripId, dayId);
  const hash = dayFingerprint(day, transport);
  const existing = db.prepare("SELECT json, content_hash, generated_at FROM day_advice WHERE day_id = ?").get(dayId) as
    | { json: string; content_hash: string; generated_at: string }
    | undefined;
  if (existing && existing.content_hash === hash && !req.body.refresh) {
    return void res.json({ advice: JSON.parse(existing.json), stale: false, generated_at: existing.generated_at });
  }

  const p = dayAdvicePrompt({ bundle, day, before, after, transport });
  const raw = await complete(p.system, p.user, loadLlmConfig(req.user), "advisor", req.user.id);
  const out = extractJson<any>(raw);
  const advice = {
    verdict: typeof out?.verdict === "string" ? out.verdict.slice(0, 400) : "",
    load: ["light", "comfortable", "full", "too much"].includes(out?.load) ? out.load : "",
    // The budget is enforced here, not just asked for — a prompt is a request, this is the rule.
    points: (Array.isArray(out?.points) ? out.points : [])
      .filter((pt: any) => pt && typeof pt.message === "string" && pt.message.trim())
      .slice(0, 3)
      .map((pt: any) => ({ type: String(pt.type || "timing"), message: pt.message.trim().slice(0, 400) })),
  };
  db.prepare(
    `INSERT INTO day_advice (day_id, trip_id, json, content_hash, generated_at) VALUES (?,?,?,?,datetime('now'))
     ON CONFLICT(day_id) DO UPDATE SET json = excluded.json, content_hash = excluded.content_hash,
       generated_at = excluded.generated_at, trip_id = excluded.trip_id`
  ).run(dayId, tripId, JSON.stringify(advice), hash);
  const saved = db.prepare("SELECT generated_at FROM day_advice WHERE day_id = ?").get(dayId) as { generated_at: string };
  res.json({ advice, stale: false, generated_at: saved.generated_at });
}));

// ---------- per-place insights (one small LLM call, cached forever) ----------
function insightRow(placeId: number) {
  return db.prepare("SELECT json, generated_at FROM place_insights WHERE place_id = ?").get(placeId) as
    | { json: string; generated_at: string }
    | undefined;
}

/** The place plus the leg city it belongs to — both routes below need exactly this. */
function placeWithCity(id: number) {
  const place: any = db.prepare("SELECT * FROM places WHERE id = ?").get(id);
  if (!place) throw Object.assign(new Error("Place not found"), { status: 404 });
  const leg: any = place.leg_id
    ? db.prepare("SELECT city, country FROM legs WHERE id = ?").get(place.leg_id)
    : null;
  return { place, city: leg?.city || "", country: leg?.country || "" };
}

api.get("/places/:id/insight", wrap((req, res) => {
  const { place } = placeWithCity(Number(req.params.id));
  assertTripAccess(req.user.id, place.trip_id);
  const row = insightRow(place.id);
  res.json(row ? { insight: JSON.parse(row.json), generated_at: row.generated_at } : { insight: null, generated_at: null });
}));

// Synchronous, unlike plan generation: one place is a short prompt and a short answer, so the
// request returns in seconds and doesn't need the whole background-job machinery.
api.post("/places/:id/insight", wrap(async (req, res) => {
  const { place, city, country } = placeWithCity(Number(req.params.id));
  assertTripWrite(req.user.id, place.trip_id);
  const existing = insightRow(place.id);
  if (existing && !req.body?.refresh) {
    return void res.json({ insight: JSON.parse(existing.json), generated_at: existing.generated_at });
  }
  const p = insightPrompt(place, city, country);
  const raw = await complete(p.system, p.user, loadLlmConfig(req.user), "insight", req.user.id);
  const insight = extractJson(raw);
  db.prepare(
    `INSERT INTO place_insights (place_id, json, generated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(place_id) DO UPDATE SET json = excluded.json, generated_at = excluded.generated_at`
  ).run(place.id, JSON.stringify(insight));
  res.json({ insight, generated_at: insightRow(place.id)!.generated_at });
}));

// Current/most recent job for a trip — lets a freshly loaded page recover job state without SSE.
api.get("/trips/:id/plan-job", wrap((req, res) => {
  assertTripAccess(req.user.id, Number(req.params.id));
  res.json(latestJob(Number(req.params.id)));
}));

// Server-Sent Events: pushes plan_jobs updates for one trip as they happen. Sends the current job
// state immediately on connect so a client never has to guess whether it missed something.
api.get("/trips/:id/events", (req: any, res) => {
  const tripId = Number(req.params.id);
  try {
    assertTripAccess(req.user.id, tripId);
  } catch (e: any) {
    return void res.status(e.status || 500).json({ error: e.message || String(e) });
  }
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // hint reverse proxies (nginx et al.) not to buffer this stream
  });
  (res as any).flushHeaders?.();

  const send = (job: any) => res.write(`event: job\ndata: ${JSON.stringify(job)}\n\n`);
  send(latestJob(tripId));

  if (!jobListeners.has(tripId)) jobListeners.set(tripId, new Set());
  jobListeners.get(tripId)!.add(send);
  const heartbeat = setInterval(() => res.write(":ping\n\n"), 25000);
  req.on("close", () => {
    clearInterval(heartbeat);
    jobListeners.get(tripId)?.delete(send);
  });
});

// ---------- conversation import ----------
api.post("/import/conversation", wrap(async (req, res) => {
  const text: string = req.body.text || "";
  if (text.trim().length < 50) {
    throw Object.assign(new Error("Paste the full conversation text (got almost nothing)"), { status: 400 });
  }
  const p = importPrompt(text.slice(0, 300_000));
  const cfg = loadLlmConfig(req.user);
  const raw = await complete(p.system, p.user, cfg, "import", req.user.id);
  const t = extractJson<any>(raw);
  const roomId = req.body.room_id ? Number(req.body.room_id) : defaultRoomId(req.user.id);
  if (!roomIdsForUser(req.user.id).includes(roomId)) throw Object.assign(new Error("Not a member of that room"), { status: 403 });

  const tx = db.transaction(() => {
    const r = db.prepare(
      `INSERT INTO trips (name, trip_type, start_date, end_date, home_city, budget, currency, notes, room_id)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).run(
      t.name || "Imported trip", t.trip_type || "round", t.start_date ?? null, t.end_date ?? null,
      t.home_city ?? "", t.budget ?? null, t.currency ?? "USD", t.notes ?? "", roomId
    );
    const tripId = Number(r.lastInsertRowid);
    const legIdByCity = new Map<string, number>();
    (t.legs || []).forEach((l: any, i: number) => {
      const lr = db.prepare(
        `INSERT INTO legs (trip_id, seq, city, country, arrive_date, arrive_time, depart_date, depart_time, lat, lng)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      ).run(
        tripId, i, l.city || `Leg ${i + 1}`, l.country || "",
        l.arrive_date ?? null, hhmm(l.arrive_time), l.depart_date ?? null, hhmm(l.depart_time),
        l.lat ?? null, l.lng ?? null
      );
      legIdByCity.set((l.city || "").toLowerCase(), Number(lr.lastInsertRowid));
    });
    for (const pl of t.places || []) {
      db.prepare(
        `INSERT INTO places (trip_id, leg_id, name, category, lat, lng, duration_min, priority, notes, source) VALUES (?,?,?,?,?,?,?,?,?,'ai')`
      ).run(
        tripId, legIdByCity.get((pl.city || "").toLowerCase()) ?? null, pl.name || "Unnamed",
        pl.category || "sight", pl.lat ?? null, pl.lng ?? null, pl.duration_min ?? 90,
        pl.priority || "want", pl.notes ?? ""
      );
    }
    for (const td of t.todos || []) {
      db.prepare(`INSERT INTO todos (trip_id, text, category, due_date, source) VALUES (?,?,?,?,'ai')`)
        .run(tripId, td.text || "?", td.category || "general", td.due_date ?? null);
    }
    for (const bk of t.bookings || []) {
      db.prepare(
        `INSERT INTO bookings (trip_id, leg_id, kind, title, date, end_date, cost, notes, source) VALUES (?,?,?,?,?,?,?,?,'ai')`
      ).run(
        tripId, legIdByCity.get((bk.city || "").toLowerCase()) ?? null, bk.kind || "other",
        bk.title || "?", bk.date ?? null, bk.end_date ?? null, bk.cost ?? null, bk.notes ?? ""
      );
    }
    return tripId;
  });
  const tripId = tx();
  res.json({ trip_id: tripId });
}));

// ---------- adding to a trip that already exists, in prose ----------
// Two steps on purpose. The LLM call only ever *proposes* — it reads the trip, works out what the
// text adds that isn't there yet, and hands back a list. Applying it is a second, plain request
// carrying exactly what the user ticked, so nothing lands in a trip without being seen first.

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();

/** Trip fields an import may fill in. It fills blanks — it never corrects what you chose. */
const TRIP_FILLABLE = ["name", "trip_type", "start_date", "end_date", "home_city", "budget", "currency"];

/**
 * Whether a trip field still holds nothing the user actually chose. Three of these arrive with a
 * value the schema (or the New-trip prompt) put there, not the traveller: a trip called "Imported
 * trip", priced in USD and typed "round" has answered none of those questions. Treating them as
 * set would mean a Portugal trip could never be offered EUR — the proposal would list it and then
 * silently drop it, which is worse than not offering it at all.
 */
function isUnsetTripField(field: string, value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;
  if (field === "name") return /^(imported trip|new trip)$/i.test(String(value).trim());
  if (field === "currency") return String(value).toUpperCase() === "USD";
  if (field === "trip_type") return String(value) === "round";
  if (field === "budget") return Number(value) === 0;
  return false;
}

api.post("/trips/:id/import/preview", wrap(async (req, res) => {
  const tripId = Number(req.params.id);
  assertTripWrite(req.user.id, tripId);
  const text: string = req.body.text || "";
  if (text.trim().length < 15) {
    throw Object.assign(new Error("Tell it a bit more than that — a sentence or two at least."), { status: 400 });
  }
  const b = getBundle(tripId);
  const p = mergePrompt(b, text.slice(0, 300_000));
  const raw = await complete(p.system, p.user, loadLlmConfig(req.user), "import", req.user.id);
  const out = extractJson<any>(raw);

  // The model is told not to repeat what's already there; this is the check that it didn't.
  // Anything already present comes back flagged rather than filtered, so the user sees the
  // whole of what was understood and decides.
  const legByCity = new Map((b.legs as any[]).map((l) => [norm(l.city), l]));
  const placeNames = new Set((b.places as any[]).map((p2) => norm(p2.name)));
  const todoTexts = new Set((db.prepare("SELECT text FROM todos WHERE trip_id = ?").all(tripId) as any[]).map((t) => norm(t.text)));
  const bookingKeys = new Set((b.bookings as any[]).map((bk) => `${norm(bk.title)}|${bk.date || ""}`));

  const legs = (out.legs || []).map((l: any) => {
    const match = legByCity.get(norm(l.city));
    return { ...l, arrive_time: hhmm(l.arrive_time), depart_time: hhmm(l.depart_time), exists: !!match, leg_id: match?.id ?? null };
  });
  const places = (out.places || []).map((p2: any) => ({ ...p2, exists: placeNames.has(norm(p2.name)) }));
  const todos = (out.todos || []).map((t: any) => ({ ...t, exists: todoTexts.has(norm(t.text)) }));
  const bookings = (out.bookings || []).map((bk: any) => ({ ...bk, exists: bookingKeys.has(`${norm(bk.title)}|${bk.date || ""}`) }));

  // Trip-level values are only ever offered for fields the trip hasn't got yet — filling blanks,
  // never correcting the user. Enforced again on apply, so a stale preview can't overwrite either.
  const trip: any = b.trip;
  const tripFields: Record<string, any> = {};
  for (const f of TRIP_FILLABLE) {
    const v = (out.trip || {})[f];
    if (v === null || v === undefined || v === "") continue;
    if (isUnsetTripField(f, trip[f])) tripFields[f] = v;
  }

  res.json({
    summary: out.summary || "",
    trip: tripFields,
    legs, places, todos, bookings,
    notes: out.notes || "",
  });
}));

api.post("/trips/:id/import/apply", wrap((req, res) => {
  const tripId = Number(req.params.id);
  assertTripWrite(req.user.id, tripId);
  const body = req.body || {};
  const trip: any = db.prepare("SELECT * FROM trips WHERE id = ?").get(tripId);
  if (!trip) throw Object.assign(new Error("Trip not found"), { status: 404 });

  const added = { legs: 0, places: 0, todos: 0, bookings: 0 };

  const tx = db.transaction(() => {
    const cols: string[] = [];
    const vals: any[] = [];
    for (const f of TRIP_FILLABLE) {
      const v = body.trip?.[f];
      if (v === null || v === undefined || v === "") continue;
      // Same rule as the preview, re-checked against the trip as it is right now — a preview
      // left open while the trip was edited elsewhere must not overwrite the newer value.
      if (!isUnsetTripField(f, trip[f])) continue;
      cols.push(f);
      vals.push(v);
    }
    if (cols.length) {
      db.prepare(`UPDATE trips SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`).run(...vals, tripId);
    }
    if (body.notes) {
      const merged = [trip.notes, String(body.notes)].filter(Boolean).join("\n\n");
      db.prepare("UPDATE trips SET notes = ? WHERE id = ?").run(merged, tripId);
    }

    // Legs first: places and bookings below resolve their city against the finished set, so a
    // place can attach to a city that only exists because this same apply just created it.
    let seq = (db.prepare("SELECT COALESCE(MAX(seq), -1) AS m FROM legs WHERE trip_id = ?").get(tripId) as { m: number }).m;
    for (const l of body.legs || []) {
      db.prepare(
        `INSERT INTO legs (trip_id, seq, city, country, arrive_date, arrive_time, depart_date, depart_time, lat, lng)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      ).run(
        tripId, ++seq, l.city || "New city", l.country || "", l.arrive_date ?? null, hhmm(l.arrive_time),
        l.depart_date ?? null, hhmm(l.depart_time), l.lat ?? null, l.lng ?? null
      );
      added.legs++;
    }
    const legIdByCity = new Map(
      (db.prepare("SELECT id, city FROM legs WHERE trip_id = ?").all(tripId) as any[]).map((l) => [norm(l.city), l.id])
    );

    for (const p of body.places || []) {
      db.prepare(
        `INSERT INTO places (trip_id, leg_id, name, category, lat, lng, duration_min, priority, notes, source)
         VALUES (?,?,?,?,?,?,?,?,?,'ai')`
      ).run(
        tripId, p.leg_id ?? p.existing_leg_id ?? legIdByCity.get(norm(p.city)) ?? null, p.name || "Unnamed",
        p.category || "sight", p.lat ?? null, p.lng ?? null, p.duration_min ?? 90, p.priority || "want", p.notes ?? ""
      );
      added.places++;
    }
    for (const t of body.todos || []) {
      db.prepare(`INSERT INTO todos (trip_id, text, category, due_date, source) VALUES (?,?,?,?,'ai')`)
        .run(tripId, t.text || "?", t.category || "general", t.due_date ?? null);
      added.todos++;
    }
    for (const bk of body.bookings || []) {
      db.prepare(
        `INSERT INTO bookings (trip_id, leg_id, kind, title, ref, date, end_date, cost, currency, notes, source)
         VALUES (?,?,?,?,?,?,?,?,?,?,'ai')`
      ).run(
        tripId, legIdByCity.get(norm(bk.city)) ?? null, bk.kind || "other", bk.title || "?", bk.ref ?? "",
        bk.date ?? null, bk.end_date ?? null, bk.cost ?? null, bk.currency || trip.currency || "USD", bk.notes ?? ""
      );
      added.bookings++;
    }
  });
  tx();
  bumpPlanVersion(tripId);
  res.json({ added });
}));

// ---------- Google Places (English search + photos) ----------
// The Maps key can come from Settings (DB) or the GOOGLE_MAPS_API_KEY env var (docker-compose).
function effectiveGmapsKey(): string | null {
  return getSetting("google_maps_api_key") || process.env.GOOGLE_MAPS_API_KEY || null;
}

function gmapsKey(): string {
  const key = effectiveGmapsKey();
  if (!key) throw Object.assign(new Error("No Google Maps API key configured (Settings or GOOGLE_MAPS_API_KEY env var)"), { status: 400 });
  return key;
}

type GPlace = {
  place_id: string; name: string; address: string;
  lat: number | null; lng: number | null; photo_ref: string;
};

async function gplacesSearch(query: string, key: string): Promise<GPlace[]> {
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.photos",
    },
    body: JSON.stringify({ textQuery: query, languageCode: "en", maxResultCount: 5 }),
  });
  const text = await res.text();
  if (!res.ok) throw Object.assign(new Error(`Google Places error (${res.status}): ${text.slice(0, 300)}`), { status: 502 });
  const data: any = JSON.parse(text);
  return (data.places || []).map((p: any) => ({
    place_id: p.id,
    name: p.displayName?.text || "",
    address: p.formattedAddress || "",
    lat: p.location?.latitude ?? null,
    lng: p.location?.longitude ?? null,
    photo_ref: p.photos?.[0]?.name || "",
  }));
}

api.get("/gplaces/search", wrap(async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) throw Object.assign(new Error("q is required"), { status: 400 });
  res.json(await gplacesSearch(q, gmapsKey()));
}));

api.get("/places/:id/photo", wrap(async (req, res) => {
  const p: any = db.prepare("SELECT * FROM places WHERE id = ?").get(Number(req.params.id));
  if (!p) throw Object.assign(new Error("Place not found"), { status: 404 });
  assertTripAccess(req.user.id, p.trip_id);
  if (!p.photo_ref) throw Object.assign(new Error("No photo for this place"), { status: 404 });

  const cached = findCachedPhoto(p.photo_ref);
  if (cached) {
    res.set("content-type", mimeForPath(cached));
    res.set("cache-control", "public, max-age=31536000, immutable");
    return void res.send(fs.readFileSync(cached));
  }

  const r = await fetch(
    `https://places.googleapis.com/v1/${p.photo_ref}/media?maxWidthPx=640&key=${encodeURIComponent(gmapsKey())}`
  );
  if (!r.ok) throw Object.assign(new Error(`Photo fetch failed (${r.status})`), { status: 502 });
  const contentType = r.headers.get("content-type") || "image/jpeg";
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(photoWritePath(p.photo_ref, contentType), buf);

  res.set("content-type", contentType);
  res.set("cache-control", "public, max-age=31536000, immutable");
  res.send(buf);
}));

// Look up photos (and missing coordinates) for every place that doesn't have one yet.
api.post("/trips/:id/fetch-photos", wrap(async (req, res) => {
  assertTripWrite(req.user.id, Number(req.params.id));
  const key = gmapsKey();
  const b = getBundle(Number(req.params.id));
  const legCity = new Map(b.legs.map((l: any) => [l.id, l.city]));
  let updated = 0;
  for (const p of b.places as any[]) {
    if (p.photo_ref) continue;
    const city = legCity.get(p.leg_id) || "";
    try {
      const results = await gplacesSearch(city ? `${p.name}, ${city}` : p.name, key);
      const hit = results[0];
      if (!hit) continue;
      db.prepare(
        `UPDATE places SET google_place_id = ?, photo_ref = ?,
           lat = COALESCE(lat, ?), lng = COALESCE(lng, ?) WHERE id = ?`
      ).run(hit.place_id, hit.photo_ref, hit.lat, hit.lng, p.id);
      updated++;
    } catch {
      /* skip places Google can't find */
    }
  }
  res.json({ updated });
}));

// ---------- Import from a Google Maps "Saved" list (via Google Takeout export) ----------
// Google has no live API for a user's starred/saved-places lists — the only way out is a
// manual Takeout export (takeout.google.com → "Saved" → download → open the list's .json file
// under Takeout/Saved/). Each list exports as a GeoJSON-ish FeatureCollection; we parse it
// defensively since the exact shape has drifted across Takeout versions.
type ImportCandidate = {
  name: string; address: string; lat: number | null; lng: number | null; gmaps_url: string;
  /** Only the share-link route supplies this — Takeout exports don't carry the pin's own note. */
  note?: string;
};

function parseTakeoutSavedPlaces(raw: any): { items: ImportCandidate[]; skipped: number } {
  const features = Array.isArray(raw?.features) ? raw.features : [];
  const items: ImportCandidate[] = [];
  let skipped = 0;
  for (const f of features) {
    const props = f?.properties || {};
    const loc = props.location || {};
    const name: string = loc.name || loc.address || props.google_maps_url || "";
    if (!name) { skipped++; continue; }
    const coords = f?.geometry?.coordinates;
    const lng = Array.isArray(coords) ? Number(coords[0]) : null;
    const lat = Array.isArray(coords) ? Number(coords[1]) : null;
    items.push({
      name,
      address: loc.address || "",
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
      gmaps_url: props.google_maps_url || "",
    });
  }
  return { items, skipped };
}

api.post(`/trips/:id/places/import-preview`, wrap((req, res) => {
  const tripId = Number(req.params.id);
  assertTripAccess(req.user.id, tripId);
  let raw: any;
  try {
    raw = typeof req.body.data === "string" ? JSON.parse(req.body.data) : req.body.data;
  } catch {
    throw Object.assign(new Error("That doesn't look like valid JSON — export the list from Google Takeout and upload the .json file as-is."), { status: 400 });
  }
  const { items, skipped } = parseTakeoutSavedPlaces(raw);
  if (items.length === 0) throw Object.assign(new Error("No places found in that file — make sure it's a Takeout \"Saved\" list export."), { status: 400 });
  const existing = new Set(
    db.prepare("SELECT name FROM places WHERE trip_id = ?").all(tripId).map((p: any) => String(p.name).trim().toLowerCase())
  );
  res.json({
    items: items.map((it) => ({ ...it, exists: existing.has(it.name.trim().toLowerCase()) })),
    skipped,
  });
}));

// Same preview, from a shared-list link instead of a Takeout file. Both hand the identical
// candidate shape to /places/import, so there is only ever one path that writes.
api.post(`/trips/:id/places/import-link`, wrap(async (req, res) => {
  const tripId = Number(req.params.id);
  assertTripWrite(req.user.id, tripId);
  const url = String(req.body.url || "").trim();
  if (!url) throw Object.assign(new Error("Paste the share link for the list"), { status: 400 });

  const { listName, items, skipped } = await fetchSharedList(url);
  if (items.length === 0) {
    throw Object.assign(new Error("That list has no places in it."), { status: 400 });
  }
  const existing = new Set(
    db.prepare("SELECT name FROM places WHERE trip_id = ?").all(tripId).map((p: any) => String(p.name).trim().toLowerCase())
  );
  res.json({
    list_name: listName,
    items: items.map((it) => ({ ...it, exists: existing.has(it.name.trim().toLowerCase()) })),
    skipped,
  });
}));

// ---------- tagging places with the city they belong to ----------
// A place's leg is what decides which day-range it can be scheduled in, so an untagged place is
// one the planner can't place. Coordinates are the only signal that doesn't need the user: the
// nearest located city wins. It's straight-line distance and it says so — a suggestion made in
// one click and corrected on the card, not a guess presented as fact.
type LegPoint = { id: number; lat: number | null; lng: number | null };

function nearestLegId(legs: LegPoint[], lat: number | null, lng: number | null): number | null {
  if (lat == null || lng == null) return null;
  let best: { id: number; d: number } | null = null;
  for (const l of legs) {
    if (l.lat == null || l.lng == null) continue;
    const d = (l.lat - lat) ** 2 + (l.lng - lng) ** 2;
    if (!best || d < best.d) best = { id: l.id, d };
  }
  return best?.id ?? null;
}

api.post(`/trips/:id/places/assign-legs`, wrap((req, res) => {
  const tripId = Number(req.params.id);
  assertTripWrite(req.user.id, tripId);
  const legs = db.prepare("SELECT id, lat, lng FROM legs WHERE trip_id = ?").all(tripId) as LegPoint[];

  // Default target is everything not tagged yet — the case that actually hurts after an import.
  const ids: number[] = Array.isArray(req.body.place_ids) ? req.body.place_ids.map(Number) : [];
  const targets = (ids.length
    ? db.prepare(
        `SELECT id, lat, lng FROM places WHERE trip_id = ? AND id IN (${ids.map(() => "?").join(",")})`
      ).all(tripId, ...ids)
    : db.prepare("SELECT id, lat, lng FROM places WHERE trip_id = ? AND leg_id IS NULL").all(tripId)) as
    { id: number; lat: number | null; lng: number | null }[];

  const auto = req.body.mode === "auto";
  const explicit = req.body.leg_id === null || req.body.leg_id === undefined ? null : Number(req.body.leg_id);
  if (!auto && explicit !== null && !legs.some((l) => l.id === explicit)) {
    throw Object.assign(new Error("That city isn't part of this trip"), { status: 400 });
  }

  const update = db.prepare("UPDATE places SET leg_id = ? WHERE id = ?");
  let assigned = 0;
  let skipped = 0;
  db.transaction(() => {
    for (const p of targets) {
      const legId = auto ? nearestLegId(legs, p.lat, p.lng) : explicit;
      // In auto mode a place with no coordinates (or a trip with no located cities) is left
      // alone rather than dumped into whichever city happens to be first.
      if (auto && legId == null) { skipped++; continue; }
      update.run(legId, p.id);
      assigned++;
    }
  })();
  if (assigned) bumpPlanVersion(tripId);
  res.json({ assigned, skipped, located_legs: legs.filter((l) => l.lat != null && l.lng != null).length });
}));

api.post(`/trips/:id/places/import`, wrap((req, res) => {
  const tripId = Number(req.params.id);
  assertTripWrite(req.user.id, tripId);
  const items: ImportCandidate[] = Array.isArray(req.body.items) ? req.body.items : [];
  const category = typeof req.body.category === "string" ? req.body.category : "other";
  if (items.length === 0) throw Object.assign(new Error("No places selected"), { status: 400 });

  // An import used to land everything untagged, which is the worst possible starting point for a
  // 97-place list. "auto" tags each one with its nearest located city as it goes; an explicit id
  // puts the whole batch in one city; null keeps the old behaviour.
  const legs = db.prepare("SELECT id, lat, lng FROM legs WHERE trip_id = ?").all(tripId) as LegPoint[];
  const auto = req.body.leg_id === "auto";
  const explicitLeg = auto || req.body.leg_id == null ? null : Number(req.body.leg_id);
  if (explicitLeg !== null && !legs.some((l) => l.id === explicitLeg)) {
    throw Object.assign(new Error("That city isn't part of this trip"), { status: 400 });
  }

  const insert = db.prepare(
    `INSERT INTO places (trip_id, leg_id, name, category, lat, lng, duration_min, priority, notes, gmaps_url, status, source)
     VALUES (?, ?, ?, ?, ?, ?, 90, 'want', ?, ?, 'active', 'import')`
  );
  const tx = db.transaction((rows: ImportCandidate[]) => {
    for (const it of rows) {
      // A candidate that carries a `note` field at all came from the share link, and its note is
      // authoritative even when empty — the address there restates the name and is already
      // covered by the coordinates and the Maps link. Takeout candidates have no note field, so
      // they keep the address as the stand-in they always had.
      const notes = typeof it.note === "string" ? it.note : (it.address || "");
      const legId = auto ? nearestLegId(legs, it.lat, it.lng) : explicitLeg;
      insert.run(tripId, legId, it.name, category, it.lat, it.lng, notes, it.gmaps_url || "");
    }
  });
  tx(items);
  bumpPlanVersion(tripId);
  res.json({ imported: items.length });
}));

// ---------- FX rates (free ECB-style feed, cached 12h in the settings table) ----------
api.get("/fx/:base", wrap(async (req, res) => {
  const base = String(req.params.base).toUpperCase();
  if (!/^[A-Z]{3}$/.test(base)) throw Object.assign(new Error("base must be a 3-letter currency code"), { status: 400 });
  const cacheKey = `fx_${base}`;
  const cached = getSetting(cacheKey);
  if (cached) {
    try {
      const c = JSON.parse(cached);
      if (Date.now() - c.ts < 12 * 3600 * 1000) return res.json({ base, rates: c.rates, cached: true });
    } catch { /* refetch */ }
  }
  const r = await fetch(`https://open.er-api.com/v6/latest/${base}`);
  const data: any = await r.json().catch(() => ({}));
  if (data.result !== "success" || !data.rates) {
    throw Object.assign(new Error(`FX rates unavailable (${r.status})`), { status: 502 });
  }
  setSetting(cacheKey, JSON.stringify({ ts: Date.now(), rates: data.rates }));
  res.json({ base, rates: data.rates });
}));

// ---------- settings (admin-only: global config) ----------
const SETTING_KEYS = ["google_maps_api_key"];

api.get("/settings", requireAdmin, wrap((_req, res) => {
  const out: Record<string, string | null> = {};
  for (const k of SETTING_KEYS) out[k] = getSetting(k);
  const source = out.google_maps_api_key ? "db" : process.env.GOOGLE_MAPS_API_KEY ? "env" : null;
  out.google_maps_api_key = effectiveGmapsKey();
  res.json({ ...out, google_maps_key_source: source });
}));

api.put("/settings", requireAdmin, wrap((req, res) => {
  for (const k of SETTING_KEYS) {
    if (k in req.body && req.body[k] != null) setSetting(k, String(req.body[k]));
  }
  res.json({ ok: true });
}));

// Any authenticated user needs the effective Google Maps key for the map/places-autocomplete —
// that's global config, but reading it isn't admin-only the way editing it is.
api.get("/app-config", wrap((_req, res) => {
  const key = effectiveGmapsKey();
  res.json({ google_maps_api_key: key, google_maps_key_source: getSetting("google_maps_api_key") ? "db" : process.env.GOOGLE_MAPS_API_KEY ? "env" : null });
}));

api.get("/llm/defaults", wrap((_req, res) => {
  res.json({ default_models: DEFAULT_MODELS, default_plan_system_prompt: DEFAULT_PLAN_SYSTEM_PROMPT });
}));

// ---------- profile (per-user: LLM connection, budget, plan prompt, money) ----------
const PROFILE_FIELDS = [
  "llm_provider", "llm_api_key", "llm_model", "llm_price_in", "llm_price_out",
  "llm_monthly_budget", "plan_system_prompt", "home_currency", "auto_replan",
];

api.put("/profile", wrap((req, res) => {
  const cols = PROFILE_FIELDS.filter((f) =>
    f in req.body && req.body[f] != null && !(f === "llm_api_key" && String(req.body[f]).startsWith("saved:"))
  );
  const values = cols.map((c) => String(req.body[c]));

  // The display name isn't just a label: room invites accept it in place of an email, so two
  // accounts sharing one would make an invite a coin flip. Validated here rather than folded
  // into PROFILE_FIELDS, which writes whatever it is given.
  if ("display_name" in req.body) {
    const name = String(req.body.display_name ?? "").trim();
    if (!name) throw Object.assign(new Error("Display name can't be empty"), { status: 400 });
    if (name.length > 40) throw Object.assign(new Error("Display name is limited to 40 characters"), { status: 400 });
    const taken = db.prepare(
      "SELECT id FROM users WHERE LOWER(display_name) = LOWER(?) AND id != ?"
    ).get(name, req.user.id);
    if (taken) throw Object.assign(new Error("Someone else already uses that name — pick another"), { status: 409 });
    cols.push("display_name");
    values.push(name);
  }

  if (cols.length) {
    db.prepare(`UPDATE users SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`)
      .run(...values, req.user.id);
  }
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  res.json({ user: safeUser(user as any) });
}));

// List chat models available to the given (or saved) key, for the Profile dropdown.
api.post("/llm/models", wrap(async (req, res) => {
  const provider = (req.body.provider || req.user.llm_provider || "anthropic") as any;
  let key = String(req.body.api_key || "");
  if (!key || key.startsWith("saved:")) key = req.user.llm_api_key || "";
  if (!key) throw Object.assign(new Error("Enter an API key first, then load the model list"), { status: 400 });
  res.json({ models: await listModels(provider, key) });
}));

api.post("/settings/test", wrap(async (req, res) => {
  const cfg = loadLlmConfig(req.user);
  // For Gemini, validate the key and model name first — its errors are otherwise cryptic.
  if (cfg.provider === "gemini") {
    const r = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models?pageSize=50",
      { headers: { "x-goog-api-key": cfg.apiKey } }
    );
    const body = await r.text();
    if (!r.ok) {
      throw Object.assign(
        new Error(`Gemini rejected the API key (${r.status}). Get a key from https://aistudio.google.com/apikey — a Google *Maps* key will not work. Details: ${body.slice(0, 300)}`),
        { status: 502 }
      );
    }
    const models: string[] = (JSON.parse(body).models || []).map((m: any) => String(m.name).replace(/^models\//, ""));
    const wanted = cfg.model.replace(/^models\//, "");
    if (models.length && !models.includes(wanted)) {
      const suggestions = models.filter((m) => m.startsWith("gemini")).slice(0, 8).join(", ");
      throw Object.assign(
        new Error(`Model "${wanted}" is not available for this key. Try one of: ${suggestions}`),
        { status: 400 }
      );
    }
  }
  const reply = await complete("Reply with exactly: OK", "ping", cfg, "test", req.user.id);
  res.json({ ok: true, model: cfg.model, reply: reply.trim().slice(0, 100) });
}));

// Ask the provider itself about the key's budget/spend. Only OpenRouter exposes this.
api.get("/llm/provider-plan", wrap(async (req, res) => {
  const provider = req.user.llm_provider || "anthropic";
  const key = req.user.llm_api_key || "";
  if (!key) throw Object.assign(new Error("Save an API key first"), { status: 400 });
  if (provider !== "openrouter") {
    throw Object.assign(
      new Error("Only OpenRouter exposes billing via its API. For other providers check their billing console (or use the manual $/1M fields below)."),
      { status: 400 }
    );
  }
  const auth = { authorization: `Bearer ${key}` };
  const keyRes = await fetch("https://openrouter.ai/api/v1/key", { headers: auth });
  const keyText = await keyRes.text();
  if (!keyRes.ok) {
    throw Object.assign(new Error(`OpenRouter rejected the key (${keyRes.status}): ${keyText.slice(0, 200)}`), { status: 502 });
  }
  const k = JSON.parse(keyText).data || {};
  // Account-level credits; may be unavailable for some key types — tolerate failure.
  let credits: { total_credits: number; total_usage: number } | null = null;
  try {
    const credRes = await fetch("https://openrouter.ai/api/v1/credits", { headers: auth });
    if (credRes.ok) credits = ((await credRes.json()) as any).data ?? null;
  } catch { /* optional */ }
  res.json({
    label: k.label ?? "",
    is_free_tier: !!k.is_free_tier,
    key_usage_usd: k.usage ?? 0,
    key_limit_usd: k.limit ?? null,
    key_remaining_usd: k.limit != null ? Math.max(0, k.limit - (k.usage ?? 0)) : null,
    account_credits_usd: credits?.total_credits ?? null,
    account_usage_usd: credits?.total_usage ?? null,
  });
}));

// ---------- LLM usage / billing (per user) ----------
api.get("/llm/usage", wrap((req, res) => {
  const days = db.prepare(
    `SELECT substr(ts, 1, 10) AS day, SUM(input_tokens) AS input_tokens,
            SUM(output_tokens) AS output_tokens, COUNT(*) AS calls
     FROM llm_usage WHERE user_id = ? AND ts >= datetime('now', '-30 days')
     GROUP BY day ORDER BY day`
  ).all(req.user.id);
  const month = db.prepare(
    `SELECT COALESCE(SUM(input_tokens), 0) AS input_tokens,
            COALESCE(SUM(output_tokens), 0) AS output_tokens, COUNT(*) AS calls
     FROM llm_usage WHERE user_id = ? AND ts >= date('now', 'start of month')`
  ).get(req.user.id);
  const totals = db.prepare(
    `SELECT COALESCE(SUM(input_tokens), 0) AS input_tokens,
            COALESCE(SUM(output_tokens), 0) AS output_tokens, COUNT(*) AS calls
     FROM llm_usage WHERE user_id = ?`
  ).get(req.user.id);
  const recent = db.prepare(`SELECT * FROM llm_usage WHERE user_id = ? ORDER BY id DESC LIMIT 12`).all(req.user.id);
  res.json({ days, month, totals, recent });
}));
