// The owner's page (part 2 of the task).
//
// Server rendered HTML with no JavaScript, so it works on a phone at 390 pixels
// and with the keyboard alone. Every value that comes from the data files is
// escaped, because a customer name is not something to trust.

import { formatIsoDate } from "./dates.js";
import type { Decision } from "./decisions.js";
import type { Invoice, ReminderStep, SkipReason } from "./invoice.js";
import { formatAmount } from "./messages.js";
import type { PlannedAction, ReminderPlan } from "./plan.js";

export interface ReminderPageModel {
  today: string;
  dataDir: string;
  /** Null when the data could not be read, in which case `error` explains why. */
  plan: ReminderPlan | null;
  invoices: Map<string, Invoice>;
  decisions: ReadonlyMap<string, Decision>;
  error: string | null;
}

const STEP_LABELS: Record<ReminderStep, string> = {
  friendly: "Friendly reminder",
  firm: "Firm reminder",
  final: "Final reminder",
};

// The reasons in plain words, not codes, as the task asks.
const SKIP_EXPLANATIONS: Record<SkipReason, string> = {
  duplicate_id: "Another invoice in the file has the same id, so this one was not checked.",
  invalid_amount: "The amount is missing, is not a number, or is zero or less.",
  missing_due_date: "There is no due date on the invoice.",
  invalid_due_date: "The due date is not a real date (it should look like 2026-09-30).",
  invalid_paid_date: "The paid date is not a real date, or it is in the future.",
};

export function renderReminderPage(model: ReminderPageModel): string {
  const sections = [pageHeader(model)];
  if (model.error !== null) {
    sections.push(errorPanel(model.error, model.dataDir));
  }
  if (model.plan !== null) {
    sections.push(
      planSummary(model.plan, model.decisions),
      remindersSection(model.plan, model.invoices, model.decisions),
      skippedSection(model.plan),
    );
  }
  sections.push(footerNote());
  return [documentStart(), ...sections, documentEnd()].join("\n");
}

const PAGE_STYLES = `:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; padding: 0 1rem 3rem; background: #f6f5f2; color: #1c1b19;
  font: 1rem/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.page { max-width: 46rem; margin: 0 auto; }
h1 { font-size: 1.5rem; margin: 1.5rem 0 0.25rem; }
h2 { font-size: 1.15rem; margin: 0 0 0.5rem; }
h3 { font-size: 0.95rem; margin: 0 0 0.35rem; }
p { margin: 0 0 0.75rem; }
.meta { color: #5b5750; font-size: 0.9rem; }
.summary { font-weight: 600; margin: 1rem 0; }
.card { background: #fff; border: 1px solid #d9d6cf; border-radius: 0.5rem; padding: 1rem; margin: 0 0 1rem; }
.card h2 { margin-bottom: 0.75rem; }
.facts { display: grid; grid-template-columns: auto 1fr; gap: 0.2rem 0.75rem; margin: 0 0 0.75rem; }
.facts dt { color: #5b5750; }
.facts dd { margin: 0; }
.message { border-top: 1px solid #e7e4dd; padding-top: 0.75rem; }
.message-text { white-space: pre-wrap; background: #faf9f6; border: 1px solid #e7e4dd;
  border-radius: 0.375rem; padding: 0.75rem; margin: 0; font-size: 0.95rem; }
.decision-form { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.75rem; }
button { font: inherit; min-height: 2.75rem; padding: 0.4rem 1.1rem; border-radius: 0.375rem;
  border: 1px solid #1c1b19; background: #1c1b19; color: #fff; cursor: pointer; }
button.secondary { background: #fff; color: #1c1b19; }
button:hover { opacity: 0.88; }
:focus-visible { outline: 3px solid #1d4ed8; outline-offset: 2px; }
.decision { font-weight: 600; margin: 0.75rem 0 0; }
.decision.approved { color: #14653a; }
.decision.rejected { color: #9a1c1c; }
.note { color: #5b5750; font-size: 0.9rem; }
.error { background: #fdeceb; border: 1px solid #f0b7b2; border-radius: 0.5rem; padding: 1rem; margin: 1rem 0; }
.empty { background: #fff; border: 1px solid #d9d6cf; border-radius: 0.5rem; padding: 1rem; margin: 0 0 1rem; }
ul { padding-left: 1.25rem; margin: 0 0 0.75rem; }
li { margin-bottom: 0.35rem; }
code { background: #edeae4; padding: 0 0.25rem; border-radius: 0.25rem; }
footer { border-top: 1px solid #d9d6cf; margin-top: 1.5rem; padding-top: 0.75rem; }`;

