// routes/dashboard.js
const express = require('express');
const db = require('../db');

const router = express.Router();

// Everything here is computed on read - no stored "profit" value to keep in sync.
router.get('/', (req, res) => {
  const totalSales = db.prepare('SELECT COALESCE(SUM(total), 0) AS v FROM sales').get().v;
  const totalExpenses = db.prepare('SELECT COALESCE(SUM(amount), 0) AS v FROM expenses').get().v;

  // Cost of goods sold isn't tracked separately in this MVP (no cost_price field yet),
  // so profit here is revenue minus operating expenses only. Add cost_price to
  // products for true gross-margin profit.
  const profit = totalSales - totalExpenses;

  const lowStock = db
    .prepare('SELECT id, name, stock_qty, low_stock_threshold FROM products WHERE stock_qty <= low_stock_threshold')
    .all();

  const outstandingCredit = db.prepare('SELECT COALESCE(SUM(balance_owed), 0) AS v FROM customers').get().v;

  const salesToday = db
    .prepare(`SELECT COALESCE(SUM(total), 0) AS v FROM sales WHERE date(created_at) = date('now')`)
    .get().v;

  // Last 7 days of sales (including today), zero-filled so the sparkline
  // on the dashboard always has 7 points even on a brand new shop.
  const rows = db
    .prepare(
      `SELECT date(created_at) AS day, SUM(total) AS total
       FROM sales WHERE created_at >= datetime('now', '-6 days', 'start of day')
       GROUP BY day`
    )
    .all();
  const byDay = Object.fromEntries(rows.map((r) => [r.day, r.total]));
  const salesLast7Days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    salesLast7Days.push({ date: key, total: byDay[key] || 0 });
  }

  res.json({
    total_sales: totalSales,
    total_expenses: totalExpenses,
    profit,
    sales_today: salesToday,
    outstanding_credit: outstandingCredit,
    low_stock_products: lowStock,
    sales_last_7_days: salesLast7Days,
  });
});

module.exports = router;
