/* ==========================================================================
   firebase-layer.js — ชั้นเชื่อมต่อข้อมูลของระบบผังจราจรและทางเบี่ยง
   หมวดทางหลวงเชิงเนิน แขวงทางหลวงระยอง

   ใช้ฐานข้อมูล (Firebase) ชุดเดียวกับระบบ "ผู้ควบคุมงานโครงการ" (choengnoen-project)
     - ล็อกอินด้วยชื่อ + รหัสผ่านชุดเดียวกัน (รายชื่อผู้ใช้ใน collection team ใช้ร่วมกัน)
     - ผังทุกแบบเก็บแยกใน collection traffic_plans ไม่ปนกับข้อมูลโครงการ
       (ช่อง kind = 'flood' ผังทางเบี่ยงอุทกภัย / 'safety' ผังติดตั้งสิ่งอำนวยความปลอดภัย)
     - ทุกการเขียนบันทึก activity_log ในคำสั่งเดียวกัน (atomic batch) เหมือนระบบเดิม
     - ต้องวางกฎ firestore.rules ชุดใหม่ (มีส่วน traffic_plans เพิ่ม) ก่อนใช้งานจริง

   มี 2 โหมด
     1) firebase — ใช้งานจริง
     2) demo     — เปิดด้วย ?demo=1 หรือโหลด Firebase ไม่ได้ : เก็บข้อมูลในเบราว์เซอร์เครื่องนี้เท่านั้น
   ========================================================================== */
