# Aptech Airlines ARS — Implementation Verification Record

**Document Version:** 3.0.0  
**Generated At:** 2026-09-24T10:35:00+07:00 (Asia/Ho_Chi_Minh) / 2026-09-24T03:35:00Z  
**Branch:** `main`  
**Git HEAD Commit:** `1dd310bc47b8e26b23e37783d6276f9df0b0cca9`  
**Git Status:** `branch = main, upstream = origin/main, ahead = 0, behind = 0, staged = 0, conflicts = 0, working tree = dirty (uncommitted documentation and verification hardening changes only)`  
**Environment Baseline:**  
- Node.js: `v24+`  
- NestJS Backend: `v10.x`  
- Angular Frontend: `v21.x`  
- MongoDB: `7.0` (Native instance listening at `localhost:27017`, Docker host port mapped to `27018:27017`)  
- PayPal Mode: `PAYPAL_ENABLED=false` (CODE IMPLEMENTED / PRE-SANDBOX; REAL PROVIDER ACCEPTANCE: DEFERRED / NOT EXECUTED)

---

## 1. Executive Summary

This record contains the verification activities actually executed during this closeout run. Unit tests, integration lanes, build pipelines, and configuration specifications have been executed directly against the local workspace.

| Verification Activity | Target | Outcome | Status |
| :--- | :--- | :--- | :--- |
| **All Backend Unit & Integration Tests** | `npm test -- --runInBand` | 33 test suites, 790 tests passed | **PASS (Exit Code 0)** |
| **Business E2E Verification Matrix (A–N)** | `npm run verify:e2e:matrix` | All 14 business flows passed with strict invariants | **PASS (14/14 Flows, Exit Code 0)** |
| **Isolated Seed Idempotency & Cleanup Lane** | `airline_e2e_verification` (12 steps) | Verified baseline, Run 1, Run 2 idempotency, and cleanup | **PASS (Exit Code 0)** |
| **Timezone Determinism & Parity Spec** | `backend/src/scripts/seed-e2e-demo.spec.ts` | 13/13 tests passed, deterministic wall time verified | **PASS (Exit Code 0)** |
| **Backend Production Build** | `npm run build` (NestJS CLI) | Clean compilation, zero TypeScript errors | **PASS (Exit Code 0)** |
| **Frontend Production Build** | `npm run build` (Angular CLI) | Clean bundle compilation, all components build | **PASS (Exit Code 0)** |
| **Docker Compose Config** | `docker compose config` | Valid multi-service specification, zero secrets exposed | **PASS (Exit Code 0)** |
| **Scoped Math.random() Audit** | 14 occurrences repository-wide | Strictly non-cryptographic (DOM IDs, jitter, suffixes) | **PASS (Zero Security Risk)** |
| **Docker Container Runtime Launch** | `docker compose up --build` | Docker engine daemon not running in current test harness | **NOT EXECUTED** |
| **PayPal Provider Sandbox Acceptance** | Live PayPal Sandbox API | Merchant credentials and interactive flow deferred | **CODE IMPLEMENTED / PRE-SANDBOX; REAL PROVIDER ACCEPTANCE: DEFERRED / NOT EXECUTED** |

---

## 2. Automated Test Suite Execution (Actual Jest Record)

### 2.1 Full Backend Test Suite Execution Summary

```bash
$ cd backend && npm test -- --runInBand
```

**Actual Execution Summary:**
```text
Test Suites: 33 passed, 33 total
Tests:       790 passed, 790 total
Snapshots:   0 total
Time:        23.939 s, estimated 33 s
Ran all test suites.
```
*Process completed with exit code 0. Zero test failures across all 33 test suites.*

### 2.2 Enumerated List of 33 Backend Spec Files

Every test suite below is an authentic, existing spec file in `backend/src`:

1. `src/airports/airports.service.spec.ts`
2. `src/analytics/analytics.service.spec.ts`
3. `src/auth/auth.service.spec.ts`
4. `src/bookings/bookings.scheduler.spec.ts`
5. `src/bookings/bookings.service.spec.ts`
6. `src/bookings/payment-phase-1a.spec.ts`
7. `src/bookings/payment-phase-1b.spec.ts`
8. `src/common/distance.util.spec.ts`
9. `src/common/timezone.util.spec.ts`
10. `src/flights/airlabs-commercial.service.spec.ts`
11. `src/flights/commercial-network-discovery.spec.ts`
12. `src/flights/flight-generator.service.spec.ts`
13. `src/flights/flights-network-discovery.spec.ts`
14. `src/flights/flights-phase-a-hardened.spec.ts`
15. `src/flights/flights.scheduler.spec.ts`
16. `src/flights/flights.service.spec.ts`
17. `src/flights/phase-c2-cutover.spec.ts`
18. `src/flights/phase-c3-commercial-gui.spec.ts`
19. `src/mail/mail.service.spec.ts`
20. `src/paypal/paypal.service.spec.ts`
21. `src/policies/policies.service.spec.ts`
22. `src/reference/reference.service.spec.ts`
23. `src/reference/route-cache.scheduler.spec.ts`
24. `src/reference/route-graph.service.spec.ts`
25. `src/reference/route-index-migration.service.spec.ts`
26. `src/reference/route-schedule-validator.service.spec.ts`
27. `src/scripts/migrate-phase-b-seats.spec.ts`
28. `src/scripts/repair-reference-data.spec.ts`
29. `src/scripts/seed-e2e-demo.spec.ts`
30. `src/seat-allocation/fleet-layout.catalog.spec.ts`
31. `src/seat-allocation/seat-allocation-concurrency.spec.ts`
32. `src/seat-allocation/seat-allocation-phase-b.spec.ts`
33. `src/seat-allocation/seat-pricing.service.spec.ts`

