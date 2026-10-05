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

Inventory: `Part` (master, identified by a short `code`, e.g. `105`), `PartStock` (quantity per branch),
`StockMovement` (append-only ledger: RECEIPT / ISSUE / RETURN / ADJUSTMENT with running balance) and `JobPart`
(engineer requests by code → store issues or marks not available). All stock changes go through
`apps/api/src/modules/inventory/stock.ts#applyMovement`, which never lets stock go negative. "Not available" puts the job
on SPARE_PENDING; issuing the last missing part resumes it automatically.

Catalogue: `Brand → DeviceModel`, `FaultCategory → Fault` (a fault can require ID proof), and `ServicePrice` — several labelled price options per model + fault (e.g. Copy / OG / Original).

Jobs: `Customer` (unique by mobile, shared across branches), `Job` (+ `JobFault` with the chosen price snapshot, `JobPhoto`), `JobCounter`, `Payment` (advance at intake; final payments at delivery).
IMEI/serial are optional at intake (dead phones) and can be added later via `PATCH /jobs/:id/device`; they will be enforced at delivery.
Job numbers are `<BRANCHCODE>-<YYMM>-<seq>` (e.g. `AND01-2610-0001`), restarting monthly per branch; the counter row is
locked during creation so concurrent jobs never collide.

Job workflow: `RECEIVED → ASSIGNED → (diagnosis) → AWAITING_APPROVAL → IN_REPAIR → REPAIRED → TESTING → READY_FOR_DELIVERY`,
with `CUSTOMER_REJECTED` when the customer declines, `SPARE_PENDING` while a part is awaited (resumes where it was),
`DELIVERED` once handed back (invoice `INV-<BRANCH>-<YYMM>-<seq>`, per-branch monthly series), and `RWR` (return without repair: reason, explanation and motherboard photos compulsory). Engineer-to-engineer
transfers (`JobTransfer`) only move the job when the receiver accepts; hold time is recorded. A diagnosis within the amount the customer already agreed (intake
estimate or earlier approval) skips approval. Transitions live in `packages/shared/src/schemas/jobs.ts`
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
| GET  | /api/v1/fault-categories | any signed-in user · POST/PATCH Super Admin |
| PUT/GET | /api/v1/users/:id/aadhaar-photo | Super Admin, Branch Manager (own-branch staff) |
| GET  | /api/v1/brands · /models · /faults | any signed-in user (`/models` also filters by `brandId`) |
| POST, PATCH | /api/v1/brands · /models · /faults | Super Admin |
| GET  | /api/v1/models/:id/prices | any signed-in user |
| GET  | /api/v1/customers/lookup?phone= | Super Admin, Branch Manager, CCO |
| GET  | /api/v1/jobs · /jobs/:id · /jobs/:id/history | Super Admin (all), Branch Manager & CCO (own branch), Engineer (only jobs assigned to them; device photos only) |
| POST | /api/v1/jobs | Branch Manager, CCO — multipart: `data` (JSON job sheet incl. optional `engineerId`, `advance`) + `CUSTOMER` / `ID_PROOF` / `DEVICE` images; ID proof enforced for flagged faults |
| PUT  | /api/v1/jobs/:id/diagnosis | assigned Engineer — `{ notes, lines: [{ faultId?, priceId?, description?, amount? }] }`; within the customer-agreed amount → IN_REPAIR, else → AWAITING_APPROVAL |
| POST | /api/v1/jobs/:id/approval | Super Admin, Branch Manager, CCO — `{ decision: APPROVED \| REJECTED, note }` (reason required to reject) |
| POST | /api/v1/jobs/:id/status | assigned Engineer — IN_REPAIR → REPAIRED → TESTING → READY_FOR_DELIVERY (test failure back to IN_REPAIR with reason) |
| POST | /api/v1/jobs/:id/transfers | assigned Engineer — `{ toEngineerId, reason }`; job stays with sender until accepted |
| GET  | /api/v1/jobs/transfers?direction=&status= | engineers: own incoming/outgoing; managers/CCO: branch |
| POST | /api/v1/jobs/transfers/:transferId/respond | receiving Engineer — `{ decision: ACCEPTED \| REJECTED, note }` |
| POST | /api/v1/jobs/transfers/:transferId/cancel | sending Engineer, Branch Manager, Super Admin |
| POST | /api/v1/jobs/:id/spare-hold | assigned Engineer — `{ part, note }` → SPARE_PENDING |
| POST | /api/v1/jobs/:id/spare-received | assigned Engineer, Branch Manager, Super Admin — resumes previous status |
| POST | /api/v1/jobs/:id/rwr | assigned Engineer — multipart `data` `{ reason, note }` + `photos[]` (≥ 1 motherboard photo) → RWR |
| GET  | /api/v1/parts · /parts/lookup?code= | any signed-in user · POST/PATCH Super Admin |
| GET  | /api/v1/inventory/stock · /movements | Storekeeper, Branch Manager, Super Admin (`branchId` required for Super Admin) |
| POST | /api/v1/inventory/receipts · /adjustments | same — stock in / signed correction with reason |
| GET  | /api/v1/inventory/part-requests?status=open | same — store queue with current stock |
| POST | /api/v1/inventory/part-requests/:id/issue · not-available · return · cancel | store roles (cancel also the assigned Engineer) |
| POST | /api/v1/jobs/:id/parts | assigned Engineer — `{ code, quantity }` |
| GET  | /api/v1/jobs/:id/bill-preview | Super Admin, Branch Manager, CCO — bill computed from the approved estimate (repair) or nothing (RWR), with amount already paid |
| POST | /api/v1/jobs/:id/deliver | same — `{ discount, discountReason, inspectionCharge (RWR), payments[], refund, deliveredTo, accessoriesReturned, note }`; payments must equal the balance exactly (or refund the excess); IMEI/serial required for repaired phones; creates the invoice and closes the job (DELIVERED) |
| GET  | /api/v1/jobs/:id/invoice | same — printable invoice data |
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
