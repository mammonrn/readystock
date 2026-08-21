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
