const $ = id => document.getElementById(id);
const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const n = value => Number(value) || 0;
const fmt = value => n(value).toLocaleString(undefined, {maximumFractionDigits: 2});
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
function render(data) {
    reportData = data;
    const st = data.students || {}, fees = data.fees || {}, accounts = data.accounts || {}, staff = data.staff || {}, followups = data.followups || {};
    $('periodLabel').textContent = `Activity from ${data.from} through ${data.to} · generated ${new Date(data.generated_at).toLocaleString()}`;
    const group = (title, hint) => `<div class="col-span-full mt-1"><h2 class="text-sm font-extrabold uppercase tracking-wider text-indigo-950">${esc(title)}</h2><p class="text-xs text-slate-500">${esc(hint)}</p></div>`;
    const billed = Number(fees.payable) || 0, got = Number(fees.collected_to_selected_vouchers) || 0;
    const rate = billed > 0 ? Math.round(got / billed * 100) + '%' : '-';
    $('kpis').innerHTML = [
        group('People', 'Students and staff right now'),
        card('Students enrolled', fmt(st.total), `${fmt(st.active)} active now`),
        card('Staff', fmt(staff.total), `${fmt(staff.active)} active now`),
        group('Fees', 'What was billed, what came in, what is still pending'),
        card('Fees billed (after discounts)', `Rs ${fmt(fees.payable)}`, `${fmt(fees.fee_rows)} fee rows · discounts given Rs ${fmt(fees.discounts)}`),
        card('Fees collected', `Rs ${fmt(fees.collected_to_selected_vouchers)}`, `Collection rate ${rate}`),
        card('Fees still pending (estimate)', `Rs ${fmt(fees.estimated_outstanding)}`, 'Billed minus collected'),
        group('Money in & out', 'Recorded in Accounts during the selected dates'),
        card('Money received', `Rs ${fmt(accounts.money_in)}`, `${fmt(accounts.entries)} account entries`),
        card('Money paid out', `Rs ${fmt(accounts.money_out)}`, 'All recorded outflow'),
        group('Staff & follow-up', 'Payroll and fee follow-up work'),
        card('Payroll paid', `Rs ${fmt(staff.payroll_paid)}`, `${fmt(staff.payroll_rows)} payroll rows in period`),
        card('Payroll unpaid', `Rs ${fmt(staff.payroll_unpaid)}`, 'Saved payroll marked unpaid'),
        card('Follow-up calls', fmt(followups.calls), `Promises logged at those calls: Rs ${fmt(followups.promised_amount)}`)
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
    ['students','fees','accounts','books','staff','followups','increments'].forEach(section => {
        const values = result[section] || {};
        Object.entries(values).forEach(([key, value]) => {
            if (Array.isArray(value)) value.forEach(row => add(section + ':' + key, row.label || 'Unspecified', JSON.stringify(row)));
            else if (value === null || ['string','number','boolean'].includes(typeof value)) add(section, key, value);
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
        const response = await fetch(`${SB_URL}/rest/v1/rpc/app_business_reports`, {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({p_from: from, p_to: to})
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || data.details || `Request failed (${response.status})`);
        if (!data || !data.students || !data.fees) throw new Error('The report service returned an unexpected response.');
        if (requestId !== reportRequestId) return;
        render(data);
    } catch (error) {
        if (requestId !== reportRequestId) return;
        status(`Could not load business reports: ${error.message}`, false);
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
    setPreset('month');
    load();
});
