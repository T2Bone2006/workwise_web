# WorkWise: Vision, Architecture & Roadmap

WorkWise is an **AI-powered job management and marketplace platform** for trade businesses. The platform comprises three interconnected products that build on each other from Phase 1 through Phase 4.

---

## Product Overview

| Product | Phase | Audience | Focus |
|--------|-------|----------|--------|
| **B2B Job Management** | 1–2 | Locksmith companies | Subcontractor + job management, quotes, invoices |
| **Solo Tradesperson Network** | 3 | Independent workers | Marketplace presence, B2C jobs, direct payments |
| **B2C Consumer App** | 4 | Homeowners | Book tradespeople, compare quotes, pay via platform |

---

## PRODUCT 1: B2B Job Management (Current Focus)

For locksmith companies managing subcontractors.

### Core Features (Built – Phase 1)

- **Job management** — Create, assign, track, complete jobs
- **Worker management** — Skills and availability
- **Customer management** — Bulk clients + individuals
- **CSV import** — AI column mapping and saved mappings
- **Skills-based auto-assignment** — Distance + availability + skills
- **AI skill detection** — From job descriptions
- **Job status tracking** — With history/audit trail
- **Glassmorphic UI** — Modern, responsive design

### Phase 2 Features (Next 4–6 weeks)

- **Worker AI Interview System (VAPI voice calls)**
  - SMS invitation to new workers
  - ~5-min voice interview: pricing, skills, availability
  - Structured data extraction → `workers.pricing_data`
  - Cost: ~£1.25 per worker, one-time

- **AI Quote Generation (Claude API)**
  - Auto-generate customer quotes from worker pricing + job requirements
  - Company markup stored in tenant settings
  - Formula: worker cost × markup = customer quote
  - Cost: ~$0.008 per quote

- **Automated Quote-to-Invoice Flow**
  - CSV import → auto-assign → AI quote → send to customer
  - Customer accepts → job assigned → worker notified
  - Job completed → auto-invoice → sync to Xero
  - Target: zero manual intervention after testing

- **Xero Integration**
  - OAuth connection
  - Push invoices automatically
  - Sync customer data
  - Track payment status
  - Two-way sync for customer records

### B2B Pricing Model

- **Setup:** £2,500 (includes 200 worker onboarding + training)
- **Monthly:** £700/month locked forever (early adopters)
- All future features included
- Unlimited users
- Unlimited jobs

### B2B Value Proposition

- Replaces manual Excel allocation (saves 10–15 hours/week)
- Replaces Tradify (saves ~£1,200/year)
- AI features Tradify doesn’t offer
- Faster emergency response → more revenue

---

## PRODUCT 2: Solo Tradesperson Network (Phase 3 – Future)

Workers can operate independently on the platform.

### Worker Types

| Type | Description |
|------|-------------|
| `company_subcontractor` | Only works for locksmith companies (B2B) |
| `platform_solo` | Independent worker taking B2C jobs |
| `both` | Mix of B2B company work + B2C direct customers |

### Features

- Workers set own pricing via AI interview
- Workers visible in marketplace (public directory)
- Accept/reject B2C job offers
- Receive payment directly via Stripe
- Ratings and reviews
- Can work for multiple companies

### Revenue Model

- Transaction fee on B2C jobs (15–20% of job value)
- Optional subscription for premium features (e.g. priority listings)

---

## PRODUCT 3: B2C Consumer App (Phase 4 – Future)

Direct-to-consumer job marketplace.

### Consumer Flow

1. Homeowner needs locksmith
2. Submits job request (address, description, photos)
3. AI detects required skills
4. Algorithm finds 3 best workers (nearest + highest rated + skills match)
5. AI generates quote per worker (using their pricing)
6. Consumer sees 3 options with profiles/ratings
7. Consumer picks worker
8. Worker notified via app
9. Job completed
10. Consumer pays via Stripe
11. Platform takes 15–20% fee
12. Worker receives 80–85%

### Features

- Real-time worker availability
- Live job tracking (worker ETA)
- In-app messaging
- Photo uploads
- Review system
- Saved workers (favorites)
- Emergency “urgent” jobs (higher fees)

---

## Technical Architecture

### Database (Supabase PostgreSQL)

- **Multi-tenancy:** `tenant_id` on all tenant-scoped tables
- **Row-Level Security (RLS)** for data isolation
- **JSONB** for flexible data: skills, `pricing_data`, settings
- **GIN indexes** for fast JSONB queries

### Key Tables

| Table | Purpose |
|-------|---------|
| `tenants` | Companies using the platform |
| `users` | Admin users per tenant |
| `workers` | All workers (company + solo) |
| `customers` | B2B bulk clients + B2C individuals |
| `jobs` | All job records |
| `job_status_history` | Audit trail |
| `import_sources` | Saved CSV mappings |
| `quotes` | Generated quotes (future) |
| `invoices` | Invoice records (future) |
| `payments` | Payment tracking (future) |

### AI Services

