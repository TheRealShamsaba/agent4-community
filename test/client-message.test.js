import assert from "node:assert/strict";
import test from "node:test";
import { buildClientMessage } from "../hq/src/client-message.js";

const URL_ = "https://client.example/c/abc";

test("the message says what is next, what is waiting, and carries the link", () => {
  const message = buildClientMessage({
    lang: "en",
    contactName: "Dr. Ahmadi",
    url: URL_,
    values: { nextStep: "Show you the first working version", nextDate: "2026-10-12", need: [["Logo file", "Dr. Ahmadi", "2026-10-09"], ["Opening hours", "Reception", "next week"]] }
  });
  assert.equal(message, [
    `Hi Dr. Ahmadi, there's a new update on your project page: ${URL_}`,
    "Next step: Show you the first working version (Mon 12 Oct).",
    "Waiting on you: Logo file by Fri 9 Oct (and 1 more on the page)."
  ].join("\n"));
});

test("it greets by the first name saved, and never invents one", () => {
  assert.match(buildClientMessage({ contactName: "Sara Ahmadi", url: URL_ }), /^Hi Sara, there's a new update on your project page:/);
  assert.match(buildClientMessage({ contactName: "", url: URL_ }), /^Hi, there's a new update on your project page:/);
  assert.match(buildClientMessage({ contactName: "   ", url: URL_ }), /^Hi, /);
});

test("a title stays with the name after it, and a lone title is not mistaken for a name", () => {
  assert.match(buildClientMessage({ contactName: "Dr. Ahmadi", url: URL_ }), /^Hi Dr\. Ahmadi, /);
  assert.match(buildClientMessage({ contactName: "prof Lena Fischer", url: URL_ }), /^Hi prof Lena, /);
  assert.match(buildClientMessage({ contactName: "Dr.", url: URL_ }), /^Hi Dr\., /);
  assert.match(buildClientMessage({ lang: "fa", contactName: "دکتر احمدی", url: URL_ }), /^سلام دکتر احمدی، /);
  assert.match(buildClientMessage({ lang: "fa", contactName: "مهندس رضا کریمی", url: URL_ }), /^سلام مهندس رضا، /);
});

test("with nothing waiting on the client it does not ask for anything", () => {
  const message = buildClientMessage({ contactName: "Sara", url: URL_, values: { nextStep: "Review the design", nextDate: "2026-10-12", need: [] } });
  assert.equal(message.includes("Waiting on you"), false);
  assert.equal(message.split("\n").length, 2);
});

test("free-text deadlines are kept, and a missing date is not invented", () => {
  const message = buildClientMessage({ contactName: "Sara", url: URL_, values: { nextStep: "Review", need: [["Photos", "", "next week"]] } });
  assert.match(message, /Next step: Review\./);
  assert.match(message, /Waiting on you: Photos by next week\./);
});

test("the Persian message is Persian, with Jalali dates and Persian digits", () => {
  const message = buildClientMessage({
    lang: "fa",
    contactName: "سارا احمدی",
    url: URL_,
    values: { nextStep: "نمایش نسخهٔ اول", nextDate: "2026-10-12", need: [["فایل لوگو", "", "2026-10-09"], ["ساعت کاری", "", ""], ["عکس‌ها", "", ""]] }
  });
  const lines = message.split("\n");
  assert.equal(lines[0], `سلام سارا، گزارش تازه‌ای روی صفحهٔ پروژهٔ شما هست: ${URL_}`);
  assert.match(lines[1], /^قدم بعدی: نمایش نسخهٔ اول \(.*۲۰ مهر\)\.$/);
  assert.match(lines[2], /^منتظر شما: فایل لوگو تا .*۱۷ مهر \(و ۲ مورد دیگر در صفحه\)\.$/);
});

test("an incomplete update still produces a usable message", () => {
  assert.equal(buildClientMessage({ url: URL_ }), `Hi, there's a new update on your project page: ${URL_}`);
  assert.equal(buildClientMessage({ url: URL_, values: { need: "not a list", nextStep: 5 } }).includes("undefined"), false);
});
