import { randomBytes } from 'node:crypto';
import { chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { APP_ROOT, loadConfig } from '../src/config.js';
process.chdir(APP_ROOT);
await mkdir('.secrets', { recursive: true, mode: 0o700 });
await chmod('.secrets', 0o700);
try { await copyFile('.env.example', '.env', 1); } catch (error) { if (error.code !== 'EEXIST') throw error; }
await chmod('.env', 0o600);
process.loadEnvFile('.env');
const config = await loadConfig();
const file = path.resolve(config.runtime.setupTokenFile);
let token;
try { token = (await readFile(file, 'utf8')).trim(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (!token) {
  token = randomBytes(32).toString('hex');
  await writeFile(file, token, { mode: 0o600 });
}
await chmod(file, 0o600);
console.log(`Open this private setup link after Agent4 starts:\n${config.runtime.publicOrigin}/#setup=${token}\n\nChoose your name, email and password in the browser. Keep this link private.\nExisting installations keep their accounts; setup never replaces an owner.`);
