/**
 * Wallet engine.
 *
 * Money is tracked in an append-only ledger made of events and entries:
 *   - wallet_events  one row per real-world movement (a sale payment, a customer
 *                    repayment, an expense, or a transfer between pots)
 *   - wallet_entries one or more signed rows per event saying which pot gained
 *                    or lost money. A NULL bucket_id is the "Unallocated" pot.
 *
 * Balances are always derived by summing entries, so they can never drift from
 * the history behind them.
 *
 * Income is divided across the active pots by percentage when it is credited.
 * Percentages that add up to less than 100 leave the remainder Unallocated.
 * Rounding is done in whole cents and the leftover cent goes to the pot with the
 * largest share, so a split always adds up to exactly what came in.
 *
 * Every write that changes money calls notify() after it commits; the SSE route
 * listens on `bus` and tells connected browsers to refresh.
 */

const { EventEmitter } = require('events');
const db = require('../db');

const bus = new EventEmitter();
bus.setMaxListeners(100);

const MAX_POTS = 8;
const UNALLOCATED = { id: null, name: 'Unallocated', color: '#94A3B8' };
const PALETTE = ['#12B76A', '#3B82F6', '#FFB020', '#F2557A', '#7C5CFC', '#14B8A6', '#FB7C2D', '#E64FB0'];
const DEFAULT_RULES = [
  { name: 'Restock', percent: 50 },
  { name: 'Rent and bills', percent: 20 },
  { name: 'Savings', percent: 15 },
  { name: 'Owner pay', percent: 15 },
];
const EAT = "'+3 hours'";

class WalletError extends Error {}

const toCents = (n) => Math.round(Number(n) * 100);

const insertEvent = db.prepare(
  'INSERT INTO wallet_events (kind, direction, label, amount, ref_type, ref_id) VALUES (?, ?, ?, ?, ?, ?)'
);
const insertEntry = db.prepare('INSERT INTO wallet_entries (event_id, bucket_id, amount) VALUES (?, ?, ?)');

/**
 * Active pots in display order.
 * @returns {{id:number,name:string,percent:number,color:string}[]}
 */
function listBuckets() {
  return db.prepare('SELECT id, name, percent, color FROM wallet_buckets WHERE active = 1 ORDER BY sort, id').all();
}

/**
 * Divides an amount in cents across pots by percentage.
 * @param {number} cents
 * @param {{id:number,percent:number}[]} buckets
 * @returns {{bucket_id:number|null,cents:number}[]} Non-zero shares that sum to `cents`.
 */
function splitCents(cents, buckets) {
  const shares = buckets.map((b) => ({ bucket_id: b.id, cents: Math.floor((cents * b.percent) / 100 + 1e-9) }));
  const rest = cents - shares.reduce((sum, s) => sum + s.cents, 0);
  const totalPercent = buckets.reduce((sum, b) => sum + b.percent, 0);

  if (rest > 0) {
    if (buckets.length > 0 && Math.abs(totalPercent - 100) < 0.005) {
      let top = 0;
      buckets.forEach((b, i) => { if (b.percent > buckets[top].percent) top = i; });
      shares[top].cents += rest;
    } else {
      shares.push({ bucket_id: null, cents: rest });
    }
  }
  return shares.filter((s) => s.cents !== 0);
}

/**
 * Credits incoming money and splits it across the pots.
 * @param {{kind:string,label:string,amount:number,refType?:string,refId?:number}} input
 * @returns {number|null} Event id, or null when the amount is zero.
 */
const credit = db.transaction(({ kind, label, amount, refType = null, refId = null }) => {
  const cents = toCents(amount);
  if (cents <= 0) return null;
  const eventId = insertEvent.run(kind, 'in', label, cents / 100, refType, refId).lastInsertRowid;
  for (const share of splitCents(cents, listBuckets())) insertEntry.run(eventId, share.bucket_id, share.cents / 100);
  return eventId;
});

/**
 * Records money leaving the wallet from one pot.
 * @param {{kind:string,label:string,amount:number,bucketId?:number|null,refType?:string,refId?:number}} input
 * @returns {number|null}
 */
const debit = db.transaction(({ kind, label, amount, bucketId = null, refType = null, refId = null }) => {
  const cents = toCents(amount);
  if (cents <= 0) return null;
  const eventId = insertEvent.run(kind, 'out', label, cents / 100, refType, refId).lastInsertRowid;
  insertEntry.run(eventId, bucketId, -cents / 100);
  return eventId;
});

