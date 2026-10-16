import type { Offer } from "@/lib/db/schema";
import type { Business, Evidence } from "@/lib/leads";
import type { CrawlFacts } from "./crawl";
import type { PageSpeed } from "./pagespeed";

// Deterministic checks from SPEC.md "The audit", turned into evidence, plus a
// PROVISIONAL score and top reason from simple rules. Gemma replaces the score and
// reason in step 6; the evidence stays code-made.

const SLOW_MS = 3000;
const MIN_REVIEWS = 20;
const MIN_RATING = 4.0;
// PageSpeed scores (0–100) below these are weak spots. Lighthouse calls under 50
// "poor" for performance.
const MIN_PERFORMANCE = 50;
const MIN_ACCESSIBILITY = 70;
const MIN_SEO = 80;

type CheckId =
  | "website" | "up" | "https" | "mobile" | "speed" | "accessibility" | "seo"
  | "fresh" | "contact" | "whatsapp" | "video" | "maps";

// Internal shape; toEvidence() adds the evidence id, kind and "what they can check".
type Check = { id: CheckId; label: string; ok: boolean | null; detail: string; reason?: string };

// How much each weak spot matters for the user's offer. Higher = better pitch angle.
const WEIGHTS: Record<Offer, Partial<Record<CheckId, number>>> = {
  websites: { https: 1.5, mobile: 2, speed: 1.5, seo: 1.5, accessibility: 0.75, fresh: 1.5, contact: 1.5, whatsapp: 1.5, maps: 0.5 },
  video: { video: 2.5, fresh: 1, mobile: 0.75, speed: 0.5, https: 0.5, contact: 0.75, whatsapp: 0.75, maps: 1 },
  social: { maps: 2, fresh: 1.5, contact: 1.5, whatsapp: 1, mobile: 1, https: 0.5, speed: 0.5 },
  other: { maps: 1.5, fresh: 1.25, contact: 1.25, whatsapp: 1, mobile: 1.25, https: 1, speed: 1 },
};

