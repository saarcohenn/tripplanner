import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlarmClock, BedDouble, Car, CarTaxiFront, ChevronLeft, ChevronRight, CircleDot, Clock,
  Flame, Footprints, GripVertical, Hotel, Info, Luggage, Map as MapIcon, MapPin, Pencil,
  PanelRightClose, Plane, Plus, Route, Shuffle, Sparkles, Sunrise, TrainFront, Trash2,
  TriangleAlert, UtensilsCrossed, Wallet, Wand2,
} from "lucide-react";
import { api } from "../api";
import {
  blankDay, ensureDayIds, fmtDayLabel, fmtDayShort, fromMin, hopBetween, hopShortfall, isoDate,
  itemForPlace, legForDate, moveDayToDate, retimeDay, scaffoldPlan, toMin, TRANSPORT_FALLBACK,
  transportLabel, tripDates, unscheduledPlaceIds, weekday,
} from "../plan";
import type {
  AdvisorDoc, ChatProposal, Leg, Place, PlanDay, PlanDoc, PlanItem, PlanJob, PlanRow,
  TransportMode, TripDetail,
} from "../types";
import { DatePicker } from "./DateRangePicker";
import DayChat from "./DayChat";
import DayMap, { DayStop } from "./DayMap";
import PlaceInsightPanel from "./PlaceInsightPanel";
import TimeField from "./TimeField";
import TransportSurvey from "./TransportSurvey";
import TripImportPanel from "./TripImportPanel";
import { CATEGORY_COLORS } from "./TripMap";

const KIND_ICON: Record<string, typeof MapPin> = {
  visit: MapPin, meal: UtensilsCrossed, transit: TrainFront, rest: BedDouble,
  checkin: Hotel, checkout: Luggage, flight: Plane, other: CircleDot,
};
const KINDS = ["visit", "meal", "transit", "rest", "checkin", "checkout", "flight", "other"];

const TRANSPORT_ICON: Record<string, typeof Car> = {
  transit: TrainFront, car: Car, walk: Footprints, taxi: CarTaxiFront, mixed: Shuffle,
};

/** Drag sources and drop targets, resolved through data attributes so touch works the same as mouse. */
type DragPayload = { kind: "place"; placeId: number } | { kind: "item"; index: number };
type DropTarget =
  | { kind: "index"; index: number }
  | { kind: "end" }
  | { kind: "tray" }
  /** A day chip. Carries the day's id, so a drop still lands right after dates are shuffled. */
  | { kind: "day"; dayId: string };

/** Matches the breakpoint where the advisor rail stops sitting beside the days (see styles.css). */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia("(max-width: 1110px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1110px)");
    const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

