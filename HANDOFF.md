# Handoff — workwise_web

Read this first in a new chat.

## Where things stand

**Three repos, one product.** This file covers `workwise_web` **and**
`workwise-mobile` until the mobile repo gets its own.

| Repo | What it is |
|---|---|
| `workwise_web` (here) | The dashboard, `app.joinworkwise.com`. Next.js + Supabase. |
| `workwise-mobile` | The phone app. Ships by OTA, same login as the dashboard. |
| `workwise_site` | Marketing site. Also serves the live Lite `widget.js`. |

**Live today: Pro.** Real paying tenants (RS Locksmiths, Eden), set up by hand.
Everything in the Rounds programme is **additive** — new tables, new columns, new
routes. Nothing may change how Pro behaves or looks. If a change would touch
Pro's jobs, workers, or phone tabs, that is a bug, not a feature.

**Being built: Rounds + Lite + self-serve signup.** Eight phases, ~12 weeks,
one person plus agents. Currently **Phase 1**, branch `rounds-foundations`.

**Two rules that apply to every phase:**
- Deploy order is always **paste migrations → deploy web → mobile OTA**. An OTA
  that reads a column the database doesn't have yet 400s the app.
- `supabase/schema_current.sql` is the **owner's** file, exported from Supabase.
  Agents never edit or commit it. It describes the *live* database. For tables
  added in the current phase it may lag — read the files in `supabase/migrations/`
  instead, they are the source of truth for anything new.

**The other documents, and what each one answers:**

| File | Use it for |
|---|---|
| `../docs/PRODUCT.md` | "Are we building the company I want?" The overview. Wins any disagreement. |
| `../docs/ROUNDS-PLAN.md` | The 12-week engineering plan and cross-repo technical design. |
| `../docs/specs/phase-1.md` | What to build this phase. §9 is the step list. |
| `../docs/WORKING-WITH-CLAUDE.md` | Which model does what, and how to keep sessions cheap. |
| **This file** | What is actually in the repos right now, and which SQL still needs pasting. |

## House rule for every agent working here

This file is the only place that says **where we actually are**. A new chat sees
the repo, not the previous conversation, so an out-of-date HANDOFF means the next
agent guesses or redoes finished work.

So, as you work:

1. **Update this file as you go, not just at the end of a phase.** After finishing
   a step (or when a decision changes the design), edit the "IN PROGRESS" section
   below: what is done, what changed, what is next. Two lines is enough.
2. **Tick the step list in the phase spec** (`../docs/specs/phase-1.md` §9) so the
   next prompt does not repeat a step. Mark it `— DONE` rather than deleting it.
3. **If a product decision changes mid-phase, write it into the spec first**
   (and `../docs/PRODUCT.md` when it changes what the product *is*), then fix any
   code already built to the old rule. Do not leave the decision only in chat.
4. Order of truth when they disagree: `../docs/PRODUCT.md` → phase spec → this file.

New chat should start: read this file, then `../docs/PRODUCT.md`, then
`../docs/specs/phase-1.md` §9, then do the next unticked step.

---

## Phase 1 — Rounds core (branch `rounds-foundations`) — IN PROGRESS, at step 5 of 32

Spec: `../docs/specs/phase-1.md` (§9 is the step list). Product picture:
`../docs/PRODUCT.md`. Steps 1–4 are done; **step 5 (route optimiser) is next**.

**Done so far**
- **Step 1** — `vitest` added (`npm test`, `vitest.config.ts` with the `@/` alias,
  `test.include: lib/**/__tests__/**/*.test.ts`) + `lib/__tests__/smoke.test.ts`.
  Pinned to `vitest@4`: v5 wants `@types/node` 22+ and this repo is on 20.
- **Step 2** — the five Phase 1 migration files written **and pasted by the owner**
  (see "SQL" below). Nothing else in Phase 1 has touched the database.
