import { DatabaseSync } from 'node:sqlite';
export const MODULES = Object.freeze([
  { id: 'room', name: 'Canvas', description: 'A shared wall for notes, links and ideas.', enabled: false },
  { id: 'workspaces', name: 'Clients & projects', description: 'Keep clients, deals, files and project work together.', enabled: true },
  { id: 'tasks', name: 'Tasks', description: 'Assign work, set dates and track progress.', enabled: true },
  { id: 'film', name: 'Meetings', description: 'Record, transcribe and review meetings. AI and transcription are optional connections.', enabled: true },
  { id: 'money', name: 'Money', description: 'Track income, expenses and invoices. Owner only.', enabled: true },
  { id: 'paperwork', name: 'Paperwork', description: 'Draft proposals and agreements from reusable templates. Owner only.', enabled: true },
  { id: 'monitor', name: 'Sites', description: 'Monitor the public sites you choose to add. Owner only.', enabled: false }
]);
function cleanSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Workspace settings are required.');
  const out = {};
  if ('name' in input) {
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 80) throw new Error('Workspace name must contain 1–80 characters.');
    out.name = input.name.trim();
  }
  if ('modules' in input) {
    if (!input.modules || typeof input.modules !== 'object' || Array.isArray(input.modules)) throw new Error('Choose your modules.');
    out.modules = {};
    for (const [key, value] of Object.entries(input.modules)) {
      if (!MODULES.some(m => m.id === key) || typeof value !== 'boolean') throw new Error('Unknown module or invalid module setting.');
      out.modules[key] = value;
    }
  }
  return out;
}
export function createSettingsStore(databasePath) {
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000; CREATE TABLE IF NOT EXISTS agent4_settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)');
  const defaults = { name: 'Your workspace', modules: Object.fromEntries(MODULES.map(m => [m.id, m.enabled])) };
  const get = () => {
    const saved = JSON.parse(db.prepare('SELECT value FROM agent4_settings WHERE id=1').get()?.value || '{}');
    return { ...defaults, ...saved, modules: { ...defaults.modules, ...saved.modules }, availableModules: MODULES };
  };
  return { get,
    update(input) {
      const clean = cleanSettings(input);
      db.exec('BEGIN IMMEDIATE');
      try {
        const previous = get();
        const next = { name: clean.name ?? previous.name, modules: { ...previous.modules, ...clean.modules } };
        db.prepare('INSERT INTO agent4_settings (id,value) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(JSON.stringify(next));
        db.exec('COMMIT'); return get();
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }, close() { db.close(); }
  };
}
