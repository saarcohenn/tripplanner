import { useState } from "react";
import { api } from "../api";
import type { AdvisorDoc, PlanDoc, TripDetail } from "../types";

const KIND_ICON: Record<string, string> = {
  visit: "📍", meal: "🍽️", transit: "🚆", rest: "😴", checkin: "🏨",
  checkout: "🧳", flight: "✈️", other: "•",
};

export default function PlanTab({ detail, refresh, llmReady, generatePlan, busy }: {
  detail: TripDetail;
  refresh: () => Promise<void>;
  llmReady: boolean;
  generatePlan: () => Promise<void>;
  busy: boolean;
}) {
  const { plan, places } = detail;
  const [advising, setAdvising] = useState(false);
  const placeById = new Map(places.map((p) => [p.id, p]));

  const planDoc: PlanDoc | null = plan ? safeParse(plan.plan_json) : null;
  const advisor: AdvisorDoc | null = plan?.advisor_json ? safeParse(plan.advisor_json) : null;

  async function reAdvise() {
    setAdvising(true);
    try {
      await api.post(`/trips/${detail.trip.id}/advise`);
      await refresh();
    } finally {
      setAdvising(false);
    }
  }

  async function dropPlace(placeId: number | null) {
    if (placeId == null) return;
    await api.put(`/places/${placeId}`, { status: "dropped" });
    await refresh();
  }

  if (!planDoc) {
    return (
      <div className="pad">
        <h2>Daily plan</h2>
        <p className="hint">
          No plan generated yet. The generator arranges <em>only the places you chose</em> into a daily
          schedule — it never adds new attractions.
        </p>
        <button className="primary" onClick={generatePlan} disabled={!llmReady || busy}>
          {llmReady ? "Generate plan" : "Add an LLM key in Settings first"}
        </button>
      </div>
    );
  }

  return (
    <div className="plan-layout">
      <div className="plan-days">
        <div className="row spread">
          <h2>Daily plan <span className="hint">generated {plan!.generated_at} UTC</span></h2>
          <button className="primary" onClick={generatePlan} disabled={!llmReady || busy}>Regenerate</button>
        </div>
        {planDoc.notes && <p className="hint" dir="auto">{planDoc.notes}</p>}
        {planDoc.days?.map((d) => (
          <div className="day-card" key={d.date}>
            <div className="day-head">
              <strong>{d.date}</strong> · <span dir="auto">{d.city}</span>
              <span className={`wake ${d.wake_time < "07:30" ? "early" : ""}`}>⏰ wake {d.wake_time}</span>
            </div>
            <div className="hint" dir="auto">{d.summary}</div>
            <ul className="items">
              {d.items?.map((it, i) => (
                <li key={i} className={`item kind-${it.kind}`}>
                  <span className="time">{it.time}</span>
                  <span className="icon">{KIND_ICON[it.kind] || "•"}</span>
                  <span dir="auto" className="grow">
                    {it.title}
                    {it.place_id != null && placeById.get(it.place_id)?.status === "dropped" && (
                      <em className="hint"> (dropped — regenerate)</em>
                    )}
                  </span>
                  <span className="hint">{it.duration_min ? `${it.duration_min}m` : ""}</span>
                </li>
              ))}
            </ul>
            {d.warnings?.map((w, i) => <div className="alert small" key={i}>⚠ {w}</div>)}
          </div>
        ))}
        {planDoc.unscheduled_place_ids && planDoc.unscheduled_place_ids.length > 0 && (
          <div className="alert">
            Didn't fit: {planDoc.unscheduled_place_ids.map((id) => placeById.get(id)?.name || `#${id}`).join(", ")}
          </div>
        )}
      </div>

      <aside className="advisor">
        <div className="row spread">
          <h2>🧠 Advisor</h2>
          <button className="small" onClick={reAdvise} disabled={!llmReady || advising}>{advising ? "…" : "Re-analyze"}</button>
        </div>
        <p className="hint">The advisor never suggests new places — it only tells you what to drop, when to rest, and when you'll have to get up early.</p>
        {!advisor && <p className="hint">No analysis yet.</p>}
        {advisor && (
          <>
            <p dir="auto">{advisor.overall}</p>
            {advisor.pacing_alerts?.length > 0 && (
              <>
                <h3>Pacing</h3>
                {advisor.pacing_alerts.map((a, i) => (
                  <div key={i} className={`alert type-${a.type}`}>
                    <strong>{a.date}</strong> {icon(a.type)} <span dir="auto">{a.message}</span>
                  </div>
                ))}
              </>
            )}
            {advisor.drop_suggestions?.length > 0 && (
              <>
                <h3>Consider dropping</h3>
                {advisor.drop_suggestions.map((s, i) => (
                  <div key={i} className="alert">
                    <strong dir="auto">{s.place_name}</strong> — <span dir="auto">{s.reason}</span>
                    {s.place_id != null && placeById.get(s.place_id)?.status === "active" && (
                      <button className="small" onClick={() => dropPlace(s.place_id)}>Drop it</button>
                    )}
                  </div>
                ))}
              </>
            )}
            {advisor.day_notes?.length > 0 && (
              <>
                <h3>Day notes</h3>
                {advisor.day_notes.map((n, i) => (
                  <p key={i} className="hint"><strong>{n.date}</strong> <span dir="auto">{n.note}</span></p>
                ))}
              </>
            )}
          </>
        )}
      </aside>
    </div>
  );
}

function icon(type: string) {
  return { overload: "🔥", early_wake: "🌅", rest_needed: "😴", transit_heavy: "🚆", budget: "💸" }[type] || "⚠";
}

function safeParse<T>(s: string): T | null {
  try { return JSON.parse(s) as T; } catch { return null; }
}
