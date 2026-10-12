// Run from inside typescript/:  npm test
//
// The rules from README part 1: thresholds, one reminder per invoice, the skip
// reasons in the order the task lists them, and the sorting of both lists.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildPlan, PlanInputError, type PlannedAction } from "../src/plan.js";
import type { ReminderStep, SkipReason } from "../src/invoice.js";

const TODAY = "2026-10-12";

/** An invoice as it appears in invoices.json. Only the interesting fields change. */
function invoice(id: string, dueDate: unknown = "2026-09-30", extra: Record<string, unknown> = {}) {
  return {
    id,
    customer: `Customer ${id}`,
    email: `${id.toLowerCase()}@example.test`,
    amount: 100,
    currency: "EUR",
    due_date: dueDate,
    paid_date: null,
    ...extra,
  };
}

/** A reminder already sent, as it appears in sent.json. */
function sent(invoiceId: string, step: string, sentOn = "2026-10-01") {
  return { invoice_id: invoiceId, step, sent_on: sentOn };
}

function planFor(invoices: unknown[], sentEntries: unknown[] = [], today = TODAY) {
  return buildPlan(invoices, sentEntries, today);
}

/** Values that are not the shape the engine expects, for the error tests. */
function notAList(value: unknown): unknown[] {
  return value as unknown[];
}

function actionsOf(invoices: unknown[], sentEntries: unknown[] = [], today = TODAY): PlannedAction[] {
  return planFor(invoices, sentEntries, today).actions;
}

function skippedOf(invoices: unknown[], sentEntries: unknown[] = [], today = TODAY) {
  return planFor(invoices, sentEntries, today).skipped;
}

describe("days overdue and the three steps", () => {
  test("due today is not overdue yet", () => {
    assert.deepEqual(actionsOf([invoice("INV-1", TODAY)]), []);
  });

  test("two days overdue is too early for any reminder", () => {
    assert.deepEqual(actionsOf([invoice("INV-1", "2026-10-10")]), []);
  });

  test("an invoice that is not due yet plans nothing", () => {
    assert.deepEqual(actionsOf([invoice("INV-1", "2026-10-20")]), []);
  });

  test("three days overdue is the friendly step, which needs no approval", () => {
    const [action] = actionsOf([invoice("INV-1", "2026-10-09")]);
    assert.equal(action.step, "friendly");
    assert.equal(action.needs_approval, false);
    assert.equal(action.days_overdue, 3);
  });

  test("nine days overdue is still the friendly step", () => {
    const [action] = actionsOf([invoice("INV-1", "2026-10-03")]);
    assert.equal(action.step, "friendly");
    assert.equal(action.days_overdue, 9);
  });

  test("ten days overdue is the firm step, which needs approval", () => {
    const [action] = actionsOf([invoice("INV-1", "2026-10-02")]);
    assert.equal(action.step, "firm");
    assert.equal(action.needs_approval, true);
    assert.equal(action.days_overdue, 10);
  });

  test("twenty three days overdue is still the firm step", () => {
    const [action] = actionsOf([invoice("INV-1", "2026-09-19")]);
    assert.equal(action.step, "firm");
    assert.equal(action.days_overdue, 23);
  });

  test("twenty four days overdue is the final step, which needs approval", () => {
    const [action] = actionsOf([invoice("INV-1", "2026-09-18")]);
    assert.equal(action.step, "final");
    assert.equal(action.needs_approval, true);
    assert.equal(action.days_overdue, 24);
  });

  test("a very old invoice stays on the final step", () => {
    const [action] = actionsOf([invoice("INV-1", "2026-01-01")]);
    assert.equal(action.step, "final");
    assert.equal(action.days_overdue, 284);
  });

  test("days overdue counts calendar days across a month boundary", () => {
    const [action] = actionsOf([invoice("INV-1", "2026-09-30")]);
    assert.equal(action.days_overdue, 12);
  });

  test("days overdue counts across a leap day", () => {
    // 27 to 29 February, then 1 March: three days only because 2024 is a leap year.
    const [action] = actionsOf([invoice("INV-1", "2024-02-27")], [], "2024-03-01");
    assert.equal(action.days_overdue, 3);
    assert.equal(action.step, "friendly");
  });
});

describe("paid invoices", () => {
  test("an invoice paid before today plans nothing", () => {
    const invoices = [invoice("INV-1", "2026-09-01", { paid_date: "2026-09-20" })];
    assert.deepEqual(actionsOf(invoices), []);
  });

  test("an invoice paid today plans nothing", () => {
    const invoices = [invoice("INV-1", "2026-09-01", { paid_date: TODAY })];
    assert.deepEqual(actionsOf(invoices), []);
  });

  test("a paid invoice plans nothing even when reminders were sent before it was paid", () => {
    const invoices = [invoice("INV-1", "2026-09-01", { paid_date: "2026-10-01" })];
    const sentEntries = [sent("INV-1", "friendly")];
    assert.deepEqual(actionsOf(invoices, sentEntries), []);
  });
});