function monthYear(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

function mapsCheck(b: Business, fromMaps: boolean): Check {
  if (!fromMaps) {
    return { id: "maps", label: "Maps presence", ok: null, detail: "Not looked up on Google Maps" };
  }
  if (b.reviews === 0) {
    return { id: "maps", label: "Maps presence", ok: false, detail: "No Google reviews yet", reason: "No Google reviews yet" };
  }
  const detail = `${b.rating.toFixed(1)}★ from ${b.reviews} reviews`;
  const weak = b.reviews < MIN_REVIEWS || b.rating < MIN_RATING;
  const reason =
    b.reviews < MIN_REVIEWS
      ? `Only ${b.reviews} Google reviews (${b.rating.toFixed(1)}★)`
      : `${b.rating.toFixed(1)}★ rating on Google Maps`;
  return { id: "maps", label: "Maps presence", ok: !weak, detail, reason: weak ? reason : undefined };
}

// Maps often lists a social page as the "website". That's no website of its own,
// and those platforms don't want to be crawled anyway.
const SOCIAL_HOSTS: [RegExp, string][] = [
  [/(^|\.)(facebook|fb)\.com$/, "Facebook page"],
  [/(^|\.)instagram\.com$/, "Instagram page"],
  [/(^|\.)tiktok\.com$/, "TikTok page"],
  [/(^|\.)(x|twitter)\.com$/, "X (Twitter) page"],
  [/(^|\.)linktr\.ee$/, "Linktree page"],
  [/(^|\.)(wa\.me|whatsapp\.com)$/, "WhatsApp link"],
  [/(^|\.)linkedin\.com$/, "LinkedIn page"],
  [/(^|\.)youtube\.com$/, "YouTube channel"],
];

export function socialPage(website: string | null): string | null {
  if (!website) return null;
  try {
    const host = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`).hostname.replace(/^www\./, "");
    return SOCIAL_HOSTS.find(([re]) => re.test(host))?.[1] ?? null;
  } catch {
    return null;
  }
}

// PageSpeed scores as checks. On any PageSpeed failure: "Couldn't check", never an error.
function pageSpeedChecks(ps: PageSpeed): Check[] {
  if (!ps.ok) {
    const detail = `Couldn't check: ${ps.reason}`;
    return [
      { id: "speed", label: "Speed", ok: null, detail },
      { id: "accessibility", label: "Accessibility", ok: null, detail },
      { id: "seo", label: "SEO", ok: null, detail },
    ];
  }
  const score = (id: CheckId, label: string, value: number, min: number, reason: string): Check =>
    value < min
      ? { id, label, ok: false, detail: `${label} score ${value}/100 on mobile (PageSpeed)`, reason: `${reason} (${value}/100 on PageSpeed)` }
      : { id, label, ok: true, detail: `${label} score ${value}/100 on mobile (PageSpeed)` };
  return [
    score("speed", "Speed", ps.performance, MIN_PERFORMANCE, "Site is slow on phones"),
    score("accessibility", "Accessibility", ps.accessibility, MIN_ACCESSIBILITY, "Site is hard to use for some visitors"),
    score("seo", "SEO", ps.seo, MIN_SEO, "Site has basic Google search problems"),
  ];
}

// pageSpeed: the PageSpeed result, or null if it wasn't run (search rows): then the
// speed check falls back to our own first-load time.
export function runChecks(
  b: Business,
  facts: CrawlFacts | null,
  offer: Offer,
  fromMaps: boolean,
  pageSpeed: PageSpeed | null = null,
): Check[] {
  const maps = mapsCheck(b, fromMaps);

  const social = socialPage(b.website);
  if (social) {
    return [
      {
        id: "website",
        label: "Website",
        ok: false,
        detail: `${fromMaps ? "Maps links to" : "That's"} ${/^[AEIOU]/.test(social) ? "an" : "a"} ${social}, not a website`,
        reason: fromMaps ? `No website: Google Maps links to their ${social}` : `No website of their own, only a ${social}`,
      },
      maps,
    ];
  }

  if (!b.website || !facts) {
    return [
      { id: "website", label: "Website", ok: false, detail: "No website listed on Google Maps", reason: "No website listed on Google Maps" },
      maps,
    ];
  }

  const host = new URL(facts.finalUrl ?? facts.website).hostname.replace(/^www\./, "");
  const website: Check = { id: "website", label: "Website", ok: true, detail: host };

  if (facts.robotsNote) {
    return [website, { id: "up", label: "Site checks", ok: null, detail: facts.robotsNote }, maps];
  }

  if (facts.error) {
    const tls = facts.errorKind === "tls";
    return [
      website,
      {
        id: "up",
        label: "Site up",
        ok: false,
        detail: facts.error,
        reason: tls ? `Site shows a security warning: ${facts.error}` : `Website is down (${facts.error})`,
      },
      maps,
    ];
  }

  const checks: Check[] = [website, { id: "up", label: "Site up", ok: true, detail: `Loads (HTTP ${facts.status})` }];

  const https = facts.finalUrl?.startsWith("https://") ?? false;
  checks.push(
    https
      ? { id: "https", label: "HTTPS", ok: true, detail: "Served over https://" }
      : {
          id: "https",
          label: "HTTPS",
          ok: false,
          detail: "Served over plain http://",
          reason: "Site is on plain http://, so browsers mark it Not Secure",
        },
  );

  checks.push(
    facts.viewport
      ? { id: "mobile", label: "Mobile-friendly", ok: true, detail: "Has a viewport meta tag" }
      : {
          id: "mobile",
          label: "Mobile-friendly",
          ok: false,
          detail: "No viewport meta tag",
          reason: "Site has no viewport tag, so it doesn't fit phone screens",
        },
  );

  if (pageSpeed) {
    checks.push(...pageSpeedChecks(pageSpeed));
  } else if (facts.loadMs !== null) {
    const s = (facts.loadMs / 1000).toFixed(1);
    checks.push(
      facts.loadMs > SLOW_MS
        ? { id: "speed", label: "Speed", ok: false, detail: `First load took ${s}s`, reason: `Site took ${s}s to load` }
        : { id: "speed", label: "Speed", ok: true, detail: `First load in ${s}s` },
    );
  }

  const thisYear = new Date().getFullYear();
  const staleYear = facts.copyrightYear !== null && facts.copyrightYear <= thisYear - 2;
  const stalePost =
    facts.latestPostDate !== null && Date.now() - Date.parse(facts.latestPostDate) > 365 * 86_400_000;
  if (staleYear) {
    checks.push({
      id: "fresh",
      label: "Fresh content",
      ok: false,
      detail: `Footer says © ${facts.copyrightYear}`,
      reason: `Footer still says © ${facts.copyrightYear}`,
    });
  } else if (stalePost) {
    checks.push({
      id: "fresh",
      label: "Fresh content",
      ok: false,
      detail: `Latest dated post: ${monthYear(facts.latestPostDate!)}`,
      reason: `Latest dated post is from ${monthYear(facts.latestPostDate!)}`,
    });
  } else if (facts.copyrightYear !== null || facts.latestPostDate !== null) {
    checks.push({
      id: "fresh",
      label: "Fresh content",
      ok: true,
      detail: facts.copyrightYear ? `Footer says © ${facts.copyrightYear}` : `Latest dated post: ${monthYear(facts.latestPostDate!)}`,
    });
  } else {
    checks.push({ id: "fresh", label: "Fresh content", ok: null, detail: "No copyright year or post dates found" });
  }

  const paths = facts.contactPaths;
  checks.push(
    paths.length > 0
      ? { id: "contact", label: "Contact path", ok: true, detail: `Has ${paths.join(", ")}` }
      : {
          id: "contact",
          label: "Contact path",
          ok: false,
          detail: "No phone link, WhatsApp link, booking link or form",
          reason: "Site has no phone link, WhatsApp link, booking link or form",
        },
  );

  if (facts.whatsappPlaceholder) {
    checks.push({
      id: "whatsapp",
      label: "WhatsApp button",
      ok: false,
      detail: `Links to placeholder number ${facts.whatsappPlaceholder}`,
      reason: `The site's WhatsApp button goes to a placeholder number (${facts.whatsappPlaceholder})`,
    });
  }

  if (offer === "video") {
    checks.push(
      facts.hasVideo
        ? { id: "video", label: "Video", ok: true, detail: "Has video on the page" }
        : {
            id: "video",
            label: "Video",
            ok: false,
            detail: "No video on the homepage or contact page",
            reason: "No video anywhere on the homepage or contact page",
          },
    );
  }

  checks.push(maps);
  return checks;
}

// Provisional rules until Gemma (step 6). 1 = weak lead, 5 = strong pitch angle.
export function provisionalScore(checks: Check[], offer: Offer): { score: number; topReason: string } {
  const failed = checks.filter((c) => c.ok === false);
  const noSite = failed.find((c) => c.id === "website");
  const down = failed.find((c) => c.id === "up");
  if (noSite) return { score: offer === "websites" ? 5 : 4, topReason: noSite.reason! };
  if (down) return { score: offer === "websites" ? 5 : 4, topReason: down.reason! };

  const weights = WEIGHTS[offer];
  const weigh = (c: Check) => weights[c.id] ?? 0.5;
  const total = failed.reduce((sum, c) => sum + weigh(c), 0);
  const score = total === 0 ? 1 : total <= 1 ? 2 : total <= 2 ? 3 : total <= 3 ? 4 : 5;
  const top = [...failed].sort((a, b) => weigh(b) - weigh(a))[0];
  return { score, topReason: top?.reason ?? "No obvious weak spot found" };
}

// Plain English: how the business owner can see this for themselves.
function checkLine(c: Check, host: string | null): string | undefined {
  const site = host ?? "their website";
  if (c.ok === null) return undefined;
  if (c.ok) {
    if (c.id === "maps") return `Open their Google Maps listing: ${c.detail}.`;
    return undefined;
  }
  switch (c.id) {
    case "website":
      return /not a website|only a/i.test(c.detail)
        ? `Tap "Website" on their Google Maps listing: it opens a social page, not a site of their own.`
        : `Search their name on Google Maps: the listing has no website.`;
    case "up":
      return /SSL|certificate/i.test(c.detail)
        ? `Open ${site}: the browser shows a security warning before the page.`
        : `Open ${site}: it doesn't load (${c.detail}).`;
    case "https":
      return `Open ${site} in Chrome: the address bar says "Not secure".`;
    case "mobile":
      return `Open ${site} on a phone: the page doesn't fit the screen and needs zooming.`;
    case "speed":
      return /PageSpeed/.test(c.detail)
        ? `Run ${site} through pagespeed.web.dev (Mobile): ${c.detail.replace(/ on mobile \(PageSpeed\)$/, "")}.`
        : `Open ${site} on mobile data: it's slow to show.`;
    case "accessibility":
    case "seo":
      return `Run ${site} through pagespeed.web.dev (Mobile): ${c.detail.replace(/ on mobile \(PageSpeed\)$/, "")}.`;
    case "fresh":
      return /footer/i.test(c.detail)
        ? `Scroll to the bottom of ${site}: ${c.detail.replace(/^Footer says/, "the footer says")}.`
        : `Look at the dates on ${site}'s posts: the newest is old (${c.detail.replace(/^Latest dated post: /, "")}).`;
    case "contact":
      return `Look on ${site} for a phone link, WhatsApp link, booking link or form: there isn't one.`;
    case "whatsapp":
      return `Tap the WhatsApp button on ${site}: it opens a chat with a placeholder number, not theirs.`;
    case "video":
      return `Look through ${site}'s homepage and contact page: there's no video.`;
    case "maps":
      return `Open their Google Maps listing: ${c.detail}.`;
  }
}

export function toEvidence(checks: Check[], host: string | null = null): Evidence[] {
  return checks.map((c) => ({
    id: `check:${c.id}`,
    kind: "check" as const,
    label: c.label,
    ok: c.ok,
    detail: c.detail,
    check: checkLine(c, host),
  }));
}

// Evidence saved before ids existed: give it the same ids by label.
const LABEL_IDS: Record<string, CheckId> = {
  Website: "website",
  "Site up": "up",
  "Site checks": "up",
  HTTPS: "https",
  "Mobile-friendly": "mobile",
  Speed: "speed",
  Accessibility: "accessibility",
  SEO: "seo",
  "Fresh content": "fresh",
  "Contact path": "contact",
  "WhatsApp button": "whatsapp",
  Video: "video",
  "Maps presence": "maps",
};

export function upgradeEvidence(items: Partial<Evidence>[]): Evidence[] {
  return items.map((e, i) => {
    const checkId = LABEL_IDS[e.label ?? ""];
    const base = { label: e.label ?? "", ok: e.ok ?? null, detail: e.detail ?? "" };
    return {
      ...base,
      id: e.id ?? `check:${checkId ?? `item${i}`}`,
      kind: e.kind ?? "check",
      // Older evidence had no "what they can check" line: make it now.
      check: e.check ?? (checkId ? checkLine({ id: checkId, ...base }, null) : undefined),
    };
  });
}
