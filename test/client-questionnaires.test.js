import { fetch } from "./helpers/http.js";
import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { URLSearchParams } from "node:url";
import { createClientLinkStore } from "../src/client-link-store.js";
import { cleanAnswer, createClientQuestionnaireStore, progressOf, QUESTIONNAIRE_LIMITS } from "../src/client-questionnaire-store.js";
import { renderClientPage, renderQuestionnairePage } from "../src/client-page.js";
import { createHqServer } from "../src/hq-server.js";
import { createInquiryLimiter } from "../src/public-inquiry.js";
import { answersAsText } from "../hq/src/client-answers.js";
import { parseInquiry } from "../src/public-inquiry.js";
import { QUESTIONNAIRE_TEMPLATES, snapshotTemplate, templateSummaries } from "../src/questionnaire-templates.js";
import { createWorkspaceStore } from "../src/workspace-store.js";

const CLIENT_HOST = "client.test";
const FORM = "application/x-www-form-urlencoded";

async function startHq({ authRequired = false, clientSaveLimiter, clientFormBodyTimeoutMs, now } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "agent4-questions-"));
  await mkdir(path.join(root, "data"));
  await writeFile(path.join(root, "data", "hq.html"), "<h1>Agent4 HQ PRIVATE</h1>");
  const databasePath = path.join(root, "data", "rooms.sqlite");
  const workspaceStore = createWorkspaceStore(databasePath);
  const linkStore = createClientLinkStore(databasePath, { workspace: workspaceStore });
  const questionnaireStore = createClientQuestionnaireStore(databasePath);
  const messages = [];
  const config = {
    company: { name: "Your company", positioning: "x" },
    runtime: {
      root,
      roomDatabasePath: databasePath,
      clientPagesEnabled: true,
      clientPagesHosts: [CLIENT_HOST],
      clientPagesUrl: "https://client.example",
      clientWhatsapp: "",
      clientEmail: "owner@example.com",
      ...(authRequired
        ? { agent4AuthRequired: true, agent4SecureCookies: false, agent4BootstrapEmail: "owner@example.com", agent4BootstrapName: "Owner", agent4BootstrapPassword: "a-long-owner-password" }
        : {})
    }
  };
  const company = workspaceStore.createCompany({ name: "Ahmadi Clinic", kind: "client", stage: "active", contactName: "Dr. Ahmadi", actorId: "owner" });
  const other = workspaceStore.createCompany({ name: "Someone Else", kind: "client", stage: "active", actorId: "owner" });
  const mine = linkStore.createLink({ companyId: company.id, label: "Dr. Ahmadi", language: "en", actorId: "owner" });
  const second = linkStore.createLink({ companyId: company.id, label: "Reception", language: "en", actorId: "owner" });
  const strangers = linkStore.createLink({ companyId: other.id, label: "Other", language: "en", actorId: "owner" });

  const server = createHqServer(config, {
    workspaceStore,
    clientLinkStore: linkStore,
    clientQuestionnaireStore: questionnaireStore,
    clientSaveLimiter,
    clientFormBodyTimeoutMs,
    now,
    notifyInquiry: async (message) => { messages.push(message); }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  function asClient(pathname, { method = "GET", headers = {}, body = null, host = CLIENT_HOST } = {}) {
    return new Promise((resolve, reject) => {
      const payload = body === null ? null : Buffer.from(body);
      const request = http.request({
        hostname: "127.0.0.1", port, path: pathname, method,
        headers: { host, ...(payload ? { "content-type": FORM, "content-length": payload.length } : {}), ...headers }
      }, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, text: Buffer.concat(chunks).toString("utf8") }));
      });
      request.on("error", reject);
      if (payload) request.write(payload);
      request.end();
    });
  }
  const owner = (pathname, options = {}) => fetch(`${base}${pathname}`, {
    ...options,
    headers: { ...(options.body ? { "content-type": "application/json" } : {}), origin: base, ...(options.headers || {}) }
  });
  const send = async (link, templateId = "getting-started", extra = {}) => {
    const response = await owner(`/api/client-links/${link.id}/questionnaires`, { method: "POST", body: JSON.stringify({ templateId, ...extra }) });
    return { response, body: await response.json() };
  };
  const formPath = (link, questionnaire) => `/c/${link.token}/q/${questionnaire.id}`;
  const post = (link, questionnaire, fields, headers = {}) => asClient(formPath(link, questionnaire), {
    method: "POST",
    headers,
    body: new URLSearchParams(fields).toString()
  });
  const settle = async (count = 1) => { for (let attempt = 0; attempt < 40 && messages.length < count; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5)); };

  return {
    base, port, asClient, owner, send, post, formPath, settle, messages, company, other, mine, second, strangers,
    workspaceStore, linkStore, questionnaireStore,
    async stop() {
      await new Promise((resolve) => server.close(resolve));
      await rm(root, { recursive: true, force: true });
    }
  };
}

/* ------------------------------------------------------------ the content --- */

test("every question exists in English and in Persian, with nothing out of place", () => {
  assert.deepEqual(QUESTIONNAIRE_TEMPLATES.map((template) => template.id), ["getting-started", "website", "product", "tool"]);
  const persian = /[؀-ۿ]/;
  for (const template of QUESTIONNAIRE_TEMPLATES) {
    const ids = new Set();
    for (const language of ["en", "fa"]) {
      const snapshot = snapshotTemplate(template.id, language);
      assert.ok(snapshot.title && snapshot.intro, `${template.id} ${language} has a title and an introduction`);
      assert.equal(persian.test(snapshot.title), language === "fa", `${template.id} title is in ${language}`);
      for (const section of snapshot.sections) {
        assert.ok(section.title, `${template.id} section has a title`);
        assert.ok(section.questions.length, `${template.id}/${section.id} has questions`);
        for (const question of section.questions) {
          assert.ok(question.text, `${template.id}/${question.id} ${language} has its words`);
          assert.equal(persian.test(question.text), language === "fa", `${template.id}/${question.id} text is in ${language}`);
          if (question.hint) assert.equal(persian.test(question.hint), language === "fa", `${template.id}/${question.id} hint is in ${language}`);
          assert.equal(/[\u202A-\u202E\u2066-\u2069\u0000-\u0008]/.test(question.text + question.hint), false, "no hidden direction overrides or control characters");
          if (language === "en") {
            assert.equal(ids.has(question.id), false, `${template.id}: question id ${question.id} is unique`);
            ids.add(question.id);
          }
        }
      }
    }
    const snapshot = snapshotTemplate(template.id, "en");
    assert.ok(snapshot.sections.flatMap((section) => section.questions).some((question) => question.must), `${template.id} says what is needed to start`);
  }
  assert.equal(snapshotTemplate("nope", "en"), null);
  assert.deepEqual(templateSummaries().map((summary) => [summary.id, summary.questions]), [["getting-started", 12], ["website", 9], ["product", 7], ["tool", 6]]);
});

