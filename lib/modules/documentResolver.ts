/**
 * lib/modules/documentResolver.ts — Module 2 of the eight-module core (PROJECT_SPEC §4).
 *
 * DocumentResolver makes the agreement text available to the rest of the pipeline.
 * It is "mostly mechanical; LLM only to disambiguate links" (CLAUDE.md §5,
 * PROJECT_SPEC §4 row 2):
 *
 *   - inline text present  → pass through, NO fetch, NO LLM call, NO trace Step.
 *   - a single link_url    → fetch it server-side and strip HTML to readable text.
 *   - fetch fails / login-walled / unusable body → return the needs_user_paste
 *     fallback so the orchestrator can ask the user to paste, WITHOUT crashing.
 *
 * The DocumentResolverInput contract carries exactly ONE link_url, so there is never a
 * "which of several links is the real policy" ambiguity to resolve — the mechanical
 * path covers every case and no LLM call is warranted here (budget: CLAUDE.md §5).
 * Consequently this module records NO Step in the common path, which is intended and
 * correct: only genuine LLM calls belong in the trace (CLAUDE.md §4/§7).
 *
 * Uses the Node runtime (server-side fetch of arbitrary URLs).
 */

import type { DocumentResolverInput, DocumentResolverOutput } from "@/lib/contracts";
import type { Tracer } from "@/lib/trace";

/** Abort a slow link well under the 5-minute serverless ceiling (CLAUDE.md §2). */
const FETCH_TIMEOUT_MS = 10_000;

/** Below this, an extracted body is treated as unusable (login wall, JS shell, error
 *  page) and we fall back to asking the user to paste. */
const MIN_USABLE_TEXT_LENGTH = 200;

/** A realistic UA — some policy hosts return a stub or block an empty UA. */
const USER_AGENT =
  "Mozilla/5.0 (compatible; ToSGuardian/1.0; +https://tos-guardian.example)";

export async function runDocumentResolver(
  input: DocumentResolverInput,
  _tracer: Tracer,
): Promise<DocumentResolverOutput> {
  // --- Inline pass-through: no fetch, no LLM, no Step. ---
  if (input.source === "inline") {
    const inline = input.inline_text?.trim() ?? "";
    if (inline.length > 0) {
      return { resolved: true, text: inline, needs_user_paste: false, reason: null };
    }
    return needsPaste("Marked inline but no agreement text was provided.");
  }

  // --- Linked: fetch mechanically. ---
  const url = input.link_url?.trim() ?? "";
  if (url.length === 0) {
    return needsPaste("Marked linked but no URL was provided.");
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return needsPaste(`The provided link is not a valid URL: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return needsPaste(`Unsupported link protocol (${parsed.protocol}); expected http/https.`);
  }

  let res: Response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    res = await fetch(parsed, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,text/plain,*/*" },
    });
  } catch (err) {
    const why =
      err instanceof Error && err.name === "AbortError"
        ? `Timed out after ${FETCH_TIMEOUT_MS / 1000}s fetching ${url}`
        : `Could not reach ${url}: ${err instanceof Error ? err.message : String(err)}`;
    return needsPaste(why);
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    return needsPaste(
      `Fetching ${url} returned HTTP ${res.status} ${res.statusText}. It may be login-walled.`,
    );
  }

  let body: string;
  try {
    body = await res.text();
  } catch (err) {
    return needsPaste(
      `Could not read the response body from ${url}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const text = htmlToText(body);
  if (text.length < MIN_USABLE_TEXT_LENGTH) {
    return needsPaste(
      `The content at ${url} was too short to be a usable policy (${text.length} chars); it may be a login wall or a JavaScript-rendered page. Please paste the text.`,
    );
  }

  return { resolved: true, text, needs_user_paste: false, reason: null };
}

/** Uniform unresolved result that asks the user to paste (contract shape). */
function needsPaste(reason: string): DocumentResolverOutput {
  return { resolved: false, text: null, needs_user_paste: true, reason };
}

/**
 * Lightweight HTML → readable plain text. Deliberately dependency-free (CLAUDE.md
 * "do not add a heavy dependency without flagging"): drop non-content elements,
 * strip remaining tags, decode a handful of common entities, and normalize
 * whitespace. Good enough to feed ClauseExtractor; not a full DOM parser.
 */
function htmlToText(html: string): string {
  let s = html;
  // Remove elements whose contents are never readable policy text.
  s = s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ");
  s = s.replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  // Turn block-level boundaries into newlines so clauses don't run together.
  s = s.replace(/<\/(p|div|li|tr|h[1-6]|section|article|header|footer)>/gi, "\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  // Strip all remaining tags.
  s = s.replace(/<[^>]+>/g, " ");
  // Decode a small set of common HTML entities.
  s = decodeEntities(s);
  // Normalize whitespace: collapse runs of spaces, cap consecutive blank lines.
  s = s.replace(/[ \t\f\v]+/g, " ");
  s = s.replace(/ *\n */g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

function decodeEntities(s: string): string {
  const named: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
    "&nbsp;": " ",
    "&mdash;": "—",
    "&ndash;": "–",
    "&hellip;": "…",
    "&rsquo;": "'",
    "&lsquo;": "'",
    "&ldquo;": "“",
    "&rdquo;": "”",
  };
  let out = s.replace(/&[a-zA-Z]+;|&#39;/g, (m) => named[m] ?? m);
  // Numeric entities (decimal + hex).
  out = out.replace(/&#(\d+);/g, (_m, d) => safeFromCodePoint(parseInt(d, 10)));
  out = out.replace(/&#[xX]([0-9a-fA-F]+);/g, (_m, h) => safeFromCodePoint(parseInt(h, 16)));
  return out;
}

function safeFromCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}
