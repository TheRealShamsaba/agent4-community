import { mkdirSync } from "node:fs";
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const PASSWORD_BYTES = 64;
const MIN_PASSWORD_LENGTH = 12;
const PASSWORD_PREFIX = 'scrypt-131072-8-1$';

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function tokenHash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function passwordHash(password, salt) {
  // OWASP's scrypt baseline: N=2^17, r=8, p=1 (128 MiB per derivation).
  const digest = scryptSync(password, salt, PASSWORD_BYTES, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
  return PASSWORD_PREFIX + digest.toString('hex');
}

function safeEqualHex(left, right) {
  try {
    if (typeof left !== 'string' || typeof right !== 'string' || !/^[0-9a-f]+$/i.test(left) || !/^[0-9a-f]+$/i.test(right)) return false;
    const leftBuffer = Buffer.from(left, "hex");
    const rightBuffer = Buffer.from(right, "hex");
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
  } catch {
    return false;
  }
}

function passwordMatches(password, user, computed = '') {
  if (!user || typeof password !== 'string') return false;
  if (user.password_hash.startsWith(PASSWORD_PREFIX)) {
    return safeEqualHex((computed || passwordHash(password, user.password_salt)).slice(PASSWORD_PREFIX.length), user.password_hash.slice(PASSWORD_PREFIX.length));
  }
  // Read-only compatibility for the first preview's stored hashes. Successful
  // login immediately replaces this value with the stronger version above.
  if (!/^[a-f0-9]{128}$/i.test(user.password_hash)) return false;
  const legacy = scryptSync(password, user.password_salt, PASSWORD_BYTES, { N: 16384, r: 8, p: 1 }).toString('hex');
  return safeEqualHex(legacy, user.password_hash);
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role
  };
}

function assertPassword(password) {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH || password.length > 200) {
    throw new Error(`Password must contain ${MIN_PASSWORD_LENGTH}-200 characters.`);
  }
}

