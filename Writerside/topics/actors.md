# Actors

`@di-framework/actors` is a local virtual-actor runtime: decorated classes, typed references,
serialized mailboxes per actor identity, and concurrent execution across identities. The package
runs on Bun with no Wasm toolchain and no wasmCloud host.

> These APIs landed on di-framework `main` after the
> [v5.3.0](https://github.com/di-framework/di-framework/releases/tag/v5.3.0) tag
> ([PR #415](https://github.com/di-framework/di-framework/pull/415), closing
> [di-framework#407](https://github.com/di-framework/di-framework/issues/407)).
> They are documented here on **latest** (EAP). `@di-framework/actors` is not on npm as of that
> tag and is not in the frozen `/v5.3/` snapshot.

This page is the actors entry topic. Persistence, local tooling, remote invocation, and wasmCloud
deployment extend it rather than introducing a second getting-started path.

SQLite persistence and per-actor migrations are covered [below](#sqlite-persistence).

## Installation

```bash
bun add @di-framework/actors @di-framework/core
```

The default entry re-exports `SqliteActorStorage`, which imports `bun:sqlite`. Tests in this
package run under **Bun**. There is no `engines` field and no Node-only default entry that omits
`bun:sqlite`. For a graph without `bun:sqlite`, import `@di-framework/actors/portable` and use
in-memory storage.

`@di-framework/actors/testing` imports `bun:test`. Do not import it from production code.

```typescript
import {
  Actor,
  ActorMethod,
  ActorContext,
  ActorRuntime,
} from '@di-framework/actors';
```

## Define an actor

```typescript
@Actor({ name: 'CounterActor', namespace: 'examples' })
class CounterActor {
  @ActorContext()
  private ctx!: ActorContext;

  private scratch = 0; // instance field — not durable storage

  async onActivate(): Promise<void> {}
  async onDeactivate(): Promise<void> {}

  @ActorMethod()
  async increment(step = 1): Promise<number> {
    const current = (await this.ctx.storage.get<number>('count')) ?? 0;
    const next = current + step;
    await this.ctx.storage.set('count', next);
    return next;
  }

  @ActorMethod()
  async getCount(): Promise<number> {
    return (await this.ctx.storage.get<number>('count')) ?? 0;
  }
}
```

`@Actor` accepts `@Actor`, `@Actor()`, `@Actor('Name')`, or
`@Actor({ name?, namespace?, description?, migrations? })`. Default name is the class name.

`@ActorMethod` / `@ActorMethod({ name?, timeout? })` exposes a mailbox method. `timeout` is
milliseconds; on timeout the invocation rejects with
`Actor method '<type>.<method>' timed out after <n>ms.`

`ActorContext` injects as a property decorator (`@ActorContext` / `@ActorContext()`) or via
`ActorContext.current()`. Fields: `actorId`, `actorKey`, `actorType`, `storage`, `actors`,
optional `database`.

Identity:

- with a namespace: `` `${namespace}:${name}:${actorKey}` ``
- without: `` `${name}:${actorKey}` ``

Default metadata namespace is `'default'`, but the runtime only prefixes identity when a
namespace is set on the decorator, `register()`, or `ActorRuntime({ namespace })`.

## Register and call

There is no implicit DI activation. Register classes on an `ActorRuntime` (or the process
singleton `actors`):

```typescript
const runtime = new ActorRuntime(); // default: InMemoryActorStorage
runtime.register(CounterActor);

const counter = runtime.get(CounterActor, 'primary');
await counter.increment(1);
console.log(await counter.getCount());
```

`runtime.get(ActorClass | string, actorKey)` returns a typed `ActorRef<T>`. Obtaining a ref does
not activate; the first method call does.

Lookups accept the class constructor, a short name, or a qualified `'namespace:actorName'`.
Duplicate short names throw `ActorAmbiguityError`. Missing registration throws
`ActorNotRegisteredError`. Missing methods throw `ActorMethodNotFoundError`.

```typescript
runtime.invoke(CounterActor, 'primary', 'increment', [1]);
await runtime.deactivate(CounterActor, 'primary');
await runtime.clear();
```

The [counter-actor example](https://github.com/di-framework/di-framework/tree/main/examples/packages/counter-actor)
is the runnable local walkthrough (`bun run index.ts` / `bun test`).

## Mailbox, concurrency, and errors

- Invocations on one identity run **one-by-one**, including inner `await`s.
- Distinct identities run **concurrently**.
- Calling the same actor through a reference from an active invocation throws a reentrancy error.
  Call `this.otherMethod()` to share the current invocation and transaction. Indirect cycles
  such as A→B→A also reject while the earlier invocation remains active.
- `maxMailboxSize` rejects excess work with `ActorBackpressureError`.
- Closed admission (reload/deactivation) rejects new enqueues with `ActorAdmissionClosedError`.
- Clearing a mailbox rejects queued calls.
- A method timeout rolls back the storage transaction and **does not cancel** JavaScript already
  running in the method. Late storage access rejects. A failed activating call or a timeout
  **evicts** the instance so the next call can activate again.

Instance fields are not actor storage. Only `ctx.storage` participates in the transaction
(commit on success, rollback on throw). The default in-memory adapter keeps that state until
`runtime.clear()` / process exit; it is not a durable log and is not a substitute for message
delivery guarantees.

## Testing

Register explicitly. Use the default in-memory storage, or see persistence for temporary SQLite.

```typescript
import { describe, it, expect, afterEach } from 'bun:test';
import { ActorRuntime } from '@di-framework/actors';

describe('CounterActor', () => {
  const runtime = new ActorRuntime();
  runtime.register(CounterActor);

  afterEach(async () => {
    await runtime.clear();
  });

  it('increments', async () => {
    const counter = runtime.get(CounterActor, 'test');
    expect(await counter.increment(2)).toBe(2);
    expect(await counter.getCount()).toBe(2);
  });
});
```

Contract helpers live in `@di-framework/actors/testing`:

```typescript
import { defineActorContractSuite } from '@di-framework/actors/testing';

defineActorContractSuite({
  name: 'in-memory',
  createAdapter: async () => ({ storage: /* ActorStorage */ }),
});
```

That entry also exports `ContractCounterActor` and `ContractFailingMigrationActor`. Direct method
tests (calling `increment` on a plain instance) skip the mailbox and storage transaction; runtime
tests go through `runtime.get(...)`.

## SQLite persistence

> Persistence landed in [PR #418](https://github.com/di-framework/di-framework/pull/418)
> (closing [di-framework#408](https://github.com/di-framework/di-framework/issues/408)), after
> the v5.3.0 tag.

```typescript
import { ActorRuntime, SqliteActorStorage } from '@di-framework/actors';

const storage = new SqliteActorStorage({ baseDir: './.actors' });
const runtime = new ActorRuntime({ storage, namespace: 'examples' });
runtime.register(CounterActor);

const counter = runtime.get(CounterActor, 'primary');
await counter.increment(1);
await runtime.clear();

const restarted = new ActorRuntime({
  storage: new SqliteActorStorage({ baseDir: './.actors' }),
  namespace: 'examples',
});
restarted.register(CounterActor);
console.log(await restarted.get(CounterActor, 'primary').getCount()); // 1
```

`SqliteActorStorage` options: `baseDir` (default `.actors`), `inMemory`, `temp`,
`maxConnections` (default 50 — cached connections, not retained databases), `idleTimeoutMs`
(default 30000), `fileLocking` (default `!inMemory`). `SqliteActorStorage.temporary()` creates a
temp directory and `close()` removes it.

Each actor identity maps to `{baseDir}/{namespace}/{actorName}/{safePrefix}_{hash}.db`. Path
traversal throws. Databases open lazily. WAL + `BEGIN IMMEDIATE` on commit. Instance fields are
still not durable — only `ctx.storage` (and optional SQL through `ctx.database` / migration
`ctx.run`).

A second process that holds `{path}.lock` cannot open the same actor DB (`ActorLockError`).
`lockTimeoutMs` does not expire a live lock. This is local file locking, not distributed
ownership.

Committed state survives deactivation and process restart against the same directory. Host-loss
recovery is a storage/volume concern; losing the files loses the actor.

### Transactions

Each method runs in a storage transaction. Success commits; a thrown error rolls back. The
counter-actor `failingAction` example writes then throws — the increment is discarded.

### Tests

```typescript
const storage = SqliteActorStorage.temporary();
const runtime = new ActorRuntime({ storage });
runtime.register(CounterActor);
// ...
await runtime.clear();
await storage.close();
```

`{ inMemory: true }` keeps one SQLite database per actor until `close()`, including actors
evicted from the connection cache. Close test storage after use; use file-backed storage for
long-lived deployments with many actor IDs.

## Actor migrations

Migrations run **before** the first activation processes calls. Failed migrations throw
`ActorMigrationError` and block activation.

Sources, first-wins on version:

1. `@Actor({ migrations })` / `register(..., { migrations })`
2. `@ActorMigration({ actor, version, description })`
3. `@di-framework/repo` `@Migration` classes whose `binding === actorType`

On SQLite adapters the runner is [`MigrationRunner`](repositories.md#database-migrations) against
**that actor's database**, with history in `_migrations`. In-memory storage runs `up` without SQL
(`db` is null; `sql`/`run` are no-ops).

```typescript
@Actor({
  name: 'CounterActor',
  namespace: 'examples',
  migrations: [
    {
      version: '1',
      description: 'Initialize counter schema',
      up: async (ctx) => {
        if (ctx.db) {
          await ctx.db.run(`CREATE TABLE IF NOT EXISTS counter_stats (
            id TEXT PRIMARY KEY,
            total INTEGER NOT NULL
          );`);
        }
      },
    },
  ],
})
class CounterActor {}
```

`ActorMigrationContext` includes `actorId`, `actorType`, `actorKey`, `version`, `description`,
`db`, `sql`, `run`, and `storage`. Inactive actors upgrade on next activation. Rolling back
application code does not undo schema (`down` is stored and not executed).

## Local development: discovery, reload, and inspection

> Tooling landed in [PR #420](https://github.com/di-framework/di-framework/pull/420)
> (closing [di-framework#409](https://github.com/di-framework/di-framework/issues/409)), after
> the v5.3.0 tag. No external services or Wasm tooling are required.

### Discovery

```typescript
import { discoverActorClasses, generateActorRegistration } from '@di-framework/actors';

const actors = await discoverActorClasses({ rootDir: 'src' });
const registrationCode = generateActorRegistration(actors);
```

The walker reads `.ts` / `.js` (skips `.d.ts`, `.test.ts`, `.spec.ts`, `node_modules`, `dist`,
`.git`, `build`). A file must mention `@Actor` or `@di-framework/actors` before it is imported.
`patterns` on `ActorDiscoveryOptions` is unused. Tests still register classes explicitly.

`runtime.discoverAndRegister(options?)` and `ActorDevManager.discoverAndRegister` wrap the same
walk. Namespaces isolate applications: two `ActorRuntime` instances with `namespace: 'app-a'`
and `'app-b'` can both register `CounterActor`.

### Reload

```typescript
await runtime.reload({
  policy: 'drain', // or 'fail'
  timeoutMs: 5000,
  actors: [UpdatedActorClass],
});
```

Sequence: stop admission → drain or fail unstarted work → `onDeactivate` → release SQLite
connections and file locks → optional re-register → **clear the migration cache** so new
migrations run before the next call.

| Policy | Queued work |
| --- | --- |
| `drain` (default) | Pending invocations complete |
| `fail` | Unstarted queued tasks reject with `ActorReloadError` |

**Preserved:** committed SQLite files / in-memory committed keys. **Not preserved:** in-memory
activations, mailboxes, uncommitted staged writes. Startup and reload **never delete**
persistent state. A reload timeout aborts reload and restores admission without closing an
active transaction.

### CLI

```text
di-framework actor list [--namespace <name>] [--dir <path>] [--active]
di-framework actor inspect <actorType|identity> [--key <key>] [--namespace <name>] [--dir <path>] [--show-state]
di-framework actor reset --actor <name> [--key <key>] [--namespace <name>] [--dir <path>]
di-framework actor reset --all
di-framework actor clean …   # alias for reset
```

Default `--dir` is `.actors`. Inspect does not dump private state unless `--show-state`. Reset
requires `--actor`, `--namespace`, or `--all` (exit 2 otherwise).

The [counter-actor example](https://github.com/di-framework/di-framework/tree/main/examples/packages/counter-actor)
walks concurrent calls, persistence across restart, and these commands with `--namespace examples`.

Programmatic equivalents: `runtime.listActors`, `runtime.inspect(..., { showState })`,
`runtime.reset({ namespace?, actorName?, actorKey?, all?, baseDir? })`.

There is no public `fixtures/` package. Tests use `@di-framework/actors/testing` contract actors
or `SqliteActorStorage.temporary()`.

## Next steps

- [Remote actors and ownership](actors-distributed.md) - RPC, fencing, and recovery
- [CLI](cli.md#actor-commands) - `actor list` / `inspect` / `reset` / `clean`
- [Repositories](repositories.md#database-migrations) - Shared `MigrationRunner`
- [Installation](installation.md) - Companion packages
- [Testing](testing.md) - Isolated containers alongside actor runtimes
- [API Reference](api-reference.md) - Core container API
- [CLI](cli.md) - Canonical command tree
