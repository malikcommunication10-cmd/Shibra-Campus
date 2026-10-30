/* Financial Statements – built from Accounts, Fees, Book Store and (optional) Assets / Staff security.
   The school books are single-entry / cash-basis, so this page gives:
   Income & Expenditure (cash basis), Financial Position (as of today), Fees Outstanding (ageing) and a Books Check. */
const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const fmt = n => r2(n).toLocaleString('en-US');
const pk = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const tcase = s => String(s || '').replace(/\w\S*/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase());
const ymd = d => d.toLocaleDateString('en-CA');
const today = () => (typeof todayYmd === 'function' ? todayYmd() : ymd(new Date()));
const fmtDate = s => s ? new Date(s + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
const signed = n => `<span class="${n < 0 ? 'st-neg' : 'st-pos'}">${n < 0 ? '−' : ''}PKR ${fmt(Math.abs(n))}</span>`;

const WALLETS = { cash: { label: 'Cash in Hand' } };
let ENT = [], RAW = [], FEES = [], BOOKS = [], PAYROLL = [], ASSET_EV = [], SEC = [], SECURITY_OK = false, ASSETS_OK = false, SY = new Date().getFullYear();
let activeTab = 'ie', exportRows = null, exportName = 'statement';

function setupWallets(items) {
    payAccountList(items).forEach(o => { const m = o.label.match(/^(\S+)\s+(.*)$/) || [null, '', o.label]; WALLETS[o.value] = { label: m[2] }; });
}
function nw(v) {
    const raw = String(v || '').trim(), low = raw.toLowerCase();
    for (const k of Object.keys(WALLETS)) if (k.toLowerCase() === low || WALLETS[k].label.toLowerCase() === low) return k;
    if (/bank/.test(low)) return WALLETS.bank ? 'bank' : Object.keys(WALLETS).find(k => /bank/i.test(k)) || 'cash';
    if (/online|jazz|easy|wallet|raast/.test(low)) return WALLETS.online ? 'online' : Object.keys(WALLETS).find(k => /online|jazz|easy/i.test(k)) || 'cash';
    return 'cash';
}
function knownAccount(v) {
    const low = String(v || '').trim().toLowerCase(); if (!low) return false;
    return Object.keys(WALLETS).some(k => k.toLowerCase() === low || WALLETS[k].label.toLowerCase() === low) || /bank|online|jazz|easy|wallet|raast|cash/.test(low);
}

// Same voucher rules as Accounts → Daybook, so the numbers agree with that page
function norm(row) {
    const id = String(row.voucher_id || '').trim(), up = id.toUpperCase();
    const inA = parseFloat(row.amount_in) || 0, outA = parseFloat(row.amount_out) || 0;
    const from = String(row.from_account || '').trim(), to = String(row.to_account || '').trim(), desc = String(row.description || '').trim();
    const e = { id, date: String(row.date || '').slice(0, 10), desc, flag: '', wallet: null, wallet2: null, acct: '' };
    if (/^(AR|AP)-\d+$/.test(up)) return null;                                  // a bill is not cash
    if (/^(?:AR|AP|BK)-\d+-/.test(up)) { const isIn = inA > 0; return Object.assign(e, { kind: isIn ? 'receipt' : 'payment', acct: isIn ? to : from, wallet: nw(isIn ? to : from), amount: inA || outA, head: isIn ? 'Accounts Receivable' : 'Accounts Payable' }); }
    if (up.startsWith('TV-')) return Object.assign(e, { kind: 'transfer', acct: from, wallet: nw(from), wallet2: nw(to), amount: inA || outA, head: 'Transfer' });
    if (up.startsWith('OB-')) return Object.assign(e, { kind: 'opening', acct: to, wallet: nw(to), amount: inA || outA, head: 'Opening balance' });
    if (up.startsWith('FA-P-')) return Object.assign(e, { kind: 'payment', acct: from, wallet: nw(from), amount: outA, head: 'Fixed asset purchase', flag: 'asset' });
    if (up.startsWith('FA-S-')) return Object.assign(e, { kind: 'receipt', acct: to, wallet: nw(to), amount: inA, head: 'Fixed asset sale', flag: 'asset' });
    if (up.startsWith('PD-')) return Object.assign(e, { kind: 'payment', acct: from, wallet: nw(from), amount: outA || inA, head: 'Partner drawings', flag: 'partner' });
    if (up.startsWith('PV-')) return Object.assign(e, { kind: 'payment', acct: from, wallet: nw(from), amount: outA || inA, head: to || 'Misc Expense', flag: pk(to) === pk('Staff Security Payable') ? 'security' : (pk(to) === pk('Partner Drawings') ? 'partner' : '') });
    if (up.startsWith('RV-')) return Object.assign(e, { kind: 'receipt', acct: to, wallet: nw(to), amount: inA || outA, head: from || 'Other Income' });
    if (/^(cash receipt|cash payment|salary payment)$/i.test(from)) { const r = inA > 0 && outA === 0; return Object.assign(e, { kind: r ? 'receipt' : 'payment', acct: row.remarks, wallet: nw(row.remarks), amount: r ? inA : outA, head: /salary/i.test(from) ? 'Salaries' : (r ? 'Other Income' : 'Misc Expense') }); }
    if (outA > 0 && inA === 0) return Object.assign(e, { kind: 'payment', acct: from, wallet: nw(from), amount: outA, head: to || desc || 'Misc Expense', flag: pk(to) === pk('Partner Drawings') ? 'partner' : '' });
    const fee = /^V-\d+/i.test(id); let head = from || 'Receipt';
    if (fee) { const m = from.match(/^(.*?)\s*\((.*?)\)\s*-\s*(.*)$/); head = 'Fee – ' + tcase(m ? m[1] : (from || 'Tuition Fee')); }
    return Object.assign(e, { kind: 'receipt', acct: to, wallet: nw(to), amount: inA, head, flag: fee ? 'fee' : '' });
}
const delta = (e, w) => e.kind === 'receipt' || e.kind === 'opening' ? (e.wallet === w ? e.amount : 0)
    : e.kind === 'payment' ? (e.wallet === w ? -e.amount : 0)
    : e.kind === 'transfer' ? (e.wallet === w ? -e.amount : 0) + (e.wallet2 === w ? e.amount : 0) : 0;
const balanceTo = (date, w) => ENT.reduce((s, e) => e.date && e.date <= date ? s + delta(e, w) : s, 0);
const balanceBefore = (date, w) => ENT.reduce((s, e) => e.date && e.date < date ? s + delta(e, w) : s, 0);
const sumBy = (list, fn) => list.reduce((s, e) => s + fn(e), 0);

/* ---------------- period ---------------- */
function applyPreset() {
    const p = $('stPeriod').value, now = new Date(); let f = '', t = '';
    if (p === 'month') { f = ymd(new Date(now.getFullYear(), now.getMonth(), 1)); t = ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0)); }
    else if (p === 'lastmonth') { f = ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)); t = ymd(new Date(now.getFullYear(), now.getMonth(), 0)); }
    else if (p === 'year') { f = `${now.getFullYear()}-01-01`; t = `${now.getFullYear()}-12-31`; }
    else if (p === 'all') { f = ENT.reduce((m, e) => e.date && e.date < m ? e.date : m, '9999-12-31'); if (f === '9999-12-31') f = today(); t = today(); }
    if (p !== 'custom') { $('stFrom').value = f; $('stTo').value = t; }
}
const range = () => ({ from: $('stFrom').value || '0000-01-01', to: $('stTo').value || '9999-12-31' });

