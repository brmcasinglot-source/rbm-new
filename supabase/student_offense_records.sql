-- Apply once to an existing Supabase project to add admin-managed,
-- established Student Offense Records. No report or conference automatically
-- creates an offense record. Mediation resolves reports without an offense
-- record; established decisions carry a follow-up date for monitoring.
-- After applying, deploy the updated `api` Edge Function so its admin-only
-- RPC allowlist can call these database functions.

alter table public.reports
  add column if not exists conference_findings text,
  add column if not exists conference_findings_updated_by uuid references public.admins(id) on delete set null,
  add column if not exists conference_findings_updated_at timestamptz;

create table if not exists public.report_student_links (
  id bigint generated always as identity primary key,
  report_id bigint not null references public.reports(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete restrict,
  linked_by uuid not null references public.admins(id) on delete restrict,
  linked_at timestamptz not null default now(),
  unique (report_id, student_id)
);

create table if not exists public.student_offense_decisions (
  id bigint generated always as identity primary key,
  report_id bigint not null references public.reports(id) on delete restrict,
  student_id uuid references public.students(id) on delete set null,
  person_key text not null,
  student_name text not null,
  student_lrn text,
  student_grade text not null,
  student_section text,
  outcome text not null check (outcome in (
    'Established', 'Needs Further Investigation', 'Not Established', 'Resolved Through Mediation'
  )),
  findings text not null,
  conference_findings text,
  admin_remarks text,
  disciplinary_action text,
  follow_up_date date,
  reviewed_at date not null default current_date,
  decided_by uuid not null references public.admins(id) on delete restrict,
  decided_at timestamptz not null default now(),
  unique (id, report_id, person_key)
);

create table if not exists public.student_offense_records (
  id bigint generated always as identity primary key,
  student_id uuid references public.students(id) on delete set null,
  person_key text not null,
  student_name text not null,
  student_lrn text,
  student_grade text not null,
  student_section text,
  incident_report_id bigint not null references public.reports(id) on delete restrict,
  decision_id bigint not null unique,
  offense_number integer not null check (offense_number > 0),
  conference_findings text,
  admin_remarks text,
  reviewed_at date not null default current_date,
  disciplinary_action text not null check (length(trim(disciplinary_action)) > 0),
  follow_up_date date,
  approved_by uuid not null references public.admins(id) on delete restrict,
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.student_offense_record_reports (
  offense_record_id bigint not null references public.student_offense_records(id) on delete cascade,
  report_id bigint not null references public.reports(id) on delete restrict,
  person_key text not null,
  created_at timestamptz not null default now(),
  primary key (offense_record_id, report_id),
  unique (person_key, report_id)
);

create table if not exists public.student_offense_audit (
  id bigint generated always as identity primary key,
  action text not null,
  student_id uuid,
  report_id bigint,
  offense_record_id bigint,
  actor_id uuid not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.student_offense_decisions
  add column if not exists person_key text,
  add column if not exists student_name text,
  add column if not exists student_lrn text,
  add column if not exists student_grade text,
  add column if not exists student_section text,
  add column if not exists conference_findings text,
  add column if not exists admin_remarks text,
  add column if not exists disciplinary_action text,
  add column if not exists follow_up_date date,
  add column if not exists reviewed_at date;

alter table public.student_offense_records
  add column if not exists person_key text,
  add column if not exists student_name text,
  add column if not exists student_lrn text,
  add column if not exists student_grade text,
  add column if not exists student_section text,
  add column if not exists admin_remarks text,
  add column if not exists reviewed_at date,
  add column if not exists follow_up_date date;

create or replace function public.offense_person_key(
  student_lrn text, student_name text, student_grade text, student_section text
) returns text
language sql immutable
as $$
  select case
    when nullif(lower(regexp_replace(trim(coalesce(student_lrn, '')), '\s+', '', 'g')), '') is not null
      then 'lrn:' || lower(regexp_replace(trim(student_lrn), '\s+', '', 'g'))
    else 'profile:' || md5(jsonb_build_array(
      lower(trim(coalesce(student_name, ''))),
      lower(trim(coalesce(student_grade, ''))),
      lower(trim(coalesce(student_section, '')))
    )::text)
  end;
$$;

update public.student_offense_decisions d
set student_name = coalesce(d.student_name, s.name, 'Unknown student'),
    student_lrn = coalesce(d.student_lrn, s.lrn),
    student_grade = coalesce(d.student_grade, s.grade, 'Unknown'),
    student_section = coalesce(d.student_section, s.section),
    person_key = coalesce(d.person_key,
      public.offense_person_key(s.lrn, s.name, s.grade, s.section)),
    reviewed_at = coalesce(d.reviewed_at, d.decided_at::date, current_date)
from public.students s
where d.student_id = s.id
  and (d.person_key is null or d.student_name is null or d.student_grade is null or d.reviewed_at is null);

update public.student_offense_decisions
set student_name = coalesce(student_name, 'Unknown student'),
    student_grade = coalesce(student_grade, 'Unknown'),
    person_key = coalesce(person_key,
      public.offense_person_key(student_lrn, student_name, student_grade, student_section)),
    reviewed_at = coalesce(reviewed_at, decided_at::date, current_date)
where person_key is null or student_name is null or student_grade is null or reviewed_at is null;

update public.student_offense_records o
set student_name = coalesce(o.student_name, s.name, 'Unknown student'),
    student_lrn = coalesce(o.student_lrn, s.lrn),
    student_grade = coalesce(o.student_grade, s.grade, 'Unknown'),
    student_section = coalesce(o.student_section, s.section),
    person_key = coalesce(o.person_key, d.person_key, public.offense_person_key(s.lrn, s.name, s.grade, s.section)),
    admin_remarks = coalesce(o.admin_remarks, d.admin_remarks),
    reviewed_at = coalesce(o.reviewed_at, d.reviewed_at, o.approved_at::date, current_date)
from public.students s, public.student_offense_decisions d
where o.student_id = s.id and d.id = o.decision_id
  and (o.person_key is null or o.student_name is null or o.student_grade is null or o.reviewed_at is null);

update public.student_offense_records o
set student_name = coalesce(o.student_name, d.student_name, 'Unknown student'),
    student_lrn = coalesce(o.student_lrn, d.student_lrn),
    student_grade = coalesce(o.student_grade, d.student_grade, 'Unknown'),
    student_section = coalesce(o.student_section, d.student_section),
    person_key = coalesce(o.person_key, d.person_key,
      public.offense_person_key(d.student_lrn, d.student_name, d.student_grade, d.student_section)),
    admin_remarks = coalesce(o.admin_remarks, d.admin_remarks),
    reviewed_at = coalesce(o.reviewed_at, d.reviewed_at, o.approved_at::date, current_date)
from public.student_offense_decisions d
where d.id = o.decision_id
  and (o.person_key is null or o.student_name is null or o.student_grade is null or o.reviewed_at is null);

update public.student_offense_decisions d
set disciplinary_action = o.disciplinary_action
from public.student_offense_records o
where o.decision_id = d.id and d.disciplinary_action is null;

alter table public.student_offense_decisions alter column student_id drop not null;
alter table public.student_offense_decisions alter column person_key set not null;
alter table public.student_offense_decisions alter column student_name set not null;
alter table public.student_offense_decisions alter column student_grade set not null;
alter table public.student_offense_decisions alter column reviewed_at set not null;
alter table public.student_offense_records alter column student_id drop not null;
alter table public.student_offense_records alter column person_key set not null;
alter table public.student_offense_records alter column student_name set not null;
alter table public.student_offense_records alter column student_grade set not null;
alter table public.student_offense_records alter column reviewed_at set not null;

insert into public.student_offense_record_reports (offense_record_id, report_id, person_key)
select id, incident_report_id, person_key
from public.student_offense_records
on conflict (offense_record_id, report_id) do nothing;

alter table public.student_offense_decisions
  drop constraint if exists student_offense_decisions_student_id_fkey;
alter table public.student_offense_decisions
  add constraint student_offense_decisions_student_id_fkey
  foreign key (student_id) references public.students(id) on delete set null;
alter table public.student_offense_records
  drop constraint if exists student_offense_records_student_id_incident_report_id_key,
  drop constraint if exists student_offense_records_student_id_offense_number_key,
  drop constraint if exists student_offense_records_decision_id_incident_report_id_student_id_fkey,
  drop constraint if exists student_offense_records_student_id_fkey;
alter table public.student_offense_records
  add constraint student_offense_records_student_id_fkey
  foreign key (student_id) references public.students(id) on delete set null;
alter table public.student_offense_records
  drop constraint if exists student_offense_records_decision_person_fkey;
alter table public.student_offense_decisions
  drop constraint if exists student_offense_decisions_id_report_id_person_key_key;
alter table public.student_offense_decisions
  add constraint student_offense_decisions_id_report_id_person_key_key unique (id, report_id, person_key);
alter table public.student_offense_records
  drop constraint if exists student_offense_records_person_incident_key,
  drop constraint if exists student_offense_records_person_offense_key;
alter table public.student_offense_records
  add constraint student_offense_records_person_incident_key unique (person_key, incident_report_id),
  add constraint student_offense_records_person_offense_key unique (person_key, offense_number);
alter table public.student_offense_records
  add constraint student_offense_records_decision_person_fkey
  foreign key (decision_id, incident_report_id, person_key)
  references public.student_offense_decisions(id, report_id, person_key) on delete restrict;

create index if not exists report_student_links_student_idx
  on public.report_student_links (student_id, report_id);
create index if not exists student_offense_records_student_idx
  on public.student_offense_records (student_id, offense_number desc);
create index if not exists student_offense_records_person_idx
  on public.student_offense_records (person_key, offense_number desc);
create index if not exists student_offense_decisions_person_idx
  on public.student_offense_decisions (person_key, report_id, decided_at desc, id desc);
create index if not exists student_offense_records_approved_idx
  on public.student_offense_records (approved_at desc);
create index if not exists student_offense_decisions_latest_idx
  on public.student_offense_decisions (student_id, report_id, decided_at desc, id desc);
create index if not exists student_offense_audit_student_idx
  on public.student_offense_audit (student_id, created_at desc);

create or replace function public.get_student_offense_filter_options(actor_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  result jsonb;
begin
  if not exists (select 1 from public.admins where id = actor_id) then
    raise exception 'Not authorized';
  end if;
  select jsonb_build_object(
    'grades', coalesce((
      select jsonb_agg(grade order by grade)
      from (select distinct grade from public.students where approved and nullif(trim(grade), '') is not null) g
    ), '[]'::jsonb),
    'sections', coalesce((
      select jsonb_agg(jsonb_build_object('grade', grade, 'section', section) order by grade, section)
      from public.grade_sections
    ), '[]'::jsonb),
    'actions', coalesce((
      select jsonb_agg(action order by action)
      from (select distinct disciplinary_action as action
        from public.student_offense_records where nullif(trim(disciplinary_action), '') is not null) a
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

alter table public.report_student_links enable row level security;
alter table public.student_offense_decisions enable row level security;
alter table public.student_offense_records enable row level security;
alter table public.student_offense_record_reports enable row level security;
alter table public.student_offense_audit enable row level security;

drop policy if exists "offense links admin read" on public.report_student_links;
create policy "offense links admin read" on public.report_student_links
  for select using (public.is_admin());
drop policy if exists "offense decisions admin read" on public.student_offense_decisions;
create policy "offense decisions admin read" on public.student_offense_decisions
  for select using (public.is_admin());
drop policy if exists "offense records admin read" on public.student_offense_records;
create policy "offense records admin read" on public.student_offense_records
  for select using (public.is_admin());
drop policy if exists "offense record reports admin read" on public.student_offense_record_reports;
create policy "offense record reports admin read" on public.student_offense_record_reports
  for select using (public.is_admin());
drop policy if exists "offense audit admin read" on public.student_offense_audit;
create policy "offense audit admin read" on public.student_offense_audit
  for select using (public.is_admin());

revoke all on table public.report_student_links, public.student_offense_decisions,
  public.student_offense_records, public.student_offense_record_reports, public.student_offense_audit
from public, anon, authenticated;
grant select on table public.report_student_links, public.student_offense_decisions,
  public.student_offense_records, public.student_offense_record_reports, public.student_offense_audit to authenticated;
grant all on table public.report_student_links, public.student_offense_decisions,
  public.student_offense_records, public.student_offense_record_reports, public.student_offense_audit to service_role;

create or replace function public.search_offense_students(
  actor_id uuid,
  search_term text default '',
  grade_filter text default null,
  section_filter text default null,
  page_size integer default 20
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  result jsonb;
  term text := lower(trim(coalesce(search_term, '')));
begin
  if not exists (select 1 from public.admins where id = actor_id) then
    raise exception 'Not authorized';
  end if;

  select coalesce(jsonb_agg(to_jsonb(matches)), '[]'::jsonb) into result
  from (
    select s.id, s.name, s.lrn, s.grade, s.section,
      (select count(*) from public.student_offense_records o where o.student_id = s.id) as established_offenses
    from public.students s
    where s.approved
      and (term = '' or lower(s.name) like '%' || term || '%'
        or lower(coalesce(s.lrn, '')) like '%' || term || '%'
        or lower(s.id::text) like '%' || term || '%')
      and (grade_filter is null or s.grade = grade_filter)
      and (section_filter is null or s.section = section_filter)
    order by s.name, s.id
    limit greatest(1, least(coalesce(page_size, 20), 50))
  ) matches;
  return result;
end;
$$;

create or replace function public.search_offense_reports(
  actor_id uuid,
  search_term text default '',
  target_student_id uuid default null,
  page_size integer default 20
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  result jsonb;
  term text := lower(trim(coalesce(search_term, '')));
begin
  if not exists (select 1 from public.admins where id = actor_id) then
    raise exception 'Not authorized';
  end if;

  select coalesce(jsonb_agg(to_jsonb(matches)), '[]'::jsonb) into result
  from (
    select r.id, r.type, r.date, r.status, r.location, r.description,
      r.evidence_count, r.scheduled_conference, r.conference_findings, r.submitted_at,
      case when coalesce(r.is_anonymous, false) then 'Anonymous' else r.submitted_by end as reporter_name,
      exists (
        select 1 from public.report_student_links l
        where l.report_id = r.id and l.student_id = target_student_id
      ) as linked_to_student
    from public.reports r
    where (target_student_id is null or exists (
      select 1 from public.report_student_links l
      where l.report_id = r.id and l.student_id = target_student_id
    ))
      and (term = '' or r.id::text like '%' || term || '%'
        or lower(coalesce(r.type, '')) like '%' || term || '%'
        or lower(coalesce(r.description, '')) like '%' || term || '%'
        or (not coalesce(r.is_anonymous, false)
          and lower(coalesce(r.submitted_by, '')) like '%' || term || '%')
        or coalesce(r.submitted_at::date::text, '') like '%' || term || '%')
    order by r.submitted_at desc nulls last, r.id desc
    limit greatest(1, least(coalesce(page_size, 20), 50))
  ) matches;
  return result;
end;
$$;

create or replace function public.get_student_offense_records(
  actor_id uuid,
  search_term text default '',
  grade_filter text default null,
  section_filter text default null,
  offense_filter text default null,
  bullying_type_filter text default null,
  date_from date default null,
  date_to date default null,
  action_filter text default null,
  sort_by text default 'recent',
  page_size integer default 25,
  page_offset integer default 0
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  result_records jsonb;
  matching_total bigint;
  stats jsonb;
  term text := lower(trim(coalesce(search_term, '')));
  safe_limit integer := greatest(1, least(coalesce(page_size, 25), 100));
  safe_offset integer := greatest(0, least(coalesce(page_offset, 0), 100000));
begin
  if not exists (select 1 from public.admins where id = actor_id) then
    raise exception 'Not authorized';
  end if;
  if sort_by not in ('name_asc', 'name_desc', 'recent', 'oldest', 'most_offenses', 'least_offenses') then
    raise exception 'Invalid sort order';
  end if;
  if offense_filter is not null and offense_filter not in ('1', '2', '3', '4+') then
    raise exception 'Invalid offense number filter';
  end if;
  if bullying_type_filter is not null and lower(bullying_type_filter) not in ('physical', 'verbal', 'social', 'cyber') then
    raise exception 'Invalid bullying type filter';
  end if;
  if date_from is not null and date_to is not null and date_from > date_to then
    raise exception 'Start date must be on or before end date';
  end if;

  with all_records as (
    select o.id, o.student_id, o.person_key, o.incident_report_id, o.offense_number,
      array(select rr.report_id from public.student_offense_record_reports rr
        where rr.offense_record_id = o.id order by rr.report_id) as incident_report_ids,
      o.conference_findings, o.admin_remarks, o.reviewed_at, o.follow_up_date,
      case
        when o.follow_up_date is null then 'Not scheduled'
        when o.follow_up_date < current_date then 'Overdue'
        else 'Monitoring'
      end as follow_up_status,
      o.disciplinary_action, o.approved_by, o.approved_at,
      o.student_name, o.student_lrn as lrn, o.student_grade as grade, o.student_section as section,
      r.type as incident_type, r.date as incident_date, a.name as approved_by_name,
      d.findings as decision_findings,
      count(*) over (partition by o.person_key) as student_offense_count
    from public.student_offense_records o
    join public.reports r on r.id = o.incident_report_id
    join public.admins a on a.id = o.approved_by
    join public.student_offense_decisions d on d.id = o.decision_id
  ), matching as (
    select * from all_records m
    where (term = '' or lower(m.student_name) like '%' || term || '%'
      or lower(coalesce(m.lrn, '')) like '%' || term || '%'
      or exists (select 1 from unnest(m.incident_report_ids) as linked(report_id)
        where linked.report_id::text like '%' || term || '%'))
      and (grade_filter is null or m.grade = grade_filter)
      and (section_filter is null or m.section = section_filter)
      and (offense_filter is null or case
        when offense_filter = '4+' then m.offense_number >= 4
        else m.offense_number = offense_filter::integer
      end)
      and (bullying_type_filter is null
        or lower(m.incident_type) = lower(bullying_type_filter)
        or lower(m.incident_type) = lower(bullying_type_filter) || ' bullying'
        or (lower(bullying_type_filter) = 'cyber' and lower(m.incident_type) = 'cyberbullying'))
      and (date_from is null or m.reviewed_at >= date_from)
      and (date_to is null or m.reviewed_at <= date_to)
      and (action_filter is null or m.disciplinary_action = action_filter)
  )
  select count(*) into matching_total from matching;

  with all_records as (
    select o.id, o.student_id, o.person_key, o.incident_report_id, o.offense_number,
      array(select rr.report_id from public.student_offense_record_reports rr
        where rr.offense_record_id = o.id order by rr.report_id) as incident_report_ids,
      o.conference_findings, o.admin_remarks, o.reviewed_at, o.follow_up_date,
      case
        when o.follow_up_date is null then 'Not scheduled'
        when o.follow_up_date < current_date then 'Overdue'
        else 'Monitoring'
      end as follow_up_status,
      o.disciplinary_action, o.approved_by, o.approved_at,
      o.student_name, o.student_lrn as lrn, o.student_grade as grade, o.student_section as section,
      r.type as incident_type, r.date as incident_date, a.name as approved_by_name,
      d.findings as decision_findings,
      count(*) over (partition by o.person_key) as student_offense_count
    from public.student_offense_records o
    join public.reports r on r.id = o.incident_report_id
    join public.admins a on a.id = o.approved_by
    join public.student_offense_decisions d on d.id = o.decision_id
  ), matching as (
    select * from all_records m
    where (term = '' or lower(m.student_name) like '%' || term || '%'
      or lower(coalesce(m.lrn, '')) like '%' || term || '%'
      or exists (select 1 from unnest(m.incident_report_ids) as linked(report_id)
        where linked.report_id::text like '%' || term || '%'))
      and (grade_filter is null or m.grade = grade_filter)
      and (section_filter is null or m.section = section_filter)
      and (offense_filter is null or case
        when offense_filter = '4+' then m.offense_number >= 4
        else m.offense_number = offense_filter::integer
      end)
      and (bullying_type_filter is null
        or lower(m.incident_type) = lower(bullying_type_filter)
        or lower(m.incident_type) = lower(bullying_type_filter) || ' bullying'
        or (lower(bullying_type_filter) = 'cyber' and lower(m.incident_type) = 'cyberbullying'))
      and (date_from is null or m.reviewed_at >= date_from)
      and (date_to is null or m.reviewed_at <= date_to)
      and (action_filter is null or m.disciplinary_action = action_filter)
  )
  select coalesce(jsonb_agg(to_jsonb(page)), '[]'::jsonb) into result_records
  from (
    select * from matching m
    order by
      case when sort_by = 'name_asc' then lower(m.student_name) end asc nulls last,
      case when sort_by = 'name_desc' then lower(m.student_name) end desc nulls last,
      case when sort_by = 'recent' then m.reviewed_at end desc nulls last,
      case when sort_by = 'oldest' then m.reviewed_at end asc nulls last,
      case when sort_by = 'most_offenses' then m.student_offense_count end desc nulls last,
      case when sort_by = 'least_offenses' then m.student_offense_count end asc nulls last,
      m.id desc
    limit safe_limit offset safe_offset
  ) page;

  select jsonb_build_object(
    'students', count(distinct person_key),
    'offenses', count(*),
    'firstOffenses', count(*) filter (where offense_number = 1),
    'repeatOffenses', count(*) filter (where offense_number > 1)
  ) into stats from public.student_offense_records;

  return jsonb_build_object(
    'records', result_records,
    'total', matching_total,
    'stats', stats,
    'options', public.get_student_offense_filter_options(actor_id)
  );
end;
$$;

drop function if exists public.get_student_offense_history(uuid, uuid);
create or replace function public.get_student_offense_history(actor_id uuid, target_person_key text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  result jsonb;
begin
  if not exists (select 1 from public.admins where id = actor_id) then
    raise exception 'Not authorized';
  end if;
  select jsonb_build_object(
    'student', (
      select jsonb_build_object(
        'name', o.student_name, 'lrn', o.student_lrn, 'grade', o.student_grade,
        'section', o.student_section
      )
      from public.student_offense_records o
      where o.person_key = target_person_key
      order by o.offense_number desc limit 1
    ),
    'records', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'incidentReportId', o.incident_report_id,
        'incidentReportIds', (select jsonb_agg(rr.report_id order by rr.report_id)
          from public.student_offense_record_reports rr where rr.offense_record_id = o.id),
        'offenseNumber', o.offense_number, 'incidentType', r.type, 'incidentDate', r.date,
        'conferenceFindings', o.conference_findings, 'adminRemarks', o.admin_remarks,
        'followUpDate', o.follow_up_date,
        'reviewedAt', o.reviewed_at, 'disciplinaryAction', o.disciplinary_action,
        'approvedBy', a.name, 'approvedAt', o.approved_at, 'reportDescription', r.description,
        'reportLocation', r.location
      ) order by o.approved_at asc, o.id asc)
      from public.student_offense_records o
      join public.reports r on r.id = o.incident_report_id
      left join public.admins a on a.id = o.approved_by
      where o.person_key = target_person_key
    ), '[]'::jsonb),
    'decisions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'reportId', d.report_id, 'outcome', d.outcome,
        'findings', d.findings, 'followUpDate', d.follow_up_date,
        'decidedBy', a.name, 'decidedAt', d.decided_at
      ) order by d.decided_at desc, d.id desc)
      from public.student_offense_decisions d
      left join public.admins a on a.id = d.decided_by
      where d.person_key = target_person_key
    ), '[]'::jsonb)
  ) into result;

  if result->'student' = 'null'::jsonb then raise exception 'Student offense history not found'; end if;
  return result;
end;
$$;

create or replace function public.get_report_student_links(actor_id uuid, target_report_id bigint)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  result jsonb;
begin
  if not exists (select 1 from public.admins where id = actor_id) then
    raise exception 'Not authorized';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'name', s.name, 'lrn', s.lrn, 'grade', s.grade, 'section', s.section,
    'linkedAt', l.linked_at,
    'establishedOffenses', (select count(*) from public.student_offense_records o where o.student_id = s.id)
  ) order by s.name), '[]'::jsonb)
  into result
  from public.report_student_links l
  join public.students s on s.id = l.student_id
  where l.report_id = target_report_id;
  return result;
