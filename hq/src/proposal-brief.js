import { SHEET_TEMPLATES, sheetText } from "./sheet-templates.js";
import { STAGE_LABELS } from "./workspace-model.js";
import { formatDealExact } from "./deals.js";

/* Everything known about one client, written out as plain text for you to hand
   to Claude (or anyone) along with your own proposal template. Agent4 does not
   try to write the proposal; it makes sure whoever does has the whole picture. */

function day(value) {
  return String(value || "").slice(0, 10);
}

function list(items, empty = "None recorded.") {
  const clean = items.filter(Boolean);
  return clean.length ? clean.map((item) => `- ${item}`).join("\n") : empty;
}

function sheetBlock(sheet, lang) {
  const template = SHEET_TEMPLATES.find((candidate) => candidate.id === sheet.templateId);
  if (!template) return "";
  const L = (value) => sheetText(value, lang);
  const lines = [`### ${sheet.title}`];
  for (const section of template.sections || []) {
    const rows = [];
    for (const item of section.items || []) {
      if (section.kind === "checklist") {
        if (sheet.checks?.[item.id]) rows.push(`- [x] ${L(item.text)}`);
        continue;
      }
      const answer = String(sheet.answers?.[item.id] || "").trim();
      if (answer) rows.push(`- ${L(item.text)}\n  ${answer.replace(/\n/g, "\n  ")}`);
    }
    if (rows.length) lines.push(`**${L(section.title)}**`, ...rows);
  }
  return lines.length > 1 ? lines.join("\n") : "";
}

/**
 * @param company  a company from the workspace model
 * @param options  { lang, showMoney, today }
 */
export function buildProposalBrief(company, { lang = "en", showMoney = false, today = new Date().toISOString().slice(0, 10) } = {}) {
  const out = [];
  out.push(`# Proposal brief: ${company.name}`);
  out.push(`Prepared ${today} from my own notes, meetings and questionnaires. Use it, with my proposal template, to write a proposal for ${company.name}. Say what is missing instead of guessing.`);

  out.push("## Who they are");
  out.push(list([
    company.url || company.website ? `Website: ${company.url || company.website}` : "",
    company.summary ? `About: ${company.summary}` : "",
    company.howMet ? `How we met: ${company.howMet}` : "",
    `Relationship: ${STAGE_LABELS[company.stage] || company.stage || "Lead"}`,
    showMoney && company.dealValue ? `Estimated deal: ${formatDealExact(company.dealValue, company.dealCurrency)}` : ""
  ]));

  const contact = [company.contactName, company.contactRole && `(${company.contactRole})`].filter(Boolean).join(" ");
  out.push("## Who I talk to");
  out.push(list([contact, company.contactEmail && `Email: ${company.contactEmail}`, company.contactPhone && `Phone: ${company.contactPhone}`, company.contactTelegram && `Telegram: ${company.contactTelegram}`], "No contact recorded."));

  if (company.nextAction) out.push("## Where we are", `Next step: ${company.nextAction}${company.nextActionOn ? ` (by ${company.nextActionOn})` : ""}`);

  const meetings = [...(company.meetings || [])].sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  out.push("## Meetings");
  if (!meetings.length) out.push("No meetings recorded.");
  for (const meeting of meetings.slice(0, 6)) {
    const block = [`### ${meeting.title || "Meeting"} · ${day(meeting.createdAt)}${meeting.projectName ? ` · ${meeting.projectName}` : ""}`];
    if (meeting.summary) block.push(meeting.summary);
    if (meeting.decisions?.length) block.push("Decisions:", list(meeting.decisions));
    if (meeting.actionItems?.length) block.push("Action items:", list(meeting.actionItems.map((item) => item.text)));
    if (meeting.openQuestions?.length) block.push("Open questions:", list(meeting.openQuestions));
    out.push(block.join("\n"));
  }

  const answered = (company.sheets || []).map((sheet) => sheetBlock(sheet, lang)).filter(Boolean);
  out.push("## What they told me (questionnaires)");
  out.push(answered.length ? answered.join("\n\n") : "No questionnaire answers recorded.");

  const notes = (company.timeline || []).filter((item) => item.type === "note" || item.type === "decision").map((item) => `${day(item.at)}: ${item.detail}`);
  const decisions = (company.projects || []).flatMap((project) => (project.decisions || []).map((decision) => `${day(decision.createdAt)}: ${decision.text} (${project.name})`));
  out.push("## My notes and decisions");
  out.push(list([...notes, ...decisions]));

  const openTasks = (company.tasks || []).filter((task) => task.status !== "done").map((task) => `${task.title}${task.dueOn ? ` (due ${task.dueOn})` : ""}`);
  if (openTasks.length) out.push("## Open work", list(openTasks));

  out.push("## What I need", "A proposal I can send to the client: the problem in their words, what I will do and in what phases, what is out of scope, the timeline, the price and payment milestones, and the next step. Match the structure of my attached template.");
  return out.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}
