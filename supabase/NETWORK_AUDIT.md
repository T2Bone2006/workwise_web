# WorkWise cross-tenant network jobs — technical audit

**Schema source:** Read [`supabase/migrations/schema.sql`](migrations/schema.sql) (309 lines). There is **no** file at `supabase/schema.sql` in this repository; [`lib/db/schema.sql`](../lib/db/schema.sql) mirrors the same core tables.

**Scope:** This repo is the **Next.js dashboard** (`app/`, `components/`, `lib/`). **Mobile worker app** is not present here; audit notes implications only.

---

## 1. DATABASE

### Current model (relevant)

- [`jobs`](migrations/schema.sql): `tenant_id` is the **sole ownership** discriminator; `customer_id` -> `customers` (same-tenant FK pattern); `assigned_worker_id` -> `workers`; rich lifecycle fields (`status`, timestamps, `completion_notes`, `industry_data`, `job_attachments`, `job_status_history`).
- [`worker_tenants`](migrations/schema.sql): junction `(worker_id, tenant_id)` with `status`, `is_primary`, rates, counters, timestamps - **reference pattern** for multi-tenant association metadata.

### What must change conceptually

- **Single `tenant_id` on `jobs` is insufficient** for "receiver owns row, sender has read-only live view." You need either:
  - **Columns on `jobs`** (minimal): e.g. `originating_tenant_id uuid NULL REFERENCES tenants(id)`, optional `network_connection_id uuid`, optional denormalized fields for sender display (customer/contact snapshot) if you cannot expose receiver `customers` rows to the sender tenant.
  - **Or** a **junction / link table** (cleaner audit trail): e.g. `network_job_links` with `id`, `connection_id`, `canonical_job_id` (FK `jobs.id` where `jobs.tenant_id` = receiving tenant), `originating_tenant_id`, `created_at`, `created_by_user_id`, `sender_reference_number`, snapshot JSONB for originating customer/notes at handoff time.

### New tables (proposed full structures)

**A. `tenant_network_connections`** (mirror `worker_tenants`: two parties + status + metadata)

```sql
CREATE TABLE public.tenant_network_connections (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id_a uuid NOT NULL REFERENCES public.tenants(id),
  tenant_id_b uuid NOT NULL REFERENCES public.tenants(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'rejected', 'revoked')),
  invited_by_tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  invited_by_user_id uuid REFERENCES public.users(id),
  message text,
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_network_connections_pkey PRIMARY KEY (id),
  CONSTRAINT tenant_network_connections_no_self CHECK (tenant_id_a <> tenant_id_b),
  CONSTRAINT tenant_network_connections_ordered_pair UNIQUE (
    LEAST(tenant_id_a, tenant_id_b),
    GREATEST(tenant_id_a, tenant_id_b)
  )
);
```

*(If PostgreSQL version disallows expressions in UNIQUE, use enforced ordering: store `smaller_tenant_id` / `larger_tenant_id` columns instead.)*

**B. `network_job_dispatches`** (or fold into `jobs` + RLS; included here if you want explicit handoff audit)

```sql
CREATE TABLE public.network_job_dispatches (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.tenant_network_connections(id),
  originating_tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  receiving_tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  canonical_job_id uuid NOT NULL REFERENCES public.jobs(id), -- job row lives on receiving tenant
  originating_customer_snapshot jsonb NOT NULL DEFAULT '{}',
  originating_reference_number text,
  created_by_user_id uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT network_job_dispatches_pkey PRIMARY KEY (id),
  CONSTRAINT network_job_dispatches_tenants_match_connection CHECK (true) -- tighten via trigger or composite FK if modeled per-connection endpoints
);
```

**C. Existing tables likely needing columns or policy-driven access**

