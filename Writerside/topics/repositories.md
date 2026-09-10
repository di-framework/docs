# Repositories

`@di-framework/repo` provides a coherent abstraction of repositories and storage adapters, allowing you to decouple your business logic from the underlying storage technology. It integrates seamlessly with `@di-framework/core`.

## Key Concepts

### Storage Adapter

A `StorageAdapter` is a minimal protocol that every storage backend must implement. It keeps the repository layer agnostic to whether you are using SQL, NoSQL, In-Memory, or an external API.

```typescript
export interface StorageAdapter<E, ID = string | number> {
  findById(id: ID): Promise<E | null>;
  findAll(): Promise<E[]>;
  save(entity: E): Promise<E>;
  delete(id: ID): Promise<boolean>;
  findPaginated(params: PaginationParams): Promise<PaginatedResult<E>>;
  // ...
}
```

### Repository

The `Repository` layer uses a `StorageAdapter` to perform data operations. It can add business logic, caching, validation, or event dispatching.

- `BaseRepository<E, ID>`: The foundational repository class.
- `EntityRepository<E, ID>`: A standard entity-aware repository.
- `SoftDeleteRepository<E, ID>`: Adds `softDelete`, `restore`, and filtering for active/deleted records.

## Installation

```bash
bun add @di-framework/repo
```

## Important: Scoped imports

Always import from the scoped package `@di-framework/core/*` to ensure a single global container instance. Mixing different import IDs (e.g., `di-framework/*` or relative paths to sources) can load a second copy of the library and create a second global container instance.

Correct:

```typescript
import { useContainer } from '@di-framework/core/container';
import { Container, Component } from '@di-framework/core/decorators';
```

Avoid:

```typescript
import { useContainer } from 'di-framework/container'; // Wrong: unscoped id
import { Container } from '../../di-framework/decorators'; // Wrong: relative id
```

## Usage with @di-framework/core

Define a model with Spring/JPA-style `@Model`, `@Id`, and optional `@GeneratedValue` (the class is the type), then register a repository with `@Repository`.

```typescript
import {
  GeneratedValue,
  GenerationType,
  Id,
  IdKind,
  Model,
  Repository,
  InMemoryRepository,
} from '@di-framework/repo';

@Model()
class User {
  @Id()
  @GeneratedValue({ strategy: GenerationType.Identity })
  id!: number;

  @Id({ kind: IdKind.Public })
  @GeneratedValue({ strategy: GenerationType.UUID }) // UUIDv7
  publicId!: string;

  name!: string;
}

@Repository()
class UserRepository extends InMemoryRepository<User, number> {}
```

`IdKind` covers multi-context identity (`Primary`, `Public`, `External`, `Legacy`, `Tenant`, `Version`). Multiple `Primary` fields express a composite primary key. `@GeneratedValue` stacks with `@Id` like JPA; `GenerationType` matches Jakarta (`Auto`, `Identity`, `Sequence`, `Table`, `UUID`), and **UUID means UUIDv7** in this framework.

Plain interfaces still work if you do not need model metadata. Read metadata with `getModelMetadata` / `getIdentities` / `getPrimaryId` / `isModel`. Foreign keys to other models are not `@Id` kinds.

### Injecting Repositories

Once registered, you can inject your repository into any other container-managed class:

```typescript
import { Container, Component } from '@di-framework/core/decorators';

@Container()
class UserService {
  constructor(@Component(UserRepository) private userRepository: UserRepository) {}

  async getUser(id: number) {
    return this.userRepository.findById(id);
  }
}
```

## Built-in In-Memory Repository

For prototyping, testing, or simple local state, use `InMemoryRepository`:

```typescript
const repo = new InMemoryRepository<MyEntity, string>();
await repo.save({ id: '1', name: 'Test' });
const items = await repo.findPaginated({ page: 1, size: 10 });
```

## Custom Adapters

You can implement your own adapter to connect to any data source:

```typescript
import { StorageAdapter, EntityRepository } from '@di-framework/repo';

class PostgresAdapter<E, ID> implements StorageAdapter<E, ID> {
  // Implementation details...
}

@Repository()
class ProductRepository extends EntityRepository<Product, string> {
  constructor() {
    super(new PostgresAdapter<Product, string>());
  }
}
```

## Database migrations

`@di-framework/repo` discovers and applies SQLite schema migrations from decorated classes, SQL
files, and a JSON manifest. The three sources **merge**; they are not mutually exclusive.

