import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { PlanJob, Settings, Trip, TripDetail } from "./types";
import OverviewTab from "./components/OverviewTab";
import MapTab from "./components/MapTab";
import PlacesTab from "./components/PlacesTab";
import PlanTab from "./components/PlanTab";
import TodosTab from "./components/TodosTab";
import BookingsTab from "./components/BookingsTab";
import ExpensesTab from "./components/ExpensesTab";
import ImportTab from "./components/ImportTab";
import SettingsTab from "./components/SettingsTab";

const TABS = ["Overview", "Map", "Places", "Plan", "Todos", "Bookings", "Expenses", "Import", "Settings"] as const;
type Tab = (typeof TABS)[number];
/** Pages scoped to the selected trip vs. app-wide pages (drawer groups them separately). */
const TRIP_TABS: Tab[] = ["Overview", "Map", "Places", "Plan", "Todos", "Bookings", "Expenses"];
const APP_TABS: Tab[] = ["Import", "Settings"];

export default function App() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<TripDetail | null>(null);
  // Tab is deep-linkable via the URL hash (e.g. /#Plan) and kept in sync for reload/PWA re-entry
  const [tab, setTab] = useState<Tab>(() => {
    const h = decodeURIComponent(window.location.hash.slice(1));
    return (TABS as readonly string[]).includes(h) ? (h as Tab) : "Overview";
  });
  useEffect(() => { window.history.replaceState(null, "", `#${tab}`); }, [tab]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [planJob, setPlanJob] = useState<PlanJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const replanTimer = useRef<number | null>(null);
  // Dedupes SSE deliveries (initial-state-on-connect + reconnects) so a dismissed error/refresh
  // doesn't fire again for the same job.
  const handledJobRef = useRef<string | null>(null);

  const loadTrips = useCallback(async () => {
    const t = await api.get<Trip[]>("/trips");
    setTrips(t);
    setSelectedId((cur) => cur ?? t[0]?.id ?? null);
  }, []);

  const loadDetail = useCallback(async () => {
    if (selectedId == null) return setDetail(null);
    setDetail(await api.get<TripDetail>(`/trips/${selectedId}`));
  }, [selectedId]);

  const loadSettings = useCallback(async () => {
    setSettings(await api.get<Settings>("/settings"));
  }, []);

  useEffect(() => { loadTrips().catch((e) => setError(String(e.message))); }, [loadTrips]);
  useEffect(() => { loadDetail().catch((e) => setError(String(e.message))); }, [loadDetail]);
  useEffect(() => { loadSettings().catch(() => {}); }, [loadSettings]);

  /** Call after any mutation: refresh data; the plan-watcher effect below reacts to version drift. */
  const refresh = useCallback(async () => {
    await Promise.all([loadTrips(), loadDetail()]);
  }, [loadTrips, loadDetail]);

  // Only nag about staleness when a plan actually exists — while the user is still
  // collecting legs/places (no plan yet) the first generation is started from the Plan tab.
  const planOutdated =
    !!detail && detail.plan != null && detail.plan.plan_version < detail.trip.plan_version;
  const llmReady = !!settings?.llm_api_key;
  const autoReplan = settings?.auto_replan === "1";

  // Plan/advisor generation runs as a background job on the server (LLM calls can take minutes on
  // slow/high-end models) — this just kicks it off; the SSE subscription below reports back.
  const generatePlan = useCallback(async () => {
    if (!detail) return;
    setError(null);
    try {
      setPlanJob(await api.post<PlanJob>(`/trips/${detail.trip.id}/generate-plan`));
    } catch (e: any) {
      setError(e.message);
    }
  }, [detail]);

  const reAdvise = useCallback(async () => {
    if (!detail) return;
    setError(null);
    try {
      setPlanJob(await api.post<PlanJob>(`/trips/${detail.trip.id}/advise`));
    } catch (e: any) {
      setError(e.message);
    }
  }, [detail]);

  // Live job updates over Server-Sent Events: the initial event on connect recovers in-progress
  // state after a reload, and later events land the moment the LLM actually replies.
  useEffect(() => {
    setPlanJob(null);
    handledJobRef.current = null;
    if (selectedId == null) return;
    const es = new EventSource(`/api/trips/${selectedId}/events`);
    es.addEventListener("job", (ev: MessageEvent) => {
      const job: PlanJob | null = ev.data ? JSON.parse(ev.data) : null;
      setPlanJob(job);
      if (!job) return;
      const key = `${job.id}:${job.status}`;
      if (handledJobRef.current === key) return;
      handledJobRef.current = key;
      if (job.status === "done") void loadDetail();
      else if (job.status === "error") setError(job.error || "Generation failed.");
    });
    return () => es.close();
  }, [selectedId, loadDetail]);

  const busy = planJob?.status === "running"
    ? (planJob.kind === "advisor" ? "Re-analyzing plan…" : "Generating plan + advisor review…")
    : null;

  // Plan watcher: when the trip data changes (places added on the map, legs edited, …)
  // and auto-replan is on, regenerate the daily schedule after a short quiet period.
  useEffect(() => {
    if (!planOutdated || !autoReplan || !llmReady || busy) return;
    if (replanTimer.current) window.clearTimeout(replanTimer.current);
    replanTimer.current = window.setTimeout(() => { void generatePlan(); }, 4000);
    return () => { if (replanTimer.current) window.clearTimeout(replanTimer.current); };
  }, [planOutdated, autoReplan, llmReady, busy, detail?.trip.plan_version, generatePlan]);

  async function createTrip() {
    const name = window.prompt("Trip name?");
    if (!name) return;
    const t = await api.post<Trip>("/trips", { name });
    await loadTrips();
    setSelectedId(t.id);
    setTab("Overview");
  }

  async function deleteTrip(id: number) {
    if (!window.confirm("Delete this trip and everything in it?")) return;
    await api.del(`/trips/${id}`);
    setSelectedId(null);
    await loadTrips();
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <button className="hamburger" aria-label="Open menu" onClick={() => setMenuOpen(true)}>☰</button>
        {/* Mobile top bar shows where you are (trip › page); the brand lives in the drawer */}
        <div className="crumb" dir="auto">
          {detail && !APP_TABS.includes(tab)
            ? <>{detail.trip.name} <span className="crumb-sep">›</span> {tab}</>
            : tab}
        </div>
        <h1>🧭 TripPlanner</h1>
        <button className="primary" onClick={createTrip}>+ New trip</button>
        <ul className="trip-list">
          {trips.map((t) => (
            <li key={t.id} className={t.id === selectedId ? "active" : ""}>
              <button className="trip-name" onClick={() => setSelectedId(t.id)} dir="auto">
                <span
                  className={`stage-dot ${t.stage === "planned" ? "planned" : ""}`}
                  title={t.stage === "planned" ? "Plan generated" : "Collecting places"}
                />
                {t.name}
              </button>
              <button className="danger small" title="Delete trip" onClick={() => deleteTrip(t.id)}>✕</button>
            </li>
          ))}
        </ul>
        <div className="sidebar-footer">
          {!llmReady && <p className="hint">⚠ No LLM key set — plan generation disabled. Add one in Settings.</p>}
        </div>
      </aside>

      {menuOpen && (
        <div className="drawer-overlay" onClick={() => setMenuOpen(false)}>
          <nav className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <button className="drawer-back" aria-label="Close menu" onClick={() => setMenuOpen(false)}>←</button>
              <h1>🧭 TripPlanner</h1>
            </div>
            <h4>Pages</h4>
            {TRIP_TABS.map((t) => (
              <button key={t} className={t === tab ? "drawer-item active" : "drawer-item"}
                onClick={() => { setTab(t); setMenuOpen(false); }}>{t}</button>
            ))}
            <h4>Trips</h4>
            {trips.map((t) => (
              <div className="drawer-trip" key={t.id}>
                <button className={t.id === selectedId ? "drawer-item active" : "drawer-item"} dir="auto"
                  onClick={() => { setSelectedId(t.id); setMenuOpen(false); }}>
                  <span
                    className={`stage-dot ${t.stage === "planned" ? "planned" : ""}`}
                    title={t.stage === "planned" ? "Plan generated" : "Collecting places"}
                  />
                  {t.name}
                </button>
                <button className="danger small" title="Delete trip" onClick={() => deleteTrip(t.id)}>✕</button>
              </div>
            ))}
            <button className="drawer-item" onClick={() => { setMenuOpen(false); void createTrip(); }}>＋ New trip</button>
            <div className="drawer-app">
              <h4>App</h4>
              {APP_TABS.map((t) => (
                <button key={t} className={t === tab ? "drawer-item active" : "drawer-item"}
                  onClick={() => { setTab(t); setMenuOpen(false); }}>{t}</button>
              ))}
            </div>
          </nav>
        </div>
      )}

      <main className="main">
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t} className={t === tab ? "tab active" : "tab"} onClick={() => setTab(t)}>{t}</button>
          ))}
        </nav>

        {error && <div className="banner error" onClick={() => setError(null)}>{error} ✕</div>}
        {busy && <div className="banner busy">⏳ {busy}</div>}
        {planOutdated && !busy && detail && !APP_TABS.includes(tab) && (
          <div className="banner warn">
            Plan is out of date with your latest changes.
            {llmReady
              ? autoReplan
                ? " Auto re-planning shortly…"
                : <button className="inline" onClick={generatePlan}>Regenerate now</button>
              : " Add an LLM key in Settings to generate it."}
          </div>
        )}

        {tab === "Import" ? (
          <ImportTab onImported={async (tripId) => { await loadTrips(); setSelectedId(tripId); setTab("Overview"); }} />
        ) : tab === "Settings" ? (
          <SettingsTab settings={settings} reload={loadSettings} />
        ) : !detail ? (
          <p className="hint pad">Select or create a trip.</p>
        ) : tab === "Overview" ? (
          // key: remount per trip so form state seeded from the trip doesn't survive a trip switch
          <OverviewTab key={detail.trip.id} detail={detail} refresh={refresh} />
        ) : tab === "Map" ? (
          <MapTab detail={detail} refresh={refresh} gmapsKey={settings?.google_maps_api_key || null}
            llmReady={llmReady} generatePlan={generatePlan} />
        ) : tab === "Places" ? (
          <PlacesTab detail={detail} refresh={refresh} gmapsKey={settings?.google_maps_api_key || null}
            llmReady={llmReady} generatePlan={generatePlan} />
        ) : tab === "Plan" ? (
          <PlanTab detail={detail} refresh={refresh} llmReady={llmReady} generatePlan={generatePlan}
            reAdvise={reAdvise} planJob={planJob} busy={!!busy} />
        ) : tab === "Todos" ? (
          <TodosTab detail={detail} refresh={refresh} />
        ) : tab === "Expenses" ? (
          <ExpensesTab key={detail.trip.id} detail={detail} refresh={refresh} homeCurrency={settings?.home_currency || null} />
        ) : (
          <BookingsTab key={detail.trip.id} detail={detail} refresh={refresh} homeCurrency={settings?.home_currency || null} />
        )}
      </main>
    </div>
  );
}
