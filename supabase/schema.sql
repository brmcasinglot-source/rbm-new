-- CNHS Bullying & Incident Reporting System — Supabase schema + RLS
-- Run this ONCE in Supabase Dashboard → SQL Editor → New query → Run.
-- Safe to run even though students/reports/etc. already exist: they're
-- currently empty, so this drops and recreates them cleanly with the
-- correct auth-aware shape.

drop table if exists notifications cascade;
drop table if exists reports cascade;
drop table if exists custom_locations cascade;
drop table if exists awareness_content cascade;
drop table if exists students cascade;
drop table if exists admins cascade;

-- ─── STUDENTS ──────────────────────────────────────────────────────────────
-- id matches the Supabase Auth user's UUID (auth.users.id) 1:1.
create table students (
  id         uuid primary key references auth.users(id) on delete cascade,
  name       text not null,
  email      text unique not null,
  lrn        text unique,
  age        int,
  sex        text,
  grade      text,
  section    text,
  approved   boolean not null default false,
  created_at timestamptz default now()
);

-- ─── ADMINS ────────────────────────────────────────────────────────────────
-- Allowlist of who counts as an admin. Same idea: id = auth.users.id.
create table admins (
  id    uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  name  text
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

-- Helper: is the currently logged-in user an admin?
-- security definer so it can read the admins table even though the caller
-- (a plain student) has no direct select policy on admins.
create or replace function is_admin() returns boolean
language sql security definer stable as $$
  select exists (select 1 from admins where id = auth.uid());
$$;

-- Lets an admin see student sign-ups still waiting on their Gmail
-- confirmation link. auth.users isn't exposed to normal clients at all —
-- this is security definer so it can read it, but it self-checks is_admin()
-- so only an actual admin caller gets real rows back.
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
      u.id, u.email::text,
      (u.raw_user_meta_data->>'name')::text    as name,
      (u.raw_user_meta_data->>'lrn')::text     as lrn,
      (u.raw_user_meta_data->>'grade')::text   as grade,
      (u.raw_user_meta_data->>'section')::text as section,
      u.created_at
    from auth.users u
    where u.email_confirmed_at is null
      and not exists (select 1 from students s where s.id = u.id)
      and not exists (select 1 from admins   a where a.id = u.id)
    order by u.created_at desc;
end;
$$;

grant execute on function get_unconfirmed_signups() to authenticated;

-- Lets the Sign Up form check LRN uniqueness before creating an account.
-- students.lrn is already `unique`, but RLS blocks an anonymous visitor
-- from querying the students table directly — this only ever returns a
-- boolean, so it's safe to expose to anon. security definer so it can also
-- see auth.users metadata for pending (not yet email-confirmed) sign-ups,
-- not just already-confirmed students.
create or replace function is_lrn_taken(check_lrn text) returns boolean
language plpgsql security definer stable as $$
begin
  return exists (select 1 from students where lrn = check_lrn)
      or exists (
        select 1 from auth.users
        where raw_user_meta_data->>'lrn' = check_lrn and email_confirmed_at is null
      );
end;
$$;

grant execute on function is_lrn_taken(text) to anon, authenticated;

-- Fully removes a declined student sign-up — including the underlying Auth
-- account, not just the students-table row (a plain `delete from students`
-- leaves auth.users behind, which then blocks the same email/LRN from ever
-- signing up again). security definer so it can reach auth.users, which
-- normal clients can't touch at all; self-checks is_admin() so only an
-- actual admin caller can invoke it. `students` cascades automatically via
-- its `references auth.users(id) on delete cascade` foreign key.
create or replace function decline_student_signup(target_id uuid) returns void
language plpgsql security definer as $$
begin
  if not is_admin() then
    raise exception 'Not authorized';
  end if;

  delete from auth.users where id = target_id;
end;
$$;

grant execute on function decline_student_signup(uuid) to authenticated;

-- students
create policy "students select own or admin" on students for select
  using (auth.uid() = id or is_admin());
create policy "students insert own" on students for insert
  with check (auth.uid() = id);
create policy "students update own" on students for update
  using (auth.uid() = id) with check (auth.uid() = id);
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
create policy "grade_sections delete admin" on grade_sections for delete
  using (is_admin());

-- Seed the built-in location metadata that used to live only in the frontend
-- (LOCATION_META) as regular rows too? No — LOCATION_META stays a frontend
-- constant (it's not admin-editable), only admin-added extra places go here.
