'use strict';

const express = require('express');
const taxonomy = require('../services/taxonomy');
const users = require('../services/users');
const invites = require('../services/invites');
const { requireAdmin, setFlash } = require('../middleware');

function adminRoutes(db) {
  const router = express.Router();
  router.use('/admin', requireAdmin);

  router.get('/admin', (req, res) => {
    res.render('admin', {
      title: 'จัดการระบบ',
      offices: taxonomy.list(db, 'offices'),
      categories: taxonomy.list(db, 'categories'),
      userList: users.listUsers(db),
      inviteCodes: invites.listCodes(db),
      activeInviteCount: invites.countActive(db),
      inviteTtlHours: invites.DEFAULT_TTL_HOURS,
      maxInvitePerBatch: invites.MAX_PER_BATCH,
    });
  });

  // ---------- รหัสเชิญ ----------
  router.post('/admin/invites/create', (req, res) => {
    try {
      const created = invites.createCodes(db, { count: Number(req.body.count), createdBy: req.session.userId });
      setFlash(req, 'success', `สร้างรหัสเชิญใหม่ ${created.length} รหัสเรียบร้อยแล้ว (หมดอายุใน ${invites.DEFAULT_TTL_HOURS} ชั่วโมง)`);
    } catch (err) {
      if (!err.expected) throw err;
      setFlash(req, 'error', err.message);
    }
    res.redirect('/admin');
  });

  // ---------- สำนักงาน / หมวดหมู่ ----------
  const KIND_LABEL = { offices: 'สำนักงาน', categories: 'หมวดหมู่' };

  router.post('/admin/:kind(offices|categories)/create', (req, res) => {
    const { kind } = req.params;
    try {
      const row = taxonomy.create(db, kind, req.body.name, { codePrefix: req.body.codePrefix });
      setFlash(req, 'success', `เพิ่ม${KIND_LABEL[kind]} "${row.name}" เรียบร้อยแล้ว`);
    } catch (err) {
      if (!err.expected) throw err;
      setFlash(req, 'error', err.message);
    }
    res.redirect('/admin');
  });

  router.post('/admin/:kind(offices|categories)/:id/rename', (req, res) => {
    const { kind, id } = req.params;
    try {
      const row = taxonomy.rename(db, kind, Number(id), req.body.name, { codePrefix: req.body.codePrefix });
      const suffix = kind === 'categories' ? ` (รหัสนำหน้า ${row.code_prefix})` : '';
      setFlash(req, 'success', `บันทึก${KIND_LABEL[kind]} "${row.name}" เรียบร้อยแล้ว${suffix}`);
    } catch (err) {
      if (!err.expected) throw err;
      setFlash(req, 'error', err.message);
    }
    res.redirect('/admin');
  });

  router.post('/admin/:kind(offices|categories)/:id/delete', (req, res) => {
    const { kind, id } = req.params;
    try {
      const row = taxonomy.remove(db, kind, Number(id));
      setFlash(req, 'success', `ลบ${KIND_LABEL[kind]} "${row.name}" เรียบร้อยแล้ว`);
    } catch (err) {
      if (!err.expected) throw err;
      setFlash(req, 'error', err.message);
    }
    res.redirect('/admin');
  });

  // ---------- ลำดับการแสดงหมวดหมู่ ----------
  router.post('/admin/categories/reorder', (req, res) => {
    try {
      taxonomy.reorderCategories(db, req.body.order);
      setFlash(req, 'success', 'บันทึกลำดับหมวดหมู่ใหม่เรียบร้อยแล้ว');
    } catch (err) {
      if (!err.expected) throw err;
      setFlash(req, 'error', err.message);
    }
    res.redirect('/admin');
  });

  router.post('/admin/categories/:id/move', (req, res) => {
    try {
      taxonomy.moveCategory(db, Number(req.params.id), String(req.body.direction));
    } catch (err) {
      if (!err.expected) throw err;
      setFlash(req, 'error', err.message);
    }
    res.redirect('/admin');
  });

  // ---------- ผู้ใช้งาน ----------
  router.post('/admin/users/:id/reset-password', (req, res) => {
    try {
      const user = users.resetPassword(db, Number(req.params.id), req.body.password);
      setFlash(req, 'success', `ตั้งรหัสผ่านใหม่ให้ ${user.username} เรียบร้อยแล้ว`);
    } catch (err) {
      if (!err.expected) throw err;
      setFlash(req, 'error', err.message);
    }
    res.redirect('/admin');
  });

  router.post('/admin/users/:id/role', (req, res) => {
    try {
      const user = users.changeRole(db, Number(req.params.id), String(req.body.role), req.session.userId);
      setFlash(req, 'success', `เปลี่ยนสิทธิ์ของ ${user.username} เป็น ${user.role} เรียบร้อยแล้ว`);
    } catch (err) {
      if (!err.expected) throw err;
      setFlash(req, 'error', err.message);
    }
    res.redirect('/admin');
  });

  router.post('/admin/users/:id/delete', (req, res) => {
    try {
      const user = users.deleteUser(db, Number(req.params.id), req.session.userId);
      setFlash(req, 'success', `ลบผู้ใช้ ${user.username} เรียบร้อยแล้ว`);
    } catch (err) {
      if (!err.expected) throw err;
      setFlash(req, 'error', err.message);
    }
    res.redirect('/admin');
  });

  return router;
}

module.exports = adminRoutes;
