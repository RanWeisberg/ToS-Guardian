-- supabase/mock_inbox.sql — the Phase 6a mock mailbox (Supabase).
--
-- A stand-in for a real inbox: drop a "change-notification email" into this
-- table and the agent's mail-trigger layer picks it up on the next check. This
-- is the MOCK MailSource's backing store (lib/mail/mockSource.ts); the real
-- Gmail source (Phase 6b) will implement the same MailSource interface without
-- touching this table.
--
-- Why a table and not memory: the serverless filesystem is wiped between calls
-- (CLAUDE.md §2), so the processed-ledger MUST live in Supabase. Marking a row
-- processed=true is the dedup key that makes re-polling idempotent — an email is
-- never handled twice.
--
-- Idempotent DDL: safe to run repeatedly. Run against the project's Supabase
-- instance (SQL editor or psql).

create table if not exists mock_inbox (
  id           text        primary key,          -- the email id; the dedup key
  service_hint text        null,                 -- best-guess service name, or null
  subject      text        not null,
  body         text        not null,
  received_at  timestamptz not null default now(),
  processed    boolean     not null default false -- flipped true once the agent handles it
);

-- Poll query filters on processed=false, so index it (partial index over the
-- unprocessed rows keeps the hot set small).
create index if not exists mock_inbox_unprocessed_idx
  on mock_inbox (received_at)
  where processed = false;
