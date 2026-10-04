// Shared sidebar + mobile menu. A page only needs: <aside id="appNav"></aside> and <script src="nav.js"></script>
(function () {
    const links = [
        ['index.html', '🏠', 'Home / Dashboard'], ['students.html', '👨‍🎓', 'Students Directory'], ['increments.html', '⚡', 'Bulk Updation'],
        ['fees.html', '💸', 'Fee Vouchers'], ['followups.html', '📞', 'Follow-up Calls'], ['books.html', '📚', 'Book Store'],
        ['accounts.html', '💰', 'Accounts & Daybook'], ['staff.html', '👩‍🏫', 'Staff & Payroll'], ['settings.html', '⚙️', 'System Settings']
    ];
    const page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    function build() {
        const aside = document.getElementById('appNav');
        if (!aside) return;
        aside.className = 'no-print fixed md:sticky top-0 left-0 h-screen w-64 shrink-0 z-50 bg-indigo-950 text-white flex flex-col -translate-x-full md:translate-x-0 transition-transform';
        aside.innerHTML = `<div class="p-5 border-b border-white/10"><h1 class="font-bold">Concept School</h1><p class="text-xs text-indigo-300">Shibra Campus</p></div>
            <nav class="flex-1 p-3 space-y-1 overflow-y-auto">${links.map(l => `<a href="${l[0]}" class="flex gap-2.5 items-center px-3 py-2.5 rounded-xl text-sm ${l[0] === page ? 'bg-indigo-600 text-white font-semibold' : 'text-indigo-200 hover:bg-white/10'}">${l[1]} <span>${l[2]}</span></a>`).join('')}</nav>`;
        document.body.insertAdjacentHTML('afterbegin',
            `<header id="appTop" class="md:hidden sticky top-0 z-40 bg-indigo-950 text-white flex items-center justify-between px-4 py-3 no-print"><div><div class="font-bold text-sm leading-tight">Concept School</div><div class="text-[11px] text-indigo-300">Shibra Campus</div></div><button id="appMenuBtn" class="text-2xl px-2" aria-label="Menu">☰</button></header>
             <div id="appBackdrop" class="fixed inset-0 bg-black/50 z-40 hidden md:hidden"></div>
             <style>@media print{#appNav,#appTop,#appBackdrop{display:none!important}}</style>`);
        const toggle = () => { aside.classList.toggle('-translate-x-full'); document.getElementById('appBackdrop').classList.toggle('hidden'); };
        document.getElementById('appMenuBtn').onclick = toggle;
        document.getElementById('appBackdrop').onclick = toggle;
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
