import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { createAuthStore } from '../src/auth-store.js';
import { loadConfig } from '../src/config.js';
const config = await loadConfig();
const auth = createAuthStore(config.runtime.roomDatabasePath);
const terminal = createInterface({ input: stdin, output: stdout });
try {
  const email = process.env.AGENT4_RESET_EMAIL || await terminal.question('Account email: ');
  const password = randomBytes(24).toString('base64url');
  if (!auth.resetPassword(email, password)) throw new Error('No active account has that email.');
  console.log(`New password: ${password}\nSave it in a password manager, then change it in Account settings. All sessions for this account were revoked.`);
} finally { terminal.close(); auth.close(); }