/* ---------------- data ---------------- */
async function tryFetch(table, query) {
    try { const r = await ERP.db.request(table, query); if (!r.ok) return null; const a = await r.json(); return Array.isArray(a) ? a : null; } catch (e) { return null; }
}
async function load() {
    $('stStatus').textContent = 'Loading records…';
    try {
        const L = await loadSettingLists(); setupWallets(L['Payment Account']);
        try { SY = await getSchoolYear(); } catch (e) { SY = new Date().getFullYear(); }
        const [acc, fees, books, assetEv, sec, payroll] = await Promise.all([
            ERP.db.fetchAll('accounts', 'select=*&order=date.asc,voucher_id.asc'),
            tryFetch('fees', 'select=voucher_id,admis_no,student_name,class,period,type,payable,discount'),
            tryFetch('books', 'select=*'),
            tryFetch('fixed_asset_transactions', 'select=*'),
            tryFetch('staff_security_ledger', 'select=entry_type,amount,transaction_date'),
            tryFetch('payroll', 'select=status,net_salary')
        ]);
        RAW = acc; FEES = fees || []; BOOKS = books || []; ASSET_EV = assetEv || []; ASSETS_OK = !!assetEv; SEC = sec || []; SECURITY_OK = !!sec; PAYROLL = payroll || [];
        ENT = acc.map(norm).filter(Boolean);
        $('stStatus').textContent = `${fmt(ENT.length)} account entries loaded · school year ${SY}`;
        if (!$('stFrom').value) applyPreset();
        renderAll();
    } catch (e) { console.error(e); $('stStatus').innerHTML = '<span class="st-neg">Could not load records. Check your connection and permissions, then press Refresh.</span>'; }
}

