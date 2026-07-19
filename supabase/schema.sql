-- supabase/schema.sql — ToS Guardian relational state (Supabase, Phase 1).
--
-- Idempotent DDL: safe to run repeatedly. All cross-call app state lives here
-- (the serverless filesystem is wiped between calls). Two tables:
--   agreement_versions — the version store + clause→case classifications
--                        (the reliable diff baseline; also the subscription list)
--   preferences        — per-(case × category) stance, keyed for slice injection
--
-- Run against the project's Supabase instance (SQL editor or psql). Uses
-- "create ... if not exists" throughout so re-running is a no-op.

-- ---------------------------------------------------------------------------
-- agreement_versions
-- ---------------------------------------------------------------------------
create table if not exists agreement_versions (
  id              bigint generated always as identity primary key,
  service         text        not null,           -- e.g. "Spotify"
  category        text        not null,           -- service category, e.g. "music streaming"
  version         int         not null,           -- 0 for onboarding baseline, incrementing after
  raw_text        text        not null,
  classifications jsonb       not null default '[]'::jsonb,  -- array of clause→case results
  active          boolean     not null default true,         -- soft-flag for "no longer registered"
  created_at      timestamptz not null default now(),
  unique (service, version)
);

create index if not exists agreement_versions_service_idx
  on agreement_versions (service);

-- ---------------------------------------------------------------------------
-- preferences
-- ---------------------------------------------------------------------------
create table if not exists preferences (
  id         bigint generated always as identity primary key,
  case_id    text        not null,   -- ToS;DR case identifier
  category   text        not null,   -- service category; "*" for the general (all-category) default
  stance     text        not null,   -- 'care' | 'dont_care'
  source     text        not null,   -- 'default' | 'user'
  updated_at timestamptz not null default now(),
  unique (case_id, category)
);

create index if not exists preferences_category_idx
  on preferences (category);