/**
 * Removes the wallet movement linked to a record, such as a deleted expense.
 * @param {string} refType
 * @param {number|string} refId
 */
function removeLinked(refType, refId) {
  db.prepare('DELETE FROM wallet_events WHERE ref_type = ? AND ref_id = ?').run(refType, refId);
}

/**
 * @param {number|null} bucketId
 * @returns {boolean} Whether the pot exists and is active (null, the Unallocated pot, always does).
 */
function bucketExists(bucketId) {
  if (bucketId === null) return true;
  return !!db.prepare('SELECT 1 FROM wallet_buckets WHERE id = ? AND active = 1').get(bucketId);
}

function bucketName(bucketId) {
  if (bucketId === null) return UNALLOCATED.name;
  const row = db.prepare('SELECT name FROM wallet_buckets WHERE id = ? AND active = 1').get(bucketId);
  if (!row) throw new WalletError('That pot no longer exists.');
  return row.name;
}

function balanceOf(bucketId) {
  if (bucketId === null) {
    const total = db.prepare('SELECT COALESCE(SUM(amount), 0) AS v FROM wallet_entries').get().v;
    const active = db.prepare(
      'SELECT COALESCE(SUM(amount), 0) AS v FROM wallet_entries WHERE bucket_id IN (SELECT id FROM wallet_buckets WHERE active = 1)'
    ).get().v;
    return total - active;
  }
  return db.prepare('SELECT COALESCE(SUM(amount), 0) AS v FROM wallet_entries WHERE bucket_id = ?').get(bucketId).v;
}

/**
 * Moves money between two pots (either may be null for Unallocated).
 * Rejects the move when the source pot holds less than the amount.
 */
const transfer = db.transaction(({ fromId, toId, amount, note = '' }) => {
  const cents = toCents(amount);
  if (cents <= 0) throw new WalletError('Enter an amount above zero.');
  if (fromId === toId) throw new WalletError('Choose two different pots.');
  const fromName = bucketName(fromId);
  const toName = bucketName(toId);
  if (toCents(balanceOf(fromId)) < cents) throw new WalletError(`${fromName} does not hold that much.`);

  const label = note || `${fromName} to ${toName}`;
  const eventId = insertEvent.run('transfer', 'move', label, cents / 100, null, null).lastInsertRowid;
  insertEntry.run(eventId, fromId, -cents / 100);
  insertEntry.run(eventId, toId, cents / 100);
  return eventId;
});

/**
 * Replaces the auto-split rules.
 * Pots missing from the new list are closed and any balance they held is swept
 * into Unallocated, so history stays intact and no money disappears.
 * @param {{id?:number,name:string,percent:number,color?:string}[]} items
 */
const saveRules = db.transaction((items) => {
  if (!Array.isArray(items)) throw new WalletError('Rules must be a list.');
  if (items.length > MAX_POTS) throw new WalletError(`You can have at most ${MAX_POTS} pots.`);

  const seen = new Set();
  let total = 0;
  const clean = items.map((item, index) => {
    const name = String(item.name ?? '').trim();
    const percent = Math.round(Number(item.percent) * 100) / 100;
    if (!name || name.length > 40) throw new WalletError('Each pot needs a name of up to 40 characters.');
    if (seen.has(name.toLowerCase())) throw new WalletError(`Two pots are named "${name}". Names must be different.`);
    seen.add(name.toLowerCase());
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
      throw new WalletError(`"${name}" needs a percentage above 0 and up to 100.`);
    }
    total += percent;
    const color = /^#[0-9a-fA-F]{6}$/.test(item.color || '') ? item.color : PALETTE[index % PALETTE.length];
    return { id: Number.isInteger(item.id) ? item.id : null, name, percent, color, sort: index };
  });
  if (total > 100.005) throw new WalletError(`Percentages add up to ${Math.round(total * 100) / 100}%. They must not go above 100%.`);

  const existing = listBuckets();
  const keepIds = new Set(clean.filter((c) => c.id !== null).map((c) => c.id));

  for (const pot of existing.filter((b) => !keepIds.has(b.id))) {
    const balance = balanceOf(pot.id);
    if (toCents(balance) !== 0) {
      const eventId = insertEvent.run('transfer', 'move', `Closed ${pot.name}`, Math.abs(balance), null, null).lastInsertRowid;
      insertEntry.run(eventId, pot.id, -balance);
      insertEntry.run(eventId, null, balance);
    }
    db.prepare('UPDATE wallet_buckets SET active = 0 WHERE id = ?').run(pot.id);
  }

  for (const c of clean) {
    if (c.id !== null && existing.some((b) => b.id === c.id)) {
      db.prepare('UPDATE wallet_buckets SET name = ?, percent = ?, color = ?, sort = ? WHERE id = ?')
        .run(c.name, c.percent, c.color, c.sort, c.id);
    } else {
      db.prepare('INSERT INTO wallet_buckets (name, percent, color, sort) VALUES (?, ?, ?, ?)')
        .run(c.name, c.percent, c.color, c.sort);
    }
  }
});

