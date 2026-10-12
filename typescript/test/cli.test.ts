// Run from inside typescript/:  npm test
//
// The command from README part 1, run as a real process so that the exit codes
// and the messages the owner sees are covered too.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));
const DATA_DIR = join(PROJECT_ROOT, "..", "data");
const TSX_CLI = fileURLToPath(new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url));

const temporaryPaths: string[] = [];

after(() => {
  for (const path of temporaryPaths) {
    rmSync(path, { recursive: true, force: true });
  }
});

function temporaryFile(name: string): string {
  const directory = mkdtempSync(join(tmpdir(), "reminder-plan-"));
  temporaryPaths.push(directory);
  return join(directory, name);
}

function runPlan(args: string[]) {
  return spawnSync(process.execPath, [TSX_CLI, join("src", "cli.ts"), ...args], {
    cwd: PROJECT_ROOT,
    encoding: "utf-8",
  });
}

function planArgs(out: string, overrides: { today?: string; invoices?: string } = {}): string[] {
  return [
    "--invoices",
    overrides.invoices ?? join(DATA_DIR, "invoices.json"),
    "--sent",
    join(DATA_DIR, "sent.json"),
    "--today",
    overrides.today ?? "2026-10-12",
    "--out",
    out,
  ];
}

test("writes today's plan for the sample data", () => {
  const out = temporaryFile("actions.json");
  const result = runPlan(planArgs(out));

  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(readFileSync(out, "utf-8"));
  assert.equal(plan.today, "2026-10-12");
  assert.deepEqual(
    plan.actions.map((action: { invoice_id: string; step: string }) => [action.invoice_id, action.step]),
    [
      ["INV-1001", "firm"],
      ["INV-1002", "friendly"],
      ["INV-1004", "final"],
      ["INV-1009", "firm"],
      ["INV-1011", "firm"],
    ],
  );
  assert.deepEqual(
    plan.skipped.map((entry: { invoice_id: string; reason: string }) => [entry.invoice_id, entry.reason]),
    [
      ["INV-1007", "invalid_due_date"],
      ["INV-1008", "missing_due_date"],
      ["INV-1010", "duplicate_id"],
    ],
  );
  assert.ok(plan.actions.every((action: { message: string }) => action.message.length > 0));
});

test("the written file ends with a newline and is indented for reading", () => {
  const out = temporaryFile("actions.json");
  assert.equal(runPlan(planArgs(out)).status, 0);
  const text = readFileSync(out, "utf-8");
  assert.ok(text.endsWith("}\n"));
  assert.ok(text.includes('\n  "actions": ['));
});

test("a date that is not a real date is refused", () => {
  const out = temporaryFile("actions.json");
  const result = runPlan(planArgs(out, { today: "31/10/2026" }));

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /today is not a real date/);
});

test("a file that cannot be read is refused", () => {
  const out = temporaryFile("actions.json");
  const result = runPlan(planArgs(out, { invoices: "/nope/invoices.json" }));

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /could not read/);
});

test("a missing option prints the usage line", () => {
  const result = runPlan(["--today", "2026-10-12"]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage: npm run plan/);
});
