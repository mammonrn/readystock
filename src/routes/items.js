'use strict';

const express = require('express');
const ExcelJS = require('exceljs');
const items = require('../services/items');
const taxonomy = require('../services/taxonomy');
const { setFlash } = require('../middleware');

function parseFilter(query, perPage) {
  return {
    q: String(query.q || '').trim(),
    officeId: query.office ? Number(query.office) : null,
    categoryId: query.category ? Number(query.category) : null,
    onlyEmpty: query.empty === '1',
    page: Number(query.page) || 1,
    perPage,
  };
}

/** สร้าง query string สำหรับลิงก์ที่ต้องคง filter เดิมไว้ */
function filterQuery(query, overrides = {}) {
  const params = new URLSearchParams();
  const merged = { q: query.q, office: query.office, category: query.category, empty: query.empty, ...overrides };
  for (const [key, value] of Object.entries(merged)) {
    if (value !== undefined && value !== null && String(value) !== '') params.set(key, String(value));
  }
  const s = params.toString();
  return s ? '?' + s : '';
}

function itemRoutes(db, config) {
  const router = express.Router();

  function refs() {
    return { offices: taxonomy.list(db, 'offices'), categories: taxonomy.list(db, 'categories') };
  }

  router.get('/', (req, res) => res.redirect('/items'));

  router.get('/items', (req, res) => {
    const filter = parseFilter(req.query, config.pageSize);
    const result = items.listItems(db, filter);
    res.render('items', {
      title: 'รายการสินค้า',
      result,
      filter,
      ...refs(),
      filterQuery: (overrides) => filterQuery(req.query, overrides),
    });
  });

  router.get('/items/export.xlsx', async (req, res, next) => {
    try {
      const filter = parseFilter(req.query, config.pageSize);
      const rows = items.listAllItems(db, filter);

      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'ReadyStock';
      workbook.created = new Date();
      const sheet = workbook.addWorksheet('รายการสินค้า');

      sheet.columns = [
        { header: 'ลำดับ', key: 'no', width: 8 },
        { header: 'รหัสสินค้า', key: 'code', width: 14 },
        { header: 'ชื่อสินค้า', key: 'name', width: 34 },
        { header: 'หมวดหมู่', key: 'category', width: 16 },
        { header: 'สำนักงาน', key: 'office', width: 14 },
        { header: 'จำนวน', key: 'quantity', width: 10 },
        { header: 'หน่วย', key: 'unit', width: 10 },
        { header: 'หมายเหตุ', key: 'note', width: 34 },
        { header: 'แก้ไขล่าสุดโดย', key: 'updatedBy', width: 18 },
        { header: 'แก้ไขล่าสุดเมื่อ', key: 'updatedAt', width: 20 },
      ];
      sheet.getRow(1).font = { bold: true };
      sheet.getRow(1).alignment = { vertical: 'middle' };
      sheet.views = [{ state: 'frozen', ySplit: 1 }];

      rows.forEach((row, index) => {
        sheet.addRow({
          no: index + 1,
          code: row.item_code,
          name: row.name,
          category: row.category_name,
          office: row.office_name,
          quantity: row.quantity,
          unit: row.unit,
          note: row.note,
          updatedBy: row.updated_by_name,
          updatedAt: row.updated_at,
        });
      });

      sheet.addRow({});
      const totalRow = sheet.addRow({
        name: 'รวมทั้งหมด',
        quantity: rows.reduce((sum, row) => sum + row.quantity, 0),
      });
      totalRow.font = { bold: true };

      const stamp = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="readystock-${stamp}.xlsx"`);
      await workbook.xlsx.write(res);
      res.end();
    } catch (err) {
      next(err);
    }
  });

  router.get('/items/new', (req, res) => {
    res.render('item-form', {
      title: 'เพิ่มสินค้า',
      item: { name: '', quantity: 0, unit: '', note: '', category_id: null, office_id: null },
      error: null,
      isEdit: false,
      backUrl: '/items' + filterQuery(req.query),
      ...refs(),
    });
  });

  router.post('/items/new', (req, res) => {
    const backUrl = typeof req.body.backUrl === 'string' && req.body.backUrl.startsWith('/') ? req.body.backUrl : '/items';
    try {
      const item = items.createItem(
        db,
        {
          name: req.body.name,
          quantity: Number(req.body.quantity),
          unit: req.body.unit,
          note: req.body.note,
          categoryId: req.body.categoryId,
          officeId: req.body.officeId,
        },
        req.session.userId
      );
      setFlash(req, 'success', `เพิ่มสินค้า "${item.name}" เรียบร้อยแล้ว`);
      res.redirect(backUrl);
    } catch (err) {
      if (!err.expected) throw err;
      res.status(400).render('item-form', {
        title: 'เพิ่มสินค้า',
        item: {
          name: req.body.name,
          quantity: req.body.quantity,
          unit: req.body.unit,
          note: req.body.note,
          category_id: Number(req.body.categoryId) || null,
          office_id: Number(req.body.officeId) || null,
        },
        error: err.message,
        isEdit: false,
        backUrl,
        ...refs(),
      });
    }
  });

  router.get('/items/:id/edit', (req, res) => {
    const item = items.getItem(db, Number(req.params.id));
    if (!item) {
      return res.status(404).render('error', { title: 'ไม่พบสินค้า', message: 'ไม่พบสินค้าที่ต้องการแก้ไข', status: 404 });
    }
    res.render('item-form', {
      title: 'แก้ไขสินค้า',
      item,
      error: null,
      isEdit: true,
      backUrl: '/items' + filterQuery(req.query),
      ...refs(),
    });
  });

  router.post('/items/:id/edit', (req, res) => {
    const id = Number(req.params.id);
    const backUrl = typeof req.body.backUrl === 'string' && req.body.backUrl.startsWith('/') ? req.body.backUrl : '/items';
    try {
      const item = items.updateItem(
        db,
        id,
        {
          name: req.body.name,
          quantity: Number(req.body.quantity),
          unit: req.body.unit,
          note: req.body.note,
          categoryId: req.body.categoryId,
          officeId: req.body.officeId,
        },
        req.session.userId
      );
      setFlash(req, 'success', `บันทึกการแก้ไข "${item.name}" เรียบร้อยแล้ว`);
      res.redirect(backUrl);
    } catch (err) {
      if (!err.expected) throw err;
      res.status(400).render('item-form', {
        title: 'แก้ไขสินค้า',
        item: {
          id,
          name: req.body.name,
          quantity: req.body.quantity,
          unit: req.body.unit,
          note: req.body.note,
          category_id: Number(req.body.categoryId) || null,
          office_id: Number(req.body.officeId) || null,
        },
        error: err.message,
        isEdit: true,
        backUrl,
        ...refs(),
      });
    }
  });

  router.post('/items/:id/delete', (req, res) => {
    const backUrl = typeof req.body.backUrl === 'string' && req.body.backUrl.startsWith('/') ? req.body.backUrl : '/items';
    try {
      const item = items.deleteItem(db, Number(req.params.id), req.session.userId);
      setFlash(req, 'success', `ลบสินค้า "${item.name}" เรียบร้อยแล้ว`);
    } catch (err) {
      if (!err.expected) throw err;
      setFlash(req, 'error', err.message);
    }
    res.redirect(backUrl);
  });

  return router;
}

module.exports = itemRoutes;
