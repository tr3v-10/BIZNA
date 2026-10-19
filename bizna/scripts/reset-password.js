/**
 * Resets an account password from the command line.
 *
 * Usage: npm run reset-password -- <email-or-username> <new-password>
 *
 * Only someone with access to the server can run this, which is what makes it a
 * safe recovery path for an installation that does not send email. All active
 * sessions for the account are ended.
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../db');

const [login, password] = process.argv.slice(2);

if (!login || !password) {
  console.error('Usage: npm run reset-password -- <email-or-username> <new-password>');
  process.exit(1);
}
if (password.length < 8 || password.length > 72) {
  console.error('The new password must be 8 to 72 characters.');
  process.exit(1);
}

const user = db.prepare('SELECT id, username FROM users WHERE lower(username) = ? OR email = ?').get(login.toLowerCase(), login.toLowerCase());
if (!user) {
  console.error(`No account found for "${login}".`);
  process.exit(1);
}

db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 12), user.id);
db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
console.log(`Password updated for ${user.username}. Existing sessions were signed out.`);