/* ---------------- shared bits ---------------- */
const kpi = (label, value, note, cls) => `<div class="st-kpi ${cls || ''}"><small>${esc(label)}</small><b>${value}</b>${note ? `<i>${esc(note)}</i>` : ''}</div>`;
function headTable(title, rows, total, totalLabel) {
    return `<div class="st-card"><h3>${esc(title)}</h3><div class="st-scroll"><table class="st"><thead><tr><th>Head</th><th class="n">Amount</th><th class="n">Share</th></tr></thead><tbody>${
        rows.length ? rows.map(([h, v]) => `<tr><td>${esc(h)}</td><td class="n">PKR ${fmt(v)}</td><td class="n">${total > 0 ? Math.round(v / total * 100) : 0}%</td></tr>`).join('') : '<tr><td colspan="3" style="color:#8793a9;text-align:center;padding:18px">No entries in this period.</td></tr>'
    }<tr class="tot"><td>${esc(totalLabel)}</td><td class="n">PKR ${fmt(total)}</td><td></td></tr></tbody></table></div></div>`;
}

/* ---------------- 1. Income & Expenditure ---------------- */
function renderIE() {
    const { from, to } = range();
    const L = ENT.filter(e => e.date >= from && e.date <= to);
    const incomeRows = L.filter(e => e.kind === 'receipt' && e.flag !== 'asset');
    const expRows = L.filter(e => e.kind === 'payment' && !['asset', 'security', 'partner'].includes(e.flag));
    const group = list => Object.entries(list.reduce((m, e) => (m[e.head] = (m[e.head] || 0) + e.amount, m), {})).sort((a, b) => b[1] - a[1]);
    const inc = group(incomeRows), exp = group(expRows);
    const tin = sumBy(incomeRows, e => e.amount), tex = sumBy(expRows, e => e.amount), surplus = tin - tex;
    const feeIn = sumBy(incomeRows.filter(e => e.flag === 'fee'), e => e.amount);
    const assetBuy = sumBy(L.filter(e => e.flag === 'asset' && e.kind === 'payment'), e => e.amount);
    const assetSell = sumBy(L.filter(e => e.flag === 'asset' && e.kind === 'receipt'), e => e.amount);
    const partner = sumBy(L.filter(e => e.flag === 'partner'), e => e.amount);
    const secRef = sumBy(L.filter(e => e.flag === 'security'), e => e.amount);
    const opening = sumBy(L.filter(e => e.kind === 'opening'), e => e.amount);
    const change = surplus + assetSell - assetBuy - partner - secRef + opening;
    const wallets = Object.keys(WALLETS);
    const openCash = wallets.reduce((s, w) => s + balanceBefore(from, w), 0), closeCash = wallets.reduce((s, w) => s + balanceTo(to === '9999-12-31' ? today() : to, w), 0);
    $('st-ie').innerHTML = `
        <div class="st-kpis">
            ${kpi('Total income', 'PKR ' + fmt(tin), `Fees: PKR ${fmt(feeIn)}`, 'good')}
            ${kpi('Total expenditure', 'PKR ' + fmt(tex), `${fmt(expRows.length)} payments`, 'bad')}
            ${kpi(surplus >= 0 ? 'Surplus' : 'Deficit', 'PKR ' + fmt(Math.abs(surplus)), tin > 0 ? `${Math.abs(Math.round(surplus / tin * 100))}% of income` : '', surplus >= 0 ? 'good' : 'bad')}
            ${kpi('Closing cash & bank', 'PKR ' + fmt(closeCash), 'All accounts together', '')}
        </div>
        <div class="st-cols">${headTable('Income (money received)', inc, tin, 'Total income')}${headTable('Expenditure (money paid)', exp, tex, 'Total expenditure')}</div>
        <div class="st-card"><h3>From surplus to cash in hand</h3><p class="st-sub">Shows exactly why your cash changed, including items that are not income or expense.</p>
            <div class="st-scroll"><table class="st"><tbody>
                <tr><td>${surplus >= 0 ? 'Surplus' : 'Deficit'} for the period</td><td class="n">${signed(surplus)}</td></tr>
                <tr><td>+ Sale of fixed assets <span class="st-note">(not income)</span></td><td class="n">PKR ${fmt(assetSell)}</td></tr>
                <tr><td>− Purchase of fixed assets <span class="st-note">(capital, not an expense)</span></td><td class="n">PKR ${fmt(assetBuy)}</td></tr>
                <tr><td>− Partner withdrawals <span class="st-note">(not an expense)</span></td><td class="n">PKR ${fmt(partner)}</td></tr>
                <tr><td>− Staff security refunded <span class="st-note">(settles a liability)</span></td><td class="n">PKR ${fmt(secRef)}</td></tr>
                <tr><td>+ Opening balances entered in the period</td><td class="n">PKR ${fmt(opening)}</td></tr>
                <tr class="tot"><td>Change in cash &amp; bank</td><td class="n">${signed(change)}</td></tr>
                <tr><td>Cash &amp; bank at start (${fmtDate(from === '0000-01-01' ? '' : from)})</td><td class="n">PKR ${fmt(openCash)}</td></tr>
                <tr class="tot"><td>Cash &amp; bank at end</td><td class="n">PKR ${fmt(closeCash)}</td></tr>
            </tbody></table></div>
            <p class="st-note" style="margin-top:10px">${Math.abs(openCash + change - closeCash) < 0.5 ? '✓ Opening cash + change equals closing cash.' : '⚠ Opening + change does not equal closing cash. Open the Books Check tab.'} Transfers between your own accounts are excluded because they only move money.</p></div>`;
    exportName = 'income-expenditure';
    exportRows = { head: ['Section', 'Head', 'Amount'], rows: [...inc.map(([h, v]) => ['Income', h, v]), ['Income', 'TOTAL', tin], ...exp.map(([h, v]) => ['Expenditure', h, v]), ['Expenditure', 'TOTAL', tex], ['Result', surplus >= 0 ? 'Surplus' : 'Deficit', surplus]] };
}

