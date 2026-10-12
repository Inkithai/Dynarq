// Run from inside typescript/:  npm test
//
// The page as the owner uses it: the plan is served, a decision can be recorded
// once, and anything that is not a real decision is refused.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Server } from "node:http";
import { after, test } from "node:test";
import { DecisionStore } from "../src/decisions.js";
import { createReminderServer } from "../src/server.js";

const TODAY = "2026-10-12";

/** An invoice that is 12 days overdue, so it is a firm reminder needing approval. */
const INVOICES = [
  {
    id: "INV-1001",
    customer: "Alder Fabrication Ltd",
    email: "accounts@alder-fabrication.test",
    amount: 1250,
    currency: "EUR",
    due_date: "2026-09-30",
    paid_date: null,
  },
  {
    id: "INV-1002",
    customer: "Birchway Studio",
    email: "billing@birchway.test",
    amount: 480,
    currency: "EUR",
    due_date: "2026-10-09",
    paid_date: null,
  },
  { id: "INV-1003", customer: "Broken Ltd", amount: "free", due_date: "2026-09-30" },
];

const SENT = [{ invoice_id: "INV-1001", step: "friendly", sent_on: "2026-10-03" }];

const temporaryDirectories: string[] = [];

after(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function dataDirWith(invoices: unknown[] = INVOICES, sent: unknown[] = SENT): string {
  const directory = mkdtempSync(join(tmpdir(), "reminder-data-"));
  temporaryDirectories.push(directory);
  writeFileSync(join(directory, "invoices.json"), JSON.stringify(invoices));
  writeFileSync(join(directory, "sent.json"), JSON.stringify(sent));
  return directory;
}

interface Running {
  server: Server;
  baseUrl: string;
  decisions: DecisionStore;
}

async function start(dataDir: string, decisions = new DecisionStore()): Promise<Running> {
  const server = createReminderServer({ dataDir, today: TODAY, decisions });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("the test server did not get a port");
  }
  return { server, baseUrl: `http://127.0.0.1:${address.port}`, decisions };
}

async function stop(running: Running): Promise<void> {
  await new Promise<void>((resolve) => running.server.close(() => resolve()));
}

function decisionForm(invoiceId: string, decision: string): string {
  return `invoice_id=${encodeURIComponent(invoiceId)}&decision=${decision}`;
}

async function post(running: Running, body: string, contentType = "application/x-www-form-urlencoded") {
  return fetch(`${running.baseUrl}/decisions`, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body,
    redirect: "manual", // so the 303 back to the page is visible to the test
  });
}

test("the page serves today's plan", async (t) => {
  const running = await start(dataDirWith());
  t.after(() => stop(running));

  const response = await fetch(`${running.baseUrl}/`);

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/html/);
  const page = await response.text();
  assert.ok(page.includes("Alder Fabrication Ltd"));
  assert.ok(page.includes("EUR 1250.00"));
  assert.ok(page.includes("Firm reminder"));
  assert.ok(page.includes("Friendly reminder"));
  assert.ok(page.includes("Broken Ltd") === false); // skipped invoices are listed by id
  assert.ok(page.includes("INV-1003"));
  assert.ok(page.includes("The amount is missing, is not a number, or is zero or less."));
});

test("a decision is recorded and shown on the next visit", async (t) => {
  const running = await start(dataDirWith());
  t.after(() => stop(running));

  const response = await post(running, decisionForm("INV-1001", "approved"));

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/");

  const page = await (await fetch(`${running.baseUrl}/`)).text();
  assert.ok(page.includes('<p class="decision approved">Approved</p>'));
  assert.ok(!page.includes('value="approved"')); // the buttons are gone once decided
  assert.equal(running.decisions.decisionFor("INV-1001"), "approved");
});

test("rejecting is recorded as well", async (t) => {
  const running = await start(dataDirWith());
  t.after(() => stop(running));

  assert.equal((await post(running, decisionForm("INV-1001", "rejected"))).status, 303);

  const page = await (await fetch(`${running.baseUrl}/`)).text();
  assert.ok(page.includes('<p class="decision rejected">Rejected</p>'));
});

test("a second decision for the same invoice is refused", async (t) => {
  const running = await start(dataDirWith());
  t.after(() => stop(running));

  assert.equal((await post(running, decisionForm("INV-1001", "approved"))).status, 303);
  const again = await post(running, decisionForm("INV-1001", "rejected"));

  assert.equal(again.status, 409);
  assert.match(await again.text(), /already been approved/);
  assert.equal(running.decisions.decisionFor("INV-1001"), "approved");
});

test("a decision for a reminder that does not need approval is refused", async (t) => {
  const running = await start(dataDirWith());
  t.after(() => stop(running));

  const response = await post(running, decisionForm("INV-1002", "approved"));

  assert.equal(response.status, 400);
  assert.match(await response.text(), /not waiting for a decision/);
});

test("a decision for an invoice that is not in the plan is refused", async (t) => {
  const running = await start(dataDirWith());
  t.after(() => stop(running));

  const response = await post(running, decisionForm("INV-4040", "approved"));

  assert.equal(response.status, 400);
  assert.match(await response.text(), /not waiting for a decision/);
});

test("a decision that is neither approve nor reject is refused", async (t) => {
  const running = await start(dataDirWith());
  t.after(() => stop(running));

  const response = await post(running, decisionForm("INV-1001", "maybe"));

  assert.equal(response.status, 400);
  assert.match(await response.text(), /Unknown decision: maybe/);
});

test("a form that is far too large is refused", async (t) => {
  const running = await start(dataDirWith());
  t.after(() => stop(running));

  const response = await post(running, `invoice_id=INV-1001&decision=approved&padding=${"x".repeat(20_000)}`);

  assert.equal(response.status, 413);
  assert.equal(running.decisions.decisionFor("INV-1001"), undefined);
});

test("a post that is not a form is refused", async (t) => {
  const running = await start(dataDirWith());
  t.after(() => stop(running));

  const response = await post(running, JSON.stringify({ invoice_id: "INV-1001", decision: "approved" }), "application/json");

  assert.equal(response.status, 415);
});

test("the page explains itself when the data cannot be read", async (t) => {
  const running = await start(join(temporaryDirectories[0] ?? tmpdir(), "not-there"));
  t.after(() => stop(running));

  const response = await fetch(`${running.baseUrl}/`);

  assert.equal(response.status, 200);
  const page = await response.text();
  assert.ok(page.includes("The invoices could not be read"));
  assert.ok(page.includes("could not read"));
  assert.ok(!page.includes("Reminders for today"));
});

test("a decision cannot be recorded while the data cannot be read", async (t) => {
  const running = await start(join(tmpdir(), "no-such-reminder-data"));
  t.after(() => stop(running));

  const response = await post(running, decisionForm("INV-1001", "approved"));

  assert.equal(response.status, 500);
  assert.match(await response.text(), /could not be read/);
  assert.equal(running.decisions.recorded.size, 0);
});

test("the health endpoint answers for a platform health check", async (t) => {
  const running = await start(dataDirWith());
  t.after(() => stop(running));

  const response = await fetch(`${running.baseUrl}/healthz`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("anything else is not found", async (t) => {
  const running = await start(dataDirWith());
  t.after(() => stop(running));

  assert.equal((await fetch(`${running.baseUrl}/nope`)).status, 404);
  assert.equal((await fetch(`${running.baseUrl}/`, { method: "POST" })).status, 404);
});