describe("reminders already sent", () => {
  test("the highest step reached is planned, and only that one", () => {
    const [action] = actionsOf([invoice("INV-1", "2026-09-30")]);
    assert.equal(action.step, "firm");
    assert.equal(actionsOf([invoice("INV-1", "2026-09-30")]).length, 1);
  });

  test("a sent friendly reminder does not hold back a firm one", () => {
    const [action] = actionsOf([invoice("INV-1", "2026-09-30")], [sent("INV-1", "friendly")]);
    assert.equal(action.step, "firm");
  });

  test("a sent firm reminder stops the plan for the firm step", () => {
    assert.deepEqual(
      actionsOf([invoice("INV-1", "2026-09-30")], [sent("INV-1", "friendly"), sent("INV-1", "firm")]),
      [],
    );
  });

  test("a sent final reminder stops a firm plan too", () => {
    assert.deepEqual(actionsOf([invoice("INV-1", "2026-09-30")], [sent("INV-1", "final")]), []);
  });

  test("a stronger reminder already sent stops a weaker plan as well", () => {
    // The invoice has only reached the friendly step, but a higher step is
    // already in sent.json, so the rule plans nothing.
    assert.deepEqual(actionsOf([invoice("INV-1", "2026-10-09")], [sent("INV-1", "firm")]), []);
  });

  test("sent_on is never read, so its value cannot change the plan", () => {
    const invoices = [invoice("INV-1", "2026-09-30")];
    const withADate = planFor(invoices, [sent("INV-1", "friendly", "2020-01-01")]);
    const withJunk = planFor(invoices, [sent("INV-1", "friendly", "not a date")]);
    assert.deepEqual(withADate, withJunk);
    assert.equal(withADate.actions[0].step, "firm");
  });

  test("entries with an unknown step are ignored", () => {
    const [action] = actionsOf([invoice("INV-1", "2026-09-30")], [sent("INV-1", "rude")]);
    assert.equal(action.step, "firm");
  });

  test("entries for invoices that are not in the file are ignored", () => {
    const [action] = actionsOf([invoice("INV-1", "2026-09-30")], [sent("INV-404", "firm")]);
    assert.equal(action.step, "firm");
  });

  test("entries that are not objects are ignored", () => {
    const [action] = actionsOf([invoice("INV-1", "2026-09-30")], ["nonsense", null, 7]);
    assert.equal(action.step, "firm");
  });
});

describe("invoices that cannot be checked", () => {
  test("a repeated id is listed once and neither invoice is checked", () => {
    const invoices = [
      invoice("INV-9", "2026-09-30"),
      invoice("INV-9", "2026-09-20", { amount: 500 }),
      invoice("INV-1", "2026-09-30"),
    ];
    const plan = planFor(invoices);
    assert.deepEqual(plan.skipped, [{ invoice_id: "INV-9", reason: "duplicate_id" }]);
    assert.deepEqual(
      plan.actions.map((action) => action.invoice_id),
      ["INV-1"],
    );
  });

  test("a missing, non numeric, zero or negative amount is invalid", () => {
    for (const amount of [undefined, null, "100", true, 0, -5, {}]) {
      const [entry] = skippedOf([invoice("INV-1", "2026-09-30", { amount })]);
      assert.equal(entry.reason, "invalid_amount", `amount ${JSON.stringify(amount)}`);
    }
  });

  test("a missing, null or empty due date is reported as missing", () => {
    const cases = [
      { ...invoice("INV-1"), due_date: undefined }, // the key is there but empty
      invoice("INV-1", null),
      invoice("INV-1", ""),
    ];
    for (const fields of cases) {
      const [entry] = skippedOf([fields]);
      assert.equal(entry.reason, "missing_due_date");
    }
  });

  test("a due date that is not a real YYYY-MM-DD date is invalid", () => {
    for (const dueDate of ["2026-02-30", "30/09/2026", "2026-9-30", "2026-13-01", "not a date", 20260930]) {
      const [entry] = skippedOf([invoice("INV-1", dueDate)]);
      assert.equal(entry.reason, "invalid_due_date", `due date ${JSON.stringify(dueDate)}`);
    }
  });

  test("a paid date that is not a real date is invalid", () => {
    for (const paidDate of ["", "2026-02-30", "31/10/2026", 5, false]) {
      const [entry] = skippedOf([invoice("INV-1", "2026-09-30", { paid_date: paidDate })]);
      assert.equal(entry.reason, "invalid_paid_date", `paid date ${JSON.stringify(paidDate)}`);
    }
  });

  test("a paid date after today is invalid", () => {
    const [entry] = skippedOf([invoice("INV-1", "2026-09-30", { paid_date: "2026-10-13" })]);
    assert.equal(entry.reason, "invalid_paid_date");
  });

  test("the first reason that applies is the one reported", () => {
    const cases: Array<[unknown[], SkipReason]> = [
      // a duplicate id wins over a bad amount
      [
        [invoice("INV-1", "2026-09-30", { amount: 0 }), invoice("INV-1", "2026-09-30", { amount: 0 })],
        "duplicate_id",
      ],
      // a bad amount wins over a bad due date
      [[invoice("INV-1", "2026-02-30", { amount: "free" })], "invalid_amount"],
      // a missing due date wins over a bad paid date
      [[invoice("INV-1", null, { paid_date: "nope" })], "missing_due_date"],
      // an invalid due date wins over a bad paid date
      [[invoice("INV-1", "2026-02-30", { paid_date: "nope" })], "invalid_due_date"],
    ];
    for (const [invoices, reason] of cases) {
      const [entry] = skippedOf(invoices);
      assert.equal(entry.reason, reason);
    }
  });

  test("a skipped invoice never produces an action", () => {
    const invoices = [
      invoice("INV-1", "2026-09-30", { amount: 0 }),
      invoice("INV-2", "2026-09-30"),
    ];
    const plan = planFor(invoices);
    assert.deepEqual(plan.skipped, [{ invoice_id: "INV-1", reason: "invalid_amount" }]);
    assert.deepEqual(
      plan.actions.map((action) => action.invoice_id),
      ["INV-2"],
    );
  });
});

