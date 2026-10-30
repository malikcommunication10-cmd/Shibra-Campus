const SUPABASE_URL = SB_URL;
const SUPABASE_KEY = SB_KEY;
const H = {apikey:SUPABASE_KEY, Authorization:`Bearer ${SUPABASE_KEY}`};
const HJ = {...H,"Content-Type":"application/json",Prefer:"return=minimal"};

const FEES_ARREARS_COL='arrears2025', FEES_SIBLINGS_COL='siblings';
const STUDENT_ARREARS_COLS=['arrears2025'], STUDENT_SIBLINGS_COL='siblings';
const ARREARS_SOURCE_YEAR=2025;
let SCHOOL_YEAR = new Date().getFullYear();
let ARREARS_PERIOD = `January ${SCHOOL_YEAR}`;
let MONTHS = [];
let monthOrder = {};
function setFeeSchoolYear(year) {
  SCHOOL_YEAR = year;
  ARREARS_PERIOD = `January ${year}`;
  MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"].map(m=>`${m} ${year}`);
  monthOrder = {};
  MONTHS.forEach((m,i)=>monthOrder[m]=i+1);
}
setFeeSchoolYear(SCHOOL_YEAR);

let accountsRaw=[],importPlan=null,syncItems=[],allFeesCache=[], allStudentsCache=[], incrementsCacheMap={}, accountsDataMap={}, filtered=[];

const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const isArr=r=>(r.type||'').trim().toLowerCase()==='arrears';
const today=()=>new Date().toISOString().split('T')[0];
const fmt=n=>Number(n||0).toLocaleString('en-PK');
const showLoading=t=>{$('loadingText').innerText=t||'Processing...';$('loadingOverlay').classList.remove('hidden');$('loadingOverlay').classList.add('flex')};
const hideLoading=()=>{$('loadingOverlay').classList.add('hidden');$('loadingOverlay').classList.remove('flex')};
const showAlert=m=>{$('alertMsg').innerText=m;$('alertModal').classList.add('open')};
const closeAlert=()=>$('alertModal').classList.remove('open');
function showConfirm(msg,cb){
  $('confirmMsg').innerText=msg;$('confirmModal').classList.add('open');
  for(const id of ['confirmYes','confirmNo']){const o=$(id),n=o.cloneNode(true);o.replaceWith(n);}
  $('confirmYes').onclick=()=>{$('confirmModal').classList.remove('open');cb(true)};
  $('confirmNo').onclick=()=>$('confirmModal').classList.remove('open');
}
function toggleMenu(){$('sidebar').classList.toggle('-translate-x-full');$('menuBackdrop').classList.toggle('hidden')}
function toggleGen(){$('genBox').classList.toggle('hidden');$('genArrow').innerText=$('genBox').classList.contains('hidden')?'▼':'▲'}

function getStudentArrears(st){for(const c of STUDENT_ARREARS_COLS){if(st[c]!=null&&String(st[c]).trim()!=='')return String(st[c]).trim()}return null}
function getStudentSiblings(st){const v=st[STUDENT_SIBLINGS_COL];return(v==null||String(v).trim()==='')?null:String(v).trim()}

/* ---------- Voucher numbering ---------- */
const vNum=id=>{const m=String(id||'').match(/^V-(\d+)/i);return m?parseInt(m[1],10):null};
const startVal=st=>{const m=String(st.doj||'').match(/^(\d{4})-(\d{2})/);return m?(+m[1])*12+(+m[2]):null};
function showWarn(miss,nolf){
  const mk=(o,t)=>{const k=Object.values(o);return k.length?`<div><b>${t} (${k.length}):</b> ${k.slice(0,15).map(x=>esc(`${x.admis_no||''} ${x.student_name||''} (${x.class||''})`)).join(', ')}${k.length>15?' ...':''}</div>`:''};
  const b=$('warnBox');
  b.innerHTML=mk(miss,'DOJ missing, vouchers skipped. Fill it in <a href="students.html" class="underline font-semibold">Students Directory</a>')+mk(nolf,'Status inactive but left_date missing, skipped');
  b.classList.toggle('hidden',!b.innerHTML);
}
function highestVoucherNo(){let mx=0;allFeesCache.forEach(f=>{const n=vNum(f.voucher_id);if(n&&n>mx)mx=n});return mx}
function vidMode(){return document.querySelector('input[name=vidMode]:checked').value}
function vidModeChange(){$('manualBox').classList.toggle('hidden',vidMode()!=='manual');updateVidHint()}
function parseStart(){const d=$('vidStart').value.replace(/\D/g,'');return d?parseInt(d,10):null}
function updateVidHint(){
  const mx=highestVoucherNo(), s=parseStart();
  $('vidHint').innerText=(mx?`Highest existing: V-${mx}. `:'No existing numbered vouchers. ')+(s?`Will start from V-${s} (used numbers are skipped).`:'');
}
function makeVidGenerator(used){
  if(vidMode()==='manual'){
    let cur=parseStart(); if(!cur) return null;
    return ()=>{while(used.has(cur))cur++;used.add(cur);return 'V-'+(cur++)};
  }
  return ()=>{let n;do{n=Math.floor(100000+Math.random()*900000)}while(used.has(n));used.add(n);return 'V-'+n};
}

/* ---------- Load ---------- */
async function initFeePage(){
  showLoading("Loading data...");
  const settingsPromise = loadSettingLists();
  $('payDate').value=today();$('bulkPayDate').value=today();$('selectAllCheckbox').checked=false;
  let loaded;
  try {
    loaded = await Promise.all([settingsPromise, ERP.db.feeVoucherData()]);
    setFeeSchoolYear(await getSchoolYear());
    payChoices = await fillPaySelects(['payToAccount','bulkAccount']);
  } catch (e) {
    console.error(e);
    hideLoading();
    $('feesTableBody').innerHTML=`<tr><td colspan="15" class="nl p-6 text-center text-rose-500">Failed to load records. Check your internet connection.</td></tr>`;
    return;
  }
  if(!$('voucherPeriod').options.length){
    $('voucherPeriod').innerHTML=MONTHS.map(m=>`<option>${m}</option>`).join('')+`<option value="ALL_YEAR">🚀 Generate all (Jan to Dec ${SCHOOL_YEAR})</option>`;
    const mo=MONTHS.map((m,i)=>`<option value="${i+1}">${m}</option>`).join('');
    $('fromMonth').innerHTML=mo;$('toMonth').innerHTML=mo;resetRange(true);
  }
  try{
    const [,data]=loaded;
    const {students,increments,accounts,fees}=data;
    if(Array.isArray(students)){allStudentsCache=students;populateClassDropdown(students)}
    incrementsCacheMap={};
    if(Array.isArray(increments))increments.forEach(i=>{const a=(i.admis_no||'').trim().toLowerCase();if(a)incrementsCacheMap[a]=i});
    accountsDataMap={};accountsRaw=Array.isArray(accounts)?accounts:[];
    if(Array.isArray(accounts))accounts.forEach(r=>{
      const vId=(r.voucher_id||'').trim().split('-').slice(0,2).join('-');if(!vId)return;
      const o=accountsDataMap[vId]??={totalPaid:0,dates:new Set(),transactions:[]};
      o.totalPaid+=parseFloat(r.amount_in)||0;if(r.date)o.dates.add(String(r.date).trim());o.transactions.push(r);
    });
    if(Array.isArray(fees)){
      allFeesCache=fees.map(row=>{
        const vId=(row.voucher_id||'').trim(),payable=parseFloat(row.payable)||0;
        const acc=accountsDataMap[vId]||{totalPaid:0,dates:new Set()};
        const paid=acc.totalPaid,disc=parseFloat(row.discount)||0,net=payable-disc;
        return{...row,discount:disc,net,totalPaid:paid,balance:net-paid,
          status:(paid>=net&&(net>0||disc>0))?'Paid':(paid>0?'Partial':'Unpaid'),
          paymentDates:acc.dates.size?[...acc.dates].join(', '):'-'};
      });
      regroupFees();populateItemFilter();renderAfBanner();populatePeriodDropdown(allFeesCache);filterVouchers();updateVidHint();renderPicker();
      if(!window.__ledgerDeepLink){window.__ledgerDeepLink=true;const q=new URLSearchParams(location.search).get('student');if(q){const hit=allFeesCache.find(x=>normAdm(x.admis_no)===normAdm(q));if(hit)openStudentLedger(hit.student_name,hit.admis_no)}}
    }else{allFeesCache=[];$('feesTableBody').innerHTML=`<tr><td colspan="15" class="nl p-6 text-center text-slate-400">No fee vouchers found.</td></tr>`}
  }catch(e){console.error(e);$('feesTableBody').innerHTML=`<tr><td colspan="15" class="nl p-6 text-center text-rose-500">Failed to load records. Check your internet connection.</td></tr>`}
  hideLoading();
}
function populateClassDropdown(data){
  const set=new Set();data.forEach(r=>{if(r.class)set.add(r.class.trim())});
  $('voucherClassSelect').innerHTML=`<option value="ALL">All classes</option>`+[...set].sort().map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
}
function populatePeriodDropdown(data){
  const set=new Set();data.forEach(r=>{if(r.period)set.add(r.period.trim())});
  const cur=$('filterPeriod').value;
  $('filterPeriod').innerHTML=`<option value="ALL">All periods</option>`+[...set].sort((a,b)=>(monthOrder[a]||99)-(monthOrder[b]||99)).map(p=>`<option value="${esc(p)}">${esc(p)}</option>`).join('');
  if(set.has(cur))$('filterPeriod').value=cur;
}
function filterVouchers(){
  const p=$('filterPeriod').value,s=$('filterStatus').value,q=$('searchInput').value.trim().toLowerCase();
  let t=allFeesCache;
  if(p!=='ALL')t=t.filter(r=>(r.period||'').trim()===p);
  
  const mf=+$('fromMonth').value||1,mt=+$('toMonth').value||12;
  const inR=r=>{const m=monthOrder[(r.period||'').trim()];return!m||(m>=mf&&m<=mt)};
  if(!q)t=t.filter(inR);
  t.forEach(r=>{r._out=!inR(r)});
  if(q)t=t.filter(r=>(r.voucher_id||'').toLowerCase().includes(q)||(r.student_name||'').toLowerCase().includes(q)||(r.admis_no||'').toLowerCase().includes(q));
  const itf=$('filterItem').value;
 if(itf!=='ALL'){const okv=new Set(t.filter(r=>(r.type||'').trim().toLowerCase()===itf).map(r=>(r.voucher_id||'').trim()));t=t.filter(r=>okv.has((r.voucher_id||'').trim()))}
 if(s!=='ALL'){const ok=new Set(buildGroups(t).filter(g=>g.status===s).map(g=>g.vid));t=t.filter(r=>ok.has((r.voucher_id||'').trim()))}
 filtered=t;renderFeesTable(t);renderStudentSummary();
}
let viewMode='vouchers';
function toggleView(){
  viewMode=viewMode==='vouchers'?'summary':'vouchers';
  $('voucherView').classList.toggle('hidden',viewMode==='summary');
  $('summaryView').classList.toggle('hidden',viewMode!=='summary');
  $('viewBtn').innerText=viewMode==='summary'?'🧾 Voucher list':'👥 Student summary';
  renderStudentSummary();
}
function renderStudentSummary(){
  const mt=+$('toMonth').value||12,q=$('searchInput').value.trim().toLowerCase();
  const lbl=($('toMonth').selectedOptions[0]||{}).text||'Month';
  const by={};
  allFeesCache.forEach(r=>{
    const m=monthOrder[(r.period||'').trim()];if(!m)return;
const k=normAdm(r.admis_no)||String(r.student_name||'').toLowerCase();
const o=by[k]??={adm:r.admis_no,name:r.student_name,cls:r.class,prev:0,pay:0,paid:0,bal:0};
const net=r.net??(parseFloat(r.payable)||0),paid=parseFloat(r.totalPaid)||0;
if(m>mt){o.bal-=paid;return}
o.bal+=net-paid;
    if(m<mt)o.prev+=net-paid;else{o.pay+=net;o.paid+=paid}
  });
  let list=Object.values(by).filter(o=>!q||(o.name||'').toLowerCase().includes(q)||String(o.adm||'').toLowerCase().includes(q)).sort((a,b)=>b.bal-a.bal);
  const T={prev:0,pay:0,paid:0,bal:0};
  $('sumHead').innerHTML=`<tr><th>Adm No</th><th>Student</th><th>Class</th><th>Previous balance</th><th>${esc(lbl)} payable</th><th>${esc(lbl)} paid</th><th>Total balance</th></tr>`;
  $('sumBody').innerHTML=list.map(o=>{
    T.prev+=o.prev;T.pay+=o.pay;T.paid+=o.paid;T.bal+=o.bal;
    return`<tr><td data-l="Adm No" class="font-mono">${esc(o.adm)||'-'}</td>
    <td data-l="Student" class="font-semibold"><a href="javascript:void(0)" onclick="openStudentLedger(decodeURIComponent('${encodeURIComponent(o.name||'')}'),decodeURIComponent('${encodeURIComponent(o.adm||'')}'))" class="text-indigo-600 underline">${esc(o.name)||'-'}</a></td>
    <td data-l="Class">${esc(o.cls)||'-'}</td>
    <td data-l="Previous balance" class="${o.prev>0?'text-rose-600 font-bold':''}">PKR ${fmt(o.prev)}</td>
    <td data-l="${esc(lbl)} payable">PKR ${fmt(o.pay)}</td>
    <td data-l="${esc(lbl)} paid" class="text-emerald-600 font-bold">PKR ${fmt(o.paid)}</td>
    <td data-l="Total balance" class="font-extrabold ${o.bal>0?'text-rose-600':o.bal<0?'text-indigo-600':'text-slate-500'}">${o.bal<0?'Adv '+fmt(-o.bal):'PKR '+fmt(o.bal)}</td></tr>`}).join('')
    +(list.length?`<tr class="bg-slate-100 font-bold"><td colspan="3" class="nl text-right">Total (${list.length} students, up to ${esc(lbl)}):</td><td data-l="Previous">PKR ${fmt(T.prev)}</td><td data-l="Payable">PKR ${fmt(T.pay)}</td><td data-l="Paid">PKR ${fmt(T.paid)}</td><td data-l="Balance" class="text-rose-600">PKR ${fmt(T.bal)}</td></tr>`:`<tr><td colspan="7" class="nl p-6 text-center text-slate-400">No students found.</td></tr>`);
}
function parsePeriod(x) {
  const t = String(x || '').trim().toLowerCase(); if(!t) return null;
  let m = null, y = (t.match(/(20\d\d)/) || [])[1] || String(SCHOOL_YEAR);
  const names = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  for(let i = 0; i < 12; i++) if(t.includes(names[i])) { m = i; break; }
  if(m === null) { const n = t.match(/^(\d{1,2})[\/\-.](20\d\d)$/) || t.match(/^(20\d\d)[\/\-.](\d{1,2})$/); if(n) { const a = +n[1], b = +n[2]; m = (a > 31 ? b : a) - 1; y = String(a > 31 ? a : b); } }
  if(m === null || m < 0 || m > 11 || y !== String(SCHOOL_YEAR)) return null;
  return MONTHS[m];
}
const periodNum = x => monthOrder[parsePeriod(x)] || 0;

