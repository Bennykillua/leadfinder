import { OLLAMA_OPTIONS, RETRY_TEMPERATURE } from "./ollama";
import { LlmError, timeoutOrUnavailable, TIMEOUT_MS, type Message, type Provider } from "./types";

// Open-weight models through OpenRouter (https://openrouter.ai/docs), production.
// - Chat completions with JSON schema structured outputs (strict), and the same
//   sampling settings as Ollama: temperature 0.3 (0.6 on the retry), max_tokens 400,
//   repetition_penalty 1.1.
// - provider.require_parameters: only route to hosts that support every parameter
//   sent, so the schema and settings are never silently dropped.
// - Reasoning is turned off on models that have it (qwen3), like Ollama's think:false.
// - The billed cost of each call comes back in usage.cost and is logged.

const API = "https://openrouter.ai/api/v1";

export const OPENROUTER_OPTIONS = {
  temperature: OLLAMA_OPTIONS.temperature,
  max_tokens: OLLAMA_OPTIONS.num_predict,
  repetition_penalty: OLLAMA_OPTIONS.repeat_penalty,
} as const;

export function openrouterKey() {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) throw new LlmError("OPENROUTER_API_KEY isn't set (needed for LLM_PROVIDER=openrouter).", "config");
  return key;
}

export type ModelInfo = { supportsReasoning: boolean; price: { input: number; output: number } | null };

// The public model list (no key needed), fetched once per process: which models
// can reason (so reasoning is switched off only where it exists) and list prices.
let modelList: Promise<Map<string, ModelInfo>> | null = null;
export function openrouterModels(): Promise<Map<string, ModelInfo>> {
  modelList ??= fetch(`${API}/models`, { signal: AbortSignal.timeout(15_000) })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((j: { data: { id: string; supported_parameters?: string[]; pricing?: { prompt?: string; completion?: string } }[] }) => {
      const map = new Map<string, ModelInfo>();
      for (const m of j.data) {
        const input = Number(m.pricing?.prompt);
        const output = Number(m.pricing?.completion);
        map.set(m.id, {
          supportsReasoning: m.supported_parameters?.includes("reasoning") ?? false,
          price: Number.isFinite(input) && Number.isFinite(output) ? { input: input * 1e6, output: output * 1e6 } : null,
        });
      }
      return map;
    })
    .catch((err) => {
      modelList = null; // try again next time
      console.warn("[llm] couldn't load OpenRouter's model list:", err);
      return new Map<string, ModelInfo>();
    });
  return modelList;
}

export function openrouterProvider(model: string): Provider {
  return {
    name: "openrouter",
    model,
    options: { ...OPENROUTER_OPTIONS, structured_outputs: "json_schema strict", require_parameters: true },
    serial: false,
    maxOutputTokens: OPENROUTER_OPTIONS.max_tokens,
    async chat(messages: Message[], schema: unknown, retry: boolean) {
      const key = openrouterKey();
      const info = (await openrouterModels()).get(model);
      let res: Response;
      try {
        res = await fetch(`${API}/chat/completions`, {
          method: "POST",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "x-title": "Lead finder" },
          body: JSON.stringify({
            model,
            messages,
            response_format: { type: "json_schema", json_schema: { name: "answer", strict: true, schema } },
            ...OPENROUTER_OPTIONS,
            ...(retry ? { temperature: RETRY_TEMPERATURE } : {}),
            ...(info?.supportsReasoning ? { reasoning: { enabled: false } } : {}),
            provider: { require_parameters: true },
            usage: { include: true },
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (err) {
        throw timeoutOrUnavailable(err, `Couldn't reach OpenRouter (${API}). Check the connection and try again.`);
      }
      const text = await res.text().catch(() => "");
      let json: {
        error?: { code?: number; message?: string };
        choices?: { message?: { content?: string | null }; finish_reason?: string | null; error?: { message?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
      } = {};
      try {
        json = JSON.parse(text);
      } catch {
        // handled below
      }
      const errMessage = json.error?.message ?? text.slice(0, 300);
      if (!res.ok || json.error) {
        const status = json.error?.code ?? res.status;
        if (status === 401 || status === 403) {
          throw new LlmError(`OpenRouter rejected OPENROUTER_API_KEY (HTTP ${status}): ${errMessage}`, "config");
        }
        if (status === 402) throw new LlmError(`OpenRouter says the account is out of credit: ${errMessage}`, "unavailable");
        if (status === 404 || /not a valid model|no endpoints found/i.test(errMessage)) {
          throw new LlmError(`OpenRouter can't serve "${model}" with these settings: ${errMessage}`, "model_missing");
        }
        if (status === 429) throw new LlmError(`OpenRouter is rate-limiting requests: ${errMessage}`, "unavailable");
        // A host failing mid-reply (5xx, timeouts upstream): a bad attempt, worth the retry.
        if (status >= 500) return { kind: "aborted", message: `HTTP ${status}: ${errMessage}` };
        throw new LlmError(`OpenRouter returned HTTP ${status}: ${errMessage}`, "unavailable");
      }
      const choice = json.choices?.[0];
      if (choice?.error) return { kind: "aborted", message: choice.error.message ?? "the host returned an error" };
      return {
        kind: "reply",
        content: choice?.message?.content ?? "",
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
        doneReason: choice?.finish_reason ?? "",
        costUsd: json.usage?.cost,
      };
    },
  };
}
