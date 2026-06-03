import Anthropic from "@anthropic-ai/sdk";
import { createClient, MODELS, textOf, parseJson } from "./claude.js";
import { VOICE, stripEmDashes } from "./voice.js";

export interface ArticleInput {
  topic: string;
  audience?: string;
  lengthWords?: number;
  // Bring your own key. When omitted, the server env var is used (self-host).
  apiKey?: string;
}

export interface Finding {
  point: string;
  source: string;
  url: string;
  claim: string;
}

export interface Research {
  framing: string;
  findings: Finding[];
}

export interface Outline {
  title: string;
  subtitle: string;
  sections: { h: string; beats: string[] }[];
}

export interface ArticleResult {
  title: string;
  subtitle: string;
  markdown: string;
  sources: Finding[];
  coverSvg: string;
}

export type Progress = (step: string, message: string) => void;

// 1. Research, with real server-side web search. Returns cited findings.
async function research(
  client: Anthropic,
  topic: string,
  audience: string,
  onProgress: Progress,
): Promise<Research> {
  onProgress("research", "Searching the web for current sources...");
  const msg = await client.messages.create({
    model: MODELS.fast,
    max_tokens: 2500,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }],
    system:
      "You are a research assistant. Search the web for current, credible sources about the topic. " +
      "Prefer primary and recent sources. Then return ONLY a JSON object, no prose, no code fences:\n" +
      '{"framing":"the one fact that frames the whole piece",' +
      '"findings":[{"point":"what this shows","source":"Publication name","url":"https://real-url","claim":"one line"}]}\n' +
      "Include 5 to 8 findings. Every url must be a real link you actually found in search results.",
    messages: [{ role: "user", content: `Topic: ${topic}\nAudience: ${audience}` }],
  });
  return parseJson<Research>(textOf(msg));
}

// 2. Outline, in house structure.
async function outline(
  client: Anthropic,
  topic: string,
  audience: string,
  r: Research,
  onProgress: Progress,
): Promise<Outline> {
  onProgress("outline", "Shaping the spine...");
  const msg = await client.messages.create({
    model: MODELS.fast,
    max_tokens: 1800,
    system:
      VOICE +
      '\n\nReturn ONLY JSON: {"title":"...","subtitle":"...","sections":[{"h":"section heading","beats":["concrete beat","concrete beat"]}]}',
    messages: [
      {
        role: "user",
        content: `Topic: ${topic}\nAudience: ${audience}\nFraming: ${r.framing}\nResearch findings:\n${JSON.stringify(
          r.findings,
        )}`,
      },
    ],
  });
  return parseJson<Outline>(textOf(msg));
}

// 3. Draft, full article in voice with inline citations.
async function draft(
  client: Anthropic,
  topic: string,
  audience: string,
  r: Research,
  o: Outline,
  lengthWords: number,
  onProgress: Progress,
): Promise<string> {
  onProgress("draft", "Writing the draft...");
  const msg = await client.messages.create({
    model: MODELS.draft,
    max_tokens: 8000,
    system:
      VOICE +
      `\n\nWrite the full article in Markdown. Target ${lengthWords} words. ` +
      `Use inline [N] citations that map to the "### Sources" list. ` +
      `Source format: [N] Source name, short description. <URL>. ` +
      `Use ONLY the real URLs provided in the research. No em dashes anywhere.`,
    messages: [
      {
        role: "user",
        content: `Topic: ${topic}\nAudience: ${audience}\nFraming: ${r.framing}\nOutline:\n${JSON.stringify(
          o,
        )}\nResearch (cite these real URLs):\n${JSON.stringify(r.findings)}`,
      },
    ],
  });
  return textOf(msg);
}

// 4. Style critic, enforces the rules and rewrites violations.
async function critic(client: Anthropic, article: string, onProgress: Progress): Promise<string> {
  onProgress("critic", "Enforcing voice and citation format...");
  const msg = await client.messages.create({
    model: MODELS.fast,
    max_tokens: 8000,
    system:
      VOICE +
      "\n\nYou are a style editor. Rewrite the article to fix every violation of the rules above: " +
      "remove ALL em dashes, ensure inline [N] markers map to the Sources list, and ensure each source " +
      "is formatted exactly as [N] Source name, description. <URL>. " +
      "Keep the author's voice and every fact and citation intact. Return ONLY the corrected Markdown.",
    messages: [{ role: "user", content: article }],
  });
  return stripEmDashes(textOf(msg));
}