export function createAuthStore(databasePath) {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=10000; PRAGMA foreign_keys=ON;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS agent4_users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      created_at TEXT NOT NULL,
      disabled_at TEXT
    );
    CREATE TABLE IF NOT EXISTS agent4_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES agent4_users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS agent4_sessions_user ON agent4_sessions(user_id);
    CREATE INDEX IF NOT EXISTS agent4_sessions_expiry ON agent4_sessions(expires_at);
    CREATE TABLE IF NOT EXISTS agent4_invites (
      token_hash TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      accepted_at TEXT,
      FOREIGN KEY(created_by) REFERENCES agent4_users(id) ON DELETE CASCADE
    );
  `);
  const sessionColumns = database.prepare("PRAGMA table_info(agent4_sessions)").all();
  if (!sessionColumns.some(column => column.name === 'csrf_token')) database.exec('ALTER TABLE agent4_sessions ADD COLUMN csrf_token TEXT');
  database.exec('CREATE TABLE IF NOT EXISTS agent4_login_attempts (scope TEXT NOT NULL, attempted_at INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS agent4_login_attempts_scope ON agent4_login_attempts(scope,attempted_at)');
  const userColumns = database.prepare("PRAGMA table_info(agent4_users)").all();
  if (!userColumns.some((column) => column.name === "telegram_user_id")) {
    database.exec("ALTER TABLE agent4_users ADD COLUMN telegram_user_id TEXT");
  }
  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS agent4_users_telegram_id
    ON agent4_users(telegram_user_id)
    WHERE telegram_user_id IS NOT NULL;
  `);

  const countUsersStatement = database.prepare("SELECT COUNT(*) AS count FROM agent4_users WHERE disabled_at IS NULL");
  const selectUserByEmail = database.prepare("SELECT * FROM agent4_users WHERE email = ? AND disabled_at IS NULL");
  const selectUserById = database.prepare("SELECT * FROM agent4_users WHERE id = ? AND disabled_at IS NULL");
  const selectUserByTelegramId = database.prepare("SELECT * FROM agent4_users WHERE telegram_user_id = ? AND disabled_at IS NULL");
  const selectUsers = database.prepare("SELECT * FROM agent4_users WHERE disabled_at IS NULL ORDER BY name COLLATE NOCASE, created_at");
  const insertUser = database.prepare(`
    INSERT INTO agent4_users (id,email,name,role,password_hash,password_salt,created_at,disabled_at)
    VALUES (?,?,?,?,?,?,?,NULL)
  `);
  const insertSession = database.prepare(`
    INSERT INTO agent4_sessions (token_hash,user_id,created_at,expires_at,last_seen_at,csrf_token) VALUES (?,?,?,?,?,?)
  `);
  const selectSession = database.prepare(`
    SELECT u.* FROM agent4_sessions s JOIN agent4_users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled_at IS NULL
  `);
  const touchSession = database.prepare("UPDATE agent4_sessions SET last_seen_at = ? WHERE token_hash = ?");
  const deleteSession = database.prepare("DELETE FROM agent4_sessions WHERE token_hash = ?");
  const deleteSessionsByUser = database.prepare("DELETE FROM agent4_sessions WHERE user_id = ?");
  const deleteExpiredSessions = database.prepare("DELETE FROM agent4_sessions WHERE expires_at <= ?");
  const updatePassword = database.prepare("UPDATE agent4_users SET password_hash = ?, password_salt = ? WHERE id = ? AND disabled_at IS NULL");
  const disableMember = database.prepare("UPDATE agent4_users SET disabled_at = ?, telegram_user_id = NULL WHERE id = ? AND role = 'member' AND disabled_at IS NULL");
  const updateTelegramUserId = database.prepare("UPDATE agent4_users SET telegram_user_id = ? WHERE id = ? AND disabled_at IS NULL");
  const insertInvite = database.prepare(`
    INSERT INTO agent4_invites (token_hash,email,name,role,created_by,created_at,expires_at,accepted_at)
    VALUES (?,?,?,?,?,?,?,NULL)
  `);
  const selectInvite = database.prepare(`
    SELECT * FROM agent4_invites WHERE token_hash = ? AND accepted_at IS NULL AND expires_at > ?
  `);
  const acceptInvite = database.prepare("UPDATE agent4_invites SET accepted_at = ? WHERE token_hash = ? AND accepted_at IS NULL");

  function countUsers() {
    return Number(countUsersStatement.get().count);
  }

  function listUsers() {
    return selectUsers.all().map(publicUser);
  }

  function createUser({ email, name, role = "member", password, now = new Date().toISOString() }) {
    const normalizedEmail = normalizeEmail(email);
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail) || normalizedEmail.length > 180) throw new Error("A valid email is required.");
    if (typeof name !== "string" || !name.trim() || name.trim().length > 80) throw new Error("Name must contain 1-80 characters.");
    if (!["owner", "member"].includes(role)) throw new Error("Role must be owner or member.");
    assertPassword(password);
    const salt = randomBytes(16).toString("hex");
    const id = `user-${randomUUID()}`;
    insertUser.run(id, normalizedEmail, name.trim(), role, passwordHash(password, salt), salt, now);
    return publicUser(selectUserById.get(id));
  }

  function hasUsers() {
    return Number(database.prepare('SELECT COUNT(*) AS count FROM agent4_users').get().count) > 0;
  }
  function ensureBootstrap({ email, name, password }) {
    if (!email || !name || !password) return null;
    database.exec('BEGIN IMMEDIATE');
    try {
      if (hasUsers()) { database.exec('COMMIT'); return null; }
      const user = createUser({ email, name, password, role: 'owner' });
      database.exec('COMMIT'); return user;
    } catch (error) { database.exec('ROLLBACK'); throw error; }
  }

  function authenticate(email, password) {
    const user = selectUserByEmail.get(normalizeEmail(email));
    if (typeof password !== 'string' || password.length > 200) return null;
    const computed = passwordHash(password, user?.password_salt || 'agent4-unavailable-account');
    if (!passwordMatches(password, user, computed)) return null;
    if (!user.password_hash.startsWith(PASSWORD_PREFIX)) {
      const upgraded = database.prepare('UPDATE agent4_users SET password_hash=? WHERE id=? AND password_hash=?').run(computed, user.id, user.password_hash);
      if (!upgraded.changes) return null; // Another process changed the password.
    }
    return publicUser(user);
  }

  function createAuthenticatedSession(email, password, options = {}) {
    database.exec('BEGIN IMMEDIATE');
    try {
      const user = authenticate(email, password);
      const session = user ? createSession(user.id, options) : null;
      database.exec('COMMIT'); return session;
    } catch (error) { database.exec('ROLLBACK'); throw error; }
  }

  function findUserByTelegramId(telegramUserId) {
    const value = String(telegramUserId || "").trim();
    return value ? publicUser(selectUserByTelegramId.get(value)) : null;
  }

  function linkTelegramUser(userId, telegramUserId) {
    const value = String(telegramUserId || "").trim();
    if (!/^\d{5,20}$/.test(value)) throw new Error("A valid numeric Telegram user id is required.");
    if (!selectUserById.get(String(userId || ""))) throw new Error("The member account is unavailable.");
    updateTelegramUserId.run(value, userId);
    return publicUser(selectUserById.get(userId));
  }

  function createSession(userId, { ttlHours = 24 * 7, now = new Date() } = {}) {
    const user = selectUserById.get(userId);
    if (!user) throw new Error("User is unavailable.");
    const token = randomBytes(32).toString("base64url");
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000).toISOString();
    deleteExpiredSessions.run(createdAt);
    const csrfToken = randomBytes(32).toString("base64url");
    insertSession.run(tokenHash(token), userId, createdAt, expiresAt, createdAt, csrfToken);
    return { token, csrfToken, expiresAt, user: publicUser(user) };
  }

  function getSession(token, now = new Date().toISOString()) {
    if (!token) return null;
    const hash = tokenHash(token);
    const user = selectSession.get(hash, now);
    if (!user) return null;
    touchSession.run(now, hash);
    return publicUser(user);
  }

  function revokeSession(token) {
    if (token) deleteSession.run(tokenHash(token));
  }

  function getCsrfToken(token, now = new Date().toISOString()) {
    if (!token) return "";
    const hash = tokenHash(token);
    const session = database.prepare("SELECT csrf_token FROM agent4_sessions WHERE token_hash = ? AND expires_at > ?").get(hash, now);
    if (!session) return "";
    if (session.csrf_token) return session.csrf_token;
    const csrfToken = randomBytes(32).toString("base64url");
    database.prepare("UPDATE agent4_sessions SET csrf_token = ? WHERE token_hash = ?").run(csrfToken, hash);
    return csrfToken;
  }

  function verifyCsrfToken(token, candidate, now = new Date().toISOString()) {
    if (typeof candidate !== "string" || !candidate) return false;
    const expected = getCsrfToken(token, now);
    return Boolean(expected) && safeEqualHex(tokenHash(candidate), tokenHash(expected));
  }

  function changePassword(userId, currentPassword, nextPassword) {
    const user = selectUserById.get(String(userId || ""));
    if (!user || typeof currentPassword !== "string" || !passwordMatches(currentPassword, user)) return null;
    assertPassword(nextPassword);
    if (passwordMatches(nextPassword, user)) throw new Error("Choose a new password you are not already using.");
    const salt = randomBytes(16).toString("hex");
    database.exec("BEGIN IMMEDIATE");
    try {
      updatePassword.run(passwordHash(nextPassword, salt), salt, user.id);
      deleteSessionsByUser.run(user.id);
      database.exec("COMMIT");
      return publicUser(selectUserById.get(user.id));
    } catch (error) {
      try { database.exec("ROLLBACK"); } catch { /* Transaction already closed. */ }
      throw error;
    }
  }

  function revokeMember(userId, now = new Date().toISOString()) {
    database.exec("BEGIN IMMEDIATE");
    try {
      const result = disableMember.run(now, userId);
      if (result.changes) deleteSessionsByUser.run(userId);
      database.exec("COMMIT");
      return Boolean(result.changes);
    } catch (error) {
      try { database.exec("ROLLBACK"); } catch { /* Transaction already closed. */ }
      throw error;
    }
  }

  function createInvite({ email, name, role = "member", createdBy, ttlHours = 24 * 7, now = new Date() }) {
    const normalizedEmail = normalizeEmail(email);
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail) || normalizedEmail.length > 180) throw new Error("A valid email is required.");
    if (typeof name !== "string" || !name.trim() || name.trim().length > 80) throw new Error("Name must contain 1-80 characters.");
    if (role !== "member") throw new Error("Invites currently create member accounts only.");
    if (selectUserById.get(createdBy)?.role !== "owner") throw new Error("Only an owner may invite members.");
    if (selectUserByEmail.get(normalizedEmail)) throw new Error("That email already has an account.");
    const token = randomBytes(32).toString("base64url");
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000).toISOString();
    database.exec('BEGIN IMMEDIATE');
    try {
      database.prepare('DELETE FROM agent4_invites WHERE email = ? AND accepted_at IS NULL').run(normalizedEmail);
      insertInvite.run(tokenHash(token), normalizedEmail, name.trim(), role, createdBy, createdAt, expiresAt);
      database.exec('COMMIT');
    } catch (error) { database.exec('ROLLBACK'); throw error; }
    return { token, email: normalizedEmail, name: name.trim(), role, expiresAt };
  }

  function getInvite(token, now = new Date().toISOString()) {
    const invite = token ? selectInvite.get(tokenHash(token), now) : null;
    if (!invite) return null;
    return { email: invite.email, name: invite.name, role: invite.role, expiresAt: invite.expires_at };
  }

  function acceptInviteToken(token, password, now = new Date().toISOString()) {
    assertPassword(password);
    const hash = tokenHash(token || "");
    database.exec("BEGIN IMMEDIATE");
    try {
      const invite = selectInvite.get(hash, now);
      if (!invite) { database.exec('COMMIT'); return null; }
      const previous = database.prepare('SELECT * FROM agent4_users WHERE email = ?').get(invite.email);
      let user;
      if (previous?.disabled_at && previous.role === 'member') {
        const salt = randomBytes(16).toString('hex');
        database.prepare('UPDATE agent4_users SET disabled_at=NULL, name=?, password_hash=?, password_salt=? WHERE id=?').run(invite.name, passwordHash(password, salt), salt, previous.id);
        user = publicUser(selectUserById.get(previous.id));
      } else {
        user = createUser({ email: invite.email, name: invite.name, role: invite.role, password, now });
      }
      acceptInvite.run(now, hash);
      database.exec("COMMIT");
      return user;
    } catch (error) {
      try { database.exec("ROLLBACK"); } catch { /* Transaction already closed. */ }
      throw error;
    }
  }


  function resetPassword(email, password) {
    const user = selectUserByEmail.get(normalizeEmail(email));
    if (!user) return false;
    assertPassword(password);
    const salt = randomBytes(16).toString('hex');
    database.exec('BEGIN IMMEDIATE');
    try {
      updatePassword.run(passwordHash(password, salt), salt, user.id);
      deleteSessionsByUser.run(user.id);
      database.exec('COMMIT'); return true;
    } catch (error) { database.exec('ROLLBACK'); throw error; }
  }
  function listInvites(now = new Date().toISOString()) {
    return database.prepare('SELECT token_hash AS id, email, name, expires_at AS expiresAt FROM agent4_invites WHERE accepted_at IS NULL AND expires_at > ? ORDER BY created_at DESC').all(now);
  }
  function revokeInvite(id) {
    return Boolean(database.prepare('DELETE FROM agent4_invites WHERE token_hash=? AND accepted_at IS NULL').run(id).changes);
  }
  function attemptLogin(address, email, now = Date.now()) {
    const scopes = [[tokenHash('address:' + address), 30], [tokenHash('account:' + normalizeEmail(email)), 10]];
    database.exec('BEGIN IMMEDIATE');
    try {
      database.prepare('DELETE FROM agent4_login_attempts WHERE attempted_at < ?').run(now - 900000);
      const limited = scopes.some(([scope, limit]) => database.prepare('SELECT COUNT(*) AS count FROM agent4_login_attempts WHERE scope=?').get(scope).count >= limit);
      if (!limited) for (const [scope] of scopes) database.prepare('INSERT INTO agent4_login_attempts VALUES (?,?)').run(scope, now);
      database.exec('COMMIT'); return !limited;
    } catch (error) { database.exec('ROLLBACK'); throw error; }
  }

  return {
    countUsers, hasUsers, getCsrfToken, verifyCsrfToken, resetPassword, listInvites, revokeInvite, attemptLogin,
    listUsers,
    createUser,
    ensureBootstrap,
    authenticate,
    createAuthenticatedSession,
    findUserByTelegramId,
    linkTelegramUser,
    createSession,
    getSession,
    revokeSession,
    changePassword,
    revokeMember,
    createInvite,
    getInvite,
    acceptInviteToken,
    close() { database.close(); }
  };
}
