import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createInvoiceStore } from "../src/invoice-store.js";
import { createMoneyStore } from "../src/money-store.js";
import { createWorkspaceStore } from "../src/workspace-store.js";

async function withStores(run) {
  const directory = await mkdtemp(path.join(tmpdir(), "agent4-invoice-"));
  const databasePath = path.join(directory, "books.sqlite");
  const money = createMoneyStore(databasePath);
  const invoices = createInvoiceStore(databasePath, { money });
  try {
    await run({ invoices, money });
  } finally {
    invoices.close();
    money.close();
    await rm(directory, { recursive: true, force: true });
  }
}

/** The same three stores the server runs, sharing one file, so a company link can be checked. */
async function withWorkspace(run) {
  const directory = await mkdtemp(path.join(tmpdir(), "agent4-invoice-company-"));
  const databasePath = path.join(directory, "books.sqlite");
  const workspace = createWorkspaceStore(databasePath);
  const money = createMoneyStore(databasePath);
  const invoices = createInvoiceStore(databasePath, { money });
  try {
    await run({ invoices, money, workspace });
  } finally {
    invoices.close();
    money.close();
    workspace.close();
    await rm(directory, { recursive: true, force: true });
  }
}

const draft = {
  clientName: "Parsian",
  currency: "IRR",
  issueOn: "2026-08-04",
  dueOn: "2026-09-03",
  actorId: "owner-1",
  lines: [
    { description: "Website redesign", quantity: 1, unitPrice: 180000000 },
    { description: "Extra pages", quantity: 3, unitPrice: 20000000 }
  ]
};

test("an invoice totals its lines", async () => {
  await withStores(({ invoices }) => {
    const invoice = invoices.createInvoice(draft);
    assert.equal(invoice.status, "draft");
    assert.equal(invoice.lines.length, 2);
    assert.equal(invoice.lines[1].amount, 60000000, "quantity multiplies the unit price");
    assert.equal(invoice.total, 240000000);
    assert.match(invoice.number, /^\d{4}-001$/);
  });
});

test("invoice numbers run in sequence within a year", async () => {
  await withStores(({ invoices }) => {
    const first = invoices.createInvoice(draft);
    const second = invoices.createInvoice(draft);
    assert.equal(Number(second.number.split("-")[1]), Number(first.number.split("-")[1]) + 1);
  });
});

test("a draft is not in the books until it is sent", async () => {
  await withStores(({ invoices, money }) => {
    invoices.createInvoice(draft);
    assert.equal(money.listEntries({}).length, 0, "an unsent invoice promises nothing");
  });
});

test("sending an invoice promises the money, paying settles it", async () => {
  await withStores(({ invoices, money }) => {
    const invoice = invoices.createInvoice(draft);

    const sent = invoices.setStatus(invoice.id, "sent");
    assert.equal(sent.status, "sent");
    assert.ok(sent.entryId, "a sent invoice is linked to its entry");
    const [promised] = money.listEntries({});
    assert.equal(promised.status, "pending");
    assert.equal(promised.amount, 240000000);
    assert.equal(promised.counterparty, "Parsian");
    assert.equal(promised.dueOn, "2026-09-03");
    assert.match(promised.note, /Invoice \d{4}-001/);

    let totals = money.summary({ month: "2026-08", today: new Date("2026-08-20T00:00:00Z") }).currencies[0];
    assert.equal(totals.in, 0, "promised money has not arrived");
    assert.equal(totals.outstanding, 240000000);

    invoices.setStatus(invoice.id, "paid", { paidOn: "2026-08-18" });
    totals = money.summary({ month: "2026-08", today: new Date("2026-08-20T00:00:00Z") }).currencies[0];
    assert.equal(totals.in, 240000000, "paying settles the same entry");
    assert.equal(totals.outstanding, 0);
    assert.equal(money.listEntries({}).length, 1, "settling must not create a second entry");
  });
});

