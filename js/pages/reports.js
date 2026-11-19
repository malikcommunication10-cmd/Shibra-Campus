const $ = id => document.getElementById(id);
const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const n = value => Number(value) || 0;
const fmt = value => n(value).toLocaleString(undefined, {maximumFractionDigits: 2});
const currency = value => `PKR ${fmt(value)}`;
const iso = date => date.toISOString().slice(0, 10);
let reportData = null, reportRequestId = 0, reportFilterTimer = null;
function periodDates(preset) {
    const today = todayYmd().split('-').map(Number), y = today[0], m = today[1], d = today[2];
    const utc = (year, month, day) => new Date(Date.UTC(year, month - 1, day));
    if (preset === 'today') return [iso(utc(y, m, d)), iso(utc(y, m, d))];
    if (preset === 'last_month') return [iso(utc(y, m - 1, 1)), iso(utc(y, m, 0))];
    if (preset === 'year') return [iso(utc(y, 1, 1)), iso(utc(y, 12, 31))];
    if (preset === 'last_year') return [iso(utc(y - 1, 1, 1)), iso(utc(y - 1, 12, 31))];
    return [iso(utc(y, m, 1)), iso(utc(y, m, d))];
}
function setPreset(value) { const dates = periodDates(value); $('fromDate').value = dates[0]; $('toDate').value = dates[1]; }
function status(message, ok) {
    const box = $('reportStatus'); box.textContent = message;
    box.className = `rounded-xl border px-4 py-3 text-sm ${ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'}`;
    box.classList.toggle('hidden', !message);
}
function rows(id, data, columns) {
    const list = Array.isArray(data) ? data : [];
    $(id).innerHTML = list.length ? list.map(row => `<tr>${columns.map(col => `<td>${esc(col(row))}</td>`).join('')}</tr>`).join('')
        : `<tr><td colspan="${columns.length}" class="text-slate-500">No records for this period</td></tr>`;
}
function renderAccountRows(data) {
    const list = Array.isArray(data) ? data : [];
    const tuitionRows = list.filter(row => /(tuition|tution)\s*fee/i.test(String(row.label || '')));
    const annualFundRows = list.filter(row => /annual\s*fund/i.test(String(row.label || '')));
    const receivableRows = [...tuitionRows, ...annualFundRows];
    const otherRows = list.filter(row => !receivableRows.includes(row));
    const rowMarkup = row => `<tr><td>${esc(row.label)}</td><td>${fmt(row.money_in)}</td><td>${fmt(row.money_out)}</td></tr>`;
    $('accountRows').innerHTML = otherRows.map(rowMarkup).join('') || '<tr><td colspan="3" class="text-slate-500">No other account activity for this period</td></tr>';
    $('tuitionReceivableRows').innerHTML = tuitionRows.map(rowMarkup).join('') || '<tr><td colspan="3" class="text-slate-500">No tuition-fee account activity for this period</td></tr>';
    $('annualFundRows').innerHTML = annualFundRows.map(rowMarkup).join('') || '<tr><td colspan="3" class="text-slate-500">No annual-fund account activity for this period</td></tr>';
}
function card(label, value, note) {
    return `<article class="report-kpi bg-white p-4 rounded-2xl border border-slate-200 shadow-sm"><p class="text-xs font-semibold text-slate-500">${esc(label)}</p><p class="text-xl font-extrabold text-indigo-950 mt-1 break-words">${esc(value)}</p><p class="text-[11px] text-slate-400 mt-1">${esc(note || '')}</p></article>`;
}
function reportProgress(received, billed) {
    return billed > 0 ? Math.min(100, Math.max(0, received / billed * 100)) : 0;
}
function renderFinancialOverview(data) {
    const financials = data.financials || {};
    const month = financials.period_tuition || {};
    const lifetime = financials.to_date_fees || {};
    const annual = financials.annual_fund || {};
    const zeroCount = n(month.zero_received_count);
    const progressBar = (received, billed) => `<div class="fin-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${reportProgress(received, billed).toFixed(1)}"><span style="width:${reportProgress(received, billed).toFixed(1)}%"></span></div>`;
    $('financialOverview').innerHTML = `
        <div class="fin-overview-head">
            <div><p class="fin-eyebrow">Collections overview</p><h2>Fees &amp; recovery</h2><p>Clear view of billed amounts, collections and balances through ${esc(data.to)}.</p></div>
            <span class="fin-updated"><span class="fin-live-dot"></span> Live report</span>
        </div>
        <div class="fin-grid">
            <article class="fin-card fin-card-featured">
                <div class="fin-card-head"><span class="fin-icon fin-icon-blue">↗</span><span class="fin-tag">Selected period</span></div>
                <h3>Tuition fee</h3><p class="fin-card-caption">Fees billed for the selected period</p>
                <div class="fin-main-value">${currency(month.billed)}</div>
                ${progressBar(n(month.received), n(month.billed))}
                <div class="fin-split"><div><span>Received</span><b>${currency(month.received)}</b></div><button type="button" class="fin-click-value" data-report-list="period-pending"><span>Pending</span><b>${currency(month.pending)}</b></button></div>
            </article>
            <article class="fin-card">
                <div class="fin-card-head"><span class="fin-icon fin-icon-amber">◷</span><span class="fin-tag">Through ${esc(data.to)}</span></div>
                <h3>Total fees to date</h3><p class="fin-card-caption">All fee types billed so far</p>
                <div class="fin-main-value">${currency(lifetime.billed)}</div>
                ${progressBar(n(lifetime.received), n(lifetime.billed))}
                <div class="fin-split"><div><span>Received</span><b>${currency(lifetime.received)}</b></div><button type="button" class="fin-click-value" data-report-list="lifetime-pending"><span>Pending</span><b>${currency(lifetime.pending)}</b></button></div>
            </article>
            <article class="fin-card">
                <div class="fin-card-head"><span class="fin-icon fin-icon-green">✳</span><span class="fin-tag">After discounts</span></div>
                <h3>Annual fund</h3><p class="fin-card-caption">Annual fund vouchers billed to date</p>
                <div class="fin-main-value">${currency(annual.billed)}</div>
                ${progressBar(n(annual.received), n(annual.billed))}
                <div class="fin-split"><div><span>Received</span><b>${currency(annual.received)}</b></div><button type="button" class="fin-click-value" data-report-list="annual-pending"><span>Balance</span><b>${currency(annual.pending)}</b></button></div>
            </article>
            <article class="fin-card fin-card-zero">
                <div class="fin-card-head"><span class="fin-icon fin-icon-rose">0</span><span class="fin-tag">Selected period</span></div>
                <h3>No tuition received</h3><p class="fin-card-caption">Students with a tuition bill and zero collection in this period</p>
                <div class="fin-zero-row"><strong>${fmt(zeroCount)}</strong><button type="button" class="fin-list-link" data-report-list="zero-received">View student list <span aria-hidden="true">→</span></button></div>
            </article>
        </div>`;
    $('financialOverview').querySelectorAll('[data-report-list]').forEach(button => {
        button.onclick = () => showFinancialList(button.dataset.reportList);
    });
}
function showFinancialList(kind) {
    const finance = reportData && reportData.financials || {};
    const month = finance.period_tuition || {}, lifetime = finance.to_date_fees || {}, annual = finance.annual_fund || {};
    const definitions = {
        'period-pending': { title: 'Selected-period tuition balances', rows: (month.students || []).filter(row => n(row.pending) > 0.5), empty: 'No pending tuition balances for this period.' },
        'lifetime-pending': { title: 'Fees pending through report date', rows: lifetime.students || [], empty: 'No fees are pending through this date.' },
        'annual-pending': { title: 'Annual fund balances', rows: annual.students || [], empty: 'No annual fund balance is pending.' },
        'zero-received': { title: 'Students with zero tuition received', rows: month.zero_received_students || [], empty: 'All billed students have a tuition collection in this period.' }
    };
    const list = definitions[kind];
    if (!list) return;
    const table = list.rows.length ? `<div class="fin-modal-table"><table><thead><tr><th>Student</th><th>Adm #</th><th>Class</th><th>Status</th><th>Billed</th><th>Received</th><th>Pending</th></tr></thead><tbody>${list.rows.map(row => `<tr><td>${esc(row.student_name)}</td><td>${esc(row.admis_no)}</td><td>${esc(row.class)}</td><td>${esc(row.status)}</td><td>${currency(row.billed)}</td><td>${currency(row.received)}</td><td>${currency(row.pending)}</td></tr>`).join('')}</tbody></table></div>` : `<p class="fin-empty">${list.empty}</p>`;
    UI.dialog({ title: list.title, html: `<p class="fin-modal-note">${fmt(list.rows.length)} student${list.rows.length === 1 ? '' : 's'} · ${esc(reportData.from)} to ${esc(reportData.to)}</p>${table}`, wide: true, buttons: [{ label: 'Close', value: null }] });
}
function render(data) {
    reportData = data;
    const st = data.students || {}, fees = data.fees || {}, accounts = data.accounts || {}, staff = data.staff || {}, followups = data.followups || {};
    $('periodLabel').textContent = `Activity from ${data.from} through ${data.to} · generated ${new Date(data.generated_at).toLocaleString()}`;
    renderFinancialOverview(data);
    $('kpis').innerHTML = [
        card('Students', fmt(st.total), `${fmt(st.active)} active now`),
        card('Staff', fmt(staff.total), `${fmt(staff.active)} active now`),
        card('Money received', currency(accounts.money_in), `${fmt(accounts.entries)} account entries in period`),
        card('Money paid out', currency(accounts.money_out), 'Recorded account outflow in period'),
        card('Payroll unpaid', currency(staff.payroll_unpaid), 'Saved payroll in selected period'),
        card('Follow-up calls', fmt(followups.calls), `Promises logged: ${currency(followups.promised_amount)}`)
    ].join('');
    rows('classRows', st.by_class, [row => row.label, row => fmt(row.count), row => fmt(row.left_count), row => fmt(row.net_count)]);
    $('classTotal').textContent = fmt(st.total);
    $('classLeftTotal').textContent = fmt(st.left);
    $('classNetTotal').textContent = fmt(st.active);
    rows('tuitionRows', st.by_tuition_fee, [row => `Rs ${fmt(row.label)}`, row => fmt(row.count)]);
    $('averageTuitionFee').textContent = `Rs ${fmt(st.average_tuition_fee)}`;
    const feeTypes = Array.isArray(fees.by_type) ? fees.by_type : [];
    rows('feeRows', feeTypes, [
        row => row.label,
        row => fmt(row.active_count), row => `Rs ${fmt(row.active_payable)}`, row => `Rs ${fmt(row.active_discount)}`, row => `Rs ${fmt(row.active_net_payable)}`,
        row => fmt(row.left_count), row => `Rs ${fmt(row.left_payable)}`, row => `Rs ${fmt(row.left_discount)}`, row => `Rs ${fmt(row.left_net_payable)}`,
        row => fmt(row.count), row => `Rs ${fmt(row.payable)}`, row => `Rs ${fmt(row.discount)}`, row => `Rs ${fmt(row.net_payable)}`
    ]);
    const feeTotals = feeTypes.reduce((totals, row) => {
        ['active_count','active_payable','active_discount','active_net_payable','left_count','left_payable','left_discount','left_net_payable','count','payable','discount','net_payable'].forEach(key => {
            totals[key] += n(row[key]);
        });
        return totals;
    }, {active_count:0,active_payable:0,active_discount:0,active_net_payable:0,left_count:0,left_payable:0,left_discount:0,left_net_payable:0,count:0,payable:0,discount:0,net_payable:0});
    [
        ['feeActiveCountTotal', feeTotals.active_count, false], ['feeActiveGrossTotal', feeTotals.active_payable, true],
        ['feeActiveDiscountTotal', feeTotals.active_discount, true], ['feeActiveNetTotal', feeTotals.active_net_payable, true],
        ['feeLeftCountTotal', feeTotals.left_count, false], ['feeLeftGrossTotal', feeTotals.left_payable, true],
        ['feeLeftDiscountTotal', feeTotals.left_discount, true], ['feeLeftNetTotal', feeTotals.left_net_payable, true],
        ['feeAllCountTotal', feeTotals.count, false], ['feeAllGrossTotal', feeTotals.payable, true],
        ['feeAllDiscountTotal', feeTotals.discount, true], ['feeAllNetTotal', feeTotals.net_payable, true]
    ].forEach(([id, value, currency]) => { $(id).textContent = currency ? `Rs ${fmt(value)}` : fmt(value); });
    renderAccountRows(accounts.by_account);
    rows('attendanceRows', staff.attendance, [row => row.label, row => fmt(row.count)]);
    rows('followupRows', followups.by_outcome, [row => row.label, row => fmt(row.count)]);
    $('booksSummary').textContent = `Books: ${fmt(data.books && data.books.records)} saved records · ${fmt(data.books && data.books.transactions)} dated transactions in period · ${fmt(data.books && data.books.units)} units`;
    $('incrementSummary').textContent = `Increments (all saved records): ${fmt(data.increments && data.increments.records)} · Rs ${fmt(data.increments && data.increments.amount)} in the selected period`;
}
function exportReport() {
    if (!flag('export')) { deny('Export permission is required to download reports.'); return; }
    if (!reportData) { status('Load a report before exporting.', false); return; }
    const result = reportData, flat = [];
    const add = (section, label, value) => flat.push({period_from:result.from, period_to:result.to, section, label, value});
    ['students','fees','financials','accounts','books','staff','followups','increments'].forEach(section => {
        const values = result[section] || {};
        Object.entries(values).forEach(([key, value]) => {
            if (Array.isArray(value)) value.forEach(row => add(section + ':' + key, row.label || 'Unspecified', JSON.stringify(row)));
            else if (value === null || ['string','number','boolean'].includes(typeof value)) add(section, key, value);
            else if (section === 'financials' && value && typeof value === 'object') {
                Object.entries(value).forEach(([metric, detail]) => {
                    if (Array.isArray(detail)) detail.forEach(row => add(section + ':' + key + ':' + metric, row.student_name || 'Unspecified', JSON.stringify(row)));
                    else if (detail === null || ['string','number','boolean'].includes(typeof detail)) add(section + ':' + key, metric, detail);
                });
            }
        });
    });
    const columns = ['period_from','period_to','section','label','value'];
    const quote = value => {
        let text = String(value == null ? '' : value);
        if (/^[\s]*[=+\-@]/.test(text)) text = "'" + text;
        return `"${text.replace(/"/g, '""')}"`;
    };
    const content = [columns.map(quote).join(','), ...flat.map(row => columns.map(key => quote(row[key])).join(','))].join('\r\n');
    const url = URL.createObjectURL(new Blob([content], {type:'text/csv;charset=utf-8'}));
    const link = document.createElement('a'); link.href = url; link.download = `school_reports_${result.from}_${result.to}.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function load() {
    const requestId = ++reportRequestId;
    reportData = null;
    const from = $('fromDate').value, to = $('toDate').value;
    if (!from || !to || from > to) {
        $('applyReport').disabled = $('refreshReport').disabled = false;
        status('Choose a valid date range; From must be on or before To.', false);
        return;
    }
    $('applyReport').disabled = $('refreshReport').disabled = true; status('', true);
    try {
        const [response, financialResponse] = await Promise.all([
            fetch(`${SB_URL}/rest/v1/rpc/app_business_reports`, {
                method: 'POST', headers: {'Content-Type':'application/json'},
                body: JSON.stringify({p_from: from, p_to: to})
            }),
            fetch(`${SB_URL}/rest/v1/rpc/app_business_report_financials`, {
                method: 'POST', headers: {'Content-Type':'application/json'},
                body: JSON.stringify({p_from: from, p_to: to})
            })
        ]);
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || data.details || `Request failed (${response.status})`);
        const financials = await financialResponse.json();
        if (!financialResponse.ok) throw new Error(financials.message || financials.details || `Financial details unavailable (${financialResponse.status}). Run sql/supabase_business_report_financials.sql.`);
        if (!data || !data.students || !data.fees || !financials) throw new Error('The report service returned an unexpected response.');
        if (data.report_schema_version !== 2) {
            throw new Error('The Business Reports database function is outdated. Rerun sql/supabase_reports_audit.sql in Supabase, then refresh this page.');
        }
        if (requestId !== reportRequestId) return;
        render({...data, financials});
    } catch (error) {
        if (requestId !== reportRequestId) return;
        status(`Could not load business reports: ${error.message}`, false);
        $('financialOverview').innerHTML = `<div class="fin-empty">Financial overview could not load. ${esc(error.message)}</div>`;
        console.error('Could not load business reports:', error);
    } finally {
        if (requestId === reportRequestId) $('applyReport').disabled = $('refreshReport').disabled = false;
    }
}
function applyReportFiltersSoon() {
    clearTimeout(reportFilterTimer);
    reportFilterTimer = setTimeout(load, 250);
}
$('preset').onchange = () => {
    if ($('preset').value !== 'custom') setPreset($('preset').value);
    applyReportFiltersSoon();
};
['fromDate','toDate'].forEach(id => $(id).onchange = () => { $('preset').value = 'custom'; applyReportFiltersSoon(); });
$('applyReport').onclick = load; $('refreshReport').onclick = load; $('printReport').onclick = () => window.print(); $('exportReport').onclick = exportReport;
const reportCards = () => Array.from(document.querySelectorAll('.report-card'));
const setReportCardExpanded = (button, expanded) => {
    button.setAttribute('aria-expanded', String(expanded));
    const content = document.getElementById(button.getAttribute('aria-controls'));
    if (content) content.hidden = !expanded;
};
document.querySelectorAll('.report-card-toggle').forEach(button => {
    button.onclick = () => setReportCardExpanded(button, button.getAttribute('aria-expanded') !== 'true');
});
$('expandAllReports').onclick = () => reportCards().forEach(card => setReportCardExpanded(card.querySelector('.report-card-toggle'), true));
$('collapseAllReports').onclick = () => reportCards().forEach(card => setReportCardExpanded(card.querySelector('.report-card-toggle'), false));
if (!flag('export')) $('exportReport').disabled = true;
window.addEventListener('DOMContentLoaded', () => {
    $('preset').value = 'month';
    setPreset('month');
    load();
});
