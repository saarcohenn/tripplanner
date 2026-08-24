import { useEffect, useRef, useState } from "react";
import {
  Camera, Download, Globe, ImageOff, Link2, Map as MapIcon, MapPinned, Sparkles, StickyNote,
  Upload, X,
} from "lucide-react";
import { api, gmapsLink } from "../api";
import type { Place, TripDetail } from "../types";
import ConfirmPlanDialog, { PlanGateChoice } from "./ConfirmPlanDialog";
import TripMap, { CATEGORY_COLORS } from "./TripMap";

const CATEGORIES = ["sight", "attractions", "landmarks", "food", "nature", "shopping", "nightlife", "other"];

/** Where a place's note came from — worth saying, because it changes how much to trust it. */
const NOTE_SOURCE: Record<string, { Icon: typeof StickyNote; label: string }> = {
  ai: { Icon: Sparkles, label: "Pulled out of your conversation by the AI" },
  import: { Icon: MapPinned, label: "Your own note, from the Google Maps list" },
  user: { Icon: StickyNote, label: "Your note" },
};

/** A one-line note shouldn't reserve three lines, and a three-line one shouldn't need scrolling. */
function autoGrow(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

type NameHit = { name: string; address: string; lat: number | null; lng: number | null; google_place_id?: string; photo_ref?: string };
type ImportCandidate = {
  name: string; address: string; lat: number | null; lng: number | null; gmaps_url: string; exists: boolean;
  /** Your own note on the pin. Only the share-link route has these — Takeout drops them. */
  note?: string;
};

function FilterIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="4" y1="6" x2="20" y2="6" /><circle cx="16" cy="6" r="2" fill="currentColor" stroke="none" />
      <line x1="4" y1="12" x2="20" y2="12" /><circle cx="9" cy="12" r="2" fill="currentColor" stroke="none" />
      <line x1="4" y1="18" x2="20" y2="18" /><circle cx="14" cy="18" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export default function PlacesTab({ detail, refresh, gmapsKey, llmReady, generatePlan, theme }: {
  detail: TripDetail;
  refresh: () => Promise<void>;
  gmapsKey: string | null;
  llmReady: boolean;
  generatePlan: () => Promise<void>;
  theme: "light" | "dark";
}) {
  const { trip, legs, places } = detail;
  const [form, setForm] = useState({ name: "", leg_id: "" as number | "", category: "sight", duration_min: 90, priority: "want", notes: "" });
  const [fetchingPhotos, setFetchingPhotos] = useState(false);
  const [gateOpen, setGateOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const autoFetchedTrip = useRef<number | null>(null);

  // Shared selection between the map and the grid below it: clicking a pin highlights and
  // scrolls to its card, clicking a card pans the map to its pin.
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // Bumping this asks the map to recentre. Selecting alone deliberately doesn't move the
  // map — only an explicit jump (card double-click, or the info window's button) does.
  const [jumpNonce, setJumpNonce] = useState(0);
  const cardRefs = useRef(new Map<number, HTMLDivElement>());
  const selectedFromMap = useRef(false);

  useEffect(() => { setSelectedId(null); }, [trip.id]);

  // Only auto-scroll when the selection came from the map — scrolling the list because the
  // user just clicked a card in that same list would yank it out from under them.
  useEffect(() => {
    if (selectedId == null || !selectedFromMap.current) return;
    selectedFromMap.current = false;
    cardRefs.current.get(selectedId)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedId]);

  function selectFromMap(id: number | null) {
    selectedFromMap.current = id != null;
    setSelectedId(id);
  }

  // ---- import a Google Maps "Saved" list (via a Takeout .json export) ----
  const [importOpen, setImportOpen] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState("");
  const [importItems, setImportItems] = useState<ImportCandidate[] | null>(null);
  const [importSkipped, setImportSkipped] = useState(0);
  const [importSelected, setImportSelected] = useState<Set<number>>(new Set());
  const [importCategory, setImportCategory] = useState("sight");
  /** "auto" = nearest city per place, "" = leave untagged, or a leg id for the whole batch. */
  const [importLeg, setImportLeg] = useState("auto");
  const [importing, setImporting] = useState(false);
  const [importFileName, setImportFileName] = useState("");
  const [importUrl, setImportUrl] = useState("");
  const [importSource, setImportSource] = useState("");
  const importFileRef = useRef<HTMLInputElement>(null);

  /** Both routes land here — same candidate shape, same review list, same apply. */
  function receive(r: { items: ImportCandidate[]; skipped: number }, source: string) {
    setImportItems(r.items);
    setImportSkipped(r.skipped);
    setImportSource(source);
    setImportSelected(new Set(r.items.map((_, i) => i).filter((i) => !r.items[i].exists)));
  }

  async function onImportFile(file: File) {
    setImportFileName(file.name);
    setImportError("");
    setImportItems(null);
    setImportBusy(true);
    try {
      const text = await file.text();
      const r = await api.post<{ items: ImportCandidate[]; skipped: number }>(`/trips/${trip.id}/places/import-preview`, { data: text });
      receive(r, file.name);
    } catch (e: any) {
      setImportError(e.message || "Couldn't read that file");
    } finally {
      setImportBusy(false);
    }
  }

  async function onImportLink() {
    setImportError("");
    setImportItems(null);
    setImportBusy(true);
    try {
      const r = await api.post<{ items: ImportCandidate[]; skipped: number; list_name: string }>(
        `/trips/${trip.id}/places/import-link`, { url: importUrl }
      );
      receive(r, r.list_name ? `“${r.list_name}”` : "that list");
    } catch (e: any) {
      setImportError(e.message || "Couldn't read that list");
    } finally {
      setImportBusy(false);
    }
  }

  function toggleImportSelected(i: number) {
    setImportSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }

  async function doImport() {
    if (!importItems || importSelected.size === 0) return;
    setImporting(true);
    try {
      const items = importItems.filter((_, i) => importSelected.has(i));
      await api.post(`/trips/${trip.id}/places/import`, {
        items, category: importCategory,
        leg_id: importLeg === "auto" ? "auto" : importLeg === "" ? null : Number(importLeg),
      });
      setImportItems(null);
      setImportOpen(false);
      await refresh();
    } catch (e: any) {
      setImportError(e.message || "Import failed");
    } finally {
      setImporting(false);
    }
  }

  // ---- filters: name (with an autocomplete dropdown), category, city — tucked behind a filter button ----
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [nameFilter, setNameFilter] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const [catFilter, setCatFilter] = useState<Set<string>>(new Set());
  const [cityFilter, setCityFilter] = useState<Set<number | null>>(new Set());
  const searchWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (searchWrapRef.current && !searchWrapRef.current.contains(e.target as Node)) setShowSuggestions(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  const suggestions = nameFilter.trim()
    ? Array.from(new Set(
        places
          .filter((p) => p.name.toLowerCase().includes(nameFilter.trim().toLowerCase()))
          .map((p) => p.name)
      )).slice(0, 8)
    : [];

  function toggleCat(cat: string) {
    setCatFilter((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  }
  function toggleCity(legId: number | null) {
    setCityFilter((prev) => {
      const next = new Set(prev);
      if (next.has(legId)) next.delete(legId); else next.add(legId);
      return next;
    });
  }
  function clearFilters() {
    setNameFilter("");
    setCatFilter(new Set());
    setCityFilter(new Set());
  }

  const anyFilterActive = !!nameFilter.trim() || catFilter.size > 0 || cityFilter.size > 0;
  function matchesFilters(p: Place) {
    if (nameFilter.trim() && !p.name.toLowerCase().includes(nameFilter.trim().toLowerCase())) return false;
    if (catFilter.size > 0 && !catFilter.has(p.category)) return false;
    if (cityFilter.size > 0 && !cityFilter.has(p.leg_id)) return false;
    return true;
  }

  // ---- add-place name intellisense: Google Places when a Maps key is set, OpenStreetMap
  // (Nominatim) fallback otherwise — same provider split the map's search above uses. ----
  const [nameHits, setNameHits] = useState<NameHit[]>([]);
  const [nameSearching, setNameSearching] = useState(false);
  const [showNameHits, setShowNameHits] = useState(false);
  const [nameHitIdx, setNameHitIdx] = useState(-1);
  const [picked, setPicked] = useState<{ lat: number | null; lng: number | null; google_place_id?: string; photo_ref?: string } | null>(null);
  const addNameWrapRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<number | null>(null);
  const skipNextSearchRef = useRef(false);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (addNameWrapRef.current && !addNameWrapRef.current.contains(e.target as Node)) setShowNameHits(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  // Debounced live search as the user types the new place's name.
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    // Picking a suggestion sets form.name too, which would otherwise re-trigger this same
    // effect and immediately re-search/reopen the dropdown for the name just picked.
    if (skipNextSearchRef.current) { skipNextSearchRef.current = false; return; }
    const q = form.name.trim();
    if (!addOpen || q.length < 2) { setNameHits([]); return; }
    debounceRef.current = window.setTimeout(async () => {
      setNameSearching(true);
      try {
        if (gmapsKey) {
          const r = await api.get<any[]>(`/gplaces/search?q=${encodeURIComponent(q)}`);
          setNameHits(r.map((p) => ({ name: p.name, address: p.address, lat: p.lat, lng: p.lng, google_place_id: p.place_id, photo_ref: p.photo_ref })));
        } else {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&limit=6&q=${encodeURIComponent(q)}`,
            { headers: { accept: "application/json" } }
          );
          const rows: { display_name: string; lat: string; lon: string }[] = await res.json();
          setNameHits(rows.map((row) => ({ name: row.display_name.split(",")[0], address: row.display_name, lat: parseFloat(row.lat), lng: parseFloat(row.lon) })));
        }
        setShowNameHits(true);
        setNameHitIdx(-1);
      } catch {
        setNameHits([]);
      } finally {
        setNameSearching(false);
      }
    }, 350);
    return () => { if (debounceRef.current) window.clearTimeout(debounceRef.current); };
  }, [form.name, addOpen, gmapsKey]);

  function pickNameHit(hit: NameHit) {
    skipNextSearchRef.current = true;
    setForm({ ...form, name: hit.name });
    setPicked({ lat: hit.lat, lng: hit.lng, google_place_id: hit.google_place_id, photo_ref: hit.photo_ref });
    setNameHits([]);
    setShowNameHits(false);
  }

  // Auto-fetch missing photos once per trip when the page renders with a Maps key.
  useEffect(() => {
    if (!gmapsKey || fetchingPhotos) return;
    if (autoFetchedTrip.current === trip.id) return;
    if (!places.some((p) => !p.photo_ref)) return;
    autoFetchedTrip.current = trip.id;
    setFetchingPhotos(true);
    api.post<{ updated: number }>(`/trips/${trip.id}/fetch-photos`)
      .then((r) => { if (r.updated > 0) return refresh(); })
      .catch(() => {})
      .finally(() => setFetchingPhotos(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.id, gmapsKey, places]);

  async function doAdd() {
    await api.post(`/trips/${trip.id}/places`, {
      ...form,
      leg_id: form.leg_id === "" ? null : form.leg_id,
      lat: picked?.lat ?? null,
      lng: picked?.lng ?? null,
      google_place_id: picked?.google_place_id || "",
      photo_ref: picked?.photo_ref || "",
    });
    setForm({ ...form, name: "", notes: "" });
    setPicked(null);
    autoFetchedTrip.current = null; // let the new place pick up a photo
    await refresh();
  }

  async function addPlace() {
    if (!form.name) return;
    if (trip.stage === "planned") {
      setGateOpen(true);
      return;
    }
    await doAdd();
  }

  async function onGateChoice(c: PlanGateChoice) {
    setGateOpen(false);
    if (c === "cancel") return;
    await doAdd();
    if (c === "add_regen") await generatePlan();
  }

  async function patch(p: Place, patchObj: Partial<Place>) {
    await api.put(`/places/${p.id}`, patchObj);
    await refresh();
  }

  // ---- tag the untagged in one go, by nearest located city ----
  const [autoTagging, setAutoTagging] = useState(false);
  const [autoTagResult, setAutoTagResult] = useState<string | null>(null);
  const locatedLegs = legs.filter((l) => l.lat != null && l.lng != null).length;

  async function autoTagUnassigned() {
    setAutoTagging(true);
    setAutoTagResult(null);
    try {
      const r = await api.post<{ assigned: number; skipped: number }>(
        `/trips/${trip.id}/places/assign-legs`, { mode: "auto" }
      );
      setAutoTagResult(
        r.assigned === 0
          ? "Nothing could be matched — those places have no coordinates."
          : `Tagged ${r.assigned}${r.skipped ? `, left ${r.skipped} alone (no coordinates)` : ""}. Check them below.`
      );
      await refresh();
    } catch (e: any) {
      setAutoTagResult(e.message);
    } finally {
      setAutoTagging(false);
    }
  }

  async function remove(p: Place) {
    if (!window.confirm(`Delete "${p.name}" permanently? (Use Drop to keep it greyed-out instead.)`)) return;
    await api.del(`/places/${p.id}`);
    await refresh();
  }

  const byLeg = new Map<number | null, Place[]>();
  for (const p of places) {
    const k = p.leg_id;
    byLeg.set(k, [...(byLeg.get(k) || []), p]);
  }
  const groups: { label: string; items: Place[]; unassigned?: boolean }[] = [
    ...legs.map((l) => ({ label: `${l.city}${l.country ? `, ${l.country}` : ""}`, items: (byLeg.get(l.id) || []).filter(matchesFilters) })),
    ...(byLeg.has(null) ? [{ label: "Unassigned", items: byLeg.get(null)!.filter(matchesFilters), unassigned: true }] : []),
  ].filter((g) => !anyFilterActive || g.items.length > 0);

  return (
    <div className="pad wide">
      <ConfirmPlanDialog open={gateOpen} llmReady={llmReady} onChoose={onGateChoice} />

      <TripMap
        detail={detail} refresh={refresh} gmapsKey={gmapsKey} llmReady={llmReady}
        generatePlan={generatePlan} theme={theme}
        selectedId={selectedId} onSelect={selectFromMap}
        jumpNonce={jumpNonce} onJump={() => setJumpNonce((n) => n + 1)}
      />

      <div className="row spread">
        <h2>
          Places ({places.filter((p) => p.status === "active").length} active)
          {anyFilterActive && (
            <span className="hint"> — showing {places.filter(matchesFilters).length} match{places.filter(matchesFilters).length === 1 ? "" : "es"}</span>
          )}
        </h2>
        <div className="row" style={{ gap: 8 }}>
          {fetchingPhotos && (
            <span className="hint icon-line"><Camera size={13} /> Fetching photos…</span>
          )}
          <button
            className={`icon-btn${filtersOpen ? " active" : ""}`} title="Filter places"
            onClick={() => setFiltersOpen((v) => !v)}
          >
            <FilterIcon />
            {anyFilterActive && <span className="badge-dot" />}
          </button>
        </div>
      </div>

      {filtersOpen && (
        <div className="filter-bar">
          <div className="filter-search" ref={searchWrapRef}>
            <input
              dir="auto" placeholder="Search places…" value={nameFilter}
              onChange={(e) => { setNameFilter(e.target.value); setShowSuggestions(true); setHighlightIdx(-1); }}
              onFocus={() => setShowSuggestions(true)}
              onKeyDown={(e) => {
                if (!showSuggestions || suggestions.length === 0) {
                  if (e.key === "Escape") setShowSuggestions(false);
                  return;
                }
                if (e.key === "ArrowDown") { e.preventDefault(); setHighlightIdx((i) => Math.min(i + 1, suggestions.length - 1)); }
                else if (e.key === "ArrowUp") { e.preventDefault(); setHighlightIdx((i) => Math.max(i - 1, 0)); }
                else if (e.key === "Enter" && highlightIdx >= 0) { setNameFilter(suggestions[highlightIdx]); setShowSuggestions(false); }
                else if (e.key === "Escape") setShowSuggestions(false);
              }}
            />
            {showSuggestions && suggestions.length > 0 && (
              <ul className="autocomplete">
                {suggestions.map((s, i) => (
                  <li key={s} className={i === highlightIdx ? "active" : ""} dir="auto"
                    onClick={() => { setNameFilter(s); setShowSuggestions(false); }}>
                    {s}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="filter-chips">
            {CATEGORIES.map((c) => (
              <button key={c} className={`chip-toggle${catFilter.has(c) ? " active" : ""}`} onClick={() => toggleCat(c)}>{c}</button>
            ))}
          </div>
          {legs.length > 0 && (
            <div className="filter-chips">
              {legs.map((l) => (
                <button key={l.id} dir="auto" className={`chip-toggle${cityFilter.has(l.id) ? " active" : ""}`} onClick={() => toggleCity(l.id)}>{l.city}</button>
              ))}
              {byLeg.has(null) && (
                <button className={`chip-toggle${cityFilter.has(null) ? " active" : ""}`} onClick={() => toggleCity(null)}>
                  <Globe size={12} /> Unassigned
                </button>
              )}
            </div>
          )}
          {anyFilterActive && (
            <button className="small btn-icon" onClick={clearFilters}>Clear filters <X size={12} /></button>
          )}
        </div>
      )}

      <div className="row" style={{ gap: 8 }}>
        <button className="primary" onClick={() => setAddOpen((v) => !v)}>{addOpen ? "− Close" : "+ Add place"}</button>
        <button className="btn-icon" onClick={() => setImportOpen((v) => !v)}>
          {importOpen ? "− Close" : <><Download size={14} /> Import from Google Maps</>}
        </button>
      </div>

      {importOpen && (
        <div className="add-row" style={{ display: "block" }}>
          {/* Paste a link is the fast path; Takeout is the one Google actually supports, so it
              stays as the fallback for a list that isn't shared. */}
          <label className="block">Share link to a Google Maps list
            <div className="row" style={{ gap: 8 }}>
              <input
                dir="ltr" className="grow" placeholder="https://maps.app.goo.gl/…"
                value={importUrl} onChange={(e) => setImportUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && importUrl.trim()) onImportLink(); }}
              />
              <button className="primary btn-icon" onClick={onImportLink} disabled={importBusy || !importUrl.trim()}>
                <Link2 size={14} /> Read list
              </button>
            </div>
          </label>
          <p className="hint">
            In Google Maps: open the list → <strong>Share</strong> → copy the link (it has to be shared,
            or Google won't hand it over). This brings each pin's own note across, which the export below
            doesn't include.
          </p>

          <details>
            <summary className="hint">Or upload a Google Takeout export (works for private lists)</summary>
            <p className="hint">
              Google offers no supported API for saved lists, so the guaranteed route is a manual export:{" "}
              <strong>takeout.google.com</strong> → deselect all → pick only "Saved" → export, then open the
              list's <code>.json</code> file inside <code>Takeout/Saved/</code> and upload it here.
            </p>
            <div className="row" style={{ gap: 8, alignItems: "center" }}>
              <input
                ref={importFileRef} type="file" accept=".json,application/json" style={{ display: "none" }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onImportFile(f); e.target.value = ""; }}
              />
              <button className="btn-icon" onClick={() => importFileRef.current?.click()}>
                <Upload size={14} /> Choose file
              </button>
              {importFileName && <span className="hint" dir="auto">{importFileName}</span>}
            </div>
          </details>

          {importBusy && <p className="hint">Reading the list…</p>}
          {importError && <p className="hint" style={{ color: "var(--danger)" }}>{importError}</p>}
          {importItems && (
            <>
              <div className="row spread" style={{ marginTop: 8 }}>
                <p className="hint">
                  Found {importItems.length} place{importItems.length === 1 ? "" : "s"}
                  {importSource ? <> in <strong dir="auto">{importSource}</strong></> : null}
                  {importSkipped > 0 ? ` (${importSkipped} skipped — no name/address)` : ""}. Already-in-trip places are unchecked.
                </p>
                <div className="row" style={{ gap: 8, alignItems: "flex-end" }}>
                  <label className="block">Tag with city
                    <select value={importLeg} onChange={(e) => setImportLeg(e.target.value)}>
                      <option value="auto" disabled={locatedLegs === 0}>
                        {locatedLegs > 0 ? "Nearest city, per place" : "Nearest city — needs city coordinates"}
                      </option>
                      <option value="">Leave untagged</option>
                      {legs.map((l) => <option key={l.id} value={String(l.id)}>All in {l.city}</option>)}
                    </select>
                  </label>
                  <label className="block">Add as category
                    <select value={importCategory} onChange={(e) => setImportCategory(e.target.value)}>
                      {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                    </select>
                  </label>
                </div>
              </div>
              <div style={{ maxHeight: 260, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8, padding: 8 }}>
                {importItems.map((it, i) => (
                  <label key={i} className="row" style={{ gap: 8, padding: "4px 0" }} dir="auto">
                    <input type="checkbox" checked={importSelected.has(i)} onChange={() => toggleImportSelected(i)} />
                    <span className="grow">
                      <strong>{it.name}</strong>{it.exists && <span className="hint"> — already in trip</span>}
                      {it.note && <div className="import-note" dir="auto">{it.note}</div>}
                      {it.address && <div className="hint">{it.address}</div>}
                    </span>
                  </label>
                ))}
              </div>
              <button className="primary" disabled={importing || importSelected.size === 0} onClick={doImport} style={{ marginTop: 8 }}>
                {importing ? "Importing…" : `Import ${importSelected.size} selected`}
              </button>
            </>
          )}
        </div>
      )}

      {addOpen && (
        <div className="add-row">
          <div className="filter-search" ref={addNameWrapRef}>
            <input
              dir="auto" placeholder={gmapsKey ? "Search Google Maps (English)…" : "Search OpenStreetMap, or type a name…"}
              value={form.name}
              onChange={(e) => { setForm({ ...form, name: e.target.value }); setPicked(null); setShowNameHits(true); }}
              onFocus={() => nameHits.length > 0 && setShowNameHits(true)}
              onKeyDown={(e) => {
                if (!showNameHits || nameHits.length === 0) return;
                if (e.key === "ArrowDown") { e.preventDefault(); setNameHitIdx((i) => Math.min(i + 1, nameHits.length - 1)); }
                else if (e.key === "ArrowUp") { e.preventDefault(); setNameHitIdx((i) => Math.max(i - 1, 0)); }
                else if (e.key === "Enter" && nameHitIdx >= 0) { e.preventDefault(); pickNameHit(nameHits[nameHitIdx]); }
                else if (e.key === "Escape") setShowNameHits(false);
              }}
            />
            {showNameHits && (nameSearching || nameHits.length > 0) && (
              <ul className="autocomplete">
                {nameSearching && <li className="hint">Searching…</li>}
                {!nameSearching && nameHits.map((hit, i) => (
                  <li key={i} className={i === nameHitIdx ? "active" : ""} onClick={() => pickNameHit(hit)}>
                    <div dir="auto"><strong>{hit.name}</strong></div>
                    {hit.address && <div className="hint" dir="auto">{hit.address}</div>}
                  </li>
                ))}
              </ul>
            )}
            {picked && <p className="hint">Location matched — will be pinned on the map too.</p>}
          </div>
          <select value={form.leg_id} onChange={(e) => setForm({ ...form, leg_id: e.target.value === "" ? "" : Number(e.target.value) })}>
            <option value="">No city</option>
            {legs.map((l) => <option key={l.id} value={l.id}>{l.city}</option>)}
          </select>
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
          <input type="number" title="Duration (minutes)" value={form.duration_min} onChange={(e) => setForm({ ...form, duration_min: Number(e.target.value) })} style={{ width: 70 }} />
          <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
            <option value="must">must</option><option value="want">want</option><option value="maybe">maybe</option>
          </select>
          <button className="primary" onClick={addPlace}>Add</button>
        </div>
      )}

      {anyFilterActive && groups.length === 0 && (
        <p className="hint">No places match your filters. <button className="small" onClick={clearFilters}>Clear filters</button></p>
      )}

      {groups.map((g) => (
        <div key={g.label}>
          <div className="row spread group-head">
            <h3 dir="auto">{g.label} <span className="hint">{g.items.length}</span></h3>
            {/* Only worth offering where there's a backlog to clear — and only when the trip has
                cities with coordinates to measure against. */}
            {g.unassigned && g.items.length > 0 && (
              locatedLegs > 0 ? (
                <button className="small btn-icon" onClick={autoTagUnassigned} disabled={autoTagging}
                  title="Tag each of these with the nearest city on the trip (straight-line distance)">
                  <Globe size={13} /> {autoTagging ? "Tagging…" : "Tag by nearest city"}
                </button>
              ) : (
                <span className="hint">
                  {legs.length === 0 ? "Add cities on the Overview tab to tag these." : "None of your cities have coordinates yet, so they can't be matched automatically."}
                </span>
              )
            )}
          </div>
          {g.unassigned && autoTagResult && <p className="hint">{autoTagResult}</p>}
          {g.items.length === 0 && <p className="hint">No places yet — add them from the map above or the ＋ button.</p>}
          <div className="place-grid">
            {g.items.map((p) => (
              <div
                key={p.id}
                ref={(el) => { if (el) cardRefs.current.set(p.id, el); else cardRefs.current.delete(p.id); }}
                className={`pcard ${p.status === "dropped" ? "dropped" : ""}${p.id === selectedId ? " selected" : ""}`}
                title="Click to show on the map · double-click to jump to it"
                // Select (don't toggle) so a double-click doesn't deselect on its first click.
                onClick={() => setSelectedId(p.id)}
                onDoubleClick={() => { setSelectedId(p.id); setJumpNonce((n) => n + 1); }}
              >
                {p.photo_ref
                  ? <img className="pcard-img" src={`/api/places/${p.id}/photo`} alt={p.name} loading="lazy" />
                  : <div className="pcard-img empty"><ImageOff size={34} strokeWidth={1.4} /></div>}
                <span className="pcard-cat" style={{ background: CATEGORY_COLORS[p.category] || CATEGORY_COLORS.other }} />
                <div className="pcard-body">
                  <div className="row spread">
                    <strong dir="auto">{p.name}</strong>
                    <a href={gmapsLink(p)} target="_blank" rel="noreferrer" title="Open in Google Maps"
                      onClick={(e) => e.stopPropagation()}><MapIcon size={15} /></a>
                  </div>
                  {/* Notes were read-only, and the only icon marked AI-extracted ones — so a note
                      you wrote yourself in Google Maps arrived unmarked and uneditable, which is
                      backwards: yours is the one worth being able to change. */}
                  <div className="pcard-note"
                    onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                    <span className={`pcard-note-mark ${p.source}`} title={NOTE_SOURCE[p.source]?.label || "Note"}
                      aria-label={NOTE_SOURCE[p.source]?.label || "Note"}>
                      {(() => { const I = NOTE_SOURCE[p.source]?.Icon || StickyNote; return <I size={11} />; })()}
                    </span>
                    <textarea
                      dir="auto" rows={1} className="subtle" defaultValue={p.notes}
                      placeholder="Add a note…" aria-label={`Note for ${p.name}`}
                      onInput={(e) => autoGrow(e.currentTarget)}
                      ref={(el) => { if (el) autoGrow(el); }}
                      onBlur={(e) => { if (e.target.value !== p.notes) patch(p, { notes: e.target.value }); }}
                    />
                  </div>
                  {/* The card selects on click and jumps on double-click, so its controls
                      must swallow both or fiddling with a dropdown would move the map. */}
                  <div className="pcard-controls"
                    onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                    {/* The city is what decides which days a place can be scheduled in, so it
                        gets its own full-width row rather than competing for space with the
                        category and duration. */}
                    <select
                      className={`pcard-city${p.leg_id == null ? " unset" : ""}`}
                      value={p.leg_id ?? ""} aria-label={`City for ${p.name}`}
                      onChange={(e) => patch(p, { leg_id: e.target.value === "" ? null : Number(e.target.value) })}
                    >
                      <option value="">— no city —</option>
                      {legs.map((l) => <option key={l.id} value={l.id}>{l.city}</option>)}
                    </select>
                    <select value={p.category} onChange={(e) => patch(p, { category: e.target.value })}>
                      {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                    </select>
                    <select value={p.priority} onChange={(e) => patch(p, { priority: e.target.value as any })}>
                      <option value="must">must</option><option value="want">want</option><option value="maybe">maybe</option>
                    </select>
                    <span className="nowrap">
                      <input type="number" value={p.duration_min} style={{ width: 58 }}
                        onChange={(e) => patch(p, { duration_min: Number(e.target.value) })} /> min
                    </span>
                  </div>
                  <div className="row pcard-actions"
                    onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                    {p.status === "active"
                      ? <button className="small" title="Drop from plan (keep in list)" onClick={() => patch(p, { status: "dropped" })}>Drop</button>
                      : <button className="small" title="Restore to plan" onClick={() => patch(p, { status: "active" })}>Restore</button>}
                    <button className="danger small" onClick={() => remove(p)}>Delete</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
