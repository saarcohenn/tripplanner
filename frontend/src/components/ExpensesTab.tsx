import { useState } from "react";
import { api } from "../api";
import type { Expense, TripDetail } from "../types";

const CATS = ["flights", "food", "transport", "lodging", "activities", "shopping", "other"] as const;
const CAT_COLORS: Record<string, string> = {
  flights: "#e86431", food: "#e8412f", transport: "#e88005", lodging: "#b4652e",
  activities: "#f0a41c", shopping: "#c93b6e", other: "#a5917c",
};

/** Booked items count toward the same categories as manual expenses. */
const BOOKING_KIND_CAT: Record<string, string> = {
  flight: "flights", stay: "lodging", train: "transport", bus: "transport",
  ferry: "transport", car: "transport", activity: "activities", other: "other",
};

export default function ExpensesTab({ detail, refresh }: { detail: TripDetail; refresh: () => Promise<void> }) {
  const { trip, legs, expenses, bookings } = detail;
  const [form, setForm] = useState({ title: "", amount: "", category: "food", leg_id: "" as number | "", date: "", notes: "" });

  async function add() {
    if (!form.title || form.amount === "") return;
    await api.post(`/trips/${trip.id}/expenses`, {
      ...form,
      amount: Number(form.amount),
      leg_id: form.leg_id === "" ? null : form.leg_id,
      date: form.date || null,
      currency: trip.currency,
    });
    setForm({ ...form, title: "", amount: "", notes: "" });
    await refresh();
  }

  async function remove(e: Expense) {
    await api.del(`/expenses/${e.id}`);
    await refresh();
  }

  const bookingsTotal = bookings.reduce((s, b) => s + (b.cost || 0), 0);
  const expensesTotal = expenses.reduce((s, e) => s + e.amount, 0);
  const grandTotal = bookingsTotal + expensesTotal;

  const byCategory: Record<string, number> = {};
  for (const e of expenses) byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
  for (const b of bookings) {
    if (!b.cost) continue;
    const cat = BOOKING_KIND_CAT[b.kind] || "other";
    byCategory[cat] = (byCategory[cat] || 0) + b.cost;
  }

  const byCity: Record<string, number> = {};
  const legName = new Map(legs.map((l) => [l.id, l.city]));
  for (const e of expenses) {
    const city = (e.leg_id != null && legName.get(e.leg_id)) || "🌍 Trip-wide";
    byCity[city] = (byCity[city] || 0) + e.amount;
  }
  for (const b of bookings) {
    if (!b.cost) continue;
    const city = (b.leg_id != null && legName.get(b.leg_id)) || "🌍 Trip-wide";
    byCity[city] = (byCity[city] || 0) + b.cost;
  }

  const budget = trip.budget || 0;
  const maxCat = Math.max(1, ...Object.values(byCategory));

  return (
    <div className="pad">
      <h2>Summary</h2>
      <div className="exp-summary">
        <div className="exp-stat">
          <div className="exp-num">{grandTotal.toFixed(0)} {trip.currency}</div>
          <div className="hint">spent total (incl. bookings)</div>
        </div>
        {budget > 0 && (
          <div className="exp-stat grow">
            <div className="budget-bar">
              <div
                className={`budget-fill ${grandTotal > budget ? "over" : ""}`}
                style={{ width: `${Math.min(100, (grandTotal / budget) * 100)}%` }}
              />
            </div>
            <div className="hint">
              {((grandTotal / budget) * 100).toFixed(0)}% of {budget.toFixed(0)} {trip.currency} budget
              {grandTotal > budget && <strong className="over-text"> — {(grandTotal - budget).toFixed(0)} over!</strong>}
            </div>
          </div>
        )}
      </div>

      <div className="exp-breakdowns">
        <div>
          <h3>By category</h3>
          {Object.entries(byCategory).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => (
            <div className="exp-row" key={cat}>
              <span className="exp-label">{cat}</span>
              <div className="exp-bar-track">
                <div className="exp-bar" style={{ width: `${(amt / maxCat) * 100}%`, background: CAT_COLORS[cat] }} />
              </div>
              <span className="exp-amt">{amt.toFixed(0)}</span>
            </div>
          ))}
          {Object.keys(byCategory).length === 0 && <p className="hint">Nothing yet.</p>}
        </div>
        <div>
          <h3>By city</h3>
          {Object.entries(byCity).sort((a, b) => b[1] - a[1]).map(([city, amt]) => (
            <div className="exp-row" key={city}>
              <span className="exp-label" dir="auto">{city}</span>
              <div className="exp-bar-track">
                <div className="exp-bar" style={{ width: `${(amt / Math.max(1, ...Object.values(byCity))) * 100}%` }} />
              </div>
              <span className="exp-amt">{amt.toFixed(0)}</span>
            </div>
          ))}
          {Object.keys(byCity).length === 0 && <p className="hint">Nothing yet.</p>}
        </div>
      </div>
      <p className="hint">
        Flights and other whole-trip costs don't belong to one city — leave the city as "🌍 Trip-wide".
        Works the same for round trips from home (e.g. TLV) and for one-way backpacking routes.
      </p>

      <h2>Expenses</h2>
      <div className="add-row">
        <input dir="auto" placeholder="What did you pay for?" value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })} onKeyDown={(e) => e.key === "Enter" && add()} />
        <input type="number" placeholder={`Amount (${trip.currency})`} style={{ width: 110 }} value={form.amount}
          onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
          {CATS.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select value={form.leg_id} onChange={(e) => setForm({ ...form, leg_id: e.target.value === "" ? "" : Number(e.target.value) })}>
          <option value="">🌍 Trip-wide (flights, insurance…)</option>
          {legs.map((l) => <option key={l.id} value={l.id}>{l.city}</option>)}
        </select>
        <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        <button className="primary" onClick={add}>Add</button>
      </div>
      <table className="table">
        <tbody>
          {expenses.map((e) => (
            <tr key={e.id}>
              <td className="nowrap hint">{e.date || "—"}</td>
              <td dir="auto" className="grow">{e.title}{e.notes && <div className="hint" dir="auto">{e.notes}</div>}</td>
              <td><span className="chip" style={{ color: CAT_COLORS[e.category] }}>{e.category}</span></td>
              <td dir="auto" className="hint">{(e.leg_id != null && legName.get(e.leg_id)) || ""}</td>
              <td className="nowrap"><strong>{e.amount.toFixed(0)} {e.currency}</strong></td>
              <td><button className="danger small" onClick={() => remove(e)}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {expenses.length === 0 && <p className="hint">No expenses recorded yet. Booking costs from the Bookings tab are included in the summary automatically.</p>}
    </div>
  );
}
