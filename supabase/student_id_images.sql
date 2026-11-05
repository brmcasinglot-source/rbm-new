-- Private storage for student ID photos collected during registration.
-- Run once on an existing Supabase project before deploying the updated API.

alter table public.students
  add column if not exists student_id_front_path text,
  add column if not exists student_id_back_path text;

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
