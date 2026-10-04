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
function computeBookDues(txs, accRows) {
    const P = {};
    const get = name => { const k = partyKey(name); return P[k] || (P[k] = { key: k, name: String(name).trim(), recvE: [], payE: [], recvS: [], payS: [] }); };
    (txs || []).forEach(t => {
        if (!t.party) return;
        const v = String(t.voucher || '').toUpperCase();
        if (!v || v.startsWith('RV-') || v.startsWith('PV-') || v.startsWith('BK-IMP') || /^imported/i.test(t.notes || '')) return;   // paid at once / opening stock
        const p = get(t.party), e = { date: t.date, amt: t.net, voucher: t.voucher, title: t.title, qty: t.qty };
        if (t.kind === 'sale') p.recvE.push(e);
        else if (t.kind === 'purchase') p.payE.push(e);
        else if (t.kind === 'sale_return') p.recvS.push({ date: t.date, amt: t.net, voucher: t.voucher, label: 'Sale return' });
        else if (t.kind === 'purchase_return') p.payS.push({ date: t.date, amt: t.net, voucher: t.voucher, label: 'Purchase return' });
    });
    (accRows || []).forEach(r => {
        const p = P[partyKey(r.description)]; if (!p) return;
        const v = String(r.voucher_id || '').toUpperCase(), d = String(r.date || '').slice(0, 10), inA = parseFloat(r.amount_in) || 0, outA = parseFloat(r.amount_out) || 0;
        if (v.startsWith('RV-') && partyKey(r.from_account) === partyKey(BOOK_SALE_HEAD) && inA > 0) p.recvS.push({ date: d, amt: inA, voucher: r.voucher_id, label: 'Receipt' });
        else if (v.startsWith('PV-') && partyKey(r.to_account) === partyKey(BOOK_BUY_HEAD) && outA > 0) p.payS.push({ date: d, amt: outA, voucher: r.voucher_id, label: 'Payment' });
    });
    const byDate = (a, b) => (a.date || '').localeCompare(b.date || '') || String(a.voucher).localeCompare(String(b.voucher));
    const fifo = (E, S) => {
        E.sort(byDate); S.sort(byDate);
        const settled = S.reduce((s, x) => s + x.amt, 0), total = E.reduce((s, x) => s + x.amt, 0); let pool = settled;
        E.forEach(e => { const use = Math.min(pool, e.amt); e.paid = Math.round(use * 100) / 100; e.rem = Math.round((e.amt - use) * 100) / 100; pool -= use; });
        return { total: Math.round(total * 100) / 100, settled: Math.round(settled * 100) / 100, pending: Math.round((total - settled) * 100) / 100 };
    };
    return Object.values(P).filter(p => p.recvE.length || p.payE.length).map(p => {
        p.recv = fifo(p.recvE, p.recvS); p.pay = fifo(p.payE, p.payS);
        p.last = [...p.recvE, ...p.payE, ...p.recvS, ...p.payS].reduce((m, x) => ((x.date || '') > m ? x.date : m), '');
        return p;
    });
}
// latest promise-to-pay per party, stored in the settings table (key "Book Promise")
function parsePromises(rows) {
    const out = {};
    (rows || []).forEach(x => { try { const o = JSON.parse(x.setting_value); if (o && o.k && (!out[o.k] || (o.ts || 0) >= (out[o.k].ts || 0))) out[o.k] = o; } catch (e) {} });
    Object.keys(out).forEach(k => { if (!out[k].d) delete out[k]; });
    return out;
}
