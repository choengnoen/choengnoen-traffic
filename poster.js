/* ==========================================================================
   poster.js — วาดผังประกาศ (ภาพโพสต์)

   ผัง 2 ชนิด
     flood  — ทางเบี่ยงอุทกภัย (ภาพรวม) มี 3 สไตล์
                doh   แบบกรมทางหลวง 16:9  — หัวขาว + ตรากรม · ป้าย กม. · ป้ายทางเบี่ยง · ลูกศรบอกทิศ · กล่องคำอธิบาย
                alert แบบเตือนภัย 4:5    — ป้ายแดงหัวผัง · เส้นมีลูกศร · กล่องชี้ "ใช้เส้นทางนี้ / ควรเลี่ยง"
                info  แบบอินโฟกราฟิก 16:9 (2400×1350) — หัวน้ำเงิน · แผงขั้นตอนการเดินทาง · แผงข้อควรทราบ · สายด่วน
     safety — ติดตั้งสิ่งอำนวยความปลอดภัย (ภาพขยาย) ใช้สไตล์ doh: เขตงานสีส้ม · ป้ายเตือน · กรวย · แผงกั้น ฯลฯ

   ทุกป้าย/อุปกรณ์ลากย้ายได้ · คลิกเส้นแล้วลากจุดวงกลมเพื่อปรับเส้น (เส้นวิ่งตามถนนใหม่เอง)
   ========================================================================== */
