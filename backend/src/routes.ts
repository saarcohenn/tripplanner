import { Router } from "express";
import { db, bumpPlanVersion, getSetting, setSetting, seedDemoIfEmpty } from "./db.js";
import { complete, extractJson, loadLlmConfig, DEFAULT_MODELS } from "./llm.js";
import { planPrompt, advisorPrompt, importPrompt, TripBundle } from "./prompts.js";

export const api = Router();

const wrap =
  (fn: (req: any, res: any) => Promise<void> | void) => async (req: any, res: any) => {
    try {
      await fn(req, res);
    } catch (e: any) {
      res.status(e.status || 500).json({ error: e.message || String(e) });
    }
  };

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

// ---------- trips ----------
api.get("/trips", wrap((_req, res) => {
  seedDemoIfEmpty();
  res.json(db.prepare("SELECT * FROM trips ORDER BY created_at DESC").all());
}));

api.post("/trips", wrap((req, res) => {
  const { name, trip_type = "round", start_date = null, end_date = null, home_city = "", budget = null, currency = "USD", notes = "" } = req.body;
  if (!name) throw Object.assign(new Error("name is required"), { status: 400 });
  const r = db.prepare(
    `INSERT INTO trips (name, trip_type, start_date, end_date, home_city, budget, currency, notes) VALUES (?,?,?,?,?,?,?,?)`
  ).run(name, trip_type, start_date, end_date, home_city, budget, currency, notes);
  res.json(db.prepare("SELECT * FROM trips WHERE id = ?").get(r.lastInsertRowid));
}));

api.get("/trips/:id", wrap((req, res) => {
  const b = getBundle(Number(req.params.id));
  const todos = db.prepare("SELECT * FROM todos WHERE trip_id = ? ORDER BY done, due_date, id").all(req.params.id);
  const expenses = db.prepare("SELECT * FROM expenses WHERE trip_id = ? ORDER BY date, id").all(req.params.id);
  const plan = db.prepare("SELECT * FROM plans WHERE trip_id = ? ORDER BY id DESC LIMIT 1").get(req.params.id);
  res.json({ ...b, todos, expenses, plan: plan ?? null });
}));

api.put("/trips/:id", wrap((req, res) => {
  const id = Number(req.params.id);
  const fields = ["name", "trip_type", "start_date", "end_date", "home_city", "budget", "currency", "notes", "stage"];
  const sets = fields.filter((f) => f in req.body);
  if (sets.length) {
    db.prepare(`UPDATE trips SET ${sets.map((f) => `${f} = ?`).join(", ")} WHERE id = ?`)
      .run(...sets.map((f) => req.body[f]), id);
    bumpPlanVersion(id);
  }
  res.json(db.prepare("SELECT * FROM trips WHERE id = ?").get(id));
}));

