import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

/**
 * A single control for picking a start/end date pair, replacing two native date inputs.
 *
 * Hand-rolled rather than pulling in a date library: the app only ever deals in plain
 * `YYYY-MM-DD` strings (no times, no zones), so the arithmetic is a few lines and a
 * dependency would cost more than it saves. All maths is done on local Date objects
 * constructed at midnight, so a value never shifts a day across timezones.
 */

/**
 * Narrowest window that fits two month grids side by side: two 7-column grids at 32px a
 * column, the gap between them, the popover's padding, and a margin either side. Below
 * this the second grid is dropped rather than squeezed — measured from the CSS, so keep
 * the two in step if .drp-grid's column width or .drp-months' gap changes.
 */
const TWO_MONTH_MIN = 520;

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
  start, end, onChange, startLabel = "Start", endLabel = "End", months = 2, single = false,
}: {
  start: string | null;
  end: string | null;
  onChange: (start: string | null, end: string | null) => void;
  startLabel?: string;
  endLabel?: string;
  /** How many month grids to show side by side, capped at what fits — see TWO_MONTH_MIN. */
  months?: number;
  /**
   * One date instead of two: the first click commits and closes, and the night count and
   * range shading go away. Same field and same calendar, so a form that needs both kinds
   * of date doesn't end up speaking two visual languages. Use the DatePicker wrapper below
   * rather than passing this directly.
   */
  single?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // While picking, only the start is committed until a second click lands.
  const [pendingStart, setPendingStart] = useState<Date | null>(null);
  const [hovered, setHovered] = useState<Date | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [wideEnough, setWideEnough] = useState(() => window.innerWidth >= TWO_MONTH_MIN);
  // How many grids actually get drawn: what was asked for, unless there isn't room for it.
  const shownMonths = wideEnough ? months : 1;

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${TWO_MONTH_MIN}px)`);
    const sync = () => setWideEnough(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const startDate = fromIso(start);
  const endDate = fromIso(end);

  const [viewMonth, setViewMonth] = useState<Date>(() => startOfMonth(startDate || new Date()));
  // Re-anchor the calendar when it's opened, so it lands on the current value rather than
  // wherever the user last browsed to.
  useEffect(() => {
    if (open) setViewMonth(startOfMonth(fromIso(start) || new Date()));
  }, [open, start]);

  /**
   * The calendar is rendered into <body> and positioned against the field, because as an
   * absolutely-positioned child it lost both ways: .pad scrolls vertically, which makes it
   * a scroll container horizontally too, so an overhanging calendar was clipped and added a
   * sideways scrollbar to the whole tab; and cards like .todo carry a fill-mode animation,
   * which gives each its own stacking context, so a later sibling painted over a calendar
   * opened from an earlier one regardless of z-index.
   *
   * Flips to the left of the field, or above it, rather than hanging off either edge.
   */
  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    function place() {
      const field = wrapRef.current?.getBoundingClientRect();
      const pop = popRef.current?.getBoundingClientRect();
      if (!field || !pop) return;
      // Scrolled its field out of view: a fixed calendar would otherwise sail up over the
      // header still faithfully anchored to something nobody can see.
      if (field.bottom < 0 || field.top > window.innerHeight) { setOpen(false); return; }
      const left = field.left + pop.width > window.innerWidth - 12
        ? Math.max(12, field.right - pop.width)
        : field.left;
      const top = field.bottom + 6 + pop.height > window.innerHeight - 12
        ? Math.max(12, field.top - pop.height - 6)
        : field.bottom + 6;
      setPos({ top, left });
    }
    place();
    window.addEventListener("resize", place);
    // Capture phase, so it follows the field when any ancestor scrolls, not just the window.
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, shownMonths]);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      const inside = wrapRef.current?.contains(t) || popRef.current?.contains(t);
      if (!inside) {
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
    if (single) return [startDate, startDate];
    if (pendingStart) {
      if (!hovered) return [pendingStart, pendingStart];
      return hovered < pendingStart ? [hovered, pendingStart] : [pendingStart, hovered];
    }
    return [startDate, endDate];
  }, [single, pendingStart, hovered, startDate, endDate]);

  function pick(day: Date) {
    if (single) {
      onChange(toIso(day), null);
      setOpen(false);
      return;
    }
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

  const nights = !single && startDate && endDate ? nightsBetween(startDate, endDate) : null;
  const summary = startDate
    ? single ? fmtShort(startDate) : `${fmtShort(startDate)}${endDate ? `  →  ${fmtShort(endDate)}` : ""}`
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
          {summary || (
            <span className="drp-placeholder">{single ? startLabel : `${startLabel} → ${endLabel}`}</span>
          )}
        </span>
        {nights != null && nights > 0 && (
          <span className="drp-nights">{nights} {nights === 1 ? "night" : "nights"}</span>
        )}
        {(start || end) && (
          <span className="drp-clear" role="button" aria-label="Clear dates" onClick={clear}><X size={12} /></span>
        )}
      </button>

      {open && (
        createPortal(
          // Parked off-screen until measured; that happens before paint, so there's no flash.
          <div
            className="drp-pop" ref={popRef} role="dialog" aria-label="Choose dates"
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
          >
          <div className="drp-head">
            <button type="button" className="drp-nav" aria-label="Previous month"
              onClick={() => setViewMonth((m) => addMonths(m, -1))}><ChevronLeft size={16} /></button>
            <div className="drp-hint">
              {single ? startLabel : pendingStart ? "Now pick the end date" : "Pick the start date"}
            </div>
            <button type="button" className="drp-nav" aria-label="Next month"
              onClick={() => setViewMonth((m) => addMonths(m, 1))}><ChevronRight size={16} /></button>
          </div>

          <div className="drp-months" onMouseLeave={() => setHovered(null)}>
            {Array.from({ length: shownMonths }, (_, i) => addMonths(viewMonth, i)).map((m) => (
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
          </div>,
          document.body
        ))}
    </div>
  );
}

/**
 * One date, same field and same calendar as the range picker above. A thin wrapper rather
 * than a second component so there is exactly one place where a date gets picked in this
 * app — see .claude/skills/date-fields.
 */
export function DatePicker({ value, onChange, label = "Pick a date" }: {
  value: string | null;
  onChange: (value: string | null) => void;
  label?: string;
}) {
  return (
    <DateRangePicker
      single months={1} start={value} end={null} startLabel={label}
      onChange={(v) => onChange(v)}
    />
  );
}
