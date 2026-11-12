-- Add adviser assignments to existing grade sections.
alter table grade_sections
  add column if not exists adviser text not null default '';
