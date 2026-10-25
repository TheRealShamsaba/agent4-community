import React, { useEffect, useMemo, useRef, useState } from "react";
import { CornerDownLeft, LoaderCircle, Search } from "lucide-react";

/* One box that reaches everything. Without it the only fast paths in the HQ
   were the Locker Room's single-letter tools and the header Add menu, so
   finding a company, a project, a meeting or a task always meant navigating to
   a place and reading down a list. Everything here is keyboard-complete: the
   palette is meant to be opened, typed into and dismissed without the mouse
   ever moving. */

const GROUP_ORDER = ["Go to", "Companies", "Projects", "Tasks", "Meetings"];

function matches(item, query) {
  if (!query) return true;
  const haystack = `${item.label} ${item.hint || ""} ${item.keywords || ""}`.toLocaleLowerCase();
  return query.split(/\s+/).filter(Boolean).every((word) => haystack.includes(word));
}

export function CommandPalette({ open, items = [], loading = false, onSelect, onClose }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const results = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const hits = items.filter((item) => matches(item, needle));
    /* Grouped, but ranked as one flat list so the arrow keys walk the results in
       the order they are drawn. */
    hits.sort((left, right) => {
      const byGroup = GROUP_ORDER.indexOf(left.group) - GROUP_ORDER.indexOf(right.group);
      return byGroup || left.label.localeCompare(right.label);
    });
    return hits.slice(0, 60);
  }, [items, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => { setActive(0); }, [query]);

  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector("[data-active='true']");
    node?.scrollIntoView({ block: "nearest" });
  }, [active, open, results]);

  if (!open) return null;

  function keydown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "ArrowDown" || (event.key === "n" && event.ctrlKey)) {
      event.preventDefault();
      setActive((current) => (results.length ? (current + 1) % results.length : 0));
      return;
    }
    if (event.key === "ArrowUp" || (event.key === "p" && event.ctrlKey)) {
      event.preventDefault();
      setActive((current) => (results.length ? (current - 1 + results.length) % results.length : 0));
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setActive(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setActive(Math.max(0, results.length - 1));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const chosen = results[active];
      if (chosen) onSelect(chosen);
    }
  }

  let lastGroup = "";
  return (
    <div className="palette-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search Agent4 HQ" onKeyDown={keydown}>
        <div className="palette__search">
          <Search size={17} aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search places, companies, projects, tasks and meetings"
            aria-label="Search Agent4 HQ"
            aria-controls="palette-results"
            autoComplete="off"
            spellCheck="false"
          />
          {loading ? <LoaderCircle className="is-spinning" size={15} aria-label="Still loading results" /> : null}
        </div>
        <ul className="palette__results" id="palette-results" ref={listRef} role="listbox" aria-label="Results">
          {results.map((item, index) => {
            const heading = item.group !== lastGroup ? item.group : "";
            lastGroup = item.group;
            return (
              <React.Fragment key={item.id}>
                {heading ? <li className="palette__group" role="presentation">{heading}</li> : null}
                <li role="option" aria-selected={index === active}>
                  <button
                    type="button"
                    data-active={index === active}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => onSelect(item)}
                  >
                    <span className="palette__label" dir="auto">{item.label}</span>
                    {item.hint ? <small dir="auto">{item.hint}</small> : null}
                    {index === active ? <CornerDownLeft size={14} aria-hidden="true" /> : null}
                  </button>
                </li>
              </React.Fragment>
            );
          })}
          {!results.length ? (
            <li className="palette__empty" role="presentation">
              {loading ? "Still reading your companies, tasks and meetings…" : `Nothing matches “${query.trim()}”.`}
            </li>
          ) : null}
        </ul>
        <footer className="palette__foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>esc</kbd> close</span>
        </footer>
      </div>
    </div>
  );
}
