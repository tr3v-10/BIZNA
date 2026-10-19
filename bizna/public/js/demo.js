/**
 * Demo backend.
 *
 * Answers the same endpoints as the real server, entirely in memory, so anyone
 * can look inside Bizna without an account. Nothing is sent to a server or
 * saved: reloading the page starts the sample shop again. The wallet rules
 * (split, closing pots, transfers, overspending) follow the server's behaviour.
 *
 * demoApi(method, path, body) is called by api.js while session.demo is true.
 * onDemoChange(fn) lets the wallet screen refresh the moment sample money moves.
 */

import { ApiError } from './util.js';
import { splitCents, UNALLOCATED } from './split.js';

const DAY = 86400000;
const listeners = new Set();
const PALETTE = ['#12B76A', '#3B82F6', '#FFB020', '#F2557A', '#7C5CFC', '#14B8A6', '#FB7C2D', '#E64FB0'];

export function onDemoChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const changed = () => listeners.forEach((fn) => fn());

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const sqlTime = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const eatKey = (ms) => new Date(ms + 3 * 3600000).toISOString().slice(0, 10);

let state = null;

function newState() {
  return {
    products: [], customers: [], sales: [], expenses: [], buckets: [], events: [],
    ids: { product: 1, customer: 1, sale: 1, expense: 1, bucket: 1, event: 1 },
  };
}

function creditAt(s, { kind, label, amount, refType = null, refId = null }, at) {
  const cents = Math.round(amount * 100);
  if (cents <= 0) return;
  const active = s.buckets.filter((b) => b.active).sort((a, b) => a.sort - b.sort);
  s.events.push({
    id: s.ids.event++, kind, direction: 'in', label, amount: cents / 100, ref_type: refType, ref_id: refId, at,
    entries: splitCents(cents, active).map((x) => ({ bucket_id: x.bucket_id, amount: x.cents / 100 })),
  });
}

function debitAt(s, { kind, label, amount, bucketId = null, refType = null, refId = null }, at) {
  const cents = Math.round(amount * 100);
  if (cents <= 0) return;
  s.events.push({
    id: s.ids.event++, kind, direction: 'out', label, amount: cents / 100, ref_type: refType, ref_id: refId, at,
    entries: [{ bucket_id: bucketId, amount: -cents / 100 }],
  });
}

function recordSale(s, { items, amountPaid, method, customerId }, at, enforceStock = true) {
  const wanted = new Map();
  items.forEach((i) => wanted.set(Number(i.product_id), (wanted.get(Number(i.product_id)) || 0) + Number(i.quantity)));

  let total = 0;
  const lines = [];
  for (const [productId, quantity] of wanted) {
    const product = s.products.find((p) => p.id === productId);
    if (!product) throw new ApiError('One of the products no longer exists. Refresh and try again.', 400);
    if (enforceStock && product.stock_qty < quantity) {
      throw new ApiError(`Not enough "${product.name}" in stock (${product.stock_qty} left, ${quantity} needed).`, 400);
    }
    total += product.price * quantity;
    lines.push({ product, quantity });
  }
  total = round2(total);
  const paid = round2(amountPaid);
  if (paid > total + 0.004) throw new ApiError(`The amount paid (${paid}) is more than the sale total (${total}).`, 400);
  const due = round2(total - paid);
  const customer = customerId ? s.customers.find((c) => c.id === Number(customerId)) : null;
  if (customerId && !customer) throw new ApiError('That customer no longer exists. Refresh and try again.', 400);
  if (due > 0 && !customer) throw new ApiError('Part of this sale is unpaid. Choose a customer to put the balance on their tab.', 400);

  const sale = {
    id: s.ids.sale++, customer_id: customer ? customer.id : null, customer_name: customer ? customer.name : null,
    total, amount_paid: paid, payment_method: method, created_at: sqlTime(at), at,
    items: lines.map((l) => ({ product_id: l.product.id, name: l.product.name, quantity: l.quantity, unit_price: l.product.price })),
  };
  s.sales.push(sale);
  lines.forEach((l) => { l.product.stock_qty -= l.quantity; });
  if (due > 0) customer.balance_owed = round2(customer.balance_owed + due);
  creditAt(s, { kind: 'sale', label: customer ? customer.name : 'Walk-in sale', amount: paid, refType: 'sale', refId: sale.id }, at);
  return sale;
}

