/**
 * Product routes, mounted at /api/products.
 *
 * GET    /             - list products
 * GET    /:id          - get one product
 * POST   /             - create a product
 * PUT    /:id          - update a product
 * POST   /:id/restock  - add stock: { quantity }
 * DELETE /:id          - delete a product; 409 if it appears in past sales
 */

const express = require('express');
const { body, param } = require('express-validator');
const db = require('../db');
const { handleValidation } = require('../lib/http');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM products ORDER BY name COLLATE NOCASE').all());
});

router.get('/:id', param('id').isInt(), handleValidation, (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found.' });
  res.json(product);
});

router.post(
  '/',
  [
    body('name').trim().isLength({ min: 1, max: 200 }).withMessage('Enter a product name.'),
    body('price').isFloat({ min: 0 }).withMessage('Enter a price of zero or more.'),
    body('stock_qty').optional().isInt({ min: 0 }).withMessage('Stock must be a whole number, zero or more.'),
    body('low_stock_threshold').optional().isInt({ min: 0 }).withMessage('The alert level must be a whole number, zero or more.'),
  ],
  handleValidation,
  (req, res) => {
    const { name, price, stock_qty = 0, low_stock_threshold = 5 } = req.body;
    const result = db
      .prepare('INSERT INTO products (name, price, stock_qty, low_stock_threshold) VALUES (?, ?, ?, ?)')
      .run(name, price, stock_qty, low_stock_threshold);
    res.status(201).json(db.prepare('SELECT * FROM products WHERE id = ?').get(result.lastInsertRowid));
  }
);

router.put(
  '/:id',
  [
    param('id').isInt(),
    body('name').optional().trim().isLength({ min: 1, max: 200 }),
    body('price').optional().isFloat({ min: 0 }),
    body('stock_qty').optional().isInt({ min: 0 }),
    body('low_stock_threshold').optional().isInt({ min: 0 }),
  ],
  handleValidation,
  (req, res) => {
    const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Product not found.' });

    const updated = { ...existing, ...req.body };
    db.prepare('UPDATE products SET name = ?, price = ?, stock_qty = ?, low_stock_threshold = ? WHERE id = ?')
      .run(updated.name, updated.price, updated.stock_qty, updated.low_stock_threshold, req.params.id);
    res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id));
  }
);

router.post(
  '/:id/restock',
  [param('id').isInt(), body('quantity').isInt({ min: 1, max: 100000 }).withMessage('Enter how many units arrived (1 or more).')],
  handleValidation,
  (req, res) => {
    const result = db.prepare('UPDATE products SET stock_qty = stock_qty + ? WHERE id = ?').run(req.body.quantity, req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Product not found.' });
    res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id));
  }
);

router.delete('/:id', param('id').isInt(), handleValidation, (req, res) => {
  try {
    const result = db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Product not found.' });
    res.json({ success: true });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
      return res.status(409).json({ error: 'This product appears in past sales, so it cannot be removed. Set its stock to zero instead.' });
    }
    throw err;
  }
});

module.exports = router;