test("pulling an invoice back withdraws the promise from the books", async () => {
  await withStores(({ invoices, money }) => {
    const invoice = invoices.createInvoice(draft);
    invoices.setStatus(invoice.id, "sent");
    assert.equal(money.listEntries({}).length, 1);

    const back = invoices.setStatus(invoice.id, "draft");
    assert.equal(back.entryId, null);
    assert.equal(money.listEntries({}).length, 0, "an unsent invoice leaves no trace in the books");
  });
});

test("voiding an invoice removes it from the books but keeps the record", async () => {
  await withStores(({ invoices, money }) => {
    const invoice = invoices.createInvoice(draft);
    invoices.setStatus(invoice.id, "sent");
    const voided = invoices.setStatus(invoice.id, "void");
    assert.equal(voided.status, "void");
    assert.equal(money.listEntries({}).length, 0);
    assert.ok(invoices.getInvoice(invoice.id), "the invoice itself is still on file");
  });
});

test("editing a sent invoice keeps the books in step", async () => {
  await withStores(({ invoices, money }) => {
    const invoice = invoices.createInvoice(draft);
    invoices.setStatus(invoice.id, "sent");

    invoices.updateInvoice(invoice.id, {
      lines: [{ description: "Website redesign", quantity: 1, unitPrice: 300000000 }],
      clientName: "Parsian Co"
    });

    const [entry] = money.listEntries({});
    assert.equal(entry.amount, 300000000, "the promise follows the invoice");
    assert.equal(entry.counterparty, "Parsian Co");
    assert.equal(money.listEntries({}).length, 1);
  });
});

test("a paid invoice cannot be quietly edited", async () => {
  await withStores(({ invoices }) => {
    const invoice = invoices.createInvoice(draft);
    invoices.setStatus(invoice.id, "paid");
    assert.throws(() => invoices.updateInvoice(invoice.id, { clientName: "Someone else" }), /cannot be edited/);
  });
});

test("deleting an invoice takes its entry with it", async () => {
  await withStores(({ invoices, money }) => {
    const invoice = invoices.createInvoice(draft);
    invoices.setStatus(invoice.id, "sent");
    assert.equal(invoices.removeInvoice(invoice.id), true);
    assert.equal(money.listEntries({}).length, 0);
    assert.equal(invoices.removeInvoice(invoice.id), false);
  });
});

test("empty and nonsense invoices are refused", async () => {
  await withStores(({ invoices }) => {
    assert.throws(() => invoices.createInvoice({ ...draft, clientName: "" }), /needs a client/);
    assert.throws(() => invoices.createInvoice({ ...draft, lines: [] }), /at least one line/);
    assert.throws(() => invoices.createInvoice({ ...draft, currency: "TOMAN" }), /three-letter code/);
    assert.throws(
      () => invoices.createInvoice({ ...draft, lines: [{ description: "Work", quantity: 0, unitPrice: 10 }] }),
      /quantity above zero/
    );
  });
});

test("an invoice worth nothing cannot be sent", async () => {
  await withStores(({ invoices }) => {
    const invoice = invoices.createInvoice({
      ...draft,
      lines: [{ description: "Goodwill", quantity: 1, unitPrice: 0 }]
    });
    assert.throws(() => invoices.setStatus(invoice.id, "sent"), /no value cannot be sent/);
  });
});

test("the company profile keeps one name, a tax id, and a unit label", async () => {
  await withStores(({ invoices }) => {
    const profile = invoices.setProfile({
      name: "Your company",
      payToFa: "بانک ملت",
      payTo: "Bank Mellat 1234",
      taxId: "TR 1234567890",
      unitLabels: { IRR: { fa: "تومان", en: "Toman", divisor: 10 } }
    });
    assert.equal(profile.name, "Your company", "a company name is a brand, not something to translate");
    assert.equal(profile.payToFa, "بانک ملت", "payment details still carry both languages");
    assert.equal(profile.taxId, "TR 1234567890", "an invoice meant for a tax return carries the number it is filed under");
    assert.equal(profile.unitLabels.IRR.en, "Toman");
    assert.equal(invoices.getProfile().payTo, "Bank Mellat 1234");
  });
});