function seed() {
  const s = newState();
  const now = Date.now();

  [['Restock', 50], ['Rent and bills', 20], ['Savings', 15], ['Owner pay', 15]].forEach(([name, percent], i) => {
    s.buckets.push({ id: s.ids.bucket++, name, percent, color: PALETTE[i], sort: i, active: true });
  });

  [['Sugar, 2kg', 320, 6], ['Cooking oil, 1L', 260, 5], ['Maize flour, 2kg', 180, 10], ['Bar soap', 60, 6], ['Tea leaves, 250g', 120, 5], ['Bread', 65, 8]]
    .forEach(([name, price, threshold]) => s.products.push({
      id: s.ids.product++, name, price, stock_qty: 500, low_stock_threshold: threshold, created_at: sqlTime(now - 8 * DAY),
    }));

  [['Mama Wanjiru', '0712 345 678'], ['Mzee Otieno', '0723 111 222'], ['Kamau Kiosk', '0734 987 654']]
    .forEach(([name, phone]) => s.customers.push({ id: s.ids.customer++, name, phone, balance_owed: 0, created_at: sqlTime(now - 8 * DAY) }));

  const baskets = [[[1, 2], [3, 1]], [[2, 1]], [[3, 2], [5, 1], [6, 2]], [[1, 1], [4, 3]], [[2, 2], [6, 1]], [[5, 2], [4, 1], [3, 1]]];
  let pick = 0;
  for (let ago = 6; ago >= 0; ago--) {
    const count = 3 + (ago % 3);
    for (let k = count; k >= 1; k--) {
      const at = ago === 0 ? now - k * 38 * 60000 : now - ago * DAY - k * 2.3 * 3600000;
      const basket = baskets[pick++ % baskets.length].map(([product_id, quantity]) => ({ product_id, quantity }));
      const gross = basket.reduce((sum, i) => sum + s.products.find((p) => p.id === i.product_id).price * i.quantity, 0);
      const onCredit = pick % 7 === 0;
      recordSale(s, {
        items: basket,
        amountPaid: onCredit ? Math.floor(gross / 2) : gross,
        method: onCredit ? 'credit' : ['cash', 'mpesa', 'cash'][pick % 3],
        customerId: onCredit ? 1 : null,
      }, at, false);
    }
    if (ago === 5) debitAt(s, { kind: 'expense', label: 'Rent', amount: 6000, bucketId: 2, refType: 'expense', refId: s.ids.expense }, now - 5 * DAY);
    if (ago === 5) s.expenses.push({ id: s.ids.expense++, category: 'Rent', description: 'Monthly shop rent', amount: 6000, bucket_id: 2, created_at: sqlTime(now - 5 * DAY), at: now - 5 * DAY });
    if (ago === 3) debitAt(s, { kind: 'expense', label: 'Supplier', amount: 2400, bucketId: 1, refType: 'expense', refId: s.ids.expense }, now - 3 * DAY);
    if (ago === 3) s.expenses.push({ id: s.ids.expense++, category: 'Supplier', description: 'Sugar and flour delivery', amount: 2400, bucket_id: 1, created_at: sqlTime(now - 3 * DAY), at: now - 3 * DAY });
    if (ago === 1) debitAt(s, { kind: 'expense', label: 'Transport', amount: 350, bucketId: 1, refType: 'expense', refId: s.ids.expense }, now - DAY);
    if (ago === 1) s.expenses.push({ id: s.ids.expense++, category: 'Transport', description: 'Boda to the wholesaler', amount: 350, bucket_id: 1, created_at: sqlTime(now - DAY), at: now - DAY });
  }

  [24, 3, 40, 4, 18, 12].forEach((qty, i) => { s.products[i].stock_qty = qty; });
  return s;
}

