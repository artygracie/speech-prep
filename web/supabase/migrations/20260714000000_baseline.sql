-- ============================================================================
-- BASELINE — full reconstruction of the live SpeechPrep schema.
--
-- Why this exists: the live database (project newkdnxxgeeangtgvabn) was built
-- up through six MCP-applied migrations (phase_1_initial_schema …
-- phase_5_session_reaper) whose SQL was never committed to the repo. This file
-- is that schema, reconstructed 2026-07-14 via read-only introspection
-- (pg_catalog / information_schema / pg_get_viewdef / pg_policies), so the
-- repo is once again the source of truth.
--
-- Idempotency contract: applying this file against the live database is a
-- no-op. Every statement is `if not exists`, `create or replace`, or
-- `drop … if exists` + `create`. It also brings a *fresh* database to the
-- current production shape (e.g. `supabase db reset` locally).
--
-- Ordering: this file sorts before every post-relaunch migration
-- (20260714000100_…+). Later workstreams append their own files after it.
--
-- Note for `create table if not exists`: it will not reconcile a table that
-- exists with a *different* shape. That situation doesn't arise here — the
-- table bodies below are verbatim reconstructions of production.
-- ============================================================================


-- ============================================================================
-- 1. Functions
-- ============================================================================

-- Generic updated_at toucher, used by profiles / speeches / sessions.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Mirrors every new auth.users row into public.profiles. Attached to
-- auth.users via the on_auth_user_created trigger below — this is where
-- profile rows come from (there is no application-side insert on signup).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

-- Marks 'recording' sessions older than 10 minutes as failed. Called on a
-- schedule (phase_5_session_reaper) so abandoned tabs don't pile up as
-- forever-"in-progress" sessions.
create or replace function public.reap_stuck_sessions()
returns table(reaped_count integer)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n integer;
begin
  -- A 'recording' row older than 10 minutes is almost certainly a tab that was
  -- closed before stop. We mark it 'failed' so the dashboard isn't lying about
  -- "in-progress" sessions and so the row eventually drops out of the user's
  -- active set. We don't decrement sessions_used — the row was created when
  -- the user clicked Start, and it's their responsibility to know they can
  -- close-without-stopping if they want to abandon it.
  update public.sessions
  set status = 'failed',
      updated_at = now()
  where status = 'recording'
    and created_at < now() - interval '10 minutes';
  get diagnostics n = row_count;

  return query select n;
end;
$$;

-- Event-trigger function: force-enables RLS on any table created in public.
-- Paired with the `ensure_rls` event trigger below.
create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
declare
  cmd record;
begin
  for cmd in
    select *
    from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type in ('table','partitioned table')
  loop
     if cmd.schema_name is not null and cmd.schema_name in ('public') and cmd.schema_name not in ('pg_catalog','information_schema') and cmd.schema_name not like 'pg_toast%' and cmd.schema_name not like 'pg_temp%' then
      begin
        execute format('alter table if exists %s enable row level security', cmd.object_identity);
        raise log 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      exception
        when others then
          raise log 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      end;
     else
        raise log 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     end if;
  end loop;
end;
$$;

-- Event triggers need elevated privileges; guard so environments where the
-- migration role can't create them (e.g. a restricted local role) still apply
-- the rest of the baseline cleanly.
do $$
begin
  if not exists (select 1 from pg_event_trigger where evtname = 'ensure_rls') then
    create event trigger ensure_rls
      on ddl_command_end
      when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      execute function public.rls_auto_enable();
  end if;
exception
  when insufficient_privilege then
    raise notice 'baseline: skipped ensure_rls event trigger (insufficient privilege)';
end;
$$;


-- ============================================================================
-- 2. Tables
-- ============================================================================

-- ---- profiles --------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text,
  plan text not null default 'free'
    constraint profiles_plan_check
    check (plan = any (array['free'::text, 'practiced'::text, 'single_speech'::text, 'coach'::text, 'enterprise'::text])),
  sessions_used integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  stripe_customer_id text,
  stripe_subscription_id text,
  subscription_status text,
  current_period_end timestamptz,
  one_shot_speech_id uuid
);

comment on table public.profiles is
  'Public profile data per authenticated user. Mirrors auth.users with app-specific columns.';

-- ---- speeches --------------------------------------------------------------
create table if not exists public.speeches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  occasion text,
  current_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- profiles.one_shot_speech_id → speeches is added after speeches exists
-- (the two tables reference each other).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_one_shot_speech_id_fkey'
  ) then
    alter table public.profiles
      add constraint profiles_one_shot_speech_id_fkey
      foreign key (one_shot_speech_id) references public.speeches (id) on delete set null;
  end if;
