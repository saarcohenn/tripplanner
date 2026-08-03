// Prompt builders for the three LLM jobs: plan generation, plan advising, conversation import.
// Hard product rule baked into every prompt: the assistant must NEVER invent new attractions.

export type TripBundle = {
  trip: any;
  legs: any[];
  places: any[];
  bookings: any[];
};

function bundleText(b: TripBundle): string {
  // Times are local to the leg's own city and only present when the user supplied them —
  // an absent time means unknown, not midnight, so it's left off the line entirely.
  const at = (date: string | null, time: string | null) =>
    `${date || "?"}${date && time ? ` ${time}` : ""}`;
  // Only stated when the traveller answered the transport survey — an unanswered leg says nothing
  // rather than implying a mode the plan would then be built around.
  const legLines = b.legs
    .map(
      (l) =>
        `- leg#${l.id} [${l.seq}] ${l.city}, ${l.country} | ${at(l.arrive_date, l.arrive_time)} -> ${at(l.depart_date, l.depart_time)}` +
        (l.transport ? ` | getting around: ${l.transport}` : "")
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

// Shown pre-filled (and editable) in Settings — the "plan_system_prompt" setting overrides it.
export const DEFAULT_PLAN_SYSTEM_PROMPT = `You are a travel scheduling engine. You arrange ONLY the places the user already chose into a realistic day-by-day schedule. You NEVER add attractions, restaurants, or sights that are not in the user's place list. Generic non-attraction items are allowed: breakfast/lunch/dinner (unnamed unless a food place is in the list), hotel check-in/out, transit between cities, and rest breaks.

Rules:
- Respect leg date ranges: a place belongs to its leg's city and dates.
- Respect fixed bookings (flights/trains) as immovable.
- Realistic pacing: account for travel time between places in the same city, typical opening hours, and meal times.
- A leg line may state how the traveller gets around that city ("getting around: transit|car|walk|taxi|mixed"). Size travel times and routing advice around it: with a car, mention parking and prefer clustering by driving distance; on foot, keep consecutive stops genuinely walkable; on transit, name the line. When a leg states nothing, assume public transit and say so rather than inventing a car.
- 'must' places get scheduled first; 'want' next; 'maybe' only if the day has room — otherwise leave them out and note it.
- Include a wake_time per day; flag days that require waking before 07:30.
- Insert explicit rest blocks on dense days and after intercity travel days.
- A leg line may carry an arrival or departure time (local to that city). Treat it as fixed and size that day around it: a late landing makes the arrival day transfer, food and sleep rather than sightseeing, and an early departure ends the last day at check-out and drives that day's alarm_time. When a leg gives no time, do not assume one — plan that day as a normal full day.
- This is a DETAILED travel guide, not just a timetable. For every visit item write "details": 1-3 sentences — how to get there from the previous stop (name the metro/train line or say walk/taxi; keep it generic if unsure) and what to expect there. Add a "tip" when there is a real queue-avoidance or booking tip (arrive at opening, prebook timed tickets, best entrance); otherwise leave tip empty. Never invent facts you are unsure of — generic advice beats wrong specifics.
- Schedule the most crowded attraction of each day at opening time when practical, and derive each day's "alarm_time": the latest wake-up that still beats the lines at the first attraction, with "alarm_reason" explaining it (e.g. "Alarm 06:45 — be at Fushimi Inari by 07:30, before the tour groups").
- Reply with ONLY a JSON object, no prose.`;

export function planPrompt(b: TripBundle, systemPromptOverride?: string | null): { system: string; user: string } {
  return {
    system: systemPromptOverride?.trim() || DEFAULT_PLAN_SYSTEM_PROMPT,
    user: `${bundleText(b)}

Produce the daily schedule as JSON with this exact shape:
{
  "days": [
    {
      "date": "YYYY-MM-DD",
      "city": "string",
      "wake_time": "HH:MM",
      "alarm_time": "HH:MM",
      "alarm_reason": "why this alarm beats the lines (short)",
      "summary": "one-line summary of the day",
      "items": [
        { "time": "HH:MM", "kind": "visit|meal|transit|rest|checkin|checkout|flight|other",
          "title": "string", "place_id": 123 or null, "duration_min": 60,
          "details": "how to get there + what to expect (1-3 sentences)",
          "tip": "queue/booking tip or empty string",
          "note": "optional short note" }
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

/**
 * Background on ONE place the traveller already picked. This is the one prompt that is allowed to
 * tell the user something they didn't put in themselves — but only *about their own choice*: what
 * the place is, why it matters, when to turn up. It still may not point them at anything new, which
 * is the rule the whole app is built on.
 */
export function insightPrompt(place: any, city: string, country: string): { system: string; user: string } {
  return {
    system: `You are a travel guide writing about ONE place the traveller has already decided to visit. Your job is to make that visit better — never to redirect it. You must NEVER recommend other attractions, restaurants, cafes, shops, neighbourhoods, day trips or activities, not even nearby ones, and never as a "while you're there". Write only about the place named.

Accuracy matters more than colour: if you are not confident about a specific date, name, figure or opening time, write the general version instead of a specific claim, and lower your confidence. An empty field is better than an invented one.

Reply with ONLY a JSON object, no prose.`,
    user: `PLACE: "${place.name}"
City: ${city || "unknown"}${country ? `, ${country}` : ""}
Category: ${place.category || "unknown"}
Time the traveller has set aside: ${place.duration_min || "?"} minutes
Their own note: ${place.notes || "none"}

Reply as JSON with this exact shape:
{
  "headline": "one short line capturing what this place actually is",
  "history": "2-4 sentences: what it is, when and why it came to be, why it is worth the stop",
  "fun_fact": "one genuinely surprising, verifiable fact about this place, or an empty string",
  "best_time": "when in the day/week to go and what the crowds are like, or an empty string",
  "tips": ["practical tips for visiting THIS place: tickets, entrances, queues, dress code, cash, accessibility"],
  "duration_note": "whether the time set aside is about right, too tight, or generous — and why",
  "confidence": "high|medium|low"
}`,
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
      "arrive_time": "HH:MM local, ONLY if the conversation states it, else null",
      "depart_date": "YYYY-MM-DD or null",
      "depart_time": "HH:MM local, ONLY if the conversation states it, else null",
      "lat": number or null, "lng": number or null }
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
