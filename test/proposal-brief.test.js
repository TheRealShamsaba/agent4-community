import assert from "node:assert/strict";
import test from "node:test";
import { buildProposalBrief } from "../hq/src/proposal-brief.js";
import { SHEET_TEMPLATES } from "../hq/src/sheet-templates.js";

const template = SHEET_TEMPLATES[0];
const firstQuestion = template.sections.find((section) => section.kind === "questions").items[0];

const company = {
  name: "Sample Studio",
  url: "https://studio.example.com",
  summary: "Supplement holding.",
  howMet: "Introduced through a friend.",
  stage: "talking",
  dealValue: 8000,
  dealCurrency: "USD",
  contactName: "Sara",
  contactRole: "Marketing",
  contactEmail: "sara@sampleStudio.example",
  nextAction: "Send the proposal",
  nextActionOn: "2026-10-27",
  meetings: [
    { id: "m1", title: "Discovery", createdAt: "2026-09-15T10:00:00Z", summary: "They want a Persian site and a reminder app.", decisions: ["Start with the website"], actionItems: [{ text: "Send a quote" }], openQuestions: ["Who writes the copy?"] }
  ],
  sheets: [{ id: "s1", templateId: template.id, title: "Discovery", answers: { [firstQuestion.id]: "A bilingual brand site with a shop later." }, checks: {} }],
  timeline: [{ type: "note", detail: "Prefers Telegram over email.", at: "2026-10-01T09:00:00Z" }, { type: "stage", detail: "Lead → Talking", at: "2026-10-02T09:00:00Z" }],
  projects: [{ name: "Website", decisions: [{ text: "Launch in Aban", createdAt: "2026-10-03T09:00:00Z" }] }],
  tasks: [{ title: "Chase the logo files", status: "open", dueOn: "2026-10-26" }, { title: "Done thing", status: "done" }]
};

test("the brief gathers everything known about a client into one pasteable document", () => {
  const brief = buildProposalBrief(company, { showMoney: true, today: "2026-10-24" });
  assert.match(brief, /^# Proposal brief: Sample Studio/);
  for (const expected of [
    "https://studio.example.com", "Introduced through a friend.", "Relationship: Talking", "Estimated deal: $8,000",
    "Sara (Marketing)", "sara@sampleStudio.example", "Next step: Send the proposal (by 2026-10-27)",
    "Discovery · 2026-09-15", "They want a Persian site", "Start with the website", "Send a quote", "Who writes the copy?",
    "A bilingual brand site with a shop later.", "2026-10-01: Prefers Telegram over email.", "Launch in Aban",
    "Chase the logo files (due 2026-10-26)", "What I need"
  ]) assert.ok(brief.includes(expected), expected);
  assert.ok(!brief.includes("Done thing"), "finished work is left out");
  assert.ok(!brief.includes("Lead → Talking"), "stage bookkeeping is not a note");
});

test("the price stays out unless the owner is the one asking, and gaps are said out loud", () => {
  const quiet = buildProposalBrief({ name: "Bare Co", stage: "lead", dealValue: 5000, dealCurrency: "USD" }, { showMoney: false });
  assert.ok(!quiet.includes("5,000"));
  assert.match(quiet, /No contact recorded\./);
  assert.match(quiet, /No meetings recorded\./);
  assert.match(quiet, /No questionnaire answers recorded\./);
});
