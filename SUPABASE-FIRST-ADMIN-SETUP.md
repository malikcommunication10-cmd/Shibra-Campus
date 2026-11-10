# First Supabase administrator — safe setup

**Do not create the app administrator until the preflight checks below are understood.** This project has no server-side admin API; the first Auth user must be created by the project owner in Supabase Dashboard. Never share a password, database connection string, access token, or reset link.

## 1. Run the read-only preflight

Open Supabase Dashboard → **SQL Editor** for the Shibra project. Run the statements in [`supabase_admin_preflight.sql`](./supabase_admin_preflight.sql) individually. Statements 1–4 only read catalog metadata, permissions, and counts; they do not create or update anything. Run statement 3 only if statement 1 confirms `app_roles` exists.

- If statement 2 errors, stop and report only the non-sensitive error text. If its count is `0`, there is no Supabase Auth account yet.
- If `public.app_users` or `public.app_roles` is missing, the app role schema has not been confirmed as installed.
- The built-in `Admin` role should exist before linking an Auth user.
- Review the Admin `perms` returned by statement 3: it should contain full page actions (`vaed`) and the intended admin flags. An existing Admin row is not overwritten by the migration.
- Every column checked by statement 4 must exist before considering `supabase_roles.sql`.
- RLS should be enabled on `app_users` and `app_roles`.
- Existing user rows or custom RLS policies require review; do not rerun the role migration just to create an administrator.

If the preflight shows that `app_users` exists, you may run this additional **read-only** check:

```sql
select role, active, count(*) as user_count
from public.app_users
group by role, active
order by role, active;
```

It reports counts and roles only, not email addresses. If `app_users` is missing, do not run this query.

## 2. Only after the migration is reviewed and safely installed

1. After a verified backup and migration review, run the corrected `supabase_roles.sql` as database owner. It changes RLS/grants on existing app tables. Do not run an older copy: the page-permission helper must read the app's string format (`vaed`) correctly.
   If a role will use **Require closing all previous days before working today**, run `supabase_require_previous_day_close.sql` once after the baseline migration. This is additive and does not alter records; do not rerun the baseline migration just to enable this role permission.
2. In Supabase Dashboard → **Authentication → Users**, use the Dashboard to create the owner-controlled administrator Auth account. Use an email you control, set a strong unique password privately, and complete email confirmation if required by your Auth settings.
3. Confirm `public.app_roles` contains the built-in `Admin` role and that `public.app_users` exists.
4. In SQL Editor, run the one-row registration statement below after replacing the email/name placeholders. It links the existing Auth identity to the app's Admin role. It does not create an Auth account or store a password.

   ```sql
   insert into public.app_users (email, name, role, active)
   select lower(u.email), 'School Administrator', 'Admin', true
   from auth.users u
   where lower(u.email) = lower('REPLACE_WITH_ADMIN_EMAIL')
     and exists (select 1 from public.app_roles r where r.name = 'Admin')
   on conflict (email) do nothing;

   select role, active, count(*) as matching_rows
   from public.app_users
   where lower(email) = lower('REPLACE_WITH_ADMIN_EMAIL')
   group by role, active;
   ```

   The first statement deliberately does nothing if the Auth email or Admin role is absent. The verification query should return one `Admin`, active row.
5. Sign in on the app's deployed HTTPS URL, not a `file://` page. If Supabase email confirmation is enabled, confirm the Auth account first.
6. Use the app to create separate accounts for other staff, with least-privilege roles. Do not share the administrator password.

## 3. If preflight says role tables or Admin role are missing

Stop before running `supabase_roles.sql`. That migration replaces existing policies on managed tables, so first take and verify a database backup and inventory the existing schema/policies. The Free-plan backup steps are in [`BACKUP-BEFORE-ARREARS-MIGRATION.md`](./BACKUP-BEFORE-ARREARS-MIGRATION.md). After a verified backup, review the migration in staging or plan the smallest additive setup needed.

The preflight may show RLS enabled with zero policies on `app_users` and `app_roles`. This is a blocker to client access, but do not solve it by disabling RLS or manually inserting an Auth user before confirming the complete migration and admin bootstrap sequence.

Never paste the contents of `auth.users`, personal email lists, student data, or credentials into chat. Share only the preflight booleans/counts and any non-sensitive SQL error text.
