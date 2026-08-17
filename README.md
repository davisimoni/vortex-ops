# Vortex Ops

Real-time infrastructure monitoring and incident management for engineering teams —
now a persisted, authenticated, multi-tenant platform rather than a client-side demo.

Open it and you land in an **organisation** — no sign-in wall, no credentials
to type: a real, permission-checked session is auto-provisioned for the
seeded Owner persona the instant you arrive. Your own incidents, your own
integrations, your own team, isolated from every other tenant on the same
deployment. Live metrics stream in over SSE, a threshold engine turns sustained
breaches into incidents, incidents are assigned and driven through a lifecycle,
and every state change can page a real Slack channel, PagerDuty service, Discord
channel or Telegram chat. Every write is authorised server-side against a
per-organisation permission table, recorded on an append-only audit trail, and
exportable as a SOC 2-style compliance report from a dedicated **Audit &
compliance** page. All of it survives a restart when a database is configured,
or once `npm run db:push` has produced a local SQLite file — and runs with
**zero setup**, honestly labelled as such, when neither is present.

A one-click **chaos drill** opens a real incident, pages real integrations and
visibly tanks the health score to prove the whole pipeline actually works. A
**live terminal** tails the structured logger in real time. And a **public
status page**, the one route in the app that needs no session at all, shows
whoever's watching what an outside customer would see.

A **global command palette** (`⌘K`/`Ctrl+K`) reaches every page, every open
incident and a live organisation switch without touching the mouse. A
**service topology map** colours the real dependency graph — Gateway → Auth/
Payments/Search → Database — by which services actually have an open incident
right now, not a diagram wired to nothing. Every incident's drawer carries an
**AI Root Cause Summary**: a diagnosis and two copy-ready remediation commands,
pattern-matched from the incident's own service and severity rather than one
static block of text. And **maintenance windows**, scheduled from the
incidents page, sync automatically onto the public status page the moment
they're created.

A **Quick Portfolio Tour** on the dashboard walks a first-time visitor —
recruiter, reviewer, anyone — through three of the features above in about
ninety seconds, each step landing on the real thing, not a screenshot of it.

---

## Contents

