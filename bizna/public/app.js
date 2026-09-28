// app.js — plain JS, no build step needed. Talks to the Express API under /api.

let token = localStorage.getItem('bizna_token') || null;
let products = [];
let paymentModalCustomerId = null;

const KES = (n) => `KES ${Number(n).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) {
    logout();
    throw new Error('Session expired. Please log in again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// --- Toasts ---
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('leaving');
    setTimeout(() => toast.remove(), 250);
  }, 2800);
}

// --- Button loading state ---
function setButtonLoading(btn, loading) {
  btn.disabled = loading;
  const spinner = btn.querySelector('.spinner');
  const label = btn.querySelector('.btn-label');
  if (spinner) spinner.classList.toggle('hidden', !loading);
  if (label) label.style.opacity = loading ? '0.6' : '1';
}

// --- Animated counters ---
function animateValue(el, to) {
  const from = Number(el.dataset.raw || 0);
  el.dataset.raw = to;
  const duration = 500;
  const start = performance.now();
  function tick(now) {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const value = from + (to - from) * eased;
    el.textContent = KES(value);
    if (progress < 1) requestAnimationFrame(tick);
    else el.textContent = KES(to);
  }
  requestAnimationFrame(tick);
}

function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app-screen').classList.remove('hidden');
  loadDashboard();
  loadProducts();
  loadCustomersInto('#sale-customer');
}

function logout() {
  token = null;
  localStorage.removeItem('bizna_token');
  document.getElementById('app-screen').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('login-username').value;
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  const submitBtn = document.getElementById('login-submit');
  errorEl.textContent = '';
  setButtonLoading(submitBtn, true);
  try {
    const data = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    token = data.token;
    localStorage.setItem('bizna_token', token);
    showApp();
  } catch (err) {
    errorEl.textContent = err.message;
  } finally {
    setButtonLoading(submitBtn, false);
  }
});

document.getElementById('logout-btn').addEventListener('click', logout);

// --- Tabs ---
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.add('hidden'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.remove('hidden');
    if (btn.dataset.tab === 'dashboard') loadDashboard();
    if (btn.dataset.tab === 'expenses') loadExpenses();
    if (btn.dataset.tab === 'customers') loadCustomers();
    if (btn.dataset.tab === 'sales') loadRecentSales();
  });
});

// --- Dashboard ---
async function loadDashboard() {
  try {
    const d = await api('/dashboard');
    animateValue(document.getElementById('stat-today'), d.sales_today);
    animateValue(document.getElementById('stat-sales'), d.total_sales);
    animateValue(document.getElementById('stat-expenses'), d.total_expenses);
    animateValue(document.getElementById('stat-profit'), d.profit);
    animateValue(document.getElementById('stat-credit'), d.outstanding_credit);

    renderChart(d.sales_last_7_days);

    const list = document.getElementById('low-stock-list');
    list.innerHTML = '';
    if (d.low_stock_products.length === 0) {
      list.innerHTML = '<li class="muted">Nothing low on stock.</li>';
    } else {
      d.low_stock_products.forEach((p) => {
        const li = document.createElement('li');
        li.innerHTML = `<span>${p.name}</span><span class="badge low">${p.stock_qty} left</span>`;
        list.appendChild(li);
      });
    }
  } catch (err) { console.error(err); }
}

function renderChart(days) {
  const wrap = document.getElementById('sales-chart');
  const max = Math.max(...days.map((d) => d.total), 1);
  const todayKey = new Date().toISOString().slice(0, 10);
  wrap.innerHTML = days.map((d) => {
    const heightPct = Math.max((d.total / max) * 100, 2);
    const label = new Date(d.date + 'T00:00:00').toLocaleDateString('en-KE', { weekday: 'short' })[0];
    const isToday = d.date === todayKey ? ' is-today' : '';
    return `<div class="chart-bar-col${isToday}" title="${KES(d.total)}">
      <div class="chart-bar" style="height:2px" data-target="${heightPct}"></div>
      <span class="chart-bar-label">${label}</span>
    </div>`;
  }).join('');
  // Animate bars up on the next frame so the CSS transition actually plays
  requestAnimationFrame(() => {
    wrap.querySelectorAll('.chart-bar').forEach((bar) => {
      bar.style.height = `${bar.dataset.target}%`;
    });
  });
}

// --- Products ---
async function loadProducts() {
  products = await api('/products');
  const tbody = document.querySelector('#products-table tbody');
  tbody.innerHTML = '';
  products.forEach((p) => {
    const tr = document.createElement('tr');
    const low = p.stock_qty <= p.low_stock_threshold;
    tr.innerHTML = `<td>${p.name}</td><td class="money">${KES(p.price)}</td>
      <td><span class="badge ${low ? 'low' : 'ok'}">${p.stock_qty}</span></td>
      <td><button data-id="${p.id}" data-name="${p.name}" class="delete-product secondary">Remove</button></td>`;
    tbody.appendChild(tr);
  });
  document.querySelectorAll('.delete-product').forEach((btn) =>
    btn.addEventListener('click', () => {
      openConfirm(`Remove "${btn.dataset.name}"?`, async () => {
        await api(`/products/${btn.dataset.id}`, { method: 'DELETE' });
        showToast('Product removed.');
        loadProducts();
      });
    })
  );
  renderSaleItemOptions();
}

document.getElementById('product-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('product-name').value;
  const price = document.getElementById('product-price').value;
  const stock_qty = document.getElementById('product-stock').value || 0;
  await api('/products', { method: 'POST', body: JSON.stringify({ name, price, stock_qty }) });
  e.target.reset();
  showToast(`${name} added to stock.`);
  loadProducts();
});

// --- Sales ---
function renderSaleItemOptions() {
  document.querySelectorAll('.sale-item-row select').forEach((sel) => fillProductSelect(sel));
}

function fillProductSelect(select) {
  const current = select.value;
  select.innerHTML = products.map((p) => `<option value="${p.id}">${p.name} (${p.stock_qty} in stock)</option>`).join('');
  if (current) select.value = current;
}

function addSaleItemRow() {
  const row = document.createElement('div');
  row.className = 'sale-item-row';
  row.innerHTML = `
    <select class="item-product"></select>
    <input type="number" class="item-qty" min="1" value="1">
    <button type="button" class="secondary remove-row">✕</button>`;
  document.getElementById('sale-items').appendChild(row);
  fillProductSelect(row.querySelector('select'));
  row.querySelector('.remove-row').addEventListener('click', () => { row.remove(); recalcTotal(); });
  row.querySelectorAll('select, input').forEach((el) => el.addEventListener('input', recalcTotal));
  recalcTotal();
}

function recalcTotal() {
  let total = 0;
  document.querySelectorAll('.sale-item-row').forEach((row) => {
    const productId = Number(row.querySelector('.item-product').value);
    const qty = Number(row.querySelector('.item-qty').value) || 0;
    const product = products.find((p) => p.id === productId);
    if (product) total += product.price * qty;
  });
  document.getElementById('sale-total').textContent = KES(total);
}

document.getElementById('add-item-row').addEventListener('click', addSaleItemRow);

// Payment method pill picker
document.getElementById('sale-payment-method').addEventListener('click', (e) => {
  const btn = e.target.closest('.method-btn');
  if (!btn) return;
  document.querySelectorAll('.method-btn').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('sale-payment-method').dataset.value = btn.dataset.value;
});

document.getElementById('submit-sale').addEventListener('click', async () => {
  const items = [...document.querySelectorAll('.sale-item-row')].map((row) => ({
    product_id: Number(row.querySelector('.item-product').value),
    quantity: Number(row.querySelector('.item-qty').value),
  }));
  const amount_paid = Number(document.getElementById('sale-amount-paid').value || 0);
  const payment_method = document.getElementById('sale-payment-method').dataset.value;
  const customer_id = document.getElementById('sale-customer').value || null;
  const msg = document.getElementById('sale-message');
  const btn = document.getElementById('submit-sale');
  msg.textContent = '';
  if (items.length === 0) { msg.textContent = 'Add at least one product.'; msg.style.color = 'var(--bad)'; return; }

  setButtonLoading(btn, true);
  try {
    await api('/sales', { method: 'POST', body: JSON.stringify({ items, amount_paid, payment_method, customer_id }) });
    showToast('Sale recorded ✓');
    document.getElementById('sale-items').innerHTML = '';
    document.getElementById('sale-amount-paid').value = '';
    addSaleItemRow();
    loadProducts();
    loadRecentSales();
    loadDashboard();
  } catch (err) {
    msg.textContent = err.message;
    msg.style.color = 'var(--bad)';
    showToast(err.message, 'error');
  } finally {
    setButtonLoading(btn, false);
  }
});

async function loadRecentSales() {
  const sales = await api('/sales');
  const list = document.getElementById('recent-sales-list');
  list.innerHTML = '';
  sales.slice(0, 15).forEach((s) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${s.customer_name || 'Walk-in'} · ${new Date(s.created_at).toLocaleString()}</span><span>${KES(s.total)}</span>`;
    list.appendChild(li);
  });
}

