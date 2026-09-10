# Remote actors and ownership

`@di-framework/actors` can invoke actors across processes through an explicit RPC dispatcher and
a pluggable transport. Ownership generations (fencing tokens) reject stale-owner writes.
Deduplication caches committed results so a retried `requestId` does not re-run the method.

This guide is independent of wasmCloud. Multi-host wasmCloud routing is **not** wired to this
protocol. Single-host wasmCloud deploy remains `replicas: 1` with a hostPath volume; see
[Actors on wasmCloud](wasmcloud.md#actors).

> These APIs landed on di-framework `main` after the
> [v5.3.0](https://github.com/di-framework/di-framework/releases/tag/v5.3.0) tag
> ([PR #421](https://github.com/di-framework/di-framework/pull/421), closing
> [di-framework#410](https://github.com/di-framework/di-framework/issues/410)).
> They are documented here on **latest** (EAP).

Read the [local runtime](actors.md) first.

## Remote client and dispatcher

```typescript
import {
  ActorRpcDispatcher,
  RemoteActorClient,
  MemoryActorTransport,
  ActorRuntime,
} from '@di-framework/actors';

const runtime = new ActorRuntime({ actors: [OrderActor] });
const dispatcher = new ActorRpcDispatcher({ runtime });
const transport = new MemoryActorTransport(dispatcher);

const client = new RemoteActorClient({
  transport,
  callerId: 'gateway-service',
  timeoutMs: 30000,
  maxRetries: 3,
  retryDelayMs: 50,
});

const order = client.get<OrderActor>(OrderActor, 'order-42');
const result = await order.placeOrder('ord-1', 100);
```

Every request includes `requestId` (client `crypto.randomUUID()`, reused on retry), optional
`namespace`, `actorType`, `actorKey`, `method`, `args`, optional `callerId`, and optional
`deadline` (epoch milliseconds).

Implemented transports:

- `MemoryActorTransport` — in-process; test hooks `dropNextResponse()`, `delayNextRequest(ms)`
- `ChildProcessIpcTransport` — `child.send` or stdin JSON lines

There is **no** HTTP/TCP/wasmCloud cluster transport in this package. wasmCloud uses a plugin
adapter at `POST /_actors/invoke`, not `RemoteActorClient`.

The client retries the same `requestId` unless the error is `ActorAuthorizationError`,
`StaleOwnerWriteError`, `ActorBackpressureError`, `ActorDeadlineExceededError`, or an
application error returned by the actor.

## Authorization

```typescript
import { createActorBindingPolicy, ActorRuntime } from '@di-framework/actors';

const policy = createActorBindingPolicy({
  allowedCallers: ['web-gateway', 'internal-cron'],
  allowedNamespaces: ['production', 'default'],
  allowedActorTypes: ['OrderActor'],
  allowedMethods: {
    OrderActor: ['getOrder', 'placeOrder'],
  },
});

const runtime = new ActorRuntime({
  actors: [OrderActor],
  authorizationPolicy: policy,
});
```

Unauthorized requests reject with `ActorAuthorizationError` **before** mailbox admission. Empty
arrays are whitelists; omit a field (leave it `undefined`) for no restriction on that axis.
This is actor RPC authorization, not [`@ServiceBinding`](service-bindings.md).

## Ownership and fencing

Storage records `{ actorId, ownerId, generation, acquiredAt, leaseExpiresAt }`.

```typescript
await runtime.acquireActorOwnership(OrderActor, 'order-42', { leaseTtlMs: 30_000 });
```

- First owner: generation `1`
- Same owner renews without bump
- Another owner with a live lease: `ActorOwnershipConflictError`
- Expired lease or `force: true`: generation `+ 1`

Every `commit()` with a generation checks `_actor_ownership`. A stale generation or wrong
`ownerId` throws `StaleOwnerWriteError` and rolls back. Operators do not implement this protocol;
the runtime does.

`ActorRuntime({ ownerId, autoAcquireOwnership })` acquires on invoke when `ownerId` is set
(`autoAcquireOwnership` defaults true in that case). If auto-acquire is off, a non-owner with an
unexpired lease gets `ActorNotOwnerError`.

## Deduplication, deadlines, and backpressure

- `_actor_idempotency` is written in the **same commit** as state
- A later request with the same `requestId` returns the cached result (`cached: true`) without
  re-running the method
- In-flight duplicate `requestId`s join the same promise
- `deadline` is checked before enqueue **and** after dequeue → `ActorDeadlineExceededError`
- `maxMailboxSize` → `ActorBackpressureError`

Transport is at-least-once. The idempotency cache makes **storage-side** execution once per
`requestId`. External side effects (HTTP, email) must still be idempotent: a successful commit
can precede a lost response (`MemoryActorTransport.dropNextResponse()` tests this). Do not treat
that as exactly-once I/O.

## Multi-process example

There is no workspace app for this path. The package tests spawn workers:

- `packages/di-framework-actors/tests/multi-process.test.ts`
- `tests/harness/worker.ts` (`Bun.spawn`, shared `baseDir`, `fileLocking: false`, `ownerId`)
- `tests/harness/cluster.ts`

Covered: competing acquire (one generation 1, the other `ActorOwnershipConflictError`), crash +
`force: true` failover (generation 2, recovered state), expired deadline with no side effects,
stale-owner commit, and duplicate delivery after a lost response.

```bash
bun test packages/di-framework-actors/tests/multi-process.test.ts
```

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `ActorAuthorizationError` | Caller, namespace, type, or method not on the policy |
| `StaleOwnerWriteError` | Another owner took the generation; retry after re-acquire |
| `ActorOwnershipConflictError` | Live lease on another `ownerId`; wait, expire, or `force` |
| `ActorDeadlineExceededError` | `deadline` passed before or after mailbox admission |
| `ActorBackpressureError` | Mailbox deeper than `maxMailboxSize` |
| Duplicate side effects | Lost response after commit; make I/O idempotent on `requestId` |

## Next steps

- [Actors](actors.md) - Local runtime, SQLite, and CLI
- [Private service bindings](service-bindings.md) - In-process named contracts, not actor RPC
- [RPC](rpc.md) - JSON-RPC / gRPC for ordinary services
- [Deployment](deployment.md) - Target runtimes
