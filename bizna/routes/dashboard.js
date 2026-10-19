/**
 * Dashboard route, mounted at /api/dashboard.
 *
 * GET / returns sales totals, expenses, profit (sales minus expenses), money
 * owed by customers, low-stock products, the last seven days of sales, the
 * best sellers of the last 30 days and the customers who owe the most.
 * Days are East Africa Time (UTC+3).
 */

const express = require('express');
const db = require('../db');

const router = express.Router();
const EAT = "'+3 hours'";

function eatDayKey(daysAgo) {
  return new Date(Date.now() + 3 * 3600000 - daysAgo * 86400000).toISOString().slice(0, 10);
}

router.get('/', (req, res) => {
  const one = (sql) => db.prepare(sql).get().v;

  const totalSales = one('SELECT COALESCE(SUM(total), 0) AS v FROM sales');
  const totalExpenses = one('SELECT COALESCE(SUM(amount), 0) AS v FROM expenses');
  const outstandingCredit = one('SELECT COALESCE(SUM(balance_owed), 0) AS v FROM customers');
  const debtorCount = one('SELECT COUNT(*) AS v FROM customers WHERE balance_owed > 0');
  const salesToday = one(`SELECT COALESCE(SUM(total), 0) AS v FROM sales WHERE date(created_at, ${EAT}) = date('now', ${EAT})`);
  const salesCountToday = one(`SELECT COUNT(*) AS v FROM sales WHERE date(created_at, ${EAT}) = date('now', ${EAT})`);

  const lowStock = db
    .prepare('SELECT id, name, stock_qty, low_stock_threshold FROM products WHERE stock_qty <= low_stock_threshold ORDER BY stock_qty, name')
    .all();

  const rows = db
    .prepare(
      `SELECT date(created_at, ${EAT}) AS day, SUM(total) AS total
         FROM sales WHERE date(created_at, ${EAT}) >= date('now', ${EAT}, '-6 days')
        GROUP BY day`
    )
    .all();
  const byDay = Object.fromEntries(rows.map((r) => [r.day, r.total]));
  const salesLast7Days = [];
  for (let i = 6; i >= 0; i--) {
    const key = eatDayKey(i);
    salesLast7Days.push({ date: key, total: byDay[key] || 0 });
  }

  const bestSellers = db
    .prepare(
      `SELECT p.name AS name, SUM(si.quantity) AS quantity, SUM(si.quantity * si.unit_price) AS revenue
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         JOIN products p ON p.id = si.product_id
        WHERE s.created_at >= datetime('now', '-30 days')
        GROUP BY p.id ORDER BY revenue DESC LIMIT 5`
    )
    .all();

  const topDebtors = db
    .prepare('SELECT id, name, balance_owed FROM customers WHERE balance_owed > 0 ORDER BY balance_owed DESC LIMIT 5')
    .all();

  res.json({
    total_sales: totalSales,
    total_expenses: totalExpenses,
    profit: totalSales - totalExpenses,
    sales_today: salesToday,
    sales_count_today: salesCountToday,
    outstanding_credit: outstandingCredit,
    debtor_count: debtorCount,
    low_stock_products: lowStock,
    sales_last_7_days: salesLast7Days,
    today: eatDayKey(0),
    best_sellers: bestSellers,
    top_debtors: topDebtors,
  });
});

module.exports = router;
