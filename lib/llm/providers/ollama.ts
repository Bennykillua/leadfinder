import { LlmError, timeoutOrUnavailable, TIMEOUT_MS, type Message, type Provider } from "./types";

// Local Gemma via Ollama's /api/chat. The JSON schema goes in `format`, so Ollama
// constrains the reply to it.

const DEFAULT_URL = "http://localhost:11434";

// Set explicitly, never left to Ollama defaults: since Ollama 0.32.10 repeat_penalty
// defaults to 1.0 (off), and small models then loop until Ollama aborts them
// ("token repeat limit reached").
export const OLLAMA_OPTIONS = {
  num_ctx: 8192,
  num_predict: 400,
  temperature: 0.3,
  repeat_penalty: 1.1,
} as const;

// The retry samples a little differently: the same prompt at the same temperature
// tends to fall into the same loop (Ollama's "token repeat limit").
export const RETRY_TEMPERATURE = 0.6;

export function ollamaUrl() {
  return (process.env.OLLAMA_URL || DEFAULT_URL).replace(/\/+$/, "");
}

export function ollamaProvider(model: string): Provider {
  const url = ollamaUrl();
  return {
    name: "ollama",
    model,
    options: { ...OLLAMA_OPTIONS },
    serial: true,
    maxOutputTokens: OLLAMA_OPTIONS.num_predict,
    async chat(messages: Message[], schema: unknown, retry: boolean) {
      let res: Response;
      try {
        res = await fetch(`${url}/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          // think: false: thinking models (gemma4, qwen3) otherwise spend the whole
          // num_predict budget reasoning and never write the JSON. Ignored by others.
          body: JSON.stringify({
            model,
            messages,
            format: schema,
            stream: false,
            think: false,
            options: retry ? { ...OLLAMA_OPTIONS, temperature: RETRY_TEMPERATURE } : OLLAMA_OPTIONS,
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (err) {
        throw timeoutOrUnavailable(
          err,
          `Ollama isn't running at ${url}. Start it with \`ollama serve\` (or open the Ollama app), then try again.`,
        );
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        if (/repeat limit|prediction aborted/i.test(text)) return { kind: "aborted", message: text.slice(0, 300) };
        if (res.status === 404 || /not found/i.test(text)) {
          throw new LlmError(`Model "${model}" isn't pulled in Ollama. Run \`ollama pull ${model}\`.`, "model_missing");
        }
        throw new LlmError(`Ollama returned HTTP ${res.status}: ${text.slice(0, 200)}`, "unavailable");
      }
      const json = (await res.json()) as {
        message?: { content?: string };
        prompt_eval_count?: number;
        eval_count?: number;
        done_reason?: string;
      };
      return {
        kind: "reply",
        content: json.message?.content ?? "",
        inputTokens: json.prompt_eval_count ?? 0,
        outputTokens: json.eval_count ?? 0,
        doneReason: json.done_reason ?? "",
      };
    },
  };
}