end;
$$;

create or replace function public.link_report_student(
  actor_id uuid, target_report_id bigint, target_student_id uuid
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  result public.report_student_links%rowtype;
begin
  if not exists (select 1 from public.admins where id = actor_id) then
    raise exception 'Not authorized';
  end if;
  if not exists (select 1 from public.reports where id = target_report_id) then
    raise exception 'Incident report not found';
  end if;
  if not exists (select 1 from public.students where id = target_student_id and approved) then
    raise exception 'Choose an existing approved student';
  end if;

  insert into public.report_student_links (report_id, student_id, linked_by)
  values (target_report_id, target_student_id, actor_id)
  on conflict (report_id, student_id) do nothing
  returning * into result;

  if found then
    insert into public.student_offense_audit (action, student_id, report_id, actor_id, details)
    values ('reported_student_linked', target_student_id, target_report_id, actor_id, '{}'::jsonb);
  else
    select * into result from public.report_student_links
    where report_id = target_report_id and student_id = target_student_id;
  end if;
  return jsonb_build_object('id', result.id, 'studentId', result.student_id, 'reportId', result.report_id);
end;
$$;

drop function if exists public.save_offense_decision(uuid, bigint, uuid, text, text);
drop function if exists public.save_offense_decision(uuid, bigint, text, text, text, text, text, text, text, text, date);
drop function if exists public.save_offense_decision(uuid, bigint, text, text, text, text, text, text, text, text, text, date);
drop function if exists public.save_offense_decision(uuid, bigint, text, text, text, text, text, text, text, text, text, date, date, bigint[]);
create or replace function public.save_offense_decision(
  actor_id uuid,
  target_report_id bigint,
  student_name text,
  student_lrn text,
  student_grade text,
  student_section text,
  decision_outcome text,
  decision_findings text,
  conference_findings text,
  admin_remarks text,
  action_text text,
  reviewed_at date,
  follow_up_date date,
  attached_report_ids bigint[]
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  decision_id bigint;
  matched_student_id uuid;
  identity_key text;
  report_ids bigint[];
  found_report_count integer;
begin
  if not exists (select 1 from public.admins where id = actor_id) then
    raise exception 'Not authorized';
  end if;
  if decision_outcome not in (
    'Established', 'Needs Further Investigation', 'Not Established', 'Resolved Through Mediation'
  ) then raise exception 'Invalid decision'; end if;
  if nullif(trim(student_name), '') is null then raise exception 'Enter the student name'; end if;
  if nullif(trim(student_grade), '') is null
    or trim(student_grade) not in ('Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12') then
    raise exception 'Select a valid grade level';
  end if;
  if reviewed_at is null then raise exception 'Enter the date of review'; end if;
  if decision_outcome = 'Established' and follow_up_date is null then
    raise exception 'Choose a follow-up date for an established decision';
  end if;
  if decision_outcome <> 'Established' and follow_up_date is not null then
    raise exception 'A follow-up date is only allowed for an established decision';
  end if;
  identity_key := public.offense_person_key(student_lrn, student_name, student_grade, student_section);
  select s.id into matched_student_id
  from public.students s
  where s.approved and (
    (nullif(trim(student_lrn), '') is not null and lower(trim(s.lrn)) = lower(trim(student_lrn)))
    or (nullif(trim(student_lrn), '') is null
      and lower(trim(s.name)) = lower(trim(student_name))
      and lower(trim(coalesce(s.grade, ''))) = lower(trim(student_grade))
      and lower(trim(coalesce(s.section, ''))) = lower(trim(coalesce(student_section, ''))))
  )
  order by case when nullif(trim(student_lrn), '') is not null then 0 else 1 end
  limit 1;
  perform pg_advisory_xact_lock(hashtextextended(identity_key, 74129));
  select array_agg(distinct supplied.report_id order by supplied.report_id)
  into report_ids
  from unnest(coalesce(attached_report_ids, '{}'::bigint[]) || array[target_report_id])
    as supplied(report_id)
  where supplied.report_id is not null;
  perform r.id from public.reports r
    where r.id = any(report_ids) order by r.id for update;
  select count(*) into found_report_count from public.reports where id = any(report_ids);
  if found_report_count <> cardinality(report_ids) then raise exception 'An attached incident report was not found'; end if;
  if exists (select 1 from public.student_offense_record_reports
    where report_id = any(report_ids) and person_key = identity_key)
    or exists (select 1 from public.student_offense_records
      where incident_report_id = any(report_ids) and person_key = identity_key) then
    raise exception 'An offense is already approved for this student and incident';
  end if;

  insert into public.student_offense_decisions
    (report_id, student_id, person_key, student_name, student_lrn, student_grade,
     student_section, outcome, findings, conference_findings, admin_remarks,
     disciplinary_action, reviewed_at, follow_up_date, decided_by)
  values (target_report_id, matched_student_id, identity_key, trim(student_name),
    nullif(trim(student_lrn), ''), trim(student_grade), nullif(trim(student_section), ''),
    decision_outcome, coalesce(trim(decision_findings), ''), nullif(trim(conference_findings), ''),
    nullif(trim(admin_remarks), ''), nullif(trim(action_text), ''), reviewed_at,
    case when decision_outcome = 'Established' then follow_up_date else null end, actor_id)
  returning id into decision_id;

  if decision_outcome = 'Resolved Through Mediation' then
    update public.reports
    set status = 'Resolved', updated_at = now()
    where id = any(report_ids);
  end if;

  insert into public.student_offense_audit
    (action, student_id, report_id, actor_id, details)
  values ('decision_recorded', matched_student_id, target_report_id, actor_id,
    jsonb_build_object('decisionId', decision_id, 'outcome', decision_outcome,
      'personKey', identity_key, 'reportIds', report_ids));

  return jsonb_build_object('id', decision_id, 'outcome', decision_outcome, 'reportIds', report_ids);
end;
$$;

drop function if exists public.create_student_offense_record(uuid, bigint, uuid, text);
drop function if exists public.create_student_offense_record(uuid, bigint, text, text, text, text, text, text, date);
drop function if exists public.create_student_offense_record(uuid, bigint, text, text, text, text);
create or replace function public.create_student_offense_record(
  actor_id uuid,
  target_report_id bigint,
  student_name text,
  student_lrn text,
  student_grade text,
  student_section text,
  attached_report_ids bigint[] default '{}'::bigint[]
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  latest_decision public.student_offense_decisions%rowtype;
  identity_key text;
  report_ids bigint[];
  found_report_count integer;
  new_offense_number integer;
  new_record public.student_offense_records%rowtype;
begin
  if not exists (select 1 from public.admins where id = actor_id) then
    raise exception 'Not authorized';
  end if;
  if nullif(trim(student_name), '') is null then raise exception 'Enter the student name'; end if;
  if nullif(trim(student_grade), '') is null
    or trim(student_grade) not in ('Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12') then
    raise exception 'Select a valid grade level';
  end if;
  identity_key := public.offense_person_key(student_lrn, student_name, student_grade, student_section);
  select array_agg(distinct supplied.report_id order by supplied.report_id)
  into report_ids
  from unnest(coalesce(attached_report_ids, '{}'::bigint[]) || array[target_report_id])
    as supplied(report_id)
  where supplied.report_id is not null;
  if coalesce(cardinality(report_ids), 0) = 0 then raise exception 'Select at least one incident report'; end if;

  perform pg_advisory_xact_lock(hashtextextended(identity_key, 74129));
  perform r.id from public.reports r
    where r.id = any(report_ids) order by r.id for update;
  select count(*) into found_report_count from public.reports where id = any(report_ids);
  if found_report_count <> cardinality(report_ids) then raise exception 'An attached incident report was not found'; end if;
  if exists (select 1 from public.reports where id = any(report_ids)
    and status not in ('Under Investigation', 'Resolved')) then
    raise exception 'Move the incident out of Pending in Incidents before approving an offense';
  end if;

  if exists (select 1 from public.student_offense_record_reports
    where person_key = identity_key and report_id = any(report_ids)) then
    raise exception 'This incident is already recorded for this student';
  end if;
  select * into latest_decision
  from public.student_offense_decisions
  where report_id = target_report_id and person_key = identity_key
  order by decided_at desc, id desc limit 1;
  if not found or latest_decision.outcome <> 'Established' then
    raise exception 'The latest decision must establish the offense before approval';
  end if;
  if nullif(trim(latest_decision.disciplinary_action), '') is null then
    raise exception 'Enter and save the approved disciplinary action before approval';
  end if;

  select coalesce(max(offense_number), 0) + 1 into new_offense_number
  from public.student_offense_records where person_key = identity_key;

  insert into public.student_offense_records
    (student_id, person_key, student_name, student_lrn, student_grade, student_section,
     incident_report_id, decision_id, offense_number, conference_findings, admin_remarks,
     reviewed_at, disciplinary_action, follow_up_date, approved_by)
  values (latest_decision.student_id, identity_key, latest_decision.student_name,
    latest_decision.student_lrn, latest_decision.student_grade, latest_decision.student_section,
    target_report_id, latest_decision.id, new_offense_number, latest_decision.conference_findings,
    latest_decision.admin_remarks, latest_decision.reviewed_at, latest_decision.disciplinary_action,
    latest_decision.follow_up_date, actor_id)
  returning * into new_record;

  insert into public.student_offense_record_reports (offense_record_id, report_id, person_key)
  select new_record.id, report_id, identity_key from unnest(report_ids) as linked(report_id);

  insert into public.student_offense_audit
    (action, student_id, report_id, offense_record_id, actor_id, details)
  values ('offense_approved', latest_decision.student_id, target_report_id, new_record.id, actor_id,
    jsonb_build_object('offenseNumber', new_offense_number, 'decisionId', latest_decision.id, 'reportIds', report_ids));

  return jsonb_build_object(
    'id', new_record.id,
    'studentId', latest_decision.student_id,
    'incidentReportId', target_report_id,
    'incidentReportIds', report_ids,
    'offenseNumber', new_offense_number,
    'approvedAt', new_record.approved_at,
    'reviewedAt', new_record.reviewed_at,
    'followUpDate', new_record.follow_up_date
  );
end;
$$;

create or replace function public.save_report_conference_findings(
  actor_id uuid, target_report_id bigint, findings_text text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  conference jsonb;
  clean_findings text := trim(coalesce(findings_text, ''));
begin
  if not exists (select 1 from public.admins where id = actor_id) then
    raise exception 'Not authorized';
  end if;
  if clean_findings = '' then raise exception 'Conference findings cannot be empty'; end if;

  select scheduled_conference into conference from public.reports where id = target_report_id for update;
  if not found then raise exception 'Incident report not found'; end if;
  if not coalesce((conference->>'completed')::boolean, false)
    and coalesce(conference->>'status', '') <> 'Completed' then
    raise exception 'Complete the scheduled conference before recording its findings';
  end if;

  update public.reports
  set conference_findings = clean_findings,
      conference_findings_updated_by = actor_id,
      conference_findings_updated_at = now(),
      updated_at = now()
  where id = target_report_id;

  insert into public.student_offense_audit (action, report_id, actor_id, details)
  values ('conference_findings_saved', target_report_id, actor_id,
    jsonb_build_object('findings', clean_findings));
  return jsonb_build_object('reportId', target_report_id, 'conferenceFindings', clean_findings);
end;
$$;

revoke all on function public.search_offense_students(uuid, text, text, text, integer) from public, anon, authenticated;
revoke all on function public.search_offense_reports(uuid, text, uuid, integer) from public, anon, authenticated;
revoke all on function public.get_student_offense_filter_options(uuid) from public, anon, authenticated;
revoke all on function public.get_student_offense_records(uuid, text, text, text, text, text, date, date, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.get_student_offense_history(uuid, text) from public, anon, authenticated;
revoke all on function public.get_report_student_links(uuid, bigint) from public, anon, authenticated;
revoke all on function public.link_report_student(uuid, bigint, uuid) from public, anon, authenticated;
revoke all on function public.save_offense_decision(uuid, bigint, text, text, text, text, text, text, text, text, text, date, date, bigint[]) from public, anon, authenticated;
revoke all on function public.create_student_offense_record(uuid, bigint, text, text, text, text, bigint[]) from public, anon, authenticated;
revoke all on function public.save_report_conference_findings(uuid, bigint, text) from public, anon, authenticated;
grant execute on function public.search_offense_students(uuid, text, text, text, integer) to service_role;
grant execute on function public.search_offense_reports(uuid, text, uuid, integer) to service_role;
grant execute on function public.get_student_offense_filter_options(uuid) to service_role;
grant execute on function public.get_student_offense_records(uuid, text, text, text, text, text, date, date, text, text, integer, integer) to service_role;
grant execute on function public.get_student_offense_history(uuid, text) to service_role;
grant execute on function public.get_report_student_links(uuid, bigint) to service_role;
grant execute on function public.link_report_student(uuid, bigint, uuid) to service_role;
grant execute on function public.save_offense_decision(uuid, bigint, text, text, text, text, text, text, text, text, text, date, date, bigint[]) to service_role;
grant execute on function public.create_student_offense_record(uuid, bigint, text, text, text, text, bigint[]) to service_role;
grant execute on function public.save_report_conference_findings(uuid, bigint, text) to service_role;

notify pgrst, 'reload schema';
