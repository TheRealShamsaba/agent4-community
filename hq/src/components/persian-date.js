/* The Persian calendar, for the two places an Iranian date is actually read or
   written. It is deliberately not in format.js: the rest of HQ speaks one date
   language so that a ledger row and a due date can be compared at a glance, and
   Jalali belongs only where a Persian reader is the audience — the Persian
   invoice, and the entry form, where the date the owner has in front of him is
   often the one on an Iranian receipt.

   The conversion is the standard Birashk/Borkowski arithmetic used by
   jalaali-js. Intl can render a Jalali date but cannot parse one, and typing a
   Gregorian date from an Iranian invoice by hand is exactly where the day slips
   by one. */

const MONTHS = [
  "\u0641\u0631\u0648\u0631\u062f\u06cc\u0646", "\u0627\u0631\u062f\u06cc\u0628\u0647\u0634\u062a", "\u062e\u0631\u062f\u0627\u062f", "\u062a\u06cc\u0631", "\u0645\u0631\u062f\u0627\u062f", "\u0634\u0647\u0631\u06cc\u0648\u0631",
  "\u0645\u0647\u0631", "\u0622\u0628\u0627\u0646", "\u0622\u0630\u0631", "\u062f\u06cc", "\u0628\u0647\u0645\u0646", "\u0627\u0633\u0641\u0646\u062f"
];

const PERSIAN_DIGITS = "\u06f0\u06f1\u06f2\u06f3\u06f4\u06f5\u06f6\u06f7\u06f8\u06f9";
const ARABIC_DIGITS = "\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669";

const BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];

/* Integer division that truncates toward zero, not toward minus infinity. The
   arithmetic below relies on it: with floor, a January date lands a year early. */
function div(left, right) { return Math.trunc(left / right); }
function mod(left, right) { return left - Math.trunc(left / right) * right; }

/* The leap rule and the Gregorian day Farvardin 1 lands on, for one Jalali year. */
function jalaliCalendar(year) {
  if (year < BREAKS[0] || year >= BREAKS[BREAKS.length - 1]) return null;
  const gregorianYear = year + 621;
  let leapJalali = -14;
  let previous = BREAKS[0];
  let jump = 0;
  for (let index = 1; index < BREAKS.length; index += 1) {
    const current = BREAKS[index];
    jump = current - previous;
    if (year < current) break;
    leapJalali += div(jump, 33) * 8 + div(mod(jump, 33), 4);
    previous = current;
  }
  let since = year - previous;
  leapJalali += div(since, 33) * 8 + div(mod(since, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - since === 4) leapJalali += 1;
  const leapGregorian = div(gregorianYear, 4) - div((div(gregorianYear, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJalali - leapGregorian;
  if (jump - since < 6) since = since - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(since + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gregorianYear, march };
}

function gregorianToDayNumber(year, month, day) {
  let number = div((year + div(month - 8, 6) + 100100) * 1461, 4)
    + div(153 * mod(month + 9, 12) + 2, 5)
    + day - 34840408;
  number -= div(div(year + 100100 + div(month - 8, 6), 100) * 3, 4) - 752;
  return number;
}

function dayNumberToGregorian(number) {
  let shifted = 4 * number + 139361631;
  shifted += div(div(4 * number + 183187720, 146097) * 3, 4) * 4 - 3908;
  const inner = div(mod(shifted, 1461), 4) * 5 + 308;
  return {
    year: div(shifted, 1461) - 100100 + div(8 - (mod(div(inner, 153), 12) + 1), 6),
    month: mod(div(inner, 153), 12) + 1,
    day: div(mod(inner, 153), 5) + 1
  };
}

function pad(value) {
  return String(value).padStart(2, "0");
}

/** Latin digits, whatever numerals were typed. Iranian keyboards produce three sets. */
export function latinDigits(value) {
  let text = String(value ?? "");
  for (let digit = 0; digit < 10; digit += 1) {
    text = text.split(PERSIAN_DIGITS[digit]).join(String(digit)).split(ARABIC_DIGITS[digit]).join(String(digit));
  }
  return text;
}

export function persianDigits(value) {
  return String(value ?? "").replace(/[0-9]/g, (digit) => PERSIAN_DIGITS[Number(digit)]);
}

/** A yyyy-mm-dd Gregorian date as { year, month, day } in the Persian calendar. */
export function toJalali(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || "").trim());
  if (!match) return null;
  const dayNumber = gregorianToDayNumber(Number(match[1]), Number(match[2]), Number(match[3]));
  const gregorian = dayNumberToGregorian(dayNumber);
  let year = gregorian.year - 621;
  const calendar = jalaliCalendar(year);
  if (!calendar) return null;
  const firstDay = gregorianToDayNumber(calendar.gregorianYear, 3, calendar.march);
  let offset = dayNumber - firstDay;
  if (offset >= 0) {
    if (offset <= 185) return { year, month: 1 + div(offset, 31), day: mod(offset, 31) + 1 };
    offset -= 186;
  } else {
    // Before Farvardin 1: the day belongs to the year before, and whether that
    // year ran long is read from the calendar we already have, not from a fresh
    // one for the earlier year.
    offset += 179 + (calendar.leap === 1 ? 1 : 0);
    year -= 1;
  }
  return { year, month: 7 + div(offset, 30), day: mod(offset, 30) + 1 };
}

/** A Persian date back to yyyy-mm-dd, or "" if it is not a real day. */
export function fromJalali(year, month, day) {
  const calendar = jalaliCalendar(Number(year));
  if (!calendar) return "";
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  if (!(monthNumber >= 1 && monthNumber <= 12) || !(dayNumber >= 1 && dayNumber <= 31)) return "";
  const absolute = gregorianToDayNumber(calendar.gregorianYear, 3, calendar.march)
    + (monthNumber - 1) * 31 - div(monthNumber, 7) * (monthNumber - 7) + dayNumber - 1;
  const gregorian = dayNumberToGregorian(absolute);
  const iso = `${gregorian.year}-${pad(gregorian.month)}-${pad(gregorian.day)}`;
  // A day past the end of the month rolls forward silently, which would record
  // the wrong date rather than refusing it, so the round trip is checked.
  const back = toJalali(iso);
  if (!back || back.year !== Number(year) || back.month !== monthNumber || back.day !== dayNumber) return "";
  return iso;
}

/** "24 Shahrivar 1405" in Persian words and numerals, for reading. */
export function jalaliLabel(iso) {
  const parts = toJalali(iso);
  if (!parts) return "";
  return `${persianDigits(parts.day)} ${MONTHS[parts.month - 1]} ${persianDigits(parts.year)}`;
}

/** The editable form of a Persian date: 1405/06/24. */
export function jalaliInputValue(iso) {
  const parts = toJalali(iso);
  if (!parts) return "";
  return `${parts.year}/${pad(parts.month)}/${pad(parts.day)}`;
}

/** Whatever the owner typed — 1405/6/24, 1405-06-24, Persian numerals — as ISO. */
export function parseJalaliInput(value) {
  const match = /^(\d{3,4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/.exec(latinDigits(value).trim());
  if (!match) return "";
  return fromJalali(Number(match[1]), Number(match[2]), Number(match[3]));
}
