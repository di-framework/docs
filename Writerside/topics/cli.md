# CLI

`di-framework` is the project's only public command-line interface. Install it from
`@di-framework/cli`; feature packages expose typed programmatic APIs instead of their own
executables.

Requires [Bun](https://bun.sh). The package ships TypeScript source as its `bin` entry, not a
platform-specific compiled binary.

## Installation

```bash
bun add -d @di-framework/cli
# or one-shot:
bun x @di-framework/cli <command>
```

All examples below use the installed executable:

```bash
di-framework <command> [options]
```

## Canonical command tree

```text
di-framework
├── init
├── build
├── check
├── generate
├── skills
│   ├── index
│   │   ├── build
│   │   ├── inspect
│   │   ├── validate
│   │   ├── query
│   │   └── migrate
│   └── validate
├── http
│   └── openapi
│       └── generate
├── agent
│   ├── audit
│   ├── init
│   ├── inspect
│   └── migrate
├── actor
│   ├── list
│   ├── inspect
│   ├── reset
│   └── clean
├── mx
│   ├── build
│   ├── test
│   ├── typecheck
│   └── publish
├── migrations
│   ├── status
│   └── execute
├── queue
│   ├── list
│   ├── inspect
│   └── retry
└── extensions
    ├── install
    ├── uninstall
    └── list
```

This tree is exhaustive for built-in commands. There are no public command aliases,
deprecated routes, or package-specific alternatives. In particular, maintainer commands are
available only below `di-framework mx`. The single sanctioned extension point is the
installed-extension namespace: a top-level token that is not a built-in command may dispatch to an
installed [CLI extension](#extensions).

| Command | Purpose |
| --- | --- |
| `init` | Scaffold an application. |
| `build` | Build an application, including configured runtime type transforms. |
| `check` | Typecheck an application without emitting output. |
| `generate` | Generate configured application surfaces from [schema manifests](codegen.md). |
| `skills index build\|inspect\|validate\|query\|migrate` | Build, examine, validate, search, or migrate the skills index. |
| `skills validate` | Validate skill catalogs and report diagnostics. |
| `http openapi generate` | Generate an OpenAPI document from HTTP controllers. |
| `agent audit` | Audit resolved agent configuration and actionable findings without writing files. |
| `agent init` | Preview or create requested neutral agent-configuration assets. |
| `agent inspect` | Inspect resolved agent instructions, skills, precedence, and ignore policy without writing files. |
| `agent migrate` | Preview or apply audited migrations into neutral agent paths. |
| `actor list\|inspect\|reset\|clean` | List, inspect, or reset local actor activations and SQLite files. |
| `mx build\|test\|typecheck\|publish` | Run di-framework monorepo maintainer workflows. |
| `migrations status\|execute` | Show or apply decorator, SQL, and manifest database migrations. |
| `queue list\|inspect\|retry` | List durable queues, inspect jobs, and retry dead-letter work. |
| `extensions install\|uninstall\|list` | Manage installed CLI extensions. |

The command paths and conventions on this page are the stable public contract.

## One executable

`@di-framework/cli` publishes one `bin`: `di-framework`. Application builds,
OpenAPI generation, and monorepo maintenance route through the canonical command
tree above. Agent configuration and Agent Skills commands install as
[`@di-framework/cli-plugin-ai`](ai-cli.md) and run through the same executable. Feature packages remain programmatic libraries and do not
publish package-specific executables. An extension package must not declare a
`bin`; its commands run through `di-framework <name>`.

## App commands

```bash
di-framework init my-api
cd my-api && bun install && bun run dev

di-framework check
di-framework build
di-framework generate
```

`init` installs `@di-framework/tsc` and `@di-framework/cli` by default, sets
`plugins: [{ "transform": "@di-framework/tsc" }]`, and wires `build` and `check` scripts to
`di-framework`. Runtime checks are injected during emit. Development runs source with Bun and does not
perform emit-time checks. The first transformed build needs a Go toolchain; see
[Runtime type checks](tsc.md).

### `init` options

```text
di-framework init [name] [--dir path] [--name package-name] [--force]
```

| Flag | Description |
| --- | --- |
| `--dir`, `-d` | Target directory (default: `./<name>`). |
| `--name`, `-n` | `package.json` name. |
| `--force`, `-f` | Overwrite existing files. |
| `--help`, `-h` | Show help. |

Existing files are skipped unless `--force` is set.

### `generate` options

```text
di-framework generate [--config <path>] [--outDir <path>] [--init] [--check] [--clean]
```

| Flag | Description |
| --- | --- |
| `--config <path>` | Codegen config file (default: `di-framework.codegen.ts` in the working directory). |
| `--outDir <path>` | Override the generated output directory. |
| `--init` | Create missing handler and policy skeletons without overwriting existing files. |
| `--check` | Report drift between manifests and generated files without writing. Exits `1` on drift. |
| `--clean` | Delete stale generated files that carry the codegen ownership header. |

`generate` delegates to `@di-framework/codegen`, which must be resolvable from the project.
JSON `data` is the codegen `GenerateResult`: `success`, `drifted`, `files`, `ledgerPath`, and
`diagnostics`. Unknown arguments exit `2`. See [Schema codegen](codegen.md) for manifests,
emitted surfaces, and the ownership ledger.

## Skills index commands

Install `@di-framework/cli-plugin-ai` (`di-framework extensions install ai`). The
`ai` command group then provides these leaves. They delegate to the typed
`@di-framework/ai-utils` operations; the extension only maps arguments and
presents their results. The project must be able to resolve
`@di-framework/ai-utils`.

## Generate HTTP OpenAPI

```bash
di-framework http openapi generate \
  --controllers ./src/controllers.ts \
  --controllers ./src/admin/controllers.ts \
  --output ./openapi.json
```

`--controllers` is required and repeatable. `--output` may be supplied once and
defaults to `openapi.json`. The handler delegates controller loading, OpenAPI
3.1 generation, and explicit file writing to `@di-framework/http`. JSON `data`
contains `controllerModules`, `outputPath`, and `bytes`. Usage failures exit
`2`; package loading, controller loading, generation, and writing failures exit
`3`.

## Agent configuration commands

These leaves are also part of `@di-framework/cli-plugin-ai` (`di-framework ai agent`).
All four delegate agent-configuration decisions to typed
`@di-framework/ai-utils` APIs. They only discover the neutral `AGENTS.md`,
`.agents/skills`, `~/.agents/skills`, and root `.aiignore` conventions
automatically. An audit may report known vendor assets as migration
opportunities, but those assets are never loaded as active configuration and no
command creates a vendor-specific path or compatibility adapter.

### Audit

## Actor commands

`actor` inspects and resets local [`@di-framework/actors`](actors.md#local-development-discovery-reload-and-inspection)
SQLite storage. It does not start a runtime.

```bash
di-framework actor list [--namespace <name>] [--dir <path>] [--active]
di-framework actor inspect <actorType|identity> \
  [--key <key>] [--namespace <name>] [--dir <path>] [--show-state]
di-framework actor reset --actor <name> \
  [--key <key>] [--namespace <name>] [--dir <path>]
di-framework actor reset --all
di-framework actor clean [same flags as reset]
```

| Option | Description |
| --- | --- |
| `--namespace <name>` | Restrict to this namespace. |
| `--dir <path>` | Storage root; default `.actors`. `--base-dir` is accepted as an alias. |
| `--active` | List only active activations. |
| `--key <key>` | Actor key (inspect; reset requires `--actor`). |
| `--show-state` | Include committed private state (inspect). |
| `--all` | Reset every actor under `--dir`. |

`inspect` requires a positional type or identity (exit 2 if missing). `reset` / `clean` require
`--actor`, `--namespace`, or `--all`. Missing `@di-framework/actors` exits `3`
(`ACTORS_PACKAGE_UNAVAILABLE`). Not found exits `1` (`ACTOR_NOT_FOUND`).

JSON `data`:

- **list:** `{ namespace, baseDir, total, actors: [{ actorId, namespace, actorType, actorKey, status, runningCalls, pendingCalls, storagePath, failedMigration }] }`
- **inspect:** the same identity fields plus `methods`, `failedMigration`, and `state` only with `--show-state`
- **reset/clean:** `{ scope, deactivatedCount, deletedFiles, success }`

## Database migration commands

`migrations` delegates discovery and execution to [`@di-framework/repo`](repositories.md#database-migrations).

```bash
di-framework migrations status [options]
di-framework migrations execute [options]
```

| Option | Description |
| --- | --- |
| `--db <path>` | SQLite path. Default: `DATABASE_URL` \|\| `DB_PATH` \|\| `./dev.db`. |
| `--dir <path>` | SQL directory. Default `./migrations` when no manifest is present. |
| `--manifest <path>` | JSON manifest. Default `migrations.json` if that file exists. |
| `--binding <name>` | Binding name; default `default`. |
| `--module <path>` | Repeatable. Import modules so `@Migration` classes register. |
| `--step <count>` | Execute only: maximum pending migrations to apply. |
| `--dry-run` | Execute only: plan without applying. |

JSON `data` is `{ binding, isUpToDate, applied, pending }` for status and
`{ binding, applied, pending, dryRun, durationMs }` for execute. A requested `--binding` that
does not match discovered migrations exits `2` (`MIGRATION_BINDING_MISMATCH`). Connect and runner
failures exit `1`.

## Durable queue commands

`queue` inspects the SQLite job table used by [`@di-framework/queues`](queues.md). It does not
start a worker.

```bash
di-framework queue list [--db <path>]
di-framework queue inspect <name> \
  [--db <path>] [--status <status>] [--limit <n>]
di-framework queue retry <name> [jobId] [--db <path>]
```

| Option | Description |
| --- | --- |
| `--db <path>` | SQLite path; `:memory:` allowed. |
| `--status <status>` | `pending` \| `processing` \| `completed` \| `dead-letter` (inspect). |
| `--limit <n>` | Positive integer; default `50` (inspect). |
| `[jobId]` | Retry one dead-letter job; omit to retry all dead-letter jobs in that queue. |

Database path: `--db` → `DI_QUEUE_DB` → existing `.di-framework/queue.db` → existing `queue.db`
→ else `.di-framework/queue.db`. JSON `data` is `{ queues }` for list, `{ jobs }` for inspect,
and `{ retried }` for retry. Missing `@di-framework/queues` exits `3`
(`QUEUES_PACKAGE_UNAVAILABLE`). Invalid options exit `2`.

## Maintainer commands

The `mx` group is only for the di-framework monorepo:

```bash
di-framework mx build
di-framework mx build --sync-versions
di-framework mx test
di-framework mx typecheck
di-framework mx publish
```

Top-level maintainer aliases are not part of the public command tree.

## Extensions

Optional capabilities ship as installable extensions so the core CLI stays lean. Installing an
extension adds one top-level command named after it:

```bash
di-framework extensions install platform
di-framework platform doctor

di-framework extensions list
di-framework extensions uninstall platform
```

| Command | Behavior |
| --- | --- |
| `extensions install <spec>` | Install an extension package into the user-global store. |
| `extensions uninstall <name-or-package>` | Remove an installed extension. |
| `extensions list` | List installed extensions with their package names and versions. |

`<spec>` is an npm package name with an optional version range (`platform`,
`@di-framework/cli-plugin-platform@^6`). A bare `<name>` resolves to the canonical
`@di-framework/cli-plugin-<name>` package. Extensions are ordinary npm packages named by
convention:

- `@di-framework/cli-plugin-<name>` — canonical, first-party.
- `di-framework-cli-plugin-<name>` and `@<scope>/di-framework-cli-plugin-<name>` — third-party.

The store is a private package directory at `~/.di-framework/extensions`, overridden by
`DI_FRAMEWORK_EXTENSIONS_DIR`. An extension package present in the current project's
`node_modules` overrides the user-global installation, so projects can pin an exact extension
version as a normal dependency.

Dispatch rules:

- Built-in commands always win. Extension resolution only runs for top-level tokens that are not
  in the canonical tree, and installing an extension whose name collides with a built-in command
  or `help` is rejected.
- The extension manifest — the package default export, built with `defineExtension` from
  [`@di-framework/cli-extension`](https://www.npmjs.com/package/@di-framework/cli-extension) — is
  structurally validated before its command tree is mounted; an invalid or misnamed manifest is
  rolled back at install time and reported with a stable error code at dispatch time.
- Mounted extension commands inherit this page's contract in full: help forms, the JSON envelope,
  and the exit-status table all behave exactly as for built-in commands.

Root help lists installed extensions alongside the built-in tree. First-party extensions:

- [Platform](platform.md) (`@di-framework/cli-plugin-platform`) builds, serves, and deploys WASI 0.3 components.
- [AI CLI](ai-cli.md) (`@di-framework/cli-plugin-ai`) inspects and manages agent configuration and Agent Skills. Through 5.x those commands shipped in `@di-framework/cli`. In 6.0 they moved to this extension when AI moved to [di-framework/ai](https://github.com/di-framework/ai).

Authors of new extensions start from
`@di-framework/cli-extension`, which provides the manifest contract, the command-node types, and
`CommandFailure`.

## Naming and help

- Command names are lowercase English words in `kebab-case`. Groups use nouns and operations use
  imperative verbs.
- `di-framework help`, `di-framework --help`, and `di-framework -h` show root help. Every group and leaf
  accepts the same three help forms for that node.
- Explicitly requested help goes to standard output with exit status `0`. An incomplete group writes its
  help to standard error with exit status `2`.
- Help includes usage, available children or options, and a short description.
- Unknown commands identify the invalid token and show the nearest group help. Leaf handlers reject
  unknown options, missing option values, duplicate single-value options, and extra positional arguments.
  Arguments are never silently ignored.
- Global `--json` is accepted before or after the canonical command path. Command-specific options follow
  the complete command path.

## Text, JSON, and errors

Normal text and explicitly requested help go to standard output; errors go to standard error. In JSON
mode the command writes exactly one JSON value followed by a newline to standard output and no
presentation text.

A successful result has this envelope:

```json
{
  "schemaVersion": 1,
  "command": "skills validate",
  "ok": true,
  "data": {}
}
```

`command` is the canonical space-separated path. `data` is the typed package result or a documented
command-specific object. A failure omits `data` and uses a stable error code:

```json
{
  "schemaVersion": 1,
  "command": "skills validate",
  "ok": false,
  "error": {
    "code": "INVALID_USAGE",
    "message": "Invalid value for --source-mode: invalid",
    "details": {
      "token": "--source-mode",
      "value": "invalid"
    }
  }
}
```

`details` is optional. JSON failures use standard output so automation has a single parseable channel;
unexpected internal diagnostics may also use standard error. JSON property names and enum values are a
stable API. JSON output never includes colors, icons, or environment-dependent formatting.

## Exit status

| Status | Meaning |
| --- | --- |
| `0` | The command succeeded, including explicitly requested help. |
| `1` | The operation completed with a negative domain result, such as validation findings or drift. |
| `2` | Command usage or configuration is invalid. |
| `3` | An unexpected execution, filesystem, or dependency failure prevented a result. |

## Package ownership

```text
feature package = domain behavior + typed results
@di-framework/cli and installed extensions =
  arguments + presentation + exit status
```

| Layer | Owns | Does not own |
| --- | --- | --- |
| Feature packages | Domain validation and transformations, typed options and results, explicit write APIs, and progress callbacks. | Argument parsing, terminal formatting, process globals, or exit status. |
| CLI and extension command handlers | Mapping parsed arguments to package options and typed results to presentation models. | Copied indexing, generation, audit, migration, validation, or other domain algorithms. |
| CLI infrastructure | Nested routing, help, injectable I/O, JSON envelopes, typed command failures, and centralized exit translation. | Feature-specific business rules. |

`@di-framework/cli-plugin-ai` follows that split: it maps `di-framework ai`
arguments and presentation, and `@di-framework/ai-utils` owns the agent and
skills operations. See [AI CLI](ai-cli.md).

Command handlers return results or throw typed command failures. They do not call `process.exit()`, write
through global `console`, or translate domain results into exit statuses. Tests at the CLI boundary must
prove delegation to package APIs. If a workflow cannot be exposed without copying package internals, its
typed package API is extended first.

## Next steps

- [Installation](installation.md) - Core package and CLI setup
- [Quick Start](quick-start.md) - Basics after scaffolding
- [Platform](platform.md) - Build and deploy apps as WebAssembly components
- [Platform backing services](backing-services.md) - `platform service create/list/get/delete/classes` for tenant Redis, NATS, blobstore, PostgreSQL, and egress requests; `platform console` opens the tenant panel
- [Kubernetes with di-framework-kube](kube.md) - Separate platform CLI and live example deployment workflow
- [HTTP Router](http-router.md) - HTTP routing, OpenAPI generation, and static assets
- [Private service bindings](service-bindings.md) - Named in-process contracts (no dedicated CLI command)
- [Scheduling](scheduling.md) - `@Cron` (discovered by `platform build`, no `cron` group)
- [Queues](queues.md) - Durable jobs and `queue list` / `inspect` / `retry`
- [Repositories](repositories.md#database-migrations) - Decorator, SQL, and manifest migrations
- [Actors](actors.md) - Local runtime, persistence, and `actor` commands
- [AI CLI](ai-cli.md) - `di-framework ai` agent and skills commands (`@di-framework/cli-plugin-ai`)
- [Agents](ai-utils.md) - Skills, plugins, and skill-index programmatic APIs
- [Runtime type checks](tsc.md) - Emit-time transforms wired by `init`
