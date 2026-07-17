import { useState } from "react";
import { api } from "../api";

export default function ImportTab({ onImported }: { onImported: (tripId: number) => Promise<void> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      <h2>Import a trip from a conversation</h2>
      <p className="hint">
        Planned your trip in a chat with Claude / ChatGPT / anything else? Paste the whole conversation
        here (any language — Hebrew works). Your configured LLM extracts the destinations, dates, places,
        budget and todos into a new trip. Nothing is invented — only what the conversation contains.
      </p>
      <ol className="hint">
        <li>Open the conversation (e.g. claude.ai), select all (Ctrl+A) and copy (Ctrl+C).</li>
        <li>Paste below and click Import.</li>
      </ol>
      {error && <div className="banner error">{error}</div>}
      <textarea
        dir="auto"
        rows={16}
        placeholder="Paste the full conversation here…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button className="primary" onClick={run} disabled={busy || text.trim().length < 50}>
        {busy ? "Extracting trip… (can take ~a minute)" : "Import conversation"}
      </button>
    </div>
  );
}
