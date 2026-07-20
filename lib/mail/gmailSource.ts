/**
 * lib/mail/gmailSource.ts — the Phase 6b REAL Gmail-backed MailSource.
 *
 * The monitoring intake path (PROJECT_SPEC §3): a change-notification email
 * arrives in the demo mailbox, and this source surfaces it to the same trigger
 * the mock uses (lib/mail/trigger.ts). It implements the exact same MailSource
 * interface as the mock (lib/mail/source.ts), so the trigger stays completely
 * source-agnostic — only the instance wired in differs (see selectSource.ts).
 *
 * Auth: an OAuth2 client built from GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET with
 * GMAIL_REFRESH_TOKEN as the credential. googleapis auto-refreshes the access
 * token, so there is NO interactive step at runtime (the one-time consent that
 * mints the refresh token is scripts-ts/mint_gmail_token.ts).
 *
 * Dedup: we hold the read-only Gmail scope, so we never mark the mailbox. The
 * processed-ledger lives in Supabase (`processed_emails`, see the matching .sql):
 * fetch returns only ids NOT in that table; markProcessed inserts the id. This
 * mirrors the mock's `processed` flag but leaves the inbox untouched, and keeps
 * re-polling idempotent (CLAUDE.md §2 — no serverless-memory state).
 *
 * Node runtime only (googleapis + Supabase). Not part of the LLM `steps` trace.
 */

import { google } from "googleapis";
import type { gmail_v1 } from "googleapis";
import { supabase } from "@/lib/db";
import type { ChangeNoticeEmail, MailSource } from "@/lib/mail/source";
import {
  GMAIL_CLIENT_ID,
  GMAIL_CLIENT_SECRET,
  GMAIL_REFRESH_TOKEN,
} from "@/lib/config";

const PROCESSED_TABLE = "processed_emails";

/** Gmail search that narrows to terms/privacy CHANGE notices. */
const SEARCH_QUERY = [
  "newer_than:90d",
  "(",
  [
    'subject:"terms of service"',
    'subject:"terms of use"',
    'subject:"privacy policy"',
    'subject:"we\'ve updated"',
    'subject:"we have updated"',
    'subject:"changes to our terms"',
    'subject:"updated our terms"',
    'subject:"update to our terms"',
    '"changes to our terms"',
    '"updated our privacy policy"',
    '"we\'ve updated our terms"',
  ].join(" OR "),
  ")",
].join(" ");

/** How many candidate messages to consider per check (newest first). */
const MAX_CANDIDATES = 10;
/** How many message ids to ask Gmail for before dedup filtering. */
const LIST_PAGE_SIZE = 25;

/** Build the authenticated Gmail client, or throw a clear config error. */
function gmailClient(): gmail_v1.Gmail {
  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
    throw new Error(
      "gmailSource: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET and GMAIL_REFRESH_TOKEN " +
        "must all be set. Mint a refresh token with " +
        "`npx tsx --env-file=.env.local scripts-ts/mint_gmail_token.ts`.",
    );
  }
  const auth = new google.auth.OAuth2(GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: GMAIL_REFRESH_TOKEN });
  return google.gmail({ version: "v1", auth });
}

/** The subset of `processed_emails` ids that appear in `ids`. */
async function alreadyProcessed(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data, error } = await supabase
    .from(PROCESSED_TABLE)
    .select("message_id")
    .in("message_id", ids);
  if (error) {
    throw new Error(`gmailSource: failed to read the processed ledger: ${error.message}`);
  }
  return new Set((data ?? []).map((r) => (r as { message_id: string }).message_id));
}

/** Read a header value (case-insensitive) from a message payload. */
function header(payload: gmail_v1.Schema$MessagePart | undefined, name: string): string {
  const lower = name.toLowerCase();
  const h = payload?.headers?.find((x) => (x.name ?? "").toLowerCase() === lower);
  return h?.value ?? "";
}