/* ---------------- 2. Financial Position ---------------- */
const feeVouchers = () => buildFeeVouchers(FEES, RAW, SY);   // shared engine (js/core/settings.js)
function renderPos() {
    const t = today(), wallets = Object.keys(WALLETS);
    const cash = wallets.map(w => [WALLETS[w].label, r2(balanceTo(t, w))]);
    const cashTotal = sumBy(cash, c => c[1]);
    let fixedNbv = 0;
    ASSET_EV.forEach(ev => { if (String(ev.event_date || '').slice(0, 10) <= t) fixedNbv += (Number(ev.cost_change) || 0) - (Number(ev.accumulated_depreciation_change) || 0); });
    fixedNbv = Math.max(0, r2(fixedNbv));
    let feeRecv = 0, feeAdv = 0;
    feeVouchers().forEach(v => {
        if (v.due && v.due <= t) { const bal = r2(v.net - v.paid); if (bal > 0) feeRecv += bal; else feeAdv += -bal; } else feeAdv += v.paid;
    });
    let dues = [];
    try { dues = computeDues(BOOKS.map(normBookRow), RAW); } catch (e) { console.error(e); }
    const recv = sumBy(dues, p => Math.max(p.recv.pending, 0)), custRefund = sumBy(dues, p => Math.max(-p.recv.pending, 0));
    const pay = sumBy(dues, p => Math.max(p.pay.pending, 0)), vendAdv = sumBy(dues, p => Math.max(-p.pay.pending, 0));
    let secPay = 0; SEC.forEach(e => { const a = Number(e.amount) || 0; secPay += e.entry_type === 'refund' ? -a : a; });
    secPay = Math.max(0, r2(secPay));
    const stockVal = BOOKS.length ? bookStockValue(BOOKS) : 0;
    const salPay = r2(PAYROLL.filter(p => String(p.status || 'Unpaid').trim() !== 'Paid').reduce((s, p) => s + (parseFloat(p.net_salary) || 0), 0));
    const assets = [['Cash & bank balances', cashTotal], ['Fees receivable (months already due)', feeRecv], ['Other customer receivables (Accounts / Book Store)', recv], ['Advances paid to vendors', vendAdv], ['Book Store stock (at average cost)', stockVal], ['Fixed assets (net book value)', fixedNbv]];
    const liabs = [['Vendor payables', pay], ['Salaries payable (saved payroll not yet paid)', salPay], ['Staff security payable', secPay], ['Fees received in advance', feeAdv], ['Customer refunds due', custRefund]];
    const TA = sumBy(assets, a => a[1]), TL = sumBy(liabs, a => a[1]), net = TA - TL;
    const rowsHtml = list => list.map(([n, v]) => `<tr><td>${esc(n)}</td><td class="n">PKR ${fmt(v)}</td></tr>`).join('');
    $('st-pos').innerHTML = `
        <div class="st-kpis">${kpi('Total assets', 'PKR ' + fmt(TA), 'What the school owns / is owed', 'good')}${kpi('Total liabilities', 'PKR ' + fmt(TL), 'What the school owes', 'bad')}${kpi('Net worth', signed(net), 'Assets − liabilities', net >= 0 ? 'good' : 'bad')}${kpi('Fees receivable', 'PKR ' + fmt(feeRecv), 'Billed up to this month, not yet received', 'warn')}</div>
        <div class="st-cols">
            <div class="st-card"><h3>Assets</h3><p class="st-sub">As of ${fmtDate(t)}</p><div class="st-scroll"><table class="st"><tbody>${rowsHtml(assets)}<tr class="tot"><td>Total assets</td><td class="n">PKR ${fmt(TA)}</td></tr></tbody></table></div>
                <p class="st-sub" style="margin-top:10px">Cash &amp; bank detail</p><table class="st"><tbody>${rowsHtml(cash)}</tbody></table></div>
            <div class="st-card"><h3>Liabilities &amp; net worth</h3><p class="st-sub">As of ${fmtDate(t)}</p><div class="st-scroll"><table class="st"><tbody>${rowsHtml(liabs)}<tr class="tot"><td>Total liabilities</td><td class="n">PKR ${fmt(TL)}</td></tr><tr class="tot"><td>Net worth (assets − liabilities)</td><td class="n">${signed(net)}</td></tr></tbody></table></div></div>
        </div>
        <div class="st-card"><h3>How to read this</h3><p class="st-note">This is a <b>position statement</b>, not an audited balance sheet, because the school records are cash-based. It always uses today's figures, whatever period is selected. <b>Stock</b> is valued at average purchase cost; <b>salaries payable</b> are payroll sheets saved as unpaid. <b>Not included:</b> prepaid expenses and other accruals${ASSETS_OK ? '' : ', and fixed assets (the asset register is not set up or not accessible)'}${SECURITY_OK ? '' : ', and staff security (ledger not available)'}.</p></div>`;
    exportName = 'financial-position';
    exportRows = { head: ['Side', 'Item', 'Amount'], rows: [...assets.map(a => ['Asset', a[0], a[1]]), ['Asset', 'TOTAL', TA], ...liabs.map(a => ['Liability', a[0], a[1]]), ['Liability', 'TOTAL', TL], ['Net worth', '', net]] };
}

