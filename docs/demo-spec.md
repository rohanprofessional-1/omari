# Omari Demo Spec — End-to-End Referral Flow

## Overview

This document describes the three views that comprise the Omari demo, how they
connect through the backend, and where the Omari AI intake (the "Orb") is
embedded in the flow.

The demo showcases one continuous workflow:

```
PCP sends referral in Epic → Omari intercepts & routes → Specialist reviews → Patient sees progress
```

All three perspectives are accessible from the same app via role-based sign-in
(admin/surgeon/patient). No frontend-only fixtures are required — the backend
owns the data and the routing decision.

---

## The 3 Demo Views

### View 1: Patient Intake (Omari Orb)

**Route:** `/patient/intake`
**Component:** `OrbExperience` wrapping `Runner`
**Role:** Patient (sign in as `marla.testfield@example.com`)

**What it demonstrates:**
- The patient opens a conversational AI intake powered by the Omari Orb.
- Omari asks clinically-grounded questions derived from the Duke Nerve Center
  decision tree (urgentRedFlag → presentationCategory → laterality → etc.).
- The patient answers in natural language; the LLM extracts structured variable
  values which the deterministic engine uses to route.
- When routing completes, the frontend POSTs a real referral to
  `POST /api/v1/referrals` with the patient's identity (name, MRN from their
  auth session) and the full extraction payload.
- The backend routing engine runs automatically, resolves the specialist, and
  sets `status = needs_review`.

**Embedding architecture:**
- The Orb is the patient-facing skin of the `Runner` component (same state
  machine, different presentation layer).
- `Runner.tsx` holds the conversation engine, calls backend `/runner/extract`
  and `/runner/voice` for NLU + warm phrasing.
- On route completion, `createReferral()` fires with the signed-in patient's
  real MRN, connecting their intake to their status view.

**Key files:**
- `frontend/src/pages/Runner.tsx` — conversation engine + referral POST
- `frontend/src/components/OrbExperience.tsx` — the visual Orb shell
- `frontend/src/lib/engine.ts` — deterministic tree walker (client-side)
- `backend/app/api/v1/runner.py` — AI utility endpoints (extract, phrase, voice)
- `backend/app/api/v1/referrals.py` — POST creates referral + auto-routes

---

### View 2: Specialist Review (Surgeon Dashboard)

**Route:** `/surgeon/referrals/cases` (queue) and `/surgeon/referrals/:id` (detail)
**Components:** `QueueScreen`, `DetailScreen`, `ActionBar`
**Role:** Surgeon (sign in as `e.saltzman@dukenerve.org` or `n.li@dukenerve.org`)

**What it demonstrates:**
- The surgeon sees only referrals routed to them (backend filters by
  `specialist_id` on `GET /api/v1/referrals`).
- Each referral card shows: patient name, referring provider, channel badge
  (Epic/fax/phone), priority, confidence score, and the AI's routing reason.
- Clicking into a referral opens the full detail: incoming packet (clinical
  note, attachments, diagnoses), the decision chain (which tree nodes fired),
  and the required workup checklist.
- The surgeon can:
  - **Approve** (keyboard shortcut: `a`) — confirms the routing.
  - **Correct** — re-route to a different specialist.
  - **Reject** — mark as out-of-scope.
  - **Escalate** — flag for multidisciplinary review.
- Every action persists to the backend via `PATCH /api/v1/referrals/:id`
  (wired through `reviewStore.applyAction` → `updateReferral`).
- The status change is visible to other roles immediately on their next fetch.

**Embedding architecture:**
- The dashboard fetches live data from the backend through `LiveEpicSource`
  (in `adapter.ts`), which calls `GET /api/v1/referrals`.
- `deriveTreeResult()` replays the tree engine client-side for the audited
  decision chain visualization — the routing DECISION comes from the backend,
  but the step-by-step path explanation is rendered locally for full
  transparency.
- Review actions are optimistic: localStorage updates instantly (no loading
  spinner), then the PATCH fires in the background.

**Key files:**
- `frontend/src/dashboard/components/queue/QueueScreen.tsx` — referral queue
- `frontend/src/dashboard/components/detail/DetailScreen.tsx` — full packet
- `frontend/src/dashboard/components/detail/ActionBar.tsx` — approve/reject bar
- `frontend/src/dashboard/lib/reviewStore.ts` — action handler + backend PATCH
- `frontend/src/dashboard/data/adapter.ts` — LiveEpicSource (backend fetch)
- `backend/app/api/v1/referrals.py` — GET (scoped list) + PATCH (status update)

---

### View 3: Patient Status (My Referral)

**Route:** `/patient/status` and `/patient/appointments`
**Components:** `MyReferralScreen`, `AppointmentsScreen`
**Role:** Patient (same sign-in as View 1)

**What it demonstrates:**
- After the surgeon approves the referral (View 2), the patient's status view
  updates to show progress.
- The journey timeline shows: Referral received → Analyzed by Omari → Under
  specialist review → Approved (or: Scheduled).
