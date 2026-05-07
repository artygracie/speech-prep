-- Drafts: speech drafts submitted for human review before publication.
-- draft_revisions: immutable audit log for state changes and system events.

create table if not exists drafts (
  id               uuid        primary key default gen_random_uuid(),
  title            text        not null,
  status           text        not null default 'awaiting_review'
                               check (status in ('awaiting_review', 'approved', 'rejected')),
  status_reason    text,
  pr_number        integer,
  email_sent_at    timestamptz not null default now(),
  reminder_sent_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists draft_revisions (
  id         uuid        primary key default gen_random_uuid(),
  draft_id   uuid        not null references drafts(id) on delete cascade,
  kind       text        not null,
  content    text        not null,
  created_at timestamptz not null default now()
);

-- Keep updated_at current automatically.
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger drafts_updated_at
  before update on drafts
  for each row execute function set_updated_at();
