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

## Next steps

- [Installation](installation.md) - Companion packages
- [Testing](testing.md) - Isolated containers alongside actor runtimes
- [API Reference](api-reference.md) - Core container API
- [CLI](cli.md) - Canonical command tree
