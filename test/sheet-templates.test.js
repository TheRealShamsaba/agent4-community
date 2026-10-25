import assert from "node:assert/strict";
import test from "node:test";
import { SHEET_TEMPLATES, sheetProgress, sheetTemplate, sheetText } from "../hq/src/sheet-templates.js";

test("every sheet template has unique item ids and both languages", () => {
  for (const template of SHEET_TEMPLATES) {
    assert.match(template.id, /^[a-z0-9][a-z0-9-]+$/);
    assert.ok(sheetText(template.name, "fa") && sheetText(template.name, "en"));
    const seen = new Set();
    for (const section of template.sections) {
      assert.ok(["questions", "checklist"].includes(section.kind), `${template.id}/${section.id} has a known kind`);
      assert.ok(sheetText(section.title, "fa") && sheetText(section.title, "en"), `${section.id} is bilingual`);
      for (const item of section.items) {
        assert.ok(!seen.has(item.id), `${template.id} reuses item id ${item.id}`);
        seen.add(item.id);
        assert.match(item.id, /^[\p{L}\p{N}_.:-]{1,80}$/u, "ids are storable keys");
        assert.ok(sheetText(item.text, "fa") && sheetText(item.text, "en"), `${item.id} is bilingual`);
        if (section.kind === "questions") assert.ok(sheetText(item.why, "fa") && sheetText(item.why, "en"), `${item.id} explains why`);
      }
    }
  }
});

test("sheet progress counts answers, must-haves and checks per section", () => {
  const template = sheetTemplate("website-discovery");
  const empty = sheetProgress(template, { answers: {}, checks: {} });
  assert.ok(empty.questions > 40);
  assert.ok(empty.must > 15 && empty.must < empty.questions);
  assert.equal(empty.answered, 0);

  const partial = sheetProgress(template, { answers: { c1: "Sana", c3: "  ", g1: "More sites" }, checks: { p1: true, x2: true } });
  assert.equal(partial.answered, 2, "whitespace is not an answer");
  assert.equal(partial.mustAnswered, 1);
  assert.equal(partial.checked, 2);
  assert.deepEqual(partial.sections.company, { total: 7, done: 1 });
  assert.deepEqual(partial.sections.prep, { total: 6, done: 1 });
  assert.equal(sheetProgress(null, {}).questions, 0);
});
