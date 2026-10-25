/* The message that carries a client page to the client, ready to paste into
   WhatsApp. It is the first thing the client reads about the update, so it is
   short, says what the update asks of them, and carries the link.

   It is written in the update's own language, and addresses the person by the
   first name saved against the company, never by a guess. */

const GREETING = {
  en: (name) => (name ? `Hi ${name},` : "Hi,"),
  fa: (name) => (name ? `سلام ${name}،` : "سلام،")
};

function calendarDay(value, lang) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(lang === "fa" ? "fa-IR-u-ca-persian" : "en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(date);
}

/* "Dr. Ahmadi" is greeted as "Dr. Ahmadi", not as "Dr.": a leading title stays
   with the name after it. Anyone else is greeted by their first name. */
const TITLES = new Set(["dr", "mr", "mrs", "ms", "prof", "eng", "دکتر", "مهندس", "استاد", "آقای", "خانم"]);

function firstName(value) {
  const words = String(value || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  const isTitle = TITLES.has(words[0].replace(/\.$/, "").toLowerCase());
  return isTitle && words[1] ? `${words[0]} ${words[1]}` : words[0];
}

/**
 * @param {object} input
 * @param {"en"|"fa"} input.lang      the update's language
 * @param {string} input.contactName  who it is for, as saved on the company
 * @param {string} input.url          the client page address
 * @param {object} input.values       the weekly update's answers
 */
export function buildClientMessage({ lang = "en", contactName = "", url = "", values = {} }) {
  const language = lang === "fa" ? "fa" : "en";
  const L = (en, fa) => (language === "fa" ? fa : en);
  const lines = [`${GREETING[language](firstName(contactName))} ${L("there's a new update on your project page:", "گزارش تازه‌ای روی صفحهٔ پروژهٔ شما هست:")} ${url}`.trim()];

  const nextStep = String(values.nextStep || "").trim();
  const nextDay = calendarDay(values.nextDate, language);
  if (nextStep) lines.push(`${L("Next step:", "قدم بعدی:")} ${nextStep}${nextDay ? ` (${nextDay})` : ""}.`);

  const needs = (Array.isArray(values.need) ? values.need : []).filter((row) => Array.isArray(row) && String(row[0] || "").trim());
  if (needs.length) {
    const [what, , by] = needs[0];
    const when = calendarDay(by, language) || String(by || "").trim();
    const extra = needs.length - 1;
    const more = extra > 0 ? L(` (and ${extra} more on the page)`, ` (و ${extra.toLocaleString("fa-IR")} مورد دیگر در صفحه)`) : "";
    lines.push(`${L("Waiting on you:", "منتظر شما:")} ${String(what).trim()}${when ? ` ${L("by", "تا")} ${when}` : ""}${more}.`);
  }
  return lines.join("\n");
}

/**
 * The first message: the page itself, what it is for, and that it needs no
 * account. Sent once, when the page is made.
 */
export function buildWelcomeMessage({ lang = "en", contactName = "", url = "" }) {
  const language = lang === "fa" ? "fa" : "en";
  const L = (en, fa) => (language === "fa" ? fa : en);
  return [
    `${GREETING[language](firstName(contactName))} ${L("this is your private project page:", "این صفحهٔ خصوصی پروژهٔ شماست:")} ${url}`.trim(),
    L(
      "You'll see where the work stands, what's next, and anything we need from you. We keep it up to date as we go. No account or password needed; just keep the link to yourself.",
      "اینجا می‌بینید کار به کجا رسیده، قدم بعدی چیست و چه چیزی از شما لازم داریم. همین‌طور که جلو می‌رویم به‌روزش می‌کنیم. حساب کاربری و رمز لازم نیست؛ فقط لینک را پیش خودتان نگه دارید."
    )
  ].join("\n");
}
