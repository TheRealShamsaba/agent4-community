import React, { useEffect, useRef } from "react";
import {
  CircleAlert,
  Clapperboard,
  ListTodo,
  LogOut,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  ShieldCheck,
  TriangleAlert,
  X
} from "lucide-react";
import { Agent4Avatar } from "./Agent4Avatar.jsx";
import { placesForActor } from "../places.js";
import { relativeTime } from "../format.js";

/* The bar across the top of every place, the banner strip under it, and the
   room history panel it opens. */

const TIERS = [{ id: "room", label: "Rooms" }, { id: "tool", label: "Tools" }];

function PlaceTab({ entry, active, onPlace }) {
  const Icon = entry.icon;
  return (
    <button
      type="button"
      className={`place-nav__tab${active ? " is-active" : ""}`}
      aria-current={active ? "page" : undefined}
      onClick={() => onPlace(entry.id)}
      aria-label={entry.label}
      title={entry.hint ? `${entry.label} — ${entry.hint}` : entry.label}
    >
      <Icon size={15} aria-hidden="true" />
      {/* The short name is the label. "Home court", "Locker room", "Task board"
          and "Content plan" needed a 1978px window to sit side by side, and the
          second word was never the part that told you where you were going. The
          full name stays in the tooltip and the accessible name. */}
      <span className="place-nav__short">{entry.short}</span>
    </button>
  );
}

