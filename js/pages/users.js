const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(msg, ok) { UI.toast(msg, ok !== false); }
function openModal(id) { $(id).classList.remove('hidden'); $(id).classList.add('flex'); }
function closeModal(id) { $(id).classList.add('hidden'); $(id).classList.remove('flex'); }
let users = [], roles = [], closes = [], permTarget = null, passwordTargetEmail = '';
const H = () => ({ apikey: SB_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' });
const roleOf = n => roles.find(r => r.name === n);
const permsOf = u => u.perms || (roleOf(u.role) || {}).perms || { pages: {}, flags: [] };
const adminCount = () => users.filter(u => u.active !== false && u.role === 'Admin' && !u.perms).length;

async function initUsers() {
    try {
        const [u, r, d] = await Promise.all([ERP.db.request('app_users', 'select=*&order=created_at.asc'), ERP.db.request('app_roles', 'select=*&order=created_at.asc'), ERP.db.request('day_close', 'select=*&order=closed_date.desc')]);
        users = u.ok ? await u.json() : []; roles = r.ok ? await r.json() : []; closes = d.ok ? await d.json() : [];
        if (!Array.isArray(users) || !Array.isArray(roles)) throw new Error('tables');
        if (!Array.isArray(closes)) closes = [];
    } catch (e) { console.error(e); toast('Could not load. Did you run supabase_roles.sql?', false); }
    renderUsers(); renderRoles(); renderDay();
}
function showTab(t) {
    $('paneUsers').classList.toggle('hidden', t !== 'users'); $('paneRoles').classList.toggle('hidden', t !== 'roles'); $('paneDay').classList.toggle('hidden', t !== 'day');
    const on = 'px-4 py-2 rounded-xl bg-indigo-600 text-white', off = 'px-4 py-2 rounded-xl bg-white border border-slate-200 text-slate-600';
    $('tabU').className = t === 'users' ? on : off; $('tabR').className = t === 'roles' ? on : off; $('tabD').className = t === 'day' ? on : off;
}

/* ---------- pure helpers ---------- */
function summarizePages(p) { const o = []; PAGES.forEach(pg => { const s = (p.pages || {})[pg[0]] || ''; if (s) o.push(`${pg[1].split(' ')[0]}: ${s.toUpperCase()}`); }); return o.join(' · ') || 'no pages'; }
function collectPerms() {
    const pages = {};
    PAGES.forEach(pg => { let s = ''; PAGE_ACTS.forEach(a => { if ((!READ_ONLY_PAGES.has(pg[0]) || a[0] === 'v') && $(`pm_${pg[0]}_${a[0]}`).checked) s += a[0]; }); if (s && !s.includes('v')) s = 'v' + s; if (s) pages[pg[0]] = s; });
    const flags = PERM_FLAGS.filter(f => $('pf_' + f[0]).checked).map(f => f[0]);
    if (flags.includes('requiredayclose') && !flags.includes('closeday')) flags.push('closeday');
    return { pages, flags };
}

/* ---------- users ---------- */
function renderUsers() {
    const isAdmin = ME && ME.role === 'Admin';
    $('usersBody').innerHTML = users.length ? users.map(u => {
        const me = u.email === (ME && ME.email);
        return `<tr class="border-t"><td class="p-3 font-semibold">${esc(u.name || '-')}${me ? ' <span class="text-[10px] bg-indigo-100 text-indigo-700 rounded px-1">you</span>' : ''}</td><td class="p-3">${esc(u.email)}</td><td class="p-3">${esc(u.role || '-')}</td>
        <td class="p-3">${u.perms ? '<span class="px-2 py-0.5 rounded bg-amber-50 text-amber-700 font-semibold">Custom</span>' : '<span class="text-slate-500">As role</span>'}</td>
        <td class="p-3">${u.active === false ? '<span class="px-2 py-0.5 rounded bg-rose-50 text-rose-700 font-semibold">Off</span>' : '<span class="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 font-semibold">Active</span>'}</td>
        <td class="p-3 whitespace-nowrap" data-e="${esc(u.email)}"><button onclick="openUser(this.parentNode.dataset.e)" class="px-2 py-1 bg-slate-100 rounded font-semibold mr-1">Edit</button><button onclick="openPerms('user',this.parentNode.dataset.e)" class="px-2 py-1 bg-indigo-50 text-indigo-700 rounded font-semibold mr-1">Permissions</button>${isAdmin ? '<button onclick="openPasswordModal(this.parentNode.dataset.e)" class="px-2 py-1 bg-amber-50 text-amber-800 rounded font-semibold mr-1">Change password</button>' : ''}${me ? '' : '<button onclick="deleteUser(this.parentNode.dataset.e)" class="px-2 py-1 bg-rose-50 text-rose-600 rounded font-semibold">Delete</button>'}</td></tr>`;
    }).join('') : '<tr><td colspan="6" class="p-6 text-center text-slate-400">No users.</td></tr>';
}
function openPasswordModal(email) {
    if (!ME || ME.role !== 'Admin') return toast('Only an Admin can set a user password.', false);
    const user = users.find(item => item.email === email);
    if (!user) return toast('User not found. Refresh the user list and try again.', false);
    passwordTargetEmail = user.email;
    $('passwordTarget').textContent = `${user.name || 'User'} · ${user.email}`;
    $('adminNewPassword').value = '';
    $('adminConfirmPassword').value = '';
    openModal('passwordModal');
    $('adminNewPassword').focus();
}
function closePasswordModal() {
    closeModal('passwordModal');
    $('adminNewPassword').value = '';
    $('adminConfirmPassword').value = '';
    passwordTargetEmail = '';
}
async function setUserPassword() {
    if (!ME || ME.role !== 'Admin') return toast('Only an Admin can set a user password.', false);
    if (!passwordTargetEmail || !users.some(item => item.email === passwordTargetEmail)) return toast('Choose a valid user first.', false);
    const password = $('adminNewPassword').value;
    if (password.length < 8) return toast('Use at least 8 characters for the new password.', false);
    if (password !== $('adminConfirmPassword').value) return toast('The passwords do not match.', false);
    const button = $('adminSetPasswordBtn');
    button.disabled = true;
    button.textContent = 'Updating...';
    try {
        const token = await sbFreshToken();
        if (!token) throw new Error('Your session expired. Sign in again.');
        const response = await fetch(`${SB_URL}/functions/v1/admin-set-user-password`, {
            method: 'POST',
            headers: { apikey: SB_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: passwordTargetEmail, password })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || `Password update failed (HTTP ${response.status}).`);
        closePasswordModal();
        toast('Password updated. Give the new password to the user securely.');
    } catch (error) {
        console.error('Admin password update failed:', error);
        toast(error.message || 'Could not update the password.', false);
    } finally {
        button.disabled = false;
        button.textContent = 'Change password';
    }
}
function openUser(email) {
    const u = email ? users.find(x => x.email === email) : null;
    $('uTitle').innerText = u ? 'Edit user' : 'Add user'; $('uEditing').value = u ? u.email : '';
    $('uName').value = u ? u.name || '' : ''; $('uEmail').value = u ? u.email : ''; $('uEmail').disabled = !!u; $('uPass').value = ''; $('uPassWrap').classList.toggle('hidden', !!u);
    $('uRole').innerHTML = roles.map(r => `<option value="${esc(r.name)}">${esc(r.name)}</option>`).join(''); $('uRole').value = u ? u.role : (roles.find(r => r.name === 'Teacher') || roles[0] || {}).name;
    $('uActive').value = u && u.active === false ? '0' : '1'; openModal('userModal');
}
async function saveUser() {
    const editing = $('uEditing').value, email = $('uEmail').value.trim().toLowerCase(), name = $('uName').value.trim(), role = $('uRole').value, active = $('uActive').value === '1', pw = $('uPass').value;
    if (!name || !email || !role) return toast('Name, email and role are required.', false);
    const me = ME && ME.email;
    if (editing) {
        if (editing === me && !active) return toast('You cannot switch yourself off.', false);
        const u = users.find(x => x.email === editing);
        if (u && u.role === 'Admin' && !u.perms && (role !== 'Admin' || !active) && adminCount() <= 1) return toast('There must always be one active Admin.', false);
        const r = await fetch(`${SB_URL}/rest/v1/app_users?email=eq.${encodeURIComponent(editing)}`, { method: 'PATCH', headers: H(), body: JSON.stringify({ name, role, active }) });
        if (!r.ok) return toast('Could not save: ' + await r.text(), false);
        toast('User saved.'); closeModal('userModal'); return initUsers();
    }
    if (users.some(x => x.email === email)) return toast('This email is already in the list.', false);
    if (pw && pw.length < 6) return toast('The password must have at least 6 characters.', false);
    if (pw) {
        const a = await fetch(`${SB_URL}/auth/v1/signup`, { method: 'POST', headers: { apikey: SB_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pw, data: { name } }) });
        const j = await a.json().catch(() => ({})), txt = JSON.stringify(j).toLowerCase();
        if (!a.ok && !txt.includes('already')) return toast('Could not create the login: ' + (j.msg || j.message || j.error_description || a.status), false);
    }
    const r = await fetch(`${SB_URL}/rest/v1/app_users`, { method: 'POST', headers: H(), body: JSON.stringify({ email, name, role, active }) });
    if (!r.ok) return toast('Could not save: ' + await r.text(), false);
    toast(pw ? 'User created. Tell them the email and the first password.' : 'User added.'); closeModal('userModal'); initUsers();
}
async function deleteUser(email) {
    const u = users.find(x => x.email === email); if (!u) return;
    if (u.role === 'Admin' && !u.perms && adminCount() <= 1) return toast('There must always be one active Admin.', false);
    if (!await UI.confirm(`Remove ${u.name || email} from the app?\n\nTheir login stays in Supabase but they will get "No access".`)) return;
    const r = await fetch(`${SB_URL}/rest/v1/app_users?email=eq.${encodeURIComponent(email)}`, { method: 'DELETE', headers: H() });
    if (!r.ok) return toast('Could not delete: ' + await r.text(), false);
    toast('User removed.'); initUsers();
}

/* ---------- roles ---------- */
function renderRoles() {
    $('rolesBody').innerHTML = roles.map(r => {
        const n = users.filter(u => u.role === r.name).length, p = r.perms || { pages: {}, flags: [] };
        return `<tr class="border-t align-top"><td class="p-3 font-semibold">${esc(r.name)}${r.builtin ? ' <span class="text-[10px] bg-slate-100 text-slate-500 rounded px-1">standard</span>' : ''}</td><td class="p-3">${n}</td><td class="p-3 text-slate-600">${esc(summarizePages(p))}</td>
        <td class="p-3 text-slate-500">${(p.flags || []).map(f => esc((PERM_FLAGS.find(x => x[0] === f) || [f, f])[1])).join('; ') || '-'}</td>
        <td class="p-3 whitespace-nowrap" data-r="${esc(r.name)}"><button onclick="openPerms('role',this.parentNode.dataset.r)" class="px-2 py-1 bg-indigo-50 text-indigo-700 rounded font-semibold mr-1">Edit permissions</button>${r.builtin || n ? '' : '<button onclick="deleteRole(this.parentNode.dataset.r)" class="px-2 py-1 bg-rose-50 text-rose-600 rounded font-semibold">Delete</button>'}</td></tr>`;
    }).join('') || '<tr><td colspan="5" class="p-6 text-center text-slate-400">No roles.</td></tr>';
}
function openRoleNew() { $('rName').value = ''; $('rCopy').innerHTML = roles.map(r => `<option value="${esc(r.name)}">${esc(r.name)}</option>`).join(''); openModal('roleModal'); }
async function createRole() {
    const name = $('rName').value.trim(); if (!name) return toast('Enter a role name.', false);
    if (roles.some(r => r.name.toLowerCase() === name.toLowerCase())) return toast('This role already exists.', false);
    const src = roleOf($('rCopy').value), perms = JSON.parse(JSON.stringify((src && src.perms) || { pages: {}, flags: [] }));
    const r = await fetch(`${SB_URL}/rest/v1/app_roles`, { method: 'POST', headers: H(), body: JSON.stringify({ name, perms, builtin: false }) });
    if (!r.ok) return toast('Could not create: ' + await r.text(), false);
    closeModal('roleModal'); await initUsers(); openPerms('role', name);
}
async function deleteRole(name) {
    if (!await UI.confirm(`Delete the role "${name}"?`)) return;
    const r = await fetch(`${SB_URL}/rest/v1/app_roles?name=eq.${encodeURIComponent(name)}`, { method: 'DELETE', headers: H() });
    if (!r.ok) return toast('Could not delete: ' + await r.text(), false);
    toast('Role deleted.'); initUsers();
}

/* ---------- the permission tick boxes ---------- */
function openPerms(type, key) {
    const t = type === 'role' ? roleOf(key) : users.find(u => u.email === key); if (!t) return;
    permTarget = { type, key };
    const p = type === 'role' ? (t.perms || { pages: {}, flags: [] }) : permsOf(t);
    $('pTitle').innerText = type === 'role' ? `Role: ${key}` : `Custom permissions: ${t.name || key}`;
    $('pReset').classList.toggle('hidden', !(type === 'user' && t.perms));
    $('permRows').innerHTML = PAGES.map(pg => `<tr class="border-t"><td class="p-1.5 font-semibold text-slate-700">${esc(pg[1])}${READ_ONLY_PAGES.has(pg[0]) ? '<span class="block text-[10px] font-normal text-slate-400">Read only</span>' : ''}</td>${PAGE_ACTS.map(a => `<td class="p-1.5 text-center"><input type="checkbox" id="pm_${pg[0]}_${a[0]}" ${(!READ_ONLY_PAGES.has(pg[0]) || a[0] === 'v') && String((p.pages || {})[pg[0]] || '').includes(a[0]) ? 'checked' : ''} ${READ_ONLY_PAGES.has(pg[0]) && a[0] !== 'v' ? 'disabled title="This page is read-only"' : ''} class="w-4 h-4 accent-indigo-600"></td>`).join('')}</tr>`).join('');
    $('permFlags').innerHTML = PERM_FLAGS.map(f => `<label class="flex items-center gap-2"><input type="checkbox" id="pf_${f[0]}" ${(p.flags || []).includes(f[0]) ? 'checked' : ''} class="w-4 h-4 accent-indigo-600"> ${esc(f[1])}</label>`).join('');
    openModal('permModal');
}
function presetPerm(k) {
    PAGES.forEach(pg => PAGE_ACTS.forEach(a => { $(`pm_${pg[0]}_${a[0]}`).checked = (!READ_ONLY_PAGES.has(pg[0]) || a[0] === 'v') && (k === 'all' || (k === 'view' && a[0] === 'v')); }));
    if (k !== 'all') PERM_FLAGS.forEach(f => { $('pf_' + f[0]).checked = false; });
}
async function savePerms() {
    const perms = collectPerms(), t = permTarget; if (!t) return;
    const mine = ME && (t.type === 'role' ? ME.role === t.key && !(users.find(u => u.email === ME.email) || {}).perms : t.key === ME.email);
    if (mine || (t.type === 'role' && t.key === 'Admin')) {
        const u = String(perms.pages.users || '');
        if (!(u.includes('v') && u.includes('e'))) return toast('Keep "Users & Roles" View and Edit for this role, otherwise nobody could manage users.', false);
    }
    const url = t.type === 'role' ? `${SB_URL}/rest/v1/app_roles?name=eq.${encodeURIComponent(t.key)}` : `${SB_URL}/rest/v1/app_users?email=eq.${encodeURIComponent(t.key)}`;
    const r = await fetch(url, { method: 'PATCH', headers: H(), body: JSON.stringify({ perms }) });
    if (!r.ok) return toast('Could not save: ' + await r.text(), false);
    toast('Permissions saved. People see it within a minute or at their next login.'); closeModal('permModal'); initUsers();
}
async function resetUserPerms() {
    const r = await fetch(`${SB_URL}/rest/v1/app_users?email=eq.${encodeURIComponent(permTarget.key)}`, { method: 'PATCH', headers: H(), body: JSON.stringify({ perms: null }) });
    if (!r.ok) return toast('Could not save: ' + await r.text(), false);
    toast('Now using the role\'s permissions.'); closeModal('permModal'); initUsers();
}

/* ---------- day close ---------- */
function renderDay() {
    const last = closes[0] && closes[0].closed_date; $('closedThrough').innerText = last || 'nothing closed yet';
    $('closeDate').value = todayYmd(); $('dayControls').classList.toggle('hidden', !flag('closeday'));
    $('closeList').innerHTML = closes.slice(0, 20).map(c => `<div class="p-2.5 flex justify-between"><span>Closed up to <b>${esc(c.closed_date)}</b></span><span class="text-slate-400">${esc(c.closed_by || '')} · ${esc(String(c.created_at || '').slice(0, 16).replace('T', ' '))}</span></div>`).join('') || '<div class="p-3 text-slate-400">No history.</div>';
}
async function closeDay() {
    const d = $('closeDate').value, last = closes[0] && closes[0].closed_date;
    if (!d) return toast('Choose a date.', false);
    if (last && d <= last) return toast(`Everything up to ${last} is already closed.`, false);
    if (!await UI.confirm(`Close every day up to ${d}?\nNobody without the special permission can change these days afterwards.`)) return;
    const r = await fetch(`${SB_URL}/rest/v1/day_close`, { method: 'POST', headers: H(), body: JSON.stringify({ closed_date: d, closed_by: ME && ME.email }) });
    if (!r.ok) return toast('Could not close: ' + await r.text(), false);
    ME.closedThrough = d; sbSaveMe(ME); toast('Day closed.'); initUsers();
}
async function reopenDay() {
    const c = closes[0]; if (!c) return toast('Nothing to re-open.', false);
    if (!await UI.confirm(`Re-open the close up to ${c.closed_date}?`)) return;
    const r = await fetch(`${SB_URL}/rest/v1/day_close?id=eq.${c.id}`, { method: 'DELETE', headers: H() });
    if (!r.ok) return toast('Could not re-open: ' + await r.text(), false);
    ME.closedThrough = (closes[1] && closes[1].closed_date) || ''; sbSaveMe(ME); toast('Re-opened.'); initUsers();
}
