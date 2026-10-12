// Run from inside typescript/:  npm test
//
// What the owner sees on the page: the plan, the decisions, the skipped
// invoices in plain words, the empty states, and escaping of data values.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { escapeHtml, renderReminderPage, type ReminderPageModel } from "../src/page.js";
import type { Invoice } from "../src/invoice.js";
import { buildPlan } from "../src/plan.js";
import type { Decision } from "../src/decisions.js";

const TODAY = "2026-10-12";
const DATA_DIR = "../data";

const ALDER: Invoice = {
  id: "INV-1001",
  customer: "Alder Fabrication Ltd",
  email: "accounts@alder-fabrication.test",
  amount: 1250,
  currency: "EUR",
  dueDate: { year: 2026, month: 9, day: 30 },
  paidDate: null,
};

function pageFor(model: Partial<ReminderPageModel> = {}): string {
  const invoices = model.invoices ?? new Map([[ALDER.id, ALDER]]);
  const plan =
    model.plan !== undefined
      ? model.plan
      : buildPlan([invoiceFields()], [], TODAY);
  return renderReminderPage({
    today: TODAY,
    dataDir: DATA_DIR,
    plan,
    invoices,
    decisions: model.decisions ?? new Map<string, Decision>(),
    error: model.error ?? null,
  });
}

describe("today's plan", () => {
  test("the page shows the customer, the invoice, the amount, the days overdue, the step and the message", () => {
    const page = pageFor();
    assert.ok(page.includes("Alder Fabrication Ltd"));
    assert.ok(page.includes("INV-1001"));
    assert.ok(page.includes("EUR 1250.00"));
    assert.ok(page.includes("2026-09-30"));
    assert.ok(page.includes("Days overdue"));
    assert.ok(page.includes("12"));
    assert.ok(page.includes("Firm reminder"));
    assert.ok(page.includes("Subject: Reminder: invoice INV-1001 is 12 days overdue"));
    assert.ok(page.includes("accounts@alder-fabrication.test"));
  });

  test("the summary counts the reminders and the ones waiting for a decision", () => {
    assert.match(pageFor(), /1 reminder to send today/);
    assert.match(pageFor(), /1 waiting for your decision/);
  });

  test("a friendly reminder is shown without any way to approve it", () => {
    const page = pageFor({
      plan: buildPlan([{ ...invoiceFields(), due_date: "2026-10-09" }], [], TODAY),
    });
    assert.ok(page.includes("Friendly reminder"));
    assert.ok(!page.includes("<form"));
    assert.ok(page.includes("A friendly reminder does not need your approval."));
  });

  test("a reminder that needs approval is shown with both choices", () => {
    const page = pageFor();
    assert.match(page, /<form[^>]*action="\/decisions"/);
    assert.match(page, /name="decision" value="approved"/);
    assert.match(page, /name="decision" value="rejected"/);
    assert.match(page, /name="invoice_id" value="INV-1001"/);
  });

  test("the page says plainly that nothing is sent", () => {
    assert.match(pageFor(), /This page only records your decisions\. It does not send any email/);
  });

  test("the page works on a narrow screen and is a normal HTML document", () => {
    const page = pageFor();
    assert.ok(page.includes('<meta name="viewport" content="width=device-width, initial-scale=1">'));
    assert.ok(page.startsWith("<!doctype html>"));
    assert.ok(page.includes('<html lang="en">'));
    assert.ok(page.includes("<main"));
    assert.ok(page.includes("<h1>Payment reminders</h1>"));
  });
});

