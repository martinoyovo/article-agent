import Anthropic from "@anthropic-ai/sdk";

// Create a client per request. The key can come from the caller (bring your
// own key, used by the public deploy) or fall back to the server env var (used
// when you self-host or run locally). The key is never stored or logged.
export function createClient(apiKey?: string): Anthropic {
  const key = apiKey?.trim() || process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error(
      "No Anthropic API key. Pass one with the request or set ANTHROPIC_API_KEY.",
    );
  }
  return new Anthropic({ apiKey: key });
}

// Models are env-configurable so you can swap without touching code.
export const MODELS = {
  draft: process.env.DRAFT_MODEL ?? "claude-sonnet-4-6",
  fast: process.env.FAST_MODEL ?? "claude-haiku-4-5-20251001",
};

export function textOf(msg: Anthropic.Message): string {
  return msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

// Robust JSON extraction: tolerate code fences and surrounding prose.
export function parseJson<T>(raw: string): T {
  let s = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end >= 0) s = s.slice(start, end + 1);
  return JSON.parse(s) as T;
}