function documentStart(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Payment reminders</title>
<style>
${PAGE_STYLES}
</style>
</head>
<body>
<main class="page">`;
}

function documentEnd(): string {
  return `</main>
</body>
</html>`;
}

function pageHeader(model: ReminderPageModel): string {
  return `<header>
<h1>Payment reminders</h1>
<p class="meta">Today is <strong>${escapeHtml(model.today)}</strong>. Reading invoices from <code>${escapeHtml(
    model.dataDir,
  )}</code>.</p>
</header>`;
}

function planSummary(plan: ReminderPlan, decisions: ReadonlyMap<string, Decision>): string {
  const waiting = plan.actions.filter(
    (action) => action.needs_approval && decisions.get(action.invoice_id) === undefined,
  ).length;
  const decided = plan.actions.filter((action) => decisions.get(action.invoice_id) !== undefined).length;

  const parts = [`${count(plan.actions.length, "reminder")} to send today`];
  if (waiting > 0) {
    parts.push(`${waiting} waiting for your decision`);
  }
  if (decided > 0) {
    parts.push(`${count(decided, "decision")} recorded`);
  }
  if (plan.skipped.length > 0) {
    parts.push(`${count(plan.skipped.length, "invoice")} could not be checked`);
  }
  return `<p class="summary">${parts.join(" &middot; ")}</p>`;
}

function remindersSection(
  plan: ReminderPlan,
  invoices: Map<string, Invoice>,
  decisions: ReadonlyMap<string, Decision>,
): string {
  if (plan.actions.length === 0) {
    return `<section class="empty">
<h2>Nothing to do today</h2>
<p>No reminders are planned. Every invoice is either paid, not overdue enough for a reminder yet, or has already had the reminder it has reached.</p>
</section>`;
  }
  const cards = plan.actions.map((action) =>
    reminderCard(action, invoices.get(action.invoice_id), decisions.get(action.invoice_id)),
  );
  return `<section aria-labelledby="reminders-heading">
<h2 id="reminders-heading">Reminders for today</h2>
${cards.join("\n")}
</section>`;
}

function reminderCard(
  action: PlannedAction,
  invoice: Invoice | undefined,
  decision: Decision | undefined,
): string {
  const customer = invoice?.customer ?? "unknown customer";
  const facts: Array<[string, string]> = [
    ["Customer", escapeHtml(customer)],
    ["Invoice", escapeHtml(action.invoice_id)],
    ["Amount", invoice === undefined ? "not available" : escapeHtml(formatAmount(invoice.amount, invoice.currency))],
    ["Due date", invoice === undefined ? "not available" : escapeHtml(formatIsoDate(invoice.dueDate))],
    ["Days overdue", String(action.days_overdue)],
    ["Step", STEP_LABELS[action.step]],
  ];
  if (invoice !== undefined && invoice.email !== "") {
    facts.push(["Customer email", escapeHtml(invoice.email)]);
  }

  const factsHtml = facts.map(([label, value]) => `<dt>${label}</dt><dd>${value}</dd>`).join("\n      ");

  return `<article class="card">
<h2>${escapeHtml(action.invoice_id)} &middot; ${escapeHtml(customer)}</h2>
<dl class="facts">
      ${factsHtml}
</dl>
<section class="message">
<h3>The message the customer would receive</h3>
<p class="message-text">${escapeHtml(action.message)}</p>
</section>
${decisionArea(action, decision)}
</article>`;
}

function decisionArea(action: PlannedAction, decision: Decision | undefined): string {
  if (!action.needs_approval) {
    return `<p class="note">A friendly reminder does not need your approval.</p>`;
  }
  if (decision !== undefined) {
    const label = decision === "approved" ? "Approved" : "Rejected";
    return `<p class="decision ${decision}">${label}</p>`;
  }
  return `<form class="decision-form" method="post" action="/decisions">
<input type="hidden" name="invoice_id" value="${escapeHtml(action.invoice_id)}">
<button type="submit" name="decision" value="approved">Approve</button>
<button type="submit" name="decision" value="rejected" class="secondary">Reject</button>
</form>`;
}

function skippedSection(plan: ReminderPlan): string {
  if (plan.skipped.length === 0) {
    return "";
  }
  const items = plan.skipped.map(
    (entry) =>
      `<li><strong>${escapeHtml(entry.invoice_id)}</strong> &mdash; ${SKIP_EXPLANATIONS[entry.reason]}</li>`,
  );
  return `<section aria-labelledby="skipped-heading">
<h2 id="skipped-heading">Could not be checked</h2>
<p class="note">These invoices were left out of today's plan. Correct the data and they will be picked up with the next run.</p>
<ul>
${items.join("\n")}
</ul>
</section>`;
}

function errorPanel(error: string, dataDir: string): string {
  return `<section class="error" role="alert">
<h2>The invoices could not be read</h2>
<p>${escapeHtml(error)}</p>
<p class="note">Check that <code>${escapeHtml(
    dataDir,
  )}</code> holds <code>invoices.json</code> and <code>sent.json</code>, and that both hold a list of entries. Nothing else on this page can be shown until the data reads correctly.</p>
</section>`;
}

function footerNote(): string {
  return `<footer>
<p class="note">This page only records your decisions. It does not send any email, and the decisions are kept in memory while the app runs, so they are lost when it restarts.</p>
</footer>`;
}

function count(total: number, noun: string): string {
  return `${total} ${noun}${total === 1 ? "" : "s"}`;
}

/** Escape text that came from the data files before it goes into the page. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
