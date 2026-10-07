// ============================================================================
//  Shared settings + helpers for every page (change the Supabase project HERE only)
// ============================================================================
const SB_URL = "https://tsnfwebctvjnmmweepiu.supabase.co";
const SB_KEY = "sb_publishable_mQcfSTQd8nca5xzbT1q6dw_aRvOHIYh";
function getSupabaseConfig() { return { url: SB_URL, key: SB_KEY }; }

// Supabase returns max 1000 rows per request. The first request also returns the total row count
// (Content-Range), then ALL remaining pages are fetched in parallel. Behaves like a fetch Response.
async function sbFetchAll(table, query) {
    query = query || 'select=*';
    const c = getSupabaseConfig(), ordKey = 'sb_ord_' + table;
    let ord = !/(^|&)order=/.test(query);
    try { if (sessionStorage.getItem(ordKey) === '0') ord = false; } catch (e) {}
    const hdr = (f, t, count) => Object.assign({ apikey: c.key, Authorization: `Bearer ${c.key}`, Range: `${f}-${t}`, 'Range-Unit': 'items' }, count ? { Prefer: 'count=exact' } : {});
    const get = (f, t, o, count) => fetch(`${c.url}/rest/v1/${table}?${query}${o ? '&order=id.asc' : ''}`, { headers: hdr(f, t, count) });
    const fail = r => ({ ok: false, status: r.status, json: async () => r.json().catch(() => ({})), text: async () => r.text().catch(() => '') });
    let r = await get(0, 999, ord, true);
    if (!r.ok && ord) { ord = false; try { sessionStorage.setItem(ordKey, '0'); } catch (e) {} r = await get(0, 999, false, true); }
    if (!r.ok) return fail(r);
    let rows = await r.json();
    if (!Array.isArray(rows)) return { ok: false, status: 200, json: async () => rows, text: async () => '' };
    const cr = r.headers.get('content-range') || '', total = cr.includes('/') ? parseInt(cr.split('/')[1], 10) : NaN, size = rows.length;
    if (size && !isNaN(total) && total > size) {
        const jobs = [];
        for (let f = size; f < total; f += size) jobs.push(get(f, f + size - 1, ord, false).then(x => x.ok ? x.json() : Promise.reject(x)));
        try { (await Promise.all(jobs)).forEach(a => { rows = rows.concat(a); }); }
        catch (x) { return fail(x && x.status ? x : { status: 500, json: async () => ({}), text: async () => '' }); }
    } else if (size && isNaN(total)) {                       // header not available: fall back to sequential paging
        for (let f = size; ; f += size) {
            const x = await get(f, f + size - 1, ord, false);
            if (!x.ok) break;
            const a = await x.json(); if (!Array.isArray(a) || !a.length) break;
            rows = rows.concat(a);
        }
    }
    return { ok: true, status: 200, json: async () => rows, text: async () => '' };
}

