-- supabase/reports.sql — persisted report records (Phase 7 Step C).
--
-- Idempotent DDL: safe to run repeatedly. Run manually against the project's
-- Supabase instance (SQL editor or psql). A `reports` row is written whenever an
-- /api/execute run produces a report (material findings present); silent runs
-- write nothing. The report screen reads a row back by id (/report/[id]).
--
-- The `points` column stores the ReportComposer structured output (ReportPoint[],
-- see lib/contracts.ts) verbatim — no reshaping, no invented fields.

create table if not exists reports (
  id                text        primary key,                 -- app-generated uuid
  service           text        not null,
  category          text        not null,
  points            jsonb       not null default '[]'::jsonb, -- ReportPoint[]
  truncation_notice text,                                     -- null unless the agreement was truncated
  response_line     text        not null default '',          -- the short plain-text /api/execute response line
  status            text        not null default 'pending',   -- 'pending' | 'answered'
  source            text        not null default 'manual',    -- 'manual' | 'mail'
  created_at        timestamptz not null default now()
);

create index if not exists reports_status_idx on reports (status);

create index if not exists reports_created_at_idx on reports (created_at desc);