import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createHqServer } from "../src/hq-server.js";
import { localIsoDate } from "../src/local-date.js";
import {
  createInquiryLimiter,
  INQUIRY_LIMITS,
  parseContact,
  parseInquiry
} from "../src/public-inquiry.js";
import { createWorkspaceStore } from "../src/workspace-store.js";

const SITE = "https://example.com";

function validBody(overrides = {}) {
  return {
    name: "Alex Rivera",
    company: "Acme Logistics",
    contact: "alex@acme.example",
    link: "https://acme.example",
    type: "Website",
    timing: "Within 1–3 months",
    problem: "Our quote form loses half of the people who start it.",
    source: "home-hero",
    lang: "en",
    extra_note: "",
    ...overrides
  };
}

async function startServer({ enabled = true, authRequired = false, inquiryLimiter, notifyInquiry, seed } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "agent4-inquiry-"));
  await mkdir(path.join(root, "data"));
  await writeFile(path.join(root, "data", "hq.html"), "<h1>Agent4 HQ</h1>");
  const workspaceStore = createWorkspaceStore(path.join(root, "data", "workspace.sqlite"));
  seed?.(workspaceStore);
  const messages = [];
  const config = {
    company: { name: "Your company", positioning: "build useful business software" },
    runtime: {
      root,
      roomDatabasePath: path.join(root, "data", "rooms.sqlite"),
      trustProxy: true,
      publicInquiryEnabled: enabled,
      publicInquiryOrigins: [SITE, "https://www.example.com"],
      ...(authRequired
        ? {
            agent4AuthRequired: true,
            agent4SecureCookies: false,
            agent4BootstrapEmail: "owner@example.com",
            agent4BootstrapName: "Owner",
            agent4BootstrapPassword: "a-long-owner-password"
          }
        : {})
    }
  };
  const server = createHqServer(config, {
    workspaceStore,
    inquiryLimiter,
    notifyInquiry: notifyInquiry || (async (message) => { messages.push(message); })
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;

  const send = (body, { origin = SITE, headers = {}, method = "POST", raw } = {}) => fetch(`${base}/public/inquiry`, {
    method,
    headers: {
      ...(origin === null ? {} : { origin }),
      ...(method === "POST" ? { "content-type": "application/json" } : {}),
      ...headers
    },
    ...(method === "POST" ? { body: raw ?? JSON.stringify(body) } : {})
  });
  const companies = () => workspaceStore.list().companies;
  const settle = async () => {
    // The owner is told after the visitor has been answered.
    for (let attempt = 0; attempt < 40 && !messages.length; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  };

  return {
    base,
    send,
    companies,
    messages,
    settle,
    workspaceStore,
    async stop() {
      // Closing the server closes the stores it was handed.
      await new Promise((resolve) => server.close(resolve));
      await rm(root, { recursive: true, force: true });
    }
  };
}

test("the public door is closed until it is switched on", async () => {
  const hq = await startServer({ enabled: false });
  try {
    const response = await hq.send(validBody());
    assert.equal(response.status, 404);
    assert.equal(hq.companies().length, 0);
  } finally {
    await hq.stop();
  }
});

test("an inquiry becomes a lead with a reply due today, and the owner is told", async () => {
  const hq = await startServer();
  try {
    const response = await hq.send(validBody());
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { ok: true }, "the visitor learns nothing about what is on file");
    assert.equal(response.headers.get("set-cookie"), null, "no session is ever created");
    assert.equal(response.headers.get("access-control-allow-origin"), SITE);

    const [company] = hq.companies();
    assert.equal(company.name, "Acme Logistics");
    assert.equal(company.kind, "prospect");
    assert.equal(company.stage, "lead");
    assert.equal(company.contactName, "Alex Rivera");
    assert.equal(company.contactEmail, "alex@acme.example");
    assert.equal(company.website, "https://acme.example/");
    assert.equal(company.summary, "Our quote form loses half of the people who start it.");
    assert.equal(company.createdBy, "website");
    assert.equal(company.nextAction, "Reply to Alex Rivera — website inquiry");
    assert.equal(company.nextActionOn, localIsoDate());
    const events = company.timeline.filter((event) => event.type === "inquiry");
    assert.equal(events.length, 1);
    assert.match(events[0].detail, /Website inquiry \(en\) · Website · Within 1–3 months · from home-hero/);

    await hq.settle();
    assert.equal(hq.messages.length, 1);
    assert.match(hq.messages[0], /New website inquiry — Acme Logistics/);
    assert.match(hq.messages[0], /Alex Rivera · alex@acme\.example/);
    assert.match(hq.messages[0], /new lead in HQ/);
  } finally {
    await hq.stop();
  }
});

test("a way to reply can be an email, a phone number in any digits, or a Telegram handle", async () => {
  assert.deepEqual(parseContact("Alex@Acme.Example"), { kind: "email", value: "alex@acme.example" });
  assert.deepEqual(parseContact("+1 202 555 0123"), { kind: "phone", value: "+12025550123" });
  assert.deepEqual(parseContact("00 1 (202) 555-0123"), { kind: "phone", value: "+12025550123" });
  assert.deepEqual(parseContact("۰۹۱۲۳۴۵۶۷۸۹"), { kind: "phone", value: "09123456789" }, "Persian digits are not an error");
  assert.deepEqual(parseContact("٠٩١٢٣٤٥٦٧٨٩"), { kind: "phone", value: "09123456789" }, "neither are Arabic-Indic ones");
  assert.deepEqual(parseContact("@alex_dev"), { kind: "telegram", value: "@alex_dev" });
  for (const nonsense of ["", "tomorrow", "alex@", "@a", "12345", "call me", "alex@acme", "<script>@x.io"]) {
    assert.equal(parseContact(nonsense), null, `"${nonsense}" is not a way to reply`);
  }

  const hq = await startServer();
  try {
    assert.equal((await hq.send(validBody({ contact: "۰۹۱۲۳۴۵۶۷۸۹", company: "Example Trading" }))).status, 201);
    assert.equal((await hq.send(validBody({ contact: "@alex_dev", company: "Telegram Co" }))).status, 201);
    const byName = Object.fromEntries(hq.companies().map((company) => [company.name, company]));
    assert.equal(byName["Example Trading"].contactPhone, "09123456789");
    assert.equal(byName["Telegram Co"].contactTelegram, "@alex_dev");
  } finally {
    await hq.stop();
  }
});

test("what is missing is reported as codes, and nothing is saved", async () => {
  const hq = await startServer();
  try {
    const response = await hq.send({ name: "", company: "Acme", contact: "tomorrow", problem: "" });
    assert.equal(response.status, 400);
    const { error } = await response.json();
    assert.equal(error.code, "invalid_inquiry");
    assert.deepEqual(error.fields, { name: "required", problem: "required", contact: "invalid" });

    const missingContact = await hq.send(validBody({ contact: "" }));
    assert.deepEqual((await missingContact.json()).error.fields, { contact: "required" });
    assert.equal(hq.companies().length, 0);
    assert.equal(hq.messages.length, 0);
  } finally {
    await hq.stop();
  }
});

test("a bad optional link never costs a lead", () => {
  const parsed = parseInquiry(validBody({ link: "not a link at all", type: "", timing: "" }));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.link, "");
  assert.equal(parseInquiry(validBody({ link: "acme.example/work" })).value.link, "https://acme.example/work");
  assert.equal(parseInquiry(validBody({ link: "javascript:alert(1)" })).value.link, "", "only http and https survive");
  assert.equal(parseInquiry(validBody({ source: "../etc/passwd" })).value.source, "direct");
  assert.equal(parseInquiry(validBody({ lang: "de" })).value.lang, "en");
});

