import "server-only";
import type { Offer } from "@/lib/db/schema";
import type { Business } from "@/lib/leads";
import { countryFromHost, likelyWhatsApp, phoneInfo, whatsappIntl } from "@/lib/phone";
import { searchGoogleMaps } from "@/lib/serpapi";
import { provisionalScore, runChecks, socialPage, toEvidence } from "./checks";
import { crawlSite, normaliseWebsite, type CrawlFacts } from "./crawl";

// The fields an audit fills in on a business (and on a saved lead).
export type AuditFields = Pick<
  Business,
  "score" | "topReason" | "evidence" | "whatsapp" | "whatsappPhone" | "email" | "phone" | "phoneIntl" | "country" | "auditedAt"
>;

// Businesses audited from a typed URL (no Maps listing) get ids like "site:example.ng".
export const SITE_ID_PREFIX = "site:";

export async function auditBusiness(
  b: Business,
  offer: Offer,
  opts: { force?: boolean } = {},
): Promise<{ business: Business; facts: CrawlFacts | null }> {
  const fromMaps = !b.id.startsWith(SITE_ID_PREFIX);
  // Social pages (Facebook, Instagram…) aren't crawled: see socialPage().
  const website = b.website && !socialPage(b.website) ? normaliseWebsite(b.website) : null;
  const facts = website ? await crawlSite(website, { force: opts.force }) : null;

  // Country: from the search/Maps result if known, else the site's domain (.ng, .co.uk).
  const country = (b.country as Parameters<typeof phoneInfo>[1]) ?? countryFromHost(facts?.finalUrl ?? website);
  // A number the site itself links to wa.me is the best contact there is.
  const phone = b.phone || facts?.sitePhone || "";
  const info = phoneInfo(phone, country);
  const whatsappPhone = facts?.whatsappPhone ? whatsappIntl(facts.whatsappPhone, info.country) : null;
  const whatsapp: Business["whatsapp"] = whatsappPhone ? "confirmed" : likelyWhatsApp(info) ? "likely" : "call";

  const withContact: Business = {
    ...b,
    phone,
    phoneIntl: info.intl,
    country: info.country,
    whatsapp,
    whatsappPhone,
    email: facts?.email ?? null,
  };
  const checks = runChecks(withContact, facts, offer, fromMaps);
  const { score, topReason } = provisionalScore(checks, offer);
  const host = facts?.finalUrl ? new URL(facts.finalUrl).hostname.replace(/^www\./, "") : null;

  return {
    business: {
      ...withContact,
      score,
      topReason,
      evidence: toEvidence(checks, host),
      auditedAt: new Date().toISOString(),
    },
    facts,
  };
}

export function auditFields(b: Business): AuditFields {
  const { score, topReason, evidence, whatsapp, whatsappPhone, email, phone, phoneIntl, country, auditedAt } = b;
  return { score, topReason, evidence, whatsapp, whatsappPhone, email, phone, phoneIntl, country, auditedAt };
}

function blankBusiness(id: string, name: string, website: string | null): Business {
  return {
    id,
    name,
    category: "",
    area: "",
    phone: "",
    whatsapp: "call",
    rating: 0,
    reviews: 0,
    website,
    email: null,
    whatsappPhone: null,
    country: null,
    phoneIntl: null,
    score: null,
    topReason: "",
    evidence: [],
    auditedAt: null,
  };
}

// Audit card, URL typed: no SerpApi call, just the website.
export async function auditWebsite(
  raw: string,
  offer: Offer,
): Promise<{ business: Business; facts: CrawlFacts | null }> {
  const typedScheme = /^https?:\/\//i.test(raw.trim());
  let website = normaliseWebsite(raw);
  if (!website) throw new Error("That doesn't look like a website address.");
  const host = new URL(website).hostname.replace(/^www\./, "");
  let result = await auditBusiness(blankBusiness(`${SITE_ID_PREFIX}${host}`, host, website), offer);
  // Typed without http(s)://: we tried https first. If it can't connect at all, the site
  // may only speak plain http, so try that once before calling it down.
  const kind = result.facts?.errorKind;
  if (!typedScheme && (kind === "network" || kind === "tls" || kind === "timeout")) {
    website = website.replace(/^https:/, "http:");
    const retry = await auditBusiness(blankBusiness(`${SITE_ID_PREFIX}${host}`, host, website), offer);
    if (!retry.facts?.error) result = retry;
  }
  const name = result.facts?.siteName?.slice(0, 120) || host;
  return { business: { ...result.business, name }, facts: result.facts };
}

// Audit card, business name typed: one SerpApi lookup (counted, cached), then audit
// the top match.
export async function auditByName(name: string, offer: Offer, userId: string): Promise<Business | null> {
  const found = await searchGoogleMaps(name, userId);
  const top = found.results[0];
  if (!top) return null;
  return (await auditBusiness(top, offer)).business;
}
