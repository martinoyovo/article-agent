import Anthropic from "@anthropic-ai/sdk";
import { createClient, MODELS, textOf, parseJson } from "./claude.js";
import { VOICE, stripEmDashes } from "./voice.js";
import { renderCover, renderFigure, type Figure } from "./design.js";

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
  figures: { anchor: string; svg: string }[];
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

// 6. Figures. After the article is final, the model decides whether any
// diagram genuinely helps and, if so, picks a template and fills its text
// slots. It may return none. renderFigure() draws each deterministically and
// each is inserted into the markdown right after its section heading.
const FIGURE_PLANNER = `You decide what visuals, if any, an article needs. Do NOT add a figure for its own sake; include one only where it genuinely aids understanding. Return 0 to 3 figures total.

Read the article. For each figure, choose the template that fits the content and copy the exact text of the section heading it belongs under into "anchor".

Templates and fields:
- stat: one striking number. {"type":"stat","anchor":"...","stat":"79%","label":"of agent deployments fail"} (stat max 6 chars, label max 8 words)
- steps: an ordered process of 2 to 5 short steps. {"type":"steps","anchor":"...","title":"optional","steps":["...","..."]} (each step max 10 words)
- comparison: two sides. {"type":"comparison","anchor":"...","leftTitle":"...","leftPoints":["..."],"rightTitle":"...","rightPoints":["..."]} (up to 4 points per side, each max 8 words)
- bar: compare 2 to 5 quantities. {"type":"bar","anchor":"...","title":"optional","bars":[{"label":"...","value":42}]} (numeric values only)

Return ONLY JSON: {"figures":[ ... ]}. If nothing helps, return {"figures":[]}. No prose, no code fences.`;

async function figures(
  client: Anthropic,
  markdown: string,
  onProgress: Progress,
): Promise<{ markdown: string; figures: { anchor: string; svg: string }[] }> {
  onProgress("figures", "Designing diagrams where they help...");
  try {
    const msg = await client.messages.create({
      model: MODELS.fast,
      max_tokens: 1500,
      system: FIGURE_PLANNER,
      messages: [{ role: "user", content: markdown }],
    });
    const plan = parseJson<{ figures: Figure[] }>(textOf(msg));
    const planned = Array.isArray(plan.figures) ? plan.figures.slice(0, 3) : [];

    let md = markdown;
    const out: { anchor: string; svg: string }[] = [];
    for (const f of planned) {
      const svg = renderFigure(f);
      if (!svg) continue;
      md = insertAfterHeading(md, f.anchor, svg);
      out.push({ anchor: f.anchor, svg });
    }
    return { markdown: md, figures: out };
  } catch {
    // Figures are optional. On any failure, ship the article without them.
    return { markdown, figures: [] };
  }
}

// Insert an SVG block after the first heading that matches the anchor text.
// Falls back to placing it before the Sources list, then at the end.
function insertAfterHeading(md: string, anchor: string, svg: string): string {
  const block = `\n\n<figure class="article-figure">\n${svg}\n</figure>\n`;
  const norm = (s: string) => s.replace(/[#*_`]/g, "").trim().toLowerCase();
  const target = norm(anchor);
  const lines = md.split("\n");
  if (target) {
    for (let i = 0; i < lines.length; i++) {
      if (/^#{1,6}\s/.test(lines[i]) && norm(lines[i]).includes(target)) {
        lines.splice(i + 1, 0, block);
        return lines.join("\n");
      }
    }
  }
  const srcIdx = lines.findIndex((l) => /^#{1,6}\s+sources/i.test(l));
  if (srcIdx >= 0) {
    lines.splice(srcIdx, 0, block);
    return lines.join("\n");
  }
  return md + block;
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
  // Plan and place diagrams last, on the finished article, so anchors match
  // the final headings and the critic cannot mangle inserted SVG.
  const withFigures = await figures(client, final, onProgress);

  onProgress("done", "Article ready.");
  return {
    title: o.title,
    subtitle: o.subtitle,
    markdown: withFigures.markdown,
    sources: r.findings,
    coverSvg,
    figures: withFigures.figures,
  };
}
