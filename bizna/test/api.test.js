/**
 * End-to-end API tests. They start the real Express app on a random port with an
 * in-memory SQLite database, so nothing touches bizna.db.
 *
 * Run with: npm test
 */

process.env.BIZNA_DB = ':memory:';
process.env.OPERATOR_NAME = 'Test Operator Ltd';
process.env.CONTACT_EMAIL = 'help@test.example';

const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../server');

let base;
let server;
let token;

test.before(async () => {
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server.closeAllConnections?.() || server.close());

async function call(method, path, body, auth = true) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(auth && token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

const cents = (n) => Math.round(n * 100);

test('security headers do not force https upgrades', async () => {
  const res = await fetch(base + '/');
  const csp = res.headers.get('content-security-policy');
  assert.ok(csp.includes("default-src 'self'"));
  assert.ok(!csp.includes('upgrade-insecure-requests'));
});

test('legal pages are rendered with operator details', async () => {
  const terms = await (await fetch(base + '/terms')).text();
  assert.ok(terms.includes('Test Operator Ltd'));
  assert.ok(terms.includes('help@test.example'));
  assert.ok(!terms.includes('{{'));
  const privacy = await (await fetch(base + '/privacy')).text();
  assert.ok(privacy.includes('Data Protection Act'));
});

test('signup validates, creates the owner once, and blocks a second owner', async () => {
  assert.equal((await call('GET', '/api/auth/status', undefined, false)).data.ownerExists, false);

  const bad = await call('POST', '/api/auth/signup', { shop_name: 'Duka', email: 'nope', password: 'longenough', accepted_terms: true }, false);
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /email/i);

  const noTerms = await call('POST', '/api/auth/signup', { shop_name: 'Duka', email: 'a@b.co', password: 'longenough', accepted_terms: false }, false);
  assert.equal(noTerms.status, 400);

  const ok = await call('POST', '/api/auth/signup', { shop_name: 'Mama Duka', email: 'Owner@Shop.CO', password: 'longenough', accepted_terms: true }, false);
  assert.equal(ok.status, 201);
  assert.equal(ok.data.email, 'owner@shop.co');
  assert.equal(ok.data.shop_name, 'Mama Duka');
  token = ok.data.token;

  const again = await call('POST', '/api/auth/signup', { shop_name: 'Other', email: 'x@y.co', password: 'longenough', accepted_terms: true }, false);
  assert.equal(again.status, 409);
});

test('login: wrong password is a 401 with a clear message; email and username both work', async () => {
  const wrong = await call('POST', '/api/auth/login', { login: 'owner@shop.co', password: 'nope-nope' }, false);
  assert.equal(wrong.status, 401);
  assert.match(wrong.data.error, /wrong/i);

  const ok = await call('POST', '/api/auth/login', { login: 'OWNER@shop.co', password: 'longenough' }, false);
  assert.equal(ok.status, 200);
  assert.ok(ok.data.token);

  const legacy = await call('POST', '/api/auth/login', { username: 'owner@shop.co', password: 'longenough' }, false);
  assert.equal(legacy.status, 200);

  const me = await call('GET', '/api/auth/me');
  assert.equal(me.data.shop_name, 'Mama Duka');
});

test('protected routes reject missing and bad tokens', async () => {
  assert.equal((await call('GET', '/api/wallet', undefined, false)).status, 401);
  const res = await fetch(base + '/api/products', { headers: { Authorization: 'Bearer abc' } });
  assert.equal(res.status, 401);
});

test('starter pots exist and add up to 100 percent', async () => {
  const { data } = await call('GET', '/api/wallet');
  assert.equal(data.buckets.length, 4);
  assert.equal(data.percent_assigned, 100);
  assert.equal(data.balance, 0);
});

let sugar;
let oil;
let customer;

test('sale credits the wallet and splits it exactly by percentage', async () => {
  sugar = (await call('POST', '/api/products', { name: 'Sugar 2kg', price: 333.33, stock_qty: 10, low_stock_threshold: 2 })).data;
  oil = (await call('POST', '/api/products', { name: 'Oil 1L', price: 250, stock_qty: 3 })).data;
  customer = (await call('POST', '/api/customers', { name: 'Mama Wanjiru', phone: '0712' })).data;

  const sale = await call('POST', '/api/sales', { items: [{ product_id: sugar.id, quantity: 1 }], amount_paid: 333.33, payment_method: 'cash' });
  assert.equal(sale.status, 201);

  const w = (await call('GET', '/api/wallet')).data;
  assert.equal(cents(w.balance), 33333);
  const potSum = w.buckets.reduce((s, b) => s + cents(b.balance), 0) + cents(w.unallocated.balance);
  assert.equal(potSum, 33333, 'pots must add up to the money received');
  assert.equal(cents(w.in_today), 33333);
  assert.equal(w.feed[0].kind, 'sale');
  assert.equal(w.feed[0].parts.length, 4);
});

test('sale rules: overpay, unpaid without customer, oversell via duplicate rows', async () => {
  const over = await call('POST', '/api/sales', { items: [{ product_id: oil.id, quantity: 1 }], amount_paid: 999 });
  assert.equal(over.status, 400);
  assert.match(over.data.error, /more than/);

  const noCustomer = await call('POST', '/api/sales', { items: [{ product_id: oil.id, quantity: 1 }], amount_paid: 0, payment_method: 'credit' });
  assert.equal(noCustomer.status, 400);
  assert.match(noCustomer.data.error, /customer/i);

  const dup = await call('POST', '/api/sales', { items: [{ product_id: oil.id, quantity: 2 }, { product_id: oil.id, quantity: 2 }], amount_paid: 1000 });
  assert.equal(dup.status, 400);
  assert.match(dup.data.error, /Not enough/);

  const stock = (await call('GET', `/api/products/${oil.id}`)).data.stock_qty;
  assert.equal(stock, 3, 'failed sales must not change stock');
});

test('credit sale adds to the customer tab and only the paid part reaches the wallet', async () => {
  const before = (await call('GET', '/api/wallet')).data.balance;
  const sale = await call('POST', '/api/sales', {
    items: [{ product_id: oil.id, quantity: 2 }], amount_paid: 100, payment_method: 'mpesa', customer_id: customer.id,
  });
  assert.equal(sale.status, 201);
  const customers = (await call('GET', '/api/customers')).data;
  assert.equal(customers.find((c) => c.id === customer.id).balance_owed, 400);
  assert.equal(cents((await call('GET', '/api/wallet')).data.balance - before), 10000);
});

test('customer repayment is capped at what is owed and credited to the wallet', async () => {
  const before = (await call('GET', '/api/wallet')).data.balance;
  const paid = await call('POST', `/api/customers/${customer.id}/pay`, { amount: 9999 });
  assert.equal(paid.status, 200);
  assert.equal(paid.data.applied, 400);
  assert.equal(paid.data.balance_owed, 0);
  assert.equal(cents((await call('GET', '/api/wallet')).data.balance - before), 40000);

  const again = await call('POST', `/api/customers/${customer.id}/pay`, { amount: 10 });
  assert.equal(again.status, 400);
});

test('expenses leave the chosen pot and deleting one gives the money back', async () => {
  const pots = (await call('GET', '/api/wallet')).data.buckets;
  const restock = pots.find((p) => p.name === 'Restock');

  const exp = await call('POST', '/api/expenses', { category: 'Supplier', amount: 100, bucket_id: restock.id });
  assert.equal(exp.status, 201);
  let after = (await call('GET', '/api/wallet')).data;
  assert.equal(cents(after.buckets.find((p) => p.id === restock.id).balance), cents(restock.balance) - 10000);
  assert.equal(cents(after.out_today), 10000);

  const del = await call('DELETE', `/api/expenses/${exp.data.id}`);
  assert.equal(del.status, 200);
  after = (await call('GET', '/api/wallet')).data;
  assert.equal(cents(after.buckets.find((p) => p.id === restock.id).balance), cents(restock.balance));
  assert.equal(after.out_today, 0);

  const bad = await call('POST', '/api/expenses', { category: 'X', amount: 5, bucket_id: 99999 });
  assert.equal(bad.status, 400);
});

test('overspending is allowed and shows as a negative pot', async () => {
  const pots = (await call('GET', '/api/wallet')).data.buckets;
  const savings = pots.find((p) => p.name === 'Savings');
  await call('POST', '/api/expenses', { category: 'Emergency', amount: savings.balance + 50, bucket_id: savings.id });
  const after = (await call('GET', '/api/wallet')).data;
  assert.equal(cents(after.buckets.find((p) => p.id === savings.id).balance), -5000);
});

test('transfers move money between pots and reject overdrafts', async () => {
  const w = (await call('GET', '/api/wallet')).data;
  const [a, b] = w.buckets;
  const move = await call('POST', '/api/wallet/transfer', { from_bucket_id: a.id, to_bucket_id: b.id, amount: 10 });
  assert.equal(move.status, 200);
  const x = move.data.buckets.find((p) => p.id === a.id);
  const y = move.data.buckets.find((p) => p.id === b.id);
  assert.equal(cents(x.balance), cents(a.balance) - 1000);
  assert.equal(cents(y.balance), cents(b.balance) + 1000);
  assert.equal(cents(move.data.balance), cents(w.balance), 'a transfer never changes the total');

  const tooMuch = await call('POST', '/api/wallet/transfer', { from_bucket_id: a.id, to_bucket_id: null, amount: 1e6 });
  assert.equal(tooMuch.status, 400);
  const same = await call('POST', '/api/wallet/transfer', { from_bucket_id: a.id, to_bucket_id: a.id, amount: 1 });
  assert.equal(same.status, 400);
});

test('rules: remainder goes unallocated, over 100 is rejected, closing a pot sweeps its balance', async () => {
  const w = (await call('GET', '/api/wallet')).data;
  const total = cents(w.balance);

  const over = await call('PUT', '/api/wallet/rules', { rules: [{ name: 'A', percent: 70 }, { name: 'B', percent: 40 }] });
  assert.equal(over.status, 400);
  const dupe = await call('PUT', '/api/wallet/rules', { rules: [{ name: 'A', percent: 10 }, { name: 'a', percent: 10 }] });
  assert.equal(dupe.status, 400);

  const keep = w.buckets[0];
  const saved = await call('PUT', '/api/wallet/rules', { rules: [{ id: keep.id, name: 'Stock', percent: 60 }, { name: 'Fuel', percent: 20, color: '#3B82F6' }] });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.buckets.length, 2);
  assert.equal(saved.data.percent_assigned, 80);
  assert.equal(cents(saved.data.balance), total, 'closing pots must not lose or create money');
  const potSum = saved.data.buckets.reduce((s, p) => s + cents(p.balance), 0) + cents(saved.data.unallocated.balance);
  assert.equal(potSum, total);

  const before = cents(saved.data.unallocated.balance);
  await call('POST', '/api/products', { name: 'Tea', price: 100, stock_qty: 5 });
  const tea = (await call('GET', '/api/products')).data.find((p) => p.name === 'Tea');
  await call('POST', '/api/sales', { items: [{ product_id: tea.id, quantity: 1 }], amount_paid: 100 });
  const after = (await call('GET', '/api/wallet')).data;
  assert.equal(cents(after.unallocated.balance) - before, 2000, '20 percent was left unassigned');
});

