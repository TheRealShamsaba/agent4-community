/*
 * Text that a stranger types ends up in front of the owner, in Telegram, and
 * pasted into proposals and chats. Some characters are invisible, so they can
 * carry words nobody can see: Unicode "tag" characters are the well-known case,
 * and they are exactly how hidden instructions are slipped to a language model
 * that is later given the text.
 *
 * These are removed. The zero-width non-joiner and joiner, and the left-to-right
 * and right-to-left marks, are NOT: Persian and Arabic need them to be spelled
 * and punctuated correctly.
 */

// Built from code points at run time rather than written out, so no invisible
// character ever has to sit in this file.
const HIDDEN = new RegExp(
  `[\\u00AD\\u200B\\u2060-\\u2064\\uFEFF${String.fromCodePoint(0xe0000)}-${String.fromCodePoint(0xe007f)}${String.fromCodePoint(0xe0100)}-${String.fromCodePoint(0xe01ef)}]`,
  "gu"
);

export function stripHiddenCharacters(value) {
  return String(value).replace(HIDDEN, "");
}
