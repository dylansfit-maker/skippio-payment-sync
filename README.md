# Skippio engineering challenge: payment events -> simulated POS

A small service that receives payment confirmations, records paid orders, registers them with a simulated point-of-sale (POS), and a one-screen UI to inspect and retry the flow.

- `backend/` Node.js + TypeScript (Express 5, zod). In-memory storage, single process.
- `frontend/` React + TypeScript (Vite). Talks to the backend over HTTP only; all business logic is in the backend.

## Run it

Requires Node 20+.

```bash
npm run install:all          # or: (cd backend && npm ci) && (cd frontend && npm ci)

# terminal 1
npm run dev:backend          # http://localhost:3001
# terminal 2
npm run dev:frontend         # http://localhost:5173  (proxies /api -> backend)
```

Tests and type checks: `npm test` and `npm run typecheck` (both apps), or per app: `cd backend && npm test`.

Backend configuration (environment variables, all optional):

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3001` | Listen port |
| `POS_FAIL_FIRST_ATTEMPTS` | `1` | Simulated POS rejects this many initial attempts per order (`0` = never fail) |
| `POS_LATENCY_MS` | `600` | Simulated POS latency per call |

Frontend: `BACKEND_URL` (dev proxy target, default `http://localhost:3001`) or `VITE_API_BASE_URL` (default `/api`).

## Demo flows

**In the UI** (see [docs/MANUAL_UI_CHECKLIST.md](docs/MANUAL_UI_CHECKLIST.md)): fill the form and send. The first POS attempt fails, so the order is paid but "POS sync: Failed". Click **Retry POS sync** and it succeeds. Send the event again (or with "New event ID") to see duplicate handling; the POS panel keeps showing one transaction.

**With curl:**

```bash
EVT='{"eventId":"evt_001","type":"payment.succeeded","order":{"id":"ord_001","venueId":"venue_001","currency":"EUR","items":[{"productId":"burger","quantity":2,"price":1200},{"productId":"water","quantity":1,"price":250}],"total":2650}}'

curl -i -X POST localhost:3001/payment-events -H 'content-type: application/json' -d "$EVT"   # 201, pos.status FAILED
curl -i -X POST localhost:3001/payment-events -H 'content-type: application/json' -d "$EVT"   # 200, duplicate: true
curl -i -X POST localhost:3001/orders/ord_001/sync                                           # 200, SYNCED, attempts 2
curl -i -X POST localhost:3001/orders/ord_001/sync                                           # 200, attempted: false
curl -s localhost:3001/orders/ord_001
curl -i -X POST localhost:3001/orders/ord_001/refund                                         # 200, refunded 2650
curl -i -X POST localhost:3001/orders/ord_001/refund                                         # 200, alreadyRefunded: true
curl -s localhost:3001/debug/pos-transactions                                                # exactly one transaction
```

## API

| Endpoint | Success | Errors |
|---|---|---|
| `POST /payment-events` | **201** new order recorded (POS outcome in `order.pos`, so a POS failure is still 201); **200** `duplicate: true`, nothing created | **400** `VALIDATION_ERROR` (with `details`), `INVALID_JSON`; **409** `ORDER_CONFLICT` |
| `GET /orders/:orderId` | 200 `{ order }` | 404 `ORDER_NOT_FOUND` |
| `POST /orders/:orderId/sync` | **200** order is synced; `attempted` says whether this request made a POS call | **502** `POS_SYNC_FAILED` (body still contains the order); 404 |
| `POST /orders/:orderId/refund` | **200**; `alreadyRefunded` tells first call from repeat | **409** `REFUND_NOT_ELIGIBLE` (not synced to POS); 404 |
| `GET /meta` | supported event types / currencies (the UI reads these instead of hard-coding them) | |
| `GET /debug/pos-transactions` | what the simulated POS accepted | |

Errors always look like `{ "error": { "code", "message", "details?" } }`. Payment status (`payment.status`), POS sync status (`pos.status`: PENDING / SYNCING / SYNCED / FAILED) and refund status (`refund.status`) are separate fields, so the outcomes are distinguishable.

### Documented behaviour

