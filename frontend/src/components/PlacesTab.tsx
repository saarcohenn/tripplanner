import { useState } from "react";
import { api, gmapsLink } from "../api";
import type { Place, TripDetail } from "../types";

const CATEGORIES = ["sight", "food", "nature", "museum", "shopping", "nightlife", "other"];

export default function PlacesTab({ detail, refresh }: { detail: TripDetail; refresh: () => Promise<void> }) {
  const { trip, legs, places } = detail;
  const [form, setForm] = useState({ name: "", leg_id: "" as number | "", category: "sight", duration_min: 90, priority: "want", notes: "" });

  async function addPlace() {
    if (!form.name) return;
    await api.post(`/trips/${trip.id}/places`, { ...form, leg_id: form.leg_id === "" ? null : form.leg_id });
    setForm({ ...form, name: "", notes: "" });
    await refresh();
  }

  async function patch(p: Place, patchObj: Partial<Place>) {
    await api.put(`/places/${p.id}`, patchObj);
    await refresh();
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
  const groups: { label: string; items: Place[] }[] = [
    ...legs.map((l) => ({ label: `${l.city}${l.country ? `, ${l.country}` : ""}`, items: byLeg.get(l.id) || [] })),
    ...(byLeg.has(null) ? [{ label: "Unassigned", items: byLeg.get(null)! }] : []),
  ];

  return (
    <div className="pad">
      <h2>Places ({places.filter((p) => p.status === "active").length} active)</h2>
      <div className="add-row">
        <input dir="auto" placeholder="Place name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
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

      {groups.map((g) => (
        <div key={g.label}>
          <h3 dir="auto">{g.label}</h3>
          {g.items.length === 0 && <p className="hint">No places yet — add them here or from the Map tab.</p>}
          <table className="table">
            <tbody>
              {g.items.map((p) => (
                <tr key={p.id} className={p.status === "dropped" ? "dropped" : ""}>
                  <td dir="auto" className="grow"><strong>{p.name}</strong>{p.notes && <div className="hint" dir="auto">{p.notes}</div>}</td>
                  <td>
                    <select value={p.category} onChange={(e) => patch(p, { category: e.target.value })}>
                      {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                    </select>
                  </td>
                  <td>
                    <select value={p.priority} onChange={(e) => patch(p, { priority: e.target.value as any })}>
                      <option value="must">must</option><option value="want">want</option><option value="maybe">maybe</option>
                    </select>
                  </td>
                  <td className="nowrap">
                    <input type="number" value={p.duration_min} style={{ width: 60 }}
                      onChange={(e) => patch(p, { duration_min: Number(e.target.value) })} /> min
                  </td>
                  <td><a href={gmapsLink(p)} target="_blank" rel="noreferrer" title="Open in Google Maps">🗺️</a></td>
                  <td className="nowrap">
                    {p.status === "active"
                      ? <button className="small" title="Drop from plan (keep in list)" onClick={() => patch(p, { status: "dropped" })}>Drop</button>
                      : <button className="small" title="Restore to plan" onClick={() => patch(p, { status: "active" })}>Restore</button>}
                    <button className="danger small" onClick={() => remove(p)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
