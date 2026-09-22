import { useEffect, useState } from "react";
import {
  ChevronDown, ChevronRight, CreditCard, Globe, Hotel, Plane, Plus, ShoppingBag, Ticket,
  TrainFront, UtensilsCrossed,
} from "lucide-react";
import { api } from "../api";
import type { Expense, TripDetail } from "../types";
import CategoryBar, { type Segment } from "./CategoryBar";
import CurrencySelect from "./CurrencySelect";
import { DatePicker } from "./DateRangePicker";
import DonutChart, { type Slice } from "./DonutChart";
import { fmtMoney } from "../currencies";
import { fmtDayLabel, tripDates } from "../plan";

const CATS = ["flights", "food", "transport", "lodging", "activities", "shopping", "other"] as const;
const CAT_ICON: Record<string, typeof Plane> = {
  flights: Plane, food: UtensilsCrossed, transport: TrainFront, lodging: Hotel,
  activities: Ticket, shopping: ShoppingBag, other: CreditCard,
};

/** Booked items count toward the same categories as manual expenses. */
const BOOKING_KIND_CAT: Record<string, string> = {
  flight: "flights", stay: "lodging", train: "transport", bus: "transport",
  ferry: "transport", car: "transport", activity: "activities", other: "other",
};

/** The eight chart slots, defined and validated as a set in styles.css. */
const SERIES = Array.from({ length: 8 }, (_, i) => `var(--series-${i + 1})`);
const ROLLUP = "other";

/**
 * Seven categories against eight slots, so each one can own its slot outright rather than
 * taking whichever is free. That's what lets a day's bar and the summary ring use the same
 * colour for food, and keeps food's colour from moving on a day it didn't come up.
 */
const CAT_COLOR: Record<string, string> = Object.fromEntries(CATS.map((c, i) => [c, SERIES[i]]));
const CAT_RANK = new Map<string, number>(CATS.map((c, i) => [c as string, i]));

/**
 * Slices for one ring.
 *
 * Two things are load-bearing beyond "turn numbers into arcs":
 *
 * - A dozen one-percent slivers read as static rather than data, so anything below
 *   `minPct`, and anything past the slot count, folds into a single "other".
 * - Slices come out in `order` — the fixed identity order of the thing being counted,
 *   not descending value — and take slots in that sequence. The palette's guarantee is
 *   that *consecutive* slots stay apart under colourblind simulation, so neighbouring
 *   arcs have to be consecutive slots. Sorting by value would put arbitrary pairs
 *   against each other, which is a test no eight-colour palette passes.
 *
 * `colors` pins a label to a slot for a set small enough to own one each (the categories);
 * without it slots are handed out in `order`, which is all a ring of cities can do.
 */