test("Persian is written with its joiners, so no verb prefix is left standing alone", () => {
  for (const question of QUESTIONNAIRE_TEMPLATES.flatMap((template) => template.sections.flatMap((section) => section.questions))) {
    for (const value of [question.text.fa, question.hint?.fa || ""]) {
      assert.equal(/(?:^|[\s«(])(?:نمی|می) [؀-ۿ]/.test(value), false, `"${value.slice(0, 40)}" has an unjoined می`);
    }
  }
});

/* -------------------------------------------------------------- the store --- */

test("a questionnaire keeps a frozen copy of its questions, and only real answers, cleaned and capped", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agent4-qstore-"));
  let clock = new Date("2026-10-07T10:00:00Z");
  const store = createClientQuestionnaireStore(path.join(root, "q.sqlite"), { now: () => clock });
  try {
    const created = store.create({ linkId: "l1", companyId: "c1", templateId: "getting-started", language: "fa", actorId: "owner" });
    assert.equal(created.status, "open");
    assert.equal(created.language, "fa");
    assert.match(created.title, /[؀-ۿ]/);
    assert.equal(created.progress.total, 12);
    assert.equal(created.progress.needed, 5);
    assert.throws(() => store.create({ linkId: "l1", companyId: "c1", templateId: "getting-started", language: "en", actorId: "owner" }), /already with them/);
    assert.throws(() => store.create({ linkId: "l1", companyId: "c1", templateId: "nope", actorId: "owner" }), /does not exist/);
    assert.ok(store.create({ linkId: "l1", companyId: "c1", templateId: "website", actorId: "owner" }), "a different set to the same link is fine");
    assert.ok(store.create({ linkId: "l2", companyId: "c1", templateId: "getting-started", actorId: "owner" }), "and the same set to another person");

    const long = "x".repeat(QUESTIONNAIRE_LIMITS.answer + 500);
    const saved = store.saveAnswers(created.id, { answers: { company: "  Ahmadi Clinic \r\n\r\n\r\n\r\nDental ", contact: long, success: "\u202Etricky\u0007", "made-up": "ignored", __proto__: "ignored", trigger: "" } });
    assert.equal(saved.changed, true);
    assert.equal(saved.questionnaire.answers.company, "  Ahmadi Clinic\n\nDental", "what was typed is kept as typed, only trailing space and runs of blank lines go");
    assert.equal(saved.questionnaire.answers.contact.length, QUESTIONNAIRE_LIMITS.answer);
    assert.equal(saved.questionnaire.answers.success, "tricky", "direction overrides and control characters are removed");
    assert.equal("made-up" in saved.questionnaire.answers, false, "an answer to a question that is not there is not kept");
    assert.equal("trigger" in saved.questionnaire.answers, false);
    assert.equal(saved.questionnaire.progress.answered, 3);
    assert.equal(saved.questionnaire.progress.neededAnswered, 3, "company, contact and success are all needed to start");
    assert.equal(saved.questionnaire.status, "open", "saving is not sending");

    clock = new Date("2026-10-07T11:00:00Z");
    store.saveAnswers(created.id, { answers: { company: "" } });
    assert.equal(store.get(created.id).progress.answered, 2, "clearing an answer removes it");
    const sent = store.saveAnswers(created.id, { answers: {}, submit: true });
    assert.equal(sent.questionnaire.status, "submitted");
    assert.equal(sent.questionnaire.submittedAt, "2026-10-07T11:00:00.000Z");
    assert.equal(sent.changed, false);

    assert.equal(store.getForLink("l1", created.id).id, created.id);
    assert.equal(store.getForLink("l2", created.id), null, "another person's link cannot reach it");
    assert.equal(store.listForLink("l1").length, 2);
    assert.equal(Object.hasOwn(store.summary(store.get(created.id)), "answers"), false, "a list never carries the answers");
    assert.equal(Object.hasOwn(store.summary(store.get(created.id)), "content"), false);

    store.setStatus(created.id, "closed");
    assert.throws(() => store.saveAnswers(created.id, { answers: { company: "late" } }), /closed/);
    assert.equal(store.setStatus(created.id, "open").status, "submitted", "reopening goes back to sent if it had been sent");
    store.setStatus(created.id, "closed");
    assert.ok(store.create({ linkId: "l1", companyId: "c1", templateId: "getting-started", language: "en", actorId: "owner" }), "once closed, the same set can be sent again");

    assert.equal(store.removeCompany("c1") >= 3, true);
    assert.equal(store.get(created.id), null);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("cleaning an answer only ever returns plain text of a bounded size", () => {
  assert.equal(cleanAnswer(undefined), "");
  assert.equal(cleanAnswer(42), "");
  assert.equal(cleanAnswer({ toString: () => "x" }), "");
  assert.equal(cleanAnswer("سلام\u200Cدنیا"), "سلام\u200Cدنیا", "the Persian joiner is part of the language");
  const emoji = cleanAnswer(`${"x".repeat(QUESTIONNAIRE_LIMITS.answer - 1)}😀`);
  const last = emoji.charCodeAt(emoji.length - 1);
  assert.equal(last >= 0xd800 && last <= 0xdbff, false, "a cut never leaves half an emoji");
  assert.deepEqual(progressOf({ sections: [{ questions: [{ id: "a", must: true }, { id: "b" }] }] }, { a: " ", b: "yes" }), { total: 2, answered: 1, needed: 1, neededAnswered: 0 });
});

/* --------------------------------------------------------------- the page --- */

function sample(overrides = {}) {
  return {
    id: "q-123456789", linkId: "l1", companyId: "c1", templateId: "getting-started", language: "en", title: "Getting started",
    status: "open", answers: {}, createdAt: "2026-10-07T10:00:00Z",
    content: { intro: "Write what you can.", sections: [{ id: "s", title: "People", questions: [{ id: "company", text: "What is it called?", hint: "One sentence.", must: true }, { id: "contact", text: "Who do we talk to?", hint: "", must: false }] }] },
    progress: { total: 2, answered: 0, needed: 1, neededAnswered: 0 },
    ...overrides
  };
}

test("what a client types comes back as text, and the form loads nothing from anywhere else", () => {
  const evil = `</textarea><script>alert(1)</script><img src=x onerror=alert(2)>"'&`;
  const html = renderQuestionnairePage({
    questionnaire: sample({ title: evil, answers: { company: evil }, content: { intro: evil, sections: [{ id: "s", title: evil, questions: [{ id: "company", text: evil, hint: evil, must: true }] }] } }),
    company: { name: evil }, base: "/c/TOKEN", contact: { whatsapp: "" }, step: 1
  });
  assert.equal(html.includes("<script"), false);
  assert.equal(html.includes("<img src=x"), false, "client text cannot inject an image");
  const imageSources = [...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(imageSources)].sort(), ["/assets/company-wordmark-light.svg", "/assets/company-wordmark.svg"], "only the fixed first-party brand lockups render as images");
  assert.equal(html.split("</textarea>").length, 2, "exactly one real closing tag: the typed one cannot end the box early");
  assert.match(html, /<form class="qform" method="post" action="\/c\/TOKEN\/q\/q-123456789"/);
  const urls = [...html.matchAll(/(?:href|src|action)="([^"]+)"|url\("([^"]+)"\)/g)].map((match) => match[1] || match[2]);
  for (const url of urls) assert.ok(url.startsWith("/") || url.startsWith("https://wa.me/") || url.startsWith("mailto:"), `unexpected address: ${url}`);
  assert.match(html, /Needed to start/);
});

test("a sent form says so, a closed one is read-only, and Persian is right to left", () => {
  const sent = renderQuestionnairePage({ questionnaire: sample({ status: "submitted" }), company: { name: "Acme" }, base: "/c/T", notice: "sent" });
  assert.match(sent, /Sent\. Thank you\./);
  const again = renderQuestionnairePage({ questionnaire: sample({ status: "submitted" }), company: { name: "Acme" }, base: "/c/T", step: "check" });
  assert.match(again, /Send again/, "the last step offers to send again once it has been sent");

  const closed = renderQuestionnairePage({ questionnaire: sample({ status: "closed", answers: { company: "Ahmadi Clinic" } }), company: { name: "Acme" }, base: "/c/T" });
  assert.equal(closed.includes("<form"), false, "nothing to submit");
  assert.equal(closed.includes("<textarea"), false);
  assert.match(closed, /Ahmadi Clinic/);
  assert.match(closed, /Not answered/);
  assert.match(closed, /This questionnaire is closed/);

  const persianOf = (step) => renderQuestionnairePage({ questionnaire: sample({ language: "fa", title: "شروع کار", content: { intro: "هر چه می\u200Cتوانید بنویسید.", sections: [{ id: "s", title: "آدم\u200Cها", questions: [{ id: "company", text: "نام شرکت شما چیست؟", hint: "", must: true }] }] }, progress: { total: 1, answered: 0, needed: 1, neededAnswered: 0 } }), company: { name: "کلینیک" }, base: "/c/T", step });
  const persian = persianOf(1);
  assert.match(persian, /<html lang="fa" dir="rtl">/);
  assert.match(persianOf("check"), /ارسال برای ما/);
  assert.match(persian, /لازم برای شروع/);
  assert.match(persian, /[۰-۹] از [۰-۹] جواب داده شده/, "counts are in Persian digits");
});

test("a client's page lists what is waiting for them, first what still needs doing", () => {
  const html = renderClientPage({
    lang: "en", company: { name: "Acme" }, projects: [], updates: [], showUpdates: false, contact: {}, base: "/c/TOKEN",
    questionnaires: [
      { id: "q-done-1234", title: "Your website", language: "en", status: "submitted", createdAt: "2026-10-01T09:00:00Z", progress: { total: 9, answered: 9, needed: 2, neededAnswered: 2 } },
      { id: "q-open-2222", title: "Your product", language: "en", status: "open", createdAt: "2026-10-03T09:00:00Z", progress: { total: 7, answered: 0, needed: 2, neededAnswered: 0 } },
      { id: "q-open-1234", title: "Getting started", language: "en", status: "open", createdAt: "2026-10-02T09:00:00Z", progress: { total: 12, answered: 4, needed: 5, neededAnswered: 2 } }
    ]
  });
  assert.match(html, /Any time/);
  assert.ok(html.indexOf("Getting started") < html.indexOf("Your product"), "of the two still open, the one sent first comes first");
  assert.ok(html.indexOf("Your product") < html.indexOf("Your website"), "and what is already sent comes after what still needs answering");
  assert.match(html, /href="\/c\/TOKEN\/q\/q-open-1234"/);
  assert.match(html, /4 of 12 answered/);
  assert.match(html, />Continue<i/, "a started one continues");
  assert.match(html, /“Your website” answers sent/);
});

/* -------------------------------------------------- over the real server --- */

test("the owner sends a questionnaire and the client sees it on their page", async () => {
  const hq = await startHq();
  try {
    const { response, body } = await hq.send(hq.mine, "getting-started");
    assert.equal(response.status, 200);
    assert.equal(body.questionnaire.status, "open");
    assert.equal(body.questionnaire.progress.total, 12);
    assert.equal(Object.hasOwn(body.questionnaire, "answers"), false);

    const main = await hq.asClient(`/c/${hq.mine.token}`);
    assert.match(main.text, /Any time/);
    assert.match(main.text, /Answer the “Getting started” questions/);
    assert.match(main.text, new RegExp(`/c/${hq.mine.token}/q/${body.questionnaire.id}`));

    const history = hq.workspaceStore.getCompany(hq.company.id) && hq.workspaceStore.list().companies.find((company) => company.id === hq.company.id).timeline;
    assert.ok(history.some((event) => event.type === "questionnaire" && /Sent "Getting started"/.test(event.detail)));

    const duplicate = await hq.send(hq.mine, "getting-started");
    assert.equal(duplicate.response.status, 400);
    const unknown = await hq.send(hq.mine, "does-not-exist");
    assert.equal(unknown.response.status, 400);

    const listed = await (await hq.owner(`/api/client-links?companyId=${hq.company.id}`)).json();
    assert.equal(listed.templates.length, 4);
    const row = listed.links.find((link) => link.id === hq.mine.id);
    assert.equal(row.questionnaires.length, 1);
    assert.equal(Object.hasOwn(row.questionnaires[0], "answers"), false, "the list never carries answers");
  } finally {
    await hq.stop();
  }
});

test("saving keeps answers, sending tells the owner with counts only, and reloading never resends", async () => {
  const hq = await startHq();
  try {
    const { body } = await hq.send(hq.mine, "getting-started");
    const questionnaire = body.questionnaire;

    const page = await hq.asClient(`${hq.formPath(hq.mine, questionnaire)}?step=1`);
    assert.equal(page.status, 200);
    assert.equal(page.headers["cache-control"], "no-store");
    assert.equal(page.headers["set-cookie"], undefined);
    assert.match(page.headers["content-security-policy"], /form-action 'self'/);
    assert.match(page.headers["content-security-policy"], /default-src 'none'/);
    assert.match(page.text, /<textarea id="a_company" name="a_company"/);

    const secret = "OUR-PRIVATE-ANSWER-1234";
    const saved = await hq.post(hq.mine, questionnaire, { a_company: `Ahmadi Clinic ${secret}`, a_contact: "WhatsApp, evenings", action: "save" });
    assert.equal(saved.status, 303, "post, then redirect");
    assert.match(saved.headers.location, new RegExp(`^${hq.formPath(hq.mine, questionnaire)}\\?done=saved&t=\\d+$`));
    const after = await hq.asClient(saved.headers.location);
    assert.match(after.text, /Saved just now/);
    const partOne = await hq.asClient(`${hq.formPath(hq.mine, questionnaire)}?step=1`);
    assert.match(partOne.text, new RegExp(`Ahmadi Clinic ${secret}`), "what was typed is back in the box");
    assert.match(partOne.text, /2 of 12 answered/);
    assert.equal(hq.messages.length, 0, "saving is not sending: nobody is told");

    const sent = await hq.post(hq.mine, questionnaire, { a_company: `Ahmadi Clinic ${secret}`, a_success: "More bookings", action: "submit" });
    assert.match(sent.headers.location, new RegExp(`^${hq.formPath(hq.mine, questionnaire)}\\?done=sent&t=\\d+$`));
    await hq.settle(1);
    assert.equal(hq.messages.length, 1);
    assert.match(hq.messages[0], /Dr\. Ahmadi sent "Getting started" for Ahmadi Clinic: 3 of 12 answered, 3 of 5 needed to start\./);
    assert.equal(hq.messages[0].includes(secret), false, "the answers themselves never go to Telegram");
    assert.equal(hq.messages[0].includes("More bookings"), false);

    const events = hq.workspaceStore.list().companies.find((company) => company.id === hq.company.id).timeline;
    assert.ok(events.some((event) => event.type === "questionnaire" && /Dr\. Ahmadi sent "Getting started" \(3 of 12 answered\)/.test(event.detail)));

    await hq.post(hq.mine, questionnaire, { a_success: "More bookings, fewer calls", action: "submit" });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(hq.messages.length, 1, "pressing send again within minutes is not another message");

    const read = await (await hq.owner(`/api/client-questionnaires/${questionnaire.id}`)).json();
    assert.equal(read.questionnaire.status, "submitted");
    assert.equal(read.questionnaire.answers.success, "More bookings, fewer calls");
    assert.equal(read.questionnaire.answers.company, `Ahmadi Clinic ${secret}`);
    assert.match(read.questionnaire.content.sections[0].questions[0].text, /company called/);
  } finally {
    await hq.stop();
  }
});

test("a post from somebody else's page is refused, and one from the client's own browser is not", async () => {
  const hq = await startHq();
  try {
    const { body } = await hq.send(hq.mine, "getting-started");
    const fields = { a_company: "Acme", action: "save" };
    const refuse = async (headers, why) => {
      const response = await hq.post(hq.mine, body.questionnaire, fields, headers);
      assert.equal(response.status, 403, why);
      assert.equal(hq.questionnaireStore.get(body.questionnaire.id).answers.company, undefined, `${why}: nothing was saved`);
    };
    await refuse({ origin: "https://evil.example" }, "another site's origin");
    await refuse({ origin: "not a url" }, "a garbled origin");
    await refuse({ "sec-fetch-site": "cross-site" }, "a browser that says it is cross-site");

    // These pages send no referrer, and a browser then reports even a same-site post as Origin: null.
    for (const headers of [{ origin: "null", "sec-fetch-site": "same-origin" }, { origin: `http://${CLIENT_HOST}` }, { origin: `http://${CLIENT_HOST}.` }, {}]) {
      const response = await hq.post(hq.mine, body.questionnaire, fields, headers);
      assert.equal(response.status, 303, JSON.stringify(headers));
    }
  } finally {
    await hq.stop();
  }
});

test("odd posts get plain refusals, and a made-up or over-long answer is dealt with, not trusted", async () => {
  const hq = await startHq();
  try {
    const { body } = await hq.send(hq.mine, "website");
    const target = hq.formPath(hq.mine, body.questionnaire);

    const json = await hq.asClient(target, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ a_current: "x" }) });
    assert.equal(json.status, 415);

    // The server answers 413 and hangs up while the sender is still writing, so
    // the sender sees either the 413 or a reset connection. Both are a refusal.
    const huge = await hq.asClient(target, { method: "POST", body: `a_current=${"x".repeat(600 * 1024)}` }).catch((error) => ({ status: 0, error }));
    assert.ok(huge.status === 413 || (huge.status === 0 && /ECONNRESET|EPIPE/.test(String(huge.error?.code))), `an oversized body is refused (got ${huge.status} ${huge.error?.code || ""})`);
    assert.equal(hq.questionnaireStore.get(body.questionnaire.id).answers.current, undefined, "and none of it was kept");

    const crowd = new URLSearchParams();
    for (let index = 0; index < 500; index += 1) crowd.append(`a_made_up_${index}`, "x");
    crowd.append("a_current", "kept");
    const flood = await hq.asClient(target, { method: "POST", body: crowd.toString() });
    assert.equal(flood.status, 303);
    const kept = hq.questionnaireStore.get(body.questionnaire.id).answers;
    assert.deepEqual(kept, { current: "kept" }, "unknown fields are ignored and cannot crowd out the real one that follows them");

    const real = await hq.post(hq.mine, body.questionnaire, { a_current: "y".repeat(9000), a_unknown: "nope", action: "save", "a_current ": "tricky", "__proto__": "x" });
    assert.equal(real.status, 303);
    const stored = hq.questionnaireStore.get(body.questionnaire.id).answers;
    assert.equal(stored.current.length, QUESTIONNAIRE_LIMITS.answer);
    assert.equal(Object.hasOwn(stored, "unknown"), false);

    assert.equal((await hq.asClient(`/c/${hq.mine.token}`, { method: "POST", body: "x=1" })).status, 405, "the main page still takes no posts");
    const put = await hq.asClient(target, { method: "PUT", body: "x=1" });
    assert.equal(put.status, 405);
    assert.match(put.headers.allow, /POST/);
  } finally {
    await hq.stop();
  }
});

