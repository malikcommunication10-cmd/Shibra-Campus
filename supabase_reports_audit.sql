-- System-wide, permission-checked reports and audit trail.
-- Run as a database owner after supabase_roles.sql and the core schema.

begin;

-- Keep existing Admin permissions intact while adding access to the two new
-- read-only pages, including Admin accounts with an explicit user-level override.
update public.app_roles
set perms = coalesce(perms, '{}'::jsonb) || jsonb_build_object(
    'pages',
    coalesce(perms -> 'pages', '{}'::jsonb) || jsonb_build_object('reports', 'v', 'audit', 'v')
)
where name = 'Admin';

update public.app_users
set perms = coalesce(perms, '{}'::jsonb) || jsonb_build_object(
    'pages',
    coalesce(perms -> 'pages', '{}'::jsonb) || jsonb_build_object('reports', 'v', 'audit', 'v')
)
where role = 'Admin'
  and perms is not null;

create or replace function public.app_report_number(p_row jsonb, p_keys text[])
returns numeric
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
    field_name text;
    field_value text;
begin
    foreach field_name in array p_keys loop
        field_value := nullif(trim(p_row ->> field_name), '');
        if field_value ~ '^[+-]?[0-9]+([.][0-9]+)?$' then
            return field_value::numeric;
        end if;
    end loop;
    return 0;
end;
$$;

create or replace function public.app_report_in_period(p_row jsonb, p_from date, p_to date)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
    field_name text;
    field_value text;
    parsed_date date;
    year_part integer;
    month_part integer;
    day_part integer;
begin
    field_value := p_row ->> 'month';
    if field_value ~ '^[0-9]{4}-[0-9]{2}$' then
        year_part := substring(field_value from 1 for 4)::integer;
        month_part := substring(field_value from 6 for 2)::integer;
        if year_part between 1 and 9999 and month_part between 1 and 12 then
            parsed_date := make_date(year_part, month_part, 1);
            return parsed_date <= p_to
                and (parsed_date + interval '1 month - 1 day')::date >= p_from;
        end if;
    end if;

    field_value := p_row ->> 'effective_period';
    if field_value ~* '^(January|February|March|April|May|June|July|August|September|October|November|December) [0-9]{4}$' then
        year_part := split_part(field_value, ' ', 2)::integer;
        month_part := case lower(split_part(field_value, ' ', 1))
            when 'january' then 1 when 'february' then 2 when 'march' then 3
            when 'april' then 4 when 'may' then 5 when 'june' then 6
            when 'july' then 7 when 'august' then 8 when 'september' then 9
            when 'october' then 10 when 'november' then 11 when 'december' then 12
        end;
        if year_part between 1 and 9999 then
            parsed_date := make_date(year_part, month_part, 1);
            return parsed_date <= p_to
                and (parsed_date + interval '1 month - 1 day')::date >= p_from;
        end if;
    end if;

    foreach field_name in array array[
        'date', 'attendance_date', 'call_date', 'payment_date',
        'paid_date', 'created_at', 'created_date', 'voucher_date',
        'increment_date', 'effective_date'
    ] loop
        field_value := p_row ->> field_name;
        if field_value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then
            year_part := substring(field_value from 1 for 4)::integer;
            month_part := substring(field_value from 6 for 2)::integer;
            day_part := substring(field_value from 9 for 2)::integer;
            if year_part between 1 and 9999 and month_part between 1 and 12 then
                parsed_date := make_date(year_part, month_part, 1);
                if day_part between 1 and extract(day from (parsed_date + interval '1 month - 1 day'))::integer then
                    parsed_date := make_date(year_part, month_part, day_part);
                    return parsed_date between p_from and p_to;
                end if;
            end if;
        end if;
    end loop;

    field_value := coalesce(p_row ->> 'period', p_row ->> 'month');
    if field_value ~ '^[0-9]{4}-[0-9]{2}$' then
        year_part := substring(field_value from 1 for 4)::integer;
        month_part := substring(field_value from 6 for 2)::integer;
        if year_part between 1 and 9999 and month_part between 1 and 12 then
            parsed_date := make_date(year_part, month_part, 1);
            return parsed_date <= p_to
                and (parsed_date + interval '1 month - 1 day')::date >= p_from;
        end if;
    elsif field_value ~ '^[0-9]{4}$' then
        year_part := field_value::integer;
        if year_part between 1 and 9999 then
            return make_date(year_part, 1, 1) <= p_to
                and make_date(year_part, 12, 31) >= p_from;
        end if;
    end if;
    return false;
