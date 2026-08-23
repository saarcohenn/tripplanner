import { useEffect, useState } from "react";
import {
  BedDouble, Clock, Flame, Hourglass, RefreshCw, Sparkles, Sunrise, TrainFront, TriangleAlert,
  Wallet, Wind,
} from "lucide-react";
import { api } from "../api";
import type { DayAdvice, DayAdviceResult, PlanDay } from "../types";

const POINT_ICON: Record<string, typeof Flame> = {
  overload: Flame, early_wake: Sunrise, rest_needed: BedDouble, transit_heavy: TrainFront,
  gap: Wind, timing: Clock, budget: Wallet,
};

const LOAD_LABEL: Record<string, string> = {
  light: "Light day", comfortable: "Comfortable", full: "Full day", "too much": "Too much",
};

/**
 * The advisor for the day you are looking at.
 *
 * The trip-wide review is the right thing to read once and the wrong thing to have open while you
 * move items around — twenty-one days of notes to find the one about Tuesday. This asks about
 * Tuesday, is capped at three points server-side, and knows when the day has changed underneath it.
 */
export default function DayAdvisor({ tripId, day, llmReady }: {
  tripId: number;
  day: PlanDay;
  llmReady: boolean;
}) {
  const [advice, setAdvice] = useState<DayAdvice | null>(null);
  const [stale, setStale] = useState(false);
  const [at, setAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-fetch per day, cleared first so one day's read never sits under another day's heading.
  useEffect(() => {
    let live = true;
    setAdvice(null);
    setStale(false);
    setAt(null);
    setError(null);
    api.get<DayAdviceResult>(`/trips/${tripId}/plan/day-advice?day_id=${encodeURIComponent(day.id)}`)
      .then((r) => { if (live) { setAdvice(r.advice); setStale(r.stale); setAt(r.generated_at); } })
      .catch(() => { /* no advice yet is the normal case */ });
    return () => { live = false; };
  }, [tripId, day.id]);

  async function run(refresh: boolean) {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<DayAdviceResult>(`/trips/${tripId}/plan/day-advice`, { day_id: day.id, refresh });
      setAdvice(r.advice);
      setStale(r.stale);
      setAt(r.generated_at);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="day-advice">
      <div className="row spread">
        <h3 className="icon-line"><Sparkles size={14} className="ai-mark" /> This day</h3>
        {advice && (
          <button className="small btn-icon" onClick={() => run(true)} disabled={!llmReady || busy}>
            <RefreshCw size={12} /> {busy ? "…" : "Re-read"}
          </button>
        )}
      </div>

      {busy && !advice && (
        <p className="hint icon-line"><Hourglass size={13} className="spin-slow" /> Reading {day.date}…</p>
      )}
      {error && <div className="alert small icon-line"><TriangleAlert size={12} /> {error}</div>}

      {!advice && !busy && (
        <>
          <p className="hint">
            Nothing read for this day yet. It looks at this day alone — how full it is, what the order
            costs you in travel, whether the morning works — and says at most three things.
          </p>
          <button className="primary btn-icon" onClick={() => run(false)} disabled={!llmReady || busy}
            title={llmReady ? "" : "Add an LLM key in Profile first"}>
            <Sparkles size={14} className="ai-mark" /> Read this day
          </button>
        </>
      )}

      {advice && (
        <>
          {stale && (
            <div className="alert small icon-line">
              <TriangleAlert size={12} />
              <span className="grow">This day has changed since — the read below is of the old version.</span>
            </div>
          )}
          <div className={`day-load load-${(advice.load || "").replace(/\s+/g, "-")}`}>
            {LOAD_LABEL[advice.load] || "Read"}
          </div>
          {advice.verdict && <p dir="auto">{advice.verdict}</p>}
          {advice.points.length === 0 ? (
            <p className="hint">Nothing else to flag on this one.</p>
          ) : (
            advice.points.map((pt, i) => {
              const Icon = POINT_ICON[pt.type] || TriangleAlert;
              return (
                <div className={`alert small type-${pt.type}`} key={i}>
                  <Icon size={12} /> <span dir="auto">{pt.message}</span>
                </div>
              );
            })
          )}
          {at && <p className="hint">Read {at} UTC.</p>}
        </>
      )}
    </section>
  );
}