test("stranger's text is cleaned, capped, and kept as plain text", () => {
  const hostile = "Hello\u0000\u0007 \u202Eevil\u202C\u2066x\u2069" + "a".repeat(5000);
  const parsed = parseInquiry(validBody({ problem: hostile, name: `  Alex\n\tRivera  ` }));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.name, "Alex Rivera");
  assert.ok(parsed.value.problem.length <= INQUIRY_LIMITS.problem);
  assert.doesNotMatch(parsed.value.problem, /[\u0000-\u0008\u202A-\u202E\u2066-\u2069]/);

  const persian = parseInquiry(validBody({
    name: "سارا احمدی",
    company: "شرکت نمونه",
    contact: "۰۹۱۲۳۴۵۶۷۸۹",
    problem: "فرم سفارش\u200Cهای ما\u200Cخراب است.\n\n\n\nلطفاً کمک کنید."
  }));
  assert.equal(persian.ok, true);
  assert.match(persian.value.problem, /سفارش\u200Cهای ما\u200Cخراب/, "the zero-width non-joiner is part of the language");
  assert.equal(persian.value.problem.includes("\n\n\n"), false, "runs of blank lines are collapsed");

  const emoji = parseInquiry(validBody({ problem: `${"x".repeat(INQUIRY_LIMITS.problem - 1)}😀` }));
  const last = emoji.value.problem.charCodeAt(emoji.value.problem.length - 1);
  assert.equal(last >= 0xd800 && last <= 0xdbff, false, "a cut never leaves half an emoji");

  for (const body of [null, "text", 5, [], [{ name: "x" }]]) assert.equal(parseInquiry(body).ok, false);
  assert.equal(parseInquiry(validBody({ name: { toString: "x" }, company: ["Acme"] })).ok, false, "only strings count");
});

