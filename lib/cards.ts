// Card types and fake JSON for build step 1 (no AI, no API calls).
// The shapes here are what Gemma + code will fill in later steps.

export type Intent = "search" | "audit" | "pitch" | "update" | "remind";

export type Stage = "New" | "Pitched" | "Replied" | "Interested" | "Won" | "Dead";

export type WhatsAppLabel = "confirmed" | "likely" | "call";

export type Lead = {
  name: string;
  category: string;
  area: string;
  rating: number;
  reviews: number;
  phone: string;
  whatsapp: WhatsAppLabel;
  score: number;
  topReason: string;
};

export type SearchData = { query: string; results: Lead[] };

export type Evidence = { label: string; ok: boolean; detail: string };

export type AuditData = {
  business: string;
  url: string | null;
  score: number;
  evidence: Evidence[];
  pitch: string;
};

export type PitchData = {
  business: string;
  phone: string;
  whatsapp: WhatsAppLabel;
  message: string;
};

export type StatusData = { business: string; from: Stage; to: Stage; note: string };

export type ReminderData = { business: string; when: string; note: string };

export type CardData =
  | { intent: "search"; data: SearchData }
  | { intent: "audit"; data: AuditData }
  | { intent: "pitch"; data: PitchData }
  | { intent: "update"; data: StatusData }
  | { intent: "remind"; data: ReminderData };

export const CARD_TYPES: {
  intent: Intent;
  label: string;
  hint: string;
  example: string;
}[] = [
  { intent: "search", label: "Search", hint: "Find businesses in an area", example: "dental clinics in Lekki" },
  { intent: "audit", label: "Audit", hint: "Check a site or business", example: "audit smiledental.ng" },
  { intent: "pitch", label: "Pitch", hint: "Write a WhatsApp message", example: "pitch Smile Dental, shorter, mention weddings" },
  { intent: "update", label: "Status", hint: "Move a lead in the pipeline", example: "Smile Dental replied, interested" },
  { intent: "remind", label: "Reminder", hint: "Set a follow-up", example: "follow up Smile Dental Friday" },
];

// --- Keyword rules (stand-in for Gemma's intent classification) ---

