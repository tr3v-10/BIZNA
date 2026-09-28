// routes/sales.js
const express = require('express');
const { body, param, validationResult } = require('express-validator');
const db = require('../db');

const router = express.Router();

function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
  next();
}

// GET all sales, most recent first
router.get('/', (req, res) => {
  const sales = db
    .prepare(
      `SELECT sales.*, customers.name AS customer_name
       FROM sales LEFT JOIN customers ON customers.id = sales.customer_id
       ORDER BY sales.created_at DESC LIMIT 200`
    )
    .all();
  res.json(sales);
});

// GET a single sale with its line items
router.get('/:id', param('id').isInt(), handleValidation, (req, res) => {
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(req.params.id);
  if (!sale) return res.status(404).json({ error: 'Sale not found' });
  const items = db
    .prepare(
      `SELECT sale_items.*, products.name AS product_name
       FROM sale_items JOIN products ON products.id = sale_items.product_id
       WHERE sale_id = ?`
    )
    .all(req.params.id);
  res.json({ ...sale, items });
});

// CREATE a sale: { customer_id?, amount_paid, payment_method, items: [{product_id, quantity}] }
router.post(
  '/',
  [
    body('items').isArray({ min: 1 }).withMessage('At least one item is required'),
    body('items.*.product_id').isInt(),
    body('items.*.quantity').isInt({ min: 1 }),
    body('amount_paid').isFloat({ min: 0 }),
    body('payment_method').optional().isIn(['cash', 'mpesa', 'card', 'credit']),
    body('customer_id').optional().isInt(),
  ],
  handleValidation,
  (req, res) => {
    const { items, amount_paid, payment_method = 'cash', customer_id = null } = req.body;

    // Everything below runs as one atomic transaction: if stock runs out
    // partway through, the whole sale is rolled back - no partial sales.
    const createSale = db.transaction(() => {
      let total = 0;
      const resolvedItems = [];

      for (const item of items) {
        const product = db.prepare('SELECT * FROM products WHERE id = ?').get(item.product_id);
        if (!product) throw new Error(`Product ${item.product_id} not found`);
        if (product.stock_qty < item.quantity) {
          throw new Error(`Not enough stock for "${product.name}" (have ${product.stock_qty}, need ${item.quantity})`);
        }
        total += product.price * item.quantity;
        resolvedItems.push({ ...item, unit_price: product.price });
      }

      const saleResult = db
        .prepare(
          'INSERT INTO sales (customer_id, total, amount_paid, payment_method) VALUES (?, ?, ?, ?)'
        )
        .run(customer_id, total, amount_paid, payment_method);
      const saleId = saleResult.lastInsertRowid;

      for (const item of resolvedItems) {
        db.prepare(
          'INSERT INTO sale_items (sale_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)'
        ).run(saleId, item.product_id, item.quantity, item.unit_price);

        db.prepare('UPDATE products SET stock_qty = stock_qty - ? WHERE id = ?')
          .run(item.quantity, item.product_id);
      }

      const balanceDue = total - amount_paid;
      if (customer_id && balanceDue > 0) {
        db.prepare('UPDATE customers SET balance_owed = balance_owed + ? WHERE id = ?')
          .run(balanceDue, customer_id);
      }

      return saleId;
    });

    try {
      const saleId = createSale();
      const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId);
      res.status(201).json(sale);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
);

module.exports = router;
