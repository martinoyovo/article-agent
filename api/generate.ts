import type { VercelRequest, VercelResponse } from "@vercel/node";
import { generateArticle } from "../src/pipeline.js";

// Allow the pipeline time to run. Requires a Vercel plan that permits this
// duration (Hobby caps at 60s, which is not enough; Pro allows up to 300s).
export const config = { maxDuration: 300 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
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
