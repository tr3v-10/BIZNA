// server.js
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');

const { router: authRouter, requireAuth } = require('./routes/auth');
const productsRouter = require('./routes/products');
const salesRouter = require('./routes/sales');
const expensesRouter = require('./routes/expenses');
const customersRouter = require('./routes/customers');
const dashboardRouter = require('./routes/dashboard');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Security middleware ---
app.use(helmet()); // sets sane security headers (X-Frame-Options, CSP baseline, etc.)
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:3000' }));
app.use(express.json({ limit: '100kb' })); // cap body size

// Rate limit login attempts specifically - the highest-value target for brute force
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
});
app.use('/api/auth/login', loginLimiter);

// General API rate limit as a backstop
app.use('/api/', rateLimit({ windowMs: 60 * 1000, max: 120 }));

// --- Static frontend ---
app.use(express.static(path.join(__dirname, 'public')));

// --- Routes ---
app.use('/api/auth', authRouter);
app.use('/api/products', requireAuth, productsRouter);
app.use('/api/sales', requireAuth, salesRouter);
app.use('/api/expenses', requireAuth, expensesRouter);
app.use('/api/customers', requireAuth, customersRouter);
app.use('/api/dashboard', requireAuth, dashboardRouter);

// Generic error handler - never leak stack traces to the client
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

app.listen(PORT, () => {
  console.log(`SME system running at http://localhost:${PORT}`);
});
