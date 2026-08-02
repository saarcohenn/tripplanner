import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, "tripplanner.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS trips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  trip_type TEXT NOT NULL DEFAULT 'round',        -- oneway | round | multicity
  start_date TEXT,
  end_date TEXT,
  home_city TEXT,
  budget REAL,
  currency TEXT DEFAULT 'USD',
  notes TEXT DEFAULT '',
  plan_version INTEGER NOT NULL DEFAULT 0,        -- bumped on any change that affects the plan
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS legs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL DEFAULT 0,
  city TEXT NOT NULL,
  country TEXT DEFAULT '',
  arrive_date TEXT,
  depart_date TEXT,
  lat REAL,
  lng REAL,
  notes TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS places (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  leg_id INTEGER REFERENCES legs(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  category TEXT DEFAULT 'sight',                  -- sight | food | nature | museum | shopping | nightlife | other
  lat REAL,
  lng REAL,
  duration_min INTEGER DEFAULT 90,
  priority TEXT DEFAULT 'want',                   -- must | want | maybe
  status TEXT DEFAULT 'active',                   -- active | dropped
  notes TEXT DEFAULT '',
  gmaps_url TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS todos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  category TEXT DEFAULT 'general',                -- general | booking | documents | packing | money
  due_date TEXT,
  done INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  leg_id INTEGER REFERENCES legs(id) ON DELETE SET NULL,
  kind TEXT DEFAULT 'stay',                       -- flight | stay | train | bus | ferry | car | activity | other
  title TEXT NOT NULL,
  ref TEXT DEFAULT '',
  url TEXT DEFAULT '',
  date TEXT,
  end_date TEXT,
  cost REAL,
  currency TEXT DEFAULT 'USD',
  notes TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  plan_version INTEGER NOT NULL,                  -- trips.plan_version this plan was generated from
  plan_json TEXT NOT NULL,
  advisor_json TEXT,
  generated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  leg_id INTEGER REFERENCES legs(id) ON DELETE SET NULL,
  category TEXT DEFAULT 'other',                  -- food | transport | lodging | activities | shopping | other
  title TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT DEFAULT 'USD',
  date TEXT,
  notes TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS llm_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  provider TEXT,
  model TEXT,
  purpose TEXT,                                   -- plan | advisor | import | test | other
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0
);

-- Plan/advisor generation runs in the background (LLM calls can take minutes); this row is how the
-- HTTP layer reports progress back to clients without blocking the request that kicked it off.
CREATE TABLE IF NOT EXISTS plan_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'plan',              -- plan | advisor
  status TEXT NOT NULL DEFAULT 'running',         -- running | done | error
  error TEXT,
  plan_id INTEGER,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'user',              -- admin | user
  status TEXT NOT NULL DEFAULT 'pending',         -- pending | approved | rejected
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS room_members (
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'editor',  -- owner | editor | viewer
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (room_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_room_members_user ON room_members(user_id);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  read_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
`);

// A job still marked "running" from before this process started can never finish — its in-memory
// promise is gone with the old process. Surface that instead of leaving clients waiting forever.
db.prepare(
  `UPDATE plan_jobs SET status = 'error', error = 'Server restarted during generation', finished_at = datetime('now')
   WHERE status = 'running'`
).run();

// Additive migrations for databases created by older versions.
function addColumn(table: string, ddl: string) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  } catch {
    /* column already exists */
  }
}
addColumn("trips", "stage TEXT NOT NULL DEFAULT 'collect'"); // collect | planned
addColumn("places", "google_place_id TEXT DEFAULT ''");
addColumn("places", "photo_ref TEXT DEFAULT ''");
// Whether a row was typed by the user or extracted by the LLM (conversation import).
addColumn("places", "source TEXT DEFAULT 'user'");
addColumn("todos", "source TEXT DEFAULT 'user'");
addColumn("bookings", "source TEXT DEFAULT 'user'");
addColumn("users", "llm_provider TEXT");
addColumn("users", "llm_api_key TEXT");
addColumn("users", "llm_model TEXT");
addColumn("users", "llm_price_in TEXT");
addColumn("users", "llm_price_out TEXT");
addColumn("users", "llm_monthly_budget TEXT");
addColumn("users", "plan_system_prompt TEXT");
addColumn("users", "home_currency TEXT DEFAULT 'USD'");
addColumn("users", "auto_replan TEXT DEFAULT '0'");
addColumn("llm_usage", "user_id INTEGER REFERENCES users(id)");
addColumn("trips", "room_id INTEGER REFERENCES rooms(id)");
// IATA codes for the boarding-pass view. The app only ever shows a code it was given or can
// look up in its curated city list — never one derived from the city's spelling — so these
// let you supply the ones it doesn't know instead of it inventing something plausible.
addColumn("legs", "airport TEXT DEFAULT ''");
addColumn("trips", "home_airport TEXT DEFAULT ''");

// Rooms used to have only 'owner'/'member' roles; 'member' is now split into 'editor'/'viewer'.
// Existing non-owner members keep the edit rights they already had rather than being silently
// downgraded to read-only.
db.prepare("UPDATE room_members SET role = 'editor' WHERE role = 'member'").run();

// Safety-net migration (idempotent, runs every boot): every approved user should have a personal
// room. New users normally get one the moment they're approved (see ensurePersonalRoom in
// rooms.ts), but any approved user still missing one — most importantly whoever was already an
// admin before rooms existed — gets one created here. Pre-existing trips (from the single-tenant
// era, room_id still NULL) are assigned to the first admin's room so upgrading an existing install
// doesn't hide the trips that were already there.
{
  const approved = db.prepare("SELECT id, display_name, email FROM users WHERE status = 'approved'").all() as
    { id: number; display_name: string; email: string }[];
  for (const u of approved) {
    const already = db.prepare("SELECT id FROM rooms WHERE owner_id = ?").get(u.id) as { id: number } | undefined;
    if (already) continue;
    const label = u.display_name || u.email;
    const r = db.prepare("INSERT INTO rooms (name, owner_id) VALUES (?, ?)").run(`${label}'s trips`, u.id);
    db.prepare("INSERT INTO room_members (room_id, user_id, role) VALUES (?, ?, 'owner')").run(r.lastInsertRowid, u.id);
  }
  const firstAdminRoom = db.prepare(
    `SELECT r.id FROM rooms r JOIN users u ON u.id = r.owner_id WHERE u.role = 'admin' ORDER BY r.id LIMIT 1`
  ).get() as { id: number } | undefined;
  if (firstAdminRoom) {
    db.prepare("UPDATE trips SET room_id = ? WHERE room_id IS NULL").run(firstAdminRoom.id);
  }
}

// One-time migration: the LLM connection, budget and plan-prompt settings used to live in the
// global `settings` table (single-tenant era) — now they're per-user (Profile page). Copy the old
// global values onto whichever admin account(s) already exist, and attribute pre-existing usage
// history to the first one, so upgrading an existing install doesn't lose that configuration.
if (getSetting("llm_api_key") !== null && getSetting("migrated_user_settings") !== "1") {
  const fields = [
    "llm_provider", "llm_api_key", "llm_model", "llm_price_in", "llm_price_out",
    "llm_monthly_budget", "plan_system_prompt", "home_currency", "auto_replan",
  ];
  const values = fields.map((f) => getSetting(f));
  const admins = db.prepare("SELECT id FROM users WHERE role = 'admin'").all() as { id: number }[];
  const update = db.prepare(`UPDATE users SET ${fields.map((f) => `${f} = ?`).join(", ")} WHERE id = ?`);
  for (const a of admins) update.run(...values, a.id);
  if (admins.length) {
    db.prepare("UPDATE llm_usage SET user_id = ? WHERE user_id IS NULL").run(admins[0].id);
  }
  setSetting("migrated_user_settings", "1");
}

export function bumpPlanVersion(tripId: number) {
  db.prepare(
    "UPDATE trips SET plan_version = plan_version + 1, updated_at = datetime('now') WHERE id = ?"
  ).run(tripId);
}

export function getSetting(key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string) {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, value);
}

