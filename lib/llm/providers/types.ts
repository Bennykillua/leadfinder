// Shared by the model providers (Ollama locally, OpenRouter in production) and the
// generateJson pipeline that sits on top of them.

export type Message = { role: "system" | "user" | "assistant"; content: string };

export class LlmError extends Error {
  constructor(
    message: string,
    readonly kind: "unavailable" | "model_missing" | "invalid_output" | "timeout" | "config" | "too_long" | "no_evidence",
  ) {
    super(message);
  }
}

export type ChatResult =
  // costUsd: what the provider billed for this reply, when it says (OpenRouter).
  | { kind: "reply"; content: string; inputTokens: number; outputTokens: number; doneReason: string; costUsd?: number }
  // The provider stopped or failed this one reply (Ollama's repeat limit, an
  // OpenRouter host erroring): a bad attempt, worth the one retry.
  | { kind: "aborted"; message: string };

export type Provider = {
  name: "ollama" | "openrouter";
  model: string;
  // What's sent besides the messages, logged with every call.
  options: Record<string, unknown>;
  // Calls run one at a time (a local model on one machine doesn't run two faster).
  serial: boolean;
  // Reply token budget, if the provider enforces one (to explain a cut-off reply).
  maxOutputTokens?: number;
  // schema: the JSON schema of the answer. retry: second attempt.
  chat(messages: Message[], schema: unknown, retry: boolean): Promise<ChatResult>;
};

export const TIMEOUT_MS = 180_000;

export function timeoutOrUnavailable(err: unknown, unavailable: string): LlmError {
  const e = err as { name?: string };
  if (e?.name === "TimeoutError") {
    return new LlmError(`The model took longer than ${TIMEOUT_MS / 1000}s to answer.`, "timeout");
  }
  return new LlmError(unavailable, "unavailable");
}
