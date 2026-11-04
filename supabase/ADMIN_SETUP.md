# Backend auth and admin setup

## Required server environment

Set these variables in the local `.env` and in Vercel's server environment settings:

```env
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
AUTH_SESSION_SECRET=a-random-secret-of-at-least-32-characters
BREVO_API_KEY=your-brevo-api-key
BREVO_SENDER_EMAIL=verified-sender@example.com
BREVO_SENDER_NAME=CNHS Bullying Reporting System
```

Use an email address verified as a sender in Brevo. Keep these values server-only: never add the `VITE_` prefix, commit them, or place them in frontend code. The service-role key is required by the serverless API to access the database; it must never be exposed to the browser.

For local development, copy `.env.example` to `.env`. Generate a session secret with a password manager or a cryptographically secure random generator; it must contain at least 32 characters.

## Existing Supabase database

1. Back up the database.
2. Run [`custom_auth.sql`](./custom_auth.sql) in the Supabase SQL Editor. It retains existing student/admin profiles and their IDs while removing their dependency on `auth.users`.
3. Configure the server environment above and deploy the app.
4. Existing student/admin profiles should select **Forgot Password**, request a Brevo code, and set a new password. Pending legacy sign-ups without a student profile must register again. Supabase Auth does not expose existing password hashes for migration.
5. Create or update an admin using the one-time local command below. Existing administrators can also establish custom credentials through **Forgot Password**.

Do not run `schema.sql` on an existing database; it drops and recreates the application tables.

## New database

Run [`schema.sql`](./schema.sql) once in the Supabase SQL Editor, then configure the server environment and create an admin using the command below.

## Create an admin account

Add these values temporarily to the local, git-ignored `.env`:

```env
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=use-a-unique-password-of-at-least-12-characters
ADMIN_NAME=Administrator
```

Run `npm run create-admin`. The command creates the `admins` row and a custom password credential. Existing custom credentials are preserved. Remove the three `ADMIN_` variables from `.env` after provisioning.

## Authentication behavior

Registration and password recovery send a 6-digit code through Brevo. Codes expire after 10 minutes and allow up to five verification attempts. User sessions are signed, seven-day, HttpOnly cookies. Database reads and writes go through the server API, which enforces student/admin access before using the Supabase service-role key.
