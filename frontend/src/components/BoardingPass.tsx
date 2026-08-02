/**
 * The trip countdown, drawn as a deck of boarding passes.
 *
 * One pass per country hop (consecutive legs in the same country are one stay, so a
 * Korea→Japan trip is two passes, not five), each counting down to its own departure date.
 * The deck is stacked by default and cycles through the passes on its own; the spread
 * control cascades them so every ticket is readable at once.
 *
 * Airport codes come from the curated table in airports.ts or from what the user typed on
 * the leg — never derived from the city name. An unknown code renders as an empty slot with
 * the city carrying the meaning, because a wrong code on a ticket is worse than no code.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Layers, Plane, Rows3 } from "lucide-react";
import { airportCode } from "../airports";
import type { Leg, Place, Trip } from "../types";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** How far down each pass sits behind the one in front of it, as a fraction of pass height.
    The spread step has to clear the route row, so it tracks how slim the ticket is. */
const STACK_STEP = 0.1;
const SPREAD_STEP = 0.52;
const CYCLE_MS = 5200;

type Endpoint = { city: string; code: string | null };

type Hop = {
  key: string;
  from: Endpoint;
  to: Endpoint;
  country: string;
  date: string | null;
  /** Small print along the bottom of the pass: [label, value] pairs. */
  facts: [string, string][];
  photoId: number | null;
};

function dayDiff(a: string, b: string): number {
  const x = new Date(`${a}T00:00:00`).getTime();
  const y = new Date(`${b}T00:00:00`).getTime();
  if (isNaN(x) || isNaN(y)) return NaN;
  return Math.round((y - x) / 86400000);
}

/** Whole days from local midnight today to local midnight on `iso` (negative once past). */
function daysUntil(iso: string): number {
  const target = new Date(`${iso}T00:00:00`);
  if (isNaN(target.getTime())) return NaN;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function fmtPassDate(iso: string | null): string {
  if (!iso) return "TBD";
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d.getTime())) return "TBD";
  return `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]}`;
}

const PRIORITY_RANK: Record<string, number> = { must: 0, want: 1, maybe: 2 };

/**
 * One landmark photo per country, used as the washed-out art on that country's pass.
 * Drawn from the trip's own saved places — this app never surfaces a place the user didn't
 * pick, and their photos are already fetched and cached.
 */
function photoByCountry(legs: Leg[], places: Place[]): Map<string, number> {
  const countryOfLeg = new Map(legs.map((l) => [l.id, (l.country || "").trim().toLowerCase()]));
  const out = new Map<string, number>();
  const ranked = places
    .filter((p) => p.photo_ref && p.status !== "dropped")
    .sort((a, b) => (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3));
  for (const p of ranked) {
    const c = countryOfLeg.get(p.leg_id ?? -1) ?? "";
    if (!out.has(c)) out.set(c, p.id);
  }
  return out;
}

/** Consecutive legs sharing a country collapse into one stay. */
function countryStays(legs: Leg[]): { country: string; legs: Leg[] }[] {
  const groups: { country: string; legs: Leg[] }[] = [];
  for (const l of legs) {
    const country = (l.country || "").trim();
    const last = groups[groups.length - 1];
    if (last && last.country.toLowerCase() === country.toLowerCase()) last.legs.push(l);
    else groups.push({ country, legs: [l] });
  }
  return groups;
}