> These APIs landed on di-framework `main` after the
> [v5.3.0](https://github.com/di-framework/di-framework/releases/tag/v5.3.0) tag
> ([PR #414](https://github.com/di-framework/di-framework/pull/414), closing
> [di-framework#405](https://github.com/di-framework/di-framework/issues/405)).
> They are documented here on **latest** (EAP) and are not in the frozen `/v5.3/` snapshot.

### Decorator

```typescript
import { Migration, type MigrationExecutionContext } from '@di-framework/repo';

@Migration({
  version: 1,
  description: 'create users table',
  binding: 'default',
})
export class CreateUsersTable {
  async up(ctx: MigrationExecutionContext): Promise<void> {
    await ctx.sql(
      'CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)',
    );
  }

  async down(ctx: MigrationExecutionContext): Promise<void> {
    await ctx.sql('DROP TABLE users');
  }
}
```

`@Migration` requires `version` and `description`. `binding` defaults to `'default'`.
Registration happens at **import time**. The runner constructs `new target()` with no arguments —
constructor DI is not used. `up` is required at execution; `execute` / `run` are accepted aliases.
`down` is stored on the definition but **`MigrationRunner.execute()` never calls it**. There is
no rollback CLI.

### SQL files and JSON manifests

SQL discovery (`discoverSqlMigrations(dir)`): `*.sql` except `*.down.sql`. Version and
description come from header comments or the filename (`001_create_users.sql`,
`V2__add_index.sql`). Split bodies with `-- migrate:up` / `-- migrate:down`.

```sql
-- migration:version 10
-- migration:description create posts table
-- migration:binding default
-- migrate:up
CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT);
-- migrate:down
DROP TABLE posts;
```

Manifest discovery (`discoverManifestMigrations`) reads JSON only (not TOML):

```json
{
  "binding": "ecommerce",
  "migrations": [
    { "version": "1.0", "description": "orders table", "file": "schema.sql" },
    { "version": "1.1", "description": "inline", "sql": "CREATE TABLE items (id INT);" }
  ]
}
```

`entry.file` is resolved relative to the manifest directory. Optional `directory` merges SQL
files; the same `(version, binding)` from the directory is skipped.

### Runner

```typescript
import { MigrationRunner } from '@di-framework/repo';

const runner = new MigrationRunner({ db, binding: 'accounts' });
await runner.execute();
const status = await runner.status();
```

History lives in `_migrations` keyed by `(version, binding)`. A lock table
`_migrations_lock` serializes runners (60s steal timeout). Each successful `up` runs inside
`db.transaction(...)`; a thrown `up` rolls back and does not write history.

Versions: integers compare numerically; strings with `.`, `_`, or `-` compare by dotted
segments (`1.2` < `1.10`). Duplicate versions throw `MigrationIntegrityError`. A pending version
lower than the latest applied throws `MigrationOrderError`.

Checksums: SQL/manifest use `sha256(upSql)`; decorator checksums use `Class.toString()` (native
vs minified Wasm output can disagree).

`autoApply()` applies pending migrations only when `NODE_ENV` is `development` or `test`, unless
`enabled: true`. Nothing in application bootstrap calls it except tests. Actor SQLite databases
reuse this runner on activation with `binding` equal to the actor type. See [Actors](actors.md).

### CLI

```text
di-framework migrations status [options]
di-framework migrations execute [options]
```

| Flag | Behavior |
| --- | --- |
| `--db <path>` | SQLite path. Default: `DATABASE_URL` \|\| `DB_PATH` \|\| `./dev.db` |
| `--dir <path>` | SQL directory (default `./migrations` if no manifest) |
| `--manifest <path>` | JSON manifest (default `migrations.json` if present) |
| `--binding <name>` | Default `default` |
| `--module <path>` | Repeatable; import `@Migration` classes |
| `--step <count>` | Execute only: max pending migrations |
| `--dry-run` | Execute only: plan, do not apply |

JSON `data`: status `{ binding, isUpToDate, applied[], pending[] }`; execute
`{ binding, applied[], pending[], dryRun, durationMs }`. Binding mismatch exits `2`. Connect or
runner failures exit `1`.

### Limitations

- `down` is parsed and stored; it is never executed by the runner or CLI
- SQLite cannot fully roll back some DDL even inside a transaction
- No baseline API, no repeatable migrations, no constructor-injected `Database`
- wasmCloud does not scan `@Migration` classes at build time; actor migrations run in-guest
  before activation

