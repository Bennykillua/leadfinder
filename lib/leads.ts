// Lead types and contact helpers. Leads are stored per user in SQLite (lib/db);
// businesses come from SerpApi (lib/serpapi.ts) and are audited by lib/audit.

export type WhatsAppLabel = "confirmed" | "likely" | "call";

// ok: true = passed, false = a weak spot, null = couldn't check (e.g. robots.txt says no).
export type Evidence = { label: string; ok: boolean | null; detail: string };

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
  // WhatsApp number linked from the business's own site (wa.me / api.whatsapp.com), as 234….
  whatsappPhone: string | null;
  // 1–5 once audited (step 5); null for fresh search results.
  score: number | null;
  auditedAt: string | null;
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

// --- Contact: WhatsApp confirmed → likely WhatsApp → email from website → call only ---

export const NG_MOBILE = /^234[789][01]\d{8}$/;

// "0803 412 7781" / "+234 803…" → "2348034127781".
export function normalisePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("234")) return digits;
  if (digits.startsWith("0")) return `234${digits.slice(1)}`;
  return digits;
}

export function whatsappNumber(b: Business): string | null {
  if (b.whatsappPhone) return b.whatsappPhone;
  if (b.whatsapp === "call") return null;
  const n = normalisePhone(b.phone);
  if (b.whatsapp === "confirmed") return n;
  return NG_MOBILE.test(n) ? n : null;
}

export type ContactKind = "confirmed" | "likely" | "email" | "call" | "none";

export function contactKind(b: Business): ContactKind {
  const wa = whatsappNumber(b);
  if (wa && b.whatsapp === "confirmed") return "confirmed";
  if (wa) return "likely";
  if (b.email) return "email";
  return b.phone ? "call" : "none";
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

export function newLead(b: Business, status: Column = "saved"): Lead {
  return { ...b, status, pitch: "", notes: "", reminder: null };
}