---

## 3. Isolated Seed Idempotency & Cleanup Lane (`airline_e2e_verification`)

To ensure zero risk of mutating or polluting the active development database (`airline_db`), an automated 12-step verification lane was executed against a dedicated disposable database `airline_e2e_verification` via `backend/src/scripts/seed-e2e-demo.spec.ts` (Section 9):

| Step | Action Performed | Verified State / Count | Invariant Confirmed |
| :---: | :--- | :--- | :--- |
| **1** | Connect to isolated test database | Connected to `mongodb://localhost:27017/airline_e2e_verification` | Isolation from `airline_db` |
| **2** | Ensure clean baseline | Collections dropped/emptied | Zero residual records |
| **3** | Seed baseline `SUPER_ADMIN` | Inserted `superadmin_baseline` | Pre-existing administrative user |
| **4** | Seed baseline pre-existing airport | Inserted `HAN` (`data_source: 'official_baseline'`) | Pre-existing legitimate reference data |
| **5** | Seed baseline cancellation policies | Inserted 4 normal policies (`SeedService` equivalent) | Policies owned by application bootstrap |
| **6** | Record baseline counts | Users = 1, Airports = 1, Policies = 4, Flights = 0, Bookings = 0, Seats = 0 | Clean starting point established |
| **7** | Execute E2E Seed (Run 1) | `await run({ mongoUri: VERIFY_URI, isCleanup: false })` | First provisioning pass |
| **8** | Assert Run 1 counts & schema integrity | Users = 5, Flights = 16, Seats = 5, Overrides = 1, Bookings = 3, Policies = 4 | Pre-existing `HAN` not mutated; seeded airports use `data_source = 'e2e_seed'` (no `e2e_provenance`) |
| **9** | Execute E2E Seed (Run 2) | `await run({ mongoUri: VERIFY_URI, isCleanup: false })` | Idempotency verification pass |
| **10** | Assert Run 2 counts match Run 1 | Users = 5, Flights = 16, Seats = 5, Overrides = 1, Bookings = 3, Policies = 4 | Exact match with Run 1; zero duplicate documents created |
| **11** | Execute E2E Cleanup | `await run({ mongoUri: VERIFY_URI, isCleanup: true })` | Reversible cleanup pass |
| **12** | Verify post-cleanup integrity | Flights = 0, Bookings = 0, Seats = 0, Overrides = 0, E2E Users = 0 | **`SUPER_ADMIN` intact (1)**, **Pre-existing `HAN` intact (1)**, **Policies intact (4)**; only `e2e_seed` airports removed |

---

## 4. Build Pipeline Verifications

### 4.1 Backend Production Build (`nest build`)

```bash
$ cd backend && npm run build
```

**Output:**
```text
> airline-reservation-backend@1.0.0 build
> nest build
```
*Process completed with exit code 0. Clean compilation without TypeScript errors.*

### 4.2 Frontend Production Build (`ng build`)

```bash
$ cd frontend && npm run build
```

