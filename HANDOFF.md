# Handoff — workwise_web

Read this first in a new chat.

## Deploying the dashboard (21 Oct 2026)

The live site is this folder on `main`. Upload it with `npx vercel --prod` from `workwise_web`. A push to GitHub does not update the site by itself.

- Commit the app changes, then upload that same folder. Never `git stash` before a production upload. Doing that ships an older site and takes Frankfurt and the quicker dashboard off.
- `vercel.json` keeps `"regions": ["fra1"]`. After the upload, check the deployment runs in `fra1` before saying it is live.
- Do not commit `supabase/schema_current.sql` or `supabase/.temp/`.

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
one person plus agents. Phases 1–3 code is on branch `rounds-foundations`
(pushed to GitHub 2026-09-29 so nothing is lost) and is **not deployed**.
Phase 2 (payments) is done; Phase 3 (messaging) is **code complete, walkthrough
not finished** — see the Phase 3 section below. Phase 4 is now **Direct Debit
(Stripe Bacs)**: `../docs/specs/phase-4/` (open banking parked 2026-09-29 in
`../docs/specs/parked/open-banking/` — too expensive before revenue). Do not deploy, OTA, or merge
to `main` until the owner asks — they want every phase finished, and to be happy
with it, before anything goes live. Pushing the branch is fine when they ask.

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
| `../docs/specs/phase-1.md` | Phase 1 (done). §9 is its step list. |
| `../docs/specs/phase-2.md` | Phase 2 payments (done). §6.0 is the step index. |
| `../docs/specs/phase-3/` | Phase 3 messaging (code complete). `README.md` is the step index; one card per step. |
| `../docs/specs/phase-4/` | Phase 4 Direct Debit (Stripe Bacs). Spec written 2026-09-29; `README.md` is the step index. |
| `../docs/specs/phase-5/` | Phase 5 running the business. **Signed off by the owner 2026-10-02, not released.** `README.md` is the step index. |
| `../docs/specs/phase-6/` | Phase 6 Lite in the dashboard. **Code complete; owner happy with the walkthrough 2026-10-05; not released.** `README.md` is the step index. |
| `../docs/specs/phase-7/`, `phase-7b/`, `phase-7c/` | Launch: 7 selling it (plans, referrals, Plan & billing), 7b dashboard design refresh, 7c release and launch. Planned 2026-10-02; start after Phase 6. `README.md` in each is the step index. |
| `../docs/specs/parked/open-banking/` | Parked open-banking (Yapily) spec — for after revenue. Do not build from it. |
| `../docs/DASHBOARD-LOOK.md` | How Rounds/Lite pages must look: palette, tones, kit, popup rules. |
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
2. **Tick the step list in the phase spec** (`../docs/specs/phase-2.md` §6.0 while
   Phase 2 is open; later the active phase's index) so the next prompt does not
   repeat a step. Mark it `— **DONE**` rather than deleting it.
3. **If a product decision changes mid-phase, write it into the spec first**
   (and `../docs/PRODUCT.md` when it changes what the product *is*), then fix any
   code already built to the old rule. Do not leave the decision only in chat.
4. Order of truth when they disagree: `../docs/PRODUCT.md` → phase spec → this file.
5. **After every step, explain it in the chat — not here.** This file stays a
   short "where we are" tick. The owner is not reading the spec for fun. In the
   reply that closes the step, say in plain language: which step number it was
   and the spec's one-line title; what you actually built (files, in English);
   what that is *for* (who uses it later — dashboard form, phone day-run, cron,
   etc.); anything they should know (defaults, things you did not do, next step
   number). Do not paste that recap into this file.

A new build chat reads only the two lines under IN PROGRESS, then that one step
card. It does not read this whole file, `PRODUCT.md`, or the rest of the spec.

## IN PROGRESS

- **Phase 9 — walkthrough (step 34) run by Claude with the owner on 2026-10-13, awaiting the owner's "walkthrough done" before it is ticked.** Spec `../docs/specs/phase-9/` (README ticks); results `../docs/specs/phase-9/test-data/walkthrough-results.md` (all 31 rows: 27 pass, 4 partly because they need a real phone; stop-ship rows 15 and 16 pass). Five bugs found and fixed during the walk: B (phone first sign-in offline never re-checked staff), C ("with Dave" tag and the Came in headline), F (Tell them preview for a push back), H (removed lead's phone not signed out), I (next-bill wording left out the team line; Add Lite "Now" row), plus a one-line type fix in `workwise_site/components/support/fragments.tsx`. Still awaiting the owner's look: 23b, 23c, 23d, 32, 33. Then step 35 (docs). Released together with Phase 7c.
- **Next: owner says "walkthrough done" (rows 8–10, 14, 21, 25 were watched), then tick step 34 and do step 35**, then the cleanup below: paste `supabase/seeds/team-test-remove.sql` (slug `team-test-cleaning`), cancel the test subscriptions in Stripe test mode (owner `sub_1UQCMiRvyWfzuOqMemkAcKZ5`, solo `sub_1UQCMnRvyWfzuOqMLqhWgBho`, pro check `sub_1UQDINRvyWfzuOqMjpN3bKx1`).

