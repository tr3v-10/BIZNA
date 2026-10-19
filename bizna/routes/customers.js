/**
 * Customer routes, mounted at /api/customers.
 *
 * GET  /        - list customers
 * POST /        - create a customer
 * POST /:id/pay - record a repayment against a customer's balance. The amount
 *                 applied (never more than is owed) is credited to the wallet.
 */

const express = require('express');
const { body, param } = require('express-validator');
const db = require('../db');
const wallet = require('../lib/wallet');
const { handleValidation, round2 } = require('../lib/http');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM customers ORDER BY name COLLATE NOCASE').all());
});

router.post(
  '/',
  [
    body('name').trim().isLength({ min: 1, max: 200 }).withMessage('Enter the customer\'s name.'),
    body('phone').optional().trim().isLength({ max: 30 }).withMessage('Phone numbers can be up to 30 characters.'),
  ],
  handleValidation,
  (req, res) => {
    const { name, phone = '' } = req.body;
    const result = db.prepare('INSERT INTO customers (name, phone) VALUES (?, ?)').run(name, phone);
    res.status(201).json(db.prepare('SELECT * FROM customers WHERE id = ?').get(result.lastInsertRowid));
  }
);

router.post(
  '/:id/pay',
  [param('id').isInt(), body('amount').isFloat({ min: 0.01 }).withMessage('Enter an amount above zero.')],
  handleValidation,
  (req, res) => {
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
    if (!customer) return res.status(404).json({ error: 'Customer not found.' });
    if (customer.balance_owed <= 0) return res.status(400).json({ error: `${customer.name} does not owe anything.` });

    const applied = round2(Math.min(req.body.amount, customer.balance_owed));
    db.transaction(() => {
      db.prepare('UPDATE customers SET balance_owed = ROUND(balance_owed - ?, 2) WHERE id = ?').run(applied, customer.id);
      const paymentId = db.prepare('INSERT INTO customer_payments (customer_id, amount) VALUES (?, ?)').run(customer.id, applied).lastInsertRowid;
      wallet.credit({ kind: 'payment', label: customer.name, amount: applied, refType: 'payment', refId: paymentId });
    })();
    wallet.notify();

    res.json({ ...db.prepare('SELECT * FROM customers WHERE id = ?').get(customer.id), applied });
  }
);

module.exports = router;