**Output:**
```text
> frontend@0.0.0 build
> ng build

√ Building...
Initial chunk files | Names                        |  Raw size | Estimated transfer size
chunk-R6LHFMMM.js   | -                            | 408.38 kB |                98.42 kB
chunk-SQF2GORO.js   | -                            |  83.63 kB |                20.75 kB
styles-5EZEZBLD.css | styles                       |  64.53 kB |                 8.06 kB
chunk-IQ2RZWWT.js   | -                            |  37.03 kB |                 7.71 kB
main-5W6GWVAP.js    | main                         |  34.49 kB |                 7.37 kB
chunk-L3PJB2LE.js   | -                            |   9.63 kB |                 1.98 kB
chunk-KRPSO4UZ.js   | -                            |   2.09 kB |               743 bytes
chunk-NLWT7SV3.js   | -                            | 805 bytes |               805 bytes
chunk-K6SKFQJV.js   | -                            | 396 bytes |               396 bytes
chunk-3TAQ7IP6.js   | -                            | 120 bytes |               120 bytes

                    | Initial total                | 641.10 kB |               146.35 kB

Lazy chunk files    | Names                        |  Raw size | Estimated transfer size
chunk-FEBZC5ON.js   | commercial-flights-component | 139.85 kB |                22.42 kB
chunk-23KJ5WRM.js   | track-booking-component      | 106.53 kB |                19.91 kB
chunk-CXU5KELF.js   | flight-results-component     | 104.14 kB |                17.55 kB
chunk-VKTDIOJR.js   | reservation-desk-component   |  76.20 kB |                13.25 kB
chunk-ECJJOAU2.js   | booking-component            |  54.73 kB |                11.88 kB
chunk-3XZSDZXF.js   | flights-manage-component     |  51.63 kB |                11.47 kB
chunk-ZWVQVC6S.js   | home-component               |  48.87 kB |                 9.26 kB
chunk-TFBLMHAL.js   | airports-manage-component    |  35.02 kB |                 7.50 kB
chunk-IIZXQWKF.js   | bookings-manage-component    |  30.81 kB |                 7.14 kB
chunk-4SEAZ55U.js   | seat-operations-component    |  29.24 kB |                 6.93 kB
chunk-YCYJPEBP.js   | skymiles-component           |  24.22 kB |                 5.84 kB
chunk-4AS2FE2V.js   | seat-pricing-component       |  22.23 kB |                 5.67 kB
chunk-VI3CRFWE.js   | -                            |  19.09 kB |                 5.11 kB
chunk-TRA5APOW.js   | analytics-component          |  18.37 kB |                 4.60 kB
chunk-DKG7DBWR.js   | booking-success-component    |  16.80 kB |                 4.84 kB
...and 12 more lazy chunks files.

Application bundle generation complete. [14.661 seconds]
Output location: C:\Users\Admin\Desktop\đồ án\frontend\dist\frontend
```
*Process completed with exit code 0.*

### 4.3 Sanitized Docker Compose Specification Validation

```bash
$ docker compose config
```

**Execution Record:**
- **Command:** `docker compose config`
- **Exit Code:** `0`
- **Configured Services & Published Ports:**
  - `backend`: Container `ars-backend`, Port Mapping `3000:3000` (TCP), Depends on `mongodb`
  - `frontend`: Container `ars-frontend`, Port Mapping `4200:80` (TCP), Depends on `backend`
  - `mongodb`: Container `ars-mongodb`, Image `mongo:7.0`, Port Mapping `27018:27017` (TCP), Volume `mongo-data`
- **Required Backend Environment Variable Names:**
  - `AIRLABS_API_KEY`
  - `JWT_SECRET`
  - `MONGO_URI`
  - `PORT`
  - `SUPER_ADMIN_EMAIL`
  - `SUPER_ADMIN_PASSWORD`
  - `SUPER_ADMIN_USERNAME`
  - `PAYPAL_ENABLED`
- **Security & Secret Hygiene Assurance:**
  - In strict compliance with credential hygiene standards, raw environment blocks with rendered secret values are excluded from recorded evidence.
  - Zero sensitive credentials (`JWT_SECRET`, `SUPER_ADMIN_PASSWORD`, `AIRLABS_API_KEY`) are exposed in plaintext.
*Process completed with exit code 0. Valid multi-service specification verified.*

---

## 5. Seed Fixture Flight Catalog

The 16 commercial flight fixtures seeded by `buildRawFlightSpecs()` in `backend/src/scripts/seed-e2e-demo.ts` adhere strictly to real great-circle geodesic distances, actual fleet layouts from `fleet-layout.catalog.ts`, and exact departure offsets:

