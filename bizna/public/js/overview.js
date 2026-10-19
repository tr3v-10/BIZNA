/**
 * Overview screen: today's numbers, the 7 day sales chart, a live wallet
 * snapshot, best sellers, low stock and who owes money.
 */

import { api } from './api.js';
import { renderPotLines, renderStack, subscribe, store } from './wallet.js';
import { $, esc, KES, short, weekday, animateMoney } from './util.js';

let bound = false;

function greeting() {
  const hour = Number(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Africa/Nairobi' }).slice(0, 2));
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

const list = (items, render, empty) =>
  items.length ? items.map(render).join('') : `<li class="empty-row">${esc(empty)}</li>`;

function renderWalletParts(s) {
  animateMoney($('#ov-balance'), s.balance);
  $('#ov-balance-meta').textContent = `${KES(s.in_today)} in, ${KES(s.out_today)} out today`;
  animateMoney($('#ov-out'), s.out_today);
  $('#ov-out-meta').textContent = s.avg_daily_spend > 0 ? `Usual pace: ${KES(s.avg_daily_spend)} a day` : 'No spending in the last 7 days';
  renderStack($('#ov-stack'), s);
  renderPotLines($('#ov-pots'), s);
}

function renderChart(days, today) {
  const max = Math.max(...days.map((d) => d.total), 0);
  $('#ov-chart').innerHTML = days.map((d) => {
    const h = max > 0 ? Math.max(2, (d.total / max) * 100) : 2;
    return `
      <div class="bar-col ${d.date === today ? 'today' : ''}" title="${esc(weekday(d.date))}: ${esc(KES(d.total))}">
        <span class="v">${d.total > 0 ? short(d.total) : ''}</span>
        <div class="bar" style="height:${h * 0.72}%"></div>
        <span class="d">${esc(d.date === today ? 'Today' : weekday(d.date))}</span>
      </div>`;
  }).join('');
}

function render(d) {
  animateMoney($('#ov-today'), d.sales_today);
  $('#ov-today-count').textContent = d.sales_count_today === 1 ? '1 sale so far' : `${d.sales_count_today} sales so far`;
  animateMoney($('#ov-credit'), d.outstanding_credit);
  $('#ov-credit-meta').textContent = d.debtor_count > 0 ? (d.debtor_count === 1 ? '1 customer owes you' : `${d.debtor_count} customers owe you`) : 'Nobody owes you';

  renderChart(d.sales_last_7_days, d.today);

  $('#ov-best').innerHTML = list(d.best_sellers, (b) => `
    <li><div class="main"><strong>${esc(b.name)}</strong><span>${b.quantity} sold</span></div><span class="end">${esc(KES(b.revenue))}</span></li>`,
  'No sales in the last 30 days yet.');

  $('#ov-low').innerHTML = list(d.low_stock_products, (p) => `
    <li><div class="main"><strong>${esc(p.name)}</strong><span>Warns at ${p.low_stock_threshold}</span></div>
    <span class="badge ${p.stock_qty === 0 ? 'out' : 'low'}">${p.stock_qty === 0 ? 'Out of stock' : `${p.stock_qty} left`}</span></li>`,
  'Nothing is running low.');

  $('#ov-debtors').innerHTML = list(d.top_debtors, (c) => `
    <li><div class="main"><strong>${esc(c.name)}</strong></div><span class="end">${esc(KES(c.balance_owed))}</span></li>`,
  'Nobody owes you anything.');

  $('#ov-total-sales').textContent = KES(d.total_sales);
  $('#ov-total-expenses').textContent = KES(d.total_expenses);
  $('#ov-profit').textContent = KES(d.profit);
}

export function initOverview() {
  if (bound) return;
  bound = true;
  subscribe((s) => {
    if (!$('#page-overview').hidden) renderWalletParts(s);
  });
}

export async function showOverview() {
  $('#greeting').textContent = greeting();
  $('#today-label').textContent = new Date().toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Nairobi' });
  if (store.data) renderWalletParts(store.data);
  render(await api('/dashboard'));
}
