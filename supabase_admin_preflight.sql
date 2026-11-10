-- First-admin setup preflight.
-- READ ONLY: no user, table, policy, or row is created or changed.

-- 1. Check whether the app role tables exist, whether RLS is enabled,
--    and how many policies are currently attached.
with expected_tables(table_name) as (
    values ('app_users'), ('app_roles')
)
select
    e.table_name,
    c.oid is not null as table_exists,
    coalesce(c.relrowsecurity, false) as rls_enabled,
    count(p.policyname) as policy_count
from expected_tables e
left join pg_class c
    on c.relnamespace = 'public'::regnamespace
   and c.relname = e.table_name
   and c.relkind in ('r', 'p')
left join pg_policies p
    on p.schemaname = 'public'
   and p.tablename = e.table_name
group by e.table_name, c.oid, c.relrowsecurity
order by e.table_name;

-- 2. Report only the total Auth user count; no identity or email is returned.
select count(*) as auth_user_count
from auth.users;

-- 3. Confirm the built-in role and inspect its permission JSON.
--    If app_roles does not exist, skip this query.
select name, builtin, perms
from public.app_roles
where name = 'Admin';

-- 4. Confirm the columns referenced by the authorization migration already exist.
--    Missing columns are blockers; do not run supabase_roles.sql until reviewed.
with expected_columns(table_name, column_name) as (
    values
        ('app_users', 'email'),
        ('app_users', 'name'),
        ('app_users', 'role'),
        ('app_users', 'perms'),
        ('app_users', 'active'),
        ('app_roles', 'name'),
        ('app_roles', 'perms'),
        ('day_close', 'closed_date'),
        ('accounts', 'date')
)
select e.table_name, e.column_name,
       c.column_name is not null as column_exists
from expected_columns e
left join information_schema.columns c
  on c.table_schema = 'public'
 and c.table_name = e.table_name
 and c.column_name = e.column_name
order by e.table_name, e.column_name;

-- 5. Read-only check of the authorization migration state.
--    Run after a failed or successful migration to verify RLS and policy counts.
with managed_tables(table_name) as (
    values
        ('accounts'), ('app_roles'), ('app_users'), ('books'), ('call_logs'),
        ('day_close'), ('fees'), ('increments'), ('payroll'), ('settings'),
        ('staff'), ('students')
)
select
    e.table_name,
    c.oid is not null as table_exists,
    coalesce(c.relrowsecurity, false) as rls_enabled,
    count(p.policyname) as policy_count
from managed_tables e
left join pg_class c
    on c.relnamespace = 'public'::regnamespace
   and c.relname = e.table_name
   and c.relkind in ('r', 'p')
left join pg_policies p
    on p.schemaname = 'public'
   and p.tablename = e.table_name
group by e.table_name, c.oid, c.relrowsecurity
order by e.table_name;
