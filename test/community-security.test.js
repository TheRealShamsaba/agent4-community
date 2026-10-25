import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHqServer } from '../src/hq-server.js';
import { createAuthStore } from '../src/auth-store.js';

async function workspace(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'agent4-community-'));
  await mkdir(path.join(root, 'public'));
  await writeFile(path.join(root, 'public/hq.html'), '<title>Agent4</title><script type="application/json" id="hq-data">{}</script>');
  const key = randomBytes(32).toString('hex');
  const tokenFile = path.join(root, 'setup-key'); await writeFile(tokenFile, key);
  const config = { company: { name: 'Your company', services: [] }, runtime: {
    root, hqTemplatePath: path.join(root, 'public/hq.html'), roomDatabasePath: path.join(root, 'data/agent4.sqlite'),
    agent4AuthRequired: true, agent4SecureCookies: false, setupToken: key, setupTokenFile: tokenFile,
    ownerTimeZone: 'UTC'
  }};
  let server;
  async function start() {
    server = createHqServer(config, { monitorRunner: { start() {}, stop() {} } });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    config.runtime.publicOrigin = `http://127.0.0.1:${server.address().port}`;
  }
  await start();
  const stop = async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };
  t.after(async () => { await stop(); await rm(root, { recursive: true, force: true }); });
  const request = (route, body, session = {}, overrides = {}) => fetch(`${config.runtime.publicOrigin}${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { origin: config.runtime.publicOrigin, 'content-type': 'application/json', ...(session.cookie ? { cookie: session.cookie, 'x-csrf-token': session.csrfToken } : {}), ...overrides.headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), ...Object.fromEntries(Object.entries(overrides).filter(([k]) => k !== 'headers'))
  });
  const login = async () => {
    const response = await request('/api/auth/login', { email: 'owner@example.com', password: 'a long unique owner passphrase' });
    const body = await response.json();
    return { cookie: response.headers.get('set-cookie')?.split(';')[0], csrfToken: body.csrfToken, actor: body.actor };
  };
  const setup = async () => {
    const response = await request('/api/auth/setup', { token: key, workspace: 'Example team', name: 'Owner', email: 'owner@example.com', password: 'a long unique owner passphrase' });
    assert.equal(response.status, 201);
    const body = await response.json();
    return { cookie: response.headers.get('set-cookie').split(';')[0], csrfToken: body.csrfToken, actor: body.actor };
  };
  return { request, setup, login, key, tokenFile, config, restart: async () => { await stop(); await start(); } };
}

test('first owner requires the installation key, consumes it, and cannot be claimed again after restart', async t => {
  const w = await workspace(t);
  assert.equal((await (await w.request('/api/auth/session')).json()).setupRequired, true);
  assert.equal((await w.request('/api/tasks')).status, 401);
  assert.equal((await w.request('/api/healthz')).status, 200);
  assert.equal((await w.request('/api/auth/setup', { token: 'wrong' })).status, 403);
  assert.equal((await w.request('/api/auth/setup', { token: w.key }, {}, { headers: { origin: 'https://evil.example' } })).status, 403);
  const owner = await w.setup();
  assert.equal(owner.actor.role, 'owner');
  assert.equal(await readFile(w.tokenFile, 'utf8'), '');
  assert.equal((await w.request('/api/auth/setup', { token: w.key })).status, 409);
  await w.restart();
  assert.equal((await w.request('/api/auth/setup', { token: w.key })).status, 409);
  assert.equal((await (await w.request('/api/settings', undefined, await w.login())).json()).settings.name, 'Example team');
});

test('sessions require exact Origin and their own CSRF token, independent of forwarded headers', async t => {
  const w = await workspace(t); const owner = await w.setup();
  assert.equal((await w.request('/api/tasks', { title: 'First task' }, { ...owner, csrfToken: 'wrong' })).status, 403);
  assert.equal((await w.request('/api/tasks', { title: 'First task' }, owner, { headers: { origin: '' } })).status, 403);
  assert.equal((await w.request('/api/tasks', { title: 'First task' }, owner, { headers: { origin: 'https://evil.example', 'x-forwarded-proto': 'https' } })).status, 403);
  assert.equal((await w.request('/api/tasks', { title: 'First task' }, owner)).status, 200);
  assert.equal((await w.request('/api/auth/logout', {}, { ...owner, csrfToken: 'wrong' })).status, 403);
  const second = await w.login();
  assert.equal((await w.request('/api/tasks', { title: 'Cannot borrow CSRF' }, { ...second, csrfToken: owner.csrfToken })).status, 403);
});

test('invitations use configured origins and fragments, replace earlier links, and support revocation and safe re-inviting', async t => {
  const w = await workspace(t); const owner = await w.setup();
  const invite = async () => (await (await w.request('/api/auth/invites', { name: 'Member', email: 'member@example.com' }, owner, { headers: { host: 'attacker.example' } })).json()).invite;
  const first = await invite(); const next = await invite();
  assert.equal(new URL(first.url).origin, w.config.runtime.publicOrigin);
  assert.equal(new URL(first.url).search, ''); assert.ok(new URL(first.url).hash.startsWith('#invite='));
  assert.equal((await w.request(`/api/auth/invites/${first.token}`)).status, 404);
  const registered = await w.request('/api/auth/register', { token: next.token, password: 'a long unique member passphrase', role: 'owner' });
  assert.equal(registered.status, 200);
  const body = await registered.json(); assert.equal(body.actor.role, 'member');
  const member = { cookie: registered.headers.get('set-cookie').split(';')[0], csrfToken: body.csrfToken };
  assert.equal((await w.request('/api/auth/register', { token: next.token, password: 'another long passphrase' })).status, 404);
  assert.equal((await w.request('/api/auth/invites', { name: 'Other', email: 'other@example.com' }, member)).status, 403);
  assert.equal((await w.request('/api/settings', { name: 'Cannot change' }, member, { method: 'PATCH' })).status, 403);
  assert.equal((await w.request('/api/money/report', undefined, member)).status, 403);
  assert.equal((await w.request(`/api/auth/members/${body.actor.id}`, undefined, owner, { method: 'DELETE' })).status, 200);
  assert.equal((await w.request('/api/tasks', undefined, member)).status, 401);
  const pending = await invite();
  const list = (await (await w.request('/api/auth/invites', undefined, owner)).json()).invites;
  assert.equal(list.length, 1); assert.equal(list[0].token, undefined);
  assert.equal((await w.request(`/api/auth/invites/${list[0].id}`, undefined, owner, { method: 'DELETE' })).status, 200);
  assert.equal((await w.request(`/api/auth/invites/${pending.token}`)).status, 404);
  const replacement = await invite();
  const rejoined = await w.request('/api/auth/register', { token: replacement.token, password: 'a different long member passphrase' });
  assert.equal(rejoined.status, 200); assert.equal((await rejoined.json()).actor.id, body.actor.id);
});

test('module choices and canvas data survive disable, re-enable and restart', async t => {
  const w = await workspace(t); let owner = await w.setup();
  const update = modules => w.request('/api/settings', { modules }, owner, { method: 'PATCH' });
  assert.equal((await update({ room: true })).status, 200);
  const saved = await w.request('/api/rooms/company-room', { baseVersion: 0, label: 'First note', state: { localObjects: [{ id: 'note-example', type: 'note', title: 'A shared idea', body: 'Ship the prototype', createdBy: 'forged-user' }], layout: {}, edges: [] } }, owner, { method: 'PUT' });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).room.state.localObjects[0].createdBy, owner.actor.id);
  await update({ room: false }); await w.restart(); owner = await w.login();
  assert.equal((await (await w.request('/api/settings', undefined, owner)).json()).settings.modules.room, false);
  await update({ room: true });
  const restored = await (await w.request('/api/rooms/company-room', undefined, owner)).json();
  assert.equal(restored.room.state.localObjects[0].body, 'Ship the prototype');
});

test('password recovery revokes sessions and login throttles survive store restarts', async t => {
  const w = await workspace(t); const owner = await w.setup();
  const store = createAuthStore(w.config.runtime.roomDatabasePath);
  assert.equal(store.resetPassword('owner@example.com', 'new long recovery passphrase'), true); store.close();
  assert.equal((await w.request('/api/tasks', undefined, owner)).status, 401);
  for (let i = 0; i < 10; i++) await w.request('/api/auth/login', { email: 'missing@example.com', password: 'incorrect' });
  await w.restart();
  assert.equal((await w.request('/api/auth/login', { email: 'missing@example.com', password: 'incorrect' })).status, 429);
});

test('an explicitly disabled transcription service rejects audio uploads', async t => {
  const w = await workspace(t); const owner = await w.setup();
  w.config.runtime.voiceTranscriptionEnabled = false;
  const rejected = await w.request('/api/meetings', { title: 'Keep this audio local' }, owner);
  assert.equal(rejected.status, 503);
  assert.equal((await rejected.json()).error.code, 'transcription_disabled');
});

test('password changes revoke old live event streams before another room update is delivered', { timeout: 20000 }, async t => {
  const w = await workspace(t); const owner = await w.setup();
  const stream = await w.request('/api/rooms/company-room/events', undefined, owner);
  const reader = stream.body.getReader(); await reader.read();
  const changed = await w.request('/api/auth/password', { currentPassword: 'a long unique owner passphrase', nextPassword: 'a new long owner passphrase' }, owner);
  assert.equal(changed.status, 200);
  const next = { cookie: changed.headers.get('set-cookie').split(';')[0], csrfToken: (await changed.json()).csrfToken };
  const saved = await w.request('/api/rooms/company-room', { baseVersion: 0, label: 'Private new update', state: { localObjects: [], layout: {}, edges: [] } }, next, { method: 'PUT' });
  assert.equal(saved.status, 200);
  let remaining = '';
  while (true) { const part = await reader.read(); if (part.done) break; remaining += Buffer.from(part.value).toString('utf8'); }
  assert.equal(remaining.includes('room.updated'), false); reader.releaseLock();
});
