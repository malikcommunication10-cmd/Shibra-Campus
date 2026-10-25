// Shared sidebar + mobile menu. A page only needs: <aside id="appNav"></aside> and <script src="nav.js"></script>
(function () {
    const links = [
        ['index.html', '🏠', 'Home / Dashboard'], ['students.html', '👨‍🎓', 'Students Directory'], ['increments.html', '⚡', 'Bulk Updation'],
        ['fees.html', '💸', 'Fee Vouchers'], ['followups.html', '📞', 'Follow-up Calls'], ['books.html', '📚', 'Book Store'],
        ['accounts.html', '💰', 'Accounts & Daybook'], ['staff.html', '👩‍🏫', 'Staff & Payroll'],
        ['reports.html', '📈', 'Business Reports'], ['audit.html', '🧾', 'Audit Trail'],
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
            ['students', 'select=*'],
            ['increments', 'select=admis_no,effective_period,old_fee,new_fee,fee_type,annual_fund,remarks'],
            ['accounts', 'select=voucher_id,amount_in,date,description,remarks'],
            ['fees', 'select=*'],
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
        ]
    };
    function prefetchPageData(file) {
        const pageKey = PAGE_FILE[file];
        if (!pageKey || typeof sbFetchAll !== 'function' || typeof can !== 'function' || !can(pageKey, 'v')) return;
        const connection = navigator.connection;
        if (connection && (connection.saveData || ['slow-2g', '2g'].includes(connection.effectiveType))) return;
        const queries = pageData[file] || [];
        Promise.all(queries.map(async ([table, query]) => {
            const response = await sbFetchAll(table, query);
            if (!response.ok) throw new Error(`${table} preload failed with HTTP ${response.status}`);
        })).catch(error => console.warn(`Navigation data prefetch for ${file} failed:`, error));
    }
    function enableKeepAliveNavigation() {
        const appFiles = new Set(links.map(link => link[0]));
        const routeFromUrl = value => {
            let url;
            try { url = new URL(value, location.href); } catch (error) { return null; }
            if (url.origin !== location.origin) return null;
            const file = (url.pathname.split('/').pop() || 'index.html').toLowerCase();
            return appFiles.has(file) ? file : null;
        };
        function setActiveNavigation(file, root = document) {
            root.querySelectorAll('#appNav nav a[href]').forEach(link => {
                const active = routeFromUrl(link.href) === file;
                link.classList.toggle('bg-indigo-600', active);
                link.classList.toggle('text-white', active);
                link.classList.toggle('font-semibold', active);
                link.classList.toggle('text-indigo-200', !active);
            });
            const reportGroup = root.querySelector('#appNav .app-report-group');
            if (reportGroup) {
                const active = ['reports.html', 'audit.html'].includes(file);
                reportGroup.open = active;
                reportGroup.classList.toggle('bg-white/5', active);
            }
        }

        if (window.parent !== window) {
            const style = document.createElement('style');
            style.textContent = '#appNav,#appTop,#appBackdrop,#appDayBtn,#appDayModal,#appPwModal{display:none!important}body{min-height:100vh}';
            document.head.appendChild(style);
            document.addEventListener('click', event => {
                const link = event.target.closest && event.target.closest('a[href]');
                if (!link) return;
                const file = routeFromUrl(link.href);
                if (!file) return;
                event.preventDefault();
                event.stopImmediatePropagation();
                window.parent.postMessage({ type: 'shibra:navigate', href: link.href }, location.protocol === 'file:' ? '*' : location.origin);
            }, true);
            return;
        }

        const pageMain = document.querySelector('main');
        if (!pageMain || window.__shibraKeepAliveNavigation) return;
        window.__shibraKeepAliveNavigation = true;

        const initialFile = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
        const instances = new Map([[initialFile, { main: pageMain }]]);
        let activeFile = initialFile, host = null, loading = null;

        function closeMobileMenu() {
            const aside = document.getElementById('appNav'), backdrop = document.getElementById('appBackdrop');
            const button = document.getElementById('appMenuBtn');
            if (aside) aside.classList.add('-translate-x-full');
            if (backdrop) backdrop.classList.add('hidden');
            if (button) {
                button.setAttribute('aria-expanded', 'false');
                button.setAttribute('aria-label', 'Open navigation menu');
            }
            document.body.classList.remove('overflow-hidden');
        }
        function getHost() {
            if (host) return host;
            host = document.createElement('div');
            host.id = 'appPageHost';
            host.style.cssText = 'display:none;flex:1;min-width:0;height:100dvh;position:relative;background:#f8fafc';
            pageMain.insertAdjacentElement('afterend', host);
            const responsiveStyle = document.createElement('style');
            responsiveStyle.textContent = '@media(max-width:767px){#appPageHost{height:calc(100dvh - 56px)}}';
            document.head.appendChild(responsiveStyle);
            loading = document.createElement('div');
            loading.className = 'absolute inset-0 z-10 flex items-center justify-center bg-slate-50 text-sm font-semibold text-slate-500';
            loading.innerHTML = '<span class="mr-2 inline-block h-5 w-5 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent"></span>Opening page…';
            host.appendChild(loading);
            return host;
        }
        function showFrame(file, frame, isReady) {
            pageMain.hidden = true;
            const pageHost = getHost();
            pageHost.style.display = 'block';
            pageHost.querySelectorAll('iframe[data-app-page]').forEach(item => { item.hidden = item !== frame; });
            if (loading) loading.hidden = isReady;
            activeFile = file;
            setActiveNavigation(file);
            if (location.origin !== 'null' && frame.contentDocument) setActiveNavigation(file, frame.contentDocument);
        }
        function navigate(file, href, options = {}) {
            if (!appFiles.has(file)) return false;
            const pageKey = PAGE_FILE[file];
            if (typeof can === 'function' && typeof ME !== 'undefined' && ME && !can(pageKey, 'v')) return false;
            closeMobileMenu();
            if (file === activeFile && options.push !== false) return true;

            if (file === initialFile) {
                pageMain.hidden = false;
                if (host) host.style.display = 'none';
                activeFile = file;
                setActiveNavigation(file);
            } else {
                let instance = instances.get(file);
                if (!instance) {
                    const pageHost = getHost();
                    const frame = document.createElement('iframe');
                    frame.title = links.find(link => link[0] === file)?.[2] || file;
                    frame.dataset.appPage = file;
                    frame.style.cssText = 'display:block;width:100%;height:100%;border:0;background:#f8fafc';
                    frame.addEventListener('load', () => {
                        instance.ready = true;
                        if (location.origin !== 'null') {
                            const framePath = frame.contentWindow.location.pathname.split('/').pop().toLowerCase();
                            if (framePath === 'login.html') {
                                location.replace('login.html');
                                return;
                            }
                            if (frame.contentDocument) setActiveNavigation(file, frame.contentDocument);
                        }
                        if (activeFile === file && loading) loading.hidden = true;
                    });
                    instance = { frame, ready: false };
                    instances.set(file, instance);
                    pageHost.appendChild(frame);
                    frame.src = href || file;
                }
                showFrame(file, instance.frame, instance.ready);
            }
            if (options.push !== false) {
                try { history.pushState({ shibraAppPage: file }, '', href || file); }
                catch (error) {
                    if (location.protocol !== 'file:') throw error;
                    console.warn('Browser history is unavailable for local file navigation:', error);
                }
            }
            return true;
        }

        document.addEventListener('click', event => {
            const link = event.target.closest && event.target.closest('a[href]');
            if (!link || link.target === '_blank' || event.defaultPrevented) return;
            const file = routeFromUrl(link.href);
            if (!file) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            if (file !== activeFile || location.pathname.split('/').pop().toLowerCase() !== file)
                navigate(file, link.href);
            else closeMobileMenu();
        }, true);
        window.addEventListener('message', event => {
            const sameOrigin = event.origin === location.origin || (location.protocol === 'file:' && event.origin === 'null');
            if (!sameOrigin || !event.data || event.data.type !== 'shibra:navigate') return;
            const sourceAllowed = [...instances.values()].some(instance => instance.frame && instance.frame.contentWindow === event.source);
            const file = routeFromUrl(event.data.href);
            if (sourceAllowed && file) navigate(file, event.data.href);
        });
        window.addEventListener('popstate', () => {
            const file = routeFromUrl(location.href);
            if (file) navigate(file, location.href, { push: false });
        });
    }
    function build() {
        const aside = document.getElementById('appNav');
        if (!aside) return;
        const me = (typeof ME !== 'undefined') ? ME : null;
        const shown = links.filter(l => !me || !me.perms || (typeof can === 'function' && can(PAGE_FILE[l[0]], 'v')));
        const reportLinks = shown.filter(l => ['reports.html', 'audit.html'].includes(l[0]));
        const mainLinks = shown.filter(l => !['reports.html', 'audit.html'].includes(l[0]));
        const reportActive = reportLinks.some(l => l[0] === page);
        const reportMenu = reportLinks.length ? `<details class="app-report-group rounded-xl ${reportActive ? 'bg-white/5' : ''}" ${reportActive ? 'open' : ''}>
            <summary class="app-report-summary flex cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold text-indigo-100 hover:bg-white/10"><span>📊 Reports &amp; Audit</span><span aria-hidden="true">⌄</span></summary>
            <div class="space-y-1 pb-1 pl-3">${reportLinks.map(l => `<a href="${l[0]}" class="flex gap-2.5 items-center px-3 py-2 rounded-xl text-sm ${l[0] === page ? 'bg-indigo-600 text-white font-semibold' : 'text-indigo-200 hover:bg-white/10'}">${l[1]} <span>${l[2]}</span></a>`).join('')}</div>
        </details>` : '';
        aside.className = 'no-print fixed md:sticky top-0 left-0 h-screen w-64 shrink-0 z-50 bg-indigo-950 text-white flex flex-col -translate-x-full md:translate-x-0 transition-transform';
        const accountActions = me && me.email ? `<div class="flex gap-2 p-3 border-b border-white/10"><button id="appPwBtn" class="flex-1 text-xs font-semibold bg-white/10 hover:bg-white/20 rounded-lg py-2">Password</button><button onclick="sbLogout()" class="flex-1 text-xs font-semibold bg-white/10 hover:bg-white/20 rounded-lg py-2">Logout</button></div>` : '';
        const who = me && me.email ? `<div class="px-3 py-2 border-b border-white/10"><div class="min-w-0"><div class="text-sm font-semibold truncate">👤 ${esc(me.name || me.email)}</div><div class="text-[11px] text-indigo-300 truncate">${esc(me.role || '')} · ${esc(me.email)}</div>${me.closedThrough ? `<div class="text-[11px] text-amber-300 mt-0.5">🔒 Closed up to ${esc(me.closedThrough)}</div>` : ''}</div></div>` : '';
        aside.innerHTML = `${accountActions}<div class="p-5 border-b border-white/10"><h1 class="font-bold">Concept School</h1><p class="text-xs text-indigo-300">Shibra Campus</p></div>${who}
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
             <div id="appPwModal" class="fixed inset-0 bg-black/60 z-[95] hidden items-center justify-center p-4 no-print"><div class="bg-white w-full max-w-xs rounded-2xl p-5 space-y-3 shadow-2xl text-slate-800"><h3 class="font-bold text-indigo-950">Change my password</h3><input id="appPw1" type="password" placeholder="New password (6+ characters)" class="w-full border rounded-lg p-2.5 text-sm outline-none"><input id="appPw2" type="password" placeholder="Type it again" class="w-full border rounded-lg p-2.5 text-sm outline-none"><p id="appPwMsg" class="text-xs text-rose-600 hidden"></p><div class="flex justify-end gap-2"><button id="appPwCancel" class="px-3 py-2 bg-slate-100 rounded-lg text-sm">Cancel</button><button id="appPwSave" class="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold">Save</button></div></div></div>
             <style>.app-report-summary{list-style:none}.app-report-summary::-webkit-details-marker{display:none}.app-report-group[open] .app-report-summary{background:rgba(255,255,255,.08)}.app-report-summary span:last-child{display:inline-block;transition:transform .15s}.app-report-group[open] .app-report-summary span:last-child{transform:rotate(180deg)}@media print{#appNav,#appTop,#appBackdrop,#appPwModal,#appDayBtn,#appDayModal{display:none!important}}</style>`);
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
        aside.querySelectorAll('nav a').forEach(link => {
            let prefetchTimer = null;
            const warm = () => {
                if (prefetchTimer || link.dataset.prefetched) return;
                prefetchTimer = setTimeout(() => {
                    prefetchTimer = null;
                    link.dataset.prefetched = 'true';
                    prefetchPageData(link.dataset.prefetchPage);
                }, 120);
            };
            link.addEventListener('pointerenter', event => {
                if (event.pointerType !== 'touch') warm();
            });
            link.addEventListener('pointerleave', () => {
                if (prefetchTimer) { clearTimeout(prefetchTimer); prefetchTimer = null; }
            });
            link.addEventListener('focus', warm);
            link.addEventListener('click', () => setMenuOpen(false));
        });
        enableKeepAliveNavigation();
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
        setupDayClose();
    }
    function setupDayClose() {
        const modal = document.getElementById('appDayModal');
        const button = document.getElementById('appDayBtn');
        const dateInput = document.getElementById('appDayDate');
        const through = document.getElementById('appDayThrough');
        const message = document.getElementById('appDayMessage');
        const error = document.getElementById('appDayError');
        const controls = document.getElementById('appDayControls');
        const doneRow = document.getElementById('appDayDoneRow');
        let lastClose = null;
        let pending = false;
        const pkDate = offset => {
            const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
            const get = key => Number(parts.find(p => p.type === key).value);
            return new Date(Date.UTC(get('year'), get('month') - 1, get('day') + (offset || 0))).toISOString().slice(0, 10);
        };
        const hasFlag = key => typeof flag === 'function' && flag(key);
        const showError = text => { error.textContent = text; error.classList.remove('hidden'); };
        const openModal = async () => {
            error.classList.add('hidden');
            modal.classList.remove('hidden'); modal.classList.add('flex');
            await refresh();
        };
        const hideModal = () => {
            if (pending) return showError(`Close all previous days through ${pkDate(-1)} before working today.`);
            modal.classList.add('hidden'); modal.classList.remove('flex');
        };
        const refresh = async () => {
            const allowed = hasFlag('closeday') || hasFlag('requiredayclose');
            button.classList.toggle('hidden', !allowed);
            controls.classList.toggle('hidden', !hasFlag('closeday'));
            doneRow.classList.toggle('hidden', pending);
            if (!allowed) { modal.classList.add('hidden'); modal.classList.remove('flex'); return false; }
            try {
                const response = await fetch(`${SB_URL}/rest/v1/day_close?select=id,closed_date&order=closed_date.desc,created_at.desc&limit=1`);
                if (!response.ok) throw new Error(await response.text());
                const rows = await response.json();
                lastClose = rows[0] || null;
                const closedThrough = lastClose ? lastClose.closed_date : '';
                if (typeof ME !== 'undefined' && ME) {
                    ME.closedThrough = closedThrough;
                    sbSaveMe(ME);
                }
                pending = hasFlag('requiredayclose') && closedThrough < pkDate(-1);
                through.textContent = closedThrough || 'No date closed yet';
                message.textContent = pending
                    ? `Work is paused until all previous days are closed through ${pkDate(-1)}.`
                    : 'Close the day after completing its work. Dates use Pakistan time.';
                dateInput.value = pending ? pkDate(-1) : pkDate(0);
                dateInput.max = pending ? pkDate(-1) : pkDate(0);
                document.getElementById('appDaySave').textContent = pending ? 'Close previous days' : 'Close days';
                document.getElementById('appDayReopen').classList.toggle('hidden', !lastClose);
                doneRow.classList.toggle('hidden', pending);
                if (typeof sbUpdateDayCloseDateLimits === 'function') sbUpdateDayCloseDateLimits();
                if (pending) {
                    error.classList.add('hidden');
                    modal.classList.remove('hidden'); modal.classList.add('flex');
                }
                return true;
            } catch (e) {
                through.textContent = 'Could not load';
                pending = hasFlag('requiredayclose') && typeof sbDayClosePending === 'function' && sbDayClosePending();
                doneRow.classList.toggle('hidden', pending);
                if (pending) { modal.classList.remove('hidden'); modal.classList.add('flex'); }
                showError('Could not check the day-close status. Refresh the page and try again.');
                console.error('Could not load day-close status:', e);
                return false;
            }
        };
        button.onclick = openModal;
        document.getElementById('appDayCancel').onclick = hideModal;
        document.getElementById('appDayCancelTop').onclick = hideModal;
        modal.addEventListener('click', event => { if (event.target === modal && !pending) hideModal(); });
        document.addEventListener('keydown', event => { if (event.key === 'Escape' && !modal.classList.contains('hidden') && !pending) hideModal(); });
        document.getElementById('appDaySave').onclick = async () => {
            const date = dateInput.value, maxDate = pending ? pkDate(-1) : pkDate(0);
            if (!date || date > maxDate) return showError(`Choose a date no later than ${maxDate}.`);
            if (lastClose && date <= lastClose.closed_date) return showError(`Dates through ${lastClose.closed_date} are already closed.`);
            if (!confirm(`Close all dates through ${date}? Entries through this date will be locked for ordinary roles.`)) return;
            const save = document.getElementById('appDaySave');
            save.disabled = true;
            try {
                const response = await fetch(`${SB_URL}/rest/v1/day_close`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
                    body: JSON.stringify({ closed_date: date, closed_by: (typeof ME !== 'undefined' && ME && ME.email) || 'Administrator' })
                });
                if (!response.ok) throw new Error(await response.text());
                if (typeof ME !== 'undefined' && ME) { ME.closedThrough = date; sbSaveMe(ME); }
                await refresh();
                if (!pending) hideModal();
            } catch (e) {
                showError('Could not close the day: ' + e.message);
                console.error('Could not close the day:', e);
            } finally { save.disabled = false; }
        };
        document.getElementById('appDayReopen').onclick = async () => {
            if (!lastClose) return showError('There is no close to re-open.');
            if (!confirm(`Re-open the last close through ${lastClose.closed_date}?`)) return;
            const reopen = document.getElementById('appDayReopen');
            reopen.disabled = true;
            try {
                const response = await fetch(`${SB_URL}/rest/v1/day_close?id=eq.${encodeURIComponent(lastClose.id)}`, { method: 'DELETE' });
                if (!response.ok) throw new Error(await response.text());
                if (typeof ME !== 'undefined' && ME) ME.closedThrough = '';
                await refresh();
            } catch (e) {
                showError('Could not re-open the day: ' + e.message);
                console.error('Could not re-open the day:', e);
            } finally { reopen.disabled = false; }
        };
        window.shibraDayCloseRefresh = refresh;
        refresh();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
