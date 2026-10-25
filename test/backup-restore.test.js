import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readdir, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createAuthStore } from '../src/auth-store.js';
import { createSettingsStore } from '../src/settings-store.js';

test('backup and fresh restore retain accounts, module choices and file bytes, and refuse overwriting data', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'agent4-restore-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source'); const target = path.join(root, 'restored');
  const auth = createAuthStore(path.join(source, 'agent4.sqlite'));
  auth.ensureBootstrap({ name: 'Owner', email: 'owner@example.com', password: 'a long restore test passphrase' }); auth.close();
  const settings = createSettingsStore(path.join(source, 'agent4.sqlite'));
  settings.update({ name: 'Example team', modules: { room: true, money: false } }); settings.close();
  for (const name of ['files','meeting-audio']) { await mkdir(path.join(source, name)); await writeFile(path.join(source, name, 'example.bin'), 'fictional test content'); }
  const env = { ...process.env, AGENT4_DATA_DIR: source };
  execFileSync(process.execPath, ['scripts/backup.js'], { env, stdio: 'pipe' });
  const backups = await readdir(path.join(source, 'backups'));
  const directory = path.join(source, 'backups', backups[0]);
  const restoreEnv = { ...env, AGENT4_DATA_DIR: target };
  execFileSync(process.execPath, ['scripts/restore.js', directory], { env: restoreEnv, stdio: 'pipe' });
  const restored = createAuthStore(path.join(target, 'agent4.sqlite'));
  assert.ok(restored.authenticate('owner@example.com', 'a long restore test passphrase')); restored.close();
  const restoredSettings = createSettingsStore(path.join(target, 'agent4.sqlite'));
  assert.equal(restoredSettings.get().modules.room, true); assert.equal(restoredSettings.get().modules.money, false); restoredSettings.close();
  for (const name of ['files','meeting-audio']) assert.equal(await readFile(path.join(target, name, 'example.bin'), 'utf8'), 'fictional test content');
  assert.throws(() => execFileSync(process.execPath, ['scripts/restore.js', directory], { env: restoreEnv, stdio: 'pipe' }), /Restore refused/);
});