test("an invoice is written in one language, not two", async () => {
  await withStores(({ invoices }) => {
    const english = invoices.createInvoice(draft);
    assert.equal(english.language, "en", "English unless asked otherwise");

    const persian = invoices.createInvoice({ ...draft, language: "fa" });
    assert.equal(persian.language, "fa");

    const switched = invoices.updateInvoice(english.id, { language: "fa" });
    assert.equal(switched.language, "fa", "an invoice can change language before it goes out");

    const nonsense = invoices.createInvoice({ ...draft, language: "klingon" });
    assert.equal(nonsense.language, "en", "an unknown language falls back rather than breaking the document");
  });
});

test("the currency label is kept per language, and never renames the currency", async () => {
  await withStores(({ invoices }) => {
    assert.deepEqual(
      invoices.getProfile().unitLabels.IRR,
      { fa: "ریال", en: "Rial", divisor: 1 },
      "IRR is rials, and calling them tomans prints ten times the price"
    );

    const profile = invoices.setProfile({
      unitLabels: { IRR: { fa: "تومان", en: "Toman", divisor: 10 }, EUR: { fa: "یورو", en: "EUR" } }
    });
    assert.equal(profile.unitLabels.EUR.fa, "یورو");
    assert.equal(profile.unitLabels.EUR.divisor, 1, "a unit with no divisor is the currency itself");

    const invoice = invoices.createInvoice({ ...draft, lines: [{ description: "Website", quantity: 1, unitPrice: 180000000 }] });
    assert.equal(invoice.total, 180000000, "the books keep rials whatever the invoice prints");
    assert.equal(invoice.displayUnit.divisor, 10);
    assert.equal(invoice.displayTotal, 18000000, "eighteen million tomans is the same money as a hundred and eighty million rials");
    assert.equal(invoice.displayUnit.en, "Toman");

    assert.throws(() => invoices.setProfile({ unitLabels: { IRR: { en: "Toman", divisor: 0 } } }), /divisor above zero/);
    assert.throws(() => invoices.setProfile({ unitLabels: { TOMAN: { en: "Toman" } } }), /three-letter code/);
  });
});

test("payment is dated by when the money arrived, not when the invoice was raised", async () => {
  await withStores(({ invoices, money }) => {
    const invoice = invoices.createInvoice({ ...draft, issueOn: "2026-06-04", dueOn: "2026-07-04" });
    invoices.setStatus(invoice.id, "sent");

    const paid = invoices.setStatus(invoice.id, "paid", { paidOn: "2026-09-02" });
    assert.equal(paid.paidOn, "2026-09-02", "the invoice remembers the day it was settled");
    const [entry] = money.listEntries({});
    assert.equal(entry.occurredOn, "2026-09-02", "June's books must not swallow September's money");
    assert.equal(entry.status, "settled");
    assert.equal(money.summary({ month: "2026-06", today: new Date("2026-09-10T00:00:00Z") }).currencies.length, 0, "June's books hold nothing at all");
    assert.equal(money.summary({ month: "2026-09", today: new Date("2026-09-10T00:00:00Z") }).currencies[0].in, 240000000);

    const reopened = invoices.setStatus(invoice.id, "sent");
    assert.equal(reopened.paidOn, null, "an invoice pulled back is no longer paid on any day");
  });
});

test("payment with no date given is dated today, not the issue date", async () => {
  await withStores(({ invoices }) => {
    const invoice = invoices.createInvoice({ ...draft, issueOn: "2026-06-04" });
    const paid = invoices.setStatus(invoice.id, "paid");
    assert.notEqual(paid.paidOn, "2026-06-04");
    assert.match(paid.paidOn, /^\d{4}-\d{2}-\d{2}$/);
  });
});

