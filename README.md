# Vortex Ops

Real-time infrastructure monitoring and incident management for engineering teams —
now a persisted, authenticated, multi-tenant platform rather than a client-side demo.

Sign in and you land in an **organisation**: your own incidents, your own
integrations, your own team, isolated from every other tenant on the same
deployment. Live metrics stream in over SSE, a threshold engine turns sustained
breaches into incidents, incidents are assigned and driven through a lifecycle,
and every state change can page a real Slack channel, PagerDuty service, Discord
channel or Telegram chat. Every write is authorised server-side against a
per-organisation permission table, recorded on an append-only audit trail, and
exportable as a SOC 2-style compliance report. All of it survives a restart when
a database is configured — and runs with **zero setup** when one is not.

A one-click **chaos drill** opens a real incident, pages real integrations and
visibly tanks the health score to prove the whole pipeline actually works. A
**live terminal** tails the structured logger in real time. And a **public
status page**, the one route in the app that needs no session at all, shows
whoever's watching what an outside customer would see.

---

## Contents

- [What it does](#what-it-does)
- [Chaos engineering drill](#chaos-engineering-drill)
- [Live log viewer](#live-log-viewer)
- [Public status page](#public-status-page)
- [Stack](#stack)
- [Running it](#running-it)
- [Architecture](#architecture)
- [Persistence — real database, or none at all](#persistence--real-database-or-none-at-all)
- [Authentication & sessions](#authentication--sessions)
- [Multi-tenancy](#multi-tenancy)
- [Real outbound notifications](#real-outbound-notifications)
- [Compliance: audit trail & exports](#compliance-audit-trail--exports)
- [Design decisions worth knowing](#design-decisions-worth-knowing)
- [Security posture](#security-posture)
- [Accessibility](#accessibility)
- [Testing](#testing)
- [Project layout](#project-layout)
- [Configuration](#configuration)
- [What is deliberately not built](#what-is-deliberately-not-built)

---

## What it does

### 1. Live system metrics — `/dashboard`

- Time-series charts for latency percentiles (p50/p95/p99), CPU load, 5xx error
  rate and throughput, fed by a server-sent event stream at 2-second resolution.
- A single **health score (0–100)** as the page's hero figure, weighted from the
  5xx rate (42), p95 latency (34) and CPU load (24), minus 7 per open critical
  incident. The gauge names the metric contributing the largest penalty.
- One time-range control (1h / 24h / 7d / 30d) scoping every card below it.
- Every chart has a **table twin** — the same values as text, reachable without
  hover, colour vision or pointer precision.
- The simulated telemetry is **seeded per organisation** (`Organization.metricSeed`),
  so switching tenant visibly changes the charts instead of showing the same data
  under a different name.

### 2. Incident management & alerting — `/incidents`

- Threshold rules with a **dwell requirement**: a rule must hold past its
  `forSamples` window before it opens anything.
- The rules card shows each rule's live reading, its threshold and how far into
  its dwell window it is — armed, counting, or firing.
- **Manual declaration**, not only rule-triggered incidents: a "Declare incident"
  form for the customer report or provider status-page outage that never crossed
  a metric threshold at all.
- Filterable table (severity chips, service, status, full-text, open-only) with
  a detail drawer: lifecycle stepper, responder assignment, timeline, notes.
- Lifecycle is a real state machine — `investigating → identified → monitoring →
  resolved`, one step back allowed, resolved reopenable — **enforced server-side**
  in the API route, not only by the disabled buttons in the stepper.
- Incidents are **persisted**: declare one, reload the page, it is still there.

### 3. Integration & webhook builder — `/integrations`

- **Slack, Discord, Telegram, PagerDuty, email and custom-webhook** destinations,
  each with its own payload dialect, credential shape and host allowlist declared
  in one provider registry (`src/lib/webhooks/providers.ts`).
- **Live payload preview** rendered by the same builder the server sends with —
  Discord gets a colour-coded embed, Telegram gets HTML-escaped `parse_mode: HTML`
  text, PagerDuty gets a stable `dedup_key` so a resolve closes the alert it
  opened instead of stacking a new one.
- **Credentials are encrypted at rest** (AES-256-GCM) and **never round-trip** to
  the browser — editing an integration shows only a masked hint (`••••4f2a`); a
  blank credential field on save means "leave it alone", never "clear it".
- **Real server-side delivery**, two ways:
  - *Test* (`/api/integrations/test`) — validates a draft the browser is still
    holding, before anything is saved.
  - *Trigger* (`/api/integrations/trigger`) — fires a **real notification**
    through a saved integration, with the credential decrypted server-side only.
    The payload is a clearly marked `TEST —` incident; nobody should page a human
    over a button click.
- Custom webhooks are signed `HMAC-SHA256` over `${timestamp}.${body}` in
  `X-Vortex-Signature`, timestamp inside the signed string so a captured payload
  cannot be replayed.

### 4. Team & RBAC — `/settings/team`

- Three roles (Owner / DevOps / Viewer) over sixteen permissions, resolved **per
  organisation** — the same person can be Owner in one tenant and Viewer in
  another (the demo account `ada.okafor@…` is exactly that).
- The permission matrix is **generated from the same table the API enforces**,
  and an Owner can **edit it live**: click a cell to grant or revoke a permission
  for that role in this organisation, persisted as an override on top of the
  built-in defaults — so a customisation survives a release that adds a new
  default permission instead of silently reverting it.
- Two built-in permissions can never be revoked from Owner (`team:read`,
  `team:role:update`) — removing them would leave the organisation with no
  administrator and no way back in the product.
- **Role preview**, relabelled from the old "role simulator" to be explicit about
  what it is: a client-side lens that changes what the UI *shows*, while every
  API request still runs under your real, server-resolved role. The banner says
  so in words, not just in behaviour.
- The last Owner cannot be demoted or removed.

### 5. Compliance: audit trail & exports — `/incidents`, `/settings/team`

- **Append-only audit log** — every write records who, what, which organisation,
  when, from where, and whether it *succeeded or was denied*. Nothing in the
  application can edit or delete a row.
- **One-click export** of the incident register, an SLA summary (MTTR, MTTA,
  per-severity target attainment), or the audit trail itself, as CSV or JSON,
  scoped to a rolling window (30/90/365 days, or all time).
- CSV output neutralises **spreadsheet formula injection** (a leading `=`, `+`,
  `-`, `@`, tab or CR gets an inert apostrophe prefix) and is served with
  `Content-Disposition: attachment` + `nosniff` — the file this produces is
  opened by an auditor in Excel, not rendered in a browser tab.
- The export itself is audited: who took a copy of the incident register off the
  platform, and when, is on the trail too.

### 6. Telemetry, logging & CI

- Structured JSON logger (`src/lib/logger.ts`): one object per line, stable field
  names, child loggers for request correlation, and redaction of secret-shaped
  keys and values before serialisation.
- `/api/health` reports **storage mode** (persistent vs. in-memory fallback,
  and *why* if a configured database could not be reached) alongside which
  optional integrations are configured — a probe that stays green while
  everything is silently running on ephemeral storage is how a "persistent"
  deployment loses data on its first restart without anyone noticing.
- GitHub Actions pipeline: typecheck → lint → unit tests → production build →
  Playwright E2E against that exact build artefact.

### 7. Chaos engineering drill — `/dashboard`

A discreet "Simulate infrastructure failure" control, gated behind `chaos:trigger`
(Owner/DevOps only) and a two-step confirm — see
[Chaos engineering drill](#chaos-engineering-drill) below.

### 8. Live log viewer — `/dashboard/logs`

A dark, CLI-styled tail of the structured logger's actual output, streamed over
SSE — see [Live log viewer](#live-log-viewer) below.

### 9. Public status page — `/status/[orgSlug]`

An unauthenticated route per organisation showing live service status, a 90-day
uptime history and incident updates — see [Public status page](#public-status-page)
below.

---

## Chaos engineering drill

A discreet control on the dashboard header, not a prominent "danger button" —
`chaos:trigger` is one of two permissions restricted to Owner/DevOps only (the
other is `logs:read`), and the UI requires an explicit second click ("Confirm
drill") before anything happens, since a stray click here pages whatever is
configured.

**What one click actually does**, in `POST /api/chaos/simulate`:

1. Picks one of the six monitored services at random.
2. Opens a real, persisted **CRITICAL** incident against it — `CHAOS DRILL —`
   prefixed in the title, and the summary states in words that this is a
   deliberate exercise with no real user impact. It goes through the exact same
   lifecycle, audit trail and repository as any other incident; it is not a
   fake row.
3. Fires a real notification to every integration subscribed to
   `incident.opened` at or above its configured severity
   (`notifyIntegrations` — the same fan-out a future "notify on every incident"
   feature would reuse), server-side, credentials decrypted only for the send.
   Marked `test: true` so every payload dialect that renders it also says
   "no live incident" — belt and braces on top of the title prefix, because
   this one is designed to reach a real pager.
4. Returns a duration the client uses to drive a **decaying metric spike**:
   `metrics-store.ts` multiplies every real incoming SSE sample (error rate,
   p95/p99 latency, a dampened CPU) by a factor that starts high and relaxes
   back to 1 over ~45 seconds. The server-sent stream has its own generator
   state the client does not control, so this rides on top of live data rather
   than trying to inject a fabricated point into a stream it doesn't own.
5. The health score reacts to *both* effects already in place before this
   feature existed — the incident-count penalty and the metric-weighted
   penalty in `assessHealth()` — with no special-casing for "this incident is
   a drill."

Rate-limited tighter than routine actions (5 per 5 minutes per organisation):
this deliberately pages on-call integrations, and a flood of clicks would be a
self-inflicted denial of service against whichever channel is configured.

---

## Live log viewer

`src/lib/log-buffer.ts` is an in-process ring buffer (2,000 lines) with a
pub/sub fan-out, wired into the structured logger's own sink — every line the
app already logs, from webhook deliveries to sign-in attempts, is captured with
no call site changed. `GET /api/logs/stream` sends the recent backlog on
connect, then live-tails new lines over SSE, the same shape as the metrics
stream.

- **Gated server-side, not just in the client.** `EventSource` cannot see a
  403 — a non-2xx response just looks like a network error to it, and the
  browser retries forever. Every other permission-gated element in this app is
  a button hidden inside a page every role can still load; this is the first
  *page* an entire role (Viewer) is excluded from, so `/dashboard/logs`
  checks `logs:read` server-side, before the viewer — and the stream —
  ever renders.
- **Filters, search, pause/resume, export.** Level chips (info/warn/error, at
  least one always on), a case-insensitive text search over the raw line,
  a pause that freezes the *displayed* list without dropping the connection
  (nothing is missed while paused), and a plain-text export of exactly what's
  currently on screen.
- **Parses its own wire format for display**, falling back to the raw line for
  anything that doesn't parse — `LOG_PRETTY=1` output, or a malformed line —
  rather than throwing and blanking the viewer (`src/lib/log-format.ts`).
- Deliberately does not follow the app's light/dark toggle. The status colours
  it uses are fixed across both themes anyway (`globals.css`), and a terminal
  panel that stays dark regardless of theme reads as an intentional "this is a
  console," not a styling bug.

---

## Public status page

`/status/[orgSlug]` — Acme's is `/status/acme-corp` — is the one route in the
app with no session check at all. The slug **is** the access control, the same
way a real status page works: anyone who knows or guesses it can read it.

- **Nothing shown is a raw `Incident`.** Everything passes through
  `src/lib/status-page.ts` first — pure functions with no database access, so
  the redaction rules are testable without one and impossible to bypass by a
  route that forgot to call them.
- **Redaction, not summarisation.** `assignment` timeline entries name an
  employee and are dropped entirely; `notification` entries describe internal
  paging plumbing ("Notified #incidents on Slack…") and are dropped too — not
  stripped of their actor, removed outright, because the message text itself
  is internal. The public shape (`PublicIncidentUpdate`) has no `actor` field
  to forget to blank.
- **Current status per service**, derived from which incidents are open right
  now; **a 90-day uptime history**, one cell per UTC calendar day, the worst
  tier of anything that overlapped it at all; both reuse the dashboard's own
  four-tier vocabulary (`HealthTier` / `HEALTH_TIER_LABEL`) rather than
  inventing a second one.
- **"No scheduled maintenance," not a fabricated maintenance calendar.** This
  product has no maintenance-window feature built — see
  [What is deliberately not built](#what-is-deliberately-not-built) — so the
  page says exactly that instead of implying a feature that isn't there.
- **Cross-tenant is a 404**, the same convention as everywhere else in this
  app: a slug that doesn't resolve tells a visitor nothing about which slugs
  are real.
- Opts back into search indexing explicitly (`robots: { index: true }`) —
  every other route in the app opts out at the root layout, since this is the
  one page actually meant for the public.

---

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router), React 19 |
| Language | TypeScript, `strict` + `noUncheckedIndexedAccess` |
| Styling | Tailwind CSS v4 (CSS-first `@theme`), class-driven dark mode |
| State | Zustand 5 (thin API clients — the database is the source of truth) |
| Persistence | Prisma ORM — SQLite (zero setup) or PostgreSQL/Supabase |
| Auth | Stateless HMAC-signed session cookies, scrypt password hashing |
| Charts | Recharts 3 |
| Icons | Lucide |
| Validation | Zod 4 |
| Unit tests | Vitest (node environment) |
| E2E | Playwright (Chromium + mobile WebKit) |

---

## Running it

Requires Node 20.9+.

```bash
npm install                    # also runs `prisma generate` (postinstall)
cp .env.example .env.local     # optional; everything runs with no database at all
npm run dev                    # http://localhost:3000 → redirects to /sign-in
```

Sign in with any seeded demo account — the sign-in page lists them, with the
password shown inline unless `VORTEX_DEMO_PASSWORD` is set (default:
`vortex-demo-2026`). Ada Okafor is Owner at **Acme Corp** and Viewer at
**Stark Industries**; the organisation switcher in the header moves between them.

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (flat config) |
| `npm test` | Vitest unit suite |
| `npm run test:coverage` | Unit suite with V8 coverage |
| `npm run test:e2e` | Playwright suite (builds are served by the config) |
| `npm run verify` | typecheck → lint → unit → build, the CI gate locally |
| `npm run db:push` | Push the Prisma schema to `DATABASE_URL` (SQLite by default) |
| `npm run db:push:postgres` | Same, against `prisma/schema.postgresql.prisma` |
| `npm run db:studio` | Prisma Studio — browse the seeded data |
| `npm run db:schema:postgres` | Regenerate the Postgres schema variant from `schema.prisma` |

> **Windows + OneDrive:** rebuilding over an existing `.next` inside a synced
> folder intermittently fails with `EINVAL: readlink`. It is the sync client
> reclaiming files, not a build error — `rm -rf .next` and rebuild.

---

## Architecture

```
Browser                              Server
───────                              ──────
POST /api/auth/sign-in  ────────────▶  scrypt verify → HMAC-signed session cookie
                                        (httpOnly, sameSite=lax, secure in prod)

GET any page  ──────────────────────▶  (app)/layout.tsx: readSession()
                                        no session → redirect /sign-in
                                        session found → resolve org + role +
                                        effective permissions, hand to client
                                        via <SessionProvider>

Zustand stores (incidents, team,      ──▶  /api/incidents, /api/team,
integrations) are now thin API             /api/integrations, /api/rbac, /api/audit
clients — every mutation is a fetch        each: requirePermission() first,
to a route; the response replaces          then repository.*(orgId, …),
local state, nothing is owned                 never a query without orgId
client-side any more.

GET /api/metrics/stream  ───────────▶  ReadableStream, 2s tick, seeded per org
  (SSE; opens only after `load`,          alert rules (pure fn) evaluate the
   so a permanent connection never          tail of every sample → POST
   leaves the tab "loading" forever)        /api/incidents when one breaches

/integrations "Send test payload"  ─▶  POST /api/integrations/trigger
                                        ├─ requirePermission(integration:test)
                                        ├─ rate limit (10/min per client)
                                        ├─ repository.getIntegrationWithCredential
                                        │    (decrypts AES-256-GCM, server-only)
                                        ├─ resolveEndpoint() — Telegram builds
                                        │    its real URL from the bot token here
                                        ├─ SSRF guard, re-checked at send time
                                        └─ fetch, 8s timeout, redirects not followed
```

**Repository layer, one contract, two drivers.** Every route calls
`getRepository()` and gets back a `VortexRepository` — `listIncidents(orgId)`,
`createIncident(orgId, draft)`, and so on for team, integrations, RBAC overrides
and the audit log. `PrismaRepository` implements it against a real database;
`MemoryRepository` implements the *identical* contract in-process. `orgId` is the
first argument on every tenant-scoped method — there is no overload that reads
data without saying whose it is, so the multi-tenancy boundary is enforced by the
type signature, not by remembering to add a `WHERE` clause.

**Driver selection is automatic and never fails the build.** `DATABASE_URL` unset
→ `MemoryRepository`. Set but the Prisma client cannot connect → the error is
logged, `/api/health` reports it, and the app **falls back to `MemoryRepository`
rather than refusing to boot.** The Prisma client itself is loaded with a dynamic
`import()`, so a missing generated client degrades the same way instead of
breaking `next build`. Both paths are exercised: `src/server/repository/memory.test.ts`
covers the fallback directly; the same contract runs for real against SQLite in
manual testing (`npm run db:push && DATABASE_URL=file:./prisma/dev.db npm start`).

**Layering, unchanged in spirit.** Pure logic lives in `src/lib` and `src/server`
with no React and, below the repository boundary, no I/O — the metric generator,
health score, RBAC table, incident state machine, alert engine, SSRF guard,
payload builders, CSV writer and SLA report are all plain, independently-tested
functions. Stores hold client state and call the API; routes call the repository;
the repository is the only thing that touches a database.

**Hydration.** Everything on screen depends on the current clock, which differs
between the server render and the browser's. Data is generated client-side after
mount and gated behind a `ready` flag; `useMounted` uses `useSyncExternalStore` so
there is no cascading render.

---

## Persistence — real database, or none at all

```bash
# Zero setup — the default. Nothing to install, nothing to configure.
npm run dev

# SQLite — one file, no server to run.
npm run db:push                                  # creates prisma/dev.db
echo 'DATABASE_URL="file:./prisma/dev.db"' >> .env.local
npm run dev

# PostgreSQL / Supabase
echo 'DATABASE_URL="postgresql://user:pass@host:5432/db?sslmode=require"' >> .env.local
npm run db:push:postgres
npm run dev
```

`prisma/schema.prisma` (SQLite) and `prisma/schema.postgresql.prisma` (Postgres)
declare identical models — the Postgres file is **generated** from the SQLite one
by `scripts/make-postgres-schema.mjs` and committed, so a fresh clone has both
with no extra step, and a model only ever needs editing in one place.

The schema is written to be portable between the two engines it targets:

- **No native enums.** SQLite has none; role, status, severity and provider are
  validated `String` columns, checked by the same Zod schemas that validate API
  input — the database was never going to be the only place that check needed
  to live.
- **No `Json` columns.** Structured values (webhook events, delivery results,
  audit metadata) are `String` holding JSON, encoded/decoded in one place per
  driver.
- **Explicit `@@index`** on every column a query filters by — SQLite will
  table-scan a fixture-sized dataset without complaint and hide the omission
  until it is running on real volume.

Seeding is idempotent (`ensureSeeded()` checks row count before writing) and
produces **two organisations** on first boot — Acme Corp (production) and Stark
Industries (staging) — with distinct incidents, integrations and a shared user
whose role differs between them, so the multi-tenancy boundary has something
real to demonstrate from the first `npm run dev`.

---

## Authentication & sessions

Password auth, deliberately unglamorous:

- **scrypt** for password hashing (`N=2¹⁶, r=8, p=1`, ~100 ms/verify) — memory-hard,
  and it ships in Node's standard library, so there is no native module to
  compile on a machine that does not have one. Parameters are stored *in* the
  hash (`scrypt$N$r$p$salt$hash`), so raising the cost later does not invalidate
  existing passwords.
- **One generic error** for a wrong password and for an unknown email —
  `/api/auth/sign-in` must not be usable to enumerate which addresses have
  accounts, and a miss still runs a full scrypt verification against a dummy
  hash so response time does not leak which case it was either.
- **Sign-in is rate-limited**, 5 attempts/minute per client IP — scrypt is
  deliberately expensive, so without a limiter this endpoint is a CPU
  exhaustion vector.
- **Stateless, signed session cookie** (`<payload>.<HMAC-SHA256>`), `httpOnly`,
  `sameSite=lax`, `secure` in production. The cookie carries a user id and the
  *selected* organisation — nothing else. It is a claim, not an authorisation:
  `readSession()` re-checks the membership and re-resolves the role against the
  database on **every** request, so a permission revoked a second ago is revoked
  now, not whenever the cookie happens to expire.
- **The auth gate is a layout, not middleware.** `(app)/layout.tsx` calls
  `readSession()` server-side and redirects to `/sign-in` if there is none —
  deliberately not Next.js middleware, which defaults to the edge runtime where
  `node:crypto` (used to sign and verify the cookie) is unavailable. One
  implementation of session verification, for pages and API routes both.

---

## Multi-tenancy

The organisation switcher in the header is the boundary made visible and testable:

- Switching organisation is a **full page reload** (`window.location.assign`),
  not a client-side route change — every server component in the tree, starting
  with the layout's own session read, has to see the new cookie, and a soft
  navigation would leave server-rendered parts of the page stale.
- The switch **re-checks the membership server-side** before issuing a new
  cookie — posting an arbitrary organisation id does not switch you into it; you
  have to actually be an active member.
- Every tenant-scoped repository method takes `orgId` as its first argument, so
  a query that forgets to filter by tenant is a type error, not a runtime bug
  waiting to be found in a security review.
- Cross-tenant references fail closed: an incident id from another organisation
  returns **404**, not 403 — confirming the resource exists (even to say "you
  can't see it") would itself leak that the other tenant has it.

`tests/e2e/multi-tenant.spec.ts` and the "server-enforced RBAC" block in
`rbac.spec.ts` exercise this directly: incidents, team rosters and integrations
created under one organisation are asserted **absent** under the other, and a
real Viewer account's API requests are checked against a live 403, not just a
hidden button.

---

## Real outbound notifications

`/api/integrations/trigger` is the module that turns "monitoring dashboard" into
"pages a human." Design choices worth naming:

- **The credential never reaches the browser.** `getIntegrationWithCredential`
  decrypts server-side, inside the route handler, and the decrypted value is
  used to build the request and discarded — it is never part of a JSON response.
- **Discord** needs nothing but the webhook URL (the URL *is* the credential);
  the payload is a colour-coded embed using the reserved status palette
  (critical/major/warning), with a plain-text `content` fallback so it still
  shows up as a real push notification, not just an empty one.
- **Telegram** needs a bot token and a chat id; the real endpoint
  (`api.telegram.org/bot<token>/sendMessage`) is **built server-side from the
  decrypted token** — there is no URL field in the UI for this provider at all,
  because storing one would put the secret in a column the UI displays. Message
  text is sent as `parse_mode: HTML` with `<`, `>` and `&` escaped — Telegram
  rejects the entire message on an unescaped angle bracket, so an incident
  summary containing `latency > 900ms` would otherwise silently fail to send.
- **PagerDuty** gets a stable `dedup_key` (the incident id), so a resolution
  event closes the alert it opened instead of stacking a duplicate.
- A provider can report success at the HTTP layer while failing at its own —
  Telegram returns `200 {"ok": false, "description": "chat not found"}` for
  several real misconfigurations. `deliverWebhook` checks for this specifically
  rather than trusting the status code alone; showing a green tick for a
  message that never reached anyone is precisely the failure this feature
  exists to prevent.
- Every send — test or trigger — carries a **`TEST —` prefix** in the sample
  payload. It lands in the same channel as a real page, and somebody will
  forward it.

---

## Compliance: audit trail & exports

- **Append-only by construction**: the repository interface has `appendAudit`
  and `listAudit`, and nothing else — there is no `updateAudit`, so an audit row
  cannot be edited even by application code that wanted to.
- **Denials are recorded, not just successes** — a log that only shows what
  worked cannot answer "did anyone try," which is most of what an access review
  is actually checking for.
- The **SLA report** derives MTTR from resolved incidents, MTTA from the first
  `assignment` event on each incident's own timeline (not a separate stored
  field — it cannot drift from what a reader can see for themselves), and target
  attainment against declared per-severity resolution targets (critical: 1h,
  major: 4h, warning: 24h), all shown alongside the target so the percentage is
  checkable, not asserted.
- CSV export neutralises formula injection (`src/lib/csv.ts`) and quotes per
  RFC 4180; every export is itself an audited action.

---

## Design decisions worth knowing

**Determinism in the simulator.** The generator is seeded (mulberry32), never
`Math.random()` — now per-organisation (`Organization.metricSeed`), so the same
seed produces the same series in a unit test, on the server and in the browser,
and switching tenant produces visibly different telemetry rather than the same
numbers under a different label.

**Latency as three percentiles, derived from one signal.** A mean latency hides
exactly the tail that wakes people up. The three percentiles are derived from a
shared signal and floored against each other, because a series where p99 dips
below p95 is not noisy telemetry — it is impossible telemetry.

**No dual-axis charts, anywhere.** Two measures on different scales get two
charts. Aligning two y-scales invents a correlation the data does not contain.

**A validated colour palette, not a chosen one.** The categorical slots were run
through a CVD validator against both surfaces: every adjacent pair clears ΔE ≥ 8
(OKLab ×100) under deuteranopia/protanopia/tritanopia and ΔE ≥ 15 for normal
vision. Status colours (good/warning/serious/critical) are reserved and never
reused as a series colour — Discord's embed colours use the same reserved tokens.

**Mutations return results, they do not throw.** A rejected status transition,
a denied permission, a failed delivery — all expected outcomes the UI has to
explain, not exceptions to catch at a boundary. `MutationResult` and
`DeliveryResult` are the shapes; `ApiFailure` carries the same discipline through
the client's fetch wrapper (`src/lib/api-client.ts`), distinguishing a network
failure from a server-reported one, because they need different fixes.

**Credentials never round-trip.** A `credential` field on an update means "here
is a new value"; its *absence* means "leave the stored one alone." The browser
never receives a secret it could accidentally resend, so an ordinary field edit
cannot silently disconnect a working integration by blanking its token.

---

## Security posture

**Password & session.** scrypt hashing with cost parameters embedded in the
hash; one generic error for wrong-password and unknown-email; sign-in rate
limited per IP; sessions are HMAC-signed, `httpOnly`, re-verified against the
database on every request rather than trusted from the cookie's own claims.

**Credentials at rest.** Discord webhook URLs, Telegram bot tokens and PagerDuty
routing keys are AES-256-GCM encrypted (`src/server/crypto/secrets.ts`) before
they reach the database — plaintext here would be readable from any database
copy or backup, and usable to post as the customer's agency into the customer's
own channels. A deployment with no encryption key configured **refuses to store**
a credentialed integration (503) rather than falling back to plaintext.

**SSRF.** `/api/integrations/test` and `/api/integrations/trigger` both make
outbound HTTP requests to destinations a caller (indirectly) controls — textbook
SSRF. Standing in the way, all tested:

1. **Permission check** — `integration:test`, enforced server-side; a disabled
   button in the UI is a courtesy, not the boundary.
2. **Rate limit** — 10 sends per client per minute.
3. **URL guard** (`src/lib/net/safe-url.ts`) — HTTPS only, no credentials in the
   URL, ports restricted to 80/443/8443, private/loopback/link-local/CGNAT
   destinations refused (including `169.254.169.254` and
   `metadata.google.internal`), host allowlists matched on exact subdomain so
   `hooks.slack.com.attacker.test` does not pass. Checked **at save time and
   again at send time** — DNS can be re-pointed after a record is stored, and
   for Telegram the *resolved* endpoint (built from the decrypted token) is what
   gets checked, not the placeholder stored in the row.
4. **Delivery hardening** — 8-second timeout, `redirect: "manual"` (a 302 to a
   private address would otherwise bypass the guard), only a short escaped
   excerpt of the response body is ever returned.

**Audit integrity.** Append-only at the interface level, not by convention.

**Multi-tenancy.** `orgId` as the first argument of every tenant-scoped
repository method; cross-tenant reads 404, never 403.

**Everything from the earlier build still applies:** secret-shaped keys and
bearer-shaped values are redacted before any log line is serialised; response
headers set `nosniff`, `DENY` framing and a strict referrer policy; the email
provider returns 503 with an actionable message when no mail relay is configured
rather than reporting a success for a message that never left the building.

---

## Accessibility

- Skip link, visible focus ring on every interactive element, `aria-current` on
  the active nav item.
- Segmented controls are real radio groups (arrow-key navigation for free); the
  drawer traps focus, closes on Escape and restores focus to its trigger.
- Status is never colour-alone: every severity/status badge and the permission
  matrix pair a colour with an icon and/or text.
- Every chart has a table view; tooltips enhance, never gate.
- `prefers-reduced-motion` is honoured.
- Light and dark are both first-class, applied before first paint by an inline
  bootstrap script.
- Controls whose visible label is responsively hidden (the user menu's
  name/role text collapses below `md`) carry an explicit `aria-label` so they
  still have an accessible name at every viewport — `display: none` removes an
  element from the accessibility tree entirely, not just visually, and a
  control with two children both hidden that way has no name left at all.

---

## Testing

**346 unit tests** across 20 files, node environment, ~15 seconds:

| Area | What is asserted |
|---|---|
| `metrics` | Seed determinism, percentile ordering, physical bounds, health weighting and its incident cap, delta baselines, downsampling |
| `rbac` | Full matrix, strictly narrowing role ladder, per-organisation `effectivePermissions()` overrides, the un-revocable Owner permissions, last-owner protection |
| `incidents` | Transition legality (including the forbidden shortcut), filter semantics, sort order, MTTR |
| `alerting` | Dwell-time behaviour, broken runs, both comparators, generated alert copy |
| `safe-url` | 23 cases covering metadata endpoints, RFC1918, IPv6, credentials, ports, lookalike suffixes |
| `logger` | Redaction (nested, arrays, bearer-shaped values), level filtering, depth and size caps |
| `webhooks` | Per-provider payload shape incl. Discord/Telegram, PagerDuty dedup/resolve semantics, Telegram HTML escaping, `resolveEndpoint()`, HMAC stability and replay resistance, `notificationFromIncident()` |
| `rate-limit` | Window boundaries, per-key isolation, retry-after |
| `csv` | RFC 4180 quoting, formula-injection neutralisation, filename sanitisation |
| `secrets` | AES-256-GCM round-trip, tamper detection, key-derivation fallback, mask formatting |
| `password` | scrypt round-trip, malformed-hash handling, cost-parameter rehash detection |
| `cookie` | Sign/verify round-trip, tamper and expiry rejection, clock-skew tolerance |
| `compliance/report` | MTTR/MTTA/attainment computation, per-service and per-severity breakdowns, window scoping |
| `repository/memory` | Tenant isolation, credential encryption round-trip through the public/private shape split, append-only audit ordering, RBAC override CRUD, slug lookup — the fallback driver held to the same contract the database is |
| `stores` | Client-store pure logic only (sample folding, draft validation, the chaos spike's decay curve and per-metric multiplier) — mutation logic now lives server-side and is covered directly against the repository and via E2E |
| `services` | `pickRandomService()` distribution and boundary indices |
| `notifications` | `selectNotifiableIntegrations()` — enabled/event/severity gating, in isolation from any network call |
| `log-buffer` | Ring-buffer eviction, monotonic ids, pub/sub fan-out, a broken subscriber not blocking the others |
| `log-format` | Wire-format parsing with a graceful fallback for pretty/malformed lines, the level+text filter, plain-text export |
| `status-page` | Per-service status derivation, aggregate tier, the 90-day uptime grid's day-boundary math, uptime percentage, and — the load-bearing one — that `redactIncidentForStatusPage` actually drops `assignment`/`notification` timeline entries and never carries an `actor` field |

**218 E2E checks** (chromium + mobile Safari) across eleven spec files: auth,
dashboard, incidents, integrations, multi-tenant, rbac, compliance, API surface,
chaos, logs, the public status page, and the original theme/accessibility checks.

### Bugs the suite caught this round

Listed because a test that never fails proved nothing:

| Found by | Bug |
|---|---|
| Manual + fix | `cloneIncident()`'s object spread satisfied the `Incident` return type structurally without stripping the internal `orgId` field — every incident response silently carried it |
| E2E (mobile) | The Telegram flow left `targetUrl` empty (no URL field renders for a provider that derives its endpoint) — the server's schema requires a non-empty string, so every Telegram integration failed to save |
| E2E (mobile) | The builder's validation error was wired only to the "Endpoint URL" field — invisible for any provider (Telegram) that field doesn't render for |
| E2E (mobile) | React hydration race: filling a controlled input before React attaches its handlers sets the DOM value, then hydration reconciles it back to empty — WebKit's slower mobile-emulation hydration hit this consistently where Chromium's faster hydration mostly won the race by luck |
| E2E (mobile) | The webhook builder's submit button was disabled via React state (`setSaving(true)`), which is *scheduled*, not synchronous — a duplicate synthetic click in that gap (mobile Safari's touch emulation can fire one) double-submitted the form; fixed with a `useRef` guard checked before any `await` |
| E2E | `/api/auth/sign-in`'s rate limit is keyed by client IP; every local Playwright request looks like the same "anonymous" caller with no reverse proxy in front, exhausting the budget across unrelated tests — fixed by giving each logical caller its own synthetic `x-forwarded-for` |
| E2E | Chromium and mobile Safari share one server process for a whole suite run; fixed literal integration/incident names created by chromium's pass collided with mobile Safari's later pass under the same name — fixed by salting test-created names with the project and a timestamp |

---

## Project layout

```
src/
├── app/
│   ├── (app)/                           # auth-gated: layout.tsx calls readSession()
│   │   ├── dashboard/ dashboard/logs/ incidents/ integrations/ settings/team/
│   ├── api/
│   │   ├── auth/sign-in, sign-out/       # scrypt verify, session cookie
│   │   ├── session/, session/organization/
│   │   ├── incidents/, incidents/[id]/
│   │   ├── integrations/, integrations/[id]/, integrations/test/, integrations/trigger/
│   │   ├── team/, team/[id]/
│   │   ├── rbac/                        # permission-matrix overrides
│   │   ├── audit/                       # read-only
│   │   ├── compliance/export/
│   │   ├── chaos/simulate/              # the drill: incident + notifications + spike duration
│   │   ├── health/
│   │   ├── metrics/stream/
│   │   └── logs/stream/                 # SSE tail of the ring buffer, gated by logs:read
│   ├── status/[orgSlug]/                # public, no session — outside (app)
│   ├── sign-in/
│   ├── globals.css                      # design tokens, both themes
│   └── layout.tsx                       # document shell + pre-paint theme bootstrap
├── components/
│   ├── auth/ compliance/ charts/ dashboard/ incidents/ integrations/ team/
│   ├── layout/ logs/ status/ system/ theme/ ui/
├── lib/
│   ├── alerting.ts  incidents.ts  metrics.ts  rbac.ts  status-page.ts   # pure domain logic
│   ├── logger.ts  log-buffer.ts  log-format.ts  log-schema.ts           # logging + live tail
│   ├── rate-limit.ts  format.ts  utils.ts  csv.ts  api-client.ts  session.ts
│   ├── net/safe-url.ts
│   ├── hooks/                           # use-metric-stream, use-log-stream
│   └── webhooks/    # provider registry, payload builders (incl. Discord/Telegram), signed delivery
├── server/
│   ├── audit.ts                         # append-only writes, denial recording
│   ├── notifications.ts                 # fan-out to every matching integration, server-initiated
│   ├── compliance/report.ts             # SLA computation, CSV column definitions
│   ├── crypto/                          # scrypt password hashing, AES-256-GCM secrets
│   ├── repository/                      # VortexRepository contract + Prisma & memory drivers
│   ├── seed/fixtures.ts                 # two-organisation demo dataset
│   ├── session/                         # signed cookie, server-side session resolution
│   ├── http.ts                          # route wrapper: no-store, typed errors
│   └── validation.ts                    # shared Zod schemas
├── store/           # zustand: thin API clients (incidents, team, integrations), session preview,
│                     #   metrics-store owns the chaos-spike decay too
└── types/
prisma/
├── schema.prisma                 # SQLite (committed default)
└── schema.postgresql.prisma      # generated from the above, committed
scripts/make-postgres-schema.mjs  # the generator
tests/e2e/           # playwright specs + global-setup (signs in every demo account once)
.github/workflows/   # CI
```

---

## Configuration

Runs with **zero configuration** on the in-memory fallback. Everything below
extends it — see `.env.example` for the full annotated list.

| Variable | Effect |
|---|---|
| `DATABASE_URL` | Enables real persistence (SQLite `file:` path or a Postgres URL). Unset → in-memory fallback, data lost on restart. |
| `VORTEX_SESSION_SECRET` | Signs session cookies. **Required in production** (the app refuses to boot without it there); in development an ephemeral per-process secret is generated with a warning. |
| `VORTEX_ENCRYPTION_KEY` | AES-256-GCM key for third-party credentials at rest (64 hex chars). Falls back to deriving one from `VORTEX_SESSION_SECRET` if set. Missing both → credentialed integrations are refused (503), never stored in plaintext. |
| `VORTEX_DEMO_PASSWORD` | Password for every seeded demo account. Must be set in any deployed environment — seeding refuses to run in production without it. |
| `VORTEX_SKIP_SEED` | Skip fixture seeding once real customer data exists. |
| `VORTEX_WEBHOOK_SIGNING_SECRET` | Enables `X-Vortex-Signature` on custom webhooks. Unset → sent unsigned, and `/api/health` says so. |
| `VORTEX_MAIL_RELAY_URL` | Enables email delivery. Unset → email test/trigger sends return 503. |
| `VORTEX_ALLOW_PRIVATE_WEBHOOK_HOSTS` | Development only. Relaxes the SSRF guard; hard-ignored when `VORTEX_ENV=production`. |
| `LOG_LEVEL`, `LOG_PRETTY` | Logger verbosity and human-readable local output. |
| `VORTEX_SERVICE_NAME`, `VORTEX_ENV`, `VORTEX_REGION` | Stamped onto every log line. |

---

## What is deliberately not built

Stated plainly, because a portfolio piece that implies more than it does is worse
than one that is honest about its edges. Persistence, authentication and
multi-tenancy — all previously listed here as absent — are now real; this list
is what still is not:

- **No OAuth / SSO / password reset flow.** Password auth only, seeded accounts.
  The session and RBAC layers underneath are the part built for real; the sign-up
  surface around them is intentionally minimal for a portfolio deployment.
- **The metric stream is simulated,** not scraped from Prometheus. The generator
  is deliberately realistic — diurnal traffic, mean reversion, degradation
  windows with ramp and decay, now seeded per organisation — because a chart of
  pure noise teaches nobody how to read a real one.
- **Email delivery has a seam, not an implementation.** It fails loudly (503)
  instead of pretending, until `VORTEX_MAIL_RELAY_URL` is configured.
- **The rate limiter is in-process.** Behind several replicas each holds its own
  counter; the honest production answer is Redis or the platform's edge limiter,
  and the module says so.
- **No object storage / attachments.** Incidents and integrations carry text and
  structured data only.
- **Audit log retention is unbounded** in the current schema — a real compliance
  deployment would add a retention policy and archival, not keep every row in
  the primary database forever.
- **No maintenance-window scheduling.** The public status page has a
  "Scheduled maintenance" section because a real one would; it always reads
  "No scheduled maintenance" because there is nowhere in the product yet to
  create one. An honest static empty state, not a calendar UI wired to nothing.
- **The log ring buffer is in-process and unpartitioned**, the same "one
  instance, not a distributed store" trade-off as the rate limiter — behind
  several replicas each holds only its own recent lines, and the buffer is not
  filtered per organisation the way every other resource in this app is,
  because infrastructure logs describe the platform, not one tenant's data.
  A real deployment ships this to Datadog/Loki/CloudWatch, which the logger's
  newline-delimited JSON output already targets.
