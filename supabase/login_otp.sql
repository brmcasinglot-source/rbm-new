-- Add login OTP support to an existing CNHS database.
alter table public.auth_otps
  drop constraint if exists auth_otps_purpose_check;

alter table public.auth_otps
  add constraint auth_otps_purpose_check
  check (purpose in ('signup', 'reset', 'login'));
