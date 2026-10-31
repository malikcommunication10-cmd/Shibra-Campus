"""Shibra Campus regression tests (browser based, no real database needed).

Setup once:   pip install playwright && playwright install chromium
Run:          python tests/run_tests.py

Every page is opened in a real Chromium with the network blocked and the login guard bypassed, and the
important calculations (fee ledger FIFO, statements, students directory, dialogs) are checked with mock data.
"""
import subprocess, sys, time, pathlib
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = 8765
PAGES = ['login', 'index', 'students', 'fees', 'accounts', 'books', 'staff', 'followups', 'increments', 'reports', 'statements', 'settings', 'users', 'audit']
FAILED = []

def check(name, ok, detail=''):
    print(('  PASS  ' if ok else '  FAIL  ') + name + (f'  [{detail}]' if detail and not ok else ''))
    if not ok: FAILED.append(name)

def new_page(browser, errors, page_name):
    pg = browser.new_page()
    pg.clock.install(time='2026-10-29T10:00:00+05:00')
    pg.on('pageerror', lambda e: errors.append(str(e)[:140]))
    pg.route('**/*', lambda r: r.continue_() if f'localhost:{PORT}' in r.request.url else r.abort())
    pg.add_init_script("Object.defineProperty(window,'SB_NO_GUARD',{value:true,writable:true});")
    pg.goto(f'http://localhost:{PORT}/{page_name}.html'); pg.wait_for_timeout(500)
    return pg

