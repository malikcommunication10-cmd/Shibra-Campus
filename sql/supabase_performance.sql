-- =====================================================================
-- Shibra Campus: performance indexes (safe to run more than once)
-- Run in the Supabase SQL Editor. It only creates an index when the table
-- and the column exist, so it will not fail on a partly set up database.
-- Indexes make the filters used by every page (by date, voucher, admission
-- number, party) fast as the data grows to many thousands of rows.
-- =====================================================================
do $$
declare
    spec text[];
    specs text[][] := array[
        -- table,            column(s),               index name
        ['accounts',         'date',                  'idx_accounts_date'],
        ['accounts',         'voucher_id',            'idx_accounts_voucher_id'],
        ['accounts',         'date, voucher_id',      'idx_accounts_date_voucher'],
        ['fees',             'voucher_id',            'idx_fees_voucher_id'],
        ['fees',             'admis_no',              'idx_fees_admis_no'],
        ['fees',             'period',                'idx_fees_period'],
        ['students',         'admis_no',              'idx_students_admis_no'],
        ['students',         'status',                'idx_students_status'],
        ['students',         'class',                 'idx_students_class'],
        ['books',            'date',                  'idx_books_date'],
        ['books',            'voucher_no',            'idx_books_voucher_no'],
        ['payroll',          'month',                 'idx_payroll_month'],
        ['payroll',          'staff_id',              'idx_payroll_staff_id'],
        ['staff_attendance', 'date',                  'idx_staff_attendance_date'],
        ['staff_security_ledger', 'staff_id',         'idx_staff_security_staff'],
        ['fixed_asset_transactions', 'asset_id',      'idx_fixed_asset_tx_asset']
    ];
    i int;
    cols text[];
    c text;
    ok boolean;
begin
    for i in 1 .. array_length(specs, 1) loop
        spec := array[specs[i][1], specs[i][2], specs[i][3]];
        ok := to_regclass('public.' || spec[1]) is not null;
        if ok then
            cols := string_to_array(replace(spec[2], ' ', ''), ',');
            foreach c in array cols loop
                if not exists (select 1 from information_schema.columns
                               where table_schema = 'public' and table_name = spec[1] and column_name = c) then
                    ok := false;
                end if;
            end loop;
        end if;
        if ok then
            execute format('create index if not exists %I on public.%I (%s)', spec[3], spec[1], spec[2]);
            raise notice 'index ready: %', spec[3];
        else
            raise notice 'skipped (table or column not found): %', spec[3];
        end if;
    end loop;
end $$;

analyze;