function eatNowShifted(offsetMs) {
  return new Date(Date.now() + 3 * 3600000 - offsetMs);
}

/**
 * Builds everything the wallet screen and dashboard widget need in one object:
 * total balance, balance per pot, today and month flows, a 24 hour in/out series,
 * a seven day spending pace with the cash runway it implies, and the latest movements.
 * "Today" and "this month" use East Africa Time (UTC+3).
 */
function summary() {
  const potRows = db.prepare('SELECT id, name, color FROM wallet_buckets').all();
  const potInfo = new Map(potRows.map((p) => [p.id, p]));
  potInfo.set(null, UNALLOCATED);

  const balances = new Map(
    db.prepare('SELECT bucket_id, SUM(amount) AS v FROM wallet_entries GROUP BY bucket_id').all().map((r) => [r.bucket_id, r.v])
  );

  const monthFlows = db.prepare(
    `SELECT en.bucket_id AS bucket_id, e.direction AS direction, SUM(en.amount) AS v
       FROM wallet_entries en JOIN wallet_events e ON e.id = en.event_id
      WHERE e.direction IN ('in', 'out')
        AND strftime('%Y-%m', e.created_at, ${EAT}) = strftime('%Y-%m', 'now', ${EAT})
      GROUP BY en.bucket_id, e.direction`
  ).all();
  const flow = (bucketId, direction) => {
    const row = monthFlows.find((r) => r.bucket_id === bucketId && r.direction === direction);
    return row ? Math.abs(row.v) : 0;
  };

  const shape = (pot) => ({
    id: pot.id,
    name: pot.name,
    color: pot.color,
    percent: pot.percent ?? null,
    balance: balances.get(pot.id) || 0,
    in_month: flow(pot.id, 'in'),
    out_month: flow(pot.id, 'out'),
  });

  const buckets = listBuckets().map(shape);
  const balance = [...balances.values()].reduce((sum, v) => sum + v, 0);

  const sumWhere = (where, params = []) =>
    db.prepare(`SELECT COALESCE(SUM(amount), 0) AS v FROM wallet_events WHERE ${where}`).get(...params).v;
  const today = `date(created_at, ${EAT}) = date('now', ${EAT})`;
  const inToday = sumWhere(`direction = 'in' AND ${today}`);
  const outToday = sumWhere(`direction = 'out' AND ${today}`);
  const inMonth = sumWhere(`direction = 'in' AND strftime('%Y-%m', created_at, ${EAT}) = strftime('%Y-%m', 'now', ${EAT})`);
  const outMonth = sumWhere(`direction = 'out' AND strftime('%Y-%m', created_at, ${EAT}) = strftime('%Y-%m', 'now', ${EAT})`);

  const sources = db.prepare(
    `SELECT kind, SUM(amount) AS v FROM wallet_events WHERE direction = 'in' AND ${today} GROUP BY kind`
  ).all();
  const sourceToday = (kind) => (sources.find((s) => s.kind === kind) || { v: 0 }).v;

  const hourlyRows = db.prepare(
    `SELECT strftime('%Y-%m-%d %H', created_at, ${EAT}) AS h, direction, SUM(amount) AS v
       FROM wallet_events
      WHERE direction IN ('in', 'out')
        AND created_at >= datetime(strftime('%Y-%m-%d %H:00:00', 'now', '-23 hours'))
      GROUP BY h, direction`
  ).all();
  const hourly = [];
  for (let i = 23; i >= 0; i--) {
    const key = eatNowShifted(i * 3600000).toISOString().slice(0, 13).replace('T', ' ');
    const pick = (dir) => (hourlyRows.find((r) => r.h === key && r.direction === dir) || { v: 0 }).v;
    hourly.push({ hour: Number(key.slice(11, 13)), in: pick('in'), out: pick('out') });
  }

  const unallocated = {
    ...shape({ ...UNALLOCATED, percent: null }),
    balance: balance - buckets.reduce((sum, b) => sum + b.balance, 0),
    in_month: inMonth - buckets.reduce((sum, b) => sum + b.in_month, 0),
    out_month: outMonth - buckets.reduce((sum, b) => sum + b.out_month, 0),
  };

  const spent7 = sumWhere("direction = 'out' AND created_at >= datetime('now', '-7 days')");
  const avgDailySpend = spent7 / 7;
  const runwayDays = avgDailySpend > 0 && balance > 0 ? balance / avgDailySpend : null;

  const events = db.prepare(
    'SELECT id, kind, direction, label, amount, created_at FROM wallet_events ORDER BY id DESC LIMIT 15'
  ).all();
  let feed = [];
  if (events.length > 0) {
    const ids = events.map((e) => e.id);
    const entries = db.prepare(
      `SELECT event_id, bucket_id, amount FROM wallet_entries WHERE event_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`
    ).all(...ids);
    feed = events.map((e) => ({
      ...e,
      parts: entries.filter((en) => en.event_id === e.id).map((en) => {
        const pot = potInfo.get(en.bucket_id) || UNALLOCATED;
        return { bucket_id: en.bucket_id, name: pot.name, color: pot.color, amount: en.amount };
      }),
    }));
  }

  return {
    balance,
    in_today: inToday,
    out_today: outToday,
    net_today: inToday - outToday,
    in_month: inMonth,
    out_month: outMonth,
    sales_today: sourceToday('sale'),
    payments_today: sourceToday('payment'),
    avg_daily_spend: avgDailySpend,
    runway_days: runwayDays,
    percent_assigned: buckets.reduce((sum, b) => sum + b.percent, 0),
    buckets,
    unallocated,
    hourly,
    feed,
  };
}

