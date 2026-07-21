import { useState } from "react";
import { api } from "../api";
import type { Leg, TripDetail } from "../types";
import CurrencySelect from "./CurrencySelect";

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

export default function OverviewTab({ detail, refresh }: { detail: TripDetail; refresh: () => Promise<void> }) {
  const { trip, legs } = detail;
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
        <label>Start <input type="date" value={form.start_date ?? ""} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></label>
        <label>End <input type="date" value={form.end_date ?? ""} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></label>
        <label>Home city <input dir="auto" value={form.home_city ?? ""} onChange={(e) => setForm({ ...form, home_city: e.target.value })} /></label>
        <label>Budget <input type="number" value={form.budget ?? ""} onChange={(e) => setForm({ ...form, budget: e.target.value as any })} /></label>
        <label>Budget currency <CurrencySelect value={form.currency || "USD"} legs={legs} onChange={(c) => setForm({ ...form, currency: c })} /></label>
      </div>
      <label className="block">Notes
        <textarea dir="auto" rows={3} value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </label>
      <button className="primary" onClick={saveTrip}>Save trip</button>

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
          <div className="row date-range">
            <input type="date" title="Arrival date" value={newLeg.arrive_date} onChange={(e) => setNewLeg({ ...newLeg, arrive_date: e.target.value })} />
            <span className="hint date-range-arrow">→</span>
            <input type="date" title="Departure date" value={newLeg.depart_date} onChange={(e) => setNewLeg({ ...newLeg, depart_date: e.target.value })} />
          </div>
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
                >⠿</button>
                <button className="leg-summary" onClick={() => setExpanded(open ? null : l.id)}>
                  <span className="leg-chev">{open ? "▾" : "▸"}</span>
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
                    <div className="row date-range">
                      <input type="date" defaultValue={l.arrive_date ?? ""} onBlur={(e) => e.target.value !== (l.arrive_date ?? "") && updateLeg(l, { arrive_date: e.target.value || null })} />
                      <span className="hint date-range-arrow">→</span>
                      <input type="date" defaultValue={l.depart_date ?? ""} onBlur={(e) => e.target.value !== (l.depart_date ?? "") && updateLeg(l, { depart_date: e.target.value || null })} />
                    </div>
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
        Tip: the leg a place belongs to decides which day-range it can be scheduled in. Drag the ⠿ handle to
        reorder. A one-way or multi-city trip is just legs without a return — set the trip type above accordingly.
      </p>
    </div>
  );
}
