import { useEffect, useState } from "react";
import {
  ChevronDown, ChevronRight, CreditCard, Globe, Hotel, Plane, Plus, ShoppingBag, Ticket,
  TrainFront, UtensilsCrossed, X,
} from "lucide-react";
import { api } from "../api";
import type { Expense, TripDetail } from "../types";
import CategoryBar, { type Segment } from "./CategoryBar";
import FilterIcon from "./FilterIcon";
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

type Order = "newest" | "oldest";
type View = { order: Order; collapsed: string[] };

/**
 * How this device likes to look at this trip's expenses: which way the days run and which of
 * them are folded away. It lives in the browser rather than the trip because it is about the
 * screen in your hand — the phone you log lunch on wants today at the top and the other three
 * weeks out of the way, and it should still look like that when you come back to the tab.
 */
const VIEW_KEY = (tripId: number) => `tripplanner.expenses.view.${tripId}`;

function loadView(tripId: number): Partial<View> {
  try {
    return JSON.parse(localStorage.getItem(VIEW_KEY(tripId)) || "{}") as Partial<View>;
  } catch {
    return {}; // private mode, or something else's key — the defaults are fine
  }
}

function saveView(tripId: number, view: View) {
  try {
    localStorage.setItem(VIEW_KEY(tripId), JSON.stringify(view));
  } catch { /* storage full or blocked: the view just doesn't outlive the tab */ }
}

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

  // Newest day first by default: on a trip the day you are adding to is today's.
  const [order, setOrder] = useState<Order>(() => loadView(trip.id).order || "newest");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(loadView(trip.id).collapsed || []));
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Filters are deliberately not remembered — a filter you forgot you set reads as missing data.
  const [catFilter, setCatFilter] = useState<Set<string>>(new Set());
  const [cityFilter, setCityFilter] = useState<Set<number | null>>(new Set());

  useEffect(() => { saveView(trip.id, { order, collapsed: [...collapsed] }); }, [trip.id, order, collapsed]);

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

  const anyFilterActive = catFilter.size > 0 || cityFilter.size > 0;
  function matchesFilters(e: Expense) {
    if (catFilter.size > 0 && !catFilter.has(CAT_RANK.has(e.category) ? e.category : ROLLUP)) return false;
    if (cityFilter.size > 0 && !cityFilter.has(e.leg_id)) return false;
    return true;
  }
  const shown = anyFilterActive ? expenses.filter(matchesFilters) : expenses;
  const shownTotal = shown.reduce((s, e) => s + conv(e.amount, e.currency), 0);

  type DayGroup = { key: string; date: string | null; items: Expense[]; total: number; byCat: Record<string, number> };
  const undated: DayGroup = { key: "undated", date: null, items: [], total: 0, byCat: {} };
  const byDay = new Map<string, DayGroup>();
  // The cards describe what's in them: with a filter on, a day's total and its bar are the
  // total and the mix of the rows you can actually see, and a day with nothing left drops out.
  for (const e of shown) {
    let group = e.date ? byDay.get(e.date) : undated;
    if (!group) {
      group = { key: e.date as string, date: e.date, items: [], total: 0, byCat: {} };
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
  const dated = [...byDay.values()].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  if (order === "newest") dated.reverse();
  // The undated stay at the end whichever way the dated ones run: they aren't late or early,
  // they're unfinished, and the end is where you go to finish them.
  const days = undated.items.length ? [...dated, undated] : dated;

  const allCollapsed = days.length > 0 && days.every((g) => collapsed.has(g.key));
  function toggleDay(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }
  function toggleAll() {
    // Only the days on screen move — a filtered-out day keeps whatever state it had.
    const keys = days.map((g) => g.key);
    setCollapsed((prev) =>
      allCollapsed
        ? new Set([...prev].filter((k) => !keys.includes(k)))
        : new Set([...prev, ...keys])
    );
  }
  function toggleIn<T>(set: Set<T>, value: T): Set<T> {
    const next = new Set(set);
    if (next.has(value)) next.delete(value); else next.add(value);
    return next;
  }
  function clearFilters() {
    setCatFilter(new Set());
    setCityFilter(new Set());
  }

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

      {expenses.length > 0 && (
        <div className="exp-toolbar">
          <div className="row spread">
            <span className="hint" dir="auto">
              {anyFilterActive
                ? `Showing ${shown.length} of ${expenses.length} · ${fmtMoney(shownTotal, home)}`
                : `${expenses.length} ${expenses.length === 1 ? "expense" : "expenses"} · ${fmtMoney(shownTotal, home)}`}
            </span>
            <div className="row" style={{ gap: 6 }}>
              <button className="small" onClick={toggleAll} disabled={days.length === 0}>
                {allCollapsed ? "Expand all" : "Collapse all"}
              </button>
              <button
                className={`icon-btn${filtersOpen ? " active" : ""}`} title="Filter and sort"
                aria-label="Filter and sort" aria-expanded={filtersOpen}
                onClick={() => setFiltersOpen((v) => !v)}
              >
                <FilterIcon />
                {anyFilterActive && <span className="badge-dot" />}
              </button>
            </div>
          </div>

          {filtersOpen && (
            <div className="filter-bar">
              <div className="filter-row">
                <span className="filter-label">Order</span>
                <div className="filter-chips">
                  {(["newest", "oldest"] as Order[]).map((o) => (
                    <button key={o} className={`chip-toggle${order === o ? " active" : ""}`} onClick={() => setOrder(o)}>
                      {o === "newest" ? "Newest first" : "Oldest first"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="filter-row">
                <span className="filter-label">Category</span>
                <div className="filter-chips">
                  {CATS.map((c) => (
                    <button
                      key={c} className={`chip-toggle${catFilter.has(c) ? " active" : ""}`}
                      onClick={() => setCatFilter((prev) => toggleIn(prev, c as string))}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              {legs.length > 0 && (
                <div className="filter-row">
                  <span className="filter-label">City</span>
                  <div className="filter-chips">
                    {legs.map((l) => (
                      <button
                        key={l.id} dir="auto" className={`chip-toggle${cityFilter.has(l.id) ? " active" : ""}`}
                        onClick={() => setCityFilter((prev) => toggleIn(prev, l.id as number | null))}
                      >
                        {l.city}
                      </button>
                    ))}
                    <button
                      className={`chip-toggle${cityFilter.has(null) ? " active" : ""}`}
                      onClick={() => setCityFilter((prev) => toggleIn(prev, null as number | null))}
                    >
                      <Globe size={12} /> Trip-wide
                    </button>
                  </div>
                </div>
              )}
              {anyFilterActive && (
                <button className="small btn-icon" onClick={clearFilters}>Clear filters <X size={12} /></button>
              )}
            </div>
          )}
        </div>
      )}

      <div className="day-exp-list">
        {days.map((g) => {
          const badge = g.date ? dayBadge(g.date) : "No date";
          const open = !collapsed.has(g.key);
          return (
            <section className="day-exp" key={g.key}>
              {/* The header is the fold: the day's number, date, total and mix stay on screen,
                  and only its rows go away — that is the view you want while scrolling a trip. */}
              <button
                className="day-exp-head" aria-expanded={open}
                onClick={() => toggleDay(g.key)}
              >
                <span className="day-exp-chev">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
                {badge && <span className={`day-exp-no${g.date ? "" : " undated"}`}>{badge}</span>}
                <span className="day-exp-date">
                  {g.date ? fmtDayLabel(g.date) : `${g.items.length} ${g.items.length === 1 ? "expense" : "expenses"}`}
                </span>
                <span className="day-exp-total">{fmtMoney(g.total, home)}</span>
              </button>
              <CategoryBar segments={segmentsFor(g)} format={(v) => fmtMoney(v, home)} />
              {open && <div className="day-exp-rows">{g.items.map(expenseCard)}</div>}
            </section>
          );
        })}
      </div>
      {expenses.length > 0 && days.length === 0 && (
        <p className="hint">
          Nothing matches these filters. <button className="inline" onClick={clearFilters}>Clear them</button>
        </p>
      )}
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
