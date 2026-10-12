# Deploying the payment reminder page

One Node.js process serves the page and records the owner's decisions. There is no
database and no build step that needs a secret.

## What deploys where

```
browser ──HTTP──▶ Node.js service (Render) ──reads on every request──▶ data/invoices.json
                     │                                                     data/sent.json
                     ├── serves the HTML page   (src/page.ts, server rendered)
                     ├── POST /decisions        (src/server.ts, in-memory DecisionStore)
                     └── GET  /healthz          (for the platform health check)
```

| Layer      | What it is here                                                                 | Deploys as |
| ---------- | ------------------------------------------------------------------------------- | ---------- |
| Frontend   | Server-rendered HTML in `src/page.ts`. No bundler, no separate static build.     | The same service |
| Backend    | `src/server.ts` + the rules engine (`src/plan.ts`), started by `src/app.ts`.     | The same service |
| Data       | Two JSON files in `data/`, read on every request. No database, no ORM.           | Part of the deployed image |
| Decisions  | `src/decisions.ts`, a `Map` in memory. Lost on restart, which is all the task asks. | Nowhere |

So this is **one** deployment, not three. `npm run build` only compiles TypeScript to
`typescript/dist`; it does not build a frontend bundle.

## Prerequisites

- Node.js 20 or newer (`node --version`).
- The two data files, `invoices.json` and `sent.json`, in one folder. They are read on
  every request, so replacing them changes what the page shows without a restart.

## Environment variables

| Variable   | Default            | Meaning                                                      |
| ---------- | ------------------ | ------------------------------------------------------------ |
| `PORT`     | `8000`             | Port to listen on. Hosting platforms set this themselves.     |
| `DATA_DIR` | `../data`          | Folder holding `invoices.json` and `sent.json`.               |
| `TODAY`    | the real date      | The date the rules run against, `YYYY-MM-DD`.                 |

`PORT` must be a whole number between 1 and 65535, otherwise the app refuses to start and
says why. An invalid `TODAY` is reported on the page. Copy `.env.example` if you want a
file; the app itself reads the real environment, so a `.env` file needs a loader.

## Build and start

```
cd typescript
npm ci                  # installs from package-lock.json
npm run build           # tsc -p tsconfig.build.json -> typescript/dist
npm start               # node dist/app.js
```

The plan can be run on its own, in production the same way:

```
node dist/cli.js --invoices ./data/invoices.json --sent ./data/sent.json --today 2026-10-12 --out ./actions.json
```

`GET /healthz` returns `{"status":"ok"}` and is the health check used below.

## Deploying on Render

`render.yaml` in the repository root describes the service:

- `rootDir: typescript`, so `npm ci` and `npm start` run inside `typescript/`.
- `buildCommand: npm ci && npm run build`, `startCommand: npm start`.
- `healthCheckPath: /healthz`.
- `DATA_DIR=../data`, which from `typescript/` is the repository's `data/` folder.

Either run `render blueprint sync` with the Render CLI, or in the dashboard choose
**New > Blueprint** and point it at this repository. Set `DATA_DIR` to wherever the JSON
files live in the deployed service; `PORT` is provided by Render and must not be set.

## Limitations to know about

- **Decisions are in memory.** They are lost when the process restarts, which is what the
  task asks for. A restart on a free plan therefore clears them.
- **The data is read from disk on every request**, so it must be part of the deployed
  image (as `data/` is here) or on a mounted disk. A hosted container's filesystem is not
  a safe place for anything you cannot rebuild.
- **No authentication.** The page is meant for a trusted network or a private URL; do not
  put it on the public internet as it stands.