(function () {
  'use strict';
  const RED = '#e01010', BLUE = '#1f6fe0', ORANGE = '#ff8f00', GREEN = '#3bd13b';
  const STY = {
    doh:   { w: 1920, h: 1080, name: 'แบบกรมทางหลวง (16:9)' },
    alert: { w: 1080, h: 1350, name: 'แบบเตือนภัย แนวตั้ง (4:5)' },
    info:  { w: 2400, h: 1350, name: 'แบบอินโฟกราฟิกประชาสัมพันธ์ (16:9 กว้าง)' }
  };
  const esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  const lines = function (s) { return String(s || '').split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean); };

  /* ---------- อุปกรณ์ความปลอดภัย ---------- */
  const DEV = {
    sign:    { name: 'ป้ายเตือน', size: 58, svg: '<svg viewBox="0 0 60 60"><path d="M30 2 L58 30 L30 58 L2 30 Z" fill="#ff9800" stroke="#111" stroke-width="3"/><path d="M30 16v18" stroke="#111" stroke-width="6" stroke-linecap="round"/><circle cx="30" cy="43" r="3.6" fill="#111"/></svg>' },
    speed:   { name: 'ป้ายจำกัดความเร็ว', size: 56, svg: null },
    arrow:   { name: 'ป้ายลูกศรบังคับชิด', size: 60, svg: null },
    cone:    { name: 'กรวยยาง', size: 26, svg: '<svg viewBox="0 0 40 40"><path d="M16 3h8l9 31H7z" fill="#ff6d00" stroke="#222" stroke-width="2"/><path d="M13 14h14l2 7H11z" fill="#fff"/><rect x="3" y="33" width="34" height="5" rx="1" fill="#333"/></svg>' },
    barrier: { name: 'แผงกั้น', size: 60, svg: '<svg viewBox="0 0 60 40"><rect x="2" y="8" width="56" height="16" fill="#fff" stroke="#222" stroke-width="2"/><path d="M8 8l-6 9M18 8l-11 16M29 8l-11 16M40 8l-11 16M51 8l-11 16M58 13l-7 11" stroke="#e01010" stroke-width="5"/><rect x="8" y="24" width="4" height="14" fill="#333"/><rect x="48" y="24" width="4" height="14" fill="#333"/></svg>' },
    light:   { name: 'ไฟกระพริบ', size: 34, svg: '<svg viewBox="0 0 40 40"><circle cx="20" cy="17" r="13" fill="#ffeb3b" stroke="#222" stroke-width="2"/><circle cx="20" cy="17" r="6.5" fill="#ff9800"/><rect x="18" y="30" width="4" height="9" fill="#333"/></svg>' },
    flag:    { name: 'เจ้าหน้าที่โบกธง', size: 46, svg: '<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="18" fill="#1565c0" stroke="#fff" stroke-width="2.5"/><circle cx="17" cy="12" r="4.5" fill="#fff"/><path d="M9 32c1-7 4-11 8-11s7 4 8 11z" fill="#fff"/><path d="M25 22 L25 8" stroke="#fff" stroke-width="2"/><path d="M25 8h9v6h-9z" fill="#e01010"/></svg>' },
    end:     { name: 'ป้ายสิ้นสุดเขตงาน', size: 50, svg: '<svg viewBox="0 0 60 40"><rect x="2" y="2" width="56" height="36" rx="4" fill="#fff" stroke="#111" stroke-width="3"/><path d="M12 20h36" stroke="#1c8a53" stroke-width="6"/><path d="M40 11l10 9-10 9" fill="none" stroke="#1c8a53" stroke-width="5"/></svg>' },
    // อุปกรณ์งานระบายน้ำ
    pump:    { name: 'เครื่องสูบน้ำ', size: 50, svg: '<svg viewBox="0 0 40 40"><rect x="3" y="9" width="25" height="21" rx="3" fill="#455a64" stroke="#fff" stroke-width="2.5"/><circle cx="15.5" cy="19.5" r="6" fill="#90caf9"/><path d="M28 15h7v5" stroke="#0288d1" stroke-width="3.5" fill="none"/><path d="M35 24c0 3-2 4.5-2 4.5s-2-1.5-2-4.5 2-4.5 2-4.5 2 1.5 2 4.5z" fill="#0288d1"/></svg>' },
    culvert: { name: 'ท่อลอด/ท่อระบายน้ำ', size: 46, svg: '<svg viewBox="0 0 40 40"><rect x="2" y="12" width="36" height="16" rx="3" fill="#9e9e9e" stroke="#fff" stroke-width="2.5"/><circle cx="12" cy="20" r="5" fill="#263238"/><circle cx="28" cy="20" r="5" fill="#263238"/></svg>' },
    sandbag: { name: 'แนวกระสอบทราย', size: 40, svg: '<svg viewBox="0 0 40 30"><rect x="2" y="15" width="17" height="11" rx="5" fill="#c8a165" stroke="#5d4037" stroke-width="2"/><rect x="21" y="15" width="17" height="11" rx="5" fill="#c8a165" stroke="#5d4037" stroke-width="2"/><rect x="11" y="4" width="17" height="11" rx="5" fill="#c8a165" stroke="#5d4037" stroke-width="2"/></svg>' },
    // จุดน้ำท่วมเพิ่มเติม (ผังทางเบี่ยงอุทกภัย วางได้หลายจุด)
    flood:   { name: 'จุดน้ำท่วม', size: 56, svg: '<svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="27" fill="#e01010" stroke="#fff" stroke-width="4"/><path d="M30 10c-5 7-8 11-8 15a8 8 0 0 0 16 0c0-4-3-8-8-15z" fill="#fff"/><path d="M11 40c3-3 5-3 8 0s5 3 8 0 5-3 8 0 5 3 8 0 5-3 7 0M11 48c3-3 5-3 8 0s5 3 8 0 5-3 8 0 5 3 8 0 5-3 7 0" stroke="#fff" stroke-width="3.2" fill="none" stroke-linecap="round"/></svg>' }
  };
  const DEV_SAFETY = ['sign', 'speed', 'arrow', 'cone', 'barrier', 'light', 'flag', 'end'];
  const DEV_DRAIN = ['pump', 'culvert', 'sandbag', 'sign', 'cone', 'barrier'];
  const DEV_FLOOD = ['flood', 'sign', 'barrier', 'cone', 'sandbag', 'pump'];
  function devSvg(d) {
    if (d.t === 'speed') return '<svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="27" fill="#fff" stroke="#e01010" stroke-width="7"/><text x="30" y="39" text-anchor="middle" font-size="24" font-weight="700" font-family="Kanit,sans-serif" fill="#111">' + esc(d.text || '') + '</text></svg>';
    if (d.t === 'arrow') {
      const left = /ซ้าย/.test(d.text || '');
      return '<svg viewBox="0 0 70 44"><rect x="1" y="1" width="68" height="42" rx="4" fill="#111"/><path d="' + (left ? 'M56 22H18M28 11 16 22l12 11' : 'M14 22h38M42 11l12 11-12 11') + '" fill="none" stroke="#ffd600" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }
    return DEV[d.t].svg;
  }
  const ICON = {
    warn: '<svg viewBox="0 0 100 90"><path d="M50 4 L96 86 H4 Z" fill="#ffd600" stroke="#111" stroke-width="6" stroke-linejoin="round"/><path d="M50 30v28" stroke="#111" stroke-width="10" stroke-linecap="round"/><circle cx="50" cy="72" r="6" fill="#111"/></svg>',
    go: '<svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="27" fill="#fff"/><path d="M14 30h26M32 19l11 11-11 11" fill="none" stroke="#1d8f2e" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    no: '<svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="27" fill="#e01010" stroke="#fff" stroke-width="4"/><rect x="12" y="25" width="36" height="10" fill="#fff"/></svg>',
    mega: '<svg viewBox="0 0 60 50"><path d="M6 18h10l26-13v40L16 32H6z" fill="#fff"/><path d="M16 32l4 14h8l-4-14" fill="#fff"/><path d="M48 15c4 3 6 7 6 10s-2 7-6 10" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/></svg>',
    car: '<svg viewBox="0 0 64 40"><path d="M8 22l6-13c1-3 3-4 6-4h24c3 0 5 1 6 4l6 13v12H8z" fill="#fff"/><rect x="16" y="9" width="32" height="11" rx="2" fill="#1d3f8f"/><circle cx="18" cy="32" r="5" fill="#1d3f8f"/><circle cx="46" cy="32" r="5" fill="#1d3f8f"/></svg>',
    check: '<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="18" fill="#1d8f2e"/><path d="M11 20l6 6 12-13" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    cross: '<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="18" fill="#fff"/><path d="M13 13l14 14M27 13 13 27" stroke="#c62828" stroke-width="5" stroke-linecap="round"/></svg>',
    phone: '<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="18" fill="#fff"/><path d="M14 10c-2 1-3 3-2 6 2 6 6 11 12 13 3 1 5 0 6-2l-4-5-3 2c-3-1-5-4-6-7l2-3z" fill="#b71c1c"/></svg>',
    north: '<svg viewBox="0 0 40 56"><text x="20" y="13" text-anchor="middle" font-size="14" font-weight="700" font-family="Kanit,sans-serif" fill="#111">N</text><circle cx="20" cy="36" r="18" fill="#fff" stroke="#111" stroke-width="2"/><path d="M20 20 L28 46 L20 40 L12 46 Z" fill="#111"/></svg>',
    cone: DEV.cone.svg
  };
  ICON.drop = '<svg viewBox="0 0 40 52"><path d="M20 2C12 14 5 22 5 32a15 15 0 0 0 30 0C35 22 28 14 20 2z" fill="#e01010" stroke="#fff" stroke-width="3"/><path d="M13 33c0 4 3 7 7 7" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/></svg>';
  ICON.outlet = '<svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="19" fill="#0277bd" stroke="#fff" stroke-width="3.5"/><path d="M10 20c3-3 6-3 9 0s6 3 9 0 6-3 7 0M10 28c3-3 6-3 9 0s6 3 9 0 6-3 7 0" stroke="#fff" stroke-width="3" fill="none"/></svg>';
  const P = window.Poster = { DEV: DEV, devSvg: devSvg, STY: STY, ICON: ICON, DEV_SAFETY: DEV_SAFETY, DEV_DRAIN: DEV_DRAIN, DEV_FLOOD: DEV_FLOOD };
  const DRAIN = '#00b0ff', WATER = '#4fc3f7', PURPLE = '#9c27b0';   // PURPLE = ทางเบี่ยงที่ 2
  let map, sheet, stage, plan, onChange, layers, deco, handles, selected = null, bases, placing = null, sideBar = null, sidePick = false;
  let lineOf = {}, bent = false;   // เส้นของแต่ละ key · เพิ่งกดลากเส้นเสร็จ (กันคลิกซ้อน)
  let refBack, refPts, refKey = '';

  /* ---------- ตัวช่วย ---------- */
  function kmNum(s) {
    const m = String(s || '').match(/(\d+)\s*\+\s*(\d{1,3})/);
    return m ? +m[1] + (+m[2]) / 1000 : null;
  }
  P.kmNum = kmNum;
  function fmtKm(m) { return (m / 1000).toFixed(2) + ' กม.'; }
  function has(p) { return !!p && isFinite(p.lat) && isFinite(p.lng) && !!(p.lat || p.lng); }
  P.has = has;
  function LL(p) { return L.latLng(p.lat, p.lng); }
  function px(p) { return map.latLngToContainerPoint(LL(p)); }
  function geo(pt) { const l = map.containerPointToLatLng(pt); return { lat: l.lat, lng: l.lng }; }
  function clampPt(pt, mx, my) { const s = map.getSize(); return L.point(Math.max(mx, Math.min(s.x - mx, pt.x)), Math.max(my, Math.min(s.y - my, pt.y))); }
  // isSafety() = ผังที่ไม่ใช่ทางเบี่ยงอุทกภัย (ความปลอดภัย / ระบายน้ำ) — ใช้สไตล์ doh และมีอุปกรณ์วางเองได้
  function isSafety() { return plan.kind !== 'flood'; }
  function isDrain() { return plan.kind === 'drain'; }
  function style() { return isSafety() ? 'doh' : (STY[plan.style] ? plan.style : 'doh'); }
  P.style = function () { return plan ? style() : 'doh'; };
  function mainKey() { return plan.kind === 'safety' ? 'zone' : isDrain() ? 'drain' : 'flood'; }
  // ช่วงน้ำท่วมเพิ่มเติม (plan.floods2[i]) ใช้ key 'fx' + i · เส้นเก็บในตัวช่วงเอง (line, len)
  function isExtra(key) { return /^fx\d+$/.test(key); }
  function extras() { return plan && plan.kind === 'flood' ? (plan.floods2 || []) : []; }
  function routeOf(key) { return isExtra(key) ? extras()[+key.slice(2)] : plan[key]; }
  function lineField(key) { return key + 'Line'; }
  function linePts(key) {
    const r = routeOf(key);
    if (!r) return [];
    const enc = isExtra(key) ? r.line : plan[lineField(key)];
    if (enc) return RT.decode(enc);
    return has(r.a) && has(r.b) ? [r.a, r.b] : [];
  }
  function changed(what) { if (onChange) onChange(what || 'plan'); }
  function kmRange(r) { return r.a.km ? 'กม.' + r.a.km + (r.b.km && r.b.km !== r.a.km ? ' - ' + r.b.km : '') : ''; }
  P.kmRange = kmRange;
  // กม. ของทุกช่วงน้ำท่วม (ช่วงหลัก + ช่วงเพิ่มเติม) เช่น "กม.233+100 - 236+700, กม.240+500 - 241+000"
  // ทุกจุดน้ำท่วมของผัง: [{ r: ช่วง, place, depth, road, section }] — จุดที่ 1 = plan.flood (ชื่อบริเวณ/สายทางใช้ของผัง)
  // จุดอื่นระบุสายทางเองได้ (1 ผังมีน้ำท่วมหลายสายทาง) ไม่ระบุ = สายทางเดียวกับจุดที่ 1
  P.floodList = function (pl) {
    if (!pl || pl.kind !== 'flood') return [];
    return [{ r: pl.flood, place: pl.place || '', depth: pl.flood.depth || '', road: pl.road || '', section: pl.section || '' }].concat((pl.floods2 || []).map(function (s) {
      const road = s.road || pl.road || '';
      return { r: s, place: s.place || '', depth: s.depth || '', road: road, section: s.section || (road === pl.road ? pl.section || '' : '') };
    }));
  };
  // หมายเลขทางหลวงทั้งหมดในผัง (ไม่ซ้ำ)
  P.roads = function (pl) {
    const out = [];
    (pl && pl.kind === 'flood' ? P.floodList(pl) : [{ road: pl && pl.road }]).forEach(function (f) { if (f.road && out.indexOf(f.road) < 0) out.push(f.road); });
    return out;
  };
  // กม. ของแต่ละจุด · หลายสายทาง = นำหน้าด้วย ทล.
  P.segKm = function (pl, f) { const k = kmRange(f.r); return k && P.roads(pl).length > 1 && f.road ? 'ทล.' + f.road + ' ' + k : k; };
  P.kmRangeAll = function (pl) {
    if (pl.kind !== 'flood') return pl.flood && pl.flood.a ? kmRange(pl.flood) : '';
    return P.floodList(pl).map(function (f) { return f.r && f.r.a ? P.segKm(pl, f) : ''; }).filter(Boolean).join(', ');
  };
  function depthTxt(d) { return d ? 'ระดับน้ำ ' + d + ' ซม.' : ''; }
  P.depthTxt = depthTxt;
  // มีทางเบี่ยงที่ 2 (มีพิกัดอย่างน้อยหนึ่งจุด)
  function hasDet2(pl) { pl = pl || plan; return !!(pl && pl.kind === 'flood' && pl.detour2 && (has(pl.detour2.a) || has(pl.detour2.b))); }
  P.hasDet2 = hasDet2;

  /* ---------- ข้อความอัตโนมัติ ---------- */
  P.autoHeadline = function (pl) {
    if (pl.kind === 'drain') {
      return 'แนวทางระบายน้ำ บริเวณ' + (pl.place || (pl.drain.a.name || 'จุดน้ำท่วมขัง')) + (pl.road ? ' ทางหลวงหมายเลข ' + pl.road : '') + (pl.drain.a.km ? ' กม.' + pl.drain.a.km : '');
    }
    if (pl.kind === 'safety') {
      return 'ผังติดตั้งป้ายและอุปกรณ์ความปลอดภัย ' + (pl.workType || 'งานก่อสร้าง') + (pl.road ? ' ทางหลวงหมายเลข ' + pl.road : '') + (kmRange(pl.zone) ? ' ' + kmRange(pl.zone) : '');
    }
    const roads = P.roads(pl);
    if (roads.length > 1) return 'เบี่ยงการจราจรน้ำท่วมทางบริเวณ ทางหลวงหมายเลข ' + roads.join(', ');
    return 'เบี่ยงการจราจรน้ำท่วมทางบริเวณ ' + (pl.road ? 'ทางหลวงหมายเลข ' + pl.road : '') + (pl.section ? ' ตอน ' + pl.section : '');
  };
  P.autoSteps = function (pl) {
    const a = pl.detour.a, b = pl.detour.b, road = pl.road ? 'ทล.' + pl.road : 'ทางหลวง';
    const s = [];
    s.push('เดินทางตาม ' + road + ' ถึง ' + (a.name || 'จุดแยกทางเบี่ยง') + (a.km ? ' (กม.' + a.km + ')' : ''));
    s.push('เลี้ยวเข้าเส้นทางเบี่ยงตามป้ายบอกทาง' + (pl.detourLen ? ' ระยะทางประมาณ ' + fmtKm(pl.detourLen) : ''));
    s.push('กลับเข้าสู่ ' + road + ' ที่ ' + (b.name || 'จุดกลับเข้าทางหลัก') + (b.km ? ' (กม.' + b.km + ')' : ''));
    if (hasDet2(pl)) {
      const c = pl.detour2.a, d = pl.detour2.b;
      s.push('ทางเบี่ยงที่ 2: เข้าที่ ' + (c.name || (c.km ? 'กม.' + c.km : 'จุดแยก')) + ' กลับเข้าที่ ' + (d.name || (d.km ? 'กม.' + d.km : 'จุดกลับเข้า')) + (pl.detour2Len ? ' (' + fmtKm(pl.detour2Len) + ')' : ''));
    }
    s.push('หลีกเลี่ยงบริเวณ' + (pl.place || 'ที่น้ำท่วม') + (P.kmRangeAll(pl) ? ' ' + P.kmRangeAll(pl) : ''));
    return s.join('\n');
  };
  P.autoNotes = function (pl) {
    const fl = P.floodTotal(pl), list = P.floodList(pl);
    const multi = list.length > 1 || list.some(function (f) { return f.depth; });
    return (multi
      ? list.map(function (f, i) { return 'จุดที่ ' + (i + 1) + ' ' + (P.segKm(pl, f) || f.place || '') + (f.depth ? ' ' + depthTxt(f.depth) : ''); })
      : ['ช่วงน้ำท่วมทาง ' + (P.kmRangeAll(pl) || '') + (fl ? ' ระยะรวม ' + fmtKm(fl) : '')]).concat([
      'มีป้ายและเจ้าหน้าที่อำนวยความสะดวกตลอดเส้นทาง',
      'เปิดไฟหน้า ลดความเร็ว เว้นระยะห่าง',
      'ไม่ขับฝ่าน้ำท่วมที่ไม่ทราบความลึก'
    ]).join('\n');
  };
  P.autoAlert2 = function (pl) {
    const roads = P.roads(pl);
    if (roads.length > 1) return 'ทล.' + roads.join(' / ทล.');
    return(pl.road ? 'ทล.' + pl.road + ' ' : '') + (kmRange(pl.flood) || '').replace(/\+\d{3}/g, function (x) { return x === '+000' ? '' : x; }); };

  function headline() {
    const h = esc((plan.headline || '').trim() || P.autoHeadline(plan));
    const hot = isDrain() ? 'ระบายน้ำ' : isSafety() ? (plan.workType || '') : 'น้ำท่วมทาง';
    return hot ? h.replace(esc(hot), '<span style="color:#e01010">' + esc(hot) + '</span>') : h;
  }
  P.floodLength = function (pl) {
    pl = pl || plan;
    if (pl.kind === 'drain') return pl.drainLen || 0;
    const r = pl.kind === 'safety' ? pl.zone : pl.flood;
    const a = kmNum(r.a.km), b = kmNum(r.b.km);
    if (a != null && b != null && a !== b) return Math.abs(b - a) * 1000;
    return (pl.kind === 'safety' ? pl.zoneLen : pl.floodLen) || 0;
  };
  // ระยะรวมทุกช่วงน้ำท่วม (ช่วงหลัก + ช่วงเพิ่มเติม) — มี กม. ครบใช้ผลต่าง กม. ไม่งั้นใช้ความยาวเส้น
  P.floodTotal = function (pl) {
    pl = pl || plan;
    let t = P.floodLength(pl);
    if (pl.kind === 'flood') (pl.floods2 || []).forEach(function (s) {
      const a = kmNum(s.a && s.a.km), b = kmNum(s.b && s.b.km);
      t += a != null && b != null && a !== b ? Math.abs(b - a) * 1000 : (s.len || 0);
    });
    return t;
  };

  function q(sel) { return sheet.querySelector(sel); }
  function renderStatic() {
    const st = style(), org = plan.org || 'แขวงทางหลวงระยอง', fl = P.floodLength();
    sheet.className = 'pz-sheet st-' + st + (HEADS[plan.head] ? ' hd-' + plan.head : '');
    placeBoxes();
    const lg = P.logoSrc(plan);
    sheet.querySelectorAll('img.pz-logo').forEach(function (im) { if (im.getAttribute('src') !== lg) im.src = lg; });
    sheet.style.width = STY[st].w + 'px'; sheet.style.height = STY[st].h + 'px';
    // doh
    q('.pz-org').textContent = org;
    q('.pz-sub').innerHTML = headline();
    const hl = q('.pz-sub').textContent.length;   // หัวเรื่องยาว → ย่อตัวอักษรให้อยู่บรรทัดเดียว
    q('.pz-sub').style.fontSize = hl > 78 ? '30px' : hl > 66 ? '34px' : hl > 56 ? '37px' : '';
    q('.pz-apology').textContent = plan.apology || 'ขออภัยในความไม่สะดวก';
    let rows;
    if (isSafety()) {
      const used = [];
      (plan.devices || []).forEach(function (d) { if (DEV[d.t] && used.indexOf(d.t) < 0) used.push(d.t); });
      rows = (isDrain()
        ? '<div class="pz-lg"><i style="background:' + DRAIN + '"></i>' + esc(plan.legendDrain || 'แนวทางระบายน้ำ') + (fl ? ' (' + fmtKm(fl) + ')' : '') + '</div>' +
          ((plan.waterLines || []).length ? '<div class="pz-lg"><i style="background:' + WATER + ';height:7px"></i>คลอง / ลำราง / แหล่งน้ำ</div>' : '') +
          '<div class="pz-lg"><span class="pz-lgi">' + ICON.drop + '</span>จุดน้ำท่วมขัง</div>' +
          '<div class="pz-lg"><span class="pz-lgi">' + ICON.outlet + '</span>จุดระบายน้ำออก' + (plan.drop != null ? ' (ต่างระดับ ~' + (+plan.drop).toFixed(1) + ' ม.)' : '') + '</div>'
        : '<div class="pz-lg"><i style="background:' + ORANGE + '"></i>' + esc(plan.legendZone || 'เขตปฏิบัติงาน / ช่องจราจรที่ปิด') + (fl ? ' (' + fmtKm(fl) + ')' : '') + '</div>') +
        used.map(function (t) {
          const n = (plan.devices || []).filter(function (d) { return d.t === t; }).length;
          return '<div class="pz-lg"><span class="pz-lgi">' + devSvg({ t: t, text: t === 'arrow' ? 'ขวา' : '' }) + '</span>' + DEV[t].name + ' (' + n + ')</div>';
        }).join('');
    } else {
      const dl = plan.detourLen || 0, nx = extras().filter(function (s) { return has(s.a); }).length, ft = P.floodTotal();
      rows = '<div class="pz-lg"><i style="background:' + RED + '"></i>' + esc(plan.legendFlood || 'บริเวณที่น้ำท่วมทาง') +
        (nx ? ' (' + (nx + 1) + ' ช่วง' + (ft ? ' รวม ' + fmtKm(ft) : '') + ')' : fl ? ' (' + fmtKm(fl) + ')' : '') + '</div>' +
        '<div class="pz-lg"><i style="background:' + BLUE + '"></i>' + esc(plan.legendDetour || (hasDet2() ? 'เส้นทางเบี่ยงที่ 1' : 'เส้นทางเบี่ยงการจราจร')) + (dl ? ' (' + fmtKm(dl) + ')' : '') + '</div>' +
        (hasDet2() ? '<div class="pz-lg"><i style="background:' + PURPLE + '"></i>' + esc(plan.legendDetour2 || 'เส้นทางเบี่ยงที่ 2') + (plan.detour2Len ? ' (' + fmtKm(plan.detour2Len) + ')' : '') + '</div>' : '');
      // จุดน้ำท่วม/อุปกรณ์ที่วางเพิ่ม → แสดงในคำอธิบายด้วย
      const used = [];
      (plan.devices || []).forEach(function (d) { if (DEV[d.t] && used.indexOf(d.t) < 0) used.push(d.t); });
      rows += used.map(function (t) {
        const n = plan.devices.filter(function (d) { return d.t === t; }).length;
        return '<div class="pz-lg"><span class="pz-lgi">' + devSvg({ t: t }) + '</span>' + DEV[t].name + (n > 1 ? ' (' + n + ' จุด)' : '') + '</div>';
      }).join('');
    }
    q('.pz-legend').innerHTML = '<div class="pz-lg-h">คำอธิบายสัญลักษณ์</div>' + rows;
    q('.pz-legend').classList.toggle('compact', isSafety());
    if (isSafety()) return;
    // alert
    q('.pz-a1').textContent = plan.alert1 || 'หลีกเลี่ยงเส้นทางน้ำท่วม';
    q('.pz-a2').textContent = plan.alert2 || P.autoAlert2(plan);
    q('.pz-a3').textContent = plan.alert3 || 'ทั้งฝั่งขาเข้าและขาออก';
    q('.pz-aorg').textContent = org;
    // info
    q('.pz-it1').textContent = plan.info1 || 'เส้นทางเลี่ยงน้ำท่วม';
    q('.pz-it2').textContent = plan.info2 || (P.roads(plan).length ? 'ทล.' + P.roads(plan).join(', ') : '');
    q('.pz-isub').textContent = plan.infoSub || '“โปรดตรวจสอบเส้นทางก่อนออกเดินทาง และขับขี่ด้วยความระมัดระวัง”';
    q('.pz-lsteps').innerHTML = lines(plan.steps || P.autoSteps(plan)).map(function (s, i) {
      return '<li><b>' + (i + 1) + '</b><span>' + esc(s) + '</span></li>';
    }).join('');
    q('.pz-lavoid span').innerHTML = 'หลีกเลี่ยง<br>' + esc(plan.place || 'บริเวณน้ำท่วม') + '<br><small>(น้ำท่วมทาง)</small>';
    q('.pz-rnotes').innerHTML = lines(plan.notes || P.autoNotes(plan)).map(function (s) { return '<li>' + ICON.check + '<span>' + esc(s) + '</span></li>'; }).join('');
    q('.pz-slogan2').textContent = org + ' ห่วงใยประชาชน';
    q('.pz-hotline b').textContent = plan.hotline || 'โทร. 1586';
    q('.pz-ilegend').innerHTML = '<div><i style="background:' + RED + '"></i>เส้นทางหลัก (น้ำท่วม ควรหลีกเลี่ยง)</div><div><i style="background:' + BLUE + '"></i>เส้นทางที่แนะนำ' + (hasDet2() ? ' 1' : '') + '</div>' +
      (hasDet2() ? '<div><i style="background:' + PURPLE + '"></i>เส้นทางที่แนะนำ 2</div>' : '');
  }

  /* ---------- แบบหัวผัง (ใช้กับแบบกรมทางหลวง) ---------- */
  const HEADS = { white: 'ขาวเรียบ (เดิม)', navy: 'แถบน้ำเงิน', yellow: 'แถบเหลือง', stripe: 'ขาว + แถบเตือนเหลืองดำ', line: 'ขาว + เส้นน้ำเงินแดง' };
  P.HEADS = HEADS;

  /* ---------- ตรากรมทางหลวง: old = แบบเดิม, new = แบบใหม่ · ผังแต่ละแผ่นเลือกเองได้ (plan.logo) หรือใช้ค่าตั้งของเว็บ (P.logoDefault) ---------- */
  P.logos = { old: 'logo.png' };
  P.logoDefault = 'old';
  P.logoSrc = function (pl) {
    const k = (pl && pl.logo) || P.logoDefault;
    return P.logos[k] || P.logos.old;
  };

  /* ---------- กล่องข้อความลากย้ายได้ (เก็บระยะเลื่อนไว้ใน plan.box หน่วยพิกเซลของแผ่นจริง) ---------- */
  const BOXES = { apology: '.pz-apology', legend: '.pz-legend', ilegend: '.pz-ilegend', afoot: '.pz-afoot', north: '.pz-north' };
  function placeBoxes() {
    const b = plan.box || {};
    Object.keys(BOXES).forEach(function (k) { const o = b[k]; q(BOXES[k]).style.translate = o ? o.dx + 'px ' + o.dy + 'px' : ''; });
  }
  function bindBoxDrag() {
    Object.keys(BOXES).forEach(function (k) {
      const el = q(BOXES[k]);
      el.classList.add('pz-movable');
      el.title = 'ลากเพื่อย้ายตำแหน่ง · ดับเบิลคลิกเพื่อคืนตำแหน่งเดิม';
      el.addEventListener('pointerdown', function (e) {
        if (!plan || e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        const s = sheet.getBoundingClientRect().width / sheet.offsetWidth;   // แผ่นถูกย่อ → แปลงระยะเมาส์กลับเป็นพิกเซลจริง
        const o = (plan.box && plan.box[k]) || { dx: 0, dy: 0 }, x0 = e.clientX, y0 = e.clientY;
        let cur = null;
        el.setPointerCapture(e.pointerId);
        function mv(ev) {
          cur = { dx: Math.round(o.dx + (ev.clientX - x0) / s), dy: Math.round(o.dy + (ev.clientY - y0) / s) };
          el.style.translate = cur.dx + 'px ' + cur.dy + 'px';
        }
        function up() {
          el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
          if (!cur) return;
          plan.box = Object.assign({}, plan.box); plan.box[k] = cur; changed('box');
        }
        el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
      });
      el.addEventListener('dblclick', function (e) {
        e.stopPropagation();
        if (!plan || !plan.box || !plan.box[k]) return;
        plan.box = Object.assign({}, plan.box); delete plan.box[k];
        placeBoxes(); changed('box');
      });
    });
  }

  /* ---------- สร้างแผ่นผัง ---------- */
  P.mount = function (stageEl, logoSrc) {
    stage = stageEl;
    const logo = '<img class="pz-logo" alt="ตรากรมทางหลวง" src="' + esc(logoSrc) + '">';
    stage.innerHTML = '<div class="pz-sheet st-doh">' +
      '<div class="pz-head">' + logo + '<div><div class="pz-org"></div><div class="pz-sub"></div></div></div>' +
      '<div class="pz-ihead"><div class="pz-badge">' + ICON.mega + 'ประชาสัมพันธ์</div><div class="pz-ititle"><div><span class="pz-it1"></span> <span class="pz-it2"></span></div><div class="pz-isub"></div></div>' + logo + '</div>' +
      '<div class="pz-body">' +
        '<div class="pz-left"><div class="pz-ph red">' + ICON.car + 'เส้นทางแนะนำ</div><div class="pz-pstrip">แนะนำให้ใช้เส้นทางเลี่ยงน้ำท่วม</div><ol class="pz-lsteps"></ol><div class="pz-lavoid">' + ICON.cross + '<span></span></div></div>' +
        '<div class="pz-mapwrap"><div class="pz-map"></div>' +
          '<div class="pz-br"><div class="pz-apology"></div><div class="pz-legend"></div></div>' +
          '<div class="pz-abanner">' + ICON.warn + '<div><div class="pz-a1"></div><div class="pz-a2"></div><div class="pz-a3"></div></div></div>' +
          '<div class="pz-afoot">' + logo + '<span class="pz-aorg"></span></div>' +
          '<div class="pz-ilegend"></div><div class="pz-north">' + ICON.north + '</div>' +
        '</div>' +
        '<div class="pz-right"><div class="pz-ph green">' + ICON.check + 'ข้อควรทราบ</div><ul class="pz-rnotes"></ul><div class="pz-rwarn">' + ICON.warn + '<span>สถานการณ์น้ำและสภาพเส้นทางอาจเปลี่ยนแปลงได้ตลอดเวลา ขอให้ตรวจสอบข้อมูลก่อนออกเดินทาง</span></div></div>' +
      '</div>' +
      '<div class="pz-ifoot"><div class="pz-slogan"><div class="pz-slogan1">เดินทางปลอดภัย</div><div class="pz-slogan2"></div></div><div class="pz-hotline">' + ICON.phone + '<div>สายด่วนกรมทางหลวง<br><b></b></div></div></div>' +
      '</div>';
    sheet = stage.querySelector('.pz-sheet');
    bindBoxDrag();
    map = L.map(q('.pz-map'), { zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 120, maxZoom: 20, zoomControl: true });
    const opt = { maxZoom: 20, maxNativeZoom: 19, crossOrigin: 'anonymous' };
    bases = {
      sat: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', Object.assign({ attribution: '© Esri' }, opt)),
      // แผนที่แบบ Google: ซ่อนหมุดร้านค้า/ร้านอาหาร/โรงแรม (poi.business) และป้ายขนส่ง เหลือหมุดสำคัญ เช่น โรงพยาบาล วัด โรงเรียน หน่วยงานราชการ
      gmap: L.tileLayer('https://mt{s}.google.com/vt/lyrs=m&hl=th&x={x}&y={y}&z={z}&scale=2&apistyle=s.t%3A33%7Cp.v%3Aoff%2Cs.t%3A40%7Cp.v%3Aoff', Object.assign({ attribution: '© Google', subdomains: '0123' }, opt, { maxNativeZoom: 20 }))
    };
    // ชั้นข้อมูลอ้างอิงอยู่ใต้เส้นของผัง (overlayPane = 400)
    map.createPane('refTb').style.zIndex = 380;
    map.getPane('refTb').style.pointerEvents = 'none';
    map.createPane('refRt').style.zIndex = 390;
    refBack = L.layerGroup().addTo(map);
    refPts = L.layerGroup().addTo(map);
    layers = L.layerGroup().addTo(map);
    deco = L.layerGroup().addTo(map);
    handles = L.layerGroup().addTo(map);
    map.setView([12.64, 101.39], 13);
    map.on('moveend', function () { if (plan) { const c = map.getCenter(); plan.view = { lat: c.lat, lng: c.lng, zoom: map.getZoom() }; changed('view'); } });
    map.on('zoomend', drawChevrons);
    const SideCtl = L.Control.extend({ options: { position: 'topright' }, onAdd: function () {
      const d = L.DomUtil.create('div', 'pz-side');
      L.DomEvent.disableClickPropagation(d); L.DomEvent.disableScrollPropagation(d);
      d.addEventListener('click', function (e) { const b = e.target.closest('[data-s]'); if (b) sideCmd(b.dataset.s); });
      return d;
    } });
    sideBar = new SideCtl().addTo(map).getContainer();
    renderSide();
    map.on('click', function (e) {
      if (bent) return;
      if (sidePick) { sideAt(e.latlng); return; }
      if (P.onPick) { const f = P.onPick; P.onPick = null; sheet.classList.remove('placing'); drawRef(); f(e.latlng); return; }
      if (placing) { placeAt(e.latlng); return; }
      if (selected) select(null);
    });
    new ResizeObserver(P.scale).observe(stage);
    P.scale();
  };
  P.scale = function () {
    if (!stage || !sheet || document.body.classList.contains('printing-poster')) return;
    const st = STY[plan ? style() : 'doh'];
    const s = Math.min(stage.clientWidth / st.w, (window.innerHeight - 150) / st.h);
    sheet.style.transform = 'scale(' + s + ')';
    stage.style.height = Math.round(st.h * s) + 'px';
    sheet.style.left = Math.max(0, (stage.clientWidth - st.w * s) / 2) + 'px';
  };
  P.map = function () { return map; };

  /* ---------- วาดทั้งหมดจากข้อมูลผัง ---------- */
  P.setPlan = function (p, cb) {
    plan = p; onChange = cb; selected = null; placing = null; refKey = '';
    if (plan.base === 'street') plan.base = 'gmap';   // ตัวเลือก "แผนที่ถนน" เลิกใช้แล้ว → ใช้แผนที่แบบ Google แทน
    P.setBase(plan.base);
    renderStatic(); P.scale(); map.invalidateSize();
    if (plan.view && plan.view.zoom) map.setView([plan.view.lat, plan.view.lng], plan.view.zoom, { animate: false });
    P.draw();
  };
  P.setBase = function (b) {
    Object.keys(bases).forEach(function (k) { map.removeLayer(bases[k]); });
    (bases[b] || bases.sat).addTo(map);
  };
  // เปลี่ยนสไตล์: ขนาดแผ่นเปลี่ยน → ซูมพอดีและจัดป้ายใหม่
  P.restyle = function () {
    renderStatic(); P.scale(); map.invalidateSize();
    P.fit(); P.autoLabels();
  };
  P.draw = function () {
    if (!plan) return;
    renderStatic();
    drawRef();
    layers.clearLayers(); lineOf = {};
    plan.pos = plan.pos || {};
    lblReg = [];
    if (isSafety()) drawSafety(); else drawFlood();
    drawLabels();
    drawChevrons();
    if (selected) { if (lineOf[selected]) lineOf[selected].bringToFront(); drawHandles(); }   // เส้นที่เลือกขึ้นบนสุด (ทางเบี่ยงที่ทับเส้นน้ำท่วมก็กดลากได้)
  };
  function clickable(line, key) {
    line.on('click', function (e) { L.DomEvent.stop(e); if (bent) return; lineClick(key, e.latlng); });
    line.on('mousedown', function (e) { bend(key, e); });
    lineOf[key] = line;
    return line;
  }
  function drawFlood() {
    const fp = linePts('flood'), dp = linePts('detour'), st = style();
    if (dp.length > 1) {
      if (st === 'alert') L.polyline(dp.map(LL), { color: '#0b5d16', weight: 24, opacity: .9, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(layers);
      clickable(L.polyline(dp.map(LL), { color: st === 'alert' ? GREEN : BLUE, weight: st === 'alert' ? 17 : 12, opacity: .97, lineCap: 'round', lineJoin: 'round' }).addTo(layers), 'detour');
    }
    const d2 = hasDet2() ? linePts('detour2') : [];
    if (d2.length > 1) {
      if (st === 'alert') L.polyline(d2.map(LL), { color: '#4a0e57', weight: 24, opacity: .9, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(layers);
      clickable(L.polyline(d2.map(LL), { color: PURPLE, weight: st === 'alert' ? 17 : 12, opacity: .97, lineCap: 'round', lineJoin: 'round' }).addTo(layers), 'detour2');
    }
    const red = function (pts, key) {
      if (st === 'alert') L.polyline(pts.map(LL), { color: '#6d0000', weight: 24, opacity: .9, interactive: false }).addTo(layers);
      clickable(L.polyline(pts.map(LL), { color: RED, weight: st === 'alert' ? 17 : 16, opacity: 1, lineCap: st === 'doh' ? 'butt' : 'round' }).addTo(layers), key);
      if (st !== 'alert') [pts[0], pts[pts.length - 1]].forEach(function (p) {
        L.circleMarker(LL(p), { radius: 11, color: RED, weight: 5, fillColor: '#fff', fillOpacity: 1, interactive: false }).addTo(layers);
      });
    };
    if (fp.length > 1) red(fp, 'flood');
    // ช่วงน้ำท่วมเพิ่มเติม: มีจุดเริ่ม-สิ้นสุด = เส้นสีแดง · มีจุดเดียว = หมุดน้ำท่วม (ลากย้ายได้)
    extras().forEach(function (s, i) {
      const ep = linePts('fx' + i);
      if (ep.length > 1) { red(ep, 'fx' + i); return; }
      if (!has(s.a)) return;
      const m = L.marker(LL(s.a), { draggable: true, keyboard: false, zIndexOffset: 600,
        icon: L.divIcon({ className: 'pz-dev', iconSize: [56, 56], iconAnchor: [28, 28], html: DEV.flood.svg }) });
      m.on('dragend', function () { const l = m.getLatLng(); s.a.lat = +l.lat.toFixed(6); s.a.lng = +l.lng.toFixed(6); P.draw(); changed('coords'); });
      m.addTo(layers);
    });
    drawFloodNums();
    drawDevices();
  }
  // หลายจุดน้ำท่วม: วงแดงมีหมายเลขกลางแต่ละช่วง ขนาดคงที่บนจอ — ซูมออกไกลแค่ไหนก็ยังเห็นตำแหน่ง
  function drawFloodNums() {
    const segs = [linePts('flood')].concat(extras().map(function (s, i) { const ep = linePts('fx' + i); return ep.length > 1 ? ep : has(s.a) ? [s.a] : []; }));
    if (segs.length < 2) return;
    segs.forEach(function (pts, i) {
      if (!pts.length) return;
      L.marker(LL(mid(pts)), { interactive: false, keyboard: false, zIndexOffset: 700,
        icon: L.divIcon({ className: 'pz-fnum', iconSize: [72, 72], iconAnchor: [36, 36], html: '<div><b>' + (i + 1) + '</b></div>' }) }).addTo(layers);
    });
  }
  // ลูกศรบอกทิศบนเส้น (แบบเตือนภัย / อินโฟกราฟิก)
  function drawChevrons() {
    deco.clearLayers();
    if (!plan || plan.kind === 'safety' || (!isDrain() && style() === 'doh')) return;
    (isDrain() ? [['drain', DRAIN]] : [['detour', style() === 'alert' ? GREEN : BLUE], ['flood', RED]].concat(hasDet2() ? [['detour2', PURPLE]] : [], extras().map(function (s, i) { return ['fx' + i, RED]; }))).forEach(function (x) {
      const pts = linePts(x[0]).map(px);
      if (pts.length < 2) return;
      const step = 120; let next = 60, cum = 0;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i], d = a.distanceTo(b);
        while (d > 0 && next <= cum + d) {
          const r = (next - cum) / d, ang = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
          const at = map.containerPointToLatLng(L.point(a.x + (b.x - a.x) * r, a.y + (b.y - a.y) * r));
          L.marker(at, { interactive: false, keyboard: false, icon: L.divIcon({ className: 'pz-chev', iconSize: [24, 24], iconAnchor: [12, 12],
            html: '<svg viewBox="0 0 24 24" style="transform:rotate(' + ang.toFixed(0) + 'deg)"><path d="M6 4 L17 12 L6 20" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' }) }).addTo(deco);
          next += step;
        }
        cum += d;
      }
    });
  }
  function drawSafety() {
    if (isDrain()) {
      (plan.waterLines || []).forEach(function (w) {
        L.polyline(RT.decode(w.line).map(LL), { color: WATER, weight: 7, opacity: .9, interactive: false }).addTo(layers);
      });
      const dp = linePts('drain');
      if (dp.length > 1) {
        L.polyline(dp.map(LL), { color: '#01579b', weight: 20, opacity: .85, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(layers);
        clickable(L.polyline(dp.map(LL), { color: DRAIN, weight: 14, opacity: 1, lineCap: 'round', lineJoin: 'round' }).addTo(layers), 'drain');
      }
      if (has(plan.drain.a)) L.marker(LL(plan.drain.a), { interactive: false, zIndexOffset: 800, icon: L.divIcon({ className: 'pz-dev', iconSize: [44, 57], iconAnchor: [22, 55], html: ICON.drop }) }).addTo(layers);
      if (has(plan.drain.b)) L.marker(LL(plan.drain.b), { interactive: false, zIndexOffset: 800, icon: L.divIcon({ className: 'pz-dev', iconSize: [48, 48], iconAnchor: [24, 24], html: ICON.outlet }) }).addTo(layers);
    }
    const zp = linePts('zone');
    if (zp.length > 1) {
      clickable(L.polyline(zp.map(LL), { color: ORANGE, weight: 20, opacity: .85, lineCap: 'butt' }).addTo(layers), 'zone');
      L.polyline(zp.map(LL), { color: '#fff', weight: 3, dashArray: '10 12', interactive: false }).addTo(layers);
    }
    drawDevices();
  }
  // อุปกรณ์/จุดน้ำท่วมที่วางเอง: ลากย้ายได้ · ดับเบิลคลิกแก้ข้อความ · คลิกขวาลบ
  function drawDevices() {
    (plan.devices || []).forEach(function (d, i) {
      if (!DEV[d.t] || !has(d)) return;
      const sz = DEV[d.t].size, withText = d.text && d.t !== 'speed' && d.t !== 'arrow';
      const m = L.marker(LL(d), { draggable: true, keyboard: false, zIndexOffset: d.t === 'cone' ? 0 : 500,
        icon: L.divIcon({ className: 'pz-dev', iconSize: [sz, sz], iconAnchor: [sz / 2, sz / 2],
          html: devSvg(d) + (withText ? '<div class="pz-devt">' + esc(d.text) + '</div>' : '') }) });
      m.on('dragend', function () { const l = m.getLatLng(); d.lat = +l.lat.toFixed(6); d.lng = +l.lng.toFixed(6); changed('devices'); });
      m.on('dblclick', function (e) {
        L.DomEvent.stop(e);
        if (['cone', 'barrier', 'light', 'flag'].indexOf(d.t) >= 0) return;
        const s = prompt(d.t === 'speed' ? 'ความเร็วที่จำกัด (กม./ชม.)' : d.t === 'flood' ? 'ชื่อจุดน้ำท่วม (เว้นว่าง = ไม่แสดงข้อความ)' : 'ข้อความบนป้าย', d.text || '');
        if (s !== null) { d.text = s.trim(); P.draw(); changed('devices'); }
      });
      m.on('contextmenu', function (e) {
        L.DomEvent.stop(e);
        if (confirm('ลบ "' + DEV[d.t].name + '" ชิ้นนี้ออกจากผัง?')) { plan.devices.splice(i, 1); P.draw(); changed('devices'); }
      });
      m.addTo(layers);
    });
  }

  /* ---------- ป้าย ---------- */
  let lblReg = [];   // ป้ายที่วาดอยู่ขณะนี้ (ใช้ตอนจัดป้ายไม่ให้ทับกัน)
  // ป้ายย่อ/ขยายได้: ชี้เมาส์ที่ป้ายแล้วกด ＋ / － (เก็บใน plan.pos[key].sc) · ลูกศรบอกทิศใช้ปุ่มหมุนของตัวเอง
  function scaledHtml(key, html) {
    if (html.indexOf('<div class="pz-dirwrap"') === 0) return html;
    const sc = (plan.pos[key] && +plan.pos[key].sc) || 1;
    return '<div class="pz-lwrap" style="transform:translate(-50%,-50%) scale(' + sc + ')">' + html +
      '<div class="pz-zm"><span data-z="1.1" title="ขยายป้าย">＋</span><span data-z="0.9" title="ย่อป้าย">－</span></div></div>';
  }
  // home = จุดที่ป้ายนี้หมายถึง (ป้ายที่ไม่มีเส้นโยง) — ถ้าป้ายถูกย้ายห่างจากจุดเกิน 110 พิกเซล จะมีเส้นโยงสีขาวบอกให้รู้ว่าหมายถึงตรงไหน
  function labelMarker(key, ll, html, anchorLL, leaderStyle, home) {
    const m = L.marker(ll, { draggable: true, keyboard: false, zIndexOffset: 1000,
      icon: L.divIcon({ className: 'pz-lbl', iconSize: [0, 0], html: scaledHtml(key, html) }) });
    m.on('click', function (e) {
      const t = e.originalEvent && e.originalEvent.target, z = t && t.dataset && +t.dataset.z;
      if (!z || !plan.pos[key]) return;
      const p = plan.pos[key];
      p.sc = Math.round(Math.min(3, Math.max(0.4, ((+p.sc || 1) * z))) * 100) / 100;
      m.setIcon(L.divIcon({ className: 'pz-lbl', iconSize: [0, 0], html: scaledHtml(key, html) }));
      changed('pos');
    });
    let leader = null;
    const tip = anchorLL || home || null, soft = !anchorLL;
    const lead = function (l) {
      if (!tip) return;
      const show = !soft || px(tip).distanceTo(px(l)) > 110;
      if (show && !leader) leader = L.polyline([tip, l], Object.assign({ color: RED, weight: 2.5, interactive: false }, soft ? { color: '#fff', weight: 3 } : leaderStyle || {})).addTo(layers);
      else if (!show && leader) { layers.removeLayer(leader); leader = null; }
      if (leader) leader.setLatLngs([tip, l]);
    };
    lead(LL(ll));
    m.on('drag', function () { lead(m.getLatLng()); });
    lblReg.push({ key: key, m: m, tip: tip, lead: !!anchorLL });
    m.on('dragend', function () { const l = m.getLatLng(); plan.pos[key] = Object.assign({}, plan.pos[key] || {}, { lat: l.lat, lng: l.lng }); changed('pos'); });
    m.addTo(layers);
    return m;
  }
  /* ---------- รูปแบบลูกศรบอกทิศ (plan.arrow / plan.arrowColor) — วาดชี้ขวา ฝั่งซ้ายกลับด้านเอง ---------- */
  const ARROWS = {
    line:    { name: 'เส้นตรงหัวสามเหลี่ยม (เดิม)', svg: function (c) { return '<path d="M6 28 H170" stroke="' + c + '" stroke-width="13" stroke-linecap="round"/><path d="M160 4 L216 28 L160 52 Z" fill="' + c + '"/>'; } },
    block:   { name: 'ลูกศรทึบ ขอบขาว', svg: function (c) { return '<path d="M5 17 H148 V4 L215 28 L148 52 V39 H5 Z" fill="' + c + '" stroke="#fff" stroke-width="4" stroke-linejoin="round"/>'; } },
    chevron: { name: 'ลูกศรบั้ง >>>', svg: function (c) { return [14, 80, 146].map(function (x) { return '<path d="M' + x + ' 7 L' + (x + 50) + ' 28 L' + x + ' 49" fill="none" stroke="#fff" stroke-width="22" stroke-linecap="round" stroke-linejoin="round"/><path d="M' + x + ' 7 L' + (x + 50) + ' 28 L' + x + ' 49" fill="none" stroke="' + c + '" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>'; }).join(''); } },
    dashed:  { name: 'เส้นประ', svg: function (c) { return '<path d="M8 28 H160" stroke="' + c + '" stroke-width="12" stroke-dasharray="24 13"/><path d="M156 5 L216 28 L156 51 Z" fill="' + c + '"/>'; } },
    curve:   { name: 'ลูกศรโค้ง (เลี้ยว)', svg: function (c) { return '<path d="M10 50 Q90 2 172 22" fill="none" stroke="' + c + '" stroke-width="12" stroke-linecap="round"/><path d="M160 2 L214 30 L156 46 Z" fill="' + c + '"/>'; } },
    sign:    { name: 'ป้ายลูกศร (พื้นสี)', svg: function (c) { return '<rect x="3" y="3" width="214" height="50" rx="10" fill="' + c + '" stroke="#fff" stroke-width="4"/><path d="M26 28 H170" stroke="#fff" stroke-width="10" stroke-linecap="round"/><path d="M158 12 L194 28 L158 44 Z" fill="#fff"/>'; } }
  };
  const ARROW_COLORS = { '#ff1a1a': 'แดง', '#1f6fe0': 'น้ำเงิน', '#1d8f2e': 'เขียว', '#ff8f00': 'ส้ม', '#ffc400': 'เหลือง', '#111111': 'ดำ' };
  P.ARROWS = ARROWS; P.ARROW_COLORS = ARROW_COLORS;
  P.arrowSvg = function (kind, color, left) {
    const a = ARROWS[kind] || ARROWS.line;
    return '<svg class="pz-arrow" viewBox="0 0 220 56" width="220" height="56" style="' + (left ? 'transform:scaleX(-1)' : '') + '">' + a.svg(ARROW_COLORS[color] ? color : '#ff1a1a') + '</svg>';
  };
  function arrowHtml(text, left, ang) {
    return '<div class="pz-dirwrap" style="transform:translate(-50%,-50%) rotate(' + (+ang || 0).toFixed(1) + 'deg)">' +
      '<div class="pz-dirtext">' + esc(text) + '</div>' +
      P.arrowSvg(plan.arrow, plan.arrowColor, left) +
      '<div class="pz-rot"><span data-d="-8" title="หมุนทวนเข็ม">⟲</span><span data-d="8" title="หมุนตามเข็ม">⟳</span></div></div>';
  }
  function mid(pts) { return pts[Math.floor(pts.length / 2)]; }
  function drawLabels() {
    const pos = plan.pos, key = mainKey(), r = routeOf(key), mp = linePts(key), st = style(), dp = isSafety() ? [] : linePts('detour');
    if (isDrain()) {
      if (pos.srcL && has(r.a)) labelMarker('srcL', LL(pos.srcL), '<div class="pz-call red small"><div>จุดน้ำท่วมขัง<small>' + esc(r.a.name || plan.place || '') + (r.a.km ? ' กม.' + esc(r.a.km) : '') + '</small></div></div>', LL(r.a), { color: '#fff', weight: 4 });
      if (pos.outL && has(r.b)) labelMarker('outL', LL(pos.outL), '<div class="pz-call blue small"><div>ระบายน้ำลง<small>' + esc(r.b.name || '') + '</small></div></div>', LL(r.b), { color: '#fff', weight: 4 });
      return;
    }
    if (st === 'alert') {
      if (pos.cG && dp.length > 1) labelMarker('cG', LL(pos.cG), '<div class="pz-call green">' + ICON.go + '<div>' + esc(plan.callGo || 'เส้นทางหลีกเลี่ยงน้ำท่วม') + '<br><em>(ใช้เส้นทางนี้)</em></div></div>', LL(mid(dp)), { color: '#fff', weight: 5 });
      if (pos.cR && mp.length > 1) labelMarker('cR', LL(pos.cR), '<div class="pz-call red">' + ICON.no + '<div>เส้นทางปกติ <em>(ควรเลี่ยง)</em><small>' + esc(plan.callNo || ('บริเวณ' + (plan.place || '') + ' น้ำท่วม' + (r.depth ? ' ' + depthTxt(r.depth) : ''))) + '</small></div></div>', LL(mid(mp)), { color: '#fff', weight: 5 });
      return;
    }
    const det2 = hasDet2() ? [['det2A', plan.detour2.a], ['det2B', plan.detour2.b]] : [];
    if (st === 'info') {
      if (pos.place && mp.length > 1) labelMarker('place', LL(pos.place), '<div class="pz-ired">' + ICON.cone + '<div>' + esc(plan.place || 'บริเวณน้ำท่วม') + '<br><small>(น้ำท่วมทาง' + (r.depth ? ' ' + depthTxt(r.depth) : '') + ')</small></div></div>', LL(mid(mp)), { color: RED, weight: 3 });
      [['detA', plan.detour.a], ['detB', plan.detour.b]].concat(det2).forEach(function (x) {
        if (!pos[x[0]] || !x[1].name) return;
        labelMarker(x[0], LL(pos[x[0]]), '<div class="pz-ipill"' + (x[0].indexOf('det2') === 0 ? ' style="background:' + PURPLE + '"' : '') + '>' + esc(x[1].name) + (x[1].km ? ' <small>กม.' + esc(x[1].km) + '</small>' : '') + '</div>', has(x[1]) ? LL(x[1]) : null, { color: '#fff', weight: 3 });
      });
      return;
    }
    // ชื่อบริเวณ + ระดับน้ำ ของแต่ละจุดท่วม
    const placeHtml = function (place, depth) {
      return '<div class="pz-stack">' + (place ? '<div class="pz-box">' + esc(place) + '</div>' : '') + (depth ? '<div class="pz-depth">' + ICON.drop + esc(depthTxt(depth)) + '</div>' : '') + '</div>';
    };
    // หลายสายทางในผังเดียว → ป้าย กม. บอกหมายเลขทางหลวงด้วย
    const multiRoad = !isSafety() && P.roads(plan).length > 1;
    const kmHtml = function (road, km) { return '<div class="pz-km">' + (multiRoad && road ? 'ทล.' + esc(road) + ' ' : '') + 'กม.' + esc(km) + '</div>'; };
    if (mp.length > 1) {
      if (pos.place && (plan.place || r.depth)) labelMarker('place', LL(pos.place), placeHtml(plan.place, r.depth), null, null, LL(mid(mp)));
      if (pos.kmA && r.a.km) labelMarker('kmA', LL(pos.kmA), kmHtml(plan.road, r.a.km), LL(mp[0]));
      if (pos.kmB && r.b.km) labelMarker('kmB', LL(pos.kmB), kmHtml(plan.road, r.b.km), LL(mp[mp.length - 1]));
    }
    // ช่วงน้ำท่วมเพิ่มเติม: ชื่อบริเวณ + ป้าย กม. ต้น/ปลาย
    extras().forEach(function (s, i) {
      const k = 'fx' + i, ep = linePts(k), anc = ep.length > 1 ? ep : has(s.a) ? [s.a] : [], road = s.road || plan.road;
      if (!anc.length) return;
      if (pos[k] && (s.place || s.depth)) labelMarker(k, LL(pos[k]), placeHtml(s.place, s.depth), null, null, LL(mid(anc)));
      if (pos[k + 'a'] && s.a.km) labelMarker(k + 'a', LL(pos[k + 'a']), kmHtml(road, s.a.km), LL(anc[0]));
      if (pos[k + 'b'] && s.b.km && anc.length > 1) labelMarker(k + 'b', LL(pos[k + 'b']), kmHtml(road, s.b.km), LL(anc[anc.length - 1]));
    });
    if (isSafety()) return;
    [['detA', plan.detour.a, dp], ['detB', plan.detour.b, dp]].concat(det2.map(function (x) { return x.concat([linePts('detour2')]); })).forEach(function (x) {
      const d = x[1];
      if (x[2].length < 2 || !pos[x[0]] || !(d.name || d.km)) return;
      const txt = [d.name, d.km ? 'กม.' + d.km : ''].filter(Boolean).join(' ');
      const two = x[0].indexOf('det2') === 0;
      labelMarker(x[0], LL(pos[x[0]]), '<div class="pz-stack"><div class="pz-box"' + (two ? ' style="color:' + PURPLE + '"' : '') + '>' + (two ? 'ทางเบี่ยงที่ 2' : det2.length ? 'ทางเบี่ยงที่ 1' : 'ทางเบี่ยง') + '</div><div class="pz-box">' + esc(txt) + '</div></div>', null, null, has(d) ? LL(d) : null);
    });
    [['arrL', plan.dirLeft, true], ['arrR', plan.dirRight, false]].forEach(function (x) {
      const p = pos[x[0]];
      if (!p || !x[1]) return;
      const m = labelMarker(x[0], LL(p), arrowHtml(x[1], x[2], p.ang));
      m.on('click', function (e) {
        const d = e.originalEvent && e.originalEvent.target && e.originalEvent.target.dataset && e.originalEvent.target.dataset.d;
        if (!d) return;
        p.ang = (+p.ang || 0) + (+d);
        m.setIcon(L.divIcon({ className: 'pz-lbl', iconSize: [0, 0], html: arrowHtml(x[1], x[2], p.ang) }));
        changed('pos');
      });
    });
  }

  // จัดตำแหน่งป้ายอัตโนมัติจากตำแหน่งเส้นบนจอขณะนี้
  P.autoLabels = function () {
    const old = plan.pos || {};
    autoPos();
    // จัดตำแหน่งใหม่แต่คงขนาดป้ายที่ผู้ใช้ย่อ/ขยายไว้
    Object.keys(plan.pos).forEach(function (k) { if (old[k] && old[k].sc) plan.pos[k].sc = old[k].sc; });
    P.draw();
    if (declutter()) P.draw();
    changed('pos');
  };

  // จัดป้ายไม่ให้ทับกัน: วัดขนาดป้ายจริงบนจอ แล้วลองวางรอบจุดที่ป้ายหมายถึงหลายทิศหลายระยะ
  // เลือกตำแหน่งที่ไม่ทับป้ายอื่น / กล่องคำอธิบาย / เส้นทาง / จุดปลายเส้น และอยู่ใกล้จุดที่สุด
  function declutter() {
    const size = map.getSize(), mc = map.getContainer(), mr = mc.getBoundingClientRect();
    const s = mr.width / (mc.offsetWidth || 1);
    if (!size.x || !size.y || !s || !lblReg.length) return false;
    const box = function (r) { return { x0: (r.left - mr.left) / s, y0: (r.top - mr.top) / s, x1: (r.right - mr.left) / s, y1: (r.bottom - mr.top) / s }; };
    const ov = function (a, b) { const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0); return w > 0 && h > 0 ? w * h : 0; };
    const inR = function (R, x, y, pad) { return x > R.x0 - pad && x < R.x1 + pad && y > R.y0 - pad && y < R.y1 + pad; };
    // กล่องที่วางทับแผนที่ (ขออภัย / คำอธิบาย / ทิศเหนือ / ปุ่มซูม ฯลฯ)
    const blocks = [];
    mc.parentNode.querySelectorAll('.pz-br > *, .pz-abanner, .pz-afoot, .pz-ilegend, .pz-north, .leaflet-control').forEach(function (el) {
      const r = el.getBoundingClientRect();
      if (r.width > 2 && r.height > 2) blocks.push(box(r));
    });
    // จุดบนเส้นทาง (ทุก ~14 พิกเซล) — ป้ายทับเส้นแดงเสียมากกว่าทับเส้นทางเบี่ยง
    const pts = [], hard = [];
    const addLine = function (arr, w) {
      const p = arr.map(px);
      if (p.length) { hard.push(p[0], p[p.length - 1]); }
      for (let i = 0; i < p.length; i++) {
        pts.push({ x: p[i].x, y: p[i].y, w: w });
        if (!i) continue;
        const a = p[i - 1], b = p[i], n = Math.floor(a.distanceTo(b) / 14);
        for (let j = 1; j < n; j++) pts.push({ x: a.x + (b.x - a.x) * j / n, y: a.y + (b.y - a.y) * j / n, w: w });
      }
    };
    addLine(linePts(mainKey()), 120);
    extras().forEach(function (x, i) { const ep = linePts('fx' + i); if (ep.length > 1) addLine(ep, 120); else if (has(x.a)) hard.push(px(x.a)); });
    if (!isSafety()) { addLine(linePts('detour'), 45); if (hasDet2()) addLine(linePts('detour2'), 45); }
    (plan.devices || []).filter(has).forEach(function (d) { const p = px(d); pts.push({ x: p.x, y: p.y, w: 40 }); });
    // ป้ายแต่ละอัน: ขนาดจริง + จุดที่หมายถึง
    const items = lblReg.map(function (o) {
      const el = o.m.getElement(), c = el && el.firstElementChild;
      if (!c) return null;
      const b = box(c.getBoundingClientRect()), cur = px(o.m.getLatLng());
      if (b.x1 - b.x0 < 2) return null;
      const tip = o.tip ? px(o.tip) : null;
      if (tip) hard.push(tip);
      return { o: o, w: b.x1 - b.x0, h: b.y1 - b.y0, dx: (b.x0 + b.x1) / 2 - cur.x, dy: (b.y0 + b.y1) / 2 - cur.y, cur: cur, tip: tip, lead: o.lead, c: cur };
    }).filter(Boolean);
    if (!items.length) return false;
    const rectAt = function (it, c) { return { x0: c.x + it.dx - it.w / 2 - 6, y0: c.y + it.dy - it.h / 2 - 6, x1: c.x + it.dx + it.w / 2 + 6, y1: c.y + it.dy + it.h / 2 + 6 }; };
    const clamp = function (it, c) {
      const hx = it.w / 2 + 8, hy = it.h / 2 + 8;
      return { x: hx * 2 > size.x ? size.x / 2 : Math.max(hx, Math.min(size.x - hx, c.x + it.dx)) - it.dx,
               y: hy * 2 > size.y ? size.y / 2 : Math.max(hy, Math.min(size.y - hy, c.y + it.dy)) - it.dy, bonus: c.bonus || 0 };
    };
    const segHitsRect = function (a, b, R) {
      const n = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 10));
      for (let j = 1; j < n; j++) if (inR(R, a.x + (b.x - a.x) * j / n, a.y + (b.y - a.y) * j / n, 0)) return true;
      return false;
    };
    const cross = function (a, b, c, d) {
      const o = function (p, q, r) { return (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x); };
      return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
    };
    const cands = function (it) {
      const out = [clamp(it, { x: it.cur.x, y: it.cur.y, bonus: -40 })];
      const t = it.tip || it.cur, rs = it.tip ? [0, 40, 90, 150, 230, 320] : [30, 60, 100, 150];
      for (let k = 0; k < 16; k++) {
        const a = k * Math.PI / 8, ux = Math.cos(a), uy = Math.sin(a);
        const clr = it.tip ? Math.abs(ux) * it.w / 2 + Math.abs(uy) * it.h / 2 + 26 : 0;
        rs.forEach(function (r) { out.push(clamp(it, { x: t.x + ux * (clr + r) - it.dx, y: t.y + uy * (clr + r) - it.dy })); });
      }
      return out;
    };
    const score = function (it, c, others) {
      const R = rectAt(it, c);
      let sc = c.bonus;
      others.forEach(function (p) {
        const a = ov(R, p.R);
        if (a) sc += 20000 + a * 20;
        if (it.lead && segHitsRect(it.tip, c, p.R)) sc += 3000;
        if (p.it.lead && segHitsRect(p.it.tip, p.c, R)) sc += 3000;
        if (it.lead && p.it.lead && cross(it.tip, c, p.it.tip, p.c)) sc += 1500;
      });
      blocks.forEach(function (b) { const a = ov(R, b); if (a) sc += 20000 + a * 20; });
      pts.forEach(function (p) { if (inR(R, p.x, p.y, 0)) sc += p.w; });
      hard.forEach(function (h) { if (inR(R, h.x, h.y, 10)) sc += 6000; });
      const ref = it.tip || it.cur;
      sc += Math.hypot(c.x - ref.x, c.y - ref.y) * (it.lead ? 1.5 : 3);
      return sc;
    };
    const best = function (it, others) {
      let bc = null, bs = Infinity;
      cands(it).forEach(function (c) { const v = score(it, c, others); if (v < bs) { bs = v; bc = c; } });
      return bc;
    };
    // ลำดับ: ชื่อบริเวณ/ระดับน้ำ → ป้าย กม. → ทางเบี่ยง → ลูกศรบอกทิศ (ป้ายสำคัญได้ที่ดีก่อน)
    const rank = function (k) { return /^(place|fx\d+|cR|cG|srcL|outL)$/.test(k) ? 0 : /^arr/.test(k) ? 3 : /^det/.test(k) ? 2 : 1; };
    items.sort(function (a, b) { return rank(a.o.key) - rank(b.o.key); });
    const done = [];
    items.forEach(function (it) { it.c = best(it, done); done.push({ it: it, c: it.c, R: rectAt(it, it.c) }); });
    // รอบสอง: ปรับแต่ละป้ายอีกครั้งโดยเห็นตำแหน่งป้ายอื่นทั้งหมดแล้ว
    for (let pass = 0; pass < 2; pass++) {
      done.forEach(function (d) {
        const others = done.filter(function (x) { return x !== d; });
        d.c = d.it.c = best(d.it, others); d.R = rectAt(d.it, d.c);
      });
    }
    done.forEach(function (d) {
      const k = d.it.o.key;
      plan.pos[k] = Object.assign({}, plan.pos[k] || {}, geo(L.point(d.c.x, d.c.y)));
    });
    return true;
  }
  function autoPos() {
    const pos = plan.pos = {}, st = style();
    const mp = linePts(mainKey()), dp = isSafety() ? [] : linePts('detour');
    const size = map.getSize();
    if (isDrain()) {
      const r = plan.drain;
      if (has(r.a)) { const a = px(r.a); pos.srcL = geo(clampPt(L.point(a.x + (a.x < size.x / 2 ? -200 : 200), a.y - 120), 200, 70)); }
      if (has(r.b)) { const b = px(r.b); pos.outL = geo(clampPt(L.point(b.x + (b.x < size.x / 2 ? -200 : 200), b.y + 110), 200, 70)); }
      return;
    }
    if (st === 'alert') {
      // กล่องเขียวไปทางฝั่งทางเบี่ยง กล่องแดงไปฝั่งตรงข้าม (ไม่ทับกัน)
      const g = dp.length > 1 ? px(mid(dp)) : null, f = mp.length > 1 ? px(mid(mp)) : null;
      let ux = 0, uy = 1;
      if (g && f) { const dx = g.x - f.x, dy = g.y - f.y, L0 = Math.hypot(dx, dy); if (L0 > 20) { ux = dx / L0; uy = dy / L0; } }
      if (g) pos.cG = geo(clampPt(L.point(g.x + ux * 200, g.y + uy * 200), 260, 330));
      if (f) pos.cR = geo(clampPt(L.point(f.x - ux * 220, f.y - uy * 220), 260, 330));
      if (pos.cG && pos.cR) {   // ยังชิดกันเกินไป → ดันแยกแนวตั้ง
        const a = px(pos.cG), b = px(pos.cR);
        if (Math.abs(a.y - b.y) < 170 && Math.abs(a.x - b.x) < 560) {
          const up = a.y <= b.y ? -1 : 1;
          pos.cG = geo(clampPt(L.point(a.x, a.y + up * 100), 260, 330));
          pos.cR = geo(clampPt(L.point(b.x, b.y - up * 100), 260, 330));
        }
      }
      return;
    }
    if (st === 'info') {
      if (mp.length > 1) { const f = px(mid(mp)); pos.place = geo(clampPt(L.point(f.x, f.y + 120), 200, 120)); }
      if (dp.length > 1) {
        const A = px(dp[0]), B = px(dp[dp.length - 1]);
        pos.detA = geo(clampPt(L.point(A.x, A.y - 70), 170, 130));
        pos.detB = geo(clampPt(L.point(B.x, B.y - 70), 170, 130));
      }
      const d2 = hasDet2() ? linePts('detour2') : [];
      if (d2.length > 1) {
        const A = px(d2[0]), B = px(d2[d2.length - 1]);
        pos.det2A = geo(clampPt(L.point(A.x, A.y + 70), 170, 130));
        pos.det2B = geo(clampPt(L.point(B.x, B.y + 70), 170, 130));
      }
      return;
    }
    if (mp.length > 1) {
      const a = px(mp[0]), b = px(mp[mp.length - 1]), m = px(mid(mp));
      pos.place = geo(clampPt(L.point(m.x, Math.min(a.y, b.y, m.y) - 80), 220, 60));
      let ax = a.x, bx = b.x;
      const gap = 330;
      if (Math.abs(ax - bx) < gap) { const c = (ax + bx) / 2, s = ax <= bx ? -1 : 1; ax = c + s * gap / 2; bx = c - s * gap / 2; }
      pos.kmA = geo(clampPt(L.point(ax, a.y + 140), 170, 50));
      pos.kmB = geo(clampPt(L.point(bx, b.y + 140), 170, 50));
    }
    extras().forEach(function (s, i) {
      const k = 'fx' + i, ep = linePts(k);
      if (ep.length > 1) {
        const a = px(ep[0]), b = px(ep[ep.length - 1]), m = px(mid(ep));
        let ax = a.x, bx = b.x;
        if (Math.abs(ax - bx) < 330) { const c = (ax + bx) / 2, sg = ax <= bx ? -1 : 1; ax = c + sg * 165; bx = c - sg * 165; }
        pos[k + 'a'] = geo(clampPt(L.point(ax, a.y + 140), 170, 50));
        pos[k + 'b'] = geo(clampPt(L.point(bx, b.y + 140), 170, 50));
        pos[k] = geo(clampPt(L.point(m.x, Math.min(a.y, b.y, m.y) - 80), 220, 60));
      } else if (has(s.a)) {
        const a = px(s.a);
        pos[k + 'a'] = geo(clampPt(L.point(a.x, a.y + 110), 170, 50));
        pos[k] = geo(clampPt(L.point(a.x, a.y - 80), 220, 60));
      }
    });
    if (dp.length > 1) {
      const A = px(dp[0]), B = px(dp[dp.length - 1]);
      pos.detA = geo(clampPt(L.point(A.x, A.y - 105), 240, 70));
      pos.detB = geo(clampPt(L.point(B.x, B.y - 105), 240, 70));
      const Lp = A.x <= B.x ? A : B, Rp = A.x <= B.x ? B : A;
      const th = Math.atan2(Rp.y - Lp.y, Rp.x - Lp.x), deg = th * 180 / Math.PI;
      pos.arrL = Object.assign(geo(clampPt(L.point(Lp.x - Math.cos(th) * 330, Lp.y - Math.sin(th) * 330 - 170), 150, 90)), { ang: deg });
      pos.arrR = Object.assign(geo(clampPt(L.point(Rp.x + Math.cos(th) * 330, Rp.y + Math.sin(th) * 330 - 170), 150, 90)), { ang: deg });
    }
    // ทางเบี่ยงที่ 2: ป้ายไว้ใต้จุด (ไม่ชนป้ายทางเบี่ยงที่ 1 ที่อยู่เหนือจุด)
    const d2 = hasDet2() ? linePts('detour2') : [];
    if (d2.length > 1) {
      const A = px(d2[0]), B = px(d2[d2.length - 1]);
      pos.det2A = geo(clampPt(L.point(A.x, A.y + 105), 240, 70));
      pos.det2B = geo(clampPt(L.point(B.x, B.y + 105), 240, 70));
    }
  }

  // ซูมให้เห็นทุกอย่าง (เว้นที่ให้หัวผัง ป้าย และกล่องคำอธิบาย)
  P.fit = function () {
    let all = linePts(mainKey());
    all = all.concat((plan.devices || []).filter(has));
    if (!isSafety()) all = all.concat(linePts('detour'));
    if (hasDet2()) all = all.concat(linePts('detour2'));
    extras().forEach(function (s, i) { const ep = linePts('fx' + i); all = all.concat(ep.length ? ep : has(s.a) ? [s.a] : []); });
    if (!all.length) return;
    const st = style();
    // ผังความปลอดภัย/ระบายน้ำ: ดันเนื้อหาขึ้นครึ่งบน เว้นมุมขวาล่างให้กล่องคำอธิบาย (รายการยาว)
    const pad = st === 'alert' ? [[150, 360], [150, 170]] : st === 'info' ? [[140, 130], [140, 110]] : isSafety() ? [[170, 150], [170, 400]] : [[260, 190], [260, 170]];
    map.fitBounds(L.latLngBounds(all.map(LL)), { paddingTopLeft: pad[0], paddingBottomRight: pad[1], animate: false, maxZoom: 19 });
  };

  /* ---------- ข้อมูลอ้างอิง (refdata.js จากไฟล์ Google Earth ของแขวงฯ) ----------
     plan.ref = { pts: 'none' | 'all' | 'sel', sel: [id จุดที่เลือก], lbl: แสดงชื่อจุด, routes: เส้นสายทางควบคุม, tambon: ขอบเขตตำบล, tambonLbl: ชื่อตำบล }
     โหมด 'sel' จุดที่ยังไม่เลือกแสดงจาง (คลิกเพื่อเลือก) และไม่ติดไปในรูป/งานพิมพ์ · ขณะเลือกพิกัด (📍) แสดงทุกจุดให้คลิกใช้ */
  const REF = window.REFDATA || { pts: [], routes: [], tambon: [] };
  P.refPts = REF.pts.map(function (r) { return { id: r[0] + '|' + r[1], road: r[0], km: r[1], name: r[2], lat: r[3], lng: r[4] }; });
  function drawRef() {
    const c = plan.ref || {}, mode = c.pts || 'none', sel = c.sel || [];
    const key = JSON.stringify(c) + (P.onPick ? '|pick' : '');
    if (key === refKey) return;
    refKey = key;
    refBack.clearLayers(); refPts.clearLayers();
    if (c.tambon) REF.tambon.forEach(function (t) {
      L.polygon(t.r, { pane: 'refTb', color: '#ffe600', weight: 3, dashArray: '12 8', fill: false, interactive: false }).addTo(refBack);
      if (c.tambonLbl !== false && t.c) L.marker(t.c, { pane: 'refTb', interactive: false, keyboard: false, icon: L.divIcon({ className: 'pz-reftb', iconSize: [0, 0], html: '<div>' + esc(t.n) + '</div>' }) }).addTo(refBack);
    });
    if (c.routes) REF.routes.forEach(function (r) {
      L.polyline(r.p, { pane: 'refRt', color: r.col, weight: 6, opacity: .8 })
        .bindTooltip('สายทาง ' + esc(r.c.slice(0, -4)) + ' ตอนควบคุม ' + esc(r.c.slice(-4)) + '<br>' + esc(r.n) + (r.k ? ' (กม.' + esc(r.k) + ')' : ''), { sticky: true })
        .addTo(refBack);
    });
    if (mode === 'none' && !P.onPick) return;
    P.refPts.forEach(function (p) {
      const on = mode === 'all' || (mode === 'sel' && sel.indexOf(p.id) >= 0);
      if (!on && mode !== 'sel' && !P.onPick) return;
      const tip = 'ทล.' + p.road + ' กม.' + p.km + ' ' + p.name;
      const m = L.marker([p.lat, p.lng], { keyboard: false, zIndexOffset: -800,
        icon: L.divIcon({ className: 'pz-refpt' + (on ? '' : ' pz-refghost'), iconSize: [0, 0],
          html: '<div title="' + esc(tip) + '"><i></i>' + (on && c.lbl !== false ? '<span>' + esc(p.name) + '<small>ทล.' + esc(p.road) + ' กม.' + esc(p.km) + '</small></span>' : '') + '</div>' }) });
      m.on('click', function (e) {
        L.DomEvent.stop(e);
        const ll = L.latLng(p.lat, p.lng);
        if (P.onPick) { const f = P.onPick; P.onPick = null; sheet.classList.remove('placing'); drawRef(); f(ll, p); return; }
        if (placing) { placeAt(ll); return; }
        if (mode !== 'sel') return;
        plan.ref = Object.assign({}, c, { sel: on ? sel.filter(function (x) { return x !== p.id; }) : sel.concat([p.id]) });
        drawRef(); changed('ref');
      });
      m.addTo(refPts);
    });
  }
  P.drawRef = function () { if (plan) drawRef(); };

  /* ---------- วางอุปกรณ์เพิ่มเอง ---------- */
  P.startPlacing = function (t) { placing = t; sheet.classList.toggle('placing', !!t); };
  P.pick = function (cb) { P.onPick = cb; placing = null; sheet.classList.add('placing'); drawRef(); };
  function placeAt(ll) {
    const t = placing;
    const d = { t: t, lat: +ll.lat.toFixed(6), lng: +ll.lng.toFixed(6) };
    if (t === 'sign') d.text = prompt('ข้อความบนป้าย', 'งานข้างหน้า') || '';
    if (t === 'speed') d.text = prompt('ความเร็วที่จำกัด (กม./ชม.)', '60') || '60';
    if (t === 'arrow') d.text = confirm('ลูกศรชี้ขวา (ให้ชิดขวา)?\nกด "ยกเลิก" = ชี้ซ้าย') ? 'ชิดขวา' : 'ชิดซ้าย';
    if (t === 'end') d.text = 'สิ้นสุดเขต' + (plan.workType || 'งาน');
    if (t === 'flood') {
      const s = prompt('ชื่อจุดน้ำท่วม เช่น บ้านซ่น กม.233+100 (เว้นว่าง = ไม่แสดงข้อความ)', '');
      if (s === null) return;
      d.text = s.trim();
    }
    plan.devices = plan.devices || [];
    plan.devices.push(d);
    if (t !== 'cone') P.startPlacing(null);
    P.draw();
    changed('devices');
    if (P.onPlaced) P.onPlaced(placing);
  }

  /* ---------- ปรับเส้นด้วยการลากจุด ---------- */
  function ctrlPts(key) { const r = routeOf(key); return [r.a].concat(r.via || [], [r.b]); }
  function select(key) {
    selected = key; sidePick = false;
    handles.clearLayers();
    if (key) drawHandles();
    renderSide();
    if (P.onSelect) P.onSelect(key);
  }
  /* ---------- เลือกฝั่งทาง (ถนนมีเกาะกลาง) ----------
     r.side: '' อัตโนมัติ · 'L' ฝั่งซ้ายของทิศ ต้น→ปลาย · 'R' ฝั่งขวา · 'line' เส้นตรงตามจุดที่ลาก (ไม่วิ่งตามถนน) */
  const SIDE_NAME = { '': 'อัตโนมัติ', L: 'ฝั่งซ้าย (ตามทิศจุดต้น → จุดปลาย)', R: 'ฝั่งขวา (ตามทิศจุดต้น → จุดปลาย)', line: 'เส้นตรงตามจุดที่ลาก' };
  function renderSide() {
    if (!sideBar) return;
    const r = selected && selected !== 'drain' ? routeOf(selected) : null;
    sideBar.style.display = r ? '' : 'none';
    sideBar.classList.toggle('picking', sidePick);
    if (!r) return;
    const s = r.side || '';
    const btn = function (k, t) { return '<button type="button" data-s="' + k + '"' + ((k === s && k !== 'pick') || (k === 'pick' && sidePick) ? ' class="on"' : '') + '>' + t + '</button>'; };
    sideBar.innerHTML = '<b>แนวเส้น: ' + SIDE_NAME[s] + '</b>' +
      (sidePick ? '<div class="pz-side-tip">คลิกบนแผนที่ฝั่งทางที่ต้องการ (ใกล้ช่องจราจรนั้น)</div>' : '') +
      '<div>' + btn('pick', '👆 คลิกเลือกฝั่งทาง') + btn('swap', '⇅ สลับฝั่ง') + '</div>' +
      '<div>' + btn('', 'อัตโนมัติ') + btn('line', '✏️ เส้นตรงตามจุดที่ลาก') + '</div>';
  }
  function sideCmd(k) {
    const r = selected && routeOf(selected);
    if (!r) return;
    if (k === 'pick') { sidePick = !sidePick; renderSide(); return; }
    sidePick = false;
    r.side = k === 'swap' ? (r.side === 'L' ? 'R' : 'L') : k;
    renderSide();
    rebuild(selected);
  }
  function sideAt(ll) {
    const key = selected, pts = key ? ctrlPts(key).filter(has).map(px) : [];
    sidePick = false;
    if (pts.length < 2) { renderSide(); return; }
    const p = map.latLngToContainerPoint(ll);
    let best = 1, bd = Infinity;
    for (let j = 1; j < pts.length; j++) { const d = L.LineUtil.pointToSegmentDistance(p, pts[j - 1], pts[j]); if (d < bd) { bd = d; best = j; } }
    const a = pts[best - 1], b = pts[best];
    // พิกัดจอ (แกน y ชี้ลง): ผลคูณไขว้ติดลบ = อยู่ซ้ายของทิศ a→b
    routeOf(key).side = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) < 0 ? 'L' : 'R';
    renderSide();
    rebuild(key);
  }
  P.select = select;
  function drawHandles() {
    handles.clearLayers();
    const key = selected, r = routeOf(key);
    if (!r) { selected = null; return; }
    const pts = ctrlPts(key);
    const color = key === 'flood' || isExtra(key) ? RED : key === 'zone' ? ORANGE : key === 'detour2' ? PURPLE : (style() === 'alert' ? '#1d8f2e' : BLUE);
    pts.forEach(function (p, i) {
      if (!has(p)) return;
      const end = i === 0 || i === pts.length - 1;
      const m = L.marker(LL(p), { draggable: true, keyboard: false, zIndexOffset: 3000,
        icon: L.divIcon({ className: 'pz-h' + (end ? ' end' : ''), iconSize: [30, 30], iconAnchor: [15, 15], html: '<div style="--c:' + color + '"></div>' }) });
      m.on('dragend', function () {
        const l = m.getLatLng(), v = { lat: +l.lat.toFixed(6), lng: +l.lng.toFixed(6) };
        if (i === 0) Object.assign(r.a, v); else if (i === pts.length - 1) Object.assign(r.b, v); else r.via[i - 1] = v;
        rebuild(key, end);
      });
      m.on('dblclick', function (e) {
        L.DomEvent.stop(e);
        if (end) return;
        r.via.splice(i - 1, 1);
        rebuild(key);
      });
      m.addTo(handles);
    });
  }
  function lineClick(key, ll) {
    if (sidePick) { sideAt(ll); return; }
    if (placing) { placeAt(ll); return; }
    if (selected !== key) { select(key); return; }
    addVia(key, ll, ll);
    drawHandles();
    changed('route');
  }
  // แทรกจุดใหม่ (to) ให้อยู่ลำดับที่ถูกต้องตามแนวเส้น ณ ตำแหน่งที่กดบนเส้น (at)
  function addVia(key, at, to) {
    const line = linePts(key).map(px);
    const near = function (pt) {
      let best = 0, bd = Infinity;
      for (let j = 1; j < line.length; j++) { const d = L.LineUtil.pointToSegmentDistance(pt, line[j - 1], line[j]); if (d < bd) { bd = d; best = j; } }
      return best;
    };
    const c = near(map.latLngToContainerPoint(at));
    const r = routeOf(key), via = r.via = r.via || [];
    let k = via.length, prev = 0;
    for (let i = 0; i < via.length; i++) { let s = near(px(via[i])); if (s < prev) s = prev; prev = s; if (s >= c) { k = i; break; } }
    via.splice(k, 0, { lat: +to.lat.toFixed(6), lng: +to.lng.toFixed(6) });
  }
  /* กดค้างบนเส้นแล้วลากไปวางบนถนนที่ต้องการ (แบบ Google Maps) → เพิ่มจุดบังคับ แล้วเส้นวิ่งตามถนนใหม่ */
  function bend(key, e) {
    const ev = e.originalEvent;
    if (ev.button || placing || sidePick || P.onPick || key === 'drain') return;
    L.DomEvent.preventDefault(ev);
    const at = e.latlng, p0 = e.containerPoint;
    let to = null, ghost = null;
    map.dragging.disable();
    const move = function (m) {
      if (!to && m.containerPoint.distanceTo(p0) < 8) return;   // ขยับนิดเดียว = คลิกธรรมดา
      to = m.latlng;
      if (!ghost) {
        const color = key === 'detour2' ? PURPLE : key === 'zone' ? ORANGE : key === 'flood' || isExtra(key) ? RED : (style() === 'alert' ? '#1d8f2e' : BLUE);
        ghost = L.marker(to, { interactive: false, zIndexOffset: 3000,
          icon: L.divIcon({ className: 'pz-h', iconSize: [30, 30], iconAnchor: [15, 15], html: '<div style="--c:' + color + '"></div>' }) }).addTo(handles);
        map.getContainer().style.cursor = 'grabbing';
      }
      ghost.setLatLng(to);
    };
    const up = function () {
      map.off('mousemove', move);
      document.removeEventListener('mouseup', up, true);
      map.dragging.enable();
      map.getContainer().style.cursor = '';
      if (!to) return;
      bent = true; setTimeout(function () { bent = false; }, 0);   // กันคลิกที่ตามมาหลังปล่อยเมาส์
      if (selected !== key) { selected = key; renderSide(); if (P.onSelect) P.onSelect(key); }
      addVia(key, at, to);
      rebuild(key);
    };
    map.on('mousemove', move);
    document.addEventListener('mouseup', up, true);
  }
  async function rebuild(key, endMoved) {
    if (key === 'drain') {   // แนวระบายน้ำไม่วิ่งตามถนน: ลากเป็นเส้นตรงผ่านจุดควบคุม
      const pts = ctrlPts(key).filter(has);
      plan.drainLine = RT.encode(pts); plan.drainLen = RT.length(pts);
      P.draw(); changed(endMoved ? 'coords' : 'route');
      return;
    }
    if (P.onBusy) P.onBusy('กำลังคำนวณเส้นทางตามถนน...');
    try {
      const res = await RT.route(ctrlPts(key), routeOf(key).side);
      if (isExtra(key)) { const r = routeOf(key); r.line = RT.encode(res.pts); r.len = res.distance; }
      else { plan[lineField(key)] = RT.encode(res.pts); plan[key + 'Len'] = res.distance; }
      if (P.onBusy) P.onBusy('');
    } catch (e) { if (P.onBusy) P.onBusy('ลากตามถนนไม่สำเร็จ: ' + e.message, true); }
    P.draw();
    changed(endMoved ? 'coords' : 'route');
  }

  /* ---------- ส่งออก ---------- */
  function filter(n) {
    return !(n.classList && (n.classList.contains('leaflet-control-zoom') || n.classList.contains('pz-rot') || n.classList.contains('pz-h') || n.classList.contains('pz-refghost') || n.classList.contains('pz-side') || n.classList.contains('pz-zm')));
  }
  P.exportPng = async function (name) {
    select(null);
    if (!window.htmlToImage) throw new Error('โหลดตัวสร้างรูปไม่ได้ (ต้องต่ออินเทอร์เน็ต)');
    const st = STY[style()];
    const url = await htmlToImage.toPng(sheet, { width: st.w, height: st.h, pixelRatio: 1, style: { transform: 'none', left: '0' }, filter: filter });
    const a = document.createElement('a');
    a.href = url; a.download = name + '.png'; a.click();
  };
  P.print = function () {
    select(null);
    const st = STY[style()], portrait = st.h > st.w;
    // ย่อให้พอดีหน้า A4 (96 dpi: 297×210 มม. ≈ 1122×793 px ลบขอบ)
    const pw = portrait ? 756 : 1085, ph = portrait ? 1085 : 756;
    const s = Math.min(pw / st.w, ph / st.h);
    document.getElementById('pageStyle').textContent = '@page{size:A4 ' + (portrait ? 'portrait' : 'landscape') + ';margin:5mm}';
    document.body.classList.add('printing-poster');
    sheet.style.transform = 'scale(' + s + ')'; sheet.style.left = '0';
    const done = function () { document.body.classList.remove('printing-poster'); window.removeEventListener('afterprint', done); P.scale(); };
    window.addEventListener('afterprint', done);
    setTimeout(function () { window.print(); }, 200);
  };
})();
