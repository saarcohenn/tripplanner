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

/**
 * The same extraction as importPrompt, but into a trip that already exists. The whole difference
 * is context: the model is shown what the trip already holds so it proposes what's *missing*
 * rather than a second copy of everything, and attaches new places to the cities already there.
 *
 * It only ever proposes — nothing here writes. The user picks what lands (see /import/preview).
 */
export function mergePrompt(b: TripBundle, text: string): { system: string; user: string } {
  return {
    system: `You extract structured trip data from what a traveller tells you and fit it into a trip that ALREADY EXISTS. You are adding to their plan, never replacing it and never second-guessing it.

Rules:
- Extract ONLY what the text actually says. You must NEVER invent cities, attractions, restaurants, hotels or dates the traveller did not mention — not even obvious ones, not even to be helpful. An empty list is the correct answer when the text names nothing.
- The trip's current contents are listed below. Anything already there must NOT be proposed again. When the text mentions a city the trip already has, put that city's existing id in "existing_leg_id" and do not add a new leg for it.
- Attach every place to the city it belongs to by name in "city", matching the leg list below where the city is already there.
- Trip-level fields: propose a value ONLY where the trip's current value is missing or unknown. If the traveller already set a name, dates, home city, budget or currency, leave that field out entirely — you are filling blanks, not correcting them.
- Dates: only give a date the text actually determines. "Ten days in October" without a year or a start day is not a date — leave it null and say so in the summary.
- Estimate lat/lng only for well-known cities and famous places you are confident about; otherwise null.
- Keep city and place names in English when a well-known English name exists, otherwise keep the original. Any input language is fine, including Hebrew.

Reply with ONLY a JSON object, no prose.`,
    user: `${bundleText(b)}

WHAT THE TRAVELLER SAYS (this is the new information to fit in):
${text}

Reply as JSON with this exact shape:
{
  "summary": "1-3 sentences: what you understood, and anything you deliberately left out because the text didn't pin it down",
  "trip": {
    "name": "string or null", "trip_type": "oneway|round|multicity or null",
    "start_date": "YYYY-MM-DD or null", "end_date": "YYYY-MM-DD or null",
    "home_city": "string or null", "budget": number or null, "currency": "3-letter code or null"
  },
  "legs": [
    { "city": "string", "country": "string", "arrive_date": "YYYY-MM-DD or null",
      "arrive_time": "HH:MM local, only if stated, else null",
      "depart_date": "YYYY-MM-DD or null", "depart_time": "HH:MM local, only if stated, else null",
      "lat": number or null, "lng": number or null }
  ],
  "places": [
    { "name": "string", "city": "which city it belongs to", "existing_leg_id": leg id from the list above or null,
      "category": "sight|food|nature|museum|shopping|nightlife|other", "duration_min": estimated minutes,
      "priority": "must|want|maybe", "lat": number or null, "lng": number or null, "notes": "short note or empty" }
  ],
  "todos": [ { "text": "string", "category": "general|booking|documents|packing|money", "due_date": "YYYY-MM-DD or null" } ],
  "bookings": [
    { "kind": "flight|stay|train|bus|ferry|car|activity|other", "title": "string", "city": "city or null",
      "date": "YYYY-MM-DD or null", "end_date": "YYYY-MM-DD or null", "cost": number or null,
      "currency": "3-letter code or null", "ref": "confirmation code or empty", "notes": "" }
  ],
  "notes": "anything stated that matters to planning but fits none of the fields above (pace, dietary needs, who is travelling), or an empty string"
}
Every list may be empty. Propose nothing the trip already has.`,
  };
}

/**
 * The per-day chat.
 *
 * This is the one place the app will put a place in front of you that you didn't pick — and it is
 * still not allowed to make one up. The model may only point at a candidate the *server* fetched
 * this turn: a real Google Places search result, or an entry from a Maps list the traveller gave
 * it. Candidates are referenced by an opaque ref and the server fills in the details from its own
 * record, so a hallucinated restaurant has nowhere to enter the system — there is no field for the
 * model to type a name into.
 *
 * Two rounds at most: one to ask for searches, one to answer with them.
 */