test('deleting a product that was sold is refused with an explanation', async () => {
  const res = await call('DELETE', `/api/products/${sugar.id}`);
  assert.equal(res.status, 409);
  assert.match(res.data.error, /past sales/);
  const unsold = (await call('POST', '/api/products', { name: 'Unsold', price: 1 })).data;
  assert.equal((await call('DELETE', `/api/products/${unsold.id}`)).status, 200);
});

test('restock adds units atomically', async () => {
  const res = await call('POST', `/api/products/${oil.id}/restock`, { quantity: 12 });
  assert.equal(res.status, 200);
  assert.equal(res.data.stock_qty, 13);
  assert.equal((await call('POST', `/api/products/${oil.id}/restock`, { quantity: 0 })).status, 400);
});

test('dashboard returns EAT day keys and consistent totals', async () => {
  const d = (await call('GET', '/api/dashboard')).data;
  assert.equal(d.sales_last_7_days.length, 7);
  assert.equal(d.sales_last_7_days[6].date, d.today);
  assert.ok(d.sales_last_7_days[6].total > 0);
  assert.ok(Array.isArray(d.best_sellers));
});

test('live stream emits an event when money moves', async () => {
  const ctrl = new AbortController();
  const res = await fetch(base + '/api/wallet/stream', { headers: { Authorization: `Bearer ${token}` }, signal: ctrl.signal });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);

  const reader = res.body.getReader();
  const got = new Promise((resolve) => {
    let buf = '';
    const decoder = new TextDecoder();
    (async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buf += decoder.decode(value);
        if (buf.includes('event: wallet')) return resolve(true);
      }
    })().catch(() => resolve(false));
  });

  await call('POST', '/api/expenses', { category: 'Transport', amount: 20 });
  assert.equal(await Promise.race([got, new Promise((r) => setTimeout(() => r(false), 3000))]), true);
  ctrl.abort();
});

test('logout revokes the token', async () => {
  const out = await call('POST', '/api/auth/logout');
  assert.equal(out.status, 200);
  assert.equal((await call('GET', '/api/wallet')).status, 401);
});
