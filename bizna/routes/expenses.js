/**
 * Expense routes, mounted at /api/expenses.
 *
 * GET    /    - list the 500 most recent expenses with the pot that paid for each
 * POST   /    - create an expense: { category, amount, description?, bucket_id? }
 *               The amount leaves the chosen pot in the wallet (Unallocated when
 *               no pot is given). Spending is never blocked; a pot that goes
 *               below zero is shown as overspent.
 * DELETE /:id - delete an expense and give the money back to its pot
 */

const express = require('express');
const { body, param } = require('express-validator');
const db = require('../db');
const wallet = require('../lib/wallet');
const { handleValidation, round2 } = require('../lib/http');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(
    db.prepare(
      `SELECT expenses.*, COALESCE(wallet_buckets.name, 'Unallocated') AS bucket_name,
              COALESCE(wallet_buckets.color, '#94A3B8') AS bucket_color
         FROM expenses LEFT JOIN wallet_buckets ON wallet_buckets.id = expenses.bucket_id
        ORDER BY expenses.id DESC LIMIT 500`
    ).all()
  );
});

router.post(
  '/',
  [
    body('category').trim().isLength({ min: 1, max: 100 }).withMessage('Enter a category, such as rent or transport.'),
    body('amount').isFloat({ min: 0.01 }).withMessage('Enter an amount above zero.'),
    body('description').optional().trim().isLength({ max: 500 }).withMessage('Keep the note under 500 characters.'),
    body('bucket_id').optional({ nullable: true, checkFalsy: true }).isInt().withMessage('Choose which pot paid for this.'),
  ],
  handleValidation,
  (req, res) => {
    const { category, description = '' } = req.body;
    const amount = round2(req.body.amount);
    const bucketId = req.body.bucket_id ? Number(req.body.bucket_id) : null;
    if (!wallet.bucketExists(bucketId)) return res.status(400).json({ error: 'That pot no longer exists. Refresh and try again.' });

    const expenseId = db.transaction(() => {
      const id = db
        .prepare('INSERT INTO expenses (category, description, amount, bucket_id) VALUES (?, ?, ?, ?)')
        .run(category, description, amount, bucketId).lastInsertRowid;
      wallet.debit({ kind: 'expense', label: category, amount, bucketId, refType: 'expense', refId: id });
      return id;
    })();
    wallet.notify();

    res.status(201).json(db.prepare('SELECT * FROM expenses WHERE id = ?').get(expenseId));
  }
);

router.delete('/:id', param('id').isInt(), handleValidation, (req, res) => {
  const result = db.transaction(() => {
    const outcome = db.prepare('DELETE FROM expenses WHERE id = ?').run(req.params.id);
    if (outcome.changes > 0) wallet.removeLinked('expense', req.params.id);
    return outcome;
  })();
  if (result.changes === 0) return res.status(404).json({ error: 'Expense not found.' });
  wallet.notify();
  res.json({ success: true });
});

module.exports = router;