- **Worker web area + self-employed workers (2026-10-08): BUILT, awaiting the owner's steps and a visual check.** Spec `../docs/specs/worker-web/` (README has the build-status table). Built and tested (tsc clean, 1,912 tests): `/worker` area (Dashboard, Calendar, Jobs + job page, Profile; employees only get this, `lib/auth/worker-link*.ts`, `lib/worker/*`, `lib/data/worker/*`, `components/worker/*`), migrations 1 and 3 written (`20261008100000`, `20261008100200`, NOT pasted), Subcontractor set-up invite (`lib/invites`, `app/accept-invite`, `/api/invite/*`), worker Lite checkout at £28 (`lib/billing/worker-lite.ts`, webhook `worker_lite`), daily `worker-discounts` cron + hooks in `lib/actions/workers.ts`, Add Lite worker card/page. **Needs the owner: 👤 step 1 (Stripe test coupon) and 👤 step 6 (paste the 3 migrations: `20261008100000`, `100100`, `100200`).** Pages were checked live as the Pro Test employee (desktop, phone, dark). A middleware bug that had disabled every role check there was found and fixed (`lib/supabase/cookie-merge.ts`); the portal-login redirects in that block are now live for the first time, so test a portal login before release. Gotchas: the web `JobStatus` union in `lib/data/jobs.ts` is stale (the real enum has accepted, en_route, arrived); the existing Rounds Add Lite upgrade never creates the `widget_clients` row Lite needs (only signup does), worth a look.
- **Rounds map, step 1 (2026-10-07): built, not ticked.** New sidebar item **Map** (`/map`, Rounds only). Every active agreement with a position as a pin (rose owes / amber due this week / blue fine); layers switch separately (Heatmap Off/Money/Customers, Pins, Area outline); side panel adds up whatever is in view (customers, yearly value, visits this month, owed) and says 'In view' with a Show everything button once zoomed; 'N customers aren't on the map' note for agreements with no lat/lng. No database changes. Files: `lib/rounds/map-areas.ts` + `map-build.ts` (pure, tested), `lib/data/rounds/map.ts`, `components/maps/rounds-map.tsx` (Leaflet, heat = blurred circles, no new dependency), `components/rounds/rounds-map-view.tsx`, `app/(dashboard)/map/page.tsx`. Checked on Test rounds 2 at desktop light/dark and 375 (stats follow zoom, popup opens). Test data has no positions for the 40 look-test customers: optional `supabase/seeds/look-test-rounds2-map-coords.sql` (owner pastes) moves all of that business's agreements into four Leeds neighbourhoods. **Redone later the same day (owner feedback: full screen, nicer heat, pins, card): the map fills the page (`DashboardScroll` has a `/map` full-bleed case) with a 380px side panel that slides off to the right via a small edge tab (choice remembered in the browser; New/Edit round reopens it; desktop only) (pull-up sheet with a four-number strip on a phone); pins are white-ringed dots that group into numbered bubbles when zoomed out (`lib/rounds/map-cluster.ts`); tapping a pin shows a customer card floating above the pin on the map (a styled Leaflet popup, `SelectedPopup` in `rounds-map.tsx`; owner asked 2026-10-07 for it on the map not in the sidebar; closes with its X or by tapping the map; several places on one spot show a list) (`map-place-card.tsx`: tags, price and how often, yearly value, next visit, Open customer, Call); heat is one canvas under the pins: the smooth **Glow** (real ~650 m spread, green to yellow to orange to deep red, map not dimmed); the owner compared it with hexagon Tiles and chose Glow, Tiles removed. Pins follow the heat: heatmap on = no pins until zoom 12 (hint 'Zoom in to see individual customers'), then plain dots with no numbers or grouping; heatmap off = numbered bubbles. Hover/tap shows the figures behind the colour (`lib/rounds/map-heat.ts`, tested).** **Step 2 (built 2026-10-07, code only, NOT yet verified in the browser: needs `supabase/migrations/20261007100100_rounds_grouping.sql` pasted by the owner first; until then the map shows 'rounds couldn't load' and works as before): named rounds.** `rounds` table + `service_agreements.round_id` (a round holds PLACES/properties, one round per place, deleting a round just un-groups). Map panel: Rounds list (click = filter map + numbers to that round, others fade; pencil = edit), New round with Draw on map / Pick customers (draw never steals from another round; pick can move a place, the panel says how many will move), name + 8 colours, Save / Delete. Round areas drawn from their members with the name on the map ('Rounds' chip). Files: `lib/rounds/rounds.ts` (pure, tested), `lib/actions/rounds/rounds.ts` (saveRound / deleteRound), `components/rounds/round-editor.tsx`, changes in `rounds-map-view.tsx` / `components/maps/rounds-map.tsx`, `.ww-round-label` in globals.css. **Rounds on the other pages (2026-10-07, built):** Customers list has a Round filter (shown only when rounds exist) and round chips under each name; customer page header shows the customer's rounds and each agreement row shows its round (`lib/data/rounds/round-membership.ts`, `components/rounds/round-chip.tsx`; all tolerant: no rounds table = no chips, nothing breaks). Migration was pasted by the owner and they made 3 test rounds (Test, test 2, test 3); checked by DOM (list filter, chips, customer page, map round list); map pictures not re-checked because the browser pane was hidden. **Not built, deliberately:** round as broadcast audience, wait for broadcasts. Mockup agreed with the owner in chat 2026-10-07.
- **Your assistant (2026-10-07): SQL pasted by the owner, working in the browser on Test rounds 2.** Plan: `../docs/specs/assistant/PLAN.md`. Web: sidebar "Your assistant" + **Ask WorkWise bar above Settings (⌘K) → the full `/assistant` page** (keeps its chat; id in localStorage; clears after 45 quiet minutes or Clear); **round Ask button bottom-right on every page → quick ask docked at the right** (fresh each open, no dimming, follows pages). Thinking = hopping dots + shimmer until the answer finishes. Maps place stops by postcode, then postcode area (postcodes.io); any customers can be mapped; money charts: in/out, spending by category, how they paid; any month. Tools tell Claude what's on screen (`on_screen_now`). **Eval:** `npx vitest run -c vitest.eval.config.ts` asks 47 real questions as Test rounds 2 (≈£1, never taps Do it) → `scripts/assistant-eval/report.md`; last run 45/47 clean, the other 2 reviewed and fine. Phone: `src/screens/rounds/assistant/*`, round Ask beside the tab bar (JS only, OTA-safe; not yet run in the simulator). **Cost pass (2026-10-07):** instructions cut 2,082→692 tokens and made the same for every business (name goes in each question), how-to help moved to a `how_to` tool, tool descriptions/results trimmed (fixed part 9.6k→7.3k tokens), tools + instructions cached for 1 hour (shared across businesses), short notes before lookups held back, cap 300→150 a month. Measured: ≈0.7p a question average on the eval (was ≈1.2p warm / 2.3p cold). Size check: `npx vitest run -c vitest.eval.config.ts size` (free).
- **Renamed Lily (2026-10-07, owner's choice, everywhere):** web sidebar bar "Ask Lily" (⌘K), page and tab title "Lily", quick ask header "Lily", intro "Hi, I'm Lily. What do you need?", a "Lily is an AI assistant" line in How it works; phone: round button label "Ask Lily", sheet header "Lily", "Hi, I'm Lily."; system prompt now starts "You're Lily, the assistant inside WorkWise" and says to admit being an AI if asked (the prefix changed, so the first question after deploy is a cache miss; re-run the free size check). Strings only: route stays `/assistant`, no DB change, phone is OTA-safe (JS only). The Lite website quote widget is still called "the assistant" and is not Lily.
- **Lily on the website too (2026-10-07):** the Lite quote assistant is now Lily as well. Visitor chat keeps the business name on top with "Lily, AI assistant · Powered by WorkWise" (`public/widget.js`, `components/lite/widget-preview.tsx`); her widget instructions open "You are Lily, the website assistant for …" and say "Lily, an AI assistant for …" if asked whether she's a person (`lib/widget/prompt.ts`, its test and `require-lite.test.ts` updated); the set-up interview greeting/prompt, dashboard strings (setup banner, widget status "Pause Lily", transcript bubbles "Lily", conversations, setup titles) all say Lily. Also new: a dismissible **Lily welcome card** on the Rounds overview (`components/assistant/lily-welcome.tsx`, remembered in localStorage only) whose examples open `/assistant?ask=…`; the page asks that question once her chat has loaded and then clears the URL. NOTE for later: Lily's chats are soft-deleted (`deleted_at`) when cleared, not purged: the rows (and the questions and answers in them) stay until the account is deleted; the privacy page says exactly that. A purge job after N days would be a sensible post-launch tidy-up. Tests: 1756 pass; tsc clean.
- **Lily for Pro offices (2026-10-08): built, seen on the Pro Test business, web only.** Plan and details: `../docs/specs/pro-refresh/PLAN.md` ("Pro assistant (Lily) built"). She is offered to a Pro **office admin** only when the business is on the new look (`tenants.settings.look = 'new'`): `requireAssistantCaller` refuses a classic-look Pro business (so RS Locksmiths see and get nothing until the owner flips them), the layout only passes `assistant` to the shell when `look === 'new'`, `/assistant` redirects otherwise. Pro workers never get her; no phone surface. Same engine (`lib/assistant`): new `ctx.hasPro`, `covers(ctx, product)`, Pro system prompt variant (`buildProPrompt`), tools `find_jobs`, `get_job`, `jobs_needing_attention`, `list_workers`, `worker_workload`, `find_job_customers`, `job_numbers` (`tools/read-pro.ts`) and Do it cards `assign_jobs`, `reschedule_jobs` (Undo), `set_job_priority`, `email_job_outcome` (`actions/pro.ts`). Assigning makes a job Ready to send and does NOT tell the worker (the office taps Send out); moving a day messages nobody; she cannot send out, create, cancel, delete, import or invite. UI reuses Rounds' Ask bar / ⌘K / `/assistant` / docked quick ask in brand blue, Pro starters, `jobId`/`workerId` page context, a hello band on the Pro jobs home, the Ask button sits above the round "+" on `/jobs`. **No SQL** (tables and `products text[]` already take 'pro'). Cost: Pro's fixed part is ≈4.6k tokens (Rounds + Lite 7.3k); eval `EVAL_SET=pro npx vitest run -c vitest.eval.config.ts run` = 28 questions as Pro Test, ≈0.6p each (`scripts/assistant-eval/report-pro.md`, `size-pro.json`). Tests: `lib/assistant/__tests__/pro.test.ts`. Not seen: dark mode with Lily on Pro pages; the email and priority Do it taps (email sends a real message).

- Phase 7 (selling it) and Phase 7b (new look) done 2026-10-06, not released: plans, sign-up, referrals, Plan & billing, Add Lite nudge, plan ended / close account, phone without buying; Rounds and Lite dashboard, customer pages and phone popups in the new look, Pro unchanged. Owner signed off both walkthroughs and the docs steps on 2026-10-06 without walking the rows listed under "Not verified" below; those are re-walked in the Phase 7c rehearsal (step 10).
- Next: Phase 7c — step 1 (`docs/specs/phase-7c/01-launch-accounts-check.md`) and step 2 (GoCardless partner review) can start now; help pages and privacy/terms are drafted and wait for the owner's read.

- **Phase 7 walkthrough, run by Claude 2026-10-05 (step 23, NOT ticked: rows 20, 22, 24 and the phone/email checks are the owner's).** Test accounts (test mode only; password not stored in this file): `p7rounds@example.com` (Rounds → Both → Rounds → yearly), `p7lite@example.com` (Lite yearly, plan ended, restarted monthly), `p7both@example.com` (bundle; plan cancelled for row 19, has a throwaway customer + skipped held text), `p7ref@example.com` (referred, Lite yearly), `p7resume@example.com` (pending signup, abandoned on purpose), `taylorbk2006+p7close@gmail.com` (closed; tenant `59340011-e053-484b-8681-7aafd2a32bcd`, waits for row 22). Stripe test clocks were used for renewals. Browser testing used `127.0.0.1:3000` so it did not touch the owner's `localhost:3000` login.
  Results: ✓ 1 site links + yearly toggle; ✓ 2 Rounds founding £17.50, Plan & billing right; ✓ 3 places-left falls (site caches 10 min); ✓ 4 Lite yearly £350, no Add Lite card, "Add Rounds" shown; ✓ 5 bundle £29.50, two rows, one subscription; ✓ 6 abandon and resume goes straight back to payment; ✓ 7 referral link + banner; ✓ 8 referred yearly £315; ✓ 9 referrer −£35 credit (**after fix 1**); ✓ 10 Add Lite pro-rata, card gone; ✓ 11 Drop Lite, cancel the change, drop again; ✓ 12 clock past renewal: Lite off, Rounds £35; ✓ 13 Switch to monthly booked for renewal; ✓ 14 yearly with a 3D Secure card: "Your bank wants to confirm", plan stays monthly until confirmed, then yearly (**after fix 4**); ✓ 15 cancel + undo; ✓ 16 failing card: amber banner, everything works, Update card opens Stripe; ✓ 17 plan ended page, Lite pages redirect; ✓ 18 restart £35 (no discount), "Welcome back"; ✓ 19 phone API 200 → 403 `plan_ended`, held text skipped; ✓ 21 close: download offered, wrong password refused, Stripe cancelled, closed_at/purge_after +30 days, login banned; ✓ 25 Stripe's real error for a missing coupon is recognised as a founding refusal. Not walked: 20 phone Texts screen, 22 purge (owner pastes one UPDATE), 23 forgot-password email / set-password, 24 view-as RS Locksmiths, the closing email arriving.
  Bugs found and fixed: (1) `invoice.paid` can arrive before `checkout.session.completed`, so a referral reward found no business and was never retried: the webhook now re-reads the first invoice after provisioning (`app/api/stripe/webhook/route.ts`, test in `__tests__/route.test.ts`); (2) `.env.local` had `STRIPE_COUPON_REFERRAL_SECOND_HALF` glued onto the `WIDGET_ALLOW_LOCALHOST` line; (3) the "Resume payment" route ignored yearly, the bundle and discounts, now it sends people back to the sign-up page; (4) a monthly plan could switch to yearly while a half-price/free-month offer was still on it (a whole year at 50% off): now refused by the server and shown greyed out, test in `manage.test.ts`; (5) the yearly confirm said "from 5 Jan" and "rest of this month": it now says when the yearly plan runs to and renews (Stripe keeps the original anniversary, so the first yearly charge covers the time until then); (6) the plan cards showed the founding price for a referred friend, who actually pays £0 then half; (7) the site's referral banner still described the old founding wording; (8) a closed account saw "Invalid email or password": it now says the account is closed; (9) two stale tests. Still open: after Add Lite the page says "£0 today" when the £12 is covered by the referral credit (true but not obvious); a failed renewal leaves an open invoice on the cancelled subscription (set Stripe to void/uncollectible on cancel, release step 7c/07).
- **Phase 7b (design refresh) started early, 2026-10-05, at the owner's request:** step 2 (tokens, `data-look` switch, kit in `components/look/`, KPI tiles proof, `docs/DASHBOARD-LOOK.md`) and step 3 (new sidebar / slim phone bar / plain page header; Add Lite card and the payment-overdue banner are Phase 7 steps 17 and 18 (built there)) are **built and pass tsc/eslint/build, not ticked**: they wait for the owner to log in and approve screenshots on the look-test accounts, and for a view-as-RS-Locksmiths check. Step 1 changed on 2026-10-05: the owner has no Clearview account, so the look-test business is **Test rounds 2** (Rounds + Lite, logs in as test4@gmail.com): `supabase/seeds/look-test-rounds2.sql` (40 customers, ~12 weeks of visits, payments, invoices, texts, expenses; leads only if a widget exists) is written and self-reviewed, **not yet pasted**; `look-test-rounds2-remove.sql` undoes it. Dave's Plastering (Lite-only) is still to check for step 13/14. The seed is pasted (with the leads fix and `look-test-rounds2-replies-patch.sql`). **Step 4 (overview) is built, not ticked**: hero greeting, real stop list in Today's round (`listTodayStops` in `lib/rounds/today-strip.ts`, tested), Needs you rows, week/money/room re-toned, empty-business `EmptyState`; checked on Test rounds 2 at 1440 light/dark and 375; waits for owner approval, the empty-business state (needs a fresh account), and view-as RS Locksmiths. Decision (owner OK 2026-10-05): Dashboard stays above the Rounds/Lite groups and should also show Lite (leads waiting) for Rounds + Lite logins — not built yet, goes in with step 13. **Step 5 (customers list and add/edit form) is built, not ticked**: list rebuilt (avatar rows, tags, money pills, filters behind a Filter button, phone cards), add-customer form split into two cards, agreement form gets a live summary card; owner decision pending on whether to merge customer + agreement into one page (card asked for it; kept two screens to avoid a behaviour change). Step 5 approved and ticked 2026-10-05. **Step 6 (customer page) is built, not ticked**: new header (avatar, tap-to-copy phone/email, status tags, Edit + Deactivate), Next visits card, Money first on phone, two-column layout on laptop; `CopyChip` added to the kit; waits for owner approval (paused-customer and no-history cases and view-as RS Locksmiths not checked). Step 6 approved and ticked 2026-10-05. **Step 7 (calendar) is built, not ticked**: styles only on the week board (columns, stop cards, tags, toast), day plan (summary row, status tones, blue next stop), month (indigo density + legend), Day/Week/Month now a segmented switch; no drag/dnd/action code touched; drag, swap, Undo and Tell them not re-tested by hand. Step 7 approved and ticked 2026-10-05. **Steps 8, 9 and 10 are built, not ticked** (waiting for owner approval): **8 Payments** = plain tab row (Overview / Who owes / Came in / Invoices), overview with Owed to you (waiting-time bar linking to filtered Who owes), Money in (vs last period + sparkline), Coming, Who to chase, Recent payments by day, chart; header actions Record a payment / Copy pay link (customer picker first); Who owes / Invoices summary tiles that filter; Came in method-mix bar + list by day; invoice page is now an on-screen paper invoice + side panel (PDF unchanged, still downloadable); new files `chase-list`, `payment-feed`, `filter-chips`, `payments-actions`, `method-style`. **9 Messages** = two-pane inbox (`messages/(inbox)/layout.tsx` keeps the list on the left; phone takes turns), compact texts meter + Buy more texts in the header, review card with the customer's words and "Looks like a no" label, bubbles with day headings and delivery ticks; texts-bought stays outside the group at the same URL; sample threads moved to `lib/messaging/sample-threads.ts`. **10 Expenses / In & out** = PageTabs (new kit piece), receipts-to-check cards with Check and save, expense list with category icons, In & out with Left in your pocket + month-by-month chart + hidden-empty categories (`components/books/trader-books-panel.tsx`). tsc, eslint, npm test (1669) and npm run build clean; checked at 1440 light/dark and 375 on Test rounds 2; view-as RS Locksmiths NOT checked. Known: pre-existing hydration warning from the account menu ids in the shell (not from these steps). **Step 11 (services and import) is built, not ticked**: Services gets a 'Used by' column (customers per service; new read-only `getServiceUsage` + `countCustomersByService`, tested); the Rounds import is now a 3-step flow with a progress row (`import-steps.tsx`), four source cards (spreadsheet, Squeegee/CleanerPlanner, round-book photos or typed list, Do it for me, which opens the existing send-us-your-file dialog; the dialog's `context` is still 'review' because `setup-request.ts` only accepts review/read_failed/done and actions were not to change), a 'N customers found · M need a look' header on Check, and key-figure tiles on Done (the Done screen was not seen in the browser: it needs a real import). Checked on Test rounds 2 at 375 and laptop width; nothing was imported. **Step 12 (settings) is built, not ticked**: new-look tab names (Company, Rounds, Messages, Payments, Accountant, Plan & billing, Your profile, Danger zone; Pro keeps the classic names), phone tabs are a horizontal pill row with labels, content capped at 880px, Payments tab starts with a 'ways customers can pay you' strip (Cards / Direct Debit / Bank transfer: On, Checking, Needs you, Off; `settings-ways-to-pay.tsx`), Company tab's raw account overview (tenant id, total jobs/workers) is replaced by a quiet Account card at the end in the new look, floating save bar uses the Rounds blue Save, Plan & billing's current-plan card uses kit tags and a next-bill tile. Not seen live: self-serve Plan & billing and Close my account (Test rounds 2 is a managed account, so it shows 'Billing'/'Managed by WorkWise' and the old Danger zone with Delete all jobs, which looks wrong for a Rounds business: owner to decide); no Discard button on the save bar (would need form-reset changes). **Step 13 (Lite leads) is built, not ticked**: the board (`/lite`) was already in the new look from the 2026-10-05 pass, so this step adds the website to the header (*From the quote assistant on {website}*) and rebuilds the lead page: header card (avatar, status tag, firm/guide/visit quote tag, status control), Conversation card (assistant bubbles soft purple, customer bubbles white), Texts timeline, Customer card (Call in Lite purple, tap-to-copy number), The job card (big price + quote tag), When's the job? card, follow-up problems as amber notices. `NeedsAnswer` and the Booked list were restyled by the earlier pass but remain hidden on the board (launch decision in `app/(dashboard)/lite/page.tsx`), so the card's 'Needs your answer first' and 'Booked' sections are NOT shown; the 'Waiting for you' tile still counts booking requests. Not exercised: Accept/Change price/Decline, Add to my round (no requests visible, actions untouched). Checked on Test rounds 2 at 1440 and 375; dark mode not re-checked. Steps 8–13 approved and ticked 2026-10-06 ('i like'). **Step 14 (Lite set-up / widget / pricing / conversations) is built, not ticked**: set-up progress rail and chat in Lite purple (bot bubbles soft purple, trader's white, purple Send), learnt panel with kit tags and sticky on laptop, finish panel numbers purple, snippet in a dark code box with a purple Copy, widget status card leads with an On / Off / waiting-for-the-code tag, widget and pricing cards on the kit card style with tone chips. Conversations list/transcript were already in the new look (step 13 restyled the transcript). **Only set-up (mid-interview) and Conversations could be seen** on Test rounds 2 because its interview isn't finished: the live Widget cards, How you price and the finish panel were restyled from the code, not seen, and need Dave's Plastering (or a finished interview) to check. Auto-accept switches remain hidden for launch (existing note in work-table.tsx). **Steps 15, 16 and 17 are built, not ticked** (2026-10-06). **15** customer-facing pages: new `PublicFrame` + `BusinessMark` in the kit (warm canvas, trader's logo or initials first, small 'Powered by WorkWise'); pay page, invoice link page, DD offer, bank card, buttons (rounded, Pay by bank first, card quieter when it isn't first), one-tap lead page (Lite purple Accept, result card), accountant sign-in / header / tabs / summary tiles / status tags, /connect return cards (emerald / blue / amber). Seen: invoice pay page at 375, a connect page; **not seen** (need tokens): customer pay page, lead page, accountant pages; 404s checked by curl. **16** popups and states: `components/look/floating-message.tsx` + `components/providers/app-toaster.tsx` (replaces the root `<Toaster>`; in the new look every `toast.success/info/message/warning/error` call with a plain string shows the floating message instead, classic/Pro and non-string toasts stay on sonner), dialog/sheet shapes via tokens in globals.css, `(dashboard)/error.tsx` (Try again + reference) and `(dashboard)/not-found.tsx`, loading skeleton cards rounded in the new look; seen: error-tone floating message, not-found page; not seen: dark mode of the message, sheet/dialog restyle, error boundary (not forced). No call sites changed popup kind on the web. **17** phone (`workwise-mobile`, JS only): `src/components/feedback/` (FloatingMessage helper, ChoiceSheet, ConfirmDialog, FeedbackProvider mounted in Rounds mode in App.tsx) and all 35 `Alert.alert` calls in `src/screens/rounds` moved (errors/info to floating messages, risky asks to ConfirmDialog, multi-option to ChoiceSheet; the Add-a-photo iOS native action sheet became the ChoiceSheet on both platforms); 0 Alert.alert left under rounds; wording unchanged. Phone tsc clean, 179 tests pass; **not run in the simulator**; the 18 hand-made `<Modal>` form sheets under rounds were left as they are (already approved layouts); labels checked by grep (Said no / Asked to move / Not told / Unpaid / Overdue / Collecting match web); one known tone difference: phone customer-money 'Overdue' is rose and 'Unpaid' amber while the web invoice tags are Overdue amber and Unpaid blue. Next: owner approval of 14–17, then step 18 (walkthrough).
- **Dashboard restyle pass, 2026-10-05 (owner: "full restyle, softer green and red, one blue")**, not ticked, waits for owner approval: palette fixed once in `app/globals.css` (Tailwind emerald/green, rose/red and sky/cyan/blue re-pointed under `[data-look="new"]`; old indigo brand tokens now brand blue; see `docs/DASHBOARD-LOOK.md`). Restyled with the kit: Payments (SummaryStrip tiles, StatTile row, chart with legend, MoneyRow, Get paid checklist, card panel, existing Direct Debits), Messages (thread list, texts meter, thread view, reply choices), Expenses and In & out, Services, Settings nav, Lite leads (tiles, Notice banners, board, cards) and conversations. Shared `@layer components` rules calm tables, tabs, cards and inputs. Not restyled yet: invoice detail page, Lite lead page / decision form / set-up interview / widget forms / how-you-price, Plan & billing, customer-facing pages. Not checked: view as RS Locksmiths.

---

## Phase 9 walkthrough — test accounts and results (2026-10-13, Stripe test mode)

Test accounts (all on the owner's Gmail with `+` tags, test mode only; passwords are not stored in this file): owner `taylorbk2006+teamowner` (business "Team Test Cleaning", slug `team-test-cleaning`, tenant `ce37842c-4ea9-465f-a3d4-33841be782a3`, yearly plan + bundle at the end), solo `+teamsolo` (tenant `8e4ab296-1a85-4c80-b517-a3e460d321f2`), Dave `+teamdave` (removed, login banned), Sam `+teamsam` (removed, login banned), Pro check `+teampro` (tenant `a2b88e68-cf10-4d06-83cd-3a2036cf409d`). Lee is a helper (name only). Owner and solo were made with `npm run stripe:p9-account -- --email … [--interval month|year] [--business …]` (the real Rounds subscription line and real provisioning, no hosted Checkout page). Seed: `supabase/seeds/team-test.sql` / `team-test-remove.sql`; extra pastes: `team-test-walk-steps.sql` (ages one payment; the database-level security check as Dave). `scripts/phase9-staff-token.mjs <email>` prints a login token for curl (password from `TEAM_TEST_PASSWORD`).

How the walk was run: web logins on `owner.localhost:3000`, `dave.localhost:3000` etc. so the owner's own `localhost` session was untouched; phone in the iOS simulator (taps need `duration: 0.15` and the screen lags ~10s); `stripe listen` forwarding to the dev server; Stripe test clocks advanced with `stripe test_helpers test_clocks advance`. Nothing was pushed, deployed or built for release.

Findings fixed (details and files in the results file): phone re-checks "am I staff?" on reconnect (`WorkerContext.tsx`); "with Dave" tag on Payments rows, the customer's payment line and activity, and the Came in headline leaves held cash out (`payment-feed.tsx`, `payments-history-table.tsx`, `customer-money-card.tsx`, `customer-activity.tsx`); push-back Tell-them preview (`undo-change-bar.tsx`); a removed lead's phone shows "Your access has ended" (`workwise-mobile/src/lib/staff/api.ts`, `staffNotice.ts`); next-bill wording includes the team line (`lib/billing/manage.ts` `thenLabelFor`, `components/billing/add-lite-view.tsx`).

Not seen and needing a real phone: dialer and messages opening from Call/Text (row 7), the cash-nudge push arriving (row 11: the cron found the cash; the owner has no push token), the phone in solo and Pro mode (rows 23, 30).

## Phase 7 and 7b — selling it and the new look — DONE 2026-10-06, NOT RELEASED

Spec folders: `../docs/specs/phase-7/` and `phase-7b/`. Branch `rounds-foundations`.

**What was built (7).** All plans (Rounds £35, Lite £35, both £59, monthly and yearly £350/£350/£590, tax-inclusive), no free trial, founding offer (50% off two months, first 200), referral links (friend: month 1 free, month 2 half; referrer: a month's credit after the friend's first full month), our own Plan & billing page (Stripe only for the card), Add Lite nudge for Rounds-only accounts, plan ended (log in, restart, nothing sent) and payment-overdue banner, Close my account (locked now, deleted after 30 days), new log-in / sign-up pages, phone with nothing to buy and a plan-ended screen, site places-left and referral banner.
**What was built (7b).** Rounds and Lite pages in the new look (`data-look="new"`, Pro excluded and unchanged), kit in `components/look/`, floating popup messages on web and phone. Guide: `../docs/DASHBOARD-LOOK.md`.

**SQL pasted (7), in order:** `20261004100000_plans_and_bundle.sql`, `20261004100100_referrals.sql`, `20261004100200_provision_plans.sql`, `20261004100300_close_account.sql`. 7b has no migrations (seeds only).

**Checks.** Phase 7 walkthrough run by Claude 2026-10-05: rows 1–19, 21, 25 passed after nine fixes (listed in the walkthrough note above). 7b: steps 1–17 approved by the owner one at a time.

**Not verified (walk again in 7c step 10):** Phase 7 rows 20 (phone Texts screen), 22 (purge of the closed test account: owner pastes one UPDATE), 23 (forgot-password and set-password emails), 24 (view as RS Locksmiths), the closing email arriving (now has Reply-To support@ since 2026-10-06); 7b: RS Locksmiths unchanged, dark mode of floating messages, customer pay page / lead page / accountant pages with real tokens, Lite widget cards and How you price on a finished interview (Dave's Plastering), empty-business overview, phone screens in the simulator, Close my account / Plan & billing on a self-serve account, Direct Debit / Pay by Bank on the preview. Known: after Add Lite the page says "£0 today" when a referral credit covers it; a failed renewal leaves an open invoice on the cancelled subscription (set Stripe to void on cancel, 7c step 7).
**Ideas after launch:** Rounds-appropriate Danger zone on managed accounts; Discard button on the settings save bar; phone Overdue/Unpaid tone match with web.

**At release.**
- Stripe **live**: six tax-inclusive prices, coupons `FOUNDING50`, `REFERRAL_MONTH`, `REFERRAL_YEAR_35`, `REFERRAL_YEAR_59`; default customer portal = card + invoices only (leave `STRIPE_PORTAL_CONFIGURATION_ID` unset in production); webhook events include `invoice.paid`; Billing settings: retries, cancel after last retry, void open invoices on cancel, Stripe's failed-payment and card-expiring emails on.
- Vercel env: six `STRIPE_PRICE_*`, four `STRIPE_COUPON_*`, `NEXT_PUBLIC_SITE_URL=https://joinworkwise.com`. Never `STRIPE_SIGNUP_TEST_CLOCK`. Marketing site: `WORKWISE_APP_URL=https://app.joinworkwise.com`.
- Cron: `/api/cron/purge-closed-accounts` (daily, `vercel.json`).
- Phone: steps 20–21 and 7b step 17 are JavaScript only and ship in the 1.1.0 store build.

**Support how-to: restore a closed account within 30 days.** Clear `tenants.closed_at` and `purge_after`, unban each login in Supabase Auth, then restart their plan from the plan-ended page.

---

## Phase 6 — Lite in the dashboard — CODE COMPLETE, owner happy with the walkthrough 2026-10-05, NOT RELEASED

Spec folder: `../docs/specs/phase-6/`. Branch `rounds-foundations`. Nothing ships until the release.

**What was built**
- **A Database.** Pasted (step 5): `supabase/migrations/20261003100000_lite_widget_and_leads.sql`, `20261003100100_lite_price_profile.sql`, `20261003100200_lite_texts.sql`. Migration 4 `20261003100300_drop_unused_tables.sql` is written; step 28 is still unmarked, so treat the paste as not confirmed.
- **B Widget.** `lib/widget/*`, `public/widget.js`, `app/api/widget/*`. The marketing site has a loader; the script is served from the app.
- **C Interview.** `lib/lite/*` (interview and price profile), `app/(dashboard)/lite/setup`, How you price at `app/(dashboard)/lite/widget/pricing`.
- **D Leads and texts.** `lib/lite/*`, `app/lead/[token]`, `app/api/cron/lite-tick`. On the laptop: `npm run lite:tick`.
- **E Lite pages.** `app/(dashboard)/lite/*` — Leads, Conversations, Widget.
- **F Rounds + Lite.** A won lead can become a round customer or a one-off visit.
- **G Site and tidy-up.** Bank tab removed. Step 26 retired the old OpenAI widget (site loader). Step 27 is **REPLACED** by the standalone site assistant.

**Launch surface (owner, 2026-10-05).** What people see is lead capture + an estimate. Book it, Accept / Change price / Decline and auto-accept stay in the repo and are hidden. The leads board is four columns (New / Contacted / Won / Lost); a won lead can still set a date and Add to my calendar.

**Walkthrough.** Owner signed it off 2026-10-05. Interview time: not recorded. Text wording changes: none.

**Not marked done in the step index** (do not tick here): 15, 16, 17, 19, 20, 25, 28 — all 🔴, still need a Claude review. 27 is **REPLACED**.

**Env (in `.env.local` now; Vercel at release):** `WIDGET_SESSION_SECRET` required. Optional: `WIDGET_AI_MODEL`, `INTERVIEW_AI_MODEL`, `LITE_TEXT_AI_MODEL` (default `claude-sonnet-5-5`), `CONVERSATION_SUMMARY_AI_MODEL` (default `claude-haiku-4-5`). `WIDGET_ALLOW_LOCALHOST=1` is laptop only — never in Vercel. Marketing site: `NEXT_PUBLIC_WORKWISE_WIDGET_ID`; on the laptop `NEXT_PUBLIC_WIDGET_ORIGIN=http://localhost:3000`. Remove `OPENAI_API_KEY` from the site at release.

**No new dependency. No phone change. Bank tab removed.**

**Not in this phase:** plain-words price updates, a calendar inside Lite, payment links, Lite for Pro, parsing customer replies, several websites per widget, WhatsApp, auto-expiring booking requests, scheduling the minute tick on the live site (Phase 7), the £59 bundle.

**Checks (2026-10-02).** `npm test`: 147 files, 1556 passed. Logged-out Lite URLs answered 307/404/400/401, never 500. `npm run build` was not run for the web app or the marketing site (dev servers on 3000 and 3001). `npx tsc --noEmit` failed only on a stale `.next/types/validator.ts` from the running dev server. Eslint errors on the Phase 6 paths were pre-existing and left alone. Run both builds with the servers stopped, before release.

## Phase 5 — Running the business — SIGNED OFF BY THE OWNER 2026-10-02, NOT RELEASED

Spec folder: `../docs/specs/phase-5/` (`README.md` is the step index). **Nothing ships until the release**: the three migrations are already pasted → deploy web → one phone build.

**What was built**
- **A Database.** Pasted: `supabase/migrations/20261002100000_expenses.sql`, `20261002100100_accountant_access.sql`, `20261002100200_setup_requests.sql`.
- **B Expenses.** `lib/books/categories.ts`, `lib/books/periods.ts`, `lib/expenses/read-receipt.ts`, `lib/expenses/expenses-core.ts`, `app/(dashboard)/expenses/page.tsx`, `components/expenses/`.
- **C In & out.** `lib/books/summary.ts`, `components/books/in-and-out-panel.tsx`.
- **D Accountant and downloads.** `lib/accountant/access.ts`, `app/accountant/[token]/`, Settings → Accountant & data, `lib/downloads/` (ZIP via `fflate`).
- **E Overview.** `components/rounds/overview/`, `lib/data/rounds/overview.ts`, `lib/data/rounds/needs-you.ts`, weather `lib/weather/met-norway.ts`.
- **F Import.** `lib/import/` (spreadsheet + `read-round-book.ts`), `components/import/rounds/`, `lib/actions/rounds/import.ts`, `lib/actions/rounds/setup-request.ts`.
- **G Phone.** `/api/rounds/expenses`, `/api/rounds/books/summary`. Phone: `workwise-mobile/src/lib/expenses/`, `src/lib/offline/receiptQueue.ts` (`SCAN_RECEIPT`), `src/screens/rounds/money/ExpensesScreen.tsx`, `ExpenseCheckScreen.tsx`, `SnapReceiptButton.tsx`.

**Decisions.** Accountant = own read-only access (email + code), money side only, invoices as issued, no customer list or phone numbers, no new role. No mileage. Fixed HMRC-shaped categories. Cash basis. "Stuck? Send us your file" is the last resort, one open request per 30 days. Making Tax Digital still to decide before April 2027. **Sonnet reads images** (owner, 2026-10-02): receipts (`RECEIPT_AI_MODEL` default `claude-sonnet-5-5`, no second read) and round-book photos (`ROUND_BOOK_AI_MODEL`). Spreadsheet imports stay on Haiku (`CUSTOMER_IMPORT_AI_MODEL`; Pro `EXTRACTION_AI_MODEL`). The walkthrough did not record how many receipts Sonnet got wrong.

**Env (in `.env.local` now; Vercel at release):** `ACCOUNTANT_CODE_SECRET`, `SETUP_REQUEST_EMAIL`. Optional overrides: `RECEIPT_AI_MODEL`, `RECEIPT_ESCALATION_MODEL`, `ROUND_BOOK_AI_MODEL`. Do not set `RECEIPT_AI_MODEL` unless overriding the Sonnet default.

**Dependency:** web `fflate` 0.8.3. No new phone native module. Phone `package.json` unchanged. `app.json` has an uncommitted change: `userInterfaceStyle` `light` → `automatic` (the app follows the phone's light/dark setting). Not a new module. The owner closed the phase without confirming it.

**Phone checks (2026-10-02):** `tsc` clean, 170 tests, one iOS Hermes bundle 6.75 MB (Phase 4 was 6.42 MB), `expo install --check` still the same 7 patch updates (not applied). Web `tsc` / tests / eslint / `npm run build` were not re-run at this close.

**Walkthrough: not run as a table.** The owner signed the phase off on 2026-10-02 without ticking these rows.

| # | | Note |
|---|---|---|
| 1 | ☐ | 15–20 real receipts; Sonnet is already the default |
| 2 | ☐ | PDF reads; HEIC refused |
| 3 | ☐ | Not a receipt |
| 4 | ☐ | To check does not count until Saved |
| 5 | ☐ | Add, edit, delete (photo gone) |
| 6 | ☐ | In & out matches payments and saved expenses |
| 7 | ☐ | Tax year: 12 months add up |
| 8 | ☐ | VAT on/off |
| 9 | ☐ | Invite email |
| 10 | ☐ | Code, then money pages |
| 11 | ☐ | 5 wrong codes, then a new code |
| 12 | ☐ | Accountant download has no contact details |
| 13 | ☐ | Remove → link dead |
| 14 | ☐ | Download all my data |
| 15 | ☐ | Tax-year ZIP: receipts and invoice PDFs |
| 16 | ☐ | Overview forward view |
| 17 | ☐ | Spreadsheet import |
| 18 | ☐ | Same file again |
| 19 | ☐ | Round-book photos |
| 20 | ☐ | Existing Direct Debit linked |
| 21 | ☐ | Stuck? link, one request per 30 days |
| 22 | ☐ | Phone snap → check → save |
| 23 | ☐ | Phone offline → Waiting to scan → one expense |
| 24 | ☐ | Worker login has no Expenses |
| 25 | ☐ | RS Locksmiths unchanged |

**Not in this phase:** mileage, Making Tax Digital, custom categories, supplier refunds, Squeegee/CleanerPlanner presets, undo a whole import, accountant editing, import/accountant/downloads/overview on the phone, bank feeds.

**At release:** privacy-policy paragraph in `workwise_site/app/privacy/page.tsx` is NOT deployed. LAUNCH LIST: rewrite the whole privacy policy for Rounds (receipt and round-book photos are read by Anthropic's AI; an accountant can be given read-only access). A task chip exists for an app-wide Radix id hydration warning.

## Calendar update (micro-phase) — CODE COMPLETE, NOT RELEASED

Spec folder: `../docs/specs/calendar-update/` (`README.md` = step index, `00-context.md` = decisions D1–D24; **D16–D24 came from the owner's feel test and override the older card text**). Branch `rounds-foundations`. **Nothing ships until everything is done**: migration → web → one phone build.

**What it is:** "How they pay" removed from the customer page (web + phone; the invoice choice stays on the Done sheet). Calendar has **Day / Week / Month** on the dashboard and the phone. **Week** is a drag board (dashboard: day columns side by side with gaps between weeks; phone: day rows, jobs across). Drag a job within a day or to a spot on another day; drag a day by its ⠿ onto another to swap planned stops (**immediately, no confirm; Undo is the safety**); click/tap a job for Open job / Move to day…; a day's ⋯ → Swap with…. After a move or swap a **floating glass message** (10 s, then fades) offers **Tell them** and **Undo**. Nothing texts a customer unless Tell them or "Let customers know" is used. Moved stops whose customers aren't told carry a **Not told** tag. Dropping a stop on a day where the same house already has a visit joins it ("Join …'s visit", "2 jobs"); one job of a combined card can be moved on its own (laptop: Show N jobs ▾ rows; phone: Move just one…). The board scrolls to where a job landed and rings it; dropped cards glide into place. Every job date picker also shows where the job is **now** (grey / ringed) and today. The phone's Week is look-only without signal. Today's (phone) and the Day plan's (web) Undo bars only show a change from the last hour.

**SQL pasted** (owner, 2026-10-01): `20261001120000_visit_changes_swap_days.sql` (adds kind `swap_days` + `client_key` unique index to `visit_changes`). Nothing else touches the database. Owner follow-up: refresh `supabase/schema_current.sql`.

**Checks** (2026-10-01, step 13/14): web `tsc` clean · 899 tests pass · eslint on the step-14 paths: 0 errors, 9 warnings in files this work didn't change (`rounds-customers-table.tsx`, `lib/actions/rounds/agreements.ts`) · `npm run build` succeeds · `check-cards.mjs calendar-update` passes. Phone: `tsc` clean · 148 tests · `expo export --platform ios` OK (6.64 MB bundle) · `package.json` / `app.json` unchanged · `expo install --check` lists 7 older patch-level mismatches (not from this work, left alone). **No new phone dependency or native module** (dragging uses the existing gesture-handler + reanimated; no vibration).

**Step 9 feel-test decision (owner, 2026-10-01): keep dragging.** `workwise-mobile/src/screens/rounds/calendar/boardConfig.ts`: `BOARD_DRAG_ENABLED = true`, `LIFT_DELAY_MS 450`, `GRIP_DELAY_MS 200`, `TAP_SLOP 10`, `FLOAT_ABOVE 24`, `LIFT_SCALE 1.06`, `EDGE_V 80`, `EDGE_H 48`, `MAX_V_SPEED 12`, `MAX_H_SPEED 10`, `GAP_ANIM_MS 120`, `GLIDE_MS 180`. Set `BOARD_DRAG_ENABLED = false` to ship the phone tap-only.

**Walkthrough (step 14): not run as a table.** The owner closed the phase on 2026-10-01 after trying it by hand. Seen working by the owner: the phone Week board and its drags, a day swap, the floating message, "Not told", joining a same-house visit, moving one job, the new date pickers (laptop and phone), the laptop board's drag within/between days (after a bug fix, see below).

**Not verified (do these at release or in the next test pass):**
- Laptop drag **with a successful save signed in** (all my drag tests used fake data; the saves were rejected on purpose or read-only) — especially keyboard (Space/arrows) and touch (250 ms hold) dragging, and the day-grip swap on the laptop.
- Tell them actually sending (one text logged for Tess) and "already told" on a second press; Undo of a told move sends the "all back" text.
- Double-click on Swap (laptop menu path) → one swap; the phone's double-tap rule.
- Phone: airplane mode banner + nothing movable; remembered view after closing the app; a phone move showing on the laptop.
- Step 2 check: marking Done with "Send invoice" on remembers it for the next Done sheet (code untouched, just confirm).
- **RS Locksmiths / Pro**: no Calendar change (the Week board is Rounds-only; the board actions now refuse non-Rounds businesses).
- Dashboard board column heights at other window sizes; the initial scroll to this week's Monday on narrow windows.

**Bugs found while testing and fixed:** laptop drag never started (dnd-kit reported no card position at drag start; now measured directly); dnd-kit hydration id mismatch (fixed id); board stayed locked until the weekly refresh finished (now locks only while saving); duplicate React keys in the phone "Move just one…" list.

**At release:**
1. Migration first (already pasted into the owner's database; paste into any other database before deploying web).
2. Web deploy adds the dependency **`@dnd-kit/core` ^6.3.1** (`npm install` runs from the lockfile). No env vars.
3. The phone ships in the one release build with everything else. Nothing here needs a new native module. (Vibration on pick-up needs `expo-haptics`, a native module; it can be added in the release build if wanted.)
4. Owner follow-ups: refresh `schema_current.sql`; decide whether to apply the app-wide popup standard (memory `project-popup-standard`: floating message / sheet / dialog) to the other ~42 alerts and ~23 modals as its own job.

## Phase 4 — Direct Debit (GoCardless) + more ways to pay (branch `rounds-foundations`) — CODE COMPLETE, NOT RELEASED

Spec folder: `../docs/specs/phase-4/` (`README.md` is the step index). Steps 1–25 done; step 26 (live at launch) stays open. **Nothing ships until all phases are done**: migrations → web → one phone build.

**SQL pasted** (owner, 2026-09-30, in this order): `20260930100000_customer_charges.sql`, `20260930100100_owner_pushes.sql`, `20260930100200_direct_debits.sql`, `20260930100300_more_ways_to_pay.sql`. Owner follow-ups: refresh `supabase/schema_current.sql`; regenerate the phone types if wanted (they were hand-added in `workwise-mobile/src/types/supabase.ts`: `customer_charges`, `other_owed_amount`, `payment_allocations.charge_id`).

**Checks** (2026-10-01): web `tsc` clean · 826 tests pass · eslint on the step-24 paths: 0 errors, 1 warning not from Phase 4 (`components/settings/settings-skills-section.tsx`) · `npm run build` succeeds · `check-cards.mjs phase-4` passes. Phone: `tsc` clean · 97 tests (this includes some tests from work outside Phase 4) · `expo export --platform ios` OK · no dependency or native-module change.

**At release**
- Stripe: no new webhook events (Stripe only takes cards now).
- Vercel: the six `GOCARDLESS_*` variables with live values (step 26): `GOCARDLESS_ENVIRONMENT`, `GOCARDLESS_CLIENT_ID`, `GOCARDLESS_CLIENT_SECRET`, `GOCARDLESS_WEBHOOK_SECRET`, `GOCARDLESS_TOKEN_KEY`, `GOCARDLESS_REDIRECT_URI`.
- Live GoCardless partner app: webhook URL `https://app.joinworkwise.com/api/gocardless/webhook`, redirect URL `https://app.joinworkwise.com/api/gocardless/callback`.
- Crons in `vercel.json` already: `/api/cron/direct-debits` (17:00 UTC), `/api/cron/send-held-messages` (07:00 UTC, also releases held pushes and sweeps stuck collections); confirm both show in the hosting dashboard.

**At launch (step 26)**: GoCardless's partner review passed (demo video, user guide, logo), revenue share agreed, live partner app created; Stripe live Apple Pay / Google Pay on for connected accounts, bank methods off.

**Verified** (step 24 — owner walkthrough in GoCardless's sandbox and Stripe test mode, 2026-09-30/10-01; "(owner)" = owner confirmed it worked, no detail recorded)
| # | Result | Note |
|---|---|---|
| 1 | ✓ | Connect GoCardless (box unticked) with a second email; card went to Checking/On |
| 2 | ✓ | Verification → Refresh → On (dashboard and phone Getting paid) |
| 3 | ✓ | Send Direct Debit link → email, offer first |
| 4 | ✓ | Set up as `Successful` → thanks banner, Active, push |
| 5 | ✓ | Visit-done email goes out the moment the visit is marked Done (by design); says it will be collected, no pay link |
| 6 | ✓ | Evening cron → Collecting £15.00 |
| 7 | ✓ | Confirmed → paid, Direct Debit payment, push, no thank-you email |
| 8 | ✓ | Paid cash → nothing collected; repeat cron runs collect nothing new (owner) |
| 9 | ✓ (wording) | Bob (`Penniless`): failed, push, customer email, held. The push said "their bank didn't pay it", not "not enough money in their account": the reason was read from the wrong GoCardless event. Fixed in `failureDetails` (webhook.ts), not confirmed live — Mary's reason also came back blank |
| 10 | ✓ | Collect again, Leave it → chaser sent (the chaser comes from the `visit-reminders` cron, not the evening one; the card said evening) |
| 11 | ✓ (wording) | Mary (`Late`): the sandbox confirms and fails almost at once, so the collection ends failed, owed again, push + email; same generic wording note as row 9 |
| 12 | ✓ | Carl (`Invalid`): Not accepted by their bank (owner) |
| 13 | ✓ after fix | Dan (`Fickle`): the sandbox reclaimed before WorkWise recorded the payment, so the collection stuck at Collecting. Fixed (the `charged_back` case now records the payment first) and healed by the morning sweep: reclaimed, push, owed again |
| 14 | not walked | Sandbox refund: GoCardless refunds need an available refund balance, and the sandbox pays out instantly (balance £0). Refund handling is covered by unit tests |
| 15 | ✓ | Phone Cancel Direct Debit → cancelled, cron skips (owner) |
| 16 | ✓ | Ollie owes from before £15 → one collection, cleared (owner) |
| 17 | ✓ | Fiona: two services (£60 + £12) → one collection of £72 |
| 18 | ✓ | Ollie £1,250 → over-the-limit push (held), nothing collected |
| 19 | ✓ | Switchers: Eve linked automatically, Gail to link, Hugh "another app still collecting" |
| 20 | ✓ | Hugh linked with old app still collecting → not collected; after cancelling the subscription → collected (owner) |
| 21 | ✓ after fix | One-off £10 on a linked mandate: no WorkWise payment recorded. The first warning push never appeared because the sandbox had already paid it out; fixed (warns on creation). Retest produced the held "Another app is collecting" push |
| 22 | ✓ | Disconnect and reconnect (box ticked): Off, On, Direct Debits kept (owner) |
| 23a | ✓ | Pay by bank → paid, Pay by Bank in history, thank-you, push; cron collected nothing for it (owner) |
| 23b | ✓ | Pay now by bank and set up Direct Debit on one GoCardless page (owner) |
| 23c | ✓ | Pay by card + "Card, Apple Pay or Google Pay"; no Pay by Bank on Stripe (owner) |
| 24 | ✓ | Other amounts owed + Add a payment, dashboard and phone (owner) |
| 25 | ✓ | GoCardless disconnected: no Direct Debit or Pay by bank, card and bank details still work (owner) |
| 26 | ✓ | Card payment after 21:00: the thank-you email goes straight away; the push to the owner is held until 07:00 |
| 27 | ✓ | RS Locksmiths unchanged (owner) |
| 28 | ✓ | Before/after query (owner) |

**Found and fixed while walking** (all in `lib/direct-debit/webhook.ts`, with tests): the failure reason was read from the wrong GoCardless event (submitted vs failed); a payment reclaimed before it was recorded left the collection stuck at Collecting; the "another app is collecting" warning was skipped when the payment had already paid out. Also: a link to Existing Direct Debits is now always shown on the Settings card once connected (the page was only reachable through a button that needed something waiting), and the phone and card wording now say Settings → Payments → Existing Direct Debits.

**Not verified**
- A refund made in GoCardless showing up in WorkWise (row 14).
- The failure-reason wording live (rows 9 and 11): the fix is unit-tested only.
- The held pushes arriving on the phone after 07:00 (the rows exist and are held; delivery to a real device wasn't watched).
- The phone screens were used in places (Getting paid, Cancel, Done) but the Stop "Direct Debit" tag, Collect again / Leave it on the phone and the share sheet weren't separately confirmed.
- Apple Pay / Google Pay on a real phone browser.

**Known gaps**: no automatic retries (by design); refunds are made in the GoCardless dashboard, not WorkWise; existing Direct Debits are matched on the dashboard only; Stripe bank details (recognised automatically) parked in `docs/specs/parked/stripe-bank-details/`; standing orders into the trader's own bank are ticked off by hand; other amounts owed not on invoices; no Direct Debit on invoice pay pages; open banking parked (`docs/specs/parked/open-banking/`). Both work trees also contain modified files that Phase 4 did not touch (phone: AddCustomer, Today and others; web: several Pro pages) — not reviewed here; look before committing.

**Next — Phase 5 is signed off** (2026-10-02, not released). See the Phase 5 section above. Next build phase is Phase 6.

---

## Phase 3 — Messaging (branch `rounds-foundations`) — CODE COMPLETE, walkthrough not finished, not deployed

Spec folder: `../docs/specs/phase-3/` (`README.md` is the step index). Steps 3–31
and 33 **DONE**; step 32 web checks done, owner walkthrough still to tick.
Owner decision: **no deploy or OTA until asked** (branch pushed 2026-09-29).

**SQL — already pasted by the owner, in this order** (`supabase/migrations/`):
1. `20260929100000_messaging.sql`
2. `20260929100100_text_credits.sql`
3. `20260929100200_visit_changes.sql`
4. `20260929120000_payment_thanks.sql` (added during the walkthrough; pasted 2026-09-29)
5. `20260929130000_customer_message_defaults.sql` (pasted 2026-09-30)

**Owner follow-ups still outstanding**
- Refresh `supabase/schema_current.sql` from the live schema (owner's file).
- Regenerate `workwise-mobile/src/types/supabase.ts` when convenient.

**Env vars to add at deploy:** `PURESMS_API_KEY`, `PURESMS_SENDER` (the virtual
number in E.164 with `+`, e.g. `+447903581020`, not "WorkWise", or replies can't
come back), `PURESMS_WEBHOOK_SECRET`, `MESSAGING_TRANSPORT=puresms`,
`STRIPE_PRICE_TEXTS_250`, `STRIPE_PRICE_TEXTS_1000`. Already expected:
`CRON_SECRET`, `ANTHROPIC_API_KEY`.

**At deploy:** set the PureSMS webhook URL to
`https://app.joinworkwise.com/api/messaging/webhook` (re-enable it if PureSMS
disabled it during testing). Confirm the two new crons are listed in the hosting
dashboard: `/api/cron/visit-reminders` (17:00 UTC) and
`/api/cron/send-held-messages` (07:00 UTC). After the walkthrough, set local
`MESSAGING_TRANSPORT` back to `log`.

**Phase 7 launch checklist additions**
- Stripe **live** text-pack products + their env ids.
- PureSMS account on a paid plan with enough credit (virtual number ~£15/month).
- Privacy policy mentions texts via PureSMS and the shared number.
- Decide whether WhatsApp is added (Twilio behind `lib/messaging/provider.ts`).

**Changed during the walkthrough (owner, 2026-09-29) — in the code, not in the cards**
- One visit-done message per **stop** (all services at one house that day). It
  waits while a service at the stop is still open; the evening cron sweeps stops
  left part-done (`sendWaitingVisitDoneNotices`).
- **Payment thank-yous** switch: business-wide (`settings.messaging.payment_thanks_enabled`)
  and per customer (`customers.payment_thanks`). Card payments and Mark as paid send it.
- Money texts always end "Questions? Call …" (may be 2 texts); pay page has a
  "Questions, or already paid?" box.
- Failed texts are retried twice by the 07:00 cron (`retryFailedTexts`), then the
  thread goes to Needs attention.
- Replies to a money message (visit done / chaser / thanks) are sorted as "Says
  they've paid" or "About a payment" (`classifyPaymentReply`); review offers Mark
  paid / Done with this, never Skip/Move. Chasers skip customers whose thread needs attention.
- One-off visits from the phone (+ next to Start day); searchable one-off picker on the dashboard.

**Verified** (step 32 — owner walkthrough, test mode). Fill in as rows are walked.
| # | Result | Note |
|---|---|---|
| 1 | | Reminders cron: one text per stop |
| 2 | | Run again: no duplicates |
| 3 | | "no thanks" → review + push, visit not skipped |
| 4 | | Accept skip with Let them know |
| 5 | | Unreviewed reply → Start day asks first |
| 6 | | Dashboard Undo on a move |
| 7 | | Move remaining tells customers; Undo says "after all" |
| 8 | | After 21:00 → held until 07:00 cron |
| 9 | | Done → email vs text per channel order |
| 10 | | No-email customer → visit-done text with pay link |
| 11 | | STOP / START across businesses |
| 12 | | "cancel" = said no, not unsubscribe |
| 13 | | Reply routed to the business that texted last |
| 14 | | Unknown number → one auto-reply |
| 15 | | 10+ texts in 24h → blocked |
| 16 | | Out of texts → reminders pause, Done falls back to email |
| 17 | | Buy 300 texts (test card); webhook replay adds nothing |
| 18 | | Chaser at 8 days; Owed shows "Reminded" |
| 19 | | RS Locksmiths unchanged |

Web checks (Cursor, 2026-09-29): `tsc` clean, `npm test` 439 passed, `npm run
build` OK, all 36 cards pass `check-cards.mjs`. Eslint: 5 pre-existing errors in
Pro `components/customers/customers-table.tsx` — not fixed, Pro must not change.
Phone checks (step 31, 2026-09-29): `tsc` clean, 75 tests pass, `expo export
--platform ios` OK, Phase 3 added no dependencies and didn't touch `app.json`.
`expo install --check` suggests patch updates (expo 54.0.37 etc.) unrelated to
Phase 3 — not applied.

**Not verified**
- Whatever rows above stay blank.
- Push notifications for replies on a real device token.

**Known gaps (by design or later)**
- WhatsApp → later.
- No typed messages from WorkWise (D9): the Text button opens the trader's own app.
- No auto top-up of texts.
- No phone single-house Reschedule (dashboard has it).
- One shared number for every business (per-business numbers later if routing bites).

---

## Phase 2 — Payments (branch `rounds-foundations`) — CODE COMPLETE, not deployed

Spec: `../docs/specs/phase-2.md` (§6.0 is the step list). Steps 1–33 **DONE**.
Same owner decision as Phase 1: **no push, deploy, or OTA until asked**.

**SQL — already pasted by the owner, in this order** (`supabase/migrations/`):
1. `20260925100000_tenant_payment_settings.sql`
2. `20260925100100_customers_payments.sql`
3. `20260925100200_invoices.sql`
4. `20260925100300_money_engine.sql`

**Owner follow-ups still outstanding**
- Refresh `supabase/schema_current.sql` from the live schema (owner's file; agents
  never edit or commit it).
- Regenerate `workwise-mobile/src/types/supabase.ts` when convenient (phone money
  queries hand-select the new columns; regenerate keeps them in sync).

**Env vars to add at deploy** (hosting + keep local `.env.local` for Stripe CLI):
- `STRIPE_CONNECT_WEBHOOK_SECRET` — from the **hosted** Connect webhook endpoint
  (step 23; different from the platform `STRIPE_WEBHOOK_SECRET` in production).
- Already expected: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`,
  `NEXT_PUBLIC_APP_URL`, Supabase URL / anon / service role, mobile
  `EXPO_PUBLIC_API_URL`.

**Stripe live checklist (Phase 7 launch)**
- Repeat step 19 in **live** mode (Connect branding, onboarding countries, connected-account payment methods, emails).
- Create the hosted Connect webhook (live) for the same event list as step 23; set `STRIPE_CONNECT_WEBHOOK_SECRET` on hosting.
- Switch `STRIPE_SECRET_KEY` to live.
- Do **not** run `npm run stripe:probe` against live keys (it refuses). Create one real connected account through the app and delete it in Stripe if needed.

**Stripe Connect params (step 20 probe)**
- Probe accepted Express + Managed Risk as written in `lib/stripe/connect-params.ts`
  (`apiVersion: '2026-08-26.preview'`). No parameter had to be removed.

**Verified** (step 32 — owner walkthrough, test mode, 2026-09-27)
| # | Result | Note |
|---|---|---|
| 1 | ✓ | Settings → Payments bank + VAT; Company logo |
| 2 | ✓ | Stripe test onboarding → card payments on |
| 3 | ✓ | Done → visit-done email with Pay + bank |
| 4 | ✓ | Card pay `4242…` → thanks page; Card payment on customer |
| 5 | ✓ | Cash £30 → thanks + credit email |
| 6 | ✓ | Next visit paid from credit |
| 7 | ✓ | No-email customer → Share pay link after Done |
| 8 | ✓ | Invoice customer → PDF email + Invoices tab |
| 9 | ✓ | Offline Done / Skip / Mark as paid then reconnect |
| 10 | ✓ | Undo + Waive |
| 11 | ✓ | Stripe refund → visit unpaid; Refunded in WorkWise |
| 12 | ✓ | Dispute card → Disputed in WorkWise (race fixed; row backfilled) |
| 13 | ✓ | Phone → Open Stripe (Express) |
| 14 | ✓ | RS Locksmiths unchanged (Pro) |

Web checks (Cursor): `tsc`, tests, eslint on Phase 2 paths, `npm run build` — pass.

**Not verified / light gaps**
- Dispute **push** to the phone (row 12 UI confirmed; push depends on a real-device token).
- Claude review still recommended for Connect webhook (step 22) and money outbox (step 27) before live.
- Hosted Connect webhook + live keys wait for Phase 7.

**Known gaps (not missing Phase 2 work)**
- Texts / WhatsApp for visit-done and reminders → **Phase 3**.
- Automatic ticking-off of bank transfers → **Phase 4**.
- Direct Debit / Bacs / Pay by Bank → **Phase 8**.
- No automatic retry of a failed visit-done email (Share pay link / resend invoice are the fallbacks).
- Stripe live mode and the hosted Connect webhook → **Phase 7**.

---

## Phase 1 — Rounds core (branch `rounds-foundations`) — CODE COMPLETE, not deployed

Phase 2 (payments) — see the section above.

Spec: `../docs/specs/phase-1.md` (§9 is the step list). Product picture:
`../docs/PRODUCT.md`. Steps 1–22, 25–31 done; **23–24 deferred**; **32 waits
on a deploy the owner has not asked for**.

**Owner decision (2026-09-24) — do not go live yet**
- Finish the later phases before anything ships. No `git push` on web or mobile.
  No web deploy. No mobile OTA. Step 32 (checks against the deployed APIs) stays
  closed until they ask.

**Verified**
- Web: `tsc` clean, `npm test` 146 passed (step 25). Phase 1 eslint clean.
  Full-repo lint still fails on pre-existing Pro issues.
- Phone: `tsc` clean and `expo export --platform ios` bundled (step 30).

**Not verified** (needs the owner, on a login — not a reason to deploy)
- Dashboard §7 checks 2–6 and 8 (no password in the agent session). Check 7
  skipped (import deferred).
- Phone on a device: Today + planned £, Start day / Continue day, Go to today,
  Done auto-advances, Move remaining, airplane-mode Done + Skip then reconnect,
  Calendar opens Stop, Customers lookup + Add, push deep-link, RS Locksmiths
  login still on the old job screen.

**Known gaps (not missing Phase 1 work)**
- A real `skipped` job status is Phase 8. Phase 1 skip is `cancelled` + `skip_reason`.
- Taking payment on the Stop screen is Phase 2. Completion leaves `payment_status` unpaid.
- Reminder copy (“We're coming Thursday, reply NO”) is Phase 3. Phase 1 sends nothing and does not wait for a YES.
- Bank connect and Stripe Connect, from both the phone and the dashboard, are Phases 2 and 4.
- Phone visual redesign: done 2026-10-02 (no neumorphism).
- `after_completion` shipped. It is not a gap.
- Spreadsheet import (steps 23–24) stays deferred until real customer sheets exist.

**Step 30 compile (2026-09-24)**
- `npx tsc --noEmit` clean.
- `npx expo export --platform ios` bundled (2011 modules) and wrote `dist/`
  (gitignored).
- Device §7 checks still need the Rounds login on a phone: Today + planned £,
  Start day / Continue day, Go to today, Done auto-advances, Move remaining,
  airplane-mode Done + Skip then reconnect, Calendar opens Stop, Customers
  lookup + Add, push deep-link, RS Locksmiths login unchanged.

**Step 25 verification (2026-09-23)**
- `npx tsc --noEmit` clean; `npm test` — 146 passed.
- Phase 1 surface eslint clean (rounds / calendar / customers / services /
  dashboard / import redirect / rounds APIs). Full-repo `npm run lint` still
  fails on **pre-existing** Pro/settings/sidebar issues (same class as noted in
  Phase 0) — not introduced here; left untouched.
- Redirects: `/rounds` → `/dashboard`, `/rounds/customers` → `/customers`,
  `/rounds/services` → `/services`.
- DB: "Test rounds 2" already has the 6 Window cleaning presets.
- §7 interactive UI checks 2–6 and 8 need a logged-in browser session (agent
  has no password). Check 7 skipped (import deferred).

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
- **Step 5** — `lib/rounds/route-optimiser.ts`: nearest-neighbour from the route
  start (or the first stop), then 2-opt on haversine (cap 200 passes). Stops
  without coordinates stay at the end in input order and do not count in
  `distanceKm`. Pure; the `/api/rounds/optimise-day` wrapper is step 15.
- **Step 6** — spreadsheet/form helpers, still pure: `parseFrequencyDays`
  ("4 weekly" / "6w" / 28 → days), `normalizeUkPhoneE164` / display,
  `USER_SKIP_REASONS` + labels, `SERVICE_PRESETS` (window cleaning, gardening,
  cleaning, exterior, general). Tests for frequency + phone.
- **Step 7** — visit generator (not a server action; takes a supabase client so
  cron and dashboard can share it). `generateVisitsForAgreement` upserts on
  `(service_agreement_id, agreement_occurrence_date)` so a re-run inserts 0.
  `generateVisitsForTenant` resumes pauses whose date has arrived, fills the
  `fixed` horizon, and backfills a missing `after_completion` next visit
  (offline-Done recovery). Also: `getSoloWorkerForTenant`, `getRoundsSettings`.
- **Step 8** — Done / Skip / Reschedule / **Move remaining** / reorder /
  Optimise as shared server functions (dashboard and phone will call these).
  Completing or skipping a “next visit from when I last did it” agreement
  creates the next stop; a **fixed** agreement does not. Pause/end/price-change
  helpers: delete or reprice only assigned future visits.
- **Step 9** — zod 4 schemas in `lib/validations/rounds/` (agreement, doorstep
  customer, visits incl. move remaining, service catalog, settings).
  `schedule_mode` defaults **`fixed`**; `shift_off_non_working_days` defaults
  **false**; skip reasons are the user-picked set only. Postcode uses the same
  UK transform as `createJobSchema`.
- **Step 10** — dashboard read layer in `lib/data/rounds/` (customers list +
  detail, agreements, day/month visits, catalog, home stats). RLS via
  `createClient()`; explicit column lists.
- **Step 11** — save actions for the catalog (create/update/deactivate, add
  trade presets without overwriting edited prices) and Rounds settings
  (read-modify-write of `tenants.settings.rounds` only).
- **Step 12** — agreement actions: create (geocode + generate visits), edit
  (rebuild future visits if the cycle/address changed; optional reprice),
  pause / resume / end, and a manual Generate now.
- **Step 13** — visit actions the dashboard (and later the phone APIs) call:
  Done, Skip, Reschedule, **Move remaining**, reorder, Optimise, one-off job.
- **Step 14** — nightly generate-visits cron route + `vercel.json` schedule
  (`0 2 * * *`). Starts on the next web deploy; needs `CRON_SECRET` set.
- **Step 15** — bearer auth (`lib/auth/bearer.ts`: anon key + the caller's JWT
  so RLS applies) and phone APIs: Optimise, Done, Skip, **Move remaining**,
  doorstep Add customer, second-property agreement. Same cores as the
  dashboard actions. Online only.
- **Step 16** — existing customer form gained a `variant="rounds"`: no bulk/individual
  toggle, no address (that lives on the agreement), plus payment terms, access
  notes, and preferred contact. Pro form unchanged. Pages that use this land
  in step 19.
- **Step 17** — Rounds sidebar now has Customers, Calendar, Services, Import,
  then Payments / Bank / Messages / Expenses. Settings gains a **Rounds** tab
  (only if the tenant has Rounds): usual work days, days off, “move visits off
  days I don’t work” off by default, horizon, reminder days, route start.
- **Step 18** — `/services` and `service-catalog-table.tsx`. Inline add
  and edit, deactivate (and activate again), and **Add presets…** per trade
  group. The page says price, duration, and repeat are defaults: each customer
  gets a copy you can change when you add them and again later, including on
  the day. Editing a default does not rewrite customers already set up.
  Switched-off services sit in a collapsed list under the active ones.
- **Step 19** — `/customers` list (search + active/inactive filter,
  Import link, floating add), `new`, `[id]` detail (payment badge, Deactivate,
  agreements card with Pause/Resume/End/Edit, visits Upcoming/Recent, notes),
  and `[id]/edit`. Uses the rounds `CustomerForm` from step 16. Agreement
  create/edit routes are linked but land in step 20.
- **Step 20** — `agreement-form.tsx` + `/agreements/new` and
  `/agreements/[agreementId]/edit`. Service from catalog (fills title/price/
  duration/frequency), address autocomplete, how often, anchor date, **Next
  visit from when I last did it** (off → `fixed`), preferred weekday/time,
  usual payment method, reminders, access notes. Create after new customer
  shows the “Now add their first service” banner (`?first=1`). Edit asks
  whether to reprice upcoming visits when price changes.
- **Step 21** — `/calendar` month + day. `visit-actions` (Done / Skip /
  Reschedule / **Move remaining**), `rounds-month-grid` (counts + working-day /
  blackout shade), `rounds-day-plan` (▲▼ + drag reorder, Save order, Optimise,
  one-off job).
- **Step 22** — Rounds `/dashboard` home: stat tiles, today's stops with
  Done/Skip/Reschedule, Optimise when unordered, **Move remaining**, empty
  states for no customers / empty catalog.
- **Step 26** — mobile types hand-edit (`service_catalog`, `service_agreements`,
  jobs/customers rounds columns); `fetchJobsForWorker` date window + customer
  embed; `fetchJobById` embed; `openNavigation.ts` extracted from JobDetail.
- **Step 27** — `workwise-mobile/src/lib/rounds/`: query keys (persisted root
  already wired), `selectDayPlan` / `nextStopAfter` / `localYmd`, skip reason
  labels, `fetchRoundsCustomers` + `useRoundsCustomers`, and `bearerFetch` +
  Optimise / Done / Skip / Move remaining / doorstep / agreement API helpers.
  `.env.example` documents `EXPO_PUBLIC_API_URL`. `tsc` clean. Screens land in
  steps 28–29.
- **Step 28** — phone day-run: `TodayScreen` (day chips, £ planned, Optimise,
  Move remaining, Start day), `StopScreen` (Navigate / Done / Skip with
  auto-advance), `SkipReasonSheet`, wired on `TodayStack`. Online Done/Skip
  hit the bearer APIs; offline patches the job and relies on cron for
  `after_completion` backfill. `tsc` clean. Today’s start and end chips can
  each take a one-off postcode for Optimise; the saved route start is unchanged.
  With no override, the day leaves home and the distance includes the drive back.
  After the run has begun, Today’s primary button says **Continue day**.
- **Step 29** — phone calendar is its own month grid (stop count, £, green
  heat for busier days, done bar). Tap a day, then a stop, to open Stop.
  Pro calendar unchanged. Customers tab is
  lookup (search, detail, call, upcoming visits) plus a two-step Add while
  out (person, then service, one doorstep API call, default `fixed`). Push
  deep-link goes to Stop when `appMode` is rounds. Money stays a placeholder.
  `tsc` clean. Device checks wait for step 30.
- **Settings, same branch** — Company → skills only when the tenant has Pro.
  Lite and Rounds do not match workers to jobs, so that block is hidden.
  Company email was blank because signup stores it on the login, not in
  `settings.company`. The field now shows the login email until they save a
  company one. Company industry is the longer trade list in
  `lib/data/settings-types.ts`. A services interview, if we do one, still waits
  for self-serve onboarding.

**Owner decision (2026-09-24) — route finishes at home**
- Optimise is no longer a one-way list that stops at the last house. The
  distance includes the hop from the last stop to a finish point, so a house
  near home lands at the end and the far cluster sits in the middle.
- Finish defaults to the saved route-start postcode, else the worker’s home
  pin — the same place the day starts from when they do not override it.
- Phone Today has an end chip with the same badge and mechanic as start:
  a UK postcode for this optimise only, not written to settings. Dashboard
  Optimise sends neither override, so that day leaves home and returns home.

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

**Owner decision (2026-09-23) — DONE: product-neutral dashboard URLs**
- Dashboard paths no longer include `/rounds`. Same login, ordinary paths
  (`/customers`, `/calendar`, `/services`, …). Entitlement picks the
  UI: Rounds-only (and Lite+Rounds) get the round CRM at `/customers`; Pro gets
  the dispatch CRM at the same path. `next.config` redirects old `/rounds/*`
  bookmarks. Helper: `lib/navigation/dashboard-paths.ts`.
- **Rounds + Pro on one tenant** is still Phase 8 — today Pro wins shared paths
  if both somehow exist (`usesRoundsCrm` = hasRounds && !isPro).
- Phone Add customer (step 29): paginated person → service in one flow when we
  get there; not two disconnected apps.

**Owner decision (2026-09-23) — DEFERRED: Rounds spreadsheet import (steps 23–24)**
- Early customers onboarded manually as a service. AI can parse messy
  name/address rows (Pro jobs import already does), but Rounds sheets need
  frequency, service matching, and agreement defaults — too unreliable without
  real sheet shapes. Revisit after those are in hand. Import nav/CTAs hidden
  for Rounds; `/import` redirects Rounds tenants to `/customers`.

**SQL — already pasted by the owner, in this order** (`supabase/migrations/`):
1. `20260915100000_service_catalog.sql`
2. `20260915100100_service_agreements.sql`
3. `20260915100200_jobs_rounds_columns.sql`
4. `20260915100300_customers_rounds_columns.sql`
5. `20260915100400_ai_interactions_rounds_types.sql`

**Owner follow-ups still outstanding**
- Paste `supabase/migrations/20260923190000_industry_is_not_the_product.sql`.
  Signup was storing industry `Rounds`. New signups leave it blank (Lite still
  stores the trade they typed). The paste also clears existing `Rounds` industries.
- Refresh `supabase/schema_current.sql` from the live schema (owner's file; agents
  never edit or commit it).
- Regenerate `workwise-mobile/src/types/supabase.ts` when convenient (step 26
  hand-added the rounds columns; regenerate keeps them in sync).
- `EXPO_PUBLIC_API_URL` into EAS env before the OTA (Phase 1 close). Local
  `.env.local` / simulator needs it pointed at a running web app for phone APIs.

**Not verified yet**: log in as a Rounds tenant and hit `/customers`,
`/services`, create → agreement. Old `/rounds/customers` should redirect.
Pro `/customers` must still be the dispatch CRM. Verification plan is spec §7.

**No web env vars added by Phase 1.** Do not push, deploy, or OTA (owner, 2026-09-24).

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



## Phase 8 — Pro self-serve — DONE 2026-10-08, NOT RELEASED

**Built (plain English).** A business can buy Starter, Growth or Pro on its own sign-up page, fed by the worker slider on the Pro pricing page, monthly or yearly (yearly = 10 months for plan and extra workers). Checkout charges the plan plus extra workers for the team size said on the slider; those extras are held on the bill until the real team reaches that size, then the bill follows head count (a Stripe extra-worker line, reconciled after every add/remove/deactivate and daily). Adding past the paid size asks first (yearly: "£x now, for the rest of your year"). Bulk add: paste or CSV, up to 100 rows, email required (it is how the worker gets a login), one confirmation, invites sent in one batch. Get started panel on the dashboard. Pro Plan & billing: cancel, undo, upgrade a tier now (pro-rata), switch monthly to yearly now (year starts the day they switch). Rounds and Lite use the same yearly rule, and their billing page now has the coloured Add Lite / Add Rounds / Pay yearly blocks. Plan ended (restart page with the right total for the team), payment overdue banner, Close my account (30-day purge). Pro referrals (one month of the cheaper plan, third monthly bill or first yearly payment). Pro Lily untouched. RS Locksmiths and Eden untouched (Managed by WorkWise). Spec: `../docs/specs/phase-8/README.md` (24 cards). Not VAT registered: no "+ VAT" anywhere, VAT added to Pro with 30 days' notice if that changes.

**SQL pasted** (owner, 2026-10-08, in order): `20261008110000_worker_allowance.sql`, `20261009100000_pro_self_serve.sql`, `20261009100100_provision_pro.sql`, `20261009100200_purge_pro.sql` (purge, pasted before the walkthrough; the purge cron then removed the closed test business, and the old Phase 7 closed test account which was also due).

**Checks (numbers).** `npm test` 2265 pass (215 files); `tsc` clean; eslint unchanged from before (39 pre-existing errors elsewhere, none in Phase 8 files); `check-cards` clean (24 cards); site `tsc` + lint clean. Stripe test-mode scripts all pass: `stripe:extra-worker-check` (monthly and `--yearly`), `stripe:pro-manage-check`, `stripe:pro-restart-check`, `stripe:pro-yearly-check` (new).

**Bugs found and fixed while walking:** the add-workers screens said "+£45 a month" for extras already paid at sign-up (now no dialog, no consent, "Fits inside your plan"); email was optional in bulk add (now required); the Workers page line became "x / y workers" with extras counted as part of the plan; the yearly add-worker preview used the real date instead of the test clock's (test mode only); a test CSV postcode (B1 1AA) postcodes.io doesn't know; the Rounds/Lite switch to yearly kept the old billing day (now the year starts the day they switch).

**Decisions to confirm with the owner (calls made, not explicitly decided):** the referral reward uses the monthly list price of the cheaper plan even for yearly customers; Rounds-to-Lite referral amounts unchanged; worker phones are not blocked when a Pro plan ends; no VAT-number field at Checkout; the Get started panel can be hidden per browser; bulk add runs in chunks of 10 with all invite emails sent together at the end; extras paid up front stay on the bill until the team reaches the slider size (this changed D4, which first said plan-only at Checkout; the owner confirmed); upgrade dialog says "Nothing to pay today" when a referral credit covers the pro-rata; the invoice list shows an invoice's total, not what was left to pay after credit.

**Not verified:** live mode; the phone (nothing changed there); the manual-business guard in `purge_tenant` (proved by reading the function, never run on a hand-set-up business); typing a card into Stripe's hosted pages (restart payment and the Pro sign-up page were done by the owner for Growth monthly only; other accounts were made with `npm run stripe:p8-account`); the emails actually arriving; the manual Pro account in the browser; a fresh Rounds sign-up and the phone Rounds tabs after the Rounds/Lite change; dark/light mode of the new blocks beyond dark desktop and light phone.

**At release** (the Phase 7c cards 05, 07 and 09 carry the same items):
- Stripe **live**: `npm run stripe:pro-prices -- --live` and `npm run stripe:extra-worker-prices -- --live` (twelve prices: three tiers × monthly/yearly × plan/extra; not VAT registered, so no tax behaviour yet).
- Vercel env (dashboard project): the twelve `STRIPE_PRICE_*` Pro ids (names in `../docs/specs/phase-8/00-context.md` §5) plus the Phase 7 variables; `CRON_SECRET` present (the daily `/api/cron/extra-workers` and the purge cron need it). Never `STRIPE_SIGNUP_TEST_CLOCK`.
- Marketing site env: `WORKWISE_APP_URL=https://app.joinworkwise.com`.
- Cron: `/api/cron/extra-workers` daily 04:45 UTC (already in `vercel.json`).
- SQL on the **live** Supabase: the four Phase 8 files above, in order.
- Stripe live webhook: no new events (`checkout.session.completed`, `customer.subscription.*`, `invoice.paid`).
- No phone change.

**Support how-to** (owner does these in Stripe or Supabase):
- Move a Pro customer to a smaller plan, or yearly back to monthly (monthly to yearly and upgrades are self-serve now): change the plan line's price on their subscription in Stripe (all items must share one interval; delete the extra-worker line first when switching interval, the daily reconcile re-adds it with the right price), then wait for the webhook or run the reconcile cron.
- Custom allowance: `UPDATE public.subscriptions SET included_workers_override = N WHERE tenant_id = '…' AND product = '…' AND status IN ('trialing','active','past_due');`
- Restore a closed Pro business within 30 days: clear `tenants.closed_at` and `purge_after`, unban each login in Supabase Auth, restart the plan from the plan-ended page.
- Make a hand-set-up Pro customer self-serve (billed by Stripe): the SQL printed by `scripts/stripe-pro-test-subscription.mjs`, with their real Stripe customer and subscription ids.

**Test helpers added:** `npm run stripe:p8-account -- --email … --tier … --interval … --workers …` (test-mode account without typing a card; set `WALKTHROUGH_PASSWORD`), `npm run stripe:pro-yearly-check`.

### Walkthrough results (step 22, run by Claude 2026-10-08)

Test accounts (Stripe test mode, each on its own test clock; test only; password not stored in this file): `taylorbk2006+p8growth` (the owner's Checkout sign-up; now Pro, plan ended, restart page up), `+p8a` Growth monthly then yearly (tenant f9e48700-…), `+p8year` Starter yearly (82a0086d-…), `+p8ref` Starter monthly referred by P7 Rounds Test Co, `+p8refpro` Growth yearly referred by p8growth, `+p8close` closed (tenant d0f2584f-…). Accounts other than p8growth were made with `npm run stripe:p8-account` (does what Checkout + webhook do without typing a card into Stripe's hosted page; it uses the real Checkout body builder and the real provisioning). Browser logins used `*.localhost:3000` origins so the owner's own sessions were untouched.

Automated: `stripe:extra-worker-check` (monthly + `--yearly`), `stripe:pro-manage-check`, `stripe:pro-restart-check`, new `stripe:pro-yearly-check` all pass; tests 2265, tsc clean, eslint unchanged (39 pre-existing errors), check-cards clean, site tsc + lint clean.

| # | Result |
|---|---|
| 1-2 | ✓ owner (Checkout £494 = £449 + 5 × £9 for the slider's 40; no promo box); DB checked |
| 3 | ✓ A: 40 added, "Fits inside your plan", no dialog, extra line stays × 5, `expected_workers` released, no consent row, no new charge. **Found + fixed earlier:** wrong "+£45". Test CSV had one postcode postcodes.io doesn't know (B1 1AA, twice): fixed in both CSVs |
| 4 | ✓ A: "37 ready · 3 need fixing" with plain messages; two unknown postcodes fixed in place |
| 5 | ✓ p8growth team 38 → Stripe extra × 3; Workers line "38 / 38 workers" |
| 6 | ✓ Plan & billing £449 + 3 × £9 = £476, next bill £458 (credit for two removed extras), card, invoices |
| 7 | ✓ clock +1 month: renewal £458 paid; Get started panel stays (no customers/jobs exist, so "data exists" didn't apply) |
| 8 | ✓ upgrade to Pro through the page: dialog "Nothing to pay today" (the £449 referral credit covered the £266.57 pro-rata), plan Pro £749, extra line gone, `pro`/`month` row, "38 / 70 workers" |
| 9 | ✓ cancel banner, Undo clears it in Stripe, cancel again, clock past end: Stripe canceled, restart page with Pro pre-selected (Starter £485 / Growth £476 / Pro £749 for 38 workers); Restart opens Checkout with Pro × 1 £749 (`restart`). **Not walked:** paying on Stripe's page (owner) |
| 10 | ✓ failing card + clock to renewal: `past_due`, amber Update card banner, workers page still works; good card + pay open invoice (£566.57): banner clears |
| 11 | ✓ Starter yearly £1,490, one line; Plan & billing "What you pay each year" |
| 12 | ✓ clock +6 months, 11th worker: dialog £60.24 now then £120 a year; Stripe invoice £60.24 paid, extra line × 1, consent row. **Found + fixed:** the preview used the real date, not the test clock's, so it said £120 on a test clock (test-clock only; `extra-workers-preview.ts`) |
| 13 | ✓ deactivate: extra line removed, customer balance −£60.24 |
| 14 | ✓ renewal £1,429.76 = £1,490 − £60.24, still yearly to 8 Oct 2028 |
| 14b | ✓ NEW switch to yearly via the page on A: dialog £4,446 (£4,940 − £494 unused), year starts today, next bill £4,940 on 8 Oct 2027; Stripe invoice £4,446 paid, items yearly, DB `year`; also `stripe:pro-yearly-check` on a test clock (£4,514.32 today, £245.68 credit, renewal £4,760 a year later). Rounds/Lite switch changed to the same rule: Lite test account £315 now, next bill £350 on 6 Oct 2028 |
| 15 | ✓ £149 no discount; referral `waiting` for P7 Rounds Test Co |
| 16 | ✓ still waiting after bill 2; after bill 3 referrer balance −£35.00, referral `rewarded` |
| 17 | ✓ £4,490 no discount; p8growth −£449.00 (cheaper Growth plan); Refer page Joined 1, credit £449 |
| 18 | ✓ no "free", "both" or "discount" except the owner's "no discount for them"; one "taken off your next bill" ("off" as ordinary wording, flagged) |
| 19 | ✓ Close my account offered (no Delete tenant account); closed with name + password |
| 20 | ✓ Stripe canceled, `closed_at` + `purge_after` +30 days, sign-in refused ("User is banned"), login page says the account is closed. **Not walked:** the email arriving (owner) |
| 21 | **Waiting for the owner:** paste `UPDATE public.tenants SET purge_after = now() - interval '1 minute' WHERE id = 'd0f2584f-c680-4b75-83f5-c743f369b232' AND closed_at IS NOT NULL;` then Claude runs the purge cron |
| 22 | Not walked in the browser (no login for Test Plumbing Co; RS Locksmiths and Eden are never used): covered by unit tests (managed tab, no Get started panel, no usage line, close-account refusal) |
| 23 | ✓ Lite Plan & billing, Refer link, Add Rounds nudge, switch to yearly all work on the Phase 7 Lite account. Not re-walked: a fresh Rounds sign-up (hosted Checkout) and phone Rounds tabs |
| 24 | ✓ 375 px: Pro sign-up, Get started, Add several, Plan & billing, Refer: no horizontal overflow |
| 25 | ✓ Pro pricing Get started links carry tier + workers (+ interval=year when yearly; monthly is the default and left out); Book a demo is secondary; Enterprise says talk to us |

Not walked on purpose: manual-business guard in `purge_tenant` (proved by reading the function), live mode, the phone.
Cleanup still to do after row 21: remove `STRIPE_SIGNUP_TEST_CLOCK=1` from `workwise_web/.env.local` and stop `stripe listen`.