- **Step 3** — `lib/rounds/dates.ts` (Ymd helpers, `todayInLondon`, DST-safe
  `addDays` via `Date.UTC`), `lib/rounds/settings.ts` (`RoundsSettings`,
  `DEFAULT_ROUNDS_SETTINGS`, tolerant `parseRoundsSettings`), and
  `TenantSettings.rounds` added in `lib/data/settings-types.ts`. Tests cover the
  exact JSON `provision_tenant_from_intent()` already writes.
- **Step 4** — `lib/rounds/recurrence.ts`: `planVisits` for both modes,
  `snapToPreferredWeekday` (±3, later date on a tie), `planNextAfterCompletion`,
  cursor helpers, `R-<agr6>-<yyyymmdd>` references, `buildVisitInsert` (writes
  `status 'assigned'`, `industry_data {}`, `payment_status 'unpaid'` so the
  existing DB-only `jobs` triggers stay harmless).
- 45 unit tests pass; `tsc --noEmit` clean.

**Decision changed mid-phase (2026-09-15 evening, after talking to window cleaners)**
- **Do not auto-move visits off weekends / days off.** `RoundsSettings` gained
  `shift_off_non_working_days`, default **false**, and
  `shiftForWorkingDaysAndBlackouts` is a no-op unless it is true. Reason: rounders
  work 3–4 days and keep the other days spare for weather and overrun. Auto-moving
  a bank-holiday Friday onto Monday eats that buffer. `working_days` now means
  "days I usually work" (calendar shading), not "days a job may exist".
  Tenants provisioned before this have no flag, which parses as off — correct.
- **New feature in the spec, not built yet: Move remaining.** One action on phone
  Today and the dashboard day view — pick a date, every **not-done** stop that day
  moves there, done stays done, later cycles do not move. Covers rain, half a wet
  day, didn't finish, van broke. Per-house Skip/Reschedule still exist. Lands in
  steps 8 (`moveRemainingCore`), 13 (`moveRemaining` action), 15
  (`/api/rounds/visits/move-remaining`), 21–22 (dashboard), 28 (phone Today).

**SQL — already pasted by the owner, in this order** (`supabase/migrations/`):
1. `20260915100000_service_catalog.sql`
2. `20260915100100_service_agreements.sql`
3. `20260915100200_jobs_rounds_columns.sql`
4. `20260915100300_customers_rounds_columns.sql`
5. `20260915100400_ai_interactions_rounds_types.sql`

**Owner follow-ups still outstanding**
- Refresh `supabase/schema_current.sql` from the live schema (owner's file; agents
  never edit or commit it).
- Regenerate `workwise-mobile/src/types/supabase.ts` (or hand-add per spec §5.1)
  before any mobile work — that is step 26, not now.
- `EXPO_PUBLIC_API_URL` into EAS env before the OTA (Phase 1 close).

**Not verified yet**: nothing Phase 1 has been exercised against a real Rounds
tenant — there are no Rounds screens or server actions yet, so there is nothing to
click. Verification plan is spec §7.

**No web env vars added by Phase 1.** No deploy needed yet. Do not OTA.

---

## Rounds foundations — Phase 0 (branch `rounds-foundations`, 2026-09-14) — UNCOMMITTED

Phase 0 of the Rounds + Lite + self-serve plan (full plan, shared across all
three repos: `../docs/ROUNDS-PLAN.md`; working method: `../docs/WORKING-WITH-CLAUDE.md`). The same
branch name exists in `workwise-mobile/`. Nothing here has been run against the
database — the owner pastes all SQL by hand and updates `schema_current.sql`.

**What's built**
- `subscriptions`-based entitlements: `lib/data/tenant-products.ts` →
  `getTenantProducts()` (React `cache()`, entitled = trialing/active/past_due/
  manual). Falls back to the legacy `settings.features.pro` flag only while a
  tenant has *zero* subscriptions rows, so RS/Eden keep their sidebar until the
  backfill runs. `lib/data/tenant-features.ts` is now a thin wrapper.
