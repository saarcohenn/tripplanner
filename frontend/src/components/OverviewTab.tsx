import { useState } from "react";
import { api } from "../api";
import type { Leg, TripDetail } from "../types";

export default function OverviewTab({ detail, refresh }: { detail: TripDetail; refresh: () => Promise<void> }) {
  const { trip, legs } = detail;
  const [form, setForm] = useState({ ...trip });
  const [newLeg, setNewLeg] = useState({ city: "", country: "", arrive_date: "", depart_date: "" });

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

  async function moveLeg(idx: number, dir: -1 | 1) {
    const other = legs[idx + dir];
    if (!other) return;
    await api.put(`/legs/${legs[idx].id}`, { seq: other.seq });
    await api.put(`/legs/${other.id}`, { seq: legs[idx].seq });
    await refresh();
  }

  async function deleteLeg(leg: Leg) {
    if (!window.confirm(`Remove leg ${leg.city}? Places stay but lose their city link.`)) return;
    await api.del(`/legs/${leg.id}`);
    await refresh();
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
        <label>Currency <input value={form.currency ?? ""} onChange={(e) => setForm({ ...form, currency: e.target.value })} /></label>
      </div>
      <label className="block">Notes
        <textarea dir="auto" rows={3} value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </label>
      <button className="primary" onClick={saveTrip}>Save trip</button>

      <h2>Legs (cities, in order)</h2>
      <table className="table">
        <thead><tr><th></th><th>City</th><th>Country</th><th>Arrive</th><th>Depart</th><th></th></tr></thead>
        <tbody>
          {legs.map((l, i) => (
            <tr key={l.id}>
              <td className="nowrap">
                <button className="small" disabled={i === 0} onClick={() => moveLeg(i, -1)}>↑</button>
                <button className="small" disabled={i === legs.length - 1} onClick={() => moveLeg(i, 1)}>↓</button>
              </td>
              <td><input dir="auto" defaultValue={l.city} onBlur={(e) => e.target.value !== l.city && updateLeg(l, { city: e.target.value })} /></td>
              <td><input dir="auto" defaultValue={l.country} onBlur={(e) => e.target.value !== l.country && updateLeg(l, { country: e.target.value })} /></td>
              <td><input type="date" defaultValue={l.arrive_date ?? ""} onBlur={(e) => e.target.value !== (l.arrive_date ?? "") && updateLeg(l, { arrive_date: e.target.value || null })} /></td>
              <td><input type="date" defaultValue={l.depart_date ?? ""} onBlur={(e) => e.target.value !== (l.depart_date ?? "") && updateLeg(l, { depart_date: e.target.value || null })} /></td>
              <td><button className="danger small" onClick={() => deleteLeg(l)}>✕</button></td>
            </tr>
          ))}
          <tr>
            <td>＋</td>
            <td><input dir="auto" placeholder="City" value={newLeg.city} onChange={(e) => setNewLeg({ ...newLeg, city: e.target.value })} /></td>
            <td><input dir="auto" placeholder="Country" value={newLeg.country} onChange={(e) => setNewLeg({ ...newLeg, country: e.target.value })} /></td>
            <td><input type="date" value={newLeg.arrive_date} onChange={(e) => setNewLeg({ ...newLeg, arrive_date: e.target.value })} /></td>
            <td><input type="date" value={newLeg.depart_date} onChange={(e) => setNewLeg({ ...newLeg, depart_date: e.target.value })} /></td>
            <td><button className="primary small" onClick={addLeg}>Add</button></td>
          </tr>
        </tbody>
      </table>
      <p className="hint">Tip: the leg a place belongs to decides which day-range it can be scheduled in. A one-way or multi-city trip is just legs without a return — set the trip type above accordingly.</p>
    </div>
  );
}
