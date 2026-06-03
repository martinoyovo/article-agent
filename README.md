# article-agent

An open-source agent that researches and writes articles in a fixed house voice. It runs a six-step pipeline: real web research with citations, an outline, a full draft, a cover graphic in the house palette, a style critic that enforces the rules (no em dashes, inline `[N]` citations, a consistent structure), and a figures pass that adds diagrams only where they help. Every graphic is rendered by deterministic code (`src/design.ts`), never drawn by the model, so it is always clean and on-brand.

Bring your own Anthropic API key. The hosted version never stores it. The voice and rules live in `src/voice.ts`, the part that makes the output yours, and it lifts straight into a Claude skill later.

## Demo

<video src="https://github.com/martinoyovo/article-agent/raw/main/docs/demo.mp4" controls></video>

> If the player does not load, [watch the demo here](https://github.com/martinoyovo/article-agent/raw/main/docs/demo.mp4).

## Use it

Open the web UI, paste your Anthropic API key (it stays in your browser and is sent only with your request), type a topic, and watch the article stream in. You can also call the API directly:

`POST /api/generate` with a topic, key in the `x-anthropic-api-key` header. It streams progress as Server-Sent Events, then a final `result` event with the article markdown and the sources it actually found.

```
event: progress
data: {"step":"research","message":"Searching the web for current sources..."}

event: result
data: {"title":"...","subtitle":"...","markdown":"# ...","sources":[...]}
```

## Run locally

```bash
npm install
npm run build
npm start                   # http://localhost:3000

# or curl the API directly (key in the header):
curl -N -X POST localhost:3000/api/generate \
  -H 'content-type: application/json' \
  -H 'x-anthropic-api-key: sk-ant-...' \
  -d '{"topic":"why local-first agents matter","lengthWords":1500}'
```

`-N` keeps curl from buffering so you see progress stream in. If you would rather not paste a key each time, copy `.env.example` to `.env`, set `ANTHROPIC_API_KEY`, and the server uses it as a fallback.

## Deploy your own

The repo is Vercel-ready: `public/index.html` is the UI, `api/generate.ts` is the serverless endpoint.

```bash
npm i -g vercel
vercel                      # link/create the project
vercel --prod
```

Leave `ANTHROPIC_API_KEY` **unset** on a public deploy so every visitor must bring their own key. Set it only on a private instance where you want a fallback.

Timeouts: the full pipeline takes a couple of minutes. `maxDuration` is 300s in `vercel.json`. With Fluid Compute (on by default), the free Hobby plan allows up to 300s per function, so it fits. Pro raises the ceiling to 800s if you ever need more. If Fluid Compute is off, enable it in Project Settings, otherwise the function is capped lower. You can also deploy to a long-running host with no timeout ceiling (Railway, Render, Fly): build `npm install && npm run build`, start `npm start`. `GET /health` returns `{"ok":true}` for health checks.

## Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | (optional) | Fallback key. Leave unset on public deploys so callers bring their own. |
| `DRAFT_MODEL` | `claude-sonnet-4-6` | model for the draft step |
| `FAST_MODEL` | `claude-haiku-4-5-20251001` | research, outline, critic |
| `RATE_LIMIT_MAX` | `5` | requests allowed per IP per window |
| `RATE_LIMIT_WINDOW_SEC` | `60` | rate limit window in seconds |

## Cost note

Each run is four model calls plus up to 6 web searches, billed to whichever key made the request. Research, outline, and critic use the fast model; only the draft uses the stronger one.

## Rate limiting

Bring-your-own-key means abuse spends the caller's tokens, not the host's. The remaining concern is compute, so each endpoint caps requests per IP (default 5 per 60s, tunable above). The limiter is in process memory, so on serverless it is per-instance, not global. That stops casual hammering. For hard, global limits in production, add [Vercel Firewall rate limiting](https://vercel.com/docs/security/vercel-waf/rate-limiting) or back the limiter with a shared store (Upstash Redis).

## Roadmap

- More figure templates (timelines, callout quotes) and embedded Inter for pixel-exact PNG text.
- Companion deliverables: tweet thread, LinkedIn caption, platform variants.
- Async job pattern so it runs on any plan without timeout limits.
- Package the voice rules as a Claude skill so the same logic runs in Claude Code.

## License

MIT. See [LICENSE](LICENSE).
