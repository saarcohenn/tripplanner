/**
 * Donut chart with a legend, hand-rolled in SVG — a charting library would be by far the
 * heaviest thing in this app's bundle for the two charts it would draw.
 *
 * Each slice is one circle with a dash pattern of "arc, rest of circumference" and an offset
 * that walks around the ring, which needs no arc-path maths and animates cleanly. Hovering
 * either a slice or its legend row highlights both.
 */
import { useState } from "react";

export type Slice = { label: string; value: number; color: string };

const SIZE = 168;
const R = 60;
const STROKE = 26;
const CIRC = 2 * Math.PI * R;
/** Surface gap between arcs, in path units — keeps two neighbours from reading as one. */
const GAP = 2;

export default function DonutChart({ slices, centerValue, centerLabel, format }: {
  slices: Slice[];
  centerValue: string;
  centerLabel: string;
  format: (value: number) => string;
}) {
  const [active, setActive] = useState<string | null>(null);
  const total = slices.reduce((s, x) => s + x.value, 0);

  if (total <= 0) return <p className="hint">Nothing yet.</p>;

  let walked = 0;
  const arcs = slices.map((s) => {
    const len = (s.value / total) * CIRC;
    const arc = { ...s, len, offset: -walked, pct: (s.value / total) * 100 };
    walked += len;
    return arc;
  });

  return (
    <div className="donut-wrap">
      <svg className="donut" viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={centerLabel}>
        {/* Rotated so the first slice starts at twelve o'clock rather than three. */}
        <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
          {arcs.map((a) => (
            <circle
              key={a.label}
              className={`donut-arc${active && active !== a.label ? " dim" : ""}`}
              cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none"
              // Via style, not the attribute: the slot colours are CSS variables, which a
              // presentation attribute wouldn't resolve.
              style={{ stroke: a.color }}
              strokeWidth={active === a.label ? STROKE + 6 : STROKE}
              // A 2px gap of surface between arcs, so neighbours never merge into one shape.
              strokeDasharray={`${Math.max(0, a.len - GAP)} ${CIRC - a.len + GAP}`}
              strokeDashoffset={a.offset}
              onMouseEnter={() => setActive(a.label)}
              onMouseLeave={() => setActive(null)}
            >
              <title>{`${a.label} — ${format(a.value)} (${a.pct < 1 ? "<1" : a.pct.toFixed(0)}%)`}</title>
            </circle>
          ))}
        </g>
        <text className="donut-value" x="50%" y="48%" textAnchor="middle">{centerValue}</text>
        <text className="donut-label" x="50%" y="62%" textAnchor="middle">{centerLabel}</text>
      </svg>

      <ul className="donut-legend">
        {arcs.map((a) => (
          <li
            key={a.label}
            className={active && active !== a.label ? "dim" : ""}
            onMouseEnter={() => setActive(a.label)}
            onMouseLeave={() => setActive(null)}
          >
            <span className="donut-dot" style={{ background: a.color }} aria-hidden="true" />
            <span className="donut-name" dir="auto">{a.label}</span>
            <span className="donut-pct">{a.pct < 1 ? "<1" : a.pct.toFixed(0)}%</span>
            <span className="donut-amt">{format(a.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
