import "server-only";
import { z } from "zod";
import type { CurrentUser } from "@/lib/dal";
import { allEvidence, type Evidence, type Lead } from "@/lib/leads";
import { businessFacts, offerText } from "./context";
import { businessNumberClaims, copiedFromExample, normalise, pointsAtFacts, unsupportedClaims } from "./grounding";
import { generateJson, LlmError } from "./ollama";

// Gemma call 2: an evidence-based WhatsApp pitch.
// Structure: an observation they can verify → why it costs them, from their customer's
// view → one simple question. 50–125 words. It must cite the evidence it uses by id,
// and code rejects (then retries once) anything that breaks the rules below.

const MIN_WORDS = 50;
const MAX_WORDS = 125;

const schema = z.object({
  pitch: z.string().min(150).max(1200),
  evidence_ids: z.array(z.string().min(3).max(60)).min(1).max(5),
});

const EXAMPLE = `{"pitch":"Hi! On your website the Halls page has no photos, so couples planning a wedding can't see the space before they call. Most of them will just book the venue whose pictures they've already seen. A short walk-through video would let them picture their day there in under a minute. Would it help if I sent you a free sample made from photos you already have?","evidence_ids":["finding:1"]}`;
// Only in the example: must not show up in a real pitch unless the business has them.
const EXAMPLE_ONLY = ["Halls", "couples", "wedding", "venue", "walk-through"];

// No hard sell.
const HARD_SELL = /\b(guarantee[ds]?|limited time|act now|don'?t miss|hurry|urgent|special offer|discount|best price|cheap(est)?|100%|money.?back|today only|last chance|deal)\b/i;
// Flattery: allowed once, and only if it's true (backed by a passed item or a good review).
const COMPLIMENT = /\b(great|amazing|awesome|lovely|beautiful|impressive|fantastic|excellent|wonderful|stunning|love (your|the)|brilliant|well done)\b/gi;
// "List of services": three or more different service words, or a bulleted list.
const SERVICE_WORDS =
  /\b(video|videos|reel|reels|website|websites|logo|logos|branding|seo|ads|advert|adverts|content|photography|photos|social media|posts|flyers?|design)\b/gi;

// Inline citations ("…the cost [finding:1].") belong in evidence_ids, not in a
// WhatsApp message: remove them.
function stripCitations(text: string) {
  return text.replace(/\s*[[(](?:check|finding|review|timing|portfolio|profile):[^\])]*[\])]/gi, "").replace(/\s+([.,!?])/g, "$1");
}

// A short sign-off after the final question ("…? – Tolu", "…? Thanks!") is harmless:
// drop it rather than reject the pitch. Anything longer after the question still fails.
export function stripSignOff(text: string) {
  const t = stripCitations(text).trim();
  const last = t.lastIndexOf("?");
  if (last === -1 || last === t.length - 1) return t;
  const tail = t.slice(last + 1).trim();
  return tail.split(/\s+/).length <= 4 && !/[.!?].+[.!?]/.test(tail) ? t.slice(0, last + 1) : t;
}

function words(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function sentences(text: string) {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// "Hi!" / "Hello Wonderwheels," on its own isn't the opening observation.
function openingSentence(text: string) {
  const s = sentences(text);
  const first = s[0] ?? "";
  if (words(first) <= 3 && s[1]) return s[1];
  return first.replace(/^(hi|hello|hey|good (morning|afternoon|evening))\b[^,!.]*[,!.]?\s*/i, "");
}

// The freelancer's profile as evidence items, so the drawer can show the portfolio
// link a pitch used. Kept out of the business pitch prompt: in testing, gemma3:4b
// cited them instead of the business's problems and passed fewer checks. The link is
// added by code instead.
export function profileEvidence(user: CurrentUser): Evidence[] {
  const items: Evidence[] = user.portfolioLinks.map((url, i) => ({
    id: `portfolio:${i + 1}`,
    kind: "profile",
    label: "Your work",
    ok: null,
    detail: url,
  }));
  if (user.niche.trim()) items.push({ id: "profile:niche", kind: "profile", label: "Your niche", ok: null, detail: user.niche.trim() });
  if (user.rate.trim()) items.push({ id: "profile:rate", kind: "profile", label: "Your rate", ok: null, detail: user.rate.trim() });
  return items;
}

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"“”]+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|ng|net|org|io|co|me|tv|app|link|site|studio|art|uk)(?:\/[^\s<>"“”]*)?/gi;

// "…clear prices. Would a short video help?" → "…clear prices. Here's some of my
// work: <link> Would a short video help?" No full stop after the link, so it stays
// clickable in WhatsApp.
function withLink(pitch: string, url: string) {
  const parts = sentences(pitch);
  const question = parts.pop() ?? "";
  return [...parts, `Here's some of my work: ${url}`, question].join(" ");
}

// "https://www.Vimeo.com/tolu/" and "vimeo.com/tolu" are the same link.
function sameLink(url: string) {
  return url.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[.,!?;:)]+$/, "").replace(/\/+$/, "");
}