/** Decode a base64url Gmail body part to a UTF-8 string. */
function decodePart(data: string | null | undefined): string {
  if (!data) return "";
  return Buffer.from(data, "base64url").toString("utf-8");
}

/** Very small HTML→text: drop tags, unescape a few common entities, collapse ws. */
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Walk the MIME tree and return the best plain-text body. Prefers text/plain;
 * falls back to stripped text/html; returns "" if neither is present.
 */
function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return "";

  const plains: string[] = [];
  const htmls: string[] = [];

  const walk = (part: gmail_v1.Schema$MessagePart) => {
    const mime = part.mimeType ?? "";
    const data = part.body?.data;
    if (mime === "text/plain" && data) plains.push(decodePart(data));
    else if (mime === "text/html" && data) htmls.push(decodePart(data));
    for (const child of part.parts ?? []) walk(child);
  };
  walk(payload);

  if (plains.length > 0) return plains.join("\n").trim();
  if (htmls.length > 0) return htmlToText(htmls.join("\n"));
  return "";
}

/** Best-effort service name from the sender domain, else null. */
function serviceHintFromSender(from: string): string | null {
  const emailMatch = from.match(/[\w.+-]+@([\w.-]+)/);
  if (!emailMatch) return null;
  const domain = emailMatch[1].toLowerCase();
  const labels = domain.split(".").filter(Boolean);
  // Drop common mail sub-labels and the TLD, keep the registrable-ish label.
  const noise = new Set(["email", "e", "mail", "mailer", "notifications", "notify", "news", "info", "no-reply", "noreply", "updates", "hello", "team", "www"]);
  const meaningful = labels.slice(0, -1).filter((l) => !noise.has(l));
  const label = meaningful.length > 0 ? meaningful[meaningful.length - 1] : labels[0];
  if (!label) return null;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Map a full Gmail message to the source-agnostic ChangeNoticeEmail. */
function toChangeNotice(msg: gmail_v1.Schema$Message): ChangeNoticeEmail {
  const payload = msg.payload ?? undefined;
  const from = header(payload, "From");
  const subject = header(payload, "Subject");
  const received_at = msg.internalDate
    ? new Date(Number(msg.internalDate)).toISOString()
    : new Date(header(payload, "Date") || 0).toISOString();

  return {
    id: msg.id ?? "",
    service_hint: serviceHintFromSender(from),
    subject,
    body: extractBody(payload),
    received_at,
  };
}

export const gmailSource: MailSource = {
  async fetchNewChangeNotices(): Promise<ChangeNoticeEmail[]> {
    const gmail = gmailClient();

    const list = await gmail.users.messages.list({
      userId: "me",
      q: SEARCH_QUERY,
      maxResults: LIST_PAGE_SIZE,
    });

    const ids = (list.data.messages ?? [])
      .map((m) => m.id)
      .filter((id): id is string => Boolean(id));
    if (ids.length === 0) return [];

    // Dedup against the Supabase ledger (read-only Gmail → no mailbox mutation).
    const processed = await alreadyProcessed(ids);
    const fresh = ids.filter((id) => !processed.has(id)).slice(0, MAX_CANDIDATES);
    if (fresh.length === 0) return [];

    const notices: ChangeNoticeEmail[] = [];
    for (const id of fresh) {
      // Defensive: a single unparseable message must not sink the whole batch.
      try {
        const full = await gmail.users.messages.get({
          userId: "me",
          id,
          format: "full",
        });
        const notice = toChangeNotice(full.data);
        if (notice.id) notices.push(notice);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`gmailSource: skipping message ${id} (parse/fetch failed): ${message}`);
      }
    }
    return notices;
  },

  async markProcessed(id: string): Promise<void> {
    const { error } = await supabase
      .from(PROCESSED_TABLE)
      .upsert({ message_id: id }, { onConflict: "message_id", ignoreDuplicates: true });
    if (error) {
      throw new Error(
        `gmailSource: failed to record message "${id}" as processed: ${error.message}`,
      );
    }
  },
};