import React, { useEffect, useRef } from "react";
import { Check, CheckCircle2, CircleAlert, Clock3, LoaderCircle, RotateCcw, TriangleAlert, X } from "lucide-react";

/* The states Film Room shows when it is not showing a meeting: a toast, a
   confirmation, a failed list, and the long wait while the server reads a
   recording. They live here because FilmRoom.jsx is long enough already, and
   nothing else imports them. */

function clock(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  return `${String(minutes).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/* One toast, two meanings. Before this, "Client recap saved." and the message
   from a delete that failed were the same green tick, so a failure read as a
   success. The tone decides the icon, the colour and the politeness level:
   a success fades, an error waits to be dismissed and announces itself. */
export function FilmNotice({ notice, onDismiss }) {
  useEffect(() => {
    if (!notice || notice.tone === "error") return undefined;
    const timer = window.setTimeout(() => onDismiss?.(), 6000);
    return () => window.clearTimeout(timer);
  }, [notice, onDismiss]);

  if (!notice) return null;
  const isError = notice.tone === "error";
  return (
    <div className={`film-notice is-${isError ? "error" : "ok"}`} role={isError ? "alert" : "status"}>
      {isError ? <TriangleAlert size={16} /> : <CheckCircle2 size={16} />}
      <p dir="auto">{notice.text}</p>
      <button type="button" className="film-notice-close" onClick={() => onDismiss?.()} aria-label="Dismiss this message"><X size={15} /></button>
    </div>
  );
}

/* window.confirm cannot say which meeting it is about, cannot be styled, and on
   a phone arrives as a system sheet with the app's own wording stripped out.
   This one names the meeting and says what is actually deleted. */
export function ConfirmDialog({ open, title, body, detail = "", confirmLabel = "Delete", tone = "danger", busy = false, onConfirm, onCancel }) {
  const cancelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    cancelRef.current?.focus();
    const onKeyDown = (event) => { if (event.key === "Escape") onCancel?.(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;
  return (
    <div className="film-confirm" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) onCancel?.(); }}>
      <div className="film-confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="film-confirm-title">
        <strong id="film-confirm-title" dir="auto">{title}</strong>
        <p dir="auto">{body}</p>
        {detail ? <small>{detail}</small> : null}
        <footer>
          <button type="button" className="btn btn--quiet btn--lg" ref={cancelRef} onClick={() => onCancel?.()}>Keep it</button>
          <button type="button" className={`btn btn--lg ${tone === "danger" ? "btn--danger" : "btn--gold"}`} disabled={busy} onClick={() => onConfirm?.()}>
            {busy ? <LoaderCircle className="is-spinning" size={15} /> : null} {confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}

/* A list that could not be read is not an empty list. It says so, and it offers
   the retry that otherwise costs a full page reload. */
export function ListFailure({ detail, onRetry, busy = false }) {
  return (
    <div className="errorstate film-list-failure" role="alert">
      <strong><TriangleAlert size={15} /> Your meetings could not be loaded.</strong>
      {detail ? <p dir="auto">{detail}</p> : null}
      <button type="button" className="btn btn--danger" disabled={busy} onClick={() => onRetry?.()}>
        {busy ? <LoaderCircle className="is-spinning" size={13} /> : <RotateCcw size={13} />} Try again
      </button>
    </div>
  );
}

/* Whisper gives up after thirty minutes. A local debrief can then wait through
   six and a half minutes of capacity retries and run for twelve minutes. */
const TRANSCRIPTION_CEILING_SECONDS = 30 * 60;
const DEBRIEF_CEILING_SECONDS = (12 * 60) + 390;
const STALLED_AFTER_SECONDS = TRANSCRIPTION_CEILING_SECONDS + DEBRIEF_CEILING_SECONDS;

/* The old version showed a spinner, three dots and one sentence for as long as
   it took: minute one and minute twenty looked identical, and a recording that
   would never finish looked exactly like one that was nearly done. The server
   writes updated_at once when processing starts and once when it ends, so the
   honest unit here is elapsed time against what the server itself will tolerate
   — not an invented percentage. */
export function ProcessingPanel({ meeting, nowMs, onRefresh, onDelete }) {
  const startedMs = Date.parse(meeting.updatedAt || meeting.createdAt || "") || nowMs;
  const elapsedSeconds = Math.max(0, Math.round((nowMs - startedMs) / 1000));
  const expectedSeconds = Math.min(TRANSCRIPTION_CEILING_SECONDS, Math.max(300, Math.round((meeting.durationSeconds || 0) * 1.5)));
  const wordsReady = Boolean(meeting.transcript);
  const slow = elapsedSeconds > expectedSeconds;
  const stalled = elapsedSeconds > STALLED_AFTER_SECONDS;

  if (meeting.status === "uploading") {
    const parts = Math.max(1, meeting.totalParts || 1);
    return (
      <div className="film-progress is-paused">
        <span className="film-progress-mark"><Clock3 size={26} /></span>
        <small>UPLOAD PAUSED</small>
        <h2>This recording is waiting for the rest.</h2>
        <p>{meeting.uploadParts} of {parts} parts reached the server. Open the saved upload on the device that recorded it and tap Resume upload; nothing is transcribed until every part arrives.</p>
        <div className="film-progress-bar" role="progressbar" aria-valuenow={meeting.uploadParts} aria-valuemin={0} aria-valuemax={parts} aria-label="Upload progress">
          <b style={{ width: `${Math.round((meeting.uploadParts / parts) * 100)}%` }} />
        </div>
        <div className="film-progress-tools">
          <button type="button" className="btn btn--quiet btn--lg" onClick={() => onRefresh?.()}><RotateCcw size={14} /> Check again</button>
          {onDelete ? <button type="button" className="btn btn--danger btn--lg" onClick={() => onDelete?.()}>Delete this meeting</button> : null}
        </div>
      </div>
    );
  }

  return (
    <div className={`film-progress${stalled ? " is-stalled" : slow ? " is-slow" : ""}`}>
      <span className="film-progress-mark">{stalled ? <CircleAlert size={26} /> : <LoaderCircle className="is-spinning" size={26} />}</span>
      <small>{wordsReady ? "TRANSCRIPT SAFE · BUILDING NOTES" : "AGENT4 IS WATCHING THE TAPE"} · {clock(elapsedSeconds)}</small>
      <h2>{stalled ? "This one has been running too long." : wordsReady ? "The words are ready. Building the notes…" : "Listening for what matters…"}</h2>
      <ol className="film-progress-steps">
        <li className="is-done">
          <span><Check size={13} /></span>
          <span><strong>Audio received</strong><small>All {Math.max(1, meeting.totalParts || 1)} parts are on the server. The raw file is deleted as soon as the notes exist.</small></span>
        </li>
        <li className={stalled ? "is-stalled" : wordsReady ? "is-done" : "is-active"}>
          <span>{stalled ? <CircleAlert size={13} /> : wordsReady ? <Check size={13} /> : <LoaderCircle className="is-spinning" size={13} />}</span>
          <span>
            <strong>{wordsReady ? "Transcript saved; debrief in progress" : "Transcribing the recording"}</strong>
            <small>{wordsReady ? "The private audio was deleted. If the notes fail, you can retry them from the saved transcript." : `Running for ${clock(elapsedSeconds)}. This is elapsed time, not an invented percentage.`}</small>
          </span>
        </li>
      </ol>
      <p>{!wordsReady && meeting.durationSeconds ? `A ${clock(meeting.durationSeconds)} recording usually lands inside ${clock(expectedSeconds)}. ` : ""}You can leave Film Room and come back — this keeps running on the server.</p>
      {wordsReady ? <details className="film-transcript"><summary><CheckCircle2 size={16} /><span><strong>Read the transcript now</strong><small>Available while the notes are built</small></span></summary><p dir="auto">{meeting.transcript}</p></details> : null}
      {slow && !stalled ? (
        <div className="film-progress-slow" role="status">
          <TriangleAlert size={15} />
          <span>
            <strong>This is taking longer than expected.</strong>
            <small>{wordsReady ? "The transcript is saved. If the notes fail, you can retry them without the recording." : "The audio is also saved in this browser until the notes are ready, so a failed transcription can be uploaded again from this device."}</small>
          </span>
        </div>
      ) : null}
      {stalled ? (
        <div className="film-progress-slow is-stalled" role="alert">
          <CircleAlert size={15} />
          <span>
            <strong>Past every server limit.</strong>
            <small>Check again. If Film Room reports a failure, use the saved transcript or the browser copy to retry; keep the meeting record until you have the notes.</small>
          </span>
        </div>
      ) : null}
      <div className="film-progress-tools">
        <button type="button" className="btn btn--quiet btn--lg" onClick={() => onRefresh?.()}><RotateCcw size={14} /> Check again</button>
        {onDelete ? <button type="button" className="btn btn--danger btn--lg" onClick={() => onDelete?.()}>Delete this meeting</button> : null}
      </div>
    </div>
  );
}