test("one person's questionnaire cannot be reached with anyone else's link, and looks like it never existed", async () => {
  const hq = await startHq();
  try {
    const { body } = await hq.send(hq.mine, "getting-started");
    const questionnaire = body.questionnaire;
    const real = await hq.asClient(hq.formPath(hq.mine, questionnaire));
    assert.equal(real.status, 200);

    const sameCompany = await hq.asClient(hq.formPath(hq.second, questionnaire));
    const otherCompany = await hq.asClient(hq.formPath(hq.strangers, questionnaire));
    const invented = await hq.asClient(`/c/${hq.mine.token}/q/00000000-0000-0000-0000-000000000000`);
    for (const response of [sameCompany, otherCompany, invented]) {
      assert.equal(response.status, 404);
      assert.match(response.text, /no longer active/);
      assert.equal(response.text.includes("Getting started"), false);
    }
    assert.equal(sameCompany.text, invented.text);
    assert.equal((await hq.post(hq.second, questionnaire, { a_company: "hijack", action: "save" })).status, 404);
    assert.equal(hq.questionnaireStore.get(questionnaire.id).answers.company, undefined, "and nothing was written");

    assert.doesNotMatch((await hq.asClient(`/c/${hq.second.token}`)).text, /Getting started/, "the second person's page does not list it");
    for (const bad of ["x", "../etc", "q/../../x", "%2e%2e%2f%2e%2e%2fapi%2fworkspaces", "00000000-0000-0000-0000-000000000000/extra"]) {
      assert.equal((await hq.asClient(`/c/${hq.mine.token}/q/${bad}`)).status, 404, bad);
    }
  } finally {
    await hq.stop();
  }
});

