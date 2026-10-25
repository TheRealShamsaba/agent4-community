import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeftRight, Download, FileText, LoaderCircle, Trash2, Upload } from "lucide-react";
import { formatDate } from "../format.js";

/* The documents you keep: the proposals you wrote with Claude, the file a
   client sent, the agreement you reuse. Drop them here and download them
   whenever you need one. A template is a document you intend to reuse. */

const PART_BYTES = 1_000_000;
const MAX_BYTES = 25 * 1024 * 1024;

async function call(pathname, { method = "GET", body } = {}) {
  const response = await fetch(pathname, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const parsed = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(parsed?.error?.message || "That did not go through.");
  return parsed;
}

async function uploadFile(file, { kind, companyId, companyName }, onProgress) {
  if (file.size > MAX_BYTES) throw new Error(`${file.name} is larger than 25 MB.`);
  if (!file.size) throw new Error(`${file.name} is empty.`);
  const { file: started } = await call("/api/files", { method: "POST", body: { name: file.name, size: file.size, mime: file.type || "application/octet-stream", kind, companyId, companyName } });
  try {
    let offset = 0;
    while (offset < file.size) {
      const part = file.slice(offset, offset + PART_BYTES);
      const response = await fetch(`/api/files/${started.id}/part?offset=${offset}`, { method: "PUT", headers: { "content-type": "application/octet-stream" }, body: part });
      if (!response.ok) throw new Error((await response.json().catch(() => ({})))?.error?.message || "The upload was interrupted.");
      offset += part.size;
      onProgress(offset / file.size);
    }
    await call(`/api/files/${started.id}/finish`, { method: "POST" });
  } catch (error) {
    await call(`/api/files/${started.id}`, { method: "DELETE" }).catch(() => {});
    throw error;
  }
}

function sizeLabel(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function FilesPanel({ title, hint, kind, companyId = "", companyName = "", showKinds = false, empty, compact = false }) {
  const [state, setState] = useState({ status: "loading", files: [], message: "" });
  const [uploads, setUploads] = useState([]);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const input = useRef(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (companyId) params.set("companyId", companyId);
      if (kind) params.set("kind", kind);
      setState({ status: "ready", files: (await call(`/api/files?${params}`)).files, message: "" });
    } catch (caught) {
      setState((current) => ({ ...current, status: "error", message: caught.message }));
    }
  }, [companyId, kind]);
  useEffect(() => { void load(); }, [load]);

  async function add(fileList) {
    setError("");
    for (const file of [...fileList]) {
      const key = `${file.name}-${file.size}-${Date.now()}`;
      setUploads((current) => [...current, { key, name: file.name, progress: 0 }]);
      try {
        await uploadFile(file, { kind: kind || "document", companyId, companyName }, (progress) => setUploads((current) => current.map((item) => (item.key === key ? { ...item, progress } : item))));
      } catch (caught) {
        setError(caught.message);
      } finally {
        setUploads((current) => current.filter((item) => item.key !== key));
      }
    }
    await load();
  }

  async function toggleKind(file) {
    setError("");
    try {
      await call(`/api/files/${file.id}`, { method: "PATCH", body: { kind: file.kind === "template" ? "document" : "template" } });
      await load();
    } catch (caught) { setError(caught.message); }
  }

  async function remove(file) {
    if (!window.confirm(`Delete “${file.name}”? This cannot be undone.`)) return;
    setError("");
    try {
      await call(`/api/files/${file.id}`, { method: "DELETE" });
      await load();
    } catch (caught) { setError(caught.message); }
  }

  return (
    <div
      className={`fp${dragging ? " is-dragging" : ""}${compact ? " is-compact" : ""}`}
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => { event.preventDefault(); setDragging(false); if (event.dataTransfer.files?.length) void add(event.dataTransfer.files); }}
    >
      <header className="fp-head">
        <span><h3>{title}</h3>{hint ? <small>{hint}</small> : null}</span>
        <button type="button" className="btn" onClick={() => input.current?.click()}><Upload size={14} /> Upload</button>
        <input ref={input} type="file" multiple hidden onChange={(event) => { if (event.target.files?.length) void add(event.target.files); event.target.value = ""; }} />
      </header>

      {uploads.map((upload) => (
        <div className="fp-upload" key={upload.key}><LoaderCircle className="is-spinning" size={14} /><span>{upload.name}</span><i style={{ "--p": `${Math.round(upload.progress * 100)}%` }} /></div>
      ))}
      {error ? <p className="fp-error" role="alert">{error}</p> : null}
      {state.status === "error" ? <p className="fp-error" role="alert">{state.message}</p> : null}

      {state.status === "ready" && state.files.length ? (
        <ul className="fp-list">
          {state.files.map((file) => (
            <li key={file.id}>
              <i><FileText size={16} /></i>
              <span><strong dir="auto">{file.name}</strong><small>{sizeLabel(file.size)} · {formatDate(String(file.createdAt).slice(0, 10))}{showKinds ? ` · ${file.kind}` : ""}</small></span>
              <a className="btn btn--icon" href={`/api/files/${file.id}/download`} aria-label={`Download ${file.name}`} title="Download"><Download size={15} /></a>
              {!compact ? <button type="button" className="btn btn--icon" aria-label={file.kind === "template" ? "Keep as a plain document" : "Keep as a template"} title={file.kind === "template" ? "Stop treating as a template" : "Keep as a template"} onClick={() => void toggleKind(file)}><ArrowLeftRight size={15} /></button> : null}
              {!compact ? <button type="button" className="btn btn--icon btn--danger" aria-label={`Delete ${file.name}`} onClick={() => void remove(file)}><Trash2 size={15} /></button> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {state.status === "ready" && !state.files.length && !uploads.length ? (
        <button type="button" className="fp-empty" onClick={() => input.current?.click()}>
          <Upload size={20} aria-hidden="true" />
          <strong>{empty?.title || "Drop a file here"}</strong>
          <small>{empty?.body || "Or click to choose one. Up to 25 MB."}</small>
        </button>
      ) : null}
    </div>
  );
}