/** Starts the sample shop from scratch. */
export function resetDemo() {
  state = seed();
}

const balanceMap = (s) => {
  const map = new Map();
  s.events.forEach((e) => e.entries.forEach((en) => map.set(en.bucket_id, (map.get(en.bucket_id) || 0) + en.amount)));
  return map;
};

const activeBuckets = (s) => s.buckets.filter((b) => b.active).sort((a, b) => a.sort - b.sort);

function balanceOf(s, id) {
  const map = balanceMap(s);
  if (id !== null) return map.get(id) || 0;
  const total = [...map.values()].reduce((a, b) => a + b, 0);
  const active = activeBuckets(s).reduce((sum, b) => sum + (map.get(b.id) || 0), 0);
  return total - active;
}

function walletSummary(s) {
  const now = Date.now();
  const today = eatKey(now);
  const month = today.slice(0, 7);
  const balances = balanceMap(s);
  const inMonth = s.events.filter((e) => e.direction !== 'move' && eatKey(e.at).startsWith(month));
  const flow = (id, dir) => Math.abs(inMonth.filter((e) => e.direction === dir)
    .reduce((sum, e) => sum + e.entries.filter((en) => en.bucket_id === id).reduce((a, en) => a + en.amount, 0), 0));

  const shape = (pot) => ({
    id: pot.id, name: pot.name, color: pot.color, percent: pot.percent ?? null,
    balance: balances.get(pot.id) || 0, in_month: flow(pot.id, 'in'), out_month: flow(pot.id, 'out'),
  });
  const buckets = activeBuckets(s).map(shape);
  const balance = [...balances.values()].reduce((a, b) => a + b, 0);
  const sum = (events) => events.reduce((a, e) => a + e.amount, 0);
  const todays = s.events.filter((e) => e.direction !== 'move' && eatKey(e.at) === today);
  const inToday = sum(todays.filter((e) => e.direction === 'in'));
  const outToday = sum(todays.filter((e) => e.direction === 'out'));
  const monthIn = sum(inMonth.filter((e) => e.direction === 'in'));
  const monthOut = sum(inMonth.filter((e) => e.direction === 'out'));

  const unallocated = {
    ...shape({ ...UNALLOCATED, percent: null }),
    balance: balance - buckets.reduce((a, b) => a + b.balance, 0),
    in_month: monthIn - buckets.reduce((a, b) => a + b.in_month, 0),
    out_month: monthOut - buckets.reduce((a, b) => a + b.out_month, 0),
  };

  const hourly = [];
  for (let i = 23; i >= 0; i--) {
    const start = now - i * 3600000;
    const key = new Date(start + 3 * 3600000).toISOString().slice(0, 13);
    const inHour = s.events.filter((e) => e.direction !== 'move' && new Date(e.at + 3 * 3600000).toISOString().slice(0, 13) === key && e.at >= now - 23 * 3600000 - 3600000);
    hourly.push({
      hour: Number(key.slice(11, 13)),
      in: sum(inHour.filter((e) => e.direction === 'in')),
      out: sum(inHour.filter((e) => e.direction === 'out')),
    });
  }

  const spent7 = sum(s.events.filter((e) => e.direction === 'out' && e.at >= now - 7 * DAY));
  const avg = spent7 / 7;
  const potInfo = new Map(s.buckets.map((b) => [b.id, b]));
  potInfo.set(null, UNALLOCATED);
  const feed = [...s.events].sort((a, b) => b.at - a.at || b.id - a.id).slice(0, 15).map((e) => ({
    id: e.id, kind: e.kind, direction: e.direction, label: e.label, amount: e.amount, created_at: sqlTime(e.at),
    parts: e.entries.map((en) => {
      const pot = potInfo.get(en.bucket_id) || UNALLOCATED;
      return { bucket_id: en.bucket_id, name: pot.name, color: pot.color, amount: en.amount };
    }),
  }));

  return {
    balance, in_today: inToday, out_today: outToday, net_today: inToday - outToday,
    in_month: monthIn, out_month: monthOut,
    sales_today: sum(todays.filter((e) => e.direction === 'in' && e.kind === 'sale')),
    payments_today: sum(todays.filter((e) => e.direction === 'in' && e.kind === 'payment')),
    avg_daily_spend: avg, runway_days: avg > 0 && balance > 0 ? balance / avg : null,
    percent_assigned: buckets.reduce((a, b) => a + b.percent, 0),
    buckets, unallocated, hourly, feed,
  };
}

