import { useEffect, useState } from "react";
import {
  Bus, Car, ChevronDown, ChevronRight, Globe, Hotel, Pin, Plane, Plus, Ship, Sparkles,
  Ticket, TrainFront,
} from "lucide-react";
import { airportCode } from "../airports";
import { api } from "../api";
import { citySlug, countryCode } from "../countries";
import type { Booking, Leg, Trip, TripDetail } from "../types";
import CurrencySelect from "./CurrencySelect";
import { AgodaMark, AirbnbMark, BookingMark, ExpediaMark, GoogleMark, SkyscannerMark } from "./ProviderIcons";
import { fmtMoney } from "../currencies";

const KINDS = ["flight", "stay", "train", "bus", "ferry", "car", "activity", "other"];
const KIND_ICON: Record<string, typeof Plane> = {
  flight: Plane, stay: Hotel, train: TrainFront, bus: Bus, ferry: Ship, car: Car,
  activity: Ticket, other: Pin,
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

/**
 * Agoda has no free-text search URL — only per-city landing pages keyed by slug and ISO
 * country code, and an unrecognised slug 404s instead of falling back to a search. So this
 * returns null unless the leg's country resolves, and the link is left out rather than
 * offered as something that might dead-end.
 */
function agodaUrl(leg: Leg): string | null {
  const cc = countryCode(leg.country);
  const slug = citySlug(leg.city);
  if (!cc || !slug) return null;
  const p = new URLSearchParams();
  if (leg.arrive_date) p.set("checkIn", leg.arrive_date);
  if (leg.depart_date) p.set("checkOut", leg.depart_date);
  const q = p.toString();
  return `https://www.agoda.com/city/${slug}-${cc}.html${q ? `?${q}` : ""}`;
}

/** Google Flights takes a plain-language query, so it works with city names or codes. */
function googleFlightsUrl(from: string, to: string, depart: string, ret: string): string {
  const parts = [`Flights from ${from} to ${to}`];
  if (depart) parts.push(ret ? `on ${depart} through ${ret}` : `on ${depart} one way`);
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(parts.join(" "))}`;
}

/** Skyscanner's path form: /transport/flights/<from>/<to>/<yymmdd>[/<yymmdd>]. */
function skyscannerUrl(from: string, to: string, depart: string, ret: string): string {
  const ymd = (iso: string) => iso.slice(2).replace(/-/g, "");
  const segs = [from.toLowerCase(), to.toLowerCase()];
  if (depart) segs.push(ymd(depart));
  if (depart && ret) segs.push(ymd(ret));
  return `https://www.skyscanner.net/transport/flights/${segs.join("/")}/`;
}

function expediaUrl(from: string, to: string, depart: string, ret: string): string {
  const p = new URLSearchParams();
  p.set("trip", ret ? "roundtrip" : "oneway");
  p.set("leg1", `from:${from},to:${to},departure:${depart}TANYT`);
  if (ret) p.set("leg2", `from:${to},to:${from},departure:${ret}TANYT`);
  p.set("passengers", "adults:1");
  p.set("mode", "search");
  return `https://www.expedia.com/Flights-Search?${p.toString()}`;
}

/** Marks live in ProviderIcons.tsx, which documents which are real logos and which aren't. */
const PROVIDERS = {
  booking: { name: "Booking.com", Mark: BookingMark },
  airbnb: { name: "Airbnb", Mark: AirbnbMark },
  agoda: { name: "Agoda", Mark: AgodaMark },
  google: { name: "Google Flights", Mark: GoogleMark },
  skyscanner: { name: "Skyscanner", Mark: SkyscannerMark },
  expedia: { name: "Expedia", Mark: ExpediaMark },
} as const;

type ProviderSpec = { name: string; Mark: (props: { size?: number }) => JSX.Element };

/** Borderless provider link. `url` of null renders it inert, with `hint` saying why. */
function ProviderLink({ p, url, hint }: { p: ProviderSpec; url: string | null; hint?: string }) {
  const body = (
    <>
      <span className="pmark"><p.Mark size={18} /></span>
      <span className="pname">{p.name}</span>
    </>
  );
  return url ? (
    <a className="plink" href={url} target="_blank" rel="noreferrer" title={`Search ${p.name}`} aria-label={`Search ${p.name}`}>{body}</a>
  ) : (
    <span className="plink disabled" title={hint} aria-label={`${p.name} — ${hint}`}>{body}</span>
  );
}

/**
 * Flight search that stands on its own: it's the first thing you need when starting a trip,
 * which is exactly when there are no legs and no dates to read them from yet. The fields
 * pre-fill from the trip when it has something to offer and are editable regardless.
 *
 * Skyscanner and Expedia address airports by code, so they're only offered once both ends
 * resolve to one — via airports.ts or whatever you typed on the leg. Google Flights takes
 * plain language, so it always works.
 */