test("only the listed sites may call, and anything else is refused before it is read", async () => {
  const hq = await startServer();
  try {
    for (const origin of ["https://evil.example", "http://example.com", "https://example.com.evil.example", "null", null]) {
      const response = await hq.send(validBody(), { origin });
      assert.equal(response.status, 403, `origin ${origin}`);
      assert.equal(response.headers.get("access-control-allow-origin"), null);
    }
    assert.equal((await hq.send(validBody(), { origin: "https://www.example.com" })).status, 201);
    assert.equal(hq.companies().length, 1);

    const preflight = await hq.send(null, { method: "OPTIONS", headers: { "access-control-request-method": "POST" } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), SITE);
    assert.equal(preflight.headers.get("access-control-allow-methods"), "POST");
    const foreignPreflight = await hq.send(null, { method: "OPTIONS", origin: "https://evil.example" });
    assert.equal(foreignPreflight.status, 403);
  } finally {
    await hq.stop();
  }
});

test("wrong methods, content types, sizes and bodies get plain refusals", async () => {
  const hq = await startServer();
  try {
    const wrongMethod = await hq.send(null, { method: "GET" });
    assert.equal(wrongMethod.status, 405);
    assert.match(wrongMethod.headers.get("allow"), /POST/);

    const form = await hq.send(null, { raw: "name=Alex", headers: { "content-type": "application/x-www-form-urlencoded" } });
    assert.equal(form.status, 415);

    const notJson = await hq.send(null, { raw: "{not json" });
    assert.equal(notJson.status, 400);
    assert.equal((await notJson.json()).error.code, "invalid_json");

    const huge = await hq.send(null, { raw: JSON.stringify(validBody({ problem: "x".repeat(INQUIRY_LIMITS.bodyBytes) })) });
    assert.equal(huge.status, 413);

    const unknown = await fetch(`${hq.base}/public/anything-else`, { method: "POST", headers: { origin: SITE, "content-type": "application/json" }, body: "{}" });
    assert.equal(unknown.status, 404);
    assert.equal(hq.companies().length, 0);
  } finally {
    await hq.stop();
  }
});

test("a script that fills the hidden field is told it worked and nothing happens", async () => {
  const hq = await startServer();
  try {
    const response = await hq.send(validBody({ extra_note: "http://spam.example" }));
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(hq.companies().length, 0);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(hq.messages.length, 0);
  } finally {
    await hq.stop();
  }
});

test("the same person writing again is one company, and a retry is one inquiry", async () => {
  const hq = await startServer();
  try {
    await hq.send(validBody());
    await hq.send(validBody()); // a retry after a slow connection
    assert.equal(hq.companies().length, 1);
    assert.equal(hq.companies()[0].timeline.filter((event) => event.type === "inquiry").length, 1);

    await hq.send(validBody({ problem: "Separately: our booking page is slow on phones." }));
    assert.equal(hq.companies().length, 1, "same company and same contact");
    assert.equal(hq.companies()[0].timeline.filter((event) => event.type === "inquiry").length, 2);

    await hq.settle();
    assert.equal(hq.messages.length, 2, "the retry did not tell the owner twice");
    assert.match(hq.messages[1], /already on file/);
  } finally {
    await hq.stop();
  }
});

test("typing a client's name never writes into the client's record", async () => {
  const hq = await startServer({
    seed(store) {
      store.createCompany({ name: "Sample Studio", kind: "client", stage: "active", contactEmail: "boss@sampleStudio.example", nextAction: "Send the update", nextActionOn: "2030-01-01", actorId: "owner" });
    }
  });
  try {
    const before = hq.companies().find((company) => company.name === "Sample Studio");
    const response = await hq.send(validBody({ company: "Sample Studio", name: "Eve", contact: "eve@elsewhere.example" }));
    assert.equal(response.status, 201);

    const after = hq.companies().find((company) => company.name === "Sample Studio");
    assert.deepEqual(after, before, "the client's record is untouched");
    const lead = hq.companies().find((company) => company.name === "Sample Studio (Eve)");
    assert.ok(lead, "the stranger gets a company of their own");
    assert.equal(lead.stage, "lead");

    await hq.send(validBody({ company: "Sample Studio", name: "Eve", contact: "eve2@elsewhere.example" }));
    assert.ok(hq.companies().find((company) => company.name === "Sample Studio (Eve) 2"), "and a second stranger gets another");
    assert.equal(hq.companies().length, 3);
  } finally {
    await hq.stop();
  }
});

