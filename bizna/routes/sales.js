/**
 * Sales routes, mounted at /api/sales.
 *
 * GET  /    - list the 200 most recent sales
 * GET  /:id - get a sale with its line items
 * POST /    - create a sale:
 *             { customer_id?, amount_paid, payment_method, items: [{ product_id, quantity }] }
 *
 * A sale runs in one transaction: stock is decremented, any unpaid balance is
 * added to the customer's tab, and the amount actually paid is credited to the
 * wallet where it is split across the pots. Nothing changes if any step fails.
 */

const express = require('express');
const { body, param } = require('express-validator');
const db = require('../db');
const wallet = require('../lib/wallet');
const { UserError, handleValidation, round2 } = require('../lib/http');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(
    db.prepare(
      `SELECT sales.*, customers.name AS customer_name
         FROM sales LEFT JOIN customers ON customers.id = sales.customer_id
        ORDER BY sales.id DESC LIMIT 200`
    ).all()
  );
});

router.get('/:id', param('id').isInt(), handleValidation, (req, res) => {
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(req.params.id);
  if (!sale) return res.status(404).json({ error: 'Sale not found.' });
  const items = db.prepare(
    `SELECT sale_items.*, products.name AS product_name
       FROM sale_items JOIN products ON products.id = sale_items.product_id
      WHERE sale_id = ?`
  ).all(req.params.id);
  res.json({ ...sale, items });
});

router.post(
  '/',
  [
    body('items').isArray({ min: 1 }).withMessage('Add at least one product.'),
    body('items.*.product_id').isInt().withMessage('Choose a product for every row.'),
    body('items.*.quantity').isInt({ min: 1 }).withMessage('Quantities must be whole numbers of 1 or more.'),
    body('amount_paid').isFloat({ min: 0 }).withMessage('Enter the amount paid (zero if nothing was paid).'),
    body('payment_method').optional().isIn(['cash', 'mpesa', 'card', 'credit']).withMessage('Choose a payment method.'),
    body('customer_id').optional({ nullable: true, checkFalsy: true }).isInt().withMessage('Choose a valid customer.'),
  ],
  handleValidation,
  (req, res, next) => {
    const { items, payment_method = 'cash' } = req.body;
    const customerId = req.body.customer_id ? Number(req.body.customer_id) : null;
    const amountPaid = round2(req.body.amount_paid);

    const createSale = db.transaction(() => {
      const wanted = new Map();
      for (const item of items) {
        wanted.set(Number(item.product_id), (wanted.get(Number(item.product_id)) || 0) + Number(item.quantity));
      }

      let total = 0;
      const lines = [];
      for (const [productId, quantity] of wanted) {
        const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
        if (!product) throw new UserError('One of the products no longer exists. Refresh and try again.');
        if (product.stock_qty < quantity) {
          throw new UserError(`Not enough "${product.name}" in stock (${product.stock_qty} left, ${quantity} needed).`);
        }
        total += product.price * quantity;
        lines.push({ productId, quantity, unitPrice: product.price });
      }
      total = round2(total);

      if (amountPaid > total + 0.004) {
        throw new UserError(`The amount paid (${amountPaid}) is more than the sale total (${total}).`);
      }
      const balanceDue = round2(total - amountPaid);

      let customer = null;
      if (customerId) {
        customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
        if (!customer) throw new UserError('That customer no longer exists. Refresh and try again.');
      }
      if (balanceDue > 0 && !customer) {
        throw new UserError('Part of this sale is unpaid. Choose a customer to put the balance on their tab.');
      }

      const saleId = db
        .prepare('INSERT INTO sales (customer_id, total, amount_paid, payment_method) VALUES (?, ?, ?, ?)')
        .run(customerId, total, amountPaid, payment_method).lastInsertRowid;

      for (const line of lines) {
        db.prepare('INSERT INTO sale_items (sale_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)')
          .run(saleId, line.productId, line.quantity, line.unitPrice);
        db.prepare('UPDATE products SET stock_qty = stock_qty - ? WHERE id = ?').run(line.quantity, line.productId);
      }

      if (balanceDue > 0) {
        db.prepare('UPDATE customers SET balance_owed = balance_owed + ? WHERE id = ?').run(balanceDue, customerId);
      }

      wallet.credit({
        kind: 'sale',
        label: customer ? customer.name : 'Walk-in sale',
        amount: amountPaid,
        refType: 'sale',
        refId: saleId,
      });

      return saleId;
    });

    try {
      const saleId = createSale();
      wallet.notify();
      res.status(201).json(db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId));
    } catch (err) {
      if (err instanceof UserError) return res.status(400).json({ error: err.message });
      next(err);
    }
  }
);

module.exports = router;