function planAnnualFund(withIds) {
  const selPeriod = $('voucherPeriod').value === 'ALL_YEAR' ? null : $('voucherPeriod').value;
  const used = new Set(); allFeesCache.forEach(f => { const n = vNum(f.voucher_id); if(n) used.add(n); });
  const nextId = withIds ? makeVidGenerator(used) : (() => 'V-0');
  const vmap = new Map(); allFeesCache.forEach(f => { const k = `${normAdm(f.admis_no)}_${(f.period || '').trim()}`; if(!vmap.has(k)) vmap.set(k, (f.voucher_id || '').trim()); });
  const vidFor = (st, period) => { const k = `${normAdm(st.admis_no)}_${period}`; let v = vmap.get(k); if(!v) { v = nextId(); vmap.set(k, v); } return v; };
  const keys = new Set(); allFeesCache.forEach(f => keys.add(`${normAdm(f.admis_no)}_${(f.period || '').trim()}_${(f.type || '').trim().toLowerCase()}`));
  const out = [], skip = { exists: 0, noStudent: 0, notEligible: 0, noPeriod: 0, notAnnual: 0 }, byMonth = {}; let usedSel = 0, rules = 0;
  Object.values(incrementsCacheMap).forEach(inc => {
    if(!(parseFloat(inc.annual_fund) > 0)) return;
    rules++;
    if(!/annual/i.test(inc.fee_type || '')) { skip.notAnnual++; return; }
    let period = parsePeriod(inc.effective_period);
    if(!period && selPeriod) { period = selPeriod; usedSel++; }
    if(!period) { skip.noPeriod++; return; }
    const st = allStudentsCache.find(x => normAdm(x.admis_no) === normAdm(inc.admis_no));
    if(!st) { skip.noStudent++; return; }
    if(eligibility(st, period) !== 'ok') { skip.notEligible++; return; }
    const key = `${normAdm(st.admis_no)}_${period}_annual fund`;
    if(keys.has(key)) { skip.exists++; return; }
    keys.add(key);
    out.push({ sr_no: st.sr_no || '', voucher_id: vidFor(st, period), admis_no: st.admis_no || '', student_name: st.student_name || '', type: 'annual fund', period, payable: parseFloat(inc.annual_fund), class: st.class || '', status: 'Unpaid', date: today(), remarks: inc.remarks || '', [FEES_SIBLINGS_COL]: getStudentSiblings(st), [FEES_ARREARS_COL]: null });
    byMonth[period] = (byMonth[period] || 0) + 1;
  });
  return { out, skip, byMonth, usedSel, selPeriod, rules };
}
// a banner on top of the list tells when annual fund set in Bulk Updation is not in the vouchers yet
function renderAfBanner() {
  const b = $('afBanner'); if(!b) return;
  let P; try { P = planAnnualFund(false); } catch (e) { b.classList.add('hidden'); return; }
  const months = Object.entries(P.byMonth).sort((x, y) => (monthOrder[x[0]] || 99) - (monthOrder[y[0]] || 99)).map(([m, n]) => `${m}: ${n}`).join(', ');
  const sk = P.skip, why = [sk.notEligible && `${sk.notEligible} not eligible (joined later / left)`, sk.noStudent && `${sk.noStudent} student not found`, sk.noPeriod && `${sk.noPeriod} without an effective month`, sk.notAnnual && `${sk.notAnnual} whose fee type is not "annual fund"`].filter(Boolean).join(', ');
  if(P.out.length) { b.innerHTML = `<span>🎁 <b>${P.out.length}</b> annual fund item(s) set in Bulk Updation are not in the vouchers yet (${esc(months)}).${why ? ' Skipped: ' + esc(why) + '.' : ''}</span><button onclick="generateAnnualFund()" class="btn b-pri">Create them now</button>`; b.classList.remove('hidden'); }
  else if(why) { b.innerHTML = `<span>🎁 Annual fund in Bulk Updation: ${P.rules} row(s), ${sk.exists} already in vouchers. Skipped: ${esc(why)}.</span>`; b.classList.remove('hidden'); }
  else b.classList.add('hidden');
}
async function generateAnnualFund() {
  if(!allStudentsCache.length) { showAlert("No students found in students directory!"); return; }
  if(vidMode() === 'manual' && !parseStart()) { showAlert("Please enter a starting voucher number, e.g. V-586545."); return; }
  const { out, skip, byMonth, usedSel, selPeriod } = planAnnualFund(true);
  const sk = `\n\nSkipped: ${skip.exists} already have it, ${skip.notEligible} not eligible (joined later / left), ${skip.noStudent} student not found, ${skip.noPeriod} no effective month, ${skip.notAnnual} fee type is not "annual fund".`;
  if(!out.length) { showAlert("No annual fund vouchers to create." + sk + (usedSel ? '' : `\n\nTip: in Bulk Updation the Effective period must be a month like "October ${SCHOOL_YEAR}".`)); return; }
  showConfirm(`${out.length} annual fund item(s) will be added (to the student's voucher of that month, or a new voucher if there is none):\n` + Object.entries(byMonth).map(([m, n]) => `${m}: ${n}`).join(', ') + (usedSel ? `\n(${usedSel} had no effective month, so ${selPeriod} is used)` : '') + sk + `\n\nProceed?`, async () => {
    showLoading("Creating annual fund vouchers...");
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/fees`, { method: 'POST', headers: HJ, body: JSON.stringify(out) });
      hideLoading();
      if(res.ok) { showAlert("Annual fund vouchers created!"); initFeePage(); } else showAlert(feeErr("Failed: " + await res.text()));
    } catch(e) { hideLoading(); console.error(e); showAlert("Error connecting to database."); }
  });
}
function regroupFees(){
  // several rows can share one voucher (admission voucher): split the voucher's payments over its rows
  const pa=splitVoucherPaid(allFeesCache,r=>r.net,r=>r.totalPaid,r=>r.type,r=>r.voucher_id,rowOrder),cnt={};
  allFeesCache.forEach(r=>{const v=(r.voucher_id||'').trim();cnt[v]=(cnt[v]||0)+1});
  allFeesCache.forEach((r,i)=>{const v=(r.voucher_id||'').trim();r._gn=cnt[v];
    if(cnt[v]>1){r.totalPaid=pa[i];r.balance=r.net-pa[i];r.status=(pa[i]>=r.net&&(r.net>0||r.discount>0))?'Paid':(pa[i]>0?'Partial':'Unpaid')}});
}
const feeErr=t=>/fees_pkey|unique_fee_voucher|\(voucher_id\)/.test(String(t))?'The fees table still forces every voucher number to be unique (a constraint on voucher_id), so one voucher cannot hold several fee rows. Run the SQL from the chat that removes it, then try again.\n\n'+String(t).slice(0,160):String(t);
const rowFilter=v=>`voucher_id=eq.${encodeURIComponent((v.voucher_id||'').trim())}&type=eq.${encodeURIComponent((v.type||'').trim())}&period=eq.${encodeURIComponent((v.period||'').trim())}`;
function populateItemFilter(){
  const set=new Set();allFeesCache.forEach(r=>{const t=(r.type||'').trim().toLowerCase();if(t)set.add(t)});
  const sel=$('filterItem'),cur=sel.value;
  sel.innerHTML='<option value="ALL">All fee items</option>'+[...set].sort((a,b)=>feeRank(a)-feeRank(b)||a.localeCompare(b)).map(t=>`<option value="${esc(t)}">${t==='arrears'?'Arrears':tcase(t)}</option>`).join('');
  if(set.has(cur))sel.value=cur;
}
let payChoices=[{value:'cash',label:'Cash'}];
const matchPay=t=>{const s=String(t||'').trim().toLowerCase();if(!s)return 'cash';const c=payChoices.find(o=>o.value.toLowerCase()===s||o.label.toLowerCase().replace(/^[^a-z0-9]+/,'')===s);return c?c.value:s};
function resetRange(silent){
  const d=new Date(),ci=d.getFullYear()===SCHOOL_YEAR?d.getMonth()+1:(d.getFullYear()>SCHOOL_YEAR?12:1);
  $('fromMonth').value=1;$('toMonth').value=ci;if(!silent)filterVouchers();
}
const isLocked=id=>{const a=accountsDataMap[(id||'').trim()];return!!(a&&a.transactions.length)};
function toggleSelectAll(m){document.querySelectorAll('.row-checkbox').forEach(cb=>{if(!cb.disabled)cb.checked=m.checked})}

let currentGroups=[];
const tcase=t=>String(t||'').replace(/\b\w/g,c=>c.toUpperCase());
const itemName=r=>isArr(r)?'Arrears':tcase(r.type||'tuition fee');
// one line per VOUCHER: all fee rows that share a voucher number are shown together as items
function buildGroups(rows){
  const m=new Map();
  rows.forEach(r=>{const v=(r.voucher_id||'').trim();let g=m.get(v);if(!g){g={vid:v,rows:[],_out:!!r._out};m.set(v,g)}g.rows.push(r)});
  return [...m.values()].map(g=>{
    const R=g.rows,f=R[0];
    g.net=R.reduce((s,r)=>s+(r.net??(parseFloat(r.payable)||0)),0);g.payable=R.reduce((s,r)=>s+(parseFloat(r.payable)||0),0);
    g.discount=R.reduce((s,r)=>s+(r.discount||0),0);g.paid=R.reduce((s,r)=>s+(parseFloat(r.totalPaid)||0),0);g.balance=g.net-g.paid;
    g.status=(g.paid>=g.net&&(g.net>0||g.discount>0))?'Paid':(g.paid>0?'Partial':'Unpaid');
    g.student=f.student_name;g.adm=f.admis_no;g.cls=f.class;g.period=f.period;g.sib=f[FEES_SIBLINGS_COL];g.dates=f.paymentDates;
    return g;
  });
}
function renderFeesTable(rowsIn){
  const groups=buildGroups(rowsIn);currentGroups=groups;
  const tb=$('feesTableBody'),tf=$('feesTableFooter');$('selectAllCheckbox').checked=false;
  if(!groups.length){tb.innerHTML=`<tr><td colspan="15" class="nl p-6 text-center text-slate-400">No vouchers found.</td></tr>`;tf.innerHTML='';
   ['stCount','stPayable','stPaid','stBal'].forEach(i=>$(i).innerText='0');return}
  let sp=0,sd=0,sb=0,html='';
  groups.forEach((g,i)=>{
    if(!g._out){sp+=g.net;sd+=g.paid;sb+=g.balance}
    const lock=isLocked(g.vid);
    const badge=g.status==='Paid'?'bg-emerald-50 text-emerald-700':g.status==='Partial'?'bg-blue-50 text-blue-700':'bg-amber-50 text-amber-700';
    const bc=g.balance<0?'text-indigo-600 font-extrabold':g.balance>0?'text-rose-600 font-bold':'text-slate-500';
    const bt=g.balance<0?`Adv ${fmt(-g.balance)}`:`PKR ${fmt(g.balance)}`;
    const onlyArr=g.rows.every(isArr);
    const chips=g.rows.map(r=>`<span class="inline-block mr-1 mb-1 px-2 py-0.5 rounded-md border text-[11px] ${isArr(r)?'bg-rose-50 border-rose-200 text-rose-700':(/annual/i.test(r.type||'')?'bg-amber-50 border-amber-300 text-amber-800':'bg-slate-50 border-slate-200 text-slate-700')}">${esc(itemName(r))} <b>${fmt(r.net??r.payable)}</b></span>`).join('');
    html+=`<tr class="${onlyArr?'bg-rose-50/60':'hover:bg-slate-50'} ${g._out?'opacity-50':''}">
 <td class="nl"><input type="checkbox" class="row-checkbox" data-voucher="${esc(g.vid)}"></td>
 <td data-l="Sr">${i+1}</td>
 <td data-l="Voucher" class="font-mono text-indigo-900">${esc(g.vid)||'-'}${lock?' <span title="Payment recorded in Accounts. Delete it there first.">🔒</span>':''}</td>
 <td data-l="Admis No" class="font-mono">${esc(g.adm)||'-'}</td>
 <td data-l="Student" class="font-semibold"><a href="javascript:void(0)" onclick="openStudentLedger(decodeURIComponent('${encodeURIComponent(g.student||'')}'),decodeURIComponent('${encodeURIComponent(g.adm||'')}'))" class="text-indigo-600 underline">${esc(g.student)||'-'}</a></td>
 <td data-l="Siblings">${esc(g.sib)||'-'}</td>
 <td data-l="Items" class="min-w-[160px]">${chips}</td>
 <td data-l="Period" class="text-indigo-600 font-medium">${esc(g.period)||'-'}</td>
 <td data-l="Payable" class="font-bold">PKR ${fmt(g.payable)}${g.discount>0?`<div class="text-[10px] text-indigo-600 font-semibold">Discount -${fmt(g.discount)}</div>`:''}</td>
 <td data-l="Paid" class="font-bold text-emerald-600">PKR ${fmt(g.paid)}</td>
 <td data-l="Balance" class="${bc}">${bt}</td>
 <td data-l="Class">${esc(g.cls)||'-'}</td>
 <td data-l="Status"><span class="badge ${badge}">${g.status}</span></td>
 <td data-l="Date(s)" class="font-mono text-indigo-700">${esc(g.dates)}</td>
 <td class="nl"><div class="flex gap-1 w-full md:w-auto"><button onclick="openPayModal('${esc(g.vid)}')" class="btn b-ok flex-1" style="padding:.35rem .5rem">💳 Pay</button><button onclick="openDiscount('${esc(g.vid)}')" class="btn b-gh flex-1" style="padding:.35rem .5rem">% Disc</button><button onclick="openAddItem('${esc(g.vid)}')" class="btn b-gh flex-1" style="padding:.35rem .5rem" title="Add another fee to this voucher">➕ Item</button></div></td></tr>`;
  });
  tb.innerHTML=html;
  $('stCount').innerText=groups.filter(g=>!g._out).length;$('stPayable').innerText=fmt(sp);$('stPaid').innerText=fmt(sd);$('stBal').innerText=sb<0?`Adv ${fmt(-sb)}`:fmt(sb);
  tf.innerHTML=`<div class="text-xs font-bold text-slate-700">Total (filtered): Payable ${fmt(sp)} | Paid ${fmt(sd)} | ${sb<0?'Advance '+fmt(-sb):'Balance '+fmt(sb)}${groups.some(g=>g._out)?' <span class="font-normal text-slate-400">(grey rows are outside the selected months, not counted)</span>':''}</div>
 <div class="flex gap-2"><button onclick="openBulkPayModal()" class="btn b-pri flex-1 md:flex-none">⚡ Bulk pay</button>
 <button onclick="sendWhatsAppReminders()" class="btn b-ok flex-1 md:flex-none">WhatsApp reminders</button></div>`;
}

/* ---------- CSV of the selected vouchers (or of everything in the list when nothing is ticked) ---------- */
function downloadVouchersCsv(){
  const sel=new Set([...document.querySelectorAll('.row-checkbox:checked')].map(c=>c.dataset.voucher));
  const list=sel.size?currentGroups.filter(g=>sel.has(g.vid)):currentGroups;
  if(!list.length){showAlert("There are no vouchers to download.");return}
  const q=v=>`"${String(v??'').replace(/"/g,'""')}"`;
  const head=['Voucher ID','Admis No','Student','Class','Period','Items','Payable','Discount','Net payable','Paid','Balance','Status','Payment date(s)'];
  const rows=list.map(g=>[g.vid,g.adm,g.student,g.cls,g.period,g.rows.map(r=>`${itemName(r)} ${r.net??r.payable}`).join(' | '),g.payable,g.discount,g.net,g.paid,g.balance,g.status,g.dates==='-'?'':g.dates]);
  const csv='\uFEFF'+[head,...rows].map(r=>r.map(q).join(',')).join('\r\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));
  a.download=`fee-vouchers-${today()}${sel.size?'-selected':''}.csv`;document.body.appendChild(a);a.click();a.remove();
}

function downloadArrearsReconciliation(){
  const norm=s=>String(s||'').trim().toLowerCase(),byAdmission=new Map(),byName=new Map();
  allFeesCache.filter(isArr).forEach(r=>{
    const adm=norm(r.admis_no),name=norm(r.student_name),key=adm||name;
    if(!key)return;
    const map=adm?byAdmission:byName,rows=map.get(key)||[];
    rows.push(r);map.set(key,rows);
  });
  const report=[],matchedRows=new Set();
  allStudentsCache.forEach(st=>{
    const adm=norm(st.admis_no),name=norm(st.student_name),source=parseFloat(String(st[STUDENT_ARREARS_COLS[0]]||'').replace(/,/g,''))||0;
    const rows=(adm&&(byAdmission.get(adm)||byName.get(name)))||byName.get(name)||[];
    rows.forEach(r=>matchedRows.add(r));
    if(source<=0&&!rows.length)return;
    const billed=rows.reduce((sum,r)=>sum+(Number(r.payable)||0),0);
    const paid=rows.reduce((sum,r)=>sum+(Number(r.totalPaid)||0),0);
    const balance=rows.reduce((sum,r)=>sum+(Number(r.balance)||0),0);
    let status;
    if(!rows.length)status='Source amount has no arrears voucher';
    else if(source<=0)status='Arrears voucher exists but source amount is zero';
    else if(Math.abs(source-billed)>0.01)status='Review: source and voucher amount differ';
    else status='Voucher exists; check remaining balance';
    report.push([st.admis_no||'',st.student_name||'',st.class||'',source,billed,paid,balance,rows.length,[...new Set(rows.map(r=>r.voucher_id).filter(Boolean))].join(' | '),status]);
  });
  allFeesCache.filter(isArr).forEach(r=>{
    if(matchedRows.has(r))return;
    report.push([r.admis_no||'',r.student_name||'',r.class||'',0,Number(r.payable)||0,Number(r.totalPaid)||0,Number(r.balance)||0,1,r.voucher_id||'','Arrears voucher has no matching student record']);
  });
  if(!report.length){showAlert('No 2025 arrears source amounts or arrears vouchers were found.');return}
  const q=v=>`"${String(v??'').replace(/"/g,'""')}"`;
  const head=['Admis No','Student','Class','2025 source arrears','Arrears voucher amount','Paid on arrears vouchers','Remaining arrears voucher balance','Arrears fee rows','Voucher IDs','Review status'];
  const csv='\uFEFF'+[head,...report].map(r=>r.map(q).join(',')).join('\r\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));
  a.download=`arrears-reconciliation-${today()}.csv`;document.body.appendChild(a);a.click();a.remove();
}

/* ---------- Add another fee item to an existing voucher ---------- */
function openAddItem(vid){
  const rows=allFeesCache.filter(r=>(r.voucher_id||'').trim()===vid);if(!rows.length)return;
  const f=rows[0];
  $('aiVid').value=vid;$('aiStudent').value=`${f.student_name||''} - ${f.period||''}`;$('aiType').value='';$('aiAmt').value='';$('aiDisc').value='';$('aiRemarks').value='';
  $('aiExisting').innerText='Already in this voucher: '+rows.map(r=>`${itemName(r)} ${fmt(r.net??r.payable)}`).join(', ');
  $('addItemModal').classList.add('open');setTimeout(()=>$('aiType').focus(),60);
}
async function saveAddItem(){
  const vid=$('aiVid').value,rows=allFeesCache.filter(r=>(r.voucher_id||'').trim()===vid),f=rows[0];if(!f)return;
  const type=$('aiType').value.trim().toLowerCase().replace(/\s+/g,' '),amt=parseFloat($('aiAmt').value)||0,disc=Math.min(parseFloat($('aiDisc').value)||0,amt),rm=$('aiRemarks').value.trim();
  if(!type){showAlert("Please choose or type the fee name.");return}
  if(amt<=0){showAlert("Please enter an amount greater than 0.");return}
  if(rows.some(r=>(r.type||'').trim().toLowerCase()===type)){showAlert(`This voucher already has "${type}". Edit its discount, or use a different name.`);return}
  if(disc>0&&!rm){showAlert("Remarks are required when a discount is given.");return}
  const row={sr_no:f.sr_no||'',voucher_id:vid,admis_no:f.admis_no||'',student_name:f.student_name||'',type,period:f.period,payable:amt,discount:disc,class:f.class||'',status:'Unpaid',date:today(),remarks:disc>0?`Discount ${disc}: ${rm}`:rm,[FEES_SIBLINGS_COL]:f[FEES_SIBLINGS_COL]??null,[FEES_ARREARS_COL]:null};
  const go=async()=>{
    showLoading("Adding item...");
    try{
      const res=await fetch(`${SUPABASE_URL}/rest/v1/fees`,{method:'POST',headers:HJ,body:JSON.stringify(row)});
      hideLoading();
      if(res.ok){$('addItemModal').classList.remove('open');showAlert(`"${tcase(type)}" PKR ${fmt(amt-disc)} added to voucher ${vid}.`);initFeePage()}
      else showAlert(feeErr("Failed to add: "+await res.text()));
    }catch(e){hideLoading();console.error(e);showAlert("Error connecting to database.")}
  };
  if(rows.every(r=>r.status==='Paid')&&rows.length)showConfirm(`Voucher ${vid} is fully paid. Adding this item makes it partly unpaid again. Continue?`,go);else go();
}

/* ---------- Bulk pay ---------- */
function openBulkPayModal(){
  if(!filtered.length){showAlert("No vouchers in the current filter.");return}
  let t=0;filtered.forEach(r=>{const b=parseFloat(r.balance)||0;if(b>0&&!r._out)t+=b});
  $('bulkTotalDues').value=`PKR ${t}`;$('bulkReceivedAmount').value=t>0?t:'';
  $('bulkPayModal').classList.add('open');
}
const closeBulkPayModal=()=>$('bulkPayModal').classList.remove('open');

function sendWhatsAppReminders(){
  if(!filtered.length){showAlert("No students in the current filter.");return}
  const map={};
  filtered.forEach(r=>{const n=(r.student_name||'').trim(),b=parseFloat(r.balance)||0;
    if(n&&b>0&&!r._out){(map[n]??={admis_no:(r.admis_no||'').trim(),total:0}).total+=b}});
  const names=Object.keys(map);
  if(!names.length){showAlert("No pending dues in the current filter.");return}
  showConfirm(`Found ${names.length} student(s) with pending dues. Prepare a WhatsApp reminder for the first one?`,()=>{
    const n=names[0],info=map[n];
    const st=allStudentsCache.find(s=>(s.student_name||'').trim().toLowerCase()===n.toLowerCase()||(s.admis_no||'').trim().toLowerCase()===info.admis_no.toLowerCase());
    const mob=String(st?(st.phone||st.mobile||st.whatsapp||''):'').replace(/\D/g,'');
    const msg=`Assalam-o-Alaikum! Dear Parent, this is a fee reminder from Concept School (Shibra Campus) for student *${n}*. Your total pending dues amount to *PKR ${info.total}*. Kindly clear the dues at your earliest convenience. Thank you!`;
    window.open(`https://wa.me/${mob}?text=${encodeURIComponent(msg)}`,'_blank');
  });
}

async function postAccounts(payload,okMsg,loadMsg){
  showLoading(loadMsg);
  try{
    const res=await fetch(`${SUPABASE_URL}/rest/v1/accounts`,{method:'POST',headers:HJ,body:JSON.stringify(payload)});
    hideLoading();
    if(res.ok){showAlert(okMsg);return true}
    showAlert("Failed to save: "+await res.text());
  }catch(e){hideLoading();console.error(e);showAlert("Error connecting to database.")}
  return false;
}

function submitBulkFifoPayment(){
  const recv=parseFloat($('bulkReceivedAmount').value)||0,date=$('bulkPayDate').value;
  const remarks=$('bulkPayRemarks').value.trim()||"Bulk payment via FIFO";
  if(recv<=0){showAlert("Please enter a valid amount greater than 0.");return}
  showConfirm(`PKR ${recv} will be distributed via FIFO. Any extra is saved as advance on the latest voucher. Proceed?`,async()=>{
    closeBulkPayModal();
    const ord=(a,b,dir)=>{const m1=monthOrder[(a.period||'').trim()]||(dir>0?99:0),m2=monthOrder[(b.period||'').trim()]||(dir>0?99:0);return m1-m2};
    const sorted=[...filtered].sort((a,b)=>ord(a,b,1)||(isArr(b)-isArr(a)));
    const newest=[...filtered].sort((a,b)=>ord(b,a,-1)||(isArr(a)-isArr(b)))[0];
    const label=v=>`${v.type||'Tuition Fee'} (${v.period||''}) - ${v.student_name||''}`;
    const mk=(v,sfx,amt,rm)=>({voucher_id:`${(v.voucher_id||'').trim()}-${sfx}`,from_account:label(v),to_account:$('bulkAccount').value||'cash',description:rm,amount_in:amt,amount_out:0,date,remarks:rm});
    const nonce=Date.now(),pl=[];let rem=recv;
    for(const v of sorted){
      if(rem<=0)break;const bal=parseFloat(v.balance)||0;let amt=0;
      if(bal>0)amt=Math.min(rem,bal);
      else if(v.voucher_id===newest.voucher_id)amt=rem;
      if(amt>0){pl.push(mk(v,`${nonce}-${Math.floor(Math.random()*1000)}`,amt,remarks));rem-=amt}
    }
    if(rem>0&&newest)pl.push(mk(newest,`${nonce}-adv`,rem,remarks+" (Advance)"));
    if(!pl.length){showAlert("No valid voucher found to apply payment.");return}
    if(await postAccounts(pl,"Bulk payments recorded successfully!","Applying payments..."))initFeePage();
  });
}

/* ---------- Delete ---------- */
function deleteSelectedVouchers(){
  const sel=[...document.querySelectorAll('.row-checkbox:checked')].map(c=>c.dataset.voucher).filter(Boolean);
  if(!sel.length){showAlert("Please select at least one voucher to delete.");return}
  const locked=[],ids=[];
  sel.forEach(id=>{if(isLocked(id)){const r=allFeesCache.find(x=>(x.voucher_id||'').trim()===id)||{};locked.push(`${r.student_name||id} (${r.type||''} ${r.period||''}) - PKR ${r.totalPaid||0} paid`)}else ids.push(id)});
  if(!ids.length){showAlert("These vouchers have payments recorded in Accounts. Delete the payment from Accounts & Daybook first.\n\n"+locked.slice(0,8).join("\n")+(locked.length>8?`\n...and ${locked.length-8} more`:''));return}
  let msg=`Delete ${ids.length} selected voucher(s)?`;
  if(locked.length)msg+=`\n\n${locked.length} voucher(s) will be skipped (payment recorded in Accounts).`;
  showConfirm(msg,async()=>{
    showLoading("Deleting vouchers...");
    try{
      const res=await fetch(`${SUPABASE_URL}/rest/v1/fees?voucher_id=in.(${ids.map(i=>`"${i}"`).join(',')})`,{method:'DELETE',headers:{...H,Prefer:"return=minimal"}});
      hideLoading();
      if(res.ok){showAlert(locked.length?`${ids.length} deleted. ${locked.length} skipped (payment in Accounts).`:"Selected vouchers deleted successfully!");initFeePage()}
      else showAlert("Failed to delete: "+await res.text());
    }catch(e){hideLoading();console.error(e);showAlert("Failed to delete due to a connection error.")}
  });
}

/* ---------- Ledger ---------- */
function periodStart(p){const d=parsePeriod(p),m=d?MONTHS.indexOf(d)+1:1;return `${SCHOOL_YEAR}-${String(m).padStart(2,'0')}-01`}
function openStudentLedger(name,adm){
  // Parent-friendly statement. A bulk/FIFO payment is saved as several rows (one per voucher it clears) but is shown here
  // as ONE receipt ("Received PKR 10,000 on 05 Oct") with the vouchers it was applied to listed underneath.
  const nm=(name||'').trim().toLowerCase(),an=normAdm(adm||'');
  const list=allFeesCache.filter(r=>an?normAdm(r.admis_no)===an:(r.student_name||'').trim().toLowerCase()===nm);
  const byV=new Map();
  list.forEach(r=>{const k=(r.voucher_id||'').trim();let g=byV.get(k);if(!g){g={vid:k,rows:[]};byV.set(k,g)}g.rows.push(r)});
  const ev=[],info={},receipts=new Map();let cls='';
  byV.forEach(g=>{
    const R=g.rows,fr=R[0];if(!cls)cls=fr.class||'-';
    const net=R.reduce((s,r)=>s+(r.net??(parseFloat(r.payable)||0)),0);
    const items=R.length>1?R.map(r=>`${itemName(r)} ${fmt(r.net??r.payable)}`).join(' + '):itemName(R[0]);
    const dn=R.filter(r=>r.discount>0).map(r=>`Discount ${fmt(r.discount)}: ${esc((r.remarks||'').split(' | ').find(x=>x.startsWith('Discount '))?.replace(/^Discount [^:]*: /,'')||'')}`).join('; ');
    info[g.vid]={period:fr.period,label:R.length>1?'Admission voucher':itemName(R[0]),net,paid:0,date:periodStart(fr.period)};
    ev.push({date:periodStart(fr.period),ord:0,vid:g.vid,period:fr.period,desc:`${esc(items)}${dn?` <span class="text-indigo-600 font-semibold">(${dn})</span>`:''}`,debit:net,credit:0});
    ((accountsDataMap[g.vid]||{}).transactions||[]).forEach(t=>{
      const amt=parseFloat(t.amount_in)||0;if(!amt)return;
      const d=String(t.date||'').slice(0,10)||periodStart(fr.period);
      const rest=String(t.voucher_id||'').trim().split('-').slice(2).join('-');
      const nonce=(rest.match(/^(\d{10,})/)||[])[1];            // split rows of one bulk receipt share this number
      const key=d+'|'+(nonce||t.voucher_id);
      let r=receipts.get(key);if(!r){r={date:d,amt:0,note:String(t.description||t.remarks||'').trim(),acct:String(t.to_account||'').trim(),parts:[],adv:false};receipts.set(key,r)}
      r.amt+=amt;if(/advance/i.test(String(t.remarks||'')+' '+String(t.description||'')))r.adv=true;
      r.parts.push({vid:g.vid,period:fr.period,label:info[g.vid].label,amt});info[g.vid].paid+=amt;
    });
  });
  receipts.forEach(r=>ev.push({date:r.date,ord:1,vid:'',period:'',desc:'',debit:0,credit:r.amt,receipt:r}));
  ev.sort((a,b)=>a.date.localeCompare(b.date)||a.ord-b.ord||String(a.vid).localeCompare(String(b.vid)));
  ev.filter(e=>e.receipt).forEach((e,i)=>{e.receipt.no=i});
  const curYm=today().slice(0,7);let run=0,tc=0,tp=0,dueCh=0,future=false,html='';
  ev.forEach(e=>{
    run=Math.round((run+e.debit-e.credit)*100)/100;tc+=e.debit;tp+=e.credit;if(e.receipt)e.receipt.bal=run;
    const fut=e.debit>0&&e.date.slice(0,7)>curYm;if(fut)future=true;if(e.debit>0&&!fut)dueCh+=e.debit;
    let vcell=esc(e.vid)||'-',pcell=esc(e.period)||'-',dcell=e.desc;
    if(e.receipt){
      const r=e.receipt,multi=r.parts.length>1;
      vcell=[...new Set(r.parts.map(p=>p.vid))].map(esc).join('<br>');pcell='';
      dcell=`<div class="font-bold text-emerald-700">Payment received${r.acct?` <span class="font-normal text-slate-500">· ${esc(tcase(r.acct))}</span>`:''}</div>`
        +(r.note&&!/^bulk payment/i.test(r.note)?`<div class="text-slate-500">${esc(r.note)}</div>`:'')
        +`<div class="mt-1 text-[11px] text-slate-500">${multi||r.adv?'Applied to (oldest dues first):':'Applied to:'}</div>`
        +r.parts.map(p=>`<div class="text-[11px]">• ${esc(p.period||'-')} ${esc(p.label)}: <b>PKR ${fmt(p.amt)}</b></div>`).join('')
        +(r.adv?'<div class="text-[11px] text-amber-700">• Includes advance for coming months</div>':'')
        +`<button type="button" onclick="printReceipt(${r.no})" class="no-print mt-1.5 px-2 py-1 rounded border bg-white text-[11px] font-semibold text-indigo-700">🖨️ Print receipt</button>`;
    }
    html+=`<tr class="border-b align-top ${e.ord?'bg-emerald-50/40':'bg-slate-50/70'} ${fut?'opacity-60':''}"><td class="p-2 font-mono ${e.ord?'':'text-slate-400'}">${e.ord?e.date:e.date.slice(0,7)}</td><td class="p-2 font-mono text-indigo-900">${vcell}</td><td class="p-2 text-indigo-600">${pcell}</td><td class="p-2 text-slate-600">${dcell}</td><td class="p-2 font-bold">${e.debit?'PKR '+fmt(e.debit):''}</td><td class="p-2 font-bold text-emerald-600">${e.credit?'PKR '+fmt(e.credit):''}</td><td class="p-2 font-bold ${run>0?'text-rose-600':'text-emerald-600'}">${run<0?'Adv '+fmt(-run):'PKR '+fmt(run)}</td></tr>`;
  });
  $('ledgerTableBody').innerHTML=html||'<tr><td colspan="7" class="p-4 text-center text-slate-400">No vouchers found for this student.</td></tr>';
  // month-wise position: shows parents exactly which month each rupee cleared
  const mo=Object.entries(info).sort((a,b)=>a[1].date.localeCompare(b[1].date)||a[0].localeCompare(b[0]));
  $('ledgerApplied').innerHTML=mo.length?`<div class="font-bold text-xs text-indigo-950 mb-1">Month-wise position</div><table class="w-full text-xs text-left mb-3"><thead class="bg-slate-100 text-slate-600"><tr><th class="p-2">Month</th><th class="p-2">Voucher</th><th class="p-2">Fee</th><th class="p-2">Charged</th><th class="p-2">Paid</th><th class="p-2">Pending</th><th class="p-2">Status</th></tr></thead><tbody>${mo.map(([vid,i])=>{const pend=Math.round((i.net-i.paid)*100)/100,st=pend<=0?(pend<0?'Advance':'Cleared'):(i.paid>0?'Part paid':'Unpaid'),cl=pend<=0?'text-emerald-700 bg-emerald-50':(i.paid>0?'text-amber-700 bg-amber-50':'text-rose-700 bg-rose-50');return`<tr class="border-b"><td class="p-2 text-indigo-600">${esc(i.period||'-')}</td><td class="p-2 font-mono">${esc(vid)}</td><td class="p-2">${esc(i.label)}</td><td class="p-2">PKR ${fmt(i.net)}</td><td class="p-2 text-emerald-600">PKR ${fmt(i.paid)}</td><td class="p-2 font-bold">${pend>0?'PKR '+fmt(pend):'-'}</td><td class="p-2"><span class="px-2 py-0.5 rounded-full font-semibold ${cl}">${st}</span></td></tr>`}).join('')}</tbody></table>`:'';
  const last=[...receipts.values()].sort((a,b)=>b.date.localeCompare(a.date))[0];
  const ref=list[0]||{};
  $('ledgerStudentInfo').innerText=`Student: ${name} | Class: ${cls||'-'}${ref.admis_no?' | Admis No: '+ref.admis_no:''}${ref[FEES_SIBLINGS_COL]?' | Siblings: '+ref[FEES_SIBLINGS_COL]:''}`;
  $('ledgerTotalPayable').innerText=`PKR ${fmt(tc)}`;$('ledgerTotalPaid').innerText=`PKR ${fmt(tp)}`;
  $('ledgerTotalBalance').innerText=run<0?`Adv ${fmt(-run)}`:`PKR ${fmt(run)}`;
  const due=Math.round((dueCh-tp)*100)/100;
  $('ledgerDue').innerText=(last?`Last payment: PKR ${fmt(last.amt)} on ${last.date}. `:'No payment received yet. ')+(future?`Due up to this month: ${due<0?'Adv '+fmt(-due):'PKR '+fmt(due)} (the grey rows are later months)`:'');
  window.LEDGER_CTX={name,adm:ref.admis_no||adm||'',cls:cls||'-',receipts:ev.filter(e=>e.receipt).map(e=>e.receipt)};
  $('ledgerModal').classList.add('open');
}

function printReceipt(i){
  const c=window.LEDGER_CTX,r=c&&c.receipts[i];if(!r)return;
  const same=c.receipts.filter(x=>x.date===r.date),no=`RC-${String(c.adm||'').replace(/\W/g,'')}-${r.date.replace(/-/g,'')}${same.length>1?'-'+(same.indexOf(r)+1):''}`;
  const rows=r.parts.map(p=>`<tr><td>${esc(p.period||'-')}</td><td>${esc(p.label)}</td><td class="n">${fmt(p.amt)}</td></tr>`).join('');
  const html=`<!doctype html><html><head><meta charset="utf-8"><title>${esc(no)}</title><style>
  body{font-family:Arial,Helvetica,sans-serif;color:#0f172a;margin:0;padding:24px}.box{border:2px solid #0b1f3f;border-radius:8px;padding:22px;max-width:620px;margin:0 auto}
  h1{margin:0;font-size:20px;text-align:center;color:#0b1f3f}.sub{text-align:center;font-size:12px;color:#64748b;margin-bottom:10px}
  .ttl{text-align:center;font-weight:bold;letter-spacing:1px;border-top:1px solid #cbd5e1;border-bottom:1px solid #cbd5e1;padding:6px 0;margin:8px 0 14px}
  table{width:100%;border-collapse:collapse;font-size:13px}td,th{padding:6px 4px;text-align:left}th{border-bottom:1px solid #94a3b8;font-size:11px;text-transform:uppercase;color:#475569}
  .n{text-align:right}.meta td{padding:4px}.meta td:first-child{color:#475569;width:30%}.tot td{border-top:2px solid #0b1f3f;font-weight:bold;font-size:15px}
  .sig{display:flex;justify-content:space-between;margin-top:44px;font-size:12px}.sig div{border-top:1px solid #334155;padding-top:4px;width:40%;text-align:center}.note{font-size:11px;color:#64748b;margin-top:10px}
  </style></head><body><div class="box"><h1>Concept School</h1><div class="sub">Shibra Campus</div><div class="ttl">FEE RECEIPT</div>
  <table class="meta"><tr><td>Receipt no</td><td><b>${esc(no)}</b></td><td>Date</td><td>${esc(r.date)}</td></tr>
  <tr><td>Student</td><td><b>${esc(c.name)}</b></td><td>Adm no</td><td>${esc(c.adm)}</td></tr>
  <tr><td>Class</td><td>${esc(c.cls)}</td><td>Paid via</td><td>${esc(tcase(r.acct||'Cash'))}</td></tr></table>
  <table style="margin-top:12px"><thead><tr><th>Month</th><th>Fee</th><th class="n">Amount (PKR)</th></tr></thead><tbody>${rows}${r.adv?'<tr><td colspan="2">Advance for coming months</td><td class="n">included</td></tr>':''}
  <tr class="tot"><td colspan="2">Total received</td><td class="n">PKR ${fmt(r.amt)}</td></tr></tbody></table>
  <p style="font-size:13px;margin:10px 0 0">Rupees ${UI.words(r.amt)} only.</p>
  <p style="font-size:13px;margin:6px 0 0">Balance after this payment: <b>${r.bal<0?'Advance PKR '+fmt(-r.bal):'PKR '+fmt(r.bal)}</b></p>
  <div class="sig"><div>Received by</div><div>Parent / Guardian</div></div><p class="note">Computer generated receipt. Please keep it for your records.</p></div></body></html>`;
  const fr=document.createElement('iframe');fr.style.cssText='position:fixed;right:0;bottom:0;width:0;height:0;border:0';document.body.appendChild(fr);
  fr.contentDocument.open();fr.contentDocument.write(html);fr.contentDocument.close();
  setTimeout(()=>{fr.contentWindow.focus();fr.contentWindow.print();setTimeout(()=>fr.remove(),1500)},300);
}
const closeLedgerModal=()=>$('ledgerModal').classList.remove('open');

/* ---------- Single payment ---------- */
function openPayModal(vId){
  const row=allFeesCache.find(r=>(r.voucher_id||'').trim()===vId);if(!row)return;
  $('payVoucherId').value=row.voucher_id||'';$('payStudentName').value=row.student_name||'';
  const grp=allFeesCache.filter(r=>(r.voucher_id||'').trim()===vId),tc=t=>String(t||'').replace(/\b\w/g,c=>c.toUpperCase());
 $('payFromAccount').value=grp.length>1?`Admission voucher (${grp.map(r=>tc(r.type)).join(' + ')}) - ${row.student_name||''}`:`${row.type||'Tuition Fee'} (${row.period||''}) - ${row.student_name||''}`;
 const pay=grp.reduce((s,r)=>s+(r.net??(parseFloat(r.payable)||0)),0),rem=pay-grp.reduce((s,r)=>s+(parseFloat(r.totalPaid)||0),0);
  $('payPayable').value=pay;$('payAmountIn').value=rem>0?rem:pay;$('payRemarks').value=row.remarks||'';
  $('payModal').classList.add('open');
}
const closePayModal=()=>$('payModal').classList.remove('open');
async function submitPayment(e){
  e.preventDefault();const rm=$('payRemarks').value.trim();
  const ok=await postAccounts({voucher_id:$('payVoucherId').value.trim()+'-'+Date.now(),from_account:$('payFromAccount').value,to_account:$('payToAccount').value,description:rm,amount_in:parseFloat($('payAmountIn').value)||0,amount_out:0,date:$('payDate').value,remarks:rm},"Payment receipt saved successfully!","Saving receipt...");
  if(ok){closePayModal();initFeePage()}
}

/* ---------- Generate ---------- */
function generateVouchers(withUpdate){
  if(!allStudentsCache.length){showAlert("No students found in students directory!");return}
  if(withUpdate===true&&!selStu.size){showAlert("Select at least one student first (choose a class, then tick students).");return}
  const sel=$('voucherPeriod').value,cls=$('voucherClassSelect').value;
  const periods=sel==='ALL_YEAR'?MONTHS:[sel];
  let students=cls==='ALL'?allStudentsCache:allStudentsCache.filter(s=>(s.class||'').trim()===cls);
  if(cls!=='ALL'&&selStu.size)students=students.filter(s=>selStu.has(skey(s)));
  if(!students.length){showAlert("No students found for the selected class!");return}

  const used=new Set();allFeesCache.forEach(f=>{const n=vNum(f.voucher_id);if(n)used.add(n)});
  if(vidMode()==='manual'&&!parseStart()){showAlert("Please enter a starting voucher number, e.g. V-586545.");return}
  const nextId=makeVidGenerator(used);

  const keys=new Set(),arrearsAdmis=new Set(),arrearsNames=new Set();
  allFeesCache.forEach(f=>{const a=(f.admis_no||'').trim().toLowerCase(),n=(f.student_name||'').trim().toLowerCase(),p=(f.period||'').trim(),t=(f.type||'').trim().toLowerCase();
    if(a)keys.add(`${a}_${p}_${t}`);if(n)keys.add(`${n}_${p}_${t}`);
    if(isArr(f)){if(a)arrearsAdmis.add(a);if(n)arrearsNames.add(n)}});
  const vmap=new Map();allFeesCache.forEach(f=>{const k=`${normAdm(f.admis_no)}_${(f.period||'').trim()}`;if(!vmap.has(k))vmap.set(k,(f.voucher_id||'').trim())});
 const vidFor=(st,period)=>{const k=`${normAdm(st.admis_no)}_${period}`;let v=vmap.get(k);if(!v){v=nextId();vmap.set(k,v)}return v};
 const out=[];let arrearsAlreadyBilledCount=0;
 const add=(st,adm,sn,period,type,payable,remarks,arrVal)=>{
    const k1=`${adm}_${period}_${type}`,k2=`${sn}_${period}_${type}`;
    if(type==='arrears'&&(arrearsAdmis.has(adm)||arrearsNames.has(sn))){arrearsAlreadyBilledCount++;return}
    if(keys.has(k1)||keys.has(k2))return;
    out.push({sr_no:st.sr_no||'',voucher_id:vidFor(st,period),admis_no:st.admis_no||'',student_name:st.student_name||'',type,period,payable,class:st.class||'',status:'Unpaid',date:today(),remarks,[FEES_SIBLINGS_COL]:getStudentSiblings(st),[FEES_ARREARS_COL]:arrVal});
    keys.add(k1);keys.add(k2);
    if(type==='arrears'){if(adm)arrearsAdmis.add(adm);if(sn)arrearsNames.add(sn)}
  };

  const miss={},nolf={};
  periods.forEach(period=>{
    const pv=SCHOOL_YEAR*12+(monthOrder[period]||0);
    students.forEach(st=>{
      const adm=(st.admis_no||st.sr_no||'').trim().toLowerCase(),sn=(st.student_name||'').trim().toLowerCase();
      const key=st.admis_no||st.student_name,sv=startVal(st),stt=(st.status||'').trim().toLowerCase();
      if(sv===null){miss[key]=st;return}
      let ev=null;
      if(stt!==''&&stt!=='active'){
        const lm=String(st.left_date||'').match(/^(\d{4})-(\d{2})-(\d{2})/);
        if(!lm){nolf[key]=st;return}
        ev=(+lm[1])*12+(+lm[2])-(+lm[3]>15?0:1);
      }
      if(pv<sv||(ev!==null&&pv>ev))return;
      const inc=incrementsCacheMap[adm],cm=monthOrder[period]||0,em=inc?periodNum(inc.effective_period):0;
      let tp=parseFloat(st.monthly_tution_fee)||0,rm='';
      if(inc){
        if(em>0&&cm>=em){if(parseFloat(inc.new_fee)>0)tp=parseFloat(inc.new_fee)}
        else tp=parseFloat(inc.old_fee)||parseFloat(st.monthly_tution_fee)||0;
        if(inc.remarks)rm=inc.remarks;
      }
      add(st,adm,sn,period,'tuition fee',tp,rm,null);
      if(period===ARREARS_PERIOD){const a=parseFloat(getStudentArrears(st))||0;if(a>0)add(st,adm,sn,period,'arrears',a,`${ARREARS_SOURCE_YEAR} arrears (one-time carry-forward)`,String(a))}
      if(inc&&parseFloat(inc.annual_fund)>0&&(inc.fee_type||'').trim().toLowerCase()==='annual fund'&&em>0&&cm===em)
        add(st,adm,sn,period,'annual fund',parseFloat(inc.annual_fund),inc.remarks||'',null);
    });
  });
  showWarn(miss,nolf);
  const arrearsSkipMsg=arrearsAlreadyBilledCount?`\n${arrearsAlreadyBilledCount} 2025 arrears item(s) skipped because an arrears voucher already exists. Check the original voucher for its remaining balance.`:'';

  const upd=[],blocked=[];
  if(withUpdate===true)periods.forEach(period=>students.forEach(st=>{
    if(eligibility(st,period)!=='ok')return;
    const v=stuVouchers(st,period)[0];if(!v)return;
    const exp=expectedTuition(st,period),old=parseFloat(v.payable)||0;
    if(!(exp>0)||exp===old)return;
    if((parseFloat(v.totalPaid)||0)>0)blocked.push(`${st.student_name} (${period}): PKR ${fmt(v.totalPaid)} already paid`);
    else upd.push({v,old,exp});
  }));
  const blockMsg=blocked.length?`\n\nERROR - paid vouchers not updated (delete the payment from Accounts first, then update):\n`+blocked.slice(0,8).join('\n')+(blocked.length>8?`\n...and ${blocked.length-8} more`:''):'';
  if(!out.length&&!upd.length){showAlert((blocked.length?"Nothing could be updated.":"Nothing to create or update: vouchers already exist and match the current fees.")+arrearsSkipMsg+blockMsg);return}
  showConfirm(`${out.length} new fee item(s) in ${new Set(out.map(o=>o.voucher_id)).size} voucher(s) will be created`+(withUpdate===true?` and ${upd.length} unpaid voucher(s) updated`:'')+(out.length?`.\nNumbers: ${out[0].voucher_id} to ${out[out.length-1].voucher_id}`:'.')+arrearsSkipMsg+blockMsg+`\n\nProceed?`,async()=>{
    showLoading("Saving vouchers...");
    try{
      if(out.length){const res=await fetch(`${SUPABASE_URL}/rest/v1/fees`,{method:'POST',headers:HJ,body:JSON.stringify(out)});if(!res.ok){hideLoading();showAlert(feeErr("Failed to generate: "+await res.text()));return}}
      for(let k=0;k<upd.length;k+=10)await Promise.all(upd.slice(k,k+10).map(it=>fetch(`${SUPABASE_URL}/rest/v1/fees?${rowFilter(it.v)}`,{method:'PATCH',headers:HJ,body:JSON.stringify({payable:it.exp,original_payable:it.v.original_payable??it.old,remarks:`${it.v.remarks?it.v.remarks+' | ':''}Updated: ${it.old} to ${it.exp}`})}).then(r=>{if(!r.ok)throw new Error('update failed')})));
      hideLoading();selStu.clear();toggleGen();showAlert("Done: "+out.length+" created"+(upd.length?`, ${upd.length} updated`:'')+".");initFeePage();
    }catch(e){hideLoading();console.error(e);showAlert("Error while saving: "+e.message)}
  });
}

const closeModal=id=>$(id).classList.remove('open');
const normAdm=s=>String(s??'').trim().toLowerCase().replace(/^0+/,'');
const feeSort=(x,y)=>((monthOrder[(x.period||'').trim()]||99)-(monthOrder[(y.period||'').trim()]||99))||(isArr(y)-isArr(x));

/* ---------- Excel / CSV import ---------- */
function openImport(){$('importFile').value='';$('importPreview').innerHTML='';$('importConfirm').classList.add('hidden');importPlan=null;$('importModal').classList.add('open')}
function toISO(v,fix){
  let iso=null,m;
  if(v instanceof Date&&!isNaN(v))iso=new Date(v.getTime()+12*36e5).toISOString().slice(0,10);
  else if(typeof v==='number'&&v>20000)iso=new Date(Math.round((v-25569)*864e5)+12*36e5).toISOString().slice(0,10);
  else{const t=String(v??'').trim();
    if(m=t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))iso=`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
    else if(m=t.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/))iso=`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;}
  return iso&&fix?String(SCHOOL_YEAR)+iso.slice(4):iso;
}
async function readImport(){
  const f=$('importFile').files[0];if(!f){showAlert("Choose an Excel or CSV file first.");return}
  showLoading("Reading file...");
  try{
    await sbLoadXlsx();
    const wb=/\.csv$/i.test(f.name)?XLSX.read(await f.text(),{type:'string',raw:true}):XLSX.read(await f.arrayBuffer(),{type:'array',cellDates:true});
    const raw=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:''});
    hideLoading();buildImportPlan(raw);
  }catch(e){hideLoading();console.error(e);showAlert(e.message || "Could not read this file.")}
}
function buildImportPlan(raw){
  const fix=$('importFixYear').checked;
  const g=(r,k)=>{const key=Object.keys(r).find(x=>x.trim().toLowerCase()===k);return key?r[key]:''};
  const pays=[];let bad=0;
  raw.forEach((r,i)=>{
    const adm=String(g(r,'voucher_id')).trim(),amt=parseFloat(String(g(r,'amount_in')).replace(/,/g,''))||0,date=toISO(g(r,'date'),fix);
    if(!adm||amt<=0||!date){if(adm||amt)bad++;return}
    pays.push({adm,key:normAdm(adm),name:String(g(r,'from_account')).trim(),to:matchPay(String(g(r,'to_account')).trim()),amt,date,cls:String(g(r,'remarks')).trim()});
  });
  const ex={};
  accountsRaw.forEach(a=>{const m=(a.description||'').match(/^Imported from Excel \(Adm (.+)\)$/);if(m){const k=normAdm(m[1])+'|'+String(a.date).slice(0,10);ex[k]=(ex[k]||0)+(parseFloat(a.amount_in)||0)}});
  const grp={};pays.forEach(p=>{const k=p.key+'|'+p.date;grp[k]=(grp[k]||0)+p.amt});
  const byStu={};allFeesCache.forEach(v=>(byStu[normAdm(v.admis_no)]??=[]).push(v));
  Object.values(byStu).forEach(a=>a.sort(feeSort));
  const rem={};allFeesCache.forEach(v=>rem[v.voucher_id]=Math.max(parseFloat(v.balance)||0,0));
  const rows=[],entries=[],nonce=Date.now();let n=0;
  pays.sort((a,b)=>a.date.localeCompare(b.date)).forEach(p=>{
    const row={p,alloc:[],flags:[],status:'OK'};rows.push(row);
    const vs=byStu[p.key];
    if(!vs){const st=allStudentsCache.find(x=>normAdm(x.admis_no)===p.key);row.status=st&&!String(st.doj||'').trim()?'DOJ missing':'Not found / no vouchers';return}
    if((ex[p.key+'|'+p.date]||0)>=grp[p.key+'|'+p.date]-0.01){row.status='Duplicate (already imported)';return}
    if(p.name&&p.name.toLowerCase()!==(vs[0].student_name||'').trim().toLowerCase())row.flags.push('Name differs: '+(vs[0].student_name||''));
    const push=(v,a)=>{entries.push({voucher_id:`${(v.voucher_id||'').trim()}-imp-${nonce}-${++n}`,from_account:`${v.type||'Tuition Fee'} (${v.period||''}) - ${v.student_name||''}`,to_account:p.to,description:`Imported from Excel (Adm ${p.adm})`,amount_in:a,amount_out:0,date:p.date,remarks:p.cls});row.alloc.push(`${v.period} ${fmt(a)}`)};
    const per=`${MONTHS[+p.date.slice(5,7)-1].split(' ')[0]} ${p.date.slice(0,4)}`;
    const v=vs.find(x=>(x.period||'').trim()===per&&isTuition(x));
    if(!v){row.status=`No ${per} tuition voucher`;return}
    row.per=per;push(v,p.amt);
    const over=p.amt-(rem[v.voucher_id]||0);rem[v.voucher_id]=Math.max((rem[v.voucher_id]||0)-p.amt,0);
    if(over>0.01)row.flags.push(`Exceeds ${per} balance by ${fmt(over)} (shown as advance)`);
  });
  const ms={};rows.forEach(r=>{if(r.status==='OK'&&r.per){const o=ms[r.per]??={n:0,s:0};o.n++;o.s+=r.p.amt}});
  const monthLine='By month: '+(Object.entries(ms).sort((x,y)=>(monthOrder[x[0]]||99)-(monthOrder[y[0]]||99)).map(([k,o])=>`${k}: ${o.n} payments, PKR ${fmt(o.s)}`).join(' | ')||'-');
  importPlan={entries};
  const cnt={};rows.forEach(r=>cnt[r.status]=(cnt[r.status]||0)+1);
  const bg=st=>st==='OK'?'text-emerald-700':st.startsWith('Dup')?'text-amber-700':'text-rose-600';
  $('importPreview').innerHTML=`<div class="rounded-lg bg-slate-50 border p-2 mb-2 font-semibold">${rows.length} payments read | ${Object.entries(cnt).map(([k,v])=>`${k}: ${v}`).join(' | ')}${bad?` | ${bad} invalid rows ignored`:''} | ${entries.length} entries will be saved<div class="font-normal text-slate-600 mt-1">${monthLine}</div></div>
  <div class="overflow-x-auto max-h-72 border rounded-lg"><table class="w-full text-left"><thead class="bg-slate-100 sticky top-0"><tr><th class="p-1.5">Adm</th><th class="p-1.5">Name</th><th class="p-1.5">Date</th><th class="p-1.5">Amount</th><th class="p-1.5">Result</th><th class="p-1.5">Allocation / notes</th></tr></thead><tbody>${rows.slice(0,400).map(r=>`<tr class="border-t"><td class="p-1.5 font-mono">${esc(r.p.adm)}</td><td class="p-1.5">${esc(r.p.name)}</td><td class="p-1.5 font-mono">${r.p.date}</td><td class="p-1.5 font-bold">${fmt(r.p.amt)}</td><td class="p-1.5 font-semibold ${bg(r.status)}">${r.status}</td><td class="p-1.5">${esc(r.alloc.join(', '))}${r.flags.length?` <span class="text-amber-700">${esc(r.flags.join('; '))}</span>`:''}</td></tr>`).join('')}</tbody></table></div>${rows.length>400?'<p class="mt-1 text-slate-500">Showing the first 400 rows; all will be processed.</p>':''}`;
  $('importConfirm').classList.toggle('hidden',!entries.length);
}
function confirmImport(){
  if(!importPlan||!importPlan.entries.length)return;
  showConfirm(`Save ${importPlan.entries.length} payment entries to Accounts?`,async()=>{
    showLoading("Importing payments...");
    try{
      for(let i=0;i<importPlan.entries.length;i+=500){
        const res=await fetch(`${SUPABASE_URL}/rest/v1/accounts`,{method:'POST',headers:HJ,body:JSON.stringify(importPlan.entries.slice(i,i+500))});
        if(!res.ok){hideLoading();showAlert("Import stopped: "+await res.text()+"\nChunks saved before this error stay saved. Re-upload the file; duplicates are skipped.");return}
      }
      hideLoading();closeModal('importModal');showAlert("Paid fees imported successfully!");initFeePage();
    }catch(e){hideLoading();console.error(e);showAlert("Error connecting to database.")}
  });
}