function toSlices(
  totals: Record<string, number>, order: string[],
  colors?: Record<string, string>, minPct = 2,
): Slice[] {
  const present = Object.entries(totals).filter(([, v]) => v > 0);
  const total = present.reduce((s, [, v]) => s + v, 0);
  if (total <= 0) return [];

  // Which entities earn a slice: biggest first, so the rollup drops the smallest.
  const keep = new Set(
    present
      .sort((a, b) => b[1] - a[1])
      .filter(([, v], i) => i < SERIES.length - 1 && (v / total) * 100 >= minPct)
      .map(([label]) => label)
  );

  const rank = new Map(order.map((label, i) => [label, i]));
  const slices = [...keep]
    .sort((a, b) => (rank.get(a) ?? 99) - (rank.get(b) ?? 99))
    .map((label, i) => ({ label, value: totals[label], color: colors?.[label] || SERIES[i] }));

  const rest = total - slices.reduce((s, x) => s + x.value, 0);
  if (rest > 0.005) {
    // Merge rather than push, so a real "other" category and the rollup don't collide.
    const existing = slices.find((s) => s.label === ROLLUP);
    if (existing) existing.value += rest;
    else slices.push({ label: ROLLUP, value: rest, color: colors?.[ROLLUP] || SERIES[SERIES.length - 1] });
  }
  return slices;
}

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
    const city = (e.leg_id != null && legName.get(e.leg_id)) || "Trip-wide";
    byCity[city] = (byCity[city] || 0) + conv(e.amount, e.currency);
  }
  for (const b of bookings) {
    if (!b.cost) continue;
    const city = (b.leg_id != null && legName.get(b.leg_id)) || "Trip-wide";
    byCity[city] = (byCity[city] || 0) + conv(b.cost, b.currency);
  }

  const budgetHome = trip.budget ? toHome(trip.budget, trip.currency || home).value : 0;
  // Each ring's identity order: categories have a canonical one, cities have the
  // itinerary. Both are stable as amounts change, which is what keeps a slice's colour
  // from jumping around between visits.
  const catSlices = toSlices(byCategory, [...CATS], CAT_COLOR);
  const citySlices = toSlices(byCity, ["Trip-wide", ...legs.map((l) => l.city)]);

  /**
   * The list, aggregated into one card per day.
   *
   * A day here is a date, not a day of the plan: an expense carries a date and nothing
   * else, and the eSIM you bought three weeks before you flew is still a trip expense.
   * Dates inside the trip window get the number of the day they land on, the ones outside
   * it say which side they're on, and the undated ones collect at the end — where the
   * missing date is the obvious thing to fix rather than a row you have to hunt for.
   */
  const dates = tripDates(trip, legs);
  const dayNo = new Map(dates.map((d, i) => [d, i + 1]));
  const firstDay = dates[0];
  const lastDay = dates[dates.length - 1];

  function dayBadge(date: string): string {
    const n = dayNo.get(date);
    if (n) return `Day ${n}`;
    // A trip with no dates set has no days to count, so the badge stays off entirely
    // rather than labelling every row "before".
    if (!firstDay) return "";
    return date < firstDay ? "Before" : lastDay && date > lastDay ? "After" : "";
  }

  type DayGroup = { date: string | null; items: Expense[]; total: number; byCat: Record<string, number> };
  const undated: DayGroup = { date: null, items: [], total: 0, byCat: {} };
  const byDay = new Map<string, DayGroup>();
  for (const e of expenses) {
    let group = e.date ? byDay.get(e.date) : undated;
    if (!group) {
      group = { date: e.date, items: [], total: 0, byCat: {} };
      byDay.set(e.date as string, group);
    }
    group.items.push(e);
    const value = conv(e.amount, e.currency);
    group.total += value;
    // A category the app no longer offers (an old row, an import) still has to land
    // somewhere with a colour — "other" is where the donut puts it too.
    const cat = CAT_RANK.has(e.category) ? e.category : ROLLUP;
    group.byCat[cat] = (group.byCat[cat] || 0) + value;
  }
  const days = [...byDay.values()].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  if (undated.items.length) days.push(undated);

  /** One segment per category the day actually had, in the categories' own fixed order. */
  function segmentsFor(g: DayGroup): Segment[] {
    return Object.entries(g.byCat)
      .filter(([, v]) => v > 0)
      .sort((a, b) => (CAT_RANK.get(a[0]) ?? 99) - (CAT_RANK.get(b[0]) ?? 99))
      .map(([label, value]) => ({ label, value, color: CAT_COLOR[label] }));
  }

  /** One expense: a line in its day's table when closed, the edit form when open. */
  function expenseCard(e: Expense) {
    const open = expanded === e.id;
    const c = toHome(e.amount, e.currency);
    return (
      <div className="bcard" key={e.id}>
        <button className="bcard-head" onClick={() => setExpanded(open ? null : e.id)}>
          <span className="bcard-chev">{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
          {(() => { const CatIcon = CAT_ICON[e.category] || CreditCard; return <CatIcon size={14} aria-label={e.category} />; })()}
          <span className="grow bcard-title" dir="auto">{e.title}</span>
          <span className="hint icon-line" dir="auto">{(e.leg_id != null && legName.get(e.leg_id)) || <Globe size={12} />}</span>
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
                  <option value="">Trip-wide</option>
                  {legs.map((l) => <option key={l.id} value={l.id}>{l.city}</option>)}
                </select>
              </label>
            </div>
            <label className="block">Date
              <DatePicker value={e.date} label="When?" onChange={(v) => patch(e, { date: v })} />
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
  }

  return (
    <div className="pad wide">
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
        <div className="exp-breakdown">
          <h3>By category</h3>
          <DonutChart
            slices={catSlices} centerValue={fmtMoney(grandTotal, home)} centerLabel="total"
            format={(v) => fmtMoney(v, home)}
          />
        </div>
        <div className="exp-breakdown">
          <h3>By city</h3>
          <DonutChart
            slices={citySlices} centerValue={String(citySlices.length)} centerLabel="places"
            format={(v) => fmtMoney(v, home)}
          />
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
        {/* Date sits before category/city so the wide-screen grid pairs it with Amount
            rather than stranding it under the full-width pair below. */}
        <label className="block">Date
          <DatePicker value={form.date || null} label="When?" onChange={(v) => setForm({ ...form, date: v || "" })} />
        </label>
        <div className="two-col">
          <label className="block">Category
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {CATS.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label className="block">City
            <select value={form.leg_id} onChange={(e) => setForm({ ...form, leg_id: e.target.value === "" ? "" : Number(e.target.value) })}>
              <option value="">Trip-wide</option>
              {legs.map((l) => <option key={l.id} value={l.id}>{l.city}</option>)}
            </select>
          </label>
        </div>
        <button className="fab-add" onClick={add} aria-label="Add expense" title="Add expense"><Plus size={18} /></button>
      </div>

      <div className="day-exp-list">
        {days.map((g) => {
          const badge = g.date ? dayBadge(g.date) : "No date";
          return (
            <section className="day-exp" key={g.date || "undated"}>
              <header className="day-exp-head">
                {badge && <span className={`day-exp-no${g.date ? "" : " undated"}`}>{badge}</span>}
                <span className="day-exp-date">
                  {g.date ? fmtDayLabel(g.date) : `${g.items.length} ${g.items.length === 1 ? "expense" : "expenses"}`}
                </span>
                <span className="day-exp-total">{fmtMoney(g.total, home)}</span>
              </header>
              <CategoryBar segments={segmentsFor(g)} format={(v) => fmtMoney(v, home)} />
              <div className="day-exp-rows">{g.items.map(expenseCard)}</div>
            </section>
          );
        })}
      </div>
      {expenses.length === 0 && <p className="hint">No expenses recorded yet. Booking costs from the Bookings tab are included in the summary automatically.</p>}
      {expenses.length > 0 && (
        <p className="hint">
          Each day's bar is that day's spending split by category, in the colours of the By category
          legend above — hover a segment for what it was. Click a row to expand and edit it: fix the
          amount or currency to match what your card was actually charged.
        </p>
      )}
      <p className="hint">
        Pay in any currency — pick it next to the amount (local currencies for this trip's countries are suggested first).
        The summary converts everything to your home currency ({home}), set in Profile → Money.
      </p>
    </div>
  );
}
