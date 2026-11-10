/* =====================================================================================
   Fee challans: A4 landscape, three copies per student (Student / Office / Bank)
   - choose a class (or the whole school) or one student
   - choose the month the challan is for; arrears are everything still unpaid up to the chosen date
     (a minus amount means the family paid in advance)
   Uses the data already loaded on the Fee Vouchers page (allFeesCache, allStudentsCache).
   ===================================================================================== */
const CHALLAN_KEY = 'shibra_challan_settings_v1';
const CHALLAN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const CHALLAN_DEFAULT = {
    school: 'Concept School Shibra Campus', city: 'Multan', account: 'Cash In Hand', fine: 0, copies: 3,
    notes: ['Please pay the school dues till due date. Failure to do so will result in a fine of Rs. 150.',
        'The bank will not accept monthly fee after the validity date of the fee challan.',
        'Rs. 50/- will be charged at the re-issuance of the fee challan.',
        'The school reserves the right to cancel admission in case of any fee default.',
        'In case of readmission, Rs. 1000/- will be charged along with the previous fee schedule of the student.'].join('\n')
};
const chSettings = () => { try { return Object.assign({}, CHALLAN_DEFAULT, JSON.parse(localStorage.getItem(CHALLAN_KEY) || '{}')); } catch (e) { return Object.assign({}, CHALLAN_DEFAULT); } };
const chMoney = n => (n < 0 ? '-' : '') + fmt(Math.abs(n));
const chRound = n => Math.round((Number(n) || 0) * 100) / 100;
const chDate = ymd => { if (!ymd) return ''; const d = new Date(ymd + 'T00:00:00'); return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-'); };
const chPeriodLabel = p => { const s = String(p || '').trim(); return /\d{4}/.test(s) ? s : (s ? `${s} ${SCHOOL_YEAR}` : ''); };
const chNatural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });

/* ---------- 1. who gets a challan, and what is on it ---------- */
function challanPlan(o) {
    const ym = `${SCHOOL_YEAR}-${String(o.month).padStart(2, '0')}`, mStart = r => periodStart(r.period);
    const pend = r => chRound((r.net ?? (parseFloat(r.payable) || 0)) - (parseFloat(r.totalPaid) || 0));   // + still owed, - paid in advance
    const stuByAdm = new Map(allStudentsCache.map(s => [normAdm(s.admis_no), s]));
    const groups = new Map();
    allFeesCache.forEach(r => { const adm = normAdm(r.admis_no), key = adm || 'n:' + String(r.student_name || '').trim().toLowerCase(); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(r); });
    const list = [], skipped = { noVoucher: 0, nothing: 0, left: 0 }, q = String(o.student || '').trim().toLowerCase();
    groups.forEach(rows => {
        const first = rows[0], st = stuByAdm.get(normAdm(first.admis_no)) || {}, cls = String(first.class || st.class || '').trim();
        if (o.cls && o.cls !== 'ALL' && cls !== o.cls) return;
        if (q && !`${first.student_name} ${first.admis_no}`.toLowerCase().includes(q)) return;
        if (st.status && !/^active$/i.test(String(st.status).trim()) && !o.includeLeft) { skipped.left++; return; }
        const arr = rows.filter(r => Math.abs(pend(r)) > 0.004 && ((isArr(r) && mStart(r).slice(0, 7) <= ym) || (!isArr(r) && mStart(r).slice(0, 7) < ym && mStart(r) <= o.asOf)))
            .sort((a, b) => mStart(a).localeCompare(mStart(b)) || String(a.type).localeCompare(String(b.type)));
        const cur = rows.filter(r => !isArr(r) && mStart(r).slice(0, 7) === ym && Math.abs(pend(r)) > 0.004);
        if (!rows.some(r => !isArr(r) && mStart(r).slice(0, 7) === ym) && !o.includeNoVoucher) { skipped.noVoucher++; return; }
        const arrTotal = chRound(arr.reduce((s, r) => s + pend(r), 0)), feeTotal = chRound(cur.reduce((s, r) => s + pend(r), 0));
        const payable = Math.max(0, chRound(arrTotal + feeTotal));
        if (payable <= 0.004 && !o.includeZero) { skipped.nothing++; return; }
        let lines = [...arr.map(r => ({ label: `${itemName(r)} - ${chPeriodLabel(r.period)}`.replace(/ - $/, ''), arr: pend(r) })), ...cur.map(r => ({ label: `${itemName(r)} - ${chPeriodLabel(r.period)}`.replace(/ - $/, ''), fee: pend(r) }))];
        const MAX = 11;                                                     // keep one challan on one page: merge the oldest arrears
        if (lines.length > MAX) {
            const nArr = lines.filter(l => l.arr !== undefined).length, take = Math.min(nArr, lines.length - MAX + 1);
            const merged = lines.slice(0, take);
            lines = [{ label: `Earlier dues (${take} items)`, arr: chRound(merged.reduce((s, l) => s + l.arr, 0)) }, ...lines.slice(take)];
        }
        list.push({ adm: first.admis_no || '', name: first.student_name || '', cls, sr: parseFloat(st.sr_no) || 0, phone: st.contact_no_father || st.contact_no_mother || '', family: first[FEES_SIBLINGS_COL] || st.siblings || '',
            lines, arrTotal, feeTotal, payable, afterDue: payable > 0 ? chRound(payable + (parseFloat(o.fine) || 0)) : 0, no: `${ym.replace('-', '')}-${first.admis_no || list.length + 1}` });
    });
    list.sort((a, b) => chNatural(a.cls, b.cls) || a.sr - b.sr || a.name.localeCompare(b.name));
    return { list, skipped, ym, total: chRound(list.reduce((s, c) => s + c.payable, 0)) };
}

