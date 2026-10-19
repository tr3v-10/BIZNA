/**
 * Shared HTTP helpers for the route modules.
 */

const { validationResult } = require('express-validator');

/** An error whose message is safe to show to the person using the app. */
class UserError extends Error {}

/**
 * Express middleware: responds 400 with the first validation message, if any.
 */
function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
  next();
}

/** Rounds a money value to two decimal places. */
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

module.exports = { UserError, handleValidation, round2 };