api.delete("/trips/:id", wrap((req, res) => {
  db.prepare("DELETE FROM trips WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
}));

// ---------- generic child-collection CRUD (legs, places, todos, bookings) ----------
type ChildSpec = { table: string; fields: string[]; affectsPlan: boolean };
const children: Record<string, ChildSpec> = {
  legs: { table: "legs", fields: ["seq", "city", "country", "arrive_date", "depart_date", "lat", "lng", "notes"], affectsPlan: true },
  places: { table: "places", fields: ["leg_id", "name", "category", "lat", "lng", "duration_min", "priority", "status", "notes", "gmaps_url", "google_place_id", "photo_ref"], affectsPlan: true },
  todos: { table: "todos", fields: ["text", "category", "due_date", "done"], affectsPlan: false },
  expenses: { table: "expenses", fields: ["leg_id", "category", "title", "amount", "currency", "date", "notes"], affectsPlan: false },
  bookings: { table: "bookings", fields: ["leg_id", "kind", "title", "ref", "url", "date", "end_date", "cost", "currency", "notes"], affectsPlan: true },
};

for (const [name, spec] of Object.entries(children)) {
  api.post(`/trips/:tripId/${name}`, wrap((req, res) => {
    const tripId = Number(req.params.tripId);
    const cols = spec.fields.filter((f) => f in req.body);
    const r = db.prepare(
      `INSERT INTO ${spec.table} (trip_id${cols.map((c) => `, ${c}`).join("")}) VALUES (?${", ?".repeat(cols.length)})`
    ).run(tripId, ...cols.map((c) => req.body[c]));
    if (spec.affectsPlan) bumpPlanVersion(tripId);
    res.json(db.prepare(`SELECT * FROM ${spec.table} WHERE id = ?`).get(r.lastInsertRowid));
  }));

  api.put(`/${name}/:id`, wrap((req, res) => {
    const id = Number(req.params.id);
    const row: any = db.prepare(`SELECT * FROM ${spec.table} WHERE id = ?`).get(id);
    if (!row) throw Object.assign(new Error("not found"), { status: 404 });
    const cols = spec.fields.filter((f) => f in req.body);
    if (cols.length) {
      db.prepare(`UPDATE ${spec.table} SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`)
        .run(...cols.map((c) => req.body[c]), id);
      if (spec.affectsPlan) bumpPlanVersion(row.trip_id);
    }
    res.json(db.prepare(`SELECT * FROM ${spec.table} WHERE id = ?`).get(id));
  }));

  api.delete(`/${name}/:id`, wrap((req, res) => {
    const row: any = db.prepare(`SELECT * FROM ${spec.table} WHERE id = ?`).get(Number(req.params.id));
    if (row) {
      db.prepare(`DELETE FROM ${spec.table} WHERE id = ?`).run(row.id);
      if (spec.affectsPlan) bumpPlanVersion(row.trip_id);
    }
    res.json({ ok: true });
  }));
}

// ---------- plan generation + advisor ----------
api.post("/trips/:id/generate-plan", wrap(async (req, res) => {
  const tripId = Number(req.params.id);
  const b = getBundle(tripId);
  const version = (b.trip as any).plan_version;
  const p = planPrompt(b);
  const raw = await complete(p.system, p.user);
  const plan = extractJson(raw);

  const a = advisorPrompt(b, JSON.stringify(plan));
  const advRaw = await complete(a.system, a.user);
  const advisor = extractJson(advRaw);

  const r = db.prepare(
    `INSERT INTO plans (trip_id, plan_version, plan_json, advisor_json) VALUES (?,?,?,?)`
  ).run(tripId, version, JSON.stringify(plan), JSON.stringify(advisor));
  // A generated plan moves the trip into the "planned" (green) stage.
  db.prepare("UPDATE trips SET stage = 'planned' WHERE id = ?").run(tripId);
  res.json(db.prepare("SELECT * FROM plans WHERE id = ?").get(r.lastInsertRowid));
}));

api.post("/trips/:id/advise", wrap(async (req, res) => {
  const tripId = Number(req.params.id);
  const b = getBundle(tripId);
  const plan: any = db.prepare("SELECT * FROM plans WHERE trip_id = ? ORDER BY id DESC LIMIT 1").get(tripId);
  if (!plan) throw Object.assign(new Error("Generate a plan first"), { status: 400 });
  const a = advisorPrompt(b, plan.plan_json);
  const advRaw = await complete(a.system, a.user);
  const advisor = extractJson(advRaw);
  db.prepare("UPDATE plans SET advisor_json = ? WHERE id = ?").run(JSON.stringify(advisor), plan.id);
  res.json(db.prepare("SELECT * FROM plans WHERE id = ?").get(plan.id));
}));

// ---------- conversation import ----------
api.post("/import/conversation", wrap(async (req, res) => {
  const text: string = req.body.text || "";
  if (text.trim().length < 50) {
    throw Object.assign(new Error("Paste the full conversation text (got almost nothing)"), { status: 400 });
  }
  const p = importPrompt(text.slice(0, 300_000));
  const raw = await complete(p.system, p.user);
  const t = extractJson<any>(raw);

  const tx = db.transaction(() => {
    const r = db.prepare(
      `INSERT INTO trips (name, trip_type, start_date, end_date, home_city, budget, currency, notes)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(
      t.name || "Imported trip", t.trip_type || "round", t.start_date ?? null, t.end_date ?? null,
      t.home_city ?? "", t.budget ?? null, t.currency ?? "USD", t.notes ?? ""
    );
    const tripId = Number(r.lastInsertRowid);
    const legIdByCity = new Map<string, number>();
    (t.legs || []).forEach((l: any, i: number) => {
      const lr = db.prepare(
        `INSERT INTO legs (trip_id, seq, city, country, arrive_date, depart_date, lat, lng) VALUES (?,?,?,?,?,?,?,?)`
      ).run(tripId, i, l.city || `Leg ${i + 1}`, l.country || "", l.arrive_date ?? null, l.depart_date ?? null, l.lat ?? null, l.lng ?? null);
      legIdByCity.set((l.city || "").toLowerCase(), Number(lr.lastInsertRowid));
    });
    for (const pl of t.places || []) {
      db.prepare(
        `INSERT INTO places (trip_id, leg_id, name, category, lat, lng, duration_min, priority, notes) VALUES (?,?,?,?,?,?,?,?,?)`
      ).run(
        tripId, legIdByCity.get((pl.city || "").toLowerCase()) ?? null, pl.name || "Unnamed",
        pl.category || "sight", pl.lat ?? null, pl.lng ?? null, pl.duration_min ?? 90,
        pl.priority || "want", pl.notes ?? ""
      );
    }
    for (const td of t.todos || []) {
      db.prepare(`INSERT INTO todos (trip_id, text, category, due_date) VALUES (?,?,?,?)`)
        .run(tripId, td.text || "?", td.category || "general", td.due_date ?? null);
    }
    for (const bk of t.bookings || []) {
      db.prepare(
        `INSERT INTO bookings (trip_id, leg_id, kind, title, date, end_date, cost, notes) VALUES (?,?,?,?,?,?,?,?)`
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

// ---------- Google Places (English search + photos) ----------
function gmapsKey(): string {
  const key = getSetting("google_maps_api_key");
  if (!key) throw Object.assign(new Error("No Google Maps API key configured (Settings)"), { status: 400 });
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
  if (!p?.photo_ref) throw Object.assign(new Error("No photo for this place"), { status: 404 });
  const r = await fetch(
    `https://places.googleapis.com/v1/${p.photo_ref}/media?maxWidthPx=640&key=${encodeURIComponent(gmapsKey())}`
  );
  if (!r.ok) throw Object.assign(new Error(`Photo fetch failed (${r.status})`), { status: 502 });
  res.set("content-type", r.headers.get("content-type") || "image/jpeg");
  res.set("cache-control", "private, max-age=86400");
  res.send(Buffer.from(await r.arrayBuffer()));
}));

// Look up photos (and missing coordinates) for every place that doesn't have one yet.
api.post("/trips/:id/fetch-photos", wrap(async (req, res) => {
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

// ---------- settings ----------
const SETTING_KEYS = ["llm_provider", "llm_api_key", "llm_model", "auto_replan", "google_maps_api_key"];

api.get("/settings", wrap((_req, res) => {
  const out: Record<string, string | null> = {};
  for (const k of SETTING_KEYS) out[k] = getSetting(k);
  // Never leak the full key back to the browser.
  if (out.llm_api_key) out.llm_api_key = `saved:${out.llm_api_key.slice(0, 6)}…${out.llm_api_key.slice(-4)}`;
  res.json({ ...out, default_models: DEFAULT_MODELS });
}));

api.put("/settings", wrap((req, res) => {
  for (const k of SETTING_KEYS) {
    if (k in req.body && req.body[k] != null && !(k === "llm_api_key" && String(req.body[k]).startsWith("saved:"))) {
      setSetting(k, String(req.body[k]));
    }
  }
  res.json({ ok: true });
}));

api.post("/settings/test", wrap(async (_req, res) => {
  const cfg = loadLlmConfig();
  const reply = await complete("Reply with exactly: OK", "ping", cfg);
  res.json({ ok: true, model: cfg.model, reply: reply.trim().slice(0, 100) });
}));