function dashboard(s) {
  const now = Date.now();
  const today = eatKey(now);
  const sales = s.sales;
  const totalSales = sales.reduce((a, x) => a + x.total, 0);
  const totalExpenses = s.expenses.reduce((a, x) => a + x.amount, 0);
  const todays = sales.filter((x) => eatKey(x.at) === today);
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const key = eatKey(now - i * DAY);
    days.push({ date: key, total: sales.filter((x) => eatKey(x.at) === key).reduce((a, x) => a + x.total, 0) });
  }
  const best = new Map();
  sales.filter((x) => x.at >= now - 30 * DAY).forEach((x) => x.items.forEach((i) => {
    const row = best.get(i.product_id) || { name: i.name, quantity: 0, revenue: 0 };
    row.quantity += i.quantity;
    row.revenue += i.quantity * i.unit_price;
    best.set(i.product_id, row);
  }));
  const debtors = s.customers.filter((c) => c.balance_owed > 0).sort((a, b) => b.balance_owed - a.balance_owed);

  return {
    total_sales: totalSales, total_expenses: totalExpenses, profit: totalSales - totalExpenses,
    sales_today: todays.reduce((a, x) => a + x.total, 0), sales_count_today: todays.length,
    outstanding_credit: s.customers.reduce((a, c) => a + c.balance_owed, 0), debtor_count: debtors.length,
    low_stock_products: s.products.filter((p) => p.stock_qty <= p.low_stock_threshold)
      .sort((a, b) => a.stock_qty - b.stock_qty).map(({ id, name, stock_qty, low_stock_threshold }) => ({ id, name, stock_qty, low_stock_threshold })),
    sales_last_7_days: days, today,
    best_sellers: [...best.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 5),
    top_debtors: debtors.slice(0, 5).map(({ id, name, balance_owed }) => ({ id, name, balance_owed })),
  };
}

function saveRules(s, items) {
  if (!Array.isArray(items)) throw new ApiError('Rules must be a list.', 400);
  if (items.length > 8) throw new ApiError('You can have at most 8 pots.', 400);
  const seen = new Set();
  let total = 0;
  const clean = items.map((item, index) => {
    const name = String(item.name ?? '').trim();
    const percent = round2(item.percent);
    if (!name || name.length > 40) throw new ApiError('Each pot needs a name of up to 40 characters.', 400);
    if (seen.has(name.toLowerCase())) throw new ApiError(`Two pots are named "${name}". Names must be different.`, 400);
    seen.add(name.toLowerCase());
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) throw new ApiError(`"${name}" needs a percentage above 0 and up to 100.`, 400);
    total += percent;
    return { id: Number.isInteger(item.id) ? item.id : null, name, percent, color: /^#[0-9a-fA-F]{6}$/.test(item.color || '') ? item.color : PALETTE[index % 8], sort: index };
  });
  if (total > 100.005) throw new ApiError(`Percentages add up to ${round2(total)}%. They must not go above 100%.`, 400);

  const keep = new Set(clean.filter((c) => c.id !== null).map((c) => c.id));
  for (const pot of activeBuckets(s).filter((b) => !keep.has(b.id))) {
    const balance = balanceOf(s, pot.id);
    if (Math.round(balance * 100) !== 0) {
      s.events.push({
        id: s.ids.event++, kind: 'transfer', direction: 'move', label: `Closed ${pot.name}`, amount: Math.abs(balance), at: Date.now(),
        entries: [{ bucket_id: pot.id, amount: -balance }, { bucket_id: null, amount: balance }],
      });
    }
    pot.active = false;
  }
  for (const c of clean) {
    const existing = c.id !== null ? s.buckets.find((b) => b.id === c.id && b.active) : null;
    if (existing) Object.assign(existing, { name: c.name, percent: c.percent, color: c.color, sort: c.sort });
    else s.buckets.push({ id: s.ids.bucket++, name: c.name, percent: c.percent, color: c.color, sort: c.sort, active: true });
  }
}

