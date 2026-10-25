import { cp, mkdir, stat, access } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
if (!process.argv[2]) throw new Error('Usage: node scripts/restore.js /path/to/one-backup-directory');
const backup = path.resolve(process.argv[2]);
const { runtime } = await loadConfig();
const snapshot = path.join(backup, 'agent4.sqlite');
await stat(snapshot);
const db = new DatabaseSync(snapshot, { readOnly: true });
try {
  const check = db.prepare('PRAGMA integrity_check').get();
  if (Object.values(check)[0] !== 'ok') throw new Error('This backup failed the SQLite integrity check.');
  if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent4_users'").get()) throw new Error('This is not an Agent4 database.');
} finally { db.close(); }
try { await access(runtime.roomDatabasePath); throw new Error('Restore refused: this data directory already has a database. Use a fresh installation or Compose project.'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
await mkdir(runtime.dataRoot, { recursive: true, mode: 0o700 });
for (const name of ['files','meeting-audio']) {
  try { await cp(path.join(backup, name), path.join(runtime.dataRoot, name), { recursive: true, force: false, errorOnExist: true }); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
await cp(snapshot, runtime.roomDatabasePath, { force: false, errorOnExist: true });
console.log('Restored Agent4 into an empty data directory. Start the app and sign in with the restored account.');
