import "server-only";
import { iso1A2Code } from "@rapideditor/country-coder";
import { getCountries, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";

// Country detection and phone numbers for any country (not just Nigeria).
// Country, best first: a country named in the search, a number already in +
// international format, then the result's map coordinates.

const COUNTRIES = getCountries();

// Country names (English) → ISO code, plus common short forms.
const NAME_TO_CODE: Map<string, CountryCode> = (() => {
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  const map = new Map<string, CountryCode>();
  for (const code of COUNTRIES) {
    const name = names.of(code);
    if (name && name !== code) map.set(name.toLowerCase(), code);
  }
  const aliases: Record<string, CountryCode> = {
    uk: "GB", "united kingdom": "GB", england: "GB", scotland: "GB", wales: "GB", britain: "GB",
    usa: "US", "u.s.": "US", "united states of america": "US", america: "US",
    uae: "AE", "south korea": "KR", "ivory coast": "CI", "côte d'ivoire": "CI", drc: "CD",
  };
  for (const [k, v] of Object.entries(aliases)) map.set(k, v);
  return map;
})();
// Longest names first, so "south africa" wins over "africa"-like partial matches.
const NAMES = [...NAME_TO_CODE.keys()].sort((a, b) => b.length - a.length);

export function countryFromText(text: string | null | undefined): CountryCode | null {
  if (!text) return null;
  const t = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}.' ]/gu, " ")} `;
  const hit = NAMES.find((n) => t.includes(` ${n} `));
  return hit ? NAME_TO_CODE.get(hit)! : null;
}

export function countryFromPoint(lat: number | undefined, lng: number | undefined): CountryCode | null {
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  const code = iso1A2Code([lng, lat]);
  return code && (COUNTRIES as string[]).includes(code) ? (code as CountryCode) : null;
}

// Country-code top-level domain: "smiledental.ng" → NG, "x.co.uk" → GB. Generic
// domains (.com, .org) say nothing.
export function countryFromHost(url: string | null | undefined): CountryCode | null {
  if (!url) return null;
  let host: string;
  try {
    host = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname;
  } catch {
    return null;
  }
  const tld = host.split(".").pop()?.toUpperCase() ?? "";
  const code = tld === "UK" ? "GB" : tld;
  return code.length === 2 && (COUNTRIES as string[]).includes(code) ? (code as CountryCode) : null;
}

export type PhoneKind = "mobile" | "maybe_mobile" | "fixed" | "unknown";
export type PhoneInfo = { intl: string | null; kind: PhoneKind; country: CountryCode | null };

// "0803 397 1669" + NG → { intl: "2348033971669", kind: "mobile" }. Numbers already in
// + format don't need the country. Invalid or unparseable numbers: kind "unknown".
export function phoneInfo(raw: string | null | undefined, country: CountryCode | null): PhoneInfo {
  const text = (raw ?? "").trim();
  if (!text) return { intl: null, kind: "unknown", country };
  const parsed = parsePhoneNumberFromString(text, country ?? undefined);
  if (!parsed || !parsed.isValid()) return { intl: null, kind: "unknown", country };
  const type = parsed.getType();
  const kind: PhoneKind =
    type === "MOBILE" ? "mobile" : type === "FIXED_LINE_OR_MOBILE" ? "maybe_mobile" : type ? "fixed" : "unknown";
  return { intl: parsed.number.replace(/^\+/, ""), kind, country: (parsed.country as CountryCode) ?? country };
}

// Mobile, or a type that can be mobile (US/Canada don't distinguish): likely WhatsApp.
export function likelyWhatsApp(info: PhoneInfo) {
  return info.kind === "mobile" || info.kind === "maybe_mobile";
}

// Digits from a wa.me / api.whatsapp.com link. wa.me numbers are international by
// definition; a local "0…" number is read with the business's country.
export function whatsappIntl(digits: string, country: CountryCode | null): string | null {
  const d = digits.replace(/\D/g, "");
  if (!d) return null;
  const info = phoneInfo(d.startsWith("0") ? d : `+${d}`, country);
  return info.intl;
}
