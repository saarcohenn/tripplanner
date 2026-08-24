import { useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer, TileLayer, CircleMarker, Polyline as LPolyline, Popup, Tooltip,
  useMapEvents, useMap as useLeafletMap,
} from "react-leaflet";
import type { LatLngExpression } from "leaflet";
import {
  APIProvider, Map as GMap, Marker, InfoWindow, Polyline, MapControl,
  ControlPosition, ColorScheme, useMap,
} from "@vis.gl/react-google-maps";
import {
  ExternalLink, FerrisWheel, LocateFixed, MapPin, Plane, Settings, ShoppingBag,
  TrainFront, TriangleAlert, UtensilsCrossed,
} from "lucide-react";
import { api, gmapsLink, parseGmapsUrl } from "../api";
import type { Leg, Place, TripDetail } from "../types";
import ConfirmPlanDialog, { PlanGateChoice } from "./ConfirmPlanDialog";

type Pending = { lat: number; lng: number; name: string; google_place_id?: string; photo_ref?: string };
type SearchResult = { name: string; address: string; lat: number | null; lng: number | null; google_place_id?: string; photo_ref?: string };

export const CATEGORY_COLORS: Record<string, string> = {
  sight: "#e88005", attractions: "#7b4fc9", landmarks: "#b4652e", food: "#e8412f",
  nature: "#a2b025", shopping: "#0f8a8a", nightlife: "#c93b6e", other: "#a5917c",
};

const CIRCLE_PATH = "M 0,-8 a 8,8 0 1,0 0.001,0 z";
const ROUTE_COLOR = "#6b5b95";

type MapTypeId = "roadmap" | "satellite" | "terrain";
const MAP_TYPES: { id: MapTypeId; label: string }[] = [
  { id: "roadmap", label: "Map" },
  { id: "satellite", label: "Satellite" },
  { id: "terrain", label: "Terrain" },
];

/**
 * Trip-relevant points of interest, toggled on top of the base map. These are Google's own
 * POI layers switched on and off through map styles — no Places lookups, so no extra
 * billing and no markers of our own competing with the trip's places.
 */
type PoiKey = "attractions" | "shopping" | "food" | "rail" | "airport";
const POI_LAYERS: {
  key: PoiKey; label: string; Icon: typeof FerrisWheel; features: string[];
}[] = [
  { key: "attractions", label: "Attractions", Icon: FerrisWheel, features: ["poi.attraction", "poi.park", "poi.place_of_worship"] },
  { key: "shopping", label: "Shopping", Icon: ShoppingBag, features: ["poi.business"] },
  { key: "food", label: "Food", Icon: UtensilsCrossed, features: ["poi.business"] },
  { key: "rail", label: "Trains", Icon: TrainFront, features: ["transit.station.rail", "transit.line"] },
  { key: "airport", label: "Airports", Icon: Plane, features: ["transit.station.airport"] },
];

function markerScale(p: Place, selected: boolean): number {
  if (selected) return 1.7;
  return p.priority === "must" ? 1.2 : 0.9;
}

function ClickCapture({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onClick(e.latlng.lat, e.latlng.lng) });
  return null;
}

/** Legs that actually have coordinates, in travel order — the basis of the route line. */
function routeLegs(legs: Leg[]): Leg[] {
  return legs
    .filter((l) => l.lat != null && l.lng != null)
    .slice()
    .sort((a, b) => a.seq - b.seq);
}