describe("the plan as a whole", () => {
  test("both lists are sorted by invoice id in plain text order", () => {
    const invoices = [
      invoice("INV-99", "2026-09-30"),
      invoice("INV-100", "2026-09-30"),
      invoice("INV-1000", "2026-09-30"),
      invoice("INV-101", "2026-09-30", { amount: 0 }),
    ];
    const plan = planFor(invoices);
    assert.deepEqual(
      plan.actions.map((action) => action.invoice_id),
      ["INV-100", "INV-1000", "INV-99"],
    );
    assert.deepEqual(
      plan.skipped.map((entry) => entry.invoice_id),
      ["INV-101"],
    );
  });

  test("every action carries a message", () => {
    const plan = planFor([invoice("INV-1", "2026-09-30")]);
    assert.ok(plan.actions[0].message.includes("INV-1"));
    assert.ok(plan.actions[0].message.includes("12 days overdue"));
  });

  test("the same input always gives the same plan", () => {
    const invoices = [invoice("INV-1", "2026-09-30"), invoice("INV-2", "2026-10-09")];
    const sentEntries = [sent("INV-1", "friendly")];
    assert.deepEqual(planFor(invoices, sentEntries), planFor(invoices, sentEntries));
  });

  test("empty input gives an empty plan", () => {
    assert.deepEqual(planFor([]), { today: TODAY, actions: [], skipped: [] });
  });

  test("a plan with no actions still reports the skipped invoices", () => {
    const plan = planFor([invoice("INV-1", "2026-10-11")]);
    assert.deepEqual(plan.actions, []);
    assert.deepEqual(plan.skipped, []);
  });
});

describe("input the rules cannot use at all", () => {
  test("today has to be a real YYYY-MM-DD date", () => {
    for (const today of ["2026-13-01", "12/10/2026", "2026-10-12T00:00:00", "", "20261012"]) {
      assert.throws(() => planFor([invoice("INV-1")], [], today), PlanInputError, today);
    }
  });

  test("the two files have to be lists", () => {
    assert.throws(() => buildPlan(notAList({}), [], TODAY), PlanInputError);
    assert.throws(() => buildPlan([], notAList({}), TODAY), PlanInputError);
  });

  test("an entry that is not an object is a broken file", () => {
    assert.throws(() => planFor(["INV-1"]), PlanInputError);
    assert.throws(() => planFor([null]), PlanInputError);
  });

  test("an entry without a text id is a broken file", () => {
    for (const id of [undefined, null, "", "   ", 7]) {
      assert.throws(() => planFor([invoice("INV-1", "2026-09-30", { id })]), PlanInputError);
    }
  });

  test("an empty plan is still returned for an empty list", () => {
    assert.deepEqual(planFor([], []), { today: TODAY, actions: [], skipped: [] });
  });
});

describe("steps and reasons stay inside the task's vocabulary", () => {
  test("only the three steps are ever planned", () => {
    const steps: ReminderStep[] = ["friendly", "firm", "final"];
    const invoices = [invoice("INV-1", "2026-09-30"), invoice("INV-2", "2026-10-09"), invoice("INV-3", "2026-09-18")];
    for (const action of actionsOf(invoices)) {
      assert.ok(steps.includes(action.step));
    }
  });

  test("only the five skip reasons are ever used", () => {
    const reasons: SkipReason[] = [
      "duplicate_id",
      "invalid_amount",
      "missing_due_date",
      "invalid_due_date",
      "invalid_paid_date",
    ];
    const invoices = [
      invoice("INV-1", "2026-09-30", { amount: 0 }),
      invoice("INV-2", null),
      invoice("INV-3", "2026-02-30"),
      invoice("INV-4", "2026-09-30", { paid_date: "2026-11-30" }),
      invoice("INV-5", "2026-09-30"),
      invoice("INV-5", "2026-09-30"),
    ];
    for (const entry of skippedOf(invoices)) {
      assert.ok(reasons.includes(entry.reason));
    }
    assert.equal(skippedOf(invoices).length, 5);
  });
});
