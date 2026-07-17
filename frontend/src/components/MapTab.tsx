import { useMemo, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup, useMapEvents } from "react-leaflet";
import type { LatLngExpression } from "leaflet";
import { APIProvider, Map as GMap, Marker, InfoWindow } from "@vis.gl/react-google-maps";
import { api, gmapsLink, parseGmapsUrl } from "../api";
import type { Place, TripDetail } from "../types";

type Pending = { lat: number; lng: number; name: string; google_place_id?: string; photo_ref?: string };
type SearchResult = { name: string; address: string; lat: number | null; lng: number | null; google_place_id?: string; photo_ref?: string };

const CATEGORY_COLORS: Record<string, string> = {
  sight: "#e4b34a", food: "#e4664a", nature: "#5cb85c", museum: "#9b6fd6",
  shopping: "#4a90e2", nightlife: "#d64f9b", other: "#8a8f98",
};

const CIRCLE_PATH = "M 0,-8 a 8,8 0 1,0 0.001,0 z";

function ClickCapture({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onClick(e.latlng.lat, e.latlng.lng) });
  return null;
}

export default function MapTab({ detail, refresh, gmapsKey }: {
  detail: TripDetail;
  refresh: () => Promise<void>;
  gmapsKey: string | null;
}) {
  const { trip, legs, places } = detail;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [pendingLeg, setPendingLeg] = useState<number | "">("");
  const [searching, setSearching] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const center = useMemo(() => {
    const withCoords = places.filter((p) => p.lat != null && p.lng != null);
    if (withCoords.length)
      return {
        lat: withCoords.reduce((s, p) => s + (p.lat as number), 0) / withCoords.length,
        lng: withCoords.reduce((s, p) => s + (p.lng as number), 0) / withCoords.length,
      };
    const leg = legs.find((l) => l.lat != null);
    return leg ? { lat: leg.lat as number, lng: leg.lng as number } : { lat: 35, lng: 130 };
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
      if (gmapsKey) {
        const r = await api.get<any[]>(`/gplaces/search?q=${encodeURIComponent(q)}`);
        setResults(r.map((p) => ({
          name: p.name, address: p.address, lat: p.lat, lng: p.lng,
          google_place_id: p.place_id, photo_ref: p.photo_ref,
        })));
      } else {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(q)}`,
          { headers: { accept: "application/json" } }
        );
        const rows: { display_name: string; lat: string; lon: string }[] = await res.json();
        setResults(rows.map((r) => ({
          name: r.display_name.split(",")[0], address: r.display_name,
          lat: parseFloat(r.lat), lng: parseFloat(r.lon),
        })));
      }
    } finally {
      setSearching(false);
    }
  }

  async function addPending() {
    if (!pending) return;
    if (trip.stage === "planned" &&
        !window.confirm("This trip already has a generated plan (green). Adding a place will mark the plan outdated and it may change when regenerated. Add anyway?")) {
      return;
    }
    await api.post(`/trips/${trip.id}/places`, {
      name: pending.name || "Unnamed place",
      lat: pending.lat,
      lng: pending.lng,
      google_place_id: pending.google_place_id || "",
      photo_ref: pending.photo_ref || "",
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

  const placesWithCoords = places.filter((p) => p.lat != null && p.lng != null);
  const selected = placesWithCoords.find((p) => p.id === selectedId) || null;

  return (
    <div className="map-layout">
      <div className="map-side">
        <div className="search-row">
          <input
            dir="auto"
            placeholder={gmapsKey ? "Search Google Maps (English)…" : "Search place, or paste a Google Maps link…"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
          />
          <button className="primary" onClick={search} disabled={searching}>{searching ? "…" : "Search"}</button>
        </div>
        {results.map((r, i) => (
          <button key={i} className="result" dir="auto"
            onClick={() => {
              if (r.lat == null || r.lng == null) return;
              setPending({ lat: r.lat, lng: r.lng, name: r.name, google_place_id: r.google_place_id, photo_ref: r.photo_ref });
              setResults([]);
            }}>
            📍 <strong>{r.name}</strong>
            <span className="hint"> {r.address}</span>
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
        {!gmapsKey && (
          <p className="hint">💡 Add a Google Maps API key in Settings to switch to Google Maps with English labels, English search results and place photos.</p>
        )}
        <p className="hint">Click anywhere on the map to pin a new place. Changes mark the daily plan as outdated.</p>
        <ul className="legend">
          {Object.entries(CATEGORY_COLORS).map(([k, c]) => (
            <li key={k}><span className="dot" style={{ background: c }} /> {k}</li>
          ))}
        </ul>
      </div>

      {gmapsKey ? (
        <APIProvider apiKey={gmapsKey} language="en">
          <GMap
            style={{ flex: 1 }}
            defaultCenter={center}
            defaultZoom={6}
            gestureHandling="greedy"
            onClick={(e) => {
              const ll = e.detail.latLng;
              if (ll) setPending({ lat: ll.lat, lng: ll.lng, name: "" });
            }}
          >
            {placesWithCoords.map((p) => (
              <Marker
                key={p.id}
                position={{ lat: p.lat as number, lng: p.lng as number }}
                onClick={() => setSelectedId(p.id)}
                icon={{
                  path: CIRCLE_PATH,
                  fillColor: p.status === "dropped" ? "#555" : CATEGORY_COLORS[p.category] || CATEGORY_COLORS.other,
                  fillOpacity: p.status === "dropped" ? 0.3 : 0.9,
                  strokeColor: "#ffffff",
                  strokeWeight: 1.5,
                  scale: p.priority === "must" ? 1.2 : 0.9,
                }}
              />
            ))}
            {pending && (
              <Marker position={{ lat: pending.lat, lng: pending.lng }} />
            )}
            {selected && (
              <InfoWindow
                position={{ lat: selected.lat as number, lng: selected.lng as number }}
                onCloseClick={() => setSelectedId(null)}
              >
                <PlaceCard p={selected} />
              </InfoWindow>
            )}
          </GMap>
        </APIProvider>
      ) : (
        <MapContainer center={[center.lat, center.lng] as LatLngExpression} zoom={6} className="map">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <ClickCapture onClick={(lat, lng) => setPending({ lat, lng, name: "" })} />
          {placesWithCoords.map((p) => (
            <CircleMarker
              key={p.id}
              center={[p.lat as number, p.lng as number]}
              radius={p.priority === "must" ? 10 : 7}
              pathOptions={{
                color: p.status === "dropped" ? "#555" : CATEGORY_COLORS[p.category] || CATEGORY_COLORS.other,
                fillOpacity: p.status === "dropped" ? 0.2 : 0.7,
              }}
            >
              <Popup><PlaceCard p={p} /></Popup>
            </CircleMarker>
          ))}
          {pending && (
            <CircleMarker center={[pending.lat, pending.lng]} radius={12} pathOptions={{ color: "#fff", dashArray: "4" }} />
          )}
        </MapContainer>
      )}
    </div>
  );
}

function PlaceCard({ p }: { p: Place }) {
  return (
    <div className="place-card">
      {p.photo_ref && <img className="place-photo" src={`/api/places/${p.id}/photo`} alt={p.name} />}
      <div dir="auto"><strong>{p.name}</strong></div>
      <div>{p.category} · ~{p.duration_min}min · {p.priority}{p.status === "dropped" ? " · DROPPED" : ""}</div>
      <a href={gmapsLink(p)} target="_blank" rel="noreferrer">Open in Google Maps ↗</a>
    </div>
  );
}
