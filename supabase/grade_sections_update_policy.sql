-- Allow Prefect/Admin users to save renamed sections in existing databases.
drop policy if exists "grade_sections update admin" on grade_sections;
create policy "grade_sections update admin" on grade_sections for update
  using (is_admin()) with check (is_admin());
