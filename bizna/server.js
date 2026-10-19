/**
 * Bizna server.
 *
 * Serves the static frontend from /public, the legal pages from /views and the
 * REST API under /api. Exports the Express app so tests can mount it on a
 * random port; it only listens when run directly (npm start).
 *
 * Environment (see .env.example): PORT, CORS_ORIGIN, FORCE_HTTPS, TRUST_PROXY,
 * OPERATOR_NAME, CONTACT_EMAIL, TERMS_EFFECTIVE_DATE, BIZNA_DB.
 */

require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { router: authRouter, requireAuth, TERMS_VERSION } = require('./routes/auth');
const productsRouter = require('./routes/products');
const salesRouter = require('./routes/sales');
const expensesRouter = require('./routes/expenses');
const customersRouter = require('./routes/customers');
const dashboardRouter = require('./routes/dashboard');
const walletRouter = require('./routes/wallet');

const app = express();
const PORT = process.env.PORT || 3000;
const FORCE_HTTPS = process.env.FORCE_HTTPS === 'true';

if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);

/*
 * Helmet's default policy tells browsers to rewrite every http:// request to
 * https://. On any plain-http address other than localhost (a phone on the same
 * Wi-Fi, a server without TLS) that breaks every API call, so it is only sent
 * when FORCE_HTTPS=true.
 */
const directives = helmet.contentSecurityPolicy.getDefaultDirectives();
if (!FORCE_HTTPS) directives['upgrade-insecure-requests'] = null;
app.use(helmet({ contentSecurityPolicy: { directives }, hsts: FORCE_HTTPS }));

const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').map((o) => o.trim()).filter(Boolean);
app.use('/api', cors({ origin: allowedOrigins.length ? allowedOrigins : false }));
app.use(express.json({ limit: '100kb' }));

app.use('/api/auth/login', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
}));
app.use('/api/auth/signup', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many attempts. Try again in 15 minutes.' },
}));
app.use('/api/', rateLimit({ windowMs: 60 * 1000, max: 300 }));

app.get('/api/health', (req, res) => res.json({ ok: true }));

const escapeHtml = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Renders a legal page, filling {{OPERATOR_NAME}}, {{CONTACT}}, {{EFFECTIVE_DATE}}
 * and {{VERSION}} from the environment.
 */
function legalPage(file) {
  const template = fs.readFileSync(path.join(__dirname, 'views', file), 'utf8');
  const values = {
    OPERATOR_NAME: process.env.OPERATOR_NAME || 'the person or business running this Bizna installation',
    CONTACT: process.env.CONTACT_EMAIL || 'the contact details the operator gave you when you were given access',
    EFFECTIVE_DATE: process.env.TERMS_EFFECTIVE_DATE || '15 October 2026',
    VERSION: TERMS_VERSION,
  };
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => escapeHtml(values[key] ?? ''));
}

for (const [route, file] of [['terms', 'terms.html'], ['privacy', 'privacy.html']]) {
  app.get([`/${route}`, `/${route}.html`], (req, res) => res.type('html').send(legalPage(file)));
}

app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', authRouter);
app.use('/api/products', requireAuth, productsRouter);
app.use('/api/sales', requireAuth, salesRouter);
app.use('/api/expenses', requireAuth, expensesRouter);
app.use('/api/customers', requireAuth, customersRouter);
app.use('/api/dashboard', requireAuth, dashboardRouter);
app.use('/api/wallet', requireAuth, walletRouter);

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(err.type === 'entity.parse.failed' ? 400 : 500).json({
    error: err.type === 'entity.parse.failed' ? 'The request was not valid JSON.' : 'Something went wrong. Please try again.',
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    const lan = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
    console.log('\nBizna is running');
    console.log(`  On this computer:  http://localhost:${PORT}`);
    lan.forEach((ip) => console.log(`  On your network:   http://${ip}:${PORT}`));
    if (!process.env.OPERATOR_NAME || !process.env.CONTACT_EMAIL) {
      console.log('\nSet OPERATOR_NAME and CONTACT_EMAIL in .env so the Terms and Privacy pages name who runs this installation.');
    }
    console.log('');
  });
}

module.exports = app;