describe("decisions", () => {
  test("an approved reminder is shown as approved", () => {
    const page = pageFor({ decisions: new Map([["INV-1001", "approved"]]) });
    assert.ok(page.includes('<p class="decision approved">Approved</p>'));
    assert.ok(!page.includes("<form"));
    assert.match(page, /1 decision recorded/);
  });

  test("a rejected reminder is shown as rejected", () => {
    const page = pageFor({ decisions: new Map([["INV-1001", "rejected"]]) });
    assert.ok(page.includes('<p class="decision rejected">Rejected</p>'));
  });

  test("a decision for an invoice that is not in today's plan is not counted", () => {
    const page = pageFor({ decisions: new Map([["INV-9999", "approved"]]) });
    assert.ok(!page.includes("1 decision recorded"));
    assert.match(page, /1 waiting for your decision/);
  });
});

describe("invoices that could not be checked", () => {
  test("each reason is shown in plain words and the code is not shown", () => {
    const page = pageFor({
      plan: buildPlan(
        [
          invoiceFields({ id: "INV-1007", due_date: "2026-02-30" }),
          invoiceFields({ id: "INV-1008", due_date: null }),
          invoiceFields({ id: "INV-1010", amount: 0 }),
          invoiceFields({ id: "INV-1011", paid_date: "2026-11-30" }),
          invoiceFields({ id: "INV-1012" }),
          invoiceFields({ id: "INV-1012" }),
        ],
        [],
        TODAY,
      ),
    });
    for (const reason of [
      "duplicate_id",
      "invalid_amount",
      "missing_due_date",
      "invalid_due_date",
      "invalid_paid_date",
    ]) {
      assert.ok(!page.includes(reason), `the code ${reason} should not be shown`);
    }
    assert.ok(page.includes("Another invoice in the file has the same id"));
    assert.ok(page.includes("The amount is missing, is not a number, or is zero or less."));
    assert.ok(page.includes("There is no due date on the invoice."));
    assert.ok(page.includes("The due date is not a real date"));
    assert.ok(page.includes("The paid date is not a real date, or it is in the future."));
    assert.ok(page.includes("Could not be checked"));
  });

  test("nothing is said about skipped invoices when there are none", () => {
    const page = pageFor();
    assert.ok(!page.includes("Could not be checked"));
  });
});

describe("states with nothing to show", () => {
  test("an empty plan explains that there is nothing to do today", () => {
    const page = pageFor({ plan: buildPlan([], [], TODAY) });
    assert.ok(page.includes("Nothing to do today"));
    assert.ok(page.includes("No reminders are planned."));
    assert.ok(!page.includes("Reminders for today"));
  });

  test("the data cannot be read: the page explains the problem", () => {
    const page = pageFor({
      plan: null,
      error: "could not read /no/such/dir/invoices.json: ENOENT: no such file or directory",
    });
    assert.ok(page.includes("The invoices could not be read"));
    assert.ok(page.includes("ENOENT: no such file or directory"));
    assert.ok(page.includes("invoices.json"));
    assert.ok(!page.includes("Nothing to do today"));
  });

  test("an invalid TODAY is reported instead of an empty plan", () => {
    const page = pageFor({ plan: null, error: 'today is not a real date in the form YYYY-MM-DD: "31/10/2026"' });
    assert.ok(page.includes("31/10/2026"));
    assert.ok(!page.includes("Reminders for today"));
  });
});

describe("data values are escaped", () => {
  test("a customer name cannot break out of the markup", () => {
    const nasty = '<script>alert("x")</script> & friends';
    const invoice: Invoice = { ...ALDER, customer: nasty };
    const page = pageFor({ invoices: new Map([[invoice.id, invoice]]) });
    assert.ok(!page.includes("<script>alert"));
    assert.ok(page.includes(escapeHtml(nasty)));
  });

  test("the escape helper covers the characters that matter in HTML", () => {
    assert.equal(escapeHtml(`<>&"'`), "&lt;&gt;&amp;&quot;&#39;");
  });
});

function invoiceFields(overrides: Record<string, unknown> = {}) {
  return {
    id: ALDER.id,
    customer: ALDER.customer,
    email: ALDER.email,
    amount: ALDER.amount,
    currency: ALDER.currency,
    due_date: "2026-09-30",
    paid_date: null,
    ...overrides,
  };
}
