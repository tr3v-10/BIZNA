/**
 * Wallet: shared data store, live connection and the Wallet screen.
 *
 * The store holds the latest /api/wallet summary. Other screens subscribe to it,
 * so the overview and the sale form update from the same live data.
 *
 * Live updates: the server pushes a "wallet" event over Server-Sent Events
 * whenever money moves. The stream is read with fetch (EventSource cannot send
 * an Authorization header), reconnects with backoff, and a slow poll runs as a
 * safety net. In demo mode the in-browser sample data signals changes instead.
 */

import { api, session } from './api.js';
import { onDemoChange } from './demo.js';
import { formDialog } from './dialog.js';
import {
  $, esc, KES, pct, ago, hourLabel, animateMoney, toast, withBusy,
} from './util.js';

const PALETTE = ['#12B76A', '#3B82F6', '#FFB020', '#F2557A', '#7C5CFC', '#14B8A6', '#FB7C2D', '#E64FB0'];
const POLL_MS = 25000;

export const store = { data: null, listeners: new Set() };

/** Calls fn now (if data exists) and on every update. Returns an unsubscribe function. */
export function subscribe(fn) {
  store.listeners.add(fn);
  if (store.data) fn(store.data);
  return () => store.listeners.delete(fn);
}

function publish(data) {
  store.data = data;
  store.listeners.forEach((fn) => fn(data));
}

/** Loads the latest wallet summary. */
export async function refresh() {
  publish(await api('/wallet'));
  return store.data;
}

/** Pots available as a spending source: every active pot plus Unallocated. */
export function potChoices(data = store.data) {
  if (!data) return [{ id: null, name: 'Unallocated', balance: 0, color: '#94A3B8' }];
  return [...data.buckets, data.unallocated];
}

const live = { abort: null, timer: null, poll: null, unsubscribeDemo: null, attempt: 0, running: false };

function setLiveState(state, text) {
  const el = $('#w-live');
  if (!el) return;
  el.dataset.state = state;
  $('#w-live-text').textContent = text;
}

async function streamOnce() {
  live.abort = new AbortController();
  const res = await fetch('/api/wallet/stream', {
    headers: { Authorization: `Bearer ${session.token}` },
    signal: live.abort.signal,
  });
  if (!res.ok || !res.body) throw new Error('stream refused');

  live.attempt = 0;
  setLiveState('live', 'Live');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (chunk.includes('event: wallet')) refresh().catch(() => {});
    }
  }
}

async function streamLoop() {
  while (live.running) {
    try {
      await streamOnce();
    } catch {
      if (!live.running) return;
    }
    if (!live.running) return;
    setLiveState('offline', 'Reconnecting');
    live.attempt += 1;
    await new Promise((resolve) => { live.timer = setTimeout(resolve, Math.min(15000, 1000 * 2 ** live.attempt)); });
  }
}

/** Starts live updates for the signed-in session or the demo. */
export function startLive() {
  if (live.running) return;
  live.running = true;
  refresh().catch(() => setLiveState('offline', 'Offline'));

  if (session.demo) {
    setLiveState('live', 'Live demo');
    live.unsubscribeDemo = onDemoChange(() => refresh().catch(() => {}));
    return;
  }
  setLiveState('connecting', 'Connecting');
  streamLoop();
  live.poll = setInterval(() => { if (!document.hidden) refresh().catch(() => {}); }, POLL_MS);
}

/** Stops live updates and clears cached data. */
export function stopLive() {
  live.running = false;
  live.abort?.abort();
  clearTimeout(live.timer);
  clearInterval(live.poll);
  live.unsubscribeDemo?.();
  live.unsubscribeDemo = null;
  live.attempt = 0;
  store.data = null;
}

function segments(data, { includeUnallocated = true } = {}) {
  const pots = includeUnallocated ? [...data.buckets, data.unallocated] : data.buckets;
  return pots.filter((p) => p.balance > 0.004);
}