const URL_RE = /\b(https?:\/\/|www\.)\S+|\b[\w-]+\.(com|ng|com\.ng|org|net|co|io)\b/i;
const REMIND_RE = /\b(remind|follow[\s-]?up|tomorrow|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;
const UPDATE_RE = /\b(replied|reply|interested|won|dead|closed|signed|ghosted|no response|not interested|said no|said yes)\b/i;
const PITCH_RE = /^\s*(pitch|write|message|draft|dm)\b|\b(shorter|longer|mention)\b/i;
const AUDIT_RE = /^\s*(audit|check|review)\b/i;
const SEARCH_RE = /\b(in|around|near)\s+\w+|\b\w+(s|es)\b.*\bwithout\b/i;

export function classify(text: string): Intent | null {
  const t = text.trim();
  if (t.length < 3 || t.startsWith("/")) return null;
  if (REMIND_RE.test(t)) return "remind";
  if (UPDATE_RE.test(t)) return "update";
  if (PITCH_RE.test(t)) return "pitch";
  if (AUDIT_RE.test(t) || URL_RE.test(t)) return "audit";
  if (SEARCH_RE.test(t)) return "search";
  // A bare name like "Smile Dental" reads as "audit this business".
  return t.split(/\s+/).length <= 4 ? "audit" : "search";
}

// Pull a business name out of the text so the fake card feels live.
function businessFrom(text: string, fallback = "Smile Dental"): string {
  const cleaned = text
    .replace(/^\s*(pitch|write|message|draft|dm|audit|check|review|remind me to( call| text| message)?|follow[\s-]?up( with)?|remind)\s+/i, "")
    .split(/[,.]|\b(replied|reply|is|said|on|by|next|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|shorter|mention)\b/i)[0]
    .trim();
  if (!cleaned || URL_RE.test(cleaned)) return fallback;
  return cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
}

const STAGE_WORDS: [RegExp, Stage][] = [
  [/\b(not interested|dead|said no|ghosted)\b/i, "Dead"],
  [/\b(won|signed|closed|paid)\b/i, "Won"],
  [/\b(interested|said yes)\b/i, "Interested"],
  [/\b(replied|reply)\b/i, "Replied"],
];

const LEADS: Lead[] = [
  { name: "Smile Dental Clinic", category: "Dentist", area: "Admiralty Way, Lekki Phase 1", rating: 4.6, reviews: 38, phone: "0803 412 7781", whatsapp: "confirmed", score: 5, topReason: "No website listed, only an Instagram link" },
  { name: "Pearl White Dental", category: "Dental clinic", area: "Chevron Drive, Lekki", rating: 4.2, reviews: 112, phone: "0909 221 4410", whatsapp: "likely", score: 4, topReason: "Site has no viewport tag; breaks on phones" },
  { name: "Lekki Family Dentistry", category: "Dentist", area: "Ikate, Lekki", rating: 3.9, reviews: 17, phone: "01 342 8890", whatsapp: "call", score: 4, topReason: "Copyright says 2019; no booking path" },
  { name: "BrightSmile Orthodontics", category: "Orthodontist", area: "Osapa London, Lekki", rating: 4.8, reviews: 204, phone: "0812 550 0193", whatsapp: "likely", score: 3, topReason: "No video on the page despite before/after photos" },
  { name: "DentaCare Lagos", category: "Dental clinic", area: "Agungi, Lekki", rating: 4.4, reviews: 61, phone: "0706 118 3302", whatsapp: "confirmed", score: 2, topReason: "Site loads in 6.8s on first visit" },
];

export function fakeCard(intent: Intent, text: string): CardData {
  switch (intent) {
    case "search":
      return { intent, data: { query: text.trim(), results: LEADS } };
    case "audit": {
      const url = text.match(URL_RE)?.[0] ?? null;
      return {
        intent,
        data: {
          business: url ? "Smile Dental Clinic" : businessFrom(text),
          url: url ?? "smiledental.ng",
          score: 4,
          evidence: [
            { label: "Website", ok: true, detail: "Site loads (200 OK)" },
            { label: "HTTPS", ok: false, detail: "Served over plain http://" },
            { label: "Mobile-friendly", ok: false, detail: "No viewport meta tag" },
            { label: "Speed", ok: false, detail: "First load took 5.2s" },
            { label: "Fresh content", ok: false, detail: "Footer says © 2020" },
            { label: "Contact path", ok: true, detail: "wa.me link in header" },
            { label: "Video", ok: false, detail: "No video on the page" },
            { label: "Maps presence", ok: true, detail: "4.6★ from 38 reviews" },
          ],
          pitch:
            "Hi, I came across Smile Dental on Google Maps. Great reviews! I noticed your site has no video, and it doesn't fit on a phone screen, which is where most patients will see it. I edit short clinic videos (tours, before/after, doctor intros). Can I send you a 20-second sample made from your Instagram photos?",
        },
      };
    }
    case "pitch":
      return {
        intent,
        data: {
          business: businessFrom(text),
          phone: "234803412778",
          whatsapp: "confirmed",
          message:
            "Hi! I saw Smile Dental on Maps. 38 great reviews, but no video anywhere on your site. Wedding season is coming and brides want that smile. I can make you a 30s clinic tour reel this week. Want a free sample?",
        },
      };
    case "update": {
      const to = STAGE_WORDS.find(([re]) => re.test(text))?.[1] ?? "Replied";
      return {
        intent,
        data: { business: businessFrom(text), from: "Pitched", to, note: "Pitched Tue, 14 Oct" },
      };
    }
    case "remind":
      return {
        intent,
        data: {
          business: businessFrom(text),
          when: "Fri, 17 Oct · 10:00",
          note: "Follow up on the clinic tour reel pitch",
        },
      };
  }
}
