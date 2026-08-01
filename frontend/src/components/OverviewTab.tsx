import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, GripVertical } from "lucide-react";
import { api } from "../api";
import type { Leg, Place, TripDetail } from "../types";
import CurrencySelect from "./CurrencySelect";
import DateRangePicker from "./DateRangePicker";

function fmtDate(d: string | null): string {
  if (!d) return "?";
  const dt = new Date(`${d}T00:00:00`);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fmtRange(a: string | null, b: string | null): string {
  if (!a && !b) return "";
  return `${fmtDate(a)} → ${fmtDate(b)}`;
}

/** Whole days from local midnight today to local midnight on `iso` (negative once past). */
function daysUntil(iso: string): number {
  const target = new Date(`${iso}T00:00:00`);
  if (isNaN(target.getTime())) return NaN;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

const PRIORITY_RANK: Record<string, number> = { must: 0, want: 1, maybe: 2 };

/**
 * Picks the photos for the countdown's stack: one landmark per country the trip visits,
 * so a multi-country trip previews each leg of it. Falls back to a second photo from the
 * same country when there's only one, and caps at three so the stack stays readable.
 *
 * Deliberately drawn from the trip's own places rather than looking up famous landmarks —
 * this app never surfaces places the user didn't choose, and their photos are already
 * fetched and cached.
 */
function landmarkPhotos(legs: Leg[], places: Place[]): Place[] {
  const countryOfLeg = new Map(legs.map((l) => [l.id, (l.country || "").trim()]));
  const withPhotos = places
    .filter((p) => p.photo_ref && p.status !== "dropped")
    .sort((a, b) => (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3));
  if (withPhotos.length === 0) return [];

  const byCountry = new Map<string, Place[]>();
  for (const p of withPhotos) {
    const country = countryOfLeg.get(p.leg_id ?? -1) || "";
    byCountry.set(country, [...(byCountry.get(country) || []), p]);
  }
  // Country order follows the itinerary, not the map's iteration order.
  const countries = Array.from(new Set(legs.map((l) => (l.country || "").trim())))
    .filter((c) => byCountry.has(c));
  const ordered = countries.length ? countries : Array.from(byCountry.keys());

  if (ordered.length <= 1) return (byCountry.get(ordered[0]) || withPhotos).slice(0, 2);
  return ordered.slice(0, 3).map((c) => byCountry.get(c)![0]);
}

function PhotoStack({ photos }: { photos: Place[] }) {
  if (photos.length === 0) return null;
  return (
    <div className="countdown-stack" aria-hidden="true">
      {photos.map((p, i) => (
        <img
          key={p.id}
          className="countdown-stack-img"
          style={{ zIndex: photos.length - i }}
          src={`/api/places/${p.id}/photo`}
          alt=""
          loading="lazy"
          title={p.name}
        />
      ))}
    </div>
  );
}

/**
 * Countdown to (or through) the trip. Deliberately date-only rather than a ticking
 * hh:mm:ss — a trip is planned in days, and a live clock would re-render every second
 * for no real information.
 */
function Countdown({ start, end, photos }: { start: string | null; end: string | null; photos: Place[] }) {
  if (!start) return null;
  const toStart = daysUntil(start);
  if (isNaN(toStart)) return null;
  const toEnd = end ? daysUntil(end) : NaN;
  const totalDays = !isNaN(toEnd) ? toEnd - toStart + 1 : NaN;

  let state: "upcoming" | "today" | "during" | "past";
  let big: string;
  let label: string;

  if (toStart > 0) {
    state = "upcoming";
    big = String(toStart);
    label = toStart === 1 ? "day to go" : "days to go";
  } else if (toStart === 0) {
    state = "today";
    big = "Today";
    label = "your trip starts";
  } else if (!isNaN(toEnd) && toEnd >= 0) {
    state = "during";
    const dayNo = -toStart + 1;
    big = `Day ${dayNo}`;
    label = !isNaN(totalDays) ? `of ${totalDays}` : "in progress";
  } else {
    state = "past";
    const since = !isNaN(toEnd) ? -toEnd : -toStart;
    big = String(since);
    label = since === 1 ? "day since you got back" : "days since you got back";
  }

  return (
    <div className={`countdown ${state}`}>
      <div className="countdown-num">{big}</div>
      <div className="countdown-label">
        {label}
        <span className="countdown-dates">
          {fmtDate(start)}{end ? ` → ${fmtDate(end)}` : ""}
          {state === "upcoming" && !isNaN(totalDays) && ` · ${totalDays} days`}
        </span>
      </div>
      <PhotoStack photos={photos} />
    </div>
  );
}

export default function OverviewTab({ detail, refresh }: { detail: TripDetail; refresh: () => Promise<void> }) {
  const { trip, legs, places } = detail;
  const photos = useMemo(() => landmarkPhotos(legs, places), [legs, places]);
  const [form, setForm] = useState({ ...trip });
  const [newLeg, setNewLeg] = useState({ city: "", country: "", arrive_date: "", depart_date: "" });
  const [expanded, setExpanded] = useState<number | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [overId, setOverId] = useState<number | null>(null);

  async function saveTrip() {
    await api.put(`/trips/${trip.id}`, {
      name: form.name, trip_type: form.trip_type, start_date: form.start_date || null,
      end_date: form.end_date || null, home_city: form.home_city,
      budget: form.budget === null || form.budget === ("" as any) ? null : Number(form.budget),
      currency: form.currency, notes: form.notes,
    });
    await refresh();
  }

  async function addLeg() {
    if (!newLeg.city) return;
    await api.post(`/trips/${trip.id}/legs`, {
      ...newLeg,
      arrive_date: newLeg.arrive_date || null,
      depart_date: newLeg.depart_date || null,
      seq: legs.length,
    });
    setNewLeg({ city: "", country: "", arrive_date: "", depart_date: "" });
    await refresh();
  }

  async function updateLeg(leg: Leg, patch: Partial<Leg>) {
    await api.put(`/legs/${leg.id}`, patch);
    await refresh();
  }

  async function deleteLeg(leg: Leg) {
    if (!window.confirm(`Remove leg ${leg.city}? Places stay but lose their city link.`)) return;
    await api.del(`/legs/${leg.id}`);
    await refresh();
  }

  // Reorders by renumbering every leg's seq 0..n-1 in the new order — simpler and more robust
  // than swapping pairs, since a drag can move an item past several others in one gesture.
  async function reorder(fromId: number, toId: number) {
    if (fromId === toId) return;
    const ids = legs.map((l) => l.id);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(toId);
    if (from === -1 || to === -1) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    await Promise.all(
      ids.map((id, i) => {
        const leg = legs.find((l) => l.id === id)!;
        return leg.seq !== i ? api.put(`/legs/${id}`, { seq: i }) : Promise.resolve();
      })
    );
    await refresh();
  }

  // Pointer Events cover mouse + touch + pen in one code path — no native HTML5 drag-and-drop,
  // whose touch support is inconsistent across mobile browsers.
  function startDrag(legId: number) {
    setDragId(legId);
    let currentOverId: number | null = null;

    function onMove(e: PointerEvent) {
      const cardEl = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>(
        "[data-leg-id]"
      );
      currentOverId = cardEl ? Number(cardEl.dataset.legId) : null;
      setOverId(currentOverId);
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setDragId(null);
      setOverId(null);
      if (currentOverId != null && currentOverId !== legId) void reorder(legId, currentOverId);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <div className="pad">
      {/* Driven by the form (not the saved trip) so it re-counts live as you pick dates. */}
      <Countdown start={form.start_date} end={form.end_date} photos={photos} />
      {/* Two independent groups — side by side once there's width for it, so a wide screen
          shows the whole trip without scrolling instead of stretching one long column. */}
      <div className="ov-cols">
      <section className="ov-col">
      <h2>Trip details</h2>
      <div className="form-grid">
        <label>Name <input dir="auto" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label>Type
          <select value={form.trip_type} onChange={(e) => setForm({ ...form, trip_type: e.target.value as any })}>
            <option value="round">Round trip</option>
            <option value="oneway">One-way</option>
            <option value="multicity">Multi-city</option>
          </select>
        </label>
        <label className="drp-label">Dates
          <DateRangePicker
            start={form.start_date} end={form.end_date}
            onChange={(s, e) => setForm({ ...form, start_date: s, end_date: e })}
          />
        </label>
        <label>Home city <input dir="auto" value={form.home_city ?? ""} onChange={(e) => setForm({ ...form, home_city: e.target.value })} /></label>
        <label>Budget <input type="number" value={form.budget ?? ""} onChange={(e) => setForm({ ...form, budget: e.target.value as any })} /></label>
        <label>Budget currency <CurrencySelect value={form.currency || "USD"} legs={legs} onChange={(c) => setForm({ ...form, currency: c })} /></label>
      </div>
      <label className="block">Notes
        <textarea dir="auto" rows={3} value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </label>
      <button className="primary" onClick={saveTrip}>Save trip</button>
      </section>

      <section className="ov-col">
      <h2>Legs (cities, in order)</h2>
      <div className="add-row leg-add-row">
        <div className="two-col">
          <label className="block">City
            <input dir="auto" placeholder="e.g. Seoul" value={newLeg.city} onChange={(e) => setNewLeg({ ...newLeg, city: e.target.value })} />
          </label>
          <label className="block">Country
            <input dir="auto" placeholder="e.g. South Korea" value={newLeg.country} onChange={(e) => setNewLeg({ ...newLeg, country: e.target.value })} />
          </label>
        </div>
        <label className="block">Dates
          <DateRangePicker
            start={newLeg.arrive_date || null} end={newLeg.depart_date || null}
            startLabel="Arrive" endLabel="Depart"
            onChange={(a, d) => setNewLeg({ ...newLeg, arrive_date: a || "", depart_date: d || "" })}
          />
        </label>
        <button className="primary" onClick={addLeg}>+ Add leg</button>
      </div>

      <div className="leg-list">
        {legs.map((l) => {
          const open = expanded === l.id;
          const isDragging = dragId === l.id;
          const isOver = overId === l.id && dragId !== l.id;
          return (
            <div
              key={l.id}
              data-leg-id={l.id}
              className={`leg-card${isDragging ? " dragging" : ""}${isOver ? " drag-over" : ""}`}
            >
              <div className="leg-head">
                <button
                  type="button" className="leg-drag-handle" aria-label="Drag to reorder"
                  onPointerDown={(e) => { e.preventDefault(); startDrag(l.id); }}
                ><GripVertical size={15} /></button>
                <button className="leg-summary" onClick={() => setExpanded(open ? null : l.id)}>
                  <span className="leg-chev">{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
                  <span className="grow leg-summary-text" dir="auto">
                    <strong>{l.city || "New leg"}</strong>
                    {l.country && <span className="hint"> · {l.country}</span>}
                  </span>
                  <span className="hint nowrap">{fmtRange(l.arrive_date, l.depart_date)}</span>
                </button>
              </div>
              {open && (
                <div className="leg-body">
                  <div className="two-col">
                    <label className="block">City
                      <input dir="auto" defaultValue={l.city} onBlur={(e) => e.target.value !== l.city && updateLeg(l, { city: e.target.value })} />
                    </label>
                    <label className="block">Country
                      <input dir="auto" defaultValue={l.country} onBlur={(e) => e.target.value !== l.country && updateLeg(l, { country: e.target.value })} />
                    </label>
                  </div>
                  <label className="block">Dates
                    <DateRangePicker
                      start={l.arrive_date} end={l.depart_date}
                      startLabel="Arrive" endLabel="Depart"
                      onChange={(a, d) => updateLeg(l, { arrive_date: a, depart_date: d })}
                    />
                  </label>
                  <div className="row spread">
                    <span />
                    <button className="danger small" onClick={() => deleteLeg(l)}>Delete leg</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {legs.length === 0 && <p className="hint">No legs yet — add your first city above.</p>}
      </div>
      <p className="hint">
        Tip: the leg a place belongs to decides which day-range it can be scheduled in. Drag the grip handle to
        reorder. A one-way or multi-city trip is just legs without a return — set the trip type above accordingly.
      </p>
      </section>
      </div>
    </div>
  );
}