/* ---------------- 3. Fees outstanding (ageing) ---------------- */
function renderAging() {
    const t = today(), q = ($('agSearch') && $('agSearch').value || '').trim().toLowerCase();
    const per = new Map();
    feeVouchers().forEach(v => {
        if (!v.due || v.due > t) return; const bal = r2(v.net - v.paid); if (bal <= 0.5) return;
        const k = v.adm || v.student; const s = per.get(k) || { adm: v.adm, student: v.student, cls: v.cls, total: 0, months: 0, oldest: v.due };
        s.total += bal; s.months++; if (v.due < s.oldest) s.oldest = v.due; per.set(k, s);
    });
    const days = d => Math.floor((new Date(t) - new Date(d)) / 864e5);
    const bucket = s => { const d = days(s.oldest); return d <= 30 ? 0 : d <= 60 ? 1 : d <= 90 ? 2 : 3; };
    const all = [...per.values()].sort((a, b) => b.total - a.total), B = [0, 0, 0, 0], C = [0, 0, 0, 0];
    all.forEach(s => { const b = bucket(s); B[b] += s.total; C[b]++; });
    const list = all.filter(s => !q || `${s.student} ${s.adm} ${s.cls}`.toLowerCase().includes(q));
    const labels = ['0–30 days', '31–60 days', '61–90 days', 'Over 90 days'], pill = ['#dcfce7;color:#15803d', '#fef9c3;color:#a16207', '#ffedd5;color:#c2410c', '#fee2e2;color:#b91c1c'];
    $('st-aging').innerHTML = `
        <div class="st-kpis">${kpi('Total outstanding', 'PKR ' + fmt(sumBy(all, s => s.total)), `${fmt(all.length)} student${all.length === 1 ? '' : 's'}`, 'bad')}${labels.map((l, i) => kpi(l, 'PKR ' + fmt(B[i]), `${fmt(C[i])} student${C[i] === 1 ? '' : 's'}`, i > 1 ? 'bad' : i === 1 ? 'warn' : 'good')).join('')}</div>
        <div class="st-card"><div style="display:flex;flex-wrap:wrap;gap:10px;justify-content:space-between;align-items:center;margin-bottom:8px"><div><h3>Students with fees outstanding</h3><p class="st-sub" style="margin:0">Only months that have already started are counted. Age = days since the oldest unpaid month began.</p></div><input id="agSearch" class="st-input no-print" placeholder="Search name, admission no, class" value="${esc(q)}"></div>
        <div class="st-scroll"><table class="st"><thead><tr><th>Student</th><th>Adm #</th><th>Class</th><th class="n">Months unpaid</th><th>Oldest unpaid</th><th>Age</th><th class="n">Outstanding</th></tr></thead><tbody>${
            list.length ? list.slice(0, 500).map(s => `<tr><td><b>${esc(s.student || '-')}</b></td><td>${esc(s.adm || '-')}</td><td>${esc(s.cls || '-')}</td><td class="n">${s.months}</td><td>${fmtDate(s.oldest)}</td><td><span class="st-pill" style="background:${pill[bucket(s)]}">${labels[bucket(s)]}</span></td><td class="n"><b>PKR ${fmt(s.total)}</b></td></tr>`).join('') : '<tr><td colspan="7" style="text-align:center;padding:22px;color:#8793a9">No outstanding fees found.</td></tr>'
        }</tbody></table></div>${list.length > 500 ? `<p class="st-note">Showing the first 500 of ${fmt(list.length)}. Export CSV for the full list.</p>` : ''}</div>`;
    const inp = $('agSearch'); if (inp) { inp.addEventListener('input', () => { const pos = inp.selectionStart; renderAging(); const n = $('agSearch'); n.focus(); n.setSelectionRange(pos, pos); }); }
    exportName = 'fees-outstanding';
    exportRows = { head: ['Student', 'Admission no', 'Class', 'Months unpaid', 'Oldest unpaid month', 'Age (days)', 'Outstanding'], rows: list.map(s => [s.student, s.adm, s.cls, s.months, s.oldest, days(s.oldest), s.total]) };
}

