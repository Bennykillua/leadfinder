// Lead types and fake data for build step 2 (no AI, no API calls, no database).
// SerpApi fills Business in step 4, the audit fills evidence in step 5.

export type WhatsAppLabel = "confirmed" | "likely" | "call";

export type Evidence = { label: string; ok: boolean; detail: string };

export type Business = {
  id: string;
  name: string;
  category: string;
  area: string;
  phone: string;
  whatsapp: WhatsAppLabel;
  rating: number;
  reviews: number;
  website: string | null;
  // Business email published on its own website (mailto: or contact page). Never guessed.
  email: string | null;
  score: number;
  topReason: string;
  evidence: Evidence[];
};

export type Column = "saved" | "pitched" | "replied" | "won" | "lost";

export const COLUMNS: { id: Column; label: string }[] = [
  { id: "saved", label: "Saved" },
  { id: "pitched", label: "Pitched" },
  { id: "replied", label: "Replied" },
  { id: "won", label: "Won" },
  { id: "lost", label: "Lost" },
];

export type Reminder = { at: string; note: string };

export type Lead = Business & {
  status: Column;
  pitch: string;
  notes: string;
  reminder: Reminder | null;
};

export function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

type Raw = Omit<Business, "id" | "evidence" | "email"> & {
  email?: string;
  checks?: Partial<Record<string, string>>;
};

// Failed checks per business; anything not listed passes.
function evidenceFor(b: Raw): Evidence[] {
  const fail = b.checks ?? {};
  const row = (label: string, okDetail: string): Evidence =>
    fail[label] ? { label, ok: false, detail: fail[label]! } : { label, ok: true, detail: okDetail };
  if (!b.website) {
    return [
      { label: "Website", ok: false, detail: "No website listed on Maps" },
      row("Contact path", "Phone number on Maps"),
      { label: "Maps presence", ok: b.reviews >= 25 && b.rating >= 4, detail: `${b.rating.toFixed(1)}★ from ${b.reviews} reviews` },
    ];
  }
  return [
    row("Website", "Site loads (200 OK)"),
    row("HTTPS", "Served over https://"),
    row("Mobile-friendly", "Has a viewport meta tag"),
    row("Speed", "First load in 1.4s"),
    row("Fresh content", "Footer says © 2026"),
    row("Contact path", "wa.me link in header"),
    row("Video", "Embedded video on home page"),
    { label: "Maps presence", ok: b.reviews >= 25 && b.rating >= 4, detail: `${b.rating.toFixed(1)}★ from ${b.reviews} reviews` },
  ];
}

