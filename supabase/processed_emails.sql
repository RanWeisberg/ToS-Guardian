-- supabase/processed_emails.sql — the Phase 6b Gmail dedup ledger (Supabase).
--
-- The real Gmail source (lib/mail/gmailSource.ts) is READ-ONLY on the mailbox
-- (gmail.readonly scope), so it cannot mark emails handled in Gmail itself.
-- Instead, processed Gmail message ids are tracked here: fetchNewChangeNotices
-- returns only messages whose id is NOT in this table, and markProcessed inserts
-- the id once runAgent has handled it. This keeps re-polling idempotent without
-- ever modifying the mailbox — the same processing-ledger approach as the mock
-- source's `processed` column, but external to the (untouchable) inbox.
--
-- State lives in Supabase because the serverless filesystem is wiped between
-- calls (CLAUDE.md §2). Idempotent DDL: safe to run repeatedly. Run against the
-- project's Supabase instance (SQL editor or psql).

create table if not exists processed_emails (
  message_id   text        primary key,            -- Gmail message id; the dedup key
  processed_at timestamptz not null default now()
);