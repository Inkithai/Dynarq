# Dynarq practical task: payment reminder assistant

The owner's morning page: which customers get a reminder today, which reminders need the
owner's approval first, and which invoices could not be checked. TypeScript on the Node.js
standard library, no runtime dependencies.

- Rules engine: `typescript/src/plan.ts`, with `dates.ts`, `invoice.ts`, `messages.ts`
- The page: `typescript/src/server.ts`, `page.ts`, `decisions.ts`, started by `app.ts`
- Research notes: `RESEARCH.md`, answered only from `sources/`, cited

## Run it

```
cd typescript
npm install
npm test                 # 91 tests: rules, messages, page, server, command
npm run typecheck
npm run plan -- --invoices ../data/invoices.json --sent ../data/sent.json --today 2026-10-12 --out ../actions.json
npm run app              # the page at http://localhost:8000/
```

## The rules

Days overdue = `today` - `due_date` in calendar days, due today is 0. The **highest** step
reached is planned, once per invoice: `friendly` from 3 days (no approval), `firm` from 10
(approval), `final` from 24 (approval). Paid invoices plan nothing. Bad data is skipped
with the first reason that applies, in order: `duplicate_id`, `invalid_amount`,
`missing_due_date`, `invalid_due_date`, `invalid_paid_date`. A step already in
`sent.json`, or a higher one, stops that invoice; `sent_on` is ignored. Both lists in
`actions.json` are sorted by invoice id in plain text order, so `INV-100` comes before
`INV-99`.

## Configuration and deployment

`PORT` (default 8000), `DATA_DIR` (folder with `invoices.json` and `sent.json`, default
`../data`), `TODAY` (default: the real date); see `typescript/.env.example`. A missing or
broken file is explained on the page instead of an empty plan, and `/healthz` answers `ok`
for a platform health check. `npm run build` compiles to `typescript/dist`, `npm start`
runs `node dist/app.js`, the plan is `node dist/cli.js`. `render.yaml` deploys it as one
Node web service on Render; the steps are in `typescript/DEPLOYMENT.md`.

## Decisions taken

Messages are plain templates, so no API key and no internet are needed, and they repeat
only what is in the invoice: no fees, no interest, no deadlines, no mention of earlier
reminders. The page has no JavaScript: forms post to `/decisions`, and a decision can be
recorded once per invoice, so a double click cannot change it. Decisions are kept in
memory and lost on restart, which is all the task asks for. An invoice with no text id
cannot be reported in the plan at all, so the run fails with a clear message rather than
inventing one.

## Next with more time

Persist the decisions, let the owner edit the wording, show a per-customer history, and
add the interest and compensation figures once `RESEARCH.md` question 4 is answered.