/* ---------- 2. the printable document (A4 landscape) ---------- */
function challanHtml(plan, o) {
    const logo = new URL('assets/logo.png', document.baseURI).href, monthName = `${CHALLAN_MONTHS[o.month - 1]} ${SCHOOL_YEAR}`;
    const labels = ['STUDENT COPY', 'OFFICE COPY', 'BANK COPY'].slice(0, o.copies === 1 ? 1 : o.copies === 2 ? 2 : 3);
    const notes = String(o.notes || '').split('\n').map(s => s.trim()).filter(Boolean).map((s, i) => `${i + 1}. ${esc(s.replace(/^\d+[.)]\s*/, ''))}`).join('<br>');
    const copy = (c, label) => {
        const rows = c.lines.length ? c.lines.map(l => `<tr><td>${esc(l.label)}</td><td class="n">${l.arr !== undefined ? chMoney(l.arr) : ''}</td><td class="n">${l.fee !== undefined ? chMoney(l.fee) : ''}</td></tr>`).join('') : '<tr><td colspan="3" class="nd">No dues</td></tr>';
        return `<div class="copy">
          <div class="head"><img class="logo" src="${logo}" alt=""><div class="hd"><div class="sc">${esc(o.school)}</div><div class="ct">${esc(o.city)}</div><div class="ft">Fee Challan</div></div></div>
          <div class="box acct"><b>${esc(o.account)}</b></div>
          <div class="bar">Session ${SCHOOL_YEAR} (Jan-Dec)</div>
          <div class="box info">
            <div class="r two"><span><b>Challan #:</b> ${esc(c.no)}</span><span><b>Admission #:</b> ${esc(c.adm)}</span></div>
            <div class="r"><b>Name:</b> <b class="nm">${esc(c.name)}</b></div>
            <div class="r two"><span><b>Class:</b> ${esc(c.cls)}</span>${c.family ? `<span><b>Family:</b> ${esc(c.family)}</span>` : '<span></span>'}</div>
            ${c.phone ? `<div class="r"><b>Contact:</b> ${esc(c.phone)}</div>` : ''}
            <div class="r"><b>Fee Challan For the Month of:</b> <b>${esc(monthName)}</b></div>
          </div>
          <div class="box fee">
            <table><thead><tr><th>Fee Type</th><th class="n">Arrears</th><th class="n">Fee Amt</th></tr></thead><tbody>${rows}</tbody>
              <tfoot><tr class="tot"><td class="n">Total:</td><td class="n ul">${chMoney(c.arrTotal)}</td><td class="n ul">${chMoney(c.feeTotal)}</td></tr></tfoot></table>
            ${c.arrTotal < 0 || c.feeTotal < 0 ? '<div class="adv">A minus (-) amount is a fee already paid in advance.</div>' : ''}
            <div class="pay"><span>Amount Payable:</span><b class="dbl">${fmt(c.payable)}</b></div>
            <div class="pay"><span>Amount Payable After Due Date:</span><b class="dbl">${fmt(c.afterDue)}</b></div>
          </div>
          <div class="dates"><span><b>Due Date:</b> ${esc(chDate(o.due))}</span><span><b>Validity Date:</b> ${esc(chDate(o.valid))}</span></div>
          <div class="box notes">Note:<br>${notes}</div>
          <div class="lab">${label}</div>
        </div>`;
    };
    const sheets = plan.list.map(c => `<section class="sheet">${labels.map(l => copy(c, l)).join('')}</section>`).join('');
    return `<!doctype html><html><head><meta charset="utf-8"><title>Fee challans - ${esc(monthName)}</title><style>
      @page{size:A4 landscape;margin:7mm}
      *{box-sizing:border-box}html,body{margin:0;padding:0}
      body{font-family:Arial,Helvetica,sans-serif;color:#000;font-size:8.5pt;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      .sheet{height:195mm;display:flex;break-after:page;page-break-after:always;overflow:hidden}
      .sheet:last-child{break-after:auto;page-break-after:auto}
      .copy{flex:1 1 0;min-width:0;padding:0 3.2mm;border-right:1px dotted #666;display:flex;flex-direction:column}
      .copy:last-child{border-right:0}.copy:first-child{padding-left:0}
      .head{display:flex;align-items:center;gap:2mm;margin-bottom:1.6mm}
      .logo{width:19mm;height:auto;flex:0 0 auto}.hd{flex:1;text-align:center}
      .sc{font-size:10.5pt}.ct{font-size:8pt;margin:.6mm 0}.ft{font-size:11.5pt;font-weight:bold}
      .box{border:1px solid #000;border-radius:2mm;padding:1.4mm 2mm;margin-bottom:2.2mm}
      .acct{min-height:12mm}.bar{border:1px solid #000;border-radius:1.6mm;background:#e4e4e4;padding:1.2mm 2mm;font-weight:bold;margin-bottom:2.2mm}
      .info .r{margin:1.3mm 0;line-height:1.25}.info .two{display:flex;justify-content:space-between;gap:2mm}.nm{font-size:10pt;margin-left:1.5mm}
      .fee table{width:100%;border-collapse:collapse}.fee th{text-align:left;font-weight:bold;padding:.8mm 0 1.4mm;border-bottom:1px solid #000}
      .fee td{padding:.9mm 0;vertical-align:top}.n{text-align:right;white-space:nowrap}.fee th.n{padding-left:2mm}.fee td.n{padding-left:2mm}
      .nd{text-align:center;color:#444;padding:3mm 0}.tot td{font-weight:bold;padding-top:2mm}.ul{border-top:1px solid #000;border-bottom:1px solid #000}
      .adv{font-size:7pt;margin:1mm 0;color:#222}
      .pay{display:flex;justify-content:flex-end;align-items:baseline;gap:3mm;font-weight:bold;margin-top:2mm}.pay b{font-size:10.5pt;min-width:22mm;text-align:right}
      .dbl{border-bottom:3px double #000;padding-bottom:.4mm}
      .dates{display:flex;justify-content:space-between;margin:0 0 2mm}
      .notes{font-size:7.4pt;line-height:1.3;padding:1.4mm 2mm;margin-bottom:0}
      .lab{margin-top:auto;text-align:center;font-size:8pt;padding-top:2mm}
    </style></head><body>${sheets}</body></html>`;
}