test("someone already on file keeps their own next step", async () => {
  const hq = await startServer({
    seed(store) {
      store.createCompany({ name: "Acme Logistics", kind: "client", stage: "active", contactEmail: "alex@acme.example", nextAction: "Send the invoice", nextActionOn: "2030-02-02", actorId: "owner" });
    }
  });
  try {
    assert.equal((await hq.send(validBody())).status, 201);
    const [company] = hq.companies();
    assert.equal(company.stage, "active");
    assert.equal(company.nextAction, "Send the invoice", "an inquiry does not replace a commitment");
    assert.equal(company.timeline.filter((event) => event.type === "inquiry").length, 1);
  } finally {
    await hq.stop();
  }
});

test("a failed Telegram message never fails the inquiry", async () => {
  const hq = await startServer({ notifyInquiry: async () => { throw new Error("Telegram is down"); } });
  try {
    const response = await hq.send(validBody());
    assert.equal(response.status, 201);
    assert.equal(hq.companies().length, 1, "the lead is saved before anyone is told");
  } finally {
    await hq.stop();
  }
});

test("a burst tells the owner a few times, then once, and every inquiry is still saved", async () => {
  const told = [];
  const hq = await startServer({
    inquiryLimiter: createInquiryLimiter({ perAddress: 100, perHour: 100 }),
    notifyInquiry: async (message) => { told.push(message); }
  });
  try {
    for (let index = 0; index < 14; index += 1) {
      const response = await hq.send(validBody({ company: `Company ${index}`, contact: `person${index}@example.com` }));
      assert.equal(response.status, 201);
    }
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(hq.companies().length, 14);
    assert.equal(told.length, 11, "ten inquiries, then a single notice");
    assert.match(told[10], /arriving faster than usual/);
  } finally {
    await hq.stop();
  }
});

test("a flood is slowed down with a clear wait, not an error page", async () => {
  const hq = await startServer({ inquiryLimiter: createInquiryLimiter({ perAddress: 2, perHour: 60 }) });
  try {
    assert.equal((await hq.send(validBody({ company: "One" }))).status, 201);
    assert.equal((await hq.send(validBody({ company: "Two" }))).status, 201);
    const limited = await hq.send(validBody({ company: "Three" }));
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("retry-after")) >= 1);
    const { error } = await limited.json();
    assert.equal(error.code, "rate_limited");
    assert.equal(hq.companies().length, 2);

    // Another address (as the local proxy reports it) has its own allowance.
    assert.equal((await hq.send(validBody({ company: "Four" }), { headers: { "x-real-ip": "203.0.113.9" } })).status, 201);
  } finally {
    await hq.stop();
  }
});

test("the limiter forgets as the window moves and counts only what it let in", () => {
  let moment = 1_000_000;
  const limiter = createInquiryLimiter({ perAddress: 2, perHour: 3, windowMs: 1000, now: () => moment });
  assert.equal(limiter.take("a").allowed, true);
  assert.equal(limiter.take("a").allowed, true);
  const refused = limiter.take("a");
  assert.equal(refused.allowed, false);
  assert.equal(refused.retryAfterSeconds, 1);
  assert.equal(limiter.take("b").allowed, true);
  assert.equal(limiter.take("c").allowed, false, "the whole site is capped too");
  moment += 1001;
  assert.equal(limiter.take("a").allowed, true, "the window has moved on");
  assert.equal(limiter.take("c").allowed, true);
});

test("opening the public door does not open anything else", async () => {
  const hq = await startServer({ authRequired: true });
  try {
    assert.equal((await hq.send(validBody())).status, 201);
    assert.equal(hq.companies().length, 1);

    for (const pathname of ["/api/workspaces", "/api/paperwork", "/api/tasks", "/api/auth/members"]) {
      const response = await fetch(`${hq.base}${pathname}`, { headers: { origin: SITE } });
      assert.equal(response.status, 403, `${pathname} still refuses a cross-origin caller`);
    }
    for (const pathname of ["/api/workspaces", "/api/paperwork", "/api/tasks"]) {
      const response = await fetch(`${hq.base}${pathname}`);
      assert.equal(response.status, 401, `${pathname} still needs a sign-in`);
    }
  } finally {
    await hq.stop();
  }
});
