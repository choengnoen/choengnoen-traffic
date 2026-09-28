/* ==========================================================================
   app.js — ระบบผังจราจรและทางเบี่ยง: ล็อกอิน · รายการผัง · สร้าง/แก้ไขผัง · ตั้งค่า
   ผัง 3 แบบ: ทางเบี่ยงอุทกภัย (flood) · ติดตั้งสิ่งอำนวยความปลอดภัย (safety) · แนวทางระบายน้ำ (drain)
   ========================================================================== */
(function () {
  'use strict';
  const $ = function (id) { return document.getElementById(id); };
  const esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  const P = window.Poster;
  const S = { team: [], plans: [], cur: null, dirty: false, view: 'list', filter: 'all', q: '', trash: false, files: [] };

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
      b.onclick = function () { const i = $(b.dataset.target); if (i) i.type = i.type === 'password' ? 'text' : 'password'; };
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
  const PT_KEYS = ['flood', 'detour', 'zone', 'drain'];
  function normName(s) { return String(s || '').toLowerCase().replace(/[\s.,:;\-–()（）'"“”]/g, ''); }
  function baseName(s) { return normName(s).replace(/^(ทางแยก|สี่แยก|สามแยก|แยก|วงเวียน|จุด)/, ''); }
  function memoLocal() { try { return JSON.parse(localStorage.getItem(MEMO_KEY)) || {}; } catch (e) { return {}; } }
  // จำจุดที่มีทั้งชื่อและพิกัดของผังนี้ไว้ในเครื่อง (เผื่อยังไม่ได้บันทึกผัง)
  function remember(p) {
    if (!p) return;
    const m = memoLocal(), t = new Date().toISOString();
    PT_KEYS.forEach(function (k) {
      if (!p[k]) return;
      [p[k].a, p[k].b].forEach(function (q) {
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
      PT_KEYS.forEach(function (k) { if (p[k]) { put(p[k].a, t); put(p[k].b, t); } });
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
    PT_KEYS.forEach(function (k) {
      if (!p[k]) return;
      [p[k].a, p[k].b].forEach(function (q) {
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
    if (kind === 'flood') Object.assign(p, { style: 'doh', flood: { a: pt(), b: pt(), via: [] }, detour: { a: pt(), b: pt(), via: [] }, dirLeft: '', dirRight: '' });
    if (kind === 'safety') Object.assign(p, { workType: 'งานก่อสร้าง', speed: 90, side: 'left', both: false, zone: { a: pt(), b: pt(), via: [] }, devices: [] });
    if (kind === 'drain') Object.assign(p, { drain: { a: pt(), b: pt(), via: [] }, devices: [], waterLines: [] });
    return p;
  }
  function autoTitle(p) {
    const r = p.kind === 'flood' ? p.flood : p.kind === 'safety' ? p.zone : p.drain;
    return [KIND[p.kind].short, p.kind === 'safety' ? p.workType : '', p.road ? 'ทล.' + p.road : '', p.place || (r && r.a && r.a.name) || '', thDate(p.date, true)].filter(Boolean).join(' · ');
  }
  function titleOf(p) { return p.title || autoTitle(p); }

  /* ======================= ล็อกอิน ======================= */
  let teamLoadError = '', appStarted = false;
  function hideLoading() { $('pageLoadingOverlay').classList.add('hide'); }
  function gateError(msg) { const el = $('gateError'); if (el) { el.textContent = msg; el.style.display = 'block'; } }
  function renderGate(errorMsg) {
    const g = $('authGate'); hideLoading(); g.classList.add('show');
    $('appHeader').style.display = 'none'; $('main').style.display = 'none';
    const head = '<img src="logo.png" alt="ตรากรมทางหลวง" class="auth-logo"><h2>ระบบผังจราจรและทางเบี่ยง</h2><p class="auth-sub">หมวดทางหลวงเชิงเนิน · แขวงทางหลวงระยอง</p>';
    const demo = FBL.mode === 'demo' ? '<div class="auth-demo">โหมดทดลอง: ข้อมูลเก็บในเบราว์เซอร์เครื่องนี้เท่านั้น (ใช้งานจริงให้เปิดจากเว็บที่อัปโหลดแล้ว)</div>' : '';
    const err = '<p class="hint auth-error" id="gateError" style="' + (errorMsg ? '' : 'display:none') + '">' + esc(errorMsg || '') + '</p>';
    if (teamLoadError) {
      g.innerHTML = '<div class="auth-card">' + head + '<h3 class="auth-h3">เชื่อมต่อฐานข้อมูลไม่สำเร็จ</h3><p class="hint auth-error">' + esc(teamLoadError) + '</p><button class="btn btn-primary auth-btn" id="gateRetry">ลองอีกครั้ง</button></div>';
      $('gateRetry').onclick = function () { location.reload(); };
      return;
    }
    if (!S.team.length) {
      if (FBL.mode !== 'demo') {
        g.innerHTML = '<div class="auth-card">' + head + '<h3 class="auth-h3">ยังไม่มีผู้ใช้งาน</h3><p class="hint">ระบบนี้ใช้รายชื่อผู้ใช้ร่วมกับระบบ "ผู้ควบคุมงานโครงการ" กรุณาตั้งเจ้าของระบบและเพิ่มผู้ใช้ที่ระบบนั้นก่อน</p></div>';
        return;
      }
      g.innerHTML = '<div class="auth-card">' + head + '<h3 class="auth-h3">ตั้งค่าเจ้าของระบบ (โหมดทดลอง)</h3>' +
        '<div class="field"><label>ชื่อ-นามสกุลของคุณ</label><input type="text" id="gName" autocomplete="off"></div>' +
        '<div class="field"><label>ตั้งรหัสผ่าน (อย่างน้อย 8 ตัวอักษร)</label>' + pwField('gP1') + '</div>' +
        '<div class="field"><label>ยืนยันรหัสผ่าน</label>' + pwField('gP2') + '</div>' + err +
        '<button class="btn btn-primary auth-btn" id="gClaim">ตั้งค่าและเข้าสู่ระบบ</button>' + demo + '</div>';
      bindPw(g);
      $('gClaim').onclick = async function () {
        const n = $('gName').value.trim(), p1 = $('gP1').value, p2 = $('gP2').value;
        if (!n || !p1) return gateError('กรอกชื่อและรหัสผ่านให้ครบ');
        if (p1.length < 8) return gateError('รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร');
        if (p1 !== p2) return gateError('รหัสผ่านสองช่องไม่ตรงกัน');
        const done = busy($('gClaim'), 'กำลังตั้งค่า...');
        try { const u = await FBL.bootstrapOwner(n, p1); S.team = FBL.team(); onAuth(u); } catch (e) { done(); gateError(e.message); }
      };
      return;
    }
    g.innerHTML = '<div class="auth-card">' + head + '<h3 class="auth-h3">เข้าสู่ระบบ</h3>' +
      '<div class="field"><label>ชื่อผู้ใช้งาน</label><select id="gSel"><option value="">— เลือกชื่อของคุณ —</option>' +
      S.team.map(function (m) { return '<option value="' + esc(m.name) + '">' + esc(m.name) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label>รหัสผ่าน</label><input type="text" id="gShadow" name="username" autocomplete="username" tabindex="-1" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0">' + pwField('gPass', 'current-password') + '</div>' +
      err + '<button class="btn btn-primary auth-btn" id="gOk">เข้าสู่ระบบ</button>' +
      '<p class="hint" style="margin:12px 0 0;text-align:left">ใช้ชื่อและรหัสผ่านเดียวกับระบบผู้ควบคุมงานโครงการ</p>' + demo + '</div>';
    bindPw(g);
    const sel = $('gSel'), sh = $('gShadow');
    sel.onchange = function () { sh.value = sel.value; };
    sh.oninput = function () { if ([].some.call(sel.options, function (o) { return o.value === sh.value; })) sel.value = sh.value; };
    const login = async function () {
      if (!sel.value) return gateError('เลือกชื่อของคุณก่อน');
      if (!$('gPass').value) return gateError('กรอกรหัสผ่าน');
      const done = busy($('gOk'), 'กำลังตรวจสอบ...');
      try { await FBL.login(sel.value, $('gPass').value); } catch (e) { done(); gateError(e.message); }
    };
    $('gOk').onclick = login;
    $('gPass').onkeydown = function (e) { if (e.key === 'Enter') login(); };
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
    // กล่องกรอกข้อมูลด้านซ้าย สูงพอดีขอบล่างของผังตัวอย่าง (จอกว้างเท่านั้น จอแคบเรียงบน-ล่าง)
    const edR = document.querySelector('.ed-right'), stg = $('pzStage');
    const fitForm = function () {
      const f = $('edForm'); if (!f) return;
      f.style.maxHeight = window.innerWidth > 1100 ? Math.max(420, Math.round(stg.getBoundingClientRect().bottom - edR.getBoundingClientRect().top)) + 'px' : '';
    };
    const ro = new ResizeObserver(fitForm); ro.observe(edR); ro.observe(stg);
    window.addEventListener('resize', fitForm);
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
    else if (opt.type === 'textarea') input = '<textarea data-k="' + path + '" rows="' + (opt.rows || 3) + '" placeholder="' + esc(opt.ph || '') + '">' + esc(v || '') + '</textarea>';
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
      '<button class="btn btn-sm btn-outline" data-pick="' + path + '" title="คลิกเลือกตำแหน่งบนแผนที่">📍</button></div></div></div></div>';
  }
  function styleCards() {
    const cur = S.cur.style || 'doh';
    const mini = {
      doh: '<div style="position:absolute;left:0;right:0;top:0;height:30%;background:#fff"></div><div style="position:absolute;right:4px;bottom:4px;width:30%;height:26%;background:#fff;border-radius:2px"></div>',
      alert: '<div style="position:absolute;left:8%;right:8%;top:6%;height:30%;background:#d61a1a;border:2px solid #fff;border-radius:5px"></div><div style="position:absolute;left:30%;top:50%;width:50%;height:5px;background:#3bd13b;transform:rotate(20deg)"></div>',
      info: '<div style="position:absolute;inset:0;background:#0d3a78"></div><div style="position:absolute;left:3%;top:28%;width:24%;bottom:14%;background:#fff;border-radius:3px"></div><div style="position:absolute;right:3%;top:28%;width:24%;bottom:14%;background:#fff;border-radius:3px"></div><div style="position:absolute;left:30%;right:30%;top:28%;bottom:14%;background:#6b8f5b"></div>'
    };
    return '<div class="style-cards">' + Object.keys(P.STY).map(function (k) {
      return '<div class="style-card' + (cur === k ? ' active' : '') + '" data-style="' + k + '"><div class="mini">' + mini[k] + '</div>' + esc(P.STY[k].name) + '</div>';
    }).join('') + '</div>';
  }
  function renderForm() {
    const el = $('edForm');
    const p = S.cur;
    if (!p) {
      el.innerHTML = '<div class="card"><div class="section-title">เลือกชนิดผังที่จะสร้าง</div>' + Object.keys(KIND).map(function (k) {
        return '<button class="new-card" style="width:100%;margin-bottom:8px" data-new="' + k + '"><span class="ic">' + KIND[k].ic + '</span><div><b>' + KIND[k].name + '</b><span>' + KIND[k].desc + '</span></div></button>';
      }).join('') + '</div>';
      el.querySelectorAll('[data-new]').forEach(function (b) { b.onclick = function () { openPlan(newPlan(b.dataset.new)); }; });
      $('edTips').textContent = '';
      return;
    }
    const k = p.kind;
    let h = '<div class="card"><div class="section-title">' + KIND[k].ic + ' ' + KIND[k].name + (p.id ? '' : ' <span class="badge b-warn">ผังใหม่ ยังไม่บันทึก</span>') + '</div>' +
      '<div class="grid grid-2">' + fld('วันที่', 'date', { type: 'date' }) + fld('สถานะ', 'status', { type: 'select', options: [{ k: 'active', n: 'ใช้งานอยู่' }, { k: 'ended', n: 'สิ้นสุดแล้ว' }] }) + '</div></div>';

    // ผู้ช่วยกรอกข้อมูล
    h += '<div class="card"><div class="section-title">🤖 ผู้ช่วยกรอกข้อมูล <span class="sub">วางข้อความ/ลิงก์ หรือแนบรูป แล้วให้ระบบกรอกให้</span></div>' +
      '<div class="field"><textarea id="aiText" rows="4" placeholder="' + esc(k === 'flood'
        ? 'เช่น น้ำท่วมทาง ทล.3 ตอน ระยอง-กะเฉด บริเวณบ้านซ่น-ตำนานป่า กม.233+100 (12.6386, 101.3783) ถึง กม.236+700 (12.6397, 101.4006)\nทางเบี่ยง แยกตะพง กม.229+768 12.6461,101.3441 ถึง แยกศาลาสังสี กม.239+710 12.6410,101.4222'
        : k === 'safety' ? 'เช่น งานก่อสร้าง ทล.3 กม.233+100 (12.6386,101.3783) ถึง กม.233+500 (12.6389,101.3841) ปิดช่องซ้าย'
          : 'เช่น น้ำท่วมขังหน้าตลาด ทล.3 กม.234+200 พิกัด 12.6398, 101.3854') + '"></textarea></div>' +
      '<div class="ai-drop" id="aiDrop">📎 แนบรูป (ภาพหน้าจอ LINE / แผนที่ / หนังสือ) — คลิก ลากไฟล์มาวาง หรือกด Ctrl+V ในช่องข้อความ<input type="file" id="aiFile" accept="image/*" multiple hidden><div class="ai-files" id="aiFiles"></div></div>' +
      '<div class="flex" style="margin-top:8px"><button class="btn btn-primary btn-sm" id="aiRun">🤖 ให้ AI อ่าน</button><button class="btn btn-outline btn-sm" id="aiLocal">อ่านเอง (ไม่ใช้ AI)</button></div>' +
      (AI.ready() ? '' : '<p class="hint" style="margin:6px 0 0">ยังไม่ได้ตั้งค่า AI — ใช้ "อ่านเอง" ได้ (อ่านพิกัด/กม. จากข้อความ) หรือใส่ API key ที่หน้าตั้งค่า</p>') + '</div>';

    // ข้อมูลหลัก
    h += '<div class="card"><div class="section-title">📍 ข้อมูลผัง</div><div class="grid grid-2">' +
      fld('ทางหลวงหมายเลข', 'road', { ph: 'เช่น 3' }) +
      (k === 'safety' ? fld('ประเภทงาน', 'workType', { type: 'select', options: WORK.indexOf(p.workType) >= 0 ? WORK : WORK.concat([p.workType]) }) : fld('ตอนควบคุม', 'section', { ph: 'เช่น ระยอง-กะเฉด' })) +
      fld(k === 'drain' ? 'ชื่อบริเวณน้ำท่วมขัง' : 'ชื่อบริเวณ', 'place', { cls: 'span-all', ph: k === 'flood' ? 'เช่น บ้านซ่น - ตำนานป่า' : 'เช่น หน้าตลาดบ้านเพ' }) + '</div>';
    if (k === 'flood') {
      h += '<div class="sub-t section-title" style="font-size:14px;margin:12px 0 6px">ช่วงน้ำท่วม</div>' + ptRow('flood.a', 'จุดเริ่มน้ำท่วม', 'ชื่อ (ไม่ใส่ก็ได้)') + ptRow('flood.b', 'จุดสิ้นสุดน้ำท่วม', 'ชื่อ (ไม่ใส่ก็ได้)') +
        '<div class="section-title" style="font-size:14px;margin:12px 0 6px">ทางเบี่ยง</div>' + ptRow('detour.a', 'จุดแยกออก (เข้าทางเบี่ยง)') + ptRow('detour.b', 'จุดกลับเข้าทางหลัก') +
        '<div class="grid grid-2">' + fld('ลูกศรฝั่งซ้ายของผัง', 'dirLeft', { ph: 'เช่น ไประยอง' }) + fld('ลูกศรฝั่งขวาของผัง', 'dirRight', { ph: 'เช่น ไปแกลง' }) + '</div>' +
        '<div class="section-title" style="font-size:14px;margin:14px 0 6px">สไตล์ผัง</div>' + styleCards();
    }
    if (k === 'safety') {
      h += '<div class="section-title" style="font-size:14px;margin:12px 0 6px">เขตปฏิบัติงาน (ตามทิศทางรถวิ่ง)</div>' + ptRow('zone.a', 'ต้นเขตงาน (รถวิ่งเข้ามาถึงก่อน)', 'ชื่อ (ไม่ใส่ก็ได้)') + ptRow('zone.b', 'ปลายเขตงาน', 'ชื่อ (ไม่ใส่ก็ได้)') +
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
    h += '<button class="btn btn-primary btn-lg" id="edBuild" style="margin-top:10px">⚡ สร้างผังอัตโนมัติ</button><div id="edLens" class="hint" style="margin-top:6px"></div></div>';

    // อุปกรณ์
    h += '<div class="card"><div class="section-title">🧰 ' + (k === 'drain' ? 'อุปกรณ์งานระบายน้ำ' : k === 'flood' ? 'จุดน้ำท่วมเพิ่มเติม / ป้ายและอุปกรณ์' : 'ป้ายและอุปกรณ์') + ' <span class="sub">เลือกแล้วคลิกบนผังเพื่อวาง' + (k === 'flood' ? ' (จุดน้ำท่วมวางได้หลายจุด)' : '') + ' · คลิกขวาที่ชิ้นเพื่อลบ · ดับเบิลคลิกแก้ข้อความ</span></div><div class="dev-palette" id="devPal"></div>' +
      (k === 'safety' ? '<div class="flex" style="margin-top:8px"><button class="btn btn-sm btn-outline" id="devRe">↺ จัดวางอุปกรณ์ใหม่อัตโนมัติ</button><button class="btn btn-sm btn-danger" id="devClr">ล้างอุปกรณ์ทั้งหมด</button></div>' : '') + '</div>';

    // ปรับแต่งข้อความ
    h += '<details class="more"><summary>✏️ ปรับแต่งข้อความบนผัง</summary><div class="in"><div class="grid">' +
      fld('หน่วยงาน (หัวผัง)', 'org') +
      fld('หัวเรื่องบรรทัดที่ 2 (เว้นว่าง = สร้างให้อัตโนมัติ)', 'headline', { ph: P.autoHeadline(p) }) +
      fld('ข้อความขออภัย', 'apology', { ph: 'ขออภัยในความไม่สะดวก' }) +
      (k === 'flood' ? fld('คำอธิบายเส้นสีแดง', 'legendFlood', { ph: 'บริเวณที่น้ำท่วมทาง' }) + fld('คำอธิบายเส้นสีน้ำเงิน', 'legendDetour', { ph: 'เส้นทางเบี่ยงการจราจร' }) : '') +
      (k === 'safety' ? fld('คำอธิบายเขตงาน', 'legendZone', { ph: 'เขตปฏิบัติงาน / ช่องจราจรที่ปิด' }) : '') +
      (k === 'drain' ? fld('คำอธิบายแนวระบายน้ำ', 'legendDrain', { ph: 'แนวทางระบายน้ำ' }) : '') +
      fld('ชื่อผัง (ใช้ในรายการ/ชื่อไฟล์)', 'title', { ph: autoTitle(p) }) +
      '</div>';
    if (k === 'flood') {
      h += '<div class="section-title" style="font-size:14px;margin:12px 0 6px">แบบเตือนภัย (แนวตั้ง)</div><div class="grid">' +
        fld('บรรทัดที่ 1', 'alert1', { ph: 'หลีกเลี่ยงเส้นทางน้ำท่วม' }) + fld('บรรทัดที่ 2 (สีเหลือง)', 'alert2', { ph: P.autoAlert2(p) }) + fld('บรรทัดที่ 3', 'alert3', { ph: 'ทั้งฝั่งขาเข้าและขาออก' }) +
        fld('กล่องเขียว', 'callGo', { ph: 'เส้นทางหลีกเลี่ยงน้ำท่วม' }) + fld('กล่องแดง (บรรทัดล่าง)', 'callNo', { ph: 'บริเวณ' + (p.place || '...') + ' น้ำท่วม' }) + '</div>' +
        '<div class="section-title" style="font-size:14px;margin:12px 0 6px">แบบอินโฟกราฟิก</div><div class="grid grid-2">' +
        fld('หัวเรื่อง (สีขาว)', 'info1', { ph: 'เส้นทางเลี่ยงน้ำท่วม' }) + fld('หัวเรื่อง (สีเหลือง)', 'info2', { ph: p.road ? 'ทล.' + p.road : '' }) +
        fld('คำขวัญใต้หัวเรื่อง', 'infoSub', { cls: 'span-all', ph: '“โปรดตรวจสอบเส้นทางก่อนออกเดินทาง และขับขี่ด้วยความระมัดระวัง”' }) +
        fld('ขั้นตอนการเดินทาง (1 บรรทัด = 1 ข้อ)', 'steps', { type: 'textarea', rows: 4, cls: 'span-all', ph: P.autoSteps(p) }) +
        fld('ข้อควรทราบ (1 บรรทัด = 1 ข้อ)', 'notes', { type: 'textarea', rows: 4, cls: 'span-all', ph: P.autoNotes(p) }) +
        fld('สายด่วน', 'hotline', { ph: 'โทร. 1586' }) + '</div>';
    }
    h += '</div></details>';
    h += '<div class="card"><div class="grid grid-2">' + fld('พื้นหลังแผนที่', 'base', { type: 'select', options: [{ k: 'sat', n: 'ภาพดาวเทียม' }, { k: 'street', n: 'แผนที่ถนน' }, { k: 'gmap', n: 'แผนที่แบบ Google (หมุดเฉพาะที่สำคัญ)' }] }) +
      fld('แบบหัวผัง (แบบกรมทางหลวง)', 'head', { type: 'select', options: Object.keys(P.HEADS).map(function (x) { return { k: x, n: P.HEADS[x] }; }) }) +
      fld('ตรากรมทางหลวง', 'logo', { type: 'select', options: [{ k: '', n: 'ตามค่าตั้งของเว็บ (' + (P.logoDefault === 'new' ? 'แบบใหม่' : 'แบบเดิม') + ')' }, { k: 'new', n: 'ตราแบบใหม่' + (P.logos.new ? '' : ' (ยังไม่มีไฟล์)') }, { k: 'old', n: 'ตราแบบเดิม' }] }) +
      (k === 'flood' ? fld('รูปแบบลูกศรบอกทิศ', 'arrow', { type: 'select', options: Object.keys(P.ARROWS).map(function (x) { return { k: x, n: P.ARROWS[x].name }; }) }) +
        fld('สีลูกศร', 'arrowColor', { type: 'select', options: Object.keys(P.ARROW_COLORS).map(function (x) { return { k: x, n: P.ARROW_COLORS[x] }; }) }) +
        '<div class="span-all arrow-prev" id="arrPrev"></div>' : '') + '</div>' +
      '<p class="hint">กล่อง "ขออภัยในความไม่สะดวก" และ "คำอธิบายสัญลักษณ์" ลากย้ายบนผังได้ · ดับเบิลคลิกที่กล่องเพื่อคืนตำแหน่งเดิม</p></div>';
    // ข้อมูลอ้างอิงจากไฟล์ Google Earth ของแขวงฯ
    p.ref = Object.assign({ pts: 'none', sel: [], lbl: true, routes: false, tambon: false, tambonLbl: true }, p.ref);
    h += '<div class="card"><div class="section-title">🗺️ ข้อมูลอ้างอิงบนแผนที่ <span class="sub">จากไฟล์ Google Earth ของแขวงฯ</span></div><div class="grid grid-2">' +
      fld('จุดแยก / จุดกลับรถ (U-Turn) ทล.3, ทล.36', 'ref.pts', { type: 'select', cls: 'span-all', options: [{ k: 'none', n: 'ไม่แสดง' }, { k: 'all', n: 'แสดงทุกจุด (' + P.refPts.length + ' จุด)' }, { k: 'sel', n: 'แสดงเฉพาะจุดที่เลือก' }] }) +
      fld('แสดงชื่อจุดและ กม.', 'ref.lbl', { type: 'checkbox', cls: 'span-all' }) +
      fld('เส้นสายทางควบคุมแขวงฯ', 'ref.routes', { type: 'checkbox' }) +
      fld('ขอบเขตตำบล จ.ระยอง', 'ref.tambon', { type: 'checkbox' }) +
      fld('แสดงชื่อตำบล', 'ref.tambonLbl', { type: 'checkbox' }) + '</div>' +
      '<div id="refList"></div>' +
      '<p class="hint">ปุ่ม 📍 ของแต่ละจุด: คลิกจุดสีเขียวบนแผนที่เพื่อใช้พิกัด ชื่อ และ กม. ของจุดนั้นได้ทันที · พิมพ์ชื่อจุด เช่น "สี่แยกตะพง" ระบบเติมพิกัดให้เอง</p></div>';
    // รายชื่อจุดที่เคยลงพิกัด (ให้เลือกตอนพิมพ์ชื่อจุด)
    h += '<datalist id="tpPlaces">' + knownList().map(function (q) { return '<option value="' + esc(q.name) + '">' + esc((q.km ? 'กม.' + q.km + ' · ' : '') + q.lat + ', ' + q.lng) + '</option>'; }).join('') + '</datalist>';
    el.innerHTML = h;
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
        status('คลิกบนแผนที่ตรงตำแหน่ง "' + b.closest('.pt-row').querySelector('.pt-h').firstChild.textContent + '" หรือคลิกจุดแยก/U-Turn เพื่อใช้พิกัดและชื่อจุดนั้น');
        P.pick(function (ll, ref) {
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
    // ผู้ช่วยกรอกข้อมูล
    const drop = $('aiDrop'), file = $('aiFile');
    drop.onclick = function (e) { if (e.target === drop) file.click(); };
    file.onchange = function () { addFiles(file.files); file.value = ''; };
    drop.ondragover = function (e) { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = function () { drop.classList.remove('over'); };
    drop.ondrop = function (e) { e.preventDefault(); drop.classList.remove('over'); addFiles(e.dataTransfer.files); };
    $('aiText').addEventListener('paste', function (e) {
      const imgs = [].filter.call((e.clipboardData && e.clipboardData.files) || [], function (f) { return /^image\//.test(f.type); });
      if (imgs.length) { e.preventDefault(); addFiles(imgs); }
    });
    showFiles();
    $('aiRun').onclick = async function () {
      const text = $('aiText').value.trim();
      if (!AI.ready()) {   // ไม่มี key → อ่านเองแทน (อ่านได้เฉพาะข้อความ)
        if (!text) { toast('ยังไม่ได้ใส่ API key — การอ่านรูปต้องใส่ key ที่แท็บ "ตั้งค่า" ก่อน', true); return; }
        applyParsed(AI.parseLocal(text, knownList()), false);
        toast('ยังไม่ได้ใส่ API key จึงใช้ "อ่านเอง" แทน (อ่านรูปไม่ได้)');
        return;
      }
      if (!text && !S.files.length) { toast('วางข้อความหรือแนบรูปก่อน', true); return; }
      const done = busy(this, 'AI กำลังอ่าน...');
      try { const r = await AI.parse(text, S.files, KIND[S.cur.kind].name, knownList()); applyParsed(r, true); }
      catch (e) { toast(e.message, true); }
      done();
    };
    $('aiLocal').onclick = function () {
      const text = $('aiText').value.trim();
      if (!text) { toast('วางข้อความก่อน (การอ่านเองอ่านรูปไม่ได้)', true); return; }
      applyParsed(AI.parseLocal(text, knownList()), false);
    };
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
  function addFiles(list) {
    [].forEach.call(list || [], function (f) { if (/^image\//.test(f.type) && S.files.length < 5) S.files.push(f); });
    showFiles();
  }
  function showFiles() {
    const box = $('aiFiles'); if (!box) return;
    box.innerHTML = S.files.map(function (f, i) { return '<img src="' + URL.createObjectURL(f) + '" title="คลิกเพื่อเอาออก" data-i="' + i + '">'; }).join('');
    box.querySelectorAll('img').forEach(function (im) { im.onclick = function (e) { e.stopPropagation(); S.files.splice(+im.dataset.i, 1); showFiles(); }; });
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
    if (p.kind === 'flood') { if (p.floodLine) out.push('ช่วงน้ำท่วม ' + fmtKm(P.floodLength(p))); if (p.detourLen) out.push('ทางเบี่ยง ' + fmtKm(p.detourLen)); }
    if (p.kind === 'safety' && p.zoneLine) out.push('เขตงาน ' + fmtKm(P.floodLength(p)), 'อุปกรณ์ ' + (p.devices || []).length + ' ชิ้น');
    if (p.kind === 'drain' && p.drainLine) out.push('แนวระบายน้ำ ' + fmtKm(p.drainLen || 0), 'ระบายลง: ' + (p.drain.b.name || '-'), p.drop != null ? 'ต่างระดับ ~' + (+p.drop).toFixed(1) + ' ม.' : '');
    el.textContent = out.filter(Boolean).join(' · ');
  }
  // เติมข้อมูลจากผู้ช่วย: เติมเฉพาะช่องที่ได้ค่ามา ไม่ลบของเดิม
  function applyParsed(r, fromAI) {
    const p = S.cur;
    ['road', 'section', 'place'].forEach(function (k) { if (r[k]) p[k] = r[k]; });
    if (fromAI) {
      if (r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date)) p.date = r.date;
      if (p.kind === 'safety' && r.workType) p.workType = r.workType;
      if (p.kind === 'flood') { if (r.dirLeft) p.dirLeft = r.dirLeft; if (r.dirRight) p.dirRight = r.dirRight; }
    }
    const fill = function (dst, src) {
      if (!dst || !src) return;
      if (src.name) dst.name = src.name;
      if (src.km) dst.km = src.km;
      if (src.lat != null && src.lng != null) { dst.lat = src.lat; dst.lng = src.lng; }
    };
    const map = { flood: ['flood', 'detour'], safety: ['zone'], drain: ['drain'] }[p.kind];
    map.forEach(function (key) {
      let src = r[key];
      if (key === 'zone' && (!src || !src.a) && r.flood) src = r.flood;          // ข้อความที่ไม่ได้ระบุชนิด
      if (!src) return;
      fill(p[key].a, src.a);
      if (key !== 'drain') fill(p[key].b, src.b);
    });
    const known = fillKnown(p);   // จุดที่ได้มาแค่ชื่อ → ใช้พิกัดที่เคยลงไว้
    markDirty();
    renderForm();
    const miss = missingCoords();
    const note = (known.length ? ' · ใช้พิกัดที่เคยลงไว้: ' + known.join(', ') : '') + (fromAI && r.remarks ? ' · หมายเหตุจาก AI: ' + r.remarks : '');
    status((miss.length ? 'ยังขาดพิกัด: ' + miss.join(', ') + ' (ใส่เองหรือกด 📍 เลือกบนแผนที่)' : 'กรอกข้อมูลแล้ว ตรวจสอบความถูกต้อง แล้วกด ⚡ สร้างผังอัตโนมัติ') + note, !!miss.length);
  }
  function missingCoords() {
    const p = S.cur, need = p.kind === 'flood' ? [['flood.a', 'จุดเริ่มน้ำท่วม'], ['flood.b', 'จุดสิ้นสุดน้ำท่วม'], ['detour.a', 'จุดแยกออก'], ['detour.b', 'จุดกลับเข้า']]
      : p.kind === 'safety' ? [['zone.a', 'ต้นเขตงาน'], ['zone.b', 'ปลายเขตงาน']] : [['drain.a', 'จุดน้ำท่วมขัง']];
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
        const f = await RT.route([p.flood.a].concat(p.flood.via || [], [p.flood.b]));
        p.floodLine = RT.encode(f.pts); p.floodLen = f.distance;
        const d = await RT.autoDetour(p.detour.a, p.detour.b, f.pts, status);
        p.detourLine = RT.encode(d.pts); p.detourLen = d.distance; p.detour.via = d.via || [];
        if (!p.dirLeft && !p.dirRight && p.section && p.section.indexOf('-') > 0) {
          const s = p.section.split('-').map(function (x) { return x.trim(); });
          p.dirLeft = 'ไป' + s[0]; p.dirRight = 'ไป' + s[1];
        }
        P.draw(); P.fit(); P.autoLabels();
        status(d.warn ? d.warn : 'สร้างผังแล้ว — ทางเบี่ยง ' + fmtKm(d.distance) + (d.via.length ? ' (ระบบบังคับให้อ้อมเพื่อไม่ผ่านช่วงน้ำท่วม)' : '') + ' · ตรวจสอบกับสภาพจริง แล้วลากปรับได้', !!d.warn);
      }
      if (p.kind === 'safety') {
        status('กำลังลากเขตงานตามถนน...');
        const z = await RT.route([p.zone.a].concat(p.zone.via || [], [p.zone.b]));
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
      return '📢 ' + org + ' ขออภัยในความไม่สะดวก\n' +
        'เนื่องจากเกิดน้ำท่วมทาง ' + road + (p.section ? ' ตอน ' + p.section : '') + (p.place ? ' บริเวณ' + p.place : '') + (P.kmRange(p.flood) ? ' ' + P.kmRange(p.flood) : '') + (date ? ' (' + date + ')' : '') + '\n' +
        'ขอให้ผู้ใช้ทางใช้เส้นทางเบี่ยง ดังนี้\n' + steps + '\n' +
        (p.detourLen ? 'ระยะทางเบี่ยงประมาณ ' + fmtKm(p.detourLen) + '\n' : '') +
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
    const el = $('view-settings'), c = AI.config(), lp = logoPref();
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
      '<div class="card" style="max-width:820px"><div class="section-title">🤖 AI ผู้ช่วยกรอกข้อมูล (Claude) <span class="sub">เก็บเฉพาะในเบราว์เซอร์เครื่องนี้ ไม่บันทึกลงฐานข้อมูล</span></div>' +
      '<div class="alert warn">เมื่อกด "ให้ AI อ่าน" ข้อความและรูปที่แนบจะถูกส่งไปประมวลผลที่ Anthropic (ผู้ให้บริการ Claude) — ห้ามแนบเอกสารชั้นความลับหรือข้อมูลส่วนบุคคลอ่อนไหว และ AI อาจผิดพลาดได้ ต้องตรวจทุกครั้ง</div>' +
      '<div class="grid grid-2"><div class="field"><label>Anthropic API key</label>' + pwField('aiKey', 'off') + '<span class="hint">สร้างที่ console.anthropic.com (จ่ายตามการใช้งาน) · ไม่ใส่ก็ใช้ระบบได้ครบ ยกเว้นปุ่ม 🤖</span></div>' +
      '<div class="field"><label>โมเดล</label><select id="aiModel">' + AI.MODELS.map(function (m) { return '<option value="' + m.key + '"' + ((c.model || 'claude-opus-5') === m.key ? ' selected' : '') + '>' + esc(m.name) + '</option>'; }).join('') + '</select></div></div>' +
      '<div class="flex" style="margin-top:12px"><button class="btn btn-primary" id="aiSave">บันทึก</button><button class="btn btn-outline" id="aiTest">ทดสอบการเชื่อมต่อ</button><button class="btn btn-ghost" id="aiClear">ลบ key ออกจากเครื่องนี้</button></div></div>' +
      '<div class="card" style="max-width:820px"><div class="section-title">🔑 เปลี่ยนรหัสผ่านของฉัน <span class="sub">ใช้ร่วมกับระบบผู้ควบคุมงานโครงการ</span></div>' +
      '<div class="grid grid-2"><div class="field"><label>รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)</label>' + pwField('pw1') + '</div><div class="field"><label>ยืนยันรหัสผ่านใหม่</label>' + pwField('pw2') + '</div></div>' +
      '<div class="flex" style="margin-top:12px"><button class="btn btn-primary" id="pwSave">เปลี่ยนรหัสผ่าน</button></div></div>' +
      '<div class="card" style="max-width:820px"><div class="section-title">🗄️ ฐานข้อมูล</div>' +
      '<p class="small" style="margin:0 0 6px">ใช้ฐานข้อมูลเดียวกับระบบ <b>ผู้ควบคุมงานโครงการ</b> (Firebase: choengnoen-project) — ผังเก็บแยกหมวด <code>traffic_plans</code> ไม่ปนกับข้อมูลโครงการ</p>' +
      '<p class="small" style="margin:0 0 6px">เพิ่ม/ลบผู้ใช้งาน และตั้งผู้ดูแลระบบ ทำที่ระบบผู้ควบคุมงานโครงการ (แท็บตั้งค่า) รายชื่อจะใช้ได้ทั้งสองระบบทันที</p>' +
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
    $('aiKey').value = c.key || '';
    $('aiSave').onclick = function () { AI.saveConfig({ key: $('aiKey').value.trim(), model: $('aiModel').value }); toast('บันทึกการตั้งค่า AI แล้ว'); };
    $('aiClear').onclick = function () { AI.clearConfig(); $('aiKey').value = ''; toast('ลบ key ออกจากเครื่องนี้แล้ว'); };
    $('aiTest').onclick = async function () {
      AI.saveConfig({ key: $('aiKey').value.trim(), model: $('aiModel').value });
      if (!AI.ready()) { toast('ใส่ API key ก่อน', true); return; }
      const done = busy(this, 'กำลังทดสอบ...');
      try { const r = await AI.test(); toast('เชื่อมต่อได้: ' + r); } catch (e) { toast('เชื่อมต่อไม่ได้: ' + (e.message || e), true); }
      done();
    };
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
