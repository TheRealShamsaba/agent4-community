import assert from "node:assert/strict";
import test from "node:test";
import { PAPERWORK_TEMPLATES } from "../hq/src/paperwork-templates.js";

test("an answer set inside a sentence never doubles the full stop the template adds", () => {
  const kickoff = PAPERWORK_TEMPLATES.find((template) => template.id === "kickoff");
  for (const lang of ["en", "fa"]) {
    for (const [given, shown] of [["About 40 calls a day.", "About 40 calls a day"], ["In the shared folder", "In the shared folder"], ["Really?!", "Really"], ["", "—"], ["  ", "—"]]) {
      const text = kickoff.render({ beforeState: given }, lang, {}).map((block) => block.text || "").join("\n");
      assert.equal(text.includes(".."), false, `${lang}: "${given}" does not end in two full stops`);
      assert.ok(text.includes(`${shown}.`), `${lang}: "${given}" reads as "${shown}."`);
    }
  }
});

test("every template still lays out an empty draft without throwing", () => {
  for (const template of PAPERWORK_TEMPLATES) {
    for (const lang of ["en", "fa"]) {
      assert.ok(Array.isArray(template.render({}, lang, { profile: {}, companyName: "", document: {} })), `${template.id} in ${lang}`);
    }
  }
});

test("the printed update lists the pieces with their state in words", () => {
  const update = PAPERWORK_TEMPLATES.find((template) => template.id === "update");
  const blocks = update.render({ weekOf: "2026-10-11", pieces: [["Booking", "done"], ["About", "half"], ["", "done"]] }, "en", {});
  const table = blocks.find((block) => block.kind === "table" && block.columns[0] === "Piece");
  assert.deepEqual(table.rows, [["Booking", "Done"], ["About", "Half way"]]);
  const persian = update.render({ weekOf: "2026-10-11", pieces: [["رزرو", "waiting"]] }, "fa", {}).find((block) => block.kind === "table" && block.columns[0] === "تکه");
  assert.deepEqual(persian.rows, [["رزرو", "منتظر شما"]]);
});

test("a proposal opens on a cover with what changes for them, then the brief, the reasons, the plan and the price", () => {
  const proposal = PAPERWORK_TEMPLATES.find((template) => template.id === "proposal");
  const values = {
    outcome: "Patients book themselves, and the phone goes quiet",
    summary: "Almost every booking comes in by phone.",
    facts: [["~40", "bookings a week"], ["", "no number, no tile"]],
    shift: [["Patients call to book", "Patients book on their phone"]],
    goalFigure: "50%",
    goal: "Half of all bookings online in three months.",
    solutions: [["Online booking", "Two taps to a time", "Most calls are bookings", "First version"], ["Treatment pages", "One page each", "Fewer wrong slots", "First version"]],
    phases: [["First version", "Booking on a link", "2026-10-22"]],
    prerequisites: [["Logo", "Dr. Weber", "2026-10-05"]],
    price: "4800",
    currency: "EUR",
    milestones: [["On signing", "40%", "1920"], ["First version", "30%", "1440"], ["Launch", "30%", "1440"]],
    validUntil: "2026-10-09"
  };
  const blocks = proposal.render(values, "en", { companyName: "Sample Studio", profile: { name: "Your company" } });
  assert.equal(blocks[0].kind, "cover");
  assert.equal(blocks[0].title, values.outcome, "the headline is what changes, not the word Proposal");
  assert.equal(blocks[0].kicker, "For Sample Studio");
  assert.deepEqual(blocks.filter((block) => block.kind === "eyebrow").map((block) => block.text), ["THE BRIEF", "WHAT WE'LL DO, AND WHY", "THE PLAN", "INVESTMENT"]);
  assert.deepEqual(blocks.find((block) => block.kind === "facts").items, [{ figure: "~40", text: "bookings a week" }]);
  assert.match(blocks.find((block) => block.kind === "heading" && /reason/.test(block.text)).text, /^Two things, each for a reason\.$/);
  assert.deepEqual(blocks.find((block) => block.kind === "solutions").items[0], { title: "Online booking", what: "Two taps to a time", why: "Most calls are bookings", lands: "First version" });
  assert.deepEqual(blocks.find((block) => block.kind === "paybar").items.map((item) => item.share), [40, 30, 30]);
  assert.equal(JSON.stringify(blocks).includes("WhatsApp"), false, "accepting is signing, not a reply");
  assert.ok(blocks.some((block) => block.kind === "signature"));

  const persian = proposal.render({ ...values, milestones: [["با امضا", "۴۰٪", "1920"], ["راه‌اندازی", "۶۰٪", "2880"]] }, "fa", { companyName: "کلینیک احمدی" });
  assert.equal(persian[0].kicker, "برای کلینیک احمدی");
  assert.ok(persian.some((block) => block.kind === "eyebrow" && block.text === "چه می‌کنیم، و چرا"));
  assert.deepEqual(persian.find((block) => block.kind === "paybar").items.map((item) => item.share), [40, 60], "Persian digits are read as numbers");
  assert.equal(proposal.render({}, "en", {})[0].kind, "cover", "an empty draft still lays out");
});