- **Payment events never trigger a POS retry.** A duplicate is acknowledged and returns current state; only `/sync` calls the POS again. This keeps retries explicit and predictable.
- **Overlapping `/sync` requests** are queued per order. A request that waited while another attempt finished does not make another call; it returns that attempt's result with `attempted: false`. So N overlapping retries produce one POS call.
- **Repeat refund** is idempotent: 200 with the original refund, not an error and not a second refund.
- **Conflict** = same order id with different venue, currency, total, or items (compared in supplied order). Rejected with 409 and nothing is changed, including the list of event ids.
- A new event id for an existing, identical order is added to `payment.eventIds` (an audit trail) but changes nothing else.

## Architecture

```
http/app.ts            routes, status codes (thin; no business rules)
services/OrderService  receive / sync / refund workflow
domain/                order types, zod validation, errors, conflict detection
concurrency/KeyedLock  interface + in-memory implementation
storage/               OrderRepository interface + in-memory implementation
pos/                   PosAdapter interface, payload mapper, SimulatedPos
server.ts              composition root: the only place concrete classes are chosen
```

Everything the service needs is injected through interfaces (`OrderRepository`, `PosAdapter`, `KeyedLock`), so each can be replaced without touching the others or the service.

### Duplicate prevention

1. Every operation on an order (receive, sync, refund) runs inside `locks.runExclusive("order:<id>")`, so check-then-act sequences are atomic per order. Different orders still run in parallel.
2. Inside the lock the order is looked up first; if it exists the request is a duplicate (or a conflict) and the POS is not called. The order is saved as PAID *before* the POS call, so a POS failure can never lose the payment.
3. The POS is called only when an order is new, or on `/sync` while status is not SYNCED.
4. The simulated POS deliberately does **not** deduplicate and keeps its own transaction list, so tests prove our code prevents duplicates rather than the fake hiding them.

### Extending

- New POS vendor: implement `PosAdapter` (+ own mapping), swap it in `server.ts`.
- Multi-instance deployment: implement `KeyedLock` with Redis or Postgres advisory locks, and `OrderRepository` with SQL. No service changes.
- Different failure simulation: implement `FailurePolicy`.
- New currency/event type: add to the constants in `domain/order.ts`; validation, `/meta` and the UI dropdowns follow.

## Tests

`cd backend && npm test` (39 tests):
the six required scenarios (`orders.test.ts`), the lock itself (`keyedLock.test.ts`), and race conditions at service level with a stale-read repository (`raceConditions.test.ts`).
Overlap is *forced*, not hoped for: a `GatedPos` holds the first POS call in flight until a second request has arrived, then asserts only one call was made. Disabling the lock makes 6 of these tests fail.
Frontend: unit tests for money parsing/formatting (`npm --prefix frontend test`). Component tests are not written; the manual checklist covers the UI.

## Scoped out (deliberately)

- Auth, rate limiting, CORS config, real payment/POS integration, queues, deployment, refund UI, partial refunds, POS refund.
- Same `eventId` reused for a *different* order (needs a global unique index on event id; trivial in SQL, racy to fake in memory).
- Timeouts after POS acceptance (out of scope per the brief). The payload carries `orderReference`; a real POS would also get an idempotency key.
- Automated frontend component tests and E2E; internationalised formatting beyond `Intl`; non-2-decimal currencies are supported by the money helpers but untested end-to-end.

## Before production

Durable storage with a unique constraint on order id and event ids; distributed lock or optimistic concurrency; structured logging, metrics and request ids; background retry with backoff and a dead-letter state instead of manual-only retries; POS idempotency keys and timeout/unknown-outcome reconciliation; authentication and signature verification on payment events; an audit log of state transitions; OpenAPI spec and contract tests; CI; Playwright tests for the UI.

## Git workflow

Small commits per layer (domain -> POS -> service/API -> tests -> frontend -> docs) on `main`, pushed at each milestone. Commit messages follow `type(scope): summary`.

## Time spent and unfinished work

Approximate time: **[fill in, e.g. ~4h]**. Unfinished: see "Scoped out" above; nothing in the required scope is knowingly incomplete.
