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
            ...(typeof ERP !== 'undefined' && ERP.db && ERP.db.feeVoucherQueries ? ERP.db.feeVoucherQueries : []),
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

    // Global toggle function taake button par click seedha chale
    window.shibraToggleSidebar = function(open) {
        const aside = document.getElementById('appNav');
        const backdrop = document.getElementById('appBackdrop');
        const menuButton = document.getElementById('appMenuBtn');
        if (!aside) return;
        
        aside.classList.toggle('-translate-x-full', !open);
        if (backdrop) backdrop.classList.toggle('hidden', !open);
        document.body.classList.toggle('overflow-hidden', open && window.matchMedia('(max-width: 767px)').matches);
        if (menuButton) menuButton.setAttribute('aria-expanded', String(open));
    };

    function prefetchPageData(file) {
        if (typeof PAGE_FILE === 'undefined' || !PAGE_FILE[file] || typeof ERP === 'undefined' || !ERP.db) return;
        const pageKey = PAGE_FILE[file];
        if (typeof can === 'function' && !can(pageKey, 'v')) return;
        const connection = navigator.connection;
        if (connection && (connection.saveData || ['slow-2g', '2g'].includes(connection.effectiveType))) return;
        const queries = pageData[file] || [];
        Promise.all(queries.map(async ([table, query]) => {
            const response = await ERP.db.fetchResponse(table, query);
            if (!response.ok) throw new Error(`${table} preload failed with HTTP ${response.status}`);
        })).catch(error => console.warn(`Navigation data prefetch for ${file} failed:`, error));
    }

    function prefetchAllWindowsData() {
        if (typeof ERP === 'undefined' || !ERP.db || typeof PAGE_FILE === 'undefined') return;
        const connection = navigator.connection;
        if (connection && (connection.saveData || ['slow-2g', '2g'].includes(connection.effectiveType))) return;
        const allPages = Object.keys(pageData);
        setTimeout(() => {
            allPages.forEach((file, index) => {
                const pageKey = PAGE_FILE[file];
                if (!pageKey || (typeof can === 'function' && can(pageKey, 'v'))) {
                    const queries = pageData[file] || [];
                    setTimeout(() => {
                        queries.forEach(async ([table, query]) => {
                            try {
                                await ERP.db.fetchResponse(table, query);
                            } catch (e) {}
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
        
        const shown = links.filter(l => {
            if (!me || !me.perms || typeof PAGE_FILE === 'undefined' || typeof can !== 'function') return true;
            const pKey = PAGE_FILE[l[0]];
            return !pKey || can(pKey, 'v');
        });

        const reportLinks = shown.filter(l => ['reports.html', 'statements.html', 'audit.html'].includes(l[0]));
        const mainLinks = shown.filter(l => !['reports.html', 'statements.html', 'audit.html'].includes(l[0]));
        const reportActive = reportLinks.some(l => l[0] === page);
        
        const reportMenu = reportLinks.length ? `<details class="app-report-group rounded-xl ${reportActive ? 'bg-white/5' : ''}" ${reportActive ? 'open' : ''}>
            <summary class="app-report-summary flex cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold text-indigo-100 hover:bg-white/10"><span>📊 Reports &amp; Audit</span><span aria-hidden="true">⌄</span></summary>
            <div class="space-y-1 pb-1 pl-3">${reportLinks.map(l => `<a href="${l[0]}" class="flex gap-2.5 items-center px-3 py-2 rounded-xl text-sm ${l[0] === page ? 'bg-indigo-600 text-white font-semibold' : 'text-indigo-200 hover:bg-white/10'}">${l[1]} <span>${l[2]}</span></a>`).join('')}</div>
        </details>` : '';
        
        // Z-index high rakha hai taake kisi cheez ke neeche na dabey
        aside.className = 'no-print fixed md:sticky top-0 left-0 h-screen w-64 shrink-0 z-[100] bg-indigo-950 text-white flex flex-col transition-transform -translate-x-full md:translate-x-0 shadow-2xl';
        
        const accountActions = me && me.email ? `<div class="flex gap-2 p-3 border-b border-white/10"><button id="appPwBtn" class="flex-1 text-xs font-semibold bg-white/10 hover:bg-white/20 rounded-lg py-2">Password</button><button onclick="sbLogout()" class="flex-1 text-xs font-semibold bg-white/10 hover:bg-white/20 rounded-lg py-2">Logout</button></div>` : '';
        const who = me && me.email ? `<div class="px-3 py-2 border-b border-white/10"><div class="min-w-0"><div class="text-sm font-semibold truncate">👤 ${esc(me.name || me.email)}</div><div class="text-[11px] text-indigo-300 truncate">${esc(me.role || '')} · ${esc(me.email)}</div>${me.closedThrough ? `<div class="text-[11px] text-amber-300 mt-0.5">🔒 Closed up to ${esc(me.closedThrough)}</div>` : ''}</div></div>` : '';
        
        // Inline onclick lagaya hai taake click event 100% execute ho
        const sidebarHeader = `<div class="flex items-center justify-between p-5 border-b border-white/15"><div><h1 class="font-bold">Concept School</h1><p class="text-xs text-indigo-300">Shibra Campus</p></div><button type="button" onclick="window.shibraToggleSidebar(false)" class="text-indigo-200 hover:text-white bg-white/10 px-2.5 py-1 rounded-lg text-sm font-bold cursor-pointer">✕ Hide</button></div>`;

        aside.innerHTML = `${accountActions}${sidebarHeader}${who}
            <nav class="flex-1 p-3 space-y-1 overflow-y-auto">${mainLinks.map(l => `<a href="${l[0]}" data-prefetch-page="${l[0]}" class="flex gap-2.5 items-center px-3 py-2.5 rounded-xl text-sm ${l[0] === page ? 'bg-indigo-600 text-white font-semibold' : 'text-indigo-200 hover:bg-white/10'}">${l[1]} <span>${l[2]}</span></a>`).join('')}${reportMenu}</nav>`;
        
        const menuButton = document.getElementById('appMenuBtn');
        const backdrop = document.getElementById('appBackdrop');
        
        if (menuButton) {
            menuButton.onclick = () => {
                const isOpen = aside.classList.contains('-translate-x-full');
                window.shibraToggleSidebar(isOpen);
            };
        }

        if (backdrop) backdrop.onclick = () => window.shibraToggleSidebar(false);

        if (window.matchMedia('(min-width: 768px)').matches) {
            aside.classList.remove('-translate-x-full');
        }

        aside.querySelectorAll('nav a').forEach(link => {
            let prefetchTimer = null;
            const warm = () => {
                if (prefetchTimer || link.dataset.prefetched) return;
                prefetchTimer = setTimeout(() => {
                    prefetchTimer = null;
                    link.dataset.prefetched = 'true';
                    prefetchPageData(link.dataset.prefetchPage);
                }, 350);
            };
            link.addEventListener('pointerenter', event => {
                if (event.pointerType !== 'touch') warm();
            });
            link.addEventListener('pointerleave', () => {
                if (prefetchTimer) { clearTimeout(prefetchTimer); prefetchTimer = null; }
            });
            link.addEventListener('focus', warm);
            link.addEventListener('click', () => {
                if (window.matchMedia('(max-width: 767px)').matches) window.shibraToggleSidebar(false);
            });
        });

        window.addEventListener('resize', () => {
            if (!window.matchMedia('(max-width: 767px)').matches) {
                if (backdrop) backdrop.classList.add('hidden');
                aside.classList.remove('-translate-x-full');
                if (menuButton) menuButton.setAttribute('aria-expanded', 'false');
                document.body.classList.remove('overflow-hidden');
            }
        });

        prefetchAllWindowsData();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
