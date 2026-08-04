// Reading a shared Google Maps list from its share link.
//
// Google publishes no API for saved/starred lists — the only supported export is a manual Takeout
// download, which is what the file-upload import does. But a list you have *shared* is served to
// anyone with the link, and the page fetches it from one unauthenticated endpoint. This module
// does the same two steps the page does: load the share link, lift the request credentials the
// page embedded for itself, then ask for the list.
//
// That endpoint is internal and undocumented. It is positional (JSPB — arrays, no field names),
// so a change at Google's end shifts meanings rather than erroring, and every read here is
// therefore guarded and shape-checked rather than trusted. If it ever stops returning something
// that looks like a list, this fails with a message pointing at the Takeout route, which is the
// supported path and is not going anywhere.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const TIMEOUT_MS = 20_000;
const MAX_BYTES = 8 * 1024 * 1024;

/** Only Google's own map hosts. Stops the endpoint being used to fetch arbitrary URLs server-side. */
const ALLOWED_HOSTS = new Set([
  "maps.app.goo.gl", "goo.gl", "maps.google.com", "www.google.com", "google.com",
  "www.google.co.uk", "maps.app.google.com",
]);

export type SharedListItem = {
  name: string;
  address: string;
  note: string;
  lat: number | null;
  lng: number | null;
  gmaps_url: string;
};

function assertAllowed(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw Object.assign(new Error("That doesn't look like a link. Paste the whole https://… URL."), { status: 400 });
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw Object.assign(new Error("Only http(s) links are supported."), { status: 400 });
  }
  const host = u.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.has(host) && !host.endsWith(".google.com")) {
    throw Object.assign(new Error("That's not a Google Maps link."), { status: 400 });
  }
  return u;
}

async function getText(url: string, referer?: string): Promise<{ text: string; finalUrl: string }> {
  const res = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      "user-agent": UA,
      "accept-language": "en-US,en;q=0.9",
      ...(referer ? { referer } : {}),
    },
  });
  if (!res.ok) {
    throw Object.assign(new Error(`Google returned ${res.status} for that link.`), { status: 502 });
  }
  const text = await res.text();
  if (text.length > MAX_BYTES) {
    throw Object.assign(new Error("That page was unexpectedly large — aborting."), { status: 502 });
  }
  return { text, finalUrl: res.url };
}

/** JSPB responses are served with a `)]}'` execution-prevention prefix. */
function parseJspb(body: string): any {
  const start = body.indexOf("[");
  if (start < 0) throw Object.assign(new Error("Google's reply wasn't a list."), { status: 502 });
  try {
    return JSON.parse(body.slice(start));
  } catch {
    throw Object.assign(new Error("Couldn't read Google's reply."), { status: 502 });
  }
}

/**
 * The list page embeds the exact request it is about to make for its own contents — the list id
 * plus a short-lived token and the frontend build number. Lifting it beats guessing the format.
 */
function seedFromHtml(html: string): { listId: string; token: string; build: number } {
  const m = html.match(/window\.APP_INITIALIZATION_STATE\s*=\s*(\[.*?\]);/s);
  if (!m) {
    throw Object.assign(
      new Error("That page didn't contain a list. Make sure the link is a shared *list*, not a single place."),
      { status: 400 }
    );
  }
  let state: any;
  try {
    state = JSON.parse(m[1]);
  } catch {
    throw Object.assign(new Error("Couldn't read that page."), { status: 502 });
  }

  let seed: any = null;
  for (const slot of Array.isArray(state) ? state : []) {
    for (const v of Array.isArray(slot) ? slot : []) {
      if (typeof v === "string" && v.startsWith(")]}'") && v.includes('[["')) {
        try { seed = JSON.parse(v.slice(v.indexOf("["))); } catch { /* not this one */ }
      }
    }
  }
  // A list id is base64url ("qpdgRj1pVKe-5fan2-VOcQ"). A single place's page seeds the same slot
  // with a feature id instead ("0x0:0x8713e370b8ac3b35"), which is how the two are told apart —
  // pasting a pin's share link rather than the list's is the easy mistake to make, and it earns
  // its own message rather than a confusing one about Google having changed.
  const listId = seed?.[0]?.[0];
  if (typeof listId !== "string" || !/^[\w-]{16,40}$/.test(listId)) {
    throw Object.assign(
      new Error("That link isn't a list — it looks like a single place. In Google Maps open the list itself, then Share → copy link."),
      { status: 400 }
    );
  }

  // Found by shape rather than by index: the block that leads with a token-shaped string (not the
  // list id) and carries the six-digit build number. Positional lookups here broke once already.
  let cred: any[] | null = null;
  (function walk(node: any) {
    if (cred || !Array.isArray(node)) return;
    if (
      typeof node[0] === "string" && node[0] !== listId && /^[\w-]{16,40}$/.test(node[0]) &&
      node.some((v) => typeof v === "number" && v > 100_000)
    ) {
      cred = node;
      return;
    }
    for (const child of node) walk(child);
  })(seed);

  const token = cred?.[0];
  const build = cred?.find((v: any) => typeof v === "number" && v > 100_000);
  if (typeof token !== "string" || typeof build !== "number") {
    throw Object.assign(
      new Error("Google's list page has changed shape — use the Takeout export below instead."),
      { status: 502 }
    );
  }
  return { listId, token, build };
}