test("closing stops the answers, reopening restarts them, and ending the link stops everything", async () => {
  const hq = await startHq();
  try {
    const { body } = await hq.send(hq.mine, "getting-started");
    const questionnaire = body.questionnaire;
    await hq.post(hq.mine, questionnaire, { a_company: "Before closing", action: "save" });

    const closed = await hq.owner(`/api/client-questionnaires/${questionnaire.id}/close`, { method: "POST" });
    assert.equal((await closed.json()).questionnaire.status, "closed");
    const refused = await hq.post(hq.mine, questionnaire, { a_company: "After closing", action: "save" });
    assert.equal(refused.status, 409);
    assert.match(refused.text, /This questionnaire is closed/);
    assert.equal(hq.questionnaireStore.get(questionnaire.id).answers.company, "Before closing");
    assert.match((await hq.asClient(hq.formPath(hq.mine, questionnaire))).text, /Before closing/, "the client can still read what they wrote");

    await hq.owner(`/api/client-questionnaires/${questionnaire.id}/reopen`, { method: "POST" });
    assert.equal((await hq.post(hq.mine, questionnaire, { a_company: "Reopened", action: "save" })).status, 303);

    await hq.owner(`/api/client-links/${hq.mine.id}/revoke`, { method: "POST" });
    const dead = await hq.post(hq.mine, questionnaire, { a_company: "From an ended link", action: "save" });
    assert.equal(dead.status, 404);
    assert.equal(hq.questionnaireStore.get(questionnaire.id).answers.company, "Reopened");
    assert.ok((await hq.owner(`/api/client-questionnaires/${questionnaire.id}`)).ok, "the owner still has everything that was answered");
    assert.equal((await hq.send(hq.mine, "website")).response.status, 400, "and cannot send more to an ended link");

    const removed = await hq.owner(`/api/client-questionnaires/${questionnaire.id}`, { method: "DELETE" });
    assert.equal(removed.status, 200);
    assert.equal(hq.questionnaireStore.get(questionnaire.id), null);
    assert.equal((await hq.owner(`/api/client-questionnaires/${questionnaire.id}`)).status, 404);
  } finally {
    await hq.stop();
  }
});

