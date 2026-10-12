// Reading the two data files the rules need, and turning anything that goes
// wrong into a message a person can act on.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { requireIsoDate } from "./dates.js";
import { messageOf } from "./errors.js";
import { readInvoices, type Invoice } from "./invoice.js";
import { buildPlan, type ReminderPlan } from "./plan.js";

/** The data files could not be read, or do not hold what the rules need. */
export class DataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataError";
  }
}

export interface ReminderPlanData {
  plan: ReminderPlan;
  /** The valid invoices by id, so the page can show the customer and the amount. */
  invoices: Map<string, Invoice>;
}

/**
 * Read invoices.json and sent.json from `dataDir` and build today's plan.
 * Throws DataError when a file is missing or broken, so callers can explain the
 * problem instead of showing an empty plan.
 */
export function loadReminderPlan(dataDir: string, today: string): ReminderPlanData {
  const todayDate = requireIsoDate(today, "today");
  const entries = readJsonList(join(dataDir, "invoices.json"));
  const sent = readJsonList(join(dataDir, "sent.json"));
  const plan = buildPlan(entries, sent, today);
  return { plan, invoices: indexById(readInvoices(entries, todayDate)) };
}

/** Read a JSON file that should hold a list of entries. */
export function readJsonList(path: string): unknown[] {
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch (error) {
    throw new DataError(`could not read ${path}: ${messageOf(error)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new DataError(`${path} is not valid JSON: ${messageOf(error)}`);
  }

  if (!Array.isArray(parsed)) {
    throw new DataError(`${path} should hold a list of entries`);
  }
  return parsed;
}

function indexById(invoices: Invoice[]): Map<string, Invoice> {
  return new Map(invoices.map((invoice) => [invoice.id, invoice]));
}
