/**
 * Lazily-constructed OpenAI client.
 * Uses the user-provided OPENAI_API_KEY secret. Returns null when no key is
 * configured so callers can degrade gracefully (e.g. fall back to raw stops).
 */
import OpenAI from "openai";

let cached: OpenAI | null | undefined;

export function getAIClient(): OpenAI | null {
  if (cached !== undefined) return cached;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    cached = null;
    return null;
  }
  // AI_INTEGRATIONS_OPENAI_BASE_URL is honoured when present,
  // otherwise the SDK targets api.openai.com with the user's own key.
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || undefined;
  // Bounded timeout + retries so a single hung request never stalls a batch run.
  // Tuned for bulk enrichment: a single ~45 s attempt with one retry keeps slow-
  // but-valid breadcrumb responses succeeding while capping the worst-case wait.
  cached = new OpenAI({ apiKey, baseURL, timeout: 45_000, maxRetries: 1 });
  return cached;
}

export function getAIModel(): string {
  return process.env.OPENAI_MODEL || "gpt-4o-mini";
}