export function Header({
  actor,
  settings,
  authRequired,
  presence,
  place,
  quickAddOpen,
  snapshotAt,
  snapshotStale,
  onPlace,
  onToggleQuickAdd,
  onQuickAdd,
  onOpenPalette,
  onOpenAgent,
  onOpenTeam,
  onLogout,
  onRefreshSnapshot
}) {
  const mobileActionsRef = useRef(null);
  useEffect(() => { if (mobileActionsRef.current) mobileActionsRef.current.open = false; }, [place, quickAddOpen]);
  useEffect(() => {
    function closeOutside(event) {
      const menu = mobileActionsRef.current;
      if (menu?.open && !menu.contains(event.target)) menu.open = false;
    }
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);
  const places = placesForActor(actor, settings?.modules);
  return (
    <header className="room-header">
      <div className="brand-lockup">
        <Agent4Avatar /><span>Agent4</span>
        <i />
        <span className="brand-lockup__culture">{settings?.name || "YOUR WORKSPACE"}</span>
      </div>
      {/* Every section, not the four that used to fit. Four of them could only
          be reached by going Home and finding the right card, which left "where
          do I log an invoice" with no answer above the fold. The rooms come
          first, then the tools. Labels shorten, then drop to icons as the window
          narrows, and on a phone the whole nav moves to a bar under the thumb —
          nothing is ever put behind a "More" menu, because a section you cannot
          see is a section you do not know exists.

          Each tier carries its own count as a custom property, because the
          phone nav lays a tier out as a fixed grid: a tier that grew from four
          to five used to wrap onto a second row and push itself off the bar. */}
      <nav className="place-nav" aria-label="Sections">
        {TIERS.map((tier, index) => {
          /* The actor's places, not every place: a member must not be shown a
             tab they would be turned away from. The count a tier reports is
             therefore the count it actually renders. */
          const entries = places.filter((entry) => entry.tier === tier.id);
          if (!entries.length) return null;
          return (
            <React.Fragment key={tier.id}>
              {index ? <span className="place-nav__rule" aria-hidden="true" /> : null}
              <div className="place-nav__tier" role="group" aria-label={tier.label} style={{ "--tier-count": entries.length }}>
                {entries.map((entry) => (
                  <PlaceTab key={entry.id} entry={entry} active={place === entry.id} onPlace={onPlace} />
                ))}
              </div>
            </React.Fragment>
          );
        })}
      </nav>
      <div className="room-presence">
        <button type="button" className="header-agent" onClick={onOpenAgent} title="Talk to Agent4 (⌘J)">
          <Sparkles size={15} aria-hidden="true" />
          <span>Agent4</span>
        </button>
        <button type="button" className="header-search" onClick={onOpenPalette} title="Search everything (⌘K)">
          <Search size={15} aria-hidden="true" />
          <span>Search</span>
          <kbd>⌘K</kbd>
        </button>
        <div className="header-add-wrap">
          <button type="button" className="header-add" aria-expanded={quickAddOpen} onClick={onToggleQuickAdd}><Plus size={16} /> Add</button>
          {quickAddOpen ? (
            <div className="header-add-menu" role="menu">
              <span>Quick add</span>
              <button type="button" role="menuitem" onClick={() => onQuickAdd("task")}><ListTodo size={16} /><span><b>Task</b><small>Put work on your list</small></span></button>
              <button type="button" role="menuitem" onClick={() => onQuickAdd("meeting")}><Clapperboard size={16} /><span><b>Meeting notes</b><small>Record and review the tape</small></span></button>
            </div>
          ) : null}
        </div>
        {/* Everything that is not the work lives in one menu, at every width.
            The bar used to carry a save pill, a snapshot age, a history button,
            a team button and a sign-out button side by side; most of them said
            nothing on a normal day. A problem still surfaces itself below. */}
        {snapshotStale ? (
          <button type="button" className="snapshot-age is-stale" onClick={onRefreshSnapshot} title="Reload the page to pick up a newer HQ snapshot">
            <RefreshCw size={13} aria-hidden="true" />
            <span><span className="snapshot-age__label">Snapshot </span>{relativeTime(snapshotAt).replace(" ago", "")}</span>
          </button>
        ) : null}
        {presence.length > 1 ? <span className="presence-dots" aria-label={`${presence.length} teammates online`}>{presence.slice(0, 4).map((member) => <i key={member.id} title={member.id === actor.id ? "You are online" : `${member.name} is online`}>{member.name.slice(0, 1).toUpperCase()}</i>)}</span> : null}
        <details ref={mobileActionsRef} className="header-mobile-actions" onKeyDown={(event) => { if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}>
          <summary aria-label="Menu" title={actor.name}><MoreHorizontal size={20} /></summary>
          <div onClick={(event) => { if (event.target.closest("button")) event.currentTarget.closest("details").open = false; }}>
            <button type="button" aria-label="Refresh Agent4" onClick={onRefreshSnapshot}><RefreshCw size={16} /> Refresh HQ{snapshotAt ? <small>{relativeTime(snapshotAt)}</small> : null}</button>
            {authRequired ? <button type="button" aria-label={actor.role === "owner" ? "Team access" : "Account settings"} onClick={onOpenTeam}><ShieldCheck size={16} /> {actor.role === "owner" ? "Team access" : "Account settings"}</button> : null}
            {authRequired ? <button type="button" aria-label="Sign out" onClick={onLogout}><LogOut size={16} /> Sign out</button> : null}
          </div>
        </details>
      </div>
    </header>
  );
}

/* The two things that have to be said above every place, whichever one you are
   looking at: that the page is showing zeros because no snapshot was baked into
   it, and any warning that must not disappear on a six-second timer. */
export function ShellNotices({ isLive, warning, onDismissWarning }) {
  if (isLive && !warning) return null;
  return (
    <div className="shell-notices">
      {!isLive ? (
        <div className="shell-notice shell-notice--bad" role="alert">
          <TriangleAlert size={17} aria-hidden="true" />
          <p>
            <strong>No live snapshot is embedded in this page.</strong>
            Every count, brief and pipeline figure below reads zero because there is nothing here to read, not because the business is empty.
            Regenerate the HQ with <code>npm run hq</code>, then reload this page.
          </p>
        </div>
      ) : null}
      {warning ? (
        <div className="shell-notice shell-notice--warn" role="alert">
          <CircleAlert size={17} aria-hidden="true" />
          <p><strong>{warning.title}</strong>{warning.body}</p>
          <button type="button" onClick={onDismissWarning} aria-label="Dismiss this warning"><X size={15} /></button>
        </div>
      ) : null}
    </div>
  );
}
