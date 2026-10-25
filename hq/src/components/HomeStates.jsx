import React from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";

/* A failed load must never look like a calm empty day.
   Every section on Home Court that fetches renders one of these three things
   and nothing else: real data, a skeleton while it is on its way, or this —
   which says what could not be read and offers the retry the user would
   otherwise have to find by reloading the whole page. */
export function LoadError({ title, detail = "", onRetry, tone = "block" }) {
  return (
    <div className={`errorstate home-errorstate is-${tone}`} role="alert">
      <strong><TriangleAlert size={15} /> {title}</strong>
      {detail ? <p>{detail}</p> : null}
      {onRetry ? (
        <button type="button" className="btn btn--danger" onClick={onRetry}>
          <RotateCcw size={13} /> Try again
        </button>
      ) : null}
    </div>
  );
}

/* Placeholder rows, sized like the real ones, so a slow network reads as
   "still loading" rather than "nothing here". */
export function SkeletonRows({ rows = 3, height = 44, label = "Loading" }) {
  return (
    <div className="home-skeleton-rows" aria-label={label} aria-busy="true">
      {Array.from({ length: rows }, (_, index) => (
        <span className="skeleton" key={index} style={{ height: `${height}px` }} />
      ))}
    </div>
  );
}
