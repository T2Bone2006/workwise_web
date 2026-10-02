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
| `../docs/specs/parked/open-banking/` | Parked open-banking (Yapily) spec — for after revenue. Do not build from it. |
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

- Phase 5 (running the business) signed off by the owner 2026-10-02, not released. See the Phase 5 section below. Phases 1–4 and the calendar update stay code-complete and unreleased. Still open from earlier: Phase 3 step 32 walkthrough; Phase 4 step 26 (live GoCardless at launch).
- Next: Phase 6 (Lite in the dashboard). No spec folder yet (`docs/ROUNDS-PLAN.md` Phase 6).

---

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
| 17 | | Buy 250 texts (test card); webhook replay adds nothing |
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
- Phone visual redesign (neumorphism) is Phase 7.
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

