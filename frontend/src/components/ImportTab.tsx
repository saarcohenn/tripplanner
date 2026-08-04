import { useState } from "react";
import { FilePlus2, PlusCircle } from "lucide-react";
import { api } from "../api";
import type { Trip } from "../types";
import TripImportPanel from "./TripImportPanel";

export default function ImportTab({ trips, selectedId, llmReady, onImported, refresh }: {
  trips: Trip[];
  selectedId: number | null;
  llmReady: boolean;
  onImported: (tripId: number) => Promise<void>;
  refresh: () => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"new" | "existing">("new");

  // A viewer can read a shared trip but not add to it — the server refuses either way, this
  // just keeps the trip out of a menu whose only purpose is writing to it.
  const writable = trips.filter((t) => t.my_role !== "viewer");
  // Derived, not seeded: the trip list arrives a tick after first render, so a useState initialiser
  // would have latched null while the <select> happily displayed its first option. Falling back
  // each render also survives the chosen trip being deleted from under it.
  const [chosenId, setChosenId] = useState<number | null>(null);
  const preferred = writable.some((t) => t.id === selectedId) ? selectedId : writable[0]?.id ?? null;
  const targetId = writable.some((t) => t.id === chosenId) ? chosenId : preferred;

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ trip_id: number }>("/import/conversation", { text });
      setText("");
      await onImported(r.trip_id);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pad narrow">
      <h2>Import</h2>
      <p className="hint">
        Planned somewhere else — a chat with Claude / ChatGPT, or just in your head? Paste or describe it
        and your configured LLM turns it into trip data. Any language (Hebrew works). Nothing is invented:
        only what the text actually contains.
      </p>

      <div className="import-modes">
        <button className={`chip-toggle${mode === "new" ? " active" : ""}`} aria-pressed={mode === "new"}
          onClick={() => setMode("new")}><FilePlus2 size={13} /> Start a new trip</button>
        <button className={`chip-toggle${mode === "existing" ? " active" : ""}`} aria-pressed={mode === "existing"}
          onClick={() => setMode("existing")} disabled={writable.length === 0}
          title={writable.length ? "" : "You need a trip you can edit first"}>
          <PlusCircle size={13} /> Add to a trip you already have
        </button>
      </div>

      {mode === "new" ? (
        <>
          <ol className="hint">
            <li>Open the conversation (e.g. claude.ai), select all (Ctrl+A) and copy (Ctrl+C).</li>
            <li>Paste below and click Import.</li>
          </ol>
          {error && <div className="banner error">{error}</div>}
          <textarea
            dir="auto" rows={16} placeholder="Paste the full conversation here…"
            value={text} onChange={(e) => setText(e.target.value)}
          />
          <button className="primary" onClick={run} disabled={busy || text.trim().length < 50}>
            {busy ? "Extracting trip… (can take ~a minute)" : "Import conversation"}
          </button>
        </>
      ) : (
        <>
          <label className="block">Add to
            <select value={targetId ?? ""} onChange={(e) => setChosenId(Number(e.target.value))}>
              {writable.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <p className="hint">
            This one reads the trip first, so it proposes what's <em>missing</em> rather than a second copy
            of what's there — new places attach to cities the trip already has, and blank trip details get
            filled without touching anything you've already set.
          </p>
          {targetId != null && (
            <TripImportPanel
              key={targetId} tripId={targetId} llmReady={llmReady} onApplied={refresh}
              placeholder="Paste a conversation, or just say it: “We added three days in Porto after Lisbon — want to do a port cellar tour and the Livraria Lello. Booked the Infante Sagres for the 12th to the 15th.”"
            />
          )}
        </>
      )}
    </div>
  );
}
