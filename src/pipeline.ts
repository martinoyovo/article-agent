import Anthropic from "@anthropic-ai/sdk";
import { createClient, MODELS, textOf, parseJson, today } from "./claude.js";
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
      `Source format: [N] Source name, short description. <URL> (accessed ${today()}). ` +
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
      "is formatted exactly as [N] Source name, description. <URL> (accessed DATE). " +
      "Keep the author's voice and every fact and citation intact. Return ONLY the corrected Markdown.",
    messages: [{ role: "user", content: article }],
  });
  return stripEmDashes(textOf(msg));
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
  const d = await draft(client, input.topic, audience, r, o, lengthWords, onProgress);
  const final = await critic(client, d, onProgress);

  onProgress("done", "Article ready.");
  return { title: o.title, subtitle: o.subtitle, markdown: final, sources: r.findings };
}
