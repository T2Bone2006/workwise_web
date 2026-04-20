# WorkWise Dash Codebase Overview

This document is a factual handoff overview of the current app structure in `workwise_dash`, based on implemented routes, actions, components, and data access.

## Architecture Snapshot

- Framework: Next.js App Router (`app/`) with route groups for auth and dashboard.
- Auth/session: Supabase Auth + SSR client in `lib/supabase/server.ts`, session refresh/redirect logic in `middleware.ts` and `lib/supabase/middleware.ts`.
- Data layer:
  - Read/query functions in `lib/data/*`
  - Mutations in server actions under `lib/actions/*`
  - API handlers in `app/api/*/route.ts`
- UI composition:
  - Global shell via `app/(dashboard)/layout.tsx` -> `components/layout/dashboard-shell.tsx`
  - Sidebar navigation and admin link in `components/layout/sidebar.tsx`

---

## 1) Pages and Routes

### Root + Auth

- `/` -> `app/page.tsx`
  - `Home()` checks `supabase.auth.getUser()` and redirects:
    - authenticated -> `/dashboard`
    - unauthenticated -> `/login`
- `/login` -> `app/(auth)/login/page.tsx`
  - `LoginPage()` renders `LoginForm` from `components/auth/login-form.tsx`.
- Auth layout -> `app/(auth)/layout.tsx`
  - `AuthLayout()` provides centered auth container + theme toggle.

### Dashboard Shell (protected area)

- Dashboard group layout -> `app/(dashboard)/layout.tsx`
  - `DashboardLayout()` verifies auth and passes tenant/admin context to `DashboardShell`.
- Middleware gatekeeping -> `middleware.ts`
  - `middleware()` redirects:
    - unauthenticated dashboard access -> `/login`
    - authenticated login access -> `/dashboard`

### Dashboard and Operations Pages

- `/dashboard` -> `app/(dashboard)/dashboard/page.tsx`
  - `DashboardPage()` loads:
    - `getDashboardJobStatCards()`
    - `getRecentJobs()`
  - Renders `DashboardStatCards` and `RecentJobs`.

- `/jobs` -> `app/(dashboard)/jobs/page.tsx`
  - `JobsPage()` parses query filters via `parseSearchParams()`.
  - Loads:
    - `getJobsForTenant()`
    - `getUnassignedJobsForTenant()`
    - `getJobsStatusSummary()`
    - `getCustomerJobCounts()`
    - optionally `getCustomerJobsCompletionSummary()`
  - Renders `JobsTable`, review banner, and error toast.

- `/jobs/new` -> `app/(dashboard)/jobs/new/page.tsx`
  - `NewJobPage()` loads customers/workers with:
    - `getCustomersForTenant()`
    - `getWorkersForTenant()`
  - Renders `JobForm`.

- `/jobs/[id]` -> `app/(dashboard)/jobs/[id]/page.tsx`
  - `JobDetailPage()` fetches job row, status history, worker list, computes map/distance (`postcodeToLatLng()`, `haversineDistance()`), renders `JobDetailView`.

- `/jobs/review` -> `app/(dashboard)/jobs/review/page.tsx`
  - `JobsReviewPage()` pulls unassigned jobs and workers, renders `JobsReviewFlow` for assignment queue.

- `/import` -> `app/(dashboard)/import/page.tsx`
  - `ImportPage()` loads tenant import sources via `getImportSourcesForTenant()` and renders `ImportWizard`.

- `/workers` -> `app/(dashboard)/workers/page.tsx`
  - `WorkersPage()` fetches tenant workers (inline `getWorkersForTenant()` in this page file), applies local filter/sort helpers (`parseSearchParams()`, `applyFilters()`, `collectAllSkillsInUse()`), renders `WorkersTable`.

- `/workers/new` -> `app/(dashboard)/workers/new/page.tsx`
  - `NewWorkerPage()` renders `WorkerForm` create mode.

- `/workers/[id]` -> `app/(dashboard)/workers/[id]/page.tsx`
  - `WorkerDetailPage()` fetches worker profile + job stats + recent jobs and renders detailed cards/metrics.

- `/workers/[id]/edit` -> `app/(dashboard)/workers/[id]/edit/page.tsx`
  - `WorkerEditPage()` loads worker (inline `getWorkerById()`), renders `WorkerForm` edit mode + `WorkerDeleteButton`.

- `/customers` -> `app/(dashboard)/customers/page.tsx`
  - `CustomersPage()` parses search/type/sort and loads `getCustomersForTenantList()`, renders `CustomersTable`.

- `/customers/new` -> `app/(dashboard)/customers/new/page.tsx`
  - `NewCustomerPage()` renders `CustomerForm` create mode.

