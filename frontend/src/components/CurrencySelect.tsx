import type { Leg } from "../types";
import { ALL_CURRENCIES, suggestedCurrencies } from "../currencies";

/**
 * Currency picker: ILS/USD/EUR plus the trip's local currencies up top,
 * the full searchable-by-name ISO list below.
 */
export default function CurrencySelect({ value, onChange, legs, title }: {
  value: string;
  onChange: (code: string) => void;
  legs?: Leg[];
  title?: string;
}) {
  const suggested = suggestedCurrencies(legs || []);
  const rest = ALL_CURRENCIES.filter((c) => !suggested.includes(c.code));
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} title={title || "Currency"}>
      {value && !suggested.includes(value) && !rest.some((c) => c.code === value) && (
        <option value={value}>{value}</option>
      )}
      <optgroup label="Suggested">
        {suggested.map((c) => <option key={c} value={c}>{c}</option>)}
      </optgroup>
      <optgroup label="All currencies">
        {rest.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
      </optgroup>
    </select>
  );
}