- **Anthropic Claude API** — Quote generation, skill detection
- **VAPI** — Voice interviews for worker onboarding
- **Typical cost:** ~£50–100/month

### Integrations

- **Xero** — Accounting sync
- **Stripe** — Payment processing (B2C)
- **Twilio** — SMS notifications (optional)
- **Firebase** — Push notifications (mobile)

### Frontend

- **Next.js 16** (App Router)
- **Tailwind v4**
- Glassmorphic design system
- **shadcn/ui** components
- **React Hook Form** + **Zod** validation

### Mobile

- **React Native (Expo)**
- Worker app for job management
- Consumer app for booking (future)

---

## How Phases Build the Full Platform

```
Phase 1 (B2B core)     →  Phase 2 (automation)  →  Phase 3 (solo network)  →  Phase 4 (B2C)
─────────────────────────────────────────────────────────────────────────────────────────
Jobs, workers,         Worker AI interview,     Workers go solo,          Consumers book
customers, CSV,        AI quotes, Xero,         marketplace directory,    workers, pay via
auto-assign, skills    quote→invoice flow      Stripe payouts             Stripe, platform fee
```

- **Phase 1** delivers the B2B job management core (jobs, workers, customers, AI assignment, CSV import).
- **Phase 2** adds automation (VAPI interviews, AI quotes, Xero, quote-to-invoice) so B2B runs with minimal manual work.
- **Phase 3** reuses workers and pricing data to power a **solo tradesperson network** and marketplace directory.
- **Phase 4** reuses the same workers, skills, and pricing to power the **B2C consumer app** and transaction fees.

Shared foundations: same DB (workers, jobs, skills, pricing), same AI (quotes, skills), same design system and auth.

---

## Competitive Advantages

### vs Tradify

- AI-powered quote generation (vs line-item only)
- Intelligent auto-assignment by skills + distance (vs manual)
- AI CSV import with saved mappings (vs basic import)
- Voice AI for worker onboarding (they have nothing)
- Future: emergency voice AI line
- Unlimited users (they charge per seat)
- Modern UI (theirs is dated)

### vs Fieldwire / ServiceTitan

- Built for locksmiths/trades (not generic construction)
- AI features throughout
- Lower price point
- Faster to deploy

### vs Marketplace Apps (TaskRabbit, etc.)

- Trade-specific (verified locksmiths, not general handymen)
- B2B + B2C in one platform
- Companies manage own workers + access marketplace
- Better fit for emergency/urgent work

---

## Growth Strategy

| Phase | Timeline | Focus | Target |
|-------|----------|--------|--------|
| **Phase 1** | Current – 6 weeks | First locksmith client (120 workers, ~500 jobs/month), prove ROI | 1 client, £8.4K ARR |
| **Phase 2** | Months 2–4 | 5 more locksmiths, worker AI interview, Xero, automation | 6 clients, £50K ARR |
| **Phase 3** | Months 5–8 | Solo tradesperson network, 50 independent workers, marketplace | 10 clients + 50 solos, £100K ARR |
| **Phase 4** | Months 9–12 | Consumer app, homeowners, transaction fees | £200K ARR (B2B + fees) |
| **Year 2** | Months 13–24 | Other trades, new geographies, enterprise | £500K–1M ARR |

---

## Data Strategy

Every interaction generates training data:

- **Worker interviews** → pricing patterns by location/skill
- **Job descriptions** → skill classification
- **Quote acceptance rates** → pricing optimization
- **Customer feedback** → quality signals
- **Worker performance** → rating algorithms

This data improves WorkWise over time and creates a moat.

---

## Current Status

### Built (Phase 1 – 100% complete, February 2026)

- **Authentication** + multi-tenancy with RLS
- **Jobs management** — create, list, detail, status tracking with history
- **AI skill detection** from job descriptions (Claude API, ~$0.005/job)
- **Skills-based auto-assignment** — distance + availability + skills matching
- **Workers management** — 100 seeded workers with skills, availability, postcodes
- **Customers management** — bulk clients + individuals
- **CSV import** with AI column mapping + saved mappings (one-time AI cost, reusable)
- **Dashboard overview** — KPIs, revenue chart, job distribution pie chart, top workers, activity feed, quick actions
- **Settings page** — company info, pricing margins, integrations, notifications, user profile
- **Glassmorphic premium UI** — fully responsive, dark/light mode

Phase 1 complete. Ready to begin Phase 2: Worker AI Interview System, AI Quote Generation, Xero Integration, Automated Quote-to-Invoice Flow.

### Next (Phase 2 – 4–6 weeks)

- Worker AI interview system (VAPI)
- AI quote generation (Claude)
- Xero integration (OAuth + invoice sync)
- Automated quote-to-invoice flow
- React Native mobile app for workers

### Tech Stack

- **Next.js 16** + TypeScript
- **Supabase** (PostgreSQL, Auth, Storage)
- **Tailwind v4**
- **shadcn/ui**
- **Anthropic Claude API**
- **VAPI**
- **React Native (Expo)**

---

*Last updated: February 2025*
