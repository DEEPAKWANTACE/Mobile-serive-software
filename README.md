# Mobile Service Management

Multi-branch mobile phone repair / service management system.

**Workflow:** CCO → Job Sheet → Engineer → Diagnosis → Estimate → Customer Approval → Repair → QC → Billing → Delivery → Reports

## Stack

| Layer    | Tech |
|----------|------|
| Monorepo | npm workspaces |
| API      | Node 24, Express 5, TypeScript, Zod, Prisma 7 (pg driver adapter), pino |
| Database | PostgreSQL 16 |
| Web      | React 19, Vite, Tailwind CSS 4, React Router, TanStack Query |
| Auth     | JWT access token (memory, 15 min) + rotating refresh token (httpOnly cookie, hashed in DB) |

## Structure

```
apps/
  api/
    prisma/
      schema.prisma        # DB schema (source of truth)
      migrations/          # SQL migrations (committed)
      seed.ts              # creates the initial Super Admin
    src/
      config/env.ts        # validated env vars — app refuses to boot if invalid
      lib/                 # prisma client, logger, tokens, password, HttpError, branch scoping
      middleware/          # authenticate, authorize(roles), validate(zod), error handler
      modules/<feature>/   # one folder per business module: *.routes → *.controller → *.service
      routes.ts            # mounts every module under /api/v1
      app.ts / server.ts   # express app composition / process bootstrap + graceful shutdown
  web/
    src/
      app/                 # router + providers
      lib/api-client.ts    # fetch wrapper: bearer token, auto-refresh on 401
      features/<feature>/  # feature UI (auth, later jobs, inventory, ...)
      components/layout/   # shell + role-filtered sidebar (navigation.ts)
      pages/
packages/
  shared/                  # roles, zod schemas & types shared by api and web
```

### Conventions

- **Module layout:** routes (HTTP wiring + validation + role guards) → controller (req/res) → service (business logic + DB). Services never touch `req`/`res`.
- **Validation:** Zod schemas live in `packages/shared` when the web form uses them too, so both sides validate identically.
- **Multi-branch isolation:** every branch-owned query goes through `branchScope(req.auth)` (`apps/api/src/lib/access.ts`). Super Admin sees all branches; every other role is locked to its own branch.
- **Authorisation:** `authorize('BRANCH_MANAGER', 'CCO')` on routes; `<RequireAuth roles={[...]}>` on web routes.
- **Audit trail:** `recordAudit()` writes to `audit_logs`; pass the transaction client so the log is atomic with the change.
- **Errors:** throw `HttpError.*`; the central handler maps Zod / Prisma / HTTP errors to `{ error: { code, message, details } }`.
- **IDs:** UUID v7 (time-ordered). Tables/columns are snake_case in Postgres.

## Data model (foundation)

`State → City → Branch (SERVICE_CENTER | MAIN_OFFICE/L4) → User (role)` plus `Session` (refresh tokens) and `AuditLog`.

L4: `Job.branchId` is the owning (customer) branch and never changes; `currentBranchId` + `location` (AT_BRANCH / TO_L4 /
TO_BRANCH) follow the phone, and `JobMovement` logs every send/receive. Branch staff see jobs they own or physically
hold; assignment and store work use the current branch, approval calls and delivery stay with the owner.

Printing & messages: `/jobs/:id/print` prints two copies on one A4 (customer copy with contact, estimate, advance and
terms; engineer copy without customer contact or money). Customer messages use WhatsApp click-to-chat with templates
in `packages/shared/src/schemas/messages.ts` (no paid provider needed; an SMS/WhatsApp API can reuse the templates).

Accounts & calling: `Expense` (never deleted — voided with reason), `CallLog` (outcome + next follow-up).

