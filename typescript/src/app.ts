// The owner's page (part 2). Start with: npm run app
//
// Environment variables:
//   PORT      port to listen on, default 8000
//   DATA_DIR  folder with invoices.json and sent.json, default ../data
//   TODAY     date as YYYY-MM-DD, default the real date

import type { Server } from "node:http";
import { pathToFileURL } from "node:url";
import { todayIsoDate } from "./dates.js";
import { messageOf } from "./errors.js";
import { createReminderServer } from "./server.js";

const DEFAULT_PORT = 8000;
const DEFAULT_DATA_DIR = "../data";

export function startApp(environment: NodeJS.ProcessEnv = process.env): Server {
  const port = readPort(environment.PORT);
  const dataDir = environment.DATA_DIR ?? DEFAULT_DATA_DIR;
  const today = environment.TODAY ?? todayIsoDate();

  const server = createReminderServer({ dataDir, today });
  server.on("error", (error: NodeJS.ErrnoException) => {
    const reason = error.code === "EADDRINUSE" ? `port ${port} is already in use` : messageOf(error);
    console.error(`reminders: could not start on port ${port}: ${reason}`);
    process.exitCode = 1;
  });
  server.listen(port, () => {
    const address = server.address();
    const listeningOn = typeof address === "object" && address !== null ? address.port : port;
    console.log(`Payment reminders page: http://localhost:${listeningOn}/ (data: ${dataDir}, today: ${today})`);
  });
  return server;
}

function readPort(raw: string | undefined): number {
  if (raw === undefined || raw === "") {
    return DEFAULT_PORT;
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be a whole number between 1 and 65535, but it is "${raw}"`);
  }
  return port;
}

// Run startApp() only when this file is started directly, not when a test imports it.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startApp();
}
