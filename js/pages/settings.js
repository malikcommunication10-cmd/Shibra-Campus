// ====================================================================================
//  CONFIG
// ====================================================================================
const CLASS_RANKS = [['playgroup','pg'],['pre-nursery','pre nursery','prenursery'],['nursery'],['kg','kg1','kg-1'],['prep','preparatory','kg2','kg-2'],['one','1','i','class 1'],['two','2','ii','class 2'],['three','3','iii','class 3'],['four','4','iv','class 4'],['five','5','v','class 5'],['six','6','vi','class 6'],['seven','7','vii','class 7'],['eight','8','viii','class 8'],['nine','9','ix','class 9'],['ten','10','x','class 10'],['eleven','11','xi'],['twelve','12','xii']];
const classRank = v => { let s = String(v).trim().toLowerCase(); let i = CLASS_RANKS.findIndex(g => g.includes(s)); return i < 0 ? 999 : i; };

// 'key' is stored in settings.setting_key — the old settings page used 'Class', so it stays compatible.
const CATEGORIES = [
    { key: 'Class', title: 'Classes', icon: '🏫', used: 'Students · Fees · Follow-ups', add: 'Add a class (e.g. Six)', sort: 'class',
      defaults: ['Playgroup', 'Pre-Nursery', 'Nursery', 'Prep', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'], usage: 'students' },
    { key: 'Section', title: 'Sections', icon: '🔤', used: 'Students', add: 'Add a section (e.g. A)', defaults: ['A', 'B', 'C'] },
    { key: 'Designation', title: 'Staff designations', icon: '👩‍🏫', used: 'Staff & Payroll', add: 'Add a designation (e.g. Teacher)',
      defaults: ['Principal', 'Vice Principal', 'Teacher', 'Coordinator', 'Accountant', 'Clerk', 'Computer Operator', 'Driver', 'Guard', 'Peon', 'Aya / Helper'], usage: 'staff' },
    { key: 'Income Head', title: 'Income heads', icon: '📈', used: 'Accounts & Daybook (receipts)', add: 'Add an income head',
      defaults: ['Admission / Registration Fee', 'Annual Fund', 'Book Store Sale', 'Uniform / Stationery Sale', 'Transport Fee', 'Donation', 'Other Income'], usage: 'income' },
    { key: 'Expense Head', title: 'Expense heads', icon: '📉', used: 'Accounts & Daybook (payments)', add: 'Add an expense head',
      defaults: ['Salaries', 'Utility Bills', 'Rent', 'Stationery', 'Repair & Maintenance', 'Fuel / Transport', 'Events / Functions', 'Books Purchase', 'Printing', 'Internet / Phone', 'Refreshments', 'Misc Expense'], usage: 'expense' },
    { key: 'Book Category', title: 'Book Store categories', icon: '📓', used: 'Book Store (items & import)', add: 'Add a category (e.g. Notebooks)', defaults: ['Books', 'Notebooks', 'Study Planner', 'Lamination Paper'] },
    { key: 'Payment Account', title: 'Payment accounts (banks / online)', icon: '🏦', used: 'Fee receipts, Payments, Accounts, Book Store, Payroll (Cash is always available)', add: 'Add an account, e.g. ABL 0021252355', defaults: ['Bank', 'Online / JazzCash'] },
    { key: 'Business Partner', title: 'Business partners', icon: '🤝', used: 'Accounts (partner withdrawals)', add: 'Add a partner name', defaults: [], usage: 'partner' },
    { key: 'Book Vendor', title: 'Book vendors / suppliers', icon: '📚', used: 'Book Store (purchases)', add: 'Add a vendor name', defaults: [], usage: 'vendor' }
];
const RULE_KEYS = ['Payroll Working Days', 'Payroll Free Leaves', 'Low Stock Limit', 'School Year'];
const HEALTH_TABLES = [
    { name: 'students',   label: 'Students',        hint: '' },
    { name: 'fees',       label: 'Fee vouchers',    hint: '' },
    { name: 'accounts',   label: 'Accounts',        hint: '' },
    { name: 'increments', label: 'Increments',      hint: '' },
    { name: 'books',      label: 'Book store',      hint: '' },
    { name: 'staff',      label: 'Staff',           hint: '' },
    { name: 'settings',   label: 'Settings',        hint: '' },
    { name: 'payroll',    label: 'Monthly payroll', hint: 'Optional — run the SQL shown on the Staff & Payroll page.', optional: true },
    { name: 'call_logs',  label: 'Follow-up calls', hint: 'Optional — run the SQL shown on the Follow-up Calls page.', optional: true }
];

// ====================================================================================
//  STATE + HELPERS
// ====================================================================================
let rows = [];            // raw settings rows {setting_key, setting_value}
let usage = {};           // usage[categoryKey][normValue] = count
let renameCtx = null;

const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const js = v => esc(JSON.stringify(v));
function showLoading(t) { $('loadingText').innerText = t || 'Loading...'; $('loadingOverlay').classList.remove('hidden'); }
function hideLoading() { $('loadingOverlay').classList.add('hidden'); }
function toast(msg, ok) { UI.toast(msg, ok !== false); }
function confirmBox(message, okLabel, onOk) { UI.confirm(message, { ok: okLabel || undefined }).then(v => { if (v) onOk(); }); }

function sbHeaders(extra = {}) { let c = getSupabaseConfig(); return { "apikey": c.key, "Authorization": `Bearer ${c.key}`, ...extra }; }
const JSON_H = { "Content-Type": "application/json" };
const enc = encodeURIComponent;

async function fetchAll(table, select = '*') {
    const response = await ERP.db.request(table, `select=${select}`);
    if(!response.ok) throw new Error(`${table}: ${response.status} ${await response.text()}`);
    const data = await response.json();
    if(!Array.isArray(data)) throw new Error(`${table}: unexpected response`);
    return data;
}

// ====================================================================================
//  LOAD
// ====================================================================================
async function initSettings() {
    showLoading('Loading settings...');
    try {
        rows = (await fetchAll('settings')).map(r => ({ key: String(r.setting_key || '').trim(), val: String(r.setting_value ?? '').trim() })).filter(r => r.key && r.val !== '');
        renderLists(); renderRules();
        hideLoading();
        loadUsage();                                                 // badges fill in afterwards
    } catch (e) {
        console.error(e); hideLoading();
        toast('Could not load settings. Check the connection tab.', false);
        showTab('connection');
    }
    if(location.hash === '#rules') showTab('rules');
}

async function loadUsage() {
    usage = {};
    const bump = (k, v) => { v = norm(v); if(!v) return; (usage[k] = usage[k] || {})[v] = ((usage[k] || {})[v] || 0) + 1; };
    const safe = async (table, select) => { try { return await fetchAll(table, select); } catch (e) { return []; } };
    let [students, staff, accounts, books] = await Promise.all([safe('students', 'class'), safe('staff', 'designation'), safe('accounts', 'from_account,to_account,voucher_id,description'), safe('books', 'party_name,type')]);
    students.forEach(r => bump('students', r.class));
    staff.forEach(r => bump('staff', r.designation));
    accounts.forEach(r => { bump('income', r.from_account); bump('expense', r.to_account); if(String(r.voucher_id || '').startsWith('PD-')) bump('partner', r.description); });
    books.forEach(r => { if(/purchase/i.test(r.type || '')) bump('vendor', r.party_name); });
    renderLists();
}

// ====================================================================================
//  TABS
// ====================================================================================
function showTab(t) {
    ['lists', 'rules', 'connection'].forEach(x => $('tab-' + x).classList.toggle('hidden', x !== t));
    document.querySelectorAll('.tabbtn').forEach(b => { b.classList.toggle('tab-on', b.dataset.tab === t); b.classList.toggle('tab-off', b.dataset.tab !== t); });
    window.scrollTo({ top: 0 });
}

// ====================================================================================
//  MASTER LISTS
// ====================================================================================
function itemsOf(cat) {
    let k = norm(cat.key), seen = new Set(), list = [];
    rows.filter(r => norm(r.key) === k).forEach(r => { let n = norm(r.val); if(!seen.has(n)) { seen.add(n); list.push({ raw: r.val, rawKey: r.key }); } });
    if(cat.sort === 'class') list.sort((a, b) => classRank(a.raw) - classRank(b.raw) || a.raw.localeCompare(b.raw, undefined, { numeric: true }));
    else list.sort((a, b) => a.raw.localeCompare(b.raw, undefined, { numeric: true }));
    return list;
}
function useCount(cat, value) { return cat.usage && usage[cat.usage] ? (usage[cat.usage][norm(value)] || 0) : null; }

function renderLists() {
    let q = norm($('listSearch').value);
    $('listGrid').innerHTML = CATEGORIES.map((cat, idx) => {
        let all = itemsOf(cat), list = q ? all.filter(i => norm(i.raw).includes(q) || norm(cat.title).includes(q)) : all;
        let missing = cat.defaults.filter(d => !all.some(i => norm(i.raw) === norm(d))).length;
        let chips = list.length ? list.map(i => {
            let n = useCount(cat, i.raw);
            return `<span class="inline-flex items-center gap-1.5 bg-indigo-50 text-indigo-900 border border-indigo-100 rounded-lg pl-2.5 pr-1 py-1 text-sm">
                <b class="font-semibold">${esc(i.raw)}</b>${n ? `<span class="text-[11px] text-indigo-500" title="Records using this value">${n}</span>` : ''}
                <button onclick="openRename(${idx}, ${js(i.raw)})" class="px-1 hover:bg-white rounded" title="Edit">✏️</button>
                <button onclick="deleteItem(${idx}, ${js(i.raw)})" class="px-1 hover:bg-rose-100 text-rose-600 rounded" title="Delete">✕</button></span>`;
        }).join('') : `<p class="text-xs text-slate-400">${all.length ? 'No matches.' : 'Nothing added yet.'}</p>`;
        return `<div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
            <div class="flex justify-between items-start gap-2">
                <div><h3 class="text-sm font-bold text-indigo-900">${cat.icon} ${cat.title} <span class="ml-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[11px] font-semibold">${all.length}</span></h3>
                <p class="text-[11px] text-slate-500 mt-0.5">Used in: ${cat.used}</p></div>
                ${missing ? `<button onclick="addDefaults(${idx})" class="text-xs bg-emerald-50 hover:bg-emerald-100 text-emerald-700 px-2.5 py-1.5 rounded-lg font-semibold whitespace-nowrap">+ Add ${missing} suggested</button>` : ''}
            </div>
            <div class="flex gap-2 mt-3">
                <input id="add_${idx}" type="text" placeholder="${esc(cat.add)}" onkeydown="if(event.key==='Enter')addItem(${idx})" class="border rounded-lg p-2.5 text-sm outline-none flex-1 min-w-0">
                <button onclick="addItem(${idx})" class="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-lg text-sm font-semibold">Add</button>
            </div>
            <div class="flex flex-wrap gap-2 mt-3">${chips}</div>
        </div>`;
    }).join('');

    // other / custom entries
    let known = new Set([...CATEGORIES.map(c => norm(c.key)), ...RULE_KEYS.map(norm)]);
    let others = rows.filter(r => !known.has(norm(r.key)));
    $('otherList').innerHTML = others.length ? others.map(r => `<div class="flex justify-between items-center gap-2 p-3"><span class="min-w-0 truncate"><b>${esc(r.key)}:</b> ${esc(r.val)}</span><button onclick="deleteOther(${js(r.key)}, ${js(r.val)})" class="text-rose-600 text-xs bg-rose-50 hover:bg-rose-100 px-2 py-1 rounded shrink-0">Delete</button></div>`).join('')
        : '<p class="p-3 text-xs text-slate-400 text-center">No other entries.</p>';
}

async function postSettings(payload) {
    let c = getSupabaseConfig();
    let r = await fetch(`${c.url}/rest/v1/settings`, { method: 'POST', headers: sbHeaders({ ...JSON_H, "Prefer": "return=minimal" }), body: JSON.stringify(payload) });
    if(!r.ok) throw new Error(await r.text());
}
async function addItem(idx) {
    let cat = CATEGORIES[idx], input = $('add_' + idx), v = input.value.trim().replace(/\s+/g, ' ');
    if(!v) return;
    if(itemsOf(cat).some(i => norm(i.raw) === norm(v))) { toast(`“${v}” already exists in ${cat.title}.`, false); return; }
    try { await postSettings({ setting_key: cat.key, setting_value: v }); rows.push({ key: cat.key, val: v }); renderLists(); toast(`Added “${v}”.`); setTimeout(() => { let i = $('add_' + idx); if(i) i.focus(); }, 30); }
    catch (e) { toast('Could not add: ' + e.message, false); }
}
async function addDefaults(idx) {
    let cat = CATEGORIES[idx], have = itemsOf(cat), missing = cat.defaults.filter(d => !have.some(i => norm(i.raw) === norm(d)));
    if(!missing.length) return;
    showLoading('Adding...');
    try { await postSettings(missing.map(v => ({ setting_key: cat.key, setting_value: v }))); missing.forEach(v => rows.push({ key: cat.key, val: v })); renderLists(); toast(`${missing.length} entries added.`); }
    catch (e) { toast('Could not add: ' + e.message, false); }
    hideLoading();
}
function deleteItem(idx, value) {
    let cat = CATEGORIES[idx], n = useCount(cat, value);
    let msg = `Delete “${value}” from ${cat.title}?` + (n ? `\n\n${n} existing record(s) use this value. They keep it, but it will no longer appear in dropdowns.` : '');
    confirmBox(msg, 'Yes, delete', async () => {
        showLoading('Deleting...');
        try {
            let c = getSupabaseConfig(), mine = rows.filter(r => norm(r.key) === norm(cat.key) && norm(r.val) === norm(value));
            for(let r of mine) {
                let res = await fetch(`${c.url}/rest/v1/settings?setting_key=eq.${enc(r.key)}&setting_value=eq.${enc(r.val)}`, { method: 'DELETE', headers: sbHeaders({ "Prefer": "return=minimal" }) });
                if(!res.ok) throw new Error(await res.text());
            }
            rows = rows.filter(r => !(norm(r.key) === norm(cat.key) && norm(r.val) === norm(value)));
            renderLists(); toast('Deleted.');
        } catch (e) { toast('Could not delete: ' + e.message, false); }
        hideLoading();
    });
}

// rename (only allowed while unused, so existing records never go out of sync)
function openRename(idx, value) {
    let cat = CATEGORIES[idx], n = useCount(cat, value);
    if(n) { toast(`“${value}” is used by ${n} record(s), so it cannot be renamed. Add the correct value, update those records, then delete this one.`, false); return; }
    renameCtx = { idx, value }; $('renameInput').value = value; $('renameModal').classList.remove('hidden');
    setTimeout(() => $('renameInput').select(), 30);
}
function closeRename() { $('renameModal').classList.add('hidden'); renameCtx = null; }
async function saveRename() {
    if(!renameCtx) return;
    let cat = CATEGORIES[renameCtx.idx], old = renameCtx.value, v = $('renameInput').value.trim().replace(/\s+/g, ' ');
    if(!v) return;
    if(norm(v) !== norm(old) && itemsOf(cat).some(i => norm(i.raw) === norm(v))) { toast(`“${v}” already exists.`, false); return; }
    showLoading('Saving...');
    try {
        let c = getSupabaseConfig(), mine = rows.filter(r => norm(r.key) === norm(cat.key) && norm(r.val) === norm(old));
        for(let r of mine) {
            let res = await fetch(`${c.url}/rest/v1/settings?setting_key=eq.${enc(r.key)}&setting_value=eq.${enc(r.val)}`, { method: 'PATCH', headers: sbHeaders({ ...JSON_H, "Prefer": "return=minimal" }), body: JSON.stringify({ setting_value: v }) });
            if(!res.ok) throw new Error(await res.text());
            r.val = v;
        }
        closeRename(); renderLists(); toast('Updated.');
    } catch (e) { toast('Could not save: ' + e.message, false); }
    hideLoading();
}

// other / custom
async function addOther() {
    let k = $('otherKey').value.trim(), v = $('otherVal').value.trim();
    if(!k || !v) { toast('Please enter both a key and a value.', false); return; }
    if(rows.some(r => norm(r.key) === norm(k) && norm(r.val) === norm(v))) { toast('That entry already exists.', false); return; }
    try { await postSettings({ setting_key: k, setting_value: v }); rows.push({ key: k, val: v }); $('otherKey').value = ''; $('otherVal').value = ''; renderLists(); toast('Added.'); }
    catch (e) { toast('Could not add: ' + e.message, false); }
}
function deleteOther(key, val) {
    confirmBox(`Delete “${key}: ${val}”?`, 'Yes, delete', async () => {
        try {
            let c = getSupabaseConfig();
            let res = await fetch(`${c.url}/rest/v1/settings?setting_key=eq.${enc(key)}&setting_value=eq.${enc(val)}`, { method: 'DELETE', headers: sbHeaders({ "Prefer": "return=minimal" }) });
            if(!res.ok) throw new Error(await res.text());
            rows = rows.filter(r => !(r.key === key && r.val === val)); renderLists(); toast('Deleted.');
        } catch (e) { toast('Could not delete: ' + e.message, false); }
    });
}

// ====================================================================================
//  RULES (single-value settings)
// ====================================================================================
const single = key => { let r = rows.find(x => norm(x.key) === norm(key)); return r ? r.val : ''; };
async function upsertSingle(key, value) {
    let c = getSupabaseConfig();
    let r = await fetch(`${c.url}/rest/v1/settings?setting_key=eq.${enc(key)}`, { method: 'PATCH', headers: sbHeaders({ ...JSON_H, "Prefer": "return=representation" }), body: JSON.stringify({ setting_value: String(value) }) });
    if(!r.ok) throw new Error(await r.text());
    let updated = await r.json();
    if(!Array.isArray(updated) || !updated.length) await postSettings({ setting_key: key, setting_value: String(value) });
    rows = rows.filter(x => norm(x.key) !== norm(key)); rows.push({ key, val: String(value) });
}
function renderRules() {
    $('ruleDays').value = single('Payroll Working Days') || 30;
    $('ruleFree').value = single('Payroll Free Leaves') || 1;
    $('ruleLow').value = single('Low Stock Limit') || 5;
    $('ruleSchoolYear').value = single('School Year') || new Date().getFullYear();
}
async function saveRules() {
    let d = parseFloat($('ruleDays').value), f = parseFloat($('ruleFree').value);
    if(!(d > 0) || isNaN(f) || f < 0) { toast('Please enter valid values.', false); return; }
    showLoading('Saving...');
    try { await upsertSingle('Payroll Working Days', d); await upsertSingle('Payroll Free Leaves', f); toast('Payroll rules saved.'); }
    catch (e) { toast('Could not save: ' + e.message, false); }
    hideLoading();
}
async function saveLowStock() {
    let n = parseInt($('ruleLow').value);
    if(isNaN(n) || n < 0) { toast('Please enter a valid number.', false); return; }
    showLoading('Saving...');
    try { await upsertSingle('Low Stock Limit', n); toast('Book store rule saved.'); }
    catch (e) { toast('Could not save: ' + e.message, false); }
    hideLoading();
}
async function saveSchoolYear() {
    const year = Number($('ruleSchoolYear').value);
    if(!Number.isInteger(year) || year < 2000 || year > 2100) { toast('Enter a school starting year from 2000 to 2100.', false); return; }
    showLoading('Saving...');
    try { await upsertSingle('School Year', year); toast('School year saved.'); }
    catch (e) { toast('Could not save: ' + e.message, false); }
    hideLoading();
}

// ====================================================================================
//  CONNECTION + HEALTH + BACKUP
// ====================================================================================

async function runHealthCheck() {
    let box = $('healthList'); box.innerHTML = '<p class="text-xs text-slate-400">Checking...</p>';
    let c = getSupabaseConfig();
    let results = await Promise.all(HEALTH_TABLES.map(async t => {
        try {
            let r = await fetch(`${c.url}/rest/v1/${t.name}?select=*&limit=1`, { headers: sbHeaders({ "Prefer": "count=exact" }) });
            if(!r.ok) return { ...t, ok: false, status: r.status };
            let cr = r.headers.get('content-range') || '', count = cr.includes('/') ? cr.split('/')[1] : '?';
            return { ...t, ok: true, count };
        } catch (e) { return { ...t, ok: false, status: 'network' }; }
    }));
    box.innerHTML = results.map(r => r.ok
        ? `<div class="flex items-center justify-between gap-2 border border-emerald-100 bg-emerald-50/50 rounded-xl px-3 py-2"><span class="text-sm font-semibold text-slate-800">✅ ${r.label}</span><span class="text-xs text-emerald-700">${r.count === '*' ? '' : r.count + ' rows'}</span></div>`
        : `<div class="border ${r.optional ? 'border-amber-200 bg-amber-50/60' : 'border-rose-200 bg-rose-50/60'} rounded-xl px-3 py-2"><div class="flex items-center justify-between gap-2"><span class="text-sm font-semibold text-slate-800">${r.optional ? '⚠️' : '❌'} ${r.label}</span><span class="text-xs ${r.optional ? 'text-amber-700' : 'text-rose-700'}">${r.optional ? 'Not set up' : 'Error ' + r.status}</span></div>${r.hint ? `<div class="text-[11px] text-slate-500 mt-1">${r.hint}</div>` : ''}</div>`).join('');
}
async function downloadBackup() {
    showLoading('Preparing backup...');
    try {
        let backup = { exported_at: new Date().toISOString(), tables: {} }, i = 0;
        for(let t of HEALTH_TABLES) {
            i++; $('loadingText').innerText = `Backing up ${t.label} (${i}/${HEALTH_TABLES.length})...`;
            try { backup.tables[t.name] = await fetchAll(t.name); } catch (e) { /* table missing - skip */ }
        }
        let a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 1)], { type: 'application/json' }));
        a.download = `school-backup-${new Date().toLocaleDateString('en-CA')}.json`;
        document.body.appendChild(a); a.click(); a.remove();
        toast('Backup downloaded.');
    } catch (e) { toast('Backup failed: ' + e.message, false); }
    hideLoading();
}

document.addEventListener('keydown', e => { if(e.key === 'Escape') closeRename(); });
