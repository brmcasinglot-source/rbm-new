-- CNHS Bullying & Incident Reporting System — Supabase schema + RLS
-- Run this ONCE in Supabase Dashboard → SQL Editor → New query → Run.
-- Safe to run only when creating a new database. This drops and recreates
-- the application tables.

drop table if exists notifications cascade;
drop table if exists reports cascade;
drop table if exists custom_locations cascade;
drop table if exists awareness_content cascade;
drop table if exists students cascade;
drop table if exists admins cascade;
drop table if exists auth_otps cascade;
drop table if exists auth_rate_limits cascade;
drop table if exists auth_credentials cascade;

-- ─── STUDENTS ──────────────────────────────────────────────────────────────
create table students (
  id         uuid primary key,
  name       text not null,
  email      text unique not null,
  lrn        text unique,
  age        int,
  sex        text,
  grade      text,
  section    text,
  student_id_front_path text,
  student_id_back_path  text,
  approved   boolean not null default false,
  created_at timestamptz default now()
);

-- ─── ADMINS ────────────────────────────────────────────────────────────────
create table admins (
  id    uuid primary key,
  email text unique not null,
  name  text
);

-- Custom credentials and short-lived OTP challenges. Access is server-only.
create table auth_credentials (
  id              uuid primary key,
  email           text unique not null,
  password_hash   text,
  role            text not null check (role in ('student', 'admin')),
  email_verified  boolean not null default false,
  session_version integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table auth_otps (
  email      text not null,
  purpose    text not null check (purpose in ('signup', 'reset')),
  code_hash  text not null,
  payload    jsonb,
  attempts   integer not null default 0,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (email, purpose)
);

create table auth_rate_limits (
  ip_hash           text primary key,
  window_started_at timestamptz not null,
  request_count     integer not null default 0
);

-- ─── REPORTS ───────────────────────────────────────────────────────────────
create table reports (
  id                    bigint generated always as identity primary key,
  type                  text not null,
  date                  date not null,
  time                  text,
  location              text,
  description           text,
  description_lead_up   text,
  description_impact    text,
  description_actions   text,
  reporter_type         text,
  victims               jsonb default '[]',
  offenders             jsonb default '[]',
  witnesses             jsonb default '[]',
  status                text default 'Pending',
  priority              text,
  submitted_by          text,
  submitted_id          uuid references students(id) on delete cascade,
  reporter_age          int,
  reporter_sex          text,
  reporter_grade        text,
  reporter_section      text,
  is_anonymous          boolean default false,
  admin_notes           text,
  evidence              jsonb default '[]',
  scheduled_conference  jsonb,
  submitted_at          timestamptz default now(),
  updated_at            timestamptz
);

-- ─── AWARENESS CONTENT ─────────────────────────────────────────────────────
create table awareness_content (
  id        bigint generated always as identity primary key,
  type      text,
  title     text,
  "desc"    text,
  link      text,
  thumbnail text,
  video_url text
);

-- ─── NOTIFICATIONS ─────────────────────────────────────────────────────────
create table notifications (
  id         bigint generated always as identity primary key,
  audience   text check (audience in ('student','admin')) not null,
  student_id uuid references students(id) on delete cascade, -- null = broadcast to all students
  title      text,
  type       text,
  read       boolean default false,
  created_at timestamptz default now()
);

-- ─── CUSTOM LOCATIONS ──────────────────────────────────────────────────────
create table custom_locations (
  key      text primary key,
  icon     text,
  color    text,
  zone     text check (zone in ('inside','outside')),
  keywords jsonb default '[]',
  custom   boolean default true
);

-- ─── GRADE SECTIONS ────────────────────────────────────────────────────────
-- Admin-managed list of sections per grade level, used by the Admin
-- Dashboard's "Grade & Sections" page and (optionally) registration/filters.
create table grade_sections (
  id         bigint generated always as identity primary key,
  grade      text not null check (grade in ('Grade 7','Grade 8','Grade 9','Grade 10')),
  section    text not null,
  created_at timestamptz default now(),
  unique (grade, section)
);

-- ─── ROW LEVEL SECURITY ────────────────────────────────────────────────────
alter table students           enable row level security;
alter table admins             enable row level security;
alter table reports            enable row level security;
alter table awareness_content  enable row level security;
alter table notifications      enable row level security;
alter table custom_locations   enable row level security;
alter table grade_sections     enable row level security;
alter table auth_credentials  enable row level security;
alter table auth_otps         enable row level security;
alter table auth_rate_limits  enable row level security;

revoke all on auth_credentials, auth_otps, auth_rate_limits from anon, authenticated;

-- Helper: is the currently logged-in user an admin?
-- security definer so it can read the admins table even though the caller
-- (a plain student) has no direct select policy on admins.
create or replace function is_admin() returns boolean
language sql security definer stable as $$
  select exists (select 1 from admins where id = auth.uid());
$$;

-- Lets an admin see student sign-ups still waiting on their email OTP.
create or replace function get_unconfirmed_signups()
returns table (
  id uuid, email text, name text, lrn text, grade text, section text, created_at timestamptz
)
language plpgsql security definer stable as $$
begin
  if not is_admin() then
    raise exception 'Not authorized';
  end if;

  return query
    select
      (o.payload->>'id')::uuid,
      o.email,
      o.payload->>'name',
      o.payload->>'lrn',
      o.payload->>'grade',
      o.payload->>'section',
      o.created_at
    from auth_otps o
    where o.purpose = 'signup'
      and o.expires_at > now()
    order by o.created_at desc;
end;
$$;

grant execute on function get_unconfirmed_signups() to authenticated;

-- Lets the Sign Up form check LRN uniqueness before creating an account.
-- Check uniqueness for existing students and registrations waiting on email OTP.
create or replace function is_lrn_taken(check_lrn text) returns boolean
language plpgsql security definer stable as $$
begin
  return exists (select 1 from students where lrn = check_lrn)
      or exists (
        select 1 from auth_otps
        where purpose = 'signup' and expires_at > now() and payload->>'lrn' = check_lrn
      );
end;
$$;

grant execute on function is_lrn_taken(text) to anon, authenticated;

-- Removes a declined student account and its custom credentials.
create or replace function decline_student_signup(target_id uuid) returns void
language plpgsql security definer as $$
declare
  target_email text;
begin
  if not is_admin() then
    raise exception 'Not authorized';
  end if;

  select email into target_email from students where id = target_id;
  delete from students where id = target_id;
  delete from auth_credentials where id = target_id;
  delete from auth_otps where email = target_email;
end;
$$;

grant execute on function decline_student_signup(uuid) to authenticated;

-- students
create policy "students select own or admin" on students for select
  using (auth.uid() = id or is_admin());
create policy "students insert own" on students for insert
  with check (auth.uid() = id);
create policy "students update admin" on students for update
  using (is_admin());
create policy "students delete admin" on students for delete
  using (is_admin());

-- admins (only an admin can see the allowlist; nobody can write to it from
-- the app — you add admins manually via SQL Editor)
create policy "admins select self" on admins for select
  using (auth.uid() = id);

-- reports
create policy "reports insert own" on reports for insert
  with check (auth.uid() = submitted_id);
create policy "reports select own or admin" on reports for select
  using (auth.uid() = submitted_id or is_admin());
create policy "reports update admin" on reports for update
  using (is_admin());
create policy "reports delete admin" on reports for delete
  using (is_admin());

-- Students may submit a conference request, but cannot update the official
-- conference status or schedule. This RPC checks ownership and updates only
-- the request state so the existing admin-only reports update policy remains.
create or replace function request_conference_change(
  target_report_id bigint,
  request_type text,
  request_reason text default ''
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_report reports%rowtype;
  conference jsonb;
  current_status text;
  requested_status text;
  request_data jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if request_type is null or request_type not in ('reschedule', 'cancellation') then
    raise exception 'Invalid conference request';
  end if;

  select * into current_report
  from reports
  where id = target_report_id
  for update;
  if not found or current_report.submitted_id is distinct from auth.uid() then
    raise exception 'Conference not found';
  end if;

  conference := coalesce(current_report.scheduled_conference, '{}'::jsonb);
  if nullif(conference->>'date', '') is null
    and nullif(conference->>'time', '') is null
    and nullif(conference->>'location', '') is null then
    raise exception 'No scheduled conference exists for this report';
  end if;
  current_status := coalesce(
    conference->>'status',
    case when coalesce((conference->>'completed')::boolean, false) then 'Completed' else 'Scheduled' end
  );
  if current_status not in ('Scheduled', 'Rescheduled') then
    raise exception 'This conference cannot accept a new request in its current status';
  end if;

  requested_status := case
    when request_type = 'reschedule' then 'Reschedule Requested'
    else 'Cancellation Requested'
  end;
  request_data := jsonb_build_object(
    'type', request_type,
    'reason', coalesce(trim(request_reason), ''),
    'requestedAt', now(),
    'previousStatus', current_status,
    'state', 'Pending'
  );
  conference := conference || jsonb_build_object(
    'status', requested_status,
    'completed', false,
    'request', request_data
  );

  update reports
  set scheduled_conference = conference, updated_at = now()
  where id = target_report_id;

  insert into notifications (audience, student_id, title, type, read)
  values (
    'admin',
    null,
    format(
      'Case #%s conference %s requested by %s.',
      target_report_id,
      request_type,
      case when current_report.is_anonymous then 'a student' else current_report.submitted_by end
    ),
    'status',
    false
  );

  return conference;
end;
$$;

revoke all on function request_conference_change(bigint, text, text) from public;
grant execute on function request_conference_change(bigint, text, text) to authenticated;

-- awareness_content — any signed-in user can read; only admins manage it
create policy "awareness select authenticated" on awareness_content for select
  using (auth.role() = 'authenticated');
create policy "awareness insert admin" on awareness_content for insert
  with check (is_admin());
create policy "awareness update admin" on awareness_content for update
  using (is_admin());
create policy "awareness delete admin" on awareness_content for delete
  using (is_admin());

-- notifications
create policy "notifications select own" on notifications for select
  using (
    (audience = 'student' and (student_id = auth.uid() or student_id is null))
    or (audience = 'admin' and is_admin())
  );
create policy "notifications insert authenticated" on notifications for insert
  with check (auth.role() = 'authenticated');
create policy "notifications update own" on notifications for update
  using (
    (audience = 'student' and (student_id = auth.uid() or student_id is null))
    or (audience = 'admin' and is_admin())
  );
create policy "notifications delete admin" on notifications for delete
  using (is_admin());

-- custom_locations — any signed-in user can read; only admins manage it
create policy "locations select authenticated" on custom_locations for select
  using (auth.role() = 'authenticated');
create policy "locations insert admin" on custom_locations for insert
  with check (is_admin());
create policy "locations update admin" on custom_locations for update
  using (is_admin());
create policy "locations delete admin" on custom_locations for delete
  using (is_admin());

-- grade_sections — public read (the Sign Up form needs it before the visitor
-- has an account/session); only admins manage it
create policy "grade_sections select public" on grade_sections for select
  using (true);
create policy "grade_sections insert admin" on grade_sections for insert
  with check (is_admin());
create policy "grade_sections update admin" on grade_sections for update
  using (is_admin()) with check (is_admin());
create policy "grade_sections delete admin" on grade_sections for delete
  using (is_admin());

-- Seed the built-in location metadata that used to live only in the frontend
-- (LOCATION_META) as regular rows too? No — LOCATION_META stays a frontend
-- constant (it's not admin-editable), only admin-added extra places go here.

-- The browser has no direct database grants; all access is mediated by the
-- authenticated server API using the server-only service-role key.
revoke all on table
  students, admins, reports, awareness_content, notifications,
  custom_locations, grade_sections, auth_credentials, auth_otps, auth_rate_limits
from public, anon, authenticated;

revoke all on sequence
  reports_id_seq, awareness_content_id_seq, notifications_id_seq, grade_sections_id_seq
from public, anon, authenticated;

grant all on table
  students, admins, reports, awareness_content, notifications,
  custom_locations, grade_sections, auth_credentials, auth_otps, auth_rate_limits
to service_role;

grant usage, select, update on sequence
  reports_id_seq, awareness_content_id_seq, notifications_id_seq, grade_sections_id_seq
to service_role;

revoke execute on function is_admin() from public, anon, authenticated;
revoke execute on function get_unconfirmed_signups() from public, anon, authenticated;
revoke execute on function is_lrn_taken(text) from public, anon, authenticated;
revoke execute on function decline_student_signup(uuid) from public, anon, authenticated;
revoke execute on function request_conference_change(bigint, text, text) from public, anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'student-ids',
  'student-ids',
  false,
  1000000,
  array['image/webp']
)
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
