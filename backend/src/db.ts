import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), "data");
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

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

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

export function seedDemoIfEmpty() {
  const count = (db.prepare("SELECT COUNT(*) AS c FROM trips").get() as { c: number }).c;
  if (count > 0) return;

  const trip = db
    .prepare(
      `INSERT INTO trips (name, trip_type, start_date, end_date, home_city, budget, currency, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      "Demo: South Korea & Japan",
      "multicity",
      "2026-10-05",
      "2026-10-25",
      "Tel Aviv",
      6000,
      "USD",
      "Demo trip seeded so the UI is not empty. Replace it by importing your real plan (Import tab) or editing it here."
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