/* ---------------- 4. Books check ---------------- */
function renderCheck() {
    const checks = [], t = today();
    const seen = new Map(); RAW.forEach(r => { const k = String(r.voucher_id || '').trim().toUpperCase(); if (k) seen.set(k, (seen.get(k) || 0) + 1); });
    const dup = [...seen.entries()].filter(([, n]) => n > 1);
    checks.push([!dup.length, 'Duplicate voucher numbers', dup.length ? `${dup.length} voucher number(s) appear more than once, e.g. ${dup.slice(0, 3).map(d => d[0]).join(', ')}.` : 'Every voucher number is unique.']);
    const noDate = RAW.filter(r => !/^\d{4}-\d{2}-\d{2}/.test(String(r.date || ''))).length;
    checks.push([!noDate, 'Entries without a valid date', noDate ? `${noDate} entr${noDate === 1 ? 'y has' : 'ies have'} a missing or invalid date and will not appear in any period.` : 'All entries have a date.']);
    const zero = ENT.filter(e => !(e.amount > 0)).length;
    checks.push([!zero, 'Zero-amount entries', zero ? `${zero} entr${zero === 1 ? 'y has' : 'ies have'} no amount.` : 'No zero-amount entries.']);
    const negs = Object.keys(WALLETS).map(w => [WALLETS[w].label, r2(balanceTo(t, w))]).filter(x => x[1] < -0.5);
    checks.push([!negs.length, 'Negative cash or bank balance', negs.length ? negs.map(n => `${n[0]}: PKR ${fmt(n[1])}`).join(' · ') + '. Usually a missing receipt, opening balance or transfer.' : 'No account is below zero.']);
    const unk = ENT.filter(e => e.kind !== 'opening' && e.acct && !knownAccount(e.acct)).length;
    checks.push([!unk, 'Entries with an unrecognised account', unk ? `${unk} entr${unk === 1 ? 'y uses' : 'ies use'} an account name that is not in Settings → Payment Accounts. They were counted under Cash.` : 'Every entry uses a known account.']);
    const over = feeVouchers().filter(v => v.due && v.due <= t && v.paid - v.net > 0.5);
    checks.push([!over.length, 'Fee vouchers paid more than billed', over.length ? `${over.length} voucher(s) have received more than their net amount, e.g. ${over.slice(0, 3).map(v => v.id).join(', ')}. Check discounts or duplicate receipts.` : 'No over-paid fee vouchers.']);
    const delta0 = Math.abs(Object.keys(WALLETS).reduce((s, w) => s + balanceTo(t, w), 0) - ENT.filter(e => e.date <= t).reduce((s, e) => s + (e.kind === 'receipt' || e.kind === 'opening' ? e.amount : e.kind === 'payment' ? -e.amount : 0), 0));
    checks.push([delta0 < 0.5, 'Account balances agree with the daybook', delta0 < 0.5 ? 'Sum of account balances equals total receipts − payments.' : `Difference of PKR ${fmt(delta0)} found.`]);
    const bad = checks.filter(c => !c[0]).length;
    $('st-check').innerHTML = `<div class="st-kpis">${kpi('Checks passed', `${checks.length - bad} / ${checks.length}`, bad ? `${bad} need attention` : 'Everything looks consistent', bad ? 'warn' : 'good')}</div>
        <div class="st-card"><h3>Books health check</h3><p class="st-sub">Run this before printing statements or closing a month.</p>${checks.map(c => `<div class="st-chk ${c[0] ? 'ok' : 'warn'}"><div class="ic">${c[0] ? '✓' : '!'}</div><div><b>${esc(c[1])}</b><span>${esc(c[2])}</span></div></div>`).join('')}</div>`;
    exportName = 'books-check';
    exportRows = { head: ['Check', 'Result', 'Details'], rows: checks.map(c => [c[1], c[0] ? 'OK' : 'Needs attention', c[2]]) };
}