export default function PlanTab({
  detail, refresh, llmReady, generatePlan, reAdvise, planJob, busy, gmapsKey, theme,
}: {
  detail: TripDetail;
  refresh: () => Promise<void>;
  llmReady: boolean;
  generatePlan: () => Promise<void>;
  reAdvise: () => Promise<void>;
  planJob: PlanJob | null;
  busy: boolean;
  gmapsKey: string | null;
  theme: "light" | "dark";
}) {
  const { trip, plan, legs, places, bookings } = detail;
  const advising = busy && planJob?.kind === "advisor";
  const narrow = useNarrow();

  const placeById = useMemo(() => new Map(places.map((p) => [p.id, p])), [places]);
  const advisor: AdvisorDoc | null = plan?.advisor_json ? safeParse<AdvisorDoc>(plan.advisor_json) : null;
  /** How much the advisor is actually saying — shown on the tab so the rail reads as live. */
  const adviceCount =
    (advisor?.pacing_alerts?.length || 0) + (advisor?.drop_suggestions?.length || 0);
  /** The advice was written against the plan as it stood at generated_at; edits came after. */
  const adviceStale = !!plan?.edited_at && !!plan?.generated_at && plan.edited_at > plan.generated_at;

  // ---------- the editable document ----------
  // The server's copy is the source of truth; this adopts it whenever the string actually changes,
  // which after our own save is the string we just sent — so local edits are never stomped.
  const [doc, setDoc] = useState<PlanDoc | null>(null);
  const serverJsonRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const json = plan?.plan_json ?? null;
    if (json === serverJsonRef.current) return;
    serverJsonRef.current = json;
    const parsed = json ? safeParse<PlanDoc>(json) : null;
    // Plans written before days had ids get them here; they're persisted on the next save.
    setDoc(parsed ? ensureDayIds(parsed) : null);
  }, [plan?.plan_json]);

  const docRef = useRef<PlanDoc | null>(null);
  useEffect(() => { docRef.current = doc; }, [doc]);

  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveTimer = useRef<number | null>(null);

  const flush = useCallback(async (next: PlanDoc) => {
    setSaveState("saving");
    setSaveError(null);
    try {
      const row = await api.put<PlanRow>(`/trips/${trip.id}/plan`, { plan: next, mode: "manual" });
      serverJsonRef.current = row.plan_json;
      setSaveState("saved");
      await refresh();
    } catch (e: any) {
      setSaveState("error");
      setSaveError(e.message);
    }
  }, [trip.id, refresh]);

  /** Every edit goes through here: optimistic locally, written back after a short quiet period. */
  const commit = useCallback((next: PlanDoc) => {
    setDoc(next);
    docRef.current = next;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { void flush(next); }, 500);
  }, [flush]);

  useEffect(() => () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); }, []);

  // ---------- which day is on screen ----------
  // Tracked by the day's id, not its date: moving a day to another date must not lose your place,
  // and two days swapping dates must not silently swap which one you were looking at.
  const days = useMemo(() => doc?.days || [], [doc]);
  const [activeId, setActiveId] = useState<string | null>(null);
  useEffect(() => {
    if (days.length === 0) return void setActiveId(null);
    setActiveId((cur) => {
      if (cur && days.some((d) => d.id === cur)) return cur;
      const today = isoDate(new Date());
      return (days.find((d) => d.date >= today) ?? days[0]).id;
    });
  }, [days]);
  const activeIdRef = useRef<string | null>(null);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);

  const dayIndex = days.findIndex((d) => d.id === activeId);
  const day: PlanDay | null = dayIndex >= 0 ? days[dayIndex] : null;
  const activeDate = day?.date ?? null;
  const activeLeg: Leg | null = activeDate ? legForDate(activeDate, legs) : null;
  const mode: TransportMode = activeLeg?.transport || "";
  /** Jump the strip to whichever day now sits on this date — used by the advisor's date links. */
  const goToDate = (d: string) => setActiveId(days.find((x) => x.date === d)?.id ?? activeId);

  const [editing, setEditing] = useState(false);
  const [showMap, setShowMap] = useState(true);
  const [surveyOpen, setSurveyOpen] = useState(false);
  const [rail, setRail] = useState<"advisor" | "place">("advisor");
  // Remembered, because whether you want the rail open is a working preference, not a per-visit
  // decision — it was reappearing at full width on every load.
  const [railOpen, setRailOpen] = useState(() => localStorage.getItem("planRail") !== "closed");
  useEffect(() => { localStorage.setItem("planRail", railOpen ? "open" : "closed"); }, [railOpen]);
  const [selected, setSelected] = useState<number | null>(null); // index into the active day's items

  // A day switch invalidates an index into the old day's list.
  useEffect(() => { setSelected(null); }, [activeDate]);

  const selectedPlace: Place | null = (() => {
    if (selected == null || !day) return null;
    const id = day.items?.[selected]?.place_id;
    return id != null ? placeById.get(id) || null : null;
  })();

  // The strip fades out at whichever edge still has days behind it, so a cut-off chip reads as
  // "there's more this way" instead of as a chip that got clipped.
  const stripRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const updateEdges = useCallback(() => {
    const el = stripRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdges({ left: el.scrollLeft > 2, right: el.scrollLeft < max - 2 });
  }, []);
  useEffect(() => {
    stripRef.current?.querySelector<HTMLElement>(".day-chip.active")
      ?.scrollIntoView({ block: "nearest", inline: "center" });
    // The scroll above is smooth, so measure once it has settled as well as right away.
    updateEdges();
    const t = window.setTimeout(updateEdges, 400);
    return () => window.clearTimeout(t);
  }, [activeId, days, updateEdges]);
  useEffect(() => {
    window.addEventListener("resize", updateEdges);
    return () => window.removeEventListener("resize", updateEdges);
  }, [updateEdges]);

  // ---------- mutations ----------
  function patchDay(patch: Partial<PlanDay>, at = dayIndex) {
    const cur = docRef.current;
    if (!cur || at < 0) return;
    const days = cur.days.slice();
    days[at] = { ...days[at], ...patch };
    commit({ ...cur, days });
  }

  function patchItem(index: number, patch: Partial<PlanItem>) {
    if (!day) return;
    const items = (day.items || []).slice();
    items[index] = { ...items[index], ...patch };
    patchDay({ items });
  }

  function removeItem(index: number) {
    if (!day) return;
    const items = (day.items || []).slice();
    items.splice(index, 1);
    patchDay({ items });
    setSelected(null);
  }

  function appendItem(item: PlanItem) {
    if (!day) return;
    patchDay({ items: [...(day.items || []), item] });
  }

  /** Order on screen is the truth; a new item just gets a sensible clock label to start from. */
  function timeAt(items: PlanItem[], idx: number, wake: string): string {
    if (idx <= 0) return fromMin(Math.max((toMin(wake) ?? 8 * 60) + 60, 9 * 60));
    const prev = items[idx - 1];
    const m = toMin(prev.time);
    return m == null ? "09:00" : fromMin(m + (prev.duration_min || 0) + 15);
  }

  function retime() {
    if (!day) return;
    patchDay(retimeDay(day, mode, placeById));
  }

  function buildScaffold() {
    commit(scaffoldPlan(trip, legs, bookings, docRef.current));
    setEditing(true);
  }

  function addMissingDays() {
    const cur = docRef.current;
    if (!cur) return;
    const have = new Set(cur.days.map((d) => d.date));
    const extra = tripDates(trip, legs).filter((d) => !have.has(d)).map((d) => blankDay(d, legs, bookings));
    if (extra.length === 0) return;
    commit({ ...cur, days: [...cur.days, ...extra].sort((a, b) => a.date.localeCompare(b.date)) });
  }

  async function setLegTransport(leg: Leg, value: TransportMode) {
    await api.put(`/legs/${leg.id}`, { transport: value });
    await refresh();
  }

  async function dropPlace(placeId: number | null) {
    if (placeId == null) return;
    await api.put(`/places/${placeId}`, { status: "dropped" });
    await refresh();
  }

  // ---------- drag and drop ----------
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  function resolveTarget(x: number, y: number): DropTarget | null {
    const el = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>("[data-drop]");
    if (!el) return null;
    switch (el.dataset.drop) {
      case "index": return { kind: "index", index: Number(el.dataset.index) };
      case "end": return { kind: "end" };
      case "tray": return { kind: "tray" };
      case "day": return el.dataset.day ? { kind: "day", dayId: el.dataset.day } : null;
      default: return null;
    }
  }

  // Pointer Events rather than HTML5 drag-and-drop — same choice (and reason) as the leg reorder
  // on the Overview tab: one code path that actually works on a phone.
  function startDrag(e: React.PointerEvent, payload: DragPayload) {
    e.preventDefault();
    setDragging(payload.kind === "item" ? `item-${payload.index}` : `place-${payload.placeId}`);
    let target: DropTarget | null = null;

    const onMove = (ev: PointerEvent) => {
      target = resolveTarget(ev.clientX, ev.clientY);
      setOver(
        target == null ? null
          : target.kind === "index" ? `index-${target.index}`
          : target.kind === "day" ? `day-${target.dayId}`
          : target.kind
      );
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      setDragging(null);
      setOver(null);
      if (target) applyDrop(payload, target);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  function applyDrop(payload: DragPayload, target: DropTarget) {
    const cur = docRef.current;
    const dayId = activeIdRef.current;
    if (!cur || !dayId) return;
    const days = cur.days.map((d) => ({ ...d, items: [...(d.items || [])] }));
    const di = days.findIndex((d) => d.id === dayId);
    if (di < 0) return;
    const source = days[di];

    let moving: PlanItem;
    if (payload.kind === "item") {
      const found = source.items[payload.index];
      if (!found) return;
      moving = found;
      source.items.splice(payload.index, 1);
    } else {
      const place = placeById.get(payload.placeId);
      if (!place) return;
      moving = itemForPlace(place, "09:00");
    }

    if (target.kind === "tray") {
      // Dragging a scheduled item back to the tray unschedules it; a tray place dropped on the
      // tray is a no-op, and the splice above never touched it.
      commit({ ...cur, days });
      setSelected(null);
      return;
    }

    if (target.kind === "day" && target.dayId !== dayId) {
      const tj = days.findIndex((d) => d.id === target.dayId);
      if (tj < 0) return;
      const dest = days[tj];
      dest.items.push({ ...moving, time: timeAt(dest.items, dest.items.length, dest.wake_time) });
      commit({ ...cur, days });
      setSelected(null);
      return;
    }

    let idx = target.kind === "end" || target.kind === "day" ? source.items.length : target.index;
    // The splice above already shifted everything below the old slot up by one.
    if (payload.kind === "item" && idx > payload.index) idx -= 1;
    idx = Math.max(0, Math.min(source.items.length, idx));
    const time = payload.kind === "item" ? moving.time : timeAt(source.items, idx, source.wake_time);
    source.items.splice(idx, 0, { ...moving, time });
    commit({ ...cur, days });
    setSelected(null);
  }

  // ---------- derived views ----------
  const unscheduled = useMemo(() => unscheduledPlaceIds(doc, places), [doc, places]);

  // The tray used to show only this city's unscheduled places, which hid most of the trip exactly
  // when you wanted to reach for it. It now offers everything, with the narrowing as filters you
  // can drop — including the ones already on a day, since a place can be worth a second visit.
  const [trayCityOnly, setTrayCityOnly] = useState(true);
  const [trayUnusedOnly, setTrayUnusedOnly] = useState(true);
  const [trayQuery, setTrayQuery] = useState("");

  const trayPlaces = useMemo(() => {
    const unusedIds = new Set(unscheduled);
    const q = trayQuery.trim().toLowerCase();
    return places.filter((p) => {
      if (p.status !== "active") return false;
      if (trayUnusedOnly && !unusedIds.has(p.id)) return false;
      // "No city yet" places stay visible under the city filter — they're the ones most in need
      // of being dragged somewhere, and hiding them is how they get forgotten.
      if (trayCityOnly && activeLeg && p.leg_id !== activeLeg.id && p.leg_id != null) return false;
      if (q && !p.name.toLowerCase().includes(q) && !(p.notes || "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [places, unscheduled, trayUnusedOnly, trayCityOnly, activeLeg, trayQuery]);

  const legCity = useMemo(() => new Map(legs.map((l) => [l.id, l.city])), [legs]);
  const scheduledIds = useMemo(
    () => new Set(places.map((p) => p.id).filter((id) => !unscheduled.includes(id))),
    [places, unscheduled]
  );

  // ---------- moving a day to another date ----------
  function moveDay(date: string | null) {
    const cur = docRef.current;
    if (!cur || !day || !date || date === day.date) return;
    commit(moveDayToDate(cur, day.id, date));
  }
  const dateTakenBy = (date: string) => days.find((d) => d.date === date && d.id !== day?.id);

  // ---------- applying what the chat proposed ----------
  // Places the chat found are created here, not on the server, so they go through the same
  // endpoint as any place you add by hand and land in the trip list like everything else.
  async function applyChatProposal(proposal: ChatProposal) {
    const cur = docRef.current;
    if (!cur || !day) return;
    const refToId = new Map<string, number>();
    for (const np of proposal.new_places) {
      const created = await api.post<Place>(`/trips/${trip.id}/places`, {
        name: np.name,
        category: "other",
        lat: np.lat, lng: np.lng,
        google_place_id: np.google_place_id || "",
        gmaps_url: np.gmaps_url || "",
        notes: np.address || "",
        leg_id: activeLeg?.id ?? null,
        duration_min: 60,
      });
      refToId.set(np.ref, created.id);
    }
    const items: PlanItem[] = proposal.items.map((it) => {
      const { new_place_ref, ...rest } = it;
      return {
        ...rest,
        place_id: new_place_ref ? refToId.get(new_place_ref) ?? null : it.place_id ?? null,
      };
    });
    const nextDays = cur.days.map((d) =>
      d.id === day.id ? { ...d, summary: proposal.summary, wake_time: proposal.wake_time, items } : d
    );
    commit({ ...cur, days: nextDays });
    setSelected(null);
    if (proposal.new_places.length) await refresh();
  }

  const stops: DayStop[] = useMemo(() => {
    const out: DayStop[] = [];
    (day?.items || []).forEach((it, i) => {
      const p = it.place_id != null ? placeById.get(it.place_id) : undefined;
      if (!p || p.lat == null || p.lng == null) return;
      out.push({
        key: String(i),
        lat: p.lat, lng: p.lng,
        label: String(out.length + 1),
        title: `${it.time} · ${p.name}`,
        color: CATEGORY_COLORS[p.category] || CATEGORY_COLORS.other,
      });
    });
    return out;
  }, [day, placeById]);

  // ---------- empty state ----------
  // A hand-built plan needs dates to hang days off; without them there is nothing to scaffold.
  const plannable = tripDates(trip, legs).length > 0;

  if (!doc || doc.days.length === 0) {
    return (
      <div className="pad narrow">
        <h2>Daily plan</h2>
        <p className="hint">
          Two ways in. Either lay the days out yourself from the places and bookings you've already
          entered, or let the generator arrange them — it schedules <em>only the places you chose</em>,
          it never adds new attractions.
        </p>
        <div className="plan-start">
          <button className="primary btn-icon" onClick={buildScaffold} disabled={!plannable}
            title={plannable ? "" : "Set the trip dates (or a leg's dates) on the Overview tab first"}>
            <Pencil size={15} /> Build it myself
          </button>
          <button className="btn-icon" onClick={generatePlan} disabled={!llmReady || busy}>
            <Sparkles size={15} className="ai-mark" /> {llmReady ? "Generate with AI" : "Add an LLM key in Profile first"}
          </button>
        </div>
        <p className="hint">
          {plannable
            ? "Building it yourself creates one card per day, already in the right city, with your bookings and stated arrival times dropped in. You then drag your places onto them."
            : "This trip has no dates yet — both routes need days to hang the plan off. Fill them in on the Overview tab, or just say what you're thinking below and let it work them out."}
        </p>

        {/* Neither route works on an empty trip, and filling the Overview in by hand first is a
            lot to ask of someone who only knows "ten days in Portugal in October". */}
        <h3>Or just describe it</h3>
        <p className="hint">
          Say where you're going and what you want to do, in whatever words you'd use. It fills in the
          cities, dates, places and bookings you mention — then come back here and lay out the days.
        </p>
        <TripImportPanel
          tripId={trip.id} llmReady={llmReady} onApplied={refresh}
          placeholder={"e.g. Ten days in Portugal in October — Lisbon first, then three days in Porto.\nWant to see Belém Tower, the Jerónimos Monastery and Livraria Lello, and do a port cellar tour.\nFlying out of Tel Aviv, budget around €2000."}
        />
      </div>
    );
  }

  const planned = new Set(days.map((d) => d.date));
  const missingDays = tripDates(trip, legs).filter((d) => !planned.has(d)).length;
  const stamp = plan?.mode === "manual" && plan?.edited_at ? `edited ${plan.edited_at} UTC` : `generated ${plan?.generated_at} UTC`;

  return (
    <div className={`plan-layout${railOpen ? "" : " rail-collapsed"}`}>
      {surveyOpen && (
        <TransportSurvey legs={legs} bookings={bookings} onSet={setLegTransport} onClose={() => setSurveyOpen(false)} />
      )}
      {narrow && selectedPlace && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal insight-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="modal-scroll">
              <PlaceInsightPanel
                place={selectedPlace} city={activeLeg?.city || ""} llmReady={llmReady}
                onClose={() => setSelected(null)}
              />
            </div>
          </div>
        </div>
      )}

      <div className="plan-days">
        <div className="row spread plan-head">
          <h2>
            Daily plan <span className="hint">{stamp}</span>
            {saveState === "saving" && <span className="hint"> · saving…</span>}
            {saveState === "saved" && <span className="hint"> · saved</span>}
          </h2>
          <div className="plan-head-actions">
            <button
              className={`chip-toggle${editing ? " active" : ""}`} aria-pressed={editing}
              onClick={() => setEditing((v) => !v)}
            ><Pencil size={13} /> {editing ? "Done editing" : "Edit"}</button>
            <button className={`chip-toggle${showMap ? " active" : ""}`} aria-pressed={showMap}
              onClick={() => setShowMap((v) => !v)}><MapIcon size={13} /> Map</button>
            <button className="chip-toggle" onClick={() => setSurveyOpen(true)}><Route size={13} /> Transport</button>
            <button className="chip-toggle" onClick={generatePlan} disabled={!llmReady || busy}
              title={llmReady ? "Replace this plan with a generated one" : "Add an LLM key in Profile first"}>
              <Sparkles size={13} className="ai-mark" /> Regenerate
            </button>
          </div>
        </div>

        {saveState === "error" && (
          <div className="alert icon-line"><TriangleAlert size={13} /> Couldn't save: {saveError}</div>
        )}
        {doc.notes && <p className="hint" dir="auto">{doc.notes}</p>}

        {/* Day navigation. In edit mode each chip is also a drop target, which is how an item
            moves to another day while only one day is on screen. */}
        <div className="day-nav">
          <button className="day-nav-arrow" aria-label="Previous day" disabled={dayIndex <= 0}
            onClick={() => setActiveId(days[dayIndex - 1].id)}><ChevronLeft size={18} /></button>
          <div className="day-strip-wrap">
            <span className={`strip-fade left${edges.left ? " show" : ""}`} aria-hidden="true" />
            <div className="day-strip" ref={stripRef} onScroll={updateEdges}>
              {doc.days.map((d) => (
                <button
                  key={d.date}
                  data-drop={editing ? "day" : undefined}
                  data-day={d.id}
                  className={`day-chip${d.id === activeId ? " active" : ""}${over === `day-${d.id}` ? " drag-over" : ""}`}
                  onClick={() => setActiveId(d.id)}
                >
                  <span className="day-chip-dow">{weekday(d.date)}</span>
                  <span className="day-chip-date">{fmtDayShort(d.date)}</span>
                  <span className="day-chip-city" dir="auto">{d.city || "—"}</span>
                  <span className="day-chip-count">{d.items?.length || 0}</span>
                </button>
              ))}
            </div>
            <span className={`strip-fade right${edges.right ? " show" : ""}`} aria-hidden="true" />
          </div>
          <button className="day-nav-arrow" aria-label="Next day" disabled={dayIndex < 0 || dayIndex >= days.length - 1}
            onClick={() => setActiveId(days[dayIndex + 1].id)}><ChevronRight size={18} /></button>
        </div>

        {missingDays > 0 && (
          <div className="alert small">
            {missingDays} {missingDays === 1 ? "day of this trip isn't" : "days of this trip aren't"} in the plan.
            <button className="inline" onClick={addMissingDays}>Add them</button>
          </div>
        )}

        {day && (
          <div className="day-card day-card-full">
            <div className="day-head">
              <strong>{fmtDayLabel(day.date)}</strong> · <span dir="auto">{day.city}</span>
              <span className="grow" />
              <span className={`wake ${day.wake_time < "07:30" ? "early" : ""}`}>
                <AlarmClock size={12} /> wake {day.wake_time}
              </span>
            </div>

            {/* How this city gets crossed — the number every travel estimate below comes from. */}
            <button className={`transport-chip${mode ? "" : " unset"}`} onClick={() => setSurveyOpen(true)}>
              {(() => { const Icon = TRANSPORT_ICON[mode] || Route; return <Icon size={13} />; })()}
              {mode
                ? <>Getting around {day.city || "here"}: <strong>{transportLabel(mode)}</strong></>
                : <>Getting around {day.city || "here"} isn't set — estimating as {TRANSPORT_FALLBACK.label.toLowerCase()}</>}
            </button>

            {day.alarm_reason && (
              <div className="alarm-reason icon-line" dir="auto"><AlarmClock size={12} /> {day.alarm_reason}</div>
            )}

            {editing ? (
              <>
                <div className="day-edit-row">
                  <label className="block">Summary
                    <input dir="auto" value={day.summary || ""} placeholder="What today is about"
                      onChange={(e) => patchDay({ summary: e.target.value })} />
                  </label>
                  <button className="small btn-icon" onClick={retime} title="Recalculate every time from the order, holding fixed items in place">
                    <Wand2 size={13} /> Re-time day
                  </button>
                </div>
                {/* The day is an object with a date, not a date with contents — so this moves the
                    whole day, and trades places with whatever already sits on the target date
                    rather than stacking two days onto one. */}
                <div className="day-edit-row">
                  <label className="block drp-label">This day happens on
                    <DatePicker value={day.date} onChange={moveDay} label="Pick a date" />
                  </label>
                  <span className="hint day-move-hint">
                    The day moves whole — items, notes and its chat come with it. Landing on a date
                    another day already holds swaps the two.
                  </span>
                </div>
              </>
            ) : (
              day.summary && <div className="hint" dir="auto">{day.summary}</div>
            )}

            {showMap && (
              <DayMap
                stops={stops} gmapsKey={gmapsKey} theme={theme} fitKey={day.date}
                selectedKey={selected == null ? null : String(selected)}
                onSelect={(k) => { setSelected(Number(k)); setRail("place"); }}
              />
            )}

            <ul className="items plan-items">
              {(day.items || []).map((it, i) => {
                const place = it.place_id != null ? placeById.get(it.place_id) : undefined;
                const prev = i > 0 ? day.items[i - 1] : null;
                const hop = prev ? hopBetween(prev, it, placeById, mode) : null;
                const short = prev && hop ? hopShortfall(prev, it, hop) : 0;
                const KindIcon = KIND_ICON[it.kind] || CircleDot;
                return (
                  <li key={i} className="plan-row">
                    {hop && (
                      <div className={`hop${short > 0 ? " tight" : ""}`}>
                        {(() => { const Icon = TRANSPORT_ICON[mode] || Route; return <Icon size={11} />; })()}
                        ~{hop.minutes} min · {hop.km.toFixed(1)} km
                        {short > 0 && <span className="hop-short"> · {short} min short</span>}
                      </div>
                    )}
                    <div
                      data-drop={editing ? "index" : undefined}
                      data-index={i}
                      className={
                        `item kind-${it.kind}` +
                        (selected === i ? " selected" : "") +
                        (dragging === `item-${i}` ? " dragging" : "") +
                        (over === `index-${i}` ? " drag-over" : "")
                      }
                    >
                      {editing && (
                        <button
                          type="button" className="item-drag" aria-label="Drag to reorder"
                          onPointerDown={(e) => startDrag(e, { kind: "item", index: i })}
                        ><GripVertical size={14} /></button>
                      )}

                      {editing ? (
                        <div className="item-edit">
                          <div className="item-edit-top">
                            <TimeField value={it.time || ""} label={`Start time for ${it.title}`}
                              onSave={(v) => patchItem(i, { time: v })} />
                            <select value={it.kind} onChange={(e) => patchItem(i, { kind: e.target.value })} aria-label="Kind">
                              {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                            </select>
                            <label className="item-dur">
                              <input type="number" min={0} step={15} value={it.duration_min ?? 0}
                                onChange={(e) => patchItem(i, { duration_min: Number(e.target.value) })} aria-label="Minutes" />
                              <span className="hint">min</span>
                            </label>
                            {it.pinned && <span className="pin-badge" title="Comes from a booking or a stated arrival time"><Clock size={11} /> fixed</span>}
                            <button className="icon-btn danger-ghost" aria-label="Remove from the day"
                              onClick={() => removeItem(i)}><Trash2 size={14} /></button>
                          </div>
                          <input dir="auto" className="item-title-input" value={it.title}
                            onChange={(e) => patchItem(i, { title: e.target.value })} aria-label="Title" />
                        </div>
                      ) : (
                        <>
                          <span className="time">{it.time}</span>
                          <span className="icon"><KindIcon size={13} /></span>
                          <span dir="auto" className="grow">
                            {it.title}
                            {place?.status === "dropped" && <em className="hint"> (dropped from the trip)</em>}
                            {it.details && <div className="item-details" dir="auto">{it.details}</div>}
                            {it.tip && <div className="item-tip icon-line" dir="auto"><Sparkles size={11} className="ai-mark" /> {it.tip}</div>}
                          </span>
                          <span className="hint nowrap">{it.duration_min ? `${it.duration_min}m` : ""}</span>
                        </>
                      )}

                      {place && (
                        <button
                          className="icon-btn item-info" title={`About ${place.name}`} aria-label={`About ${place.name}`}
                          onClick={() => { setSelected(i); setRail("place"); }}
                        ><Info size={14} /></button>
                      )}
                    </div>
                  </li>
                );
              })}

              {editing && (
                <li
                  data-drop="end"
                  className={`drop-end${over === "end" ? " drag-over" : ""}`}
                >Drop a place here to add it at the end of the day</li>
              )}
              {(day.items || []).length === 0 && !editing && (
                <li className="hint">Nothing scheduled for this day yet — hit Edit and drag places in.</li>
              )}
            </ul>

            {editing && (
              <div className="day-add-row">
                <button className="small btn-icon" onClick={() => appendItem({
                  time: timeAt(day.items || [], (day.items || []).length, day.wake_time),
                  kind: "meal", title: "Meal", place_id: null, duration_min: 60,
                })}><Plus size={13} /> Meal</button>
                <button className="small btn-icon" onClick={() => appendItem({
                  time: timeAt(day.items || [], (day.items || []).length, day.wake_time),
                  kind: "rest", title: "Rest", place_id: null, duration_min: 60,
                })}><Plus size={13} /> Rest</button>
                <button className="small btn-icon" onClick={() => appendItem({
                  time: timeAt(day.items || [], (day.items || []).length, day.wake_time),
                  kind: "other", title: "New item", place_id: null, duration_min: 30,
                })}><Plus size={13} /> Something else</button>
              </div>
            )}

            {day.warnings?.map((w, i) => (
              <div className="alert small icon-line" key={i}><TriangleAlert size={12} /> {w}</div>
            ))}
          </div>
        )}

        {/* Every place on the trip, ready to drag onto the day. The filters narrow it; none of
            them hide anything you can't get back with one click. */}
        {editing && (
          <div
            data-drop="tray"
            className={`plan-tray${over === "tray" ? " drag-over" : ""}`}
          >
            <div className="row spread">
              <h3>Your places <span className="hint">{trayPlaces.length} of {places.length}</span></h3>
              <span className="hint">Drag onto the day — or drag a scheduled item back here to take it off.</span>
            </div>
            <div className="tray-filters">
              <input
                dir="auto" className="tray-search" placeholder="Search your places…"
                value={trayQuery} onChange={(e) => setTrayQuery(e.target.value)}
              />
              <button
                className={`chip-toggle${trayCityOnly ? " active" : ""}`} aria-pressed={trayCityOnly}
                onClick={() => setTrayCityOnly((v) => !v)}
                title="Show only places in this day's city (places with no city always show)"
              >{activeLeg ? activeLeg.city : "This city"}</button>
              <button
                className={`chip-toggle${trayUnusedOnly ? " active" : ""}`} aria-pressed={trayUnusedOnly}
                onClick={() => setTrayUnusedOnly((v) => !v)}
                title="Hide places already scheduled somewhere in the plan"
              >Not scheduled yet</button>
            </div>
            <div className="tray-list">
              {trayPlaces.map((p) => (
                <div
                  key={p.id}
                  className={`tray-card${dragging === `place-${p.id}` ? " dragging" : ""}`}
                  onPointerDown={(e) => startDrag(e, { kind: "place", placeId: p.id })}
                >
                  <span className="tray-dot" style={{ background: CATEGORY_COLORS[p.category] || CATEGORY_COLORS.other }} />
                  <span className="grow tray-name" dir="auto">
                    {p.name}
                    <span className="tray-meta">
                      {legCity.get(p.leg_id ?? -1) || "no city"} · {p.duration_min}m · {p.priority}
                    </span>
                  </span>
                  {scheduledIds.has(p.id) && <span className="tray-badge" title="Already on a day">on a day</span>}
                  <GripVertical size={13} className="tray-grip" />
                </div>
              ))}
              {trayPlaces.length === 0 && (
                <p className="hint">
                  {places.length === 0
                    ? "No places on this trip yet — add them on the Places tab."
                    : "Nothing matches those filters. Turn one off above to see more."}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Per-day, because "replan the day" only means anything against a specific day. */}
        {editing && day && (
          <DayChat tripId={trip.id} day={day} llmReady={llmReady} onApply={applyChatProposal} />
        )}

        {unscheduled.length > 0 && !editing && (
          <div className="alert">
            Not on any day yet: {unscheduled.map((id) => placeById.get(id)?.name || `#${id}`).join(", ")}
          </div>
        )}
      </div>

      <aside className={`advisor${railOpen ? "" : " collapsed"}`}>
        {/* Collapsed, the rail is a strip of buttons that reopen it — it stops holding 350px of a
            laptop screen open for advice you've already read, without hiding that it's there. */}
        {!railOpen ? (
          <div className="rail-stub">
            <button className="rail-stub-btn" title="Show the advisor" aria-label="Show the advisor"
              onClick={() => { setRail("advisor"); setRailOpen(true); }}>
              <Sparkles size={16} className="ai-mark" />
              {adviceCount > 0 && <span className="rail-count">{adviceCount}</span>}
            </button>
            <button className="rail-stub-btn" title="Show the selected place" aria-label="Show the selected place"
              disabled={!selectedPlace}
              onClick={() => { setRail("place"); setRailOpen(true); }}>
              <Info size={16} />
            </button>
            <span className="rail-stub-label">Advisor</span>
          </div>
        ) : (
        <>
        <div className="rail-tabs">
          <button className={rail === "advisor" ? "active" : ""} onClick={() => setRail("advisor")}>
            <Sparkles size={13} className="ai-mark" /> Advisor
            {adviceCount > 0 && <span className="rail-count">{adviceCount}</span>}
          </button>
          <button className={rail === "place" ? "active" : ""} onClick={() => setRail("place")} disabled={!selectedPlace}>
            <Info size={13} /> Place
          </button>
          <button className="rail-close" title="Collapse this panel" aria-label="Collapse this panel"
            onClick={() => setRailOpen(false)}><PanelRightClose size={15} /></button>
        </div>

        {rail === "place" ? (
          selectedPlace ? (
            <PlaceInsightPanel place={selectedPlace} city={activeLeg?.city || ""} llmReady={llmReady} />
          ) : (
            <p className="hint">Tap a stop on the day (or a pin on the map) to read about it.</p>
          )
        ) : (
          <>
            <div className="row spread">
              <h2 className="icon-line"><Sparkles size={15} className="ai-mark" /> Advisor</h2>
              <button className="small" onClick={reAdvise} disabled={!llmReady || advising}>{advising ? "…" : "Re-analyze"}</button>
            </div>
            <p className="hint">
              The advisor never suggests new places — it only tells you what to drop, when to rest, and
              when you'll have to get up early. It reads whatever is saved, hand-built plans included.
            </p>
            {/* It reads the plan as it was when it last ran, so once you've edited the day it is
                describing something that no longer exists. Saying so is the difference between a
                panel that looks broken and one that's honestly out of date. */}
            {advisor && adviceStale && (
              <div className="alert small icon-line">
                <TriangleAlert size={12} />
                <span className="grow">You've edited the plan since this was written.</span>
                <button className="inline" onClick={reAdvise} disabled={!llmReady || advising}>
                  {advising ? "Re-reading…" : "Re-analyze"}
                </button>
              </div>
            )}
            {!advisor && <p className="hint">No analysis yet.</p>}
            {advisor && (
              <>
                <p dir="auto">{advisor.overall}</p>
                {advisor.pacing_alerts?.length > 0 && (
                  <>
                    <h3>Pacing</h3>
                    {advisor.pacing_alerts.map((a, i) => (
                      <div key={i} className={`alert type-${a.type}`}>
                        <button className="alert-date" onClick={() => goToDate(a.date)}>{a.date}</button>{" "}
                        <AdvisorIcon type={a.type} /> <span dir="auto">{a.message}</span>
                      </div>
                    ))}
                  </>
                )}
                {advisor.drop_suggestions?.length > 0 && (
                  <>
                    <h3>Consider dropping</h3>
                    {advisor.drop_suggestions.map((s, i) => (
                      <div key={i} className="alert">
                        <strong dir="auto">{s.place_name}</strong> — <span dir="auto">{s.reason}</span>
                        {s.place_id != null && placeById.get(s.place_id)?.status === "active" && (
                          <button className="small" onClick={() => dropPlace(s.place_id)}>Drop it</button>
                        )}
                      </div>
                    ))}
                  </>
                )}
                {advisor.day_notes?.length > 0 && (
                  <>
                    <h3>Day notes</h3>
                    {advisor.day_notes.map((n, i) => (
                      <p key={i} className="hint">
                        <button className="alert-date" onClick={() => goToDate(n.date)}>{n.date}</button>{" "}
                        <span dir="auto">{n.note}</span>
                      </p>
                    ))}
                  </>
                )}
              </>
            )}
          </>
        )}
        </>
        )}
      </aside>
    </div>
  );
}

function AdvisorIcon({ type }: { type: string }) {
  const Icon = ({
    overload: Flame, early_wake: Sunrise, rest_needed: BedDouble,
    transit_heavy: TrainFront, budget: Wallet,
  } as Record<string, typeof Flame>)[type] || TriangleAlert;
  return <Icon size={13} />;
}

function safeParse<T>(s: string): T | null {
  try { return JSON.parse(s) as T; } catch { return null; }
}
