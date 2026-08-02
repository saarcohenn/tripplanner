---
name: date-fields
description: How TripPlanner renders every date field — the shared DateRangePicker/DatePicker in frontend/src/components/DateRangePicker.tsx, its props, its date-handling rules, and how to convert a native <input type="date"> to it. Use when adding, editing, or reviewing any date input in this app.
---

# Date fields

Every date the user picks in this app goes through **one component file**,
`frontend/src/components/DateRangePicker.tsx`. There are no native
`<input type="date">` controls left in the UI, and new ones shouldn't appear:
the native control renders differently in every browser, ignores the app's
theme tokens, and can't show a range, a night count, or trip context.

## Which one to use

| Situation | Component | Import |
| --- | --- | --- |
| Two dates that bracket something (trip, leg, stay, flight out/back) | `DateRangePicker` | `import DateRangePicker from "./DateRangePicker"` |
| One standalone date (a due date, the day money was spent) | `DatePicker` | `import { DatePicker } from "./DateRangePicker"` |

Both render the same field and the same popover calendar, so a form never
mixes two visual languages. `DatePicker` is the range picker in single mode:
one month grid, no night count, first click commits and closes.

## Props

```tsx
<DateRangePicker
  start={leg.arrive_date}          // string | null, "YYYY-MM-DD"
  end={leg.depart_date}            // string | null
  onChange={(s, e) => save(s, e)}  // both null when cleared
  startLabel="Arrive"              // placeholder halves, default "Start"/"End"
  endLabel="Depart"
  months={2}                       // month grids side by side, default 2
/>
```

`months` is a ceiling, not a promise: the component drops to one grid below
`TWO_MONTH_MIN` (520px), where two 7-column grids genuinely don't fit. Don't
add a media query for this — how many months fit is about the calendar's width,
not the viewport's shape, and the component already owns it.

```tsx

<DatePicker
  value={todo.due_date}            // string | null
  onChange={(v) => save(v)}        // null when cleared
  label="Due date"                 // placeholder, default "Pick a date"
/>
```

## Rules that must not be broken

1. **Values are plain `YYYY-MM-DD` strings, never `Date` objects.** That's what
   the API and SQLite store. Empty is `null`, never `""` — the backend columns
   are nullable and `""` is not a date.
2. **Every `Date` is constructed at local midnight** — `new Date("2026-10-05T00:00:00")`,
   not `new Date("2026-10-05")`, which parses as UTC and lands on the previous
   day for anyone west of Greenwich. `fromIso`/`toIso` in the component already
   do this; use them rather than hand-rolling.
3. **No date library.** The app deals only in date-only strings with no times
   and no zones, so the arithmetic is a handful of lines. A dependency here
   would outweigh what it saves.
4. **`onChange` fires once per completed pick**, so it can save directly — there
   is no separate "apply" step and no need to debounce.

## Converting a native date input

Replace this shape:

```tsx
<label className="block">Due date
  <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
</label>
```

with:

```tsx
<label className="block">Due date
  <DatePicker value={due || null} onChange={(v) => setDue(v || "")} />
</label>
```

Watch for these when converting:

- **`defaultValue` + `onBlur`.** Uncontrolled native inputs in this app save on
  blur. The pickers are controlled and fire `onChange` on pick, so drop the
  blur handler and the change guard with it.
- **`""` vs `null`.** Form state often holds `""`; convert at the boundary as
  above rather than letting `""` reach the API.
- **A pair of inputs is a range.** If two date inputs in the same form bracket
  one thing, they become a single `DateRangePicker`, not two `DatePicker`s —
  that's the whole point, and it's where the night count comes from.
- **Layout.** The field is a button, not an input, and fills its container. In
  a `.form-grid` cell give the label `className="drp-label"`, which spans two
  columns once the grid actually has two (see the media query — spanning below
  that width overflows the page).

## Styling

All of it lives under the `.drp*` prefix in `frontend/src/styles.css`
(`.drp-field`, `.drp-pop`, `.drp-day`, and so on) and is built from theme
tokens, so both themes and the focus ring come free. Don't add per-usage
styles; if a usage needs something different, change the shared rules so every
date field moves together.

Two rules about the calendar specifically:

- **It is rendered into `<body>` and positioned by the component**, so don't
  give `.drp-pop` a `top`/`left`/`right` in CSS — an inline `left` plus a
  stylesheet `right` stretches a fixed-position box instead of placing it. It
  lives outside its field's subtree because `.pad` scrolls (making it a
  horizontal clipping context) and cards like `.todo` carry fill-mode
  animations (giving each its own stacking context), either of which would
  swallow an absolutely-positioned calendar.
- **Placement is fit-based, not breakpoint-based.** It flips left of the field
  or above it as needed, and closes if its field scrolls out of view.
