---
name: house-voice
description: Write articles, blog posts, essays, newsletters, and long-form prose in the article-agent house voice — direct and concrete, for a builder audience (founders, engineers, AI integrators), with no em dashes, honest tradeoffs over hype, and inline [N] citations to a Sources list. Use this whenever drafting or editing any long-form written piece for builders, when the user asks for writing in "the house voice" / "our voice" / this project's style (even without naming the skill), and when reviewing or rewriting prose to strip em dashes and hype or fix citation formatting.
---

# House voice

This is the voice the article-agent ships in. It is the same set of rules encoded in `src/voice.ts` (which drives the API pipeline); this skill is its twin for writing prose directly inside Claude Code. When you draft or edit an article, post, essay, or newsletter here, write it this way. When you fix someone else's draft, bring it to this standard.

The audience is builders: founders, engineers, and AI integrators. They are smart, skeptical, and short on time. Everything below follows from respecting that.

## Voice

- **Lead with the angle.** Builders skim. The first sentence should carry the point, not warm up to it. Cut throat-clearing ("In today's fast-paced world...", "It's worth noting that...").
- **Concrete over abstract.** A specific number, name, or example beats a general claim. "Each run is four model calls plus up to six searches" lands; "this can get expensive" does not.
- **Honest about tradeoffs.** Name the limits and the costs plainly. A technical reader trusts writing that admits what it can't do far more than writing that only sells. No hype, no superlatives doing the work an argument should do.
- **Respect the reader's intelligence.** Don't over-explain the obvious or pad with restatement. Say it once, well.
- **Close softly.** End on an invitation or an open door, not a call to hustle and not a recap. No "In conclusion," no "So what are you waiting for?"

## The em-dash rule (hard)

**Never use an em dash (—). Anywhere.** This is a mechanical house constraint, not a stylistic preference, so it holds even mid-draft: use a comma, a period, or restructure the sentence instead. (Em dashes also read as a tell of unedited or machine-generated text, which is the opposite of the impression this voice wants.)

**Example:**
- Avoid: `The pipeline is deterministic — the model only handles judgment.`
- Use: `The pipeline is deterministic. The model only handles judgment.`
- Or: `The pipeline is deterministic, so the model only handles judgment.`

Before finishing, scan the whole piece for `—` and remove every one.

## Numbers

Use **digits** for quantities a reader scans or compares: prices, percentages, multipliers, durations, token counts, version numbers (`$5`, `36%`, `3x faster`, `300ms`, `8000 tokens`).

Use **words** for structural counts and ordinals that read as prose, not data (`four checks`, `the first step`, `two tradeoffs`). The test: if it's a measurement, use a digit; if it's narration, spell it out.

## Citations

When the piece makes factual claims, cite them so a skeptical reader can verify.

- Put inline `[N]` markers in the body where the claim is made.
- Map them to a `### Sources` list at the end, one entry per source, in this exact format:
  `[N] Source name, short description. <URL>`
- Consolidate repeated references to one entry. **Never invent a URL.** A fabricated source is worse than no citation; it destroys the trust the citations were there to earn. If you don't have a real source, make the claim weaker or drop it.

## Structure of a finished article

Follow this spine unless the user asks for something else:

1. **H1 title.** Then an optional one-line italic subtitle.
2. **Intro: 3 to 4 sentences** that state the thesis plainly. The reader should know the argument and why it matters before the first section.
3. **Body sections.** Each earns its place with one concrete point. If a section restates a neighbor or adds no new evidence, cut it.
4. **An honest note on tradeoffs or limits** before the end. What this doesn't solve, what it costs, where it breaks.
5. **A short invitational close.**
6. **A `### Sources` list, last.**

## Quick checklist before you ship

- Opening sentence carries the angle, no throat-clearing.
- Zero em dashes (search for `—`).
- Claims are cited; every Source entry has a real URL.
- Digits for measurements, words for structural counts.
- Tradeoffs named honestly; no hype.
- Close is soft and open, not a sales pitch or a recap.
