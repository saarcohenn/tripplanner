import { useEffect, useState } from "react";
import { api } from "../api";
import type { Expense, TripDetail } from "../types";
import CurrencySelect from "./CurrencySelect";
import { fmtMoney } from "../currencies";

const CATS = ["flights", "food", "transport", "lodging", "activities", "shopping", "other"] as const;
const CAT_COLORS: Record<string, string> = {
  flights: "#e86431", food: "#e8412f", transport: "#e88005", lodging: "#b4652e",
  activities: "#f0a41c", shopping: "#c93b6e", other: "#a5917c",
};
const CAT_ICON: Record<string, string> = {
  flights: "✈️", food: "🍽️", transport: "🚆", lodging: "🏨", activities: "🎟️", shopping: "🛍️", other: "💳",
};

/** Booked items count toward the same categories as manual expenses. */
const BOOKING_KIND_CAT: Record<string, string> = {
  flight: "flights", stay: "lodging", train: "transport", bus: "transport",
  ferry: "transport", car: "transport", activity: "activities", other: "other",
};

export default function ExpensesTab({ detail, refresh, homeCurrency }: {
  detail: TripDetail;
  refresh: () => Promise<void>;
  homeCurrency: string | null;
}) {
  const { trip, legs, expenses, bookings } = detail;
  const [form, setForm] = useState({
    title: "", amount: "", category: "food", leg_id: "" as number | "",
    date: "", notes: "", currency: trip.currency || "USD",
  });
  const [expanded, setExpanded] = useState<number | null>(null);
  const [rates, setRates] = useState<Record<string, number> | null>(null);

  const home = homeCurrency || trip.currency || "USD";
  useEffect(() => {
    api.get<{ rates: Record<string, number> }>(`/fx/${home}`).then((r) => setRates(r.rates)).catch(() => setRates(null));
  }, [home]);

  /** Convert to home currency; falls back to the raw amount when the rate is unknown. */
  function toHome(amount: number, currency: string): { value: number; exact: boolean } {
    if (currency === home) return { value: amount, exact: true };
    const rate = rates?.[currency];
    return rate ? { value: amount / rate, exact: true } : { value: amount, exact: false };
  }

  async function add() {
    if (!form.title || form.amount === "") return;
    await api.post(`/trips/${trip.id}/expenses`, {
      ...form,
      amount: Number(form.amount),
      leg_id: form.leg_id === "" ? null : form.leg_id,
      date: form.date || null,
    });
    setForm({ ...form, title: "", amount: "", notes: "" });
    await refresh();
  }

  async function patch(e: Expense, patchObj: Partial<Expense>) {
    await api.put(`/expenses/${e.id}`, patchObj);
    await refresh();
  }

  async function remove(e: Expense) {
    await api.del(`/expenses/${e.id}`);
    await refresh();
  }

  const legName = new Map(legs.map((l) => [l.id, l.city]));

  let anyInexact = false;
  const conv = (amount: number, currency: string) => {
    const r = toHome(amount, currency);
    if (!r.exact) anyInexact = true;
    return r.value;
  };

  const expensesTotal = expenses.reduce((s, e) => s + conv(e.amount, e.currency), 0);
  const bookingsTotal = bookings.reduce((s, b) => s + (b.cost != null ? conv(b.cost, b.currency) : 0), 0);
  const grandTotal = expensesTotal + bookingsTotal;

  const byCategory: Record<string, number> = {};
  for (const e of expenses) byCategory[e.category] = (byCategory[e.category] || 0) + conv(e.amount, e.currency);
  for (const b of bookings) {
    if (!b.cost) continue;
    const cat = BOOKING_KIND_CAT[b.kind] || "other";
    byCategory[cat] = (byCategory[cat] || 0) + conv(b.cost, b.currency);
  }

  const byCity: Record<string, number> = {};
  for (const e of expenses) {
    const city = (e.leg_id != null && legName.get(e.leg_id)) || "🌍 Trip-wide";
    byCity[city] = (byCity[city] || 0) + conv(e.amount, e.currency);
  }
  for (const b of bookings) {
    if (!b.cost) continue;
    const city = (b.leg_id != null && legName.get(b.leg_id)) || "🌍 Trip-wide";
    byCity[city] = (byCity[city] || 0) + conv(b.cost, b.currency);
  }

  const budgetHome = trip.budget ? toHome(trip.budget, trip.currency || home).value : 0;
  const maxCat = Math.max(1, ...Object.values(byCategory));

  return (
    <div className="pad">
      <h2>Summary <span className="hint">— everything converted to {home} at today's rate</span></h2>
      <div className="exp-summary">
        <div className="exp-stat">
          <div className="exp-num">{fmtMoney(grandTotal, home)}</div>
          <div className="hint">spent total (incl. bookings){anyInexact ? " — some rates unavailable, raw amounts used" : ""}</div>
        </div>
        {budgetHome > 0 && (
          <div className="exp-stat grow">
            <div className="budget-bar">
              <div
                className={`budget-fill ${grandTotal > budgetHome ? "over" : ""}`}
                style={{ width: `${Math.min(100, (grandTotal / budgetHome) * 100)}%` }}
              />
            </div>
            <div className="hint">
              {((grandTotal / budgetHome) * 100).toFixed(0)}% of {fmtMoney(budgetHome, home)} budget
              {trip.currency !== home && ` (${trip.budget} ${trip.currency})`}
              {grandTotal > budgetHome && <strong className="over-text"> — {fmtMoney(grandTotal - budgetHome, home)} over!</strong>}
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
              <span className="exp-amt">{fmtMoney(amt, home)}</span>
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
              <span className="exp-amt">{fmtMoney(amt, home)}</span>
            </div>
          ))}
          {Object.keys(byCity).length === 0 && <p className="hint">Nothing yet.</p>}
        </div>
      </div>

      <h2>Expenses</h2>
      <div className="add-row exp-add-row">
        <label className="block">What did you pay for?
          <input dir="auto" placeholder="e.g. Dinner in Gion" value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })} onKeyDown={(e) => e.key === "Enter" && add()} />
        </label>
        <label className="block">Amount
          <div className="row amount-row">
            <input type="number" placeholder="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            <CurrencySelect value={form.currency} legs={legs} onChange={(c) => setForm({ ...form, currency: c })} />
          </div>
        </label>
        <div className="two-col">
          <label className="block">Category
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {CATS.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label className="block">City
            <select value={form.leg_id} onChange={(e) => setForm({ ...form, leg_id: e.target.value === "" ? "" : Number(e.target.value) })}>
              <option value="">🌍 Trip-wide</option>
              {legs.map((l) => <option key={l.id} value={l.id}>{l.city}</option>)}
            </select>
          </label>
        </div>
        <label className="block">Date
          <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        </label>
        <button className="primary" onClick={add}>+ Add expense</button>
      </div>

      <div className="leg-list">
        {expenses.map((e) => {
          const open = expanded === e.id;
          const c = toHome(e.amount, e.currency);
          return (
            <div className="bcard" key={e.id}>
              <button className="bcard-head" onClick={() => setExpanded(open ? null : e.id)}>
                <span className="bcard-chev">{open ? "▾" : "▸"}</span>
                <span title={e.category}>{CAT_ICON[e.category] || "💳"}</span>
                <span className="grow bcard-title" dir="auto">{e.title}</span>
                <span className="hint" dir="auto">{(e.leg_id != null && legName.get(e.leg_id)) || "🌍"}</span>
                <span className="bcard-cost nowrap">{fmtMoney(e.amount, e.currency)}</span>
              </button>
              {open && (
                <div className="bcard-body">
                  <label className="block">What did you pay for?
                    <input dir="auto" defaultValue={e.title} onBlur={(ev) => ev.target.value !== e.title && patch(e, { title: ev.target.value })} />
                  </label>
                  <label className="block">Amount
                    <div className="row amount-row">
                      <input type="number" defaultValue={e.amount}
                        onBlur={(ev) => ev.target.value !== "" && Number(ev.target.value) !== e.amount && patch(e, { amount: Number(ev.target.value) })} />
                      <CurrencySelect value={e.currency} legs={legs} onChange={(code) => patch(e, { currency: code })} />
                    </div>
                  </label>
                  {e.currency !== home && (
                    <p className="hint">≈ {c.exact ? fmtMoney(c.value, home) : "rate unavailable"} in {home} at today's rate</p>
                  )}
                  <div className="two-col">
                    <label className="block">Category
                      <select value={e.category} onChange={(ev) => patch(e, { category: ev.target.value })}>
                        {CATS.map((cat) => <option key={cat}>{cat}</option>)}
                      </select>
                    </label>
                    <label className="block">City
                      <select value={e.leg_id ?? ""} onChange={(ev) => patch(e, { leg_id: ev.target.value === "" ? null : Number(ev.target.value) })}>
                        <option value="">🌍 Trip-wide</option>
                        {legs.map((l) => <option key={l.id} value={l.id}>{l.city}</option>)}
                      </select>
                    </label>
                  </div>
                  <label className="block">Date
                    <input type="date" defaultValue={e.date ?? ""} onBlur={(ev) => ev.target.value !== (e.date ?? "") && patch(e, { date: ev.target.value || null })} />
                  </label>
                  <label className="block">Notes
                    <input dir="auto" placeholder="Optional notes…" defaultValue={e.notes}
                      onBlur={(ev) => ev.target.value !== e.notes && patch(e, { notes: ev.target.value })} />
                  </label>
                  <div className="row spread">
                    <span />
                    <button className="danger small" onClick={() => remove(e)}>Delete expense</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {expenses.length === 0 && <p className="hint">No expenses recorded yet. Booking costs from the Bookings tab are included in the summary automatically.</p>}
      {expenses.length > 0 && <p className="hint">Click a row to expand and edit — fix the amount or currency to match what your card was actually charged.</p>}
      <p className="hint">
        Pay in any currency — pick it next to the amount (local currencies for this trip's countries are suggested first).
        The summary converts everything to your home currency ({home}), set in Settings → Money.
      </p>
    </div>
  );
}