// Dropdown lists + rules maintained on the System Settings page (with sensible defaults)
const SETTING_DEFAULTS = {
    'Class': ['Playgroup', 'Pre-Nursery', 'Nursery', 'Prep', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'],
    'Section': ['A', 'B', 'C'],
    'Designation': ['Principal', 'Vice Principal', 'Teacher', 'Coordinator', 'Accountant', 'Clerk', 'Computer Operator', 'Driver', 'Guard', 'Peon', 'Aya / Helper'],
    'Income Head': ['Admission / Registration Fee', 'Annual Fund', 'Book Store Sale', 'Uniform / Stationery Sale', 'Transport Fee', 'Donation', 'Other Income'],
    'Expense Head': ['Salaries', 'Utility Bills', 'Rent', 'Stationery', 'Repair & Maintenance', 'Fuel / Transport', 'Events / Functions', 'Books Purchase', 'Printing', 'Internet / Phone', 'Refreshments', 'Misc Expense'],
    'Book Vendor': [],
    'Book Category': ['Books', 'Notebooks', 'Study Planner', 'Lamination Paper']
};
let _settingLists = null;
async function loadSettingLists() {
    if (_settingLists) return _settingLists;
    try { const c = JSON.parse(sessionStorage.getItem('sb_settings_v2') || 'null'); if (c && Date.now() - c.t < 120000) { _settingLists = c.d; return c.d; } } catch (e) {}
    const out = { rules: {} };
    Object.keys(SETTING_DEFAULTS).forEach(k => out[k] = [...SETTING_DEFAULTS[k]]);
    try {
        const rows = await (await sbFetchAll('settings', 'select=setting_key,setting_value')).json();
        if (Array.isArray(rows)) {
            const by = {};
            const canon = k => String(k || '').toLowerCase().replace(/[^a-z]/g, '').replace(/s$/, '');
            const ALIAS = { 'Book Vendor': ['bookvendor', 'vendor', 'booksupplier', 'supplier'], 'Income Head': ['incomehead', 'income'], 'Expense Head': ['expensehead', 'expense'], 'Designation': ['designation'], 'Class': ['class'], 'Section': ['section'], 'Book Category': ['bookcategory', 'category'] };
            const keyOf = raw => { const cn = canon(raw); for (const d of Object.keys(ALIAS)) if (ALIAS[d].includes(cn) || canon(d) === cn) return d; return String(raw || '').trim(); };
            rows.forEach(x => { const k = keyOf(x.setting_key), v = String(x.setting_value ?? '').trim(); if (k && v !== '') (by[k] = by[k] || []).push(v); });
            Object.keys(SETTING_DEFAULTS).forEach(k => { if (by[k] && by[k].length) out[k] = by[k]; });
            ['Payroll Working Days', 'Payroll Free Leaves', 'Low Stock Limit'].forEach(k => { if (by[k]) out.rules[k] = by[k][0]; });
        }
    } catch (e) { console.error('Settings lists', e); }
    // rules saved on the Settings page also drive the Staff / Book Store pages
    try {
        if (out.rules['Payroll Working Days'] !== undefined) localStorage.setItem('payroll_days', out.rules['Payroll Working Days']);
        if (out.rules['Payroll Free Leaves'] !== undefined) localStorage.setItem('payroll_free', out.rules['Payroll Free Leaves']);
        if (out.rules['Low Stock Limit'] !== undefined) localStorage.setItem('books_low_stock', out.rules['Low Stock Limit']);
    } catch (e) {}
    _settingLists = out;
    try { sessionStorage.setItem('sb_settings_v2', JSON.stringify({ t: Date.now(), d: out })); } catch (e) {}
    return out;
}

// ============================================================================
//  Book Store dues (what students owe / what is owed to vendors) - shared by
//  the Book Store, Accounts and Dashboard pages.
//  Credit entry  = a sale / purchase that was NOT recorded in Accounts (voucher BK-...).
//  Settlement    = an Accounts receipt (RV-, head "Book Store Sale") or payment (PV-, head "Books Purchase")
//                  whose particulars equal the party name. Settlements clear the oldest entries first (FIFO).
// ============================================================================
const BOOK_SALE_HEAD = 'Book Store Sale', BOOK_BUY_HEAD = 'Books Purchase';
const partyKey = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
function normBookRow(row) {
    const t = String(row.type ?? row.tx_type ?? '').trim().toLowerCase();
    const kind = t.includes('return') ? (t.includes('sale') ? 'sale_return' : 'purchase_return') : (t.includes('sale') ? 'sale' : 'purchase');
    return { kind, party: String(row.party_name ?? row.party ?? '').trim(), net: parseFloat(row.net_amount ?? row.amount) || 0, voucher: String(row.voucher_no ?? '').trim(),
        notes: String(row.notes ?? '').trim(), date: String(row.date ?? '').slice(0, 10), title: String(row.book ?? row.book_title ?? row.title ?? '').trim(), qty: parseFloat(row.qty) || 0 };
}
function computeDues(txs, accRows, opts) {
    opts = opts || {};
    const P = {}, bills = {}, rows = accRows || [];
    const get = name => { const k = partyKey(name); return P[k] || (P[k] = { key: k, name: String(name).trim(), recvE: [], payE: [], recvS: [], payS: [] }); };
    (txs || []).forEach(t => {                                   // Book Store sales / purchases that were NOT recorded in Accounts
        if (!t.party) return;
        const v = String(t.voucher || '').toUpperCase();
        if (!v || v.startsWith('RV-') || v.startsWith('PV-') || v.startsWith('BK-IMP') || /^imported/i.test(t.notes || '')) return;
        const p = get(t.party);
        if (t.kind === 'sale' || t.kind === 'purchase') {
            const e = { date: t.date, amt: t.net, voucher: t.voucher, title: t.title, qty: t.qty, src: 'book', paid: 0, pk: p.key, side: t.kind === 'sale' ? 'recv' : 'pay' };
            (t.kind === 'sale' ? p.recvE : p.payE).push(e); bills[v] = e;
        } else if (t.kind === 'sale_return') p.recvS.push({ date: t.date, amt: t.net, voucher: t.voucher, label: 'Sale return', pool: true });
        else if (t.kind === 'purchase_return') p.payS.push({ date: t.date, amt: t.net, voucher: t.voucher, label: 'Purchase return', pool: true });
    });
    if (!opts.bookOnly) rows.forEach(r => {                      // bills raised (AR-) / received (AP-) in Accounts
        const v = String(r.voucher_id || '').trim().toUpperCase(), m = v.match(/^(AR|AP)-\d+$/);
        if (!m || !r.description) return;
        const recv = m[1] === 'AR', amt = parseFloat(recv ? r.amount_in : r.amount_out) || 0;
        if (amt <= 0) return;
        const p = get(r.description), e = { date: String(r.date || '').slice(0, 10), amt, voucher: v, title: String(r.remarks || '').trim(), qty: 0, src: 'acct', paid: 0, pk: p.key, side: recv ? 'recv' : 'pay' };
        (recv ? p.recvE : p.payE).push(e); bills[v] = e;
    });
    rows.forEach(r => {                                          // settlements: they carry the bill voucher (BK-123456-xxxx)
        const vid = String(r.voucher_id || '').trim(), up = vid.toUpperCase(), d = String(r.date || '').slice(0, 10);
        const inA = parseFloat(r.amount_in) || 0, outA = parseFloat(r.amount_out) || 0, ref = up.match(/^((?:AR|AP|BK)-\d+)-/);
        if (ref) {
            const b = bills[ref[1]]; if (!b) return;
            const amt = b.side === 'recv' ? inA : outA; if (amt <= 0) return;
            b.paid += amt;
            P[b.pk][b.side === 'recv' ? 'recvS' : 'payS'].push({ date: d, amt, voucher: vid, bill: b.voucher, label: b.side === 'recv' ? 'Receipt' : 'Payment' });
            return;
        }
        const p = P[partyKey(r.description)]; if (!p) return;     // older receipts / payments matched by party name
        if (up.startsWith('RV-') && partyKey(r.from_account) === partyKey(BOOK_SALE_HEAD) && inA > 0) p.recvS.push({ date: d, amt: inA, voucher: vid, label: 'Receipt', pool: true });
        else if (up.startsWith('PV-') && partyKey(r.to_account) === partyKey(BOOK_BUY_HEAD) && outA > 0) p.payS.push({ date: d, amt: outA, voucher: vid, label: 'Payment', pool: true });
    });
    const byDate = (a, b) => (a.date || '').localeCompare(b.date || '') || String(a.voucher).localeCompare(String(b.voucher));
    const r2 = n => Math.round(n * 100) / 100;
    const side = (E, S) => {
        E.sort(byDate); S.sort(byDate);
        let pool = S.filter(x => x.pool).reduce((t, x) => t + x.amt, 0);
        E.forEach(e => { const rem0 = Math.max(0, e.amt - e.paid), use = Math.min(pool, rem0); pool -= use; e.rem = r2(rem0 - use); e.paid = r2(e.amt - e.rem); });
        const total = E.reduce((t, e) => t + e.amt, 0), settled = S.reduce((t, x) => t + x.amt, 0);
        return { total: r2(total), settled: r2(settled), pending: r2(total - settled) };
    };
    return Object.values(P).filter(p => p.recvE.length || p.payE.length).map(p => {
        p.recv = side(p.recvE, p.recvS); p.pay = side(p.payE, p.payS);
        p.last = [...p.recvE, ...p.payE, ...p.recvS, ...p.payS].reduce((m, x) => ((x.date || '') > m ? x.date : m), '');
        return p;
    });
}
const computeBookDues = (txs, accRows) => computeDues(txs, accRows, { bookOnly: true });
// latest promise-to-pay per party, stored in the settings table (key "Book Promise")
function parsePromises(rows) {
    const out = {};
    (rows || []).forEach(x => { try { const o = JSON.parse(x.setting_value); if (o && o.k && (!out[o.k] || (o.ts || 0) >= (out[o.k].ts || 0))) out[o.k] = o; } catch (e) {} });
    Object.keys(out).forEach(k => { if (!out[k].d) delete out[k]; });
    return out;
}

// ============================================================================
//  One voucher can hold several fee rows (the admission voucher: registration + admission + annual fund + tuition).
//  The payments of a voucher are shared by its rows and clear them in this order.
// ============================================================================
const FEE_ORDER = ['arrears', 'registration fee', 'admission fee', 'annual fund', 'tuition fee'];
const feeRank = t => { const i = FEE_ORDER.indexOf(String(t || '').trim().toLowerCase()); return i < 0 ? 9 : i; };
// returns the paid amount of every row (same order as rows); paidOf(row) is the TOTAL paid of the row's voucher
function splitVoucherPaid(rows, netOf, paidOf, typeOf, vidOf) {
    const groups = {};
    rows.forEach((r, i) => { const v = String(vidOf(r) || '').trim(); (groups[v] = groups[v] || []).push(i); });
    const out = new Array(rows.length).fill(0);
    Object.keys(groups).forEach(v => {
        const idx = groups[v], total = paidOf(rows[idx[0]]) || 0;
        if (idx.length === 1) { out[idx[0]] = total; return; }
        let left = total;
        const ord = idx.slice().sort((a, b) => feeRank(typeOf(rows[a])) - feeRank(typeOf(rows[b])) || a - b);
        ord.forEach((i, k) => { const use = k === ord.length - 1 ? left : Math.max(0, Math.min(left, netOf(rows[i]))); out[i] = Math.round(use * 100) / 100; left -= use; });
    });
    return out;
}
