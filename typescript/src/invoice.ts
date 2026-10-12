// The invoice data the rules work on, and the validation that turns one raw
// entry from invoices.json into it.

import { daysBetween, parseIsoDate, type CalendarDate } from "./dates.js";
import { PlanInputError } from "./errors.js";

export type ReminderStep = "friendly" | "firm" | "final";

/** A validated invoice: every field the rules and the messages need is usable. */
export interface Invoice {
  id: string;
  customer: string;
  email: string;
  amount: number;
  currency: string;
  dueDate: CalendarDate;
  /** Null when the invoice is unpaid. */
  paidDate: CalendarDate | null;
}

/** Why an invoice could not be checked, in the order the task lists them. */
export type SkipReason =
  | "duplicate_id"
  | "invalid_amount"
  | "missing_due_date"
  | "invalid_due_date"
  | "invalid_paid_date";

export interface ReminderRule {
  step: ReminderStep;
  /** The invoice has to be at least this many days overdue. */
  minDaysOverdue: number;
  needsApproval: boolean;
}

/** The steps, ordered from the gentlest to the strongest. */
export const REMINDER_RULES: readonly ReminderRule[] = [
  { step: "friendly", minDaysOverdue: 3, needsApproval: false },
  { step: "firm", minDaysOverdue: 10, needsApproval: true },
  { step: "final", minDaysOverdue: 24, needsApproval: true },
];

export const REMINDER_STEPS: readonly ReminderStep[] = REMINDER_RULES.map((rule) => rule.step);

/** One entry of invoices.json: its id, and the fields it came with. */
export interface InvoiceEntry {
  id: string;
  fields: Record<string, unknown>;
}

export type InvoiceReadResult = { invoice: Invoice } | { reason: SkipReason };

// The task guarantees a text id, customer and currency. When one of them is
// missing the invoice is still usable, so a neutral stand-in keeps the message
// and the page readable instead of breaking the run.
const MISSING_CUSTOMER = "customer";
const MISSING_TEXT = "";

/**
 * Read the id of one entry of invoices.json. An entry we cannot name at all is
 * a broken file rather than a bad invoice, because the plan reports invoices by
 * id, so this raises instead of inventing an id.
 */
export function readInvoiceEntry(entry: unknown, position: number): InvoiceEntry {
  if (!isRecord(entry)) {
    throw new PlanInputError(`invoices entry ${position} is not an object`);
  }
  const id = entry.id;
  if (typeof id !== "string" || id.trim() === "") {
    throw new PlanInputError(`invoices entry ${position} has no text id`);
  }
  return { id, fields: entry };
}

/**
 * Read one invoice. Returns the invoice when the data is usable, or the first
 * reason why it is not, in the order the task lists the reasons.
 */
export function readInvoice(entry: InvoiceEntry, today: CalendarDate): InvoiceReadResult {
  const { fields } = entry;

  const amount = fields.amount;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return { reason: "invalid_amount" };
  }

  const dueDate = fields.due_date;
  if (dueDate === null || dueDate === undefined || dueDate === "") {
    return { reason: "missing_due_date" };
  }
  const parsedDueDate = parseIsoDate(dueDate);
  if (parsedDueDate === null) {
    return { reason: "invalid_due_date" };
  }

  // A missing paid_date means unpaid. An empty string is not a date, so it is
  // reported as an invalid paid date rather than quietly treated as unpaid.
  let paidDate: CalendarDate | null = null;
  if (fields.paid_date !== null && fields.paid_date !== undefined) {
    const parsedPaidDate = parseIsoDate(fields.paid_date);
    if (parsedPaidDate === null || daysBetween(parsedPaidDate, today) < 0) {
      return { reason: "invalid_paid_date" };
    }
    paidDate = parsedPaidDate;
  }

  return {
    invoice: {
      id: entry.id,
      customer: readText(fields.customer, MISSING_CUSTOMER),
      email: readText(fields.email, MISSING_TEXT),
      amount,
      currency: readText(fields.currency, MISSING_TEXT),
      dueDate: parsedDueDate,
      paidDate,
    },
  };
}

/** The invoices that passed validation, in file order, one entry per id. */
export function readInvoices(entries: unknown[], today: CalendarDate): Invoice[] {
  const invoices: Invoice[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    const record = readInvoiceEntry(entry, index + 1);
    if (seen.has(record.id)) {
      continue; // the rules skip these as duplicate_id
    }
    const result = readInvoice(record, today);
    if ("invoice" in result) {
      invoices.push(result.invoice);
      seen.add(record.id);
    }
  }
  return invoices;
}

export function isReminderStep(value: unknown): value is ReminderStep {
  return typeof value === "string" && (REMINDER_STEPS as readonly string[]).includes(value);
}

/** True for a plain JSON object, which is what an invoice or a sent entry is. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readText(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed === "" ? fallback : trimmed;
}
