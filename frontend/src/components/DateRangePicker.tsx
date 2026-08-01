import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

/**
 * A single control for picking a start/end date pair, replacing two native date inputs.
 *
 * Hand-rolled rather than pulling in a date library: the app only ever deals in plain
 * `YYYY-MM-DD` strings (no times, no zones), so the arithmetic is a few lines and a
 * dependency would cost more than it saves. All maths is done on local Date objects
 * constructed at midnight, so a value never shifts a day across timezones.
 */

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function toIso(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function fromIso(s: string | null): Date | null {
  if (!s) return null;
  const d = new Date(`${s}T00:00:00`);
  return isNaN(d.getTime()) ? null : d;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function sameDay(a: Date | null, b: Date | null): boolean {
  return !!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function fmtShort(d: Date | null): string {
  return d ? d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";
}

/** Whole days between two dates, both at local midnight. */
function nightsBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/** The cells of one month grid, Monday-first, padded with nulls to whole weeks. */
function monthGrid(month: Date): (Date | null)[] {
  const first = startOfMonth(month);
  // getDay() is Sunday-first; shift so Monday === 0.
  const lead = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = Array(lead).fill(null);
  for (let i = 1; i <= daysInMonth; i++) cells.push(new Date(month.getFullYear(), month.getMonth(), i));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export default function DateRangePicker({
  start, end, onChange, startLabel = "Start", endLabel = "End", months = 2,
}: {
  start: string | null;
  end: string | null;
  onChange: (start: string | null, end: string | null) => void;
  startLabel?: string;
  endLabel?: string;
  /** How many month grids to show side by side (falls back to 1 on narrow screens). */
  months?: number;
}) {
  const [open, setOpen] = useState(false);
  // While picking, only the start is committed until a second click lands.
  const [pendingStart, setPendingStart] = useState<Date | null>(null);
  const [hovered, setHovered] = useState<Date | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const startDate = fromIso(start);
  const endDate = fromIso(end);

  const [viewMonth, setViewMonth] = useState<Date>(() => startOfMonth(startDate || new Date()));
  // Re-anchor the calendar when it's opened, so it lands on the current value rather than
  // wherever the user last browsed to.
  useEffect(() => {
    if (open) setViewMonth(startOfMonth(fromIso(start) || new Date()));
  }, [open, start]);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setPendingStart(null);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { setOpen(false); setPendingStart(null); }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  // The range being drawn right now: either the committed one, or start→cursor mid-pick.
  const [rangeFrom, rangeTo] = useMemo<[Date | null, Date | null]>(() => {
    if (pendingStart) {
      if (!hovered) return [pendingStart, pendingStart];
      return hovered < pendingStart ? [hovered, pendingStart] : [pendingStart, hovered];
    }
    return [startDate, endDate];
  }, [pendingStart, hovered, startDate, endDate]);

  function pick(day: Date) {
    if (!pendingStart) {
      setPendingStart(day);
      return;
    }
    // Second click closes the range; clicking earlier than the first flips the order.
    const [a, b] = day < pendingStart ? [day, pendingStart] : [pendingStart, day];
    onChange(toIso(a), toIso(b));
    setPendingStart(null);
    setHovered(null);
    setOpen(false);
  }

  function clear(e: React.MouseEvent) {
    e.stopPropagation();
    onChange(null, null);
    setPendingStart(null);
  }

  const nights = startDate && endDate ? nightsBetween(startDate, endDate) : null;
  const summary = startDate
    ? `${fmtShort(startDate)}${endDate ? `  →  ${fmtShort(endDate)}` : ""}`
    : "";

  return (
    <div className="drp" ref={wrapRef}>
      <button
        type="button"
        className={`drp-field${open ? " open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className="drp-value">
          {summary || <span className="drp-placeholder">{startLabel} → {endLabel}</span>}
        </span>
        {nights != null && nights > 0 && (
          <span className="drp-nights">{nights} {nights === 1 ? "night" : "nights"}</span>
        )}
        {(start || end) && (
          <span className="drp-clear" role="button" aria-label="Clear dates" onClick={clear}><X size={12} /></span>
        )}
      </button>

      {open && (
        <div className="drp-pop" role="dialog" aria-label="Choose dates">
          <div className="drp-head">
            <button type="button" className="drp-nav" aria-label="Previous month"
              onClick={() => setViewMonth((m) => addMonths(m, -1))}><ChevronLeft size={16} /></button>
            <div className="drp-hint">
              {pendingStart ? "Now pick the end date" : "Pick the start date"}
            </div>
            <button type="button" className="drp-nav" aria-label="Next month"
              onClick={() => setViewMonth((m) => addMonths(m, 1))}><ChevronRight size={16} /></button>
          </div>

          <div className="drp-months" onMouseLeave={() => setHovered(null)}>
            {Array.from({ length: months }, (_, i) => addMonths(viewMonth, i)).map((m) => (
              <div className="drp-month" key={`${m.getFullYear()}-${m.getMonth()}`}>
                <div className="drp-month-name">{MONTHS[m.getMonth()]} {m.getFullYear()}</div>
                <div className="drp-weekdays">
                  {WEEKDAYS.map((w) => <span key={w}>{w}</span>)}
                </div>
                <div className="drp-grid">
                  {monthGrid(m).map((day, i) => {
                    if (!day) return <span key={i} className="drp-day empty" />;
                    const isFrom = sameDay(day, rangeFrom);
                    const isTo = sameDay(day, rangeTo);
                    const inRange = !!rangeFrom && !!rangeTo && day > rangeFrom && day < rangeTo;
                    const cls = [
                      "drp-day",
                      isFrom || isTo ? "sel" : "",
                      isFrom && rangeTo && !sameDay(rangeFrom, rangeTo) ? "from" : "",
                      isTo && rangeFrom && !sameDay(rangeFrom, rangeTo) ? "to" : "",
                      inRange ? "in" : "",
                      sameDay(day, new Date()) ? "today" : "",
                    ].filter(Boolean).join(" ");
                    return (
                      <button
                        key={i} type="button" className={cls}
                        onClick={() => pick(day)}
                        onMouseEnter={() => pendingStart && setHovered(day)}
                      >{day.getDate()}</button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