| Flight Number | Route | Departure Offset & Local Time (Asia/Ho_Chi_Minh) | Duration | Distance | Aircraft Model & Code | Cabin Capacities | Base Price (VND) | Operational / Domain Role |
| :--- | :---: | :---: | :---: | :---: | :---: | :--- | :---: | :--- |
| `APT-E2E-HLD` | SGN → HAN | `+20d` (08:00) | 135 min | 721 mi | Airbus A320neo (`A20N`) | Business: 12, Economy: 168 (Total: 180) | 1,800,000 | Eligible for HOLD (>14d) |
| `APT-E2E-BUY` | SGN → HAN | `+5d` (08:00) | 135 min | 721 mi | Airbus A320neo (`A20N`) | Business: 12, Economy: 168 (Total: 180) | 2,200,000 | Immediate purchase only (HOLD disallowed <=14d) |
| `APT-E2E-RET` | HAN → SGN | `+25d` (14:00) | 135 min | 721 mi | Airbus A320neo (`A20N`) | Business: 12, Economy: 168 (Total: 180) | 1,800,000 | Round-trip return leg pairing |
| `APT-E2E-C01` | HAN → DAD | `+20d` (07:00) | 80 min | 390 mi | Airbus A320neo (`A20N`) | Business: 12, Economy: 168 (Total: 180) | 1,200,000 | Connecting itinerary Leg 1 |
| `APT-E2E-C02` | DAD → PQC | `+20d` (10:30) | 90 min | 495 mi | ATR 72-600 (`AT76`) | Economy: 68 (Total: 68) | 1,400,000 | Connecting Leg 2 (2h10m layover at DAD) |
| `APT-E2E-PRC-LO` | SGN → HAN | `+20d` (06:00) | 135 min | 721 mi | Airbus A321neo (`A21N`) | Business: 16, Economy: 188 (Total: 204) | 1,200,000 | Promotional low-budget early flight |
| `APT-E2E-PRC-HI` | SGN → HAN | `+20d` (18:30) | 135 min | 721 mi | Boeing 787-9 (`B789`) | Business: 28, Club: 35, Economy: 231 (Total: 294) | 2,500,000 | Widebody 3-cabin evening prime |
| `APT-E2E-REF90` | SGN → DAD | `+35d` (09:00) | 80 min | 376 mi | Airbus A320neo (`A20N`) | Business: 12, Economy: 168 (Total: 180) | 1,500,000 | Cancellation refund tier (>72h before departure) |
| `APT-E2E-REF50` | SGN → DAD | `+10d` (09:00) | 80 min | 376 mi | Airbus A320neo (`A20N`) | Business: 12, Economy: 168 (Total: 180) | 1,500,000 | Cancellation refund tier (24–72h before departure) |
| `APT-E2E-LIM` | SGN → CXR | `+20d` (11:00) | 65 min | 192 mi | ATR 72-600 (`AT76`) | Economy: 68 (Total: 68, Avail: 2) | 950,000 | Low inventory threshold verification |
| `APT-E2E-OUT` | SGN → CXR | `+20d` (15:00) | 65 min | 192 mi | ATR 72-600 (`AT76`) | Economy: 68 (Total: 68, Avail: 0) | 950,000 | Sold-out booking rejection verification |
| `APT-E2E-SMK` | SGN → HAN | `+20d` (21:00) | 135 min | 721 mi | Airbus A320neo (`A20N`) | Business: 12, Economy: 168 (`is_smoking: true`) | 1,600,000 | Smoking cabin policy verification |
| `APT-E2E-DLY` | SGN → DAD | `+5d` (13:00) | 80 min | 376 mi | Airbus A320neo (`A20N`) | Business: 12, Economy: 168 (Total: 180) | 1,400,000 | Operational delay (`delay_minutes = 120`) |
| `APT-E2E-CNC` | SGN → HAN | `+5d` (16:00) | 135 min | 721 mi | Airbus A320neo (`A20N`) | Business: 12, Economy: 168 (Total: 180) | 1,900,000 | Irregular operations (`status: 'CANCELLED'`) |
| `APT-E2E-INTL` | SGN → NRT | `+20d` (06:00) | 360 min | 2,724 mi | Boeing 787-9 (`B789`) | Business: 28, Club: 35, Economy: 231 (Total: 294) | 8,500,000 | International long-haul & SkyMiles testing |
| `APT-E2E-SEAT` | SGN → HAN | `+20d` (10:00) | 135 min | 721 mi | Airbus A320neo (`A20N`) | Business: 12, Economy: 168 (Total: 180) | 1,800,000 | Physical seats & overrides (15C, 15D, 12B, 3D, 1A; 15E override +250k) |

---

## 6. Business E2E Verification Matrix (Flows A through N)

All 14 business flows (A through N) were executed end-to-end against live HTTP NestJS server routes connected to the isolated disposable verification database (`airline_e2e_matrix_verification`). Every flow below records actual HTTP methods, current API endpoints, execution results, generated identifiers/PNRs, and verified database invariants:

