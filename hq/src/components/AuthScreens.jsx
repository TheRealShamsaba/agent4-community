import React, { useEffect, useState } from "react";
import { ArrowRight, Check, Copy, LoaderCircle, ShieldCheck, Trash2, TriangleAlert, UserPlus, Users, X } from "lucide-react";
import { Agent4Avatar } from "./Agent4Avatar.jsx";
import { authRequest, entryTokens } from "../api.js";
import { WorkspaceSettings } from "./WorkspaceSettings.jsx";
import { copyText } from "../clipboard.js";

/* Everything that happens before, and around, being signed in. */

export function AuthLoading() {
  return (
    <main className="auth-screen auth-screen--loading">
      <Agent4Avatar size="large" />
      <LoaderCircle className="is-spinning" size={20} />
      {/* A spinner with nothing under it cannot say whether it is working or
          stuck. It gives up on its own after AUTH_TIMEOUT_MS. */}
      <p>Checking your Agent4 session…</p>
    </main>
  );
}

export function LoginScreen({ notice = "", onAuthenticated }) {
  const inviteToken = entryTokens.invite;
  const [invite, setInvite] = useState(null);
  const [inviteLoading, setInviteLoading] = useState(Boolean(inviteToken));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!inviteToken) return;
    authRequest(`/invites/${inviteToken}`)
      .then((response) => setInvite(response.invite))
      .catch((inviteError) => setError(inviteError.message))
      .finally(() => setInviteLoading(false));
  }, [inviteToken]);

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (invite && password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = invite
        ? await authRequest("/register", { method: "POST", body: JSON.stringify({ token: inviteToken, password }) })
        : await authRequest("/login", { method: "POST", body: JSON.stringify({ email, password }) });
      window.history.replaceState({}, "", window.location.pathname);
      entryTokens.invite = "";
      onAuthenticated(response.actor);
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-screen">
      <section className="auth-panel" aria-label={invite ? "Join Agent4" : "Sign in to Agent4"}>
        <header><Agent4Avatar size="large" /><div><strong>agent4</strong><span>your team workspace</span></div></header>
        {inviteLoading ? <div className="auth-panel__loading"><LoaderCircle className="is-spinning" size={18} /> Checking invite</div> : (
          <form onSubmit={submit}>
            <div className="auth-panel__title">
              <h1>{invite ? `Join as ${invite.name}` : "Welcome back"}</h1>
              <p>{invite ? invite.email : "Sign in to your team’s Agent4 workspace."}</p>
            </div>
            {notice ? <div className="auth-panel__notice" role="status"><TriangleAlert size={14} aria-hidden="true" /> {notice}</div> : null}
            {!invite ? <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required autoFocus /></label> : null}
            <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={invite ? "new-password" : "current-password"} minLength={invite ? 12 : undefined} required autoFocus={Boolean(invite)} /></label>
            {invite ? <label>Confirm password<input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={12} required /></label> : null}
            {error ? <div className="auth-panel__error" role="alert">{error}</div> : null}
            <button type="submit" disabled={busy}>{busy ? <LoaderCircle className="is-spinning" size={16} /> : invite ? <UserPlus size={16} /> : <ArrowRight size={16} />}{invite ? "Create account" : "Sign in"}</button>
          </form>
        )}
      </section>
    </main>
  );
}

