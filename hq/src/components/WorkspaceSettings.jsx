import React, { useEffect, useState } from 'react';
import { Check, Copy, LoaderCircle, Settings2, Trash2 } from 'lucide-react';
import { authRequest } from '../api.js';
import { copyText } from '../clipboard.js';

export function WorkspaceSettings() {
  const [settings, setSettings] = useState(null);
  const [invites, setInvites] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let live = true;
    Promise.all([fetch('/api/settings').then(r => r.json()), authRequest('/invites')])
      .then(([body, invitation]) => { if (live) { setSettings(body.settings); setInvites(invitation.invites || []); } })
      .catch(cause => { if (live) setError(cause.message); });
    return () => { live = false; };
  }, []);
  async function save(event) {
    event.preventDefault(); setBusy(true); setError(''); setSaved(false);
    try {
      const response = await fetch('/api/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: settings.name, modules: settings.modules }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || 'Could not save your workspace.');
      setSettings(body.settings); setSaved(true);
      window.dispatchEvent(new window.CustomEvent('agent4-settings', { detail: body.settings }));
    } catch (cause) { setError(cause.message); } finally { setBusy(false); }
  }
  async function revoke(invite) {
    setBusy(true); setError('');
    try { await authRequest(`/invites/${invite.id}`, { method: 'DELETE' }); setInvites(current => current.filter(i => i.id !== invite.id)); }
    catch (cause) { setError(cause.message); } finally { setBusy(false); }
  }
  return <details className="team-panel__security workspace-settings">
    <summary><Settings2 size={16} /><span><strong>Customize this workspace</strong><small>Choose your name and the tools your team needs</small></span></summary>
    {settings ? <form onSubmit={save}>
      <label>Workspace name<input required maxLength={80} value={settings.name} onChange={e => { setSaved(false); setSettings(s => ({ ...s, name: e.target.value })); }} /></label>
      <p className="workspace-settings__hint">Turn tools off to clear your navigation. Their work stays saved. Turn them back on whenever you need them.</p>
      {settings.availableModules.map(module => <label className="module-choice" key={module.id}>
        <input type="checkbox" checked={settings.modules[module.id]} onChange={e => { setSaved(false); setSettings(s => ({ ...s, modules: { ...s.modules, [module.id]: e.target.checked } })); }} />
        <span><strong>{module.name}</strong><small>{module.description}</small></span>
      </label>)}
      <button disabled={busy}>{busy ? <LoaderCircle className="is-spinning" size={15} /> : <Check size={15} />} Save workspace</button>
      {saved ? <p role="status" className="team-panel__success">Workspace updated.</p> : null}
    </form> : <p>Loading workspace settings…</p>}
    {invites.length ? <section className="pending-invites"><h3>Pending invitations</h3><p>Creating another invite for an email replaces its previous link.</p>{invites.map(invite => <div key={invite.id}><span><strong>{invite.name}</strong><small>{invite.email} · expires {new Date(invite.expiresAt).toLocaleDateString()}</small></span><button type="button" disabled={busy} aria-label={`Revoke invite for ${invite.name}`} onClick={() => revoke(invite)}><Trash2 size={15} /></button></div>)}</section> : null}
    {error ? <p role="alert" className="team-panel__error">{error}</p> : null}
  </details>;
}
