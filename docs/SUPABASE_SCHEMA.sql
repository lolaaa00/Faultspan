-- Faultspan Supabase Postgres projection schema.
-- Run this once in Supabase Dashboard -> SQL Editor for the configured project.
-- The API writes through the server-side service-role key; do not expose that key to the frontend.

create table if not exists public.faultspan_cases (
  case_id text primary key,
  title text not null,
  owner text not null,
  coordinator text not null,
  contract_address text not null,
  tx_hash text,
  status text not null default 'CREATED',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.faultspan_spans (
  case_id text not null,
  span_id text not null,
  parent_id text,
  requester text not null,
  provider text not null,
  obligation text not null,
  bond_wei text not null,
  status text not null default 'PROPOSED',
  tx_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (case_id, span_id)
);

create table if not exists public.faultspan_activity (
  activity_id text primary key,
  case_id text not null,
  span_id text,
  actor text not null,
  action text not null,
  status text not null default 'FINALIZED',
  tx_hash text,
  summary text not null,
  created_at timestamptz not null default now()
);

create index if not exists faultspan_cases_owner_idx on public.faultspan_cases (owner);
create index if not exists faultspan_cases_updated_at_idx on public.faultspan_cases (updated_at desc);
create index if not exists faultspan_spans_case_idx on public.faultspan_spans (case_id, updated_at desc);
create index if not exists faultspan_spans_tx_hash_idx on public.faultspan_spans (tx_hash);
create index if not exists faultspan_activity_case_idx on public.faultspan_activity (case_id, created_at desc);
create index if not exists faultspan_activity_tx_hash_idx on public.faultspan_activity (tx_hash);

create or replace function public.set_faultspan_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists faultspan_cases_set_updated_at on public.faultspan_cases;
create trigger faultspan_cases_set_updated_at
before update on public.faultspan_cases
for each row
execute function public.set_faultspan_updated_at();

drop trigger if exists faultspan_spans_set_updated_at on public.faultspan_spans;
create trigger faultspan_spans_set_updated_at
before update on public.faultspan_spans
for each row
execute function public.set_faultspan_updated_at();

alter table public.faultspan_cases enable row level security;
alter table public.faultspan_spans enable row level security;
alter table public.faultspan_activity enable row level security;

grant usage on schema public to service_role;
grant select, insert, update, delete on public.faultspan_cases to service_role;
grant select, insert, update, delete on public.faultspan_spans to service_role;
grant select, insert, update, delete on public.faultspan_activity to service_role;

-- No public RLS policies are required for the app path because the backend uses the service-role key.
-- If you later expose this table directly to the browser, add restrictive select policies first.
