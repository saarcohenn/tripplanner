/**
 * City → IATA code lookup for the boarding-pass view.
 *
 * Deliberately a hand-checked table rather than anything derived from the city's spelling:
 * a naive "first three letters" style guess produces confident nonsense (TEA for Tel Aviv
 * instead of TLV). Nothing here is inferred at runtime — a city that isn't in this table has
 * no code, and the pass renders a blank slot rather than a plausible-looking invention.
 *
 * When we don't know a city, the answer is to type the real code in: every leg has an
 * `airport` field and the trip has `home_airport`, and an explicit value always wins.
 *
 * Cities served by more than one major airport map to a single primary one (Tokyo → HND,
 * New York → JFK); override per-leg if you're flying into the other. Cities whose name is
 * genuinely ambiguous across countries (Santiago, Valencia, San José) are only listed under
 * CITY_IN_COUNTRY, so an unqualified match can't pick the wrong continent.
 */

const CITY: Record<string, string> = {
  // Middle East
  "tel aviv": "TLV", "tel aviv yafo": "TLV", "tel aviv jaffa": "TLV",
  dubai: "DXB", "abu dhabi": "AUH", doha: "DOH", amman: "AMM", riyadh: "RUH", jeddah: "JED",
  // East + Southeast Asia
  seoul: "ICN", incheon: "ICN", busan: "PUS", jeju: "CJU",
  tokyo: "HND", osaka: "KIX", nagoya: "NGO", fukuoka: "FUK", sapporo: "CTS",
  okinawa: "OKA", naha: "OKA",
  taipei: "TPE", "hong kong": "HKG", macau: "MFM", beijing: "PEK", shanghai: "PVG",
  "guangzhou": "CAN", chengdu: "CTU",
  bangkok: "BKK", phuket: "HKT", "chiang mai": "CNX", krabi: "KBV",
  singapore: "SIN", "kuala lumpur": "KUL", "ho chi minh city": "SGN", saigon: "SGN",
  hanoi: "HAN", "da nang": "DAD", "danang": "DAD", "phnom penh": "PNH", "siem reap": "REP",
  vientiane: "VTE", yangon: "RGN", manila: "MNL", cebu: "CEB",
  jakarta: "CGK", bali: "DPS", denpasar: "DPS",
  delhi: "DEL", "new delhi": "DEL", mumbai: "BOM", bengaluru: "BLR", bangalore: "BLR",
  goa: "GOI", kathmandu: "KTM", colombo: "CMB", male: "MLE",
  // Europe
  london: "LHR", manchester: "MAN", edinburgh: "EDI", dublin: "DUB",
  paris: "CDG", nice: "NCE", lyon: "LYS", marseille: "MRS",
  amsterdam: "AMS", brussels: "BRU", luxembourg: "LUX",
  berlin: "BER", munich: "MUC", frankfurt: "FRA", hamburg: "HAM", cologne: "CGN",
  dusseldorf: "DUS", stuttgart: "STR",
  zurich: "ZRH", geneva: "GVA", basel: "BSL", vienna: "VIE", salzburg: "SZG",
  prague: "PRG", budapest: "BUD", warsaw: "WAW", krakow: "KRK", gdansk: "GDN",
  bucharest: "OTP", sofia: "SOF", belgrade: "BEG", zagreb: "ZAG", ljubljana: "LJU",
  rome: "FCO", milan: "MXP", venice: "VCE", naples: "NAP", florence: "FLR",
  bologna: "BLQ", turin: "TRN", pisa: "PSA", catania: "CTA", palermo: "PMO",
  madrid: "MAD", barcelona: "BCN", seville: "SVQ", malaga: "AGP", bilbao: "BIO",
  palma: "PMI", ibiza: "IBZ",
  lisbon: "LIS", porto: "OPO", faro: "FAO",
  athens: "ATH", thessaloniki: "SKG", santorini: "JTR", mykonos: "JMK", heraklion: "HER",
  istanbul: "IST", ankara: "ESB", antalya: "AYT",
  copenhagen: "CPH", oslo: "OSL", stockholm: "ARN", gothenburg: "GOT",
  helsinki: "HEL", reykjavik: "KEF", tallinn: "TLL", riga: "RIX", vilnius: "VNO",
  moscow: "SVO",
  // North America
  "new york": "JFK", "new york city": "JFK", nyc: "JFK", newark: "EWR",
  boston: "BOS", philadelphia: "PHL", washington: "IAD", "washington dc": "IAD",
  atlanta: "ATL", miami: "MIA", orlando: "MCO", chicago: "ORD", detroit: "DTW",
  minneapolis: "MSP", denver: "DEN", "salt lake city": "SLC", phoenix: "PHX",
  "las vegas": "LAS", "los angeles": "LAX", "san francisco": "SFO", "san diego": "SAN",
  seattle: "SEA", portland: "PDX", austin: "AUS", dallas: "DFW", houston: "IAH",
  honolulu: "HNL",
  toronto: "YYZ", vancouver: "YVR", montreal: "YUL", calgary: "YYC", ottawa: "YOW",
  "mexico city": "MEX", cancun: "CUN", guadalajara: "GDL", tulum: "TQO",
  // South America
  "sao paulo": "GRU", "rio de janeiro": "GIG", "buenos aires": "EZE",
  lima: "LIM", bogota: "BOG", cusco: "CUZ", quito: "UIO", montevideo: "MVD",
  // Africa
  cairo: "CAI", marrakesh: "RAK", marrakech: "RAK", casablanca: "CMN",
  "cape town": "CPT", johannesburg: "JNB", nairobi: "NBO", "addis ababa": "ADD",
  "dar es salaam": "DAR", zanzibar: "ZNZ",
  // Oceania
  sydney: "SYD", melbourne: "MEL", brisbane: "BNE", perth: "PER", adelaide: "ADL",
  cairns: "CNS", auckland: "AKL", wellington: "WLG", queenstown: "ZQN",
  christchurch: "CHC", nadi: "NAN",
};

/** Names that mean different airports in different countries — never matched unqualified. */
const CITY_IN_COUNTRY: Record<string, string> = {
  "santiago|chile": "SCL",
  "valencia|spain": "VLC",
  "san jose|costa rica": "SJO",
  "cordoba|argentina": "COR",
  "birmingham|united kingdom": "BHX",
  "birmingham|uk": "BHX",
};

/** Lowercase, strip accents and punctuation, collapse whitespace. */
function norm(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The IATA code for a city, or null when we genuinely don't know one.
 * An explicit three-letter `override` (what the user typed on the leg) always wins.
 */
export function airportCode(city: string, country: string, override?: string | null): string | null {
  const explicit = (override || "").trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(explicit)) return explicit;

  const key = norm(city);
  if (!key) return null;
  return CITY_IN_COUNTRY[`${key}|${norm(country)}`] || CITY[key] || null;
}