- **`jobs`:** Add `originating_tenant_id` (nullable) and/or FK to `network_job_dispatches`; consider `network_customer_snapshot jsonb` on the job for sender-visible customer identity without cross-tenant `customers` SELECT.
- **`customers`:** No change strictly required if network jobs use `customer_id` NULL or a per-tenant synthetic "Network partner" customer; otherwise new customer type or flags.
- **`job_attachments` / `job_status_history`:** Inherit access from canonical `job_id`; RLS must allow **originating tenant read** when parent job is a network job.
- **`ai_interactions`:** If skill detection runs on send path, ensure `tenant_id` reflects the correct billing/logging tenant (today tied to acting user's tenant in [`createJob`](../lib/actions/jobs.ts)).

### `worker_tenants` relevance

- Table exists in schema; **app usage is minimal** today ([`lib/actions/settings.ts`](../lib/actions/settings.ts) deletes `worker_tenants` when removing workers). **Pattern** (composite key + status + timestamps) is the right analogue for `tenant_network_connections`; **not** a substitute for tenant-to-tenant job visibility.

---

## 2. BACKEND and API

### Server actions (primary mutation surface)

All job lifecycle logic is in [`lib/actions/jobs.ts`](../lib/actions/jobs.ts) with **hard tenant scoping**: every fetch/update uses `.eq('tenant_id', tenantId)` where `tenantId` comes from [`getTenantIdForCurrentUser()`](../lib/data/tenant.ts) or `users.tenant_id` from auth.

| Function | Cross-tenant impact |
|----------|---------------------|
| `createJob` | Today inserts `tenant_id: tenantId` only. **Sending** a job to another tenant needs a new path: create row on **receiver** `tenant_id`, set origin metadata, optionally no `customer_id` or mapped customer. |
| `assignJob`, `updateJobStatus`, `sendJobToWorker`, `sendPendingJobsToWorkers`, `deleteJob`, `bulkDeleteJobs` | All assume **acting tenant = job owner**. Originator must be **blocked** in app logic (and RLS) from these paths when `originating_tenant_id` != null and user tenant is originator. |
| `autoAllocateJob`, `getRankedWorkersForJob` | Load workers with `.eq('primary_tenant_id', tenantId)` - correct **only for the owning tenant** executing allocation on the canonical job. Originator must not auto-assign on receiver's job unless explicitly designing delegation (not in product spec). |

### Data layer reads

[`lib/data/jobs.ts`](../lib/data/jobs.ts): every query `.eq('tenant_id', tenantId)`. **New read paths** needed: jobs where user's tenant is **originator** (read-only list + detail) vs **owner** (current behavior).

[`lib/data/dashboard.ts`](../lib/data/dashboard.ts), [`lib/data/customers.ts`](../lib/data/customers.ts), customer/worker pages: all **owner-tenant** scoped - stats must decide whether to include/exclude network-originated jobs for receiver and whether dashboard shows "sent jobs" for originator.

### Import

[`lib/actions/import.ts`](../lib/actions/import.ts): bulk inserts `jobs` with `tenant_id: tenantId` only - **no** network path today.

### HTTP API routes

[`app/api/detect-skills/route.ts`](../app/api/detect-skills/route.ts), [`app/api/map-columns/route.ts`](../app/api/map-columns/route.ts), [`app/api/seed/workers/route.ts`](../app/api/seed/workers/route.ts): **not** related to inter-tenant jobs. **New** routes or actions are expected for: connection CRUD, accept/reject, list partners, **dispatch job to connected tenant** (likely privileged insert/RPC on Supabase).

### New endpoints / actions (conceptual list)

- Connection lifecycle: create invite, accept, revoke, list `active` connections for current tenant.
- Dispatch: validate active connection + payload; insert/update `jobs` on **receiver** tenant + link row; optional notification to receiver admins.
- Read-only getters for originator: list dispatched jobs, job detail projection (status, worker, photos, history) **without** mutating server actions.

### Job creation / assignment / auto-assign for "originates elsewhere"

- **Canonical model:** one `jobs` row on **receiving** `tenant_id`; originator never holds a duplicate job row unless you add a **mirror** (not recommended).
- **Creation:** Either originator calls a **trusted RPC/service role** that inserts into receiver's namespace, or receiver "accepts" an inbox payload - not supported today.
- **Assignment / auto-assign:** Unchanged **on the receiver's job**; receiver's workers only (`primary_tenant_id` / availability as today). Originator's [`createJob`](../lib/actions/jobs.ts) + [`autoAllocateJob`](../lib/actions/jobs.ts) flow is irrelevant post-handoff unless you add a separate "draft on sender then push" model.

### Push notifications

[`lib/services/worker-push.ts`](../lib/services/worker-push.ts): uses **receiver** `tenantId` for settings and worker token - **aligned** with canonical job on receiver; no change to contract except ensuring dispatch triggers the same path when receiver sends job to worker.

---

## 3. FRONTEND — DASHBOARD

### Navigation / shell

[`components/layout/sidebar.tsx`](../components/layout/sidebar.tsx): fixed `navItems` - **Jobs, Workers, Customers, Import, Settings** only. **No** network/connections entry.

### Jobs list and filters

- [`app/(dashboard)/jobs/page.tsx`](../app/(dashboard)/jobs/page.tsx) + [`components/jobs/jobs-table.tsx`](../components/jobs/jobs-table.tsx): tenant-scoped data from `getJobsForTenant`. **Extend** with tabs or filters: "My jobs" vs "Sent to network (read-only)" or merge rows with a badge - requires new loaders and row typing (`JobRow` in [`lib/data/jobs.ts`](../lib/data/jobs.ts)).
- Banners: [`PendingSendJobsBanner`](../components/jobs/pending-send-jobs-banner.tsx), [`JobsForReviewBanner`](../components/jobs/jobs-for-review-banner.tsx) - **receiver** workflows only.

### Job detail

- [`app/(dashboard)/jobs/[id]/page.tsx`](../app/(dashboard)/jobs/[id]/page.tsx): `.eq('tenant_id', tenantId)` - **blocks** originator viewing canonical id unless RLS + query change.
- [`JobDetailView`](../components/jobs/job-detail-view.tsx) + [`JobDetailActionsCard`](../components/jobs/job-detail-actions-card.tsx): always shows assign/status/send/delete - **must branch** to read-only for originator (hide or disable [`assign-worker-dialog`](../components/jobs/assign-worker-dialog.tsx), [`job-detail-actions-card`](../components/jobs/job-detail-actions-card.tsx), delete, etc.).

### Job create / review

- [`components/jobs/job-form.tsx`](../components/jobs/job-form.tsx) + [`app/(dashboard)/jobs/new/page.tsx`](../app/(dashboard)/jobs/new/page.tsx): customer + worker pickers are **local tenant** only - **extend** with "Send to connected tenant" step + target tenant selector, or separate wizard page.
- [`app/(dashboard)/jobs/review/page.tsx`](../app/(dashboard)/jobs/review/page.tsx) + [`jobs-review-flow`](../components/jobs/jobs-review-flow.tsx): unassigned queue for **own** tenant - receiver behavior; originator has no equivalent.

### Dashboard home

[`app/(dashboard)/dashboard/page.tsx`](../app/(dashboard)/dashboard/page.tsx) + [`lib/data/dashboard.ts`](../lib/data/dashboard.ts): counts and recent jobs **only** `tenant_id` - **extend** or add widgets for outbound network job activity if product requires.

### Greenfield UI (not present)

- Connection management (invite, pending, active partners, revoke).
- Network job **inbox** for receiver (incoming before acceptance - if product needs staging vs direct insert).
- **Sent jobs** list for originator with live status (could reuse `JobsTable` patterns with `readOnly` prop and different data source).

---

## 4. SECURITY and RLS

### What exists in-repo

- Only explicit SQL policy file: [`lib/db/rls-job-status-history.sql`](../lib/db/rls-job-status-history.sql) - `job_status_history` SELECT/INSERT/DELETE allowed when `job_id` references `jobs` where `jobs.tenant_id` in `(SELECT tenant_id FROM users WHERE id = auth.uid())`.
- **No** checked-in policies for `jobs`, `customers`, `workers`, `job_attachments` in this repo; comments in [`lib/data/jobs.ts`](../lib/data/jobs.ts) assume "RLS enforces tenant isolation." **Production Supabase must be audited separately**; app logic **always** filters `tenant_id`, which is defense in depth but **not** a substitute for correct RLS if service role or bugs bypass filters.

### Required RLS direction (conceptual)

- **`jobs`:** Split policies: **full CRUD** where `tenant_id = user_tenant`; **SELECT only** (narrow columns optional via view) where `originating_tenant_id = user_tenant` (or user in table derived from `network_job_dispatches`). **No** UPDATE/DELETE for originator on canonical row.
- **`job_status_history`, `job_attachments`:** SELECT for originator when linked job is visible as network origin; **no** INSERT/UPDATE/DELETE for originator (unless you intentionally allow comment threads cross-tenant - not in spec).
- **`customers`:** Originator must **not** gain SELECT on receiver `customers` via job joins - **risk**: PostgREST embeds (`customer:customers!customer_id`) on job detail could leak PII if RLS widens `jobs` SELECT without locking down `customers`. Prefer **snapshot fields on `jobs`** or a **security definer view** exposing only non-sensitive columns to originator.
- **`tenant_network_connections`:** Each party can read rows they participate in; only invited/responder can update status; prevent arbitrary pairing without mutual consent.
- **Data leak risks:** Broad "OR originating_tenant" policies on `jobs` without companion restrictions on related tables; listing workers across tenants; exposing receiver internal `reference_number` vs agreed external ref; admin [`createAdminClient`](../lib/actions/workers.ts) paths - review any future network endpoints using service role.

---

## 5. REAL TIME

- **No** `supabase.channel`, `postgres_changes`, or Realtime subscriptions appear in the TypeScript/React codebase (grep over `*.ts` / `*.tsx`).
- UI freshness relies on **server components +** [`router.refresh()`](../components/jobs/job-detail-actions-card.tsx) after mutations.
- **Implication:** Cross-tenant "live" visibility for the originator **has no foundation** in the web app today. Options: Supabase Realtime subscriptions filtered by `job_id` (with RLS allowing originator to subscribe), polling from a small client component, or server-push (out of scope here).

---

## 6. WHAT IS ALREADY IN PLACE

- **Multi-tenant data model:** `tenants`, `users.tenant_id`, `jobs.tenant_id`, tenant-scoped customers/workers/import sources.
- **Centralized tenant resolution:** [`getTenantIdForCurrentUser`](../lib/data/tenant.ts) used across pages and actions.
- **Rich job domain:** status machine + history table, attachments, completion notes, industry JSON, geocoding/lat-lng on jobs ([`migrations/20260421113000_add_jobs_lat_lng_columns.sql`](migrations/20260421113000_add_jobs_lat_lng_columns.sql)), auto-assign and ranking ([`lib/actions/jobs.ts`](../lib/actions/jobs.ts), [`lib/jobs/worker-skill-match.ts`](../lib/jobs/worker-skill-match.ts)).
- **Junction pattern precedent:** `worker_tenants` schema ([`migrations/schema.sql`](migrations/schema.sql)).
- **Worker push pipeline** for assignment events ([`sendJobAssignedPushToWorker`](../lib/services/worker-push.ts)) - works per **owning** tenant + worker.
- **Dashboard patterns** for lists, filters, URL state ([`jobs-table`](../components/jobs/jobs-table.tsx)), reusable job UI components for extension.

---

## 7. WHAT IS MISSING ENTIRELY

- **Tenant-to-tenant relationship** tables, APIs, and UI (connections, invites, trust graph).
- **Cross-tenant job dispatch** and **originating-tenant read model** (queries, types, pages).
- **RLS (in repo)** for `jobs`/attachments beyond implicit assumptions; explicit originator read policies.
- **Realtime or polling** for live cross-tenant updates on the dashboard.
- **Mobile app** implementation (not in repo) - worker UX "no change" still depends on receiver tenant's existing assignment flows.
