// Secrets from invitation/setup links remain in memory, never URL queries or storage.
const entry = new URLSearchParams(window.location.hash.slice(1));
export const entryTokens = { invite: entry.get('invite') || '', setup: entry.get('setup') || '' };
if (entryTokens.invite || entryTokens.setup) window.history.replaceState({}, '', window.location.pathname + window.location.search);
let csrfToken = '';
export function installSessionFetch() {
  const original = window.fetch.bind(window);
  window.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, window.location.href);
    const local = url.origin === window.location.origin;
    const method = String(options.method || input?.method || 'GET').toUpperCase();
    if (local && !['GET','HEAD','OPTIONS'].includes(method) && csrfToken) {
      const headers = new window.Headers(options.headers || input?.headers || {});
      headers.set('x-csrf-token', csrfToken);
      options = { ...options, headers };
    }
    const response = await original(input, options);
    if (local && /^\/api\/auth\/(session|login|register|setup|password)$/.test(url.pathname) && response.ok) {
      const body = await response.clone().json().catch(() => ({}));
      csrfToken = body.csrfToken || '';
    }
    if (local && url.pathname === '/api/auth/logout' && response.ok) csrfToken = '';
    return response;
  };
}

/* Every call the HQ shell makes, and the one rule they all share: a 401 means
   the session is gone. The room used to answer that with a generic message and
   go on quietly accepting edits it could never save. */

export const ROOM_ID = "company-room";

/* A 401 is not "the server is having a moment". The session is gone, every
   later write will be refused, and the room used to answer it by flipping to
   "Offline · browser backup" and quietly accepting edits it could never save.
   Anything that sees one hands the user back to the sign-in screen, the way the
   Telegram mini-app already does. */
let sessionExpiredHandler = null;

export function setSessionExpiredHandler(handler) {
  sessionExpiredHandler = handler;
}

function isUnauthorized(response, body) {
  return response?.status === 401 || body?.error?.code === "authentication_required";
}

function noteUnauthorized(response, body) {
  if (!isUnauthorized(response, body)) return false;
  sessionExpiredHandler?.();
  return true;
}

/* The plain GETs the shell makes for itself. They go through the same 401
   check as everything else, because a read that comes back 401 means the
   session is gone just as much as a write does. */
export async function fetchJson(pathname) {
  const response = await fetch(pathname);
  let body = null;
  try { body = await response.json(); } catch { /* handled by the ok check */ }
  if (!response.ok) {
    const expired = noteUnauthorized(response, body);
    const error = new Error(expired ? "Your Agent4 session expired." : `Agent4 could not read ${pathname}.`);
    error.status = response.status;
    throw error;
  }
  return body || {};
}

export async function authRequest(pathname, options = {}) {
  let response;
  try {
    response = await fetch(`/api/auth${pathname}`, {
      ...options,
      headers: options.body ? { "content-type": "application/json", ...(options.headers || {}) } : options.headers
    });
  } catch {
    throw new Error("Agent4's sign-in service is offline.");
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error("Agent4's sign-in service returned an unreadable response.");
  }
  if (!response.ok) {
    /* The sign-in endpoints answer a wrong password with a 401 of their own.
       That is the form doing its job, not an expired session, so only the rest
       of the auth surface hands the user back to the login screen. */
    if (!/^\/(login|register|invites)/.test(pathname)) noteUnauthorized(response, body);
    const error = new Error(body?.error?.message || "Agent4 could not complete the sign-in request.");
    error.code = body?.error?.code;
    error.status = response.status;
    throw error;
  }
  return body;
}

/* Six other surfaces in this app keep their own fetch helpers, and a 401 in any
   of them means exactly what a 401 here means: the session is gone and nothing
   the user does next will be saved. Rather than reach into files this module
   does not own, the shell watches every /api/ response once. It reads nothing
   but the status and hands the response straight back, so no body is consumed
   and no caller sees a difference. The sign-in endpoints are excluded: a wrong
   password is also a 401, and that is the form doing its job. */
export function watchUnauthorizedResponses() {
  const original = window.fetch;
  if (original.agent4Watched) return () => {};
  const patched = (...args) => original(...args).then((response) => {
    const url = String(args[0]?.url || args[0] || "");
    if (response.status === 401 && url.includes("/api/") && !/\/api\/auth\/(login|register|invites)/.test(url)) {
      sessionExpiredHandler?.();
    }
    return response;
  });
  patched.agent4Watched = true;
  window.fetch = patched;
  return () => { window.fetch = original; };
}
