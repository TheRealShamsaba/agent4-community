/* The same one-obvious-step-per-stage the company page offers when you move a
   stage. The server image ships src/ only, so it is restated here. */
const STAGE_PROMPTS = {
  lead: { action: "Make first contact", days: 2 },
  talking: { action: "Book the discovery meeting", days: 5 },
  proposal: { action: "Follow up on the proposal", days: 3 },
  active: { action: "Confirm the current milestone with them", days: 7 },
  operating: { action: "Send this month's update", days: 30 },
  dormant: { action: "Check back in", days: 60 }
};

/* Answers that need no model at all. A small model on a shared server is slow
   and shaky, and "what should I do today" is a sorting problem, not a language
   one. These come back instantly, and they come back the same way every time.
   Anything else falls through to the model. */

const OPEN_STAGES = new Set(["lead", "talking", "proposal"]);
const QUIET_AFTER_DAYS = 14;
const DAY = 86_400_000;

function addDays(day, days) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

function dayLabel(day, today) {
  const diff = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  if (diff < 0) return `${-diff} days late`;
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

function bullets(lines) {
  return lines.map((line) => `• ${line}`).join("\n");
}

function needsFollowUp(company) {
  if (!OPEN_STAGES.has(company.stage)) return false;
  return !company.nextStep || (company.daysSinceTouch != null && company.daysSinceTouch >= QUIET_AFTER_DAYS);
}

function followUpAction(company, today) {
  const prompt = STAGE_PROMPTS[company.stage] || STAGE_PROMPTS.lead;
  return {
    type: "set_next_step",
    companyId: company.id,
    title: null,
    text: prompt.action,
    dueOn: addDays(today, Math.max(1, prompt.days || 2)),
    stage: null,
    dealValue: null,
    dealCurrency: null,
    reason: company.nextStep ? `Quiet for ${company.daysSinceTouch} days.` : "Nothing is written down for what happens next."
  };
}

function todayAnswer(context) {
  const { today } = context;
  const mine = context.openTasks.filter((task) => task.mine);
  const late = mine.filter((task) => task.due && task.due < today);
  const dueToday = mine.filter((task) => task.due === today);
  const meetings = context.calendarNext7Days.filter((event) => event.on === today);
  const waiting = context.companies.filter((company) => company.nextStep && company.nextStepDue && company.nextStepDue <= today);
  const quiet = context.companies.filter(needsFollowUp);
  const lines = [];
  if (late.length) lines.push(`Late: ${late.slice(0, 4).map((task) => `${task.title}${task.company ? ` (${task.company})` : ""}`).join("; ")}`);
  if (dueToday.length) lines.push(`Due today: ${dueToday.slice(0, 4).map((task) => task.title).join("; ")}`);
  if (meetings.length) lines.push(`On your calendar: ${meetings.map((event) => `${event.at ? `${event.at} ` : ""}${event.title}`).join("; ")}`);
  if (waiting.length) lines.push(`Clients waiting on a step: ${waiting.slice(0, 4).map((company) => `${company.name} (${company.nextStep})`).join("; ")}`);
  if (quiet.length) lines.push(`Gone quiet or no next step: ${quiet.slice(0, 4).map((company) => company.name).join(", ")}`);
  if (!lines.length) {
    const doing = mine.filter((task) => task.status === "doing");
    return { reply: doing.length ? `Nothing is due. Keep going on ${doing[0].title}.` : "Nothing is late or due today. Pick the client closest to paying and move them one step.", actions: [] };
  }
  const first = late[0] || dueToday[0] || null;
  const opener = first ? `Start with “${first.title}”.` : waiting[0] ? `Start with ${waiting[0].name}.` : "Here is where you stand.";
  return { reply: `${opener}\n\n${bullets(lines)}`, actions: quiet.slice(0, 3).map((company) => followUpAction(company, today)) };
}

function quietAnswer(context) {
  const { today } = context;
  const quiet = context.companies
    .filter(needsFollowUp)
    .sort((left, right) => (right.daysSinceTouch ?? 999) - (left.daysSinceTouch ?? 999));
  if (!quiet.length) {
    const open = context.companies.filter((company) => OPEN_STAGES.has(company.stage)).length;
    return { reply: open
      ? `Nobody has gone quiet. All ${open} open ${open === 1 ? "client has" : "clients have"} a next step and a recent touch.`
      : "You have no leads, talking clients or proposals open right now, so nobody can have gone quiet. Add one on the Clients page, or look at the radar leads.", actions: [] };
  }
  const lines = quiet.slice(0, 6).map((company) => `${company.name} · ${company.stage}${company.daysSinceTouch != null ? ` · ${company.daysSinceTouch} days since the last touch` : ""}${company.nextStep ? "" : " · no next step"}${company.deal ? ` · ${company.deal}` : ""}`);
  return { reply: `${quiet.length} open ${quiet.length === 1 ? "client needs" : "clients need"} you:\n\n${bullets(lines)}\n\nI can set a next step for each.`, actions: quiet.slice(0, 5).map((company) => followUpAction(company, today)) };
}

function moneyAnswer(context) {
  const { today } = context;
  const priced = context.companies.filter((company) => company.deal);
  const proposals = context.companies.filter((company) => company.stage === "proposal");
  const unpriced = context.companies.filter((company) => OPEN_STAGES.has(company.stage) && !company.deal);
  const lines = [];
  for (const company of proposals.slice(0, 4)) lines.push(`${company.name} has a proposal out${company.deal ? ` (${company.deal})` : ""}. ${company.nextStep ? `Next: ${company.nextStep}.` : "Nobody has written the follow-up."}`);
  const talking = context.companies.filter((company) => company.stage === "talking").slice(0, 3);
  for (const company of talking) lines.push(`${company.name} is talking to you${company.deal ? ` (${company.deal})` : ""}. Move them to a proposal.`);
  if (unpriced.length) lines.push(`${unpriced.length} open ${unpriced.length === 1 ? "deal has" : "deals have"} no value yet: ${unpriced.slice(0, 4).map((company) => company.name).join(", ")}. Put a number on each so the pipeline total means something.`);
  if (!lines.length) return { reply: priced.length ? "Nothing is waiting on a decision right now. Your next move is to start a conversation, so look at the radar leads on the Clients page." : "There are no open deals yet. Add a client and put a value on it, and I can tell you where the money is.", actions: [] };
  const actions = proposals.filter((company) => !company.nextStep).slice(0, 3).map((company) => ({
    type: "set_next_step", companyId: company.id, title: null, text: "Follow up on the proposal", dueOn: addDays(today, 2), stage: null, dealValue: null, dealCurrency: null, reason: "A proposal with no follow-up is the likeliest deal to die."
  }));
  return { reply: `Closest to money first:\n\n${bullets(lines)}`, actions };
}

function weekAnswer(context) {
  const { today } = context;
  const days = Array.from({ length: 7 }, (_, index) => addDays(today, index));
  const lines = [];
  for (const day of days) {
    const events = context.calendarNext7Days.filter((event) => event.on === day);
    const tasks = context.openTasks.filter((task) => task.mine && task.due === day);
    const bits = [...events.map((event) => `${event.at ? `${event.at} ` : ""}${event.title}`), ...tasks.map((task) => `task: ${task.title}`)];
    if (bits.length) lines.push(`${dayLabel(day, today)[0].toUpperCase()}${dayLabel(day, today).slice(1)}: ${bits.slice(0, 4).join("; ")}`);
  }
  const late = context.openTasks.filter((task) => task.mine && task.due && task.due < today);
  if (late.length) lines.unshift(`Late: ${late.slice(0, 4).map((task) => task.title).join("; ")}`);
  const chase = context.companies.filter(needsFollowUp);
  if (chase.length) lines.push(`Chase: ${chase.slice(0, 4).map((company) => company.name).join(", ")}`);
  if (!lines.length) return { reply: "Your week is empty. Choose one client to move forward and book a time for it.", actions: [] };
  return { reply: `Your week:\n\n${bullets(lines)}`, actions: chase.slice(0, 3).map((company) => followUpAction(company, today)) };
}

function sitesAnswer(context) {
  const sites = context.sites || [];
  if (!sites.length) return null;
  const problems = [];
  for (const site of sites) {
    if (site.status === "down") problems.push(`${site.name} is DOWN.`);
    if (site.sslDays != null && site.sslDays <= 14) problems.push(`${site.name}: the certificate ${site.sslDays <= 0 ? "has expired" : `expires in ${site.sslDays} days`}.`);
    if (site.uptime30 != null && site.uptime30 < 99 && site.status !== "down") problems.push(`${site.name}: ${site.uptime30}% uptime over 30 days.`);
    if (site.errors7 > 0) problems.push(`${site.name}: ${site.errors7} browser ${site.errors7 === 1 ? "error" : "errors"} this week.`);
    if (site.seo != null && site.seo < 70) problems.push(`${site.name}: SEO score ${site.seo}/100.`);
  }
  const traffic = sites.filter((site) => site.visitors7 != null).map((site) => `${site.name} ${site.visitors7}`);
  const head = problems.length ? `${problems.length} thing${problems.length === 1 ? "" : "s"} to look at:` : `All ${sites.length} ${sites.length === 1 ? "site is" : "sites are"} healthy.`;
  return { reply: [head, problems.length ? `\n${bullets(problems.slice(0, 8))}` : "", traffic.length ? `\nVisitors this week: ${traffic.join(" · ")}.` : ""].join("").trim(), actions: [] };
}

const RULES = [
  { test: /\b(problems?|issues?|trouble|wrong) with (?:my |the )?(?:sites?|websites?)\b|\b(?:my )?(?:sites?|websites?) (?:down|status|health|ok|okay|alright)\b|\bis .{1,40} (?:down|up)\b\??$|\buptime\b|\bvisitors\b|\btraffic\b|\bmonitor/i, answer: sitesAnswer },
  { test: /\b(gone quiet|go(?:ne)? silent|quiet on|forgot(?:ten)?|neglect|haven'?t (?:talked|spoken|heard)|follow[- ]?ups?|who (?:should i|do i) (?:chase|follow))\b/i, answer: quietAnswer },
  { test: /\b(plan (?:my |the )?week|my week|week ahead)\b/i, answer: weekAnswer },
  { test: /\b(money|revenue|earn|cash|close (?:a )?deal|deals?|pipeline|get paid|make me)\b/i, answer: moneyAnswer },
  { test: /\b(what (?:should|do) i (?:do|work)|today|next move|focus|priorit|where (?:do|should) i start)\b/i, answer: todayAnswer }
];

/** The built-in answer for a message, or null when only a model can help. */
export function quickAnswer({ message, context }) {
  const text = String(message || "").replace(/\(The owner is looking at[^)]*\)\s*/i, "");
  if (text.length > 120) return null;
  for (const rule of RULES) {
    if (!rule.test.test(text)) continue;
    const answer = rule.answer(context);
    if (answer) return answer;
  }
  return null;
}