/** Renders the stacked share bar used on several screens. */
export function renderStack(el, data) {
  const parts = segments(data);
  const total = parts.reduce((sum, p) => sum + p.balance, 0);
  el.innerHTML = total > 0
    ? parts.map((p) => `<span style="flex-grow:${p.balance};background:${esc(p.color)}" title="${esc(p.name)}: ${esc(KES(p.balance))}"></span>`).join('')
    : '<span style="flex-grow:1;background:var(--line)" title="Nothing in the wallet yet"></span>';
}

/** Renders a compact list of pots and their balances. */
export function renderPotLines(el, data) {
  const pots = [...data.buckets];
  if (Math.abs(data.unallocated.balance) >= 0.005) pots.push(data.unallocated);
  el.innerHTML = pots.map((p) => `
    <li style="--dot:${esc(p.color)}">
      <span class="dot"></span>
      <span>${esc(p.name)}${p.percent ? `<small>${pct(p.percent)}%</small>` : ''}</span>
      <span class="amt ${p.balance < 0 ? 'neg' : ''}">${esc(KES(p.balance))}</span>
    </li>`).join('');
}

let draft = null;
let dirty = false;
let lastFeedTop = null;

function runwayText(s) {
  if (s.balance <= 0) return s.balance < 0 ? 'Your wallet is overspent. Money in will first cover the gap.' : 'Your wallet is empty.';
  if (s.avg_daily_spend <= 0) return 'No spending recorded in the last 7 days, so there is no pace to measure yet.';
  const days = s.runway_days;
  const span = days > 365 ? 'more than a year' : days >= 2 ? `about ${Math.floor(days)} days` : 'less than 2 days';
  return `At your recent spending of ${KES(s.avg_daily_spend)} a day, this lasts ${span}.`;
}

function renderPots(s) {
  const pots = [...s.buckets];
  const showUnallocated = Math.abs(s.unallocated.balance) >= 0.005 || s.unallocated.in_month > 0 || s.unallocated.out_month > 0 || pots.length === 0;
  if (showUnallocated) pots.push(s.unallocated);

  $('#w-pots').innerHTML = pots.map((p) => {
    const spentShare = p.in_month > 0 ? Math.min(100, (p.out_month / p.in_month) * 100) : (p.out_month > 0 ? 100 : 0);
    const over = p.balance < -0.004;
    return `
      <article class="pot-card ${over ? 'neg' : ''}" style="--c:${esc(p.color)}">
        <h3>${esc(p.name)}<span class="share">${p.percent ? `${pct(p.percent)}% of income` : 'Not assigned'}</span></h3>
        <div class="bal">${esc(KES(p.balance))}</div>
        ${over ? `<span class="flag">Overspent by ${esc(KES(-p.balance))}</span>` : ''}
        <div class="track" aria-hidden="true"><span style="width:${spentShare}%"></span></div>
        <div class="foot">This month: ${esc(KES(p.in_month))} in, ${esc(KES(p.out_month))} spent</div>
      </article>`;
  }).join('');
}

function renderHourly(s) {
  const max = Math.max(1, ...s.hourly.flatMap((h) => [h.in, h.out]));
  const height = (v) => (v > 0 ? `${Math.max(3, (v / max) * 100)}%` : '0');
  $('#w-hourly').innerHTML = s.hourly.map((h) => `
    <div class="flow-col" title="${esc(hourLabel(h.hour))}: ${esc(KES(h.in))} in, ${esc(KES(h.out))} out">
      <div class="flow-bars"><i class="in" style="height:${height(h.in)}"></i><i class="out" style="height:${height(h.out)}"></i></div>
      <span class="h">${h.hour % 6 === 0 ? esc(hourLabel(h.hour)) : ''}</span>
    </div>`).join('');
}