/** Google: frame the whole trip on load and whenever the trip changes. */
function FitToTrip({ points, tripId }: { points: { lat: number; lng: number }[]; tripId: number }) {
  const map = useMap();
  useEffect(() => {
    if (!map || points.length === 0) return;
    if (points.length === 1) {
      map.setCenter(points[0]);
      map.setZoom(11);
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    for (const p of points) bounds.extend(p);
    map.fitBounds(bounds, 64);
    // Depends on tripId, not `points`: refitting on every place edit would yank the
    // viewport out from under someone who has panned somewhere deliberately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, tripId]);
  return null;
}

/**
 * Google: recentre on the selected place — but only when a jump is explicitly asked for
 * (double-click, or the button in the info window). Selecting a place just opens its card;
 * moving the map on every selection kept yanking the view away mid-browse.
 */
function JumpToSelected({ place, nonce }: { place: Place | null; nonce: number }) {
  const map = useMap();
  useEffect(() => {
    if (!map || nonce === 0 || !place || place.lat == null || place.lng == null) return;
    map.panTo({ lat: place.lat, lng: place.lng });
    map.setZoom(15);
    // Keyed on the nonce alone: adding `place` would re-fire this on plain selection changes,
    // which is exactly the jumping behaviour being removed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, nonce]);
  return null;
}

/** Google: ease to the browser-reported position once it arrives. */
function PanToLocation({ at }: { at: { lat: number; lng: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (!map || !at) return;
    map.panTo(at);
    map.setZoom(14);
  }, [map, at]);
  return null;
}

/** Leaflet equivalents of the helpers above. */
function LeafletFit({ points, tripId }: { points: { lat: number; lng: number }[]; tripId: number }) {
  const map = useLeafletMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) { map.setView([points[0].lat, points[0].lng], 11); return; }
    map.fitBounds(points.map((p) => [p.lat, p.lng] as [number, number]), { padding: [40, 40] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, tripId]);
  return null;
}

function LeafletJump({ place, nonce }: { place: Place | null; nonce: number }) {
  const map = useLeafletMap();
  useEffect(() => {
    if (nonce === 0 || !place || place.lat == null || place.lng == null) return;
    map.setView([place.lat, place.lng], 15);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, nonce]);
  return null;
}

function LeafletPanToLocation({ at }: { at: { lat: number; lng: number } | null }) {
  const map = useLeafletMap();
  useEffect(() => {
    if (!at) return;
    map.setView([at.lat, at.lng], 14);
  }, [map, at]);
  return null;
}

export default function TripMap({
  detail, refresh, gmapsKey, llmReady, generatePlan, theme, selectedId, onSelect,
  jumpNonce, onJump,
}: {
  detail: TripDetail;
  refresh: () => Promise<void>;
  gmapsKey: string | null;
  llmReady: boolean;
  generatePlan: () => Promise<void>;
  theme: "light" | "dark";
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  /** Bumped by the parent (card double-click) to request an explicit recentre. */
  jumpNonce: number;
  onJump: () => void;
}) {
  const { trip, legs, places } = detail;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [pendingLeg, setPendingLeg] = useState<number | "">("");
  const [searching, setSearching] = useState(false);
  const [gateOpen, setGateOpen] = useState(false);
  const [googleFailed, setGoogleFailed] = useState(false);
  const [showRoute, setShowRoute] = useState(true);
  const [mapTypeId, setMapTypeId] = useState<MapTypeId>("roadmap");
  const [poi, setPoi] = useState<Record<PoiKey, boolean>>({
    attractions: false, shopping: false, food: false, rail: false, airport: false,
  });
  const [myLocation, setMyLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) setSettingsOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  function locate() {
    if (!navigator.geolocation) {
      setLocateError("This browser can't share a location.");
      return;
    }
    setLocating(true);
    setLocateError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setMyLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
      },
      (err) => {
        setLocating(false);
        setLocateError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission denied."
            : "Couldn't get your location."
        );
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  // Google draws its own POI icons by default, which clutter a map whose point is the
  // trip's own pins. Hide the lot, then switch back on only the categories asked for.
  const mapStyles = useMemo(() => {
    const styles: google.maps.MapTypeStyle[] = [
      { featureType: "poi", stylers: [{ visibility: "off" }] },
      { featureType: "transit", stylers: [{ visibility: "off" }] },
    ];
    for (const layer of POI_LAYERS) {
      if (!poi[layer.key]) continue;
      for (const f of layer.features) styles.push({ featureType: f, stylers: [{ visibility: "on" }] });
    }
    return styles;
  }, [poi]);

  // Google Maps reports auth problems (key invalid, API not enabled, billing off,
  // referrer blocked) via this global callback — fall back to OpenStreetMap.
  useEffect(() => {
    (window as any).gm_authFailure = () => setGoogleFailed(true);
    return () => { delete (window as any).gm_authFailure; };
  }, []);

  const useGoogle = !!gmapsKey && !googleFailed;
  const placesWithCoords = useMemo(() => places.filter((p) => p.lat != null && p.lng != null), [places]);
  const selected = placesWithCoords.find((p) => p.id === selectedId) || null;
  const route = useMemo(() => routeLegs(legs), [legs]);
  const routePath = useMemo(
    () => route.map((l) => ({ lat: l.lat as number, lng: l.lng as number })),
    [route]
  );

  // Everything worth framing: every pinned place plus every located leg city.
  const fitPoints = useMemo(() => [
    ...placesWithCoords.map((p) => ({ lat: p.lat as number, lng: p.lng as number })),
    ...routePath,
  ], [placesWithCoords, routePath]);

  const center = fitPoints.length
    ? { lat: fitPoints[0].lat, lng: fitPoints[0].lng }
    : { lat: 35, lng: 130 };

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
    if (trip.stage === "planned") { setGateOpen(true); return; }
    await doAdd();
  }

  async function onGateChoice(c: PlanGateChoice) {
    setGateOpen(false);
    if (c === "cancel") return;
    await doAdd();
    if (c === "add_regen") await generatePlan();
  }

  async function doAdd() {
    if (!pending) return;
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

  const legName = new Map(legs.map((l) => [l.id, l.city]));

  return (
    <div className="trip-map">
      <ConfirmPlanDialog open={gateOpen} llmReady={llmReady} onChoose={onGateChoice} />

      <div className="map-controls">
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

        {/* Trip-relevant map layers. Google-only: these drive its POI styling, which the
            OpenStreetMap fallback has no equivalent for. */}
        {useGoogle && (
          <div className="poi-chips">
            {POI_LAYERS.map((l) => (
              <button
                key={l.key}
                className={`chip-toggle${poi[l.key] ? " active" : ""}`}
                aria-pressed={poi[l.key]}
                title={`Show ${l.label.toLowerCase()} on the map`}
                onClick={() => setPoi((p) => ({ ...p, [l.key]: !p[l.key] }))}
              >
                <l.Icon size={13} /> {l.label}
              </button>
            ))}
          </div>
        )}
        {locateError && <p className="hint" style={{ color: "var(--danger)" }}>{locateError}</p>}
        {results.map((r, i) => (
          <button key={i} className="result" dir="auto"
            onClick={() => {
              if (r.lat == null || r.lng == null) return;
              setPending({ lat: r.lat, lng: r.lng, name: r.name, google_place_id: r.google_place_id, photo_ref: r.photo_ref });
              setResults([]);
            }}>
            <MapPin size={13} /> <strong>{r.name}</strong>
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
        {gmapsKey && googleFailed && (
          <div className="alert icon-line">
            <TriangleAlert size={14} /> Google rejected the Maps key, showing the OpenStreetMap fallback instead. Open the browser
            console (F12) for the exact reason — usually "Maps JavaScript API" isn't enabled on the key's
            Google Cloud project, or billing/referrer restrictions block it.
          </div>
        )}
      </div>

      <div className="map-frame">
        {useGoogle ? (
          <APIProvider apiKey={gmapsKey!} language="en">
            <GMap
              style={{ flex: 1 }}
              defaultCenter={center}
              defaultZoom={6}
              gestureHandling="greedy"
              // Native light/dark map tiles, so the map stops being a bright slab at night.
              colorScheme={theme === "dark" ? ColorScheme.DARK : ColorScheme.LIGHT}
              mapTypeId={mapTypeId}
              styles={mapStyles}
              // Google's own Map/Satellite pill sits half-rounded against the frame and can't
              // be restyled — replaced by the settings panel in the bottom-right corner below.
              mapTypeControl={false}
              // Pin the rest to fixed corners explicitly — otherwise Google Maps mirrors this
              // layout for RTL browser locales (e.g. Hebrew), scattering the buttons.
              zoomControlOptions={{ position: ControlPosition.RIGHT_BOTTOM }}
              fullscreenControlOptions={{ position: ControlPosition.TOP_RIGHT }}
              streetViewControlOptions={{ position: ControlPosition.RIGHT_BOTTOM }}
              onClick={(e) => {
                const ll = e.detail.latLng;
                if (ll) setPending({ lat: ll.lat, lng: ll.lng, name: "" });
                onSelect(null);
                setSettingsOpen(false);
              }}
            >
              <FitToTrip points={fitPoints} tripId={trip.id} />
              <JumpToSelected place={selected} nonce={jumpNonce} />
              <PanToLocation at={myLocation} />

              <MapControl position={ControlPosition.RIGHT_BOTTOM}>
                <div className="map-tools" ref={settingsRef}>
                  {settingsOpen && (
                    <div className="map-settings-panel">
                      <div className="map-settings-head">Map type</div>
                      {MAP_TYPES.map((t) => (
                        <button
                          key={t.id}
                          className={`map-settings-item${mapTypeId === t.id ? " active" : ""}`}
                          onClick={() => setMapTypeId(t.id)}
                        >{t.label}</button>
                      ))}
                    </div>
                  )}
                  <button
                    className="map-tool-btn" title="Show my location" aria-label="Show my location"
                    onClick={locate} disabled={locating}
                  ><LocateFixed size={16} className={locating ? "pulse" : ""} /></button>
                  <button
                    className={`map-tool-btn${settingsOpen ? " active" : ""}`}
                    title="Map settings" aria-label="Map settings" aria-expanded={settingsOpen}
                    onClick={() => setSettingsOpen((v) => !v)}
                  ><Settings size={16} /></button>
                </div>
              </MapControl>

              {myLocation && (
                <Marker
                  position={myLocation}
                  title="Your location"
                  zIndex={20}
                  icon={{
                    path: CIRCLE_PATH,
                    fillColor: "#1a73e8",
                    fillOpacity: 1,
                    strokeColor: "#ffffff",
                    strokeWeight: 3,
                    scale: 1.1,
                  }}
                />
              )}

              {showRoute && routePath.length > 1 && (
                <Polyline
                  path={routePath}
                  strokeColor={ROUTE_COLOR}
                  strokeOpacity={0}
                  icons={[{
                    icon: { path: "M 0,-1 0,1", strokeOpacity: 0.9, strokeWeight: 3, scale: 3 },
                    offset: "0",
                    repeat: "14px",
                  }]}
                />
              )}

              {/* City stops, numbered in travel order. */}
              {showRoute && route.map((l, i) => (
                <Marker
                  key={`leg-${l.id}`}
                  position={{ lat: l.lat as number, lng: l.lng as number }}
                  title={`${i + 1}. ${l.city}`}
                  label={{ text: String(i + 1), color: "#ffffff", fontSize: "11px", fontWeight: "700" }}
                  zIndex={1}
                  // No labelOrigin here: it would need `new google.maps.Point(...)`, and this
                  // icon object is built during render — before the Maps script has defined
                  // the `google` global. The default origin centres the digit anyway.
                  icon={{
                    path: CIRCLE_PATH,
                    fillColor: ROUTE_COLOR,
                    fillOpacity: 1,
                    strokeColor: "#ffffff",
                    strokeWeight: 2,
                    scale: 1.5,
                  }}
                />
              ))}

              {placesWithCoords.map((p) => (
                <Marker
                  key={p.id}
                  position={{ lat: p.lat as number, lng: p.lng as number }}
                  title={p.name}
                  zIndex={p.id === selectedId ? 10 : 2}
                  onClick={() => onSelect(p.id)}
                  icon={{
                    path: CIRCLE_PATH,
                    fillColor: p.status === "dropped" ? "#7c7c7c" : CATEGORY_COLORS[p.category] || CATEGORY_COLORS.other,
                    fillOpacity: p.status === "dropped" ? 0.35 : 0.95,
                    strokeColor: "#ffffff",
                    strokeWeight: p.id === selectedId ? 3 : 1.5,
                    scale: markerScale(p, p.id === selectedId),
                  }}
                />
              ))}

              {pending && <Marker position={{ lat: pending.lat, lng: pending.lng }} />}

              {selected && (
                <InfoWindow
                  position={{ lat: selected.lat as number, lng: selected.lng as number }}
                  onCloseClick={() => onSelect(null)}
                >
                  <PlaceCard p={selected} city={legName.get(selected.leg_id ?? -1) || null} onJump={onJump} />
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
            <LeafletFit points={fitPoints} tripId={trip.id} />
            <LeafletJump place={selected} nonce={jumpNonce} />
            <LeafletPanToLocation at={myLocation} />
            {myLocation && (
              <CircleMarker
                center={[myLocation.lat, myLocation.lng]}
                radius={8}
                pathOptions={{ color: "#ffffff", weight: 3, fillColor: "#1a73e8", fillOpacity: 1 }}
              />
            )}

            {showRoute && routePath.length > 1 && (
              <LPolyline
                positions={routePath.map((p) => [p.lat, p.lng] as [number, number])}
                pathOptions={{ color: ROUTE_COLOR, weight: 3, dashArray: "8 8", opacity: 0.85 }}
              />
            )}
            {showRoute && route.map((l, i) => (
              <CircleMarker
                key={`leg-${l.id}`}
                center={[l.lat as number, l.lng as number]}
                radius={11}
                pathOptions={{ color: "#ffffff", weight: 2, fillColor: ROUTE_COLOR, fillOpacity: 1 }}
              >
                <Tooltip permanent direction="center" className="leg-pin-label">{i + 1}</Tooltip>
              </CircleMarker>
            ))}

            {placesWithCoords.map((p) => (
              <CircleMarker
                key={p.id}
                center={[p.lat as number, p.lng as number]}
                radius={p.id === selectedId ? 13 : p.priority === "must" ? 9 : 7}
                eventHandlers={{ click: () => onSelect(p.id) }}
                pathOptions={{
                  color: p.id === selectedId ? "#ffffff" : (p.status === "dropped" ? "#7c7c7c" : CATEGORY_COLORS[p.category] || CATEGORY_COLORS.other),
                  weight: p.id === selectedId ? 3 : 1,
                  fillColor: p.status === "dropped" ? "#7c7c7c" : CATEGORY_COLORS[p.category] || CATEGORY_COLORS.other,
                  fillOpacity: p.status === "dropped" ? 0.25 : 0.8,
                }}
              >
                <Popup><PlaceCard p={p} city={legName.get(p.leg_id ?? -1) || null} onJump={onJump} /></Popup>
              </CircleMarker>
            ))}
            {pending && (
              <CircleMarker center={[pending.lat, pending.lng]} radius={12} pathOptions={{ color: "#fff", dashArray: "4" }} />
            )}
          </MapContainer>
        )}
      </div>

      <div className="map-legend-bar">
        <ul className="legend">
          {Object.entries(CATEGORY_COLORS).map(([k, c]) => (
            <li key={k}><span className="dot" style={{ background: c }} /> {k}</li>
          ))}
          {routePath.length > 1 && (
            <li><span className="dot route" /> route</li>
          )}
        </ul>
        <div className="map-legend-actions">
          {routePath.length > 1 && (
            <label className="row nowrap" style={{ gap: 6 }}>
              <input type="checkbox" checked={showRoute} onChange={(e) => setShowRoute(e.target.checked)} />
              <span className="hint">Show route</span>
            </label>
          )}
          {/* The Google build gets this from the locate control on the map itself. */}
          {!useGoogle && (
            <button className="small btn-icon" onClick={locate} disabled={locating}>
              <LocateFixed size={13} /> {locating ? "Locating…" : "My location"}
            </button>
          )}
          <span className="hint">Click the map to pin a new place.</span>
        </div>
      </div>
    </div>
  );
}

function PlaceCard({ p, city, onJump }: { p: Place; city: string | null; onJump?: () => void }) {
  return (
    <div className={`place-card${p.photo_ref ? " has-photo" : ""}`}>
      {p.photo_ref && <img className="place-photo" src={`/api/places/${p.id}/photo`} alt={p.name} />}
      <div className="place-card-body">
        <div className="place-card-title" dir="auto"><strong>{p.name}</strong></div>
        <div className="place-card-meta">
          {city ? `${city} · ` : ""}{p.category} · ~{p.duration_min}min · {p.priority}
          {p.status === "dropped" ? " · DROPPED" : ""}
        </div>
        {p.notes && <div className="place-card-notes" dir="auto">{p.notes}</div>}
        <div className="place-card-actions">
          {onJump && (
            <button className="place-card-jump btn-icon" onClick={onJump}>
              <LocateFixed size={12} /> Jump to location
            </button>
          )}
          <a className="icon-line" href={gmapsLink(p)} target="_blank" rel="noreferrer">
            Open in Google Maps <ExternalLink size={11} />
          </a>
        </div>
      </div>
    </div>
  );
}
