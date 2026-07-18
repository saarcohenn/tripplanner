import type { Leg } from "./types";

/** Currencies the app always offers first. */
export const BASE_CURRENCIES = ["ILS", "USD", "EUR"];

export const ALL_CURRENCIES: { code: string; name: string }[] = [
  { code: "USD", name: "US Dollar" }, { code: "EUR", name: "Euro" }, { code: "ILS", name: "Israeli Shekel" },
  { code: "JPY", name: "Japanese Yen" }, { code: "KRW", name: "South Korean Won" }, { code: "GBP", name: "British Pound" },
  { code: "CHF", name: "Swiss Franc" }, { code: "AUD", name: "Australian Dollar" }, { code: "CAD", name: "Canadian Dollar" },
  { code: "NZD", name: "New Zealand Dollar" }, { code: "CNY", name: "Chinese Yuan" }, { code: "HKD", name: "Hong Kong Dollar" },
  { code: "TWD", name: "Taiwan Dollar" }, { code: "SGD", name: "Singapore Dollar" }, { code: "THB", name: "Thai Baht" },
  { code: "VND", name: "Vietnamese Dong" }, { code: "MYR", name: "Malaysian Ringgit" }, { code: "IDR", name: "Indonesian Rupiah" },
  { code: "PHP", name: "Philippine Peso" }, { code: "INR", name: "Indian Rupee" }, { code: "NPR", name: "Nepalese Rupee" },
  { code: "LKR", name: "Sri Lankan Rupee" }, { code: "KHR", name: "Cambodian Riel" }, { code: "LAK", name: "Lao Kip" },
  { code: "MMK", name: "Myanmar Kyat" }, { code: "BDT", name: "Bangladeshi Taka" }, { code: "PKR", name: "Pakistani Rupee" },
  { code: "NOK", name: "Norwegian Krone" }, { code: "SEK", name: "Swedish Krona" }, { code: "DKK", name: "Danish Krone" },
  { code: "ISK", name: "Icelandic Krona" }, { code: "PLN", name: "Polish Zloty" }, { code: "CZK", name: "Czech Koruna" },
  { code: "HUF", name: "Hungarian Forint" }, { code: "RON", name: "Romanian Leu" }, { code: "BGN", name: "Bulgarian Lev" },
  { code: "RSD", name: "Serbian Dinar" }, { code: "TRY", name: "Turkish Lira" }, { code: "GEL", name: "Georgian Lari" },
  { code: "AMD", name: "Armenian Dram" }, { code: "AZN", name: "Azerbaijani Manat" }, { code: "UAH", name: "Ukrainian Hryvnia" },
  { code: "EGP", name: "Egyptian Pound" }, { code: "MAD", name: "Moroccan Dirham" }, { code: "TND", name: "Tunisian Dinar" },
  { code: "JOD", name: "Jordanian Dinar" }, { code: "AED", name: "UAE Dirham" }, { code: "SAR", name: "Saudi Riyal" },
  { code: "QAR", name: "Qatari Riyal" }, { code: "KWD", name: "Kuwaiti Dinar" }, { code: "BHD", name: "Bahraini Dinar" },
  { code: "OMR", name: "Omani Rial" }, { code: "ZAR", name: "South African Rand" }, { code: "KES", name: "Kenyan Shilling" },
  { code: "TZS", name: "Tanzanian Shilling" }, { code: "MXN", name: "Mexican Peso" }, { code: "BRL", name: "Brazilian Real" },
  { code: "ARS", name: "Argentine Peso" }, { code: "CLP", name: "Chilean Peso" }, { code: "PEN", name: "Peruvian Sol" },
  { code: "COP", name: "Colombian Peso" }, { code: "UYU", name: "Uruguayan Peso" }, { code: "BOB", name: "Bolivian Boliviano" },
  { code: "CRC", name: "Costa Rican Colon" }, { code: "GTQ", name: "Guatemalan Quetzal" }, { code: "DOP", name: "Dominican Peso" },
];

const EURO_COUNTRIES = [
  "france", "germany", "italy", "spain", "portugal", "netherlands", "belgium", "austria", "greece",
  "ireland", "finland", "slovakia", "slovenia", "estonia", "latvia", "lithuania", "luxembourg",
  "malta", "cyprus", "croatia",
];

const COUNTRY_CURRENCY: Record<string, string> = {
  japan: "JPY", "south korea": "KRW", korea: "KRW", israel: "ILS",
  "united states": "USD", usa: "USD", "united kingdom": "GBP", uk: "GBP", england: "GBP", scotland: "GBP",
  switzerland: "CHF", australia: "AUD", canada: "CAD", "new zealand": "NZD",
  china: "CNY", "hong kong": "HKD", taiwan: "TWD", singapore: "SGD", thailand: "THB", vietnam: "VND",
  malaysia: "MYR", indonesia: "IDR", philippines: "PHP", india: "INR", nepal: "NPR", "sri lanka": "LKR",
  cambodia: "KHR", laos: "LAK", myanmar: "MMK", bangladesh: "BDT", pakistan: "PKR",
  norway: "NOK", sweden: "SEK", denmark: "DKK", iceland: "ISK", poland: "PLN",
  "czech republic": "CZK", czechia: "CZK", hungary: "HUF", romania: "RON", bulgaria: "BGN", serbia: "RSD",
  turkey: "TRY", georgia: "GEL", armenia: "AMD", azerbaijan: "AZN", ukraine: "UAH",
  egypt: "EGP", morocco: "MAD", tunisia: "TND", jordan: "JOD",
  "united arab emirates": "AED", uae: "AED", "saudi arabia": "SAR", qatar: "QAR", kuwait: "KWD",
  bahrain: "BHD", oman: "OMR", "south africa": "ZAR", kenya: "KES", tanzania: "TZS",
  mexico: "MXN", brazil: "BRL", argentina: "ARS", chile: "CLP", peru: "PEN", colombia: "COP",
  uruguay: "UYU", bolivia: "BOB", "costa rica": "CRC", guatemala: "GTQ", "dominican republic": "DOP",
  ...Object.fromEntries(EURO_COUNTRIES.map((c) => [c, "EUR"])),
};

/** ILS/USD/EUR plus the local currency of every country in the trip's legs. */
export function suggestedCurrencies(legs: Leg[]): string[] {
  const out = [...BASE_CURRENCIES];
  for (const l of legs) {
    const code = COUNTRY_CURRENCY[(l.country || "").trim().toLowerCase()];
    if (code && !out.includes(code)) out.push(code);
  }
  return out;
}

export function fmtMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${amount.toFixed(0)} ${currency}`;
  }
}
