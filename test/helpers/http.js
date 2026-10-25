// Existing API behavior tests act like the browser: same Origin and the current
// session's CSRF token. Security tests use raw fetch to exercise rejected requests.
export async function fetch(input, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  if (!['GET','HEAD','OPTIONS'].includes(method)) {
    const headers = new Headers(options.headers || {});
    if (!headers.has('origin')) headers.set('origin', new URL(input).origin);
    if (headers.has('cookie') && !headers.has('x-csrf-token')) {
      const session = await globalThis.fetch(new URL('/api/auth/session', input), { headers: { cookie: headers.get('cookie') } });
      const body = await session.json();
      if (body.csrfToken) headers.set('x-csrf-token', body.csrfToken);
    }
    options = { ...options, headers };
  }
  return globalThis.fetch(input, options);
}