export function TeamPanel({ open, actor, members, onInvite, onRevoke, onChangePassword, onClose }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [removingId, setRemovingId] = useState("");
  const [error, setError] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordSaved, setPasswordSaved] = useState(false);
  const isOwner = actor.role === "owner";
  if (!open) return null;

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const url = await onInvite({ name, email });
      setInviteUrl(url);
    } catch (inviteError) {
      setError(inviteError.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(member) {
    if (!window.confirm(`Remove ${member.name} from Agent4 and sign them out everywhere?`)) return;
    setRemovingId(member.id);
    setError("");
    try {
      await onRevoke(member.id);
    } catch (removeError) {
      setError(removeError.message);
    } finally {
      setRemovingId("");
    }
  }

  async function changePassword(event) {
    event.preventDefault();
    if (nextPassword !== confirmPassword) {
      setPasswordError("New passwords do not match.");
      return;
    }
    setPasswordBusy(true);
    setPasswordError("");
    setPasswordSaved(false);
    try {
      await onChangePassword({ currentPassword, nextPassword });
      setCurrentPassword("");
      setNextPassword("");
      setConfirmPassword("");
      setPasswordSaved(true);
    } catch (passwordChangeError) {
      setPasswordError(passwordChangeError.message);
    } finally {
      setPasswordBusy(false);
    }
  }

  return (
    <aside className="team-panel" aria-label={isOwner ? "Manage team access" : "Account settings"}>
      <header><div>{isOwner ? <Users size={17} /> : <ShieldCheck size={17} />}<span><strong>{isOwner ? "Team access" : "My account"}</strong><small>Signed in as {actor.name} · {actor.role}</small></span></div><button type="button" onClick={onClose} aria-label="Close account settings"><X size={16} /></button></header>
      {isOwner ? <div className="team-panel__members">
        {members.map((member) => (
          <div key={member.id}>
            <span>{member.name.slice(0, 1).toUpperCase()}</span>
            <p><strong>{member.name}</strong><small>{member.email} · {member.role}</small></p>
            {member.id !== actor.id && member.role !== "owner" ? <button type="button" onClick={() => removeMember(member)} disabled={Boolean(removingId)} aria-label={`Remove ${member.name}`} title={`Remove ${member.name}`}>{removingId === member.id ? <LoaderCircle className="is-spinning" size={14} /> : <Trash2 size={14} />}</button> : null}
          </div>
        ))}
      </div> : null}
      <section className="team-panel__access" aria-label="Access policy">
        <strong>{isOwner ? "What members can access" : "Your access"}</strong>
        <p><span>Shared with the team</span> Locker Room, Companies and Tasks</p>
        <p><span>Private to each person</span> Home calendar, Content and Film Room recordings, transcripts and notes</p>
        <p><span>Owner only</span> Pipeline, Money, Paperwork, invites, removals and deletion of companies, projects, sheets or tasks</p>
      </section>
      {isOwner && inviteUrl ? (
        <div className="team-panel__invite"><strong>Private invite ready</strong><small>Single use · expires in 7 days</small><p>{inviteUrl}</p><button type="button" onClick={() => copyText(inviteUrl)}><Copy size={15} /> Copy invite link</button><button type="button" onClick={() => { setInviteUrl(""); setName(""); setEmail(""); }}>Invite someone else</button></div>
      ) : isOwner ? (
        <form onSubmit={submit}>
          <div className="team-panel__form-head"><strong>Invite a teammate</strong><small>They choose their own password. The link works once and expires after 7 days.</small></div>
          <label>Name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required autoFocus /></label>
          <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={180} required /></label>
          {error ? <div className="team-panel__error" role="alert">{error}</div> : null}
          <button type="submit" disabled={busy}>{busy ? <LoaderCircle className="is-spinning" size={15} /> : <UserPlus size={15} />} Create invite</button>
        </form>
      ) : null}
      {isOwner ? <WorkspaceSettings key={inviteUrl} /> : null}
      <details className="team-panel__security">
        <summary><ShieldCheck size={15} /><span><strong>Login & security</strong><small>Change your Agent4 password</small></span></summary>
        <form onSubmit={changePassword}>
          <label>Current password<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" required /></label>
          <label>New password<input type="password" value={nextPassword} onChange={(event) => setNextPassword(event.target.value)} autoComplete="new-password" minLength={12} required /></label>
          <label>Confirm new password<input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={12} required /></label>
          {passwordError ? <div className="team-panel__error" role="alert">{passwordError}</div> : null}
          {passwordSaved ? <div className="team-panel__success"><Check size={13} /> Password changed. Other sessions were signed out.</div> : null}
          <button type="submit" disabled={passwordBusy}>{passwordBusy ? <LoaderCircle className="is-spinning" size={15} /> : <ShieldCheck size={15} />} Update password</button>
        </form>
      </details>
    </aside>
  );
}