// --- Expenses ---
async function loadExpenses() {
  const expenses = await api('/expenses');
  const tbody = document.querySelector('#expenses-table tbody');
  tbody.innerHTML = expenses.map((e) => `
    <tr><td>${e.category}</td><td>${e.description || ''}</td><td class="money">${KES(e.amount)}</td>
    <td>${new Date(e.created_at).toLocaleDateString()}</td></tr>`).join('');
}

document.getElementById('expense-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const category = document.getElementById('expense-category').value;
  const description = document.getElementById('expense-description').value;
  const amount = document.getElementById('expense-amount').value;
  await api('/expenses', { method: 'POST', body: JSON.stringify({ category, description, amount }) });
  e.target.reset();
  showToast('Expense logged.');
  loadExpenses();
  loadDashboard();
});

// --- Customers ---
async function loadCustomers() {
  const customers = await api('/customers');
  const tbody = document.querySelector('#customers-table tbody');
  tbody.innerHTML = customers.map((c) => `
    <tr><td>${c.name}</td><td>${c.phone || ''}</td><td class="money">${KES(c.balance_owed)}</td>
    <td>${c.balance_owed > 0 ? `<button class="secondary pay-btn" data-id="${c.id}">Record payment</button>` : ''}</td></tr>`).join('');
  document.querySelectorAll('.pay-btn').forEach((btn) =>
    btn.addEventListener('click', () => openPaymentModal(btn.dataset.id))
  );
}

