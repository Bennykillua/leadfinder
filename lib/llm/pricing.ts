// Per-token prices for the cost comparison, in USD per 1M tokens.

export type Price = { input: number; output: number };

// Two popular closed models, at their published list prices (standard tier, no
// caching or batch discounts). Their tokenizers differ from Gemma's, so "the same
// token volume" is an approximation.
export const CLOSED_MODELS: (Price & { name: string; source: string; checked: string })[] = [
  {
    name: "Claude Sonnet 5.5",
    input: 2,
    output: 10,
    source: "https://platform.claude.com/docs/en/about-claude/pricing",
    checked: "2026-10-16",
  },
  {
    name: "GPT-5.4",
    input: 2.5,
    output: 15,
    source: "https://developers.openai.com/api/docs/pricing",
    checked: "2026-10-16",
  },
];

export function costUsd(price: Price, inputTokens: number, outputTokens: number) {
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}