Inventory: `Part` (master, identified by a short `code`, e.g. `105`), `PartStock` (quantity per branch),
`StockMovement` (append-only ledger: RECEIPT / ISSUE / RETURN / ADJUSTMENT with running balance) and `JobPart`
(engineer requests by code → store issues or marks not available). All stock changes go through
`apps/api/src/modules/inventory/stock.ts#applyMovement`, which never lets stock go negative. "Not available" puts the job
on SPARE_PENDING; issuing the last missing part resumes it automatically.

Catalogue: per-branch `Brand → DeviceModel`, `FaultCategory → Fault`, parts (with category/subcategory), and received-accessory options. Branch Managers edit their branch; Super Admin manages global defaults or any branch.

Jobs: `Customer` (unique by mobile, shared across branches), `Job` (+ `JobFault` with the chosen price snapshot, `JobPhoto`), `JobCounter`, `Payment` (advance at intake; final payments at delivery).
Jobs are either MOBILE (brand and model required; IMEI optional) or ACCESSORY (accessory name and serial number required).
Job numbers are `<BRANCHCODE>-<YYMM>-<seq>` (e.g. `AND01-2610-0001`), restarting monthly per branch; the counter row is
locked during creation so concurrent jobs never collide.

Job workflow: CCO creates and assigns the job, then `ASSIGNED → (engineer diagnosis) → AWAITING_APPROVAL → (CCO records the customer's answer) → IN_REPAIR → REPAIRED → TESTING → READY_FOR_DELIVERY`,
with `CUSTOMER_REJECTED` when the customer declines, `SPARE_PENDING` while a part is awaited (resumes where it was),
`DELIVERED` once handed back (invoice `INV-<BRANCH>-<YYMM>-<seq>`, per-branch monthly series). A CCO may skip diagnosis with an estimate: if the customer already approved, it goes directly to repair; otherwise it waits for the CCO's approval record. Engineer-entered estimates always return to the CCO. RWR is `RWR_PENDING` (locked) until the owning Branch Manager finalizes it, and only that manager may deliver it. Engineer-to-engineer
transfers (`JobTransfer`) only move the job when the receiver accepts; hold time is recorded. Transitions live in `packages/shared/src/schemas/jobs.ts`
(`ENGINEER_TRANSITIONS`) and `apps/api/src/modules/jobs/workflow.service.ts`; every move is audited.

Photos are private: stored via `apps/api/src/lib/storage.ts` (local disk under `UPLOAD_DIR` today, S3-compatible driver
later), type-checked by file signature, and only streamed through authorised, branch-scoped endpoints.

## Getting started

```bash
npm install
cp apps/api/.env.example apps/api/.env   # set DATABASE_URL, JWT_ACCESS_SECRET, seed admin password
createdb msm_dev
npm run db:migrate                        # apply migrations + regenerate Prisma client
npm run db:seed                           # create Super Admin
npm run dev                               # API :4000, web :5173 (proxies /api)
```

Other scripts: `npm run build`, `npm run typecheck`, `npm run db:studio`.

### Repeatable test-branch fixtures

After creating the `B1` test accounts, populate or refresh a comprehensive workflow dataset with:

```bash
npm run db:seed-test-fixtures
```

The script creates four `TSTFIX-` jobs for every job status and five `[FIXTURE]` reminders for each test role. It is safe to rerun: reserved fixture jobs are updated and only `[FIXTURE]` reminders are replaced. Override the volume with `TEST_JOBS_PER_STATUS=1..10` or the branch with `TEST_BRANCH_CODE` (non-`B1` branches must contain "test" in their name).

### API (so far)

