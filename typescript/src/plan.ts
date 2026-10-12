// The rules engine (part 1 of the task).
//
// Pure functions: no clock, no file access, no framework. `today` is always
// passed in, which keeps the rules deterministic and easy to test, and lets the
// page and the command line share exactly the same rules.

import { daysBetween, requireIsoDate, type CalendarDate } from "./dates.js";
import {
  isRecord,
  isReminderStep,
  readInvoice,
  readInvoiceEntry,
  REMINDER_RULES,
  type Invoice,
  type InvoiceEntry,
  type ReminderRule,
  type ReminderStep,
  type SkipReason,
} from "./invoice.js";
import { buildReminderMessage } from "./messages.js";
import { PlanInputError } from "./errors.js";

export { PlanInputError };

// Field names follow the output shape the task requires (README part 1).
export interface PlannedAction {
  invoice_id: string;
  step: ReminderStep;
  needs_approval: boolean;
  days_overdue: number;
  message: string;
}

export interface SkippedInvoice {
  invoice_id: string;
  reason: SkipReason;
}

export interface ReminderPlan {
  today: string;
  actions: PlannedAction[];
  skipped: SkippedInvoice[];
}

/**
 * Build today's plan.
 * invoices: the list from invoices.json
 * sent: the list from sent.json
 * today: a date string, YYYY-MM-DD
 */
export function buildPlan(invoices: unknown[], sent: unknown[], today: string): ReminderPlan {
  const todayDate = requireIsoDate(today, "today");
  const entries = readEntries(invoices);
  const duplicateIds = findDuplicateIds(entries);
  const sentSteps = readSentSteps(sent, entries);

  const actions: PlannedAction[] = [];
  const skipped: SkippedInvoice[] = [];
  const listed = new Set<string>();

  for (const entry of entries) {
    // Every id is looked at once, so a repeated id is reported once and none of
    // the invoices carrying it are checked any further.
    if (listed.has(entry.id)) {
      continue;
    }
    listed.add(entry.id);

    if (duplicateIds.has(entry.id)) {
      skipped.push({ invoice_id: entry.id, reason: "duplicate_id" });
      continue;
    }

    const result = readInvoice(entry, todayDate);
    if ("reason" in result) {
      skipped.push({ invoice_id: entry.id, reason: result.reason });
      continue;
    }

    const action = planAction(result.invoice, todayDate, sentSteps.get(result.invoice.id));
    if (action !== null) {
      actions.push(action);
    }
  }

  return {
    today,
    actions: sortByInvoiceId(actions),
    skipped: sortByInvoiceId(skipped),
  };
}

/** The one reminder to plan for an invoice, or null when there is nothing to do. */
function planAction(
  invoice: Invoice,
  today: CalendarDate,
  sent: ReadonlySet<ReminderStep> | undefined,
): PlannedAction | null {
  if (invoice.paidDate !== null) {
    return null; // paid, even if reminders were sent before it was paid
  }

  const daysOverdue = daysBetween(invoice.dueDate, today);
  const rule = highestReachedRule(daysOverdue);
  if (rule === null) {
    return null; // fewer than 3 days overdue
  }
  if (alreadySent(rule.step, sent)) {
    return null;
  }

  return {
    invoice_id: invoice.id,
    step: rule.step,
    needs_approval: rule.needsApproval,
    days_overdue: daysOverdue,
    message: buildReminderMessage(invoice, rule.step, daysOverdue),
  };
}

/** The strongest step the invoice has reached, or null before the first one. */
function highestReachedRule(daysOverdue: number): ReminderRule | null {
  let reached: ReminderRule | null = null;
  for (const rule of REMINDER_RULES) {
    if (daysOverdue >= rule.minDaysOverdue) {
      reached = rule;
    }
  }
  return reached;
}

/**
 * True when the step, or a stronger one, was already sent for this invoice.
 * A weaker step that was sent does not hold a stronger reminder back.
 */
function alreadySent(step: ReminderStep, sent: ReadonlySet<ReminderStep> | undefined): boolean {
  if (sent === undefined) {
    return false;
  }
  const reachedAt = REMINDER_RULES.findIndex((rule) => rule.step === step);
  return REMINDER_RULES.slice(reachedAt).some((rule) => sent.has(rule.step));
}

function readEntries(invoices: unknown[]): InvoiceEntry[] {
  if (!Array.isArray(invoices)) {
    throw new PlanInputError("invoices must be a list");
  }
  return invoices.map((entry, index) => readInvoiceEntry(entry, index + 1));
}

/**
 * The steps already sent, by invoice id. Entries for invoices that are not in
 * invoices.json, and entries with a step that is not one of the three, are
 * ignored. `sent_on` is for information only and is not read here.
 */
function readSentSteps(sent: unknown[], entries: InvoiceEntry[]): Map<string, Set<ReminderStep>> {
  const sentSteps = new Map<string, Set<ReminderStep>>();
  if (!Array.isArray(sent)) {
    throw new PlanInputError("sent must be a list");
  }
  const knownIds = new Set(entries.map((entry) => entry.id));

  for (const entry of sent) {
    if (!isRecord(entry)) {
      continue;
    }
    const invoiceId = entry.invoice_id;
    const step = entry.step;
    if (typeof invoiceId !== "string" || !knownIds.has(invoiceId) || !isReminderStep(step)) {
      continue;
    }
    const steps = sentSteps.get(invoiceId) ?? new Set<ReminderStep>();
    steps.add(step);
    sentSteps.set(invoiceId, steps);
  }
  return sentSteps;
}

function findDuplicateIds(entries: InvoiceEntry[]): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const { id } of entries) {
    if (seen.has(id)) {
      duplicates.add(id);
    }
    seen.add(id);
  }
  return duplicates;
}

function sortByInvoiceId<T extends { invoice_id: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => compareInvoiceIds(left.invoice_id, right.invoice_id));
}

/**
 * Plain text order, character by character, so INV-100 comes before INV-99.
 * `localeCompare` would put INV-99 first, which is not what the task asks for.
 */
function compareInvoiceIds(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}
