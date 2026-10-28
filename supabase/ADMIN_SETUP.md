# Provision a deployed admin account

The app does not create administrator accounts automatically. An admin must exist in both Supabase Auth and the `admins` table.

## Supabase Dashboard (no terminal)

1. In the Supabase project used by the deployed app, open **Authentication → Users** and choose **Add user**.
2. Enter the admin's email and a unique password. Confirm the user's email if the dashboard offers that option, then create the user.
3. Open the new user and copy their **UID**.
4. Open **SQL Editor → New query** and run the following, replacing the example values with the new user's UID, email, and display name:

   ```sql
   insert into public.admins (id, email, name)
   values ('PASTE-USER-UID-HERE', 'admin@example.com', 'Administrator')
   on conflict (id) do update
     set email = excluded.email, name = excluded.name;
   ```

5. Sign in to the deployed app with that email and password.

The `admins` table must already exist; run `schema.sql` first if you have not created the tables. Use an account that is not already registered as a student.

## Optional local command

If you prefer the terminal, the command below automates the same setup:

1. Make sure `schema.sql` has been run on the Supabase project used by the deployed app.
2. In your local, git-ignored `.env`, set the deployed project's URL, anon key, and these admin-provisioning values:

   ```env
   VITE_SUPABASE_URL=https://your-project-ref.supabase.co
   VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-or-secret-key
   ADMIN_EMAIL=admin@example.com
   ADMIN_PASSWORD=use-a-unique-password-of-at-least-12-characters
   ADMIN_NAME=Administrator
   ```

3. Run `npm run create-admin`.
4. For a newly created account, sign in to the deployed app using `ADMIN_EMAIL` and `ADMIN_PASSWORD`. If the Auth user already existed, keep using its existing password.

The command creates and confirms the Supabase Auth user, then adds its admin profile. If the email already belongs to a student, use a different email. If the Auth user already exists, the command links it as an admin without changing its password; sign in using that account's existing password.

**Keep the service-role/secret key private.** Never prefix it with `VITE_`, put it in frontend code, or add it to Vercel environment variables. The command should only be run locally against the intended Supabase project. Use a unique password and keep it out of source control.
