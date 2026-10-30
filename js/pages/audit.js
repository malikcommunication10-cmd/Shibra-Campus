const $ = id => document.getElementById(id), PAGE_SIZE = 50;
const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
let currentPage = 0, total = 0, events = [], auditRequestId = 0, auditFilterTimer = null;
const iso = date => date.toISOString().slice(0, 10);
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
function setStatus(message, ok) {
    const el = $('auditStatus'); el.textContent = message;
    el.className = `rounded-xl border px-4 py-3 text-sm ${ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'}`;
    el.classList.toggle('hidden', !message);
}
function render() {
    $('auditCount').textContent = `${total.toLocaleString()} matching event(s)`;
    $('pageNumber').textContent = `Page ${currentPage + 1} · ${events.length} shown`;
    $('previousAudit').disabled = currentPage === 0;
    $('nextAudit').disabled = (currentPage + 1) * PAGE_SIZE >= total;
    $('auditRows').innerHTML = events.length ? events.map(event => {
        const changed = JSON.stringify(event.changes || {}, null, 2);
        return `<tr><td>${esc(new Date(event.occurred_at).toLocaleString())}</td>
            <td>${esc(event.actor_email || 'Unattributed')}<br><span class="text-[10px] text-slate-400">${esc(event.id)}</span></td>
            <td><span class="audit-action ${esc(event.operation)}">${esc(event.operation)}</span></td>
            <td>${esc(event.table_name)}</td><td>${esc(event.row_key || '—')}</td>
            <td><details><summary class="cursor-pointer text-indigo-700 font-semibold">Show changed fields</summary><pre>${esc(changed)}</pre></details></td></tr>`;
    }).join('') : '<tr><td colspan="6" class="p-4 text-sm text-slate-500">No audit events match these filters.</td></tr>';
}
async function loadAudit() {
    const requestId = ++auditRequestId;
    const from = $('fromDate').value, to = $('toDate').value;
    if (!from || !to || from > to) {
        $('applyAudit').disabled = false;
        setStatus('Choose a valid date range; From must be on or before To.', false);
        return;
    }
    $('applyAudit').disabled = true; setStatus('', true);
    try {
        const response = await fetch(`${SB_URL}/rest/v1/rpc/app_audit_events`, {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({
                p_from: from, p_to: to, p_table: $('tableFilter').value || null,
                p_operation: $('operationFilter').value || null, p_actor: $('actorFilter').value.trim() || null,
                p_search: $('searchFilter').value.trim() || null, p_limit: PAGE_SIZE, p_offset: currentPage * PAGE_SIZE
            })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || result.details || `Request failed (${response.status})`);
        if (!result || !Array.isArray(result.events)) throw new Error('The audit service returned an unexpected response.');
        if (requestId !== auditRequestId) return;
        events = result.events; total = Number(result.total) || 0; render();
    } catch (error) {
        if (requestId !== auditRequestId) return;
        events = []; total = 0; render(); setStatus(`Could not load audit events: ${error.message}`, false);
        console.error('Could not load audit events:', error);
    } finally { if (requestId === auditRequestId) $('applyAudit').disabled = false; }
}
function applyAuditFiltersSoon() {
    clearTimeout(auditFilterTimer);
    auditFilterTimer = setTimeout(() => { currentPage = 0; loadAudit(); }, 250);
}
const tableNames = ['students','fees','accounts','increments','books','staff','payroll','staff_attendance','call_logs','settings','app_users','app_roles','day_close'];
tableNames.forEach(name => { const option = document.createElement('option'); option.value = `public.${name}`; option.textContent = name; $('tableFilter').appendChild(option); });
$('period').onchange = () => {
    if ($('period').value !== 'custom') setPreset($('period').value);
    applyAuditFiltersSoon();
};
['fromDate','toDate'].forEach(id => $(id).onchange = () => { $('period').value = 'custom'; applyAuditFiltersSoon(); });
['tableFilter','operationFilter'].forEach(id => $(id).onchange = applyAuditFiltersSoon);
['actorFilter','searchFilter'].forEach(id => $(id).addEventListener('input', applyAuditFiltersSoon));
$('applyAudit').onclick = () => { currentPage = 0; loadAudit(); };
$('previousAudit').onclick = () => { if (currentPage > 0) { currentPage--; loadAudit(); } };
$('nextAudit').onclick = () => { if ((currentPage + 1) * PAGE_SIZE < total) { currentPage++; loadAudit(); } };
$('printAudit').onclick = () => window.print();
$('exportAudit').onclick = () => {
    if (!flag('export')) { deny('Export permission is required to download audit data.'); return; }
    const csv = rows => {
        const cols = ['occurred_at','actor_email','operation','table_name','row_key','changes'];
        const quote = value => {
            let text = String(value == null ? '' : value);
            if (/^[\s]*[=+\-@]/.test(text)) text = "'" + text;
            return `"${text.replace(/"/g, '""')}"`;
        };
        const body = [cols.map(quote).join(','), ...rows.map(row => [
            row.occurred_at, row.actor_email, row.operation, row.table_name, row.row_key, JSON.stringify(row.changes || {})
        ].map(quote).join(','))].join('\r\n');
        const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([body], {type:'text/csv;charset=utf-8'}));
        link.download = `audit_${$('fromDate').value}_${$('toDate').value}_page${currentPage + 1}.csv`; link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    };
    csv(events);
};
window.addEventListener('DOMContentLoaded', () => { setPreset('month'); loadAudit(); });
