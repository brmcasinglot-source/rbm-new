-- Run once in Supabase SQL Editor before deploying the media-storage API changes.
-- Private evidence files are served only through short-lived, authenticated URLs.
-- Awareness media is public educational content and uses cacheable public URLs.

alter table public.awareness_content
  add column if not exists thumbnail_path text,
  add column if not exists full_image_path text;

alter table public.reports
  add column if not exists evidence_count integer
  generated always as (
    jsonb_array_length(case when jsonb_typeof(evidence) = 'array' then evidence else '[]'::jsonb end)
  ) stored;

insert into storage.buckets (id, name, public, file_size_limit)
values
  ('report-evidence', 'report-evidence', false, 10000000),
  ('awareness-media', 'awareness-media', true, 10000000)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;
