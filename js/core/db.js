// Shared database access for Shibra Campus pages.
(function () {
    window.ERP = window.ERP || {};

    const feeVoucherQueries = [
        ['students', 'select=*'],
        ['increments', 'select=admis_no,effective_period,old_fee,new_fee,fee_type,annual_fund,remarks'],
        ['accounts', 'select=voucher_id,amount_in,date,description,remarks&voucher_id=like.V-*'],
        ['fees', 'select=*']
    ];

    async function fetchAll(table, query) {
        const response = await sbFetchAll(table, query);
        if (!response.ok)
            throw new Error(`Could not load ${table} (HTTP ${response.status}): ${await response.text()}`);
        const rows = await response.json();
        if (!Array.isArray(rows))
            throw new Error(`Could not load ${table}: the response was not a row list.`);
        return rows;
    }

    async function fetchResponse(table, query) {
        const response = await sbFetchAll(table, query);
        if (!response.ok)
            throw new Error(`Could not load ${table} (HTTP ${response.status}): ${await response.text()}`);
        return response;
    }

    function request(table, query) {
        return sbFetchAll(table, query);
    }

    async function feeVoucherData() {
        const [students, increments, accounts, fees] = await Promise.all(
            feeVoucherQueries.map(([table, query]) => fetchAll(table, query))
        );
        return { students, increments, accounts, fees };
    }

    ERP.db = { request, fetchAll, fetchResponse, feeVoucherData, feeVoucherQueries };
})();
