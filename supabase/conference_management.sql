-- Apply this once to an existing database to enable student conference requests.
-- Students can submit requests for their own reports; only admins can apply
-- official conference status and schedule changes.
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

notify pgrst, 'reload schema';