(function () {
  'use strict';

  // ▼▼▼ ค่าเดียวกับ firebase-layer.js ของระบบผู้ควบคุมงานโครงการ (ใช้ฐานข้อมูลร่วมกัน) ▼▼▼
  const firebaseConfig = {
    apiKey: "AIzaSyCbItTxZa9nbBbmCp0vwzUAvKeMdV--Aok",
    authDomain: "choengnoen-project.firebaseapp.com",
    projectId: "choengnoen-project",
    storageBucket: "choengnoen-project.firebasestorage.app",
    messagingSenderId: "694075265572",
    appId: "1:694075265572:web:14109f2bc45f53285ebeb1"
  };
  // ▲▲▲ ------------------------------------------------------------------------------------ ▲▲▲

  const EMAIL_DOMAIN = 'project.invalid';
  const COL = 'traffic_plans';

  const params = new URLSearchParams(location.search);
  const configured = /^AIza/.test(firebaseConfig.apiKey || '');
  // เปิดไฟล์ตรงจากเครื่อง (file://) ล็อกอิน Firebase ไม่ได้ จึงเข้าโหมดทดลองให้เอง
  const DEMO = params.has('demo') || !configured || typeof firebase === 'undefined' || !/^https?:$/.test(location.protocol);

  const FBL = { mode: DEMO ? 'demo' : 'firebase', user: null, onError: null };
  window.FBL = FBL;

  function thErr(e) {
    const code = (e && e.code) || '';
    const map = {
      'auth/invalid-credential': 'รหัสผ่านไม่ถูกต้อง',
      'auth/wrong-password': 'รหัสผ่านไม่ถูกต้อง',
      'auth/invalid-login-credentials': 'รหัสผ่านไม่ถูกต้อง',
      'auth/user-not-found': 'ไม่พบบัญชีนี้ในระบบ',
      'auth/too-many-requests': 'ลองผิดหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่',
      'auth/network-request-failed': 'เชื่อมต่ออินเทอร์เน็ตไม่ได้ ตรวจสอบสัญญาณแล้วลองใหม่',
      'auth/weak-password': 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร',
      'auth/password-does-not-meet-requirements': 'รหัสผ่านไม่ตรงตามเงื่อนไขความปลอดภัยของระบบ (ยาวอย่างน้อย 8 ตัวอักษร)',
      'auth/requires-recent-login': 'กรุณาออกจากระบบแล้วเข้าสู่ระบบใหม่ก่อนเปลี่ยนรหัสผ่าน',
      'auth/unauthorized-domain': 'โดเมนนี้ยังไม่ได้รับอนุญาตใน Firebase (Authentication → Settings → Authorized domains)',
      'permission-denied': 'ไม่มีสิทธิ์ทำรายการนี้ (ตรวจสอบว่าได้วางกฎ firestore.rules ชุดล่าสุดที่มีส่วน traffic_plans แล้ว)',
      'resource-exhausted': 'เกินโควตาฟรีของ Firestore — รอวันถัดไปแล้วลองใหม่',
      'unavailable': 'เชื่อมต่อฐานข้อมูลไม่ได้ในขณะนี้ กรุณาลองใหม่'
    };
    return map[code] || ((e && e.message) ? e.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ');
  }
  FBL.errorText = thErr;

  function nowIso() { return new Date().toISOString(); }
  function randomId(n) {
    const bytes = crypto.getRandomValues(new Uint8Array(n));
    return Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('').slice(0, n);
  }
  FBL.newId = function () { return Date.now().toString(36) + randomId(6); };
  // Firestore ไม่รับ undefined / NaN / array ซ้อน array — ล้างแบบลึก
  function clean(v) {
    if (v === undefined) return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (Array.isArray(v)) return v.map(clean);
    if (v && typeof v === 'object') {
      const out = {};
      Object.keys(v).forEach(function (k) { if (v[k] !== undefined) out[k] = clean(v[k]); });
      return out;
    }
    return v;
  }
  function stamp(rec, isNew) {
    const r = Object.assign({}, rec);
    r.updatedAt = nowIso(); r.updatedBy = FBL.user ? FBL.user.name : '';
    if (isNew) { r.createdAt = r.createdAt || r.updatedAt; r.createdBy = r.createdBy || r.updatedBy; }
    return r;
  }
  // รหัสผ่านที่ตั้ง/เปลี่ยนใหม่ ต้องยาวอย่างน้อย 8 ตัว (คนที่ใช้รหัสเดิมอยู่ไม่ถูกบังคับ — ตรวจเฉพาะตอนตั้งใหม่)
  const MIN_PASSWORD = 8;
  function requireNewPassword(p) {
    if (String(p || '').length < MIN_PASSWORD) throw new Error('รหัสผ่านต้องยาวอย่างน้อย ' + MIN_PASSWORD + ' ตัวอักษร');
  }
  FBL.minPassword = MIN_PASSWORD;
  function requirePrivileged() { if (!FBL.user || !(FBL.user.isOwner || FBL.user.isAdmin)) throw new Error('เฉพาะเจ้าของระบบหรือผู้ดูแลระบบเท่านั้น'); }
  function sortTeam(t) {
    t.sort(function (a, b) { return (b.isOwner ? 1 : 0) - (a.isOwner ? 1 : 0) || String(a.name).localeCompare(String(b.name), 'th'); });
    return t;
  }

  let team = [];
  FBL.team = function () { return team.slice(); };

  if (DEMO) setupDemo(); else setupFirebase();

  /* ======================================================================
     โหมด Firebase
     ====================================================================== */
  function setupFirebase() {
    firebase.initializeApp(firebaseConfig);
    const auth = firebase.auth();
    const db = firebase.firestore();
    try { db.enablePersistence({ synchronizeTabs: true }).catch(function () { /* ใช้ไม่ได้ก็ข้าม */ }); } catch (e) { /* ข้าม */ }

    /* ---------- สมุดชื่อล็อกอิน (login_directory) — แผน 6 ----------
       หน้าล็อกอินอ่านรายชื่อได้ก่อนล็อกอิน จึงอ่านเฉพาะ ชื่อ → อีเมลสังเคราะห์ (ไม่มีสถานะเจ้าของ/ผู้ดูแล) จากสมุดชื่อ
       เจ้าของระบบเป็นผู้กดย้ายรายชื่อที่ระบบ "ผู้ควบคุมงานโครงการ"/"หนังสือราชการ" (ใช้ฐานข้อมูลชุดเดียวกัน) — ก่อนย้าย ทุกอย่างทำงานแบบเดิม */
    const DIR_READY_ID = '_ready';
    async function readLoginDirectory() {
      const snap = await db.collection('login_directory').get();
      let ready = false;
      const list = [];
      snap.docs.forEach(function (d) {
        if (d.id === DIR_READY_ID) { ready = true; return; }
        const v = d.data();
        if (v && v.name && v.email) list.push({ uid: d.id, name: v.name, email: v.email });
      });
      return { ready: ready, list: list };
    }
    // ก่อนล็อกอิน: อ่านสมุดชื่อ · หลังล็อกอิน: อ่านตาราง team เต็ม
    FBL.loadTeam = async function () {
      let list = null;
      if (!FBL.user) {
        try {
          const dir = await readLoginDirectory();
          if (dir.ready) list = dir.list;
        } catch (e) { /* ยังไม่ได้ประกาศกฎชุดใหม่ — อ่านจาก team แบบเดิม */ }
      }
      if (!list) {
        const snap = await db.collection('team').get();
        list = snap.docs.map(function (d) { return Object.assign({ uid: d.id }, d.data()); });
      }
      team = sortTeam(list);
      return team.slice();
    };

    FBL.onAuth = function (cb) {
      auth.onAuthStateChanged(async function (u) {
        if (!u) { FBL.user = null; cb(null); return; }
        try {
          const d = await db.collection('team').doc(u.uid).get();
          if (!d.exists) {
            FBL.user = null; await auth.signOut();
            cb(null, 'บัญชีนี้ไม่ได้อยู่ในรายชื่อผู้ใช้งาน กรุณาติดต่อเจ้าของระบบ'); return;
          }
          FBL.user = { uid: u.uid, name: d.data().name, isOwner: !!d.data().isOwner, isAdmin: !!d.data().isAdmin };
          try { await FBL.loadTeam(); } catch (e) { /* ข้าม — หน้าเว็บโหลดรายชื่อซ้ำเองอีกครั้ง */ }   // ล็อกอินแล้วอ่านตาราง team เต็มได้ (มีสถานะเจ้าของ/ผู้ดูแล)
          cb(FBL.user);
        } catch (e) { FBL.user = null; cb(null, thErr(e)); }
      });
    };

    FBL.login = async function (name, password) {
      const m = team.find(function (x) { return x.name === String(name || '').trim(); });
      if (!m) throw new Error('ไม่พบชื่อนี้ในระบบ');
      try { await auth.signInWithEmailAndPassword(m.email, password); } catch (e) { throw new Error(thErr(e)); }
    };
    FBL.logout = async function () { if (unsub) unsub(); await auth.signOut(); };

    /* ==== IDLE-GUARD v1 — ออกจากระบบอัตโนมัติเมื่อไม่ได้ใช้งาน + ล้างข้อมูลแคชในเครื่อง (โค้ดชุดเดียวกันทุกระบบ ห้ามแก้เฉพาะระบบ) ====
       - นับเวลาจากเมาส์/แป้นพิมพ์/แตะจอ รวมทุกแท็บของระบบเดียวกัน (แชร์ผ่าน localStorage)
       - เตือนก่อนออก (ไม่ขัดจังหวะ ไม่ดึงโฟกัสจากช่องที่กำลังพิมพ์) แล้วออกจากระบบ: signOut → terminate → clearPersistence → โหลดหน้าใหม่
       - ทดสอบ: ตั้ง localStorage 'fbl_idle_test' = "วินาทีออก,วินาทีเตือน" (ใช้ได้เฉพาะ "ลดเวลา" ลง ไม่ทำให้ยาวขึ้น) */
    (function (FBL, auth, db, pid) {
      var IDLE_MIN = 60, WARN_MIN = 5;
      var idleMs = IDLE_MIN * 60000, warnMs = WARN_MIN * 60000;
      try {
        var tst = String(localStorage.getItem('fbl_idle_test') || '').split(',');
        if (+tst[0] > 0) { idleMs = Math.min(idleMs, +tst[0] * 1000); warnMs = Math.min(warnMs, (+tst[1] > 0 ? +tst[1] : +tst[0] / 3) * 1000, idleMs - 1000); }
      } catch (e) { /* ข้าม */ }
      var K_ACT = 'fbl_idle_act_' + pid, K_OUT = 'fbl_idle_out_' + pid, K_DONE = 'fbl_idle_done_' + pid;
      var lastLocal = 0, lastWrite = 0, warnEl = null, shield = null, leaving = false, inFlight = null, leader = false;

      function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
      function lsGet(k) { try { return +localStorage.getItem(k) || 0; } catch (e) { return 0; } }
      function lsSet(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) { /* ข้าม */ } }
      function lastActive() { return Math.max(lastLocal, lsGet(K_ACT)); }
      function touch() {
        var n = Date.now(); lastLocal = n;
        if (n - lastWrite > 3000) { lastWrite = n; lsSet(K_ACT, n); }
        if (warnEl) hideWarn();
      }
      var staleOnLoad = lsGet(K_ACT) > 0 && Date.now() - lsGet(K_ACT) >= idleMs; // เปิดหน้าขึ้นมาตอนที่ค้างไม่ได้ใช้งานเกินกำหนดแล้ว
      if (!lsGet(K_ACT)) lsSet(K_ACT, Date.now()); // ครั้งแรกที่ใช้ระบบนี้ในเครื่อง — ยังไม่มีบันทึก ถือว่าเริ่มนับจากตอนนี้

      /* ---------- กล่องเตือน ---------- */
      function dirtyCount() {
        var n = 0;
        try {
          var els = document.querySelectorAll('input:not([type=password]):not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]),textarea');
          for (var i = 0; i < els.length; i++) { var el = els[i]; if (el.offsetParent !== null && !el.readOnly && !el.disabled && el.value !== el.defaultValue) n++; }
        } catch (e) { /* ข้าม */ }
        return n;
      }
      function fmt(ms) { var s = Math.max(0, Math.ceil(ms / 1000)), m = Math.floor(s / 60); return m + ':' + ('0' + (s % 60)).slice(-2); }
      function showWarn(left) {
        if (!warnEl) {
          warnEl = document.createElement('div');
          warnEl.setAttribute('role', 'alert');
          warnEl.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483000;max-width:340px;background:#fff8e1;color:#4a3300;border:2px solid #f59e0b;border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.35);padding:14px 16px;font:14px/1.5 system-ui,"Sarabun","Noto Sans Thai",sans-serif';
          warnEl.innerHTML = '<div style="font-weight:700;margin-bottom:4px">⏱ ไม่มีการใช้งานสักครู่</div>' +
            '<div>ระบบจะออกจากระบบอัตโนมัติใน <b data-idle-left></b> เพื่อความปลอดภัยของข้อมูล</div>' +
            '<div data-idle-dirty style="display:none;margin-top:6px;color:#b45309;font-weight:600"></div>' +
            '<button type="button" data-idle-stay style="margin-top:10px;width:100%;padding:8px;border:0;border-radius:8px;background:#f59e0b;color:#fff;font:inherit;font-weight:700;cursor:pointer">ยังใช้งานอยู่ — อยู่ต่อ</button>';
          warnEl.querySelector('[data-idle-stay]').onclick = function () { touch(); };
          // ไม่ดึงโฟกัสออกจากช่องที่กำลังพิมพ์: กดปุ่มนี้ด้วยเมาส์ไม่ย้ายโฟกัส
          warnEl.addEventListener('mousedown', function (e) { e.preventDefault(); });
          (document.body || document.documentElement).appendChild(warnEl);
        }
        warnEl.querySelector('[data-idle-left]').textContent = fmt(left);
        var d = dirtyCount(), dEl = warnEl.querySelector('[data-idle-dirty]');
        if (d > 0) { dEl.style.display = 'block'; dEl.textContent = 'อาจมีข้อมูลที่กรอกค้างอยู่ ' + d + ' ช่อง — กดบันทึกก่อนครบเวลา ไม่เช่นนั้นข้อมูลจะหาย'; }
        else dEl.style.display = 'none';
      }
      function hideWarn() { if (warnEl) { warnEl.remove(); warnEl = null; } }
      function showShield() {
        if (shield) return;
        shield = document.createElement('div');
        shield.style.cssText = 'position:fixed;inset:0;z-index:2147483600;background:#0b2540;color:#fff;display:flex;align-items:center;justify-content:center;font:600 18px system-ui,"Sarabun","Noto Sans Thai",sans-serif';
        shield.textContent = 'กำลังออกจากระบบและล้างข้อมูลในเครื่อง...';
        (document.body || document.documentElement).appendChild(shield);
      }

      /* ---------- ออกจากระบบ + ล้างแคช ---------- */
      async function wipe() {
        try { await db.terminate(); } catch (e) { /* ข้าม */ }
        for (var i = 0; i < 8; i++) {
          try { await db.clearPersistence(); return true; } catch (e) { await sleep(500); }
        }
        console.warn('ล้างแคชในเครื่องไม่สำเร็จ (อาจมีแท็บอื่นเปิดระบบนี้ค้างอยู่)');
        return false;
      }
      var origLogout = FBL.logout;
      FBL.logout = function () {
        if (inFlight) return inFlight;
        var args = arguments;
        leaving = true; leader = true; FBL._leaving = true;
        hideWarn(); showShield();
        inFlight = (async function () {
          setTimeout(function () { location.reload(); }, 25000); // กันค้าง
          lsSet(K_OUT, Date.now());                    // บอกแท็บอื่นของระบบนี้ให้ปิดฐานข้อมูล (ไม่งั้นล้างแคชไม่ได้)
          // ส่งข้อมูลที่ค้างรอส่งขึ้นเซิร์ฟเวอร์ให้เสร็จก่อน ไม่งั้นการล้างแคชจะทำให้ข้อมูลที่เพิ่งบันทึกตอนออฟไลน์หาย
          try { await Promise.race([db.waitForPendingWrites(), sleep(5000)]); } catch (e) { /* ข้าม */ }
          try { await origLogout.apply(FBL, args); } catch (e) { /* ข้าม */ }
          try { await auth.signOut(); } catch (e) { /* ข้าม */ }
          await wipe();
          lsSet(K_DONE, Date.now());
          location.reload();
          await new Promise(function () { });          // ไม่ให้โค้ดหลังปุ่มออกจากระบบทำงานต่อระหว่างโหลดหน้าใหม่
        })();
        return inFlight;
      };

      // แท็บอื่นของระบบเดียวกัน: ปิดฐานข้อมูลแล้วรอแท็บที่กดออกล้างเสร็จ จึงโหลดใหม่
      window.addEventListener('storage', function (e) {
        if (e.key === K_OUT && e.newValue && !leader && !leaving) {
          leaving = true; FBL._leaving = true; showShield();
          try { db.terminate().catch(function () { }); } catch (x) { /* ข้าม */ }
          setTimeout(function () { location.reload(); }, 15000);
        } else if (e.key === K_DONE && e.newValue && !leader && leaving) {
          location.reload();
        }
      });

      /* ---------- นับเวลาไม่ใช้งาน ---------- */
      ['mousemove', 'mousedown', 'pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll', 'click'].forEach(function (t) {
        window.addEventListener(t, touch, { passive: true, capture: true });
      });
      // เหตุการณ์ล็อกอินครั้งแรกหลังเปิดหน้า: ถ้าเป็นเซสชันเก่าที่ค้างมานานเกินกำหนด ให้ออกจากระบบทันที (ไม่ให้แค่ขยับเมาส์แล้วเข้าได้เลย)
      auth.onAuthStateChanged(function (u) { if (u && staleOnLoad && !leaving) FBL.logout(); staleOnLoad = false; });
      function tick() {
        if (leaving || !auth.currentUser) { if (!auth.currentUser) hideWarn(); return; }
        var idle = Date.now() - lastActive();
        if (idle >= idleMs) FBL.logout();
        else if (idle >= idleMs - warnMs) showWarn(idleMs - idle);
        else if (warnEl) hideWarn();
      }
      setInterval(tick, 1000);
      document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });
    })(FBL, auth, db, firebaseConfig.projectId);
    FBL.changeMyPassword = async function (pw) {
      requireNewPassword(pw);
      try { await auth.currentUser.updatePassword(pw); } catch (e) { throw new Error(thErr(e)); }
    };

    let unsub = null;
    FBL.watchPlans = function (onChange) {
      return new Promise(function (resolve) {
        let first = true;
        unsub = db.collection(COL).onSnapshot(function (snap) {
          const docs = snap.docs.map(function (d) { return Object.assign({}, d.data(), { id: d.id }); });
          if (first) { first = false; resolve(docs); } else if (onChange) onChange(docs);
        }, function (err) {
          if (FBL.onError) FBL.onError(thErr(err));
          if (first) { first = false; resolve([]); }
        });
      });
    };

    function logEntry(action, target, summary) {
      return {
        ts: firebase.firestore.FieldValue.serverTimestamp(),
        actorName: FBL.user ? FBL.user.name : '', actorUid: FBL.user ? FBL.user.uid : '',
        action: action, target: target, summary: String(summary || '').slice(0, 300)
      };
    }
    FBL.savePlan = async function (p) {
      const isNew = !p.id;
      const id = p.id || FBL.newId();
      const batch = db.batch();
      batch.set(db.collection(COL).doc(id), clean(stamp(Object.assign({}, p, { id: id }), isNew)));
      batch.set(db.collection('activity_log').doc(), logEntry(isNew ? 'add' : 'update', COL + '/' + id, p.title));
      try { await batch.commit(); } catch (e) { throw new Error(thErr(e)); }
      return id;
    };
    FBL.softDeletePlan = async function (p, restore) {
      const batch = db.batch();
      batch.update(db.collection(COL).doc(p.id), restore ? { deletedAt: null, deletedBy: '' } : { deletedAt: nowIso(), deletedBy: FBL.user ? FBL.user.name : '' });
      batch.set(db.collection('activity_log').doc(), logEntry(restore ? 'restore' : 'delete', COL + '/' + p.id, p.title));
      try { await batch.commit(); } catch (e) { throw new Error(thErr(e)); }
    };
    FBL.hardDeletePlan = async function (p) {
      requirePrivileged();
      const batch = db.batch();
      batch.delete(db.collection(COL).doc(p.id));
      batch.set(db.collection('activity_log').doc(), logEntry('permanentDelete', COL + '/' + p.id, p.title));
      try { await batch.commit(); } catch (e) { throw new Error(thErr(e)); }
    };
  }

  /* ======================================================================
     โหมดทดลอง — เก็บในเบราว์เซอร์เครื่องนี้ (localStorage)
     ====================================================================== */
  function setupDemo() {
    const KEY = 'fdp_demo_v1';
    function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
    const S = load();
    S.team = S.team || []; S.plans = S.plans || {};
    function persist() {
      try { localStorage.setItem(KEY, JSON.stringify(S)); }
      catch (e) { if (FBL.onError) FBL.onError('พื้นที่เก็บข้อมูลในเบราว์เซอร์เต็ม (โหมดทดลอง)'); }
    }
    async function hash(s) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('fdp|' + s));
      return Array.from(new Uint8Array(buf)).map(function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    }
    let listener = null, authCb = null;
    function list() { return Object.keys(S.plans).map(function (id) { return JSON.parse(JSON.stringify(S.plans[id])); }); }
    function emit() { if (listener) setTimeout(function () { listener(list()); }, 0); }

    FBL.loadTeam = async function () { team = sortTeam(S.team.map(function (t) { return Object.assign({}, t); })); return team.slice(); };
    FBL.onAuth = function (cb) {
      authCb = cb;
      let uid = null; try { uid = sessionStorage.getItem('fdp_demo_uid'); } catch (e) { /* ข้าม */ }
      const m = uid && S.team.find(function (t) { return t.uid === uid; });
      if (m) { FBL.user = { uid: m.uid, name: m.name, isOwner: !!m.isOwner, isAdmin: !!m.isAdmin }; cb(FBL.user); }
      else cb(null);
    };
    FBL.login = async function (name, password) {
      const m = S.team.find(function (t) { return t.name === name; });
      if (!m) throw new Error('ไม่พบชื่อนี้ในระบบ');
      if (m.pw !== await hash(password)) throw new Error('รหัสผ่านไม่ถูกต้อง');
      try { sessionStorage.setItem('fdp_demo_uid', m.uid); } catch (e) { /* ข้าม */ }
      FBL.user = { uid: m.uid, name: m.name, isOwner: !!m.isOwner, isAdmin: !!m.isAdmin };
      if (authCb) authCb(FBL.user);
    };
    FBL.logout = async function () { try { sessionStorage.removeItem('fdp_demo_uid'); } catch (e) { /* ข้าม */ } FBL.user = null; };
    // โหมดทดลองเท่านั้น: ฐานข้อมูลจริงใช้รายชื่อผู้ใช้ของระบบผู้ควบคุมงานโครงการ (เพิ่มคนที่ระบบนั้น)
    FBL.bootstrapOwner = async function (name, password) {
      name = String(name || '').trim();
      if (!name) throw new Error('กรอกชื่อ-นามสกุลก่อน');
      if (S.team.length) throw new Error('ตั้งเจ้าของระบบไปแล้ว');
      const m = { uid: 'u-' + randomId(8), name: name, isOwner: true, isAdmin: false, pw: await hash(password), createdAt: nowIso() };
      S.team.push(m); persist();
      try { sessionStorage.setItem('fdp_demo_uid', m.uid); } catch (e) { /* ข้าม */ }
      FBL.user = { uid: m.uid, name: name, isOwner: true, isAdmin: false };
      team = [Object.assign({}, m)];
      return FBL.user;
    };
    FBL.changeMyPassword = async function (pw) {
      const m = S.team.find(function (t) { return FBL.user && t.uid === FBL.user.uid; });
      if (m) { m.pw = await hash(pw); persist(); }
    };
    FBL.watchPlans = function (onChange) { listener = onChange; return Promise.resolve(list()); };
    FBL.savePlan = async function (p) {
      const isNew = !p.id; const id = p.id || FBL.newId();
      S.plans[id] = clean(stamp(Object.assign({}, p, { id: id }), isNew));
      persist(); emit();
      return id;
    };
    FBL.softDeletePlan = async function (p, restore) {
      const r = S.plans[p.id];
      if (r) { r.deletedAt = restore ? null : nowIso(); r.deletedBy = restore ? '' : (FBL.user ? FBL.user.name : ''); persist(); emit(); }
    };
    FBL.hardDeletePlan = async function (p) { requirePrivileged(); delete S.plans[p.id]; persist(); emit(); };
    FBL.resetDemo = function () { localStorage.removeItem(KEY); try { sessionStorage.removeItem('fdp_demo_uid'); } catch (e) { /* ข้าม */ } };
  }
})();
