/* ============================================================================
   Book Store: club the transactions of one student (or vendor) on one date into ONE row.
   The row shows the total; the + button opens the individual items.
   Add this ONE line to books.html, just before </body> (after the page's own <script> block):
       <script src="books-group.js"></script>
   ============================================================================ */
(function () {
    'use strict';
    if (typeof renderTransactions !== 'function' || typeof txList !== 'function') { console.error('books-group.js must be loaded after the books page script.'); return; }

    const open = new Set();            // groups that are expanded
    let groups = new Map();            // key -> group (for the buttons)
    const isoDate = t => String(t.date || '');
    const unitKey = t => {
        const p = norm(t.party);
        if (t.kind === 'purchase' && t.invoiceNo) return `inv|${t.invoiceNo.toLowerCase()}`;      // a supplier invoice is already one bill
        return (p && t.date) ? `${t.date}|${t.kind}|${p}` : '';
    };
    function buildUnits(list) {
        const map = new Map(), units = [];
        list.forEach(t => {
            const key = unitKey(t);
            if (!key) { units.push({ single: t }); return; }
            let g = map.get(key);
            if (!g) { g = { key, rows: [], kind: t.kind, party: t.party, date: t.date }; map.set(key, g); units.push(g); }
            g.rows.push(t);
        });
        groups = new Map();
        return units.map(u => {
            if (u.single) return u;
            if (u.rows.length === 1) return { single: u.rows[0] };
            u.net = u.rows.reduce((s, t) => s + t.net, 0); u.qty = u.rows.reduce((s, t) => s + t.qty, 0); u.discount = u.rows.reduce((s, t) => s + t.discount, 0);
            u.vouchers = [...new Set(u.rows.map(t => t.voucher).filter(Boolean))];
            u.modes = [...new Set(u.rows.map(t => t.mode || ''))];
            u.invoices = [...new Set(u.rows.map(t => t.invoiceNo).filter(Boolean))];
            groups.set(u.key, u); return u;
        });
    }
    const q = v => esc(JSON.stringify(v));
    const modeText = m => m && WALLETS[m] ? WALLETS[m].icon + ' ' + WALLETS[m].label : (m || '-');
    const canId = t => t.id !== undefined && t.id !== null;

    function rowActions(t) {
        return `${['sale', 'purchase'].includes(t.kind) ? `<button onclick="editTx(${q(t.uid)})" title="Edit" class="px-1.5 hover:bg-indigo-50 rounded">✏️</button>` : ''}<button onclick="printSlip(${q(t.uid)})" title="Print slip" class="px-1.5 hover:bg-slate-100 rounded">🖨️</button><button onclick="deleteTx(${q(t.uid)})" title="Delete" class="px-1.5 hover:bg-rose-50 rounded">🗑️</button>`;
    }
    const itemCheckbox = t => canId(t) ? `<input type="checkbox" aria-label="Select ${esc(t.title)}" ${selectedTxUids.has(t.uid) ? 'checked' : ''} onchange="toggleTxSelection(${q(t.uid)},this.checked)" class="w-4 h-4 rounded">` : '';
    function itemRow(t, nested) {
        const inv = t.kind === 'purchase' && t.invoiceNo ? `<button type="button" onclick="openEditPurchaseInvoice(${q(t.invoiceNo)})" class="text-left text-indigo-700 hover:underline">${esc(t.invoiceNo)}</button>` : '<span class="text-slate-400">-</span>';
        return `<tr class="border-b ${nested ? 'bg-indigo-50/40' : 'hover:bg-slate-50'} align-top">
            <td class="p-2.5 no-print">${itemCheckbox(t)}</td>
            <td class="p-2.5 whitespace-nowrap text-slate-600">${nested ? '<span class="pl-7 text-slate-300">↳</span>' : fmtDate(t.date)}</td>
            <td class="p-2.5 whitespace-nowrap">${inv}</td>
            <td class="p-2.5 font-mono text-indigo-900 whitespace-nowrap">${esc(t.voucher || (t.id !== undefined ? '#' + t.id : '-'))}</td>
            <td class="p-2.5">${kindBadge(t.kind)}</td><td class="p-2.5">${nested ? '' : esc(t.party || '-')}</td>
            <td class="p-2.5 font-semibold text-slate-800"><button type="button" onclick="openItemLedger(${q(t.key)})" class="text-left text-indigo-700 hover:underline">${esc(t.title || '-')}</button>${t.notes ? `<div class="text-[11px] font-normal text-slate-400">${esc(t.notes)}</div>` : ''}</td>
            <td class="p-2.5 text-right">${fmt(t.qty)}</td><td class="p-2.5 text-right">${fmt(t.unit)}</td>
            <td class="p-2.5 text-right text-amber-600">${t.discount ? fmt(t.discount) : '-'}</td>
            <td class="p-2.5 text-right font-bold text-slate-800 whitespace-nowrap">PKR ${fmt(t.net)}</td>
            <td class="p-2.5 whitespace-nowrap">${modeText(t.mode)}</td><td class="p-2.5 whitespace-nowrap no-print">${rowActions(t)}</td></tr>`;
    }
    function groupRow(g) {
        const isOpen = open.has(g.key), n = g.rows.length;
        const titles = g.rows.slice(0, 2).map(t => esc(t.title)).join(', ') + (n > 2 ? ` +${n - 2} more` : '');
        const voucher = g.vouchers.length > 1 ? `${esc(g.vouchers[0])} <span class="text-[10px] text-slate-400">+${g.vouchers.length - 1}</span>` : esc(g.vouchers[0] || '-');
        const inv = g.invoices.length === 1 ? esc(g.invoices[0]) : (g.invoices.length > 1 ? `${g.invoices.length} invoices` : '<span class="text-slate-400">-</span>');
        const mode = g.modes.length === 1 ? modeText(g.modes[0]) : 'Mixed';
        return `<tr class="border-b bg-slate-50 hover:bg-slate-100 align-top">
            <td class="p-2.5 no-print"><input type="checkbox" data-gk="${esc(g.key)}" aria-label="Select all items of this bill" onchange="selectTxGroup(this.dataset.gk,this.checked)" class="w-4 h-4 rounded"></td>
            <td class="p-2.5 whitespace-nowrap font-semibold text-slate-700"><button type="button" data-k="${esc(g.key)}" onclick="toggleTxGroup(this.dataset.k)" aria-expanded="${isOpen}" aria-label="${isOpen ? 'Hide' : 'Show'} items" class="w-6 h-6 mr-1.5 rounded-md bg-indigo-100 hover:bg-indigo-200 text-indigo-700 font-bold leading-none">${isOpen ? '−' : '+'}</button>${fmtDate(g.date)}</td>
            <td class="p-2.5 whitespace-nowrap">${inv}</td><td class="p-2.5 font-mono text-indigo-900 whitespace-nowrap">${voucher}</td>
            <td class="p-2.5">${kindBadge(g.kind)}</td><td class="p-2.5 font-semibold text-slate-800">${esc(g.party)}</td>
            <td class="p-2.5 text-slate-600"><b>${n} items</b><div class="text-[11px] text-slate-400 max-w-[260px] truncate">${titles}</div></td>
            <td class="p-2.5 text-right font-semibold">${fmt(g.qty)}</td><td class="p-2.5 text-right text-slate-300">-</td>
            <td class="p-2.5 text-right text-amber-600">${g.discount ? fmt(g.discount) : '-'}</td>
            <td class="p-2.5 text-right font-extrabold text-slate-900 whitespace-nowrap">PKR ${fmt(g.net)}</td>
            <td class="p-2.5 whitespace-nowrap">${mode}</td>
            <td class="p-2.5 whitespace-nowrap no-print" data-k="${esc(g.key)}"><button onclick="printGroupSlip(this.parentNode.dataset.k)" title="Print one slip for all items" class="px-1.5 hover:bg-slate-100 rounded">🖨️</button><button onclick="deleteGroupTx(this.parentNode.dataset.k)" title="Delete all items of this bill" class="px-1.5 hover:bg-rose-50 rounded">🗑️</button></td></tr>
            ${isOpen ? g.rows.map(t => itemRow(t, true)).join('') : ''}`;
    }
    function groupCard(g) {
        const isOpen = open.has(g.key), n = g.rows.length;
        return `<div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
            <div class="flex justify-between items-center gap-2"><span class="no-print"><input type="checkbox" data-gk="${esc(g.key)}" onchange="selectTxGroup(this.dataset.gk,this.checked)" class="w-4 h-4 rounded"></span>${kindBadge(g.kind)}<span class="text-xs text-slate-500">${fmtDate(g.date)}</span></div>
            <div class="font-bold text-slate-800 text-sm mt-2">${esc(g.party)}</div>
            <div class="flex items-end justify-between mt-2"><button type="button" data-k="${esc(g.key)}" onclick="toggleTxGroup(this.dataset.k)" class="px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 text-xs font-bold">${isOpen ? '−' : '+'} ${n} items</button><div class="text-lg font-extrabold text-slate-900">PKR ${fmt(g.net)}</div></div>
            ${isOpen ? `<div class="mt-3 border-t pt-2 space-y-2">${g.rows.map(t => `<div class="rounded-xl bg-indigo-50/40 p-2.5"><div class="flex justify-between gap-2"><button type="button" onclick="openItemLedger(${q(t.key)})" class="text-left text-xs font-semibold text-indigo-700">${esc(t.title)}</button><b class="text-xs">PKR ${fmt(t.net)}</b></div><div class="text-[11px] text-slate-500">${fmt(t.qty)} × ${fmt(t.unit)}${t.discount ? ' · disc ' + fmt(t.discount) : ''} · ${esc(t.voucher || '')}</div><div class="flex justify-between items-center mt-1"><span class="no-print">${itemCheckbox(t)}</span><span>${rowActions(t)}</span></div></div>`).join('')}</div>` : ''}
            <div class="flex justify-end gap-1 mt-2 border-t pt-2" data-k="${esc(g.key)}"><button onclick="printGroupSlip(this.parentNode.dataset.k)" class="px-1.5">🖨️</button><button onclick="deleteGroupTx(this.parentNode.dataset.k)" class="px-1.5">🗑️</button></div></div>`;
    }
    function singleCard(t) {
        return `<div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
            <div class="flex justify-between items-center gap-2"><span class="no-print">${itemCheckbox(t)}</span>${kindBadge(t.kind)}<span class="text-xs text-slate-500">${fmtDate(t.date)}</span></div>
            <button type="button" onclick="openItemLedger(${q(t.key)})" class="font-bold text-indigo-700 text-sm text-left mt-2 hover:underline">${esc(t.title || '-')}</button>
            <div class="text-xs text-slate-500">${esc(t.party || '-')}${t.voucher ? ' · ' + esc(t.voucher) : ''}</div>
            <div class="flex items-end justify-between mt-3"><div class="text-xs text-slate-500">${fmt(t.qty)} × ${fmt(t.unit)}${t.discount ? ` · disc ${fmt(t.discount)}` : ''}</div><div class="text-lg font-extrabold text-slate-800">PKR ${fmt(t.net)}</div></div>
            <div class="flex justify-end gap-1 mt-2 border-t pt-2">${rowActions(t)}</div></div>`;
    }

    let shownRows = [];                // every transaction that is on screen (for "select all")
    window.renderTransactions = function () {
        const list = txList(), st = periodStats(list), units = buildUnits(list), shown = units.slice(0, txLimit);
        $('txCards').innerHTML = [
            { t: 'Sales', v: 'PKR ' + fmt(st.sales), c: 'text-emerald-600' }, { t: 'Purchases', v: 'PKR ' + fmt(st.purch), c: 'text-indigo-700' },
            { t: 'Sale returns', v: 'PKR ' + fmt(st.salesRet), c: 'text-amber-600' }, { t: 'Purchase returns', v: 'PKR ' + fmt(st.purchRet), c: 'text-rose-600' }
        ].map(card).join('');
        shownRows = shown.flatMap(u => u.single ? [u.single] : u.rows);
        selectedTxUids = new Set([...selectedTxUids].filter(uid => txByUid[uid] && canId(txByUid[uid])));
        const selVisible = shownRows.filter(t => selectedTxUids.has(t.uid)).length, allSel = shownRows.length > 0 && selVisible === shownRows.length;
        const grouped = units.filter(u => !u.single).length;
        $('txCount').innerText = `${list.length} transaction${list.length === 1 ? '' : 's'}${grouped ? ` · ${units.length} entries (${grouped} bills with several items are clubbed)` : ''}${shown.length < units.length ? ` · showing ${shown.length}` : ''}`;
        $('txSelectionBar').classList.toggle('hidden', !shown.length);
        $('txSelectAll').checked = allSel; $('txSelectAll').indeterminate = selVisible > 0 && !allSel;
        $('txSelectedCount').innerText = `${selectedTxUids.size} selected`; $('txDeleteSelected').disabled = selectedTxUids.size === 0;
        $('txBody').innerHTML = shown.length ? shown.map(u => u.single ? itemRow(u.single, false) : groupRow(u)).join('') : '<tr><td colspan="13" class="p-8 text-center text-slate-400">No transactions found in this period.</td></tr>';
        $('txCards2').innerHTML = shown.length ? shown.map(u => u.single ? singleCard(u.single) : groupCard(u)).join('') : '<div class="bg-white rounded-2xl border p-8 text-center text-slate-400 text-sm">No transactions found in this period.</div>';
        $('txMore').innerHTML = units.length > txLimit ? `<button onclick="txLimit+=200;renderTransactions()" class="bg-white border border-slate-200 hover:bg-slate-100 px-4 py-2 rounded-lg text-sm font-semibold">Show more (${units.length - txLimit} remaining)</button>` : '';
        document.querySelectorAll('input[data-gk]').forEach(cb => {          // a clubbed row is ticked when all its items are
            const g = groups.get(cb.dataset.gk); if (!g) return;
            const n = g.rows.filter(t => selectedTxUids.has(t.uid)).length;
            cb.checked = n === g.rows.length; cb.indeterminate = n > 0 && n < g.rows.length;
        });
    };
    window.toggleTxGroup = key => { if (open.has(key)) open.delete(key); else open.add(key); renderTransactions(); };
    window.selectTxGroup = (key, on) => { const g = groups.get(key); if (!g) return; g.rows.forEach(t => { if (!canId(t)) return; if (on) selectedTxUids.add(t.uid); else selectedTxUids.delete(t.uid); }); renderTransactions(); };
    window.toggleAllTx = on => { shownRows.forEach(t => { if (!canId(t)) return; if (on) selectedTxUids.add(t.uid); else selectedTxUids.delete(t.uid); }); renderTransactions(); };
    window.deleteGroupTx = key => {
        const g = groups.get(key); if (!g) return;
        if (g.rows.some(t => !canId(t))) { toast('Some items of this bill have no database id and cannot be deleted from here.', false); return; }
        selectedTxUids = new Set(g.rows.map(t => t.uid)); renderTransactions(); deleteSelectedTx();
    };
    window.printGroupSlip = key => {
        const g = groups.get(key); if (!g) return;
        const vendor = g.kind === 'purchase' || g.kind === 'purchase_return', gross = g.rows.reduce((s, t) => s + t.gross, 0);
        const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(KINDS[g.kind].label)} slip</title>
        <style>body{font-family:Arial,Helvetica,sans-serif;color:#0f172a;margin:0;padding:24px}.box{border:2px solid #1e1b4b;border-radius:6px;padding:20px;max-width:640px;margin:0 auto}
        h1{margin:0;font-size:20px;text-align:center;color:#1e1b4b}.sub{text-align:center;font-size:12px;color:#64748b;margin-bottom:10px}
        .ttl{text-align:center;font-weight:bold;font-size:14px;border-top:1px solid #cbd5e1;border-bottom:1px solid #cbd5e1;padding:6px 0;margin:10px 0 14px;letter-spacing:.5px}
        table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:6px 4px;text-align:left;border-bottom:1px solid #e2e8f0}th{background:#f1f5f9;font-size:12px}td.r,th.r{text-align:right}
        .tot td{border-top:2px solid #1e1b4b;font-weight:bold;font-size:15px}.sig{display:flex;justify-content:space-between;margin-top:40px;font-size:12px}.sig div{border-top:1px solid #334155;padding-top:4px;width:40%;text-align:center}</style></head><body><div class="box">
        <h1>Concept School</h1><div class="sub">Shibra Campus · Book Store</div><div class="ttl">${esc(KINDS[g.kind].label.toUpperCase())} SLIP</div>
        <p style="font-size:13px;margin:4px 0"><b>${vendor ? 'Vendor' : 'Student / Customer'}:</b> ${esc(g.party)}<br><b>Date:</b> ${fmtDate(g.date)}<br><b>Slip no:</b> ${esc(g.vouchers.join(', ') || '-')}</p>
        <table><thead><tr><th>#</th><th>Item</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Discount</th><th class="r">Net</th></tr></thead><tbody>
        ${g.rows.map((t, i) => `<tr><td>${i + 1}</td><td>${esc(t.title)}</td><td class="r">${fmt(t.qty)}</td><td class="r">${fmt(t.unit)}</td><td class="r">${t.discount ? fmt(t.discount) : '-'}</td><td class="r">${fmt(t.net)}</td></tr>`).join('')}
        <tr class="tot"><td colspan="2">Total (${g.rows.length} items)</td><td class="r">${fmt(g.qty)}</td><td></td><td class="r">${g.discount ? fmt(g.discount) : '-'}</td><td class="r">PKR ${fmt(g.net)}</td></tr></tbody></table>
        <p style="font-size:13px;margin-top:10px"><b>In words:</b> Rupees ${numToWords(g.net)} Only</p>
        <div class="sig"><div>Prepared by</div><div>${g.kind === 'sale' ? 'Received by' : 'Signature'}</div></div></div></body></html>`;
        const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
        document.body.appendChild(f); f.contentDocument.open(); f.contentDocument.write(html); f.contentDocument.close();
        setTimeout(() => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 1500); }, 300);
    };
    window.__booksGroup = { buildUnits, unitKey };
    try { renderTransactions(); } catch (e) { /* the page re-renders after it loads its data */ }
})();
