import { useState } from "react";
import { ChevronDown, ChevronRight, GripVertical } from "lucide-react";
import { airportCode } from "../airports";
import { api } from "../api";
import type { Leg, TripDetail } from "../types";
import BoardingPass from "./BoardingPass";
import CurrencySelect from "./CurrencySelect";
import DateRangePicker from "./DateRangePicker";
import TimeField from "./TimeField";

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
  const { trip, legs, places } = detail;
  const [form, setForm] = useState({ ...trip });
  const [newLeg, setNewLeg] = useState({ city: "", country: "", arrive_date: "", depart_date: "" });
  const [expanded, setExpanded] = useState<number | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [overId, setOverId] = useState<number | null>(null);

  async function saveTrip() {
    await api.put(`/trips/${trip.id}`, {
      name: form.name, trip_type: form.trip_type, start_date: form.start_date || null,
      end_date: form.end_date || null, home_city: form.home_city,
      home_airport: (form.home_airport || "").trim().toUpperCase(),
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
    <div className="pad wide">
      {/* Driven by the form (not the saved trip) so it re-counts live as you pick dates. */}
      <BoardingPass trip={form} legs={legs} places={places} />
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
        <label>Home airport
          <input
            dir="ltr" maxLength={3} className="code-input"
            placeholder={airportCode(form.home_city ?? "", "", null) ?? "e.g. TLV"}
            value={form.home_airport ?? ""}
            onChange={(e) => setForm({ ...form, home_airport: e.target.value.toUpperCase() })}
          />
        </label>
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
                  <label className="block">Airport code
                    <input
                      dir="ltr" maxLength={3} className="code-input"
                      placeholder={airportCode(l.city, l.country, null) ?? "e.g. ICN"}
                      defaultValue={l.airport ?? ""}
                      onBlur={(e) => {
                        const v = e.target.value.trim().toUpperCase();
                        if (v !== (l.airport ?? "")) updateLeg(l, { airport: v });
                      }}
                    />
                    <span className="hint">Shown on the boarding pass. Left blank, the app uses the code it knows for this city — and shows none rather than guessing.</span>
                  </label>
                  <label className="block">Dates
                    <DateRangePicker
                      start={l.arrive_date} end={l.depart_date}
                      startLabel="Arrive" endLabel="Depart"
                      onChange={(a, d) => updateLeg(l, { arrive_date: a, depart_date: d })}
                    />
                  </label>
                  {/* Local time in this city. Optional — the planner only uses a time you give it. */}
                  <div className="two-col">
                    <label className="block">Lands at
                      <TimeField
                        value={l.arrive_time} label={`Lands at, ${l.city}`}
                        onSave={(v) => updateLeg(l, { arrive_time: v })}
                      />
                    </label>
                    <label className="block">Leaves at
                      <TimeField
                        value={l.depart_time} label={`Leaves at, ${l.city}`}
                        onSave={(v) => updateLeg(l, { depart_time: v })}
                      />
                    </label>
                  </div>
                  <p className="hint">
                    Local times, both optional. Given one, the plan sizes that day around it — a late
                    landing becomes transfer and rest instead of sightseeing, an early departure sets
                    the last morning's alarm. Left blank, the day is planned as a normal full one.
                  </p>
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
