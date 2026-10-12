// The command line entry point (part 1 of the task).
//
// From inside typescript/:
//
//   npm run plan -- --invoices ../data/invoices.json --sent ../data/sent.json --today 2026-10-12 --out ../actions.json
//
// The command needs no internet and exits 0 on success. A bad date, an unreadable
// file or a missing option gives a clear message and a non zero exit code.

import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { messageOf } from "./errors.js";
import { buildPlan, type ReminderPlan } from "./plan.js";
import { DataError, readJsonList } from "./planData.js";

interface PlanOptions {
  invoices: string;
  sent: string;
  today: string;
  out: string;
}

const USAGE = "Usage: npm run plan -- --invoices FILE --sent FILE --today YYYY-MM-DD --out FILE";

/** Run the command. Returns the exit code the process should use. */
export function main(argv: string[]): number {
  let options: PlanOptions;
  try {
    const { values } = parseArgs({
      args: argv,
      options: {
        invoices: { type: "string" },
        sent: { type: "string" },
        today: { type: "string" },
        out: { type: "string" },
      },
      allowPositionals: false,
    });
    if (!values.invoices || !values.sent || !values.today || !values.out) {
      throw new DataError("all of --invoices, --sent, --today and --out are needed");
    }
    options = { invoices: values.invoices, sent: values.sent, today: values.today, out: values.out };
  } catch (error) {
    console.error(`plan: ${messageOf(error)}`);
    console.error(USAGE);
    return 2;
  }

  let plan: ReminderPlan;
  try {
    const invoices = readJsonList(options.invoices);
    const sent = readJsonList(options.sent);
    plan = buildPlan(invoices, sent, options.today);
    writePlan(options.out, plan);
  } catch (error) {
    console.error(`plan: ${messageOf(error)}`);
    return 1;
  }

  console.log(
    `Wrote ${plan.actions.length} reminder(s) and ${plan.skipped.length} skipped invoice(s) to ${options.out}`,
  );
  return 0;
}

function writePlan(path: string, plan: ReminderPlan): void {
  try {
    writeFileSync(path, `${JSON.stringify(plan, null, 2)}\n`, "utf-8");
  } catch (error) {
    throw new DataError(`could not write ${path}: ${messageOf(error)}`);
  }
}

// Run main() only when this file is started directly, not when a test imports it.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
