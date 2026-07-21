/**
 * lib/preprocess/trimAgreement.ts — conservative pre-trim + generous hard cap.
 *
 * A pure, mechanical helper that runs BEFORE ClauseExtractor (wired in the
 * orchestrator). It does two things and NOTHING more:
 *
 *   1. Conservatively strips ONLY unmistakable non-clause structure — table-of-
 *      contents index lines, address/contact blocks, navigation/menu/footer
 *      lines, standalone "Last updated" date stamps — and collapses excess
 *      whitespace. Anything ambiguous is LEFT IN: ClauseExtractor remains the
 *      sole judge of what is a real clause. This helper must never remove text
 *      that could plausibly be a term.
 *
 *   2. Applies a generous hard character cap. A full normal ToS (tens of
 *      thousands of characters) passes untouched; only pathological pastes are
 *      cut, on a clean paragraph/sentence/word boundary (never mid-word).
 *
 * No LLM call. No trace Step. Deterministic.
 */

/**
 * Generous hard ceiling on the analyzed agreement length, in characters.
 *
 * Real terms-of-service / privacy policies run ~5k–60k characters; even very
 * long ones rarely exceed ~80k. 100,000 characters therefore lets every normal
 * (and most abnormally long) agreement through untouched, and only trims truly
 * pathological input — an entire book, a scraped page dump — that would waste
 * budget and add no clause value. Raising this is safe; lowering it risks
 * cutting genuine terms, so keep it generous.
 */
export const MAX_AGREEMENT_CHARS = 100_000;

export interface TrimResult {
  /** The cleaned (and, if over the cap, boundary-truncated) agreement text. */
  text: string;
  /** True only when the hard cap fired and text was cut. */
  truncated: boolean;
  /** Length of the raw input, in characters. */
  original_length: number;
  /** Length of the returned `text`, in characters. */
  kept_length: number;
}

/**
 * Conservatively clean an agreement and enforce the hard cap.
 */
export function trimAgreement(raw: string): TrimResult {
  const original_length = raw.length;

  // Normalize line endings, then filter line-by-line.
  const normalized = raw.replace(/\r\n?/g, "\n");
  const kept: string[] = [];
  for (const rawLine of normalized.split("\n")) {
    // Collapse internal runs of spaces/tabs and trim the ends of each line.
    const line = rawLine.replace(/[ \t]+/g, " ").trim();
    if (line === "") {
      kept.push(""); // preserve a break; blank runs are collapsed below
      continue;
    }
    if (isDroppableStructure(line)) continue;
    kept.push(line);
  }

  // Collapse runs of blank lines to a single blank line, and trim the ends.
  let text = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  const truncated = text.length > MAX_AGREEMENT_CHARS;
  if (truncated) text = cutAtBoundary(text, MAX_AGREEMENT_CHARS);

  return { text, truncated, original_length, kept_length: text.length };
}

// ---------------------------------------------------------------------------
// Conservative drop predicates. Each targets a NARROW, unmistakable pattern and
// errs toward keeping. A line is dropped only if one of these is confidently true.
// ---------------------------------------------------------------------------

function isDroppableStructure(line: string): boolean {
  return (
    isTocIndexLine(line) ||
    isEmailOnlyLine(line) ||
    isContactDetailLine(line) ||
    isPostalAddressLine(line) ||
    isNavOrFooterLine(line) ||
    isDateStampLine(line)
  );
}

/**
 * A table-of-contents index line: either a dotted-leader entry
 * ("Privacy Policy .......... 12") or an inline numbered index of SHORT labels
 * ("1. Account  2. Content  3. Data  4. Sharing"). The inline case requires 4+
 * numbered items that are all short and carry no sentence punctuation, so a real
 * inline numbered clause list (whose items are full, punctuated sentences) is
 * never mistaken for a TOC.
 */