- Route enforcement via nested layouts: Pro pages moved (git mv, URLs unchanged)
  into `app/(dashboard)/(pro)/` with a guard layout; `rounds/` and `lite/` groups
  with their own guards and placeholder homes; `/dashboard` switches on
  `products.primary`; sidebar renders per-product sections.
- Self-serve signup: `/signup?product=rounds|lite` → `lib/actions/signup.ts`
  (admin createUser → `signup_intents` → Stripe customer → server sign-in →
  Checkout, 14-day trial, card upfront) → `app/api/stripe/webhook` (insert-first
  idempotency on `stripe_events`; `checkout.session.completed` calls the SQL fn
  `provision_tenant_from_intent`; subscription events → `lib/stripe/sync-subscription.ts`)
  → `/signup/complete` polls `/api/signup/status` then goes to `/dashboard`.
  `/api/stripe/checkout` resumes an abandoned Checkout. Settings gained a Billing
  tab → Stripe Billing Portal. `/api/cron/cleanup-signups` (daily, `vercel.json`).
- Agency referral is dropped entirely (user: the model failed).

**SQL to paste, in order** (`supabase/migrations/`):
1. `20260914100000_subscriptions.sql`
2. `20260914100100_signup_intents_stripe_events_provision_fn.sql`
3. `20260914100200_backfill_manual_pro_grants.sql` — check its final SELECT shows
   RS Locksmiths + Eden as `pro / manual`.
4. `20260914100300_capture_existing_jobs_triggers.sql` — not a change: run the
   SELECT, paste its output under the marker, commit.

**Env vars to add** (`.env.local` + hosting): `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ROUNDS`, `STRIPE_PRICE_LITE`
(`STRIPE_PRICE_STARTER/GROWTH/PRO` optional until Pro self-serve), `CRON_SECRET`.
`NEXT_PUBLIC_APP_URL` already exists and is used for Checkout return URLs.

**Stripe dashboard setup (test mode first)**: Products + monthly Prices for
Rounds and Lite (£49; £29 launch discount as a coupon/promotion code —
`allow_promotion_codes` is on); webhook endpoint `<app>/api/stripe/webhook` with
events `checkout.session.completed`, `customer.subscription.created/updated/deleted`,
`invoice.payment_failed`, `customer.subscription.trial_will_end`; Billing Portal
configuration enabled (cancel, update card, switch Lite↔Rounds).

**Verified**: `tsc` clean; `/signup` renders (screenshot taken); dashboard logs
show the legacy fallback firing because `subscriptions` doesn't exist yet
(expected). **Not verified** (needs a login + the tables): signup end-to-end,
`/jobs` redirect for a non-Pro tenant, Billing tab. Two pre-existing
`react-hooks/set-state-in-effect` lint errors in `components/layout/sidebar.tsx`
are untouched.

**Mobile (`workwise-mobile`, branch `rounds-foundations`)**: `src/lib/entitlements.ts`
reads `subscriptions` for `workers.primary_tenant_id`; `WorkerContext` exposes
`products` + `appMode` (cached in AsyncStorage for offline boot); `RootNavigator`
renders `RoundsTabs` (placeholder Today/Calendar/Customers/Money/Profile) when
`appMode === 'rounds'`, else the existing `MainTabs`. `LoginScreen` no longer
calls `navigation.replace("MainTabs")`. `subscriptions` added by hand to
`src/types/supabase.ts`. `eas-cli` pin bumped to `^23` (run `npm install`).
`expo export --platform ios` bundles clean. Two pre-existing TS errors in the
owner's uncommitted work (`useJob.ts:35`, `queries/index.ts:164`) are not from
this branch. Known gap: the reused `CalendarScreen` still navigates to
`JobsStack/JobDetail`, which doesn't exist under `RoundsTabs` — Phase 1 gives it
an `onOpenJob` prop. Do not OTA this until migration 1 is pasted.

---

## Pro backlog — still open, not part of the Rounds programme

These are live Pro items. None of them block Rounds, and none are scheduled.
Don't pick one up mid-phase without asking.

