import "server-only";
import { z } from "zod";
import type { CurrentUser } from "@/lib/dal";
import { allEvidence, type Evidence, type Lead } from "@/lib/leads";
import { businessFacts, offerText } from "./context";
import { copiedFromExample, normalise, pointsAtFacts, unknownNumbers } from "./grounding";
import { generateJson } from "./ollama";

// Gemma call 2: an evidence-based WhatsApp pitch.
// Structure: an observation they can verify → why it costs them, from their customer's
// view → one simple question. 50–125 words. It must cite the evidence it uses by id,
// and code rejects (then retries once) anything that breaks the rules below.

const MIN_WORDS = 50;
const MAX_WORDS = 125;

const schema = z.object({
  pitch: z.string().min(150).max(1200),
  evidence_ids: z.array(z.string().min(3).max(60)).min(1).max(4),
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

function evidenceLine(e: Evidence) {
  const state = e.kind === "timing" ? "TIMING" : e.ok === true ? "PASSED" : e.ok === false ? "PROBLEM" : "NOTE";
  return `[${e.id}] ${state} · ${e.label}: ${e.detail}${e.check ? ` (they can check: ${e.check})` : ""}`;
}

const SYSTEM = `You write a first WhatsApp message from a freelancer to a local business. It must be based only on the evidence list, and you must say which evidence you used.

Reply with JSON in exactly this shape (this example is for a different business; never copy its details, names or numbers):
${EXAMPLE}

The message:
1. Open with ONE specific observation from the evidence that the owner can check for themselves (after a short "Hi!" at most).
2. Then say why it costs them, from THEIR CUSTOMERS' point of view (what customers can't do, or do instead).
3. One line on how the freelancer could help, without listing services.
4. End with ONE simple, low-pressure question. Nothing after it, no sign-off.

Rules:
- ${MIN_WORDS}-${MAX_WORDS} words. Plain, friendly English. No hashtags, no emojis.
- No hard sell (no discounts, deadlines, guarantees). No list of services.
- At most one compliment, and only if it is true from a PASSED item or a good review in the evidence. Otherwise no compliment.
- Every fact must come from the evidence you cite. No invented numbers, names, prices or results. Don't claim you visited.
- "evidence_ids": the ids, exactly as written in brackets, of every evidence item the message uses. At least one must be a PROBLEM or a review.`;

export async function writePitch(user: CurrentUser, lead: Lead): Promise<{ pitch: string; evidence: Evidence[] }> {
  const items = allEvidence(lead);
  const byId = new Map(items.map((e) => [e.id, e]));
  const facts = businessFacts(lead);
  const whyNow = lead.ai?.timing?.[0];

  const { value } = await generateJson({
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
EVIDENCE (cite by id):
${items.map(evidenceLine).join("\n")}`,
      },
    ],
    check: (v) => {
      const unknown = v.evidence_ids.filter((id) => !byId.has(id));
      if (unknown.length) return `"evidence_ids" has ids that aren't in the evidence list: ${unknown.join(", ")}. Use ids exactly as written in brackets.`;
      const cited = v.evidence_ids.map((id) => byId.get(id)!);
      if (!cited.some((e) => e.ok === false || e.kind === "review" || e.kind === "finding")) {
        return `Cite at least one PROBLEM item or review in "evidence_ids": the message must be about a real problem.`;
      }
      const citedText = [...cited.map((e) => `${e.label} ${e.detail} ${e.check ?? ""}`), facts];

      const n = words(v.pitch);
      if (n < MIN_WORDS || n > MAX_WORDS) return `The message is ${n} words; it must be ${MIN_WORDS}-${MAX_WORDS}.`;
      if (/^\s*([-•*]|\d+[.)])\s/m.test(v.pitch)) return "The message has a list. Write it as plain sentences, no list.";
      const trimmed = v.pitch.trim();
      if (!trimmed.endsWith("?")) return "End the message with one simple question, with nothing after it.";
      if ((trimmed.match(/\?/g) ?? []).length > 1) return "Ask only ONE question, at the end.";

      const opening = openingSentence(trimmed);
      if (!pointsAtFacts(opening, cited.map((e) => `${e.label} ${e.detail} ${e.check ?? ""}`))) {
        return `The message must open with the specific observation from the evidence you cited. The opening "${opening}" doesn't say what the evidence says.`;
      }
      const hardSell = trimmed.match(HARD_SELL);
      if (hardSell) return `No hard sell: remove "${hardSell[0]}".`;
      const services = new Set((trimmed.match(SERVICE_WORDS) ?? []).map((w) => w.toLowerCase().replace(/s$/, "")));
      if (services.size >= 4) return `Don't list services (${[...services].join(", ")}). Mention at most one way you'd help.`;

      const compliments = trimmed.match(COMPLIMENT) ?? [];
      if (compliments.length > 1) return `Only one compliment at most (found: ${compliments.join(", ")}).`;
      if (compliments.length === 1) {
        const earned = cited.some((e) => e.ok === true || (e.kind === "review" && /^[45]★/.test(e.label)));
        if (!earned) return `The compliment "${compliments[0]}" isn't backed by a PASSED item or a good review you cited. Remove it, or cite the evidence for it.`;
      }

      const numbers = unknownNumbers(trimmed, citedText);
      if (numbers.length) return `The message uses numbers that aren't in the evidence you cited (${numbers.join(", ")}).`;
      const quotes = [...trimmed.matchAll(/["“]([^"”]{3,})["”]/g)].map((m) => m[1]);
      const fakeQuote = quotes.find((q) => !normalise(citedText.join(" ")).includes(normalise(q)));
      if (fakeQuote) return `The quote "${fakeQuote}" isn't in the evidence you cited. Quote exactly or don't quote.`;
      const copied = copiedFromExample(trimmed, EXAMPLE_ONLY, citedText);
      if (copied.length) return `The message copies the example (${copied.join(", ")}). Write about this business only.`;
      return null;
    },
  });

  return {
    pitch: value.pitch.trim(),
    evidence: value.evidence_ids.map((id) => byId.get(id)!).filter(Boolean),
  };
}
