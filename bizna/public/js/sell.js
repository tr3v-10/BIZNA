/**
 * New sale screen. The form builds a basket, works out the total and the part
 * that goes on credit, and previews how the amount paid will be divided into
 * the wallet pots before the sale is saved.
 */

import { api } from './api.js';
import { store, refresh } from './wallet.js';
import { previewSplit } from './split.js';
import { $, $$, esc, KES, when, toast, withBusy } from './util.js';

let products = [];
let lines = [];
let method = 'cash';
let paidTouched = false;
let bound = false;

const priceOf = (id) => products.find((p) => p.id === Number(id))?.price ?? 0;
const total = () => Math.round(lines.reduce((sum, l) => sum + priceOf(l.product_id) * 100 * (Number(l.quantity) || 0), 0)) / 100;
const paid = () => Math.round((Number($('#s-paid').value) || 0) * 100) / 100;

function productOptions(selected) {
  return `<option value="">Choose a product</option>${products.map((p) =>
    `<option value="${p.id}" ${p.id === Number(selected) ? 'selected' : ''} ${p.stock_qty === 0 ? 'disabled' : ''}>${esc(p.name)}, ${esc(KES(p.price))} (${p.stock_qty} in stock)</option>`).join('')}`;
}

function renderLines() {
  $('#s-items').innerHTML = lines.map((l, i) => `
    <div class="sale-line" data-index="${i}">
      <select aria-label="Product" data-field="product_id">${productOptions(l.product_id)}</select>
      <input type="number" min="1" step="1" inputmode="numeric" value="${l.quantity}" aria-label="Quantity" data-field="quantity">
      <span class="line-total">${esc(KES(priceOf(l.product_id) * (Number(l.quantity) || 0)))}</span>
      <button type="button" class="icon-btn remove" aria-label="Remove this product" data-remove ${lines.length === 1 ? 'disabled' : ''}><svg class="icon"><use href="#i-trash"/></svg></button>
    </div>`).join('');
}

function updateTotals() {
  const t = total();
  if (!paidTouched) $('#s-paid').value = method === 'credit' ? '0' : String(t);
  const p = paid();
  const due = Math.max(0, Math.round((t - p) * 100) / 100);
  $('#s-total').textContent = KES(t);
  $('#s-paid-now').textContent = KES(Math.min(p, t));
  $('#s-due').textContent = KES(due);
  $$('.sale-line').forEach((row, i) => {
    $('.line-total', row).textContent = KES(priceOf(lines[i].product_id) * (Number(lines[i].quantity) || 0));
  });

  const buckets = store.data ? [...store.data.buckets] : [];
  const split = previewSplit(Math.min(p, t), buckets);
  $('#s-preview').innerHTML = split.length
    ? split.map((x) => `<li style="--dot:${esc(x.color)}"><span class="dot"></span><span>${esc(x.name)}</span><span class="amt">${esc(KES(x.amount))}</span></li>`).join('')
    : '<li style="display:block"><span class="none">Nothing enters the wallet until money is paid.</span></li>';
}

function setMethod(value) {
  method = value;
  $$('#s-method button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.value === value)));
  paidTouched = false;
  updateTotals();
}

function resetForm() {
  lines = [{ product_id: '', quantity: 1 }];
  paidTouched = false;
  $('#s-customer').value = '';
  $('#s-error').textContent = '';
  setMethod('cash');
  renderLines();
  updateTotals();
}

async function loadRecent() {
  const sales = await api('/sales');
  $('#s-recent').innerHTML = sales.slice(0, 6).map((s) => {
    const due = Math.round((s.total - s.amount_paid) * 100) / 100;
    return `<li><div class="main"><strong>${esc(s.customer_name || 'Walk-in customer')}</strong><span>${esc(s.payment_method)}, ${esc(when(s.created_at))}${due > 0 ? `, ${esc(KES(due))} on credit` : ''}</span></div><span class="end">${esc(KES(s.total))}</span></li>`;
  }).join('') || '<li class="empty-row">No sales yet. Your first one will show up here.</li>';
}

function bind() {
  if (bound) return;
  bound = true;

  const items = $('#s-items');
  items.addEventListener('input', (event) => {
    const row = event.target.closest('.sale-line');
    if (!row) return;
    lines[Number(row.dataset.index)][event.target.dataset.field] = event.target.value;
    updateTotals();
  });
  items.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-remove]');
    if (!remove || lines.length === 1) return;
    lines.splice(Number(remove.closest('.sale-line').dataset.index), 1);
    renderLines();
    updateTotals();
  });

  $('#s-add').addEventListener('click', () => {
    lines.push({ product_id: '', quantity: 1 });
    renderLines();
    updateTotals();
  });

  $('#s-method').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-value]');
    if (button) setMethod(button.dataset.value);
  });

  $('#s-paid').addEventListener('input', () => {
    paidTouched = true;
    updateTotals();
  });
  $('#s-paid-full').addEventListener('click', () => {
    paidTouched = false;
    $('#s-paid').value = String(total());
    updateTotals();
  });

  $('#s-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const error = $('#s-error');
    error.textContent = '';
    const chosen = lines.filter((l) => l.product_id);
    if (chosen.length === 0) {
      error.textContent = 'Choose at least one product.';
      return;
    }
    if (lines.some((l) => !l.product_id)) {
      error.textContent = 'Choose a product for every row, or remove the empty one.';
      return;
    }
    withBusy($('#s-submit'), async () => {
      try {
        const sale = await api('/sales', {
          method: 'POST',
          body: {
            items: chosen.map((l) => ({ product_id: Number(l.product_id), quantity: Number(l.quantity) })),
            amount_paid: paid(),
            payment_method: method,
            customer_id: $('#s-customer').value ? Number($('#s-customer').value) : null,
          },
        });
        toast(`Sale saved: ${KES(sale.total)}`);
        await Promise.all([loadProducts(), loadRecent(), refresh().catch(() => {})]);
        resetForm();
      } catch (err) {
        error.textContent = err.message;
      }
    });
  });
}

async function loadProducts() {
  products = await api('/products');
}

export async function showSell() {
  bind();
  const [, customers] = await Promise.all([loadProducts(), api('/customers'), loadRecent()]);
  $('#s-customer').innerHTML = `<option value="">Walk-in customer</option>${customers.map((c) =>
    `<option value="${c.id}">${esc(c.name)}${c.balance_owed > 0 ? ` (owes ${esc(KES(c.balance_owed))})` : ''}</option>`).join('')}`;
  resetForm();
  if (!store.data) refresh().then(updateTotals).catch(() => {});
}