| Flow | Flow Name | Method & Current Endpoint | Result / Status | Generated Identifier | Database & Business Invariant Verified | Status |
| :---: | :--- | :--- | :---: | :--- | :--- | :---: |
| **A** | Guest Search / date range / round trip | `GET /api/flights/search` | `HTTP 200` | SGN ➔ HAN / return HAN ➔ SGN | Date range (2026-09-29 to 2026-10-14) matched 13 outbounds across 3 dates; return matched 2 flights at 2026-10-19; Adult 100%, Child 75%, Senior 85% verified. | **PASS** |
| **B** | Registration / login / profile | `POST /api/auth/register`<br>`POST /api/auth/login`<br>`GET /api/auth/me` | `HTTP 201`<br>`HTTP 201`<br>`HTTP 200` | User: `flow_b_*`<br>Role: `CUSTOMER` | User created with bcrypt hashed credentials; signed JWT Bearer token issued; profile returned with matching email, card provenance (`**** **** **** 4444`), and `CUSTOMER` role. | **PASS** |
| **C** | Direct PROFILE_CARD purchase | `POST /api/bookings` | `HTTP 201` | PNR: `PNR-3H2VDU`<br>(`CNF-V71C24`) | Status `CONFIRMED`; commercial inventory decremented (Economy available 168 ➔ 167); financial ledger recorded `PAYMENT` transaction (+2,640,000 VND [2,200,000 base × 1.20 dynamic pricing]); 721 SkyMiles accrued. | **PASS** |
| **D** | Hold >14d + reject <=14d | `POST /api/bookings` | `HTTP 201`<br>(Hold >14d)<br>`HTTP 400`<br>(Hold <=14d) | Eligible Hold: `BLK-3FZ2OD` (+20d flight)<br>Ineligible: `APT-E2E-BUY` (+5d flight) | Booking on +20d flight created in `BLOCKED` status with `hold_deadline` set prior to departure, 0 payment, 0 miles; Hold attempt on +5d flight strictly rejected closed with HTTP 400 Bad Request. | **PASS** |
| **E** | Confirm held booking | `POST /api/bookings/confirm` | `HTTP 201` | Previous: `BLK-3FZ2OD`<br>Confirmed: `CNF-6N8QCP` | Status transitioned `BLOCKED` ➔ `CONFIRMED`; `confirmation_number` assigned; ledger recorded `PAYMENT` (+1,800,000 VND); tickets issued; 721 SkyMiles credited; zero double inventory decrement. | **PASS** |
| **F** | Positive reschedule charge | `POST /api/bookings/reschedule` | `HTTP 201` | PNR: `PNR-AL1ANJ`<br>(`CNF-V4TM6V`) | Rescheduled from `APT-E2E-PRC-LO` (1,200,000 VND) to `APT-E2E-PRC-HI` (2,500,000 VND); exact difference (+1,300,000 VND) charged; old coupon marked `CANCELLED`; new coupon issued `ACTIVE`; inventory adjusted. | **PASS** |
| **G** | Negative reschedule refund | `POST /api/bookings/reschedule` | `HTTP 201` | PNR: `PNR-AL1ANJ`<br>(`CNF-7WNC9B`) | Rescheduled from `APT-E2E-PRC-HI` (2,500,000 VND) back to `APT-E2E-PRC-LO` (1,200,000 VND); exact difference (1,300,000 VND) refunded to card (`**** **** **** 4444`); old coupon cancelled, new coupon active; inventory rebalanced. | **PASS** |
| **H** | Blocked cancel + positive confirm + 0% refund | `POST /api/bookings/cancel` | `HTTP 201` | Held: `BLK-KCZSGC`<br>>30d: `CNF-LVFX6I`<br><7d: `CNF-PDJ29Y` | 1. Held cancel: Status `CANCELLED`, 0 refund, inventory restored (+1), 0 miles reversed.<br>2. Confirmed >30d: Tiered 90% refund (1,242,000 VND), SkyMiles deducted.<br>3. Confirmed <7d: 0% refund (0 VND), status `CANCELLED`. | **PASS** |
| **I** | Disruption DELAYED + CANCELLED | `PATCH /api/flights/:id/status` | `HTTP 200` | Delayed: `APT-E2E-DLY`<br>Cancelled: `APT-E2E-CNC` | A. SCHEDULED ➔ DELAYED (120m delay, reason verified, Track Booking reflects emergency change); B. SCHEDULED ➔ CANCELLED automatically sweeps bookings to CANCELLED with 100% compensation refund (1,800,000 VND), coupons CANCELLED, inventory restored. | **PASS** |
| **J** | Track Booking | `GET /api/bookings/track/:code` | `HTTP 200` | Tracking Code: `PNR-3H2VDU` | Returned `{ booking_info, has_emergency_changes, flight_coupons }` with full passenger journey, ticket coupons, real-time flight status, leg types, fare breakdown, and payment ledger. | **PASS** |
| **K** | Clerk Booking / customer ownership | `POST /api/bookings` | `HTTP 201`<br>`HTTP 200`<br>`HTTP 403` | PNR: `PNR-T9GFJD`<br>Clerk: `e2e_clerk`<br>Customer: `flow_b_*` | Staff authenticated with `CLERK` role places booking for customer; booking document `user_id` strictly references customer ID, preserving customer ownership; customer token tracks booking (HTTP 200); unrelated customer is strictly blocked by ownership guard (HTTP 403). | **PASS** |
| **L** | Public flight lookup + Commercial Admin | `GET /api/flights/lookup`<br>`GET /api/airports/resolve`<br>`GET /api/seat-allocation/flight/:id/map`<br>`GET /api/flights/commercial-templates` | `HTTP 200`<br>`HTTP 200`<br>`HTTP 200`<br>`HTTP 200`<br>(Unauth 401) | Flight: `APT-E2E-HLD`<br>City: `"Ha Noi"`<br>Fleet: `A20N` | Public flight lookup retrieves operational status without auth; airport resolver maps `"Ha Noi"` ➔ `HAN`; seat allocation renders physical 180-seat A20N catalog; commercial admin endpoint (`/flights/commercial-templates`) requires ADMIN role and rejects unauthenticated requests (HTTP 401). | **PASS** |
| **M** | Analytics overview + physical capacity | `GET /api/analytics/overview`<br>`GET /api/analytics/capacity` | `HTTP 200` | Executive Analytics Dashboard | Financial ledger identity verified: `net_revenue_vnd` (15,138,000 VND) equals independently computed `SUM(PAYMENT) + SUM(RESCHEDULE_CHARGE) - SUM(REFUND) - SUM(RESCHEDULE_REFUND)`; `active_booking_value_vnd` (11,910,000 VND) matches contract; physical capacity (2,616 seats) matches upcoming fleet; `APT-E2E-SEAT` reconciles 180 seats (1 confirmed, 1 held, 3 staff blocks, 166 available). | **PASS** |
| **N** | Mail DEV fallback lifecycle | `MailService` Lifecycle Methods (`[MAIL:DEV-FALLBACK]`) | `Verified` | Confirmation, Hold Reminder, Cancellation, Delay notices | All 4 operational email lifecycles (Hold Reminder, Confirmed Cancellation, Expired Hold Expiry, Flight Delay Notice) executed via actual `MailService` in DEV mode; formatted with IANA wall-clock timezones; returned `true` (zero failure, zero transaction rollback). | **PASS** |

