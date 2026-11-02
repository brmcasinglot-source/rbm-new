-- Students' personal information is read-only after account registration.
-- Admin profile updates remain allowed by the "students update admin" policy.
drop policy if exists "students update own" on public.students;
