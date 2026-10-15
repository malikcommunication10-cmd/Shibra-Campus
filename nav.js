// Shared sidebar + mobile menu. A page only needs: <aside id="appNav"></aside> and <script src="nav.js"></script>
(function () {
    const links = [
        ['index.html', '🏠', 'Home / Dashboard'], ['students.html', '👨‍🎓', 'Students Directory'], ['increments.html', '⚡', 'Bulk Updation'],
        ['fees.html', '💸', 'Fee Vouchers'], ['followups.html', '📞', 'Follow-up Calls'], ['books.html', '📚', 'Book Store'],
        ['accounts.html', '💰', 'Accounts & Daybook'], ['staff.html', '👩‍🏫', 'Staff & Payroll'], ['settings.html', '⚙️', 'System Settings'], ['users.html', '🔐', 'Users & Roles']
    ];
    const page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    function build() {
        const aside = document.getElementById('appNav');
        if (!aside) return;
        const me = (typeof ME !== 'undefined') ? ME : null;
        const shown = links.filter(l => !me || !me.perms || (typeof can === 'function' && can(PAGE_FILE[l[0]], 'v')));
        aside.className = 'no-print fixed md:sticky top-0 left-0 h-screen w-64 shrink-0 z-50 bg-indigo-950 text-white flex flex-col -translate-x-full md:translate-x-0 transition-transform';
        const who = me && me.email ? `<div class="p-3 border-t border-white/10 space-y-2"><div class="min-w-0"><div class="text-sm font-semibold truncate">👤 ${esc(me.name || me.email)}</div><div class="text-[11px] text-indigo-300 truncate">${esc(me.role || '')} · ${esc(me.email)}</div>${me.closedThrough ? `<div class="text-[11px] text-amber-300 mt-0.5">🔒 Closed up to ${esc(me.closedThrough)}</div>` : ''}</div><div class="flex gap-2"><button id="appPwBtn" class="flex-1 text-xs font-semibold bg-white/10 hover:bg-white/20 rounded-lg py-2">Password</button><button onclick="sbLogout()" class="flex-1 text-xs font-semibold bg-white/10 hover:bg-white/20 rounded-lg py-2">Logout</button></div></div>` : '';
        aside.innerHTML = `<div class="p-5 border-b border-white/10"><h1 class="font-bold">Concept School</h1><p class="text-xs text-indigo-300">Shibra Campus</p></div>
            <nav class="flex-1 p-3 space-y-1 overflow-y-auto">${shown.map(l => `<a href="${l[0]}" class="flex gap-2.5 items-center px-3 py-2.5 rounded-xl text-sm ${l[0] === page ? 'bg-indigo-600 text-white font-semibold' : 'text-indigo-200 hover:bg-white/10'}">${l[1]} <span>${l[2]}</span></a>`).join('')}</nav>${who}`;
        document.body.insertAdjacentHTML('afterbegin',
            `<header id="appTop" class="md:hidden sticky top-0 z-40 bg-indigo-950 text-white flex items-center justify-between px-4 py-3 no-print"><div><div class="font-bold text-sm leading-tight">Concept School</div><div class="text-[11px] text-indigo-300">Shibra Campus</div></div><button id="appMenuBtn" class="text-2xl px-2 min-h-11 min-w-11" aria-label="Open navigation menu" aria-controls="appNav" aria-expanded="false">☰</button></header>
             <div id="appBackdrop" class="fixed inset-0 bg-black/50 z-40 hidden md:hidden"></div>
             <div id="appPwModal" class="fixed inset-0 bg-black/60 z-[95] hidden items-center justify-center p-4 no-print"><div class="bg-white w-full max-w-xs rounded-2xl p-5 space-y-3 shadow-2xl text-slate-800"><h3 class="font-bold text-indigo-950">Change my password</h3><input id="appPw1" type="password" placeholder="New password (6+ characters)" class="w-full border rounded-lg p-2.5 text-sm outline-none"><input id="appPw2" type="password" placeholder="Type it again" class="w-full border rounded-lg p-2.5 text-sm outline-none"><p id="appPwMsg" class="text-xs text-rose-600 hidden"></p><div class="flex justify-end gap-2"><button id="appPwCancel" class="px-3 py-2 bg-slate-100 rounded-lg text-sm">Cancel</button><button id="appPwSave" class="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold">Save</button></div></div></div>
             <style>@media print{#appNav,#appTop,#appBackdrop,#appPwModal{display:none!important}}</style>`);
        const menuButton = document.getElementById('appMenuBtn');
        const backdrop = document.getElementById('appBackdrop');
        const setMenuOpen = open => {
            aside.classList.toggle('-translate-x-full', !open);
            backdrop.classList.toggle('hidden', !open);
            menuButton.setAttribute('aria-expanded', String(open));
            menuButton.setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');
            document.body.classList.toggle('overflow-hidden', open && window.matchMedia('(max-width: 767px)').matches);
        };
        menuButton.onclick = () => setMenuOpen(menuButton.getAttribute('aria-expanded') !== 'true');
        backdrop.onclick = () => setMenuOpen(false);
        aside.querySelectorAll('nav a').forEach(link => link.addEventListener('click', () => setMenuOpen(false)));
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && menuButton.getAttribute('aria-expanded') === 'true') {
                setMenuOpen(false);
                menuButton.focus();
            }
        });
        window.addEventListener('resize', () => {
            if (!window.matchMedia('(max-width: 767px)').matches) {
                backdrop.classList.add('hidden');
                menuButton.setAttribute('aria-expanded', 'false');
                document.body.classList.remove('overflow-hidden');
            }
        });
        const pm = document.getElementById('appPwModal'), msg = document.getElementById('appPwMsg');
        const showMsg = (t, ok) => { msg.textContent = t; msg.className = 'text-xs ' + (ok ? 'text-emerald-600' : 'text-rose-600'); };
        if (document.getElementById('appPwBtn')) document.getElementById('appPwBtn').onclick = () => { document.getElementById('appPw1').value = ''; document.getElementById('appPw2').value = ''; msg.className = 'hidden'; pm.classList.remove('hidden'); pm.classList.add('flex'); };
        document.getElementById('appPwCancel').onclick = () => { pm.classList.add('hidden'); pm.classList.remove('flex'); };
        document.getElementById('appPwSave').onclick = async () => {
            const a = document.getElementById('appPw1').value, b = document.getElementById('appPw2').value;
            if (a.length < 6) return showMsg('Use at least 6 characters.');
            if (a !== b) return showMsg('The two passwords are not the same.');
            const err = await sbChangePassword(a); if (err) return showMsg(err);
            showMsg('Password changed.', true); setTimeout(() => { pm.classList.add('hidden'); pm.classList.remove('flex'); }, 900);
        };
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