/* ---------- Sync ---------- */
function eligibility(st,period){
  const sv=startVal(st);if(sv===null)return'nodoj';
  const pv=SCHOOL_YEAR*12+(monthOrder[period]||0),stt=(st.status||'').trim().toLowerCase();
  if(pv<sv)return'out';
  if(stt!==''&&stt!=='active'){
    const lm=String(st.left_date||'').match(/^(\d{4})-(\d{2})-(\d{2})/);if(!lm)return'nolf';
    if(pv>(+lm[1])*12+(+lm[2])-(+lm[3]>15?0:1))return'out';
  }
  return'ok';
}
function expectedTuition(st,period){
  const inc=incrementsCacheMap[(st.admis_no||'').trim().toLowerCase()],cm=monthOrder[period]||0;
  let t=parseFloat(st.monthly_tution_fee)||0;
  if(inc){const em=periodNum(inc.effective_period);
    if(em>0&&cm>=em){if(parseFloat(inc.new_fee)>0)t=parseFloat(inc.new_fee)}else t=parseFloat(inc.old_fee)||t}
  return t;
}
function openSync(){
  syncItems=[];
  filtered.forEach(v=>{
    if(isArr(v))return;
    const st=allStudentsCache.find(x=>normAdm(x.admis_no)===normAdm(v.admis_no));if(!st)return;
    const period=(v.period||'').trim(),el=eligibility(st,period),paid=parseFloat(v.totalPaid)||0;
    if(el==='out')syncItems.push({v,kind:'del',paid});
    else if(el==='ok'&&(v.type||'').trim().toLowerCase()==='tuition fee'){
      const exp=expectedTuition(st,period),old=parseFloat(v.payable)||0;
      if(exp>0&&exp!==old)syncItems.push({v,kind:'upd',old,exp,paid});
    }
  });
  if(!syncItems.length){showAlert("Everything in the current filter already matches the increment, DOJ and left-date rules.");return}
  $('syncList').innerHTML=`<table class="w-full text-left"><thead class="bg-slate-100 sticky top-0"><tr><th class="p-1.5 w-10"><input type="checkbox" id="syncAll" onchange="toggleSyncAll(this)" title="Select all" class="w-4 h-4"></th><th class="p-1.5">Student</th><th class="p-1.5">Period</th><th class="p-1.5">Change</th><th class="p-1.5">Note</th></tr></thead><tbody>${syncItems.map((it,i)=>{
    const v=it.v,upd=it.kind==='upd',lockDel=!upd&&it.paid>0;
    const chk=lockDel?'disabled':(upd&&it.paid===0?'checked':'');
    return`<tr class="border-t ${it.paid>0?'bg-amber-50':''}"><td class="p-1.5"><input type="checkbox" class="sync-cb" data-i="${i}" ${chk} onchange="syncAllState()"></td><td class="p-1.5 font-semibold">${esc(v.student_name)}<div class="font-mono text-slate-400">${esc(v.voucher_id)}</div></td><td class="p-1.5">${esc(v.period)}</td><td class="p-1.5 font-bold">${upd?`${fmt(it.old)} to ${fmt(it.exp)} (${it.exp>it.old?'+':''}${fmt(it.exp-it.old)})`:'Delete voucher (outside DOJ / left date)'}</td><td class="p-1.5 ${it.paid>0?'text-amber-700 font-semibold':'text-slate-500'}">${lockDel?'Payment recorded, cannot delete':it.paid>0?`Paid ${fmt(it.paid)}: status will change`:'Unpaid'}</td></tr>`}).join('')}</tbody></table>`;
  syncAllState();$('syncModal').classList.add('open');
}
function toggleSyncAll(cb){document.querySelectorAll('.sync-cb').forEach(c=>{if(!c.disabled)c.checked=cb.checked});syncAllState()}
function syncAllState(){
  const all=[...document.querySelectorAll('.sync-cb')].filter(c=>!c.disabled),on=all.filter(c=>c.checked).length,h=$('syncAll');
  if(h){h.checked=all.length>0&&on===all.length;h.indeterminate=on>0&&on<all.length}
  const n=$('syncCount');if(n)n.innerText=`${on} of ${all.length} selected`;
}
function applySync(){
  const sel=[...document.querySelectorAll('.sync-cb:checked')].map(c=>syncItems[+c.dataset.i]);
  if(!sel.length){showAlert("Tick at least one row to apply.");return}
  const upd=sel.filter(i=>i.kind==='upd'),del=sel.filter(i=>i.kind==='del');
  showConfirm(`Update ${upd.length} voucher(s) and delete ${del.length} voucher(s)?`,async()=>{
    showLoading("Applying sync...");
    try{
      for(let i=0;i<upd.length;i+=10)await Promise.all(upd.slice(i,i+10).map(it=>fetch(`${SUPABASE_URL}/rest/v1/fees?${rowFilter(it.v)}`,{method:'PATCH',headers:HJ,body:JSON.stringify({payable:it.exp,original_payable:it.v.original_payable??it.old,remarks:`${it.v.remarks?it.v.remarks+' | ':''}Sync: ${it.old} to ${it.exp}`})}).then(r=>{if(!r.ok)throw new Error('update failed')})));
      if(del.length){const r=await fetch(`${SUPABASE_URL}/rest/v1/fees?voucher_id=in.(${del.map(i=>`"${(i.v.voucher_id||'').trim()}"`).join(',')})`,{method:'DELETE',headers:{...H,Prefer:"return=minimal"}});if(!r.ok)throw new Error('delete failed')}
      hideLoading();closeModal('syncModal');showAlert("Sync applied successfully!");initFeePage();
    }catch(e){hideLoading();console.error(e);showAlert("Sync failed part-way: "+e.message+". Refresh and run Sync again to see what is left.")}
  });
}