const RAW: Raw[] = [
  { name: "Smile Dental Clinic", category: "Dentist", area: "Admiralty Way, Lekki Phase 1", phone: "0803 412 7781", whatsapp: "confirmed", rating: 4.6, reviews: 38, website: "smiledental.ng", score: 5, topReason: "No video, and the site breaks on phones", checks: { "Mobile-friendly": "No viewport meta tag", Video: "No video on the page", HTTPS: "Served over plain http://" } },
  { name: "Pearl White Dental", category: "Dental clinic", area: "Chevron Drive, Lekki", phone: "0909 221 4410", whatsapp: "likely", rating: 4.2, reviews: 112, website: "pearlwhitedental.com", email: "bookings@pearlwhitedental.com", score: 4, topReason: "Site takes 5.9s to load on first visit", checks: { Speed: "First load took 5.9s", Video: "No video on the page" } },
  { name: "Lekki Family Dentistry", category: "Dentist", area: "Ikate, Lekki", phone: "01 342 8890", whatsapp: "call", rating: 3.9, reviews: 17, website: "lekkifamilydentistry.com", email: "info@lekkifamilydentistry.com", score: 4, topReason: "Footer says © 2019 and there's no booking path", checks: { "Fresh content": "Footer says © 2019", "Contact path": "Only an email address; no phone link, WhatsApp or form" } },
  { name: "Royal Halls Event Centre", category: "Event venue", area: "Oniru, Victoria Island", phone: "0812 550 0193", whatsapp: "likely", rating: 4.4, reviews: 203, website: null, score: 5, topReason: "No website; 203 reviews but nowhere to see the hall" },
  { name: "The Grand Pavilion", category: "Event venue", area: "Lekki-Epe Expressway", phone: "0706 118 3302", whatsapp: "confirmed", rating: 4.1, reviews: 89, website: "grandpavilionlekki.com", score: 4, topReason: "Wedding venue with no video tour on the site", checks: { Video: "No video on the page" } },
  { name: "Glow Beauty Lounge", category: "Beauty salon", area: "Herbert Macaulay Way, Yaba", phone: "0814 903 2276", whatsapp: "likely", rating: 4.7, reviews: 64, website: null, score: 4, topReason: "No website; bookings only by phone" },
  { name: "Mama Cass Kitchen", category: "Restaurant", area: "Allen Avenue, Ikeja", phone: "0802 667 1180", whatsapp: "likely", rating: 3.8, reviews: 412, website: "mamacass.ng", score: 3, topReason: "Menu page is a 2021 PDF", checks: { "Fresh content": "Menu PDF dated 2021", "Mobile-friendly": "No viewport meta tag" } },
  { name: "FitHub Lekki", category: "Gym", area: "Admiralty Way, Lekki", phone: "0905 774 0021", whatsapp: "confirmed", rating: 4.5, reviews: 151, website: "fithublekki.com", score: 2, topReason: "Only weak spot: no video of the space", checks: { Video: "No video on the page" } },
  { name: "Bloom Florals", category: "Florist", area: "Awolowo Road, Ikoyi", phone: "0703 228 4419", whatsapp: "likely", rating: 4.9, reviews: 22, website: null, score: 4, topReason: "No website and under 25 reviews" },
  { name: "Ikoyi Physio Centre", category: "Physiotherapist", area: "Kingsway Road, Ikoyi", phone: "01 463 2290", whatsapp: "call", rating: 4.0, reviews: 9, website: "ikoyiphysio.com", score: 3, topReason: "Site is down (502 error)", checks: { Website: "502 Bad Gateway" } },
  { name: "Snap & Frame Studios", category: "Photo studio", area: "Sabo, Yaba", phone: "0816 330 7712", whatsapp: "confirmed", rating: 4.3, reviews: 47, website: "snapandframe.com", score: 3, topReason: "No HTTPS; browsers flag it as not secure", checks: { HTTPS: "Served over plain http://" } },
  { name: "Chops & Grills", category: "Restaurant", area: "Opebi, Ikeja", phone: "0908 112 6643", whatsapp: "likely", rating: 4.1, reviews: 233, website: "chopsandgrills.ng", score: 3, topReason: "Takes 6.4s to load on mobile data", checks: { Speed: "First load took 6.4s" } },
  { name: "Kemi's Bridal House", category: "Bridal shop", area: "Surulere", phone: "0809 441 9087", whatsapp: "likely", rating: 4.6, reviews: 31, website: null, score: 5, topReason: "No website; dresses only on Instagram" },
  { name: "Harbour View Suites", category: "Hotel", area: "Ozumba Mbadiwe, Victoria Island", phone: "0701 556 2234", whatsapp: "confirmed", rating: 3.6, reviews: 58, website: "harbourviewsuites.com", score: 4, topReason: "3.6★ rating and a 2020 copyright", checks: { "Fresh content": "Footer says © 2020" } },
];

export const BUSINESSES: Business[] = RAW.map(({ checks, email, ...b }) => ({
  ...b,
  email: email ?? null,
  id: slug(b.name),
  evidence: evidenceFor({ ...b, checks }),
}));

// --- Contact: WhatsApp confirmed → likely WhatsApp → email from website → call only ---

const NG_MOBILE = /^234[789][01]\d{8}$/;

// "0803 412 7781" / "+234 803…" → "2348034127781".
export function normalisePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("234")) return digits;
  if (digits.startsWith("0")) return `234${digits.slice(1)}`;
  return digits;
}

