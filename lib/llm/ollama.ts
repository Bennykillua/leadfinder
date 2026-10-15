import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { llmCalls } from "@/lib/db/schema";

// Ollama client for structured JSON output.
// - The JSON schema in `format` comes from the zod schema, and the reply is validated
//   with the same zod schema (plus an optional `check` for rules zod can't express).
// - Invalid output (bad JSON, failed check, cut off, or Ollama aborting a repeating
//   reply) gets one retry, with the problem fed back to the model.
// - One model call at a time: a local model on one machine doesn't run two faster.
// - Every call is logged to llm_call; failed calls also keep the raw output of each
//   attempt, the prompt size and the options, for debugging.

const DEFAULT_URL = "http://localhost:11434";
const TIMEOUT_MS = 180_000;

// Set explicitly, never left to Ollama defaults: since Ollama 0.32.10 repeat_penalty
// defaults to 1.0 (off), and small models then loop until Ollama aborts them
// ("token repeat limit reached").
export const OLLAMA_OPTIONS = {
  num_ctx: 8192,
  num_predict: 400,
  temperature: 0.3,
  repeat_penalty: 1.1,
} as const;

// Rough size check so a prompt never silently overflows num_ctx (Ollama would cut
// the start of it off). ~3.5 characters per token for English text.
const CHARS_PER_TOKEN = 3.5;
const MAX_PROMPT_TOKENS = OLLAMA_OPTIONS.num_ctx - OLLAMA_OPTIONS.num_predict - 256;
const MAX_RAW_LOG = 8000;

export type PromptType = "deep_read" | "pitch";
export type Message = { role: "system" | "user" | "assistant"; content: string };

export class LlmError extends Error {
  constructor(
    message: string,
    readonly kind: "unavailable" | "model_missing" | "invalid_output" | "timeout" | "config" | "too_long",
  ) {
    super(message);
  }
}

export function llmConfig() {
  const url = (process.env.OLLAMA_URL || DEFAULT_URL).replace(/\/+$/, "");
  const model = process.env.LLM_MODEL?.trim();
  if (!model) throw new LlmError("LLM_MODEL isn't set in .env.local (e.g. LLM_MODEL=gemma3:4b).", "config");
  return { url, model };
}

let queue: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

type ChatResult =
  | { kind: "reply"; content: string; inputTokens: number; outputTokens: number; doneReason: string }
  // Ollama stopped a reply that kept repeating itself: a bad attempt, worth one retry.
  | { kind: "aborted"; message: string };

async function chat(messages: Message[], format: unknown): Promise<ChatResult> {
  const { url, model } = llmConfig();
  let res: Response;
  try {
    res = await fetch(`${url}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // think: false: thinking models (gemma4, qwen3) otherwise spend the whole
      // num_predict budget reasoning and never write the JSON. Ignored by others.
      body: JSON.stringify({ model, messages, format, stream: false, think: false, options: OLLAMA_OPTIONS }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const e = err as { name?: string };
    if (e?.name === "TimeoutError") {
      throw new LlmError(`The model took longer than ${TIMEOUT_MS / 1000}s to answer.`, "timeout");
    }
    throw new LlmError(
      `Ollama isn't running at ${url}. Start it with \`ollama serve\` (or open the Ollama app), then try again.`,
      "unavailable",
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
}

// Returns an error message if the parsed value breaks a rule, or null if it's fine.
export type Check<T> = (value: T) => string | null;

// jsonOk: parsed and matched the schema. value: also passed the check.
function validate<T>(
  content: string,
  schema: z.ZodType<T>,
  check?: Check<T>,
): { value?: T; error?: string; jsonOk: boolean } {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return { error: "The reply wasn't valid JSON.", jsonOk: false };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: `JSON didn't match the schema at "${issue?.path.join(".")}": ${issue?.message}`, jsonOk: false };
  }
  const problem = check?.(parsed.data);
  return problem ? { error: problem, jsonOk: true } : { value: parsed.data, jsonOk: true };
}