/** Tells every connected live stream that money moved. */
function notify() {
  bus.emit('change');
}

/**
 * First-run setup: seeds starter pots once, then (once) mirrors any sales,
 * repayments and expenses recorded before the wallet existed into the ledger as
 * Unallocated money, keeping their original timestamps.
 */
function init() {
  const flag = (key) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  const setFlag = (key) => db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, '1');

  db.transaction(() => {
    if (!flag('wallet_seeded')) {
      if (db.prepare('SELECT COUNT(*) AS c FROM wallet_buckets').get().c === 0) {
        DEFAULT_RULES.forEach((rule, index) => {
          db.prepare('INSERT INTO wallet_buckets (name, percent, color, sort) VALUES (?, ?, ?, ?)')
            .run(rule.name, rule.percent, PALETTE[index % PALETTE.length], index);
        });
      }
      setFlag('wallet_seeded');
    }

    if (!flag('wallet_backfilled')) {
      const ledgerEmpty = db.prepare('SELECT COUNT(*) AS c FROM wallet_events').get().c === 0;
      if (ledgerEmpty) db.exec(`
        INSERT INTO wallet_events (kind, direction, label, amount, ref_type, ref_id, created_at)
          SELECT 'sale', 'in', COALESCE(c.name, 'Walk-in sale'), s.amount_paid, 'sale', s.id, s.created_at
            FROM sales s LEFT JOIN customers c ON c.id = s.customer_id WHERE s.amount_paid > 0;
        INSERT INTO wallet_events (kind, direction, label, amount, ref_type, ref_id, created_at)
          SELECT 'payment', 'in', COALESCE(c.name, 'Customer'), p.amount, 'payment', p.id, p.created_at
            FROM customer_payments p LEFT JOIN customers c ON c.id = p.customer_id;
        INSERT INTO wallet_events (kind, direction, label, amount, ref_type, ref_id, created_at)
          SELECT 'expense', 'out', category, amount, 'expense', id, created_at FROM expenses WHERE amount > 0;
        INSERT INTO wallet_entries (event_id, bucket_id, amount)
          SELECT id, NULL, CASE direction WHEN 'in' THEN amount ELSE -amount END FROM wallet_events;
      `);
      setFlag('wallet_backfilled');
    }
  })();
}

init();

module.exports = {
  bus,
  WalletError,
  MAX_POTS,
  listBuckets,
  splitCents,
  credit,
  debit,
  removeLinked,
  bucketExists,
  transfer,
  saveRules,
  summary,
  notify,
};
