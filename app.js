/* ==========================================================================
   app.js — ระบบผังจราจรและทางเบี่ยง: ล็อกอิน · รายการผัง · สร้าง/แก้ไขผัง · ตั้งค่า
   ผัง 3 แบบ: ทางเบี่ยงอุทกภัย (flood) · ติดตั้งสิ่งอำนวยความปลอดภัย (safety) · แนวทางระบายน้ำ (drain)
   ========================================================================== */
(function () {
  'use strict';
  const $ = function (id) { return document.getElementById(id); };
  const esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  const P = window.Poster;
  const S = { team: [], plans: [], cur: null, dirty: false, view: 'list', filter: 'all', q: '', trash: false, files: [], open: {} };

  const KIND = {
    flood:  { name: 'ผังทางเบี่ยงอุทกภัย', short: 'ทางเบี่ยงอุทกภัย', ic: '🌊', badge: 'b-info', desc: 'ภาพรวมช่วงน้ำท่วม + เส้นทางเบี่ยง (ระบบหาทางเบี่ยงที่ไม่ผ่านน้ำท่วมให้เอง) เลือกได้ 3 สไตล์' },
    safety: { name: 'ผังติดตั้งสิ่งอำนวยความปลอดภัย', short: 'สิ่งอำนวยความปลอดภัย', ic: '🚧', badge: 'b-warn', desc: 'งานก่อสร้าง · อุบัติเหตุ · งานบำรุงทาง — ระบบวางป้ายเตือน กรวย แผงกั้น ไฟกระพริบ ตามระยะให้เอง' },
    drain:  { name: 'ผังแนวทางระบายน้ำ', short: 'แนวทางระบายน้ำ', ic: '💧', badge: 'b-ok', desc: 'ใส่จุดน้ำท่วมขัง ระบบไล่ระดับพื้นดินหาทางน้ำไหล และบอกว่าระบายลงคลอง/ลำรางใด' }
  };
  const WORK = ['งานก่อสร้าง', 'อุบัติเหตุ', 'งานบำรุงทาง', 'งานซ่อมผิวทาง', 'งานตัดต้นไม้/กิ่งไม้', 'งานระบายน้ำ'];

  /* ======================= ตัวช่วย ======================= */
  let toastTimer = null;
  function toast(msg, isErr) {
    const t = $('toast'); t.textContent = msg; t.classList.toggle('err', !!isErr); t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('show'); }, isErr ? 5500 : 2600);
  }
  function busy(btn, text) {
    if (!btn) return function () {};
    const old = btn.innerHTML; btn.disabled = true; btn.textContent = text || 'กำลังทำงาน...';
    return function () { btn.disabled = false; btn.innerHTML = old; };
  }
  function pwField(id, ac) {
    return '<div class="pw-wrap"><input type="password" id="' + id + '" autocomplete="' + (ac || 'new-password') + '"><button type="button" class="pw-toggle" data-target="' + id + '" title="แสดง/ซ่อนรหัสผ่าน">👁</button></div>';
  }
  function bindPw(root) {
    root.querySelectorAll('.pw-toggle').forEach(function (b) {
      // แบบเดียวกับระบบรายงานประจำเดือน: กดแล้วสลับรูป 👁 / 🙈 และคงเคอร์เซอร์ไว้ในช่อง
      b.onclick = function () {
        const i = $(b.dataset.target); if (!i) return;
        const show = i.type === 'password';
        i.type = show ? 'text' : 'password'; b.textContent = show ? '🙈' : '👁'; i.focus();
      };
    });
  }
  function today() { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
  function thDate(iso, short) {
    if (!iso) return '';
    const d = new Date(iso.length <= 10 ? iso + 'T00:00' : iso);
    if (isNaN(d)) return '';
    return d.toLocaleDateString('th-TH', { day: 'numeric', month: short ? 'short' : 'long', year: 'numeric' });
  }
  function getP(o, path) { return path.split('.').reduce(function (a, k) { return a == null ? a : a[k]; }, o); }
  function setP(o, path, v) { const ks = path.split('.'), last = ks.pop(); ks.reduce(function (a, k) { return a[k] = a[k] || {}; }, o)[last] = v; }
  function pt() { return { name: '', km: '', lat: null, lng: null }; }
  function canAdmin() { return FBL.user && (FBL.user.isOwner || FBL.user.isAdmin); }
  function fmtKm(m) { return (m / 1000).toFixed(2) + ' กม.'; }

  /* ======================= ความจำพิกัด (ชื่อจุด → พิกัด) =======================
     จำชื่อจุดที่เคยลงพิกัดไว้ จากทุกผังของทีม (Firestore) + จุดที่เพิ่งกรอกในเครื่องนี้
     ครั้งต่อไปใส่แค่ชื่อ เช่น "แยกตะพง" ระบบเติมพิกัด (และ กม.) ให้เอง */
  const MEMO_KEY = 'tp_places_v1';
  const PT_KEYS = ['flood', 'detour', 'detour2', 'zone', 'drain'];
  function normName(s) { return String(s || '').toLowerCase().replace(/[\s.,:;\-–()（）'"“”]/g, ''); }
  function baseName(s) { return normName(s).replace(/^(ทางแยก|สี่แยก|สามแยก|แยก|วงเวียน|จุด)/, ''); }
  // ทุกคู่จุดต้น-ปลายของผัง (รวมช่วงน้ำท่วมเพิ่มเติม floods2)
  function ptGroups(p) { return PT_KEYS.map(function (k) { return p[k]; }).concat(Array.isArray(p.floods2) ? p.floods2 : []).filter(Boolean); }
  function memoLocal() { try { return JSON.parse(localStorage.getItem(MEMO_KEY)) || {}; } catch (e) { return {}; } }
  // จำจุดที่มีทั้งชื่อและพิกัดของผังนี้ไว้ในเครื่อง (เผื่อยังไม่ได้บันทึกผัง)
  function remember(p) {
    if (!p) return;
    const m = memoLocal(), t = new Date().toISOString();
    ptGroups(p).forEach(function (g) {
      [g.a, g.b].forEach(function (q) {
        if (q && q.name && P.has(q) && normName(q.name)) m[normName(q.name)] = { name: q.name.trim(), km: q.km || '', lat: q.lat, lng: q.lng, t: t };
      });
    });
    try { localStorage.setItem(MEMO_KEY, JSON.stringify(m)); } catch (e) { /* ข้าม */ }
  }
  // รายชื่อจุดที่รู้พิกัด: { ชื่อที่ปรับรูปแล้ว: {name, km, lat, lng, t} } — ถ้าชื่อซ้ำใช้ของล่าสุด
  function places() {
    const m = {};
    const put = function (q, t) {
      if (!q || !q.name || !P.has(q)) return;
      const k = normName(q.name);
      if (k && (!m[k] || m[k].t <= t)) m[k] = { name: String(q.name).trim(), km: q.km || '', lat: q.lat, lng: q.lng, t: t };
    };
    // จุดแยก/U-Turn จากไฟล์ Google Earth ของแขวงฯ (refdata.js) — ลำดับต่ำสุด ชื่อซ้ำใช้ที่ทีมลงไว้
    (P.refPts || []).forEach(function (r) { put(r, ''); });
    const lm = memoLocal();
    Object.keys(lm).forEach(function (k) { put(lm[k], lm[k].t || ''); });
    (Array.isArray(S.plans) ? S.plans : []).forEach(function (p) {
      const t = p.deletedAt ? '0' : (p.updatedAt || '');   // ผังในถังขยะใช้เป็นตัวเลือกสุดท้าย
      ptGroups(p).forEach(function (g) { put(g.a, t); put(g.b, t); });
    });
    return m;
  }
  function findPlace(name, all) {
    const k = normName(name);
    if (!k) return null;
    all = all || places();
    if (all[k]) return all[k];
    // ไม่ตรงทั้งคำ: ลองเทียบโดยไม่สนคำนำหน้า เช่น "ตะพง" = "แยกตะพง"
    const b = baseName(name);
    if (b.length < 2) return null;
    let best = null;
    Object.keys(all).forEach(function (x) { if (baseName(x) === b && (!best || best.t < all[x].t)) best = all[x]; });
    return best;
  }
  // เติมพิกัดให้จุดที่มีชื่อแต่ยังไม่มีพิกัด · คืนรายชื่อจุดที่เติมให้
  function fillKnown(p) {
    const all = places(), got = [];
    ptGroups(p).forEach(function (g) {
      [g.a, g.b].forEach(function (q) {
        if (!q || !q.name || P.has(q)) return;
        const f = findPlace(q.name, all);
        if (!f) return;
        q.lat = f.lat; q.lng = f.lng;
        if (!q.km && f.km) q.km = f.km;
        got.push(q.name);
      });
    });
    return got;
  }
  function knownList() {
    const all = places();
    return Object.keys(all).map(function (k) { return all[k]; });
  }

  function newPlan(kind) {
    const p = { kind: kind, status: 'active', date: today(), org: 'แขวงทางหลวงระยอง', road: '', section: '', place: '', title: '', base: 'sat', pos: {}, view: null };
    if (kind === 'flood') Object.assign(p, { style: 'doh', flood: { a: pt(), b: pt(), via: [], depth: '' }, floods2: [], detour: { a: pt(), b: pt(), via: [] }, detour2: null, dirLeft: '', dirRight: '' });
    if (kind === 'safety') Object.assign(p, { workType: 'งานก่อสร้าง', speed: 90, side: 'left', both: false, zone: { a: pt(), b: pt(), via: [] }, devices: [] });
    if (kind === 'drain') Object.assign(p, { drain: { a: pt(), b: pt(), via: [] }, devices: [], waterLines: [] });
    return p;
  }
  function autoTitle(p) {
    const r = p.kind === 'flood' ? p.flood : p.kind === 'safety' ? p.zone : p.drain;
    return [KIND[p.kind].short, p.kind === 'safety' ? p.workType : '', P.roads(p).length ? 'ทล.' + P.roads(p).join(', ') : '', p.place || (r && r.a && r.a.name) || '', thDate(p.date, true)].filter(Boolean).join(' · ');
  }
  function titleOf(p) { return p.title || autoTitle(p); }

  /* ======================= ล็อกอิน ======================= */
  let teamLoadError = '', appStarted = false;
  function hideLoading() { $('pageLoadingOverlay').classList.add('hide'); }
  function gateError(msg) { const el = $('gateError'); if (el) el.textContent = msg; }
  // หน้าล็อกอิน — โครงสร้างและคลาสเดียวกับระบบรายงานประจำเดือน (สไตล์อยู่ใน index.html หัวข้อ "หน้าล็อกอิน")
  function renderGate(errorMsg) {
    const g = $('authGate'); hideLoading(); g.classList.add('show');
    $('appHeader').style.display = 'none'; $('main').style.display = 'none';
    const demo = FBL.mode === 'demo' ? '<div class="demo-note"><b>โหมดทดลอง</b> — ข้อมูลเก็บในเบราว์เซอร์เครื่องนี้เท่านั้น (ใช้งานจริงให้เปิดจากเว็บที่อัปโหลดแล้ว)</div>' : '';
    const head = '<img src="logo.png" alt="ตรากรมทางหลวง"><h1>งานผังจราจร</h1><p class="sub">หมวดทางหลวงเชิงเนิน · แขวงทางหลวงระยอง</p>' + demo;
    const err = '<div class="err" id="gateError">' + esc(errorMsg || '') + '</div>';
    if (teamLoadError) {
      g.innerHTML = '<div class="login-card">' + head + '<form onsubmit="return false"><h3 class="login-h3">เชื่อมต่อฐานข้อมูลไม่สำเร็จ</h3><div class="err">' + esc(teamLoadError) + '</div><button class="btn btn-primary" type="button" id="gateRetry">ลองอีกครั้ง</button></form></div>';
      $('gateRetry').onclick = function () { location.reload(); };
      return;
    }
    if (!S.team.length) {
      if (FBL.mode !== 'demo') {
        g.innerHTML = '<div class="login-card">' + head + '<form onsubmit="return false"><h3 class="login-h3">ยังไม่มีผู้ใช้งาน</h3><p class="note">ระบบนี้ใช้รายชื่อผู้ใช้ร่วมกับระบบ "งานควบคุมงานโครงการ" กรุณาตั้งเจ้าของระบบและเพิ่มผู้ใช้ที่ระบบนั้นก่อน</p></form></div>';
        return;
      }
      g.innerHTML = '<div class="login-card">' + head + '<form id="gForm"><h3 class="login-h3">ตั้งค่าเจ้าของระบบ (โหมดทดลอง)</h3>' +
        '<div><label class="f" for="gName">ชื่อ-นามสกุลของคุณ</label><input type="text" id="gName" autocomplete="off"></div>' +
        '<div><label class="f" for="gP1">ตั้งรหัสผ่าน (อย่างน้อย 8 ตัวอักษร)</label>' + pwField('gP1') + '</div>' +
        '<div class="login-pw"><label class="f" for="gP2">ยืนยันรหัสผ่าน</label>' + pwField('gP2') + '</div>' + err +
        '<button class="btn btn-primary" type="submit" id="gClaim">ตั้งค่าและเข้าสู่ระบบ</button></form></div>';
      bindPw(g);
      $('gForm').onsubmit = async function (ev) {
        ev.preventDefault();
        const n = $('gName').value.trim(), p1 = $('gP1').value, p2 = $('gP2').value;
        if (!n || !p1) return gateError('กรอกชื่อและรหัสผ่านให้ครบ');
        if (p1.length < 8) return gateError('รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร');
        if (p1 !== p2) return gateError('รหัสผ่านสองช่องไม่ตรงกัน');
        const done = busy($('gClaim'), 'กำลังตั้งค่า...');
        try { const u = await FBL.bootstrapOwner(n, p1); S.team = FBL.team(); onAuth(u); } catch (e) { done(); gateError(e.message); }
      };
      return;
    }
    g.innerHTML = '<div class="login-card">' + head + '<form id="gForm"><h3 class="login-h3">เข้าสู่ระบบ</h3>' +
      '<div><label class="f" for="gSel">ชื่อผู้ใช้งาน</label><select id="gSel"><option value="">— เลือกชื่อของคุณ —</option>' +
      S.team.map(function (m) { return '<option value="' + esc(m.name) + '">' + esc(m.name) + '</option>'; }).join('') + '</select></div>' +
      '<div class="login-pw"><label class="f" for="gPass">รหัสผ่าน</label><input type="text" id="gShadow" name="username" autocomplete="username" tabindex="-1" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0">' + pwField('gPass', 'current-password') + '</div>' +
      err + '<button class="btn btn-primary" type="submit" id="gOk">เข้าสู่ระบบ</button></form></div>';
    bindPw(g);
    const sel = $('gSel'), sh = $('gShadow');
    sel.onchange = function () { sh.value = sel.value; };
    sh.oninput = function () { if ([].some.call(sel.options, function (o) { return o.value === sh.value; })) sel.value = sh.value; };
    $('gForm').onsubmit = async function (ev) {
      ev.preventDefault();
      gateError('');
      if (!sel.value) return gateError('เลือกชื่อของคุณก่อน');
      if (!$('gPass').value) return gateError('กรอกรหัสผ่าน');
      const done = busy($('gOk'), 'กำลังเข้าสู่ระบบ…');
      try { await FBL.login(sel.value, $('gPass').value); } catch (e) { done(); gateError(e.message); }
    };
  }
  function onAuth(user, errorMsg) {
    if (!user) { appStarted = false; renderGate(errorMsg); return; }
    $('authGate').classList.remove('show'); $('authGate').innerHTML = '';
    startApp();
  }
  async function boot() {
    FBL.onError = function (m) { toast(m, true); };
    try { S.team = await FBL.loadTeam(); } catch (e) { teamLoadError = FBL.errorText(e); }
    FBL.onAuth(onAuth);
  }

  /* ======================= เริ่มระบบ ======================= */
  async function startApp() {
    if (appStarted) return;
    appStarted = true;
    $('appHeader').style.display = ''; $('main').style.display = '';
    $('demoBadge').style.display = FBL.mode === 'demo' ? '' : 'none';
    $('whoDisplay').textContent = 'ผู้ใช้งาน: ' + FBL.user.name + (FBL.user.isOwner ? ' 👑' : FBL.user.isAdmin ? ' 🛡️' : '');
    $('btnLogout').onclick = async function () {
      if (S.dirty && !confirm('ผังที่แก้ไขยังไม่ได้บันทึก ออกจากระบบเลยหรือไม่?')) return;
      await FBL.logout(); location.reload();
    };
    $('tabs').querySelectorAll('.tab-btn').forEach(function (b) { b.onclick = function () { go(b.dataset.view); }; });
    window.addEventListener('beforeunload', function (e) { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });
    S.plans = await FBL.watchPlans(function (docs) { S.plans = docs; if (S.view === 'list') renderList(); });
    hideLoading();
    buildEditor();
    go('list');
  }
  function go(v) {
    S.view = v;
    document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.toggle('active', b.dataset.view === v); });
    document.querySelectorAll('.view').forEach(function (s) { s.classList.toggle('active', s.id === 'view-' + v); });
    if (v === 'list') renderList();
    if (v === 'edit') { renderForm(); setTimeout(function () { P.scale(); P.map().invalidateSize(); }, 30); }
    if (v === 'settings') renderSettings();
  }

  /* ======================= รายการผัง ======================= */
  function renderList() {
    const el = $('view-list');
    const q = S.q.trim().toLowerCase();
    const rows = S.plans.filter(function (p) {
      if (!!p.deletedAt !== S.trash) return false;
      if (S.filter !== 'all' && p.kind !== S.filter) return false;
      return !q || (titleOf(p) + ' ' + (p.place || '') + ' ' + (p.road || '')).toLowerCase().indexOf(q) >= 0;
    }).sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')); });
    const trashN = S.plans.filter(function (p) { return p.deletedAt; }).length;
    el.innerHTML =
      (S.trash ? '' : '<div class="new-cards">' + Object.keys(KIND).map(function (k) {
        return '<button class="new-card" data-new="' + k + '"><span class="ic">' + KIND[k].ic + '</span><div><b>+ ' + KIND[k].name + '</b><span>' + KIND[k].desc + '</span></div></button>';
      }).join('') + '</div>') +
      '<div class="card"><div class="section-title">' + (S.trash ? '🗑 ถังขยะ' : 'ผังที่บันทึกไว้') + ' <span class="sub">' + rows.length + ' ผัง</span>' +
      '<span style="margin-left:auto" class="flex">' +
      ['all', 'flood', 'safety', 'drain'].map(function (k) { return '<span class="chip' + (S.filter === k ? ' active' : '') + '" data-f="' + k + '">' + (k === 'all' ? 'ทั้งหมด' : KIND[k].ic + ' ' + KIND[k].short) + '</span>'; }).join('') +
      '<input class="inp" id="lsQ" placeholder="ค้นหา..." style="width:180px" value="' + esc(S.q) + '">' +
      '<button class="btn btn-sm btn-outline" id="lsTrash">' + (S.trash ? '← กลับรายการผัง' : '🗑 ถังขยะ (' + trashN + ')') + '</button></span></div>' +
      (S.trash && canAdmin() && rows.length ? '<div class="alert warn">ผังในถังขยะยังกินพื้นที่ฐานข้อมูล กด "ลบถาวร" หรือ "ล้างถังขยะ" เมื่อไม่ใช้แล้ว (ลบถาวรแล้วกู้คืนไม่ได้) <button class="btn btn-sm btn-danger" id="lsEmpty" style="margin-left:auto">ล้างถังขยะทั้งหมด</button></div>' : '') +
      (S.trash && !canAdmin() ? '<div class="alert info">ลบถาวรได้เฉพาะเจ้าของระบบหรือผู้ดูแลระบบ</div>' : '') +
      '<div class="table-wrap"><table class="data"><thead><tr><th>วันที่</th><th>ชนิด</th><th>ชื่อผัง</th><th>ทางหลวง</th><th>สถานะ</th><th>แก้ไขล่าสุด</th><th></th></tr></thead><tbody>' +
      (rows.length ? rows.map(function (p) {
        return '<tr class="clickable" data-id="' + esc(p.id) + '"><td class="small">' + esc(thDate(p.date, true)) + '</td>' +
          '<td><span class="badge ' + KIND[p.kind].badge + '">' + KIND[p.kind].ic + ' ' + KIND[p.kind].short + '</span></td>' +
          '<td>' + esc(titleOf(p)) + '</td><td>' + (p.road ? 'ทล.' + esc(p.road) : '') + '</td>' +
          '<td>' + (p.status === 'ended' ? '<span class="badge b-mute">สิ้นสุดแล้ว</span>' : '<span class="badge b-ok">ใช้งานอยู่</span>') + '</td>' +
          '<td class="small muted">' + esc(p.updatedBy || '') + '<br>' + esc(thDate(p.updatedAt, true)) + '</td>' +
          '<td style="white-space:nowrap">' + (S.trash
            ? '<button class="btn btn-sm btn-outline" data-act="restore">กู้คืน</button> ' + (canAdmin() ? '<button class="btn btn-sm btn-danger" data-act="hard">ลบถาวร</button>' : '')
            : '<button class="btn btn-sm btn-outline" data-act="dup">ทำสำเนา</button> <button class="btn btn-sm btn-danger" data-act="del">ลบ</button>') + '</td></tr>';
      }).join('') : '<tr><td colspan="7" class="empty">' + (S.trash ? 'ถังขยะว่าง' : 'ยังไม่มีผัง — เลือกชนิดผังด้านบนเพื่อเริ่มสร้าง') + '</td></tr>') +
      '</tbody></table></div></div>';
    el.querySelectorAll('[data-new]').forEach(function (b) { b.onclick = function () { openPlan(newPlan(b.dataset.new)); }; });
    el.querySelectorAll('[data-f]').forEach(function (c) { c.onclick = function () { S.filter = c.dataset.f; renderList(); }; });
    $('lsQ').oninput = function () { S.q = this.value; const pos = this.selectionStart; renderList(); const i = $('lsQ'); i.focus(); i.setSelectionRange(pos, pos); };
    $('lsTrash').onclick = function () { S.trash = !S.trash; renderList(); };
    if ($('lsEmpty')) $('lsEmpty').onclick = async function () {
      const list = S.plans.filter(function (p) { return p.deletedAt; });
      if (!confirm('ลบถาวรผังในถังขยะทั้งหมด ' + list.length + ' ผัง?\nกู้คืนไม่ได้')) return;
      const done = busy(this, 'กำลังลบ...');
      try { for (const p of list) await FBL.hardDeletePlan(p); toast('ล้างถังขยะแล้ว'); } catch (e) { toast(e.message, true); }
      done();
    };
    el.querySelectorAll('tr[data-id]').forEach(function (tr) {
      const p = S.plans.find(function (x) { return x.id === tr.dataset.id; });
      tr.onclick = function (e) {
        const act = e.target.dataset && e.target.dataset.act;
        if (!act) { if (!S.trash) openPlan(JSON.parse(JSON.stringify(p))); return; }
        e.stopPropagation();
        if (act === 'dup') { const c = JSON.parse(JSON.stringify(p)); ['id', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy'].forEach(function (k) { delete c[k]; }); c.title = titleOf(p) + ' (สำเนา)'; c.date = today(); openPlan(c); }
        if (act === 'del' && confirm('ย้าย "' + titleOf(p) + '" ไปถังขยะ?')) FBL.softDeletePlan(p).then(function () { toast('ย้ายไปถังขยะแล้ว'); }, function (er) { toast(er.message, true); });
        if (act === 'restore') FBL.softDeletePlan(p, true).then(function () { toast('กู้คืนแล้ว'); }, function (er) { toast(er.message, true); });
        if (act === 'hard' && confirm('ลบ "' + titleOf(p) + '" ถาวร?\nกู้คืนไม่ได้')) FBL.hardDeletePlan(p).then(function () { toast('ลบถาวรแล้ว'); }, function (er) { toast(er.message, true); });
      };
    });
  }

  /* ======================= หน้าแก้ไขผัง ======================= */
  function buildEditor() {
    $('view-edit').innerHTML = '<div class="editor"><div class="ed-form no-print" id="edForm"></div>' +
      '<div class="ed-right"><div class="ed-bar no-print">' +
        '<button class="btn btn-primary" id="edSave">💾 บันทึก</button>' +
        '<button class="btn btn-gold" id="edPng">⬇ รูป PNG</button>' +
        '<button class="btn btn-outline" id="edPrint">🖨 พิมพ์ / PDF</button>' +
        '<button class="btn btn-outline" id="edText">📋 คัดลอกข้อความประกาศ</button>' +
        '<span style="margin-left:auto" class="flex"><button class="btn btn-sm btn-outline" id="edFit">⤢ ซูมพอดี</button><button class="btn btn-sm btn-outline" id="edLabels">↺ จัดป้ายใหม่</button></span>' +
      '</div><div class="ed-status no-print" id="edStatus"></div><div class="pz-stage" id="pzStage"></div>' +
      '<p class="hint no-print" id="edTips"></p></div></div>';
    P.logos = { old: window.LOGO_DATA || 'logo.png' };
    if (window.LOGO_NEW_DATA) P.logos.new = window.LOGO_NEW_DATA;
    P.logoDefault = logoPref();
    P.mount($('pzStage'), P.logoSrc(null));
    P.onBusy = status;
    P.onSelect = function (k) { if (k) status('ลากจุดวงกลมเพื่อปรับเส้น · คลิกบนเส้นเพื่อเพิ่มจุด · ดับเบิลคลิกจุดเพื่อลบ · คลิกที่ว่างเมื่อเสร็จ'); else status(''); };
    P.onPlaced = function () { renderPalette(); };
    $('edSave').onclick = save;
    $('edPng').onclick = async function () {
      if (!S.cur) return;
      const done = busy(this, 'กำลังสร้างรูป...');
      try { await P.exportPng(titleOf(S.cur).replace(/[\\/:*?"<>|]/g, '_')); } catch (e) { toast('สร้างรูปไม่สำเร็จ: ' + (e.message || e) + ' — ใช้ "พิมพ์ / PDF" แทน', true); }
      done();
    };
    $('edPrint').onclick = function () { if (S.cur) P.print(); };
    $('edText').onclick = function () {
      if (!S.cur) return;
      const t = announce(S.cur);
      (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { toast('คัดลอกข้อความประกาศแล้ว วางใน LINE/Facebook ได้เลย'); }, function () { prompt('คัดลอกข้อความนี้', t); });
    };
    $('edFit').onclick = function () { if (S.cur) P.fit(); };
    $('edLabels').onclick = function () { if (S.cur) P.autoLabels(); };
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && S.cur) { P.startPlacing(null); P.onPick = null; P.drawRef(); P.select(null); renderPalette(); } });
  }
  function status(msg, err) { const el = $('edStatus'); if (!el) return; el.textContent = msg || ''; el.classList.toggle('err', !!err); }
  function markDirty() { S.dirty = true; }
  function onPoster(what) {
    if (what !== 'view') markDirty();
    if (what === 'coords') refreshPtInputs();
    if (what === 'devices' || what === 'route') refreshLens();
    if (what === 'ref') renderRefList();
  }
  function openPlan(p) {
    if (S.dirty && !confirm('ผังเดิมยังไม่ได้บันทึก เปิดผังอื่นเลยหรือไม่?')) return;
    S.cur = p; S.dirty = !p.id; S.files = [];
    go('edit');
    P.setPlan(S.cur, onPoster);
    const has = linesReady();
    if (!has) { const c = firstCoord(); if (c) P.map().setView([c.lat, c.lng], 14); }
    status(has ? '' : 'กรอกข้อมูลด้านซ้าย (หรือให้ AI กรอก) แล้วกด ⚡ สร้างผังอัตโนมัติ');
  }
  function linesReady() { const p = S.cur; return !!(p.floodLine || p.zoneLine || p.drainLine); }
  function firstCoord() {
    const p = S.cur, r = p.flood || p.zone || p.drain;
    return r && P.has(r.a) ? r.a : null;
  }

  /* ---------- ฟอร์ม ---------- */
  function fld(label, path, opt) {
    opt = opt || {};
    const v = getP(S.cur, path);
    let input;
    if (opt.type === 'select') input = '<select data-k="' + path + '">' + opt.options.map(function (o) { const k = typeof o === 'object' ? o.k : o, n = typeof o === 'object' ? o.n : o; return '<option value="' + esc(k) + '"' + (String(v) === String(k) ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '</select>';
    else if (opt.type === 'textarea') input = '<textarea data-k="' + path + '" rows="' + (opt.rows || 3) + '"' + (opt.fill ? ' data-fill="1"' : '') + ' placeholder="' + esc(opt.ph || '') + '">' + esc(v || '') + '</textarea>';
    else if (opt.type === 'checkbox') return '<div class="field ' + (opt.cls || '') + '"><label><input type="checkbox" data-k="' + path + '"' + (v ? ' checked' : '') + '> ' + esc(label) + '</label></div>';
    else input = '<input type="' + (opt.type || 'text') + '" data-k="' + path + '" value="' + esc(v == null ? '' : v) + '" placeholder="' + esc(opt.ph || '') + '">';
    return '<div class="field ' + (opt.cls || '') + '"><label>' + esc(label) + '</label>' + input + (opt.hint ? '<span class="hint">' + opt.hint + '</span>' : '') + '</div>';
  }
  function ptRow(path, label, phName) {
    const p = getP(S.cur, path) || pt();
    const ll = P.has(p) ? p.lat + ', ' + p.lng : '';
    return '<div class="pt-row"><div class="pt-h">' + esc(label) + '<span class="' + (P.has(p) ? 'pt-ok' : 'pt-bad') + '" data-okfor="' + path + '">' + (P.has(p) ? '✓ มีพิกัด' : 'ยังไม่มีพิกัด') + '</span></div>' +
      '<div class="grid"><div class="field"><input data-k="' + path + '.name" list="tpPlaces" autocomplete="off" value="' + esc(p.name || '') + '" placeholder="' + esc(phName || 'ชื่อจุด เช่น แยกตะพง') + '"></div>' +
      '<div class="field"><input data-k="' + path + '.km" value="' + esc(p.km || '') + '" placeholder="กม. เช่น 229+768"></div>' +
      '<div class="field span-all"><div class="pt-ll"><input data-ll="' + path + '" value="' + esc(ll) + '" placeholder="พิกัด 12.77, 101.71 หรือวางลิงก์ Google Maps">' +
      '<button class="btn btn-sm btn-outline" data-pick="' + path + '" data-label="' + esc(label) + '" title="คลิกเลือกตำแหน่งบนแผนที่">📍</button></div></div></div></div>';
  }
  // ช่องพิกัดแบบย่อ (ใช้ในการ์ดจุดน้ำท่วม)
  function llField(path, label) {
    const p = getP(S.cur, path) || pt();
    return '<div class="field ll-f"><label>' + esc(label) + '<span class="' + (P.has(p) ? 'pt-ok' : 'pt-bad') + '" data-okfor="' + path + '">' + (P.has(p) ? '✓ มีพิกัด' : 'ยังไม่มีพิกัด') + '</span></label>' +
      '<div class="pt-ll"><input data-ll="' + path + '" value="' + esc(P.has(p) ? p.lat + ', ' + p.lng : '') + '" placeholder="12.8123, 101.2345 หรือลิงก์ Google Maps">' +
      '<button class="btn btn-sm btn-outline" data-pick="' + path + '" data-label="' + esc(label) + '" title="คลิกเลือกตำแหน่งบนแผนที่">📍</button></div></div>';
  }
  // การ์ดจุดน้ำท่วม: i = 0 คือ plan.flood · i ≥ 1 คือ plan.floods2[i-1]
  function segCard(i) {
    const main = i === 0, b = main ? 'flood' : 'floods2.' + (i - 1);
    const s = getP(S.cur, b);
    if (s.depth == null) s.depth = '';
    const canDel = !main || (S.cur.floods2 || []).length;
    // สายทาง: จุดที่ 1 = สายทางหลักของผัง · จุดอื่นเว้นว่าง = สายทางเดียวกับจุดที่ 1 (ใส่ต่างได้ = หลายสายทางในผังเดียว)
    const same = S.cur.road ? 'เว้นว่าง = ทล.' + S.cur.road : '';
    return '<div class="seg"><div class="seg-h">🌊 จุดน้ำท่วมที่ ' + (i + 1) + (canDel ? '<button type="button" class="btn btn-sm btn-danger" data-fxdel="' + i + '">ลบจุดนี้</button>' : '') + '</div>' +
      '<div class="grid grid-2" style="margin-bottom:6px">' + fld('หมายเลขทางหลวง', main ? 'road' : b + '.road', { ph: main ? 'เช่น 3574' : same || 'เช่น 3574' }) +
      fld('ตอนควบคุม', main ? 'section' : b + '.section', { ph: main ? 'เช่น บ้านค่าย-ระยอง' : (same ? 'เว้นว่าง = ' + (S.cur.section || 'ตอนเดียวกับจุดที่ 1') : 'เช่น บ้านค่าย-ระยอง') }) + '</div>' +
      '<div class="grid grid-3">' + fld('กม. เริ่ม', b + '.a.km', { ph: 'เช่น 44+000' }) + fld('กม. สิ้นสุด', b + '.b.km', { ph: 'เช่น 46+000' }) + fld('ระดับน้ำ (ซม.)', b + '.depth', { type: 'number', ph: 'เช่น 30' }) + '</div>' +
      '<div class="grid grid-2" style="margin-top:6px">' + llField(b + '.a', 'พิกัดจุดเริ่ม') + llField(b + '.b', main ? 'พิกัดจุดสิ้นสุด' : 'พิกัดจุดสิ้นสุด (ไม่ใส่ = หมุดจุดเดียว)') + '</div>' +
      '<div style="margin-top:6px">' + fld('ชื่อบริเวณ (ไม่บังคับ แสดงบนผัง)', main ? 'place' : b + '.place', { ph: 'เช่น หน้าวัดบ้านค่าย' }) + '</div></div>';
  }
  function styleCards() {
    const cur = S.cur.style || 'doh';
    const mini = {
      doh: '<div style="position:absolute;left:0;right:0;top:0;height:30%;background:#fff"></div><div style="position:absolute;right:4px;bottom:4px;width:30%;height:26%;background:#fff;border-radius:2px"></div>',
      alert: '<div style="position:absolute;left:8%;right:8%;top:6%;height:30%;background:#d61a1a;border:2px solid #fff;border-radius:5px"></div><div style="position:absolute;left:30%;top:50%;width:50%;height:5px;background:#3bd13b;transform:rotate(20deg)"></div>',
      info: '<div style="position:absolute;inset:0;background:#0d3a78"></div><div style="position:absolute;left:3%;top:28%;width:20%;bottom:14%;background:#fff;border-radius:3px"></div><div style="position:absolute;right:3%;top:28%;width:20%;bottom:14%;background:#fff;border-radius:3px"></div><div style="position:absolute;left:25%;right:25%;top:28%;bottom:14%;background:#6b8f5b"></div>'
    };
    return '<div class="style-cards">' + Object.keys(P.STY).map(function (k) {
      return '<div class="style-card' + (cur === k ? ' active' : '') + '" data-style="' + k + '"><div class="mini">' + mini[k] + '</div>' + esc(P.STY[k].name) + '</div>';
    }).join('') + '</div>';
  }
  function renderForm() {
    const el = $('edForm');
    const p = S.cur;
    if (!p) {
      el.innerHTML = '<div class="card wide"><div class="section-title">เลือกชนิดผังที่จะสร้าง</div>' + Object.keys(KIND).map(function (k) {
        return '<button class="new-card" style="width:100%;margin-bottom:8px" data-new="' + k + '"><span class="ic">' + KIND[k].ic + '</span><div><b>' + KIND[k].name + '</b><span>' + KIND[k].desc + '</span></div></button>';
      }).join('') + '</div>';
      el.querySelectorAll('[data-new]').forEach(function (b) { b.onclick = function () { openPlan(newPlan(b.dataset.new)); }; });
      $('edTips').textContent = '';
      return;
    }
    const k = p.kind;
    const sec = function (id, title, body, cls) {   // ส่วนพับเก็บได้ (จำว่าเปิด/ปิดไว้)
      return '<details class="more ' + (cls || 'wide') + '" data-sec="' + id + '"' + (S.open[id] ? ' open' : '') + '><summary>' + title + '</summary><div class="in">' + body + '</div></details>';
    };
    let h = '<div class="card wide"><div class="section-title">' + KIND[k].ic + ' ' + KIND[k].name + (p.id ? '' : ' <span class="badge b-warn">ผังใหม่ ยังไม่บันทึก</span>') +
      '<span class="flex" style="margin-left:auto;font-family:Sarabun,sans-serif;font-weight:400">' + fld('วันที่', 'date', { type: 'date' }) + fld('สถานะ', 'status', { type: 'select', options: [{ k: 'active', n: 'ใช้งานอยู่' }, { k: 'ended', n: 'สิ้นสุดแล้ว' }] }) + '</span></div>' +
      (k === 'flood' ? '<p class="hint" style="margin:0">ขั้นตอน: ① ใส่สายทางและจุดน้ำท่วม (วางข้อความทีเดียวหลายจุดได้) → ② ใส่ทางเบี่ยง → ③ กด ⚡ สร้างผัง · ผังตัวอย่างอยู่ด้านล่าง</p>' : '') + '</div>';

    // ข้อมูลหลัก + ปุ่มสร้างผัง
    const buildRow = '<div class="card wide"><div class="build-row"><button class="btn btn-primary btn-lg" id="edBuild">⚡ ' + (k === 'flood' ? '③ ' : '') + 'สร้างผังอัตโนมัติ</button><div id="edLens" class="hint"></div></div></div>';
    if (k === 'flood') {
      const n = 1 + (p.floods2 || []).length;
      const nr = P.roads(p).length;
      h += '<div class="card"><div class="section-title"><span class="step-no">1</span> จุดน้ำท่วม <span class="sub">' + n + ' จุด' + (nr > 1 ? ' · ' + nr + ' สายทาง' : '') + ' — แต่ละจุดอยู่คนละสายทางได้</span></div>' +
        '<div class="field paste-box" style="margin:0 0 10px"><label>📥 วางข้อมูลจุดน้ำท่วม (ใส่ได้หลายจุดพร้อมกัน ระบบแยกให้เอง)</label><textarea id="fxPaste" placeholder="' + esc(
          'หมายเลขทางหลวง: 3574 ตอนควบคุม บ้านค่าย - ระยอง ช่วง กม.: 44+000 ถึง กม.: 46+000 ระดับน้ำ: 30 เซ็นติเมตร\nเริ่ม 12.8123, 101.2345  สิ้นสุด 12.8012, 101.2456\nหมายเลขทางหลวง: 3574 ตอนควบคุม บ้านค่าย - ระยอง ช่วง กม.: 48+500 ถึง กม.: 49+200 ระดับน้ำ: 20 เซ็นติเมตร\nเริ่ม ...  สิ้นสุด ...\nหมายเลขทางหลวง: 3 ตอนควบคุม ... (คนละสายทางในผังเดียวกันได้)\nทางเบี่ยง เริ่ม 12.83, 101.22 ถึง 12.79, 101.27') + '"></textarea>' +
        '<div class="flex" style="margin-top:6px"><button type="button" class="btn btn-sm btn-primary" id="fxRead">อ่านข้อมูลใส่ให้</button><span class="hint">พิกัดคู่แรกของแต่ละจุด = จุดเริ่ม คู่ที่สอง = จุดสิ้นสุด</span></div></div>' +
        segCard(0) + (p.floods2 || []).map(function (s, i) { return segCard(i + 1); }).join('') +
        '<button type="button" class="btn btn-sm btn-outline" id="fxAdd">+ เพิ่มจุดน้ำท่วม</button></div>';
      h += '<div class="card"><div class="section-title"><span class="step-no">2</span> ทางเบี่ยง <span class="sub">ระบบหาเส้นทางที่ไม่ผ่านจุดน้ำท่วมทุกจุดให้เอง</span></div>' +
        '<div class="seg det"><div class="seg-h">🔵 ทางเบี่ยงที่ 1</div>' + ptRow('detour.a', 'จุดแยกออก (เข้าทางเบี่ยง)') + ptRow('detour.b', 'จุดกลับเข้าทางหลัก') + '</div>' +
        (p.detour2
          ? '<div class="seg det2"><div class="seg-h">🟣 ทางเบี่ยงที่ 2 <button type="button" class="btn btn-sm btn-danger" id="det2Del">ลบทางเบี่ยงที่ 2</button></div>' + ptRow('detour2.a', 'จุดแยกออก (เข้าทางเบี่ยงที่ 2)') + ptRow('detour2.b', 'จุดกลับเข้าทางหลัก') + '</div>'
          : '<button type="button" class="btn btn-sm btn-outline" id="det2Add" style="margin-bottom:10px">+ เพิ่มทางเบี่ยงที่ 2</button>') +
        '<div class="grid grid-2">' + fld('ลูกศรฝั่งซ้ายของผัง', 'dirLeft', { ph: 'เช่น ไปบ้านค่าย' }) + fld('ลูกศรฝั่งขวาของผัง', 'dirRight', { ph: 'เช่น ไประยอง' }) + '</div></div>';
      h += buildRow;
    } else {
      h += '<div class="card"><div class="section-title">📍 ข้อมูลผัง</div><div class="grid grid-2">' +
        fld('ทางหลวงหมายเลข', 'road', { ph: 'เช่น 3' }) +
        (k === 'safety' ? fld('ประเภทงาน', 'workType', { type: 'select', options: WORK.indexOf(p.workType) >= 0 ? WORK : WORK.concat([p.workType]) }) : fld('ตอนควบคุม', 'section', { ph: 'เช่น ระยอง-กะเฉด' })) +
        fld(k === 'drain' ? 'ชื่อบริเวณน้ำท่วมขัง' : 'ชื่อบริเวณ', 'place', { cls: 'span-all', ph: 'เช่น หน้าตลาดบ้านเพ' }) + '</div></div><div class="card">';
      if (k === 'safety') {
        h += '<div class="section-title" style="font-size:14px;margin:0 0 6px">เขตปฏิบัติงาน (ตามทิศทางรถวิ่ง)</div>' + ptRow('zone.a', 'ต้นเขตงาน (รถวิ่งเข้ามาถึงก่อน)', 'ชื่อ (ไม่ใส่ก็ได้)') + ptRow('zone.b', 'ปลายเขตงาน', 'ชื่อ (ไม่ใส่ก็ได้)') +
          '<div class="grid grid-2">' + fld('ความเร็วปกติของถนน (กม./ชม.)', 'speed', { type: 'select', options: [{ k: 60, n: '60' }, { k: 80, n: '80' }, { k: 90, n: '90' }, { k: 100, n: '100' }, { k: 120, n: '120' }] }) +
          fld('ช่องจราจรที่ปิด', 'side', { type: 'select', options: [{ k: 'left', n: 'ช่องซ้าย (ชิดไหล่ทาง)' }, { k: 'right', n: 'ช่องขวา (ชิดเกาะกลาง)' }] }) +
          fld('ถนน 2 ช่องจราจรสวนกัน (วางป้ายให้รถทั้งสองทิศทาง)', 'both', { type: 'checkbox', cls: 'span-all' }) + '</div>' +
          '<p class="hint">ระยะป้ายเตือนและช่วงเบี่ยงกรวยคำนวณจากความเร็ว (ปรับตำแหน่งเองได้ทุกชิ้น) — ต้องตรวจกับมาตรฐานกรมทางหลวงก่อนใช้งานจริง</p>';
      }
      if (k === 'drain') {
        h += ptRow('drain.a', 'จุดน้ำท่วมขัง', 'ชื่อจุด เช่น หน้าตลาดบ้านเพ') +
          '<details class="more" style="margin:6px 0"><summary>กำหนดจุดระบายเอง (ไม่บังคับ)</summary><div class="in">' + ptRow('drain.b', 'จุดระบายน้ำออก', 'ชื่อ เช่น คลองน้ำเค็ม') + '<p class="hint">เว้นว่างไว้ = ให้ระบบหาทางน้ำที่น้ำไหลไปถึงเอง</p></div></details>' +
          (p.drainNote ? '<div class="alert warn">' + esc(p.drainNote) + '</div>' : '') +
          '<p class="hint">ระบบใช้ข้อมูลความสูงพื้นดิน (SRTM ~30 ม.) และทางน้ำจาก OpenStreetMap ใช้ช่วยวางแนวเบื้องต้น ต้องสำรวจระดับจริงก่อนดำเนินการ</p>';
      }
      h += '</div>' + buildRow;
    }

    // รูปแบบผัง
    let look = (k === 'flood' ? '<div class="section-title" style="font-size:14px;margin:0 0 6px">สไตล์ผัง</div>' + styleCards() : '') +
      '<div class="grid grid-3" style="margin-top:10px">' + fld('พื้นหลังแผนที่', 'base', { type: 'select', options: [{ k: 'sat', n: 'ภาพดาวเทียม' },{ k: 'gmap', n: 'แผนที่แบบ Google (หมุดเฉพาะที่สำคัญ)' }] }) +
      fld('แบบหัวผัง (แบบกรมทางหลวง)', 'head', { type: 'select', options: Object.keys(P.HEADS).map(function (x) { return { k: x, n: P.HEADS[x] }; }) }) +
      fld('ตรากรมทางหลวง', 'logo', { type: 'select', options: [{ k: '', n: 'ตามค่าตั้งของเว็บ (' + (P.logoDefault === 'new' ? 'แบบใหม่' : 'แบบเดิม') + ')' }, { k: 'new', n: 'ตราแบบใหม่' + (P.logos.new ? '' : ' (ยังไม่มีไฟล์)') }, { k: 'old', n: 'ตราแบบเดิม' }] }) +
      (k === 'flood' ? fld('รูปแบบลูกศรบอกทิศ', 'arrow', { type: 'select', options: Object.keys(P.ARROWS).map(function (x) { return { k: x, n: P.ARROWS[x].name }; }) }) +
        fld('สีลูกศร', 'arrowColor', { type: 'select', options: Object.keys(P.ARROW_COLORS).map(function (x) { return { k: x, n: P.ARROW_COLORS[x] }; }) }) +
        '<div class="span-all arrow-prev" id="arrPrev"></div>' : '') + '</div>' +
      '<p class="hint">กล่อง "ขออภัยในความไม่สะดวก" และ "คำอธิบายสัญลักษณ์" ลากย้ายบนผังได้ · ดับเบิลคลิกที่กล่องเพื่อคืนตำแหน่งเดิม</p>';
    h += sec('look', '🎨 รูปแบบผัง / พื้นหลังแผนที่ / ลูกศร', look);

    // อุปกรณ์
    h += sec('dev', '🧰 ' + (k === 'drain' ? 'อุปกรณ์งานระบายน้ำ' : k === 'flood' ? 'หมุดน้ำท่วม / ป้ายและอุปกรณ์ วางเพิ่มบนผัง' : 'ป้ายและอุปกรณ์'),
      '<p class="hint" style="margin-top:0">เลือกแล้วคลิกบนผังเพื่อวาง · คลิกขวาที่ชิ้นเพื่อลบ · ดับเบิลคลิกแก้ข้อความ</p><div class="dev-palette" id="devPal"></div>' +
      (k === 'safety' ? '<div class="flex" style="margin-top:8px"><button class="btn btn-sm btn-outline" id="devRe">↺ จัดวางอุปกรณ์ใหม่อัตโนมัติ</button><button class="btn btn-sm btn-danger" id="devClr">ล้างอุปกรณ์ทั้งหมด</button></div>' : ''),
      k === 'flood' ? 'wide' : '');

    // ปรับแต่งข้อความ
    let tx = '<div class="grid grid-2">' +
      fld('หน่วยงาน (หัวผัง)', 'org') +
      fld('หัวเรื่องบรรทัดที่ 2 (เว้นว่าง = สร้างให้อัตโนมัติ)', 'headline', { ph: P.autoHeadline(p) }) +
      fld('ข้อความขออภัย', 'apology', { ph: 'ขออภัยในความไม่สะดวก' }) +
      (k === 'flood' ? fld('คำอธิบายเส้นสีแดง', 'legendFlood', { ph: 'บริเวณที่น้ำท่วมทาง' }) + fld('คำอธิบายเส้นสีน้ำเงิน', 'legendDetour', { ph: p.detour2 ? 'เส้นทางเบี่ยงที่ 1' : 'เส้นทางเบี่ยงการจราจร' }) +
        (p.detour2 ? fld('คำอธิบายเส้นสีม่วง', 'legendDetour2', { ph: 'เส้นทางเบี่ยงที่ 2' }) : '') : '') +
      (k === 'safety' ? fld('คำอธิบายเขตงาน', 'legendZone', { ph: 'เขตปฏิบัติงาน / ช่องจราจรที่ปิด' }) : '') +
      (k === 'drain' ? fld('คำอธิบายแนวระบายน้ำ', 'legendDrain', { ph: 'แนวทางระบายน้ำ' }) : '') +
      fld('ชื่อผัง (ใช้ในรายการ/ชื่อไฟล์)', 'title', { ph: autoTitle(p) }) +
      '</div>';
    if (k === 'flood') {
      tx += '<div class="section-title" style="font-size:14px;margin:12px 0 6px">แบบเตือนภัย (แนวตั้ง)</div><div class="grid grid-2">' +
        fld('บรรทัดที่ 1', 'alert1', { ph: 'หลีกเลี่ยงเส้นทางน้ำท่วม' }) + fld('บรรทัดที่ 2 (สีเหลือง)', 'alert2', { ph: P.autoAlert2(p) }) + fld('บรรทัดที่ 3', 'alert3', { ph: 'ทั้งฝั่งขาเข้าและขาออก' }) +
        fld('กล่องเขียว', 'callGo', { ph: 'เส้นทางหลีกเลี่ยงน้ำท่วม' }) + fld('กล่องแดง (บรรทัดล่าง)', 'callNo', { cls: 'span-all', ph: 'บริเวณ' + (p.place || '...') + ' น้ำท่วม' }) + '</div>' +
        '<div class="section-title" style="font-size:14px;margin:12px 0 6px">แบบอินโฟกราฟิก</div><div class="grid grid-2">' +
        fld('หัวเรื่อง (สีขาว)', 'info1', { ph: 'เส้นทางเลี่ยงน้ำท่วม' }) + fld('หัวเรื่อง (สีเหลือง)', 'info2', { ph: p.road ? 'ทล.' + p.road : '' }) +
        fld('คำขวัญใต้หัวเรื่อง', 'infoSub', { cls: 'span-all', ph: '“โปรดตรวจสอบเส้นทางก่อนออกเดินทาง และขับขี่ด้วยความระมัดระวัง”' }) +
        fld('ขั้นตอนการเดินทาง (1 บรรทัด = 1 ข้อ)', 'steps', { type: 'textarea', rows: 4, ph: P.autoSteps(p), fill: true, hint: 'คลิกในช่องเพื่อแก้ไข/เพิ่มข้อความได้เลย · ลบจนว่าง = กลับไปใช้ข้อความอัตโนมัติ' }) +
        fld('ข้อควรทราบ (1 บรรทัด = 1 ข้อ)', 'notes', { type: 'textarea', rows: 4, ph: P.autoNotes(p), fill: true, hint: 'คลิกในช่องเพื่อแก้ไข/เพิ่มข้อความได้เลย · ลบจนว่าง = กลับไปใช้ข้อความอัตโนมัติ' }) +
        fld('สายด่วน', 'hotline', { ph: 'โทร. 1586' }) + '</div>';
    }
    h += sec('text', '✏️ ปรับแต่งข้อความบนผัง', tx);

    // ข้อมูลอ้างอิงจากไฟล์ Google Earth ของแขวงฯ
    p.ref = Object.assign({ pts: 'none', sel: [], lbl: true, routes: false, tambon: false, tambonLbl: true }, p.ref);
    h += sec('ref', '🗺️ ข้อมูลอ้างอิงบนแผนที่ <span class="muted small">จุดแยก/U-Turn · สายทาง · ขอบเขตตำบล</span>', '<div class="grid grid-3">' +
      fld('จุดแยก / จุดกลับรถ (U-Turn) ทล.3, ทล.36', 'ref.pts', { type: 'select', options: [{ k: 'none', n: 'ไม่แสดง' }, { k: 'all', n: 'แสดงทุกจุด (' + P.refPts.length + ' จุด)' }, { k: 'sel', n: 'แสดงเฉพาะจุดที่เลือก' }] }) +
      fld('แสดงชื่อจุดและ กม.', 'ref.lbl', { type: 'checkbox' }) +
      fld('เส้นสายทางควบคุมแขวงฯ', 'ref.routes', { type: 'checkbox' }) +
      fld('ขอบเขตตำบล จ.ระยอง', 'ref.tambon', { type: 'checkbox' }) +
      fld('แสดงชื่อตำบล', 'ref.tambonLbl', { type: 'checkbox' }) + '</div>' +
      '<div id="refList"></div>' +
      '<p class="hint">ปุ่ม 📍 ของแต่ละจุด: คลิกจุดสีเขียวบนแผนที่เพื่อใช้พิกัด ชื่อ และ กม. ของจุดนั้นได้ทันที · พิมพ์ชื่อจุด เช่น "สี่แยกตะพง" ระบบเติมพิกัดให้เอง</p>');
    // รายชื่อจุดที่เคยลงพิกัด (ให้เลือกตอนพิมพ์ชื่อจุด)
    h += '<datalist id="tpPlaces">' + knownList().map(function (q) { return '<option value="' + esc(q.name) + '">' + esc((q.km ? 'กม.' + q.km + ' · ' : '') + q.lat + ', ' + q.lng) + '</option>'; }).join('') + '</datalist>';
    el.innerHTML = h;
    el.querySelectorAll('details[data-sec]').forEach(function (d) { d.addEventListener('toggle', function () { S.open[d.dataset.sec] = d.open; }); });
    bindForm(el);
    renderRefList();
    refreshArrPrev();
    renderPalette();
    refreshLens();
    $('edTips').textContent = 'ลากป้าย/ลูกศร/อุปกรณ์ไปวางได้ · คลิกที่เส้นแล้วลากจุดวงกลมเพื่อปรับเส้น (วิ่งตามถนนใหม่เอง) · เลื่อนหรือซูมแผนที่ได้ตามต้องการ แล้วกด "จัดป้ายใหม่" ถ้าป้ายหลุดกรอบ';
  }

  // ตัวอย่างลูกศรที่เลือก (ซ้าย / ขวา)
  function refreshArrPrev() {
    const b = $('arrPrev'); if (!b || !S.cur) return;
    b.innerHTML = P.arrowSvg(S.cur.arrow, S.cur.arrowColor, true) + P.arrowSvg(S.cur.arrow, S.cur.arrowColor, false);
  }

  let drawTimer = null;
  function bindForm(el) {
    // ช่องข้อความอัตโนมัติ: คลิกแล้วนำข้อความอัตโนมัติมาใส่ให้แก้/เพิ่มต่อได้ · ออกจากช่องโดยไม่ได้แก้ = ยังใช้แบบอัตโนมัติ
    el.querySelectorAll('textarea[data-fill]').forEach(function (t) {
      t.addEventListener('focus', function () {
        if (t.value || !t.placeholder) return;
        t.value = t.placeholder;
        t.setSelectionRange(t.value.length, t.value.length);
      });
      t.addEventListener('blur', function () {
        if (t.value.trim() === t.placeholder.trim() && !getP(S.cur, t.dataset.k)) t.value = '';
      });
    });
    el.querySelectorAll('[data-k]').forEach(function (inp) {
      const path = inp.dataset.k;
      const ev = inp.tagName === 'SELECT' || inp.type === 'checkbox' || inp.type === 'date' ? 'change' : 'input';
      inp.addEventListener(ev, function () {
        let v = inp.type === 'checkbox' ? inp.checked : inp.value;
        if (path === 'speed') v = +v;
        setP(S.cur, path, v);
        markDirty();
        if (path === 'base') { P.setBase(v); P.draw(); return; }
        if (path.indexOf('ref.') === 0) { P.drawRef(); renderRefList(); return; }
        if (path === 'arrow' || path === 'arrowColor') refreshArrPrev();
        clearTimeout(drawTimer); drawTimer = setTimeout(function () { P.draw(); }, 250);
      });
    });
    el.querySelectorAll('[data-ll]').forEach(function (inp) {
      inp.addEventListener('change', function () { setCoord(inp.dataset.ll, inp.value); });
    });
    // พิมพ์ชื่อจุดที่เคยลงพิกัดไว้ → เติมพิกัดให้เอง (เฉพาะจุดที่ยังไม่มีพิกัด)
    el.querySelectorAll('[data-k$=".name"]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        const q = getP(S.cur, inp.dataset.k.replace(/\.name$/, ''));
        if (!q || P.has(q)) return;
        const f = findPlace(q.name);
        if (!f) return;
        q.lat = f.lat; q.lng = f.lng;
        if (!q.km && f.km) q.km = f.km;
        markDirty(); refreshPtInputs(); P.draw();
        status('ใช้พิกัดที่เคยลงไว้ของ "' + f.name + '" (' + f.lat + ', ' + f.lng + ') — ตรวจสอบ แล้วกด ⚡ สร้างผังอัตโนมัติ');
      });
    });
    el.querySelectorAll('[data-pick]').forEach(function (b) {
      b.onclick = function () {
        // แผนที่อยู่ด้านล่าง: เลื่อนลงไปให้คลิก แล้วเลื่อนกลับมาที่ช่องเดิมเมื่อเลือกเสร็จ
        const back = window.scrollY;
        document.querySelector('.ed-right').scrollIntoView({ behavior: 'smooth', block: 'start' });
        status('👇 คลิกบนแผนที่ตรงตำแหน่ง "' + (b.dataset.label || 'จุด') + '" หรือคลิกจุดแยก/U-Turn เพื่อใช้พิกัดและชื่อจุดนั้น (กด Esc เพื่อยกเลิก)');
        P.pick(function (ll, ref) {
          setTimeout(function () { window.scrollTo({ top: back, behavior: 'smooth' }); }, 350);
          const path = b.dataset.pick;
          if (ref) {   // คลิกจุดแยก/U-Turn → ใช้ชื่อและ กม. ด้วย (ถ้าช่องยังว่าง)
            const q = getP(S.cur, path);
            if (!q.name) q.name = ref.name;
            if (!q.km) q.km = ref.km;
          }
          setCoord(path, ll.lat.toFixed(6) + ', ' + ll.lng.toFixed(6));
          status(ref ? 'ใช้จุด "' + ref.name + '" ทล.' + ref.road + ' กม.' + ref.km + ' แล้ว' : 'เลือกตำแหน่งแล้ว');
        });
      };
    });
    el.querySelectorAll('[data-style]').forEach(function (c) {
      c.onclick = function () {
        S.cur.style = c.dataset.style; markDirty();
        el.querySelectorAll('[data-style]').forEach(function (x) { x.classList.toggle('active', x === c); });
        P.restyle();
      };
    });
    if ($('edBuild')) $('edBuild').onclick = build;
    // ช่วงน้ำท่วมเพิ่มเติม: เพิ่ม / ลบ
    if ($('fxAdd')) $('fxAdd').onclick = function () {
      S.cur.floods2 = S.cur.floods2 || [];
      S.cur.floods2.push({ place: '', depth: '', a: pt(), b: pt(), via: [] });
      markDirty(); renderForm();
      status('ใส่ กม. ระดับน้ำ และพิกัดเริ่ม-สิ้นสุด ของจุดน้ำท่วมที่ ' + (S.cur.floods2.length + 1) + ' แล้วกด ⚡ สร้างผังอัตโนมัติ');
    };
    if ($('fxRead')) $('fxRead').onclick = applyFloodPaste;
    if ($('det2Add')) $('det2Add').onclick = function () {
      S.cur.detour2 = { a: pt(), b: pt(), via: [] };
      markDirty(); renderForm();
      status('ใส่จุดแยกออก และจุดกลับเข้า ของทางเบี่ยงที่ 2 แล้วกด ⚡ สร้างผังอัตโนมัติ');
    };
    if ($('det2Del')) $('det2Del').onclick = function () {
      if (!confirm('ลบทางเบี่ยงที่ 2?')) return;
      P.select(null);
      S.cur.detour2 = null; delete S.cur.detour2Line; delete S.cur.detour2Len;
      if (S.cur.pos) { delete S.cur.pos.det2A; delete S.cur.pos.det2B; }
      markDirty(); renderForm(); P.draw(); refreshLens();
    };
    el.querySelectorAll('[data-fxdel]').forEach(function (b) {
      b.onclick = function () {
        const n = +b.dataset.fxdel, i = n - 1, list = S.cur.floods2;
        if (!confirm('ลบจุดน้ำท่วมที่ ' + (n + 1) + '?')) return;
        P.select(null);
        if (n === 0) {   // ลบจุดที่ 1 → เลื่อนจุดที่ 2 ขึ้นมาแทน แล้วจัดป้ายใหม่
          const s = list.shift(), oldRoad = S.cur.road, oldSec = S.cur.section;
          // จุดที่เว้นสายทางไว้ (= ตามจุดที่ 1 เดิม) ใส่สายทางเดิมให้ชัด ก่อนเปลี่ยนจุดที่ 1
          list.forEach(function (x) { if (!x.road) { x.road = oldRoad || ''; if (!x.section) x.section = oldSec || ''; } });
          if (s.road) { S.cur.road = s.road; S.cur.section = s.section || ''; }
          list.forEach(function (x) { if (x.road === S.cur.road) { x.road = ''; if (x.section === S.cur.section) x.section = ''; } });
          S.cur.flood = { a: s.a, b: s.b, via: s.via || [], depth: s.depth || '' };
          S.cur.place = s.place || '';
          S.cur.floodLine = s.line || ''; S.cur.floodLen = s.len || 0;
          markDirty(); renderForm();
          if (linesReady()) P.autoLabels(); else P.draw();
          refreshLens();
          return;
        }
        list.splice(i, 1);
        // เลื่อนตำแหน่งป้ายของช่วงที่อยู่ถัดไปขึ้นมาหนึ่งลำดับ
        const pos = S.cur.pos || {}, np = {};
        Object.keys(pos).forEach(function (key) {
          const m = key.match(/^fx(\d+)([ab]?)$/);
          if (!m) { np[key] = pos[key]; return; }
          const j = +m[1];
          if (j < i) np[key] = pos[key]; else if (j > i) np['fx' + (j - 1) + m[2]] = pos[key];
        });
        S.cur.pos = np;
        markDirty(); renderForm(); P.draw(); refreshLens();
      };
    });
  }
  // รายการจุดแยก/U-Turn ให้ติ๊กเลือก (เฉพาะโหมด "แสดงเฉพาะจุดที่เลือก")
  function renderRefList() {
    const box = $('refList'); if (!box || !S.cur) return;
    const r = S.cur.ref || {};
    if (r.pts !== 'sel') { box.innerHTML = ''; return; }
    const sel = r.sel || [];
    let h = '<div class="flex" style="margin-top:8px"><button class="btn btn-sm btn-outline" id="refInView">เลือกทุกจุดที่อยู่ในแผนที่ขณะนี้</button><button class="btn btn-sm btn-outline" id="refClr">ล้างที่เลือก</button>' +
      '<span class="hint">เลือกแล้ว ' + sel.length + ' จุด · คลิกจุดสีจางบนแผนที่เพื่อเลือกได้เช่นกัน (จุดจางไม่ติดไปในรูป)</span></div><div class="ref-list">';
    let road = null;
    P.refPts.forEach(function (q) {
      if (q.road !== road) { road = q.road; h += '<h5>ทางหลวงหมายเลข ' + esc(road) + '</h5>'; }
      h += '<label><input type="checkbox" data-rp="' + esc(q.id) + '"' + (sel.indexOf(q.id) >= 0 ? ' checked' : '') + '><b>' + esc(q.km) + '</b>' + esc(q.name) + '</label>';
    });
    box.innerHTML = h + '</div>';
    const set = function (ids) { S.cur.ref = Object.assign({}, S.cur.ref, { sel: ids }); markDirty(); P.drawRef(); renderRefList(); };
    box.querySelectorAll('[data-rp]').forEach(function (c) {
      c.onchange = function () {
        const cur = (S.cur.ref.sel || []).filter(function (x) { return x !== c.dataset.rp; });
        set(c.checked ? cur.concat([c.dataset.rp]) : cur);
      };
    });
    $('refInView').onclick = function () {
      const b = P.map().getBounds();
      set(P.refPts.filter(function (q) { return b.contains([q.lat, q.lng]); }).map(function (q) { return q.id; }));
    };
    $('refClr').onclick = function () { set([]); };
  }
  function setCoord(path, text) {
    const c = AI.coords(text);
    const p = getP(S.cur, path);
    if (!c) { if (text.trim()) toast('อ่านพิกัดไม่ได้ — ตัวอย่าง 12.776552, 101.711629 หรือลิงก์ Google Maps แบบยาว', true); p.lat = null; p.lng = null; }
    else { p.lat = c.lat; p.lng = c.lng; remember(S.cur); }
    markDirty();
    refreshPtInputs();
    if (c) status('แก้ไขพิกัดแล้ว — กด ⚡ สร้างผังอัตโนมัติ เพื่อคำนวณเส้นใหม่');
  }
  function refreshPtInputs() {
    document.querySelectorAll('[data-ll]').forEach(function (inp) {
      const p = getP(S.cur, inp.dataset.ll);
      if (document.activeElement !== inp) inp.value = P.has(p) ? p.lat + ', ' + p.lng : '';
      const ok = document.querySelector('[data-okfor="' + inp.dataset.ll + '"]');
      if (ok) { ok.className = P.has(p) ? 'pt-ok' : 'pt-bad'; ok.textContent = P.has(p) ? '✓ มีพิกัด' : 'ยังไม่มีพิกัด'; }
    });
    document.querySelectorAll('[data-k$=".name"],[data-k$=".km"]').forEach(function (inp) {
      if (document.activeElement !== inp) inp.value = getP(S.cur, inp.dataset.k) || '';
    });
  }
  function refreshLens() {
    const el = $('edLens'); if (!el || !S.cur) return;
    const p = S.cur, out = [];
    if (p.kind === 'flood') {
      const nx = (p.floods2 || []).filter(function (s) { return P.has(s.a); }).length;
      if (p.floodLine) out.push(nx ? 'ช่วงน้ำท่วม ' + (nx + 1) + ' ช่วง รวม ' + fmtKm(P.floodTotal(p)) : 'ช่วงน้ำท่วม ' + fmtKm(P.floodLength(p)));
      if (p.detourLen) out.push((p.detour2 ? 'ทางเบี่ยงที่ 1 ' : 'ทางเบี่ยง ') + fmtKm(p.detourLen));
      if (p.detour2 && p.detour2Line && p.detour2Len) out.push('ทางเบี่ยงที่ 2 ' + fmtKm(p.detour2Len)); }
    if (p.kind === 'safety' && p.zoneLine) out.push('เขตงาน ' + fmtKm(P.floodLength(p)), 'อุปกรณ์ ' + (p.devices || []).length + ' ชิ้น');
    if (p.kind === 'drain' && p.drainLine) out.push('แนวระบายน้ำ ' + fmtKm(p.drainLen || 0), 'ระบายลง: ' + (p.drain.b.name || '-'), p.drop != null ? 'ต่างระดับ ~' + (+p.drop).toFixed(1) + ' ม.' : '');
    el.textContent = out.filter(Boolean).join(' · ');
  }
  // วางข้อความรายการจุดน้ำท่วม (หลายจุด) → แทนที่จุดน้ำท่วมทั้งหมด · ทางเบี่ยงที่อ่านได้ใส่ทางเบี่ยงที่ 1 และ 2
  function applyFloodPaste() {
    const text = ($('fxPaste').value || '').trim(), p = S.cur;
    if (!text) { toast('วางข้อความรายการจุดน้ำท่วมก่อน', true); return; }
    const r = AI.parseFloods(text);
    if (!r.floods.length && !r.detours.length) { toast('ไม่พบ กม. / ระดับน้ำ / พิกัด ในข้อความ — ดูตัวอย่างในช่อง', true); return; }
    if (r.floods.length) {
      const old = P.floodList(p).filter(function (f) { return f.r.a.km || P.has(f.r.a); }).length;
      if (old && !confirm('แทนที่จุดน้ำท่วมเดิม ' + old + ' จุด ด้วยข้อมูลใหม่ ' + r.floods.length + ' จุด?')) return;
      const r0 = r.floods[0].road || r.road || p.road, s0 = r.floods[0].section || (r0 === p.road ? p.section : '') || r.section;
      p.road = r0 || ''; p.section = s0 || '';
      const segs = r.floods.map(function (f) {
        // จุดที่อยู่สายทางเดียวกับจุดที่ 1 ไม่ต้องเก็บซ้ำ (เว้นว่าง = ตามจุดที่ 1)
        const rd = f.road && f.road !== r0 ? f.road : '', sc = f.section && f.section !== s0 ? f.section : '';
        return { road: rd, section: sc, place: f.place || '', depth: f.depth || '', via: [],
          a: Object.assign(pt(), f.a || {}, { km: (f.a && f.a.km) || f.kmA || '' }),
          b: Object.assign(pt(), f.b || {}, { km: (f.b && f.b.km) || f.kmB || '' }) };
      });
      const first = segs.shift();
      p.flood = { a: first.a, b: first.b, via: [], depth: first.depth };
      if (first.place) p.place = first.place;
      p.floods2 = segs;
      p.floodLine = ''; p.floodLen = 0; p.pos = {};
    }
    if (!r.floods.length) { if (r.road) p.road = r.road; if (r.section) p.section = r.section; }
    r.detours.slice(0, 2).forEach(function (d, i) {
      const key = i ? 'detour2' : 'detour';
      if (!p[key]) p[key] = { a: pt(), b: pt(), via: [] };
      if (d.a) Object.assign(p[key].a, d.a);
      if (d.b) Object.assign(p[key].b, d.b);
      p[key].via = []; p[key + 'Line'] = '';
    });
    const known = fillKnown(p);
    remember(p); markDirty(); renderForm(); P.draw();
    if (firstCoord()) P.fit();
    const miss = missingCoords();
    status('อ่านได้ ' + r.floods.length + ' จุดน้ำท่วม' + (r.detours.length ? ' · ทางเบี่ยง ' + Math.min(2, r.detours.length) + ' เส้น' : '') +
      (known.length ? ' · ใช้พิกัดที่เคยลงไว้: ' + known.join(', ') : '') +
      (miss.length ? ' — ยังขาดพิกัด: ' + miss.join(', ') + ' (ใส่เองหรือกด 📍)' : ' — ตรวจสอบแล้วกด ⚡ สร้างผังอัตโนมัติ'), !!miss.length);
  }
  function missingCoords() {
    const p = S.cur;
    let need = p.kind === 'safety' ? [['zone.a', 'ต้นเขตงาน'], ['zone.b', 'ปลายเขตงาน']] : [['drain.a', 'จุดน้ำท่วมขัง']];
    if (p.kind === 'flood') {
      need = [['flood.a', 'จุดเริ่มของจุดน้ำท่วมที่ 1'], ['flood.b', 'จุดสิ้นสุดของจุดน้ำท่วมที่ 1']];
      (p.floods2 || []).forEach(function (s, i) { need.push(['floods2.' + i + '.a', 'จุดเริ่มของจุดน้ำท่วมที่ ' + (i + 2)]); });
      need.push(['detour.a', 'จุดแยกออกของทางเบี่ยง'], ['detour.b', 'จุดกลับเข้าของทางเบี่ยง']);
      if (p.detour2) need.push(['detour2.a', 'จุดแยกออกของทางเบี่ยงที่ 2'], ['detour2.b', 'จุดกลับเข้าของทางเบี่ยงที่ 2']);
    }
    return need.filter(function (n) { return !P.has(getP(p, n[0])); }).map(function (n) { return n[1]; });
  }

  function renderPalette() {
    const box = $('devPal'); if (!box || !S.cur) return;
    const list = S.cur.kind === 'drain' ? P.DEV_DRAIN : S.cur.kind === 'flood' ? P.DEV_FLOOD : P.DEV_SAFETY;
    box.innerHTML = list.map(function (t) {
      return '<button class="dev-btn" data-dev="' + t + '">' + P.devSvg({ t: t, text: t === 'speed' ? '60' : t === 'arrow' ? 'ชิดขวา' : '' }) + '<span>' + P.DEV[t].name + '</span></button>';
    }).join('');
    box.querySelectorAll('[data-dev]').forEach(function (b) {
      b.onclick = function () {
        const on = !b.classList.contains('active');
        box.querySelectorAll('.dev-btn').forEach(function (x) { x.classList.remove('active'); });
        if (on) { b.classList.add('active'); status('คลิกบนผังเพื่อวาง "' + P.DEV[b.dataset.dev].name + '"' + (b.dataset.dev === 'cone' ? ' (วางต่อเนื่องได้ กด Esc เมื่อเสร็จ)' : '')); }
        else status('');
        P.startPlacing(on ? b.dataset.dev : null);
      };
    });
    if ($('devRe')) $('devRe').onclick = async function () {
      if (!S.cur.zoneLine) { toast('สร้างผังอัตโนมัติก่อน', true); return; }
      if ((S.cur.devices || []).length && !confirm('จัดวางใหม่จะแทนที่อุปกรณ์เดิมทั้งหมด ทำต่อหรือไม่?')) return;
      const done = busy(this, 'กำลังจัดวาง...');
      try { await layoutDevices(); P.draw(); refreshLens(); markDirty(); } catch (e) { toast(e.message, true); }
      done();
    };
    if ($('devClr')) $('devClr').onclick = function () { if (confirm('ล้างอุปกรณ์ทั้งหมดในผัง?')) { S.cur.devices = []; P.draw(); refreshLens(); markDirty(); } };
  }

  /* ---------- สร้างผังอัตโนมัติ ---------- */
  function sampleVia(pts, n) {
    if (pts.length <= 2) return [];
    const out = [];
    for (let i = 1; i <= n; i++) { const p = pts[Math.round(i * (pts.length - 1) / (n + 1))]; out.push({ lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6) }); }
    return out;
  }
  async function layoutDevices() {
    const p = S.cur;
    const res = await RT.layoutSafety({ zonePts: RT.decode(p.zoneLine), speed: p.speed, side: p.side, both: p.both, workType: p.workType }, status);
    p.devices = res.devices;
    return res;
  }
  async function build() {
    const p = S.cur, btn = $('edBuild');
    const miss = missingCoords();
    if (miss.length) { status('ยังขาดพิกัด: ' + miss.join(', '), true); return; }
    const done = busy(btn, 'กำลังสร้างผัง...');
    try {
      if (p.kind === 'flood') {
        status('กำลังลากเส้นช่วงน้ำท่วมตามถนน...');
        const f = await RT.route([p.flood.a].concat(p.flood.via || [], [p.flood.b]), p.flood.side);
        p.floodLine = RT.encode(f.pts); p.floodLen = f.distance;
        // ช่วงน้ำท่วมเพิ่มเติม: มีต้น-ปลาย = ลากเส้นตามถนน · มีจุดเดียว = หมุด
        const fx = p.floods2 || [], segs = [f.pts];
        for (let i = 0; i < fx.length; i++) {
          const s = fx[i];
          s.line = ''; s.len = 0;
          if (!P.has(s.a)) continue;
          if (!P.has(s.b)) { segs.push([s.a]); continue; }
          status('กำลังลากเส้นจุดน้ำท่วมที่ ' + (i + 2) + ' ตามถนน...');
          const r = await RT.route([s.a].concat(s.via || [], [s.b]), s.side);
          s.line = RT.encode(r.pts); s.len = r.distance;
          segs.push(r.pts);
        }
        // ทางเบี่ยงต้องไม่ผ่านจุดน้ำท่วมใดเลย
        const d = await RT.autoDetour(p.detour.a, p.detour.b, segs, status);
        p.detourLine = RT.encode(d.pts); p.detourLen = d.distance; p.detour.via = d.via || [];
        if (p.detour2) {
          status('กำลังหาทางเบี่ยงที่ 2...');
          const d2 = await RT.autoDetour(p.detour2.a, p.detour2.b, segs, status);
          p.detour2Line = RT.encode(d2.pts); p.detour2Len = d2.distance; p.detour2.via = d2.via || [];
          if (d2.warn && !d.warn) d.warn = 'ทางเบี่ยงที่ 2: ' + d2.warn;
        }
        if (!p.dirLeft && !p.dirRight && p.section && p.section.indexOf('-') > 0) {
          const s = p.section.split('-').map(function (x) { return x.trim(); });
          p.dirLeft = 'ไป' + s[0]; p.dirRight = 'ไป' + s[1];
        }
        P.draw(); P.fit(); P.autoLabels();
        status(d.warn ? d.warn : 'สร้างผังแล้ว — ทางเบี่ยง ' + fmtKm(d.distance) + (d.via.length ? ' (ระบบบังคับให้อ้อมเพื่อไม่ผ่านช่วงน้ำท่วม)' : '') + ' · ตรวจสอบกับสภาพจริง แล้วลากปรับได้', !!d.warn);
      }
      if (p.kind === 'safety') {
        status('กำลังลากเขตงานตามถนน...');
        const z = await RT.route([p.zone.a].concat(p.zone.via || [], [p.zone.b]), p.zone.side);
        p.zoneLine = RT.encode(z.pts); p.zoneLen = z.distance;
        const res = await layoutDevices();
        P.draw(); P.fit(); P.autoLabels();
        status('วางอุปกรณ์แล้ว ' + p.devices.length + ' ชิ้น (ป้ายเตือนที่ ' + res.signDist.join(' / ') + ' ม. ก่อนเขตงาน · ช่วงเบี่ยงกรวย ' + res.taper + ' ม.) — ลากปรับตำแหน่งได้');
      }
      if (p.kind === 'drain') {
        if (P.has(p.drain.b)) {
          const pts = [p.drain.a].concat(p.drain.via || [], [p.drain.b]);
          p.drainLine = RT.encode(pts); p.drainLen = RT.length(pts);
          const e1 = await RT.elevation(p.drain.a), e2 = await RT.elevation(p.drain.b);
          p.drop = e1 != null && e2 != null ? +(e1 - e2).toFixed(1) : null;
          p.drainNote = p.drop != null && p.drop < 0 ? 'จุดระบายที่เลือกสูงกว่าจุดน้ำท่วมขังประมาณ ' + (-p.drop).toFixed(1) + ' ม. — อาจต้องใช้เครื่องสูบน้ำ' : '';
        } else {
          const r = await RT.traceDrain(p.drain.a, status);
          p.drainLine = RT.encode(r.pts); p.drainLen = r.distance;
          p.drain.b = { name: r.out.name, km: '', lat: r.out.lat, lng: r.out.lng };
          p.drain.via = sampleVia(r.pts, Math.min(8, Math.max(0, r.pts.length - 2)));
          p.drop = r.drop != null ? +r.drop.toFixed(1) : null;
          p.drainNote = r.note;
          p.waterLines = r.ways.map(function (w) { return { name: w.name, line: RT.encode(w.pts) }; });
        }
        P.draw(); P.fit(); P.autoLabels();
        renderForm();
        status('แนวระบายน้ำ ' + fmtKm(p.drainLen) + ' → ระบายลง ' + (p.drain.b.name || 'จุดที่เลือก') + (p.drop != null ? ' · ต่างระดับ ~' + p.drop + ' ม.' : '') + ' · ข้อมูลเบื้องต้น ต้องสำรวจระดับจริง');
      }
      markDirty(); refreshLens();
    } catch (e) { status('สร้างผังไม่สำเร็จ: ' + e.message, true); }
    done();
  }

  /* ---------- บันทึก ---------- */
  async function save() {
    const p = S.cur;
    if (!p) return;
    const done = busy($('edSave'), 'กำลังบันทึก...');
    try {
      if (!p.title) p.title = '';
      const id = await FBL.savePlan(JSON.parse(JSON.stringify(p)));
      p.id = id; S.dirty = false;
      remember(p);
      toast('บันทึกผังแล้ว');
      renderForm();
    } catch (e) { toast('บันทึกไม่สำเร็จ: ' + e.message, true); }
    done();
  }

  /* ---------- ข้อความประกาศสำหรับ LINE / Facebook ---------- */
  function announce(p) {
    const org = p.org || 'แขวงทางหลวงระยอง', date = thDate(p.date);
    const road = p.road ? 'ทางหลวงหมายเลข ' + p.road : '';
    if (p.kind === 'flood') {
      const steps = (p.steps || P.autoSteps(p)).split(/\r?\n/).filter(Boolean).map(function (s, i) { return (i + 1) + '. ' + s; }).join('\n');
      const list = P.floodList(p), multi = list.length > 1 || list.some(function (f) { return f.depth; });
      const roads = P.roads(p), manyRoads = roads.length > 1;
      const pts = multi ? list.map(function (f, i) { return '• จุดที่ ' + (i + 1) + ' ' + (P.segKm(p, f) || '') + (manyRoads && f.section ? ' ตอน ' + f.section : '') + (f.place ? ' บริเวณ' + f.place : '') + (f.depth ? ' ' + P.depthTxt(f.depth) : ''); }).join('\n') + '\n' : '';
      return '📢 ' + org + ' ขออภัยในความไม่สะดวก\n' +
        'เนื่องจากเกิดน้ำท่วมทาง ' + (manyRoads ? 'ทางหลวงหมายเลข ' + roads.join(', ') : road + (p.section ? ' ตอน ' + p.section : '')) + (multi ? ' จำนวน ' + list.length + ' จุด' + (date ? ' (' + date + ')' : '') + '\n' + pts
          : (p.place ? ' บริเวณ' + p.place : '') + (P.kmRangeAll(p) ? ' ' + P.kmRangeAll(p) : '') + (date ? ' (' + date + ')' : '') + '\n') +
        'ขอให้ผู้ใช้ทางใช้เส้นทางเบี่ยง ดังนี้\n' + steps + '\n' +
        (p.detourLen ? 'ระยะทางเบี่ยง' + (P.hasDet2(p) ? 'ที่ 1' : '') + 'ประมาณ ' + fmtKm(p.detourLen) + '\n' : '') +
        (P.hasDet2(p) && p.detour2Len ? 'ระยะทางเบี่ยงที่ 2 ประมาณ ' + fmtKm(p.detour2Len) + '\n' : '') +
        '⚠️ ไม่ขับฝ่าน้ำท่วมที่ไม่ทราบความลึก ปฏิบัติตามป้ายและเจ้าหน้าที่\n☎️ สายด่วนกรมทางหลวง ' + (p.hotline || 'โทร. 1586');
    }
    if (p.kind === 'safety') {
      return '📢 ' + org + ' แจ้ง' + (p.workType || 'งาน') + ' ' + road + (P.kmRange(p.zone) ? ' ' + P.kmRange(p.zone) : '') + (p.place ? ' บริเวณ' + p.place : '') + (date ? ' (' + date + ')' : '') + '\n' +
        'ปิดช่องจราจร' + (p.side === 'right' ? 'ขวา (ชิดเกาะกลาง)' : 'ซ้าย (ชิดไหล่ทาง)') + (p.both ? ' ใช้ช่องจราจรสลับทิศทาง' : '') + '\n' +
        'ขอให้ผู้ใช้ทางลดความเร็ว เพิ่มความระมัดระวัง และปฏิบัติตามป้ายและสัญญาณของเจ้าหน้าที่\nขออภัยในความไม่สะดวก ☎️ สายด่วนกรมทางหลวง 1586';
    }
    const a = p.drain.a, b = p.drain.b;
    return '💧 แนวทางระบายน้ำ ' + (p.place || a.name || '') + ' ' + road + (a.km ? ' กม.' + a.km : '') + (date ? ' (' + date + ')' : '') + '\n' +
      'จุดน้ำท่วมขัง: ' + (a.name || '-') + ' (' + a.lat + ', ' + a.lng + ')\n' +
      'ระบายลง: ' + (b.name || '-') + (P.has(b) ? ' (' + b.lat + ', ' + b.lng + ')' : '') + '\n' +
      (p.drainLen ? 'ระยะแนวระบาย ประมาณ ' + fmtKm(p.drainLen) + '\n' : '') + (p.drop != null ? 'ต่างระดับประมาณ ' + p.drop + ' ม.\n' : '') +
      'หมายเหตุ: ข้อมูลระดับจากแบบจำลองความสูงพื้นดิน ใช้ประกอบการวางแผนเบื้องต้น ต้องสำรวจระดับจริงก่อนดำเนินการ';
  }

  /* ======================= ตั้งค่า ======================= */
  // ตราที่ใช้บนผัง (ค่าเริ่มต้นของเว็บ): เก็บในเบราว์เซอร์ · โหลดตราแบบใหม่จากฐานข้อมูลกลางได้แล้วค่อยเลือกแบบใหม่ได้
  function logoPref() {
    let v = null;
    try { v = localStorage.getItem('fdp_logo'); } catch (e) { /* ข้าม */ }
    if (!window.LOGO_NEW_DATA) return 'old';
    return v === 'old' ? 'old' : 'new';
  }
  function renderSettings() {
    const el = $('view-settings'), lp = logoPref();
    const logoOpt = function (k, src, name) {
      return '<label class="logo-opt' + (lp === k ? ' active' : '') + (src ? '' : ' disabled') + '"><input type="radio" name="logoPref" value="' + k + '"' + (lp === k ? ' checked' : '') + (src ? '' : ' disabled') + '>' +
        (src ? '<img src="' + src + '" alt="">' : '<span class="logo-none">ยังไม่มีไฟล์</span>') + '<span>' + name + '</span></label>';
    };
    el.innerHTML =
      '<div class="card" style="max-width:820px"><div class="section-title">🏛️ ตรากรมทางหลวงบนผัง <span class="sub">ค่าเริ่มต้นของทุกผัง · ผังแต่ละแผ่นเลือกเปลี่ยนเองได้ในหน้าแก้ไขผัง</span></div>' +
      '<div class="logo-opts">' + logoOpt('new', window.LOGO_NEW_DATA, 'ตราแบบใหม่') + logoOpt('old', window.LOGO_DATA || 'logo.png', 'ตราแบบเดิม') + '</div>' +
      '<p class="hint">' + (window.LOGO_NEW_DATA
        ? 'ตราแบบใหม่ใช้ไฟล์กลางจากฐานข้อมูลกลาง (CN-Hub) — ทุกระบบใช้ตราเดียวกัน'
        : 'ยังเชื่อมต่อฐานข้อมูลกลางไม่ได้ — ใช้ตราแบบเดิมไปก่อน') + '</p></div>' +
      '<div class="card" style="max-width:820px"><div class="section-title">🔑 เปลี่ยนรหัสผ่านของฉัน <span class="sub">ใช้ร่วมกับระบบงานควบคุมงานโครงการ</span></div>' +
      '<div class="grid grid-2"><div class="field"><label>รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)</label>' + pwField('pw1') + '</div><div class="field"><label>ยืนยันรหัสผ่านใหม่</label>' + pwField('pw2') + '</div></div>' +
      '<div class="flex" style="margin-top:12px"><button class="btn btn-primary" id="pwSave">เปลี่ยนรหัสผ่าน</button></div></div>' +
      '<div class="card" style="max-width:820px"><div class="section-title">🗄️ ฐานข้อมูล</div>' +
      '<p class="small" style="margin:0 0 6px">ใช้ฐานข้อมูลเดียวกับระบบ <b>งานควบคุมงานโครงการ</b> (Firebase: choengnoen-project) — ผังเก็บแยกหมวด <code>traffic_plans</code> ไม่ปนกับข้อมูลโครงการ</p>' +
      '<p class="small" style="margin:0 0 6px">เพิ่ม/ลบผู้ใช้งาน และตั้งผู้ดูแลระบบ ทำที่ระบบงานควบคุมงานโครงการ (แท็บตั้งค่า) รายชื่อจะใช้ได้ทั้งสองระบบทันที</p>' +
      '<p class="small" style="margin:0">ผังที่ไม่ใช้แล้ว: รายการผัง → ลบ (ย้ายไปถังขยะ) → ถังขยะ → ลบถาวร (เจ้าของระบบ/ผู้ดูแลระบบ)</p>' +
      (FBL.mode === 'demo' ? '<div class="flex" style="margin-top:10px"><button class="btn btn-danger" id="demoReset">ล้างข้อมูลทดลองทั้งหมด</button></div>' : '') + '</div>';
    bindPw(el);
    el.querySelectorAll('input[name="logoPref"]').forEach(function (r) {
      r.onchange = function () {
        try { localStorage.setItem('fdp_logo', r.value); } catch (e) { /* ข้าม */ }
        P.logoDefault = r.value;
        el.querySelectorAll('.logo-opt').forEach(function (x) { x.classList.toggle('active', x.contains(r)); });
        toast('ตั้งค่าตราแล้ว — ผังที่เลือก "ตามค่าตั้งของเว็บ" จะใช้ตรานี้');
      };
    });
    $('pwSave').onclick = async function () {
      const a = $('pw1').value, b = $('pw2').value;
      if (a.length < 8) { toast('รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร', true); return; }
      if (a !== b) { toast('รหัสผ่านสองช่องไม่ตรงกัน', true); return; }
      const done = busy(this);
      try { await FBL.changeMyPassword(a); toast('เปลี่ยนรหัสผ่านแล้ว'); $('pw1').value = $('pw2').value = ''; } catch (e) { toast(e.message, true); }
      done();
    };
    if ($('demoReset')) $('demoReset').onclick = function () { if (confirm('ล้างข้อมูลทดลองทั้งหมดในเครื่องนี้?')) { FBL.resetDemo(); location.reload(); } };
  }

  // ตราแบบใหม่: ไฟล์กลางจากฐานข้อมูลกลาง (CNMaster.EMBLEM_URL) · โหลดไม่ได้ (ออฟไลน์/ฮับล่ม) = มีแต่ตราแบบเดิม
  // ตราบนหัวเว็บ/หน้าล็อกอิน/ไอคอนแท็บ master-client.js เปลี่ยนให้เองอัตโนมัติ
  function applyNewLogo(src) {
    window.LOGO_NEW_DATA = src;
    if (P.logos) P.logos.new = src;
    P.logoDefault = logoPref();
    if (S.cur) P.draw();
    if ($('view-settings') && $('view-settings').classList.contains('active')) renderSettings();
  }
  if (window.CNMaster && CNMaster.EMBLEM_URL) {
    const newLogo = new Image();
    newLogo.onload = function () { applyNewLogo(CNMaster.EMBLEM_URL); };
    newLogo.src = CNMaster.EMBLEM_URL;
  }

  boot();
})();
