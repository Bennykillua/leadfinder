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
  /\b(freelancer|opportunit(y|ies)|our services|my services|your services|online presence|digital presence|digital content|content creation|web ?design|website design|web development|video (editing|production|services?)|social media (management|services?)|graphic design|marketing services|promotional content|website (build|builds|building|redesign|creation)|build(ing)? (a|their|your) (new )?website|client'?s website)\b/i;

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