test("saving is rate-limited per person, and slowing one person down does not touch another", async () => {
  const hq = await startHq({ clientSaveLimiter: createInquiryLimiter({ perAddress: 3, perHour: 1000, windowMs: 60_000 }) });
  try {
    const first = (await hq.send(hq.mine, "getting-started")).body.questionnaire;
    const second = (await hq.send(hq.second, "getting-started")).body.questionnaire;
    for (let attempt = 0; attempt < 3; attempt += 1) assert.equal((await hq.post(hq.mine, first, { a_company: `try ${attempt}`, action: "save" })).status, 303);
    const limited = await hq.post(hq.mine, first, { a_company: "too many", action: "save" });
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers["retry-after"]) >= 1);
    assert.equal(hq.questionnaireStore.get(first.id).answers.company, "try 2");
    assert.equal((await hq.post(hq.second, second, { a_company: "fine", action: "save" })).status, 303);
  } finally {
    await hq.stop();
  }
});

test("only the signed-in owner can send, read, close or remove questionnaires", async () => {
  const hq = await startHq({ authRequired: true });
  try {
    const sendPath = `/api/client-links/${hq.mine.id}/questionnaires`;
    for (const [method, pathname] of [["POST", sendPath], ["GET", "/api/client-questionnaires/abcdefgh-1"], ["POST", "/api/client-questionnaires/abcdefgh-1/close"], ["DELETE", "/api/client-questionnaires/abcdefgh-1"]]) {
      assert.equal((await hq.owner(pathname, { method, ...(method === "POST" ? { body: "{}" } : {}) })).status, 401, `${method} ${pathname} needs a sign-in`);
    }

    const login = await hq.owner("/api/auth/login", { method: "POST", body: JSON.stringify({ email: "owner@example.com", password: "a-long-owner-password" }) });
    const ownerCookie = String(login.headers.get("set-cookie")).split(";", 1)[0];
    const invite = await (await hq.owner("/api/auth/invites", { method: "POST", headers: { cookie: ownerCookie }, body: JSON.stringify({ email: "member@example.com", name: "Member" }) })).json();
    const token = invite.invite.token || String(invite.invite.url).split("invite=")[1];
    const registered = await hq.owner("/api/auth/register", { method: "POST", body: JSON.stringify({ token, password: "a-long-friend-password" }) });
    const memberCookie = String(registered.headers.get("set-cookie")).split(";", 1)[0];

    const made = await (await hq.owner(sendPath, { method: "POST", headers: { cookie: ownerCookie }, body: JSON.stringify({ templateId: "getting-started" }) })).json();
    assert.ok(made.questionnaire.id, "the owner can send one");
    for (const [method, pathname] of [["POST", sendPath], ["GET", `/api/client-questionnaires/${made.questionnaire.id}`], ["POST", `/api/client-questionnaires/${made.questionnaire.id}/close`], ["DELETE", `/api/client-questionnaires/${made.questionnaire.id}`]]) {
      const response = await hq.owner(pathname, { method, headers: { cookie: memberCookie }, ...(method === "POST" ? { body: JSON.stringify({ templateId: "website" }) } : {}) });
      assert.equal(response.status, 403, `a teammate must not ${method} ${pathname}`);
    }
    assert.equal(hq.questionnaireStore.get(made.questionnaire.id).status, "open", "and nothing was changed");
  } finally {
    await hq.stop();
  }
});

test("deleting a company deletes what its clients answered", async () => {
  const hq = await startHq();
  try {
    const { body } = await hq.send(hq.mine, "getting-started");
    await hq.post(hq.mine, body.questionnaire, { a_company: "Private", action: "save" });
    const removed = await hq.owner(`/api/workspaces/companies/${hq.company.id}?confirm=true`, { method: "DELETE" });
    assert.equal(removed.status, 200);
    assert.equal(hq.questionnaireStore.get(body.questionnaire.id), null);
    assert.equal((await hq.asClient(hq.formPath(hq.mine, body.questionnaire))).status, 404);
  } finally {
    await hq.stop();
  }
});


/* ------------------------------- findings from the independent review --- */

/** A post whose body arrives in two parts, with something happening in between. */
function slowPost(port, pathname, body, between) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(body);
    const half = Math.floor(payload.length / 2);
    const request = http.request({
      hostname: "127.0.0.1", port, path: pathname, method: "POST",
      headers: { host: CLIENT_HOST, "content-type": FORM, "content-length": payload.length }
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, text: Buffer.concat(chunks).toString("utf8") }));
    });
    request.on("error", reject);
    request.write(payload.subarray(0, half));
    Promise.resolve(between()).then(() => request.end(payload.subarray(half)), reject);
  });
}