def main():
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '-d', str(ROOT)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            print('1. Every page loads without script errors')
            for n in PAGES:
                errs = []; pg = new_page(b, errs, n); check(n, not errs, errs[:1]); pg.close()

            print('2. Fee ledger: one FIFO receipt is shown once and applied month by month')
            errs = []; pg = new_page(b, errs, 'fees')
            out = pg.evaluate("""()=>{ SCHOOL_YEAR=2026;
              const mk=(v,per)=>({voucher_id:v,student_name:'Ali Khan',admis_no:'101',class:'5',period:per,type:'tuition fee',payable:4000,net:4000,discount:0});
              allFeesCache=[mk('V-101','Aug'),mk('V-102','Sep'),mk('V-103','Oct')];
              const t=(v,a,s)=>({voucher_id:v+'-'+s,date:'2026-10-05',amount_in:a,to_account:'cash',description:'Bulk payment via FIFO',remarks:'Bulk payment via FIFO'});
              accountsDataMap={'V-101':{transactions:[t('V-101',4000,'1730000000000-1')]},'V-102':{transactions:[t('V-102',4000,'1730000000000-2')]},'V-103':{transactions:[t('V-103',2000,'1730000000000-3')]}};
              openStudentLedger('Ali Khan','101');
              return {rows:[...document.querySelectorAll('#ledgerTableBody tr')].length, bal:document.getElementById('ledgerTotalBalance').innerText, rc:LEDGER_CTX.receipts.length, amt:LEDGER_CTX.receipts[0].amt};}""")
            check('3 charge rows + 1 receipt row', out['rows'] == 4, out); check('receipt = 10,000', out['amt'] == 10000, out); check('balance = 2,000', '2,000' in out['bal'], out)
            pg.evaluate("()=>{printReceipt(0)}"); pg.wait_for_timeout(120)
            txt = pg.evaluate("document.querySelector('iframe').contentDocument.body.innerText")
            check('printed receipt has number, words and balance', 'RC-101-20261005' in txt and 'Ten Thousand' in txt and 'PKR 2,000' in txt, txt[:160])
            check('no errors', not errs, errs); pg.close()

            print('3. Students directory')
            students = [
              {'sr_no':1,'admis_no':'101','student_name':'Ali Khan','class':'5','doj':'2024-04-01','contact_no_father':'0300-1','monthly_tution_fee':4000,'monthly_tution_pay':4000,'status':'Active','siblings':'F-9'},
              {'sr_no':2,'admis_no':'102','student_name':'Sara Khan','class':'3','doj':'2025-04-01','contact_no_father':'','contact_no_mother':'','monthly_tution_fee':3000,'monthly_tution_pay':3000,'status':'Active','siblings':'F-9'},
              {'sr_no':3,'admis_no':'103','student_name':'Zain Ali','class':'7','monthly_tution_pay':5000,'status':'Left'}]
            fees = [{'voucher_id':'V-1','admis_no':'101','student_name':'Ali Khan','period':'Aug','payable':4000,'discount':0},
                    {'voucher_id':'V-2','admis_no':'101','student_name':'Ali Khan','period':'Sep','payable':4000,'discount':0},
                    {'voucher_id':'V-3','admis_no':'102','student_name':'Sara Khan','period':'Oct','payable':3000,'discount':0}]
            acc = [{'voucher_id':'V-1-1730000000000-1','amount_in':4000}]
            errs = []; pg = new_page(b, errs, 'students')
            pg.evaluate("""([S,F,A])=>{ getSchoolYear=async()=>2026; loadSettingLists=async()=>({Class:['3','5','7']});
              const ok=r=>({ok:true,json:async()=>r});
              ERP.db.request=async(t,q)=>t==='students'?ok(S):t==='fees'?ok(F.filter(x=>!q.includes('eq.')||q.endsWith('eq.'+x.admis_no))):ok([]);
              ERP.db.fetchAll=async t=>t==='fees'?F:A; return initPage(); }""", [students, fees, acc]); pg.wait_for_timeout(600)
            k = pg.inner_text('#stuKpis')
            check('2 active students', 'ACTIVE STUDENTS\n2' in k.upper().replace('\r', ''), k[:80]); check('fees due 7,000', '7,000' in k, k)
            pg.fill('#studentSearch', 'sara'); pg.wait_for_timeout(400)
            check('debounced search filters the list', pg.eval_on_selector_all('#studentTableBody tr', 'e=>e.length') == 1)
            pg.fill('#studentSearch', ''); pg.wait_for_timeout(400)
            pg.evaluate("()=>{deleteStudent('101')}"); pg.wait_for_timeout(300)
            check('student with fee vouchers cannot be deleted', 'cannot be deleted' in pg.inner_text('.ui-modal')); pg.keyboard.press('Escape')
            check('no errors', not errs, errs); pg.close()

            print('4. Financial statements')
            ent = [{'voucher_id':'OB-1','from_account':'Opening Balance','to_account':'cash','amount_in':100000,'amount_out':0,'date':'2026-10-01'},
                   {'voucher_id':'RV-2','from_account':'Donation','to_account':'bank','amount_in':20000,'amount_out':0,'date':'2026-10-06'},
                   {'voucher_id':'PV-3','from_account':'cash','to_account':'Salaries','amount_in':0,'amount_out':30000,'date':'2026-10-07'},
                   {'voucher_id':'FA-P-1','from_account':'cash','to_account':'Fixed asset','amount_in':0,'amount_out':10000,'date':'2026-10-09'},
                   {'voucher_id':'TV-1','from_account':'cash','to_account':'bank','amount_in':8000,'amount_out':8000,'date':'2026-10-11'}]
            errs = []; pg = new_page(b, errs, 'statements')
            pg.evaluate("""([E,F])=>{ loadSettingLists=async()=>({'Payment Account':['Bank']}); getSchoolYear=async()=>2026;
              const ok=r=>({ok:true,json:async()=>r});
              ERP.db.fetchAll=async t=>t==='accounts'?E:[];
              ERP.db.request=async t=>t==='fees'?ok(F):t==='payroll'?ok([{status:'Unpaid',net_salary:15000}]):t==='books'?ok([{type:'purchase',book_title:'Math 5',qty:10,net_amount:5000},{type:'sale',book_title:'Math 5',qty:4,net_amount:3000}]):({ok:false,json:async()=>[]});
              document.getElementById('stFrom').value='2026-10-01';document.getElementById('stTo').value='2026-10-31'; return load(); }""", [ent, fees]); pg.wait_for_timeout(500)
            ie = pg.inner_text('#st-ie'); check('deficit 10,000 (income 20,000 − expense 30,000)', 'DEFICIT\nPKR 10,000' in ie.upper().replace('\r',''), ie[:120])
            pg.click('.st-tab[data-tab="pos"]'); pos = pg.inner_text('#st-pos')
            check('cash 80,000 (100,000+20,000−30,000−10,000)', '80,000' in pos, pos[:200]); check('stock 3,000 (6 × 500)', '3,000' in pos, pos[:300]); check('salaries payable 15,000', '15,000' in pos)
            pg.click('.st-tab[data-tab="aging"]'); check('fees outstanding 6,500 + 3,000... shown', 'PKR' in pg.inner_text('#st-aging'))
            check('no errors', not errs, errs); pg.close()

            print('5. Dialogs')
            errs = []; pg = new_page(b, errs, 'users')
            pg.evaluate("()=>{window.__r={};UI.prompt('Month?',{value:'2026-10'}).then(v=>window.__r.p=v)}"); pg.fill('#uiPromptInput', '2026-11'); pg.keyboard.press('Enter'); pg.wait_for_timeout(100)
            pg.evaluate("()=>{UI.confirm('Delete the role X?').then(v=>window.__r.c=v)}"); pg.wait_for_timeout(80); pg.click('.ui-btn.danger'); pg.wait_for_timeout(80)
            check('prompt returns typed value', pg.evaluate('window.__r.p') == '2026-11'); check('confirm returns true on Yes, delete', pg.evaluate('window.__r.c') is True)
            check('UI.words(10250) = Ten Thousand Two Hundred Fifty', pg.evaluate('UI.words(10250)') == 'Ten Thousand Two Hundred Fifty'); pg.close()
            print('6. Speed: shared table cache and silent refresh')
            errs = []; pg = new_page(b, errs, 'students')
            out = pg.evaluate("""async()=>{
              sbCacheClear(); _sbDataMemory.clear(); let calls=0;
              const rows=[{id:1,admis_no:'1',student_name:'A',class:'5',status:'Active'},{id:2,admis_no:'2',student_name:'B',class:'3',status:'Left'}];
              window.sbFetchAllUncached=async(t,q)=>{calls++;return {ok:true,status:200,json:async()=>rows,text:async()=>''}};
              const a=await (await sbFetchAll('students','select=admis_no,student_name')).json();
              const b=await (await sbFetchAll('students','select=*')).json();
              const c=await (await sbFetchAll('students','select=class')).json();
              return {calls, a:JSON.stringify(a), c:JSON.stringify(c), full:b.length};}""")
            check('3 different column queries = 1 download', out['calls'] == 1, out)
            check('column subset is projected correctly', out['a'] == '[{"admis_no":"1","student_name":"A"},{"admis_no":"2","student_name":"B"}]' and out['c'] == '[{"class":"5"},{"class":"3"}]', out)
            out = pg.evaluate("""async()=>{
              sbCacheClear(); _sbDataMemory.clear(); _sbCanonFailed.clear();
              window.sbFetchAllUncached=async(t,q)=>q==='select=*'?{ok:false,status:403,json:async()=>({}),text:async()=>''}:{ok:true,status:200,json:async()=>[{x:1}],text:async()=>''};
              const r=await (await sbFetchAll('fees','select=x')).json(); return {len:r.length,failed:_sbCanonFailed.has('fees')};}""")
            check('falls back to the original query when the full table is not allowed', out['len'] == 1 and out['failed'], out)
            out = pg.evaluate("""async()=>{
              document.body.setAttribute('onload','window.__n=(window.__n||0)+1'); window.__n=0;
              window.dispatchEvent(new CustomEvent('sb:data-cache-updated',{detail:{table:'students'}}));
              await new Promise(r=>setTimeout(r,1200)); const first=window.__n;
              const m=document.createElement('div'); m.className='fixed inset-0'; m.id='probeModal'; document.body.appendChild(m);
              window.dispatchEvent(new CustomEvent('sb:data-cache-updated',{detail:{table:'students'}}));
              await new Promise(r=>setTimeout(r,1200)); m.remove(); return {first, withModal: window.__n};}""")
            check('background change redraws the page once, quietly', out['first'] == 1, out)
            check('redraw waits while a dialog is open', out['withModal'] == 1, out)
            out = pg.evaluate("""async()=>{
              window.sbHeaders=()=>({}); let n=0; localStorage.clear(); sbCacheClear(); _sbDataMemory.clear();
              window.fetch=async(u)=>{n++; return {ok:true,status:200,text:async()=>JSON.stringify({v:n}),json:async()=>({v:n})}};
              await sbProbe('https://x.supabase.co/rest/v1/books?select=a&limit=1'); await sbProbe('https://x.supabase.co/rest/v1/books?select=a&limit=1');
              const probeCalls=n; n=0;
              const r1=await (await sbRpcCached('app_followup_data',['students'])).json(); const r2=await (await sbRpcCached('app_followup_data',['students'])).json();
              return {probeCalls, rpcCalls:n, same:JSON.stringify(r1)===JSON.stringify(r2)};}""")
            check('schema probe runs once, not on every load', out['probeCalls'] == 1, out)
            check('server function result is reused (1 call for 2 loads)', out['rpcCalls'] == 1 and out['same'], out)
            check('no errors', not errs, errs); pg.close()

            print('7. Follow-up cards (LPD / LPA) and layout')
            errs = []; pg = new_page(b, errs, 'followups')
            pg.evaluate("""()=>{
              const st=(adm,n,sib)=>({admis_no:adm,student_name:n,class:'5',status:'Active',siblings:sib,monthly_tution_fee:4000,contact_no_father:'0300-1234567'});
              const fee=(v,adm,n,per,sib)=>({voucher_id:v,admis_no:adm,student_name:n,class:'5',period:per,type:'tuition fee',payable:4000,discount:0,siblings:sib});
              const R={school_year:2026,assignments:[],assignees:[],students:[st('1','Ali','F-9'),st('2','Sara','F-9'),st('3','Noor','F-7')],
                fees:[fee('V-1','1','Ali','Aug','F-9'),fee('V-2','1','Ali','Sep','F-9'),fee('V-3','2','Sara','Oct','F-9'),fee('V-4','3','Noor','Oct','F-7')],
                accounts:[{voucher_id:'V-1-1730000000000-1',date:'2026-10-05',amount_in:4000},{voucher_id:'V-2-1730000000000-2',date:'2026-10-05',amount_in:1000},{voucher_id:'V-3-1731111111111-1',date:'2026-09-20',amount_in:2000}]};
              window.sbRpcCached=async()=>({ok:true,status:200,json:async()=>R,text:async()=>''}); window.loadLogs=async()=>{}; return initFollowups(); }"""); pg.wait_for_timeout(500)
            cards = pg.eval_on_selector_all('.fam-card', 'els=>els.map(e=>e.innerText.replace(/\\s+/g," "))')
            check('family with two children: LPD = latest receipt date', any('LPD: 05 Oct 2026' in c for c in cards), cards)
            check('LPA counts one bulk receipt once (4,000 + 1,000 = 5,000)', any('LPA: PKR 5,000' in c for c in cards), cards)
            check('family with no payment shows a dash', any('LPD: —' in c and 'LPA: —' in c for c in cards), cards)
            check('no errors', not errs, errs); pg.close()
            for n in PAGES:
                pg = b.new_page(viewport={'width': 1280, 'height': 800}); pg.route('**/*', lambda r: r.continue_() if f'localhost:{PORT}' in r.request.url else r.abort())
                pg.add_init_script("Object.defineProperty(window,'SB_NO_GUARD',{value:true,writable:true});"); pg.goto(f'http://localhost:{PORT}/{n}.html'); pg.wait_for_timeout(400)
                over = pg.evaluate("document.documentElement.scrollWidth-document.documentElement.clientWidth")
                check(f'{n}: no sideways page scroll at 1280px (sidebar cannot cover content)', over <= 1, over); pg.close()

            print('8. Fee page: table fits the screen, student Bulk pay')
            errs = []; pg = new_page(b, errs, 'fees'); pg.set_viewport_size({'width': 1280, 'height': 800})
            out = pg.evaluate("""()=>{ SCHOOL_YEAR=2026;
              const mk=(v,adm,n,per,paid)=>({voucher_id:v,student_name:n,admis_no:adm,class:'5',period:per,type:'tuition fee',payable:4000,net:4000,discount:0,totalPaid:paid,paymentDates:'2026-10-05'});
              window.__rows=[mk('V-1','101','Muhammad Abdul Rehman Qureshi','Aug',1000),mk('V-2','101','Muhammad Abdul Rehman Qureshi','Sep',0),mk('V-3','101','Muhammad Abdul Rehman Qureshi','Oct',0),mk('V-4','101','Muhammad Abdul Rehman Qureshi','Nov',0)];
              allFeesCache=window.__rows.slice(); for(let i=0;i<24;i++)allFeesCache.push(mk('V-9'+i,'2'+i,'Student Number '+i,'Oct',0));
              renderFeesTable(allFeesCache);
              const v=document.getElementById('voucherView'); return {sw:v.scrollWidth,cw:v.clientWidth,cols:document.querySelectorAll('#feesTableBody tr:first-child td').length};}""")
            check('voucher table has 9 columns', out['cols'] == 9, out); check('no sideways scroll in the voucher table (1280px)', out['sw'] <= out['cw'] + 1, out)
            out = pg.evaluate("""()=>{ window.__posted=null; window.postAccounts=async p=>{window.__posted=p;return true}; window.showConfirm=(m,cb)=>cb(); window.initFeePage=async()=>{};
              $('payToAccount').innerHTML='<option value="cash">Cash</option>'; openPayModal('V-2'); openStudentBulkPay();
              const total=$('sbTotal').value, lines=document.querySelectorAll('#sbDues tbody tr').length; $('sbAmount').value=15000; sbPreview();
              const prev=document.getElementById('sbPreview').innerText.replace(/\\s+/g,' '); submitStuBulk(); return {total,lines,prev};}""")
            pg.wait_for_timeout(200); posted = pg.evaluate('window.__posted')
            check('dues up to today = Aug 3,000 + Sep 4,000 + Oct 4,000', out['total'] == 'PKR 11,000' and out['lines'] == 3, out)
            check('preview shows an advance for November', 'advance' in out['prev'].lower() and 'V-4' in out['prev'], out['prev'])
            check('4 payment rows: 3,000 / 4,000 / 4,000 / 4,000 (advance)', posted is not None and [x['amount_in'] for x in posted] == [3000, 4000, 4000, 4000], posted)
            check('advance row goes to the Nov voucher', posted is not None and posted[-1]['voucher_id'].startswith('V-4-') and posted[-1]['voucher_id'].endswith('-adv'), posted)
            check('receipt label keeps the "Type (Period) - Student" format', posted is not None and posted[0]['from_account'] == 'tuition fee (Aug) - Muhammad Abdul Rehman Qureshi', posted[0] if posted else None)
            check('no errors', not errs, errs); pg.close()

            print('9. Sidebar: hide button (desktop) and drawer (mobile)')
            R = "s=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect(),c=getComputedStyle(e);return {l:Math.round(r.left),r:Math.round(r.right),disp:c.display,vis:c.visibility,sh:c.boxShadow}}"
            def ctx_for(w, h, mobile=False):
                c = b.new_context(viewport={'width': w, 'height': h}, is_mobile=mobile, has_touch=mobile)
                c.route('**/*', lambda r, req=None: r.continue_() if f'localhost:{PORT}' in r.request.url else r.abort())
                c.add_init_script("Object.defineProperty(window,'SB_NO_GUARD',{value:true,writable:true});"); return c
            c = ctx_for(1366, 800); pg = c.new_page(); pg.goto(f'http://localhost:{PORT}/fees.html'); pg.wait_for_timeout(500)
            a = pg.evaluate(R, '#appNav'); check('desktop: sidebar is beside the content', a['l'] == 0 and a['r'] == 272 and pg.evaluate(R, 'main')['l'] == 272, a)
            pg.click('#navCollapseBtn'); pg.wait_for_timeout(100)
            check('desktop: Hide button hides the sidebar and the page uses the full width', pg.evaluate(R, '#appNav')['disp'] == 'none' and pg.evaluate(R, 'main')['l'] == 0)
            check('desktop: a small tab is shown to bring it back', pg.evaluate(R, '#navReopen')['disp'] == 'flex')
            pg.goto(f'http://localhost:{PORT}/students.html'); pg.wait_for_timeout(400)
            check('desktop: the choice is remembered on the next page', pg.evaluate(R, '#appNav')['disp'] == 'none')
            pg.click('#navReopen'); pg.wait_for_timeout(100); check('desktop: the tab shows the sidebar again', pg.evaluate(R, '#appNav')['disp'] == 'flex'); c.close()
            c = ctx_for(900, 700); pg = c.new_page(); pg.goto(f'http://localhost:{PORT}/accounts.html'); pg.wait_for_timeout(400)
            check('tablet / narrow window: starts with the sidebar hidden', pg.evaluate("document.documentElement.classList.contains('nav-collapsed')")); c.close()
            c = ctx_for(390, 780, True); pg = c.new_page(); pg.goto(f'http://localhost:{PORT}/fees.html'); pg.wait_for_timeout(500)
            a = pg.evaluate(R, '#appNav')
            check('mobile: closed drawer is off-screen, invisible and casts no shadow', a['r'] <= 0 and a['vis'] == 'hidden' and a['sh'] == 'none', a)
            check('mobile: content uses the whole width', pg.evaluate(R, 'main')['l'] == 0 and pg.evaluate("document.documentElement.scrollWidth-innerWidth") <= 0)
            pg.click('#appMenuBtn'); pg.wait_for_timeout(400); a = pg.evaluate(R, '#appNav'); check('mobile: menu button opens the drawer', a['l'] == 0 and a['vis'] == 'visible', a)
            pg.click('#navCloseBtn'); pg.wait_for_timeout(400); check('mobile: the X button closes it', pg.evaluate(R, '#appNav')['vis'] == 'hidden')
            pg.click('#appMenuBtn'); pg.wait_for_timeout(300); pg.mouse.click(375, 400); pg.wait_for_timeout(400); check('mobile: tapping outside closes it', pg.evaluate(R, '#appNav')['vis'] == 'hidden')
            pg.click('#appMenuBtn'); pg.wait_for_timeout(300); pg.keyboard.press('Escape'); pg.wait_for_timeout(400); check('mobile: Esc closes it', pg.evaluate(R, '#appNav')['vis'] == 'hidden'); c.close()

            b.close()
    finally:
        srv.terminate()
    print('\n' + ('ALL TESTS PASSED' if not FAILED else f'{len(FAILED)} FAILED: ' + ', '.join(FAILED)))
    sys.exit(1 if FAILED else 0)

if __name__ == '__main__':
    main()
