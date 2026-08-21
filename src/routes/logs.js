'use strict';

const express = require('express');
const logs = require('../services/logs');

function logRoutes(db, config) {
  const router = express.Router();

  router.get('/logs', (req, res) => {
    const result = logs.listLogs(db, { page: Number(req.query.page) || 1, perPage: config.pageSize });
    res.render('logs', { title: 'ประวัติการใช้งาน', result });
  });

  return router;
}

module.exports = logRoutes;
