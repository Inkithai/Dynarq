// Run from inside typescript/:  npm test
//
// The message rules from README part 3: what every message must contain, and
// what it must not.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildReminderMessage, formatAmount } from "../src/messages.js";
import type { Invoice, ReminderStep } from "../src/invoice.js";
import { formatIsoDate } from "../src/dates.js";

const INVOICE: Invoice = {
  id: "INV-1001",
  customer: "Alder Fabrication Ltd",
  email: "accounts@alder-fabrication.test",
  amount: 1250,
  currency: "EUR",
  dueDate: { year: 2026, month: 9, day: 30 },
  paidDate: null,
};

function messageFor(step: ReminderStep, daysOverdue = 12, invoice: Invoice = INVOICE): string {
  return buildReminderMessage(invoice, step, daysOverdue);
}

/** Everything a message is allowed to mention as a figure. */
function allowedFigures(message: string, invoice: Invoice, daysOverdue: number): string[] {
  return [
    invoice.id,
    formatIsoDate(invoice.dueDate),
    formatAmount(invoice.amount, invoice.currency),
    `${daysOverdue} day`,
  ];
}

describe("formatting an amount", () => {
  test("the currency and two decimals are always there", () => {
    assert.equal(formatAmount(1250, "EUR"), "EUR 1250.00");
    assert.equal(formatAmount(215.5, "EUR"), "EUR 215.50");
    assert.equal(formatAmount(845.25, "USD"), "USD 845.25");
    assert.equal(formatAmount(0.01, "GBP"), "GBP 0.01");
  });

  test("a missing currency does not leave a stray space", () => {
    assert.equal(formatAmount(100, ""), "100.00");
  });
});

describe("what every message contains", () => {
  for (const step of ["friendly", "firm", "final"] as ReminderStep[]) {
    test(`${step} carries the customer, the invoice, the due date, the amount and the days overdue`, () => {
      const message = messageFor(step);
      assert.ok(message.includes(INVOICE.customer), "customer name");
      assert.ok(message.includes(INVOICE.id), "invoice id");
      assert.ok(message.includes("2026-09-30"), "due date as YYYY-MM-DD");
      assert.ok(message.includes("EUR 1250.00"), "amount with currency and two decimals");
      assert.ok(message.includes("12 days overdue"), "days overdue");
      assert.ok(message.startsWith("Subject:"), "a subject line");
    });

    test(`${step} mentions no figure that is not in the invoice data`, () => {
      const message = messageFor(step);
      const withoutKnownFigures = allowedFigures(message, INVOICE, 12).reduce(
        (text, figure) => text.split(figure).join(""),
        message,
      );
      assert.equal(withoutKnownFigures.includes("1"), false, `leftover figure in: ${withoutKnownFigures}`);
    });
  }

  test("a single day overdue is written as one day", () => {
    assert.ok(messageFor("friendly", 1).includes("1 day overdue"));
    assert.ok(!messageFor("friendly", 1).includes("1 days overdue"));
  });

  test("a large amount keeps two decimals", () => {
    const invoice: Invoice = { ...INVOICE, amount: 7600 };
    assert.ok(messageFor("final", 34, invoice).includes("EUR 7600.00"));
  });
});

describe("tone and wording", () => {
  test("the three steps read differently", () => {
    const subjects = (["friendly", "firm", "final"] as ReminderStep[]).map((step) =>
      messageFor(step).split("\n")[0],
    );
    assert.equal(new Set(subjects).size, 3);
    assert.ok(subjects[0].startsWith("Subject: Friendly reminder"));
    assert.ok(subjects[1].startsWith("Subject: Reminder:"));
    assert.ok(subjects[2].startsWith("Subject: Final reminder"));
  });

  test("no message adds fees, interest, a deadline or earlier reminders", () => {
    const forbidden = [
      /fee/i,
      /interest/i,
      /penalt/i,
      /%/, // a percentage
      /within \d/i, // a deadline made up by us
      /previous reminder/i,
      /reminder(s)? (we|you) sent/i,
      /second notice/i,
      /legal action/i,
      /debt collector/i,
      /\bEUR 40\b/,
      /\bEUR 25\b/,
    ];
    for (const step of ["friendly", "firm", "final"] as ReminderStep[]) {
      for (const pattern of forbidden) {
        assert.ok(!pattern.test(messageFor(step)), `${step} must not match ${pattern}`);
      }
    }
  });

  test("a missing customer name still produces a readable greeting", () => {
    const invoice: Invoice = { ...INVOICE, customer: "customer" };
    assert.ok(messageFor("friendly", 12, invoice).includes("Dear customer,"));
  });
});