let selStu=new Set();
const skey=st=>String(st.admis_no||st.student_name||'');
const isTuition=v=>(v.type||'').trim().toLowerCase()==='tuition fee';
function stuVouchers(st,per){const a=normAdm(st.admis_no);return allFeesCache.filter(v=>normAdm(v.admis_no)===a&&isTuition(v)&&(per==='ALL_YEAR'||(v.period||'').trim()===per))}
function stuState(st,per){
  const vs=stuVouchers(st,per);
  if(per==='ALL_YEAR')return{t:`${vs.length}/12`,miss:vs.length<12,c:vs.length<12?'bg-amber-50 text-amber-700':'bg-emerald-50 text-emerald-700'};
  if(!vs.length)return{t:'No voucher',miss:true,c:'bg-rose-50 text-rose-700'};
  const v=vs[0];return{t:v.status,miss:false,c:v.status==='Paid'?'bg-emerald-50 text-emerald-700':v.status==='Partial'?'bg-blue-50 text-blue-700':'bg-amber-50 text-amber-700'};
}
function classStudents(){const cls=$('voucherClassSelect').value;return cls==='ALL'?[]:allStudentsCache.filter(s=>(s.class||'').trim()===cls)}
function renderPicker(){
  const box=$('stuPanel'),list=classStudents();
  if(!list.length){box.classList.add('hidden');return}
  box.classList.remove('hidden');
  const per=$('voucherPeriod').value,q=$('stuSearch').value.trim().toLowerCase();
  $('stuList').innerHTML=list.filter(s=>!q||(s.student_name||'').toLowerCase().includes(q)||String(s.admis_no||'').toLowerCase().includes(q))
    .map(s=>{const st=stuState(s,per);return`<label class="flex items-center gap-2 px-2 py-1.5 text-xs cursor-pointer"><input type="checkbox" data-k="${esc(skey(s))}" ${selStu.has(skey(s))?'checked':''} onchange="togStu(this)"><span class="font-semibold flex-1">${esc(s.student_name)}</span><span class="font-mono text-slate-400">${esc(s.admis_no)}</span><span class="badge ${st.c}">${st.t}</span></label>`}).join('')||'<div class="p-3 text-xs text-slate-400">No students match.</div>';
  $('stuCount').innerText=`${selStu.size} selected / ${list.length}`;
}
function togStu(cb){cb.checked?selStu.add(cb.dataset.k):selStu.delete(cb.dataset.k);$('stuCount').innerText=`${selStu.size} selected / ${classStudents().length}`}
function pickStu(mode){
  const per=$('voucherPeriod').value;selStu.clear();
  if(mode!=='none')classStudents().forEach(s=>{if(mode==='all'||stuState(s,per).miss)selStu.add(skey(s))});
  renderPicker();
}

