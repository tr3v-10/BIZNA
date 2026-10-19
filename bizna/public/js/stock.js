/**
 * Stock screen: add products, see what is in stock, restock and remove.
 */

import { api } from './api.js';
import { confirmDialog, formDialog } from './dialog.js';
import { $, esc, KES, toast, withBusy } from './util.js';

let bound = false;

function badge(p) {
  if (p.stock_qty === 0) return '<span class="badge out">Out of stock</span>';
  if (p.stock_qty <= p.low_stock_threshold) return `<span class="badge low">${p.stock_qty} left</span>`;
  return `<span class="badge">${p.stock_qty}</span>`;
}

async function load() {
  const products = await api('/products');
  $('#p-table tbody').innerHTML = products.map((p) => `
    <tr data-id="${p.id}">
      <td class="primary-cell" data-label="Product">${esc(p.name)}</td>
      <td class="r" data-label="Price">${esc(KES(p.price))}</td>
      <td class="r" data-label="In stock">${badge(p)}</td>
      <td class="r" data-label="Warn at">${p.low_stock_threshold}</td>
      <td class="actions">
        <button type="button" class="btn secondary sm" data-restock="${p.id}">Restock</button>
        <button type="button" class="btn danger sm" data-remove="${p.id}">Remove</button>
      </td>
    </tr>`).join('');
  $('#p-empty').hidden = products.length > 0;
  return products;
}

function bind() {
  if (bound) return;
  bound = true;

  $('#p-form').addEventListener('submit', (event) => {
    event.preventDefault();
    withBusy($('#p-form [type="submit"]'), async () => {
      await api('/products', {
        method: 'POST',
        body: {
          name: $('#p-name').value.trim(),
          price: Number($('#p-price').value),
          stock_qty: Number($('#p-stock').value) || 0,
          low_stock_threshold: Number($('#p-alert').value) || 0,
        },
      });
      toast(`${$('#p-name').value.trim()} added.`);
      $('#p-form').reset();
      $('#p-stock').value = '0';
      $('#p-alert').value = '5';
      await load();
    });
  });

  $('#p-table').addEventListener('click', async (event) => {
    const restock = event.target.closest('[data-restock]');
    const remove = event.target.closest('[data-remove]');
    const row = event.target.closest('tr');
    if (!row) return;
    const name = $('td', row).textContent;

    if (restock) {
      formDialog({
        title: `Restock ${name}`,
        note: 'Enter how many units arrived. They are added to what is already in stock.',
        submitLabel: 'Add to stock',
        fields: [{ name: 'quantity', label: 'Units received', type: 'number', min: 1, step: 1, inputmode: 'numeric' }],
        onSubmit: async (v) => {
          await api(`/products/${restock.dataset.restock}/restock`, { method: 'POST', body: { quantity: Number(v.quantity) } });
          toast(`${v.quantity} added to ${name}.`);
          await load();
        },
      });
    }

    if (remove) {
      const ok = await confirmDialog({ title: `Remove ${name}?`, message: 'It will no longer appear in new sales. Products that were already sold cannot be removed.', confirmLabel: 'Remove', danger: true });
      if (!ok) return;
      try {
        await api(`/products/${remove.dataset.remove}`, { method: 'DELETE' });
        toast(`${name} removed.`);
        await load();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });
}

export async function showStock() {
  bind();
  await load();
}