| Method | Path | Auth |
|--------|------|------|
| GET  | /api/v1/health | – |
| POST | /api/v1/auth/login | – (rate-limited) |
| POST | /api/v1/auth/refresh | refresh cookie |
| POST | /api/v1/auth/logout | refresh cookie |
| GET  | /api/v1/auth/me | Bearer |
| GET  | /api/v1/states · /cities · /branches | any signed-in user (filters: `search`, `isActive`, `page`, `pageSize`, plus `stateId` / `cityId` / `type`) |
| POST, PATCH | /api/v1/states · /cities · /branches | Super Admin |
| GET, POST, PATCH | /api/v1/users | Super Admin (all) · Branch Manager (own-branch CCO/Engineer/Storekeeper/Accounts only) |
| POST | /api/v1/users/:id/reset-password | same as above |
| GET  | /api/v1/fault-categories | any signed-in user · POST/PATCH Super Admin or Branch Manager (scoped) |
| PUT/GET | /api/v1/users/:id/aadhaar-photo | Super Admin, Branch Manager (own-branch staff) |
| GET  | /api/v1/brands · /models · /faults | any signed-in user (`/models` also filters by `brandId`) |
| POST, PATCH | /api/v1/brands · /models · /faults | Super Admin or Branch Manager (scoped) |
| GET  | /api/v1/models/:id/prices | any signed-in user |
| GET  | /api/v1/customers/lookup?phone= | Super Admin, Branch Manager, CCO |
| GET  | /api/v1/jobs · /jobs/:id · /jobs/:id/history | Super Admin (all), Branch Manager & CCO (own branch), Engineer (only jobs assigned to them; device photos only) |
| POST | /api/v1/jobs | CCO — multipart: `data` (JSON job sheet incl. required `engineerId`, optional `advance`) + `CUSTOMER` / `ID_PROOF` / `DEVICE` / `PHYSICAL_CONDITION` images |
| PUT  | /api/v1/jobs/:id/diagnosis | assigned Engineer — `{ notes, lines: [...] }` → AWAITING_APPROVAL |
| POST | /api/v1/jobs/:id/approval | Branch Manager, CCO — `{ decision: APPROVED \| REJECTED, note }` (reason required to reject) |
| POST | /api/v1/jobs/:id/status | assigned Engineer — IN_REPAIR → REPAIRED → TESTING → READY_FOR_DELIVERY (test failure back to IN_REPAIR with reason) |
| POST | /api/v1/jobs/:id/transfers | assigned Engineer — `{ toEngineerId, reason }`; job stays with sender until accepted |
| GET  | /api/v1/jobs/transfers?direction=&status= | engineers: own incoming/outgoing; managers/CCO: branch |
| POST | /api/v1/jobs/transfers/:transferId/respond | receiving Engineer — `{ decision: ACCEPTED \| REJECTED, note }` |
| POST | /api/v1/jobs/transfers/:transferId/cancel | sending Engineer, Branch Manager, Super Admin |
| POST | /api/v1/jobs/:id/spare-hold | assigned Engineer — `{ part, note }` → SPARE_PENDING |
| POST | /api/v1/jobs/:id/spare-received | assigned Engineer, Branch Manager, Super Admin — resumes previous status |
| POST | /api/v1/jobs/:id/rwr | assigned Engineer or CCO — multipart `data` `{ reason, note }` + `photos[]` → RWR_PENDING |
| POST | /api/v1/jobs/:id/rwr/finalize | owning Branch Manager only → RWR (ready for manager delivery) |
| GET  | /api/v1/parts · /parts/lookup?code= | any signed-in user · POST/PATCH Super Admin or Branch Manager (scoped) |
| GET  | /api/v1/inventory/stock · /movements | Storekeeper, Branch Manager, Super Admin (`branchId` required for Super Admin) |
| POST | /api/v1/inventory/receipts · /adjustments | same — stock in / signed correction with reason |
| GET  | /api/v1/inventory/part-requests?status=open | same — store queue with current stock |
| POST | /api/v1/inventory/part-requests/:id/issue · not-available · return · cancel | store roles (cancel also the assigned Engineer) |
| POST | /api/v1/jobs/:id/parts | assigned Engineer — `{ code, quantity }` |
| GET  | /api/v1/jobs/:id/bill-preview | Branch Manager, CCO — bill computed from the approved estimate (repair) or optional RWR inspection charge |
| POST | /api/v1/jobs/:id/deliver | Branch Manager, CCO for repaired jobs; owning Branch Manager only for RWR; closes the job as DELIVERED |
| GET  | /api/v1/jobs/:id/invoice | same — printable invoice data |
| GET  | /api/v1/accounts/day-book?from=&to=&branchId= | Super Admin, Branch Manager, Accounts, CCO — received / refunds / expenses by mode, net, cash in hand (business dates, `APP_TIMEZONE`) |
| POST | /api/v1/accounts/expenses · /expenses/:id/void | add: same roles · void (with reason): Super Admin, Branch Manager, Accounts |
| GET  | /api/v1/calling/list?list=ready\|rwr\|due\|approval · /calling/summary | Super Admin, Branch Manager, CCO, Accounts — pending collection & call lists |
| GET/POST | /api/v1/jobs/:id/calls | Super Admin, Branch Manager, CCO — call history / log a call (outcome, note, next follow-up) |
| POST | /api/v1/jobs/:id/l4/send · /l4/receive · /l4/send-back | send: owning branch / assigned engineer → a MAIN_OFFICE · receive: destination branch · send back: L4 once Ready/RWR |
| GET  | /api/v1/jobs/l4/movements?view=incoming\|outgoing\|all | Super Admin, Branch Manager, CCO |
| GET  | /api/v1/reports?from=&to=&stateId=&cityId=&branchId= | Super Admin (any scope), Branch Manager & Accounts (own branch) — summary + branch / engineer / CCO tables |
| PATCH | /api/v1/jobs/:id | owning Branch Manager / CCO — correct the job sheet (device & faults only before diagnosis; not after delivery; diff audited) |
| DELETE | /api/v1/jobs/:id/photos/:photoId | same — `{ reason }`; RWR photos and the last required ID proof are protected |
| GET  | /api/v1/jobs/imei-check?imei=&excludeJobId= | job viewers — open jobs and earlier repairs with the same IMEI, all branches |
| GET/POST | /api/v1/inventory/transfers · /transfers/:id/receive · /cancel | store roles — branch-to-branch stock (out on send, in on receive, back on cancel) |
| GET/PUT | /api/v1/settings/shop · /settings/shop/logo | read: any signed-in user · change: Super Admin — shop name, legal name, GSTIN, address, logo, invoice terms |
| PATCH | /api/v1/jobs/:id/device | job viewers — set/correct IMEI & serial (audited) |
| GET  | /api/v1/jobs/stats | job viewers — counts by status in caller's scope |
| GET  | /api/v1/jobs/engineers?branchId= | Super Admin (branchId required), Branch Manager, CCO — active engineers + open workload |
| POST | /api/v1/jobs/:id/assign | Super Admin, Branch Manager, CCO — `{ engineerId }`; allowed while RECEIVED/ASSIGNED |
| POST | /api/v1/jobs/:id/photos | Branch Manager, CCO — multipart `kind` + `photos[]` (JPEG/PNG/WebP, ≤ 8 MB, ≤ 10 per request) |
| GET  | /api/v1/jobs/:id/photos/:photoId | same as job view |
| PUT  | /api/v1/models/:id/prices | Super Admin — `{ prices: [{ faultId, options: [{ label, price }] }] }`; empty `options` removes, unlisted faults untouched; audited old → new |

Records are never hard-deleted — deactivate with `PATCH { "isActive": false }`. Deactivating a user, changing their role/branch, or resetting their password signs them out of every device.

## Production notes

- Serve web and API under the **same domain** (reverse proxy `/api` → API) so the `SameSite=Strict` refresh cookie works; `secure` cookies are enabled when `NODE_ENV=production`.
- Run `npm run db:deploy --workspace=@msm/api` (not `migrate dev`) on deploy.
- `npm audit` reports advisories in the Prisma **CLI's** dev dependencies (mysql2, deepmerge-ts); they are not part of the runtime API.
