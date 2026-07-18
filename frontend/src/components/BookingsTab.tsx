import { useState } from "react";
import { api } from "../api";
import type { Booking, Leg, TripDetail } from "../types";

const KINDS = ["flight", "stay", "train", "bus", "ferry", "car", "activity", "other"];

function bookingUrl(leg: Leg) {
  const p = new URLSearchParams({ ss: `${leg.city}${leg.country ? `, ${leg.country}` : ""}` });
  if (leg.arrive_date) p.set("checkin", leg.arrive_date);
  if (leg.depart_date) p.set("checkout", leg.depart_date);
  return `https://www.booking.com/searchresults.html?${p.toString()}`;
}

function airbnbUrl(leg: Leg) {
  const p = new URLSearchParams();
  if (leg.arrive_date) p.set("checkin", leg.arrive_date);
  if (leg.depart_date) p.set("checkout", leg.depart_date);
  const q = p.toString();
  return `https://www.airbnb.com/s/${encodeURIComponent(`${leg.city}${leg.country ? `--${leg.country}` : ""}`)}/homes${q ? `?${q}` : ""}`;
}

export default function BookingsTab({ detail, refresh }: { detail: TripDetail; refresh: () => Promise<void> }) {
  const { trip, legs, bookings } = detail;
  const [form, setForm] = useState({ kind: "stay", title: "", leg_id: "" as number | "", date: "", end_date: "", cost: "", url: "", notes: "" });

  async function add() {
    if (!form.title) return;
    await api.post(`/trips/${trip.id}/bookings`, {
      ...form,
      leg_id: form.leg_id === "" ? null : form.leg_id,
      date: form.date || null,
      end_date: form.end_date || null,
      cost: form.cost === "" ? null : Number(form.cost),
      currency: trip.currency,
    });
    setForm({ ...form, title: "", date: "", end_date: "", cost: "", url: "", notes: "" });
    await refresh();
  }

  async function patch(b: Booking, patchObj: Partial<Booking>) {
    await api.put(`/bookings/${b.id}`, patchObj);
    await refresh();
  }

  async function remove(b: Booking) {
    if (!window.confirm(`Delete booking "${b.title}"?`)) return;
    await api.del(`/bookings/${b.id}`);
    await refresh();
  }

  const total = bookings.reduce((s, b) => s + (b.cost || 0), 0);

  return (
    <div className="pad">
      <h2>Find a stay</h2>
      <p className="hint">Opens Booking.com / Airbnb pre-filled with each city and your leg dates. Paste the reservation back below once you book.</p>
      <table className="table">
        <tbody>
          {legs.map((l) => (
            <tr key={l.id}>
              <td dir="auto"><strong>{l.city}</strong> <span className="hint">{l.arrive_date} → {l.depart_date}</span></td>
              <td><a className="linkbtn" href={bookingUrl(l)} target="_blank" rel="noreferrer">Booking.com ↗</a></td>
              <td><a className="linkbtn" href={airbnbUrl(l)} target="_blank" rel="noreferrer">Airbnb ↗</a></td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Bookings {total > 0 && <span className="hint">— total {total.toFixed(0)} {trip.currency}</span>}</h2>
      <div className="add-row">
        <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select>
        <input dir="auto" placeholder="Title (e.g. TLV→ICN Korean Air)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <select value={form.leg_id} onChange={(e) => setForm({ ...form, leg_id: e.target.value === "" ? "" : Number(e.target.value) })}>
          <option value="">City…</option>
          {legs.map((l) => <option key={l.id} value={l.id}>{l.city}</option>)}
        </select>
        <input type="date" title="Date / check-in" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        <input type="date" title="Check-out" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
        <input type="number" placeholder="Cost" style={{ width: 80 }} value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
        <input placeholder="URL" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
        <button className="primary" onClick={add}>Add</button>
      </div>
      <table className="table">
        <tbody>
          {bookings.map((b) => (
            <tr key={b.id}>
              <td>
                <select value={b.kind} onChange={(e) => patch(b, { kind: e.target.value })}>
                  {KINDS.map((k) => <option key={k}>{k}</option>)}
                </select>
              </td>
              <td dir="auto" className="grow">
                <div className="row">
                  <input dir="auto" className="grow" defaultValue={b.title}
                    onBlur={(e) => e.target.value !== b.title && patch(b, { title: e.target.value })} />
                  {b.url && <a href={b.url} target="_blank" rel="noreferrer" title="Open booking">↗</a>}
                </div>
                <div className="row" style={{ marginTop: 4 }}>
                  {b.source === "ai" && <span title="Extracted by AI from your conversation — double-check it">✨</span>}
                  <input dir="auto" className="grow subtle" placeholder="Comment…" defaultValue={b.notes}
                    onBlur={(e) => e.target.value !== b.notes && patch(b, { notes: e.target.value })} />
                </div>
              </td>
              <td>
                <select value={b.leg_id ?? ""} onChange={(e) => patch(b, { leg_id: e.target.value === "" ? null : Number(e.target.value) })}>
                  <option value="">🌍</option>
                  {legs.map((l) => <option key={l.id} value={l.id}>{l.city}</option>)}
                </select>
              </td>
              <td><input type="date" defaultValue={b.date ?? ""} onBlur={(e) => e.target.value !== (b.date ?? "") && patch(b, { date: e.target.value || null })} /></td>
              <td><input type="date" defaultValue={b.end_date ?? ""} onBlur={(e) => e.target.value !== (b.end_date ?? "") && patch(b, { end_date: e.target.value || null })} /></td>
              <td>
                <input type="number" style={{ width: 80 }} placeholder="Cost" defaultValue={b.cost ?? ""}
                  onBlur={(e) => e.target.value !== String(b.cost ?? "") && patch(b, { cost: e.target.value === "" ? null : Number(e.target.value) })} /> {b.currency}
              </td>
              <td><input placeholder="URL" style={{ width: 90 }} defaultValue={b.url}
                onBlur={(e) => e.target.value !== b.url && patch(b, { url: e.target.value })} /></td>
              <td><button className="danger small" onClick={() => remove(b)}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {bookings.length === 0 && <p className="hint">No bookings recorded yet.</p>}
      {bookings.length > 0 && <p className="hint">Click any field to edit — changes save when you leave the field. ✨ marks AI-extracted entries.</p>}
    </div>
  );
}