/** A place's own Maps page, from the second half of its feature id. Blank when it isn't usable. */
function cidUrl(ftid: unknown): string {
  if (!Array.isArray(ftid) || typeof ftid[1] !== "string") return "";
  try {
    const signed = BigInt(ftid[1]);
    const unsigned = signed < 0n ? signed + (1n << 64n) : signed;
    return `https://maps.google.com/?cid=${unsigned.toString()}`;
  } catch {
    return "";
  }
}

function looksLikeEntry(e: any): boolean {
  return Array.isArray(e) && Array.isArray(e[1]) && typeof e[2] === "string";
}

/** Resolves a shared-list link to its places. Throws with a user-facing message on any failure. */
export async function fetchSharedList(rawUrl: string): Promise<{ listName: string; items: SharedListItem[]; skipped: number }> {
  const url = assertAllowed(rawUrl);
  const { text: html, finalUrl } = await getText(url.toString());

  // A pin's own share link is the easy mistake to make, and it lands on a page that parses far
  // enough to produce a confusing "Google changed" error. Name it before we get that far.
  if (/\/maps\/place\//.test(finalUrl) && !/placelists|!3e3/.test(finalUrl)) {
    throw Object.assign(
      new Error("That link is one place, not a list. Open the list itself in Google Maps, then Share → copy link."),
      { status: 400 }
    );
  }

  const { listId, token, build } = seedFromHtml(html);

  const pb = `!1m4!1s${listId}!2e1!3m1!1e1!2e2!3e2!4i500!6m3!1s${token}!15i${build}!28e2!16b1`;
  const api = `https://www.google.com/maps/preview/entitylist/getlist?authuser=0&hl=en&gl=us&pb=${encodeURIComponent(pb)}`;
  const { text: body } = await getText(api, finalUrl);
  const data = parseJspb(body);

  const root = Array.isArray(data?.[0]) ? data[0] : data;
  // Prefer the known slot, but accept the longest entry-shaped array anywhere in the record —
  // one added field upstream would otherwise silently return an empty list.
  let entries: any[] | null =
    Array.isArray(root?.[8]) && root[8].length > 0 && root[8].every(looksLikeEntry) ? root[8] : null;
  if (!entries) {
    for (const child of Array.isArray(root) ? root : []) {
      if (Array.isArray(child) && child.length > 0 && child.every(looksLikeEntry)) {
        if (!entries || child.length > entries.length) entries = child;
      }
    }
  }
  if (!entries) {
    throw Object.assign(
      new Error("That list came back empty. It may be private — open it in Google Maps, tap Share, and make sure link sharing is on."),
      { status: 400 }
    );
  }

  const listName = typeof root?.[4] === "string" ? root[4] : "";
  let skipped = 0;
  const items: SharedListItem[] = [];
  for (const e of entries) {
    const d = Array.isArray(e[1]) ? e[1] : [];
    const ll = Array.isArray(d[5]) ? d[5] : [];
    const name = typeof e[2] === "string" ? e[2].trim() : "";
    const address = (typeof d[2] === "string" && d[2]) || (typeof d[4] === "string" && d[4]) || "";
    if (!name && !address) { skipped++; continue; }
    items.push({
      name: name || address,
      address,
      // The traveller's own note on the pin. Takeout drops these entirely, which makes this
      // route strictly better than the file upload when a list has them.
      note: typeof e[3] === "string" ? e[3].trim() : "",
      lat: typeof ll[2] === "number" ? ll[2] : null,
      lng: typeof ll[3] === "number" ? ll[3] : null,
      gmaps_url: cidUrl(d[6]),
    });
  }
  return { listName, items, skipped };
}
