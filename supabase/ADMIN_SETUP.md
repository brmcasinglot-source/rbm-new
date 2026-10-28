# Provision a deployed admin account

The app does not create administrator accounts automatically. An admin must exist in both Supabase Auth and the `admins` table.

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
