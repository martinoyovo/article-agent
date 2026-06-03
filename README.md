# article-agent

An open-source agent that researches and writes articles in a fixed house voice. It runs a four-step pipeline: real web research with citations, an outline, a full draft, and a style critic that enforces the rules (no em dashes, inline `[N]` citations, a consistent structure).

Bring your own Anthropic API key. The hosted version never stores it. The voice and rules live in `src/voice.ts`, the part that makes the output yours, and it lifts straight into a Claude skill later.

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

Timeouts: the full pipeline takes a couple of minutes. `maxDuration` is 300s in `vercel.json`, which needs a Pro plan. On Hobby (60s cap) the request times out before finishing. To stay on Hobby, deploy to a long-running host instead (Railway, Render, Fly): build `npm install && npm run build`, start `npm start`, no timeout ceiling. `GET /health` returns `{"ok":true}` for health checks.

## Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | (optional) | Fallback key. Leave unset on public deploys so callers bring their own. |
| `DRAFT_MODEL` | `claude-sonnet-4-6` | model for the draft step |
| `FAST_MODEL` | `claude-haiku-4-5-20251001` | research, outline, critic |

## Cost note

Each run is four model calls plus up to 6 web searches, billed to whichever key made the request. Research, outline, and critic use the fast model; only the draft uses the stronger one.

## Roadmap

- Graphics step: SVG in the house palette rendered to PNG via `@resvg/resvg-js`.
- Companion deliverables: tweet thread, LinkedIn caption, platform variants.
- Async job pattern so it runs on any plan without timeout limits.
- Package the voice rules as a Claude skill so the same logic runs in Claude Code.

## License

MIT. See [LICENSE](LICENSE).
