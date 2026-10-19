/**
 * Customers screen: who you sell to, what they owe, and repayments.
 */

import { api } from './api.js';
import { formDialog } from './dialog.js';
import { refresh } from './wallet.js';
import { $, esc, KES, toast, withBusy } from './util.js';

let bound = false;
let customers = [];

async function load() {
  customers = await api('/customers');
  $('#c-table tbody').innerHTML = customers.map((c) => `
    <tr data-id="${c.id}">
      <td class="primary-cell" data-label="Name">${esc(c.name)}</td>
      <td data-label="Phone">${esc(c.phone || 'No phone')}</td>
      <td class="r" data-label="Owes you"><span class="owes ${c.balance_owed > 0 ? '' : 'clear'}">${c.balance_owed > 0 ? esc(KES(c.balance_owed)) : 'Nothing'}</span></td>
      <td class="actions">${c.balance_owed > 0 ? `<button type="button" class="btn secondary sm" data-pay="${c.id}">Record payment</button>` : ''}</td>
    </tr>`).join('');
  $('#c-empty').hidden = customers.length > 0;
}

function bind() {
  if (bound) return;
  bound = true;

  $('#c-form').addEventListener('submit', (event) => {
    event.preventDefault();
    withBusy($('#c-form [type="submit"]'), async () => {
      const name = $('#c-name').value.trim();
      await api('/customers', { method: 'POST', body: { name, phone: $('#c-phone').value.trim() } });
      toast(`${name} added.`);
      $('#c-form').reset();
      await load();
    });
  });

  $('#c-table').addEventListener('click', (event) => {
    const button = event.target.closest('[data-pay]');
    if (!button) return;
    const customer = customers.find((c) => c.id === Number(button.dataset.pay));
    if (!customer) return;
    formDialog({
      title: `Payment from ${customer.name}`,
      note: `They owe ${KES(customer.balance_owed)}. The payment goes into your wallet and is divided into your pots.`,
      submitLabel: 'Record payment',
      fields: [{ name: 'amount', label: 'Amount received (KES)', type: 'number', min: 0.01, step: 0.01, inputmode: 'decimal', value: customer.balance_owed }],
      onSubmit: async (v) => {
        const result = await api(`/customers/${customer.id}/pay`, { method: 'POST', body: { amount: Number(v.amount) } });
        toast(`Recorded ${KES(result.applied)} from ${customer.name}.`);
        await Promise.all([load(), refresh().catch(() => {})]);
      },
    });
  });
}

export async function showCustomers() {
  bind();
  await load();
}
