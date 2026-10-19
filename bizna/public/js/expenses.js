/**
 * Expenses screen: record spending against a wallet pot and review it.
 * Spending is never blocked; a pot that goes below zero shows as overspent on
 * the Wallet screen.
 */

import { api } from './api.js';
import { confirmDialog } from './dialog.js';
import { store, refresh, potChoices } from './wallet.js';
import { $, esc, KES, when, toast, withBusy } from './util.js';

let bound = false;

function fillPots() {
  const select = $('#e-pot');
  const keep = select.value;
  const pots = potChoices();
  select.innerHTML = pots.map((p) => `<option value="${p.id === null ? '' : p.id}">${esc(p.name)}</option>`).join('');
  if ([...select.options].some((o) => o.value === keep)) select.value = keep;
  updateHint();
}

function updateHint() {
  const field = $('#e-pot').closest('.field');
  let hint = $('.hint', field);
  if (!hint) {
    hint = document.createElement('span');
    hint.className = 'hint';
    field.append(hint);
  }
  const pot = potChoices().find((p) => String(p.id ?? '') === $('#e-pot').value);
  const amount = Number($('#e-amount').value) || 0;
  if (!pot) return;
  const over = amount > 0 && amount > pot.balance;
  hint.textContent = over ? `${pot.name} holds ${KES(pot.balance)}, so this will overspend it.` : `${pot.name} holds ${KES(pot.balance)}.`;
  hint.style.color = over ? 'var(--coral-text)' : '';
  hint.style.fontWeight = over ? '650' : '';
}

async function load() {
  const expenses = await api('/expenses');
  $('#e-table tbody').innerHTML = expenses.map((e) => `
    <tr data-id="${e.id}">
      <td data-label="Date">${esc(when(e.created_at))}</td>
      <td class="primary-cell" data-label="Category">${esc(e.category)}</td>
      <td data-label="Note">${esc(e.description || '')}</td>
      <td data-label="Paid from"><span class="potchip"><i class="dot" style="background:${esc(e.bucket_color)}"></i>${esc(e.bucket_name)}</span></td>
      <td class="r" data-label="Amount">${esc(KES(e.amount))}</td>
      <td class="actions"><button type="button" class="btn danger sm" data-delete="${e.id}">Delete</button></td>
    </tr>`).join('');
  $('#e-empty').hidden = expenses.length > 0;
}

function bind() {
  if (bound) return;
  bound = true;

  $('#e-pot').addEventListener('change', updateHint);
  $('#e-amount').addEventListener('input', updateHint);

  $('#e-form').addEventListener('submit', (event) => {
    event.preventDefault();
    withBusy($('#e-form [type="submit"]'), async () => {
      const bucket = $('#e-pot').value;
      await api('/expenses', {
        method: 'POST',
        body: {
          category: $('#e-category').value.trim(),
          description: $('#e-note').value.trim(),
          amount: Number($('#e-amount').value),
          bucket_id: bucket ? Number(bucket) : null,
        },
      });
      toast('Expense recorded.');
      $('#e-category').value = '';
      $('#e-note').value = '';
      $('#e-amount').value = '';
      await Promise.all([load(), refresh().then(fillPots).catch(() => {})]);
    });
  });

  $('#e-table').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-delete]');
    if (!button) return;
    const ok = await confirmDialog({
      title: 'Delete this expense?',
      message: 'The money goes back into the pot it was paid from.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/expenses/${button.dataset.delete}`, { method: 'DELETE' });
      toast('Expense deleted.');
      await Promise.all([load(), refresh().then(fillPots).catch(() => {})]);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

export async function showExpenses() {
  bind();
  if (!store.data) await refresh().catch(() => {});
  fillPots();
  await load();
}
