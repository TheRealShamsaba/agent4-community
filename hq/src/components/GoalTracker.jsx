import React from "react";

const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

function statusLabel(day) {
  if (day.status === "moved") return "moved the target";
  if (day.status === "stalled") return "mostly noise";
  if (day.status === "missed") return "not checked";
  if (day.status === "today") return "waiting for today's answer";
  return "ahead";
}

export function GoalTracker({ tracker, onCheckIn, busy = false, error = "", valext = "home" }) {
  if (!tracker?.target) return null;
  const answered = tracker.todayCheckin?.movedTarget;
  const scoreLine = tracker.elapsedDays
    ? `${tracker.movedDays}/${tracker.elapsedDays} days moved`
    : "Week starts next";
  return (
    <div className={`target-tracker is-${valext}`} aria-label={`Weekly target score: ${scoreLine}`}>
      <div className="target-tracker-head"><span><b>{tracker.movedDays}</b> target {tracker.movedDays === 1 ? "day" : "days"}</span><em>{scoreLine}</em></div>
      <div className="target-tracker-days" aria-label="Monday through Sunday target progress">
        {(tracker.days || []).map((day, index) => (
          <span className={`is-${day.status}`} key={day.day} title={`${day.day}: ${statusLabel(day)}`}>
            <small>{DAY_LABELS[index]}</small><i />
          </span>
        ))}
      </div>
      {tracker.canCheckIn && onCheckIn ? (
        <div className="target-tracker-actions">
          <span>{tracker.todayCheckin ? "TODAY RECORDED" : "DID TODAY MOVE IT?"}</span>
          <span>
            <button type="button" className={answered === true ? "is-selected is-yes" : ""} aria-pressed={answered === true} onClick={() => onCheckIn(true)} disabled={busy}>Moved it</button>
            <button type="button" className={answered === false ? "is-selected is-no" : ""} aria-pressed={answered === false} onClick={() => onCheckIn(false)} disabled={busy}>Mostly noise</button>
          </span>
        </div>
      ) : <p className="target-tracker-note">This target starts {new Date(`${tracker.weekStart}T12:00:00`).toLocaleDateString(undefined, { weekday: "long" })}.</p>}
      {error ? <p className="target-tracker-error" role="alert">{error}</p> : null}
    </div>
  );
}
