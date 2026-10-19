/**
 * Log in and create-account forms.
 *
 * showAuth(mode) switches between the two forms. Errors from the server are
 * shown under the form in plain language; a server that cannot be reached
 * shows how to fix the address instead of a bare "failed to fetch".
 */

import { api, setToken } from './api.js';
import { $, $$, withBusy } from './util.js';

let bound = false;
let ownerExists = false;

/** Records whether an owner account already exists (signup is closed then). */
export function setOwnerExists(value) {
  ownerExists = value;
  const closed = $('#signup-closed');
  if (closed) closed.hidden = !value;
  $$('#signup-form input, #signup-form button[type="submit"]').forEach((el) => { el.disabled = value; });
}

export function showAuth(mode) {
  bind();
  const signup = mode === 'signup';
  $('#login-form').hidden = signup;
  $('#signup-form').hidden = !signup;
  $('#auth-tab-login').setAttribute('aria-selected', String(!signup));
  $('#auth-tab-signup').setAttribute('aria-selected', String(signup));
  $('#login-error').textContent = '';
  $('#signup-error').textContent = '';
  setOwnerExists(ownerExists);
  (signup ? $('#su-shop') : $('#login-id')).focus({ preventScroll: true });
}

/**
 * @param {(user:object)=>void} onSuccess called after a successful login or signup
 */
let onSuccess = () => {};
export function onAuthenticated(fn) {
  onSuccess = fn;
}

function bind() {
  if (bound) return;
  bound = true;

  $$('.pw-toggle').forEach((button) => {
    button.addEventListener('click', () => {
      const input = button.parentElement.querySelector('input');
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      button.setAttribute('aria-pressed', String(show));
      button.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      button.querySelector('use').setAttribute('href', show ? '#i-eye-off' : '#i-eye');
    });
  });

  $('#login-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const error = $('#login-error');
    error.textContent = '';
    withBusy($('#login-form [type="submit"]'), async () => {
      try {
        const user = await api('/auth/login', {
          method: 'POST',
          body: { login: $('#login-id').value.trim(), password: $('#login-password').value },
        });
        setToken(user.token);
        $('#login-password').value = '';
        onSuccess(user);
      } catch (err) {
        error.textContent = err.message;
      }
    });
  });

  $('#signup-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const error = $('#signup-error');
    error.textContent = '';
    if ($('#su-password').value !== $('#su-confirm').value) {
      error.textContent = 'The two passwords do not match.';
      $('#su-confirm').focus();
      return;
    }
    withBusy($('#signup-form [type="submit"]'), async () => {
      try {
        const user = await api('/auth/signup', {
          method: 'POST',
          body: {
            shop_name: $('#su-shop').value.trim(),
            email: $('#su-email').value.trim(),
            password: $('#su-password').value,
            accepted_terms: $('#su-terms').checked,
          },
        });
        setToken(user.token);
        $('#su-password').value = '';
        $('#su-confirm').value = '';
        onSuccess(user);
      } catch (err) {
        error.textContent = err.message;
        if (err.status === 409) setOwnerExists(true);
      }
    });
  });
}
