/**
 * Country name → ISO 3166-1 alpha-2, for the booking deep links that need one.
 *
 * Agoda is the reason this exists: unlike Booking.com and Airbnb it has no free-text search
 * URL, only per-city landing pages of the form /city/<slug>-<iso2>.html, and a slug it
 * doesn't recognise returns a 404 rather than a search. So the link is only offered when the
 * country actually resolves here — same rule as the airport codes in airports.ts: a link we
 * can't build correctly isn't shown at all.
 *
 * Aliases are included for the ways people actually type these into a free-text field.
 */
const CODES: Record<string, string> = {
  // Asia
  "south korea": "kr", korea: "kr", "republic of korea": "kr",
  japan: "jp", china: "cn", "hong kong": "hk", macau: "mo", taiwan: "tw",
  thailand: "th", vietnam: "vn", "viet nam": "vn", cambodia: "kh", laos: "la",
  myanmar: "mm", burma: "mm", malaysia: "my", singapore: "sg", indonesia: "id",
  philippines: "ph", india: "in", "sri lanka": "lk", nepal: "np", maldives: "mv",
  // Middle East
  israel: "il", jordan: "jo", "united arab emirates": "ae", uae: "ae",
  qatar: "qa", "saudi arabia": "sa", turkey: "tr", turkiye: "tr", oman: "om",
  // Europe
  "united kingdom": "gb", uk: "gb", england: "gb", scotland: "gb", britain: "gb",
  ireland: "ie", france: "fr", spain: "es", portugal: "pt", italy: "it",
  germany: "de", netherlands: "nl", holland: "nl", belgium: "be", luxembourg: "lu",
  switzerland: "ch", austria: "at", "czech republic": "cz", czechia: "cz",
  poland: "pl", hungary: "hu", slovakia: "sk", slovenia: "si", croatia: "hr",
  serbia: "rs", romania: "ro", bulgaria: "bg", greece: "gr", cyprus: "cy",
  denmark: "dk", norway: "no", sweden: "se", finland: "fi", iceland: "is",
  estonia: "ee", latvia: "lv", lithuania: "lt", malta: "mt", russia: "ru",
  // Americas
  "united states": "us", usa: "us", us: "us", "united states of america": "us",
  canada: "ca", mexico: "mx", brazil: "br", argentina: "ar", chile: "cl",
  peru: "pe", colombia: "co", uruguay: "uy", ecuador: "ec", "costa rica": "cr",
  panama: "pa", cuba: "cu", "dominican republic": "do", jamaica: "jm",
  // Africa
  egypt: "eg", morocco: "ma", tunisia: "tn", "south africa": "za", kenya: "ke",
  tanzania: "tz", ethiopia: "et", namibia: "na", mauritius: "mu", seychelles: "sc",
  // Oceania
  australia: "au", "new zealand": "nz", fiji: "fj",
};

/** Lowercase, strip accents and punctuation, collapse whitespace. */
function norm(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The ISO alpha-2 code for a country name, or null when we don't recognise it. */
export function countryCode(name: string): string | null {
  const key = norm(name);
  if (!key) return null;
  if (/^[a-z]{2}$/.test(key) && Object.values(CODES).includes(key)) return key;
  return CODES[key] ?? null;
}

/** "Tel Aviv" → "tel-aviv": the slug shape Agoda's city pages use. */
export function citySlug(city: string): string {
  return norm(city).replace(/\s/g, "-");
}
