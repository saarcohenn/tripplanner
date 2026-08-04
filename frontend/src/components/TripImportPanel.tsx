import { useMemo, useState } from "react";
import {
  BedDouble, Check, CircleCheck, Hourglass, ListTodo, MapPin, Plane, Sparkles, TriangleAlert, Undo2,
} from "lucide-react";
import { api } from "../api";
import type { ImportProposal } from "../types";

type Section = "legs" | "places" | "todos" | "bookings";
type Picked = Record<Section, Set<number>> & { trip: boolean; notes: boolean };

const SECTION_META: { key: Section; label: string; Icon: typeof MapPin }[] = [
  { key: "legs", label: "Cities", Icon: Plane },
  { key: "places", label: "Places", Icon: MapPin },
  { key: "bookings", label: "Bookings", Icon: BedDouble },
  { key: "todos", label: "Todos", Icon: ListTodo },
];

/** Everything not already in the trip starts ticked; anything that is starts unticked. */
function initialPicks(p: ImportProposal): Picked {
  const pick = (rows: { exists: boolean }[]) =>
    new Set(rows.map((r, i) => (r.exists ? -1 : i)).filter((i) => i >= 0));
  return {
    legs: pick(p.legs), places: pick(p.places), todos: pick(p.todos), bookings: pick(p.bookings),
    trip: Object.keys(p.trip).length > 0,
    notes: !!p.notes,
  };
}

function rowLabel(section: Section, row: any): { title: string; meta: string } {
  switch (section) {
    case "legs":
      return {
        title: [row.city, row.country].filter(Boolean).join(", "),
        meta: [row.arrive_date, row.depart_date].filter(Boolean).join(" → "),
      };
    case "places":
      return {
        title: row.name,
        meta: [row.city, row.category, row.duration_min ? `~${row.duration_min}m` : "", row.priority]
          .filter(Boolean).join(" · "),
      };
    case "bookings":
      return {
        title: row.title,
        meta: [row.kind, row.city, [row.date, row.end_date].filter(Boolean).join(" → "),
          row.cost ? `${row.cost} ${row.currency || ""}`.trim() : ""].filter(Boolean).join(" · "),
      };
    case "todos":
      return { title: row.text, meta: [row.category, row.due_date].filter(Boolean).join(" · ") };
  }
}

const TRIP_FIELD_LABEL: Record<string, string> = {
  name: "Trip name", trip_type: "Type", start_date: "Start date", end_date: "End date",
  home_city: "Home city", budget: "Budget", currency: "Currency",
};

/**
 * Describe-it-in-prose, into a trip that already exists. The LLM call only proposes; this shows
 * what it understood, ticks the parts that aren't in the trip yet, and writes only what survives
 * the user's review. Used by the Import tab and by the Plan tab's empty state.
 */