function buildHops(trip: Trip, legs: Leg[], places: Place[]): Hop[] {
  const art = photoByCountry(legs, places);
  const home: Endpoint = {
    city: trip.home_city || "Home",
    code: airportCode(trip.home_city || "", "", trip.home_airport),
  };

  const stays = countryStays(legs);
  if (stays.length === 0) {
    // No itinerary yet — still worth a pass, so the countdown has somewhere to live.
    return [{
      key: "trip",
      from: home,
      to: { city: trip.name || "Somewhere", code: null },
      country: "",
      date: trip.start_date,
      facts: [["Departs", fmtPassDate(trip.start_date)], ["Returns", fmtPassDate(trip.end_date)]],
      photoId: null,
    }];
  }

  const hops: Hop[] = [];
  let prev = home;

  stays.forEach((stay, i) => {
    const first = stay.legs[0];
    const last = stay.legs[stay.legs.length - 1];
    const arrive = first.arrive_date ?? (i === 0 ? trip.start_date : null);
    const depart = last.depart_date ?? (i === stays.length - 1 ? trip.end_date : null);
    const nights = arrive && depart ? dayDiff(arrive, depart) : NaN;

    const facts: [string, string][] = [["Departs", fmtPassDate(arrive)]];
    if (!isNaN(nights) && nights > 0) facts.push(["Stay", `${nights} ${nights === 1 ? "night" : "nights"}`]);
    facts.push([stay.legs.length > 1 ? "Cities" : "City", stay.legs.map((l) => l.city).filter(Boolean).join(" · ")]);

    hops.push({
      key: `stay-${first.id}`,
      from: prev,
      to: { city: first.city, code: airportCode(first.city, stay.country, first.airport) },
      country: stay.country,
      date: arrive,
      facts,
      photoId: art.get(stay.country.toLowerCase()) ?? null,
    });
    prev = { city: last.city, code: airportCode(last.city, stay.country, last.airport) };
  });

  // A round trip earns a homebound pass; a one-way or multi-city one ends where it ends.
  if (trip.trip_type === "round" && trip.home_city) {
    const lastStay = stays[stays.length - 1];
    const back = lastStay.legs[lastStay.legs.length - 1].depart_date ?? trip.end_date;
    const total = trip.start_date && trip.end_date ? dayDiff(trip.start_date, trip.end_date) : NaN;
    const facts: [string, string][] = [["Departs", fmtPassDate(back)]];
    if (!isNaN(total) && total > 0) facts.push(["Trip", `${total + 1} days`]);
    facts.push(["Home", trip.home_city]);
    hops.push({ key: "home", from: prev, to: home, country: "", date: back, facts, photoId: null });
  }

  return hops;
}

/** What the stub reads for a given hop: its own countdown, not the trip's. */
function stubFor(date: string | null): { state: string; big: string; label: string } {
  if (!date) return { state: "tbd", big: "—", label: "date to be set" };
  const n = daysUntil(date);
  if (isNaN(n)) return { state: "tbd", big: "—", label: "date to be set" };
  if (n > 0) return { state: "upcoming", big: String(n), label: n === 1 ? "day to go" : "days to go" };
  if (n === 0) return { state: "today", big: "Today", label: "departure day" };
  return { state: "past", big: String(-n), label: -n === 1 ? "day ago" : "days ago" };
}

/** Deterministic bar widths, so a pass keeps the same barcode across re-renders. */
function barcodeBars(seed: string): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Array.from({ length: 30 }, () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    return 1 + ((h >>> 9) % 3);
  });
}

