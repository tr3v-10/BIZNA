/**
 * API client.
 *
 * api(path, options) talks to /api on the same origin and returns parsed JSON.
 * Failures become ApiError with a message that is safe to show:
 *   - the server could not be reached (wrong address, server stopped, file opened directly)
 *   - the server answered with an error message
 *   - a signed-in session expired (401 on any route except login and signup)
 *
 * In demo mode every call is answered by the in-browser sample data instead.
 */

import { ApiError } from './util.js';
import { demoApi } from './demo.js';

const TOKEN_KEY = 'bizna_token';

export const session = {
  token: safeGet(TOKEN_KEY),
  demo: false,
  onExpired: () => {},
};

function safeGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

/** Stores or clears the sign-in token. */
export function setToken(token) {
  session.token = token || null;
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* storage unavailable: the session lasts until the tab closes */ }
}

function unreachableMessage() {
  if (location.protocol === 'file:') {
    return 'This page was opened as a file. Start the server with "npm start", then open http://localhost:3000 in your browser.';
  }
  return `Can't reach the Bizna server at ${location.host}. Check that it is running and that you opened the address it printed in the terminal.`;
}

/**
 * @param {string} path Path after /api, for example "/wallet".
 * @param {{method?:string,body?:any}} [options]
 */
export async function api(path, { method = 'GET', body } = {}) {
  if (session.demo) return demoApi(method, path, body);

  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(session.token ? { Authorization: `Bearer ${session.token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(unreachableMessage(), 0);
  }

  const data = await res.json().catch(() => null);

  if (res.status === 401 && session.token && !path.startsWith('/auth/login') && !path.startsWith('/auth/signup')) {
    session.onExpired();
    throw new ApiError('Your session has expired. Log in again.', 401);
  }
  if (!res.ok) throw new ApiError(data?.error || `Something went wrong (error ${res.status}).`, res.status);
  return data;
}
