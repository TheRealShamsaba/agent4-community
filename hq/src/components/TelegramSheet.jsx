import React, { useEffect, useRef } from "react";
import { X } from "lucide-react";

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/* One sheet shell for the whole mini-app. The capture sheet used to declare
   role="dialog" aria-modal="true" and then let Escape through, leave focus in
   the page behind it, and let that page scroll under your thumb — a modal in
   name only. Everything that behaves like a sheet goes through here instead. */
export function TelegramSheet({ label, kicker, title, onClose, children }) {
  const sheetRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previousFocus = document.activeElement;
    const scroller = document.querySelector(".tg-app");
    const previousOverflow = scroller?.style.overflow || "";
    const previousBodyOverflow = document.body.style.overflow || "";
    const previousTop = scroller?.scrollTop || 0;
    if (scroller) scroller.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    sheetRef.current?.querySelector(FOCUSABLE)?.focus();

    function keydown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !sheetRef.current) return;
      const focusable = [...sheetRef.current.querySelectorAll(FOCUSABLE)];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && (document.activeElement === first || !sheetRef.current.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      document.body.style.overflow = previousBodyOverflow;
      if (scroller) {
        scroller.style.overflow = previousOverflow;
        scroller.scrollTop = previousTop;
      }
      if (previousFocus?.isConnected && typeof previousFocus.focus === "function") previousFocus.focus();
    };
  }, []);

  return (
    <div className="tg-sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="tg-sheet" role="dialog" aria-modal="true" aria-label={label} ref={sheetRef}>
        <header>
          <div><small>{kicker}</small><strong>{title}</strong></div>
          <button type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        {children}
      </section>
    </div>
  );
}
