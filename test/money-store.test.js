import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createMoneyStore } from "../src/money-store.js";
import { createWorkspaceStore } from "../src/workspace-store.js";

async function withStore(run) {
  const directory = await mkdtemp(path.join(tmpdir(), "agent4-money-"));
  const store = createMoneyStore(path.join(directory, "money.sqlite"));
  try {
    await run(store);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
}

/** The money record and the workspace share one file, which is how a company link can be checked. */
async function withWorkspace(run) {
  const directory = await mkdtemp(path.join(tmpdir(), "agent4-money-company-"));
  const databasePath = path.join(directory, "hq.sqlite");
  const workspace = createWorkspaceStore(databasePath);
  const store = createMoneyStore(databasePath);
  try {
    await run({ store, workspace });
  } finally {
    store.close();
    workspace.close();
    await rm(directory, { recursive: true, force: true });
  }
}

const income = {
  direction: "in",
  amount: 240,
  currency: "IRR",
  category: "client",
  occurredOn: "2026-08-04",
  counterparty: "Parsian",
  actorId: "owner-1"
};

test("entries round-trip with amounts intact", async () => {
  await withStore((store) => {
    const entry = store.addEntry({ ...income, amount: 240.55, note: "Phase one" });
    assert.equal(entry.amount, 240.55);
    assert.equal(entry.currency, "IRR");
    assert.equal(entry.status, "settled");
    assert.equal(entry.counterparty, "Parsian");
    assert.equal(entry.createdBy, "owner-1");
    assert.equal(store.listEntries({ month: "2026-08" }).length, 1);
  });
});

test("repeated small amounts do not drift the way floats do", async () => {
  await withStore((store) => {
    for (let index = 0; index < 3; index += 1) {
      store.addEntry({ ...income, amount: 0.1, occurredOn: "2026-08-05" });
    }
    const [totals] = store.summary({ month: "2026-08", today: new Date("2026-08-20T00:00:00Z") }).currencies;
    assert.equal(totals.in, 0.3);
  });
});

test("currencies are reported separately and never summed together", async () => {
  await withStore((store) => {
    store.addEntry({ ...income, amount: 240, currency: "IRR" });
    store.addEntry({ ...income, amount: 50, currency: "EUR", counterparty: "Hetzner", direction: "out", category: "running" });
    store.addEntry({ ...income, amount: 20, currency: "USD", counterparty: "OpenAI", direction: "out", category: "running" });

    const { currencies } = store.summary({ month: "2026-08", today: new Date("2026-08-20T00:00:00Z") });
    const byCode = new Map(currencies.map((bucket) => [bucket.currency, bucket]));
    assert.equal(currencies.length, 3);
    assert.equal(byCode.get("IRR").in, 240);
    assert.equal(byCode.get("IRR").out, 0);
    assert.equal(byCode.get("EUR").out, 50);
    assert.equal(byCode.get("EUR").net, -50);
    assert.equal(byCode.get("USD").out, 20);
  });
});

test("spending is broken down by what it was for", async () => {
  await withStore((store) => {
    const base = { ...income, direction: "out", currency: "IRR", occurredOn: "2026-08-09" };
    store.addEntry({ ...base, amount: 100, category: "people" });
    store.addEntry({ ...base, amount: 40, category: "running" });
    store.addEntry({ ...base, amount: 25, category: "contractor" });
    store.addEntry({ ...base, amount: 10, category: "billable" });

    const [totals] = store.summary({ month: "2026-08", today: new Date("2026-08-20T00:00:00Z") }).currencies;
    assert.equal(totals.out, 175);
    assert.deepEqual(totals.spend, { people: 100, running: 40, contractor: 25, billable: 10 });
  });
});

test("unpaid invoices count as outstanding, and late ones as overdue", async () => {
  await withStore((store) => {
    store.addEntry({ ...income, amount: 85, status: "pending", dueOn: "2026-08-25" });
    store.addEntry({ ...income, amount: 45, status: "pending", dueOn: "2026-08-01" });

    const [totals] = store.summary({ month: "2026-08", today: new Date("2026-08-13T00:00:00Z") }).currencies;
    assert.equal(totals.in, 0, "pending money has not actually arrived");
    assert.equal(totals.outstanding, 130);
    assert.equal(totals.overdue, 45);
    assert.equal(totals.overdueCount, 1);
  });
});

test("money owed from an earlier month still shows as outstanding today", async () => {
  await withStore((store) => {
    store.addEntry({ ...income, amount: 60, occurredOn: "2026-03-02", status: "pending", dueOn: "2026-03-20" });
    const [totals] = store.summary({ month: "2026-08", today: new Date("2026-08-13T00:00:00Z") }).currencies;
    assert.equal(totals.outstanding, 60);
    assert.equal(totals.overdue, 60);
  });
});

test("settling an invoice moves it into the month and drops its due date", async () => {
  await withStore((store) => {
    const pending = store.addEntry({ ...income, amount: 45, status: "pending", dueOn: "2026-08-01" });
    const settled = store.updateEntry(pending.id, { status: "settled" });
    assert.equal(settled.status, "settled");
    assert.equal(settled.dueOn, null);

    const [totals] = store.summary({ month: "2026-08", today: new Date("2026-08-13T00:00:00Z") }).currencies;
    assert.equal(totals.in, 45);
    assert.equal(totals.outstanding, 0);
    assert.equal(totals.overdue, 0);
  });
});

test("nonsense entries are refused", async () => {
  await withStore((store) => {
    assert.throws(() => store.addEntry({ ...income, amount: 0 }), /cannot be zero/);
    assert.throws(() => store.addEntry({ ...income, currency: "RIAL" }), /three-letter code/);
    assert.throws(() => store.addEntry({ ...income, occurredOn: "04-08-2026" }), /YYYY-MM-DD/);
    assert.throws(() => store.addEntry({ ...income, direction: "sideways" }), /in or out/);
    assert.throws(
      () => store.addEntry({ ...income, direction: "out", category: "client" }),
      /not valid for money out/,
      "income categories must not be usable for spending"
    );
  });
});

test("entries can be corrected and removed", async () => {
  await withStore((store) => {
    const entry = store.addEntry(income);
    const fixed = store.updateEntry(entry.id, { amount: 300, counterparty: "Parsian Co" });
    assert.equal(fixed.amount, 300);
    assert.equal(fixed.counterparty, "Parsian Co");
    assert.ok(fixed.updatedAt);

    assert.equal(store.removeEntry(entry.id), true);
    assert.equal(store.removeEntry(entry.id), false);
    assert.equal(store.listEntries({}).length, 0);
  });
});

test("standing costs forecast a monthly figure per currency", async () => {
  await withStore((store) => {
    store.addRecurring({ direction: "out", amount: 42, currency: "EUR", category: "running", cadence: "monthly", counterparty: "Hetzner", actorId: "owner-1" });
    store.addRecurring({ direction: "out", amount: 120, currency: "EUR", category: "running", cadence: "yearly", counterparty: "Domains", actorId: "owner-1" });
    store.addRecurring({ direction: "out", amount: 20, currency: "USD", category: "running", cadence: "monthly", counterparty: "OpenAI", actorId: "owner-1" });

    const commitments = store.monthlyCommitments();
    const byCode = new Map(commitments.map((item) => [item.currency, item.amount]));
    assert.equal(byCode.get("EUR"), 52, "yearly costs are spread across twelve months");
    assert.equal(byCode.get("USD"), 20);

    const [stopped] = store.listRecurring();
    assert.equal(store.stopRecurring(stopped.id), true);
    assert.equal(store.stopRecurring(stopped.id), false);
    assert.equal(store.listRecurring().length, 2);
  });
});

test("listing filters by month, direction and status", async () => {
  await withStore((store) => {
    store.addEntry({ ...income, amount: 10, occurredOn: "2026-07-30" });
    store.addEntry({ ...income, amount: 20, occurredOn: "2026-08-02" });
    store.addEntry({ ...income, amount: 30, occurredOn: "2026-08-03", direction: "out", category: "running" });
    store.addEntry({ ...income, amount: 40, occurredOn: "2026-08-04", status: "pending", dueOn: "2026-09-01" });

    assert.equal(store.listEntries({ month: "2026-08" }).length, 3);
    assert.equal(store.listEntries({ month: "2026-07" }).length, 1);
    assert.equal(store.listEntries({ month: "2026-08", direction: "out" }).length, 1);
    assert.equal(store.listEntries({ month: "2026-08", status: "pending" }).length, 1);
  });
});

test("periods cover months, quarters and years", async () => {
  await withStore((store) => {
    assert.deepEqual(store.periodBounds("2026-02"), { from: "2026-02-01", to: "2026-02-28", granularity: "month" });
    assert.deepEqual(store.periodBounds("2024-02"), { from: "2024-02-01", to: "2024-02-29", granularity: "month" }, "leap years are real");
    assert.deepEqual(store.periodBounds("2026-Q3"), { from: "2026-07-01", to: "2026-09-30", granularity: "quarter" });
    assert.deepEqual(store.periodBounds("2026"), { from: "2026-01-01", to: "2026-12-31", granularity: "year" });
    assert.throws(() => store.periodBounds("2026-Q9"), /YYYY-MM/);
  });
});

test("a quarter adds up its months and attributes who paid", async () => {
  await withStore((store) => {
    store.addEntry({ ...income, amount: 100, occurredOn: "2026-07-04", counterparty: "Parsian" });
    store.addEntry({ ...income, amount: 50, occurredOn: "2026-08-04", counterparty: "Parsian" });
    store.addEntry({ ...income, amount: 25, occurredOn: "2026-09-04", counterparty: "Kavir" });
    store.addEntry({ ...income, amount: 30, occurredOn: "2026-10-04", counterparty: "Kavir" });
    store.addEntry({ ...income, amount: 20, direction: "out", category: "running", occurredOn: "2026-08-06", counterparty: "Hetzner" });

    const report = store.periodReport({ period: "2026-Q3", today: new Date("2026-10-20T00:00:00Z") });
    const [totals] = report.currencies;
    assert.equal(report.granularity, "quarter");
    assert.equal(totals.in, 175, "October is a different quarter");
    assert.equal(totals.out, 20);
    assert.equal(totals.net, 155);
    assert.deepEqual(totals.earners, [
      { companyId: null, name: "Parsian", amount: 150 },
      { companyId: null, name: "Kavir", amount: 25 }
    ], "biggest first, so the reader starts where the money is");
    assert.deepEqual(totals.payees, [{ companyId: null, name: "Hetzner", amount: 20 }]);
  });
});

test("a year rolls the quarters up", async () => {
  await withStore((store) => {
    store.addEntry({ ...income, amount: 100, occurredOn: "2026-02-04" });
    store.addEntry({ ...income, amount: 100, occurredOn: "2026-11-04" });
    store.addEntry({ ...income, amount: 999, occurredOn: "2025-11-04" });
    const [totals] = store.periodReport({ period: "2026", today: new Date("2026-12-01T00:00:00Z") }).currencies;
    assert.equal(totals.in, 200);
  });
});

test("the trend runs consecutive months even where nothing happened", async () => {
  await withStore((store) => {
    store.addEntry({ ...income, amount: 60, occurredOn: "2026-06-10" });
    store.addEntry({ ...income, amount: 40, direction: "out", category: "running", occurredOn: "2026-08-10" });

    const [track] = store.series({ months: 4, endMonth: "2026-08" });
    assert.equal(track.currency, "IRR");
    assert.deepEqual(track.points.map((point) => point.month), ["2026-05", "2026-06", "2026-07", "2026-08"]);
    assert.deepEqual(track.points.map((point) => point.net), [0, 60, 0, -40]);
  });
});

test("the trend crosses a year boundary without losing its place", async () => {
  await withStore((store) => {
    store.addEntry({ ...income, amount: 10, occurredOn: "2025-12-10" });
    const [track] = store.series({ months: 3, endMonth: "2026-02" });
    assert.deepEqual(track.points.map((point) => point.month), ["2025-12", "2026-01", "2026-02"]);
    assert.equal(track.points[0].in, 10);
  });
});

test("old money is restated into what it would be worth today", async () => {
  await withStore((store) => {
    store.setInflation("IRR", 0.4);
    assert.deepEqual(store.getSettings().inflation, { IRR: 0.4 });

    const today = new Date("2026-08-29T00:00:00Z");
    const lastYear = store.inTodaysMoney({ amount: 100, currency: "IRR", on: "2025-08-29", today });
    assert.equal(lastYear.adjusted, true);
    assert.ok(Math.abs(lastYear.amount - 140) < 0.2, `100 a year ago is about 140 today, got ${lastYear.amount}`);

    const now = store.inTodaysMoney({ amount: 100, currency: "IRR", on: "2026-08-29", today });
    assert.equal(now.amount, 100, "today's money is already today's money");
    assert.equal(now.adjusted, false);

    const untouched = store.inTodaysMoney({ amount: 100, currency: "EUR", on: "2025-08-29", today });
    assert.equal(untouched.adjusted, false, "a currency with no rate set is left alone");
    assert.equal(untouched.amount, 100);
  });
});

test("nominal growth can hide a real-terms decline", async () => {
  await withStore((store) => {
    store.setInflation("IRR", 0.4);
    const today = new Date("2026-08-29T00:00:00Z");
    const lastYear = store.inTodaysMoney({ amount: 100, currency: "IRR", on: "2025-08-29", today }).amount;
    const thisYear = 120;
    assert.ok(thisYear > 100, "nominally this looks like growth");
    assert.ok(thisYear < lastYear, "in today's money it is a decline");
  });
});

test("implausible inflation rates are refused", async () => {
  await withStore((store) => {
    assert.throws(() => store.setInflation("IRR", -0.1), /between 0 and 10/);
    assert.throws(() => store.setInflation("IRR", 50), /between 0 and 10/);
    assert.throws(() => store.setInflation("RIAL", 0.4), /three-letter code/);
  });
});

test("cash position combines the opening balance with everything settled", async () => {
  await withStore((store) => {
    store.setOpeningBalance("IRR", 500);
    store.addEntry({ ...income, amount: 200, occurredOn: "2026-08-02" });
    store.addEntry({ ...income, amount: 80, direction: "out", category: "running", occurredOn: "2026-08-03" });
    store.addEntry({ ...income, amount: 999, status: "pending", dueOn: "2026-09-01", occurredOn: "2026-08-04" });

    const [irr] = store.cashPosition({ today: new Date("2026-08-20T00:00:00Z") });
    assert.equal(irr.opening, 500);
    assert.equal(irr.cash, 620, "promised money is not cash until it arrives");
  });
});

test("runway measures whole months of spending, not the half-finished one", async () => {
  await withStore((store) => {
    store.setOpeningBalance("IRR", 900);
    const spend = { ...income, direction: "out", category: "running" };
    store.addEntry({ ...spend, amount: 100, occurredOn: "2026-05-10" });
    store.addEntry({ ...spend, amount: 100, occurredOn: "2026-06-10" });
    store.addEntry({ ...spend, amount: 100, occurredOn: "2026-07-10" });
    store.addEntry({ ...spend, amount: 900, occurredOn: "2026-08-02" });

    const [irr] = store.cashPosition({ today: new Date("2026-08-10T00:00:00Z"), burnMonths: 3 });
    assert.equal(irr.burn, 100, "August is still running and must not set the burn rate");
    assert.equal(irr.cash, -300);
    assert.equal(irr.runwayMonths, -3);
  });
});

test("runway is unknowable when nothing is being spent", async () => {
  await withStore((store) => {
    store.setOpeningBalance("IRR", 400);
    const [irr] = store.cashPosition({ today: new Date("2026-08-10T00:00:00Z") });
    assert.equal(irr.burn, 0);
    assert.equal(irr.runwayMonths, null, "dividing by no spending would invent a number");
  });
});

test("standing costs post the charges they already incurred, exactly once", async () => {
  await withStore((store) => {
    store.addRecurring({
      direction: "out", amount: 42.5, currency: "EUR", category: "running",
      cadence: "monthly", dayOfMonth: 5, counterparty: "Hetzner", actorId: "owner-1"
    });

    const first = store.postDueRecurring({ today: new Date("2026-11-20T00:00:00Z") });
    assert.ok(first.length >= 1, "charges since the cost was created are written in");
    assert.ok(first.every((entry) => entry.counterparty === "Hetzner"));
    assert.ok(first.every((entry) => entry.fromRecurring), "posted charges are traceable to their source");

    const again = store.postDueRecurring({ today: new Date("2026-11-20T00:00:00Z") });
    assert.equal(again.length, 0, "running it twice must not double-charge the books");

    const total = store.listEntries({ limit: 500 }).filter((entry) => entry.fromRecurring).length;
    assert.equal(total, first.length);
  });
});

test("a stopped standing cost posts nothing further", async () => {
  await withStore((store) => {
    const item = store.addRecurring({
      direction: "out", amount: 10, currency: "EUR", category: "running",
      cadence: "monthly", dayOfMonth: 5, counterparty: "Old tool", actorId: "owner-1"
    });
    store.stopRecurring(item.id);
    assert.equal(store.postDueRecurring({ today: new Date("2027-01-20T00:00:00Z") }).length, 0);
  });
});

test("the same client written two ways is still one client", async () => {
  await withStore((store) => {
    store.addEntry({ ...income, amount: 100, counterparty: "Parsian", occurredOn: "2026-08-02" });
    store.addEntry({ ...income, amount: 50, counterparty: "parsian", occurredOn: "2026-08-03" });
    store.addEntry({ ...income, amount: 5, counterparty: "", occurredOn: "2026-08-04" });
    const [totals] = store.periodReport({ period: "2026-08", today: new Date("2026-08-20T00:00:00Z") }).currencies;
    assert.deepEqual(totals.earners, [
      { companyId: null, name: "Parsian", amount: 150 },
      { companyId: null, name: "No name given", amount: 5 }
    ], "an entry nobody was named on says so, rather than borrowing the word for having no company");
  });
});

test("the export is a flat CSV an accountant can open", async () => {
  await withStore((store) => {
    store.addEntry({ ...income, amount: 240, occurredOn: "2026-08-04", note: 'Phase one, "final"' });
    const csv = store.exportCsv();
    const [header, row] = csv.split("\n");
    assert.equal(header, "date,direction,amount,currency,category,status,due,counterparty,note,auto");
    assert.match(row, /^2026-08-04,in,240,IRR,client,settled,,Parsian,/);
    assert.match(row, /"Phase one, ""final"""/, "commas and quotes inside a note must not break the columns");
  });
});

test("a refund is money going back, not a cost nobody can explain", async () => {
  await withStore((store) => {
    store.addEntry({ ...income, amount: 1000, occurredOn: "2026-08-04" });
    store.addEntry({ ...income, amount: -250, occurredOn: "2026-08-20", note: "Refunded the last milestone" });
    store.addEntry({ ...income, amount: 200, direction: "out", category: "running", counterparty: "Hetzner", occurredOn: "2026-08-06" });
    store.addEntry({ ...income, amount: -200, direction: "out", category: "running", counterparty: "Hetzner", occurredOn: "2026-08-07" });
    store.addEntry({ ...income, amount: 60, direction: "out", category: "people", counterparty: "Sara", occurredOn: "2026-08-08" });

    const today = new Date("2026-08-31T00:00:00Z");
    const [totals] = store.summary({ month: "2026-08", today }).currencies;
    assert.equal(totals.in, 750, "what came in is net of what went back");
    assert.equal(totals.out, 60);
    assert.deepEqual(totals.spend, { people: 60 }, "a charge that was fully refunded is not a slice of where the money went");

    const [report] = store.periodReport({ period: "2026-08", today }).currencies;
    assert.equal(report.in, 750);
    assert.equal(report.out, 60);
    assert.deepEqual(report.spend, { people: 60 });
    assert.deepEqual(
      report.payees,
      [{ companyId: null, name: "Sara", amount: 60 }],
      "a supplier who was paid and then paid back nets out"
    );
    assert.deepEqual(report.earners, [{ companyId: null, name: "Parsian", amount: 750 }]);

    const [cash] = store.cashPosition({ today, burnMonths: 1 });
    assert.equal(cash.in, 750);
    assert.equal(cash.out, 60);
    assert.equal(cash.cash, 690, "the bank balance follows the money, refunds included");
  });
});

test("a chargeback can be recorded, but an entry worth nothing cannot", async () => {
  await withStore((store) => {
    const refund = store.addEntry({ ...income, amount: -40, note: "Chargeback" });
    assert.equal(refund.amount, -40);
    assert.equal(store.updateEntry(refund.id, { amount: -55 }).amount, -55);
    assert.throws(() => store.addEntry({ ...income, amount: 0 }), /cannot be zero/);
    assert.throws(() => store.updateEntry(refund.id, { amount: 0 }), /cannot be zero/);
  });
});

test("a period switcher can ask for a quarter, not only a month", async () => {
  await withStore((store) => {
    store.addEntry({ ...income, amount: 10, occurredOn: "2026-06-30" });
    store.addEntry({ ...income, amount: 20, occurredOn: "2026-07-01" });
    store.addEntry({ ...income, amount: 30, occurredOn: "2026-09-30" });
    store.addEntry({ ...income, amount: 40, occurredOn: "2026-10-01" });

    const { from, to } = store.periodBounds("2026-Q3");
    const quarter = store.listEntries({ from, to });
    assert.deepEqual(quarter.map((entry) => entry.amount).sort((left, right) => left - right), [20, 30]);
    assert.equal(store.listEntries({ from: "2026-07-01" }).length, 3, "a lower bound on its own is enough");
    assert.equal(store.listEntries({ to: "2026-06-30" }).length, 1);
    assert.equal(store.listEntries({ from, to, direction: "out" }).length, 0, "the other filters still apply");
    assert.throws(() => store.listEntries({ from: "01-07-2026" }), /YYYY-MM-DD/);
  });
});

test("money can be attributed to a company, and read back as that company's page", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agent4-company-money-"));
  const databasePath = path.join(directory, "hq.sqlite");
  const workspace = createWorkspaceStore(databasePath);
  const store = createMoneyStore(databasePath);
  try {
    const project = workspace.ensureCompany({ id: "project", name: "SampleProject", actorId: "owner" });
    const other = workspace.ensureCompany({ id: "example-metals", name: "Kavir", actorId: "owner" });

    store.addEntry({ ...income, amount: 500, companyId: project.id, occurredOn: "2026-08-04" });
    store.addEntry({ ...income, amount: -100, companyId: project.id, occurredOn: "2026-08-14", note: "Refund" });
    store.addEntry({ ...income, amount: 300, companyId: project.id, occurredOn: "2026-08-20", status: "pending", dueOn: "2026-09-01" });
    store.addEntry({ ...income, amount: 90, companyId: project.id, direction: "out", category: "contractor", counterparty: "Editor", occurredOn: "2026-08-21" });
    store.addEntry({ ...income, amount: 70, companyId: other.id, occurredOn: "2026-08-22" });
    store.addEntry({ ...income, amount: 20, project: "Loose change", occurredOn: "2026-08-23" });

    const summary = store.companySummary({ companyId: project.id, today: new Date("2026-09-14T09:00:00Z") });
    assert.equal(summary.companyId, "project");
    const [totals] = summary.currencies;
    assert.equal(totals.in, 400, "only this company's settled money, net of its refund");
    assert.equal(totals.out, 90);
    assert.equal(totals.net, 310);
    assert.equal(totals.outstanding, 300);
    assert.equal(totals.overdueCount, 1, "a promise past its due date is one the owner should chase");
    assert.equal(totals.overdue, 300);
    assert.equal(summary.entries.length, 4, "the company's own movements, ready to list");

    assert.equal(store.listEntries({ companyId: other.id }).length, 1);
    assert.throws(() => store.addEntry({ ...income, companyId: "nobody" }), /no longer exists/);
    assert.equal(store.listEntries({})[0].project, "Loose change", "free text still works where there is no company to point at");
  } finally {
    store.close();
    workspace.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a standing cost carries its company onto every charge it posts", async () => {
  await withWorkspace(({ store, workspace }) => {
    const client = workspace.ensureCompany({ id: "sampleStudio", name: "Sample Studio", actorId: "owner" });
    const retainer = store.addRecurring({
      direction: "out", amount: 200, currency: "EUR", category: "contractor",
      cadence: "monthly", dayOfMonth: 5, counterparty: "Sample Studio", companyId: client.id, actorId: "owner-1"
    });
    assert.equal(retainer.companyId, "sampleStudio", "a standing cost reads back the company it was filed against");
    assert.equal(store.listRecurring({})[0].companyId, "sampleStudio");

    const posted = store.postDueRecurring({ today: new Date("2026-11-20T00:00:00Z") });
    assert.ok(posted.length >= 1);
    assert.ok(posted.every((entry) => entry.companyId === "sampleStudio"), "a retainer charge belongs to the client paying it");
    assert.equal(store.listEntries({ companyId: "sampleStudio", limit: 500 }).length, posted.length);

    assert.throws(
      () => store.addRecurring({
        direction: "out", amount: 10, currency: "EUR", category: "running",
        cadence: "monthly", companyId: "nobody", actorId: "owner-1"
      }),
      /no longer exists/
    );
  });
});

test("a standing cost whose company was deleted keeps charging, unattributed", async () => {
  await withWorkspace(({ store, workspace }) => {
    const client = workspace.ensureCompany({ id: "gone", name: "Gone Ltd", actorId: "owner" });
    store.addRecurring({
      direction: "out", amount: 30, currency: "EUR", category: "running",
      cadence: "monthly", dayOfMonth: 5, counterparty: "Gone Ltd", companyId: client.id, actorId: "owner-1"
    });
    workspace.removeCompany(client.id, { confirm: true });

    const posted = store.postDueRecurring({ today: new Date("2026-11-20T00:00:00Z") });
    assert.ok(posted.length >= 1, "the bank still took the money, so the books still say so");
    assert.ok(posted.every((entry) => entry.companyId === null));
  });
});

test("who paid and who got paid is grouped by company, under the company's own name", async () => {
  await withWorkspace(({ store, workspace }) => {
    const client = workspace.ensureCompany({ id: "sampleStudio", name: "Sample Studio", actorId: "owner" });
    const other = workspace.ensureCompany({ id: "example-metals", name: "Kavir", actorId: "owner" });
    const paid = { ...income, currency: "EUR", companyId: client.id };
    store.addEntry({ ...paid, amount: 100, counterparty: "Sample Studio", occurredOn: "2026-08-02" });
    store.addEntry({ ...paid, amount: 50, counterparty: "sampleStudio", occurredOn: "2026-08-03" });
    store.addEntry({ ...paid, amount: 25, counterparty: "Sample Studio Holding", occurredOn: "2026-08-04" });
    store.addEntry({ ...income, currency: "EUR", amount: 10, counterparty: "Sample Studio", occurredOn: "2026-08-05" });
    store.addEntry({
      ...income, currency: "EUR", amount: 40, direction: "out", category: "contractor",
      counterparty: "Editor", companyId: other.id, occurredOn: "2026-08-06"
    });

    const [totals] = store.periodReport({ period: "2026-08", today: new Date("2026-08-20T00:00:00Z") }).currencies;
    assert.deepEqual(totals.earners, [
      { companyId: "sampleStudio", name: "Sample Studio", amount: 175 },
      { companyId: null, name: "Sample Studio", amount: 10 }
    ], "three spellings are one client; an entry pointing at nobody stays its own line");
    assert.deepEqual(totals.payees, [{ companyId: "example-metals", name: "Kavir", amount: 40 }], "the company's name, not the spelling on the entry");

    workspace.updateCompany(client.id, { name: "Sample Studio GmbH" });
    const [renamed] = store.periodReport({ period: "2026-08", today: new Date("2026-08-20T00:00:00Z") }).currencies;
    assert.equal(renamed.earners[0].name, "Sample Studio GmbH", "renaming the company renames the row");
  });
});

test("the entries with no company can be asked for, not sieved for", async () => {
  await withWorkspace(({ store, workspace }) => {
    const client = workspace.ensureCompany({ id: "project", name: "SampleProject", actorId: "owner" });
    store.addEntry({ ...income, amount: 100, companyId: client.id, occurredOn: "2026-08-02" });
    store.addEntry({ ...income, amount: 50, occurredOn: "2026-08-03" });
    store.addEntry({ ...income, amount: 25, occurredOn: "2026-08-04", counterparty: "Nobody in particular" });

    const loose = store.listEntries({ companyId: "none" });
    assert.equal(loose.length, 2, "the set a person actually wants to go and fix");
    assert.ok(loose.every((entry) => entry.companyId === null));
    assert.equal(store.listEntries({ companyId: "project" }).length, 1);
    assert.equal(store.listEntries({ companyId: "none", month: "2026-08", direction: "out" }).length, 0, "the other filters still apply");
    assert.equal(store.listEntries({}).length, 3);
  });
});
