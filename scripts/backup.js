import { cp, mkdir, writeFile, chmod, stat } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
const { runtime } = await loadConfig();
await stat(runtime.roomDatabasePath);
const directory = path.join(runtime.dataRoot, 'backups', new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(directory, { recursive: true, mode: 0o700 });
const snapshot = path.join(directory, 'agent4.sqlite');
const db = new DatabaseSync(runtime.roomDatabasePath);
try { db.exec(`VACUUM INTO '${snapshot.replaceAll("'", "''")}'`); } finally { db.close(); }
await chmod(snapshot, 0o600);
for (const name of ['files', 'meeting-audio']) {
  try { await cp(path.join(runtime.dataRoot, name), path.join(directory, name), { recursive: true }); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
await writeFile(path.join(directory, 'README.txt'), 'Agent4 backup: database, uploaded files and meeting audio. Restore only with the app stopped. Keep this directory private. Environment credentials and setup keys are intentionally excluded.\n', { mode: 0o600 });
console.log(`Backup saved to ${directory}. Copy the entire directory to private off-host storage.`);