export function recordLlmUsage(
  userId: number,
  provider: string,
  model: string,
  purpose: string,
  inputTokens: number,
  outputTokens: number
) {
  db.prepare(
    `INSERT INTO llm_usage (user_id, provider, model, purpose, input_tokens, output_tokens) VALUES (?,?,?,?,?,?)`
  ).run(userId, provider, model, purpose, Math.round(inputTokens || 0), Math.round(outputTokens || 0));
}

/** Seeds a demo trip into `roomId` the first time ever a trips table is completely empty. */
export function seedDemoIfEmpty(roomId: number) {
  const count = (db.prepare("SELECT COUNT(*) AS c FROM trips").get() as { c: number }).c;
  if (count > 0) return;

  const trip = db
    .prepare(
      `INSERT INTO trips (name, trip_type, start_date, end_date, home_city, budget, currency, notes, room_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      "Demo: South Korea & Japan",
      "multicity",
      "2026-10-05",
      "2026-10-25",
      "Tel Aviv",
      6000,
      "USD",
      "Demo trip seeded so the UI is not empty. Replace it by importing your real plan (Import tab) or editing it here.",
      roomId
    );
  const tripId = Number(trip.lastInsertRowid);

  const insLeg = db.prepare(
    `INSERT INTO legs (trip_id, seq, city, country, arrive_date, depart_date, lat, lng) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const seoul = Number(insLeg.run(tripId, 0, "Seoul", "South Korea", "2026-10-05", "2026-10-11", 37.5665, 126.978).lastInsertRowid);
  const busan = Number(insLeg.run(tripId, 1, "Busan", "South Korea", "2026-10-11", "2026-10-14", 35.1796, 129.0756).lastInsertRowid);
  const osaka = Number(insLeg.run(tripId, 2, "Osaka", "Japan", "2026-10-14", "2026-10-18", 34.6937, 135.5023).lastInsertRowid);
  const kyoto = Number(insLeg.run(tripId, 3, "Kyoto", "Japan", "2026-10-18", "2026-10-21", 35.0116, 135.7681).lastInsertRowid);
  const tokyo = Number(insLeg.run(tripId, 4, "Tokyo", "Japan", "2026-10-21", "2026-10-25", 35.6762, 139.6503).lastInsertRowid);

  const insPlace = db.prepare(
    `INSERT INTO places (trip_id, leg_id, name, category, lat, lng, duration_min, priority) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insPlace.run(tripId, seoul, "Gyeongbokgung Palace", "sight", 37.5796, 126.977, 150, "must");
  insPlace.run(tripId, seoul, "Bukchon Hanok Village", "sight", 37.5826, 126.9838, 90, "want");
  insPlace.run(tripId, seoul, "Gwangjang Market", "food", 37.5701, 126.9996, 90, "must");
  insPlace.run(tripId, seoul, "N Seoul Tower", "sight", 37.5512, 126.9882, 120, "maybe");
  insPlace.run(tripId, busan, "Gamcheon Culture Village", "sight", 35.0975, 129.0106, 120, "must");
  insPlace.run(tripId, busan, "Haeundae Beach", "nature", 35.1587, 129.1604, 120, "want");
  insPlace.run(tripId, osaka, "Osaka Castle", "sight", 34.6873, 135.5262, 120, "want");
  insPlace.run(tripId, osaka, "Dotonbori", "food", 34.6687, 135.5013, 120, "must");
  insPlace.run(tripId, kyoto, "Fushimi Inari Taisha", "sight", 34.9671, 135.7727, 180, "must");
  insPlace.run(tripId, kyoto, "Arashiyama Bamboo Grove", "nature", 35.0094, 135.6722, 120, "want");
  insPlace.run(tripId, kyoto, "Kinkaku-ji", "sight", 35.0394, 135.7292, 90, "want");
  insPlace.run(tripId, tokyo, "Shibuya Crossing", "sight", 35.6595, 139.7005, 60, "must");
  insPlace.run(tripId, tokyo, "Senso-ji Temple", "sight", 35.7148, 139.7967, 90, "must");
  insPlace.run(tripId, tokyo, "teamLab Planets", "museum", 35.649, 139.7898, 150, "want");

  const insTodo = db.prepare(
    `INSERT INTO todos (trip_id, text, category, due_date) VALUES (?, ?, ?, ?)`
  );
  insTodo.run(tripId, "Book flight TLV -> Seoul", "booking", "2026-08-01");
  insTodo.run(tripId, "Book Busan -> Osaka flight or ferry", "booking", "2026-08-15");
  insTodo.run(tripId, "Check K-ETA / Japan entry requirements", "documents", "2026-08-01");
  insTodo.run(tripId, "Order travel insurance", "documents", "2026-09-01");
  insTodo.run(tripId, "Get JR Pass / T-money card", "money", "2026-09-15");
}
