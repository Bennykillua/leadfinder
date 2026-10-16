// "No invented facts" and "say something specific", enforced in code.

export function normalise(s: string) {
  return s
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[“”"‘’'`*_:[\]]/g, " ")
    .replace(/[^\p{L}\p{N}@%₦$£€./\-\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Words that say nothing about this particular business.
const GENERIC = new Set(
  `about above after again against their there these those which while would could should cannot doesn don't
  without within other every where being because before customer customers client clients people visitors potential
  business businesses company website websites online information details clear clearly easily simple simply really
  makes making makes needs need first right whole likely might maybe still often never always something anything
  nothing everything looks looking appear appears seems seem shows showing provide provides offer offers service
  services quality professional modern update updated better improve improving lacks lacking missing limited limits
  important difficult trust things great`
    .split(/\s+/)
    .filter(Boolean),
);

function specificWords(text: string) {
  return normalise(text)
    .split(" ")
    .filter((w) => (w.length >= 5 && !GENERIC.has(w)) || /\d/.test(w));
}

// True if the claim mentions at least one specific word (or number) that appears in
// the facts: it has to point at something on the page or in the evidence.
export function pointsAtFacts(claim: string, corpusParts: string[]) {
  const corpus = ` ${normalise(corpusParts.join(" "))} `;
  // Singular or plural both count: "apartments" points at "Apartment".
  return specificWords(claim).some((w) => corpus.includes(w) || corpus.includes(w.replace(/(es|s)$/, "")));
}

// Talk about the freelancer's services or "opportunities" instead of the business's
// own problem. Bad: "Lack of online presence limits website design opportunities."
const SERVICE_TALK =
  /\b(freelancer|opportunit(y|ies)|our services|my services|your services|online presence|digital presence|digital content|content creation|web ?design|website design|web development|video (editing|production|services?)|social media (management|services?)|graphic design|marketing services|promotional content|website (build|builds|building|redesign|creation)|redesign( project)?|re-?design|build(ing)? (a|their|your) (new )?website|client'?s website)\b/i;

export function serviceTalk(text: string, offerDetail = ""): string | null {
  const m = text.match(SERVICE_TALK);
  if (m) return m[0];
  const phrase = offerDetail.trim().toLowerCase();
  if (phrase.split(/\s+/).length >= 3 && text.toLowerCase().includes(phrase)) return phrase;
  return null;
}

// Numbers in model text (ratings, review counts, years, seconds) must appear in the
// facts. Catches "500 reviews" or "© 2018" that we never said.
export function unknownNumbers(text: string, corpusParts: string[]): string[] {
  const corpusNumbers = new Set((corpusParts.join(" ").match(/\d+(?:\.\d+)?/g) ?? []).map(Number));
  return [...new Set(text.match(/\d+(?:\.\d+)?/g) ?? [])].filter((n) => !corpusNumbers.has(Number(n)));
}

// Words that only exist in a prompt's example and must not leak into real output.
export function copiedFromExample(text: string, exampleOnly: string[], knownParts: string[]) {
  const known = knownParts.join(" ");
  return exampleOnly.filter(
    (w) => new RegExp(`\\b${w}\\b`, "i").test(text) && !new RegExp(`\\b${w}\\b`, "i").test(known),
  );
}

// Numbers that make a claim about the business: ratings, review counts, scores,
// prices, dates and load times. Each is returned with its number. Ordinary phrasing
// ("1 quick question", "a 30-second video", "2 minutes of your time") is not a claim.
const NUM = String.raw`(\d[\d,]*(?:\.\d+)?)`;
const BUSINESS_CLAIMS: RegExp[] = [
  // Ratings: 4.7★, 4.7 stars, 4.7-star, 4.7/5, rated 4.7, rating of 4.7
  new RegExp(String.raw`${NUM}\s*(?:★|-?\s*stars?\b|\/\s*5\b)`, "gi"),
  new RegExp(String.raw`\brat(?:ed|ing)(?:\s+of)?\s+${NUM}`, "gi"),
  // Review counts: 64 reviews, 64 Google reviews, 64 ratings
  new RegExp(String.raw`${NUM}\s+(?:[A-Za-z]+\s+)?(?:reviews?|ratings?|reviewers?)\b`, "gi"),
  // Scores and percentages: 42/100, 35%, score of 42
  new RegExp(String.raw`${NUM}\s*(?:\/\s*100\b|%|percent\b)`, "gi"),
  new RegExp(String.raw`\bscor(?:e|ed|es)(?:\s+(?:of|is|was))?\s+${NUM}`, "gi"),
  // Prices: ₦25,000, $50, 25k naira, 25,000 NGN
  new RegExp(String.raw`[₦$£€]\s?${NUM}k?`, "gi"),
  new RegExp(String.raw`${NUM}\s*k?\s*(?:naira|ngn|usd|dollars?|pounds?|gbp|euros?)\b`, "gi"),
  // Dates: 2019, since 2019, 3 months ago, March 12, 12 March
  new RegExp(String.raw`\b((?:19|20)\d{2})\b`, "g"),
  new RegExp(String.raw`${NUM}\s+(?:days?|weeks?|months?|years?)\s+ago\b`, "gi"),
  new RegExp(String.raw`\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b`, "gi"),
  new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b`, "gi"),
  // Load times about their site: loads in 6 seconds, takes over 6s to load
  new RegExp(String.raw`\b(?:loads?|loading|takes?|took)\s+(?:in\s+|about\s+|over\s+|around\s+|nearly\s+)*${NUM}\s*(?:s|secs?|seconds?)\b`, "gi"),
];

export function businessNumberClaims(text: string): { claim: string; number: number }[] {
  const out: { claim: string; number: number }[] = [];
  for (const re of BUSINESS_CLAIMS) {
    for (const m of text.matchAll(re)) out.push({ claim: m[0].trim(), number: Number(m[1].replace(/,/g, "")) });
  }
  return out;
}

// Business claims whose number isn't in the evidence or in the freelancer's own
// profile/offer text (their prices and numbers are theirs to use).
export function unsupportedClaims(text: string, evidenceParts: string[], ownParts: string[]): string[] {
  const known = new Set(
    ([...evidenceParts, ...ownParts].join(" ").match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => Number(n.replace(/,/g, ""))),
  );
  return [...new Set(businessNumberClaims(text).filter((c) => !known.has(c.number)).map((c) => c.claim))];
}