export function whatsappNumber(b: Business): string | null {
  if (b.whatsapp === "call") return null;
  const n = normalisePhone(b.phone);
  if (b.whatsapp === "confirmed") return n;
  return NG_MOBILE.test(n) ? n : null;
}

export type ContactKind = "confirmed" | "likely" | "email" | "call";

export function contactKind(b: Business): ContactKind {
  const wa = whatsappNumber(b);
  if (wa && b.whatsapp === "confirmed") return "confirmed";
  if (wa) return "likely";
  return b.email ? "email" : "call";
}

export function whatsappLink(number: string, pitch: string) {
  const text = pitch.trim();
  return text ? `https://wa.me/${number}?text=${encodeURIComponent(text)}` : `https://wa.me/${number}`;
}

export function mailtoLink(b: Business, pitch: string) {
  const subject = encodeURIComponent(`Quick idea for ${b.name}`);
  return `mailto:${b.email}?subject=${subject}&body=${encodeURIComponent(pitch.trim())}`;
}

export function telLink(b: Business) {
  return `tel:+${normalisePhone(b.phone)}`;
}

const byId = (id: string) => BUSINESSES.find((b) => b.id === id)!;

// Fake search: same 14 businesses for every query, until SerpApi in step 4.
export function fakeSearch(): Business[] {
  return BUSINESSES;
}

// Fake audit: a URL or name maps to Smile Dental's evidence, renamed to what you typed.
export function fakeAudit(name: string | null, url: string | null): Business {
  const base = byId("smile-dental-clinic");
  if (!name) {
    const site = url?.replace(/^(https?:\/\/)?(www\.)?/i, "").replace(/\/.*$/, "") ?? "";
    const known = BUSINESSES.find((b) => b.website === site);
    if (known || !site) return known ?? base;
    return { ...base, id: slug(site), name: site, website: site };
  }
  const known = BUSINESSES.find((b) => b.name.toLowerCase().startsWith(name.toLowerCase()));
  if (known) return known;
  return { ...base, id: slug(name), name, website: url ?? base.website };
}

// Template draft until Gemma writes pitches in step 6.
export function fakePitch(lead: Business): string {
  return `Hi! I found ${lead.name} on Google Maps. ${lead.rating.toFixed(1)}★ from ${lead.reviews} reviews, nice work. One thing I noticed: ${lead.topReason.charAt(0).toLowerCase()}${lead.topReason.slice(1)}. I edit short videos for local businesses and could fix that this week. Want a free 20-second sample?`;
}

export function newLead(b: Business, status: Column = "saved"): Lead {
  return { ...b, status, pitch: "", notes: "", reminder: null };
}

function daysFromNow(days: number, hour = 10) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

export function seedLeads(): Lead[] {
  const lead = (id: string, status: Column, extra: Partial<Lead> = {}) => ({
    ...newLead(byId(id), status),
    ...extra,
  });
  return [
    lead("royal-halls-event-centre", "saved"),
    lead("kemi-s-bridal-house", "saved", { notes: "Posts new dresses every Friday on IG." }),
    // Email fallback: landline only, but the site publishes info@.
    lead("lekki-family-dentistry", "saved", { pitch: fakePitch(byId("lekki-family-dentistry")) }),
    // Nothing to message: landline, no email on the site.
    lead("ikoyi-physio-centre", "saved"),
    lead("pearl-white-dental", "pitched", {
      pitch: fakePitch(byId("pearl-white-dental")),
      reminder: { at: daysFromNow(0), note: "Follow up if no reply" },
    }),
    lead("the-grand-pavilion", "pitched", { pitch: fakePitch(byId("the-grand-pavilion")) }),
    lead("glow-beauty-lounge", "replied", {
      notes: "Spoke to the manager, call back after the 20th.",
      reminder: { at: daysFromNow(3, 15), note: "Call the manager" },
    }),
    lead("fithub-lekki", "won", { notes: "₦150k for 4 reels. Deposit paid." }),
    lead("mama-cass-kitchen", "lost", { notes: "Said they already have someone." }),
  ];
}
