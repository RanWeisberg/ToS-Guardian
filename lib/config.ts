/**
 * lib/config.ts — single source of truth for ToS Guardian's configuration.
 *
 * Mirrors the finished `config.py`: exactly one place reads the environment and
 * exactly one place fails loudly when something required is missing. Every API
 * route and library imports its secrets from here — nothing else reads
 * `process.env` directly.
 *
 * Values are never logged. `envPresence()` reports which variables are set by
 * NAME ONLY, so diagnostics can never leak a key.
 */

// A variable that is present but still empty/placeholder counts as unset.
const PLACEHOLDERS = new Set(["", "your-key-here", "changeme"]);

function get(name: string, fallback?: string): string | undefined {
  const raw = process.env[name];
  const value = raw ?? fallback;
  if (value !== undefined && PLACEHOLDERS.has(value.trim())) {
    return undefined;
  }
  return value;
}

// --- LLMod.ai ---
export const LLMOD_API_KEY = get("LLMOD_API_KEY");
export const LLMOD_BASE_URL = get("LLMOD_BASE_URL");
export const LLMOD_TEXT_MODEL = get("LLMOD_TEXT_MODEL", "MB5R2CF-azure/gpt-5.4-mini");
export const LLMOD_EMBED_MODEL = get(
  "LLMOD_EMBED_MODEL",
  "MB5R2CF-azure/text-embedding-3-small",
);

// --- Pinecone ---
export const PINECONE_API_KEY = get("PINECONE_API_KEY");
export const PINECONE_INDEX_NAME = get("PINECONE_INDEX_NAME", "tosdr-taxonomy");
export const PINECONE_CLOUD = get("PINECONE_CLOUD", "aws");
export const PINECONE_REGION = get("PINECONE_REGION", "us-east-1");

// --- Supabase ---
export const SUPABASE_URL = get("SUPABASE_URL");
export const SUPABASE_SERVICE_ROLE_KEY = get("SUPABASE_SERVICE_ROLE_KEY");
export const SUPABASE_ANON_KEY = get("SUPABASE_ANON_KEY");

// --- Gmail (monitoring intake, Phase 6b) ---
// Optional: when GMAIL_REFRESH_TOKEN is present the mail layer uses the real
// Gmail source; otherwise it falls back to the mock. Not in REQUIRED — the app
// (and the graded paste path) work fine without a mailbox configured.
export const GMAIL_CLIENT_ID = get("GMAIL_CLIENT_ID");
export const GMAIL_CLIENT_SECRET = get("GMAIL_CLIENT_SECRET");
export const GMAIL_REFRESH_TOKEN = get("GMAIL_REFRESH_TOKEN");
export const GMAIL_USER = get("GMAIL_USER");

/**
 * Every variable this module knows about, keyed by name. Used only to derive
 * presence (booleans) — never to expose values.
 */
const ALL_VARS: Record<string, string | undefined> = {
  LLMOD_API_KEY,
  LLMOD_BASE_URL,
  LLMOD_TEXT_MODEL,
  LLMOD_EMBED_MODEL,
  PINECONE_API_KEY,
  PINECONE_INDEX_NAME,
  PINECONE_CLOUD,
  PINECONE_REGION,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_ANON_KEY,
  GMAIL_CLIENT_ID,
  GMAIL_CLIENT_SECRET,
  GMAIL_REFRESH_TOKEN,
  GMAIL_USER,
};

// Required to do anything in Phase 0 (connectivity diagnostic).
const REQUIRED = [
  "LLMOD_API_KEY",
  "LLMOD_BASE_URL",
  "PINECONE_API_KEY",
  "PINECONE_INDEX_NAME",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

const missing = REQUIRED.filter((name) => !ALL_VARS[name]);
if (missing.length > 0) {
  throw new Error(
    "Missing required environment variables: " +
      missing.join(", ") +
      "\nFill them in your .env.local / .env.local.local (see .env.local.local.example).",
  );
}

/**
 * Report which known variables are present — names and booleans only, never
 * values. Safe to return from a diagnostic endpoint.
 */
export function envPresence(): Record<string, boolean> {
  const presence: Record<string, boolean> = {};
  for (const [name, value] of Object.entries(ALL_VARS)) {
    presence[name] = Boolean(value);
  }
  return presence;
}
