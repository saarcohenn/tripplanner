import { useEffect, useState } from "react";
import {
  Clock, ExternalLink, Hourglass, Lightbulb, RefreshCw, ScrollText, Sparkles, TriangleAlert, X,
} from "lucide-react";
import { api, gmapsLink } from "../api";
import type { Place, PlaceInsight } from "../types";

type Loaded = { insight: PlaceInsight | null; generated_at: string | null };

/**
 * What we know about one stop on the day. Insights are cached server-side per place, so opening
 * the same stop again costs nothing — only the explicit button spends an LLM call.
 */
export default function PlaceInsightPanel({ place, city, llmReady, onClose }: {
  place: Place;
  city: string;
  llmReady: boolean;
  onClose?: () => void;
}) {
  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-fetch per place, and clear first so the previous place's text never sits under a new title.
  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    api.get<Loaded>(`/places/${place.id}/insight`)
      .then((r) => { if (live) setData(r); })
      .catch(() => { if (live) setData({ insight: null, generated_at: null }); });
    return () => { live = false; };
  }, [place.id]);

  async function generate(refresh: boolean) {
    setLoading(true);
    setError(null);
    try {
      setData(await api.post<Loaded>(`/places/${place.id}/insight`, { refresh }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const insight = data?.insight ?? null;

  return (
    <div className="insight-panel">
      <div className="insight-head">
        <div className="grow">
          <h3 dir="auto">{place.name}</h3>
          <p className="hint" dir="auto">
            {city ? `${city} · ` : ""}{place.category} · ~{place.duration_min} min · {place.priority}
          </p>
        </div>
        {onClose && <button className="icon-btn" aria-label="Close" onClick={onClose}><X size={16} /></button>}
      </div>

      {place.notes && <p className="insight-note" dir="auto">{place.notes}</p>}

      {!insight && !loading && (
        <div className="insight-empty">
          <p className="hint">
            No background for this place yet. Fetching it costs one small LLM call, and it's cached
            afterwards — the plan itself is never changed by this.
          </p>
          <button className="primary btn-icon" onClick={() => generate(false)} disabled={!llmReady}
            title={llmReady ? "" : "Add an LLM key in Profile first"}>
            <Sparkles size={14} className="ai-mark" /> Tell me about this place
          </button>
        </div>
      )}

      {loading && (
        <p className="hint icon-line"><Hourglass size={13} className="spin-slow" /> Reading up on {place.name}…</p>
      )}

      {error && <div className="alert icon-line"><TriangleAlert size={13} /> {error}</div>}

      {insight && !loading && (
        <div className="insight-body">
          {insight.confidence === "low" && (
            <div className="alert small icon-line">
              <TriangleAlert size={12} /> The model flagged this as low confidence — worth checking before you rely on it.
            </div>
          )}
          {insight.headline && <p className="insight-headline" dir="auto">{insight.headline}</p>}
          {insight.history && (
            <section>
              <h4 className="icon-line"><ScrollText size={12} /> Background</h4>
              <p dir="auto">{insight.history}</p>
            </section>
          )}
          {insight.fun_fact && (
            <section className="insight-fact">
              <h4 className="icon-line"><Sparkles size={12} className="ai-mark" /> Fun fact</h4>
              <p dir="auto">{insight.fun_fact}</p>
            </section>
          )}
          {insight.best_time && (
            <section>
              <h4 className="icon-line"><Clock size={12} /> When to go</h4>
              <p dir="auto">{insight.best_time}</p>
            </section>
          )}
          {insight.tips?.length > 0 && (
            <section>
              <h4 className="icon-line"><Lightbulb size={12} /> Before you go</h4>
              <ul className="insight-tips">
                {insight.tips.map((t, i) => <li key={i} dir="auto">{t}</li>)}
              </ul>
            </section>
          )}
          {insight.duration_note && (
            <p className="hint" dir="auto"><strong>Time set aside:</strong> {insight.duration_note}</p>
          )}
          <div className="insight-foot">
            <a className="icon-line" href={gmapsLink(place)} target="_blank" rel="noreferrer">
              Open in Google Maps <ExternalLink size={11} />
            </a>
            <button className="small btn-icon" onClick={() => generate(true)} disabled={!llmReady}>
              <RefreshCw size={12} /> Regenerate
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