end;
$$;

-- ---- script_versions -------------------------------------------------------
create table if not exists public.script_versions (
  id uuid primary key default gen_random_uuid(),
  speech_id uuid not null references public.speeches (id) on delete cascade,
  v integer not null,
  parent_version_id uuid references public.script_versions (id),
  summary text,
  created_at timestamptz not null default now(),
  constraint script_versions_speech_id_v_key unique (speech_id, v)
);

-- ---- sections --------------------------------------------------------------
create table if not exists public.sections (
  id uuid primary key default gen_random_uuid(),
  script_version_id uuid not null references public.script_versions (id) on delete cascade,
  position integer not null,
  name text not null default 'Untitled',
  target_seconds integer not null default 30
    constraint sections_target_seconds_check check (target_seconds >= 5),
  body text not null default '',
  created_at timestamptz not null default now()
);

-- ---- sessions --------------------------------------------------------------
create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  speech_id uuid not null references public.speeches (id) on delete cascade,
  script_version_id uuid not null references public.script_versions (id) on delete restrict,
  user_id uuid not null references public.profiles (id) on delete cascade,
  mode text not null default 'with-script'
    constraint sessions_mode_check
    check (mode = any (array['with-script'::text, 'freestyle'::text])),
  status text not null default 'recording'
    constraint sessions_status_check
    check (status = any (array['recording'::text, 'uploaded'::text, 'transcribed'::text, 'failed'::text])),
  audio_path text,
  audio_mime text,
  audio_bytes bigint,
  duration_ms integer,
  tags jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---- transcripts -----------------------------------------------------------
create table if not exists public.transcripts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  provider text not null default 'deepgram',
  model text,
  language text default 'en',
  text text not null default '',
  words jsonb not null default '[]'::jsonb,
  filler_count integer not null default 0,
  pause_count integer not null default 0,
  raw jsonb,
  created_at timestamptz not null default now(),
  constraint transcripts_session_id_key unique (session_id)
);