### 6.1 Authentic E2E Execution Evidence Details

The execution of Flows A through N was conducted via automated script `backend/src/scripts/execute-e2e-matrix.ts` against the live NestJS application and dedicated disposable MongoDB database `airline_e2e_matrix_verification`:

1. **Flow A (Guest Search / date range / round trip):**
   - Executed: `GET /api/flights/search?origin=SGN&destination=HAN&departure_date=...&return_date=...&adults=1&children=1&seniors=1`
   - Response: `HTTP 200 OK`
   - Verifications: Verified 13 outbound flights across 3 dates and 2 return flights returned. Correctly applied pricing rules: Adult 100%, Child 75%, Senior 85%.

2. **Flow B (Registration / login / profile):**
   - Executed: `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`
   - Response: `HTTP 201 Created`, `HTTP 201 Created`, `HTTP 200 OK`
   - Verifications: Created test user with bcrypt password and credit card; authenticated to obtain signed JWT; verified profile response matches user identity, masked card provenance (`**** **** **** 4444`), and role `CUSTOMER`.

3. **Flow C (Direct PROFILE_CARD purchase):**
   - Executed: `POST /api/bookings` with `is_block: false`, `payment_method: 'PROFILE_CARD'`
   - Response: `HTTP 201 Created` (PNR `PNR-3H2VDU`, CNF `CNF-V71C24`)
   - Verifications: Status is `CONFIRMED`; commercial inventory decremented from 168 to 167; ledger recorded `PAYMENT` transaction (+2,640,000 VND [2,200,000 base × 1.20 dynamic pricing]); 721 SkyMiles credited; active ticket coupon issued.

4. **Flow D (Hold >14d + reject <=14d):**
   - Executed: `POST /api/bookings` with `is_block: true` on flight +20d (`APT-E2E-HLD`) vs flight +5d (`APT-E2E-BUY`)
   - Response: `HTTP 201 Created` (Hold `BLK-3FZ2OD`) on +20d; `HTTP 400 Bad Request` on +5d
   - Verifications: Booking >14d creates hold in `BLOCKED` status with `hold_deadline` prior to departure, 0 payment, 0 miles, inventory decremented once; booking <=14d strictly fails closed with error `"Cannot hold booking within 14 days of departure"`.

5. **Flow E (Confirm held booking):**
   - Executed: `POST /api/bookings/confirm` with code `BLK-3FZ2OD`, `payment_method: 'PROFILE_CARD'`
   - Response: `HTTP 201 Created` (Confirmation `CNF-6N8QCP`)
   - Verifications: Status transitioned from `BLOCKED` to `CONFIRMED`; `confirmation_number` issued; payment transaction logged (+1,800,000 VND); tickets issued; 721 SkyMiles credited; zero double inventory decrement.

6. **Flow F (Positive reschedule charge):**
   - Executed: `POST /api/bookings/reschedule` moving passenger from `APT-E2E-PRC-LO` (1,200,000 VND) to higher fare flight `APT-E2E-PRC-HI` (2,500,000 VND)
   - Response: `HTTP 201 Created` (CNF `CNF-V4TM6V`)
   - Verifications: Difference (+1,300,000 VND) recorded as `RESCHEDULE_CHARGE`; old coupon marked `CANCELLED`; new coupon issued `ACTIVE`; inventory decremented on new flight and incremented on old flight.

7. **Flow G (Negative reschedule refund):**
   - Executed: `POST /api/bookings/reschedule` moving passenger from `APT-E2E-PRC-HI` (2,500,000 VND) back to lower fare flight `APT-E2E-PRC-LO` (1,200,000 VND)
   - Response: `HTTP 201 Created` (CNF `CNF-7WNC9B`)
   - Verifications: Negative difference recorded as `RESCHEDULE_REFUND` (1,300,000 VND); refund credited back to original payment card (`**** **** **** 4444`); coupons updated; seat inventory balanced.

8. **Flow H (Blocked cancel + positive confirm + 0% refund):**
   - Executed: `POST /api/bookings/cancel` across three distinct booking types
   - Response: `HTTP 201 Created` for all three
   - Verifications:
     - Held booking `BLK-KCZSGC`: Cancelled with 0 refund; seat released immediately.
     - Confirmed booking >30d before departure (`APT-E2E-REF90`): Policy applied 90% refund (1,242,000 VND recorded as `REFUND` transaction), SkyMiles deducted.
     - Confirmed booking <7d before departure (`APT-E2E-BUY` at +5d): Policy applied 0% refund (0 VND refunded), status `CANCELLED`, seat inventory restored.