- [What it does](#what-it-does)
- [Command palette](#command-palette)
- [Service topology](#service-topology)
- [AI root cause assistant](#ai-root-cause-assistant)
- [Maintenance windows](#maintenance-windows)
- [Chaos engineering drill](#chaos-engineering-drill)
- [Live log viewer](#live-log-viewer)
- [Public status page](#public-status-page)
- [Quick Portfolio Tour](#quick-portfolio-tour)
- [Dynamic social preview image](#dynamic-social-preview-image)
- [One-click webhook test helper](#one-click-webhook-test-helper)
- [Stack](#stack)
- [Running it](#running-it)
- [Architecture](#architecture)
- [Persistence — real database, or none at all](#persistence--real-database-or-none-at-all)
- [Storage indicator](#storage-indicator)
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

- Three roles (Owner / DevOps / Viewer) over nineteen permissions, resolved **per
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

### 5. Compliance: audit trail & exports — `/audit`, `/incidents`, `/settings/team`

- **A dedicated Audit & compliance page** (`/audit`, linked from the primary
  nav), so a SOC 2 evidence request or an access review is a click from the
  sidebar rather than something found by scrolling to the bottom of Team &
  access. The export card and the audit trail also still render there and on
  `/incidents` — someone mid-incident-review should not have to navigate away
  for the export they need.
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
uptime history, scheduled maintenance and incident updates — see
[Public status page](#public-status-page) below.

### 10. Global command palette — `⌘K` / `Ctrl+K`, any page

Search pages, jump straight into an open incident's drawer, switch organisation
or trigger a chaos drill — without leaving the keyboard. See
[Command palette](#command-palette) below.

### 11. Service topology — `/dashboard/topology`

An interactive dependency graph — Gateway → Auth/Payments/Search → Database —
coloured live from real open incidents, not a static diagram. See
[Service topology](#service-topology) below.

### 12. AI root cause assistant — inside every incident's drawer

A "✨ AI Root Cause Summary" section with a diagnosis, a confidence score and
two copy-ready remediation commands, computed from the incident's own service
and severity. See [AI root cause assistant](#ai-root-cause-assistant) below.

### 13. Maintenance windows — `/incidents`, synced to `/status/[orgSlug]`

Schedule a maintenance window against one or more services; it appears on the
public status page the moment it's created, no separate publish step. See
[Maintenance windows](#maintenance-windows) below.

---

## Command palette

`⌘K` / `Ctrl+K` from any authenticated page, or the visible **Search** button
in the header — the shortcut alone would leave anyone on a phone with no way
in, and this app is used on one more than at a desk.

- **Hand-rolled, not `cmdk`.** This app already owns the primitives a command
  palette needs — a focus trap, Escape-to-close, a backdrop (`Modal`/`Drawer`)
  — so the only genuinely new code is the command list and the chaos-drill
  confirm step. Pulling in a dependency to re-solve dialog plumbing two
  existing files already solve would be bundle size spent on nothing new.
- **Four sections, permission-filtered live**: *Actions* (currently just
  Trigger Chaos Drill, gated on `chaos:trigger`), *Active incidents* (every
  unresolved incident, jumping straight into its drawer), *Pages* (the same
  list `NAV_ITEMS` drives the sidebar with — `/audit`, `/dashboard/logs`,
  `/integrations` and the rest, so a permission a role does not have cannot
  appear here either), and *Switch organisation* (every org the account
  belongs to, excluding the current one).
  Permission filtering replicates `usePermission()`'s own logic once at the
  top of the component rather than calling the hook inside a loop over
  `NAV_ITEMS` — React's rules of hooks do not allow the latter.
- **Chaos drill keeps its two-step confirm inside the palette** — selecting it
  does not fire it, it swaps the list for an explicit "Press Enter to confirm"
  step, the same safety property the dashboard's own button has, because a
  stray Enter here pages whatever integrations are configured exactly the way
  a stray click there would.
- **Plain substring search** (`lib/command-palette.ts`), case-insensitive over
  a label plus keywords — the same level of "search sophistication" the live
  log viewer already uses. A handful of pages and a dozen commands do not need
  a fuzzy-matching library.

---

## Service topology

`/dashboard/topology` — an interactive dependency graph: Gateway → Auth /
Payments / Search Index → Postgres Primary, Payments → Notifications.

- **A fixed, hand-authored graph** (`TOPOLOGY_EDGES` in `src/lib/topology.ts`),
  not anything inferred at runtime. This product has no service mesh or trace
  pipeline to derive a real dependency graph from, and a topology that
  silently reshuffled itself between renders would be a worse demo than one
  that is honestly static.
- **Layered left-to-right automatically** (`computeTopologyLayout`) — every
  node's column is its longest path from a root, so a service always renders
  strictly to the right of everything it depends on, the one property that
  makes a dependency diagram readable at a glance instead of a bag of
  connected circles.
- **Node colour is entirely real.** Health is derived from this service's own
  currently-open incidents (`deriveTopologyStatus`, reusing the exact
  `SEVERITY_TIER`/`worstTier` logic the public status page already uses) —
  nothing about which node is red is invented.
- **The latency/error-rate estimate in each node is a derivation, not a second
  fabrication.** It scales the dashboard's own live sample — already disclosed
  as simulated telemetry throughout this README — by this service's baseline
  relative to the fleet average, so six services read as six different,
  plausible numbers instead of the one org-wide figure repeated six times.
- **Plain HTML buttons, not SVG or canvas nodes.** Only the connecting lines
  are SVG; every node is a real, focusable `<button>` with its own accessible
  name, so it never needs a from-scratch keyboard or screen-reader story the
  way a graphics-primitive node would.
- Click a node for a detail panel: the live estimate, and its real open
  incidents linking straight into `/incidents`.

---

## AI root cause assistant

Inside every incident's drawer, a "✨ AI Root Cause Summary" — a headline
diagnosis, a one-paragraph explanation, a confidence score, and exactly two
copy-ready remediation commands (`src/lib/incident-analysis.ts`).

**What this honestly is: a deterministic diagnostic engine, not a live model
call.** It makes no network request and does not claim to be a specific
external LLM. That is a design decision worth saying out loud rather than
leaving implied — the same "AI-assisted, not AI-fabricated" line this app
draws everywhere else (the chaos drill is real-but-simulated; the metric
stream is disclosed as simulated telemetry). What makes it real in the sense
that matters for a demo is that every field is actually computed from *this*
incident:

- **Per-service authored profiles** (six of them, one per monitored service,
  plus a generic fallback) give a genuinely different headline and remediation
  pair depending on which service the incident belongs to — Postgres gets a
  connection-pool diagnosis and a `pg_terminate_backend` command, Auth Service
  gets a JWKS-cache diagnosis and a cache-flush command, and so on.
- **Confidence scales with severity and how long the incident has run**, offset
  by a small, *stable* hash of the incident's own id — not `Math.random()`,
  the same determinism discipline `mulberry32` gives the metric simulator, so
  the same incident produces the exact same analysis on every render and in
  every test run.
- **"Copy Fix Command"** uses the Clipboard API directly; a denied permission
  (some browsers refuse it outside a user gesture) shows a toast rather than
  silently doing nothing.
- Wiring in a *real* model call is a legitimate future seam — the STT
  integration in a sibling of this codebase shows the shape: agnostic behind
  an env var, a clear 503 without one — but it is a deliberately separate
  piece of work from what ships here, not something to fake with a spinner
  and static copy in the meantime.

---

## Maintenance windows

A "Maintenance windows" card on `/incidents`, gated behind a new
`maintenance:manage` permission (Owner/DevOps — the same tier as declaring an
incident): title, description, one or more affected services, a start and end
time. Created windows sync onto the public status page automatically — there
is no separate publish step to forget.

- **Status is derived, never stored**, the same way `HealthTier` is never a
  column anywhere else in this schema: `scheduled` / `in_progress` /
  `completed` are only ever a comparison of `startsAt`/`endsAt` against the
  clock (`deriveMaintenanceStatus` in `src/lib/maintenance.ts`). `cancelledAt`
  is the one column that exists, because cancelling is a real event, not a
  function of time.
- **Real persistence, both drivers** — a `MaintenanceWindow` model in
  `prisma/schema.prisma` (and its generated Postgres twin), implemented
  identically in `PrismaRepository` and `MemoryRepository`, the same
  contract-parity discipline every other resource in this app is held to.
- **The public projection drops what a status page should not show forever.**
  A cancelled window is removed entirely, not shown crossed out — a
  maintenance that never happened is not a fact about the service's history.
  A completed window ages out after 7 days — recent enough to matter, not so
  old it reads as stale news (`maintenanceWindowsForStatusPage`).
- Cancelling is idempotent — cancelling an already-cancelled window returns
  the same `cancelledAt`, not a second timestamp or an error.

This replaces the honest static stub this README used to describe here: a
"Scheduled maintenance" section on the status page that always read "No
scheduled maintenance" because there was nowhere in the product yet to create
one. There is now — the empty state is unchanged for an organisation with
nothing scheduled, but it is no longer the only possible state.

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
- **Real scheduled maintenance, synced automatically** — see
  [Maintenance windows](#maintenance-windows) above. An organisation with
  nothing scheduled still gets the honest "No scheduled maintenance" line,
  not a calendar UI silently wired to zero rows.
- **Cross-tenant is a 404**, the same convention as everywhere else in this
  app: a slug that doesn't resolve tells a visitor nothing about which slugs
  are real.
- Opts back into search indexing explicitly (`robots: { index: true }`) —
  every other route in the app opts out at the root layout, since this is the
  one page actually meant for the public.

---

## Quick Portfolio Tour

A small pill button in the dashboard's header row — **✨ Quick Portfolio Tour**
— opens a three-step, centered dialog (`src/components/dashboard/demo-tour.tsx`,
built on a new reusable `Modal` primitive in `src/components/ui/modal.tsx`).
Never shown automatically: an unsolicited modal on first load is a cost every
visitor pays, including the ones who came to read code, not click through a
tour, so it only opens on request.

Each step's call to action does the real thing, not a mockup of it:

1. **RBAC simulator.** "Preview as Viewer" flips the live role-preview lens
   (the same one `/settings/team`'s Role preview card drives) and lands on
   that page already showing the effect — buttons locked, the Viewer card
   active — instead of describing it in prose.
2. **Chaos drill engine.** Since the trigger already lives on this exact page,
   the step's CTA closes the tour and smooth-scrolls to it
   (`#chaos-trigger`) rather than sending the visitor somewhere else to find
   a button that was already on screen.
3. **Live logs & the public status page.** One button opens `/dashboard/logs`
   in the same tab; a second link opens `/status/acme-corp` in a new one, so
   trying the public page never loses the authenticated tab underneath it.

Step navigation (Back/Next/Done, plus dots) and the focus-trapped, Escape-to-close
dialog itself are shared, generic UI — nothing about `Modal` is tour-specific,
so the next feature that needs a centered dialog does not start from zero.

---

## Dynamic social preview image

`src/app/og/route.tsx` generates the `og:image`/`twitter:image` PNG at
**`/og`** on request, using `next/og`'s `ImageResponse` — dark background,
a soft brand-coloured glow, the same wave logomark as the sign-in page, the
title **"Vortex Ops — Real-Time Infrastructure Monitoring B2B SaaS"**, and the
subtitle **"Live SSE Metrics • Chaos Engineering • SOC2 Compliance •
Multi-Tenant RBAC"** rendered as a row of dotted pill chips. 1200×630,
matching the size every major platform expects for a large preview card.

- **Edge runtime, deliberately unlike the rest of the app.** Everywhere else
  `node:crypto` (signing session cookies, encrypting credentials) forces the
  Node runtime; this route touches no session, no database and no secret —
  pure, stateless rendering, exactly the case edge is for.
- **Generated, not a static asset**, so the copy in the image and the copy in
  `<meta>` tags cannot drift from each other the way a hand-exported PNG
  eventually does after the third copy edit.
- Wired into `src/app/layout.tsx`'s `openGraph`/`twitter` metadata, with
  `metadataBase` set from `NEXT_PUBLIC_APP_URL` so the emitted `<meta>` tags
  carry an absolute URL rather than resolving against `localhost` on a real
  deployment. The root layout's `robots: { index: false }` does not affect
  this at all — social unfurlers (Slack, LinkedIn, X) read Open Graph tags
  regardless of the indexing directive.
- Preview it directly at **`/og`** in a browser, or check it end-to-end with
  `curl -I http://localhost:3000/og` (expect `content-type: image/png`).

---

## One-click webhook test helper

A "One-click notification test" card sits at the top of `/integrations`,
above the destination list, for a visitor with no Discord server or Telegram
bot sitting open (`src/components/integrations/quick-test-helper.tsx`).

There is nothing here that fakes a delivery. A real webhook URL or bot token
committed to a public repository would be a live credential anyone reading the
source could fire messages through, and a fabricated one would just fail
silently — teaching a visitor nothing about the feature. What the helper
removes is everything *else*: "Test with Discord" / "Test with Telegram" opens
the builder pre-set to that provider (`draftForProvider()` in
`webhook-builder.tsx`), with a throwaway name already filled in
(`Portfolio test — Discord`) and that provider's own setup hint — already the
single source of truth in the `PROVIDERS` registry, not new copy — right
underneath the button. Paste a URL or token, save, and the existing
**Send test payload** button fires a real, `TEST —`-marked notification: the
exact request a real incident would trigger.

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
npm run dev                    # http://localhost:3000 → straight to /dashboard, no sign-in
```

No credentials to type: a first visit auto-provisions a real session for Ada
Okafor, Owner at **Acme Corp** — the organisation switcher in the header moves
between tenants. To try a specific role instead (DevOps, Viewer, or Ada's own
Viewer seat at **Stark Industries**), open **Switch account** from the user
menu — the sign-in page lists every seeded account, with the password shown
inline unless `VORTEX_DEMO_PASSWORD` is set (default: `vortex-demo-2026`).

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
                                        no session → redirect /api/auth/demo-session
                                          (provisions the demo Owner, same cookie
                                           helpers as sign-in, redirects → /dashboard)
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

**Driver selection is automatic and never fails the build.** In order: an
explicit `DATABASE_URL` → Prisma against it. Unset, but `prisma/dev.db` already
exists at its conventional path and this is not Vercel (`isVercelRuntime()`,
whose filesystem is read-only outside `/tmp`) → Prisma against that file,
found with no configuration at all. Neither → `MemoryRepository`. A configured
database that cannot connect is logged, reported at `/api/health`, and **falls
back to `MemoryRepository` rather than refusing to boot** — the same fallback
the "neither" case uses, just for a different reason, which is exactly why
`getStorageStatus()` returns *why* alongside the driver rather than only the
driver itself. The Prisma client is loaded with a dynamic `import()`, so a
missing generated client degrades the same way instead of breaking `next build`.
Every path is exercised: `src/server/repository/memory.test.ts` covers the
in-memory fallback directly; the same contract runs for real against SQLite in
manual testing (`npm run db:push && npm start`, no `DATABASE_URL` needed — the
auto-detection finds it). The relative SQLite path resolves against
`prisma/schema.prisma`'s own directory, not the project root, so an *explicit*
`DATABASE_URL` needs `file:./dev.db` — not `file:./prisma/dev.db`, despite
`npm run db:push` printing `prisma/dev.db` as the file it created and every
intuition suggesting otherwise (the auto-detection path sidesteps the question
entirely by resolving an absolute path itself). Confirmed empirically:
`file:./prisma/dev.db` silently fails to connect (Prisma looks for
`prisma/prisma/dev.db`), for both the CLI and a `PrismaClient` constructed
with `datasourceUrl` at runtime.

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
npm run db:push   # creates prisma/dev.db — found automatically from here on, no DATABASE_URL needed
npm run dev

# PostgreSQL / Supabase — the only path that actually persists on Vercel
echo 'DATABASE_URL="postgresql://user:pass@host:5432/db?sslmode=require"' >> .env.local
npm run db:push:postgres
npm run dev
```

**`DATABASE_URL` unset does not mean in-memory any more — it means "look for a
local SQLite file first."** `npm run db:push` alone is now enough for an
incident created in the UI to survive a page reload: `selectRepository()`
(`src/server/repository/index.ts`) checks, in order, an explicit
`DATABASE_URL`; failing that, `prisma/dev.db` at its conventional path *if this
process is not running on Vercel*; failing that, the in-process store. Setting
`DATABASE_URL` explicitly (SQLite `file:./dev.db` or a Postgres URL) still
works exactly as before and always wins.

The Vercel exclusion is not caution for its own sake — outside `/tmp`, a
deployed function's filesystem is **read-only**, so a committed `prisma/dev.db`
would be readable there but every write would fail with a confusing database
error instead of the honest, already-tested in-memory fallback just working.
`isVercelRuntime()` in `src/lib/runtime-env.ts` is what draws that line. **On
Vercel, this means `DATABASE_URL` genuinely has no free substitute** — set a
real Postgres URL (Vercel Postgres, Neon and Supabase all have first-class
Vercel integrations), or accept that data resets on every cold start. The
header badge says which of the two is currently true; see
[Storage indicator](#storage-indicator) below.

The E2E suite sets `VORTEX_FORCE_MEMORY_STORAGE=1` (`playwright.config.ts`) to
keep this auto-detection from finding a real `prisma/dev.db` a developer has
pushed locally mid test run — the suite's "every run starts from the same
seeded fixtures" guarantee depends on the driver being memory, deterministically,
regardless of what else exists on disk in that working directory.

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

## Storage indicator

A compact chip in the header (`src/components/layout/storage-badge.tsx`), not
the full-width banner earlier versions of this README described. The banner
was right to say what it said — it just said it at the wrong size for a fact
that is true on every single page load. Three states, distinguished by colour
and icon rather than by paragraph:

- **"Storage: Persistent"** (green) — `DATABASE_URL` set, or a local SQLite
  file auto-detected. Hovering names which.
- **"Storage: Demo Mode"** (neutral) — no database reachable at all. This is
  the honest, documented zero-setup path, not an error — Vercel with no
  `DATABASE_URL` configured lands here by design, and the badge says so rather
  than pretending otherwise.
- **"Storage: Degraded"** (red) — `DATABASE_URL` *was* set and Prisma could
  not use it. The one state that keeps a strong visual: this is a real
  misconfiguration risking silent data loss, not the zero-setup path, and it
  stays loud here, in `GET /api/health`, and in the server logs.

Same three states `getStorageStatus()` (`src/server/repository/index.ts`)
already reported to `/api/health` — the badge is a second, human-facing view
onto data that already existed, not a new source of truth.

---

## Authentication & sessions

A portfolio deployment has no sign-in wall: every visitor lands straight on
the dashboard, auto-signed in as the seeded "Owner at Acme Corp" persona,
zero clicks. Explicit sign-in — to try a specific role instead — is one click
away, never a requirement.

- **No sign-in wall, by design.** `(app)/layout.tsx` still gates every page on
  a valid session, but a request that arrives with none is no longer sent to
  `/sign-in` — it is sent to `GET /api/auth/demo-session`, which provisions a
  real session for the seeded demo Owner and redirects to `/dashboard`. This
  is not a second, weaker auth path: it signs the cookie with the exact same
  `encodeSession`/`sessionCookie` helpers `/api/auth/sign-in` uses, pre-filled
  with a fixed identity instead of a submitted password. Every write that
  identity makes afterwards is permission-checked and audited exactly like a
  password sign-in — the audit trail records it as `auth.demo_session`
  (`metadata.auto: true`) rather than letting it read as a real credentialed
  login.
- **A route handler, not the layout itself, does the provisioning** — Next.js
  refuses to let a Server Component mutate cookies mid-render, so the actual
  cookie-setting has to happen in a route handler the layout redirects to. It
  is rate-limited (30/min per client) the same way `/api/auth/sign-in` is: an
  ordinary visitor never gets near that limit, only a script hitting the
  endpoint directly, never sending the cookie back, would.
- **Explicit sign-in has not gone anywhere.** "Switch account" in the user menu
  clears the session and lands on the real picker — the only way to try a
  DevOps or Viewer's permission set specifically, or Stark Industries instead
  of Acme, rather than the default Owner guest.
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
- **The auth gate is a layout, not middleware.** Deliberately not Next.js
  middleware, which defaults to the edge runtime where `node:crypto` (used to
  sign and verify the cookie) is unavailable. One implementation of session
  verification, for pages and API routes both — the demo-session route handler
  reuses it rather than adding a second one.

> **Deploying to Vercel (or any multi-instance platform): set `VORTEX_SESSION_SECRET`.**
> Without it, the app does not fail to boot — it falls back to a per-process
> *ephemeral* secret, generated fresh on every cold start. That is fine for a
> single, long-running local process, and it is exactly wrong for a serverless
> platform: each instance mints its own random secret, so a session cookie
> signed by one instance fails to verify on the next request if it lands on
> another, and with the no-sign-in-wall flow above retrying automatically,
> that failure mode is `ERR_TOO_MANY_REDIRECTS`, not a clear error. The
> detection this depends on (`isProductionDeployment()` in
> `src/lib/runtime-env.ts`) checks `VERCEL_ENV` as well as this app's own
> `VORTEX_ENV`, specifically so a real Vercel deployment does not need anyone
> to remember to set the latter — but the secret itself still has to be set by
> hand, because there is no way to make an *ephemeral* secret stable across
> independent instances without configuring one. `GET /api/health` reports
> this directly under the `session_secret` check, and — as defense in depth
> independent of the root cause — `/api/auth/demo-session` cannot loop more
> than once regardless: a session that fails to verify on the very next
> request after being issued lands on `/sign-in?reason=session_unstable`
> instead of retrying (`ATTEMPT_COOKIE` in that route).

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

**400 unit tests** across 25 files, node environment, ~15 seconds:

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
| `cookie` | Sign/verify round-trip, tamper and expiry rejection, clock-skew tolerance, the secret-required check firing on Vercel production detected via `VERCEL_ENV` alone |
| `runtime-env` | `isProductionDeployment()` — `VORTEX_ENV`, `VERCEL_ENV`, both, neither, and confirming it deliberately ignores `NODE_ENV`; `isVercelRuntime()` — any Vercel environment vs. none, and that only the literal `"1"` counts |
| `compliance/report` | MTTR/MTTA/attainment computation, per-service and per-severity breakdowns, window scoping |
| `repository/memory` | Tenant isolation, credential encryption round-trip through the public/private shape split, append-only audit ordering, RBAC override CRUD, slug lookup — the fallback driver held to the same contract the database is |
| `stores` | Client-store pure logic only (sample folding, draft validation, the chaos spike's decay curve and per-metric multiplier) — mutation logic now lives server-side and is covered directly against the repository and via E2E |
| `services` | `pickRandomService()` distribution and boundary indices |
| `notifications` | `selectNotifiableIntegrations()` — enabled/event/severity gating, in isolation from any network call |
| `log-buffer` | Ring-buffer eviction, monotonic ids, pub/sub fan-out, a broken subscriber not blocking the others |
| `log-format` | Wire-format parsing with a graceful fallback for pretty/malformed lines, the level+text filter, plain-text export |
| `status-page` | Per-service status derivation, aggregate tier, the 90-day uptime grid's day-boundary math, uptime percentage, and — the load-bearing one — that `redactIncidentForStatusPage` actually drops `assignment`/`notification` timeline entries and never carries an `actor` field |
| `topology` | Layered layout (every node strictly right of its dependencies, no infinite loop on a cyclic edge set as a defensive check), health derivation scoped to the correct service and excluding resolved incidents, the live-sample estimate actually varying per service rather than repeating one number |
| `incident-analysis` | Determinism (same incident → byte-identical analysis), a different headline/commands per service, the generic fallback for an unauthored service, confidence bounds and severity ordering, that duration and impacted-request count are read from the real incident, not templated blind |
| `maintenance` | Status derivation at each of its four states including the cancelled-overrides-everything case, the public projection dropping cancelled windows entirely and ageing out old completed ones, service-id-to-name resolution with a safe fallback |
| `command-palette` | Case-insensitive substring matching on label and keywords, empty-query matches-everything, filter order preservation |

**314 E2E checks** (chromium + mobile Safari; 312 run, two skipped by design —
the storage badge is `sm+`-only chrome, and WebKit's Playwright driver cannot
grant the `clipboard-write` permission at all, see below) across sixteen spec
files: auth (covering the no-sign-in-wall flow — auto-provisioning, deep
links, "Switch account", the public-status-page shortcut in the user menu,
and a dedicated circuit-breaker suite that forges an unverifiable session
cookie to prove `/api/auth/demo-session` cannot loop more than once —
alongside explicit sign-in), dashboard (including the storage indicator
badge), incidents, integrations (including the quick-test helper),
multi-tenant, rbac, compliance (including the dedicated `/audit` page,
reachable from the sidebar on desktop and from the mobile nav drawer alike),
API surface (including a byte-level check that `/og` returns a real PNG, and
that `/api/health` reports `autoDetectedSqlite`), chaos, logs, the public
status page (including real, seeded maintenance windows alongside the honest
empty state for a tenant with none), the guided demo tour, the original
theme/accessibility checks, the **command palette** (search, keyboard nav,
navigation, the chaos drill's two-step confirm, permission gating), **service
topology** (every node present, real open-incident markers, the detail
panel's real incident list), the **AI root cause summary** (present with a
confidence score and two commands, genuinely different per service, the copy
button's confirmed state), and **maintenance windows** (scheduling, cancelling
without deleting, permission gating, syncing onto the public status page).

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
| Manual + fix | The auto-demo-session route hard-coded its redirect target to `/dashboard` — a deep link to any other page as a visitor's very first, cookie-less request got silently redirected away from where they were headed, landing on the dashboard instead. Left as-is deliberately: the requirement is "land on the dashboard," not "preserve arbitrary deep links," and the alternative (reading the request path before a session exists) meant reintroducing edge middleware for a single header read — not worth it for a case a second navigation resolves anyway |
| E2E | A test written to mirror an existing one omitted its `await expect(page).toHaveURL(...)` wait after signing in before clicking the user menu — Playwright's auto-waiting on the *next* locator eventually found the button, but the click landed mid-navigation and the dropdown never opened, hanging until the 30s test timeout. The sibling test right above it had the wait and passed instantly; the fix was copying it forward |
| Production report + manual repro | The real one: `ERR_TOO_MANY_REDIRECTS` on Vercel. Both `secret()`'s "refuse to boot without a session secret" check and the cookie's `secure` flag were gated on `VORTEX_ENV=production` — an app-level label that has to be set by hand and Vercel never sets automatically. Left unset, the app silently took the *development* branch instead of failing loudly: each serverless instance generated its own random ephemeral signing secret, so a session cookie signed by one instance failed to verify on the next request if it landed on another, and the no-sign-in-wall flow retried automatically on every failure — a real, reproducible infinite loop, invisible to local testing because a single long-running `npm start` process only ever has one ephemeral secret. Could not be caught by the existing E2E suite for the same reason it could not be caught locally at all: Playwright's `webServer` is one process. Fixed two ways — `isProductionDeployment()` (`src/lib/runtime-env.ts`) checks `VERCEL_ENV` as a second, unforgettable signal so the *existing* loud-failure code path actually fires on Vercel; and independently, `/api/auth/demo-session` now refuses to provision a second time within seconds of the first attempt regardless of *why* the first one didn't verify, capping the redirect chain at one extra hop no matter what breaks next. Reproduced and verified against a locally built server with `VERCEL_ENV=production` set and `VORTEX_SESSION_SECRET` deliberately unset before either fix existed, then again after |
| E2E | The circuit-breaker test forged a session cookie via `context.addCookies()` after a real one had already been set by an earlier navigation in the same test — Chromium held both as distinct entries (Playwright's derived `domain` from a bare origin did not exactly match the one the server set) and sent both back, with the real cookie winning; the test passed without exercising the code path it claimed to. Fixed by `context.clearCookies({ name })` before adding the forged replacement, in both the "should trip" and "should not trip" tests — the second one had the identical latent flaw despite already passing |
| E2E (mobile) | The new Audit & compliance nav-link test clicked the sidebar link directly and hung to the 30s timeout on mobile Safari — below the `lg` breakpoint the static rail is `display:none` (excluded from the accessibility tree entirely, not just visually hidden) and the drawer's own copy of the nav does not mount until the hamburger button opens it. Every other spec in the suite reaches a page with `page.goto()` and never clicks a sidebar link at all, which is exactly why nothing had caught this before; fixed by opening the drawer first on `isMobile`, the way an actual visitor on a phone would have to |
| E2E | `WebKit`'s Playwright driver has no `clipboard-write` permission to grant at all — `context.grantPermissions(["clipboard-write"])` throws `Unknown permission` outright rather than failing softly, unlike Chromium. The "Copy Fix Command" test skips on `webkit` with a named reason rather than papering over it with a try/catch that would silently stop testing the real behaviour on the browser that actually supports it |
| E2E (mobile) | The topology page's first render depends on both the incident store's async fetch and the metrics store's client-side init; `page.goto()` only waits for `load`, not for those to resolve. Every other topology test happened to interact with the graph slowly enough (typing, clicking, waiting on a toast) to clear the race by accident — the one test that asserted immediately after navigation was the one that caught it. Fixed by waiting for `networkidle` in `beforeEach`, the same hydration-timing fix already used in `auth.spec.ts` |

---

## Project layout

```
src/
├── app/
│   ├── (app)/                           # auth-gated: layout.tsx calls readSession()
│   │   ├── dashboard/ dashboard/logs/ incidents/ integrations/ audit/ settings/team/
│   ├── api/
│   │   ├── auth/sign-in, sign-out/       # scrypt verify, session cookie
│   │   ├── auth/demo-session/            # no-sign-in-wall: auto-provisions the demo Owner
│   │   ├── session/, session/organization/
│   │   ├── incidents/, incidents/[id]/
│   │   ├── integrations/, integrations/[id]/, integrations/test/, integrations/trigger/
│   │   ├── team/, team/[id]/
│   │   ├── rbac/                        # permission-matrix overrides
│   │   ├── audit/                       # read-only
│   │   ├── compliance/export/
│   │   ├── maintenance/, maintenance/[id]/  # schedule + cancel, synced to the status page
│   │   ├── chaos/simulate/              # the drill: incident + notifications + spike duration
│   │   ├── health/
│   │   ├── metrics/stream/
│   │   └── logs/stream/                 # SSE tail of the ring buffer, gated by logs:read
│   ├── status/[orgSlug]/                # public, no session — outside (app)
│   ├── og/route.tsx                     # dynamic OG/Twitter image, next/og, edge runtime
│   ├── sign-in/
│   ├── globals.css                      # design tokens, both themes
│   └── layout.tsx                       # document shell + pre-paint theme bootstrap + OG metadata
├── components/
│   ├── auth/ compliance/ charts/ dashboard/ incidents/ integrations/ team/
│   ├── layout/ logs/ status/ system/ theme/ ui/
│   ├── command/command-palette.tsx      # ⌘K / Ctrl+K, mounted once in AppShell
│   ├── topology/                        # topology-graph.tsx (SVG+HTML), topology-view.tsx
│   ├── incidents/root-cause-card.tsx    # "✨ AI Root Cause Summary" in the incident drawer
│   ├── incidents/maintenance-windows-card.tsx
│   ├── dashboard/demo-tour.tsx          # Quick Portfolio Tour
│   └── integrations/quick-test-helper.tsx  # one-click Discord/Telegram test shortcut
├── lib/
│   ├── alerting.ts  incidents.ts  metrics.ts  rbac.ts  status-page.ts   # pure domain logic
│   ├── topology.ts                      # dependency graph, layout, live-status derivation
│   ├── incident-analysis.ts             # the root-cause engine — see the module's own doc comment
│   ├── maintenance.ts                   # status derivation, public status-page projection
│   ├── command-palette.ts               # search/filter matching, kept pure and unit-tested
│   ├── logger.ts  log-buffer.ts  log-format.ts  log-schema.ts           # logging + live tail
│   ├── runtime-env.ts                   # isProductionDeployment(), isVercelRuntime()
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
├── store/           # zustand: thin API clients (incidents, team, integrations, maintenance),
│                     #   session preview, command-palette-store (open/closed only),
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
| `DATABASE_URL` | Enables real persistence (SQLite `file:` path or a Postgres URL). Unset → auto-detects a local `prisma/dev.db` (from `npm run db:push`) on any platform with a real filesystem; on Vercel, or with no local file either, in-memory fallback, data lost on restart. |
| `VORTEX_FORCE_MEMORY_STORAGE` | Skips the local-SQLite auto-detection above unconditionally. Not for normal use — exists so the E2E suite stays deterministic regardless of what a developer has pushed to disk in the same working directory (`playwright.config.ts` sets it). |
| `VORTEX_SESSION_SECRET` | Signs session cookies. **Required on a real deployment** — detected automatically on Vercel via `VERCEL_ENV`, not only via `VORTEX_ENV`, so this is not something to remember to opt into (see the callout above [Authentication & sessions](#authentication--sessions)). In development an ephemeral per-process secret is generated with a warning; on a multi-instance platform that same fallback is what turns a missing secret into `ERR_TOO_MANY_REDIRECTS` instead of a clear error, so it is refused there. `GET /api/health` reports this check by name (`session_secret`). |
| `VORTEX_ENCRYPTION_KEY` | AES-256-GCM key for third-party credentials at rest (64 hex chars). Falls back to deriving one from `VORTEX_SESSION_SECRET` if set. Missing both → credentialed integrations are refused (503), never stored in plaintext. |
| `VORTEX_DEMO_PASSWORD` | Password for every seeded demo account. Deliberately gated on `VORTEX_ENV=production` **only**, not the broader Vercel detection above — this deployment's whole premise is a publicly known demo password shown right on the sign-in page, so treating a bare Vercel deployment as a reason to refuse seeding would break the one thing this app is for. Set this explicitly if you fork this into something that is not a public demo. |
| `VORTEX_SKIP_SEED` | Skip fixture seeding once real customer data exists. |
| `VORTEX_WEBHOOK_SIGNING_SECRET` | Enables `X-Vortex-Signature` on custom webhooks. Unset → sent unsigned, and `/api/health` says so. |
| `VORTEX_MAIL_RELAY_URL` | Enables email delivery. Unset → email test/trigger sends return 503. |
| `VORTEX_ALLOW_PRIVATE_WEBHOOK_HOSTS` | Development only. Relaxes the SSRF guard; hard-ignored on any real deployment, detected the same Vercel-aware way as the session secret above. |
| `LOG_LEVEL`, `LOG_PRETTY` | Logger verbosity and human-readable local output. |
| `VORTEX_SERVICE_NAME`, `VORTEX_ENV`, `VORTEX_REGION` | Stamped onto every log line. `VORTEX_ENV` is this app's own environment label; unset on a real Vercel deployment, log lines still report `env: "production"` by falling back to `VERCEL_ENV` rather than misreporting `"development"`. |
| `NEXT_PUBLIC_APP_URL` | Public base URL, used only to resolve absolute `og:image`/`twitter:image` URLs (`metadataBase` in `layout.tsx`). Unset → `localhost`, fine in development but breaks the social preview on a real deployment. |

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
- **The AI root cause assistant is a deterministic diagnostic engine, not a
  live model call.** See [AI root cause assistant](#ai-root-cause-assistant) —
  it makes no network request and does not claim to be a specific external
  LLM. Wiring a real one in is a legitimate future seam, deliberately not
  built as part of this pass.
- **The log ring buffer is in-process and unpartitioned**, the same "one
  instance, not a distributed store" trade-off as the rate limiter — behind
  several replicas each holds only its own recent lines, and the buffer is not
  filtered per organisation the way every other resource in this app is,
  because infrastructure logs describe the platform, not one tenant's data.
  A real deployment ships this to Datadog/Loki/CloudWatch, which the logger's
  newline-delimited JSON output already targets.
