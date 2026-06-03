import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { generateArticle } from "./pipeline.js";
import { rateLimit, clientKey } from "./rateLimit.js";

const port = process.env.PORT ? Number(process.env.PORT) : 3000;

// public/ sits next to the project root. From dist/src/server.js that is ../../public.
const here = dirname(fileURLToPath(import.meta.url));
const indexPath = join(here, "..", "..", "public", "index.html");

// The caller's key arrives in this header. It is used per request and never
// stored or logged. Falls back to ANTHROPIC_API_KEY when self-hosting.
function keyFrom(req: http.IncomingMessage): string | undefined {
  const h = req.headers["x-anthropic-api-key"];
  return Array.isArray(h) ? h[0] : h;
}

http
  .createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
      readFile(indexPath)
        .then((html) => {
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end(html);
        })
        .catch(() => {
          res.writeHead(404, { "content-type": "text/plain" });
          res.end("UI not found. Run npm run build first.");
        });
      return;
    }

    if (req.method === "POST" && (req.url === "/generate" || req.url === "/api/generate")) {
      const gate = rateLimit(clientKey(req.headers["x-forwarded-for"], req.socket.remoteAddress));
      if (!gate.ok) {
        res.writeHead(429, {
          "content-type": "application/json",
          "retry-after": String(gate.retryAfterSec),
          "x-ratelimit-limit": String(gate.limit),
          "x-ratelimit-remaining": "0",
        });
        res.end(JSON.stringify({ error: `Rate limit exceeded. Try again in ${gate.retryAfterSec}s.` }));
        return;
      }

      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", async () => {
        try {
          const { topic, audience, lengthWords } = JSON.parse(body || "{}");
          if (!topic) {
            res.writeHead(400, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "topic is required" }));
            return;
          }
          res.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
            "x-ratelimit-limit": String(gate.limit),
            "x-ratelimit-remaining": String(gate.remaining),
          });
          const send = (event: string, data: unknown) =>
            res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

          try {
            const result = await generateArticle(
              { topic, audience, lengthWords, apiKey: keyFrom(req) },
              (step, message) => send("progress", { step, message }),
            );
            send("result", result);
          } catch (e) {
            send("error", { message: e instanceof Error ? e.message : String(e) });
          }
          res.end();
        } catch (e) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end();
  })
  .listen(port, () => console.log(`article-agent listening on :${port}`));