test("emptying an invoice that is already in the books changes nothing", async () => {
  await withStores(({ invoices, money }) => {
    const invoice = invoices.createInvoice(draft);
    invoices.setStatus(invoice.id, "sent");

    assert.throws(
      () => invoices.updateInvoice(invoice.id, { lines: [], clientName: "Parsian Co" }),
      /must keep a value above zero/
    );

    const untouched = invoices.getInvoice(invoice.id);
    assert.equal(untouched.lines.length, 2, "the invoice is left exactly as it was");
    assert.equal(untouched.total, 240000000);
    assert.equal(untouched.clientName, "Parsian", "a rejected edit changes nothing at all");
    assert.equal(money.listEntries({})[0].amount, 240000000, "the books are untouched too");
  });
});

test("an entry an invoice raised cannot be deleted out from under it", async () => {
  await withStores(({ invoices, money }) => {
    const invoice = invoices.createInvoice(draft);
    const sent = invoices.setStatus(invoice.id, "sent");

    assert.throws(() => money.removeEntry(sent.entryId), /Void or delete that invoice instead/);
    assert.equal(money.listEntries({}).length, 1, "refusing loses nothing, where unlinking would lose a sent invoice's place in the books");
    assert.equal(invoices.getInvoice(invoice.id).entryId, sent.entryId);

    const paid = invoices.setStatus(invoice.id, "paid", { paidOn: "2026-08-20" });
    assert.equal(paid.status, "paid", "the next status change still works instead of failing on an entry that is gone");

    invoices.setStatus(invoice.id, "void");
    assert.equal(money.listEntries({}).length, 0, "voiding the invoice is how the entry goes");
  });
});

test("invoice numbers keep counting past a thousand", async () => {
  await withStores(({ invoices }) => {
    const year = invoices.nextNumber().split("-")[0];
    invoices.createInvoice({ ...draft, number: `${year}-999` });
    assert.equal(invoices.nextNumber(), `${year}-1000`);

    const thousandth = invoices.createInvoice({ ...draft, number: invoices.nextNumber() });
    assert.equal(thousandth.number, `${year}-1000`);
    assert.equal(invoices.nextNumber(), `${year}-1001`, "sorted as text, 1000 falls below 999 and a used number would be issued again");

    const next = invoices.createInvoice(draft);
    assert.equal(next.number, `${year}-1001`);
  });
});

test("tax is set per invoice, because Turkey and Iran are not the same paperwork", async () => {
  await withStores(({ invoices, money }) => {
    const turkish = invoices.createInvoice({
      ...draft,
      currency: "TRY",
      taxRate: 20,
      taxLabel: "KDV",
      lines: [{ description: "Website redesign", quantity: 1, unitPrice: 1000 }]
    });
    assert.equal(turkish.subtotal, 1000);
    assert.equal(turkish.taxRate, 20);
    assert.equal(turkish.taxLabel, "KDV");
    assert.equal(turkish.taxAmount, 200);
    assert.equal(turkish.total, 1200, "the total is what the client actually pays");

    const iranian = invoices.createInvoice({ ...draft, taxRate: 9, taxLabel: "VAT" });
    assert.equal(iranian.taxAmount, 21600000);
    assert.equal(iranian.total, 261600000);

    const untaxed = invoices.createInvoice(draft);
    assert.equal(untaxed.taxRate, 0, "no tax unless the invoice says so");
    assert.equal(untaxed.total, untaxed.subtotal);

    invoices.setStatus(turkish.id, "sent");
    assert.equal(money.listEntries({ direction: "in" })[0].amount, 1200, "the books hold the gross, which is the money that moves");

    const lowered = invoices.updateInvoice(turkish.id, { taxRate: 10 });
    assert.equal(lowered.total, 1100);
    assert.equal(money.listEntries({ direction: "in" })[0].amount, 1100, "changing the rate keeps the books in step");

    assert.throws(() => invoices.createInvoice({ ...draft, taxRate: 140 }), /between 0 and 100/);
  });
});

