// Prompt builders for the three LLM jobs: plan generation, plan advising, conversation import.
// Hard product rule baked into every prompt: the assistant must NEVER invent new attractions.

export type TripBundle = {
  trip: any;
  legs: any[];
  places: any[];
  bookings: any[];
};

function bundleText(b: TripBundle): string {
  const legLines = b.legs
    .map(
      (l) =>
        `- leg#${l.id} [${l.seq}] ${l.city}, ${l.country} | ${l.arrive_date || "?"} -> ${l.depart_date || "?"}`
    )
    .join("\n");
  const placeLines = b.places
    .filter((p) => p.status === "active")
    .map(
      (p) =>
        `- place#${p.id} "${p.name}" (leg#${p.leg_id ?? "?"}, ${p.category}, ~${p.duration_min}min, priority=${p.priority})${p.notes ? ` notes: ${p.notes}` : ""}`
    )
    .join("\n");
  const bookingLines = b.bookings
    .map(
      (bk) =>
        `- ${bk.kind}: ${bk.title} on ${bk.date || "?"}${bk.end_date ? ` until ${bk.end_date}` : ""}${bk.notes ? ` (${bk.notes})` : ""}`
    )
    .join("\n");
  return `TRIP: "${b.trip.name}" (${b.trip.trip_type}) ${b.trip.start_date || "?"} -> ${b.trip.end_date || "?"}
Budget: ${b.trip.budget ?? "unspecified"} ${b.trip.currency || ""}. Home city: ${b.trip.home_city || "unspecified"}.
Trip notes: ${b.trip.notes || "none"}

LEGS (cities in order):
${legLines || "(none)"}

PLACES THE USER CHOSE (the only attractions that may appear in the plan):
${placeLines || "(none)"}

FIXED BOOKINGS (flights/stays/trains — immovable constraints):
${bookingLines || "(none)"}`;
}

export function planPrompt(b: TripBundle): { system: string; user: string } {
  return {
    system: `You are a travel scheduling engine. You arrange ONLY the places the user already chose into a realistic day-by-day schedule. You NEVER add attractions, restaurants, or sights that are not in the user's place list. Generic non-attraction items are allowed: breakfast/lunch/dinner (unnamed unless a food place is in the list), hotel check-in/out, transit between cities, and rest breaks.

Rules:
- Respect leg date ranges: a place belongs to its leg's city and dates.
- Respect fixed bookings (flights/trains) as immovable.
- Realistic pacing: account for travel time between places in the same city (assume public transit), typical opening hours, and meal times.
- 'must' places get scheduled first; 'want' next; 'maybe' only if the day has room — otherwise leave them out and note it.
- Include a wake_time per day; flag days that require waking before 07:30.
- Insert explicit rest blocks on dense days and after intercity travel days.
- Reply with ONLY a JSON object, no prose.`,
    user: `${bundleText(b)}

Produce the daily schedule as JSON with this exact shape:
{
  "days": [
    {
      "date": "YYYY-MM-DD",
      "city": "string",
      "wake_time": "HH:MM",
      "summary": "one-line summary of the day",
      "items": [
        { "time": "HH:MM", "kind": "visit|meal|transit|rest|checkin|checkout|flight|other",
          "title": "string", "place_id": 123 or null, "duration_min": 60, "note": "optional short note" }
      ],
      "warnings": ["optional pacing warnings for this day"]
    }
  ],
  "unscheduled_place_ids": [ids of active places that did not fit],
  "notes": "overall notes about the schedule"
}
Every "visit" item MUST reference an existing place_id from the list above. Cover every date from trip start to trip end.`,
  };
}

export function advisorPrompt(b: TripBundle, planJson: string): { system: string; user: string } {
  return {
    system: `You are a travel plan reviewer. Your ONLY job is to critique the user's existing plan — you must NEVER suggest new places, attractions, restaurants, or activities of any kind. You may only recommend: dropping or shortening existing places, reordering, adding rest, changing wake-up times, or flagging unrealistic days.

Reply with ONLY a JSON object, no prose.`,
    user: `${bundleText(b)}

CURRENT GENERATED PLAN:
${planJson}

Review the plan and reply as JSON with this exact shape:
{
  "overall": "2-3 sentence honest assessment of pacing and feasibility",
  "drop_suggestions": [
    { "place_id": 123, "place_name": "string", "reason": "why dropping/shortening it would improve the trip" }
  ],
  "pacing_alerts": [
    { "date": "YYYY-MM-DD", "type": "overload|early_wake|rest_needed|transit_heavy|budget",
      "message": "specific, actionable message (e.g. 'You need to wake up at 06:30 to make this work' or 'Take an afternoon rest — 3rd intense day in a row')" }
  ],
  "day_notes": [ { "date": "YYYY-MM-DD", "note": "short note" } ]
}
If the plan is fine, return empty arrays — do not invent problems, and NEVER suggest adding anything new.`,
  };
}

export function importPrompt(conversationText: string): { system: string; user: string } {
  return {
    system: `You extract structured trip data from a travel-planning conversation (any language, including Hebrew). Extract ONLY what the conversation actually contains — do not invent places or dates. Keep place/city names in English when a well-known English name exists, otherwise keep the original. Estimate lat/lng for well-known cities and famous places when you are confident; otherwise use null.

Reply with ONLY a JSON object, no prose.`,
    user: `CONVERSATION:
${conversationText}

Extract the trip as JSON with this exact shape:
{
  "name": "short trip name",
  "trip_type": "oneway|round|multicity",
  "start_date": "YYYY-MM-DD or null",
  "end_date": "YYYY-MM-DD or null",
  "home_city": "string or null",
  "budget": number or null,
  "currency": "ILS|USD|EUR|... or null",
  "notes": "important constraints/preferences mentioned (budget details, pace, dietary, etc.)",
  "legs": [
    { "city": "string", "country": "string", "arrive_date": "YYYY-MM-DD or null",
      "depart_date": "YYYY-MM-DD or null", "lat": number or null, "lng": number or null }
  ],
  "places": [
    { "name": "string", "city": "which leg city it belongs to", "category": "sight|food|nature|museum|shopping|nightlife|other",
      "duration_min": estimated minutes, "priority": "must|want|maybe", "lat": number or null, "lng": number or null,
      "notes": "short note from the conversation or empty" }
  ],
  "todos": [ { "text": "string", "category": "general|booking|documents|packing|money", "due_date": "YYYY-MM-DD or null" } ],
  "bookings": [
    { "kind": "flight|stay|train|bus|ferry|other", "title": "string", "date": "YYYY-MM-DD or null",
      "end_date": "YYYY-MM-DD or null", "city": "leg city or null", "cost": number or null, "notes": "" }
  ]
}`,
  };
}
