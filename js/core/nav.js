// Shared sidebar + mobile menu. A page only needs: <aside id="appNav"></aside> and <script src="nav.js"></script>
(function () {
    const links = [
        ['index.html', '🏠', 'Home / Dashboard'], ['students.html', '👨‍🎓', 'Students Directory'], ['increments.html', '⚡', 'Bulk Updation'],
        ['fees.html', '💸', 'Fee Vouchers'], ['followups.html', '📞', 'Follow-up Calls'], ['books.html', '📚', 'Book Store'],
        ['accounts.html', '💰', 'Accounts & Daybook'], ['staff.html', '👩‍🏫', 'Staff & Payroll'],
        ['reports.html', '📈', 'Business Reports'], ['statements.html', '🧮', 'Financial Statements'], ['audit.html', '🧾', 'Audit Trail'],
        ['settings.html', '⚙️', 'System Settings'], ['users.html', '🔐', 'Users & Roles']
    ];
    const page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const pageData = {
        'index.html': [
            ['students', 'select=admis_no,student_name,status,class'],
            ['fees', 'select=admis_no,student_name,class,voucher_id,period,type,payable,discount'],
            ['accounts', 'select=voucher_id,from_account,to_account,description,amount_in,amount_out,date,remarks'],
            ['books', 'select=*'],
            ['settings', 'select=*&setting_key=eq.Book%20Promise'],
            ['settings', 'select=setting_key,setting_value']
        ],
        'students.html': [
            ['students', 'select=*'],
            ['settings', 'select=setting_key,setting_value']
        ],
        'fees.html': [
            ...ERP.db.feeVoucherQueries,
            ['settings', 'select=setting_key,setting_value']
        ],
        'books.html': [
            ['books', 'select=*'],
            ['settings', 'select=setting_key,setting_value'],
            ['settings', 'select=*&setting_key=eq.Book%20Item'],
            ['settings', 'select=*&setting_key=eq.Book%20Promise'],
            ['accounts', 'select=voucher_id,from_account,to_account,description,amount_in,amount_out,date'],
            ['students', 'select=admis_no,student_name,class,status']
        ],
        'accounts.html': [
            ['accounts', 'select=*&order=date.asc,voucher_id.asc'],
            ['fees', 'select=voucher_id,admis_no,student_name,class,period,type'],
            ['staff_security_ledger', 'select=staff_id,staff_name,entry_type,amount,transaction_date,salary_month,voucher_id,notes'],
            ['settings', 'select=setting_key,setting_value']
        ],
        'staff.html': [
            ['staff', 'select=*'],
            ['payroll', 'select=*'],
            ['staff_security_ledger', 'select=*'],
            ['staff_salary_increments', 'select=*'],
            ['settings', 'select=setting_key,setting_value']
        ],
        'increments.html': [
            ['increments', 'select=*'],
            ['students', 'select=*'],
            ['settings', 'select=setting_key,setting_value']
        ],
        'settings.html': [
            ['settings', 'select=*'],
            ['students', 'select=class'],
            ['staff', 'select=designation'],
            ['accounts', 'select=from_account,to_account,voucher_id,description'],
            ['books', 'select=party_name,type']
        ],
        'users.html': [
            ['app_users', 'select=*&order=created_at.asc'],
            ['app_roles', 'select=*&order=created_at.asc'],
            ['day_close', 'select=*&order=closed_date.desc']
        ]
    };
    function prefetchPageData(file) {
        const pageKey = PAGE_FILE[file];
        if (!pageKey || typeof sbFetchAll !== 'function' || typeof can !== 'function' || !can(pageKey, 'v')) return;
        const connection = navigator.connection;
        if (connection && (connection.saveData || ['slow-2g', '2g'].includes(connection.effectiveType))) return;
        const queries = pageData[file] || [];
        Promise.all(queries.map(async ([table, query]) => {
            const response = await ERP.db.fetchResponse(table, query);
            if (!response.ok) throw new Error(`${table} preload failed with HTTP${response.status}`);
        })).catch(error => console.warn(`Navigation data prefetch for ${file} failed:`, error));
    }

    // Login ke foran baad background mein saare pages ka data prefetch karne ke liye
    function prefetchAllWindowsData() {
        if (typeof sbFetchAll !== 'function' || typeof can !== 'function') return;
        
        const connection = navigator.connection;
        if (connection && (connection.saveData || ['slow-2g', '2g'].includes(connection.effectiveType))) return;

        const allPages = Object.keys(pageData);
        
        setTimeout(() => {
            allPages.forEach((file, index) => {
                const pageKey = PAGE_FILE[file];
                if (pageKey && can(pageKey, 'v')) {
                    const queries = pageData[file] || [];
                    setTimeout(() => {
                        queries.forEach(async ([table, query]) => {
                            try {
                                await ERP.db.fetchResponse(table, query);
                            } catch (e) {
                                // Background prefetch silent error handling
                            }
                        });
                    }, index * 300); 
                }
            });
        }, 1500); 
    }

    function build() {
        const aside = document.getElementById('appNav');
        if (!aside) return;
        const me = (typeof ME !== 'undefined') ? ME : null;
        const shown = links.filter(l => !me || !me.perms || (typeof can === 'function' && can(PAGE_FILE[l[0]], 'v')));
        const reportLinks = shown.filter(l => ['reports.html', 'statements.html', 'audit.html'].includes(l[0]));
        const mainLinks = shown.filter(l => !['reports.html', 'statements.html', 'audit.html'].includes(l[0]));
        const reportActive = reportLinks.some(l => l[0] === page);
        const reportMenu = reportLinks.length ? `<details class="app-report-group rounded-xl ${reportActive ? 'bg-white/5' : ''}" ${reportActive ? 'open' : ''}>
            <summary class="app-report-summary flex cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold text-indigo-100 hover:bg-white/10"><span>📊 Reports &amp; Audit</span><span aria-hidden="true">⌄</span></summary>
            <div class="space-y-1 pb-1 pl-3">${reportLinks.map(l => `<a href="${l[0]}" class="flex gap-2.5 items-center px-3 py-2 rounded-xl text-sm ${l[0] === page ? 'bg-indigo-600 text-white font-semibold' : 'text-indigo-200 hover:bg-white/10'}">${l[1]} <span>${l[2]}</span></a>`).join('')}</div>
        </details>` : '';
        aside.className = 'no-print fixed md:sticky top-0 left-0 h-screen w-64 shrink-0 z-50 bg-indigo-950 text-white flex flex-col -translate-x-full md:translate-x-0 transition-transform';
        const accountActions = me && me.email ? `<div class="flex gap-2 p-3 border-b border-white/10"><button id="appPwBtn" class="flex-1 text-xs font-semibold bg-white/10 hover:bg-white/20 rounded-lg py-2">Password</button><button onclick="sbLogout()" class="flex-1 text-xs font-semibold bg-white/10 hover:bg-white/20 rounded-lg py-2">Logout</button></div>` : '';
        const who = me && me.email ? `<div class="px-3 py-2 border-b border-white/10"><div class="min-w-0"><div class="text-sm font-semibold truncate">👤 ${esc(me.name || me.email)}</div><div class="text-[11px] text-indigo-300 truncate">${esc(me.role \vert{}\vert{} '')} ·${esc(me.email)}</div>${me.closedThrough ? `<div class="text-[11px] text-amber-300 mt-0.5">🔒 Closed up to ${esc(me.closedThrough)}</div>` : ''}</div></div>` : ''; aside.innerHTML = `${accountActions}<div class="p-5 border-b border-white/10"><h1 class="font-bold">Concept School</h1><p class="text-xs text-indigo-300">Shibra Campus</p></div>${who}
            <nav class="flex-1 p-3 space-y-1 overflow-y-auto">${mainLinks.map(l => `<a href="${l[0]}" data-prefetch-page="${l[0]}" class="flex gap-2.5 items-center px-3 py-2.5 rounded-xl text-sm ${l[0] === page ? 'bg-indigo-600 text-white font-semibold' : 'text-indigo-200 hover:bg-white/10'}">${l[1]} <span>${l[2]}</span></a>`).join('')}${reportMenu}</nav>`;
        document.body.insertAdjacentHTML('afterbegin',
            `<header id="appTop" class="md:hidden sticky top-0 z-40 bg-indigo-950 text-white flex items-center justify-between px-4 py-3 no-print"><div><div class="font-bold text-sm leading-tight">Concept School</div><div class="text-[11px] text-indigo-300">Shibra Campus</div></div><button id="appMenuBtn" class="text-2xl px-2 min-h-11 min-w-11" aria-label="Open navigation menu" aria-controls="appNav" aria-expanded="false">☰</button></header>
             <div id="appBackdrop" class="fixed inset-0 bg-black/50 z-40 hidden md:hidden"></div>
             <button id="appDayBtn" type="button" class="fixed bottom-4 right-4 z-[80] hidden rounded-full bg-rose-600 px-4 py-3 text-sm font-bold text-white shadow-lg hover:bg-rose-700 no-print">🔒 Day close</button>
             <div id="appDayModal" class="fixed inset-0 z-[95] hidden items-center justify-center bg-black/60 p-4 no-print"><div class="w-full max-w-sm space-y-4 rounded-2xl bg-white p-5 text-slate-800 shadow-2xl">
                <div class="flex items-start justify-between gap-3"><div><h3 class="font-bold text-indigo-950">Day close</h3><p id="appDayMessage" class="text-xs text-slate-500"></p></div><button id="appDayCancelTop" type="button" class="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100" aria-label="Close">✕</button></div>
                <p class="rounded-xl border bg-slate-50 p-3 text-sm">Closed through: <b id="appDayThrough" class="text-indigo-900">Checking…</b></p>
                <p id="appDayError" class="hidden break-words rounded-lg bg-rose-50 p-2 text-xs text-rose-700"></p>
                <div id="appDayControls" class="space-y-3">
                    <div><label for="appDayDate" class="mb-1 block text-xs font-semibold text-slate-600">Close all dates through</label><input id="appDayDate" type="date" class="w-full rounded-lg border p-2.5 text-sm"></div>
                    <div class="flex justify-end gap-2"><button id="appDayReopen" type="button" class="rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">Re-open last close</button><button id="appDaySave" type="button" class="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white">Close days</button></div>
                </div>
                <div id="appDayDoneRow" class="flex justify-end"><button id="appDayCancel" type="button" class="rounded-lg bg-slate-100 px-4 py-2 text-sm">Done</button></div>
             </div></div>
             <div id="appPwModal" class="fixed inset-0 bg-black/60 z-[95] hidden items-center justify-center p-4 no-print"><div class="bg-white w-full max-w-xs rounded-2xl p-5 space-y-3 shadow-2xl text-slate-800"><h3 class="font-bold text-indigo-950">Change my password</h3><input id="appPw1" type="password" placeholder="New password (6+ characters)" class="w-full border rounded-lg p-2.5 text-sm outline-none"><input id="appPw2" type="password" placeholder="Type it again" class="w-full border rounded-lg p-