test("a link ended while its answers are still arriving saves nothing", async () => {
  const hq = await startHq();
  try {
    const { body } = await hq.send(hq.mine, "getting-started");
    const answers = new URLSearchParams({ a_company: "Sent after the link was ended", action: "submit" }).toString();
    const result = await slowPost(hq.port, hq.formPath(hq.mine, body.questionnaire), answers, async () => {
      await hq.owner(`/api/client-links/${hq.mine.id}/revoke`, { method: "POST" });
    });
    assert.equal(result.status, 404);
    assert.equal(hq.questionnaireStore.get(body.questionnaire.id).answers.company, undefined, "nothing was written");
    assert.equal(hq.messages.length, 0, "and nobody was told");
  } finally {
    await hq.stop();
  }
});

test("a body that never finishes is cut off instead of holding the connection", async () => {
  const hq = await startHq({ clientFormBodyTimeoutMs: 150 });
  try {
    const { body } = await hq.send(hq.mine, "getting-started");
    const status = await new Promise((resolve, reject) => {
      const request = http.request({
        hostname: "127.0.0.1", port: hq.port, path: hq.formPath(hq.mine, body.questionnaire), method: "POST",
        headers: { host: CLIENT_HOST, "content-type": FORM, "content-length": 5000 }
      }, (response) => { resolve(response.statusCode); response.resume(); });
      request.on("error", reject);
      request.write("a_company=slow");
      setTimeout(() => reject(new Error("the server never answered")), 3000).unref();
    });
    assert.equal(status, 408);
    assert.equal(hq.questionnaireStore.get(body.questionnaire.id).answers.company, undefined);
  } finally {
    await hq.stop();
  }
});

test("pressing send again is news only when something changed, and a form can only ping the owner a few times a day", async () => {
  const clock = { value: Date.parse("2026-10-08T10:00:00Z") };
  const hq = await startHq({ now: () => new Date(clock.value) });
  try {
    const { body } = await hq.send(hq.mine, "getting-started");
    const send = (fields) => hq.post(hq.mine, body.questionnaire, { ...fields, action: "submit" });
    const quiet = () => new Promise((resolve) => setTimeout(resolve, 25));

    await send({ a_company: "First version" });
    await hq.settle(1);
    assert.equal(hq.messages.length, 1, "the first send is news");

    clock.value += 11 * 60 * 1000;
    await send({ a_company: "First version" });
    await quiet();
    assert.equal(hq.messages.length, 1, "the same answers sent again, long after, are not");

    await send({ a_company: "Second version" });
    await hq.settle(2);
    assert.equal(hq.messages.length, 2, "a change is");

    for (let attempt = 3; attempt <= 14; attempt += 1) {
      clock.value += 11 * 60 * 1000;
      await send({ a_company: `Version ${attempt}` });
      await quiet();
    }
    assert.equal(hq.messages.length, 6, "but a single form pings the owner at most six times a day, however often it is changed");
    assert.equal(hq.questionnaireStore.get(body.questionnaire.id).answers.company, "Version 14", "and every change was still saved");

    clock.value += 25 * 60 * 60 * 1000;
    await send({ a_company: "A new day" });
    await hq.settle(7);
    assert.equal(hq.messages.length, 7, "a day later it can tell the owner again");
  } finally {
    await hq.stop();
  }
});

test("sending questions to a link needs client pages to be on, like making the link did", async () => {
  const off = await startHqWithPagesOff();
  try {
    const response = await off.owner(`/api/client-links/${off.linkId}/questionnaires`, { method: "POST", body: JSON.stringify({ templateId: "getting-started" }) });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, "client_pages_off");
  } finally {
    await off.stop();
  }
});

async function startHqWithPagesOff() {
  const root = await mkdtemp(path.join(tmpdir(), "agent4-off-"));
  await mkdir(path.join(root, "data"));
  await writeFile(path.join(root, "data", "hq.html"), "<h1>x</h1>");
  const databasePath = path.join(root, "data", "rooms.sqlite");
  const workspaceStore = createWorkspaceStore(databasePath);
  const linkStore = createClientLinkStore(databasePath, { workspace: workspaceStore });
  const company = workspaceStore.createCompany({ name: "Off Co", kind: "client", actorId: "owner" });
  const link = linkStore.createLink({ companyId: company.id, actorId: "owner" });
  const server = createHqServer({ company: { name: "x", positioning: "x" }, runtime: { root, roomDatabasePath: databasePath, clientPagesEnabled: false } }, { workspaceStore, clientLinkStore: linkStore });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    linkId: link.id,
    owner: (pathname, options = {}) => fetch(`${base}${pathname}`, { ...options, headers: { "content-type": "application/json", origin: base } }),
    async stop() {
      await new Promise((resolve) => server.close(resolve));
      await rm(root, { recursive: true, force: true });
    }
  };
}


/* ------------------------------- second review: rendering and size --- */

const fill = (value, count = 12) => Object.fromEntries(Array.from({ length: count }, (_, index) => [`k${index}`, value]));
function closedWith(answers) {
  return sample({
    status: "closed", answers,
    content: { intro: "", sections: [{ id: "s", title: "S", questions: Array.from({ length: 12 }, (_, index) => ({ id: `k${index}`, text: `Q${index}`, hint: "", must: false })) }] },
    progress: { total: 12, answered: 12, needed: 0, neededAnswered: 0 }
  });
}

test("an answer built to make link detection slow does not slow the server", () => {
  for (const quote of ["'", '"', ")", ".", "&"]) {
    const started = performance.now();
    renderQuestionnairePage({ questionnaire: closedWith(fill(`https://a.bc/${quote.repeat(3900)}x`)), company: { name: "C" }, base: "/c/T" });
    renderQuestionnairePage({ questionnaire: closedWith(fill(`https://a.bc/${quote.repeat(3900)}`)), company: { name: "C" }, base: "/c/T" });
    const took = performance.now() - started;
    assert.ok(took < 250, `twenty-four such answers took ${Math.round(took)} ms with ${JSON.stringify(quote)}; it used to take well over a second`);
  }
});