export default function BoardingPass({ trip, legs, places }: { trip: Trip; legs: Leg[]; places: Place[] }) {
  const hops = useMemo(() => buildHops(trip, legs, places), [trip, legs, places]);
  const [active, setActive] = useState(0);
  const [spread, setSpread] = useState(false);
  const [paused, setPaused] = useState(false);
  const deckRef = useRef<HTMLDivElement>(null);

  const count = hops.length;
  useEffect(() => { if (active >= count) setActive(0); }, [count, active]);

  // Auto-advance only while stacked and untouched — a spread deck is being read, and a
  // hovered one is being aimed at.
  useEffect(() => {
    if (count < 2 || spread || paused) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setActive((i) => (i + 1) % count), CYCLE_MS);
    return () => clearInterval(t);
  }, [count, spread, paused]);

  if (count === 0 || (!trip.start_date && legs.length === 0)) return null;

  const rows = spread ? 1 + SPREAD_STEP * (count - 1) : 1 + STACK_STEP * Math.min(count - 1, 2);

  return (
    <div className="bp-wrap">
      <div
        ref={deckRef}
        className={`bp-deck${spread ? " spread" : ""}`}
        style={{ ["--rows" as any]: rows }}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        {hops.map((hop, i) => {
          // Stacked: depth is distance from the front, wrapping round. Spread: itinerary order.
          const depth = (i - active + count) % count;
          const stub = stubFor(hop.date);
          const style: any = spread
            ? { transform: `translateY(${i * SPREAD_STEP * 100}%)`, zIndex: i + 1 }
            : {
                transform: `translateY(${depth * STACK_STEP * 100}%) scale(${1 - depth * 0.05})`,
                zIndex: count - depth,
                opacity: depth > 2 ? 0 : 1,
                pointerEvents: depth > 2 ? "none" : undefined,
              };
          return (
            <article
              key={hop.key}
              className={`bp-pass ${stub.state}${!spread && depth === 0 ? " front" : ""}`}
              style={style}
              onClick={() => {
                if (spread) { setActive(i); setSpread(false); }
                else if (count > 1) setActive(depth === 0 ? (i + 1) % count : i);
              }}
            >
              {hop.photoId != null && (
                <div className="bp-art" style={{ backgroundImage: `url(/api/places/${hop.photoId}/photo)` }} aria-hidden="true" />
              )}

              <div className="bp-main">
                <header className="bp-head">
                  <span className="bp-brand"><Plane size={13} /> Boarding pass</span>
                  <span className="bp-seq">{count > 1 ? `Leg ${i + 1} of ${count}` : trip.name}</span>
                </header>

                <div className="bp-route">
                  <div className="bp-port">
                    <span className="bp-code">{hop.from.code ?? <i className="bp-nocode" title="No airport code — add one on the leg">•••</i>}</span>
                    <span className="bp-city" dir="auto">{hop.from.city}</span>
                  </div>
                  <div className="bp-path" aria-hidden="true">
                    <span className="bp-dash" />
                    <Plane className="bp-plane" size={16} />
                    <span className="bp-dash" />
                  </div>
                  <div className="bp-port to">
                    <span className="bp-code">{hop.to.code ?? <i className="bp-nocode" title="No airport code — add one on the leg">•••</i>}</span>
                    <span className="bp-city" dir="auto">{hop.to.city}</span>
                  </div>
                </div>

                <footer className="bp-facts">
                  {hop.facts.map(([label, value]) => (
                    <div className="bp-fact" key={label}>
                      <span className="bp-fact-label">{label}</span>
                      <span className="bp-fact-value" dir="auto">{value}</span>
                    </div>
                  ))}
                </footer>
              </div>

              <aside className="bp-stub">
                <div className="bp-stub-body">
                  <div className="bp-stub-num">{stub.big}</div>
                  <div className="bp-stub-label">{stub.label}</div>
                </div>
                <div className="bp-barcode" aria-hidden="true">
                  {barcodeBars(hop.key).map((w, b) => <span key={b} style={{ width: `${w}px` }} />)}
                </div>
              </aside>
            </article>
          );
        })}
      </div>

      {count > 1 && (
        <div className="bp-controls">
          <button className="bp-arrow" aria-label="Previous pass" disabled={spread}
            onClick={() => setActive((i) => (i - 1 + count) % count)}><ChevronLeft size={15} /></button>
          <div className="bp-dots" role="tablist">
            {hops.map((h, i) => (
              <button
                key={h.key} role="tab" aria-selected={i === active} aria-label={`Pass ${i + 1}`}
                className={`bp-dot${i === active ? " on" : ""}`} onClick={() => setActive(i)}
              />
            ))}
          </div>
          <button className="bp-arrow" aria-label="Next pass" disabled={spread}
            onClick={() => setActive((i) => (i + 1) % count)}><ChevronRight size={15} /></button>
          <button className={`bp-spread${spread ? " on" : ""}`} onClick={() => setSpread((s) => !s)}>
            {spread ? <Layers size={14} /> : <Rows3 size={14} />}
            {spread ? "Stack" : "Spread"}
          </button>
        </div>
      )}
    </div>
  );
}
