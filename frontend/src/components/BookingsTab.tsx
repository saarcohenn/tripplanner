import { useEffect, useState } from "react";
import { api } from "../api";
import type { Booking, Leg, TripDetail } from "../types";
import CurrencySelect from "./CurrencySelect";
import { fmtMoney } from "../currencies";

const KINDS = ["flight", "stay", "train", "bus", "ferry", "car", "activity", "other"];
const KIND_ICON: Record<string, string> = {
  flight: "✈️", stay: "🏨", train: "🚆", bus: "🚌", ferry: "⛴️", car: "🚗", activity: "🎟️", other: "📌",
};

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

export default function BookingsTab({ detail, refresh, homeCurrency }: {
  detail: TripDetail;
  refresh: () => Promise<void>;
  homeCurrency: string | null;
}) {
  const { trip, legs, bookings } = detail;
  const [form, setForm] = useState({
    kind: "stay", title: "", leg_id: "" as number | "", date: "", end_date: "",
    cost: "", currency: trip.currency || "USD", url: "", notes: "",
  });
  const [expanded, setExpanded] = useState<number | null>(null);
  const [rates, setRates] = useState<Record<string, number> | null>(null);

  const home = homeCurrency || trip.currency || "USD";
  useEffect(() => {
    api.get<{ rates: Record<string, number> }>(`/fx/${home}`).then((r) => setRates(r.rates)).catch(() => setRates(null));
  }, [home]);

  /** Convert an amount to the home currency; null when the rate isn't available. */
  function toHome(amount: number, currency: string): number | null {
    if (currency === home) return amount;
    const rate = rates?.[currency];
    return rate ? amount / rate : null;
  }

  async function add() {
    if (!form.title) return;
    await api.post(`/trips/${trip.id}/bookings`, {
      ...form,
      leg_id: form.leg_id === "" ? null : form.leg_id,
      date: form.date || null,
      end_date: form.end_date || null,
      cost: form.cost === "" ? null : Number(form.cost),
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

  const legName = new Map(legs.map((l) => [l.id, l.city]));
  const totalHome = bookings.reduce((s, b) => s + (b.cost != null ? toHome(b.cost, b.currency) ?? 0 : 0), 0);
  const anyUnconverted = bookings.some((b) => b.cost != null && toHome(b.cost, b.currency) == null);

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

      <h2>
        Bookings
        {totalHome > 0 && <span className="hint"> — total ≈ {fmtMoney(totalHome, home)}{anyUnconverted ? " (some rates unavailable)" : ""}</span>}
      </h2>
      <div className="add-row">
        <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select>
        <input dir="auto" placeholder="Title (e.g. TLV→ICN Korean Air)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <select value={form.leg_id} onChange={(e) => setForm({ ...form, leg_id: e.target.value === "" ? "" : Number(e.target.value) })}>
          <option value="">🌍 Trip-wide</option>
          {legs.map((l) => <option key={l.id} value={l.id}>{l.city}</option>)}
        </select>
        <input type="date" title="Date / check-in" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        <input type="date" title="Check-out" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
        <input type="number" placeholder="Cost" style={{ width: 90 }} value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
        <CurrencySelect value={form.currency} legs={legs} onChange={(c) => setForm({ ...form, currency: c })} />
        <button className="primary" onClick={add}>Add</button>
      </div>

      {bookings.map((b) => {
        const open = expanded === b.id;
        const converted = b.cost != null ? toHome(b.cost, b.currency) : null;
        return (
          <div className="bcard" key={b.id}>
            <button className="bcard-head" onClick={() => setExpanded(open ? null : b.id)}>
              <span className="bcard-chev">{open ? "▾" : "▸"}</span>
              <span title={b.kind}>{KIND_ICON[b.kind] || "📌"}</span>
              <span className="grow bcard-title" dir="auto">
                {b.source === "ai" && <span title="Extracted by AI from your conversation">✨ </span>}
                {b.title}
              </span>
              <span className="hint" dir="auto">{(b.leg_id != null && legName.get(b.leg_id)) || "🌍"}</span>
              <span className="bcard-cost nowrap">{b.cost != null ? `${b.cost} ${b.currency}` : ""}</span>
            </button>
            {open && (
              <div className="bcard-body">
                <div className="row wrap">
                  <label className="block">Type
                    <select value={b.kind} onChange={(e) => patch(b, { kind: e.target.value })}>
                      {KINDS.map((k) => <option key={k}>{k}</option>)}
                    </select>
                  </label>
                  <label className="block">Title
                    <input dir="auto" defaultValue={b.title} onBlur={(e) => e.target.value !== b.title && patch(b, { title: e.target.value })} />
                  </label>
                  <label className="block">City
                    <select value={b.leg_id ?? ""} onChange={(e) => patch(b, { leg_id: e.target.value === "" ? null : Number(e.target.value) })}>
                      <option value="">🌍 Trip-wide</option>
                      {legs.map((l) => <option key={l.id} value={l.id}>{l.city}</option>)}
                    </select>
                  </label>
                </div>
                <label className="block">Comment {b.source === "ai" && <span title="Extracted by AI — double-check it">✨</span>}
                  <input dir="auto" placeholder="Notes about this booking…" defaultValue={b.notes}
                    onBlur={(e) => e.target.value !== b.notes && patch(b, { notes: e.target.value })} />
                </label>
                <div className="row wrap">
                  <label className="block">Date / check-in
                    <input type="date" defaultValue={b.date ?? ""} onBlur={(e) => e.target.value !== (b.date ?? "") && patch(b, { date: e.target.value || null })} />
                  </label>
                  <label className="block">Check-out
                    <input type="date" defaultValue={b.end_date ?? ""} onBlur={(e) => e.target.value !== (b.end_date ?? "") && patch(b, { end_date: e.target.value || null })} />
                  </label>
                  <label className="block">Cost
                    <div className="row">
                      <input type="number" style={{ width: 100 }} defaultValue={b.cost ?? ""}
                        onBlur={(e) => e.target.value !== String(b.cost ?? "") && patch(b, { cost: e.target.value === "" ? null : Number(e.target.value) })} />
                      <CurrencySelect value={b.currency} legs={legs} onChange={(c) => patch(b, { currency: c })} />
                    </div>
                  </label>
                </div>
                {b.cost != null && b.currency !== home && (
                  <p className="hint">≈ {converted != null ? fmtMoney(converted, home) : "rate unavailable"} in {home} at today's rate</p>
                )}
                <div className="row wrap">
                  <label className="block">URL
                    <input placeholder="https://…" defaultValue={b.url} onBlur={(e) => e.target.value !== b.url && patch(b, { url: e.target.value })} />
                  </label>
                  <label className="block">Ref / phone
                    <input dir="auto" placeholder="Confirmation no., phone…" defaultValue={b.ref}
                      onBlur={(e) => e.target.value !== b.ref && patch(b, { ref: e.target.value })} />
                  </label>
                </div>
                <div className="row spread">
                  {b.url ? <a href={b.url} target="_blank" rel="noreferrer">Open booking ↗</a> : <span />}
                  <button className="danger small" onClick={() => remove(b)}>Delete booking</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
      {bookings.length === 0 && <p className="hint">No bookings recorded yet.</p>}
      {bookings.length > 0 && <p className="hint">Click a row to expand and edit. ✨ marks AI-extracted entries.</p>}
    </div>
  );
}
