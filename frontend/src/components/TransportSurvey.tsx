import { Car, CarTaxiFront, Check, Footprints, Shuffle, TrainFront, X } from "lucide-react";
import { TRANSPORT, TRANSPORT_FALLBACK } from "../plan";
import type { Booking, Leg, TransportMode } from "../types";

const MODE_ICON: Record<string, typeof Car> = {
  transit: TrainFront, car: Car, walk: Footprints, taxi: CarTaxiFront, mixed: Shuffle,
};

/**
 * A car booking that overlaps this leg is strong evidence of how the city gets crossed — offered
 * as a suggestion, never applied silently, because a car booked for one leg often sits parked
 * during another.
 */
function suggestedFor(leg: Leg, bookings: Booking[]): TransportMode | null {
  const overlaps = bookings.some((b) => {
    if (b.kind !== "car" || !b.date) return false;
    const from = b.date;
    const to = b.end_date || b.date;
    return !(leg.depart_date && leg.depart_date < from) && !(leg.arrive_date && leg.arrive_date > to);
  });
  return overlaps ? "car" : null;
}

/**
 * Asks the one question the schedule can't work out on its own. Everything else the plan needs
 * (dates, cities, places, bookings) is already in the trip; how you actually move between two
 * stops is not, and it changes every travel estimate on the day.
 */
export default function TransportSurvey({ legs, bookings, onSet, onClose }: {
  legs: Leg[];
  bookings: Booking[];
  onSet: (leg: Leg, mode: TransportMode) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal survey-modal" onClick={(e) => e.stopPropagation()}>
        <div className="row spread">
          <h3>How are you getting around?</h3>
          <button className="icon-btn" aria-label="Close" onClick={onClose}><X size={16} /></button>
        </div>
        <p>
          One answer per city. It sets how long the plan allows between two stops, and it's handed to
          the generator as a constraint. Unanswered cities are planned as
          “{TRANSPORT_FALLBACK.label.toLowerCase()}”.
        </p>

        <div className="modal-scroll survey-legs">
          {legs.map((l) => {
            const suggested = suggestedFor(l, bookings);
            return (
              <div className="survey-leg" key={l.id}>
                <div className="survey-leg-head">
                  <strong dir="auto">{l.city || "Unnamed city"}</strong>
                  {l.country && <span className="hint"> · {l.country}</span>}
                  {suggested && l.transport !== suggested && (
                    <span className="survey-hint">You have a car booked here</span>
                  )}
                </div>
                <div className="survey-modes">
                  {TRANSPORT.map((t) => {
                    const Icon = MODE_ICON[t.id];
                    const active = l.transport === t.id;
                    return (
                      <button
                        key={t.id}
                        className={`chip-toggle${active ? " active" : ""}`}
                        aria-pressed={active}
                        title={t.hint}
                        onClick={() => void onSet(l, active ? "" : t.id)}
                      >
                        <Icon size={13} /> {t.label}
                        {active && <Check size={12} />}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {legs.length === 0 && <p className="hint">Add cities on the Overview tab first.</p>}
        </div>

        <div className="modal-actions">
          <button className="primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