export default function TripImportPanel({ tripId, llmReady, placeholder, onApplied }: {
  tripId: number;
  llmReady: boolean;
  placeholder?: string;
  onApplied: () => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<ImportProposal | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const total = useMemo(
    () => (picked ? SECTION_META.reduce((n, s) => n + picked[s.key].size, 0) : 0),
    [picked]
  );

  async function preview() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const p = await api.post<ImportProposal>(`/trips/${tripId}/import/preview`, { text });
      setProposal(p);
      setPicked(initialPicks(p));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function toggle(section: Section, i: number) {
    setPicked((cur) => {
      if (!cur) return cur;
      const next = new Set(cur[section]);
      next.has(i) ? next.delete(i) : next.add(i);
      return { ...cur, [section]: next };
    });
  }

  async function apply() {
    if (!proposal || !picked) return;
    setApplying(true);
    setError(null);
    try {
      const r = await api.post<{ added: Record<string, number> }>(`/trips/${tripId}/import/apply`, {
        trip: picked.trip ? proposal.trip : {},
        notes: picked.notes ? proposal.notes : "",
        legs: proposal.legs.filter((_, i) => picked.legs.has(i)),
        places: proposal.places.filter((_, i) => picked.places.has(i)),
        todos: proposal.todos.filter((_, i) => picked.todos.has(i)),
        bookings: proposal.bookings.filter((_, i) => picked.bookings.has(i)),
      });
      const parts = Object.entries(r.added).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`);
      setDone(parts.length ? `Added ${parts.join(", ")}.` : "Nothing to add — the trip already had all of it.");
      setProposal(null);
      setPicked(null);
      setText("");
      await onApplied();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="trip-import">
      {!proposal && (
        <>
          <textarea
            dir="auto" rows={6} value={text} onChange={(e) => setText(e.target.value)}
            placeholder={placeholder || "e.g. Ten days in Portugal in October — Lisbon first, then Porto. Want to see Belém Tower and Livraria Lello, and we've booked the Hotel Infante Sagres."}
          />
          <div className="row">
            <button className="primary btn-icon" onClick={preview}
              disabled={busy || !llmReady || text.trim().length < 15}
              title={llmReady ? "" : "Add an LLM key in Profile first"}>
              <Sparkles size={14} className="ai-mark" />
              {busy ? "Reading it…" : llmReady ? "See what it adds" : "Add an LLM key in Profile first"}
            </button>
            {done && <span className="hint icon-line"><CircleCheck size={13} /> {done}</span>}
          </div>
          <p className="hint">
            Nothing is written until you've seen it. Only what you actually say gets added — it never
            invents a city or an attraction to fill a gap, and it never overwrites something you set.
          </p>
        </>
      )}

      {error && <div className="alert icon-line"><TriangleAlert size={13} /> {error}</div>}

      {busy && !proposal && (
        <p className="hint icon-line"><Hourglass size={13} className="spin-slow" /> Working out what this adds to the trip…</p>
      )}

      {proposal && picked && (
        <div className="import-proposal">
          {proposal.summary && <p dir="auto">{proposal.summary}</p>}

          {Object.keys(proposal.trip).length > 0 && (
            <label className="import-row import-trip">
              <input type="checkbox" checked={picked.trip}
                onChange={() => setPicked({ ...picked, trip: !picked.trip })} />
              <span className="grow">
                <strong>Fill in the trip's blanks</strong>
                <span className="import-meta" dir="auto">
                  {Object.entries(proposal.trip).map(([k, v]) => `${TRIP_FIELD_LABEL[k] || k}: ${v}`).join(" · ")}
                </span>
              </span>
            </label>
          )}

          {SECTION_META.map(({ key, label, Icon }) => {
            const rows = proposal[key] as any[];
            if (rows.length === 0) return null;
            return (
              <section className="import-section" key={key}>
                <h4 className="icon-line"><Icon size={13} /> {label} <span className="hint">{picked[key].size}/{rows.length}</span></h4>
                {rows.map((row, i) => {
                  const { title, meta } = rowLabel(key, row);
                  return (
                    <label className={`import-row${row.exists ? " already" : ""}`} key={i}>
                      <input type="checkbox" checked={picked[key].has(i)} onChange={() => toggle(key, i)} />
                      <span className="grow">
                        <strong dir="auto">{title}</strong>
                        {meta && <span className="import-meta" dir="auto">{meta}</span>}
                      </span>
                      {row.exists && <span className="import-badge"><Check size={11} /> already in the trip</span>}
                    </label>
                  );
                })}
              </section>
            );
          })}

          {proposal.notes && (
            <label className="import-row">
              <input type="checkbox" checked={picked.notes}
                onChange={() => setPicked({ ...picked, notes: !picked.notes })} />
              <span className="grow">
                <strong>Append to the trip notes</strong>
                <span className="import-meta" dir="auto">{proposal.notes}</span>
              </span>
            </label>
          )}

          {total === 0 && Object.keys(proposal.trip).length === 0 && (
            <p className="hint">Nothing new here — the trip already covers everything in that text.</p>
          )}

          <div className="row">
            <button className="primary" onClick={apply} disabled={applying}>
              {applying ? "Adding…" : `Add ${total} ${total === 1 ? "item" : "items"} to the trip`}
            </button>
            <button className="btn-icon" onClick={() => { setProposal(null); setPicked(null); }} disabled={applying}>
              <Undo2 size={14} /> Back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
