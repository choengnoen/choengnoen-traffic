/* หน้าต่างโมดัลลอย — รูปแบบเดียวกับระบบงานอุบัติเหตุ (ใช้แทน confirm / prompt ของเบราว์เซอร์)
   UI.confirm(ชื่อ, { msg, ok, cancel, danger })        → Promise<true|false>
   UI.prompt(ชื่อ, ค่าเริ่ม, { msg, ok, multiline, readonly }) → Promise<ข้อความ|null>
   UI.choose(ชื่อ, [{ label, value, cls }], { msg })       → Promise<value|null>   (ปิดด้วย × / Esc / คลิกนอกกล่อง = null) */
(function () {
  'use strict';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function root() {
    let r = document.getElementById('modalRoot');
    if (!r) { r = document.createElement('div'); r.id = 'modalRoot'; document.body.appendChild(r); }
    return r;
  }

  // o = { title, msg, field: { value, multiline, readonly }, buttons: [{ label, value, cls }] }
  function open(o) {
    return new Promise(function (resolve) {
      const r = root(), prevFocus = document.activeElement;
      const f = o.field;
      r.innerHTML =
        '<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true">' +
          '<div class="modal-head"><h3>' + esc(o.title) + '</h3><button class="modal-close" type="button" aria-label="ปิด">×</button></div>' +
          '<div class="modal-body">' +
            (o.msg ? '<p>' + esc(o.msg).replace(/\n/g, '<br>') + '</p>' : '') +
            (f ? '<div class="modal-field">' + (f.multiline
              ? '<textarea rows="8"' + (f.readonly ? ' readonly' : '') + '>' + esc(f.value) + '</textarea>'
              : '<input type="text" value="' + esc(f.value) + '">') + '</div>' : '') +
            '<div class="actions">' + o.buttons.map(function (b, i) {
              return '<button class="btn ' + (b.cls || 'btn-outline') + '" type="button" data-i="' + i + '">' + esc(b.label) + '</button>';
            }).join('') + '</div>' +
          '</div></div></div>';
      const bd = r.querySelector('.modal-backdrop'), inp = r.querySelector('.modal-field input, .modal-field textarea');
      function done(v) {
        document.removeEventListener('keydown', onKey, true);
        r.innerHTML = '';
        if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch (e) { /* ปุ่มเดิมอาจถูกวาดใหม่แล้ว */ }
        resolve(v);
      }
      function valueOf(b) { return b.value === '$input' ? inp.value : b.value; }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); }
        else if (e.key === 'Enter' && !(inp && inp.tagName === 'TEXTAREA')) {
          const last = o.buttons[o.buttons.length - 1];
          if (o.enterOk !== false) { e.preventDefault(); e.stopPropagation(); done(valueOf(last)); }
        }
      }
      document.addEventListener('keydown', onKey, true);
      r.querySelector('.modal-close').onclick = function () { done(null); };
      bd.addEventListener('mousedown', function (e) { if (e.target === bd) done(null); });
      r.querySelectorAll('.actions [data-i]').forEach(function (btn) {
        btn.onclick = function () { done(valueOf(o.buttons[+btn.dataset.i])); };
      });
      if (inp) { inp.focus(); inp.select(); }
      else r.querySelector('.actions .btn:last-child').focus();
    });
  }

  window.UI = {
    confirm: function (title, o) {
      o = o || {};
      return open({ title: title, msg: o.msg, buttons: [
        { label: o.cancel || 'ยกเลิก', value: false },
        { label: o.ok || 'ยืนยัน', value: true, cls: o.danger ? 'btn-danger' : 'btn-primary' }
      ] }).then(function (v) { return v === true; });
    },
    prompt: function (title, value, o) {
      o = o || {};
      const btns = o.readonly ? [{ label: o.ok || 'ปิด', value: null, cls: 'btn-primary' }]
        : [{ label: o.cancel || 'ยกเลิก', value: null }, { label: o.ok || 'ตกลง', value: '$input', cls: 'btn-primary' }];
      return open({ title: title, msg: o.msg, field: { value: value || '', multiline: o.multiline, readonly: o.readonly }, buttons: btns });
    },
    choose: function (title, buttons, o) {
      o = o || {};
      return open({ title: title, msg: o.msg, buttons: buttons, enterOk: false });
    }
  };
})();