/* ---------------- tabs / export ---------------- */
function renderAll() {
    ['ie', 'pos', 'aging', 'check'].forEach(k => { $('st-' + k).hidden = k !== activeTab; });
    document.querySelectorAll('.st-tab').forEach(b => b.classList.toggle('on', b.dataset.tab === activeTab));
    ({ ie: renderIE, pos: renderPos, aging: renderAging, check: renderCheck })[activeTab]();
    const { from, to } = range(), names = { ie: 'Income & Expenditure', pos: 'Financial Position', aging: 'Fees Outstanding', check: 'Books Check' };
    $('stPrintTitle').textContent = activeTab === 'ie' ? `${names.ie}: ${fmtDate(from === '0000-01-01' ? '' : from)} to ${fmtDate(to === '9999-12-31' ? today() : to)}` : `${names[activeTab]}: as of ${fmtDate(today())}`;
}
function exportCsv() {
    if (!exportRows || !exportRows.rows.length) return;
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = '\uFEFF' + [exportRows.head, ...exportRows.rows].map(r => r.map(q).join(',')).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    a.download = `${exportName}-${today()}.csv`; document.body.appendChild(a); a.click(); a.remove();
}
document.querySelectorAll('.st-tab').forEach(b => b.addEventListener('click', () => { activeTab = b.dataset.tab; renderAll(); }));
$('stPeriod').addEventListener('change', () => { applyPreset(); renderAll(); });
['stFrom', 'stTo'].forEach(id => $(id).addEventListener('change', () => { $('stPeriod').value = 'custom'; renderAll(); }));
$('stRefresh').addEventListener('click', () => { try { sbCacheClear(); } catch (e) {} load(); });
$('stPrint').addEventListener('click', () => window.print());
$('stCsv').addEventListener('click', exportCsv);
load();