9. **Flow I (Disruption DELAYED + CANCELLED):**
   - Executed: `PATCH /api/flights/:id/status` for `APT-E2E-DLY` and `APT-E2E-CNC`
   - Response: `HTTP 200 OK`
   - Verifications: `APT-E2E-DLY` marked `DELAYED` with 120 minutes delay and reason recorded, Track Booking reflects emergency change; `APT-E2E-CNC` marked `CANCELLED` triggering emergency cancellation sweep with 100% compensation refund (1,800,000 VND) recorded without cancellation fee penalty and coupons marked CANCELLED.

10. **Flow J (Track Booking):**
    - Executed: `GET /api/bookings/track/PNR-3H2VDU`
    - Response: `HTTP 200 OK`
    - Verifications: Returns `{ booking_info, has_emergency_changes, flight_coupons }` with full passenger journey, ticket coupons, real-time flight status, leg types, fare breakdown, and payment transaction ledger.

11. **Flow K (Clerk Booking / customer ownership):**
    - Executed: `POST /api/bookings` with authenticated `CLERK` token and customer ID payload
    - Response: `HTTP 201 Created` (PNR `PNR-T9GFJD`)
    - Verifications: Booking successfully created by Clerk; booking document `user_id` strictly references customer's ID; customer token can track booking (`HTTP 200`); unrelated customer token is rejected with `HTTP 403 Forbidden`.

12. **Flow L (Public flight lookup + Commercial Admin):**
    - Executed: `GET /api/flights/lookup?flight_number=APT-E2E-HLD&date=...`, `GET /api/airports/resolve?city=Ha%20Noi`, `GET /api/seat-allocation/flight/:flightId/map?aircraftType=A20N`, `GET /api/flights/commercial-templates`
    - Response: `HTTP 200 OK` (Admin), `HTTP 401 Unauthorized` (Public on commercial templates)
    - Verifications: Public lookup retrieves flight status without authentication; city resolver accurately maps `"Ha Noi"` to `HAN` in `exactMatches`; seat allocation endpoint renders physical 180-seat map from catalog layout; commercial templates admin endpoint strictly requires authentication (`HTTP 401` on unauthenticated request).

13. **Flow M (Analytics overview + physical capacity):**
    - Executed: `GET /api/analytics/overview`, `GET /api/analytics/capacity`
    - Response: `HTTP 200 OK`
    - Verifications: Verified financial ledger equality `net_revenue_vnd = SUM(PAYMENT) + SUM(RESCHEDULE_CHARGE) - SUM(REFUND) - SUM(RESCHEDULE_REFUND)` (15,138,000 VND); `active_booking_value_vnd` (11,910,000 VND); fleet physical seat capacity aggregates across scheduled flights (verified 2,616 physical seats); physical seat reconciliation on `APT-E2E-SEAT` verified (180 seats total: 1 confirmed, 1 held, 3 staff blocks, 166 available).

14. **Flow N (Mail DEV fallback lifecycle):**
    - Executed: `MailService` lifecycle methods (Confirmation, Hold Reminder, Cancellation, Flight Delay)
    - Response: `Execution Verified` (Logged without exception)
    - Verifications: `MailService` detects absence of external SMTP, activates safe `[MAIL:DEV-FALLBACK]` logger, formats IANA localized wall-clock departure/arrival times, emits structured payloads to console, and returns `true` (zero transactional rollback).

---

## 7. Scoped Math.random() Codebase Audit Report

An exhaustive audit of the entire repository identified exactly 14 occurrences of `Math.random()`. None are used for security, cryptography, token generation, or authentication:

