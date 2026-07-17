import { useMemo, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup, useMapEvents } from "react-leaflet";
import type { LatLngExpression } from "leaflet";
import { api, gmapsLink, parseGmapsUrl } from "../api";
import type { TripDetail } from "../types";

type Pending = { lat: number; lng: number; name: string };

const CATEGORY_COLORS: Record<string, string> = {
  sight: "#e4b34a", food: "#e4664a", nature: "#5cb85c", museum: "#9b6fd6",
  shopping: "#4a90e2", nightlife: "#d64f9b", other: "#8a8f98",
};

function ClickCapture({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onClick(e.latlng.lat, e.latlng.lng) });
  return null;
}

export default function MapTab({ detail, refresh }: { detail: TripDetail; refresh: () => Promise<void> }) {
  const { trip, legs, places } = detail;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ display_name: string; lat: string; lon: string }[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [pendingLeg, setPendingLeg] = useState<number | "">("");
  const [searching, setSearching] = useState(false);

  const center: LatLngExpression = useMemo(() => {
    const withCoords = places.filter((p) => p.lat != null && p.lng != null);
    if (withCoords.length)
      return [
        withCoords.reduce((s, p) => s + (p.lat as number), 0) / withCoords.length,
        withCoords.reduce((s, p) => s + (p.lng as number), 0) / withCoords.length,
      ];
    const leg = legs.find((l) => l.lat != null);
    return leg ? [leg.lat as number, leg.lng as number] : [35, 130];
  }, [places, legs]);

  async function search() {
    const q = query.trim();
    if (!q) return;
    // A pasted Google Maps link is handled locally, no geocoder needed.
    const coords = parseGmapsUrl(q);
    if (coords) {
      setPending({ ...coords, name: "Pinned from Google Maps link" });
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(q)}`,
        { headers: { accept: "application/json" } }
      );
      setResults(await res.json());
    } finally {
      setSearching(false);
    }
  }

  async function addPending() {
    if (!pending) return;
    await api.post(`/trips/${trip.id}/places`, {
      name: pending.name || "Unnamed place",
      lat: pending.lat,
      lng: pending.lng,
      leg_id: pendingLeg === "" ? guessLeg(pending.lat, pending.lng) : pendingLeg,
    });
    setPending(null);
    setResults([]);
    setQuery("");
    await refresh();
  }

  /** Assign the nearest leg city when the user didn't pick one. */
  function guessLeg(lat: number, lng: number): number | null {
    let best: { id: number; d: number } | null = null;
    for (const l of legs) {
      if (l.lat == null || l.lng == null) continue;
      const d = (l.lat - lat) ** 2 + (l.lng - lng) ** 2;
      if (!best || d < best.d) best = { id: l.id, d };
    }
    return best?.id ?? null;
  }

  return (
    <div className="map-layout">
      <div className="map-side">
        <div className="search-row">
          <input
            dir="auto"
            placeholder="Search place, or paste a Google Maps link…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
          />
          <button className="primary" onClick={search} disabled={searching}>{searching ? "…" : "Search"}</button>
        </div>
        {results.map((r, i) => (
          <button key={i} className="result" dir="auto"
            onClick={() => { setPending({ lat: parseFloat(r.lat), lng: parseFloat(r.lon), name: r.display_name.split(",")[0] }); setResults([]); }}>
            📍 {r.display_name}
          </button>
        ))}
        {pending && (
          <div className="pending-card">
            <strong>Add place to trip</strong>
            <input dir="auto" value={pending.name} onChange={(e) => setPending({ ...pending, name: e.target.value })} />
            <select value={pendingLeg} onChange={(e) => setPendingLeg(e.target.value === "" ? "" : Number(e.target.value))}>
              <option value="">City: auto (nearest leg)</option>
              {legs.map((l) => <option key={l.id} value={l.id}>{l.city}</option>)}
            </select>
            <div className="row">
              <button className="primary" onClick={addPending}>Add place</button>
              <button onClick={() => setPending(null)}>Cancel</button>
            </div>
          </div>
        )}
        <p className="hint">Click anywhere on the map to pin a new place. Adding, editing or dropping a place marks the daily plan as outdated — it regenerates automatically (or via the banner button).</p>
        <ul className="legend">
          {Object.entries(CATEGORY_COLORS).map(([k, c]) => (
            <li key={k}><span className="dot" style={{ background: c }} /> {k}</li>
          ))}
        </ul>
      </div>

      <MapContainer center={center} zoom={6} className="map">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ClickCapture onClick={(lat, lng) => setPending({ lat, lng, name: "" })} />
        {places.filter((p) => p.lat != null && p.lng != null).map((p) => (
          <CircleMarker
            key={p.id}
            center={[p.lat as number, p.lng as number]}
            radius={p.priority === "must" ? 10 : 7}
            pathOptions={{
              color: p.status === "dropped" ? "#555" : CATEGORY_COLORS[p.category] || CATEGORY_COLORS.other,
              fillOpacity: p.status === "dropped" ? 0.2 : 0.7,
            }}
          >
            <Popup>
              <div dir="auto"><strong>{p.name}</strong></div>
              <div>{p.category} · ~{p.duration_min}min · {p.priority}{p.status === "dropped" ? " · DROPPED" : ""}</div>
              <a href={gmapsLink(p)} target="_blank" rel="noreferrer">Open in Google Maps ↗</a>
            </Popup>
          </CircleMarker>
        ))}
        {pending && (
          <CircleMarker center={[pending.lat, pending.lng]} radius={12} pathOptions={{ color: "#fff", dashArray: "4" }} />
        )}
      </MapContainer>
    </div>
  );
}
