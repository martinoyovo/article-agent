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

// 5. Cover graphic. The model never draws. It only extracts an optional
// headline stat (plain text) from the research. All geometry is the
// deterministic code below, so shapes sit in fixed margins and can never
// overlap or clip the type. A clean cover always ships.
async function graphics(
  client: Anthropic,
  topic: string,
  r: Research,
  o: Outline,
  onProgress: Progress,
): Promise<string> {
  onProgress("graphics", "Designing the cover...");
  let stat: string | null = null;
  let statLabel: string | null = null;
  try {
    const msg = await client.messages.create({
      model: MODELS.fast,
      max_tokens: 300,
      system:
        "From the research, pick the single most striking headline number for a cover. " +
        'Return ONLY JSON: {"stat":"79%","statLabel":"of agent deployments fail"} where stat is a ' +
        "short number or percentage (max 6 characters) and statLabel is at most 6 words. " +
        'If there is no strong number, return {"stat":null,"statLabel":null}. No prose, no code fences.',
      messages: [
        {
          role: "user",
          content: `Framing: ${r.framing}\nFindings: ${JSON.stringify(r.findings)}\nTopic: ${topic}`,
        },
      ],
    });
    const parsed = parseJson<{ stat: string | null; statLabel: string | null }>(textOf(msg));
    if (parsed.stat && parsed.statLabel) {
      stat = parsed.stat.slice(0, 6);
      statLabel = parsed.statLabel;
    }
  } catch {
    // No stat is fine; the cover renders cleanly without one.
  }
  return renderCover(o.title, o.subtitle || r.framing, stat, statLabel);
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Greedy word wrap to a character budget, capped at maxLines.
function wrapWords(text: string, perLine: number, maxLines: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const w of (text || "").split(/\s+/)) {
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

// Largest font size at which the title fits in <=4 lines in the given column.
// Inter bold runs roughly 0.56 em per character.
function layoutTitle(title: string, colW: number): { size: number; lines: string[] } {
  for (const size of [76, 68, 60, 52]) {
    const perLine = Math.max(6, Math.floor(colW / (size * 0.56)));
    const lines = wrapWords(title, perLine, 6);
    if (lines.length <= 4) return { size, lines };
  }
  const size = 48;
  const perLine = Math.max(6, Math.floor(colW / (size * 0.56)));
  return { size, lines: wrapWords(title, perLine, 4) };
}

// Fully deterministic cover. The model supplies only text; this owns every
// coordinate. Decoration lives strictly in the right margin and corners, and
// the title column is narrowed when a stat panel is present, so nothing can
// collide. Title and subtitle are vertically centered as one block.
export function renderCover(
  title: string,
  subtitle: string,
  stat: string | null,
  statLabel: string | null,
): string {
  const W = 1200;
  const H = 630;
  const M = 80;
  const hasStat = !!(stat && statLabel);
  const colW = hasStat ? 540 : 760;

  const { size, lines } = layoutTitle(title, colW);
  const lh = Math.round(size * 1.1);
  const subLines = wrapWords(subtitle, Math.floor(colW / 13), 2);

  const titleBlockH = (lines.length - 1) * lh;
  const subBlockH = (subLines.length - 1) * 34;
  const totalH = titleBlockH + 56 + subBlockH;
  const titleTop = Math.round((H - totalH) / 2) + Math.round(size * 0.34);

  const titleTspans = lines
    .map((l, i) => `<tspan x="${M}" dy="${i === 0 ? 0 : lh}">${escapeXml(l)}</tspan>`)
    .join("");
  const subStartY = titleTop + titleBlockH + 56;
  const subTspans = subLines
    .map((l, i) => `<tspan x="${M}" dy="${i === 0 ? 0 : 34}">${escapeXml(l)}</tspan>`)
    .join("");

  const decor = hasStat
    ? `<polygon points="1092,72 1148,104 1092,136" fill="#A78ECC"/>`
    : `<rect x="900" y="118" width="150" height="150" fill="#5FB78A"/>
  <rect x="978" y="196" width="150" height="150" fill="#FF7A5C" opacity="0.92"/>
  <polygon points="900,430 992,476 900,522" fill="#A78ECC"/>`;

  let statPanel = "";
  if (hasStat) {
    const labelTspans = wrapWords(statLabel!, 22, 3)
      .map((l, i) => `<tspan x="700" dy="${i === 0 ? 0 : 34}">${escapeXml(l)}</tspan>`)
      .join("");
    statPanel = `<rect x="660" y="150" width="460" height="372" fill="#1C1B22"/>
  <text x="700" y="322" font-family="Inter, system-ui, sans-serif" font-size="108" font-weight="700" fill="#FF7A5C">${escapeXml(
    stat!,
  )}</text>
  <text x="700" y="388" font-family="Inter, system-ui, sans-serif" font-size="26" font-weight="600" fill="#FAF9FB">${labelTspans}</text>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="#FAF9FB"/>
  <rect x="0" y="0" width="${W}" height="12" fill="#FF7A5C"/>
  ${decor}
  ${statPanel}
  <text x="${M}" y="${titleTop}" font-family="Inter, system-ui, sans-serif" font-size="${size}" font-weight="700" fill="#1C1B22" letter-spacing="-0.5">${titleTspans}</text>
  <text x="${M}" y="${subStartY}" font-family="Inter, system-ui, sans-serif" font-size="24" font-weight="500" fill="#6B6975">${subTspans}</text>
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
