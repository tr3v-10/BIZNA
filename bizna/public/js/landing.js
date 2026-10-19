/**
 * The interactive example on the landing page: tap a sale and watch it divide
 * across four example pots using the same split rule as the real wallet.
 * It runs entirely in the page and is labelled as sample figures.
 */

import { splitCents } from './split.js';
import { $, $$, esc, KES, pct, animateMoney } from './util.js';

const POTS = [
  { id: 1, name: 'Restock', percent: 50, color: '#12B76A' },
  { id: 2, name: 'Rent and bills', percent: 20, color: '#3B82F6' },
  { id: 3, name: 'Savings', percent: 15, color: '#FFB020' },
  { id: 4, name: 'Owner pay', percent: 15, color: '#F2557A' },
];
const SPEND = 200;

let balances = new Map();
let bound = false;

const reset = () => { balances = new Map(POTS.map((p) => [p.id, 0])); };
const total = () => [...balances.values()].reduce((a, b) => a + b, 0);

function render() {
  animateMoney($('#sp-total'), total());
  const positive = POTS.filter((p) => balances.get(p.id) > 0);
  $('#sp-stack').innerHTML = positive.length
    ? positive.map((p) => `<span style="flex-grow:${balances.get(p.id)};background:${p.color}"></span>`).join('')
    : '<span style="flex-grow:1;background:rgba(255,255,255,.12)"></span>';
  $('#sp-pots').innerHTML = POTS.map((p) => `
    <li><i class="dot" style="background:${p.color}"></i><span class="name">${esc(p.name)}<small>${pct(p.percent)}%</small></span><span class="amt">${esc(KES(balances.get(p.id)))}</span></li>`).join('');
}

function setHint(text) {
  $('.sp-hint').textContent = text;
}

export function initLanding() {
  if (bound) return;
  bound = true;
  reset();
  render();

  $('#sp-chips').addEventListener('click', (event) => {
    const chip = event.target.closest('[data-amount]');
    if (!chip) return;
    const cents = Math.round(Number(chip.dataset.amount) * 100);
    splitCents(cents, POTS).forEach((s) => balances.set(s.bucket_id, balances.get(s.bucket_id) + s.cents / 100));
    setHint(`${KES(cents / 100)} came in and was divided by the percentages above.`);
    render();
  });

  $('#sp-spend').addEventListener('click', () => {
    if (balances.get(1) < SPEND) {
      setHint(`Restock only holds ${KES(balances.get(1))}. Tap a sale first, then spend.`);
      return;
    }
    balances.set(1, balances.get(1) - SPEND);
    setHint(`${KES(SPEND)} left the Restock pot. The other pots did not change.`);
    render();
  });

  $('#sp-reset').addEventListener('click', () => {
    reset();
    setHint('Tap a sale and watch it divide by the rules above.');
    render();
  });
}
