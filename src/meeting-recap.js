function clean(value, fallback = "") {
  return String(value ?? "").trim() || fallback;
}

function formatDate(value, language) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(language === "fa" ? "fa-IR" : "en", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC"
  }).format(date);
}

function formatDueDate(value, language) {
  if (!value) return "";
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return clean(value);
  return new Intl.DateTimeFormat(language === "fa" ? "fa-IR" : "en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  }).format(date);
}

function bulletList(items, emptyMessage) {
  const lines = items.map((item) => clean(item)).filter(Boolean);
  return lines.length ? lines.map((item) => `- ${item}`).join("\n") : emptyMessage;
}

function explicitActions(items, language) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => item && item.confidence !== "inferred" && clean(item.text))
    .map((item) => {
      const details = [];
      if (item.owner) details.push(language === "fa" ? `مسئول: ${clean(item.owner)}` : `Owner: ${clean(item.owner)}`);
      if (item.dueOn) details.push(language === "fa" ? `موعد: ${formatDueDate(item.dueOn, language)}` : `Due: ${formatDueDate(item.dueOn, language)}`);
      return `${clean(item.text)}${details.length ? ` — ${details.join(language === "fa" ? "، " : ", ")}` : ""}`;
    });
}

export function buildClientRecap(meeting = {}) {
  const language = meeting.detectedLanguage === "en" ? "en" : "fa";
  const title = clean(meeting.title, language === "fa" ? "جلسه بدون عنوان" : "Untitled meeting");
  const date = formatDate(meeting.createdAt, language);
  const summary = clean(
    meeting.summary,
    language === "fa" ? "خلاصه‌ای برای این جلسه ثبت نشده است." : "No summary was recorded for this meeting."
  );
  const decisions = Array.isArray(meeting.decisions) ? meeting.decisions : [];
  const openQuestions = Array.isArray(meeting.openQuestions) ? meeting.openQuestions : [];
  const actions = explicitActions(meeting.actionItems, language);

  if (language === "fa") {
    return [
      `جمع‌بندی جلسه\nموضوع: ${title}${date ? `\nتاریخ: ${date}` : ""}`,
      `خلاصه گفت‌وگو\n${summary}`,
      `تصمیم‌ها\n${bulletList(decisions, "تصمیمی به‌صورت صریح ثبت نشد.")}`,
      `گام‌های بعدی\n${bulletList(actions, "اقدام مشخصی به‌صورت صریح تعیین نشد.")}`,
      `موارد باز\n${bulletList(openQuestions, "مورد بازی ثبت نشد.")}`,
      "اگر نکته‌ای نیاز به اصلاح یا تکمیل دارد، لطفاً اطلاع دهید."
    ].join("\n\n");
  }

  return [
    `Meeting recap\nSubject: ${title}${date ? `\nDate: ${date}` : ""}`,
    `Summary\n${summary}`,
    `Decisions\n${bulletList(decisions, "No decision was explicitly recorded.")}`,
    `Next steps\n${bulletList(actions, "No specific next step was explicitly assigned.")}`,
    `Open items\n${bulletList(openQuestions, "No open item was recorded.")}`,
    "If anything needs correcting or adding, please let me know."
  ].join("\n\n");
}
