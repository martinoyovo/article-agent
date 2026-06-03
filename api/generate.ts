import type { IncomingMessage, ServerResponse } from "node:http";
import { generateArticle } from "../src/pipeline.js";
import { rateLimit, clientKey } from "../src/rateLimit.js";

// Minimal local types for the Vercel Node handler. We only use the few members
// below, so we extend Node's own http types instead of depending on
// @vercel/node (a dev-only package whose transitive deps carry CVEs).
type VercelRequest = IncomingMessage & { body?: unknown };
type VercelResponse = ServerResponse & {
  status: (code: number) => VercelResponse;
  json: (body: unknown) => void;
};

// Allow the pipeline time to run. Requires a Vercel plan that permits this
// duration. With Fluid Compute (default on), the free Hobby plan allows 300s.
export const config = { maxDuration: 300 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }

  // Rate limit before doing any work or opening the stream.
  const gate = rateLimit(clientKey(req.headers["x-forwarded-for"], req.socket?.remoteAddress));
  res.setHeader("X-RateLimit-Limit", String(gate.limit));
  res.setHeader("X-RateLimit-Remaining", String(gate.remaining));
  if (!gate.ok) {
    res.setHeader("Retry-After", String(gate.retryAfterSec));
    res.status(429).json({ error: `Rate limit exceeded. Try again in ${gate.retryAfterSec}s.` });
    return;
  }

  const { topic, audience, lengthWords } = (req.body ?? {}) as {
    topic?: string;
    audience?: string;
    lengthWords?: number;
  };

  if (!topic) {
    res.status(400).json({ error: "topic is required" });
    return;
  }

  // Bring your own key, sent per request. Never stored or logged. Falls back
  // to the server env var when self-hosting.
  const headerKey = req.headers["x-anthropic-api-key"];
  const apiKey = Array.isArray(headerKey) ? headerKey[0] : headerKey;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  const send = (event: string, data: unknown) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    const result = await generateArticle(
      { topic, audience, lengthWords, apiKey },
      (step, message) => send("progress", { step, message }),
    );
    send("result", result);
  } catch (e) {
    send("error", { message: e instanceof Error ? e.message : String(e) });
  } finally {
    res.end();
  }
}