- Once approved, the workup checklist appears: what tests to book, what's
  outstanding, and appointment slots for the consultation.
- The status gate reads from the backend: if `backendStatus === 'reviewed'`,
  the patient sees the approval even if they're on a different device than the
  surgeon who approved it.

**Embedding architecture:**
- `usePatientReferral` hook fetches via `LiveEpicSource` (same backend call,
  scoped by MRN).
- Status logic checks localStorage first (instant optimistic feedback if the
  patient approved on the same device), then falls back to `backendStatus`
  from the fetched referral for cross-device propagation.
- The care plan and journey are derived from the referral's workup items and
  the review timestamp.

**Key files:**
- `frontend/src/pages/patient/MyReferralScreen.tsx` — status + journey
- `frontend/src/pages/patient/AppointmentsScreen.tsx` — booking cards
- `frontend/src/pages/patient/usePatientReferral.ts` — data hook (backend + fallback)
- `frontend/src/pages/patient/carePlan.ts` — derives what's bookable

---

## Demo Flow (Step by Step)

### Setup
1. Run `python alembic/seed.py` (backend) — seeds clinic, tree, specialists,
   users, 5 referrals with attachments.
2. Start the backend: `uvicorn app.main:app --reload`
3. Start the frontend: `npm run dev`

### Act 1: PCP Sends a Referral (pre-seeded)
- The 5 seeded referrals simulate PCP-originated referrals that Omari has
  already intercepted and routed. They are ready in the surgeon's queue.

### Act 2: Surgeon Reviews
1. Sign in as **Dr. Saltzman** (`e.saltzman@dukenerve.org` / `omari`).
2. Navigate to `/surgeon/referrals/cases` — see 2 referrals (Marla CTS, Diane cubital).
3. Click into Marla's referral — view the full packet, decision chain, workup.
4. Press `a` to approve. The status updates locally and PATCHes to the backend.

### Act 3: Patient Sees Progress
1. Sign in as **Marla Testfield** (`marla.testfield@example.com` / `omari`).
2. Navigate to `/patient/status` — the referral shows as "Approved" because the
   backend status is now `reviewed` (from Act 2's PATCH).
3. The workup checklist and consultation booking are now visible.

### Act 4: Live Intake (Optional)
1. Sign in as **Marla** again, navigate to `/patient/intake`.
2. Walk through the Orb conversation. At the end, a NEW referral is created
   in the backend with Marla's real MRN.
3. Sign in as a surgeon — the new referral appears in their queue.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                       Frontend (React)                        │
├──────────────┬───────────────────────┬──────────────────────┤
│ Patient Orb  │  Surgeon Dashboard    │  Patient Status       │
│ (Runner.tsx) │  (QueueScreen +       │  (MyReferralScreen)   │
│              │   DetailScreen)       │                       │
├──────────────┴───────────────────────┴──────────────────────┤
│                    LiveEpicSource (adapter.ts)                │
│              GET /referrals  |  PATCH /referrals/:id         │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP
┌──────────────────────────────┴──────────────────────────────┐
│                     Backend (FastAPI)                         │
├─────────────────────────────────────────────────────────────┤
│  POST /referrals ──→ routing_engine.py ──→ specialist FK     │
│  GET  /referrals ──→ scoped by user role / specialist_id     │
│  PATCH /referrals/:id ──→ status + corrections + audit       │
│  POST /runner/* ──→ Anthropic (extract, phrase, voice)        │
├─────────────────────────────────────────────────────────────┤
│                     PostgreSQL                                │
│  clinics | trees | nodes | branches | conditions | specialists│
│  patients | referrals | attachments | referring_providers     │
│  users | conversations                                        │
└─────────────────────────────────────────────────────────────┘
```

---

## Seeded Demo Data

| # | Patient | Referral | Route | Status | Specialist |
|---|---------|----------|-------|--------|------------|
| 1 | Marla Testfield | REF-2026-0142 | CTS, wrist | needs_review | Dr. Saltzman |
| 2 | Robert Nulligan | REF-2026-0147 | Ulnar, incomplete | needs_review | Neuromuscular |
| 3 | James Whitford | REF-2026-0163 | Brachial plexus | needs_review | Dr. Li |
| 4 | Angela Vasquez | REF-2026-0158 | Acute trauma | needs_review (escalated) | None |
| 5 | Diane Chowdhury | REF-2026-0171 | Cubital tunnel | needs_review | Dr. Saltzman |

---

## What's NOT in this demo (future work)

- **Epic FHIR integration** — referrals are created via API, not via real Epic webhook.
- **Backend conversation persistence** — the intake conversation state machine lives in the frontend; only the final referral is persisted server-side.
- **Real authentication** — demo uses a shared password (`omari`) with no JWT expiration.
- **Appointment booking persistence** — bookings are localStorage only.
- **Real-time updates** — no WebSocket; the patient sees approval on their next page load/fetch.
