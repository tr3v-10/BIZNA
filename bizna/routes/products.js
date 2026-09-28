// routes/products.js
const express = require('express');
const { body, param, validationResult } = require('express-validator');
const db = require('../db');

const router = express.Router();

function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
  next();
}

// GET all products
router.get('/', (req, res) => {
  const products = db.prepare('SELECT * FROM products ORDER BY name').all();
  res.json(products);
});

// GET one product
router.get('/:id', param('id').isInt(), handleValidation, (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  res.json(product);
});

// CREATE product
router.post(
  '/',
  [
    body('name').trim().isLength({ min: 1, max: 200 }).withMessage('Name is required'),
    body('price').isFloat({ min: 0 }).withMessage('Price must be a positive number'),
    body('stock_qty').optional().isInt({ min: 0 }).withMessage('Stock must be a non-negative integer'),
    body('low_stock_threshold').optional().isInt({ min: 0 }),
  ],
  handleValidation,
  (req, res) => {
    const { name, price, stock_qty = 0, low_stock_threshold = 5 } = req.body;
    const result = db
      .prepare(
        'INSERT INTO products (name, price, stock_qty, low_stock_threshold) VALUES (?, ?, ?, ?)'
      )
      .run(name, price, stock_qty, low_stock_threshold);
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(product);
  }
);

// UPDATE product
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
    if (!existing) return res.status(404).json({ error: 'Product not found' });

    const updated = { ...existing, ...req.body };
    db.prepare(
      'UPDATE products SET name = ?, price = ?, stock_qty = ?, low_stock_threshold = ? WHERE id = ?'
    ).run(updated.name, updated.price, updated.stock_qty, updated.low_stock_threshold, req.params.id);

    res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id));
  }
);

// DELETE product
router.delete('/:id', param('id').isInt(), handleValidation, (req, res) => {
  const result = db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Product not found' });
  res.json({ success: true });
});

module.exports = router;