export function dayChatPrompt(args: {
  bundle: TripBundle;
  day: any;
  dayPlaces: any[];
  history: { role: string; content: string }[];
  message: string;
  candidates: { ref: string; name: string; address: string; via: string }[];
  canSearch: boolean;
  searchesUsed: boolean;
}): { system: string; user: string } {
  const { bundle, day, dayPlaces, history, message, candidates, canSearch, searchesUsed } = args;

  const itemLines = (day.items || [])
    .map((it: any, i: number) =>
      `  [${i}] ${it.time} ${it.kind} "${it.title}"${it.place_id != null ? ` (place#${it.place_id})` : ""} ${it.duration_min || 0}min${it.pinned ? " FIXED" : ""}`
    )
    .join("\n");

  const placeLines = dayPlaces
    .map((p) => `  place#${p.id} "${p.name}" (${p.category}, ~${p.duration_min}min, ${p.priority}${p.leg_id ? "" : ", no city"})${p.notes ? ` — ${p.notes}` : ""}`)
    .join("\n");

  const candidateLines = candidates
    .map((c) => `  ${c.ref} "${c.name}" — ${c.address || "no address"} [via ${c.via}]`)
    .join("\n");

  const searchClause = canSearch && !searchesUsed
    ? `If answering needs a place that is not in either list above, do NOT name one from memory. Reply with ONLY {"searches": ["...", "..."]} — up to 3 short Google-Maps-style queries including the city, e.g. "vintage record shops Shimokitazawa Tokyo". You will be given the real results and asked again.`
    : searchesUsed
      ? `The search results are in CANDIDATES above. Use them or say nothing suitable came back.`
      : `Searching is unavailable (no Google Maps key is configured), so work only with the lists above and say so if the request needed a search.`;

  return {
    system: `You edit ONE day of a traveller's itinerary, by conversation. You are precise, brief, and you never pretend.

The hard rule: you may only schedule a place that appears in TRIP PLACES or in CANDIDATES below. You must NEVER write the name of an attraction, restaurant, shop or venue that is not in one of those lists — not from your own knowledge, not as an example, not as a "you could also". If you want somewhere that isn't listed, ask for a search instead. A day you cannot improve honestly is a day you leave alone, and you say why.

Other rules:
- Items marked FIXED come from a booking or a stated arrival/departure time. Keep them, keep their time.
- Respect the city and the way the traveller gets around it — travel between stops has to fit.
- Give times in local 24h HH:MM, in a sensible order, with realistic durations and travel gaps.
- Keep everything the traveller didn't ask you to change.

Reply with ONLY a JSON object, no prose.`,
    user: `${bundleText(bundle)}

THE DAY YOU ARE EDITING — ${day.date}, ${day.city || "city unknown"} (wake ${day.wake_time || "?"})
Summary: ${day.summary || "(none)"}
Items:
${itemLines || "  (empty)"}

TRIP PLACES you may schedule (the traveller chose these):
${placeLines || "  (none)"}

CANDIDATES you may schedule (fetched for you this turn — real results, not your own recall):
${candidateLines || "  (none)"}

${history.length ? `EARLIER IN THIS CONVERSATION:\n${history.map((h) => `${h.role}: ${h.content}`).join("\n")}\n` : ""}
THE TRAVELLER SAYS:
${message}

${searchClause}

Otherwise reply as JSON with this exact shape:
{
  "reply": "1-3 sentences: what you changed and why. Say plainly if you couldn't do part of it.",
  "proposal": {
    "summary": "one-line summary of the day",
    "wake_time": "HH:MM",
    "items": [
      { "time": "HH:MM", "kind": "visit|meal|transit|rest|checkin|checkout|flight|other",
        "title": "string", "place_id": 123 or null, "new_place_ref": "c2 or null",
        "duration_min": 90, "details": "how to get there + what to expect, or empty",
        "tip": "queue/booking tip or empty", "pinned": true only for items that were FIXED }
    ]
  }
}
"items" is the WHOLE day after your change, in order — not a diff. Every item that stands for a place must carry either "place_id" (from TRIP PLACES) or "new_place_ref" (from CANDIDATES), never both, never a name alone. Set "proposal" to null when you are only answering a question or have nothing to change.`,
  };
}

/**
 * The advisor, narrowed to one day.
 *
 * The trip-wide review answers "is this whole trip survivable", which is worth reading once and is
 * far too much while you are moving things around on Tuesday. This asks the same kind of question
 * about a single day, and is held to a hard budget: at most three points, each about *this* day.
 * The no-new-places rule is unchanged — it critiques, it never suggests somewhere to go.
 */
export function dayAdvicePrompt(args: {
  bundle: TripBundle;
  day: any;
  before: any | null;
  after: any | null;
  transport: string;
}): { system: string; user: string } {
  const { bundle, day, before, after, transport } = args;
  const line = (d: any) =>
    d ? `${d.date} in ${d.city || "?"}: ${(d.items || []).length} items, wake ${d.wake_time || "?"}` : "(none)";
  const items = (day.items || [])
    .map((it: any) => `  ${it.time} ${it.kind} "${it.title}" ${it.duration_min || 0}min${it.pinned ? " FIXED" : ""}`)
    .join("\n");

  return {
    system: `You review ONE day of a traveller's itinerary. You are blunt, specific and short.

You must NEVER suggest a new place, restaurant, attraction or activity — not one. You may only say: this is too much, this is too little, this order wastes travel, this needs an earlier start, this leaves no time to eat, this day is fine. If the day is fine, say so in one line and return no points; inventing a problem to look useful is the worst thing you can do here.

Budget: at most 3 points. Fewer is better. Each one must be about THIS day and must name what to actually do about it.

Reply with ONLY a JSON object, no prose.`,
    user: `${bundleText(bundle)}

THE DAY UNDER REVIEW — ${day.date}, ${day.city || "city unknown"}
Wake ${day.wake_time || "?"}. Getting around: ${transport || "not stated (assume public transport)"}.
Summary: ${day.summary || "(none)"}
Items:
${items || "  (nothing scheduled)"}

The day before — ${line(before)}
The day after  — ${line(after)}

Reply as JSON with this exact shape:
{
  "verdict": "one line: how this day actually reads. Say 'This day is fine' when it is.",
  "load": "light|comfortable|full|too much",
  "points": [
    { "type": "overload|early_wake|rest_needed|transit_heavy|gap|timing|budget",
      "message": "one specific sentence, naming the item or the hour it is about" }
  ]
}
"points" may be empty. Never more than 3.`,
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
