# CLAUDE.md

Project context for Claude Code. Read this before making changes.

## What this is

`article-agent` is an open-source agent that researches and writes articles in the author's house voice. It runs a deterministic four-step pipeline:

1. **research** (`src/pipeline.ts`) — real web search via the Anthropic server-side `web_search` tool, returns cited findings with live URLs.
2. **outline** — shapes the spine in house structure.
3. **draft** — full article in voice, with inline `[N]` citations.
4. **critic** — a style editor pass that enforces the rules and rewrites violations.

The orchestration is plain code; Claude is called only for the cognitive steps. This is deliberate: deterministic control flow, model for judgment.

## Bring your own key

The pipeline takes an optional `apiKey` per request. The web UI and both endpoints read it from the `x-anthropic-api-key` header, fall back to the `ANTHROPIC_API_KEY` env var, and never store or log it. This is what makes a public deploy safe: leave the env var unset and every caller spends their own tokens, not yours. `createClient()` in `src/claude.ts` is the single place the key turns into a client.

## File map

- `src/pipeline.ts` — the agent. The four steps and `generateArticle()`. Each step takes the per-request client.
- `src/voice.ts` — the encoded house style and the em-dash safety net. **This is the part that makes the output the author's, not generic. Treat it as the most important file.** It is meant to lift into a Claude skill later.
- `src/claude.ts` — `createClient(apiKey?)`, model config, JSON parsing helpers.
- `src/rateLimit.ts` — per-IP fixed-window rate limiter, dependency-free. Shared by both endpoints.
- `src/server.ts` — standalone Node server (`/`, `/api/generate`, `/health`), host-agnostic. Serves the UI.
- `api/generate.ts` — Vercel serverless endpoint, streaming SSE. Uses local http-based types, not `@vercel/node` (removed to drop its CVE-bearing dev deps).
- `public/index.html` — the web UI. Single file, house palette, key stored in localStorage only.

## Conventions

- TypeScript, ESM (`"type": "module"`, NodeNext). Import local files with the `.js` extension.
- The pipeline is a pure async function with a progress callback. Keep it runtime-agnostic. Do not couple it to Vercel or to the standalone server.
- **Output rule, non-negotiable: never emit em dashes.** `voice.ts` enforces this both in the prompt and mechanically via `stripEmDashes`.
- Citations are inline `[N]` mapping to a `### Sources` list, one entry per source, format `[N] Source name, description. <URL> (accessed DATE)`. Never invent URLs.
- Models are env-configurable. Do not hardcode model IDs in new code; read from `MODELS` in `src/claude.ts`.
- The endpoint path is `/api/generate` on both the server and Vercel, so the UI posts to one path everywhere.

## Run / build / deploy

```bash
npm install
npm run build
npm start                   # standalone on :3000, serves the UI
```

Vercel: `vercel`, then `vercel --prod`. Leave `ANTHROPIC_API_KEY` unset on public deploys. `maxDuration` is 300s. With Fluid Compute (default on), the free Hobby plan allows up to 300s, so it fits; Pro raises the ceiling to 800s. Make sure Fluid Compute is enabled.

Long-running hosts (Railway/Render/Fly): build `npm install && npm run build`, start `npm start`. No timeout ceiling.

## Guardrails

- Never commit `.env`, `node_modules`, or `dist` (already in `.gitignore`).
- The key is BYOK, so a public deploy does not spend the author's tokens. Compute abuse is capped by a per-IP rate limiter (`src/rateLimit.ts`, default 5/60s). It is in-memory, so per-instance on serverless, best-effort. For global limits use Vercel Firewall rate limiting or a shared store (Upstash Redis).

## Roadmap (pick these up)

1. **Graphics step** — generate SVGs in the house palette (coral #FF7A5C, green #5FB78A, lavender #A78ECC, Inter font, sharp corners, filled triangle arrowheads) and render to PNG at 2400px via `@resvg/resvg-js` (serverless-safe, embeds fonts). Do not use cairosvg (Python, painful in serverless).
2. **Companion deliverables** — tweet thread (10 to 12), LinkedIn caption mirroring the intro verbatim, IG/X/WhatsApp variants.
3. **Async job pattern** — kick off, store, poll. Removes the timeout ceiling so it runs on any plan.
4. **Global rate limit** — the in-memory per-IP limiter is best-effort on serverless. For hard limits add Vercel Firewall rate limiting or back `rateLimit.ts` with Upstash Redis.
5. **Package `voice.ts` as a Claude skill** so the same rules run inside Claude Code.
