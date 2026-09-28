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
      'auth/weak-password': 'รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร',
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

    FBL.loadTeam = async function () {
      const snap = await db.collection('team').get();
      team = sortTeam(snap.docs.map(function (d) { return Object.assign({ uid: d.id }, d.data()); }));
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
    FBL.changeMyPassword = async function (pw) {
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
