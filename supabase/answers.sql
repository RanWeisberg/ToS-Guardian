-- supabase/answers.sql — the answer log (PROJECT_SPEC §5, migration step 1).
--
-- Idempotent DDL: safe to run repeatedly. Run manually against the project's
-- Supabase instance (SQL editor or psql). ADDITIVE — this stands the `answers`
-- table up ALONGSIDE the existing `preferences` table; nothing here touches
-- `preferences`.
--
-- The human-facing, growing record of every material clause the user has been
-- shown and how they responded: one row per (service × case × category). A row is
-- created for each material finding when a report is produced (answered=false,
-- stance=NULL); answering a finding sets stance and flips answered=true. A
-- re-review of the same service updates the row in place and bumps
-- agreement_version, preserving any prior answer.

create table if not exists answers (
  id                bigint generated always as identity primary key,
  service           text        not null,
  category          text        not null,
  case_id           text        not null,
  clause            text        not null default '',   -- plain-language finding text (step 3)
  explanation       text        not null default '',   -- why it matters (step 3)
  agreement_version int         not null default 0,
  stance            text,                                -- 'care' | 'dont_care' | NULL until answered
  answered          boolean     not null default false,
  report_id         text,                                -- reference to reports.id; NO FK constraint
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (service, case_id, category)
);

create index if not exists answers_category_case_idx on answers (category, case_id);

create index if not exists answers_report_id_idx on answers (report_id);