function feedItem(e, fresh) {
  const icon = e.direction === 'in' ? 'plus' : e.direction === 'out' ? 'minus' : 'swap';
  const kind = { sale: 'Sale', payment: 'Repayment', expense: 'Expense', transfer: 'Moved' }[e.kind] || e.kind;
  const chip = (p, sign) => `<span><i class="dot" style="background:${esc(p.color)}"></i>${esc(p.name)} ${sign}${esc(KES(Math.abs(p.amount)))}</span>`;
  let split = '';
  if (e.direction === 'in') split = e.parts.map((p) => chip(p, '+')).join('');
  else if (e.direction === 'out') split = e.parts.map((p) => `<span><i class="dot" style="background:${esc(p.color)}"></i>from ${esc(p.name)}</span>`).join('');
  else split = e.parts.map((p) => chip(p, p.amount < 0 ? '-' : '+')).join('');
  const sign = e.direction === 'in' ? '+' : e.direction === 'out' ? '-' : '';
  return `
    <li class="${e.direction} ${fresh ? 'fresh' : ''}">
      <span class="badge"><svg class="icon"><use href="#i-${icon}"/></svg></span>
      <div class="what"><strong>${esc(e.label)}</strong><span class="when">${esc(kind)}, ${esc(ago(e.created_at))}</span><div class="split">${split}</div></div>
      <span class="amt">${sign}${esc(KES(e.amount))}</span>
    </li>`;
}

function renderFeed(s) {
  const top = s.feed[0]?.id ?? null;
  const isNew = (e) => lastFeedTop !== null && e.id > lastFeedTop;
  $('#w-feed').innerHTML = s.feed.length
    ? s.feed.map((e) => feedItem(e, isNew(e))).join('')
    : '<li class="empty-row" style="display:block;color:var(--ink-3)">Nothing has moved yet. Complete a sale or record an expense and it appears here instantly.</li>';
  lastFeedTop = top;
}

function ruleTotal() {
  return draft.reduce((sum, r) => sum + (Number(r.percent) || 0), 0);
}

function updateRuleTotal() {
  const total = Math.round(ruleTotal() * 100) / 100;
  const el = $('#r-total');
  const save = $('#r-save');
  el.className = 'rules-total';
  if (draft.length === 0) {
    el.textContent = 'No pots. Everything you receive will stay Unallocated.';
    el.classList.add('warn');
    save.disabled = false;
  } else if (Math.abs(total - 100) < 0.005) {
    el.textContent = '100% assigned. Every payment is fully divided.';
    el.classList.add('ok');
    save.disabled = false;
  } else if (total < 100) {
    el.textContent = `${pct(total)}% assigned. The other ${pct(100 - total)}% of each payment stays Unallocated.`;
    el.classList.add('warn');
    save.disabled = false;
  } else {
    el.textContent = `${pct(total)}% is ${pct(total - 100)}% too much. Lower a share to save.`;
    el.classList.add('bad');
    save.disabled = true;
  }
}

function renderRules() {
  const list = $('#r-list');
  list.innerHTML = draft.map((r, i) => `
    <div class="rule-row" data-index="${i}">
      <input type="color" value="${esc(r.color)}" aria-label="Colour for ${esc(r.name || 'pot')}" data-field="color">
      <input type="text" value="${esc(r.name)}" maxlength="40" placeholder="Pot name" aria-label="Pot name" data-field="name">
      <div class="pct"><input type="number" value="${esc(r.percent)}" min="0.5" max="100" step="0.5" inputmode="decimal" aria-label="Percentage for ${esc(r.name || 'pot')}" data-field="percent"></div>
      <button type="button" class="icon-btn" aria-label="Remove ${esc(r.name || 'pot')}" data-remove><svg class="icon"><use href="#i-trash"/></svg></button>
    </div>`).join('') || '<p class="sub">You have no pots yet. Add one to start dividing your income.</p>';
  updateRuleTotal();
}

function resetDraft(data) {
  draft = data.buckets.map((b) => ({ id: b.id, name: b.name, percent: b.percent, color: b.color }));
  dirty = false;
  $('#r-error').textContent = '';
  renderRules();
}