- **JWT/session perf (Option A1+A2)** — middleware currently does 2 sequential
  network round-trips per request (`getUser()` + a `users.role` query). Plan:
  bake `role` into the JWT via a Supabase auth hook + switch to local JWT
  verification. Owner wants this on a big model given it touches every
  authenticated request — discussed but not built.
- **Export rework** — Stripe-style: scope picker (all/page/custom count) +
  column picker. Designed in conversation, not built.
- **Address autocomplete → full postcode enumeration** — Google Places (New)
  cannot list every address at a postcode (confirmed via live test — it's not
  a UK PAF/Royal Mail data lookup). getAddress.io was ruled out (Oct 2025
  High Court judgment against them for using unlicensed Royal Mail/IDDQD
  data — **do not use**). Parked; the owner will explain the "finds the street,
  not every house number" limitation to their client for now.
- **Remove "worker name" from import column-mapping options** — flagged by the
  owner as nonsensical to have there, not yet investigated/fixed.
- **Backfill** — the ~100 real jobs imported before the geocoding fix still have
  null lat/lng and empty skills; would need a one-off re-run script.

## Known, accepted limitations (not bugs)

- AI skill detection isn't perfectly deterministic — identical job
  descriptions can occasionally get slightly different detected skills
  (LLM sampling variance). The clustering split-by-signature logic already
  handles this gracefully.
- Auto-assign is skill-strict (all-or-nothing) by design, per owner decision.

---

# Archive — Pro work that already shipped

Everything below is **history**, kept for context on why the Pro code looks the
way it does. It is committed and deployed; the SQL it mentions is applied. Do not
action anything in here. Verified 2026-09-16: commits `e3040d1`, `77e4434`,
`d4bebe4`, `2c3aafe`, `6341e07` are all ancestors of `HEAD`, and `job_groups` +
`import_sources.grouping_columns` are present in `schema_current.sql`.

## Maps, geocoding, dispatch and clustering (branch `fix/maps-geocoding-dispatch-and-ai-model`)

- **Root cause of "AI does nothing"**: `lib/services/ai-logger.ts` had a retired
  model (`claude-sonnet-4-20250514`, 404s) hardcoded as default. Fixed — now
  defaults to `claude-haiku-4-5` (tested equal accuracy to Opus on this
  classification task, far cheaper), overridable via `ANTHROPIC_MODEL` env var.
- **Geocoding**: was silently failing (Google billing/API issues swallowed,
  jobs stored with null lat/lng). Now tries free postcodes.io first, Google
  as fallback only. `lib/utils/geocoding.ts`, `lib/utils/places.ts`.
- **Perf**: killed a 500-row fetch used only for `.length`, made `xlsx`
  dynamic-import (was loading on every jobs-page view), replaced
  framer-motion in the sidebar with CSS (it was only animating width/opacity).
- **Login toast** only fired on the first failed attempt — fixed (nonce in
  action result so `useEffect` re-fires).
- **Dispatch modal** redesigned: grouped by worker, shows address/skills,
  labels sourced from `tenant_skills` (was hardcoded).
- **Job clustering** (new): `lib/jobs/assignment-ranking.ts` +
  `autoAllocateJobGroup` in `lib/actions/jobs.ts`. Jobs imported at the same
  postcode are grouped and assigned to one worker as a unit (5 jobs in one
  building → 1 worker, not 5 separate dispatches). If no worker covers the
  union of the group's required skills, it splits by skill signature and
  retries subsets rather than failing the whole site. Also fixed a dead
  load-balancing tiebreaker (was comparing floats for equality, never fired)
  — replaced with a weighted score (`assignmentScore`), 17/17 unit tests pass.
- **Worker skills cap removed** — `MAX_SKILLS = 10` in `worker-form.tsx` and
  `invite-worker-dialog.tsx` was silently blocking any 11th skill with no
  error shown. This was the actual cause of a failed clustering test (worker
  had "all 10 skills" per the cap, but not the two the job actually needed).
