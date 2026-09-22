/**
 * A thin horizontal stacked bar — one day's spending split by category.
 *
 * It encodes composition, not magnitude: every bar is the full width of its card whatever
 * the day cost. The day's total is stated as a number right beside it, and scaling the bars
 * against each other instead would leave the day you bought a ₪40 lunch as a two-pixel stub
 * next to the day you paid for the flights — the mix, which is the thing this bar is for,
 * would be unreadable on most days of a trip.
 *
 * Identity never rests on colour alone: the summary's category legend sits above, each
 * segment carries its own tooltip, and the expense rows under the bar are the table view.
 */
export type Segment = { label: string; value: number; color: string };

export default function CategoryBar({ segments, format }: {
  segments: Segment[];
  format: (value: number) => string;
}) {
  const parts = segments.filter((s) => s.value > 0);
  const total = parts.reduce((s, x) => s + x.value, 0);
  if (total <= 0) return null;

  const withPct = parts.map((p) => ({ ...p, pct: (p.value / total) * 100 }));

  return (
    <div
      className="catbar"
      role="img"
      aria-label={withPct.map((p) => `${p.label} ${format(p.value)}`).join(", ")}
    >
      {withPct.map((p) => (
        <span
          key={p.label}
          className="catbar-seg"
          // Width via style: it's data, not a design decision. The fill is painted into the
          // content box only (see .catbar-seg), so the segment's hover target is the full
          // height of the row while the bar itself stays thin.
          style={{ width: `${p.pct}%`, background: p.color }}
          title={`${p.label} — ${format(p.value)} (${p.pct < 1 ? "<1" : p.pct.toFixed(0)}%)`}
        />
      ))}
    </div>
  );
}
