// routes/customers.js
const express = require('express');
const { body, param, validationResult } = require('express-validator');
const db = require('../db');

const router = express.Router();

function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
  next();
}

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM customers ORDER BY name').all());
});

router.post(
  '/',
  [
    body('name').trim().isLength({ min: 1, max: 200 }).withMessage('Name is required'),
    body('phone').optional().trim().isLength({ max: 30 }),
  ],
  handleValidation,
  (req, res) => {
    const { name, phone = '' } = req.body;
    const result = db.prepare('INSERT INTO customers (name, phone) VALUES (?, ?)').run(name, phone);
    res.status(201).json(db.prepare('SELECT * FROM customers WHERE id = ?').get(result.lastInsertRowid));
  }
);

// Record a payment against an outstanding balance (e.g. customer clears their debt)
router.post(
  '/:id/pay',
  [param('id').isInt(), body('amount').isFloat({ min: 0.01 })],
  handleValidation,
  (req, res) => {
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    const newBalance = Math.max(0, customer.balance_owed - req.body.amount);
    db.prepare('UPDATE customers SET balance_owed = ? WHERE id = ?').run(newBalance, req.params.id);
    res.json(db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id));
  }
);

module.exports = router;
