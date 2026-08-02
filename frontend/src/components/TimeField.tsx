import { useEffect, useState } from "react";

/**
 * A time field that looks the same on every platform.
 *
 * iOS Safari draws `<input type="time">` differently in two ways, both obvious once the app
 * is installed as a PWA: an unset one is completely blank — there is no `--:--` the way
 * desktop Chrome shows one — and it sizes itself from its own content rather than from the
 * box around it, so it stands taller than the text inputs beside it.
 *
 * Rather than fight the control, the wrapper owns the appearance: it draws the bordered
 * field and the placeholder, and the input inside is stripped to a transparent filler. That
 * makes the height ours on every platform, and gives one `--:--` — with the browser's own
 * empty rendering hidden, so the two can never both show.
 *
 * The native picker is deliberately kept. The iOS time wheel is better than anything worth
 * hand-rolling on a phone; only the resting appearance needed fixing.
 */
export default function TimeField({ value, onSave, label }: {
  value: string | null;
  onSave: (value: string) => void;
  label: string;
}) {
  const current = value ?? "";
  const [draft, setDraft] = useState(current);
  // Re-sync when the row is refreshed from the server.
  useEffect(() => setDraft(current), [current]);

  return (
    <span className={`time-field${draft ? "" : " empty"}`}>
      <input
        type="time" aria-label={label} value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if (draft !== current) onSave(draft); }}
      />
    </span>
  );
}