function openDiscount(vId){
 const rows=allFeesCache.filter(x=>(x.voucher_id||'').trim()===vId);if(!rows.length)return;
 $('dcVid').value=vId;$('dcStudent').value=rows[0].student_name||'';
 $('dcItem').innerHTML=rows.map((r,i)=>`<option value="${i}">${esc(itemName(r))} - PKR ${fmt(r.payable)}</option>`).join('');
 $('dcItemWrap').classList.toggle('hidden',rows.length<2);dcPick();
 $('discountModal').classList.add('open');
}
function dcPick(){
 const rows=allFeesCache.filter(x=>(x.voucher_id||'').trim()===$('dcVid').value),r=rows[+$('dcItem').value||0];if(!r)return;
 $('dcPayable').value=parseFloat(r.payable)||0;$('dcAmt').value=r.discount||'';
 const d=(r.remarks||'').split(' | ').find(x=>x.startsWith('Discount '));$('dcRemarks').value=d?d.replace(/^Discount [^:]*: /,''):'';
}
const closeDiscount=()=>$('discountModal').classList.remove('open');
async function saveDiscount(){
  const vid=$('dcVid').value,amt=parseFloat($('dcAmt').value)||0,rs=$('dcRemarks').value.trim(),pay=parseFloat($('dcPayable').value)||0;
  if(amt<0||amt>pay){showAlert("Discount must be between 0 and the payable amount.");return}
  if(amt>0&&!rs){showAlert("Remarks are required for a discount.");return}
  const r=allFeesCache.filter(x=>(x.voucher_id||'').trim()===vid)[+$('dcItem').value||0]||{};
 const parts=(r.remarks||'').split(' | ').filter(x=>x&&!x.startsWith('Discount '));
  if(amt>0)parts.push(`Discount ${amt}: ${rs}`);
  showLoading("Saving discount...");
  try{
    const res=await fetch(`${SUPABASE_URL}/rest/v1/fees?${rowFilter(r)}`,{method:'PATCH',headers:HJ,body:JSON.stringify({discount:amt,remarks:parts.join(' | ')})});
    hideLoading();
    if(res.ok){closeDiscount();showAlert("Discount saved.");initFeePage()}
    else showAlert("Failed to save: "+await res.text());
  }catch(e){hideLoading();console.error(e);showAlert("Error connecting to database.")}
}
document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.modal.open').forEach(m=>m.classList.remove('open'))});
