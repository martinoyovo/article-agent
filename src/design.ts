// The visual design system. Every graphic the agent produces is rendered here,
// in deterministic code. The model never emits SVG or coordinates: it supplies
// only content (a title, a stat, step labels), and these functions own all
// geometry. That is what keeps output clean and on-brand instead of the
// overlapping mess you get when a model positions pixels itself.

export const PALETTE = {
  coral: "#FF7A5C",
  green: "#5FB78A",
  lavender: "#A78ECC",
  ink: "#1C1B22",
  muted: "#6B6975",
  bg: "#FAF9FB",
  line: "#E6E4EA",
  track: "#ECEAF0",
};

const FONT = 'font-family="Inter, system-ui, sans-serif"';
const NS = 'xmlns="http://www.w3.org/2000/svg"';

export function escapeXml(s: string): string {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Greedy word wrap to a character budget, capped at maxLines.
export function wrapWords(text: string, perLine: number, maxLines: number): string[] {
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

function svgText(
  x: number,
  y: number,
  lines: string[],
  size: number,
  weight: number,
  fill: string,
  lineH: number,
  extra = "",
): string {
  const tspans = lines
    .map((l, i) => `<tspan x="${x}" dy="${i === 0 ? 0 : lineH}">${escapeXml(l)}</tspan>`)
    .join("");
  return `<text x="${x}" y="${y}" ${FONT} font-size="${size}" font-weight="${weight}" fill="${fill}" ${extra}>${tspans}</text>`;
}

// ---------------------------------------------------------------------------
// Cover
// ---------------------------------------------------------------------------

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
  const subStartY = titleTop + titleBlockH + 56;

  const decor = hasStat
    ? `<polygon points="1092,72 1148,104 1092,136" fill="${PALETTE.lavender}"/>`
    : `<rect x="900" y="118" width="150" height="150" fill="${PALETTE.green}"/>
  <rect x="978" y="196" width="150" height="150" fill="${PALETTE.coral}" opacity="0.92"/>
  <polygon points="900,430 992,476 900,522" fill="${PALETTE.lavender}"/>`;

  let statPanel = "";
  if (hasStat) {
    const labelTspans = wrapWords(statLabel!, 22, 3)
      .map((l, i) => `<tspan x="700" dy="${i === 0 ? 0 : 34}">${escapeXml(l)}</tspan>`)
      .join("");
    statPanel = `<rect x="660" y="150" width="460" height="372" fill="${PALETTE.ink}"/>
  <text x="700" y="322" ${FONT} font-size="108" font-weight="700" fill="${PALETTE.coral}">${escapeXml(
    stat!,
  )}</text>
  <text x="700" y="388" ${FONT} font-size="26" font-weight="600" fill="${PALETTE.bg}">${labelTspans}</text>`;
  }

  return `<svg ${NS} viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="${PALETTE.bg}"/>
  <rect x="0" y="0" width="${W}" height="12" fill="${PALETTE.coral}"/>
  ${decor}
  ${statPanel}
  ${svgText(M, titleTop, lines, size, 700, PALETTE.ink, lh, 'letter-spacing="-0.5"')}
  ${svgText(M, subStartY, subLines, 24, 500, PALETTE.muted, 34)}
</svg>`;
}

// ---------------------------------------------------------------------------
// In-article figures
// ---------------------------------------------------------------------------

export type Figure =
  | { type: "stat"; anchor: string; stat: string; label: string }
  | { type: "steps"; anchor: string; title?: string; steps: string[] }
  | {
      type: "comparison";
      anchor: string;
      leftTitle: string;
      leftPoints: string[];
      rightTitle: string;
      rightPoints: string[];
    }
  | { type: "bar"; anchor: string; title?: string; bars: { label: string; value: number }[] };

const FIG_W = 1040;

function frame(h: number, body: string): string {
  return `<svg ${NS} viewBox="0 0 ${FIG_W} ${h}" width="${FIG_W}" height="${h}">
  <rect x="0.5" y="0.5" width="${FIG_W - 1}" height="${h - 1}" fill="${PALETTE.bg}" stroke="${PALETTE.line}"/>
  <rect x="0" y="0" width="${FIG_W}" height="8" fill="${PALETTE.coral}"/>
  ${body}
</svg>`;
}

function renderStat(f: { stat: string; label: string }): string {
  const H = 200;
  const stat = f.stat.slice(0, 6);
  const numW = stat.length * 104 * 0.72;
  const labelX = 48 + numW + 48;
  const labelChars = Math.max(8, Math.floor((FIG_W - 48 - labelX) / 15));
  const labelLines = wrapWords(f.label, labelChars, 3);
  const labelStartY = Math.round(H / 2 - ((labelLines.length - 1) * 36) / 2) + 8;
  const body = `<polygon points="${FIG_W - 64},34 ${FIG_W - 32},54 ${FIG_W - 64},74" fill="${PALETTE.lavender}"/>
  <text x="48" y="132" ${FONT} font-size="104" font-weight="700" fill="${PALETTE.coral}">${escapeXml(stat)}</text>
  ${svgText(labelX, labelStartY, labelLines, 30, 600, PALETTE.ink, 36)}`;
  return frame(H, body);
}

function renderSteps(f: { title?: string; steps: string[] }): string {
  const steps = f.steps.slice(0, 5);
  const pad = 40;
  const chip = 52;
  const gap = 30;
  const startY = f.title ? 100 : 44;
  const rows = steps
    .map((s, i) => {
      const rowY = startY + i * (chip + gap);
      const textLines = wrapWords(s, Math.floor((FIG_W - 124 - 48) / 13), 2);
      const textTop = rowY + (textLines.length === 1 ? 34 : 22);
      const arrow =
        i < steps.length - 1
          ? `<polygon points="60,${rowY + chip + 6} 88,${rowY + chip + 6} 74,${rowY + chip + gap - 4}" fill="${PALETTE.coral}"/>`
          : "";
      return `<rect x="48" y="${rowY}" width="${chip}" height="${chip}" fill="${PALETTE.coral}"/>
  <text x="74" y="${rowY + 35}" ${FONT} font-size="28" font-weight="700" fill="${PALETTE.bg}" text-anchor="middle">${i + 1}</text>
  ${svgText(124, textTop, textLines, 26, 500, PALETTE.ink, 32)}
  ${arrow}`;
    })
    .join("\n  ");
  const H = startY + steps.length * chip + (steps.length - 1) * gap + pad;
  const title = f.title
    ? svgText(48, 58, wrapWords(f.title, 56, 1), 30, 700, PALETTE.ink, 0, 'letter-spacing="-0.3"')
    : "";
  return frame(H, `${title}\n  ${rows}`);
}

function renderComparison(f: {
  leftTitle: string;
  leftPoints: string[];
  rightTitle: string;
  rightPoints: string[];
}): string {
  const pad = 40;
  const gap = 32;
  const colW = Math.floor((FIG_W - 2 * pad - gap) / 2);
  const leftX = pad;
  const rightX = pad + colW + gap;
  const headerH = 56;
  const headerY = 36;
  const pointsStartY = headerY + headerH + 44;
  const rowH = 78;
  const cols: [number, string, string[], string][] = [
    [leftX, f.leftTitle, f.leftPoints.slice(0, 4), PALETTE.green],
    [rightX, f.rightTitle, f.rightPoints.slice(0, 4), PALETTE.lavender],
  ];
  const maxPoints = Math.max(cols[0][2].length, cols[1][2].length, 1);
  const colChars = Math.floor((colW - 64) / 13);
  const blocks = cols
    .map(([x, title, points, color]) => {
      const header = `<rect x="${x}" y="${headerY}" width="${colW}" height="${headerH}" fill="${color}"/>
  ${svgText(x + 20, headerY + 37, wrapWords(title, Math.floor((colW - 40) / 14), 1), 26, 700, PALETTE.ink, 0)}`;
      const rows = points
        .map((p, j) => {
          const py = pointsStartY + j * rowH;
          const lines = wrapWords(p, colChars, 2);
          return `<rect x="${x + 20}" y="${py - 13}" width="13" height="13" fill="${color}"/>
  ${svgText(x + 48, py, lines, 22, 500, PALETTE.ink, 30)}`;
        })
        .join("\n  ");
      return `${header}\n  ${rows}`;
    })
    .join("\n  ");
  const H = pointsStartY + maxPoints * rowH + pad - 30;
  return frame(H, blocks);
}

function renderBar(f: { title?: string; bars: { label: string; value: number }[] }): string {
  const bars = f.bars.slice(0, 5);
  const pad = 40;
  const startY = f.title ? 100 : 48;
  const barH = 46;
  const gap = 20;
  const trackX = 300;
  const barMaxW = FIG_W - trackX - 96;
  const maxVal = Math.max(...bars.map((b) => b.value), 1);
  const cycle = [PALETTE.green, PALETTE.coral, PALETTE.lavender];
  const rows = bars
    .map((b, i) => {
      const y = startY + i * (barH + gap);
      const fillW = Math.max(2, Math.round((b.value / maxVal) * barMaxW));
      const label = wrapWords(b.label, 20, 1);
      return `${svgText(40, y + 30, label, 22, 600, PALETTE.ink, 0)}
  <rect x="${trackX}" y="${y}" width="${barMaxW}" height="${barH}" fill="${PALETTE.track}"/>
  <rect x="${trackX}" y="${y}" width="${fillW}" height="${barH}" fill="${cycle[i % 3]}"/>
  <text x="${trackX + fillW + 12}" y="${y + 30}" ${FONT} font-size="20" font-weight="700" fill="${PALETTE.ink}">${escapeXml(
    String(b.value),
  )}</text>`;
    })
    .join("\n  ");
  const H = startY + bars.length * (barH + gap) - gap + pad;
  const title = f.title
    ? svgText(40, 58, wrapWords(f.title, 60, 1), 30, 700, PALETTE.ink, 0, 'letter-spacing="-0.3"')
    : "";
  return frame(H, `${title}\n  ${rows}`);
}

// Dispatch. Returns null for an unknown/invalid figure so the caller can skip it.
export function renderFigure(f: Figure): string | null {
  try {
    switch (f.type) {
      case "stat":
        if (!f.stat || !f.label) return null;
        return renderStat(f);
      case "steps":
        if (!Array.isArray(f.steps) || f.steps.length < 2) return null;
        return renderSteps(f);
      case "comparison":
        if (!f.leftTitle || !f.rightTitle) return null;
        return renderComparison(f);
      case "bar":
        if (!Array.isArray(f.bars) || f.bars.length < 2) return null;
        return renderBar(f);
      default:
        return null;
    }
  } catch {
    return null;
  }
}
