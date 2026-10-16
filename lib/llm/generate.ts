import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { llmCalls } from "@/lib/db/schema";
import { currentProvider } from "./providers";
import { OLLAMA_OPTIONS } from "./providers/ollama";
import { LlmError, type Message } from "./providers/types";

// Structured JSON from the model, the same way on every provider (LLM_PROVIDER:
// Ollama locally, OpenRouter in production; see ./providers).
// - The JSON schema comes from the zod schema, and the reply is validated with the
//   same zod schema (plus an optional `check` for rules zod can't express).
// - Invalid output (bad JSON, failed check, cut off, or the provider aborting a
//   reply) gets one retry, with the problem fed back to the model.
// - Ollama runs one model call at a time: a local model on one machine doesn't run
//   two faster.
// - Every call is logged to llm_call with its provider; failed calls also keep the
//   raw output of each attempt, the prompt size and the options, for debugging.

// Rough size check so a prompt never silently overflows num_ctx (Ollama would cut
// the start of it off; kept for OpenRouter too, so both run the same prompts).
// ~3.5 characters per token for English text.
const CHARS_PER_TOKEN = 3.5;
const MAX_PROMPT_TOKENS = OLLAMA_OPTIONS.num_ctx - OLLAMA_OPTIONS.num_predict - 256;
const MAX_RAW_LOG = 8000;

export type PromptType = "deep_read" | "pitch";
export { LlmError, type Message };

let queue: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

// Returns an error message if the parsed value breaks a rule, or null if it's fine.
export type Check<T> = (value: T) => string | null;

// jsonOk: parsed and matched the schema. value: also passed the check. parsed: the
// schema-valid value even if the check failed (for salvage).
function validate<T>(
  content: string,
  schema: z.ZodType<T>,
  check?: Check<T>,
): { value?: T; parsed?: T; error?: string; jsonOk: boolean } {
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
  return problem
    ? { parsed: parsed.data, error: problem, jsonOk: true }
    : { value: parsed.data, parsed: parsed.data, jsonOk: true };
}

export async function generateJson<T>(opts: {
  type: PromptType;
  schema: z.ZodType<T>;
  messages: Message[];
  check?: Check<T>;
  // Last resort after the retry also fails its check: repair the schema-valid answer
  // (drop or replace the parts that broke a rule). Return null if nothing is usable.
  salvage?: (value: T) => T | null;
  userId: string;
  leadId: string;
}): Promise<{ value: T; model: string }> {
  const provider = currentProvider();
  const { model } = provider;
  const format = z.toJSONSchema(opts.schema);
  const promptChars = opts.messages.reduce((n, m) => n + m.content.length, 0);
  const run = async () => {
    const started = performance.now();
    let inputTokens = 0;
    let outputTokens = 0;
    let costUsd: number | null = null;
    let attempts = 0;
    let validFirstTry = false;
    let groundedFirstTry = false;
    let lastError = "";
    let lastParsed: T | undefined;
    const rawOutputs: string[] = [];
    let messages = opts.messages;

    const log = (ok: boolean, error: string | null) =>
      db
        .insert(llmCalls)
        .values({
          userId: opts.userId,
          leadId: opts.leadId,
          promptType: opts.type,
          provider: provider.name,
          model,
          inputTokens,
          outputTokens,
          costUsd,
          latencyMs: Math.round(performance.now() - started),
          validFirstTry,
          groundedFirstTry,
          attempts,
          ok,
          error,
          promptChars,
          options: provider.options,
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
        const reply = await provider.chat(messages, format, attempts > 1);
        let content = "";
        let error: string | undefined;
        let value: T | undefined;
        let jsonOk = false;
        let parsed: T | undefined;

        if (reply.kind === "aborted") {
          error =
            provider.name === "ollama"
              ? `Ollama aborted the reply because it kept repeating itself (${reply.message}).`
              : `The model's run failed (${reply.message}).`;
          rawOutputs.push(`[attempt ${attempts}: aborted by ${provider.name}] ${reply.message}`);
        } else {
          content = reply.content;
          inputTokens += reply.inputTokens;
          outputTokens += reply.outputTokens;
          if (reply.costUsd !== undefined) costUsd = (costUsd ?? 0) + reply.costUsd;
          rawOutputs.push(`[attempt ${attempts}: done_reason=${reply.doneReason}, ${reply.outputTokens} tokens]\n${content}`);
          if (provider.name === "ollama" && reply.inputTokens >= MAX_PROMPT_TOKENS) {
            console.warn(`[llm] prompt used ${reply.inputTokens} tokens of num_ctx ${OLLAMA_OPTIONS.num_ctx}`);
          }
          ({ value, parsed, error, jsonOk } = validate(content, opts.schema, opts.check));
          if (parsed !== undefined) lastParsed = parsed;
          if (value === undefined && reply.doneReason === "length") {
            error = `The reply hit the ${provider.maxOutputTokens ?? "output"}-token limit before the JSON finished. Keep every field short.`;
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
        // Retry once: show the model its reply and what was wrong with it. The reply is
        // re-written as compact JSON: echoing a broken one (runs of whitespace, JSON
        // spilled into a string) primes the model to repeat it until Ollama aborts.
        messages = [
          ...opts.messages,
          ...(parsed !== undefined ? [{ role: "assistant" as const, content: JSON.stringify(parsed) }] : []),
          {
            role: "user",
            content: `That reply was rejected: ${lastError} Answer again with JSON only, in exactly the shape shown, following every rule.`,
          },
        ];
      }
      attempts = 2;
      const salvaged = lastParsed !== undefined ? opts.salvage?.(lastParsed) : null;
      if (salvaged) {
        await log(true, `salvaged after two rejections: ${lastError}`);
        return { value: salvaged, model };
      }
      await log(false, lastError);
      throw new LlmError(`The model's answer was invalid twice (${lastError}).`, "invalid_output");
    } catch (err) {
      if (err instanceof LlmError && err.kind !== "invalid_output") await log(false, err.message);
      throw err;
    }
  };
  return provider.serial ? oneAtATime(run) : run();
}
