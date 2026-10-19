/**
 * Authentication routes and middleware.
 *
 * One owner account per installation, created through POST /signup. Passwords
 * are bcrypt hashed. Sessions are random bearer tokens whose SHA-256 hash is
 * stored in the sessions table, so they survive restarts and a leaked database
 * does not leak usable tokens. Tokens last 12 hours.
 *
 * GET  /api/auth/status  - whether an owner account exists
 * POST /api/auth/signup  - { shop_name, email, password, accepted_terms: true }; 409 if an owner exists
 * POST /api/auth/login   - { login, password } where login is an email or a username
 * POST /api/auth/logout  - revokes the current token
 * GET  /api/auth/me      - the signed-in account
 *
 * Exports { router, requireAuth, TERMS_VERSION }.
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const db = require('../db');

const router = express.Router();

const TERMS_VERSION = '2026-10-15';
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const DUMMY_HASH = bcrypt.hashSync('bizna-timing-equaliser', 12);

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const bearer = (req) => ((req.headers.authorization || '').match(/^Bearer\s+(\S+)$/i) || [])[1] || '';

/**
 * Creates a session and returns the raw token (shown to the client once).
 * @param {number} userId
 * @returns {string}
 */
function issueToken(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(hashToken(token), userId, Date.now() + TOKEN_TTL_MS);
  return token;
}

function ownerExists() {
  return !!db.prepare('SELECT id FROM users WHERE role = ?').get('owner');
}

function publicUser(user) {
  return { username: user.username, email: user.email, shop_name: user.shop_name || 'My shop', role: user.role };
}

function firstError(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
  next();
}

router.get('/status', (req, res) => {
  res.json({ ownerExists: ownerExists() });
});

router.post(
  '/signup',
  [
    body('shop_name').trim().isLength({ min: 2, max: 80 }).withMessage('Enter your shop name (2 to 80 characters).'),
    body('email').trim().toLowerCase().isEmail().withMessage('Enter a valid email address.'),
    body('password').isLength({ min: 8, max: 72 }).withMessage('Use a password of 8 to 72 characters.'),
    body('accepted_terms').custom((v) => v === true).withMessage('Accept the Terms and Conditions to continue.'),
  ],
  firstError,
  (req, res) => {
    if (ownerExists()) {
      return res.status(409).json({ error: 'This installation already has a shop account. Log in instead.' });
    }

    const { shop_name, email, password } = req.body;
    let userId;
    try {
      userId = db
        .prepare(
          `INSERT INTO users (username, email, shop_name, password_hash, role, terms_accepted_at, terms_version)
           VALUES (?, ?, ?, ?, 'owner', datetime('now'), ?)`
        )
        .run(email, email, shop_name, bcrypt.hashSync(password, 12), TERMS_VERSION).lastInsertRowid;
    } catch (err) {
      return res.status(400).json({ error: 'An account with that email already exists.' });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    res.status(201).json({ token: issueToken(userId), ...publicUser(user) });
  }
);

router.post(
  '/login',
  [body('password').notEmpty().withMessage('Enter your password.')],
  firstError,
  (req, res) => {
    const login = String(req.body.login ?? req.body.username ?? '').trim().toLowerCase();
    if (!login) return res.status(400).json({ error: 'Enter your email or username.' });

    const user = db.prepare('SELECT * FROM users WHERE lower(username) = ? OR email = ?').get(login, login);
    const valid = bcrypt.compareSync(String(req.body.password), user ? user.password_hash : DUMMY_HASH);
    if (!user || !valid) return res.status(401).json({ error: 'Wrong email, username or password.' });

    res.json({ token: issueToken(user.id), ...publicUser(user) });
  }
);

router.post('/logout', (req, res) => {
  const token = bearer(req);
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  res.json({ success: true });
});

/**
 * Express middleware: requires a valid, unexpired bearer token and sets req.userId.
 */
function requireAuth(req, res, next) {
  const token = bearer(req);
  const session = token && db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(hashToken(token));

  if (!session || session.expires_at < Date.now()) {
    if (session) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(session.token_hash);
    return res.status(401).json({ error: 'Your session has expired. Log in again.' });
  }

  req.userId = session.user_id;
  next();
}

router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  res.json(publicUser(user));
});

module.exports = { router, requireAuth, TERMS_VERSION };
