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

create index if not exists faultspan_cases_owner_idx on public.faultspan_cases (owner);
create index if not exists faultspan_cases_updated_at_idx on public.faultspan_cases (updated_at desc);

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

alter table public.faultspan_cases enable row level security;

-- No public RLS policies are required for the app path because the backend uses the service-role key.
-- If you later expose this table directly to the browser, add restrictive select policies first.
