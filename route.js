/* ==========================================================================
   route.js — คำนวณเส้นทางตามถนน (OSRM สาธารณะ) + หาทางเบี่ยงอัตโนมัติ
   - เส้นน้ำท่วม: ลากตามถนนจากจุดเริ่มถึงจุดสิ้นสุด (ลองทั้งสองทิศ กันถนนแบ่งทิศทางพาไปกลับรถ)
   - ทางเบี่ยง: หาเส้นจากแยกออกถึงแยกกลับเข้าที่ "ไม่ผ่านช่วงน้ำท่วม" เอง
       1) ขอเส้นทางหลักและเส้นทางสำรองจาก OSRM แล้วเลือกเส้นที่ไม่ทับช่วงน้ำท่วมและสั้นที่สุด
       2) ถ้าทุกเส้นทับ ลองบังคับให้อ้อมผ่านจุดทางซ้าย/ขวาของช่วงน้ำท่วม ห่างออกไปทีละระยะ
   - ตัดเส้น "ไปแล้ววนกลับทางเดิม" (ติ่ง) ที่เกิดจากจุดบังคับที่อยู่ในซอยตัน
   ========================================================================== */
(function () {
  'use strict';
  const OSRM = 'https://router.project-osrm.org/route/v1/driving/';
  const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  /* ---------- เรขาคณิตแบบระยะใกล้ (เมตร) ---------- */
  function metric(lat0) {
    const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
    return {
      xy: function (p) { return [p.lng * kx, p.lat * ky]; },
      ll: function (x, y) { return { lat: y / ky, lng: x / kx }; }
    };
  }
  function dist(a, b) {
    const m = metric((a.lat + b.lat) / 2), p = m.xy(a), q = m.xy(b);
    return Math.hypot(p[0] - q[0], p[1] - q[1]);
  }
  function length(pts) { let s = 0; for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]); return s; }
  function segDist(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
    let t = L ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  }
  // จุดบนเส้นทุก ๆ step เมตร
  function sample(pts, step) {
    const out = [pts[0]];
    let cum = 0, next = step;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], d = dist(a, b);
      while (d > 0 && next <= cum + d) {
        const r = (next - cum) / d;
        out.push({ lat: a.lat + (b.lat - a.lat) * r, lng: a.lng + (b.lng - a.lng) * r });
        next += step;
      }
      cum += d;
    }
    out.push(pts[pts.length - 1]);
    return out;
  }
  // สัดส่วนของช่วงน้ำท่วมที่ถูกเส้นทางทับ (0–1)
  function overlap(floodPts, routePts) {
    if (!floodPts || floodPts.length < 2 || !routePts || routePts.length < 2) return 0;
    const m = metric(floodPts[0].lat);
    const R = routePts.map(m.xy);
    const S = sample(floodPts, 30).map(m.xy);
    let hit = 0;
    S.forEach(function (p) {
      for (let i = 1; i < R.length; i++) { if (segDist(p, R[i - 1], R[i]) < 35) { hit++; return; } }
    });
    return hit / S.length;
  }
  // ตัดเส้นที่วิ่งไปแล้ววนกลับทางเดิม
  function removeSpurs(pts) {
    const st = [];
    pts.forEach(function (p) {
      if (st.length >= 2 && dist(p, st[st.length - 2]) < 3) st.pop();
      else if (!st.length || dist(p, st[st.length - 1]) > 0.5) st.push(p);
    });
    return st;
  }

  /* ---------- OSRM ---------- */
  let last = 0;
  async function osrm(pts, alternatives) {
    const wait = 350 - (Date.now() - last);   // ถนอมเซิร์ฟเวอร์สาธารณะ
    if (wait > 0) await sleep(wait);
    last = Date.now();
    const coords = pts.map(function (p) { return (+p.lng).toFixed(6) + ',' + (+p.lat).toFixed(6); }).join(';');
    let res;
    try {
      res = await fetch(OSRM + coords + '?overview=full&geometries=geojson' + (alternatives ? '&alternatives=' + alternatives : ''));
    } catch (e) { throw new Error('เชื่อมต่อบริการคำนวณเส้นทางไม่ได้ (ตรวจสอบอินเทอร์เน็ต)'); }
    const data = await res.json();
    if (data.code !== 'Ok' || !data.routes || !data.routes.length) throw new Error(data.message || 'หาเส้นทางตามถนนไม่พบ');
    return data.routes.map(function (r) {
      const line = removeSpurs(r.geometry.coordinates.map(function (c) { return { lat: c[1], lng: c[0] }; }));
      return { pts: line, distance: length(line), waypoints: (data.waypoints || []).map(function (w) { return { lat: w.location[1], lng: w.location[0] }; }) };
    });
  }

  // เส้นทางผ่านทุกจุดตามลำดับ · 2 จุดลองทั้งสองทิศ เลือกเส้นที่สั้นกว่า
  async function route(pts) {
    const a = (await osrm(pts))[0];
    if (pts.length === 2) {
      try {
        const b = (await osrm([pts[1], pts[0]]))[0];
        if (b.distance < a.distance * 0.8) return { pts: b.pts.slice().reverse(), distance: b.distance, waypoints: a.waypoints };
      } catch (e) { /* ใช้ทิศแรก */ }
    }
    return a;
  }

  // หาทางเบี่ยงที่ไม่ผ่านช่วงน้ำท่วม: คืน { pts, distance, via:[จุดบังคับ], overlap, warn }
  async function autoDetour(A, B, floodPts, progress) {
    const say = progress || function () {};
    const OK = 0.08;
    say('กำลังหาเส้นทางเบี่ยง (เส้นทางหลักและเส้นทางสำรอง)...');
    let cands = (await osrm([A, B], 3)).map(function (r) { return { pts: r.pts, distance: r.distance, via: [], overlap: overlap(floodPts, r.pts) }; });
    let good = cands.filter(function (c) { return c.overlap < OK; });
    if (!good.length && floodPts && floodPts.length > 1) {
      const m = metric(floodPts[0].lat);
      const f0 = m.xy(floodPts[0]), f1 = m.xy(floodPts[floodPts.length - 1]);
      const mid = m.xy(floodPts[Math.floor(floodPts.length / 2)]);
      const L = Math.hypot(f1[0] - f0[0], f1[1] - f0[1]) || 1;
      const n = [-(f1[1] - f0[1]) / L, (f1[0] - f0[0]) / L];   // ตั้งฉากกับแนวน้ำท่วม
      const dists = [1500, 3000, 5000, 8000];
      for (let i = 0; i < dists.length && !good.length; i++) {
        for (const s of [1, -1]) {
          say('ลองอ้อมห่างจากจุดน้ำท่วม ' + (dists[i] / 1000) + ' กม. (' + (s > 0 ? 'ด้านที่ 1' : 'ด้านที่ 2') + ')...');
          const v = m.ll(mid[0] + s * dists[i] * n[0], mid[1] + s * dists[i] * n[1]);
          try {
            const r = (await osrm([A, v, B]))[0];
            const c = { pts: r.pts, distance: r.distance, via: [r.waypoints[1] || v], overlap: overlap(floodPts, r.pts) };
            cands.push(c);
            if (c.overlap < OK) good.push(c);
          } catch (e) { /* จุดนี้ไม่มีถนน ข้าม */ }
        }
      }
    }
    const pool = good.length ? good : cands;
    pool.sort(function (a, b) { return a.distance - b.distance; });
    const best = pool[0];
    if (!good.length) best.warn = 'ทุกเส้นทางที่หาได้ยังผ่านช่วงน้ำท่วม — กรุณาลากจุดปรับเส้นเองบนผัง';
    return best;
  }

  /* ---------- เก็บเส้นแบบย่อ (Encoded Polyline) — Firestore ไม่รับ array ซ้อน array ---------- */
  function encode(pts) {
    let out = '', pl = 0, pg = 0;
    function enc(v) {
      v = v < 0 ? ~(v << 1) : v << 1;
      let s = '';
      while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; }
      return s + String.fromCharCode(v + 63);
    }
    pts.forEach(function (p) {
      const la = Math.round(p.lat * 1e5), lg = Math.round(p.lng * 1e5);
      out += enc(la - pl) + enc(lg - pg); pl = la; pg = lg;
    });
    return out;
  }
  function decode(str) {
    const pts = []; let i = 0, la = 0, lg = 0;
    function dec() {
      let r = 0, sh = 0, b;
      do { b = str.charCodeAt(i++) - 63; r |= (b & 0x1f) << sh; sh += 5; } while (b >= 0x20);
      return (r & 1) ? ~(r >> 1) : (r >> 1);
    }
    while (i < (str || '').length) { la += dec(); lg += dec(); pts.push({ lat: la / 1e5, lng: lg / 1e5 }); }
    return pts;
  }

  /* ======================================================================
     ผังติดตั้งสิ่งอำนวยความปลอดภัย — จัดวางป้าย/อุปกรณ์อัตโนมัติ
     ใช้หลักทั่วไปของการควบคุมการจราจรในเขตงาน (ปรับตำแหน่งเองได้ทุกชิ้น)
       ระยะป้ายเตือนล่วงหน้าตามความเร็ว · ความยาวช่วงเบี่ยงกรวย (taper)
         ≥ 70 กม./ชม.: L = W × V / 1.6   · < 70 กม./ชม.: L = W × V² / 256   (W = ความกว้างช่องจราจร 3.5 ม.)
     ** ค่าเริ่มต้นเพื่อช่วยร่างผัง ต้องตรวจกับมาตรฐาน/คู่มือของกรมทางหลวงก่อนใช้งานจริง **
     ====================================================================== */
  const LANE = 3.5;
  function signDistances(v) { return v >= 90 ? [800, 400, 200] : v >= 70 ? [500, 300, 150] : [300, 200, 100]; }
  function taperLength(v) { const L = v >= 70 ? LANE * v / 1.6 : LANE * v * v / 256; return Math.round(Math.max(30, Math.min(250, L))); }
  // ตำแหน่งบนเส้นที่ระยะ d จากจุดแรก + ทิศทางเดินรถ (หน่วยเวกเตอร์ในระบบเมตร)
  function along(pts, d, m) {
    let cum = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = m.xy(pts[i - 1]), b = m.xy(pts[i]), L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L > 0 && cum + L >= d) {
        const r = (d - cum) / L;
        return { xy: [a[0] + (b[0] - a[0]) * r, a[1] + (b[1] - a[1]) * r], dir: [(b[0] - a[0]) / L, (b[1] - a[1]) / L] };
      }
      cum += L;
    }
    const n = pts.length, a = m.xy(pts[n - 2] || pts[0]), b = m.xy(pts[n - 1]), L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const dir = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    return { xy: [b[0] + dir[0] * (d - cum), b[1] + dir[1] * (d - cum)], dir: dir };
  }
  // ย้ายออกด้านข้าง: lat > 0 = ซ้ายของทิศเดินรถ
  function side(pos, lat, m) { return m.ll(pos.xy[0] - pos.dir[1] * lat, pos.xy[1] + pos.dir[0] * lat); }
  function fix(p) { return { lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6) }; }

  // เส้นถนนก่อนถึงจุด a (ทางที่รถวิ่งเข้ามา) ความยาวประมาณ len เมตร เรียงจาก a ย้อนออกไป
  async function approachFrom(zonePts, len) {
    const m = metric(zonePts[0].lat);
    const h = along(zonePts, 30, m);
    const a = m.xy(zonePts[0]);
    const up = m.ll(a[0] - h.dir[0] * len, a[1] - h.dir[1] * len);
    try {
      const r = await route([up, zonePts[0]]);
      return r.pts.slice().reverse();
    } catch (e) { return [zonePts[0], up]; }
  }

  async function layoutSafety(o, progress) {
    const say = progress || function () {};
    const Z = o.zonePts, v = +o.speed || 80, work = o.workType || 'งานก่อสร้าง';
    const m = metric(Z[0].lat);
    const D = signDistances(v), T = taperLength(v);
    const s = o.side === 'right' ? -1 : 1;          // ช่องที่ปิด: +1 ซ้าย (ชิดขอบทาง) / -1 ขวา (ชิดเกาะกลาง)
    const EDGE = LANE + 3;                           // ป้ายตั้งริมทางซ้าย
    const devs = [];
    const add = function (t, p, text) { devs.push(Object.assign({ t: t }, fix(p), text ? { text: text } : {})); };

    say('กำลังหาแนวถนนก่อนเข้าเขตงาน...');
    const back = await approachFrom(Z, D[0] + T + 150);   // เริ่มที่จุด a ย้อนไปทางรถวิ่งเข้ามา
    const at = function (d) { const p = along(back, d, m); p.dir = [-p.dir[0], -p.dir[1]]; return p; };   // ทิศเดินรถจริง

    // ป้ายเตือนล่วงหน้า
    add('sign', side(at(D[0] + T), EDGE, m), work + 'ข้างหน้า ' + D[0] + ' ม.');
    add('speed', side(at(D[1] + T), EDGE, m), String(Math.max(30, Math.round((v - 30) / 10) * 10)));
    add('sign', side(at(D[2] + T), EDGE, m), 'ช่องจราจร' + (s > 0 ? 'ซ้าย' : 'ขวา') + 'ปิด');
    add('arrow', side(at(T + 20), s * LANE * 0.5, m), s > 0 ? 'ชิดขวา' : 'ชิดซ้าย');
    if (/อุบัติเหตุ/.test(work) || o.both) add('flag', side(at(D[2] + T - 40), EDGE - 1, m));

    // ช่วงเบี่ยงกรวย: จากขอบนอกของช่องที่ปิด ค่อย ๆ เข้าหาเส้นแบ่งช่องจราจรที่จุด a
    const step = v >= 70 ? 15 : 10, n = Math.max(3, Math.ceil(T / step));
    for (let j = 0; j <= n; j++) {
      const d = T * (1 - j / n);
      add('cone', side(at(d), s * LANE * (d / T), m));
    }
    add('light', side(at(T), s * LANE, m));

    // เขตงาน: แผงกั้นต้นทาง + กรวยตามแนวเส้นแบ่งช่องจราจร + ไฟกระพริบ
    const zl = length(Z);
    add('barrier', side(along(Z, 8, m), s * LANE * 0.5, m));
    add('light', side(along(Z, 2, m), s * LANE * 0.9, m));
    const cs = Math.max(25, Math.ceil(zl / 60));
    for (let d = cs; d < zl - 5; d += cs) add('cone', side(along(Z, d, m), 0, m));
    add('barrier', side(along(Z, Math.max(0, zl - 5), m), s * LANE * 0.5, m));
    add('light', side(along(Z, zl, m), s * LANE * 0.9, m));

    // สิ้นสุดเขตงาน (หลังจุด b ประมาณ 100 ม.)
    add('end', side(along(Z, zl + 100, m), EDGE, m), 'สิ้นสุดเขต' + work);

    // ถนน 2 ช่องจราจรสวนกัน: รถฝั่งตรงข้ามเข้ามาจากด้านจุด b
    if (o.both) {
      say('กำลังวางป้ายสำหรับรถฝั่งตรงข้าม...');
      const Zr = Z.slice().reverse();
      const backR = await approachFrom(Zr, D[0] + 150);
      const atR = function (d) { const p = along(backR, d, m); p.dir = [-p.dir[0], -p.dir[1]]; return p; };
      add('sign', side(atR(D[0]), EDGE, m), work + 'ข้างหน้า ' + D[0] + ' ม.');
      add('speed', side(atR(D[1]), EDGE, m), String(Math.max(30, Math.round((v - 30) / 10) * 10)));
      add('sign', side(atR(D[2]), EDGE, m), 'ทางแคบ ผ่านทีละทิศทาง');
      add('flag', side(atR(40), EDGE - 1, m));
      add('end', side(along(Zr, zl + 100, m), EDGE, m), 'สิ้นสุดเขต' + work);
    }
    return { devices: devs, taper: T, signDist: D };
  }

  /* ======================================================================
     ผังแนวทางระบายน้ำ — น้ำจากจุดนี้ไหลไปทางไหน ลงที่ใด
       1) ความสูงพื้นดินจากแผ่นข้อมูลความสูง Terrarium (AWS Open Data, ข้อมูล SRTM ความละเอียดราว 30 ม.)
       2) ไล่จากจุดเริ่มไปยังจุดที่ต่ำกว่าเรื่อย ๆ (ทางลาดชันที่สุด) ถ้าพื้นราบให้มองไกลขึ้น
       3) หาคลอง/ลำราง/แหล่งน้ำจาก OpenStreetMap (Overpass) — เส้นไหลถึงทางน้ำแห่งแรก = จุดระบายออก
     ** ข้อมูลความสูงไม่ละเอียดพอสำหรับงานออกแบบ ใช้ช่วยวางแนวเบื้องต้น ต้องสำรวจระดับจริงในพื้นที่ **
     ====================================================================== */
  const DEM_Z = 15, TILE = 256;
  const demCache = {};
  function demTile(x, y) {
    const k = x + '/' + y;
    if (!demCache[k]) demCache[k] = new Promise(function (resolve) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () {
        const c = document.createElement('canvas'); c.width = c.height = TILE;
        const g = c.getContext('2d'); g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, TILE, TILE).data, e = new Float32Array(TILE * TILE);
        for (let i = 0; i < e.length; i++) e[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
        resolve(e);
      };
      img.onerror = function () { resolve(null); };
      img.src = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/' + DEM_Z + '/' + x + '/' + y + '.png';
    });
    return demCache[k];
  }
  // พิกัด → พิกเซลรวมของระดับซูม DEM_Z
  function toPix(p) {
    const n = TILE * Math.pow(2, DEM_Z), s = Math.sin(p.lat * Math.PI / 180);
    return [(p.lng + 180) / 360 * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
  }
  function toLL(x, y) {
    const n = TILE * Math.pow(2, DEM_Z);
    return { lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI, lng: x / n * 360 - 180 };
  }
  async function elevAt(x, y) {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE), e = await demTile(tx, ty);
    if (!e) return null;
    const ix = Math.min(TILE - 1, Math.max(0, Math.floor(x - tx * TILE))), iy = Math.min(TILE - 1, Math.max(0, Math.floor(y - ty * TILE)));
    return e[iy * TILE + ix];
  }
  async function elevation(p) { const q = toPix(p); return elevAt(q[0], q[1]); }

  async function waterways(bounds) {
    const bb = [bounds.s, bounds.w, bounds.n, bounds.e].map(function (v) { return v.toFixed(5); }).join(',');
    // ทางน้ำ + แหล่งน้ำ + แนวชายฝั่งทะเล (ตัดเส้นให้อยู่ในกรอบค้นหา)
    const ql = '[out:json][timeout:25];(way["waterway"~"river|stream|canal|drain|ditch"](' + bb + ');way["natural"="water"](' + bb + ');way["natural"="coastline"](' + bb + '););out geom(' + bb + ');';
    const res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(ql), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    if (!res.ok) throw new Error('ดึงข้อมูลทางน้ำไม่สำเร็จ (' + res.status + ')');
    const j = await res.json();
    const kindName = { river: 'แม่น้ำ', stream: 'ลำห้วย', canal: 'คลอง', drain: 'รางระบายน้ำ', ditch: 'คูระบายน้ำ' };
    return (j.elements || []).map(function (w) {
      const t = w.tags || {};
      const kind = t.waterway ? (kindName[t.waterway] || 'ทางน้ำ') : t.natural === 'coastline' ? 'ทะเล' : 'แหล่งน้ำ';
      const pts = (w.geometry || []).filter(Boolean).map(function (g) { return { lat: g.lat, lng: g.lon }; });
      return { name: t['name:th'] || t.name || (kind === 'ทะเล' ? 'ทะเล (แนวชายฝั่ง)' : kind + 'ไม่ทราบชื่อ'), kind: kind, pts: pts };
    }).filter(function (w) { return w.pts.length > 1; });
  }

  /* ---------- หาแนวน้ำไหลแบบ "เติมแอ่งแล้วล้น" (priority flood) ----------
     น้ำจะไหลไปที่ต่ำที่สุดที่ไปถึงได้ ถ้าเจอแอ่งจะขังจนเต็มแล้วล้นออกทางขอบที่ต่ำที่สุด
     ค้นในตารางขนาดช่องละ ~28 ม. รัศมี ~3 กม. จนกว่าจะถึงช่องที่เป็นทางน้ำ/แหล่งน้ำ/ทะเล */
  function Heap() { this.a = []; }
  Heap.prototype.push = function (x) {
    const a = this.a; a.push(x); let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; const t = a[p]; a[p] = a[i]; a[i] = t; i = p; }
  };
  Heap.prototype.pop = function () {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; const t = a[m]; a[m] = a[i]; a[i] = t; i = m; }
    }
    return top;
  };
  async function floodPath(src, ways, say) {
    const CELL = 6, RADIUS_M = 3000;
    const s = toPix(src);
    const mpp = 156543.03 * Math.cos(src.lat * Math.PI / 180) / Math.pow(2, DEM_Z);
    const R = Math.ceil(RADIUS_M / (CELL * mpp));
    // โหลดแผ่นข้อมูลความสูงทั้งพื้นที่ไว้ก่อน แล้วอ่านแบบไม่ต้องรอ
    const t0x = Math.floor((s[0] - R * CELL) / TILE), t1x = Math.floor((s[0] + R * CELL) / TILE);
    const t0y = Math.floor((s[1] - R * CELL) / TILE), t1y = Math.floor((s[1] + R * CELL) / TILE);
    const tiles = {};
    const jobs = [];
    for (let x = t0x; x <= t1x; x++) for (let y = t0y; y <= t1y; y++) jobs.push(demTile(x, y).then(function (e) { tiles[x + '/' + y] = e; }));
    say('กำลังโหลดข้อมูลความสูงพื้นดิน (' + jobs.length + ' แผ่น)...');
    await Promise.all(jobs);
    function elev(i, j) {
      const x = s[0] + i * CELL, y = s[1] + j * CELL, tx = Math.floor(x / TILE), ty = Math.floor(y / TILE), e = tiles[tx + '/' + ty];
      if (!e) return null;
      return e[Math.min(TILE - 1, Math.floor(y - ty * TILE)) * TILE + Math.min(TILE - 1, Math.floor(x - tx * TILE))];
    }
    // ช่องที่เป็นน้ำ
    const water = {};
    ways.forEach(function (w, wi) {
      for (let k = 1; k < w.pts.length; k++) {
        const a = toPix(w.pts[k - 1]), b = toPix(w.pts[k]), n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2));
        for (let q = 0; q <= n; q++) {
          const i = Math.round((a[0] + (b[0] - a[0]) * q / n - s[0]) / CELL), j = Math.round((a[1] + (b[1] - a[1]) * q / n - s[1]) / CELL);
          if (Math.abs(i) <= R && Math.abs(j) <= R) water[i + ',' + j] = wi;
        }
      }
    });
    say('กำลังจำลองทางน้ำไหล...');
    const heap = new Heap(), parent = {}, seen = {};
    const e0 = elev(0, 0);
    if (e0 == null) throw new Error('โหลดข้อมูลความสูงพื้นดินไม่ได้ (ตรวจสอบอินเทอร์เน็ต)');
    heap.push([e0, 0, 0]); seen['0,0'] = 1;
    let hit = null, n = 0;
    while (heap.a.length && n < 90000) {
      const c = heap.pop(); n++;
      const key = c[1] + ',' + c[2];
      if (water[key] !== undefined && key !== '0,0') { hit = { key: key, wi: water[key] }; break; }
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        if (!di && !dj) continue;
        const i = c[1] + di, j = c[2] + dj, k = i + ',' + j;
        if (seen[k] || Math.abs(i) > R || Math.abs(j) > R) continue;
        const e = elev(i, j);
        if (e == null) continue;
        seen[k] = 1; parent[k] = key;
        heap.push([Math.max(e, c[0]) + (di && dj ? 0.0001 : 0), i, j]);
      }
    }
    if (!hit) return null;
    const cells = [];
    for (let k = hit.key; k; k = parent[k]) { const ij = k.split(','); cells.push(toLL(s[0] + ij[0] * CELL, s[1] + ij[1] * CELL)); if (k === '0,0') break; }
    cells.reverse();
    // ลดความเป็นขั้นบันไดของตาราง
    const pts = [cells[0]];
    for (let i = 2; i < cells.length - 1; i += 2) pts.push(cells[i]);
    pts.push(cells[cells.length - 1]);
    return { pts: pts, way: ways[hit.wi] };
  }
  function nearestOnWays(p, ways, maxD) {
    const m = metric(p.lat), q = m.xy(p);
    let best = null;
    ways.forEach(function (w) {
      const P2 = w.pts.map(m.xy);
      for (let i = 1; i < P2.length; i++) {
        const a = P2[i - 1], b = P2[i], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
        let t = L2 ? ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t));
        const x = a[0] + t * dx, y = a[1] + t * dy, d = Math.hypot(q[0] - x, q[1] - y);
        if (d <= maxD && (!best || d < best.d)) best = { d: d, way: w, at: m.ll(x, y) };
      }
    });
    return best;
  }

  async function traceDrain(src, progress) {
    const say = progress || function () {};
    say('กำลังค้นหาคลอง/ลำราง/แหล่งน้ำ/ชายฝั่งรอบจุด (รัศมี ~3 กม.)...');
    const dLat = 0.03, dLng = 0.03 / Math.cos(src.lat * Math.PI / 180);
    let near = [];
    try { near = await waterways({ s: src.lat - dLat, n: src.lat + dLat, w: src.lng - dLng, e: src.lng + dLng }); }
    catch (e) { say('ดึงข้อมูลทางน้ำไม่ได้ — ใช้แนวไหลตามความสูงอย่างเดียว'); }
    if (near.length) {
      const fp = await floodPath(src, near, say);
      if (fp) {
        const last = fp.pts[fp.pts.length - 1];
        const on = nearestOnWays(last, [fp.way], 60);
        const pts = fp.pts.slice(); if (on) pts[pts.length - 1] = on.at;
        const out = pts[pts.length - 1];
        const e1 = await elevation(src), e2 = await elevation(out);
        return {
          pts: pts.map(fix), distance: length(pts), out: Object.assign(fix(out), { name: fp.way.name }),
          drop: e1 != null && e2 != null ? Math.max(0, e1 - e2) : null, note: '',
          ways: near.filter(function (w) { return w.kind !== 'ทะเล'; }).slice(0, 60).map(function (w) { return { name: w.name, pts: w.pts }; })
        };
      }
    }
    say('กำลังอ่านข้อมูลความสูงพื้นดิน...');
    let cur = toPix(src), curE = await elevAt(cur[0], cur[1]);
    if (curE == null) throw new Error('โหลดข้อมูลความสูงพื้นดินไม่ได้ (ตรวจสอบอินเทอร์เน็ต)');
    const startE = curE, path = [toLL(cur[0], cur[1])], seen = {};
    const R0 = 5, DIRS = 16;   // มองรอบตัวรัศมี ~24 ม. ถ้าราบค่อยขยาย
    for (let step = 0; step < 500; step++) {
      let best = null;
      for (let r = R0; r <= 80 && !best; r = Math.round(r * 1.6)) {
        for (let k = 0; k < DIRS; k++) {
          const a = 2 * Math.PI * k / DIRS, x = cur[0] + Math.cos(a) * r, y = cur[1] + Math.sin(a) * r;
          const key = Math.round(x / 3) + ',' + Math.round(y / 3);
          if (seen[key]) continue;
          const e = await elevAt(x, y);
          if (e != null && e < curE - 0.05 && (!best || e < best.e)) best = { x: x, y: y, e: e };
        }
      }
      if (!best) break;                       // แอ่งต่ำ ไม่มีทางไหลต่อ
      seen[Math.round(cur[0] / 3) + ',' + Math.round(cur[1] / 3)] = 1;
      cur = [best.x, best.y]; curE = best.e;
      path.push(toLL(cur[0], cur[1]));
      if (length(path) > 8000) break;
    }
    say('กำลังค้นหาคลอง/ลำราง/แหล่งน้ำใกล้เคียง...');
    const lats = path.map(function (p) { return p.lat; }), lngs = path.map(function (p) { return p.lng; });
    const pad = 0.012;
    let ways = [];
    try { ways = await waterways({ s: Math.min.apply(null, lats) - pad, n: Math.max.apply(null, lats) + pad, w: Math.min.apply(null, lngs) - pad, e: Math.max.apply(null, lngs) + pad }); }
    catch (e) { say('ดึงข้อมูลทางน้ำไม่ได้ — แสดงเฉพาะแนวไหลตามความสูง'); }
    // ทางน้ำแห่งแรกที่แนวไหลไปถึง (ห่างไม่เกิน 40 ม.)
    let outlet = null, cut = path.length;
    for (let i = 1; i < path.length && !outlet; i++) {
      const hit = nearestOnWays(path[i], ways, 40);
      if (hit) { outlet = hit; cut = i + 1; }
    }
    let pts = path.slice(0, cut), note = '';
    if (!outlet) {
      const hit = nearestOnWays(pts[pts.length - 1], ways, 1500);
      if (hit) { outlet = hit; pts.push(hit.at); note = 'ช่วงสุดท้ายเป็นแนวต่อเชื่อมที่เสนอไปยังทางน้ำที่ใกล้ที่สุด (พื้นที่ราบ/เป็นแอ่ง)'; }
      else note = 'ไม่พบทางน้ำในระยะ 1.5 กม. — น้ำไปรวมที่แอ่งต่ำปลายเส้น';
    } else pts[pts.length - 1] = outlet.at;
    const out = outlet ? outlet.at : pts[pts.length - 1];
    const outE = await elevation(out);
    return {
      pts: pts.map(fix), distance: length(pts), out: Object.assign(fix(out), { name: outlet ? outlet.way.name : 'แอ่งต่ำ (จุดรวมน้ำ)' }),
      drop: outE != null ? Math.max(0, startE - outE) : null, note: note,
      ways: ways.slice(0, 60).map(function (w) { return { name: w.name, pts: w.pts }; })
    };
  }

  window.RT = { route: route, autoDetour: autoDetour, layoutSafety: layoutSafety, traceDrain: traceDrain, elevation: elevation,
    taperLength: taperLength, signDistances: signDistances,
    overlap: overlap, length: length, dist: dist, encode: encode, decode: decode, removeSpurs: removeSpurs };
})();
