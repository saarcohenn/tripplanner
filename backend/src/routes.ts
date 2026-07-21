import { Router } from "express";
import { db, bumpPlanVersion, getSetting, setSetting, seedDemoIfEmpty } from "./db.js";
import { complete, extractJson, listModels, loadLlmConfig, DEFAULT_MODELS } from "./llm.js";
import { planPrompt, advisorPrompt, importPrompt, DEFAULT_PLAN_SYSTEM_PROMPT, TripBundle } from "./prompts.js";

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
  const b = getBundle(tripId);
  const existing: any = latestJob(tripId);
  if (existing?.status === "running") return void res.status(202).json(existing);

  const version = (b.trip as any).plan_version;
  const job = startJob(tripId, "plan", async () => {
    const p = planPrompt(b, getSetting("plan_system_prompt"));
    const raw = await complete(p.system, p.user, undefined, "plan");
    const plan = extractJson(raw);

    // The advisor review is a separate, best-effort LLM call. A slow or failing advisor must never
    // throw away a plan that already took real time/money to generate — it's re-triggerable via /advise.
    let advisorJson: string | null = null;
    try {
      const a = advisorPrompt(b, JSON.stringify(plan));
      const advRaw = await complete(a.system, a.user, undefined, "advisor");
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
  const b = getBundle(tripId);
  const plan: any = db.prepare("SELECT * FROM plans WHERE trip_id = ? ORDER BY id DESC LIMIT 1").get(tripId);
  if (!plan) throw Object.assign(new Error("Generate a plan first"), { status: 400 });
  const existing: any = latestJob(tripId);
  if (existing?.status === "running") return void res.status(202).json(existing);

  const job = startJob(tripId, "advisor", async () => {
    const a = advisorPrompt(b, plan.plan_json);
    const advRaw = await complete(a.system, a.user, undefined, "advisor");
    const advisor = extractJson(advRaw);
    db.prepare("UPDATE plans SET advisor_json = ? WHERE id = ?").run(JSON.stringify(advisor), plan.id);
    return { planId: plan.id };
  });
  res.status(202).json(job);
}));

// Current/most recent job for a trip — lets a freshly loaded page recover job state without SSE.
api.get("/trips/:id/plan-job", wrap((req, res) => {
  res.json(latestJob(Number(req.params.id)));
}));

// Server-Sent Events: pushes plan_jobs updates for one trip as they happen. Sends the current job
// state immediately on connect so a client never has to guess whether it missed something.
api.get("/trips/:id/events", (req, res) => {
  const tripId = Number(req.params.id);
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
  const raw = await complete(p.system, p.user, undefined, "import");
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

// ---------- settings ----------
const SETTING_KEYS = [
  "llm_provider", "llm_api_key", "llm_model", "auto_replan", "google_maps_api_key",
  "llm_price_in", "llm_price_out", "llm_monthly_budget", "home_currency", "plan_system_prompt",
];

api.get("/settings", wrap((_req, res) => {
  const out: Record<string, string | null> = {};
  for (const k of SETTING_KEYS) out[k] = getSetting(k);
  // Never leak the full key back to the browser.
  if (out.llm_api_key) out.llm_api_key = `saved:${out.llm_api_key.slice(0, 6)}…${out.llm_api_key.slice(-4)}`;
  const source = out.google_maps_api_key ? "db" : process.env.GOOGLE_MAPS_API_KEY ? "env" : null;
  out.google_maps_api_key = effectiveGmapsKey();
  res.json({
    ...out, google_maps_key_source: source, default_models: DEFAULT_MODELS,
    default_plan_system_prompt: DEFAULT_PLAN_SYSTEM_PROMPT,
  });
}));

// List chat models available to the given (or saved) key, for the Settings dropdown.
api.post("/llm/models", wrap(async (req, res) => {
  const provider = (req.body.provider || getSetting("llm_provider") || "anthropic") as any;
  let key = String(req.body.api_key || "");
  if (!key || key.startsWith("saved:")) key = getSetting("llm_api_key") || "";
  if (!key) throw Object.assign(new Error("Enter an API key first, then load the model list"), { status: 400 });
  res.json({ models: await listModels(provider, key) });
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
  const reply = await complete("Reply with exactly: OK", "ping", cfg, "test");
  res.json({ ok: true, model: cfg.model, reply: reply.trim().slice(0, 100) });
}));

// Ask the provider itself about the key's budget/spend. Only OpenRouter exposes this.
api.get("/llm/provider-plan", wrap(async (_req, res) => {
  const provider = getSetting("llm_provider") || "anthropic";
  const key = getSetting("llm_api_key") || "";
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

// ---------- LLM usage / billing ----------
api.get("/llm/usage", wrap((_req, res) => {
  const days = db.prepare(
    `SELECT substr(ts, 1, 10) AS day, SUM(input_tokens) AS input_tokens,
            SUM(output_tokens) AS output_tokens, COUNT(*) AS calls
     FROM llm_usage WHERE ts >= datetime('now', '-30 days')
     GROUP BY day ORDER BY day`
  ).all();
  const month = db.prepare(
    `SELECT COALESCE(SUM(input_tokens), 0) AS input_tokens,
            COALESCE(SUM(output_tokens), 0) AS output_tokens, COUNT(*) AS calls
     FROM llm_usage WHERE ts >= date('now', 'start of month')`
  ).get();
  const totals = db.prepare(
    `SELECT COALESCE(SUM(input_tokens), 0) AS input_tokens,
            COALESCE(SUM(output_tokens), 0) AS output_tokens, COUNT(*) AS calls
     FROM llm_usage`
  ).get();
  const recent = db.prepare(`SELECT * FROM llm_usage ORDER BY id DESC LIMIT 12`).all();
  res.json({ days, month, totals, recent });
}));
