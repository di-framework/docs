# Durable job queues

`@di-framework/queues` is a durable job queue: producers enqueue work, DI-managed handlers process
it, and a backend retains jobs across restarts. Enqueue resolves when the backend **accepts** the
job. The worker acknowledges completion only after awaiting the handler.

This is not [Events](events.md). `@Publisher` / `@Subscriber` and `@di-framework/events` move
messages on an in-process bus or to a broker. Queues store jobs with leases, retries, timeouts,
and a dead-letter state.

> These APIs landed on di-framework `main` after the
> [v5.3.0](https://github.com/di-framework/di-framework/releases/tag/v5.3.0) tag
> ([PR #423](https://github.com/di-framework/di-framework/pull/423), closing
> [di-framework#404](https://github.com/di-framework/di-framework/issues/404)).
> They are documented here on **latest** (EAP). `@di-framework/queues` is not on npm as of that
> tag and is not in the frozen `/v5.3/` snapshot.

Delivery is **at-least-once**. Use stable job ids or `idempotencyKey` for application-level
idempotency. Timeouts mark an attempt failed; they do not cancel JavaScript already running in
the handler.

## Installation

```bash
bun add @di-framework/queues @di-framework/core
```

```typescript
import { Container, Component } from '@di-framework/core/decorators';
import {
  queue,
  QueueHandler,
  QueueWorker,
  ContainerQueueDispatcher,
  SqliteQueueBackend,
  InMemoryQueueBackend,
  type JobMetadata,
} from '@di-framework/queues';
```

`@QueueHandler` is defined in `@di-framework/core` and re-exported here.

## Receipt worker walkthrough

The [receipt-worker example](https://github.com/di-framework/di-framework/tree/main/examples/receipt-worker)
is the runnable end-to-end guide.

### Producer

```typescript
this.producer = queue.get<ReceiptJobPayload>('receipts');
return this.producer.enqueue(payload, {
  idempotencyKey: idempotencyKey ?? payload.receiptId,
  maxRetries: 3,
  backoffMs: 100,
});
```

`queue.get(name)` returns a `QueueProducer<T>`. `enqueue` returns a `Job<T>` after the backend
inserts it, not after the handler runs.

### Handler

```typescript
@Container()
export class ReceiptProcessor {
  constructor(@Component(AuditLogService) private readonly auditLog: AuditLogService) {}

  @QueueHandler('receipts', {
    maxRetries: 3,
    backoffMs: 100,
    timeoutMs: 5000,
    concurrency: 2,
  })
  async processReceipt(payload: ReceiptJobPayload, meta?: JobMetadata): Promise<void> {
    if (!payload?.receiptId || payload.total < 0) {
      throw new Error(`Invalid receipt data for receipt ${payload?.receiptId}`);
    }
    this.auditLog.log('receipt.processed', {
      receiptId: payload.receiptId,
      attempt: meta?.attempts ?? 1,
    });
  }
}
```

The dispatcher calls `instance[method](job.payload, meta)`. Throw to fail the attempt.

### Local worker

```typescript
const dbPath = process.env.QUEUE_DB_PATH ?? join(process.cwd(), '.di-framework', 'queues.db');
const backend = new SqliteQueueBackend({ path: dbPath });
queue.setBackend(backend);

const worker = new QueueWorker(backend, dispatcher, {
  queues: ['receipts'],
  pollIntervalMs: 500,
});
worker.start();
```

```bash
bun run dev
bun test
```

The example `di-framework.config.json` sets `"applicationType": "worker"`.

## Backends

| Class | `name` | Use |
| --- | --- | --- |
| `InMemoryQueueBackend` | `in-memory` | Tests; virtual clock; `step` / `drain` |
| `SqliteQueueBackend` | `sqlite` | Local durability via `bun:sqlite` (WAL by default) |
| `WasmSqliteQueueBackend` | `sqlite-wasm` | WASI SQLite; portable / wasmCloud entry |

The native package root exports `SqliteQueueBackend`. The `wasmcloud` export condition and
`@di-framework/queues/portable` export the Wasm backend instead and do not import `bun:sqlite`.
Portable imports alone do not provide durable Wasm storage; the composed `di-framework:sqlite`
capability does.

`queue` is a process-wide `QueueManager`. Default backend is in-memory until `queue.setBackend(...)`.

## Options and defaults

Handler decorator defaults: `maxRetries: 3`, `backoffMs: 1000`, `timeoutMs: 30000`,
`concurrency: 1`.

Enqueue uses the **first registered handler** for that queue as defaults, then falls back to
those same numbers. Explicit enqueue options win. Import handler modules before producing jobs
if you rely on decorator defaults.

Other enqueue fields: `jobId`, `idempotencyKey`, `delayMs` (default 0), `priority` (default 0).
Dequeue order is `priority DESC, availableAt ASC, enqueuedAt ASC`.

Worker defaults: `pollIntervalMs: 50`, `leaseTimeoutMs: 30000`, `recoveryIntervalMs: 10000`,
`shutdownTimeoutMs: 5000`.

## Delivery, retries, and dead letters

- **Accept vs complete.** `enqueue` confirms durable insert. `complete` runs only after the
  awaited handler returns.
- **Job ids.** `options.jobId` or `job_<timestamp>_<seq>_<rand>`. Colliding SQLite primary keys
  throw.
- **Idempotency.** A matching `(queueName, idempotencyKey)` returns the existing non-dead-letter
  job. Dead-lettered keys can be reused. The index is not unique.
- **Retries.** `fail` re-queues as `pending` while `attempts < maxRetries`, with backoff
  `min(backoffMs * 2^(attempts-1), 60000)`. Otherwise the job becomes `dead-letter`.
- **Timeouts.** The dispatcher races `timeoutMs`. The handler is not interrupted and may finish
  after a retry has begun. Make side effects idempotent.
- **Leases.** Dequeue sets `leaseExpiresAt`. `recoverUnacknowledged` returns expired
  `processing` rows to `pending` or dead-letter.
- **Dead-letter retry.** `retryJob(queueName, jobId?)` sets matching dead-letter rows back to
  `pending`. It does **not** reset `attempts`.

Completed and dead-letter jobs are retained; nothing purges them.

## Testing with the in-memory backend

```typescript
const memory = new InMemoryQueueBackend();
queue.setBackend(memory);

await queue.get('receipts').enqueue({ receiptId: 'r1', total: 10 });

const processed = await memory.step('receipts', async (job) => {
  await dispatcher.dispatch(job);
});
```

- `advanceTime(ms)` moves the virtual clock (no real sleeps for delay/backoff)
- `step(queueName?)` dequeues one eligible job
- `drain(queueName?, maxSteps?)` loops `step` until empty
- `setExecutor(fn)` supplies a default handler for `step`/`drain`

`step` does not apply dispatcher timeouts; call `ContainerQueueDispatcher.dispatch` yourself when
you need that path.

## CLI

```text
di-framework queue list [--db <path>]
di-framework queue inspect <name> [--db <path>] [--status <status>] [--limit <n>]
di-framework queue retry <name> [jobId] [--db <path>]
```

`--status` is `pending` | `processing` | `completed` | `dead-letter`. Inspect `--limit` defaults
to 50. Database path: `--db` → `DI_QUEUE_DB` → existing `.di-framework/queue.db` → existing
`queue.db` → else `.di-framework/queue.db`.

The receipt-worker local default is `.di-framework/queues.db` (plural). Pass `--db` or
`DI_QUEUE_DB` to inspect that file.

JSON `data` through the public CLI envelope: `{ queues }` for list, `{ jobs }` for inspect,
`{ retried }` for retry. Missing `@di-framework/queues` exits `3`
(`QUEUES_PACKAGE_UNAVAILABLE`).

## wasmCloud workers

Build discovers `@QueueHandler('name', { numeric options })`. A project is a queue worker when
handlers exist and either `applicationType` is `"worker"` or the sources have no HTTP controller
decorators.

Implemented deploy path:

- Guest WIT exports `wasi:http/handler@0.3.0` and imports `di-framework:sqlite`
- Generated module constructs `WasmSqliteQueueBackend` and **`pump()`s** on control HTTP
  (request-scoped Wasm tasks do not start `setTimeout` poll loops)
- Control prefix `/_di/queues/` for list, enqueue, inspect, and retry
- Workload `replicas: 1`, `deployPolicy: Recreate`, `hostgroup: storage`, hostPath volume,
  `QUEUE_DB_PATH=/data/queue.db`, `DI_SQLITE_BACKEND=wasm`
- Public ingress is omitted for workers; a ClusterIP Service still exists for control HTTP

SQLite-backed workloads cannot use more than one replica (WASI VFS has no file locking).

If `DI_CONTROL_TOKEN` / `DI_CONTROL_IDENTITIES` are unset, control identities are open for
local/dev. Provision a token before exposing the ClusterIP.

You can still [schedule](scheduling.md) work that enqueues jobs; neither feature requires the
other.

## Events versus queues

| | Queues | Events |
| --- | --- | --- |
| Role | Durable jobs with persist, lease, retry, DLQ | In-process bus and broker bridge |
| Produce | `queue.get(name).enqueue` | `@Publisher` / event bridge |
| Consume | `@QueueHandler` + worker; ack after await | `@Subscriber`; broker `ack` / `nack` |
| Durability | SQLite or in-memory job table | Broker-specific |
| Inspect | `di-framework queue …` | Not a job CLI |

## Limitations

- At-least-once only; overlapping retries are possible after a timeout
- SQLite/Wasm payloads are JSON; in-memory keeps object references
- No Redis/Kafka/NATS queue backends
- `retryJob` does not reset `attempts`
- Wasm workers process jobs when control HTTP runs `pump()`, not via a host `queueConsumers`
  field

## Next steps

- [Events](events.md) - Broker bridges, not durable jobs
- [Scheduling](scheduling.md) - Optional `@Cron` that can enqueue work
- [CLI](cli.md) - `queue list` / `inspect` / `retry`
- [Testing](testing.md) - Isolated containers and in-memory backends
- [wasmCloud](wasmcloud.md) - Worker deploy without public ingress