function numbersIn(e: Evidence) {
  return (`${e.label} ${e.detail}`.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => Number(n.replace(/,/g, "")));
}

function evidenceLine(e: Evidence) {
  const state =
    e.kind === "timing" ? "TIMING" : e.ok === true ? "PASSED" : e.ok === false ? "PROBLEM" : "NOTE";
  return `[${e.id}] ${state} · ${e.label}: ${e.detail}${e.check ? ` (they can check: ${e.check})` : ""}`;
}

const SYSTEM = `You write a first WhatsApp message from a freelancer to a local business. It must be based only on the evidence list, and you must say which evidence you used.

Reply with JSON in exactly this shape (this example is for a different business; never copy its details, names or numbers):
${EXAMPLE}

The message:
1. Open with ONE specific observation from the evidence that the owner can check for themselves (after a short "Hi!" at most). Prefer a PROBLEM if there is one.
2. Then say why it matters from THEIR CUSTOMERS' point of view (what customers can't do or do instead; for a STRENGTH message, how more customers could benefit).
3. One line on how the freelancer could help, without listing services.
4. End with ONE simple, low-pressure question. Nothing after it, no sign-off.

Rules:
- ${MIN_WORDS}-${MAX_WORDS - 5} words. Plain, friendly English. No hashtags, no emojis.
- No hard sell (no discounts, deadlines, guarantees). No list of services.
- At most one compliment, and only if it is true from a PASSED item or a good review in the evidence. Otherwise no compliment.
- Every fact about the business must come from the evidence you cite: no invented ratings, review counts, prices, dates or results. Don't claim you visited.
- No links or web addresses.
- "evidence_ids": the ids, exactly as written in brackets, of every evidence item the message uses.`;

