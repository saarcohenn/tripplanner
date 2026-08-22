// Everything the Plan tab needs to build and reason about a schedule without an LLM: the day
// scaffold derived from legs/bookings, local clock arithmetic, and travel-time estimates between
// two stops. Deliberately pure and dependency-free — the tab is the only place that touches state.

import type { Booking, Leg, Place, PlanDay, PlanDoc, PlanItem, TransportMode, Trip } from "./types";

// ---------- day identity ----------

let idSeq = 0;
/** Short, unique within a document. Not persistent-globally-unique — it only has to key one plan. */
export function newDayId(): string {
  idSeq += 1;
  return `d${Date.now().toString(36)}${idSeq.toString(36)}`;
}

/**
 * Every plan written before days had ids is keyed by date alone. Stamp ids on load so the rest of
 * the app can assume they exist; the document is saved with them on the next edit. Returns the
 * same object when nothing was missing, so this can run on every load without churning state.
 */
export function ensureDayIds(doc: PlanDoc): PlanDoc {
  const seen = new Set<string>();
  let changed = false;
  const days = doc.days.map((d) => {
    // A duplicated id is as bad as a missing one — it would make two days the same day.
    if (d.id && !seen.has(d.id)) { seen.add(d.id); return d; }
    changed = true;
    const id = newDayId();
    seen.add(id);
    return { ...d, id };
  });
  return changed ? { ...doc, days } : doc;
}

/**
 * Moves one day onto a new date. If another day already sits there the two swap, which is what
 * "these two days should trade places" means and avoids ever producing two days on one date.
 * Days come back in date order, so the strip re-sorts itself.
 */
export function moveDayToDate(doc: PlanDoc, dayId: string, date: string): PlanDoc {
  const moving = doc.days.find((d) => d.id === dayId);
  if (!moving || moving.date === date) return doc;
  const occupant = doc.days.find((d) => d.date === date && d.id !== dayId);
  const days = doc.days.map((d) => {
    if (d.id === dayId) return { ...d, date };
    if (occupant && d.id === occupant.id) return { ...d, date: moving.date };
    return d;
  });
  return { ...doc, days: days.slice().sort((a, b) => a.date.localeCompare(b.date)) };
}

// ---------- dates (local midnight, never UTC — see the date-fields skill) ----------

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function parseDate(iso: string): Date | null {
  const d = new Date(`${iso}T00:00:00`);
  return isNaN(d.getTime()) ? null : d;
}

/** Every date from `start` to `end` inclusive. Capped so a typo'd year can't spin forever. */
export function eachDate(start: string, end: string): string[] {
  const from = parseDate(start);
  const to = parseDate(end);
  if (!from || !to || to < from) return [];
  const out: string[] = [];
  for (const d = from; d <= to && out.length < 400; d.setDate(d.getDate() + 1)) out.push(isoDate(d));
  return out;
}

/** The full span of the trip: its own dates, widened by any leg that falls outside them. */
export function tripDates(trip: Trip, legs: Leg[]): string[] {
  const all = [
    trip.start_date, trip.end_date,
    ...legs.map((l) => l.arrive_date), ...legs.map((l) => l.depart_date),
  ].filter((d): d is string => !!d).sort();
  if (all.length === 0) return [];
  return eachDate(all[0], all[all.length - 1]);
}

/**
 * Which city a date belongs to. On a transfer day two legs overlap — the arrival city wins, since
 * that's where the day actually ends up and where its places live.
 */
export function legForDate(date: string, legs: Leg[]): Leg | null {
  const arriving = legs.find((l) => l.arrive_date === date);
  if (arriving) return arriving;
  const containing = legs.filter(
    (l) => l.arrive_date && l.depart_date && l.arrive_date <= date && date <= l.depart_date
  );
  if (containing.length) return containing[containing.length - 1];
  // Outside every leg range (e.g. the flight-home day): fall back to the last leg that had started.
  const started = legs.filter((l) => l.arrive_date && l.arrive_date <= date);
  return started.length ? started[started.length - 1] : legs[0] || null;
}