/* ---------- 3. the popup ---------- */
const chEl = id => document.getElementById(id);
function studentChallanOptions(adm, name, cls, period) {
    const periodText = String(period || '').trim().toLowerCase();
    let monthIndex = CHALLAN_MONTHS.findIndex(month =>
        periodText.includes(month.toLowerCase()) || periodText.includes(month.slice(0, 3).toLowerCase()));
    if (monthIndex < 0 && typeof parsePeriod === 'function') {
        monthIndex = CHALLAN_MONTHS.indexOf(parsePeriod(period));
    }
    if (monthIndex < 0) throw new Error(`Could not determine the fee month for ${period || 'this voucher'}.`);
    const month = monthIndex + 1, settings = chSettings(), asOf = typeof sbToday === 'function' ? sbToday() : today();
    const monthText = String(month).padStart(2, '0');
    return {
        cls: String(cls || 'ALL').trim(), student: String(adm || name || '').trim(), month, asOf,
        due: `${SCHOOL_YEAR}-${monthText}-01`, valid: `${SCHOOL_YEAR}-${monthText}-28`,
        fine: Number(settings.fine) || 0, copies: Number(settings.copies) || 3,
        includeLeft: true, includeNoVoucher: false, includeZero: true,
        account: settings.account, notes: settings.notes, school: settings.school, city: settings.city
    };
}
function chForm() {
    const s = chSettings();
    return { cls: chEl('chClass').value, student: chEl('chStudent').value, month: +chEl('chMonth').value, asOf: chEl('chAsOf').value, due: chEl('chDue').value, valid: chEl('chValid').value,
        fine: parseFloat(chEl('chFine').value) || 0, copies: +chEl('chCopies').value, includeLeft: chEl('chLeft').checked, includeNoVoucher: chEl('chNoVoucher').checked, includeZero: chEl('chZero').checked,
        account: chEl('chAccount').value.trim() || s.account, notes: chEl('chNotes').value, school: chEl('chSchool').value.trim() || s.school, city: chEl('chCity').value.trim() || s.city };
}
function openChallanModal() {
    if (!allFeesCache.length) { showAlert('Fee vouchers are still loading, or none exist yet. Please try again in a moment.'); return; }
    const s = chSettings(), td = typeof sbToday === 'function' ? sbToday() : today();
    const classes = [...new Set(allFeesCache.map(r => String(r.class || '').trim()).filter(Boolean))].sort(chNatural);
    chEl('chClass').innerHTML = '<option value="ALL">All classes (whole school)</option>' + classes.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    chEl('chMonth').innerHTML = CHALLAN_MONTHS.map((m, i) => `<option value="${i + 1}">${m} ${SCHOOL_YEAR}</option>`).join('');
    const nowM = +td.slice(5, 7), sameYear = String(SCHOOL_YEAR) === td.slice(0, 4);
    chEl('chMonth').value = String(sameYear ? Math.min(12, nowM + 1) : 1);
    chEl('chAsOf').value = td; chEl('chStudent').value = '';
    chEl('chFine').value = s.fine; chEl('chCopies').value = String(s.copies); chEl('chAccount').value = s.account; chEl('chNotes').value = s.notes; chEl('chSchool').value = s.school; chEl('chCity').value = s.city;
    chEl('chLeft').checked = false; chEl('chNoVoucher').checked = false; chEl('chZero').checked = false;
    chMonthChanged(); chEl('challanModal').classList.add('open');
}
function chMonthChanged() {
    const m = String(chEl('chMonth').value).padStart(2, '0');
    chEl('chDue').value = `${SCHOOL_YEAR}-${m}-01`; chEl('chValid').value = `${SCHOOL_YEAR}-${m}-28`; chRefresh();
}
function chClassChanged() {
    const cls = chEl('chClass').value, seen = new Map();
    allFeesCache.forEach(r => { if (cls !== 'ALL' && String(r.class || '').trim() !== cls) return; const k = normAdm(r.admis_no) || r.student_name; if (!seen.has(k)) seen.set(k, `${r.student_name} (Adm ${r.admis_no || '-'})`); });
    chEl('chStudentList').innerHTML = [...seen.values()].sort().map(v => `<option value="${esc(v)}">`).join(''); chEl('chStudent').value = ''; chRefresh();
}
function chRefresh() {
    const f = chForm(), plan = challanPlan(Object.assign({}, f, { student: f.student.replace(/\s*\(Adm .*\)$/, '') }));
    const sk = plan.skipped, notes = [];
    if (sk.noVoucher) notes.push(`${sk.noVoucher} without a ${CHALLAN_MONTHS[f.month - 1]} voucher (create the vouchers first)`);
    if (sk.nothing) notes.push(`${sk.nothing} with nothing to pay`);
    if (sk.left) notes.push(`${sk.left} left students`);
    chEl('chSummary').innerHTML = `<b>${fmt(plan.list.length)}</b> challan${plan.list.length === 1 ? '' : 's'} · ${fmt(plan.list.length * (f.copies || 3))} copies · total payable <b>PKR ${fmt(plan.total)}</b>${notes.length ? `<div class="text-[11px] text-amber-700 mt-1">Skipped: ${esc(notes.join(' · '))}</div>` : ''}`;
    chEl('chPreview').innerHTML = plan.list.slice(0, 8).map(c => `<tr class="border-b"><td class="p-1.5">${esc(c.cls)}</td><td class="p-1.5">${esc(c.name)} <span class="text-slate-400">#${esc(c.adm)}</span></td><td class="p-1.5 text-right">${chMoney(c.arrTotal)}</td><td class="p-1.5 text-right">${chMoney(c.feeTotal)}</td><td class="p-1.5 text-right font-bold">${fmt(c.payable)}</td></tr>`).join('')
        + (plan.list.length > 8 ? `<tr><td colspan="5" class="p-1.5 text-slate-400">… and ${fmt(plan.list.length - 8)} more</td></tr>` : '') || '<tr><td colspan="5" class="p-3 text-center text-slate-400">No student matches these choices.</td></tr>';
}
const closeChallanModal = () => chEl('challanModal').classList.remove('open');
async function printChallanPlan(plan, f) {
    if (!plan.list.length) { showAlert('There are no challans to print for these choices.'); return; }
    try { localStorage.setItem(CHALLAN_KEY, JSON.stringify({ school: f.school, city: f.city, account: f.account, fine: f.fine, copies: f.copies, notes: f.notes })); } catch (e) {}
    const fr = document.createElement('iframe'); fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'; document.body.appendChild(fr);
    fr.contentDocument.open(); fr.contentDocument.write(challanHtml(plan, f)); fr.contentDocument.close();
    await Promise.all([...fr.contentDocument.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; })));
    setTimeout(() => { fr.contentWindow.focus(); fr.contentWindow.print(); setTimeout(() => fr.remove(), 120000); }, 200);
}
async function printChallans() {
    const f = chForm(); f.student = f.student.replace(/\s*\(Adm .*\)$/, '');
    return printChallanPlan(challanPlan(f), f);
}
function printStudentChallan(adm, name, cls, period) {
    let f;
    try { f = studentChallanOptions(decodeURIComponent(adm), decodeURIComponent(name), decodeURIComponent(cls), decodeURIComponent(period)); }
    catch (error) { showAlert(error.message || 'Could not prepare this student’s fee challan.'); return; }
    return printChallanPlan(challanPlan(f), f);
}