export async function generateJson<T>(opts: {
  type: PromptType;
  schema: z.ZodType<T>;
  messages: Message[];
  check?: Check<T>;
  userId: string;
  leadId: string;
}): Promise<{ value: T; model: string }> {
  const { model } = llmConfig();
  const format = z.toJSONSchema(opts.schema);
  const promptChars = opts.messages.reduce((n, m) => n + m.content.length, 0);
  return oneAtATime(async () => {
    const started = performance.now();
    let inputTokens = 0;
    let outputTokens = 0;
    let attempts = 0;
    let validFirstTry = false;
    let groundedFirstTry = false;
    let lastError = "";
    const rawOutputs: string[] = [];
    let messages = opts.messages;

    const log = (ok: boolean, error: string | null) =>
      db
        .insert(llmCalls)
        .values({
          userId: opts.userId,
          leadId: opts.leadId,
          promptType: opts.type,
          model,
          inputTokens,
          outputTokens,
          latencyMs: Math.round(performance.now() - started),
          validFirstTry,
          groundedFirstTry,
          attempts,
          ok,
          error,
          promptChars,
          options: { ...OLLAMA_OPTIONS },
          // Kept whenever an attempt failed, including calls that succeeded on the retry.
          rawOutput:
            ok && attempts === 1
              ? null
              : rawOutputs.join("\n\n----- next attempt -----\n\n").slice(0, MAX_RAW_LOG) || null,
        })
        .catch((err) => console.warn("[llm] couldn't log call:", err));

    try {
      if (promptChars / CHARS_PER_TOKEN > MAX_PROMPT_TOKENS) {
        // Callers trim their input; this is the backstop so nothing is silently cut.
        throw new LlmError(
          `Prompt is about ${Math.round(promptChars / CHARS_PER_TOKEN)} tokens, over the ${MAX_PROMPT_TOKENS} that fit in num_ctx ${OLLAMA_OPTIONS.num_ctx}.`,
          "too_long",
        );
      }
      for (attempts = 1; attempts <= 2; attempts++) {
        const reply = await chat(messages, format);
        let content = "";
        let error: string | undefined;
        let value: T | undefined;
        let jsonOk = false;

        if (reply.kind === "aborted") {
          error = `Ollama aborted the reply because it kept repeating itself (${reply.message}).`;
          rawOutputs.push(`[attempt ${attempts}: aborted by Ollama] ${reply.message}`);
        } else {
          content = reply.content;
          inputTokens += reply.inputTokens;
          outputTokens += reply.outputTokens;
          rawOutputs.push(`[attempt ${attempts}: done_reason=${reply.doneReason}, ${reply.outputTokens} tokens]\n${content}`);
          if (reply.inputTokens >= MAX_PROMPT_TOKENS) {
            console.warn(`[llm] prompt used ${reply.inputTokens} tokens of num_ctx ${OLLAMA_OPTIONS.num_ctx}`);
          }
          ({ value, error, jsonOk } = validate(content, opts.schema, opts.check));
          if (value === undefined && reply.doneReason === "length") {
            error = `The reply hit the ${OLLAMA_OPTIONS.num_predict}-token limit before the JSON finished. Keep every field short.`;
          }
        }

        if (attempts === 1) {
          validFirstTry = jsonOk;
          groundedFirstTry = value !== undefined;
        }
        if (value !== undefined) {
          await log(true, attempts > 1 ? `first attempt rejected: ${lastError}` : null);
          return { value, model };
        }
        lastError = error ?? "Invalid output";
        console.warn(`[llm] ${opts.type} attempt ${attempts} rejected: ${lastError}`);
        // Retry once: show the model its reply and what was wrong with it.
        messages = [
          ...opts.messages,
          ...(content ? [{ role: "assistant" as const, content }] : []),
          {
            role: "user",
            content: `That reply was rejected: ${lastError} Answer again with JSON only, in exactly the shape shown, following every rule.`,
          },
        ];
      }
      attempts = 2;
      await log(false, lastError);
      throw new LlmError(`The model's answer was invalid twice (${lastError}).`, "invalid_output");
    } catch (err) {
      if (err instanceof LlmError && err.kind !== "invalid_output") await log(false, err.message);
      throw err;
    }
  });
}