test("addresses end where the sentence resumes, in both scripts", () => {
  const linkOf = (text) => {
    const html = renderQuestionnairePage({ questionnaire: closedWith({ k0: text }), company: { name: "C" }, base: "/c/T" });
    return { html, href: (html.match(/<a href="(https?:[^"]*)" target="_blank"/) || [])[1] };
  };
  assert.equal(linkOf("see https://example.com؟").href, "https://example.com", "a Persian question mark is the sentence's, not the address's");
  assert.equal(linkOf("سایت https://example.com، و").href, "https://example.com");
  assert.equal(linkOf("https://a.com/?x=1&").href, "https://a.com/?x=1", "a trailing ampersand is dropped whole, not split into half an entity");
  assert.equal(linkOf("https://a.com/?x=1&").html.includes("&amp</a>"), false);
  assert.equal(linkOf("(see https://example.com/page)").href, "https://example.com/page", "a closing bracket the address did not open is the sentence's");
  assert.equal(linkOf("https://en.wikipedia.org/wiki/Foo_(bar)").href, "https://en.wikipedia.org/wiki/Foo_(bar)", "one it did open is its own");
  assert.equal(linkOf(`https://example.com/${"a".repeat(2100)}`).href, undefined, "an address over two thousand characters is shown as text, not linked");
});

test("a long answer in Persian is accepted whole, since Persian takes six bytes a letter in a form", async () => {
  const hq = await startHq();
  try {
    const { body } = await hq.send(hq.mine, "getting-started");
    const longest = "ا".repeat(QUESTIONNAIRE_LIMITS.answer);
    const fields = Object.fromEntries([...body.questionnaire.progress ? ["company", "contact", "approver", "owner-after", "trigger", "success", "today", "deadline", "customers", "why-you", "tried", "constraints"] : []].map((id) => [`a_${id}`, longest]));
    const encoded = new URLSearchParams({ ...fields, action: "submit" }).toString();
    assert.ok(encoded.length > 250_000, `the form is ${encoded.length} bytes, the size that used to be turned away`);
    const response = await hq.asClient(hq.formPath(hq.mine, body.questionnaire), { method: "POST", body: encoded });
    assert.equal(response.status, 303);
    const stored = hq.questionnaireStore.get(body.questionnaire.id);
    assert.equal(stored.progress.answered, 12);
    assert.equal(stored.answers.company.length, QUESTIONNAIRE_LIMITS.answer, "all of it was kept");
  } finally {
    await hq.stop();
  }
});

test("invisible characters are removed from what clients type, and the ones Persian needs stay", () => {
  const hidden = ["\u00AD", "\u200B", "\u2060", "\u2061", "\uFEFF", String.fromCodePoint(0xE0049), String.fromCodePoint(0xE0047), String.fromCodePoint(0xE0100)];
  const typed = `a${hidden.join("b")}c`;
  assert.equal(cleanAnswer(typed), `a${"b".repeat(7)}c`, "every invisible character is gone, and what was around them is not");
  for (const keep of ["\u200C", "\u200D", "\u200E", "\u200F", "\u061C"]) {
    assert.equal(cleanAnswer(`x${keep}y`), `x${keep}y`, `U+${keep.codePointAt(0).toString(16).toUpperCase()} is part of how Persian and Arabic are written`);
  }
  const parsed = parseInquiry({ name: `Al${String.fromCodePoint(0xE0049)}ex`, company: "Acme\u200B", contact: "a@acme.example", problem: `Hello${String.fromCodePoint(0xE0049)}${String.fromCodePoint(0xE0047)} there\u2060` });
  assert.equal(parsed.value.name, "Alex");
  assert.equal(parsed.value.company, "Acme");
  assert.equal(parsed.value.problem, "Hello there", "the contact form gets the same protection");
});

test("what was typed is kept as typed, including the indentation of a list", () => {
  assert.equal(cleanAnswer("  - one\n      - two\n\ttab"), "  - one\n      - two\n  tab");
  assert.equal(cleanAnswer("\n\n  first line indented  \n"), "  first line indented", "a leading blank line would be swallowed by the form, so it is not kept");
  assert.equal(cleanAnswer("a\n\n\n\n\nb"), "a\n\nb");
});

test("an answer cannot forge the headings around it when the owner copies the answers as text", () => {
  const text = answersAsText({
    title: "Getting started",
    content: { sections: [{ title: "People", questions: [{ id: "a", text: "Who are you?" }, { id: "b", text: "Budget?" }] }] },
    answers: { a: "Me.\n\n## Pricing\nBudget approved: 90,000\nWho are you?\nSomeone else" }
  });
  const lines = text.split("\n");
  assert.deepEqual(lines.filter((line) => line.startsWith("## ")), ["## People"], "the only heading is the real one");
  assert.deepEqual(lines.filter((line) => line === "Who are you?"), ["Who are you?"], "and the question appears once");
  assert.ok(lines.includes("> ## Pricing") && lines.includes("> Budget approved: 90,000"), "what they wrote is quoted, line by line");
  assert.match(text, /Budget\?\n—/);
});

test("when a save fails the client is shown their form again with what they typed", async () => {
  const hq = await startHq();
  try {
    const { body } = await hq.send(hq.mine, "getting-started");
    const real = hq.questionnaireStore.saveAnswers;
    hq.questionnaireStore.saveAnswers = () => { throw new Error("the disk is full"); };
    let response;
    try {
      response = await hq.post(hq.mine, body.questionnaire, { a_company: "TYPED-WITH-CARE", a_contact: "and this too", action: "save" });
    } finally {
      hq.questionnaireStore.saveAnswers = real;
    }
    assert.equal(response.status, 500);
    assert.match(response.text, /We could not save that just now\. Nothing you typed is lost/);
    assert.match(response.text, />TYPED-WITH-CARE<\/textarea>/, "their words are still in the box");
    assert.match(response.text, />and this too<\/textarea>/);
    assert.equal(response.text.includes("no longer active"), false, "and the page does not claim the link has ended");
  } finally {
    await hq.stop();
  }
});

test("a client who saves too fast is told so on their own form, not that their link has ended", async () => {
  const hq = await startHq({ clientSaveLimiter: createInquiryLimiter({ perAddress: 1, perHour: 1000, windowMs: 60_000 }) });
  try {
    const { body } = await hq.send(hq.mine, "getting-started");
    await hq.post(hq.mine, body.questionnaire, { a_company: "one", action: "save" });
    const slowed = await hq.post(hq.mine, body.questionnaire, { a_company: "two", action: "save" });
    assert.equal(slowed.status, 429);
    assert.match(slowed.text, /saving very quickly/);
    assert.equal(slowed.text.includes("no longer active"), false);
    assert.ok(Number(slowed.headers["retry-after"]) >= 1);
  } finally {
    await hq.stop();
  }
});

test("'Saved just now' is only said just after saving, and 'Sent' only for something that was sent", async () => {
  const hq = await startHq();
  try {
    const { body } = await hq.send(hq.mine, "getting-started");
    const target = hq.formPath(hq.mine, body.questionnaire);
    const now = Math.floor(Date.now() / 1000);

    assert.match((await hq.asClient(`${target}?done=saved&t=${now}`)).text, /Saved just now/);
    assert.equal((await hq.asClient(`${target}?done=saved&t=${now - 3600}`)).text.includes("Saved just now"), false, "an hour later it no longer claims it");
    assert.equal((await hq.asClient(`${target}?done=saved`)).text.includes("Saved just now"), false, "and a made-up address does not either");
    assert.equal((await hq.asClient(`${target}?done=sent&t=${now}`)).text.includes("Sent. Thank you"), false, "nothing was sent, so it does not say so");

    await hq.post(hq.mine, body.questionnaire, { a_company: "Acme", action: "submit" });
    assert.match((await hq.asClient(`${target}?done=sent&t=${now}`)).text, /Sent\. Thank you/);
  } finally {
    await hq.stop();
  }
});

test("every answer on the client site asks for https, the form and its redirect included", async () => {
  const hq = await startHq();
  try {
    const { body } = await hq.send(hq.mine, "getting-started");
    const secure = { "x-forwarded-proto": "https" };
    const page = await hq.asClient(hq.formPath(hq.mine, body.questionnaire), { headers: secure });
    assert.match(page.headers["strict-transport-security"], /max-age=31536000/);
    const redirect = await hq.post(hq.mine, body.questionnaire, { a_company: "Acme", action: "save" }, secure);
    assert.equal(redirect.status, 303);
    assert.match(redirect.headers["strict-transport-security"], /max-age=31536000/);
    assert.equal((await hq.asClient(hq.formPath(hq.mine, body.questionnaire))).headers["strict-transport-security"], undefined, "and makes no such promise over plain http");
  } finally {
    await hq.stop();
  }
});

/* ----------------------------------------------------- one part at a time --- */

test("the questions come one part at a time, and each step saves before it moves", async () => {
  const hq = await startHq();
  try {
    const { body } = await hq.send(hq.mine, "getting-started");
    const questionnaire = body.questionnaire;
    const path = hq.formPath(hq.mine, questionnaire);

    const start = await hq.asClient(path);
    assert.match(start.text, /Two ways to answer/);
    assert.match(start.text, /Type it here/);
    assert.match(start.text, /Talk instead/);
    assert.match(start.text, new RegExp(`href="${path}\\?step=1"`), "starting is a plain link to part 1");
    assert.equal(start.text.includes('name="a_company"'), false, "the start asks nothing yet");

    const next = await hq.post(hq.mine, questionnaire, { step: "1", a_company: "Ahmadi Clinic", a_contact: "WhatsApp", action: "next" });
    assert.equal(next.status, 303);
    assert.match(next.headers.location, new RegExp(`^${path}\\?step=2&done=part&part=1&t=\\d+$`));
    const partTwo = await hq.asClient(next.headers.location);
    assert.match(partTwo.text, /Part 1 saved\. 2 of 4 answered\./);
    assert.match(partTwo.text, /Part 2 of 4/);
    assert.match(partTwo.text, /name="a_trigger"/);
    assert.equal(partTwo.text.includes('name="a_company"'), false, "only this part's questions");
    assert.equal(hq.questionnaireStore.get(questionnaire.id).answers.company, "Ahmadi Clinic");

    // Going back saves too, and an answer emptied in this part is removed.
    const back = await hq.post(hq.mine, questionnaire, { step: "2", a_trigger: "Phones ring all day", action: "back" });
    assert.match(back.headers.location, new RegExp(`^${path}\\?step=1$`));
    assert.equal(hq.questionnaireStore.get(questionnaire.id).answers.trigger, "Phones ring all day");

    const last = await hq.post(hq.mine, questionnaire, { step: "4", a_tried: "A booking app", action: "next" });
    assert.match(last.headers.location, new RegExp(`^${path}\\?step=check&done=part&part=4&t=\\d+$`), "after the last part comes the check");
    const check = await hq.asClient(last.headers.location);
    assert.match(check.text, /Check and send/);
    assert.match(check.text, /Three months after launch/, "a question needed to start that is still empty is named");
    assert.match(check.text, /You can send it with gaps/);
    assert.equal(hq.messages.length, 0, "moving between parts is not sending");

    for (const odd of ["99", "0", "-1", "abc", "1;drop"]) {
      const page = await hq.asClient(`${path}?step=${encodeURIComponent(odd)}`);
      assert.equal(page.status, 200);
      assert.match(page.text, /Type it here/, `${odd} falls back to the start`);
      assert.equal(page.text.includes("Talk instead"), false, "once they have typed, the call offer steps aside");
      assert.equal(page.text.includes("Part 99"), false);
    }
  } finally {
    await hq.stop();
  }
});

test("a client can ask to answer on a call instead; the owner hears once, without what they typed", async () => {
  const hq = await startHq();
  try {
    const { body } = await hq.send(hq.mine, "getting-started");
    const questionnaire = body.questionnaire;
    const path = hq.formPath(hq.mine, questionnaire);
    const times = "Weekday mornings PRIVATE-TIMES-77";

    const asked = await hq.post(hq.mine, questionnaire, { action: "call", times });
    assert.equal(asked.status, 303);
    assert.match(asked.headers.location, new RegExp(`^${path}\\?done=call&t=\\d+$`));
    const page = await hq.asClient(asked.headers.location);
    assert.match(page.text, /Call asked for\./);
    assert.match(page.text, /PRIVATE-TIMES-77/, "they see what they wrote");
    assert.match(page.text, /Type them instead/, "and can still type");

    await hq.settle(1);
    assert.equal(hq.messages.length, 1);
    assert.match(hq.messages[0], /Dr\. Ahmadi would rather answer "Getting started" for Ahmadi Clinic on a 20-minute call\. They left times that suit them\./);
    assert.equal(hq.messages[0].includes("PRIVATE-TIMES-77"), false, "what a client types never goes to Telegram");
    const events = hq.workspaceStore.list().companies.find((company) => company.id === hq.company.id).timeline;
    assert.ok(events.some((event) => /asked to answer "Getting started" on a call/.test(event.detail)));

    await hq.post(hq.mine, questionnaire, { action: "call", times: "Tuesday" });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(hq.messages.length, 1, "asking again is not news");
    assert.equal(hq.questionnaireStore.get(questionnaire.id).callTimes, "Tuesday", "but the times are updated");

    const read = await (await hq.owner(`/api/client-questionnaires/${questionnaire.id}`)).json();
    assert.ok(read.questionnaire.callRequestedAt);
    const client = await hq.asClient(`/c/${hq.mine.token}`);
    assert.match(client.text, /You asked for a call/, "their page says it too");

    hq.questionnaireStore.setStatus(questionnaire.id, "closed");
    const late = await hq.post(hq.mine, questionnaire, { action: "call", times: "now" });
    assert.equal(late.status, 409, "a closed questionnaire takes nothing more");
  } finally {
    await hq.stop();
  }
});

test("the owner can type in what a client said on a call, and only into questions that exist", async () => {
  const hq = await startHq();
  try {
    const { body } = await hq.send(hq.mine, "getting-started");
    const id = body.questionnaire.id;
    const response = await hq.owner(`/api/client-questionnaires/${id}/answers`, { method: "PUT", body: JSON.stringify({ answers: { company: "Ahmadi Clinic, physio", success: "40 online bookings a month", invented: "dropped" }, submit: true }) });
    assert.equal(response.status, 200);
    const saved = hq.questionnaireStore.get(id);
    assert.equal(saved.answers.company, "Ahmadi Clinic, physio");
    assert.equal(saved.answers.success, "40 online bookings a month");
    assert.equal("invented" in saved.answers, false);
    assert.equal(saved.status, "submitted");
    assert.equal(hq.messages.length, 0, "the owner is not told about their own typing");
    const missing = await hq.owner("/api/client-questionnaires/does-not-exist-1/answers", { method: "PUT", body: JSON.stringify({ answers: {} }) });
    assert.equal(missing.status, 404);
  } finally {
    await hq.stop();
  }
});