export function fmtDayLabel(iso: string): string {
  const d = parseDate(iso);
  if (!d) return iso;
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

export function fmtDayShort(iso: string): string {
  const d = parseDate(iso);
  if (!d) return iso;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function weekday(iso: string): string {
  const d = parseDate(iso);
  return d ? d.toLocaleDateString(undefined, { weekday: "short" }) : "";
}

// ---------- clock ----------

export function toMin(t: string | undefined | null): number | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(t ?? "").trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function fromMin(m: number): string {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, Math.round(m)));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

export function addMin(t: string, n: number): string {
  const m = toMin(t);
  return m == null ? t : fromMin(m + n);
}

/** Sorts by clock time; items without a usable time sink to the end, keeping their relative order. */
export function sortItems(items: PlanItem[]): PlanItem[] {
  return items
    .map((it, i) => ({ it, i, m: toMin(it.time) }))
    .sort((a, b) => {
      if (a.m == null && b.m == null) return a.i - b.i;
      if (a.m == null) return 1;
      if (b.m == null) return -1;
      return a.m - b.m || a.i - b.i;
    })
    .map((x) => x.it);
}

// ---------- transport ----------

export type TransportSpec = {
  id: Exclude<TransportMode, "">;
  label: string;
  hint: string;
  /** Door-to-door average, not vehicle speed: waiting, transfers and the last walk are in here. */
  kmh: number;
  /** Fixed cost of each hop — waiting for a train, finding parking. */
  overheadMin: number;
};

export const TRANSPORT: TransportSpec[] = [
  { id: "transit", label: "Public transport", hint: "Metro, bus, local trains", kmh: 18, overheadMin: 8 },
  { id: "car", label: "Rental car", hint: "Driving yourself, parking each stop", kmh: 30, overheadMin: 10 },
  { id: "walk", label: "Mostly walking", hint: "Everything within a stroll", kmh: 4.5, overheadMin: 0 },
  { id: "taxi", label: "Taxi / rideshare", hint: "Door to door, no parking", kmh: 28, overheadMin: 5 },
  { id: "mixed", label: "A bit of everything", hint: "Transit plus taxis when it's easier", kmh: 20, overheadMin: 7 },
];

/** What an unanswered leg is planned as. Named so the UI can say it out loud rather than imply it. */
export const TRANSPORT_FALLBACK = TRANSPORT[4];

export function transportSpec(mode: TransportMode): TransportSpec {
  return TRANSPORT.find((t) => t.id === mode) || TRANSPORT_FALLBACK;
}

export function transportLabel(mode: TransportMode): string {
  return mode ? transportSpec(mode).label : "Not set";
}

type Point = { lat: number | null; lng: number | null };

/** Great-circle distance in km, or null when either end has no coordinates. */
export function haversineKm(a: Point, b: Point): number | null {
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null;
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Real routes are never straight lines — 1.35 is the usual rule-of-thumb detour factor for a
 * street grid. This is an estimate and the UI labels it as one; it exists to catch a day that
 * can't physically work, not to replace a routing engine.
 */
const DETOUR = 1.35;

export function travelMinutes(km: number, mode: TransportMode): number {
  const spec = transportSpec(mode);
  return Math.max(1, Math.round(spec.overheadMin + ((km * DETOUR) / spec.kmh) * 60));
}

export type Hop = { km: number; minutes: number; mode: TransportMode };

/** The hop between two plan items, when both are places we have coordinates for. */
export function hopBetween(
  a: PlanItem, b: PlanItem, placeById: Map<number, Place>, mode: TransportMode
): Hop | null {
  const from = a.place_id != null ? placeById.get(a.place_id) : undefined;
  const to = b.place_id != null ? placeById.get(b.place_id) : undefined;
  if (!from || !to) return null;
  const km = haversineKm(from, to);
  if (km == null) return null;
  return { km, minutes: travelMinutes(km, mode), mode };
}

/** Minutes the day is short by between these two items, or 0 when there's room. */
export function hopShortfall(a: PlanItem, b: PlanItem, hop: Hop): number {
  const start = toMin(a.time);
  const next = toMin(b.time);
  if (start == null || next == null) return 0;
  const free = next - (start + (a.duration_min || 0));
  return free < hop.minutes ? hop.minutes - free : 0;
}

// ---------- building days ----------

const BOOKING_KIND_TO_ITEM: Record<string, string> = {
  flight: "flight", train: "transit", bus: "transit", ferry: "transit",
  car: "other", activity: "visit", other: "other",
};

/** Default clock position for a booking whose row carries a date but no time. */
const BOOKING_DEFAULT_TIME: Record<string, string> = {
  checkin: "15:00", checkout: "10:00", flight: "09:00", transit: "09:00", visit: "10:00", other: "12:00",
};

/**
 * `notBefore` is the day's stated arrival time, when there is one. A check-in date says which day
 * the room starts, never the hour — so the 15:00 default has to yield to a landing the user
 * actually told us about, rather than scheduling them into the hotel before the plane lands.
 */
function bookingItems(date: string, bookings: Booking[], notBefore: number | null): PlanItem[] {
  const out: PlanItem[] = [];
  for (const b of bookings) {
    const kinds: string[] = [];
    if (b.kind === "stay") {
      if (b.date === date) kinds.push("checkin");
      if (b.end_date === date) kinds.push("checkout");
    } else if (b.date === date) {
      kinds.push(BOOKING_KIND_TO_ITEM[b.kind] || "other");
    }
    for (const kind of kinds) {
      const label = kind === "checkin" ? "Check in" : kind === "checkout" ? "Check out" : "";
      const fallback = BOOKING_DEFAULT_TIME[kind] || "12:00";
      const floored =
        kind === "checkin" && notBefore != null && notBefore > (toMin(fallback) ?? 0)
          ? fromMin(notBefore)
          : fallback;
      out.push({
        time: floored,
        kind,
        title: label ? `${label} — ${b.title}` : b.title,
        place_id: null,
        duration_min: kind === "checkin" || kind === "checkout" ? 30 : 90,
        details: b.ref ? `Booking ref ${b.ref}` : "",
        pinned: true,
        booking_id: b.id,
      });
    }
  }
  return out;
}

/** The arrival/departure the leg itself states — a fixed point, exactly like a booking. */
function legItems(date: string, leg: Leg | null): PlanItem[] {
  if (!leg) return [];
  const out: PlanItem[] = [];
  if (leg.arrive_date === date && leg.arrive_time) {
    out.push({
      time: leg.arrive_time, kind: "transit", title: `Arrive in ${leg.city}`,
      place_id: null, duration_min: 60, pinned: true,
      details: "Transfer from the airport/station and drop bags.",
    });
  }
  if (leg.depart_date === date && leg.depart_time) {
    out.push({
      time: leg.depart_time, kind: "transit", title: `Leave ${leg.city}`,
      place_id: null, duration_min: 60, pinned: true,
      details: "Be at the airport/station in good time.",
    });
  }
  return out;
}

/** The day's items that come straight from the trip's own rows: arrival/departure, then bookings. */
function fixedItems(date: string, leg: Leg | null, bookings: Booking[]): PlanItem[] {
  const fromLeg = legItems(date, leg);
  const arrival = leg?.arrive_date === date ? toMin(leg.arrive_time) : null;
  // An hour after landing is the transfer, not a guess about the hotel: it's the earliest the
  // check-in could realistically happen given a time the user stated.
  return sortItems([...fromLeg, ...bookingItems(date, bookings, arrival == null ? null : arrival + 60)]);
}

/** Wake early enough to make the first fixed point of the day; otherwise a normal morning. */
function wakeFor(items: PlanItem[]): string {
  const first = items.map((i) => toMin(i.time)).filter((m): m is number => m != null).sort((a, b) => a - b)[0];
  if (first == null) return "08:00";
  return first < 9 * 60 ? fromMin(Math.max(4 * 60, first - 120)) : "08:00";
}

/**
 * A blank week built from what's already known — one card per date, in the right city, with the
 * bookings and stated arrival/departure times already dropped in. Nothing is invented: every item
 * here traces back to a row the user entered.
 */
export function scaffoldPlan(
  trip: Trip, legs: Leg[], bookings: Booking[], previous?: PlanDoc | null
): PlanDoc {
  const byDate = new Map((previous?.days || []).map((d) => [d.date, d]));
  const days: PlanDay[] = tripDates(trip, legs).map((date) => {
    const kept = byDate.get(date);
    if (kept) return kept;
    const leg = legForDate(date, legs);
    const items = fixedItems(date, leg, bookings);
    return {
      id: newDayId(),
      date,
      city: leg?.city || trip.home_city || "",
      wake_time: wakeFor(items),
      summary: "",
      items,
    };
  });
  return {
    days,
    unscheduled_place_ids: previous?.unscheduled_place_ids,
    notes: previous?.notes,
  };
}

/** A new day card for a date the plan doesn't cover yet (adding a day by hand). */
export function blankDay(date: string, legs: Leg[], bookings: Booking[]): PlanDay {
  const leg = legForDate(date, legs);
  const items = fixedItems(date, leg, bookings);
  return { id: newDayId(), date, city: leg?.city || "", wake_time: wakeFor(items), summary: "", items };
}

/** A place turned into a schedulable item, dropped in at `time`. */
export function itemForPlace(place: Place, time: string): PlanItem {
  return {
    time,
    kind: place.category === "food" ? "meal" : "visit",
    title: place.name,
    place_id: place.id,
    duration_min: place.duration_min || 90,
    details: place.notes || "",
  };
}

/**
 * Re-times a day end to end: keeps the order on screen, holds every pinned item where it is, and
 * pushes the movable ones out far enough to absorb the travel between them.
 */
export function retimeDay(day: PlanDay, mode: TransportMode, placeById: Map<number, Place>): PlanDay {
  const items = day.items || [];
  if (items.length === 0) return day;
  const first = toMin(items[0].time) ?? toMin(day.wake_time) ?? 9 * 60;
  const out: PlanItem[] = [];
  let cursor = first;
  items.forEach((it, i) => {
    if (i > 0) {
      const hop = hopBetween(items[i - 1], it, placeById, mode);
      cursor += hop ? hop.minutes : 15;
    }
    // A pinned item is a fact (a flight, a check-in) — it holds its time and the day bends to it.
    const pinnedAt = it.pinned ? toMin(it.time) : null;
    const time = pinnedAt != null ? Math.max(pinnedAt, cursor) : cursor;
    out.push({ ...it, time: fromMin(time) });
    cursor = time + (it.duration_min || 0);
  });
  return { ...day, items: out };
}

/** Place ids that don't appear anywhere in the plan — the pool the tray offers. */
export function unscheduledPlaceIds(doc: PlanDoc | null, places: Place[]): number[] {
  const used = new Set<number>();
  for (const d of doc?.days || []) {
    for (const it of d.items || []) if (it.place_id != null) used.add(it.place_id);
  }
  return places.filter((p) => p.status === "active" && !used.has(p.id)).map((p) => p.id);
}