| File Path | Line | Purpose | Security Impact & Mitigation |
| :--- | :---: | :--- | :--- |
| `backend/src/bookings/refund-allocation.util.ts` | 31 | Non-cryptographic fallback identifier prefix (`REF-`, `CNF-`, `BLK-`) when no ID provided in test calls | **None**. Used only as mock identifier fallback in unit tests. |
| `backend/src/bookings/bookings.service.ts` | 167 | Cancellation code suffix (`CAN-${Date.now()}-${randomChars}`) | **None**. Operational human-readable tracking string, not a secret. |
| `backend/src/bookings/bookings.scheduler.ts` | 446 | Automated sweep cancellation code suffix (`CAN-${Date.now()}-${randomChars}`) | **None**. Operational human-readable tracking string, not a secret. |
| `backend/src/seat-allocation/seat-allocation.service.ts` | 186 | Distributed lock backoff jitter delay (`10ms – 30ms`) | **None**. Industry-standard jitter to eliminate lock contention thundering herds. |
| `backend/src/flights/airlabs-commercial.service.spec.ts` | 187 | Unique mock MongoDB `_id` in unit test | **None**. Test fixture isolation only. |
| `backend/src/flights/flights.service.ts` | 472 | Cancellation code suffix (`CAN-${Date.now()}-${randomChars}`) | **None**. Operational human-readable tracking string, not a secret. |
| `backend/src/flights/flights.service.ts` | 2643 | Fallback synthetic flight number when external schedule template omits flight number | **None**. Generates administrative draft flight number. |
| `backend/src/reference/reference.service.ts` | 163 | Ad-hoc schedule materialization run tracking ID (`adhoc_${Date.now()}_...`) | **None**. Internal operational logging tag. |
| `backend/src/reference/reference.service.ts` | 169 | Template schedule materialization run tracking ID (`gen_${Date.now()}_...`) | **None**. Internal operational logging tag. |
| `backend/src/reference/reference.service.ts` | 189 | Route batch schedule materialization run tracking ID (`gen_${Date.now()}_...`) | **None**. Internal operational logging tag. |
| `backend/src/reference/route-schedule-validator.service.spec.ts` | 20 | Test mock route schedule source key (`KEY_...`) | **None**. Test fixture isolation only. |
| `frontend/src/app/shared/components/pagination/pagination.component.ts` | 119 | Accessible HTML `<select id="...">` and `<label for="...">` pairing | **None**. Browser DOM element ID generation to avoid collision between multiple pagination controls. |
| `frontend/src/app/pages/booking/booking.component.ts` | 1514 | Client-side HTTP request idempotency key fallback | **None**. Nonce for idempotent network requests. |
| `frontend/src/app/admin/flights-manage/flights-manage.component.ts` | 1021 | Quick flight number generator helper in admin draft form | **None**. Convenience helper in administrative UI form. |

**Audit Conclusion:** Zero occurrences are in security or cryptographic codepaths. All cryptographic hashing, key generation, and token creation strictly utilize Node.js `crypto` (`crypto.randomBytes`, `crypto.createHash`) and `bcrypt`.

---

## 8. Summary of Parity and Schema Truthfulness

1. **Seed Schema Parity**:
   - `Booking` documents seed with `user_id`, `passengers`, `flight_id`, `flight_number`, `coupon_number`, and `payment_transactions`.
   - Purged all non-schema invented fields: `contact_name`, `contact_phone`, `contact_email`, `total_price`, and `currency`.
   - `Passenger` subdocuments strictly contain `first_name`, `last_name`, `passenger_type`, `date_of_birth`, `id_card_or_passport`, and `nationality`. Purged `passenger_index` and `sex`.
   - `SeatAllocation` records strictly contain `seat_code`, `status`, `cabin_class`, `booking_id`, `coupon_number`, `passenger_name`, `seat_selection_type`, and `seat_fee`. Purged `allocated_at` and `confirmed_at`.
2. **Commercial Inventory Invariant**:
   - On `APT-E2E-SEAT`: Physical cabin capacities are Business: 12, Economy: 168.
   - 2 Economy seats are reserved by customers (`15C` CONFIRMED, `15D` HELD). Commercial inventory reflects `available_seats: 166`.
   - Staff/Maintenance blocks (`12B`, `3D`, `1A`) are operational seat status overrides and do NOT decrement commercial sellable inventory, preserving operational parity.
3. **Reversible Cancellation Policies**:
   - Cancellation policies are owned by application bootstrap (`SeedService`). E2E seed checks for their presence and never creates out-of-schema `e2e_provenance` fields.
   - Teardown removes only reference airports provisioned by seed (`data_source: 'e2e_seed'`) and never deletes cancellation policies or mutates pre-existing airports.
4. **Distance & Mileage Integrity**:
   - Geodesic distances are computed dynamically using the Great-Circle Haversine formula against `KNOWN_AIRPORT_COORDINATES`.
   - Hardcoded `721` fallback is completely purged from seed code.
5. **Timezone Determinism**:
   - Seed departure timestamps are computed using `localDateKey` and `localWallTimeToUtc` against `Asia/Ho_Chi_Minh` timezone.
   - Preserves deterministic 08:00 local wall clock time independent of host machine or container process timezone.
6. **Financial & Capacity Metrics Truthfulness**:
   - `net_revenue_vnd` in analytics is computed directly as `SUM(PAYMENT) + SUM(RESCHEDULE_CHARGE) - SUM(REFUND) - SUM(RESCHEDULE_REFUND)`.
   - Separate metric `active_booking_value_vnd` accurately captures gross value of active non-cancelled bookings.
   - Purged all legacy compatibility aliases (`total_confirmed_revenue_vnd`, `total_revenue`) across backend, frontend, tests, and documentation.
7. **Document Parity**:
   - CRS Document §3.3.4 verbatim meaning preserved, clearly noting PARTIAL status for FIRST cabin due to commercial fleet configurations.
   - ER Diagram fully updated to reflect production Mongoose schemas, SAGA operations, and PayPal checkout tables.
   - Algorithms specification expanded to all 20 production algorithms, including SAGA two-phase create, forward recovery, and compensation refund.
   - Interface Design Document matches actual backend controller routes, describes the 6-aircraft multi-fleet catalog for `SeatMapModalComponent`, and includes all 11 admin frontend views.