function transfer(s, { from_bucket_id: from, to_bucket_id: to, amount, note }) {
  const cents = Math.round(Number(amount) * 100);
  if (!(cents > 0)) throw new ApiError('Enter an amount above zero.', 400);
  if (from === to) throw new ApiError('Choose two different pots.', 400);
  const name = (id) => {
    if (id === null) return UNALLOCATED.name;
    const pot = s.buckets.find((b) => b.id === id && b.active);
    if (!pot) throw new ApiError('That pot no longer exists.', 400);
    return pot.name;
  };
  const fromName = name(from);
  const toName = name(to);
  if (Math.round(balanceOf(s, from) * 100) < cents) throw new ApiError(`${fromName} does not hold that much.`, 400);
  s.events.push({
    id: s.ids.event++, kind: 'transfer', direction: 'move', label: (note || '').trim() || `${fromName} to ${toName}`, amount: cents / 100, at: Date.now(),
    entries: [{ bucket_id: from, amount: -cents / 100 }, { bucket_id: to, amount: cents / 100 }],
  });
}

const fail = (message, status = 400) => { throw new ApiError(message, status); };
const clone = (v) => JSON.parse(JSON.stringify(v));

/**
 * Handles one API call against the sample shop.
 * @param {string} method
 * @param {string} path Path after /api.
 * @param {any} body
 */
