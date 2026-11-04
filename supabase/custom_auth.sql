-- Replace Supabase Auth identities with application-managed credentials.
-- Existing student/admin profile IDs are retained; users set a new password
-- through the Brevo OTP password-reset flow before signing in again.

do $$
declare
  fk record;
begin
  for fk in
    select conrelid::regclass as table_name, conname
    from pg_constraint
    where contype = 'f'
      and confrelid = 'auth.users'::regclass
      and conrelid in ('public.students'::regclass, 'public.admins'::regclass)
  loop
    execute format('alter table %s drop constraint %I', fk.table_name, fk.conname);
  end loop;
end;
$$;

create table if not exists public.auth_credentials (
  id              uuid primary key,
  email           text unique not null,
  password_hash   text,
  role            text not null check (role in ('student', 'admin')),
  email_verified  boolean not null default false,
  session_version integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.auth_otps (
  email      text not null,
  purpose    text not null check (purpose in ('signup', 'reset')),
  code_hash  text not null,
  payload    jsonb,
  attempts   integer not null default 0,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (email, purpose)
);

create table if not exists public.auth_rate_limits (
  ip_hash            text primary key,
  window_started_at  timestamptz not null,
  request_count      integer not null default 0
);

alter table public.auth_credentials enable row level security;
alter table public.auth_otps enable row level security;
alter table public.auth_rate_limits enable row level security;

revoke all on table
  public.students, public.admins, public.reports, public.awareness_content,
  public.notifications, public.custom_locations, public.grade_sections,
  public.auth_credentials, public.auth_otps, public.auth_rate_limits
from public, anon, authenticated;

revoke all on sequence
  public.reports_id_seq, public.awareness_content_id_seq,
  public.notifications_id_seq, public.grade_sections_id_seq
from public, anon, authenticated;

grant all on table
  public.students, public.admins, public.reports, public.awareness_content,
  public.notifications, public.custom_locations, public.grade_sections,
  public.auth_credentials, public.auth_otps, public.auth_rate_limits
to service_role;

grant usage, select, update on sequence
  public.reports_id_seq, public.awareness_content_id_seq,
  public.notifications_id_seq, public.grade_sections_id_seq
to service_role;

do $$
declare
  routine text;
begin
  foreach routine in array array[
    'public.is_admin()',
    'public.get_unconfirmed_signups()',
    'public.is_lrn_taken(text)',
    'public.decline_student_signup(uuid)',
    'public.request_conference_change(bigint, text, text)'
  ]
  loop
    if to_regprocedure(routine) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', routine);
    end if;
  end loop;
end;
$$;