end;
$$;

create or replace function public.app_business_reports(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
declare
    result jsonb;
begin
    if not public.app_has_page_permission('reports', 'v') then
        raise exception 'Business Reports View permission is required.'
            using errcode = '42501';
    end if;
    if p_from is null or p_to is null or p_from > p_to then
        raise exception 'Choose a valid report date range.'
            using errcode = '22023';
    end if;
    if p_to - p_from > 3660 then
        raise exception 'Report date ranges cannot exceed ten years.'
            using errcode = '22023';
    end if;

    select jsonb_build_object(
        'from', p_from,
        'to', p_to,
        'generated_at', now(),
        'students', jsonb_build_object(
            'total', (select count(*) from public.students),
            'active', (select count(*) from public.students s
                where lower(coalesce(to_jsonb(s) ->> 'status', '')) not in ('left', 'inactive', 'withdrawn', 'deleted', 'graduated')),
            'by_class', coalesce((
                select jsonb_agg(jsonb_build_object('label', class_name, 'count', total) order by total desc, class_name)
                from (
                    select coalesce(nullif(trim(to_jsonb(s) ->> 'class'), ''), 'Unassigned') as class_name, count(*) as total
                    from public.students s
                    group by 1
                ) classes
            ), '[]'::jsonb)
        ),
        'fees', jsonb_build_object(
            'fee_rows', (select count(*) from public.fees f
                where public.app_report_in_period(to_jsonb(f), p_from, p_to)),
            'payable', coalesce((select sum(
                    public.app_report_number(to_jsonb(f), array['payable', 'amount', 'total'])
                    - public.app_report_number(to_jsonb(f), array['discount', 'discount_amount'])
                )
                from public.fees f where public.app_report_in_period(to_jsonb(f), p_from, p_to)), 0),
            'discounts', coalesce((select sum(public.app_report_number(to_jsonb(f), array['discount', 'discount_amount']))
                from public.fees f where public.app_report_in_period(to_jsonb(f), p_from, p_to)), 0),
            'collected_to_selected_vouchers', coalesce((
                select sum(public.app_report_number(to_jsonb(a), array['amount_in']))
                from public.accounts a
                where exists (
                    select 1 from public.fees f
                    where public.app_report_in_period(to_jsonb(f), p_from, p_to)
                      and nullif(trim(to_jsonb(a) ->> 'voucher_id'), '') is not null
                      and split_part(coalesce(to_jsonb(f) ->> 'voucher_id', ''), '-', 1)
                            = split_part(coalesce(to_jsonb(a) ->> 'voucher_id', ''), '-', 1)
                      and split_part(coalesce(to_jsonb(f) ->> 'voucher_id', ''), '-', 2)
                            = split_part(coalesce(to_jsonb(a) ->> 'voucher_id', ''), '-', 2)
                )
            ), 0),
            'estimated_outstanding', greatest(
                coalesce((select sum(
                        public.app_report_number(to_jsonb(f), array['payable', 'amount', 'total'])
                        - public.app_report_number(to_jsonb(f), array['discount', 'discount_amount'])
                    )
                    from public.fees f where public.app_report_in_period(to_jsonb(f), p_from, p_to)), 0)
                - coalesce((
                    select sum(public.app_report_number(to_jsonb(a), array['amount_in']))
                    from public.accounts a
                    where exists (
                        select 1 from public.fees f
                        where public.app_report_in_period(to_jsonb(f), p_from, p_to)
                          and nullif(trim(to_jsonb(a) ->> 'voucher_id'), '') is not null
                          and split_part(coalesce(to_jsonb(f) ->> 'voucher_id', ''), '-', 1)
                                = split_part(coalesce(to_jsonb(a) ->> 'voucher_id', ''), '-', 1)
                          and split_part(coalesce(to_jsonb(f) ->> 'voucher_id', ''), '-', 2)
                                = split_part(coalesce(to_jsonb(a) ->> 'voucher_id', ''), '-', 2)
                    )
                ), 0), 0
            ),
            'by_type', coalesce((
                select jsonb_agg(jsonb_build_object(
                    'label', fee_type, 'count', total,
                    'payable', payable_total, 'discount', discount_total
                ) order by payable_total desc)
                from (
                    select coalesce(nullif(trim(to_jsonb(f2) ->> 'type'), ''), 'Other') as fee_type,
                        count(*) as total,
                        sum(public.app_report_number(to_jsonb(f2), array['payable', 'amount', 'total'])) as payable_total,
                        sum(public.app_report_number(to_jsonb(f2), array['discount', 'discount_amount'])) as discount_total
                    from public.fees f2
                    where public.app_report_in_period(to_jsonb(f2), p_from, p_to)
                    group by 1
                ) fee_types
            ), '[]'::jsonb)
        ),
        'accounts', jsonb_build_object(
            'entries', (select count(*) from public.accounts a
                where public.app_report_in_period(to_jsonb(a), p_from, p_to)),
            'money_in', coalesce((select sum(public.app_report_number(to_jsonb(a), array['amount_in']))
                from public.accounts a where public.app_report_in_period(to_jsonb(a), p_from, p_to)), 0),
            'money_out', coalesce((select sum(public.app_report_number(to_jsonb(a), array['amount_out']))
                from public.accounts a where public.app_report_in_period(to_jsonb(a), p_from, p_to)), 0),
            'by_account', coalesce((
                select jsonb_agg(jsonb_build_object('label', account_name, 'money_in', incoming, 'money_out', outgoing)
                    order by incoming + outgoing desc)
                from (
                    select coalesce(
                        nullif(trim(to_jsonb(a) ->> 'from_account'), ''),
                        nullif(trim(to_jsonb(a) ->> 'to_account'), ''),
                        nullif(trim(to_jsonb(a) ->> 'description'), ''),
                        'Unspecified'
                    ) as account_name,
                    sum(public.app_report_number(to_jsonb(a), array['amount_in'])) as incoming,
                    sum(public.app_report_number(to_jsonb(a), array['amount_out'])) as outgoing
                    from public.accounts a
                    where public.app_report_in_period(to_jsonb(a), p_from, p_to)
                    group by 1
                ) account_totals
            ), '[]'::jsonb)
        ),
        'books', jsonb_build_object(
            'records', (select count(*) from public.books),
            'transactions', (select count(*) from public.books b
                where public.app_report_in_period(to_jsonb(b), p_from, p_to)),
            'units', coalesce((select sum(public.app_report_number(to_jsonb(b), array['quantity', 'qty', 'quantity_in', 'quantity_out']))
                from public.books b where public.app_report_in_period(to_jsonb(b), p_from, p_to)), 0),
            'amount', coalesce((select sum(public.app_report_number(to_jsonb(b), array['net_amount', 'amount', 'total', 'amount_in', 'amount_out']))
                from public.books b where public.app_report_in_period(to_jsonb(b), p_from, p_to)), 0)
        ),
        'staff', jsonb_build_object(
            'total', (select count(*) from public.staff),
            'active', (select count(*) from public.staff s
                where lower(coalesce(to_jsonb(s) ->> 'status', 'active')) not in ('left', 'inactive', 'terminated', 'deleted')),
            'payroll_rows', (select count(*) from public.payroll p
                where public.app_report_in_period(to_jsonb(p), p_from, p_to)),
            'payroll_paid', coalesce((select sum(public.app_report_number(to_jsonb(p), array['net_salary', 'salary']))
                from public.payroll p
                where public.app_report_in_period(to_jsonb(p), p_from, p_to)
                  and lower(coalesce(to_jsonb(p) ->> 'status', '')) = 'paid'), 0),
            'payroll_unpaid', coalesce((select sum(public.app_report_number(to_jsonb(p), array['net_salary', 'salary']))
                from public.payroll p
                where public.app_report_in_period(to_jsonb(p), p_from, p_to)
                  and lower(coalesce(to_jsonb(p) ->> 'status', '')) <> 'paid'), 0),
            'attendance', coalesce((
                select jsonb_agg(jsonb_build_object('label', attendance_status, 'count', total) order by attendance_status)
                from (
                    select coalesce(to_jsonb(a) ->> 'status', 'Unknown') as attendance_status, count(*) as total
                    from public.staff_attendance a
                    where public.app_report_in_period(to_jsonb(a), p_from, p_to)
                    group by 1
                ) attendance_totals
            ), '[]'::jsonb)
        ),
        'followups', jsonb_build_object(
            'calls', (select count(*) from public.call_logs c
                where public.app_report_in_period(to_jsonb(c), p_from, p_to)),
            'promised_amount', coalesce((select sum(public.app_report_number(to_jsonb(c), array['promise_amount']))
                from public.call_logs c where public.app_report_in_period(to_jsonb(c), p_from, p_to)), 0),
            'by_outcome', coalesce((
                select jsonb_agg(jsonb_build_object('label', outcome, 'count', total) order by total desc, outcome)
                from (
                    select coalesce(nullif(trim(to_jsonb(c) ->> 'outcome'), ''), 'Unspecified') as outcome, count(*) as total
                    from public.call_logs c
                    where public.app_report_in_period(to_jsonb(c), p_from, p_to)
                    group by 1
                ) call_outcomes
            ), '[]'::jsonb)
        ),
        'increments', jsonb_build_object(
            'records', (select count(*) from public.increments),
            'amount', coalesce((select sum(
                    public.app_report_number(to_jsonb(i), array['fee_increament', 'increment', 'increase_amount'])
                    + public.app_report_number(to_jsonb(i), array['annual_fund'])
                )
                from public.increments i
                where public.app_report_in_period(to_jsonb(i), p_from, p_to)), 0)
        )
    )
    into result;

    return result;
end;
$$;

create table if not exists public.audit_log (
    id bigint generated always as identity primary key,
    occurred_at timestamptz not null default now(),
    actor_email text,
    table_name text not null,
    operation text not null check (operation in ('INSERT', 'UPDATE', 'DELETE')),
    row_key text,
    changes jsonb not null default '{}'::jsonb
);

create index if not exists audit_log_occurred_at_idx on public.audit_log (occurred_at desc, id desc);
create index if not exists audit_log_table_operation_idx on public.audit_log (table_name, operation, occurred_at desc);
alter table public.audit_log enable row level security;
revoke all on table public.audit_log from public, anon, authenticated;
revoke all on sequence public.audit_log_id_seq from public, anon, authenticated;

create or replace function public.app_capture_audit_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
    old_row jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
    new_row jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
    source_row jsonb;
    field_name text;
    old_value jsonb;
    new_value jsonb;
    changes jsonb := '{}'::jsonb;
    record_key text;
begin
    source_row := coalesce(new_row, old_row);
    record_key := coalesce(
        source_row ->> 'id', source_row ->> 'admis_no', source_row ->> 'voucher_id',
        source_row ->> 'staff_id', source_row ->> 'book_id', source_row ->> 'setting_key',
        source_row ->> 'email', source_row ->> 'name'
    );
    for field_name in
        select jsonb_object_keys(coalesce(old_row, '{}'::jsonb) || coalesce(new_row, '{}'::jsonb))
    loop
        if field_name ~* '(password|token|secret|credential)' then
            continue;
        end if;
        old_value := old_row -> field_name;
        new_value := new_row -> field_name;
        if old_value is distinct from new_value then
            changes := changes || jsonb_build_object(
                field_name, jsonb_build_object('old', old_value, 'new', new_value)
            );
        end if;
    end loop;
    if tg_op = 'UPDATE' and changes = '{}'::jsonb then
        return new;
    end if;

    insert into public.audit_log (actor_email, table_name, operation, row_key, changes)
    values (
        nullif(auth.jwt() ->> 'email', ''),
        tg_table_schema || '.' || tg_table_name,
        tg_op,
        record_key,
        changes
    );
    if tg_op = 'DELETE' then return old; end if;
    return new;
end;
$$;

revoke all on function public.app_capture_audit_event() from public, anon, authenticated;

do $$
declare
    table_name text;
begin
    foreach table_name in array array[
        'students', 'fees', 'accounts', 'increments', 'books', 'staff', 'payroll',
        'staff_attendance', 'call_logs', 'settings', 'app_users', 'app_roles', 'day_close'
    ] loop
        if to_regclass(format('public.%I', table_name)) is null then
            continue;
        end if;
        execute format('drop trigger if exists shibra_audit_log on public.%I', table_name);
        execute format(
            'create trigger shibra_audit_log after insert or update or delete on public.%I for each row execute function public.app_capture_audit_event()',
            table_name
        );
    end loop;
end;
$$;

create or replace function public.app_audit_events(
    p_from date,
    p_to date,
    p_table text default null,
    p_operation text default null,
    p_actor text default null,
    p_search text default null,
    p_limit integer default 50,
    p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
begin
    if not public.app_has_page_permission('audit', 'v') then
        raise exception 'Audit Trail View permission is required.'
            using errcode = '42501';
    end if;
    if p_from is null or p_to is null or p_from > p_to then
        raise exception 'Choose a valid audit date range.'
            using errcode = '22023';
    end if;
    if p_to - p_from > 3660 then
        raise exception 'Audit date ranges cannot exceed ten years.'
            using errcode = '22023';
    end if;

    return (
        with filtered as (
            select id, occurred_at, actor_email, table_name, operation, row_key, changes
            from public.audit_log
            where occurred_at >= (p_from::timestamp at time zone 'Asia/Karachi')
              and occurred_at < ((p_to + 1)::timestamp at time zone 'Asia/Karachi')
              and (nullif(p_table, '') is null or table_name = p_table)
              and (nullif(p_operation, '') is null or operation = upper(p_operation))
              and (nullif(p_actor, '') is null or coalesce(actor_email, '') ilike '%' || p_actor || '%')
              and (nullif(p_search, '') is null
                or coalesce(row_key, '') ilike '%' || p_search || '%'
                or changes::text ilike '%' || p_search || '%')
        ),
        page_rows as (
            select * from filtered
            order by occurred_at desc, id desc
            limit least(greatest(coalesce(p_limit, 50), 1), 200)
            offset least(greatest(coalesce(p_offset, 0), 0), 100000)
        )
        select jsonb_build_object(
            'total', (select count(*) from filtered),
            'events', coalesce(
                (select jsonb_agg(to_jsonb(page_rows) order by occurred_at desc, id desc) from page_rows),
                '[]'::jsonb
            )
        )
    );
end;
$$;

revoke all on function public.app_report_number(jsonb, text[]) from public, anon, authenticated;
revoke all on function public.app_report_in_period(jsonb, date, date) from public, anon, authenticated;
revoke all on function public.app_business_reports(date, date) from public, anon, authenticated;
revoke all on function public.app_audit_events(date, date, text, text, text, text, integer, integer)
    from public, anon, authenticated;
grant execute on function public.app_business_reports(date, date) to authenticated;
grant execute on function public.app_audit_events(date, date, text, text, text, text, integer, integer)
    to authenticated;

comment on table public.audit_log is
    'Append-only system audit events. Read only through app_audit_events() with the Audit Trail View permission.';

commit;

notify pgrst, 'reload schema';