/** Renders every part of the Wallet screen from a summary. */
export function renderWallet(s) {
  animateMoney($('#w-balance'), s.balance);
  $('#w-runway').textContent = runwayText(s);
  $('#w-in').textContent = KES(s.in_today);
  $('#w-out').textContent = KES(s.out_today);
  const net = $('#w-net');
  net.textContent = `${s.net_today > 0 ? '+' : ''}${KES(s.net_today)}`;
  net.className = s.net_today > 0 ? 'in' : s.net_today < 0 ? 'out' : '';
  renderStack($('#w-stack'), s);
  $('#w-sources').innerHTML = `<span>Sales today <strong>${esc(KES(s.sales_today))}</strong></span><span>Customer repayments today <strong>${esc(KES(s.payments_today))}</strong></span>`;
  $('#w-month-label').textContent = `This month: ${KES(s.in_month)} in, ${KES(s.out_month)} spent`;
  renderPots(s);
  renderHourly(s);
  renderFeed(s);
  if (!dirty) resetDraft(s);
}

function openMoveDialog() {
  const s = store.data;
  if (!s) return;
  const pots = potChoices(s);
  const options = pots.map((p) => ({ value: p.id === null ? 'null' : p.id, label: `${p.name} (${KES(p.balance)})` }));
  const parse = (v) => (v === 'null' ? null : Number(v));

  formDialog({
    title: 'Move money between pots',
    note: 'This only changes how your wallet is divided. The total stays the same.',
    submitLabel: 'Move money',
    fields: [
      { name: 'from', label: 'From', type: 'select', options, value: options[0].value },
      { name: 'to', label: 'To', type: 'select', options, value: options[1]?.value ?? options[0].value },
      { name: 'amount', label: 'Amount (KES)', type: 'number', min: 0.01, step: 0.01, inputmode: 'decimal' },
      { name: 'note', label: 'Note (optional)', type: 'text', required: false, maxlength: 120 },
    ],
    onSubmit: async (v) => {
      const result = await api('/wallet/transfer', {
        method: 'POST',
        body: { from_bucket_id: parse(v.from), to_bucket_id: parse(v.to), amount: Number(v.amount), note: v.note || '' },
      });
      publish(result);
      toast('Money moved.');
    },
  });
}

let bound = false;

/** Wires the Wallet screen once. */
export function initWallet() {
  if (bound) return;
  bound = true;

  subscribe((data) => {
    if ($('#page-wallet').hidden) return;
    renderWallet(data);
  });

  $('#w-move').addEventListener('click', openMoveDialog);

  const list = $('#r-list');
  list.addEventListener('input', (event) => {
    const row = event.target.closest('.rule-row');
    if (!row) return;
    const field = event.target.dataset.field;
    draft[Number(row.dataset.index)][field] = event.target.value;
    dirty = true;
    $('#r-error').textContent = '';
    updateRuleTotal();
  });
  list.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-remove]');
    if (!remove) return;
    draft.splice(Number(remove.closest('.rule-row').dataset.index), 1);
    dirty = true;
    renderRules();
  });

  $('#r-add').addEventListener('click', () => {
    if (draft.length >= 8) return toast('You can have up to 8 pots.', 'error');
    const room = Math.max(0, 100 - ruleTotal());
    draft.push({ id: null, name: '', percent: room >= 5 ? Math.min(10, room) : 5, color: PALETTE[draft.length % PALETTE.length] });
    dirty = true;
    renderRules();
    const names = list.querySelectorAll('[data-field="name"]');
    names[names.length - 1]?.focus();
  });

  $('#r-reset').addEventListener('click', () => {
    if (store.data) resetDraft(store.data);
  });

  $('#r-save').addEventListener('click', (event) => {
    const button = event.currentTarget;
    withBusy(button, async () => {
      $('#r-error').textContent = '';
      try {
        const result = await api('/wallet/rules', {
          method: 'PUT',
          body: { rules: draft.map((r) => ({ id: r.id ?? undefined, name: r.name, percent: Number(r.percent), color: r.color })) },
        });
        dirty = false;
        publish(result);
        resetDraft(result);
        toast('Rules saved. They apply to money you record from now on.');
      } catch (err) {
        $('#r-error').textContent = err.message;
      }
    });
  });
}

/** Called each time the Wallet screen opens. */
export async function showWallet() {
  if (store.data) renderWallet(store.data);
  await refresh();
}