// 5. Cover graphic. The model returns one self-contained SVG in the house
// palette. Runs alongside the draft. If the output is unusable, a deterministic
// on-brand template ships instead, so an image always comes back.
async function graphics(
  client: Anthropic,
  topic: string,
  r: Research,
  o: Outline,
  onProgress: Progress,
): Promise<string> {
  onProgress("graphics", "Designing the cover...");
  try {
    const msg = await client.messages.create({
      model: MODELS.fast,
      max_tokens: 2000,
      system:
        'You design one cover graphic as a single self-contained SVG. ' +
        'Requirements: root <svg> with viewBox="0 0 1200 630", width="1200", height="630". ' +
        'House palette only: coral #FF7A5C, green #5FB78A, lavender #A78ECC, ink #1C1B22, off-white #FAF9FB. ' +
        'font-family="Inter, system-ui, sans-serif". Sharp corners only, never rounded (no rx/ry). ' +
        'Show the article title large and bold, wrapped with <tspan> lines of about 18 characters each, ' +
        'plus one short framing line. Use bold geometric blocks of the palette and at least one ' +
        'filled triangle arrowhead as a <polygon>. ' +
        'Forbidden: <image>, <foreignObject>, <script>, url() references, external fonts or links. ' +
        'Return ONLY the SVG markup, no prose, no code fences.',
      messages: [
        {
          role: "user",
          content: `Title: ${o.title}\nSubtitle: ${o.subtitle}\nFraming: ${r.framing}\nTopic: ${topic}`,
        },
      ],
    });
    const svg = extractSvg(textOf(msg));
    if (svg) return sanitizeSvg(svg);
  } catch {
    // fall through to the template
  }
  return fallbackCover(o.title, o.subtitle || r.framing);
}

// Pull the <svg>...</svg> out of the model output, tolerating fences or prose.
function extractSvg(raw: string): string | null {
  const s = raw.replace(/```(svg|xml|html)?/gi, "").replace(/```/g, "");
  const start = s.indexOf("<svg");
  const end = s.lastIndexOf("</svg>");
  if (start >= 0 && end > start) return s.slice(start, end + 6);
  return null;
}

// The SVG is rendered as inline markup in the browser, so strip anything that
// could execute or load external resources before it reaches the client.
function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/(xlink:href|href)\s*=\s*"(?!#)[^"]*"/gi, "")
    .replace(/(xlink:href|href)\s*=\s*'(?!#)[^']*'/gi, "");
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function wrapWords(text: string, perLine: number, maxLines: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const w of text.split(/\s+/)) {
    if (cur && (cur + " " + w).length > perLine) {
      lines.push(cur);
      cur = w;
    } else {
      cur = cur ? cur + " " + w : w;
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, maxLines);
}

// Deterministic on-brand cover, used when the model output is missing or bad.
function fallbackCover(title: string, subtitle: string): string {
  const lines = wrapWords(title, 20, 4);
  const tspans = lines
    .map((l, i) => `<tspan x="80" dy="${i === 0 ? 0 : 78}">${escapeXml(l)}</tspan>`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <rect width="1200" height="630" fill="#FAF9FB"/>
  <rect x="0" y="0" width="1200" height="16" fill="#FF7A5C"/>
  <rect x="0" y="0" width="16" height="630" fill="#5FB78A"/>
  <rect x="980" y="110" width="120" height="120" fill="#5FB78A"/>
  <rect x="1040" y="170" width="120" height="120" fill="#FF7A5C" opacity="0.9"/>
  <polygon points="1050,470 1170,540 1050,610" fill="#A78ECC"/>
  <text x="80" y="210" font-family="Inter, system-ui, sans-serif" font-size="64" font-weight="700" fill="#1C1B22">${tspans}</text>
  <text x="80" y="572" font-family="Inter, system-ui, sans-serif" font-size="28" font-weight="500" fill="#6B6975">${escapeXml(subtitle).slice(0, 80)}</text>
</svg>`;
}

export async function generateArticle(
  input: ArticleInput,
  onProgress: Progress = () => {},
): Promise<ArticleResult> {
  const audience = input.audience ?? "developers and builders";
  const lengthWords = input.lengthWords ?? 1500;
  const client = createClient(input.apiKey);

  const r = await research(client, input.topic, audience, onProgress);
  const o = await outline(client, input.topic, audience, r, onProgress);
  // The draft and the cover both depend only on the outline and research, so
  // run them concurrently to save a model round trip of latency.
  const [d, coverSvg] = await Promise.all([
    draft(client, input.topic, audience, r, o, lengthWords, onProgress),
    graphics(client, input.topic, r, o, onProgress),
  ]);
  const final = await critic(client, d, onProgress);

  onProgress("done", "Article ready.");
  return { title: o.title, subtitle: o.subtitle, markdown: final, sources: r.findings, coverSvg };
}
