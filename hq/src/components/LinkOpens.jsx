import React from "react";
import { formatDate, formatTime, localIsoDate, relativeTime } from "../format.js";

const DEVICE = { phone: "Phone", tablet: "Tablet", computer: "Computer" };

function when(iso) {
  const ms = Date.parse(iso || "");
  if (!Number.isFinite(ms)) return "";
  return `${formatDate(localIsoDate(new Date(ms)))} ${formatTime(iso)}`;
}

function times(count) {
  return count === 1 ? "once" : `${count.toLocaleString("en-US")} times`;
}

/**
 * Whether the client has opened their link, and every open since we began
 * keeping them. Opens from the network the owner uses HQ on are shown as "You"
 * and left out of the count, so "not opened yet" means the client has not.
 * The history is always on show, short as it may be: a card that only grows a
 * list after the next open looks exactly like one that tracks nothing.
 */
export function LinkOpens({ link, className = "" }) {
  const views = link.views || null;
  const count = link.viewCount || 0;
  const opens = views?.opens || [];
  const devices = views?.devices || 0;
  const logged = views?.logged || 0;
  const earlier = views ? Math.max(0, count - logged) : 0;
  const own = views?.ownOpens || 0;
  const rows = opens.length + (earlier ? 1 : 0);

  const headline = count
    ? `Opened ${times(count)}${devices > 1 ? ` on ${devices} devices` : ""}${link.lastViewedAt ? ` · last ${relativeTime(link.lastViewedAt)}` : ""}`
    : "They have not opened it yet";
  const notes = [
    count && !earlier && views?.firstViewedAt ? `First opened ${when(views.firstViewedAt)}` : "",
    own ? `You opened it ${times(own)} yourself, not counted` : ""
  ].filter(Boolean);

  // Before any open was kept in detail, only the count and the latest moment
  // were: so the latest earlier open has a time, and the rest only a number.
  const earlierWhen = logged ? `Before ${when(views.firstViewedAt)}` : link.lastViewedAt ? `Last ${when(link.lastViewedAt)}` : "Earlier";

  return (
    <div className={`lo ${count ? "is-opened" : "is-unopened"} ${className}`.trim()}>
      <p className="lo-headline"><span className="lo-dot" aria-hidden="true" />{headline}</p>
      {notes.length ? <p className="lo-notes">{notes.join(" · ")}</p> : null}
      {views ? (
        rows ? (
          <details className="lo-list" open={rows <= 4}>
            <summary>Every open ({(count + own).toLocaleString("en-US")})</summary>
            <ol>
              {opens.map((open, index) => (
                <li key={`${open.at}-${index}`} className={open.own ? "is-own" : ""}>
                  <time dateTime={open.at}>{when(open.at)}</time>
                  <span className="lo-who">{open.own ? "You" : devices > 1 && open.visitor ? `Device ${open.visitor}` : "Them"}</span>
                  <span className="lo-what">{[DEVICE[open.device] || "Device", open.os, open.browser].filter(Boolean).join(" · ")}</span>
                </li>
              ))}
              {earlier ? (
                <li className="is-earlier">
                  <time>{earlierWhen}</time>
                  <span className="lo-who">{earlier === 1 ? "1 open" : `${earlier.toLocaleString("en-US")} opens`}</span>
                  <span className="lo-what">From before HQ kept the device, so it is not known</span>
                </li>
              ) : null}
            </ol>
          </details>
        ) : <p className="lo-empty">When they open it, each open shows up here with the time and the device.</p>
      ) : null}
    </div>
  );
}