async function loadCustomersInto(selector) {
  const customers = await api('/customers').catch(() => []);
  const select = document.querySelector(selector);
  select.innerHTML = '<option value="">Walk-in</option>' + customers.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
}

document.getElementById('customer-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('customer-name').value;
  const phone = document.getElementById('customer-phone').value;
  await api('/customers', { method: 'POST', body: JSON.stringify({ name, phone }) });
  e.target.reset();
  showToast(`${name} added.`);
  loadCustomers();
  loadCustomersInto('#sale-customer');
});

// --- Confirm modal (replaces window.confirm) ---
let confirmAction = null;
function openConfirm(message, onConfirm) {
  document.getElementById('confirm-message').textContent = message;
  confirmAction = onConfirm;
  document.getElementById('confirm-modal').classList.remove('hidden');
}
document.getElementById('confirm-cancel').addEventListener('click', () => {
  document.getElementById('confirm-modal').classList.add('hidden');
  confirmAction = null;
});
document.getElementById('confirm-ok').addEventListener('click', async () => {
  document.getElementById('confirm-modal').classList.add('hidden');
  if (confirmAction) await confirmAction();
  confirmAction = null;
});

// --- Payment modal (replaces window.prompt) ---
function openPaymentModal(customerId) {
  paymentModalCustomerId = customerId;
  document.getElementById('payment-amount-input').value = '';
  document.getElementById('payment-modal').classList.remove('hidden');
  document.getElementById('payment-amount-input').focus();
}
document.getElementById('payment-cancel').addEventListener('click', () => {
  document.getElementById('payment-modal').classList.add('hidden');
  paymentModalCustomerId = null;
});
document.getElementById('payment-ok').addEventListener('click', async () => {
  const amount = Number(document.getElementById('payment-amount-input').value);
  if (!amount || amount <= 0) return;
  await api(`/customers/${paymentModalCustomerId}/pay`, { method: 'POST', body: JSON.stringify({ amount }) });
  document.getElementById('payment-modal').classList.add('hidden');
  showToast('Payment recorded.');
  loadCustomers();
  loadDashboard();
});

// --- Init ---
addSaleItemRow();
if (token) showApp();
