// ยืนยันก่อนทำงานที่ย้อนกลับไม่ได้ (ลบสินค้า / ลบผู้ใช้ / ตั้งรหัสผ่านใหม่ ฯลฯ)
document.addEventListener('submit', function (event) {
  var form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  var message = form.getAttribute('data-confirm');
  if (message && !window.confirm(message)) {
    event.preventDefault();
  }
});

// ซ่อนข้อความแจ้งเตือนอัตโนมัติหลัง 6 วินาที
window.setTimeout(function () {
  document.querySelectorAll('.flash-success').forEach(function (el) {
    el.style.transition = 'opacity .4s';
    el.style.opacity = '0';
    window.setTimeout(function () { el.remove(); }, 400);
  });
}, 6000);

// กด Enter ในช่องค้นหาแล้วส่งฟอร์มทันที (พฤติกรรมมาตรฐานของ browser อยู่แล้ว)
// เลือกข้อความในช่อง "ตั้งรหัสผ่านใหม่" ให้อัตโนมัติเมื่อคลิก เพื่อพิมพ์ทับได้ง่าย
document.addEventListener('focusin', function (event) {
  var el = event.target;
  if (el instanceof HTMLInputElement && el.name === 'password' && el.type === 'text') {
    el.select();
  }
});

// ปุ่มคัดลอกรหัสเชิญไปยังคลิปบอร์ด
document.addEventListener('click', function (event) {
  var button = event.target.closest ? event.target.closest('[data-copy]') : null;
  if (!button) return;

  var text = button.getAttribute('data-copy');
  var original = button.textContent;

  function done(ok) {
    button.textContent = ok ? 'คัดลอกแล้ว ✓' : 'คัดลอกไม่สำเร็จ';
    button.classList.toggle('btn-copied', ok);
    window.setTimeout(function () {
      button.textContent = original;
      button.classList.remove('btn-copied');
    }, 1500);
  }

  // navigator.clipboard ใช้ได้เฉพาะบน https หรือ localhost จึงต้องมีวิธีสำรองไว้ด้วย
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(fallbackCopy(text)); });
  } else {
    done(fallbackCopy(text));
  }
});

function fallbackCopy(text) {
  var area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  var ok = false;
  try {
    ok = document.execCommand('copy');
  } catch (err) {
    ok = false;
  }
  document.body.removeChild(area);
  return ok;
}

// พิมพ์รหัสเชิญเป็นตัวพิมพ์ใหญ่ให้อัตโนมัติ (ฝั่งเซิร์ฟเวอร์ก็แปลงให้อยู่แล้ว)
document.addEventListener('input', function (event) {
  var el = event.target;
  if (el instanceof HTMLInputElement && el.classList.contains('code-input')) {
    var start = el.selectionStart;
    el.value = el.value.toUpperCase();
    el.setSelectionRange(start, start);
  }
});
