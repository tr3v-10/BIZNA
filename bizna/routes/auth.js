// routes/auth.js
// Minimal auth for the MVP: one owner account, bcrypt-hashed password,
// bearer token issued on login. This is intentionally simple - swap for
// JWT + refresh tokens + roles when you add employees (see README "Next steps").

const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const db = require('../db');

const router = express.Router();

// In-memory token store. Fine for a single-process MVP; move to a DB-backed
// session table (or real JWTs) before running more than one server instance.
const activeTokens = new Map(); // token -> { userId, expiresAt }
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function seedOwnerIfMissing() {
  const existing = db.prepare('SELECT id FROM users WHERE role = ?').get('owner');
  if (existing) return;

  const username = process.env.OWNER_USERNAME || 'owner';
  const password = process.env.OWNER_PASSWORD;
  if (!password) {
    console.warn(
      '[auth] No OWNER_PASSWORD set in .env - skipping owner seed. ' +
      'Set OWNER_USERNAME and OWNER_PASSWORD in .env, then restart.'
    );
    return;
  }
  const hash = bcrypt.hashSync(password, 12);
  db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)')
    .run(username, hash, 'owner');
  console.log(`[auth] Seeded owner account "${username}" from .env`);
}
seedOwnerIfMissing();

router.post(
  '/login',
  [
    body('username').trim().notEmpty().withMessage('Username is required'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { username, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

    // Same error for "no such user" and "wrong password" - don't leak which one.
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    activeTokens.set(token, { userId: user.id, expiresAt: Date.now() + TOKEN_TTL_MS });

    res.json({ token, username: user.username, role: user.role });
  }
);

router.post('/logout', (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  activeTokens.delete(token);
  res.json({ success: true });
});

// Middleware that protects every other route.
function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const record = activeTokens.get(token);

  if (!record || record.expiresAt < Date.now()) {
    activeTokens.delete(token);
    return res.status(401).json({ error: 'Not authenticated. Please log in.' });
  }

  req.userId = record.userId;
  next();
}

module.exports = { router, requireAuth };
