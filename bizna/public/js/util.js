/**
 * Small helpers shared by every view: DOM shortcuts, escaping, money and date
 * formatting (East Africa Time), toasts, button busy state and animated numbers.
 */

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapes a value for safe use inside HTML text or attributes. */
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** Formats an amount as "KES 1,250" and shows cents only when there are some. */
export function KES(amount) {
  const n = Number(amount) || 0;
  const abs = Math.abs(n);
  const cents = Math.round(abs * 100) % 100 !== 0;
  const text = abs.toLocaleString('en-KE', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 });
  return `${n < 0 && Math.round(abs * 100) > 0 ? '-' : ''}KES ${text}`;
}

/** Compact amount for chart labels: 950, 1.2k, 3.4M. */
export function short(amount) {
  const n = Math.abs(Number(amount) || 0);
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}k`;
  return String(Math.round(n));
}

/** Formats a percentage without trailing zeros: 12.5, 50. */
export const pct = (n) => String(Math.round(Number(n) * 100) / 100);

const TZ = 'Africa/Nairobi';

/** Parses the server's "YYYY-MM-DD HH:MM:SS" UTC timestamps. */
export const parseUtc = (value) => new Date(`${String(value).replace(' ', 'T')}Z`);

/** The East Africa Time calendar day of a date as "YYYY-MM-DD". */
export const eatDay = (date) => new Date(date.getTime() + 3 * 3600000).toISOString().slice(0, 10);

const timeOf = (date) => date.toLocaleTimeString('en-KE', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
const dateOf = (date) => date.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', timeZone: TZ });

/** "Today, 2:14 pm" or "12 Oct, 2:14 pm". */
export function when(value) {
  const date = parseUtc(value);
  const day = eatDay(date) === eatDay(new Date()) ? 'Today' : dateOf(date);
  return `${day}, ${timeOf(date)}`;
}

/** "Just now", "5 min ago", or the full date for older entries. */
export function ago(value) {
  const seconds = (Date.now() - parseUtc(value).getTime()) / 1000;
  if (seconds < 45) return 'Just now';
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min ago`;
  return when(value);
}

/** Short weekday name for a "YYYY-MM-DD" key. */
export const weekday = (key) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString('en-KE', { weekday: 'short', timeZone: 'UTC' });

/** "6am", "12pm" label for an hour number 0-23. */
export const hourLabel = (h) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'am' : 'pm'}`;

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Counts a money element up or down to a new value. The current value lives in data-raw. */
export function animateMoney(el, to) {
  const from = Number(el.dataset.raw ?? 0);
  el.dataset.raw = String(to);
  if (from === to || reducedMotion()) {
    el.textContent = KES(to);
    return;
  }
  const start = performance.now();
  const duration = 550;
  const tick = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - (1 - t) ** 3;
    el.textContent = t === 1 ? KES(to) : KES(Math.round(from + (to - from) * eased));
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Shows a short message at the bottom of the screen. type is "ok" or "error". */
export function toast(message, type = 'ok') {
  const region = $('#toast-region');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<svg class="icon"><use href="#i-${type === 'error' ? 'alert' : 'check'}"/></svg><span>${esc(message)}</span>`;
  region.append(el);
  setTimeout(() => el.remove(), type === 'error' ? 6000 : 3800);
}

/** Marks a button busy (spinner, ignores clicks) while an async action runs. */
export function setBusy(button, busy) {
  if (!button) return;
  if (busy) button.setAttribute('aria-busy', 'true');
  else button.removeAttribute('aria-busy');
}

/** Wraps an async event handler so failures show as a toast instead of vanishing. */
export const guard = (fn) => async (...args) => {
  try {
    await fn(...args);
  } catch (err) {
    toast(err.message || 'Something went wrong.', 'error');
  }
};

/** Runs fn with a button in the busy state. Errors are shown as a toast. */
export async function withBusy(button, fn) {
  if (button?.getAttribute('aria-busy')) return;
  setBusy(button, true);
  try {
    await fn();
  } catch (err) {
    toast(err.message || 'Something went wrong.', 'error');
  } finally {
    setBusy(button, false);
  }
}
