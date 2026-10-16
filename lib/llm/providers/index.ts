import { ollamaProvider } from "./ollama";
import { openrouterProvider } from "./openrouter";
import { LlmError, type Provider } from "./types";

export type ProviderName = Provider["name"];

// LLM_PROVIDER=ollama (local, the default) or openrouter (production). Read on every
// call, so a script can switch models and providers between calls.
export function currentProvider(): Provider {
  const name = (process.env.LLM_PROVIDER?.trim() || "ollama").toLowerCase();
  const model = process.env.LLM_MODEL?.trim();
  if (!model) {
    throw new LlmError(
      name === "openrouter"
        ? "LLM_MODEL isn't set (e.g. LLM_MODEL=google/gemma-3-12b-it)."
        : "LLM_MODEL isn't set in .env.local (e.g. LLM_MODEL=gemma3:4b).",
      "config",
    );
  }
  if (name === "ollama") return ollamaProvider(model);
  if (name === "openrouter") return openrouterProvider(model);
  throw new LlmError(`LLM_PROVIDER must be "ollama" or "openrouter", not "${name}".`, "config");
}
