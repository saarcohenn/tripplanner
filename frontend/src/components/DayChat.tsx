import { useEffect, useRef, useState } from "react";
import {
  Check, Eraser, Hourglass, MapPin, Search, Send, Sparkles, TriangleAlert, Undo2,
} from "lucide-react";
import { api } from "../api";
import type { ChatMessage, ChatProposal, ChatTurn, PlanDay } from "../types";

/**
 * Editing one day by conversation.
 *
 * The chat never writes to the plan. It comes back with a proposed replacement for the day, shown
 * next to what's there now, and nothing happens until it's accepted. Places it offers come from a
 * real Google Places search or a Maps list you gave it — the model picks the search, Google picks
 * the places, so nothing here is recalled from the model's own head.
 */
export default function DayChat({ tripId, day, llmReady, onApply }: {
  tripId: number;
  day: PlanDay;
  llmReady: boolean;
  onApply: (proposal: ChatProposal) => Promise<void>;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<ChatProposal | null>(null);
  const [searched, setSearched] = useState<string[]>([]);
  const [applying, setApplying] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  // Threads are per day, so switching days switches conversations rather than continuing one.
  useEffect(() => {
    let live = true;
    setMessages([]);
    setProposal(null);
    setSearched([]);
    setError(null);
    api.get<{ messages: ChatMessage[] }>(`/trips/${tripId}/plan/chat?day_id=${encodeURIComponent(day.id)}`)
      .then((r) => { if (live) setMessages(r.messages); })
      .catch(() => { /* an empty thread is the normal case */ });
    return () => { live = false; };
  }, [tripId, day.id]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages, busy, proposal]);

  async function send() {
    const msg = text.trim();
    if (!msg || busy) return;
    setBusy(true);
    setError(null);
    setProposal(null);
    setText("");
    try {
      const r = await api.post<ChatTurn>(`/trips/${tripId}/plan/chat`, { day_id: day.id, message: msg });
      setMessages(r.messages);
      setProposal(r.proposal);
      setSearched(r.searched || []);
    } catch (e: any) {
      setError(e.message);
      setText(msg);
    } finally {
      setBusy(false);
    }
  }

  async function accept() {
    if (!proposal) return;
    setApplying(true);
    setError(null);
    try {
      await onApply(proposal);
      setProposal(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setApplying(false);
    }
  }

  async function clearThread() {
    if (!window.confirm("Clear this day's conversation?")) return;
    await api.del(`/trips/${tripId}/plan/chat?day_id=${encodeURIComponent(day.id)}`);
    setMessages([]);
    setProposal(null);
  }

  return (
    <div className="day-chat">
      <div className="row spread">
        <h3 className="icon-line"><Sparkles size={14} className="ai-mark" /> Edit this day by chat</h3>
        {messages.length > 0 && (
          <button className="small btn-icon" onClick={clearThread}><Eraser size={12} /> Clear</button>
        )}
      </div>

      <div className="chat-log" ref={logRef}>
        {messages.length === 0 && !busy && (
          <div className="chat-empty">
            <p className="hint">Tell it what to change. It can:</p>
            <ul className="hint">
              <li>rework the day from a Google Maps list — paste the share link</li>
              <li>find something specific nearby ("somewhere near Shibuya that sells vintage denim")</li>
              <li>reorder, retime, shorten, or drop what's already here</li>
            </ul>
            <p className="hint">
              It can only schedule places already on your trip, or ones a real search turned up —
              it never names somewhere from memory.
            </p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`chat-msg ${m.role}`} dir="auto">{m.content}</div>
        ))}
        {busy && (
          <div className="chat-msg assistant pending icon-line">
            <Hourglass size={12} className="spin-slow" /> Working on {day.date}…
          </div>
        )}
      </div>

      {searched.length > 0 && (
        <p className="hint icon-line">
          <Search size={12} /> Searched: {searched.map((s) => `“${s}”`).join(", ")}
        </p>
      )}
      {error && <div className="alert small icon-line"><TriangleAlert size={12} /> {error}</div>}

      {proposal && (
        <div className="chat-proposal">
          <div className="row spread">
            <strong>Proposed day</strong>
            <span className="hint">{proposal.items.length} items · wake {proposal.wake_time}</span>
          </div>
          {proposal.new_places.length > 0 && (
            <div className="chat-new-places">
              <span className="hint">New to your trip, if you accept:</span>
              {proposal.new_places.map((p) => (
                <div className="chat-new-place" key={p.ref}>
                  <MapPin size={12} />
                  <span className="grow" dir="auto">
                    <strong>{p.name}</strong>
                    {p.address && <span className="hint"> · {p.address}</span>}
                  </span>
                  <span className="chat-via">{p.via}</span>
                </div>
              ))}
            </div>
          )}
          <ol className="chat-items">
            {proposal.items.map((it, i) => (
              <li key={i} dir="auto">
                <span className="time">{it.time}</span>
                <span className="grow">
                  {it.title}
                  {it.new_place_ref && <span className="chat-badge">new</span>}
                  {it.pinned && <span className="chat-badge fixed">fixed</span>}
                </span>
                <span className="hint nowrap">{it.duration_min ? `${it.duration_min}m` : ""}</span>
              </li>
            ))}
          </ol>
          <div className="row">
            <button className="primary btn-icon" onClick={accept} disabled={applying}>
              <Check size={14} /> {applying ? "Applying…" : "Use this day"}
            </button>
            <button className="btn-icon" onClick={() => setProposal(null)} disabled={applying}>
              <Undo2 size={14} /> Keep what I have
            </button>
          </div>
        </div>
      )}

      <div className="chat-input">
        <textarea
          dir="auto" rows={2} value={text} placeholder="Replan this day from https://maps.app.goo.gl/…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }}
        />
        <button className="primary icon-btn" onClick={send} aria-label="Send"
          disabled={busy || !llmReady || !text.trim()}
          title={llmReady ? "Send (Ctrl/Cmd + Enter)" : "Add an LLM key in Profile first"}>
          <Send size={15} />
        </button>
      </div>
    </div>
  );
}
