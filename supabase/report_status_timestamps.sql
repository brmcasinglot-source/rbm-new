alter table public.reports
  add column if not exists under_investigation_at timestamptz,
  add column if not exists resolved_at timestamptz;

create or replace function public.set_report_status_timestamps()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'Under Investigation' and new.under_investigation_at is null then
      new.under_investigation_at := now();
    end if;
    if new.status = 'Resolved' and new.resolved_at is null then
      new.resolved_at := now();
    end if;
  elsif new.status is distinct from old.status then
    if new.status = 'Pending' then
      new.under_investigation_at := null;
      new.resolved_at := null;
    elsif new.status = 'Under Investigation' then
      new.under_investigation_at := now();
      new.resolved_at := null;
    elsif new.status = 'Resolved' then
      new.resolved_at := now();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists reports_stamp_status_timestamps on public.reports;
create trigger reports_stamp_status_timestamps
before insert or update of status on public.reports
for each row execute function public.set_report_status_timestamps();
