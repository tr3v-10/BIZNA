// routes/expenses.js
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
  res.json(db.prepare('SELECT * FROM expenses ORDER BY created_at DESC').all());
});

router.post(
  '/',
  [
    body('category').trim().isLength({ min: 1, max: 100 }).withMessage('Category is required'),
    body('amount').isFloat({ min: 0 }).withMessage('Amount must be a positive number'),
    body('description').optional().trim().isLength({ max: 500 }),
  ],
  handleValidation,
  (req, res) => {
    const { category, amount, description = '' } = req.body;
    const result = db
      .prepare('INSERT INTO expenses (category, description, amount) VALUES (?, ?, ?)')
      .run(category, description, amount);
    res.status(201).json(db.prepare('SELECT * FROM expenses WHERE id = ?').get(result.lastInsertRowid));
  }
);

router.delete('/:id', param('id').isInt(), handleValidation, (req, res) => {
  const result = db.prepare('DELETE FROM expenses WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Expense not found' });
  res.json({ success: true });
});

module.exports = router;
