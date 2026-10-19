/**
 * App entry point: hash router, screen switching, session handling and demo mode.
 *
 * Routes (all behind "#/"):
 *   (empty), features, how       landing page
 *   login, signup                account forms
 *   demo                         starts the in-browser sample shop
 *   overview, wallet, sell,
 *   stock, expenses, customers   the app (needs a session or demo mode)
 */

import { api, session, setToken } from './api.js';
import { resetDemo } from './demo.js';
import { showAuth, setOwnerExists, onAuthenticated } from './auth.js';
import { initLanding } from './landing.js';
import { initWallet, showWallet, startLive, stopLive } from './wallet.js';
import { initOverview, showOverview } from './overview.js';
import { showSell } from './sell.js';
import { showStock } from './stock.js';
import { showExpenses } from './expenses.js';
import { showCustomers } from './customers.js';
import { $, $$, toast } from './util.js';

const PAGES = {
  overview: { title: 'Overview', show: showOverview },
  wallet: { title: 'Wallet', show: showWallet },
  sell: { title: 'New sale', show: showSell },
  stock: { title: 'Stock', show: showStock },
  expenses: { title: 'Expenses', show: showExpenses },
  customers: { title: 'Customers', show: showCustomers },
};

let appReady = false;

function setNotice(message) {
  const el = $('#notice');
  el.textContent = message || '';
  el.hidden = !message;
}

function showView(name) {
  ['landing', 'auth', 'app'].forEach((v) => { $(`#view-${v}`).hidden = v !== name; });
}

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

async function loadStatus() {
  try {
    const status = await api('/auth/status');
    setOwnerExists(status.ownerExists);
    setNotice(location.protocol === 'file:' ? $('#notice').textContent : '');
    const closed = status.ownerExists;
    $$('[data-signup-cta]').forEach((el) => {
      if (el.classList.contains('lg')) {
        el.textContent = closed ? 'Log in to your shop' : 'Create your shop account';
        el.setAttribute('href', closed ? '#/login' : '#/signup');
      } else {
        el.hidden = closed;
      }
    });
  } catch (err) {
    setNotice(err.message);
    $('#landing-note').hidden = false;
    $('#landing-note').textContent = 'The demo still works without the server: choose "Look inside with sample data".';
  }
}

async function enterApp(page) {
  showView('app');
  if (!appReady) {
    appReady = true;
    initWallet();
    initOverview();
  }

  const name = session.demo ? 'Sample duka' : localStorage.getItem('bizna_shop') || 'My shop';
  $('#shop-name').textContent = name;
  $('#demo-chip').hidden = !session.demo;
  $('#demo-banner').hidden = !session.demo;

  $$('.page').forEach((p) => { p.hidden = p.id !== `page-${page}`; });
  $$('[data-route]').forEach((a) => {
    if (a.dataset.route === page) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  document.title = `${PAGES[page].title} - Bizna`;
  window.scrollTo({ top: 0 });

  startLive();
  try {
    await PAGES[page].show();
  } catch (err) {
    if (err.status !== 401) toast(err.message, 'error');
  }

  if (!session.demo && session.token) {
    api('/auth/me').then((me) => {
      localStorage.setItem('bizna_shop', me.shop_name);
      $('#shop-name').textContent = me.shop_name;
    }).catch(() => {});
  }
}

async function route() {
  const name = location.hash.replace(/^#\/?/, '').split('?')[0];

  if (name === 'demo') {
    session.demo = true;
    resetDemo();
    stopLive();
    return go('#/overview');
  }

  if (PAGES[name]) {
    if (!session.token && !session.demo) return go('#/login');
    return enterApp(name);
  }

  if (name === 'login' || name === 'signup') {
    if (session.demo) await leaveDemo();
    if (session.token) return go('#/overview');
    showView('auth');
    document.title = `${name === 'login' ? 'Log in' : 'Create account'} - Bizna`;
    await loadStatus();
    showAuth(name);
    return undefined;
  }

  if (session.token && !session.demo && name === '') return go('#/overview');
  if (session.demo) await leaveDemo();
  showView('landing');
  document.title = 'Bizna: sales, stock and money tracking for your shop';
  initLanding();
  await loadStatus();
  if (name === 'features' || name === 'how') {
    document.getElementById(name === 'how' ? 'how' : 'features').scrollIntoView({ behavior: 'smooth' });
  } else {
    window.scrollTo({ top: 0 });
  }
  return undefined;
}

async function leaveDemo() {
  session.demo = false;
  stopLive();
}

async function logout() {
  if (session.demo) {
    await leaveDemo();
    return go('#/');
  }
  try { await api('/auth/logout', { method: 'POST' }); } catch { /* the token is dropped locally either way */ }
  setToken(null);
  localStorage.removeItem('bizna_shop');
  stopLive();
  return go('#/');
}

session.onExpired = () => {
  setToken(null);
  stopLive();
  toast('Your session expired. Please log in again.', 'error');
  go('#/login');
};

onAuthenticated((user) => {
  if (user.shop_name) localStorage.setItem('bizna_shop', user.shop_name);
  go('#/overview');
});

document.addEventListener('click', (event) => {
  if (event.target.closest('[data-logout]')) logout();
});

window.addEventListener('hashchange', route);

if (location.protocol === 'file:') setNotice('This page was opened as a file. Start the server with "npm start", then open http://localhost:3000 in your browser.');
route();
