/* ==========================================================================
   ai.js — ผู้ช่วยกรอกข้อมูลผัง
     1) อ่านเอง (ไม่ใช้ AI): ดึงพิกัด / กม. / ชื่อจุด จากข้อความหรือลิงก์ Google Maps ด้วยกฎของระบบ
     2) AI (Claude): อ่านข้อความยาว ๆ จาก LINE/หนังสือ หรือรูปภาพ (ภาพหน้าจอ/ภาพถ่ายป้าย) แล้วกรอกให้ครบ
        ต้องใส่ Anthropic API key ที่หน้า "ตั้งค่า" (เก็บเฉพาะในเบราว์เซอร์เครื่องนี้ ไม่ขึ้นฐานข้อมูล)
   ========================================================================== */
(function () {
  'use strict';
  const KEY = 'tp_ai_v1';
  const SDK = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk/+esm';
  const MODELS = [
    { key: 'claude-opus-5', name: 'Claude Opus 5 (แม่นยำที่สุด · แนะนำ)' },
    { key: 'claude-sonnet-5', name: 'Claude Sonnet 5 (ประหยัดกว่า)' },
    { key: 'claude-haiku-4-5', name: 'Claude Haiku 4.5 (ถูกและเร็วที่สุด)' }
  ];
  const AI = window.AI = { MODELS: MODELS };

  AI.config = function () { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };
  AI.saveConfig = function (c) { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) { /* ข้าม */ } };
  AI.clearConfig = function () { try { localStorage.removeItem(KEY); } catch (e) { /* ข้าม */ } };
  AI.ready = function () { return !!AI.config().key; };

  /* ---------------- 1) อ่านเอง ---------------- */
  // พิกัดจากข้อความหรือลิงก์ Google Maps: "12.77, 101.71" · "@12.77,101.71" · "q=12.77,101.71" · "!3d12.77!4d101.71"
  AI.coords = function (s) {
    s = String(s || '');
    let m = s.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || s.match(/[@=](-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/) ||
      s.match(/(-?\d{1,2}\.\d{3,})\s*[,\s]\s*(-?\d{1,3}\.\d{3,})/);
    if (!m) return null;
    let lat = +m[1], lng = +m[2];
    if (Math.abs(lat) > 90 && Math.abs(lng) <= 90) { const t = lat; lat = lng; lng = t; }
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat: +lat.toFixed(6), lng: +lng.toFixed(6) };
  };
  function km(s) { const m = String(s || '').match(/(\d{1,4})\s*\+\s*(\d{3})/); return m ? m[1] + '+' + m[2] : ''; }
  function cleanName(s) {
    return String(s || '')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/-?\d{1,3}\.\d{3,}\s*[, ]\s*-?\d{1,3}\.\d{3,}/g, ' ')
      .replace(/\b(lat(itude)?|long(itude)?|lng|lon)\b\s*:?/gi, ' ')
      .replace(/กม\.?\s*\d{1,4}\s*\+\s*\d{3}/g, ' ').replace(/\d{1,4}\s*\+\s*\d{3}/g, ' ')
      .replace(/พิกัด\s*:?/g, ' ').replace(/[()（）]/g, ' ')
      .replace(/^[\s,:;|\-–•*]+|[\s,:;|\-–•*]+$/g, '').replace(/\s{2,}/g, ' ').trim();
  }
  // ชื่อจุดที่รู้พิกัดแล้ว (known = [{name, km, lat, lng}]) ที่ปรากฏในบรรทัด เรียงตามลำดับที่เขียน
  const norm = function (s) { return String(s || '').toLowerCase().replace(/[\s.,:;\-–()（）'"“”]/g, ''); };
  const bare = function (s) { return norm(s).replace(/^(ทางแยก|สี่แยก|สามแยก|แยก|วงเวียน|จุด)/, ''); };
  function knownIn(line, known) {
    const L = norm(line).split(''), hits = [];
    (known || []).map(function (q) { return { q: q, keys: [norm(q.name), bare(q.name)] }; })
      .sort(function (a, b) { return b.keys[0].length - a.keys[0].length; })   // ชื่อยาวก่อน กัน "ตะพง" ทับ "แยกตะพง"
      .forEach(function (o) {
        o.keys.some(function (k) {
          if (k.length < 3) return false;
          const i = L.join('').indexOf(k);
          if (i < 0) return false;
          for (let j = i; j < i + k.length; j++) L[j] = '\u0000';   // กันชื่อสั้นกว่ามาจับซ้ำ
          hits.push({ i: i, q: o.q });
          return true;
        });
      });
    return hits.sort(function (a, b) { return a.i - b.i; }).map(function (h) { return h.q; });
  }
  AI.parseLocal = function (text, known) {
    const out = { flood: [], detour: [], zone: [], drain: [] };
    let ctx = null;
    String(text || '').split(/\r?\n/).forEach(function (line) {
      const t = line.trim();
      if (!t) return;
      if (/ระบาย|ท่วมขัง/.test(t)) ctx = 'drain';
      else if (/เบี่ยง|เลี่ยง/.test(t)) ctx = 'detour';
      else if (/ท่วม/.test(t)) ctx = 'flood';
      else if (/ก่อสร้าง|อุบัติเหตุ|ซ่อม|บำรุง|ปิดช่อง|เขตงาน/.test(t)) ctx = 'zone';
      const c = AI.coords(t);
      if (!c) {
        // ไม่มีพิกัดในบรรทัด: หาชื่อจุดที่เคยลงพิกัดไว้ เช่น "ทางเบี่ยง แยกตะพง ถึง แยกศาลาสังสี"
        const hits = knownIn(t, known);
        hits.forEach(function (q) {
          out[ctx || 'flood'].push({ name: q.name, km: hits.length === 1 && km(t) ? km(t) : (q.km || ''), lat: q.lat, lng: q.lng });
        });
        return;
      }
      (out[ctx || 'flood']).push(Object.assign({ name: cleanName(t.replace(/^(จุด)?(น้ำท่วม|ทางเบี่ยง|เลี่ยง|เริ่ม|สิ้นสุด|ต้น|ปลาย)\S*\s*:?/, '')), km: km(t) }, c));
    });
    const all = String(text || '');
    const road = (all.match(/(?:ทางหลวง(?:หมายเลข)?|ทล\.?)\s*(\d{1,4})/) || [])[1] || '';
    const stop = '(?=\\s+(?:บริเวณ|กม|จุด|ช่วง|ทางเบี่ยง|พิกัด)|\\s{2,}|\\n|$)';
    const section = ((all.match(new RegExp('ตอน(?:ควบคุม)?\\s*([^\\n,]+?)' + stop)) || [])[1] || '').trim();
    const place = ((all.match(new RegExp('บริเวณ\\s*([^\\n,]+?)' + stop)) || [])[1] || '').trim();
    const pair = function (a) { return { a: a[0] || null, b: a[1] || null }; };
    return { road: road, section: section, place: cleanName(place), flood: pair(out.flood), detour: pair(out.detour), zone: pair(out.zone), drain: { a: out.drain[0] || out.flood[0] || null } };
  };

  /* ---------- อ่านรายการจุดน้ำท่วมหลายจุด (สายทางเดียวกัน) ----------
     รับข้อความแบบ
       หมายเลขทางหลวง: 3574 ตอนควบคุม บ้านค่าย - ระยอง ช่วง กม.: 44+000 ถึง กม.: 46+000 ระดับน้ำ: 30 เซ็นติเมตร
       เริ่ม 12.83, 101.29   สิ้นสุด 12.82, 101.30
       (จุดถัดไป ...)
       ทางเบี่ยง ... พิกัด ... ถึง ... พิกัด ...
     คืน { road, section, floods:[{road, section, kmA, kmB, depth, place, a, b}], detours:[{a, b}] } — แต่ละจุดอยู่คนละสายทางได้ — a/b = {name, km, lat, lng} หรือ null */
  AI.parseFloods = function (text) {
    const all = String(text || '');
    const out = { road: '', section: '', floods: [], detours: [] };
    out.road = (all.match(/(?:หมายเลขทางหลวง|ทางหลวง(?:หมายเลข)?|ทล\.?)\s*:?\s*(\d{1,4})/) || [])[1] || '';
    const sec = all.match(/ตอน(?:ควบคุม)?\s*:?\s*([^\n,]+?)(?=\s+(?:ช่วง|กม|ระดับ|บริเวณ|พิกัด|จุด|เริ่ม)|\s{2,}|\n|$)/);
    out.section = sec ? sec[1].replace(/\s*-\s*/g, '-').trim() : '';
    const KMR = /(\d{1,4})\s*\+\s*(\d{3})\s*(?:ถึง|-|–|—)\s*(?:กม\.?\s*:?\s*)?(\d{1,4})\s*\+\s*(\d{3})/;
    const DEP = /ระดับ(?:น้ำ)?\s*:?\s*(?:สูง)?\s*(?:ประมาณ)?\s*(\d+(?:\.\d+)?)\s*(ซม|เซ็?น|cm|ม\.|เมตร|m\b)?/i;
    const coordsIn = function (s) {
      const res = [], re = /!3d-?\d+\.\d+!4d-?\d+\.\d+|-?\d{1,3}\.\d{3,}\s*[,\s]\s*-?\d{1,3}\.\d{3,}/g;
      let m;
      while ((m = re.exec(s))) {
        const c = AI.coords(m[0]);
        if (!c) continue;
        const before = s.slice(Math.max(0, m.index - 25), m.index);
        c.role = /สิ้นสุด|สุด|ปลาย|ถึง|กลับ|end/i.test(before) ? 'b' : /เริ่ม|ต้น|แยกออก|start/i.test(before) ? 'a' : '';
        res.push(c);
      }
      return res;
    };
    const put = function (o, c, nm, k, again) {
      const p = { name: nm || '', km: k || '', lat: c.lat, lng: c.lng };
      if (c.role === 'b' && !o.b) o.b = p;
      else if (c.role !== 'b' && !o.a) o.a = p;
      else if (!o.b) o.b = p;
      else { o = again(); o.a = p; }
      return o;
    };
    let ctx = 'flood', cur = null, det = null;
    const newF = function () { cur = { road: '', section: '', kmA: '', kmB: '', depth: '', place: '', a: null, b: null }; out.floods.push(cur); return cur; };
    const newD = function () { det = { a: null, b: null }; out.detours.push(det); return det; };
    all.split(/\r?\n/).forEach(function (line) {
      const t = line.trim();
      if (!t) return;
      const kmr = t.match(KMR), dep = t.match(DEP);
      const busy = cur && (cur.kmA || cur.a || cur.depth);
      if (/เบี่ยง|เลี่ยง/.test(t) && !kmr && !dep) {
        ctx = 'detour';
        if (!det || (det.a && det.b) || (/ที่\s*\d/.test(t) && (det.a || det.b))) newD();
      } else if (kmr || dep || /หมายเลขทางหลวง|^ทล\.?\s*\d|^ทางหลวง|ท่วม/.test(t)) {
        ctx = 'flood';
        if (!cur || (busy && (/หมายเลขทางหลวง|^ทล\.?\s*\d|^ทางหลวง/.test(t) || /(?:จุด|แห่ง|ช่วง)(?:น้ำท่วม)?ที่\s*\d/.test(t))) ||
          (kmr && (cur.kmA || (cur.a && cur.b))) || (dep && !kmr && cur.depth)) newF();
      }
      const cs = coordsIn(t);
      const kmOne = (t.match(/(\d{1,4})\s*\+\s*(\d{3})/) || []);
      const km1 = kmOne[1] ? kmOne[1] + '+' + kmOne[2] : '';
      if (ctx === 'detour') {
        if (!det) newD();
        const nm = cleanName(t.replace(/ทางเบี่ยง(?:ที่\s*\d)?|เส้นทางเลี่ยง|เริ่ม|สิ้นสุด|จุดแยกออก|จุดกลับเข้า(?:ทางหลัก)?|ถึง/g, ' '));
        cs.forEach(function (c) { det = put(det, c, cs.length === 1 ? nm : '', cs.length === 1 ? km1 : '', newD); });
        return;
      }
      if (!cur) newF();
      // สายทางของจุดนี้ (1 ผังมีหลายสายทางได้)
      const rd = t.match(/(?:หมายเลขทางหลวง|ทางหลวง(?:หมายเลข)?|ทล\.?)\s*:?\s*(\d{1,4})(?!\s*\+)/);
      if (rd) cur.road = rd[1];
      const sc = t.match(/ตอน(?:ควบคุม)?\s*:?\s*([^\n,]+?)(?=\s+(?:ช่วง|กม|ระดับ|บริเวณ|พิกัด|จุด|เริ่ม)|\s{2,}|$)/);
      if (sc) cur.section = sc[1].replace(/\s*-\s*/g, '-').trim();
      if (kmr) { cur.kmA = kmr[1] + '+' + kmr[2]; cur.kmB = kmr[3] + '+' + kmr[4]; }
      else if (km1) { if (/สิ้นสุด|ปลาย|ถึง/.test(t) || cur.kmA) cur.kmB = cur.kmB || km1; else cur.kmA = km1; }
      if (dep) { let v = +dep[1]; if (/^(ม\.|เมตร|m)$/i.test(dep[2] || '')) v *= 100; cur.depth = String(Math.round(v)); }
      const pl = t.match(/บริเวณ\s*:?\s*([^\n,]+?)(?=\s+(?:ช่วง|กม|ระดับ|พิกัด|เริ่ม)|\s{2,}|$)/);
      if (pl) cur.place = cleanName(pl[1]);
      cs.forEach(function (c) { cur = put(cur, c, '', '', newF); });
    });
    out.floods = out.floods.filter(function (f) { return f.kmA || f.a || f.depth; });
    out.floods.forEach(function (f) {
      if (f.a && !f.a.km) f.a.km = f.kmA;
      if (f.b && !f.b.km) f.b.km = f.kmB;
    });
    out.detours = out.detours.filter(function (d) { return d.a || d.b; });
    return out;
  };

  /* ---------------- 2) AI (Claude) ---------------- */
  const PT = { type: 'object', additionalProperties: false, required: ['name', 'km', 'lat', 'lng'],
    properties: { name: { type: 'string' }, km: { type: 'string' }, lat: { type: ['number', 'null'] }, lng: { type: ['number', 'null'] } } };
  const PAIR = { type: 'object', additionalProperties: false, required: ['a', 'b'], properties: { a: PT, b: PT } };
  const SCHEMA = {
    type: 'object', additionalProperties: false,
    required: ['kind', 'road', 'section', 'place', 'date', 'workType', 'flood', 'detour', 'zone', 'drain', 'dirLeft', 'dirRight', 'remarks'],
    properties: {
      kind: { type: 'string', enum: ['flood', 'safety', 'drain', 'unknown'] },
      road: { type: 'string' }, section: { type: 'string' }, place: { type: 'string' },
      date: { type: 'string' }, workType: { type: 'string' },
      flood: PAIR, detour: PAIR, zone: PAIR,
      drain: { type: 'object', additionalProperties: false, required: ['a'], properties: { a: PT } },
      dirLeft: { type: 'string' }, dirRight: { type: 'string' }, remarks: { type: 'string' }
    }
  };
  const SYSTEM = [
    'คุณช่วยเจ้าหน้าที่กรมทางหลวง (แขวงทางหลวงระยอง) กรอกข้อมูลสำหรับทำผังจราจร 3 แบบ:',
    'flood = ผังทางเบี่ยงอุทกภัย (มีช่วงน้ำท่วม จุดเริ่ม-จุดสิ้นสุด และทางเบี่ยง จุดแยกออก-จุดกลับเข้า),',
    'safety = ผังติดตั้งสิ่งอำนวยความปลอดภัยในเขตงานก่อสร้าง/อุบัติเหตุ/งานบำรุงทาง (zone = ต้นและปลายเขตงาน),',
    'drain = ผังแนวทางระบายน้ำ (drain.a = จุดน้ำท่วมขัง).',
    'อ่านข้อความและรูปที่ได้รับ แล้วดึงข้อมูลตาม schema:',
    '- km ใช้รูปแบบ "233+100" (ไม่ต้องมีคำว่า กม.) ถ้าไม่มีให้เป็นสตริงว่าง',
    '- lat/lng เป็นองศาทศนิยม (ประเทศไทย lat ประมาณ 5–21, lng ประมาณ 97–106) ถ้าไม่มีพิกัดชัดเจนให้เป็น null ห้ามเดาพิกัด',
    '- ถ้ามีรายการ "จุดที่เคยลงพิกัดไว้แล้ว" และจุดในข้อมูลใหม่มีแค่ชื่อ (ไม่มีพิกัด) ให้ใช้พิกัดและ กม. ของจุดที่ชื่อตรงกันจากรายการนั้น (ชื่ออาจเขียนต่างกันเล็กน้อย เช่น "ตะพง" = "แยกตะพง") และใช้ชื่อตามรายการ · ถ้าข้อมูลใหม่ให้พิกัดมาเอง ให้ใช้พิกัดใหม่',
    '- name = ชื่อจุด เช่น "แยกตะพง" "แยกศาลาสังสี" ไม่ต้องใส่ กม. หรือพิกัดซ้ำในชื่อ',
    '- place = ชื่อบริเวณ เช่น "บ้านซ่น - ตำนานป่า" · road = ตัวเลขทางหลวงอย่างเดียว เช่น "3" · section = ชื่อตอนควบคุม เช่น "ระยอง-กะเฉด"',
    '- date รูปแบบ YYYY-MM-DD (ค.ศ.) ถ้าเป็น พ.ศ. ให้ลบ 543 ถ้าไม่มีให้เป็นสตริงว่าง',
    '- dirLeft/dirRight = ข้อความบอกทิศ เช่น "ไประยอง" "ไปแกลง" ถ้าไม่มีให้เป็นสตริงว่าง',
    '- ช่องที่ไม่มีข้อมูลให้ใส่สตริงว่าง หรือ null สำหรับพิกัด · remarks = สิ่งที่ไม่แน่ใจหรือควรตรวจสอบ (ภาษาไทย สั้น ๆ)'
  ].join('\n');

  let clientP = null, clientKey = '';
  function client(key) {
    if (!clientP || clientKey !== key) {
      clientKey = key;
      clientP = import(SDK).then(function (mod) {
        const Anthropic = mod.default || mod.Anthropic;
        return new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
      });
    }
    return clientP;
  }
  // ย่อรูปก่อนส่ง (ด้านยาวไม่เกิน 1568 px) เพื่อประหยัดและเร็วขึ้น
  AI.imageBlock = function (file) {
    return new Promise(function (resolve, reject) {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        const s = Math.min(1, 1568 / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.85).split(',')[1] } });
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('อ่านไฟล์รูปไม่ได้')); };
      img.src = url;
    });
  };

  AI.parse = async function (text, files, kindHint, known) {
    const cfg = AI.config();
    if (!cfg.key) throw new Error('ยังไม่ได้ใส่ API key ที่หน้า "ตั้งค่า"');
    const c = await client(cfg.key);
    const content = [];
    for (const f of files || []) content.push(await AI.imageBlock(f));
    // จุดที่เคยลงพิกัดไว้ — ถ้าข้อมูลใหม่มีแค่ชื่อ ให้ AI ใช้พิกัดจากรายการนี้
    const memo = (known || []).slice(0, 300).map(function (q) { return '- ' + q.name + (q.km ? ' | กม.' + q.km : '') + ' | ' + q.lat + ', ' + q.lng; }).join('\n');
    content.push({ type: 'text', text: (kindHint ? 'ผู้ใช้กำลังทำผังแบบ: ' + kindHint + '\n\n' : '') +
      (memo ? 'จุดที่เคยลงพิกัดไว้แล้ว (ชื่อ | กม. | lat, lng):\n' + memo + '\n\n' : '') +
      'ข้อมูลที่ได้รับ:\n' + (text || '(ดูจากรูป)') });
    const params = {
      model: cfg.model || 'claude-opus-5', max_tokens: 16000, system: SYSTEM,
      messages: [{ role: 'user', content: content }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } }
    };
    let res;
    try {
      // Opus 5: เปิดระบบสำรองฝั่งเซิร์ฟเวอร์ ถ้าโมเดลปฏิเสธคำขอจะส่งต่อให้โมเดลอื่นทำแทนอัตโนมัติ
      if (params.model === 'claude-opus-5') {
        try {
          res = await c.beta.messages.create(Object.assign({}, params, { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }));
        } catch (e) {
          if (e && e.status === 400) res = await c.messages.create(params); else throw e;
        }
      } else res = await c.messages.create(params);
    } catch (e) {
      const st = e && e.status;
      if (st === 401) throw new Error('API key ไม่ถูกต้อง');
      if (st === 429) throw new Error('เรียกใช้ AI ถี่เกินไป กรุณารอสักครู่');
      if (st === 400) throw new Error('คำขอไม่ถูกต้อง: ' + ((e.error && e.error.error && e.error.error.message) || e.message));
      throw new Error('เรียก AI ไม่สำเร็จ: ' + ((e && e.message) || e));
    }
    if (res.stop_reason === 'refusal') throw new Error('AI ปฏิเสธคำขอนี้ ลองใช้ "อ่านเอง" แทน');
    const block = (res.content || []).find(function (b) { return b.type === 'text'; });
    if (!block) throw new Error('AI ไม่ได้ส่งผลลัพธ์กลับมา');
    const out = JSON.parse(block.text);
    // ตัดพิกัดที่อยู่นอกประเทศไทยทิ้ง (กันค่าผิดพลาด)
    const okPt = function (p) { if (p && (p.lat == null || p.lat < 4 || p.lat > 22 || p.lng < 96 || p.lng > 107)) { p.lat = null; p.lng = null; } return p; };
    ['flood', 'detour', 'zone'].forEach(function (k) { okPt(out[k].a); okPt(out[k].b); });
    okPt(out.drain.a);
    return out;
  };

  AI.test = async function () {
    const cfg = AI.config();
    const c = await client(cfg.key);
    const r = await c.messages.create({ model: cfg.model || 'claude-opus-5', max_tokens: 2048, messages: [{ role: 'user', content: 'ตอบคำว่า "พร้อม" คำเดียว' }] });
    const b = (r.content || []).find(function (x) { return x.type === 'text'; });
    return b ? b.text : '';
  };
})();
