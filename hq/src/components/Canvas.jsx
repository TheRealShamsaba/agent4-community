import React, { useEffect, useRef, useState } from 'react';
import { Download, LoaderCircle, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { ROOM_ID } from '../api.js';

let unsaved = false;
export function canvasHasUnsavedChanges() { return unsaved; }
const blank = () => ({ localObjects: [], layout: {}, edges: [], zones: [], strokes: [] });
export function Canvas() {
  const [state, setState] = useState(blank);
  const [version, setVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  unsaved = dirty;
  useEffect(() => () => { unsaved = false; }, []);
  async function load() {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/rooms/${ROOM_ID}`);
      if (!response.ok) throw new Error('Could not load this canvas. Try again.');
      const body = await response.json();
      setState(body.room?.state || blank()); setVersion(body.room?.version || 0); setDirty(false);
    } catch (cause) { setError(cause.message); } finally { setBusy(false); }
  }
  useEffect(() => { load(); }, []);
  useEffect(() => {
    const warn = event => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  // Notify on shared changes without ever replacing this person's draft.
  useEffect(() => {
    const events = new EventSource(`/api/rooms/${ROOM_ID}/events`);
    const update = event => {
      const body = JSON.parse(event.data);
      if (body.room?.version > version) {
        if (dirtyRef.current) setError('A teammate saved a newer canvas. Download your draft, then reload to see their changes.');
        else { setState(body.room.state); setVersion(body.room.version); }
      }
    };
    events.addEventListener('room.updated', update);
    return () => events.close();
  }, [version]);
  function patch(id, changes) {
    setDirty(true);
    setState(current => ({ ...current, localObjects: current.localObjects.map(note => note.id === id ? { ...note, ...changes } : note) }));
  }
  async function save() {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/rooms/${ROOM_ID}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseVersion: version, label: 'Canvas notes updated', state }) });
      const body = await response.json();
      if (!response.ok) throw new Error(response.status === 409 ? 'A teammate saved first. Download your draft, then reload before making changes.' : body.error?.message || 'Could not save. Your draft is still here.');
      setState(body.room.state); setVersion(body.room.version); setDirty(false);
    } catch (cause) { setError(cause.message); } finally { setBusy(false); }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'agent4-canvas-draft.json'; link.click(); URL.revokeObjectURL(url);
  }
  return <main className="canvas-page">
    <header><div><span className="setup-eyebrow">A LITTLE ROOM TO THINK</span><h1>Your team canvas</h1><p>Notes, ideas, and the things you want everyone to see. Turn this tool off any time; your notes stay here.</p></div>
      <div className="canvas-actions"><button onClick={() => { setState(s => ({ ...s, localObjects: [...s.localObjects, { id: `note-${globalThis.crypto.randomUUID()}`, type: 'note', title: 'New idea', body: '', tone: 'yellow', x: 0, y: 0, w: 280, rot: 0 }] })); setDirty(true); }} disabled={busy || state.localObjects.length >= 200}><Plus size={16} /> Add note</button><button disabled={busy || !dirty} onClick={save}>{busy ? <LoaderCircle size={16} className="is-spinning" /> : <Save size={16} />} Save canvas</button><button onClick={() => { if (!dirty || window.confirm('Discard your unsaved canvas edits and load the saved version?')) load(); }} disabled={busy}><RefreshCw size={16} /> Reload</button>{dirty ? <button onClick={download}><Download size={16} /> Download draft</button> : null}</div>
    </header>
    <p className="canvas-status" role="status">{dirty ? 'Unsaved changes · save before leaving this page' : `Saved · revision ${version}`}</p>
    {error ? <p className="auth-panel__error" role="alert">{error}</p> : null}
    {!state.localObjects.length && !busy ? <div className="canvas-empty"><h2>Good ideas need somewhere to land.</h2><p>Add your first note. Keep a plan, a useful link, or a question for the team.</p></div> : null}
    <div className="canvas-notes">{state.localObjects.map(note => <article className={`canvas-note tone-${note.tone}`} key={note.id}>
      <div><input aria-label="Note title" maxLength={240} value={note.title} onChange={e => patch(note.id, { title: e.target.value })} /><button aria-label={`Delete ${note.title}`} onClick={() => { setState(s => ({ ...s, localObjects: s.localObjects.filter(n => n.id !== note.id) })); setDirty(true); }}><Trash2 size={15} /></button></div>
      <textarea aria-label={`Content for ${note.title}`} maxLength={50000} value={note.body || ''} placeholder="Write it down…" onChange={e => patch(note.id, { body: e.target.value })} />
      <footer><select aria-label="Note color" value={note.tone} onChange={e => patch(note.id, { tone: e.target.value })}><option value="yellow">Yellow</option><option value="blue">Blue</option><option value="mint">Mint</option><option value="pink">Pink</option></select><small>{note.updatedByName || note.createdByName || 'Your draft'}</small></footer>
    </article>)}</div>
  </main>;
}