export async function demoApi(method, path, body = {}) {
  if (!state) resetDemo();
  const s = state;
  const route = `${method} ${path}`;
  const match = (re) => route.match(re);
  let m;

  if (route === 'GET /auth/status') return { ownerExists: true };
  if (route === 'GET /auth/me') return { username: 'demo', email: 'demo@bizna.example', shop_name: 'Sample duka', role: 'owner' };
  if (route === 'GET /dashboard') return clone(dashboard(s));
  if (route === 'GET /wallet') return clone(walletSummary(s));

  if (route === 'GET /products') return clone([...s.products].sort((a, b) => a.name.localeCompare(b.name)));
  if (route === 'POST /products') {
    const name = String(body.name || '').trim();
    if (!name) fail('Enter a product name.');
    if (!(Number(body.price) >= 0)) fail('Enter a price of zero or more.');
    const p = {
      id: s.ids.product++, name, price: Number(body.price), stock_qty: Number(body.stock_qty) || 0,
      low_stock_threshold: body.low_stock_threshold === undefined ? 5 : Number(body.low_stock_threshold), created_at: sqlTime(Date.now()),
    };
    s.products.push(p);
    return clone(p);
  }
  if ((m = match(/^POST \/products\/(\d+)\/restock$/))) {
    const p = s.products.find((x) => x.id === Number(m[1])) || fail('Product not found.', 404);
    const q = Number(body.quantity);
    if (!Number.isInteger(q) || q < 1) fail('Enter how many units arrived (1 or more).');
    p.stock_qty += q;
    return clone(p);
  }
  if ((m = match(/^DELETE \/products\/(\d+)$/))) {
    const id = Number(m[1]);
    if (s.sales.some((x) => x.items.some((i) => i.product_id === id))) {
      fail('This product appears in past sales, so it cannot be removed. Set its stock to zero instead.', 409);
    }
    s.products = s.products.filter((p) => p.id !== id);
    return { success: true };
  }

  if (route === 'GET /customers') return clone([...s.customers].sort((a, b) => a.name.localeCompare(b.name)));
  if (route === 'POST /customers') {
    const name = String(body.name || '').trim();
    if (!name) fail("Enter the customer's name.");
    const c = { id: s.ids.customer++, name, phone: String(body.phone || ''), balance_owed: 0, created_at: sqlTime(Date.now()) };
    s.customers.push(c);
    return clone(c);
  }
  if ((m = match(/^POST \/customers\/(\d+)\/pay$/))) {
    const c = s.customers.find((x) => x.id === Number(m[1])) || fail('Customer not found.', 404);
    if (!(Number(body.amount) >= 0.01)) fail('Enter an amount above zero.');
    if (c.balance_owed <= 0) fail(`${c.name} does not owe anything.`);
    const applied = round2(Math.min(Number(body.amount), c.balance_owed));
    c.balance_owed = round2(c.balance_owed - applied);
    creditAt(s, { kind: 'payment', label: c.name, amount: applied, refType: 'payment', refId: 0 }, Date.now());
    changed();
    return { ...clone(c), applied };
  }

  if (route === 'GET /sales') {
    return clone([...s.sales].sort((a, b) => b.at - a.at || b.id - a.id).slice(0, 200).map(({ items, at, ...rest }) => rest));
  }
  if (route === 'POST /sales') {
    if (!Array.isArray(body.items) || body.items.length === 0) fail('Add at least one product.');
    if (!(Number(body.amount_paid) >= 0)) fail('Enter the amount paid (zero if nothing was paid).');
    const sale = recordSale(s, {
      items: body.items, amountPaid: body.amount_paid, method: body.payment_method || 'cash', customerId: body.customer_id || null,
    }, Date.now());
    changed();
    const { items, at, ...rest } = sale;
    return clone(rest);
  }

  if (route === 'GET /expenses') {
    return clone([...s.expenses].sort((a, b) => b.at - a.at || b.id - a.id).map(({ at, ...e }) => {
      const pot = s.buckets.find((b) => b.id === e.bucket_id);
      return { ...e, bucket_name: pot ? pot.name : 'Unallocated', bucket_color: pot ? pot.color : UNALLOCATED.color };
    }));
  }
  if (route === 'POST /expenses') {
    const category = String(body.category || '').trim();
    if (!category) fail('Enter a category, such as rent or transport.');
    const amount = round2(body.amount);
    if (!(amount >= 0.01)) fail('Enter an amount above zero.');
    const bucketId = body.bucket_id ? Number(body.bucket_id) : null;
    if (bucketId !== null && !s.buckets.some((b) => b.id === bucketId && b.active)) fail('That pot no longer exists. Refresh and try again.');
    const at = Date.now();
    const expense = { id: s.ids.expense++, category, description: String(body.description || ''), amount, bucket_id: bucketId, created_at: sqlTime(at), at };
    s.expenses.push(expense);
    debitAt(s, { kind: 'expense', label: category, amount, bucketId, refType: 'expense', refId: expense.id }, at);
    changed();
    const { at: _at, ...rest } = expense;
    return clone(rest);
  }
  if ((m = match(/^DELETE \/expenses\/(\d+)$/))) {
    const id = Number(m[1]);
    if (!s.expenses.some((e) => e.id === id)) fail('Expense not found.', 404);
    s.expenses = s.expenses.filter((e) => e.id !== id);
    s.events = s.events.filter((e) => !(e.ref_type === 'expense' && e.ref_id === id));
    changed();
    return { success: true };
  }

  if (route === 'PUT /wallet/rules') {
    saveRules(s, body.rules);
    changed();
    return clone(walletSummary(s));
  }
  if (route === 'POST /wallet/transfer') {
    transfer(s, body);
    changed();
    return clone(walletSummary(s));
  }

  throw new ApiError('Not found.', 404);
}
