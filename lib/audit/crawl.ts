import "server-only";
import * as cheerio from "cheerio";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { crawlCache } from "@/lib/db/schema";
import { fetchPage, FetchProblem, robotsFor, type Page } from "./fetch";

// Crawl one business website: homepage, plus its contact page if it has one.
// Facts only; lib/audit/checks.ts turns them into evidence and a score.

export type CrawlFacts = {
  website: string;
  finalUrl: string | null;
  status: number | null;
  error: string | null;
  errorKind: FetchProblem["kind"] | "http" | null;
  // Why some or all checks were skipped (robots.txt), if they were.
  robotsNote: string | null;
  loadMs: number | null;
  viewport: boolean | null;
  copyrightYear: number | null;
  latestPostDate: string | null;
  contactPaths: string[];
  hasVideo: boolean | null;
  whatsappPhone: string | null;
  // A wa.me link to an obvious template number (e.g. 27000000000): broken button.
  whatsappPlaceholder: string | null;
  email: string | null;
  sitePhone: string | null;
  siteName: string | null;
  contactPage: { url: string; status: number | null } | null;
  crawledAt: string;
};

const CACHE_MS = 24 * 60 * 60 * 1000;
const MAX_CONCURRENT = 4;

// --- Website address helpers ---

export function normaliseWebsite(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (!url.hostname.includes(".")) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function siteKey(website: string) {
  const u = new URL(website);
  return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}`.toLowerCase();
}

function hostOf(url: string) {
  return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
}

// --- Extraction ---

const VIDEO_SRC =
  /youtube\.com\/embed|youtube-nocookie\.com|youtu\.be\/|player\.vimeo\.com|vimeo\.com\/video|tiktok\.com\/embed|instagram\.com\/(p|reel)\/[^/]+\/embed|facebook\.com\/plugins\/video|fast\.wistia|loom\.com\/embed/i;
const BOOKING_HREF =
  /calendly\.com|fresha\.com|booksy\.com|setmore\.com|simplybook|acuityscheduling|squareup\.com\/appointments|square\.site|opentable|zocdoc|appointy|picktime|youcanbook\.me|tidycal/i;
const BOOKING_TEXT = /\b(book (now|online|an? appointment|a table|a session)|make a (booking|reservation)|reserve( a table| now)?|schedule (a|an) (call|appointment|visit)|appointment)\b/i;
const ROLE_LOCAL =
  /^(info|hello|hi|contact|contactus|bookings?|enquir(y|ies)|inquir(y|ies)|sales|admin|support|office|reservations?|care|customercare|customerservice|service|mail|team|studio|events?|orders?|help)$/i;
const JUNK_EMAIL_DOMAIN = /(^|\.)(example\.(com|org|net)|domain\.com|email\.com|yourdomain\.com|sentry\.io|wixpress\.com|sentry-next\.wixpress\.com|godaddy\.com)$/i;
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

function cleanEmail(raw: string): string | null {
  let e = raw.trim().toLowerCase();
  try {
    e = decodeURIComponent(e);
  } catch {
    // keep as is
  }
  e = e.replace(/^mailto:/, "").split("?")[0].trim();
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(e)) return null;
  const domain = e.split("@")[1];
  if (JUNK_EMAIL_DOMAIN.test(domain)) return null;
  if (/\.(png|jpe?g|gif|svg|webp|avif)$/.test(e)) return null;
  return e;
}

// Theme demo numbers like 27000000000 or 1234567890 are not anyone's WhatsApp.
export function isPlaceholderNumber(n: string) {
  return /(\d)\1{5,}/.test(n) || /0123456789|1234567890/.test(n);
}

// wa.me/2348031234567, api.whatsapp.com/send?phone=…, whatsapp://send?phone=…
export function whatsappFromHref(href: string): string | null {
  let digits: string | undefined;
  const wa = href.match(/wa\.me\/\+?(\d[\d\s-]{6,})/i);
  if (wa) digits = wa[1];
  else if (/whatsapp\.com\/send|whatsapp:\/\/send/i.test(href)) {
    digits = href.match(/[?&]phone=\+?([\d\s%-]+)/i)?.[1];
  }
  if (!digits) return null;
  const n = decodeURIComponent(digits).replace(/\D/g, "");
  const normalised = n.startsWith("0") && n.length === 11 ? `234${n.slice(1)}` : n;
  return normalised.length >= 10 && normalised.length <= 15 ? normalised : null;
}

type PageFacts = {
  viewport: boolean;
  copyrightYear: number | null;
  postDates: number[];
  contactPaths: Set<string>;
  hasVideo: boolean;
  whatsappPhone: string | null;
  whatsappPlaceholder: string | null;
  mailtoEmails: string[];
  textEmails: string[];
  telPhone: string | null;
  siteName: string | null;
  contactLink: string | null;
};

function extract(page: Page): PageFacts {
  const $ = cheerio.load(page.html);
  const base = page.finalUrl;
  const thisYear = new Date().getFullYear();

  const viewport = $('meta[name="viewport" i]')
    .toArray()
    .some((m) => /width\s*=\s*device-width/i.test($(m).attr("content") ?? ""));

  // Visible text without scripts and styles, for the copyright and email scans.
  $("script:not([type='application/ld+json']), style, noscript, template").remove();
  // Space between elements so "Message" + "sales@x.ng" in adjacent tags don't fuse.
  const text = cheerio
    .load(($("body").html() ?? "").replace(/></g, "> <"))
    .root()
    .text()
    .replace(/\s+/g, " ");

  let copyrightYear: number | null = null;
  for (const m of text.matchAll(/(?:©|\(c\)|copyright)[^0-9]{0,40}((?:19|20)\d{2})(?:\s*[-–—]\s*((?:19|20)\d{2}))?/gi)) {
    for (const y of [m[1], m[2]]) {
      const year = Number(y);
      if (year && year <= thisYear + 1 && (!copyrightYear || year > copyrightYear)) copyrightYear = year;
    }
  }

  const postDates: number[] = [];
  const addDate = (v: string | undefined) => {
    const t = v ? Date.parse(v) : NaN;
    if (!Number.isNaN(t) && t <= Date.now() + 86_400_000 && t > Date.parse("2000-01-01")) postDates.push(t);
  };
  $("time[datetime]").each((_, el) => addDate($(el).attr("datetime")));
  $('meta[property="article:published_time"], meta[property="article:modified_time"]').each((_, el) =>
    addDate($(el).attr("content")),
  );
  $('script[type="application/ld+json"]').each((_, el) => {
    for (const m of ($(el).text() ?? "").matchAll(/"date(?:Published|Modified)"\s*:\s*"([^"]+)"/g)) addDate(m[1]);
  });

  const contactPaths = new Set<string>();
  let whatsappPhone: string | null = null;
  let whatsappPlaceholder: string | null = null;
  let telPhone: string | null = null;
  const mailtoEmails: string[] = [];
  let contactLink: string | null = null;

  $("a[href]").each((_, el) => {
    const href = ($(el).attr("href") ?? "").trim();
    const label = $(el).text().trim();
    if (/^tel:/i.test(href)) {
      contactPaths.add("phone link");
      telPhone ??= decodeURIComponent(href.slice(4)).trim() || null;
    } else if (/^mailto:/i.test(href)) {
      contactPaths.add("email link");
      const e = cleanEmail(href);
      if (e) mailtoEmails.push(e);
    } else if (/wa\.me|whatsapp\.com\/send|whatsapp:\/\/send/i.test(href)) {
      contactPaths.add("WhatsApp link");
      const n = whatsappFromHref(href);
      if (n && isPlaceholderNumber(n)) whatsappPlaceholder ??= n;
      else if (n) whatsappPhone ??= n;
    } else if (BOOKING_HREF.test(href) || BOOKING_TEXT.test(label)) {
      contactPaths.add("booking link");
    }
    if (!contactLink && (/contact/i.test(href) || /^contact( us)?$/i.test(label))) {
      try {
        const u = new URL(href, base);
        if (u.origin === new URL(base).origin && u.pathname !== new URL(base).pathname) {
          u.hash = "";
          contactLink = u.toString();
        }
      } catch {
        // ignore bad hrefs
      }
    }
  });

  const hasForm = $("form")
    .toArray()
    .some((f) => {
      const form = $(f);
      if (form.is('[role="search"]') || /search/i.test(form.attr("action") ?? "")) return false;
      if (form.find('input[type="search"]').length > 0) return false;
      return form.find('textarea, input[type="email"], input[type="tel"], input[type="text"]').length > 0;
    });
  if (hasForm) contactPaths.add("contact form");

  const hasVideo =
    $("video").length > 0 ||
    $("iframe[src], iframe[data-src], embed[src]")
      .toArray()
      .some((el) => VIDEO_SRC.test($(el).attr("src") ?? $(el).attr("data-src") ?? ""));

  const textEmails = [...new Set((text.match(EMAIL_RE) ?? []).map(cleanEmail).filter((e): e is string => !!e))];

  const siteName =
    $('meta[property="og:site_name"]').attr("content")?.trim() ||
    $("title").first().text().split(/\s[|–—-]\s/)[0]?.trim() ||
    null;

  return {
    viewport,
    copyrightYear,
    postDates,
    contactPaths,
    hasVideo,
    whatsappPhone,
    whatsappPlaceholder,
    mailtoEmails,
    textEmails,
    telPhone,
    siteName,
    contactLink,
  };
}

// Business email only: mailto links first; text addresses only if they look like a
// business inbox (info@, hello@, bookings@…) or are on the site's own domain.
function pickEmail(site: string, pages: PageFacts[]): string | null {
  const host = hostOf(site);
  const sameDomain = (e: string) => {
    const d = e.split("@")[1];
    return d === host || host.endsWith(`.${d}`) || d.endsWith(`.${host}`);
  };
  const role = (e: string) => ROLE_LOCAL.test(e.split("@")[0]);
  const mailto = pages.flatMap((p) => p.mailtoEmails);
  const text = pages.flatMap((p) => p.textEmails).filter((e) => role(e) || sameDomain(e));
  const rank = (e: string) => (role(e) ? 0 : 1) + (sameDomain(e) ? 0 : 1);
  const best = (list: string[]) => [...list].sort((a, b) => rank(a) - rank(b))[0] ?? null;
  return best(mailto) ?? best(text);
}

// --- Crawl ---

let running = 0;
const waiting: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

const inFlight = new Map<string, Promise<CrawlFacts>>();

export async function crawlSite(website: string, opts: { force?: boolean } = {}): Promise<CrawlFacts> {
  const key = siteKey(website);
  if (!opts.force) {
    const cached = await db.query.crawlCache.findFirst({ where: eq(crawlCache.siteKey, key) });
    if (cached && Date.now() - cached.crawledAt.getTime() < CACHE_MS) return cached.facts as CrawlFacts;
  }
  const pending = inFlight.get(key);
  if (pending) return pending;
  const p = slot(() => crawl(website))
    .then(async (facts) => {
      const crawledAt = new Date(facts.crawledAt);
      await db
        .insert(crawlCache)
        .values({ siteKey: key, facts, crawledAt })
        .onConflictDoUpdate({ target: crawlCache.siteKey, set: { facts, crawledAt } });
      return facts;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

function emptyFacts(website: string): CrawlFacts {
  return {
    website,
    finalUrl: null,
    status: null,
    error: null,
    errorKind: null,
    robotsNote: null,
    loadMs: null,
    viewport: null,
    copyrightYear: null,
    latestPostDate: null,
    contactPaths: [],
    hasVideo: null,
    whatsappPhone: null,
    whatsappPlaceholder: null,
    email: null,
    sitePhone: null,
    siteName: null,
    contactPage: null,
    crawledAt: new Date().toISOString(),
  };
}

async function crawl(website: string): Promise<CrawlFacts> {
  const facts = emptyFacts(website);
  const fail = (err: unknown) => {
    const p = err instanceof FetchProblem ? err : new FetchProblem("Couldn't connect", "network");
    facts.error = p.message;
    facts.errorKind = p.kind;
    return facts;
  };

  // robots.txt first. If even that can't connect, the site is unreachable: stop here.
  let robots;
  try {
    robots = await robotsFor(new URL(website).origin);
  } catch (err) {
    return fail(err);
  }
  if (!robots.allowed(website)) {
    facts.robotsNote = robots.note ?? "robots.txt asks bots not to crawl this site, so it wasn't checked";
    return facts;
  }

  let home: Page;
  try {
    home = await fetchPage(website);
  } catch (err) {
    return fail(err);
  }
  facts.finalUrl = home.finalUrl;
  facts.status = home.status;
  facts.loadMs = home.ms;
  if (home.status >= 400) {
    facts.error = `HTTP ${home.status}`;
    facts.errorKind = "http";
    return facts;
  }

  const pages = [extract(home)];

  // Contact page: the site's own contact link if it has one, otherwise /contact.
  const finalOrigin = new URL(home.finalUrl).origin;
  const contactUrl = pages[0].contactLink ?? `${finalOrigin}/contact`;
  if (new URL(contactUrl).pathname !== new URL(home.finalUrl).pathname) {
    try {
      const contactRobots = finalOrigin === new URL(website).origin ? robots : await robotsFor(finalOrigin);
      if (contactRobots.allowed(contactUrl)) {
        const contact = await fetchPage(contactUrl);
        facts.contactPage = { url: contact.finalUrl, status: contact.status };
        if (contact.status < 400 && contact.html) pages.push(extract(contact));
      }
    } catch (err) {
      facts.contactPage = { url: contactUrl, status: null };
      if (!(err instanceof FetchProblem)) console.warn("[audit] contact page:", err);
    }
  }

  const [h] = pages;
  facts.viewport = h.viewport;
  facts.copyrightYear = Math.max(0, ...pages.map((p) => p.copyrightYear ?? 0)) || null;
  const latest = Math.max(0, ...pages.flatMap((p) => p.postDates));
  facts.latestPostDate = latest ? new Date(latest).toISOString() : null;
  facts.contactPaths = [...new Set(pages.flatMap((p) => [...p.contactPaths]))];
  facts.hasVideo = pages.some((p) => p.hasVideo);
  facts.whatsappPhone = pages.map((p) => p.whatsappPhone).find(Boolean) ?? null;
  facts.whatsappPlaceholder = facts.whatsappPhone
    ? null
    : (pages.map((p) => p.whatsappPlaceholder).find(Boolean) ?? null);
  facts.email = pickEmail(home.finalUrl, pages);
  facts.sitePhone = pages.map((p) => p.telPhone).find(Boolean) ?? null;
  facts.siteName = h.siteName;
  return facts;
}