function isTocIndexLine(line: string): boolean {
  if (/\.{4,}\s*\d+\s*$/.test(line)) return true;

  const markers = line.match(/(?:^|\s)\d+\.\s+/g);
  if (!markers || markers.length < 4) return false;
  const parts = line
    .split(/(?:^|\s)\d+\.\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length < 4) return false;
  return parts.every(
    (p) => p.split(/\s+/).length <= 4 && !/[.!?:;]$/.test(p),
  );
}

/** A line whose entire content is a single email address. */
function isEmailOnlyLine(line: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(line);
}

/**
 * A "Contact: …" / "Contact us at …" line that also carries an actual contact
 * detail (email, phone, or "at"). Requiring the detail avoids dropping a real
 * clause that merely begins with the word "Contact".
 */
function isContactDetailLine(line: string): boolean {
  if (!/^contact(\s+us)?\b/i.test(line)) return false;
  return /@|\bat\b|\+?\d[\d\s().-]{6,}/.test(line);
}

/**
 * A short postal-address line. Requires at least TWO independent address signals
 * (street-type word, ZIP/postcode, leading street number) so ordinary prose that
 * merely mentions an address in passing is not removed.
 */
function isPostalAddressLine(line: string): boolean {
  if (line.length > 120) return false;
  const streetish =
    /\b(street|st\.|avenue|ave\.|road|rd\.|boulevard|blvd\.|suite|ste\.|p\.?\s?o\.?\s?box|floor|drive|dr\.|lane|ln\.)\b/i.test(
      line,
    );
  const zipish =
    /\b\d{5}(-\d{4})?\b/.test(line) ||
    /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/.test(line);
  const streetNumber = /^\d{1,6}\s+\p{L}/u.test(line);
  const signals = [streetish, zipish, streetNumber].filter(Boolean).length;
  return signals >= 2;
}

/**
 * A navigation/menu/footer line: a short link-list of 3+ tiny, unpunctuated
 * items separated by pipes/bullets ("Home | About | Privacy | Terms"), or a
 * copyright / all-rights-reserved footer.
 */
function isNavOrFooterLine(line: string): boolean {
  if (/^©/.test(line) || /\ball rights reserved\b/i.test(line)) return true;

  const seps = (line.match(/[|·•›»]/g) || []).length;
  if (seps < 2 || line.length > 120) return false;
  const parts = line
    .split(/[|·•›»]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return (
    parts.length >= 3 &&
    parts.every((p) => p.split(/\s+/).length <= 4 && !/[.!?]$/.test(p))
  );
}

/**
 * A standalone date stamp: a short line that starts with "Last updated",
 * "Effective date", "Last revised", etc. The length guard keeps a real clause
 * that discusses effective dates (a longer sentence) in.
 */
function isDateStampLine(line: string): boolean {
  if (line.length > 80) return false;
  return /^(last updated|last revised|last modified|effective(\s+date)?(\s+as of)?|updated on|revised on)\b[:\s]/i.test(
    line,
  );
}

// ---------------------------------------------------------------------------
// Hard-cap boundary cut.
// ---------------------------------------------------------------------------

/**
 * Cut `text` to at most `max` characters on a clean boundary — preferring a
 * paragraph break, then a sentence end, then a word boundary. Never cuts
 * mid-word (unless the input has no whitespace at all, a degenerate case).
 */
function cutAtBoundary(text: string, max: number): string {
  if (text.length <= max) return text;
  const window = text.slice(0, max);
  const floor = Math.floor(max * 0.5); // don't cut absurdly early

  const para = window.lastIndexOf("\n\n");
  if (para >= floor) return window.slice(0, para).trimEnd();

  const sentence = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf(".\n"),
    window.lastIndexOf("! "),
    window.lastIndexOf("? "),
  );
  if (sentence >= floor) return window.slice(0, sentence + 1).trimEnd();

  const space = window.lastIndexOf(" ");
  if (space > 0) return window.slice(0, space).trimEnd();

  return window; // no whitespace to break on
}
