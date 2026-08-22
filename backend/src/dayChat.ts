// The part of the per-day chat that decides what a model reply is *allowed* to become.
//
// The whole safety property of the chat lives here: a place can only enter the plan if the server
// itself fetched it this turn (a real Places search result, or an entry from a Maps list the
// traveller pasted). The model refers to one by an opaque ref; everything user-visible about it —
// name, address, coordinates — is copied from our own record, never from the reply. So there is no
// field a made-up restaurant can arrive in, which is a stronger guarantee than asking the prompt
// nicely and hoping.
//
// Kept out of the route handler so it can be tested directly against adversarial replies.
//
// What this does NOT stop, stated plainly: a reply can still put a made-up name in the *title* of
// an item that claims no place at all. That item is then exactly what a hand-typed "Lunch" line is
// — a label with no coordinates, no pin on the day map, no link, and nothing added to the trip's
// places. The prompt forbids it and this keeps it inert, but the two together are a strong
// discouragement rather than an impossibility, and the UI shouldn't imply otherwise.

export type Candidate = {
  ref: string; name: string; address: string; lat: number | null; lng: number | null;
  google_place_id: string; gmaps_url: string; via: string;
};

export type ProposedItem = {
  time: string; kind: string; title: string;
  place_id: number | null; new_place_ref: string | null;
  duration_min: number; details: string; tip: string; pinned: boolean;
};

export type Proposal = {
  summary: string; wake_time: string; items: ProposedItem[]; new_places: Candidate[];
};

const KINDS = new Set(["visit", "meal", "transit", "rest", "checkin", "checkout", "flight", "other"]);

/** Keeps a well-formed local "HH:MM"; anything else becomes blank rather than a guess. */
export function hhmmOrBlank(v: unknown): string {
  const s = String(v ?? "").trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? s : "";
}

export function sanitizeProposal(
  raw: any,
  candidates: Candidate[],
  knownPlaceIds: Set<number>,
  day: { summary?: string; wake_time?: string }
): Proposal | null {
  if (!raw || !Array.isArray(raw.items)) return null;

  const byRef = new Map(candidates.map((c) => [c.ref, c]));
  const usedRefs = new Set<string>();

  const items: ProposedItem[] = [];
  for (const it of raw.items) {
    if (!it || typeof it !== "object") continue;

    // A ref the server didn't hand out is dropped, not honoured. Same for a place id that isn't
    // on this trip — that's how a reply referring to someone else's place would be caught.
    const ref = typeof it.new_place_ref === "string" && byRef.has(it.new_place_ref) ? it.new_place_ref : null;
    const placeId = ref == null && knownPlaceIds.has(Number(it.place_id)) ? Number(it.place_id) : null;
    if (ref) usedRefs.add(ref);

    // The title of a ref'd item comes from our record. The model doesn't get to name it, which
    // means it can't smuggle "Joe's Bar (closed Mondays)" in through a field we do display.
    const title = ref
      ? byRef.get(ref)!.name
      : String(it.title ?? "").trim().slice(0, 200);
    if (!title && placeId == null) continue;

    items.push({
      time: hhmmOrBlank(it.time) || "09:00",
      kind: KINDS.has(String(it.kind)) ? String(it.kind) : "other",
      title,
      place_id: placeId,
      new_place_ref: ref,
      duration_min: Number.isFinite(Number(it.duration_min))
        ? Math.min(24 * 60, Math.max(0, Math.round(Number(it.duration_min))))
        : 60,
      details: typeof it.details === "string" ? it.details.slice(0, 2000) : "",
      tip: typeof it.tip === "string" ? it.tip.slice(0, 500) : "",
      pinned: it.pinned === true,
    });
  }

  if (items.length === 0) return null;

  return {
    summary: typeof raw.summary === "string" ? raw.summary.slice(0, 500) : day.summary || "",
    wake_time: hhmmOrBlank(raw.wake_time) || day.wake_time || "08:00",
    items,
    // Only candidates something actually points at are offered for creation.
    new_places: candidates.filter((c) => usedRefs.has(c.ref)),
  };
}

/** Up to `max` non-empty, deduplicated search queries out of whatever the model asked for. */
export function searchQueries(raw: any, max = 3): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of raw) {
    const s = String(q ?? "").trim().slice(0, 200);
    const key = s.toLowerCase();
    if (!s || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}
