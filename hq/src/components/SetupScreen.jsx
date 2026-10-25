import React, { useState } from 'react';
import { ArrowRight, LoaderCircle, ShieldCheck } from 'lucide-react';
import { Agent4Avatar } from './Agent4Avatar.jsx';
import { authRequest, entryTokens } from '../api.js';

export function SetupScreen({ onAuthenticated }) {
  const [form, setForm] = useState({ workspace: '', name: '', email: '', password: '', confirm: '', token: entryTokens.setup || '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const field = key => event => setForm(current => ({ ...current, [key]: event.target.value }));
  async function submit(event) {
    event.preventDefault();
    if (form.password !== form.confirm) { setError('Passwords do not match.'); return; }
    setBusy(true); setError('');
    try {
      const response = await authRequest('/setup', { method: 'POST', body: JSON.stringify(form) });
      entryTokens.setup = '';
      onAuthenticated(response.actor);
    } catch (cause) { setError(cause.message); } finally { setBusy(false); }
  }
  return <main className="auth-screen setup-screen">
    <section className="setup-story" aria-label="Welcome to Agent4">
      <Agent4Avatar size="large" /><span className="setup-eyebrow">AGENT4 · COMMUNITY</span>
      <h1>Your company.<br />Your starting point.</h1>
      <p>A place to plan the work, look after your clients, and build something together. Hosted by you. Shaped by your team.</p>
      <div className="setup-promise"><ShieldCheck size={20} /><span>A fresh workspace. Your data stays on your server.<br />No subscription needed for the core tools.</span></div>
    </section>
    <section className="auth-panel" aria-label="Set up your owner account">
      <form onSubmit={submit}>
        <div className="auth-panel__title"><h2>Make yourself at home</h2><p>Create the first owner account. You can invite your team next.</p></div>
        <label>Workspace name<input value={form.workspace} onChange={field('workspace')} maxLength={80} placeholder="Your company or team" required /></label>
        <label>Your name<input value={form.name} onChange={field('name')} autoComplete="name" maxLength={80} required autoFocus /></label>
        <label>Email<input type="email" value={form.email} onChange={field('email')} autoComplete="email" maxLength={180} required /></label>
        <label>Password<input type="password" value={form.password} onChange={field('password')} autoComplete="new-password" minLength={12} maxLength={200} required /><small>Use at least 12 characters. A passphrase works well.</small></label>
        <label>Confirm password<input type="password" value={form.confirm} onChange={field('confirm')} autoComplete="new-password" minLength={12} maxLength={200} required /></label>
        {!entryTokens.setup ? <label>Setup key<input type="password" value={form.token} onChange={field('token')} autoComplete="off" required /><small>Use the private setup link or key printed by the installer.</small></label> : null}
        {error ? <p className="auth-panel__error" role="alert">{error}</p> : null}
        <button disabled={busy}>{busy ? <LoaderCircle size={16} className="is-spinning" /> : <ArrowRight size={16} />} Create my workspace</button>
      </form>
    </section>
  </main>;
}