test("an invoice knows it is late without anyone storing that it is", async () => {
  await withStores(({ invoices }) => {
    const late = invoices.createInvoice({ ...draft, issueOn: "2026-08-01", dueOn: "2026-08-10" });
    invoices.setStatus(late.id, "sent");
    const soon = invoices.createInvoice({ ...draft, issueOn: "2026-09-01", dueOn: "2099-01-01" });
    invoices.setStatus(soon.id, "sent");
    const unsent = invoices.createInvoice({ ...draft, issueOn: "2026-09-05", dueOn: "2026-08-10" });

    const today = new Date("2026-09-14T09:00:00Z");
    const [first, ...rest] = invoices.listInvoices({ today });
    assert.equal(first.id, late.id, "late money is what needs a person today");
    assert.equal(first.overdue, true);
    assert.equal(first.daysOverdue, 35);
    assert.equal(rest.every((invoice) => invoice.overdue === false), true);
    assert.equal(invoices.getInvoice(unsent.id, { today }).overdue, false, "a draft is not late; nobody has asked for the money yet");
    assert.equal(invoices.getInvoice(soon.id, { today }).daysOverdue, 0);

    invoices.setStatus(late.id, "paid", { paidOn: "2026-09-14" });
    assert.equal(invoices.getInvoice(late.id, { today }).overdue, false, "money that arrived is not late");
  });
});

test("the invoice list can be asked for one company, or for the ones with none", async () => {
  await withWorkspace(({ invoices, workspace }) => {
    const client = workspace.ensureCompany({ id: "project", name: "SampleProject", actorId: "owner" });
    const other = workspace.ensureCompany({ id: "example-metals", name: "Kavir", actorId: "owner" });
    const theirs = invoices.createInvoice({ ...draft, companyId: client.id });
    invoices.createInvoice({ ...draft, companyId: other.id });
    const loose = invoices.createInvoice(draft);

    assert.deepEqual(invoices.listInvoices({ companyId: "project" }).map((invoice) => invoice.id), [theirs.id]);
    assert.deepEqual(invoices.listInvoices({ companyId: "none" }).map((invoice) => invoice.id), [loose.id], "the set a person goes looking for to fix");
    assert.equal(invoices.listInvoices({}).length, 3);

    invoices.setStatus(theirs.id, "sent");
    assert.equal(invoices.listInvoices({ companyId: "project", status: "sent" }).length, 1, "the two filters narrow together");
    assert.equal(invoices.listInvoices({ companyId: "project", status: "draft" }).length, 0);
    assert.equal(invoices.listInvoices({ companyId: "nobody" }).length, 0);
  });
});

test("an entry an invoice raised takes its company from that invoice, and only from there", async () => {
  await withWorkspace(({ invoices, money, workspace }) => {
    const client = workspace.ensureCompany({ id: "project", name: "SampleProject", actorId: "owner" });
    const other = workspace.ensureCompany({ id: "example-metals", name: "Kavir", actorId: "owner" });
    const invoice = invoices.createInvoice({ ...draft, companyId: client.id });
    invoices.setStatus(invoice.id, "sent");
    const entryId = invoices.getInvoice(invoice.id).entryId;
    assert.equal(money.listEntries({})[0].companyId, "project", "sending an invoice files its money against the same company");

    assert.throws(
      () => money.updateEntry(entryId, { companyId: other.id }),
      /Change the company on that invoice instead/,
      "the money row and the invoice that raised it must not drift apart"
    );
    assert.throws(() => money.updateEntry(entryId, { companyId: "" }), /Change the company on that invoice instead/);
    assert.equal(money.listEntries({})[0].companyId, "project", "the refused edit changed nothing");

    assert.equal(money.updateEntry(entryId, { note: "Chased twice" }).note, "Chased twice", "everything else about the entry is still editable");

    invoices.updateInvoice(invoice.id, { companyId: other.id });
    assert.equal(money.listEntries({})[0].companyId, "example-metals", "changing it on the invoice carries through to the books");
    assert.equal(invoices.listInvoices({ companyId: "example-metals" }).length, 1);
  });
});