- `/customers/[id]` -> `app/(dashboard)/customers/[id]/page.tsx`
  - `CustomerDetailPage()` loads:
    - `getCustomerById()`
    - `getCustomerJobStats()`
    - `getRecentJobsForCustomer()`
  - Renders `CustomerDetailView`.

- `/customers/[id]/edit` -> `app/(dashboard)/customers/[id]/edit/page.tsx`
  - `CustomerEditPage()` loads customer and renders `CustomerForm` edit mode.

- `/settings` -> `app/(dashboard)/settings/page.tsx`
  - `SettingsPage()` loads `getSettingsPageData()` and renders `SettingsView`.

- `/admin/ai-analytics` -> `app/(dashboard)/admin/ai-analytics/page.tsx`
  - `AIAnalyticsPage()` uses `isAdmin()`, reads analytics views/tables (`ai_performance_summary`, `ai_training_readiness`, `ai_interactions`) and displays platform-wide AI metrics.

- `/dev/seed` -> `app/(dashboard)/dev/seed/page.tsx` (dev utility page)
  - `DevSeedPage()` client utility to GET/POST/DELETE `/api/seed/workers`.

---

## 2) API Routes

- `POST /api/map-columns` -> `app/api/map-columns/route.ts`
  - `POST()` validates incoming `columnNames`, builds a mapping prompt, calls `callAIWithLogging()` (Anthropic-backed), parses JSON mapping/transforms, returns `{ mapping, transforms }`.

- `POST /api/detect-skills` -> `app/api/detect-skills/route.ts`
  - `POST()` validates `description`, calls `detectSkills()`, returns `{ skills, interactionId }`.

- `GET|POST|DELETE /api/seed/workers` -> `app/api/seed/workers/route.ts`
  - `POST()` creates seed workers using `generateSeedWorkers()`.
  - `DELETE()` finds seed workers by `@seed.workwise.local`, unassigns jobs, deletes workers.
  - `GET()` returns current seed worker count.

---

## 3) Key Components and Flows

### Import Wizard (primary import flow)

- UI: `components/import/import-wizard.tsx` (`ImportWizard`)
  - 4-step flow: source -> upload -> map -> preview/import.
  - File parsing:
    - CSV via `papaparse`
    - XLSX via `xlsx`
  - AI mapping trigger: `handleAiMapping()` -> `/api/map-columns`.
  - Supports saved mappings from `import_sources.column_mapping`.
  - Executes import with server action `importJobs()` from `lib/actions/import.ts`.

- Server import logic: `lib/actions/import.ts` (`importJobs`)
  - Resolves/updates `import_sources` mapping metadata.
  - Validates required fields from mapped rows.
  - Appends unmapped CSV columns into `job_description` (`formatUnmappedCsvColumns()`).
  - Runs AI skill detection in batches via `detectSkills()`.
  - Inserts jobs in batches (`BATCH_SIZE`), then auto-assigns with `autoAllocateJob()`.
  - Writes import audit row into `import_history`.

### Job Management

- Jobs list/table: `components/jobs/jobs-table.tsx` (`JobsTable`)
  - URL-driven filters/sort/pagination through `useSearchParams()` and `router.push`.
  - Status cards, view toggle (list/grouped), customer filter, debounced search.
  - Renders grouped mode via `JobsGroupedView`.

- Job create form: `components/jobs/job-form.tsx` (`JobForm`)
  - Submits to `createJob()` in `lib/actions/jobs.ts`.
  - Optional AI skill detection (`/api/detect-skills`), with user edit logging support.
  - Optional auto-assignment via `autoAllocateJob()` after creation.

- Job detail composition: `components/jobs/job-detail-view.tsx` (`JobDetailView`)
  - Details card, skills card, status timeline, customer/worker side cards, actions card, and map.
  - Map component: `components/maps/job-location-map.tsx` (`JobLocationMap`) using Leaflet.

- Review queue: `components/jobs/jobs-review-flow.tsx` (`JobsReviewFlow`)
  - Manual assign (`assignJob()`) and auto assign (`autoAllocateJob()`) actions.

- Core job actions: `lib/actions/jobs.ts`
  - `createJob()`
  - `updateJobStatus()`
  - `assignJob()`
  - `autoAllocateJob()` (distance + skill + load aware worker selection)
  - all status-changing paths log to `job_status_history`.

### Dashboard

- Page: `app/(dashboard)/dashboard/page.tsx` (`DashboardPage`)
- Data loaders: `lib/data/dashboard.ts`
  - `getDashboardJobStatCards()`
  - `getRecentJobs()`
  - (also available: `getRecentActivity()`, `getTopWorkers()`)
- Components:
  - `components/dashboard/dashboard-stat-cards.tsx`
  - `components/dashboard/recent-jobs.tsx`

