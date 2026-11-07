# Embedded PostgreSQL and Encryption at Rest

`@di-framework/pglite-component` (`di-framework:pglite/database@0.2.0`) embeds a single-backend PostgreSQL engine as a WASI WebAssembly component inside the workload composition. Instead of connecting over TCP to an external database service through `wasmcloud:postgres`, the component executes SQL calls in-process across WIT and persists its `PGDATA` directory on the workload's mounted WASI filesystem volume.

When combined with `@di-framework/pglite-encfs`, the PostgreSQL data directory is encrypted at rest at the WASI filesystem boundary before reaching the host volume.

## Overview and When to Use

Choose embedded PostgreSQL (`@di-framework/pglite-component`) when a workload needs full PostgreSQL SQL semantics, interactive multi-statement transactions (`BEGIN` / `COMMIT` / `ROLLBACK` and savepoints), `plpgsql`, or `pgcrypto` without external database infrastructure:

| Capability | Embedded PostgreSQL (`@di-framework/pglite-component`) | Managed PostgreSQL (`wasmcloud:postgres@0.2.0`) |
| --- | --- | --- |
| **Execution model** | Bundled WASI component composed into the workload; SQL runs in-process with no network hop. | External PostgreSQL service accessed over the network via a host connection pool. |
| **Transactions** | Interactive `transaction(fn)` with `BEGIN`, `COMMIT`, `ROLLBACK`, and nested `SAVEPOINT` support over an exclusive connection. | Autocommit per call (`openPostgresDatabase`) or write-only single-query `atomicBatch`; no cross-call connection affinity. |
| **Scaling & concurrency** | Single-owner `PGDATA` (`replicas: 1`, `Recreate` rollout strategy). | Multi-replica horizontal scaling backed by a connection pool. |
| **Encryption at rest** | Component-level WASI filesystem encryption via `@di-framework/pglite-encfs`. | Delegated to cluster storage class or disk-level encryption. |

### Bundled Extensions

The embedded engine ships with `plpgsql` enabled by default and `pgcrypto` linked statically:

- Enable `pgcrypto` with `CREATE EXTENSION IF NOT EXISTS pgcrypto;` for `digest()`, `hmac()`, `crypt()`, `gen_salt()`, `pgp_sym_encrypt()`, `pgp_sym_decrypt()`, `pgp_pub_encrypt()`, and `pgp_pub_decrypt()`, alongside built-in `gen_random_uuid()`.
- Legacy cipher algorithms (`bf`, `cast5`, and single `des`) are disabled for PGP/cipher operations; use `aes128`, `aes192`, or `aes256` (`crypt()` password hashing with `gen_salt('bf')` remains supported).

## Application Adapter (`createWasmPgliteDatabase`)

Guest applications wrap the `di-framework:pglite/database@0.2.0` WIT import with `createWasmPgliteDatabase` from `@di-framework/repo/postgres` to obtain a full `SqlDatabase` implementation compatible with `@di-framework/repo` repositories and `MigrationRunner`:

```typescript
import { MigrationRunner, type SqlDatabase } from '@di-framework/repo';
import { createWasmPgliteDatabase } from '@di-framework/repo/postgres';

const db: SqlDatabase = await createWasmPgliteDatabase(
  process.env.DI_PGLITE_DATA_DIR ?? '/data/pglite',
);

// Run schema migrations against embedded PostgreSQL
const runner = new MigrationRunner({ db, binding: 'orders' });
await runner.execute();

// Interactive multi-statement transactions and nested savepoints
await db.transaction(async (tx) => {
  await tx.run(
    'INSERT INTO orders (id, customer_id, total_cents, meta) VALUES (?, ?, ?, ?)',
    ['0195f3c0-0000-7000-8000-000000000001', 'cust_42', 12500n, { currency: 'USD' }],
  );

  // Nested transaction() calls open a SAVEPOINT
  await tx.transaction(async (sp) => {
    await sp.run('INSERT INTO order_audit (order_id, event) VALUES (?, ?)', [
      '0195f3c0-0000-7000-8000-000000000001',
      'created',
    ]);
  });
});

const order = await db.first<{ id: string; total_cents: number; meta: { currency: string } }>(
  'SELECT id, total_cents, meta FROM orders WHERE id = ?',
  ['0195f3c0-0000-7000-8000-000000000001'],
);
```

