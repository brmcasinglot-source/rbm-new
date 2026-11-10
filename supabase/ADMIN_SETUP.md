# Backend auth and admin setup

## Supabase Edge Function configuration

In Supabase Dashboard, open **Edge Functions → Secrets** and set:

```env
AUTH_SESSION_SECRET=a-random-secret-of-at-least-32-characters
BREVO_API_KEY=your-brevo-api-key
BREVO_SENDER_EMAIL=verified-sender@example.com
BREVO_SENDER_NAME=CNHS Bullying Reporting System
ALLOWED_ORIGINS=https://your-app.example.com,http://localhost:5173
```

Use an email address verified as a sender in Brevo. If Brevo API key security restricts authorized IPs, allow the Supabase Edge Function's outbound IP shown in the function logs, or remove that IP restriction; otherwise Brevo rejects email requests. `ALLOWED_ORIGINS` must contain the exact browser origins for your deployed frontend and any local development frontend, separated by commas. Supabase provides the project URL and service-role key to Edge Functions. Keep all secrets server-side; never add a `VITE_` prefix or put them in frontend code.

Verification, password-reset, and admin notification emails show only the school logo in their header, loaded from `/logo.png` on the requesting frontend origin (or the first public origin in `ALLOWED_ORIGINS` when the request has no origin). Keep `public/logo.png` deployed and publicly accessible so email clients can display it.

After a student verifies their signup code, the API emails all administrator addresses in the `admins` table to notify them that an account is waiting for approval. These notices are sent through the configured Brevo sender; add the administrator's Gmail address to the admin account with `ADMIN_EMAIL` when provisioning, or update the existing admin email address, and ensure it is a valid recipient. The student account still requires approval in the dashboard before they can sign in.

The frontend `.env` contains only the public project URL and anon key:

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```

Generate `AUTH_SESSION_SECRET` with a password manager or a cryptographically secure random generator; it must contain at least 32 characters.

Deploy from the repository root after installing and authenticating the Supabase CLI:

```sh
supabase login
supabase link --project-ref your-project-ref
supabase functions deploy api
```

The function is configured with `verify_jwt = false` because it uses its own signed session token, not Supabase Auth JWTs. Its handler validates that session token and applies role checks before using the service-role key. Configure `ALLOWED_ORIGINS` before testing from a browser.

Conference scheduling, rescheduling, outcomes, and request reviews are handled by the admin-only `manage_conference` API action. Deploy the updated `api` Edge Function after changing conference-management code. Conference history is stored with each report's `scheduled_conference` JSON and includes the acting admin and timestamp.

## Existing Supabase database

1. Back up the database.
2. Run [`custom_auth.sql`](./custom_auth.sql) in the Supabase SQL Editor. It retains existing student/admin profiles and their IDs while removing their dependency on `auth.users`.
3. Run [`student_id_images.sql`](./student_id_images.sql) to add the private student-ID image bucket and profile fields.
4. Configure the Edge Function secrets above and deploy the function.
5. Existing student/admin profiles should select **Forgot Password**, request a Brevo code, and set a new password. Pending legacy sign-ups without a student profile must register again. Supabase Auth does not expose existing password hashes for migration.
6. Create or update an admin using the one-time local command below. Existing administrators can also establish custom credentials through **Forgot Password**.

Do not run `schema.sql` on an existing database; it drops and recreates the application tables.

## New database

Run [`schema.sql`](./schema.sql) once in the Supabase SQL Editor, then configure the Edge Function and create an admin using the command below. The schema also creates the private student-ID image bucket.

New ID photos are resized to at most 1200 pixels and compressed to 350 KB each before upload, reducing storage and image-view egress. If an existing `student-ids` bucket is already present, rerun [`student_id_images.sql`](./student_id_images.sql) to apply the updated upload size limit.

## Create an admin account

This is a one-time local provisioning command, not a local API server. Add these values temporarily to the git-ignored `.env`:

```env
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=use-a-unique-password-of-at-least-12-characters
ADMIN_NAME=Administrator
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
```

Run `npm run create-admin`. The command creates the `admins` row and a PBKDF2 password credential. Existing PBKDF2 credentials are preserved; an older scrypt credential is replaced with the supplied `ADMIN_PASSWORD`. Remove the `ADMIN_` variables from `.env` after provisioning.

## Authentication behavior

Registration and password recovery send a 6-digit code through Brevo. Codes expire after 10 minutes and allow up to five verification attempts. User sessions are signed seven-day bearer tokens sent to the Supabase Edge Function. Passwords are hashed with PBKDF2-SHA-256. Accounts with password hashes from the previous local API must use **Forgot Password** once to set a compatible password. Database reads and writes are authorized by the Edge Function before it uses the Supabase service-role key.