---

## 4) Database Tables Used (and what they store)

Schema reference: `lib/db/schema.sql`

- `users`: app user profile row keyed to `auth.users`; stores tenant/role/profile fields.
- `tenants`: company/tenant record; includes `settings` JSONB and subscription metadata.
- `jobs`: core work items (customer, worker assignment, address/postcode, status/priority, schedule, completion fields, required skills, etc.).
- `job_status_history`: status transition/audit timeline for jobs.
- `customers`: tenant customer records (individual/bulk client + contact/billing metadata).
- `workers`: worker profiles, location, availability, skills, performance counters.
- `worker_tenants`: tenant-worker relationship/metadata for multi-tenant worker linkage.
- `import_sources`: reusable source definitions and saved column mappings for imports.
- `import_history`: per-import audit trail (counts, errors, created job IDs, timing).
- `ai_interactions`: logged AI prompts/responses/costs/latency/outcomes.
- `notifications`: notification records (defined in schema; current app logic primarily stores notification settings in tenant JSON).
- `job_attachments`: attachment metadata table (defined in schema; not central in current route flow).

Additionally read in admin analytics page:
- `ai_performance_summary` (likely DB view): aggregate AI quality/cost/latency metrics.
- `ai_training_readiness` (likely DB view): readiness counts/status for training data volume.

---

## 5) Saved State / Persistent Config

### Browser local state

- Sidebar collapse preference in localStorage:
  - key: `workwise-sidebar-collapsed`
  - file: `components/layout/sidebar.tsx`

### Database persisted settings/state

- Import column mappings:
  - saved in `import_sources.column_mapping` (JSONB)
  - read by `getImportSourcesForTenant()` (`lib/data/import-sources.ts`)
  - updated/created in `importJobs()` (`lib/actions/import.ts`)

- Tenant settings JSON:
  - stored in `tenants.settings` (JSONB)
  - shape defined in `lib/data/settings-types.ts` (`TenantSettings`)
  - updated by `lib/actions/settings.ts`:
    - company profile (`updateCompanySettings`)
    - integrations (`updateIntegrations`, `saveAnthropicApiKey`, `saveVAPIApiKey`)
    - notifications (`updateNotifications`)
    - per-user phone map (`updateUserProfile` writes `settings.user_phone[userId]`)

- Job list/worker list filter state:
  - encoded in URL search params (`/jobs?...`, `/workers?...`) rather than localStorage.

---

## 6) Third-Party Integrations Active

### Supabase (active and core)

- Packages: `@supabase/ssr`, `@supabase/supabase-js`
- Session/client setup:
  - `lib/supabase/server.ts` (`createClient`)
  - `lib/supabase/middleware.ts` (`updateSession`)
- Used across data/actions/routes for auth + database reads/writes.

### Anthropic Claude (active for AI features)

- Package: `@anthropic-ai/sdk`
- AI gateway/logger: `lib/services/ai-logger.ts` (`callAIWithLogging`)
  - model default currently set to `claude-sonnet-4-20250514`
  - logs every interaction to `ai_interactions` with token/cost/latency metadata.
- Consumers:
  - column mapping route (`app/api/map-columns/route.ts`)
  - skill detection (`lib/detect-skills.ts`, `/api/detect-skills`)
  - import/create-job flows (through `detectSkills()`).

### Mapping tiles (active in UI)

- Packages: `leaflet`, `react-leaflet`
- `JobLocationMap` uses CARTO tile endpoint:
  - `https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png`
  - file: `components/maps/job-location-map.tsx`

### File parsing (active in import)

- `papaparse` for CSV
- `xlsx` for Excel
- both used in `components/import/import-wizard.tsx`

### Configured-but-not-runtime service placeholders

- Settings schema includes integration config objects for:
  - Xero (`integrations.xero`)
  - VAPI (`integrations.vapi`)
  - Anthropic (`integrations.anthropic`)
- Managed in `lib/actions/settings.ts`; currently this stores masked key/config metadata in `tenants.settings`.
- Note: runtime AI calls use `process.env.ANTHROPIC_API_KEY` in `lib/services/ai-logger.ts`; saved masked settings are UI/config metadata, not the runtime secret source.

---

## Additional Notes for Handoff

- Route guard behavior is split between:
  - middleware (`middleware.ts`) for login/dashboard redirects
  - dashboard layout auth check (`app/(dashboard)/layout.tsx`)
- Admin access is controlled by `isAdmin()` in `lib/utils/admin.ts` (role check + hardcoded email allowlist).
- Import/job flows are tightly coupled to UK postcode geocoding and distance-based allocation through:
  - `postcodeToLatLng()` (`lib/utils/postcode`)
  - `haversineDistance()` (`lib/utils/haversine`)