### `SqlDatabase` Contract and Type Mapping

The provider opens a single connection per component instance and serializes concurrent calls:

- **Methods:** `query<T>(sql, params?)`, `first<T>(sql, params?)`, `run(sql, params?)` returning `{ changes: number }`, `exec(sql)`, `transaction(fn)`, and `close()`.
- **Transactions and savepoints:** Root `db.transaction(fn)` calls execute `BEGIN`, `COMMIT`, and `ROLLBACK` on error. Nested `tx.transaction(fn)` calls issue `SAVEPOINT`, `RELEASE SAVEPOINT`, and `ROLLBACK TO SAVEPOINT`, allowing inner work to roll back without aborting the outer transaction. Use the callback parameter (`tx`) inside `fn` so statements join the active transaction across async boundaries.
- **Placeholder rewriting (`toPgPlaceholders`):** SQLite-style `?` placeholders are rewritten to positional `$1`, `$2`, ... parameters when `params` is non-empty. Quoted strings, quoted identifiers, dollar-quoted blocks, SQL comments, and `jsonb` `?|` / `?&` operators are preserved. For the bare `jsonb` key-existence `?` operator in a parameterized statement, use `jsonb_exists(col, ?)`. Do not mix `?` and `$n` in the same statement.
- **Parameter and result type mapping:**
  - `int8` / integers: Safe integers (`number` or `bigint` within `±(2^53 - 1)`) are bound as `int8` and returned as `number`. `bigint` values beyond `±(2^53 - 1)` within signed 64-bit range are bound as `int8` `BigInt` payloads and decoded as exact decimal strings. `bigint` values outside 64-bit `int8` range are sent as decimal `text` for `numeric` columns. Passing an unsafe integer `number` throws a `TypeError`.
  - `timestamptz` and `Date`: Every connection pins `DateStyle=ISO` and `TimeZone=UTC`. `Date` parameters are sent as RFC 3339 UTC strings (`toISOString()`), and `timestamptz` result cells are returned as RFC 3339 UTC strings (`YYYY-MM-DDTHH:MM:SS.mmmZ`).
  - `bytea`: `Uint8Array`, `ArrayBuffer`, and typed arrays are bound as `bytea` and returned as `Uint8Array`.
  - `json` / `jsonb`: Plain objects and arrays are serialized with `JSON.stringify` and parsed back with `JSON.parse` on read.
- **Errors:** Provider errors throw `WasmPgliteError` with the PostgreSQL SQLSTATE in `error.code` (such as `'23505'` for unique violations) and a message prefixed with `PostgreSQL <code>`, matching `isUniqueViolation` from `@di-framework/repo`.

## CLI Configuration (`di-framework.config.json`)

Configure embedded PostgreSQL in `di-framework.config.json` under the `"pglite"` block:

```json
{
  "name": "orders",
  "entry": "src/app.ts",
  "pglite": {
    "image": "ghcr.io/di-framework/pglite-component@sha256:<digest>",
    "storageMount": "/data",
    "dataDir": "/data/pglite"
  }
}
```

