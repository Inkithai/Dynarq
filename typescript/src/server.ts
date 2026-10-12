// The HTTP server behind the owner's page (part 2 of the task).
//
// Two things happen here: showing today's plan, and recording the owner's
// decision on a reminder that needs approval. Nothing is ever sent to a
// customer. Standard library only, no framework.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { DecisionStore, DuplicateDecisionError, isDecision } from "./decisions.js";
import { messageOf } from "./errors.js";
import { renderReminderPage } from "./page.js";
import { loadReminderPlan, type ReminderPlanData } from "./planData.js";

export interface ReminderServerOptions {
  /** The folder that holds invoices.json and sent.json. */
  dataDir: string;
  /** Today's date, YYYY-MM-DD. Passed in so the page and the rules agree. */
  today: string;
  /** Injected by tests; a fresh store is used when it is left out. */
  decisions?: DecisionStore;
}

// A decision form is tiny. Anything larger is refused, but the request is still
// drained a little so the browser is not left with a broken connection.
const MAX_BODY_BYTES = 8 * 1024;
const DRAIN_LIMIT_BYTES = 1024 * 1024;

/** A submitted form that is larger than a decision can possibly be. */
class BodyTooLargeError extends Error {
  constructor() {
    super("the submitted form is too large");
    this.name = "BodyTooLargeError";
  }
}

export function createReminderServer(options: ReminderServerOptions): Server {
  const decisions = options.decisions ?? new DecisionStore();
  const server = createServer((request, response) => {
    handleRequest(request, response, options, decisions).catch((error: unknown) => {
      // Nothing useful can be said about an unexpected failure, and the stack
      // trace stays in the log rather than in the page.
      console.error(`reminders: ${messageOf(error)}`);
      sendText(response, 500, "Something went wrong on the server. Please try again.");
    });
  });
  return server;
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: ReminderServerOptions,
  decisions: DecisionStore,
): Promise<void> {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;

  if (request.method === "GET" && path === "/") {
    sendPage(response, options, decisions);
    return;
  }
  if (request.method === "GET" && path === "/healthz") {
    sendJson(response, 200, { status: "ok" });
    return;
  }
  if (request.method === "POST" && path === "/decisions") {
    await recordDecision(request, response, options, decisions);
    return;
  }
  sendText(response, 404, "Not found");
}

function sendPage(
  response: ServerResponse,
  options: ReminderServerOptions,
  decisions: DecisionStore,
): void {
  let data: ReminderPlanData | null = null;
  let error: string | null = null;
  try {
    data = loadReminderPlan(options.dataDir, options.today);
  } catch (failure) {
    // The page itself still works: it explains what is wrong with the data.
    error = messageOf(failure);
  }

  sendHtml(
    response,
    200,
    renderReminderPage({
      today: options.today,
      dataDir: options.dataDir,
      plan: data?.plan ?? null,
      invoices: data?.invoices ?? new Map(),
      decisions: decisions.recorded,
      error,
    }),
  );
}

async function recordDecision(
  request: IncomingMessage,
  response: ServerResponse,
  options: ReminderServerOptions,
  decisions: DecisionStore,
): Promise<void> {
  if (!(request.headers["content-type"] ?? "").startsWith("application/x-www-form-urlencoded")) {
    sendText(response, 415, "Expected a submitted form.");
    return;
  }

  let body: string;
  try {
    body = await readBody(request);
  } catch (failure) {
    if (failure instanceof BodyTooLargeError) {
      sendText(response, 413, "The submitted form is too large.");
      return;
    }
    sendText(response, 400, `The submitted form could not be read: ${messageOf(failure)}`);
    return;
  }

  const form = parseFormBody(body);
  const invoiceId = form.invoice_id ?? "";
  const decision = form.decision;
  if (!isDecision(decision)) {
    sendText(response, 400, `Unknown decision: ${decision ?? "nothing"}.`);
    return;
  }

  // The plan is read again so that a decision can only be recorded for a
  // reminder that is really waiting for one today.
  let data: ReminderPlanData;
  try {
    data = loadReminderPlan(options.dataDir, options.today);
  } catch (failure) {
    sendText(response, 500, `The reminder data could not be read, so no decision was recorded: ${messageOf(failure)}`);
    return;
  }

  const action = data.plan.actions.find((candidate) => candidate.invoice_id === invoiceId);
  if (action === undefined || !action.needs_approval) {
    sendText(response, 400, `Invoice ${invoiceId} is not waiting for a decision today.`);
    return;
  }

  try {
    decisions.record(invoiceId, decision);
  } catch (failure) {
    if (failure instanceof DuplicateDecisionError) {
      sendText(
        response,
        409,
        `Invoice ${invoiceId} has already been ${failure.existing}, so the decision was not changed.`,
      );
      return;
    }
    throw failure;
  }

  response.writeHead(303, { Location: "/" });
  response.end();
}

/** Read a submitted form, refusing anything that is not the size of a form. */
function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;

    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        // Keep reading so the sender can finish, but throw the body away.
        tooLarge = true;
        chunks.length = 0;
      }
      if (size > DRAIN_LIMIT_BYTES) {
        request.destroy();
        return;
      }
      if (!tooLarge) {
        chunks.push(chunk);
      }
    });
    request.on("end", () => {
      if (tooLarge) {
        reject(new BodyTooLargeError());
        return;
      }
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });
    request.on("error", reject);
  });
}

function parseFormBody(body: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const pair of body.split("&")) {
    if (pair === "") {
      continue;
    }
    const separator = pair.indexOf("=");
    const name = decodeFormValue(separator === -1 ? pair : pair.slice(0, separator));
    if (!(name in values)) {
      values[name] = decodeFormValue(separator === -1 ? "" : pair.slice(separator + 1));
    }
  }
  return values;
}

function decodeFormValue(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value; // a value we cannot decode is passed on as it arrived
  }
}

function sendHtml(response: ServerResponse, status: number, html: string): void {
  sendBytes(response, status, "text/html; charset=utf-8", Buffer.from(html, "utf-8"));
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  sendBytes(response, status, "application/json; charset=utf-8", Buffer.from(JSON.stringify(payload), "utf-8"));
}

function sendText(response: ServerResponse, status: number, text: string): void {
  sendBytes(response, status, "text/plain; charset=utf-8", Buffer.from(text, "utf-8"));
}

function sendBytes(
  response: ServerResponse,
  status: number,
  contentType: string,
  body: Buffer,
): void {
  response.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": body.length,
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}