- **Clustering — confirmed working with two competing workers.** Re-ran
  `test-jobs-clustering.csv` with a second test worker (all skills, postcode
  `NW2 6JN`, ~3.4km from the `NW6 5DG` test cluster) alongside the original.
  Result: the two clusters resolved to *different* workers, and neither
  cluster split — `NW6 5DG` (5 jobs) went entirely to the new worker,
  `CR7 8JF` (3 jobs) went entirely to the original. That's the strong pass:
  not just "no splits," but proof each site is ranked independently rather
  than everything piling onto one default worker. Considered production-
  ready. One residual caveat, not worth chasing further: since all 5 NW6
  jobs share identical coordinates, if the winning worker was clearly closer
  on raw distance, naive un-grouped per-job ranking might have coincidentally
  produced the same result — the load-penalty tiebreaker only bites once
  enough jobs stack up, and 5 may not be enough to isolate that specific
  edge. Doesn't change the verdict; the end-to-end behavior is correct
  either way.

## Job groups + bulk/inline assign (2026-09-13 — shipped, SQL applied)

Built from Debbie's (RS Locksmiths) three asks: see grouped jobs, assign a group
to one locksmith in one go, and assign workers straight from the jobs list.

- **Migrations `20260913100000_job_groups.sql` and
  `20260913100100_import_sources_grouping_columns.sql` are applied** — both
  appear in `schema_current.sql`. (This section previously said they still
  needed pasting; that was stale.)
- **Model**: `job_groups(id, tenant_id, label, import_history_id)` +
  `jobs.job_group_id`. Trade-agnostic on purpose — nothing says "warrant
  officer". No schedule on the group (date/time stay on the jobs). A group is
  an affordance, not a lock: assigning a group cascades to every member via
  `assignJobGroup`, but a member can still be reassigned on its own (the job
  detail Assignment card shows a "Part of group X" hint + link).
- **Jobs list** (`components/jobs/jobs-table.tsx`): members are clustered
  under a header row (label · count · worker picker that assigns the whole
  group · Ungroup). Clicking the label filters to `?group=<id>` (new
  `JobsFilters.job_group_id`). Bulk bar gained **Assign worker**, **Group
  selected** (≥2 rows) and **Ungroup**. The Worker column is now an inline
  type-ahead (`SearchableSelect`) for pending/pending_send/assigned/declined
  jobs (`canAssignWorkerInline`); other statuses keep the plain link.
- **Import**: `import_sources.grouping_columns` (NULL = never decided, [] =
  off). Review step shows `ImportGroupingPanel`: for a new customer the wizard
  asks the model once (`lib/import/suggest-grouping-columns.ts`, Opus 5, ~5k
  tokens; on Debbie's sheet it picked W/O First/Last Name + Mobile + Date
  Required) and the user confirms; a returning customer gets their saved
  choice with no AI call. Grouping itself is deterministic
  (`lib/import/job-grouping.ts`, sets of ≥2 rows only). `importJobs` creates
  the groups after insert and auto-allocates a group as one unit
  (`autoAllocateJobGroup`), falling back to the postcode cluster for
  ungrouped jobs.
- Shared assignment core moved to `lib/jobs/assign-worker-to-jobs.ts` (not a
  `'use server'` module — it takes `tenantId`, so it must not be an endpoint).
- **Not visually verified** — the Browser pane needed a login. tsc + eslint
  clean; helper verified against the real sheet via a scratch script.
- **Later**: worker app gets N `pending_send` jobs individually when a group
  is sent; a "3 jobs · <group>" card in the app is a follow-up, not built.

## Verified how (in case it matters)

Real job data was exported from Supabase (`jobs_rows.json`, not in repo) and
used to test geocoding, skill detection, and clustering against actual
addresses/postcodes — not synthetic data. Two test CSVs exist at repo root
(untracked): `test-jobs-clustering.csv` (mixed skills, 2 clusters + 2 solo
jobs) and `test-jobs-clustering-noskill.csv` (isolates clustering from
skill-matching).