| Field | Default | Description |
| --- | --- | --- |
| `pglite.image` | Required (unless `wasm` is set) | Immutable OCI component reference pinned by `@sha256:<digest>`. Mutable tags are rejected. |
| `pglite.wasm` | None | Local `.wasm` file path inside the project for offline development (or `DI_FRAMEWORK_PGLITE_WASM`). Refused by `platform deploy` and in CI unless `DI_FRAMEWORK_ALLOW_LOCAL_PGLITE=1` is set. |
| `pglite.storageMount` | `"/data"` | Mounted WASI filesystem preopen path (resolved against `wasmcloud.storage.mounts`; tenant targets accept `/data` or `/data/actors`). |
| `pglite.dataDir` | `"<storageMount>/pglite"` (`/data/pglite`) | Database root directory under `storageMount`, injected into the guest environment as `DI_PGLITE_DATA_DIR`. Setting a conflicting `wasmcloud.env.DI_PGLITE_DATA_DIR` or configuring two workload members with the same database root fails with `WASMCLOUD_PGLITE_DATA_DIR_CONFLICT`. |
| `pglite.encryption` | None | Optional `@di-framework/pglite-encfs` configuration (`{ "image": "ghcr.io/di-framework/pglite-encfs@sha256:<digest>" }` or local `wasm`); see [Encryption at Rest](#encryption-at-rest). |

During `di-framework platform build`, the CLI pulls and verifies the digest-pinned `pglite-component` artifact with `oras` and composes it into the application component.

### Single-Instance Execution

Because PostgreSQL locks its `PGDATA` directory to a single process, `di-framework platform deploy` configures pglite workloads for single-instance execution (`replicas: 1`, `Recreate` rollout strategy, and `di-framework.dev/exclusive-instance: "true"`). Any configuration with `replicas > 1` is rejected.

## Encryption at Rest (`@di-framework/pglite-encfs`) {id="encryption-at-rest"}

`@di-framework/pglite-encfs` interposes on the WASI filesystem imports between `pglite-component` and the host so every file under `PGDATA` is encrypted before it is written to the volume.

### Configuring Encryption

Add `pglite.encryption` and declare `"DI_PGLITE_KEY"` in `controlSecretKeys`:

```json
{
  "name": "orders",
  "entry": "src/app.ts",
  "controlSecretKeys": ["DI_PGLITE_KEY"],
  "pglite": {
    "image": "ghcr.io/di-framework/pglite-component@sha256:<digest>",
    "encryption": {
      "image": "ghcr.io/di-framework/pglite-encfs@sha256:<digest>"
    }
  }
}
```

Omitting `DI_PGLITE_KEY` from `controlSecretKeys` when `pglite.encryption` is set fails `di-framework platform build` with `WASMCLOUD_PGLITE_KEY_UNDECLARED`.

### Key Provisioning and Rotation

`pglite-encfs` requires a 256-bit master key (64 hex characters or 32 random bytes encoded in base64). It reads `DI_PGLITE_KEY` once at initialization and strips `DI_PGLITE_KEY` and `DI_PGLITE_KEY_PREVIOUS` from the environment visible to the PostgreSQL engine.

Provision the key before deploying. On a controller-backed (`/v1`) target, set secret `di-pglite-key` (which the controller exposes to the workload as `DI_PGLITE_KEY`):

```bash
# Via the platform CLI extension:
openssl rand -base64 32 | di-framework platform secrets set di-pglite-key --env prod --from-file -

# Or via the tenant CLI:
openssl rand -base64 32 | di-tenant secrets set di-pglite-key --env prod --from-file -
```

On a kubeconfig-backed target, write `DI_PGLITE_KEY` into the workload's `<deployment>-control` Secret in the target namespace.

To rotate the master key:

1. Declare both `"DI_PGLITE_KEY"` and `"DI_PGLITE_KEY_PREVIOUS"` in `controlSecretKeys`, set `DI_PGLITE_KEY` to the new 256-bit key, and set `DI_PGLITE_KEY_PREVIOUS` (`di-pglite-key-previous` on `/v1` targets) to the existing key.
2. Redeploy or restart the workload. On startup, `pglite-encfs` verifies the existing volume against `DI_PGLITE_KEY_PREVIOUS` and re-wraps the volume's file keys under `DI_PGLITE_KEY`.
3. Once startup logs `pglite-encfs: key rotation complete`, remove `DI_PGLITE_KEY_PREVIOUS`.

> **Fail-closed semantics and key custody:** If `DI_PGLITE_KEY` is missing, malformed, or does not match the encrypted volume (and `DI_PGLITE_KEY_PREVIOUS` does not match), or if an unencrypted directory is mounted under `pglite-encfs`, the component refuses access before any byte is written. Back up `DI_PGLITE_KEY` separately from volume backups—losing the key renders the volume unreadable.
{style="warning"}