function FlightFinder({ trip, legs }: { trip: Trip; legs: Leg[] }) {
  const firstLeg = legs[0];
  const [from, setFrom] = useState(trip.home_airport || trip.home_city || "");
  const [to, setTo] = useState(firstLeg ? firstLeg.airport || firstLeg.city : "");
  const [depart, setDepart] = useState(firstLeg?.arrive_date || trip.start_date || "");
  const [ret, setRet] = useState(trip.trip_type === "round" ? trip.end_date || "" : "");

  const fromCode = airportCode(from, "", from);
  const toCode = airportCode(to, "", to);
  const ready = from.trim() !== "" && to.trim() !== "";
  const coded = ready && fromCode != null && toCode != null;
  const dated = depart !== "";
  const codedHint = coded ? "Pick a departure date" : "Needs an airport code at both ends";

  return (
    <div className="finder">
      <div className="finder-fields">
        <label className="block">From
          <input dir="ltr" placeholder="City or airport code" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="block">To
          <input dir="ltr" placeholder="City or airport code" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="block">Depart
          <input type="date" value={depart} onChange={(e) => setDepart(e.target.value)} />
        </label>
        <label className="block">Return
          <input type="date" value={ret} onChange={(e) => setRet(e.target.value)} />
        </label>
      </div>
      <div className="provider-links">
        <ProviderLink
          p={PROVIDERS.google} hint="Fill in where you're flying from and to"
          url={ready ? googleFlightsUrl(from, to, depart, ret) : null}
        />
        <ProviderLink
          p={PROVIDERS.skyscanner} hint={codedHint}
          url={coded && dated ? skyscannerUrl(fromCode!, toCode!, depart, ret) : null}
        />
        <ProviderLink
          p={PROVIDERS.expedia} hint={codedHint}
          url={coded && dated ? expediaUrl(fromCode!, toCode!, depart, ret) : null}
        />
      </div>
      <p className="hint">
        {coded
          ? `Searching ${fromCode} → ${toCode}${ret ? " return" : depart ? " one way" : ""}.`
          : "Skyscanner and Expedia need a three-letter airport code at both ends — type one above, or set it on the leg in Overview. Google Flights works with plain city names."}
        {" "}Book wherever you like, then add the flight below to keep it in the plan.
      </p>
    </div>
  );
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
      <h2 className="icon-line"><Plane size={16} /> Find a flight</h2>
      <FlightFinder trip={trip} legs={legs} />

      <h2>Find a stay</h2>
      <p className="hint">Opens Booking.com / Airbnb / Agoda pre-filled with each city and your leg dates. Paste the reservation back below once you book.</p>
      <table className="table">
        <tbody>
          {legs.map((l) => {
            const agoda = agodaUrl(l);
            return (
              <tr key={l.id}>
                <td dir="auto"><strong>{l.city}</strong> <span className="hint">{l.arrive_date} → {l.depart_date}</span></td>
                <td>
                  {/* One wrapping cell rather than a column per provider — a fourth column
                      would push the table into a sideways scroll on a phone. */}
                  <div className="provider-links">
                    <ProviderLink p={PROVIDERS.booking} url={bookingUrl(l)} />
                    <ProviderLink p={PROVIDERS.airbnb} url={airbnbUrl(l)} />
                    <ProviderLink p={PROVIDERS.agoda} url={agoda} hint={`No Agoda city page for "${l.country || "this country"}"`} />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {legs.length === 0 && <p className="hint">Add a city in Overview and its stay links show up here.</p>}

      <h2>
        Bookings
        {totalHome > 0 && <span className="hint"> — total ≈ {fmtMoney(totalHome, home)}{anyUnconverted ? " (some rates unavailable)" : ""}</span>}
      </h2>
      {/* Title leads, so the narrow-width grid fills as "title across the top, then the
          pairs that belong together" without auto-placement leaving holes. */}
      <div className="add-row booking-add">
        <input className="b-title" dir="auto" placeholder="Title (e.g. TLV→ICN Korean Air)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <select title="Type" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select>
        <select title="City" value={form.leg_id} onChange={(e) => setForm({ ...form, leg_id: e.target.value === "" ? "" : Number(e.target.value) })}>
          <option value="">Trip-wide</option>
          {legs.map((l) => <option key={l.id} value={l.id}>{l.city}</option>)}
        </select>
        <input type="date" title="Date / check-in" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        <input type="date" title="Check-out" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
        <input type="number" placeholder="Cost" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
        <CurrencySelect value={form.currency} legs={legs} onChange={(c) => setForm({ ...form, currency: c })} />
        <button className="fab-add" onClick={add} aria-label="Add booking" title="Add booking"><Plus size={18} /></button>
      </div>

      {bookings.map((b) => {
        const open = expanded === b.id;
        const converted = b.cost != null ? toHome(b.cost, b.currency) : null;
        return (
          <div className="bcard" key={b.id}>
            <button className="bcard-head" onClick={() => setExpanded(open ? null : b.id)}>
              <span className="bcard-chev">{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
              {(() => { const KindIcon = KIND_ICON[b.kind] || Pin; return <KindIcon size={14} aria-label={b.kind} />; })()}
              <span className="grow bcard-title" dir="auto">
                {b.source === "ai" && <Sparkles size={11} className="ai-mark" aria-label="Extracted by AI from your conversation" />}{" "}
                {b.title}
              </span>
              <span className="hint icon-line" dir="auto">{(b.leg_id != null && legName.get(b.leg_id)) || <Globe size={12} />}</span>
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
                      <option value="">Trip-wide</option>
                      {legs.map((l) => <option key={l.id} value={l.id}>{l.city}</option>)}
                    </select>
                  </label>
                </div>
                <label className="block icon-line">Comment {b.source === "ai" && <Sparkles size={11} className="ai-mark" aria-label="Extracted by AI, double-check it" />}
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
      {bookings.length > 0 && <p className="hint icon-line">Click a row to expand and edit. <Sparkles size={11} className="ai-mark" /> marks AI-extracted entries.</p>}
    </div>
  );
}