-- ---- section_metrics -------------------------------------------------------
create table if not exists public.section_metrics (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  section_id uuid not null references public.sections (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  position integer not null,
  actual_seconds numeric not null,
  target_seconds integer not null,
  delta_seconds numeric not null,
  wpm numeric,
  filler_count integer not null default 0,
  pause_ms_total integer not null default 0,
  word_start_idx integer,
  word_end_idx integer,
  created_at timestamptz not null default now(),
  constraint section_metrics_session_id_section_id_key unique (session_id, section_id)
);

-- ---- ai_reports ------------------------------------------------------------
create table if not exists public.ai_reports (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  provider text not null default 'anthropic',
  model text,
  prompt_version integer not null default 1,
  summary text not null default '',
  per_section jsonb not null default '[]'::jsonb,
  suggested_edits jsonb not null default '[]'::jsonb,
  input_tokens integer,
  output_tokens integer,
  cached_input_tokens integer,
  raw jsonb,
  created_at timestamptz not null default now(),
  headline text,
  constraint ai_reports_session_id_key unique (session_id)
);

-- headline was added post-launch (Coaching v2). Kept as add-if-missing so this
-- baseline also upgrades any pre-v2 database.
alter table public.ai_reports add column if not exists headline text;

comment on column public.ai_reports.headline is
  'Hero pull-quote (≤90 chars) — the single most important takeaway. Coach v2+. Falls back to first sentence of summary when null.';


-- ============================================================================
-- 3. Indexes (beyond the ones constraints create)
-- ============================================================================

create index if not exists profiles_stripe_customer_idx
  on public.profiles (stripe_customer_id) where (stripe_customer_id is not null);
create index if not exists speeches_user_id_idx
  on public.speeches (user_id, created_at desc);
create index if not exists script_versions_speech_id_idx
  on public.script_versions (speech_id, v desc);
create index if not exists sections_script_version_id_idx
  on public.sections (script_version_id, "position");
create index if not exists sessions_user_id_idx
  on public.sessions (user_id, created_at desc);
create index if not exists sessions_speech_id_idx
  on public.sessions (speech_id, created_at desc);
create index if not exists transcripts_user_id_idx
  on public.transcripts (user_id, created_at desc);
create index if not exists section_metrics_session_idx
  on public.section_metrics (session_id, "position");
create index if not exists ai_reports_user_id_idx
  on public.ai_reports (user_id, created_at desc);


-- ============================================================================
-- 4. Triggers
-- ============================================================================

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists speeches_touch_updated_at on public.speeches;
create trigger speeches_touch_updated_at
  before update on public.speeches
  for each row execute function public.touch_updated_at();

drop trigger if exists sessions_touch_updated_at on public.sessions;
create trigger sessions_touch_updated_at
  before update on public.sessions
  for each row execute function public.touch_updated_at();

-- Profile creation happens HERE, not in app code: every new auth.users row
-- gets a public.profiles row.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ============================================================================
-- 5. Views
-- ============================================================================

create or replace view public.current_script as
select sp.id as speech_id,
    sp.user_id,
    sp.title,
    sp.occasion,
    sp.current_version,
    sv.id as script_version_id,
    sec.id as section_id,
    sec."position",
    sec.name as section_name,
    sec.target_seconds,
    sec.body
   from speeches sp
     join script_versions sv on sv.speech_id = sp.id and sv.v = sp.current_version
     join sections sec on sec.script_version_id = sv.id;

comment on view public.current_script is
  'Flat read-side view: every section of every speech at its current version.';

create or replace view public.entitlements as
select id as user_id,
    plan,
    subscription_status,
    current_period_end,
    one_shot_speech_id,
    sessions_used,
        case
            when plan = 'practiced'::text and (subscription_status = any (array['active'::text, 'trialing'::text])) and (current_period_end is null or current_period_end > now()) then true
            when plan = 'single_speech'::text and current_period_end is not null and current_period_end > now() then true
            when plan = 'free'::text and sessions_used < 3 then true
            else false
        end as is_entitled,
        case
            when plan = 'free'::text then greatest(0, 3 - sessions_used)
            else null::integer
        end as free_sessions_remaining
   from profiles p;

create or replace view public.session_summaries as
select s.id as session_id,
    s.speech_id,
    s.user_id,
    s.script_version_id,
    s.mode,
    s.status,
    s.duration_ms,
    s.created_at,
    coalesce(sum(sm.actual_seconds), 0::numeric)::numeric(10,2) as total_actual_seconds,
    coalesce(sum(sm.target_seconds), 0::bigint)::integer as total_target_seconds,
    coalesce(sum(sm.filler_count), 0::bigint)::integer as total_filler_count
   from sessions s
     left join section_metrics sm on sm.session_id = s.id
  group by s.id;

comment on view public.session_summaries is
  'One row per session with totals rolled up from section_metrics.';


-- ============================================================================
-- 6. Row-level security
-- ============================================================================

alter table public.profiles        enable row level security;
alter table public.speeches        enable row level security;
alter table public.script_versions enable row level security;
alter table public.sections        enable row level security;
alter table public.sessions        enable row level security;
alter table public.transcripts     enable row level security;
alter table public.section_metrics enable row level security;
alter table public.ai_reports      enable row level security;

-- profiles: users read/update their own row. No insert/delete policies —
-- rows are created by the handle_new_user trigger and deleted via the
-- auth.users cascade.
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (auth.uid() = id);
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- speeches: direct user_id ownership.
drop policy if exists speeches_select_own on public.speeches;
create policy speeches_select_own on public.speeches
  for select using (auth.uid() = user_id);
drop policy if exists speeches_insert_own on public.speeches;
create policy speeches_insert_own on public.speeches
  for insert with check (auth.uid() = user_id);
drop policy if exists speeches_update_own on public.speeches;
create policy speeches_update_own on public.speeches
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists speeches_delete_own on public.speeches;
create policy speeches_delete_own on public.speeches
  for delete using (auth.uid() = user_id);

-- script_versions: ownership via the parent speech.
drop policy if exists script_versions_select_own on public.script_versions;
create policy script_versions_select_own on public.script_versions
  for select using (exists (
    select 1 from speeches s
    where s.id = script_versions.speech_id and s.user_id = auth.uid()
  ));
drop policy if exists script_versions_insert_own on public.script_versions;
create policy script_versions_insert_own on public.script_versions
  for insert with check (exists (
    select 1 from speeches s
    where s.id = script_versions.speech_id and s.user_id = auth.uid()
  ));
drop policy if exists script_versions_update_own on public.script_versions;
create policy script_versions_update_own on public.script_versions
  for update using (exists (
    select 1 from speeches s
    where s.id = script_versions.speech_id and s.user_id = auth.uid()
  ));
drop policy if exists script_versions_delete_own on public.script_versions;
create policy script_versions_delete_own on public.script_versions
  for delete using (exists (
    select 1 from speeches s
    where s.id = script_versions.speech_id and s.user_id = auth.uid()
  ));

-- sections: ownership via script_version → speech.
drop policy if exists sections_select_own on public.sections;
create policy sections_select_own on public.sections
  for select using (exists (
    select 1 from script_versions sv
    join speeches s on s.id = sv.speech_id
    where sv.id = sections.script_version_id and s.user_id = auth.uid()
  ));
drop policy if exists sections_insert_own on public.sections;
create policy sections_insert_own on public.sections
  for insert with check (exists (
    select 1 from script_versions sv
    join speeches s on s.id = sv.speech_id
    where sv.id = sections.script_version_id and s.user_id = auth.uid()
  ));
drop policy if exists sections_update_own on public.sections;
create policy sections_update_own on public.sections
  for update using (exists (
    select 1 from script_versions sv
    join speeches s on s.id = sv.speech_id
    where sv.id = sections.script_version_id and s.user_id = auth.uid()
  ));
drop policy if exists sections_delete_own on public.sections;
create policy sections_delete_own on public.sections
  for delete using (exists (
    select 1 from script_versions sv
    join speeches s on s.id = sv.speech_id
    where sv.id = sections.script_version_id and s.user_id = auth.uid()
  ));

-- sessions / transcripts / section_metrics / ai_reports: direct user_id
-- ownership, full CRUD scoped to the owner.
drop policy if exists sessions_select_own on public.sessions;
create policy sessions_select_own on public.sessions
  for select using (auth.uid() = user_id);
drop policy if exists sessions_insert_own on public.sessions;
create policy sessions_insert_own on public.sessions
  for insert with check (auth.uid() = user_id);
drop policy if exists sessions_update_own on public.sessions;
create policy sessions_update_own on public.sessions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists sessions_delete_own on public.sessions;
create policy sessions_delete_own on public.sessions
  for delete using (auth.uid() = user_id);

drop policy if exists transcripts_select_own on public.transcripts;
create policy transcripts_select_own on public.transcripts
  for select using (auth.uid() = user_id);
drop policy if exists transcripts_insert_own on public.transcripts;
create policy transcripts_insert_own on public.transcripts
  for insert with check (auth.uid() = user_id);
drop policy if exists transcripts_update_own on public.transcripts;
create policy transcripts_update_own on public.transcripts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists transcripts_delete_own on public.transcripts;
create policy transcripts_delete_own on public.transcripts
  for delete using (auth.uid() = user_id);

drop policy if exists section_metrics_select_own on public.section_metrics;
create policy section_metrics_select_own on public.section_metrics
  for select using (auth.uid() = user_id);
drop policy if exists section_metrics_insert_own on public.section_metrics;
create policy section_metrics_insert_own on public.section_metrics
  for insert with check (auth.uid() = user_id);
drop policy if exists section_metrics_update_own on public.section_metrics;
create policy section_metrics_update_own on public.section_metrics
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists section_metrics_delete_own on public.section_metrics;
create policy section_metrics_delete_own on public.section_metrics
  for delete using (auth.uid() = user_id);

drop policy if exists ai_reports_select_own on public.ai_reports;
create policy ai_reports_select_own on public.ai_reports
  for select using (auth.uid() = user_id);
drop policy if exists ai_reports_insert_own on public.ai_reports;
create policy ai_reports_insert_own on public.ai_reports
  for insert with check (auth.uid() = user_id);
drop policy if exists ai_reports_update_own on public.ai_reports;
create policy ai_reports_update_own on public.ai_reports
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists ai_reports_delete_own on public.ai_reports;
create policy ai_reports_delete_own on public.ai_reports
  for delete using (auth.uid() = user_id);


-- ============================================================================
-- 7. Storage — recordings bucket + per-user folder policies
-- ============================================================================

-- Private bucket; audio lives at {user_id}/{session_id}.{ext}.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'recordings',
  'recordings',
  false,
  104857600, -- 100 MB
  array['audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/wav','audio/x-m4a']
)
on conflict (id) do nothing;

drop policy if exists recordings_select_own on storage.objects;
create policy recordings_select_own on storage.objects
  for select using (
    bucket_id = 'recordings' and (storage.foldername(name))[1] = (auth.uid())::text
  );
drop policy if exists recordings_insert_own on storage.objects;
create policy recordings_insert_own on storage.objects
  for insert with check (
    bucket_id = 'recordings' and (storage.foldername(name))[1] = (auth.uid())::text
  );
drop policy if exists recordings_update_own on storage.objects;
create policy recordings_update_own on storage.objects
  for update using (
    bucket_id = 'recordings' and (storage.foldername(name))[1] = (auth.uid())::text
  );
drop policy if exists recordings_delete_own on storage.objects;
create policy recordings_delete_own on storage.objects
  for delete using (
    bucket_id = 'recordings' and (storage.foldername(name))[1] = (auth.uid())::text
  );
