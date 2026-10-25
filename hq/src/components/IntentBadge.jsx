import React from "react";

/**
 * Buyer-intent signal from public update evidence. The meaning used to live
 * only in a title= tooltip with a ●/○ glyph as the only other signal, which on
 * a touch screen means it never appeared at all — so the badge says what it
 * means in words and the glyph is decoration. "unclear" renders nothing rather
 * than noise.
 */
export function IntentBadge({ intent, compact = false }) {
  if (intent === "active") {
    return (
      <span className="badge badge--good">
        <span aria-hidden="true">●</span> Active site{compact ? "" : " — updated recently"}
      </span>
    );
  }
  if (intent === "dormant") {
    return (
      <span className="badge badge--muted">
        <span aria-hidden="true">○</span> Dormant{compact ? "" : " — no public update in a long time"}
      </span>
    );
  }
  return null;
}
