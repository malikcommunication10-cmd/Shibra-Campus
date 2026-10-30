let _settingLists = null, _settingListsRevision = '';
async function loadSettingLists() {
    const revision = sbDataRevision('settings');
    if (_settingLists && _settingListsRevision === revision) return _settingLists;
    try {
        const c = JSON.parse(sessionStorage.getItem('sb_settings_v3') || 'null');
        if (c && c.r === revision && Date.now() - c.t < 120000) {
            _settingLists = c.d; _settingListsRevision = revision; return c.d;
        }
    } catch (e) {}
    const out = { rules: { 'School Year': String(new Date().getFullYear()) } };
    Object.keys(SETTING_DEFAULTS).forEach(k => out[k] = [...SETTING_DEFAULTS[k]]);
    try {
        const rows = await (await sbFetchAll('settings', 'select=setting_key,setting_value')).json();
        if (Array.isArray(rows)) {
            const by = {};
            const canon = k => String(k || '').toLowerCase().replace(/[^a-z]/g, '').replace(/s$/, '');
            const ALIAS = { 'Book Vendor': ['bookvendor', 'vendor', 'booksupplier', 'supplier'], 'Income Head': ['incomehead', 'income'], 'Expense Head': ['expensehead', 'expense'], 'Designation': ['designation'], 'Class': ['class'], 'Section': ['section'], 'Book Category': ['bookcategory', 'category'], 'Payment Account': ['paymentaccount', 'paymentmode', 'paymentaccounts'], 'Business Partner': ['businesspartner', 'partner', 'partners'] };
            const keyOf = raw => { const cn = canon(raw); for (const d of Object.keys(ALIAS)) if (ALIAS[d].includes(cn) || canon(d) === cn) return d; return String(raw || '').trim(); };
            rows.forEach(x => { const k = keyOf(x.setting_key), v = String(x.setting_value ?? '').trim(); if (k && v !== '') (by[k] = by[k] || []).push(v); });
            Object.keys(SETTING_DEFAULTS).forEach(k => { if (by[k] && by[k].length) out[k] = by[k]; });
            ['Payroll Working Days', 'Payroll Free Leaves', 'Low Stock Limit', 'School Year'].forEach(k => { if (by[k]) out.rules[k] = by[k][0]; });
        }
    } catch (e) { console.error('Settings lists', e); }
    // rules saved on the Settings page also drive the Staff / Book Store pages
    try {
        if (out.rules['Low Stock Limit'] !== undefined) localStorage.setItem('books_low_stock', out.rules['Low Stock Limit']);
    } catch (e) {}
    _settingLists = out;
    _settingListsRevision = revision;
    try { sessionStorage.setItem('sb_settings_v3', JSON.stringify({ t: Date.now(), r: revision, d: out })); } catch (e) {}
    return out;
}
async function getSchoolYear() {
    const lists = await loadSettingLists();
    const year = Number(lists.rules['School Year']);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
        throw new Error('School Year in System Settings must be a year from 2000 to 2100.');
    }
    return year;
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
function normalizeBookParty(value) {
    const party = String(value || '').trim().replace(/\s+/g, ' ');
    if(!/^purchase\s*:/i.test(party)) return party;
    const detail = party.replace(/^purchase\s*:\s*/i, '').trim();
    const vendors = (typeof _settingLists !== 'undefined' && _settingLists && _settingLists['Book Vendor']) || [];
    const configuredVendor = vendors.slice().sort((a, b) => String(b).length - String(a).length)
        .find(vendor => detail.toLowerCase().endsWith(` - ${String(vendor).trim().toLowerCase()}`));
    const separator = detail.lastIndexOf(' - ');
    return configuredVendor || (separator >= 0 ? detail.slice(separator + 3).trim() : detail);
}
// One place that decides which party a Book Store row belongs to (used by Books AND Accounts, so ledgers agree)
function bookPartyFromRow(row) {
    const rawParty = row.party_name ?? row.party ?? row.vendor ?? '';
    const alternateParty = String(row.party ?? row.vendor ?? '').trim();
    return normalizeBookParty(/^purchase\s*:/i.test(String(rawParty)) && alternateParty && !/^purchase\s*:/i.test(alternateParty)
        ? alternateParty
        : rawParty);
}
function normBookRow(row) {
    const t = String(row.type ?? row.tx_type ?? '').trim().toLowerCase();
    const kind = t.includes('return') ? (t.includes('sale') ? 'sale_return' : 'purchase_return') : (t.includes('sale') ? 'sale' : 'purchase');
    return { kind, party: bookPartyFromRow(row), net: parseFloat(row.net_amount ?? row.amount) || 0, voucher: String(row.voucher_no ?? '').trim(),
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
        const p = get(normalizeBookParty(r.description)), e = { date: String(r.date || '').slice(0, 10), amt, voucher: v, title: String(r.remarks || '').trim(), qty: 0, src: 'acct', paid: 0, pk: p.key, side: recv ? 'recv' : 'pay' };
        (recv ? p.recvE : p.payE).push(e); bills[v] = e;
    });
    rows.forEach(r => {                                          // settlements: they carry the bill voucher (BK-123456-xxxx)
        const vid = String(r.voucher_id || '').trim(), up = vid.toUpperCase(), d = String(r.date || '').slice(0, 10);
        const inA = parseFloat(r.amount_in) || 0, outA = parseFloat(r.amount_out) || 0, ref = up.match(/^((?:AR|AP|BK)-\d+)-/);
        if (ref) {
            const b = bills[ref[1]]; if (!b) return;
            const amt = b.side === 'recv' ? inA : outA; if (amt <= 0) return;
            b.paid += amt;
            P[b.pk][b.side === 'recv' ? 'recvS' : 'payS'].push({ date: d, amt, voucher: vid, bill: b.voucher, account: r.from_account, label: b.side === 'recv' ? 'Receipt' : 'Payment' });
            return;
        }
        if (up.startsWith('RV-') && partyKey(r.from_account) === partyKey(BOOK_SALE_HEAD) && inA > 0) {
            get(normalizeBookParty(r.description)).recvS.push({ date: d, amt: inA, voucher: vid, label: 'Receipt', pool: true });
        } else if (up.startsWith('PV-') && partyKey(r.to_account) === partyKey(BOOK_BUY_HEAD) && outA > 0) {
            get(normalizeBookParty(r.description)).payS.push({ date: d, amt: outA, voucher: vid, account: r.from_account, label: 'Payment', pool: true });
        }
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
    return Object.values(P).filter(p => p.recvE.length || p.payE.length || p.recvS.length || p.payS.length).map(p => {
        p.recv = side(p.recvE, p.recvS); p.pay = side(p.payE, p.payS);
        p.last = [...p.recvE, ...p.payE, ...p.recvS, ...p.payS].reduce((m, x) => ((x.date || '') > m ? x.date : m), '');
        return p;
    });
}
// NOTE: computeBookDues ignores AR-/AP- bills raised in Accounts. Books and Accounts ledgers must use computeDues() so figures match.
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
// when the rows were created (columns tried in this order: seq, created_at, id); rows without any keep the loaded order
const rowOrder = r => { if (r.seq != null && isFinite(Number(r.seq))) return Number(r.seq); if (r.created_at) { const t = Date.parse(r.created_at); if (!isNaN(t)) return t; } const n = Number(r.id); return isFinite(n) && r.id !== '' && r.id != null ? n : 0; };
// returns the paid amount of every row (same order as rows); paidOf(row) is the TOTAL paid of the row's voucher.
// The payments of a voucher clear its rows OLDEST FIRST (orderOf), e.g. January tuition before an annual fund added later.
function splitVoucherPaid(rows, netOf, paidOf, typeOf, vidOf, orderOf) {
    const groups = {};
    rows.forEach((r, i) => { const v = String(vidOf(r) || '').trim(); (groups[v] = groups[v] || []).push(i); });
    const out = new Array(rows.length).fill(0);
    Object.keys(groups).forEach(v => {
        const idx = groups[v], total = paidOf(rows[idx[0]]) || 0;
        if (idx.length === 1) { out[idx[0]] = total; return; }
        let left = total;
        const key = i => orderOf ? orderOf(rows[i]) : feeRank(typeOf(rows[i]));
        const ord = idx.slice().sort((a, b) => key(a) - key(b) || a - b);
        ord.forEach((i, k) => { const use = k === ord.length - 1 ? left : Math.max(0, Math.min(left, netOf(rows[i]))); out[i] = Math.round(use * 100) / 100; left -= use; });
    });
    return out;
}

// ============================================================================
//  Payment accounts (Settings -> "Payment accounts"): Cash is always there; banks and wallets are added in Settings,
//  e.g. "ABL 0021252355" or "Online / JazzCash". The chosen text is what gets saved in Accounts.
// ============================================================================
function payBaseKey(t) {
    const s = String(t || '').trim().toLowerCase();
    if (s === 'cash' || s === 'cash in hand') return 'cash';
    if (s === 'bank') return 'bank';
    if (/^online(\s*\/\s*jazz\s*cash)?$/.test(s)) return 'online';
    return null;
}
const payEsc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
function payAccountList(items) {
    const out = [{ value: 'cash', label: '💵 Cash in Hand' }], seen = new Set(['cash']);
    const src = (items && items.length) ? items : ['Bank', 'Online / JazzCash'];      // nothing in Settings yet: the old Cash / Bank / Online
    src.forEach(raw => {
        const t = String(raw || '').trim(); if (!t) return;
        const b = payBaseKey(t), value = b || t, k = value.toLowerCase();
        if (seen.has(k)) return; seen.add(k);
        out.push({ value, label: b === 'bank' ? '🏦 Bank' : b === 'online' ? '📱 Online / JazzCash' : (/online|jazz|easy|raast|wallet/i.test(t) ? '📱 ' : '🏦 ') + t });
    });
    return out;
}
const payOptionsHtml = (list, sel) => list.map(o => `<option value="${payEsc(o.value)}"${o.value === sel ? ' selected' : ''}>${payEsc(o.label)}</option>`).join('');
async function fillPaySelects(ids) {          // fills the <select>s and keeps whatever is already chosen
    const L = await loadSettingLists(), list = payAccountList(L['Payment Account']);
    ids.forEach(id => { const el = document.getElementById(id); if (!el) return; const cur = el.value; el.innerHTML = payOptionsHtml(list); if (cur && [...el.options].some(o => o.value === cur)) el.value = cur; });
    return list;
}


// ====================================================================================
// FEE VOUCHER POSITION – single source of truth (Students, Statements, ... use this)
// fees: rows from `fees`; accRows: rows from `accounts` (only V-* receipts are read); returns one object per voucher
// ====================================================================================
function buildFeeVouchers(fees, accRows, schoolYear) {
    const paid = {};
    (accRows || []).forEach(r => {
        const id = String(r.voucher_id || '').trim(); if (!/^V-\d+/i.test(id)) return;
        const k = id.split('-').slice(0, 2).join('-'); paid[k] = (paid[k] || 0) + (parseFloat(r.amount_in) || 0);
    });
    const names = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'], map = new Map();
    (fees || []).forEach(f => {
        const id = String(f.voucher_id || '').trim(); if (!id) return;
        const g = map.get(id) || { id, adm: String(f.admis_no || '').trim(), student: f.student_name || '', cls: f.class || '', period: f.period || '', net: 0, due: '' };
        g.net += (parseFloat(f.payable) || 0) - (parseFloat(f.discount) || 0);
        if (!g.due) {
            const t = String(f.period || '').toLowerCase(), m = names.findIndex(n => t.includes(n)), y = (t.match(/(20\d\d)/) || [])[1] || String(schoolYear);
            if (m >= 0) g.due = `${y}-${String(m + 1).padStart(2, '0')}-01`;
        }
        map.set(id, g);
    });
    return [...map.values()].map(g => Object.assign(g, { paid: Math.round((paid[g.id] || 0) * 100) / 100 }));
}


// Book Store stock valued at average purchase cost (same method as the Book Store inventory screen)
function bookStockValue(rows) {
    const items = {};
    (rows || []).forEach(row => {
        const t = String(row.type ?? row.tx_type ?? '').trim().toLowerCase();
        const kind = t.includes('return') ? (t.includes('sale') ? 'sale_return' : 'purchase_return') : (t.includes('sale') ? 'sale' : 'purchase');
        const title = String(row.book_title || row.title || row.book || '').trim().replace(/\s+/g, ' ').toLowerCase(); if (!title) return;
        const qty = parseFloat(row.qty) || 0, net = parseFloat(row.net_amount ?? row.amount) || 0;
        const it = items[title] || (items[title] = { p: 0, pr: 0, s: 0, sr: 0, pAmt: 0, prAmt: 0 });
        if (kind === 'purchase') { it.p += qty; it.pAmt += net; } else if (kind === 'purchase_return') { it.pr += qty; it.prAmt += net; }
        else if (kind === 'sale') it.s += qty; else it.sr += qty;
    });
    return Math.round(Object.values(items).reduce((sum, it) => {
        const stock = it.p - it.pr - it.s + it.sr, netQty = it.p - it.pr;
        return sum + Math.max(stock, 0) * (netQty > 0 ? Math.max(0, (it.pAmt - it.prAmt) / netQty) : 0);
    }, 0) * 100) / 100;
}