export async function writePitch(user: CurrentUser, lead: Lead): Promise<{ pitch: string; evidence: Evidence[] }> {
  const items = allEvidence(lead);
  const yours = profileEvidence(user);
  const byId = new Map(items.map((e) => [e.id, e]));
  const businessHost = lead.website ? sameLink(lead.website).split("/")[0] : "";
  // The link sentence code adds ("Here's some of my work: <link>") is 5 words, so the
  // model's text leaves room for it inside the 125.
  const maxWords = user.portfolioLinks.length > 0 ? MAX_WORDS - 5 : MAX_WORDS;
  const facts = businessFacts(lead);
  const whyNow = lead.ai?.timing?.[0];

  if (items.length === 0) {
    throw new LlmError("Nothing to go on yet: run the audit on this lead first.", "no_evidence");
  }
  // A business with nothing wrong can still be pitched: on a real strength (a passed
  // check or a good review), never on an invented problem.
  const hasProblem = items.some((e) => e.ok === false || e.kind === "finding" || (e.kind === "review" && /^[12]★/.test(e.label)));
  const strengthMode = hasProblem
    ? ""
    : `
NO PROBLEMS FOUND: every check passed. Write a STRENGTH message instead:
1. Open with ONE real strength from a PASSED item or a good review (this is your one compliment).
2. Say how the freelancer could help them build on it for their customers (e.g. more people seeing it).
3. End with one simple question.
Never claim or hint at a problem: none was found.
`;

  // Bookkeeping slips are repaired, not rejected (the facts are still checked):
  // - The ids spilled into the message text ('…help? ” , “evidence_ids”: [“check:fresh”]'):
  //   cut the spill off and read the ids from it.
  // - A figure in the message is in an evidence item the model forgot to cite
  //   ("© 2021" without check:fresh): cite that item.
  const ID_RE = /\b(?:check|finding|review|timing):[\w-]+/g;
  function repair(v: z.infer<typeof schema>): z.infer<typeof schema> {
    let pitch = v.pitch;
    // "[check:maps]" → "check:maps": the brackets are how ids are shown in the prompt.
    const ids = new Set(v.evidence_ids.map((id) => id.trim().replace(/^\[+|\]+$/g, "")));
    const spill = pitch.search(/["”“]?\s*,?\s*["“”]?evidence_ids["“”]?\s*:/i);
    if (spill !== -1) {
      for (const id of pitch.slice(spill).match(ID_RE) ?? []) if (byId.has(id)) ids.add(id);
      pitch = pitch.slice(0, spill).replace(/\s*["”“]\s*$/, "").trim();
    }
    for (const { number } of businessNumberClaims(pitch)) {
      const cited = [...ids].map((id) => byId.get(id)).filter(Boolean);
      if (cited.some((e) => numbersIn(e!).includes(number))) continue;
      const source = items.find((e) => numbersIn(e).includes(number));
      if (source) ids.add(source.id);
    }
    return { pitch, evidence_ids: [...ids].slice(0, 5) };
  }

  const { value: raw } = await generateJson({
    type: "pitch",
    schema,
    userId: user.id,
    leadId: lead.id,
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: `THE FREELANCER (the sender; NOT about the business): sells ${offerText(user)}

THE BUSINESS (the recipient):
${facts}

Best reason to pitch: ${lead.ai?.topReason ?? lead.topReason ?? "(none)"}
${whyNow ? `Why now: ${whyNow.detail} [${whyNow.id}]\n` : ""}
${strengthMode}
EVIDENCE (cite by id):
${items.map(evidenceLine).join("\n")}`,
      },
    ],
    check: (rawValue) => {
      const v = repair(rawValue);
      const unknown = v.evidence_ids.filter((id) => !byId.has(id));
      if (unknown.length) return `"evidence_ids" has ids that aren't in the evidence list: ${unknown.join(", ")}. Use ids exactly as written in brackets.`;
      const cited = v.evidence_ids.map((id) => byId.get(id)!);
      if (!cited.some((e) => e.kind !== "timing")) {
        return `Cite the evidence item your opening observation comes from in "evidence_ids".`;
      }
      const citedText = [...cited.map((e) => `${e.label} ${e.detail} ${e.check ?? ""}`), facts];

      const pitch = stripSignOff(v.pitch);
      const n = words(pitch);
      if (n < MIN_WORDS || n > maxWords) return `The message is ${n} words; it must be ${MIN_WORDS}-${maxWords}.`;
      if (/^\s*([-•*]|\d+[.)])\s/m.test(pitch)) return "The message has a list. Write it as plain sentences, no list.";
      if (!pitch.endsWith("?")) return "End the message with one simple question, with nothing after it.";

      // No links from the model: the portfolio link is added by code afterwards.
      // Naming the business's own site ("your website, slowlagos.com") is fine.
      const links = (pitch.match(URL_RE) ?? []).filter((l) => !businessHost || !sameLink(l).startsWith(businessHost));
      if (links.length) return `Don't write links or web addresses (found "${links[0]}").`;
      const trimmed = pitch;
      if ((trimmed.match(/\?/g) ?? []).length > 1) return "Ask only ONE question, at the end.";

      const opening = openingSentence(trimmed);
      const aboutBusiness = cited.filter((e) => e.kind !== "profile");
      if (!pointsAtFacts(opening, aboutBusiness.map((e) => `${e.label} ${e.detail} ${e.check ?? ""}`))) {
        return `The message must open with the specific observation from the evidence you cited. The opening "${opening}" doesn't say what the evidence says.`;
      }
      const hardSell = trimmed.match(HARD_SELL);
      if (hardSell) return `No hard sell: remove "${hardSell[0]}".`;
      const services = new Set((trimmed.match(SERVICE_WORDS) ?? []).map((w) => w.toLowerCase().replace(/s$/, "")));
      if (services.size >= 4) return `Don't list services (${[...services].join(", ")}). Mention at most one way you'd help.`;

      const compliments = trimmed.match(COMPLIMENT) ?? [];
      if (compliments.length > 1) return `Only one compliment at most (found: ${compliments.join(", ")}).`;
      if (compliments.length === 1) {
        const positive = cited.filter((e) => e.ok === true || (e.kind === "review" && /^[45]★/.test(e.label)));
        if (!positive.length) {
          return `The compliment "${compliments[0]}" isn't backed by a PASSED item or a good review you cited. Remove it, or cite the evidence for it.`;
        }
        // The compliment's sentence must say what that evidence says ("4.6 stars from 52 reviews").
        const sentence = sentences(trimmed).find((x) => new RegExp(`\\b${compliments[0]}\\b`, "i").test(x)) ?? "";
        if (!pointsAtFacts(sentence, positive.map((e) => `${e.label} ${e.detail}`))) {
          return `The compliment "${sentence}" isn't something the evidence shows. Compliment only what a PASSED item or good review says (e.g. the rating), or leave it out.`;
        }
      }

      // Only numbers that claim something about the business must be in the cited
      // evidence. "1 quick question", "a 30-second video" and the freelancer's own
      // prices are fine.
      const claims = unsupportedClaims(trimmed, citedText, [offerText(user), user.offerDetail, user.niche, user.rate]);
      if (claims.length) {
        return `The message claims ${claims.map((c) => `"${c}"`).join(", ")} about the business, but that isn't in the evidence you cited. Use the exact figures from the evidence, or leave them out.`;
      }
      const quotes = [...trimmed.matchAll(/["“]([^"”]{3,})["”]/g)].map((m) => m[1]);
      const fakeQuote = quotes.find((q) => !normalise(citedText.join(" ")).includes(normalise(q)));
      if (fakeQuote) return `The quote "${fakeQuote}" isn't in the evidence you cited. Quote exactly or don't quote.`;
      const copied = copiedFromExample(trimmed, EXAMPLE_ONLY, citedText);
      if (copied.length) return `The message copies the example (${copied.join(", ")}). Write about this business only.`;
      return null;
    },
  });

  const value = repair(raw);
  const evidence = value.evidence_ids.map((id) => byId.get(id)!).filter(Boolean);
  // The freelancer's first (best) portfolio link, exactly as saved, just before the
  // closing question. Code adds it so it can never be mistyped or invented.
  const link = yours.find((e) => e.id === "portfolio:1");
  const pitch = link ? withLink(stripSignOff(value.pitch), link.detail) : stripSignOff(value.pitch);
  if (link && !evidence.includes(link)) evidence.push(link);
  return { pitch, evidence };
}
