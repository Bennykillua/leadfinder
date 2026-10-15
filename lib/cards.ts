// Find-box intents. Keyword rules stand in for Gemma's intent prompt until step 6.
// Search results come from SerpApi (lib/serpapi.ts); audits from lib/audit.

export type Intent = "search" | "audit";

export type CardData =
  | { intent: "search"; data: { query: string } }
  | { intent: "audit"; data: { kind: "url" | "name"; target: string; key: string } };

// What "/" shows: exactly one row per card type, with one example inside the row.
export const CARD_TYPES: { intent: Intent; label: string; hint: string; example: string }[] = [
  { intent: "search", label: "Search", hint: "Find businesses in an area", example: "event centres in Lekki" },
  { intent: "audit", label: "Audit", hint: "Check one website or business", example: "smiledental.ng" },
];

const URL_RE = /\b(https?:\/\/|www\.)\S+|\b[\w-]+\.(com\.ng|com|ng|org|net|co|io)\b/i;
const AUDIT_RE = /^\s*(audit|check|review)\b/i;
const SEARCH_RE = /\b(in|around|near|for)\s+\w+|\bwithout\b/i;
// Plural business types read as a search ("salons Yaba"); singular names read as one business.
const PLURAL_RE =
  /\b(salons|clinics|dentists|restaurants|centres|centers|venues|shops|stores|hotels|gyms|spas|bakeries|pharmacies|schools|boutiques|studios|lounges|bars|businesses|agencies)\b/i;

export function classify(text: string): Intent | null {
  const t = text.trim();
  if (t.length < 3 || t.startsWith("/")) return null;
  if (AUDIT_RE.test(t) || URL_RE.test(t)) return "audit";
  if (SEARCH_RE.test(t) || PLURAL_RE.test(t)) return "search";
  return t.split(/\s+/).length <= 4 ? "audit" : "search";
}

function clean(text: string) {
  return text.trim().replace(/\s+/g, " ");
}

// What a card works on. Nothing here calls SerpApi or crawls: that only happens when
// the user presses Enter (see Composer), because a search or name lookup costs a credit.
export function cardFor(intent: Intent, text: string): CardData {
  if (intent === "search") return { intent, data: { query: clean(text) } };
  const url = text.match(URL_RE)?.[0];
  if (url) return { intent, data: { kind: "url", target: url, key: clean(text) } };
  return { intent, data: { kind: "name", target: clean(text.replace(AUDIT_RE, "")), key: clean(text) } };
}

// The submitted-text key a card answers to, so Enter on the same text runs it.
export function cardKey(card: CardData) {
  return card.intent === "search" ? card.data.query : card.data.key;
}
