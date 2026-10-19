/**
 * Wallet routes, mounted at /api/wallet.
 *
 * GET  /          - live summary: balance, balance per pot, today and month flows,
 *                   24 hour series, spending pace, runway and the latest movements
 * PUT  /rules     - replace the auto-split rules: { rules: [{ id?, name, percent, color? }] }
 * POST /transfer  - move money between pots: { from_bucket_id, to_bucket_id, amount, note? }
 *                   (null means the Unallocated pot)
 * GET  /stream    - Server-Sent Events; emits a "wallet" event whenever money moves
 */

const express = require('express');
const { body } = require('express-validator');
const wallet = require('../lib/wallet');
const { handleValidation } = require('../lib/http');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(wallet.summary());
});

router.put('/rules', [body('rules').isArray({ max: wallet.MAX_POTS }).withMessage(`Use up to ${wallet.MAX_POTS} pots.`)], handleValidation, (req, res) => {
  try {
    wallet.saveRules(req.body.rules);
  } catch (err) {
    if (err instanceof wallet.WalletError) return res.status(400).json({ error: err.message });
    throw err;
  }
  wallet.notify();
  res.json(wallet.summary());
});

router.post(
  '/transfer',
  [
    body('amount').isFloat({ min: 0.01 }).withMessage('Enter an amount above zero.'),
    body('from_bucket_id').custom((v) => v === null || Number.isInteger(v)).withMessage('Choose where the money comes from.'),
    body('to_bucket_id').custom((v) => v === null || Number.isInteger(v)).withMessage('Choose where the money goes.'),
    body('note').optional().trim().isLength({ max: 120 }).withMessage('Keep the note under 120 characters.'),
  ],
  handleValidation,
  (req, res) => {
    try {
      wallet.transfer({
        fromId: req.body.from_bucket_id,
        toId: req.body.to_bucket_id,
        amount: req.body.amount,
        note: req.body.note,
      });
    } catch (err) {
      if (err instanceof wallet.WalletError) return res.status(400).json({ error: err.message });
      throw err;
    }
    wallet.notify();
    res.json(wallet.summary());
  }
);

router.get('/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('retry: 3000\n\n');

  const push = () => res.write(`event: wallet\ndata: ${Date.now()}\n\n`);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);
  wallet.bus.on('change', push);

  req.on('close', () => {
    clearInterval(heartbeat);
    wallet.bus.off('change', push);
  });
});

module.exports = router;
