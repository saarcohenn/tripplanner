import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, CircleMarker, Polyline as LPolyline, Tooltip, useMap as useLeafletMap } from "react-leaflet";
import { APIProvider, Map as GMap, Marker, Polyline, ColorScheme, useMap } from "@vis.gl/react-google-maps";
import { MapPinOff } from "lucide-react";

/** One located stop in the day, already numbered in visiting order. */
export type DayStop = { key: string; lat: number; lng: number; label: string; title: string; color: string };

const CIRCLE_PATH = "M 0,-8 a 8,8 0 1,0 0.001,0 z";
const ROUTE_COLOR = "#6b5b95";

/** Refit whenever the day changes — a day map has one job, showing today, so it always reframes. */
function GoogleFit({ stops, fitKey }: { stops: DayStop[]; fitKey: string }) {
  const map = useMap();
  useEffect(() => {
    if (!map || stops.length === 0) return;
    if (stops.length === 1) {
      map.setCenter({ lat: stops[0].lat, lng: stops[0].lng });
      map.setZoom(14);
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    for (const s of stops) bounds.extend({ lat: s.lat, lng: s.lng });
    map.fitBounds(bounds, 48);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, fitKey, stops.length]);
  return null;
}

function LeafletFit({ stops, fitKey }: { stops: DayStop[]; fitKey: string }) {
  const map = useLeafletMap();
  useEffect(() => {
    if (stops.length === 0) return;
    if (stops.length === 1) { map.setView([stops[0].lat, stops[0].lng], 14); return; }
    map.fitBounds(stops.map((s) => [s.lat, s.lng] as [number, number]), { padding: [30, 30] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, fitKey, stops.length]);
  return null;
}

/**
 * The day's own route: just the stops that have coordinates, in the order they're scheduled.
 * Read-only on purpose — adding and moving places happens on the Places tab's full map, this one
 * is for seeing whether today's order makes geographic sense.
 */
export default function DayMap({ stops, gmapsKey, theme, selectedKey, onSelect, fitKey }: {
  stops: DayStop[];
  gmapsKey: string | null;
  theme: "light" | "dark";
  selectedKey: string | null;
  onSelect: (key: string) => void;
  fitKey: string;
}) {
  const path = useMemo(() => stops.map((s) => ({ lat: s.lat, lng: s.lng })), [stops]);

  if (stops.length === 0) {
    return (
      <div className="day-map empty">
        <p className="hint icon-line">
          <MapPinOff size={14} /> Nothing on today's plan has coordinates yet. Pin places on the Places tab and they'll show up here.
        </p>
      </div>
    );
  }

  const center = { lat: stops[0].lat, lng: stops[0].lng };

  return (
    <div className="day-map">
      {gmapsKey ? (
        <APIProvider apiKey={gmapsKey} language="en">
          <GMap
            style={{ width: "100%", height: "100%" }}
            defaultCenter={center}
            defaultZoom={13}
            gestureHandling="cooperative"
            colorScheme={theme === "dark" ? ColorScheme.DARK : ColorScheme.LIGHT}
            disableDefaultUI
            zoomControl
            styles={[
              { featureType: "poi", stylers: [{ visibility: "off" }] },
              { featureType: "transit", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
            ]}
          >
            <GoogleFit stops={stops} fitKey={fitKey} />
            {path.length > 1 && (
              <Polyline
                path={path}
                strokeColor={ROUTE_COLOR}
                strokeOpacity={0}
                icons={[{ icon: { path: "M 0,-1 0,1", strokeOpacity: 0.9, strokeWeight: 3, scale: 3 }, offset: "0", repeat: "12px" }]}
              />
            )}
            {stops.map((s) => (
              <Marker
                key={s.key}
                position={{ lat: s.lat, lng: s.lng }}
                title={s.title}
                zIndex={s.key === selectedKey ? 10 : 2}
                onClick={() => onSelect(s.key)}
                label={{ text: s.label, color: "#ffffff", fontSize: "11px", fontWeight: "700" }}
                icon={{
                  path: CIRCLE_PATH,
                  fillColor: s.color,
                  fillOpacity: 1,
                  strokeColor: "#ffffff",
                  strokeWeight: s.key === selectedKey ? 3 : 1.5,
                  scale: s.key === selectedKey ? 1.7 : 1.3,
                }}
              />
            ))}
          </GMap>
        </APIProvider>
      ) : (
        <MapContainer center={[center.lat, center.lng]} zoom={13} className="map" scrollWheelZoom={false}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <LeafletFit stops={stops} fitKey={fitKey} />
          {path.length > 1 && (
            <LPolyline
              positions={path.map((p) => [p.lat, p.lng] as [number, number])}
              pathOptions={{ color: ROUTE_COLOR, weight: 3, dashArray: "8 8", opacity: 0.85 }}
            />
          )}
          {stops.map((s) => (
            <CircleMarker
              key={s.key}
              center={[s.lat, s.lng]}
              radius={s.key === selectedKey ? 13 : 10}
              eventHandlers={{ click: () => onSelect(s.key) }}
              pathOptions={{
                color: "#ffffff", weight: s.key === selectedKey ? 3 : 1.5,
                fillColor: s.color, fillOpacity: 0.95,
              }}
            >
              <Tooltip permanent direction="center" className="leg-pin-label">{s.label}</Tooltip>
            </CircleMarker>
          ))}
        </MapContainer>
      )}
    </div>
  );
}
