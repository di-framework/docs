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
├── mx
│   ├── build
│   ├── test
│   ├── typecheck
│   └── publish
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
| `generate` | Generate configured application surfaces. |
| `skills index build\|inspect\|validate\|query\|migrate` | Build, examine, validate, search, or migrate the skills index. |
| `skills validate` | Validate skill catalogs and report diagnostics. |
| `http openapi generate` | Generate an OpenAPI document from HTTP controllers. |
| `agent audit` | Audit resolved agent configuration and actionable findings without writing files. |
| `agent init` | Preview or create requested neutral agent-configuration assets. |
| `agent inspect` | Inspect resolved agent instructions, skills, precedence, and ignore policy without writing files. |
| `agent migrate` | Preview or apply audited migrations into neutral agent paths. |
| `mx build\|test\|typecheck\|publish` | Run di-framework monorepo maintainer workflows. |
| `extensions install\|uninstall\|list` | Manage installed CLI extensions. |

The command paths and conventions on this page are the stable public contract.

## One executable

`@di-framework/cli` publishes one `bin`: `di-framework`. Application builds,
skill indexing, OpenAPI generation, agent operations, and monorepo maintenance
all route through the canonical command tree above. Feature packages remain
programmatic libraries and do not publish package-specific executables. That
includes CLI extensions: an extension package must not declare a `bin`; its
commands run through `di-framework <name>`.

Neutral skill discovery uses `.agents/skills` and `~/.agents/skills`. No
non-neutral path is consulted implicitly.

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

## Skills index commands

The five index leaves delegate to the typed `@di-framework/ai-utils` operations;
the CLI only maps arguments and presents their results:

```bash
di-framework skills index build \
  --skills-dir ./.agents/skills \
  --output ./.di-framework/skills-index.json
di-framework skills index inspect --input ./.di-framework/skills-index.json
di-framework skills index validate \
  --input ./.di-framework/skills-index.json \
  --skills-dir ./.agents/skills
di-framework skills index query \
  --input ./.di-framework/skills-index.json \
  --query 'review TypeScript authorization'
di-framework skills index migrate \
  --input ./older-skills-index.json \
  --output ./.di-framework/skills-index.json
```

| Leaf | Options |
| --- | --- |
| `build` | repeatable `--skills-dir`, repeatable `--skill-file`, `--output`, `--threshold`, `--limit`, `--batch-size`, `--chunk-tokens`, `--chunk-overlap`, `--force` |
| `inspect` | `--input` |
| `validate` | `--input`, repeatable `--skills-dir`, repeatable `--skill-file`, `--allow-extra-skills` |
| `query` | required `--query`, `--input`, `--limit`, `--min-score`, `--abstention-threshold` |
| `migrate` | `--input`, `--output` |

The default index path is `.di-framework/skills-index.json`. Text output
summarizes the typed package result; JSON mode returns that result in `data`.
Validation drift and query abstention exit `1`. Invalid options, missing inputs,
and invalid indexes exit `2`; dependency, embedding, write, and unexpected
operation failures exit `3`.

## Validate skill catalogs

`skills validate` uses the same neutral source resolution and
`validateSkillCatalog` API as application code:

```bash
# Workspace and user neutral defaults.
di-framework skills validate

# Explicit sources before the defaults.
di-framework skills validate \
  --workspace . \
  --skills-dir ./team-skills \
  --skills-package @example/shared-skills

# Explicit sources only.
di-framework skills validate \
  --skills-dir ./team-skills \
  --source-mode replace \
  --json
```

| Option | Description |
| --- | --- |
| `--workspace <path>` | Workspace root; defaults to the current directory. |
| `--user-directory <path>` | User root for neutral default discovery. |
| `--skills-dir <path>` | Explicit `SKILL.md` tree; repeatable. |
| `--skills-package <name-or-path>` | Package skill source; repeatable. |
| `--source-mode <merge\|replace>` | Merge with or replace neutral defaults. |

Text mode prints a summary and source-aware diagnostics. JSON `data` contains
`valid`, `skillCount`, and the typed diagnostics without skill bodies. Valid
catalogs exit `0`, catalogs with error findings exit `1`, malformed CLI
configuration exits `2`, and unavailable packages or unexpected failures exit
`3`.

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

All four leaves delegate agent-configuration decisions to typed
`@di-framework/ai-utils` APIs. They only discover the neutral `AGENTS.md`,
`.agents/skills`, `~/.agents/skills`, and root `.aiignore` conventions
automatically. An audit may report known vendor assets as migration
opportunities, but those assets are never loaded as active configuration and no
command creates a vendor-specific path or compatibility adapter.

### Audit

```bash
di-framework agent audit
di-framework agent audit \
  --working-directory packages/api \
  --skills-dir ./team-skills \
  --json
```

`agent audit` is read-only and delegates every rule to
`auditAgentConfiguration`. Text output groups findings under Errors, Warnings,
and Info and includes source paths, provenance, precedence, related paths, and
recommended actions when present. JSON `data` is the unchanged typed audit
report, including resolved instruction and skill provenance, active ignore
policy, content-free suppressions, conflicts, vendor assets, and migration
opportunities. Instruction and ignored-file contents are not emitted.

| Option | Description |
| --- | --- |
| `--workspace <path>` | Workspace boundary; defaults to the current directory. |
| `--working-directory <path>` | Location used for hierarchical instruction discovery. |
| `--user-directory <path>` | User-level neutral source root. |
| `--skills-dir <path>` | Explicit skill root; repeatable. |
| `--skills-package <name>` | Package-provided skill root; repeatable. |
| `--source-mode <merge\|replace>` | Merge with or replace neutral skill roots. |
| `--instructions-fallback <name>` | Additional instruction filename; repeatable. |
| `--max-instruction-bytes <count>` | Non-negative combined instruction byte limit. |
| `--allowed-directory <path>` | Further restrict allowed instruction roots; repeatable. |

A report with no error-severity finding exits `0`; a report containing an error
exits `1`. Invalid options exit `2`, and an unavailable package or unexpected
execution failure exits `3`.

### Inspect

```bash
di-framework agent inspect
di-framework agent inspect --working-directory packages/api --json
```

`agent inspect` is also read-only. It delegates source resolution, catalog
conflict detection, hierarchical instruction discovery, and root `.aiignore`
loading to `@di-framework/ai-utils`. Text and JSON identify resolved skill roots
and precedence, instruction file paths from broad to specific, active policy
rules, suppressed sources, and shadowed skills. Instruction contents are not
emitted, and the command does not change files. It accepts the audit options
above except `--allowed-directory`.

### Initialize neutral assets

```bash
# Preview all four assets without writing (the default).
di-framework agent init

# Preview a selected subset.
di-framework agent init \
  --asset AGENTS.md \
  --asset .agents/skills

# Apply the generated plan after reviewing the preview.
di-framework agent init \
  --asset AGENTS.md \
  --asset .agents/skills \
  --apply
```

With no `--asset`, `agent init` requests `AGENTS.md`,
`.agents/AGENTS.md`, `.agents/skills`, and `.aiignore`. The repeatable option
accepts only those four paths. Dry-run is the default; explicit `--dry-run` and
`--apply` are mutually exclusive. Both text and JSON contain the deterministic
plan followed by its dry-run or apply result. Existing files become explicit
collisions and are never silently overwritten. Initialization excludes
audit-discovered vendor assets, so it only creates the requested neutral
scaffolding.

Plan or execution failures exit `1`; invalid options exit `2`; package-loading
or unexpected failures exit `3`.

### Migrate audited assets

```bash
# Planning is the default and never writes.
di-framework agent migrate
di-framework agent migrate --plan --json

# Select exact audited source paths.
di-framework agent migrate \
  --source ./legacy-agent-instructions.md \
  --source ./legacy-skills

# Generate and apply that invocation's exact plan.
di-framework agent migrate --apply
```

`agent migrate` calls the audit API, passes its report directly to the
migration planner, and calls the executor only in `--apply` mode. Default mode
and explicit `--plan` perform no writes. Text always shows the audit and planned
actions; apply mode additionally groups every result as applied, skipped, or
failed. Stable JSON `data` contains `mode`, the audit validity and findings, and
the complete versioned plan; apply mode also includes the typed execution
result.

The repeatable `--source` option limits migration to exact paths reported by
the audit. Without it, all audited opportunities are planned.
`--replace-existing` converts eligible file collisions into explicit
`replace-file` actions whose old targets are retained with a
`.di-framework-backup` suffix. It does not silently weaken directory, symlink,
boundary, source-change, target-change, or backup-collision checks.

`agent migrate` also accepts the audit options above except
`--allowed-directory`. `--plan` and `--apply` are mutually exclusive. Invalid
audits, plans, collisions, and partial execution failures exit `1`; invalid
options exit `2`; package-loading or unexpected failures exit `3`.

Migration writes only `AGENTS.md`, `.agents/AGENTS.md`, `.agents/skills/**`,
and `.aiignore`. Source vendor files remain in place for deliberate cleanup
after the neutral result is verified; no legacy or vendor-specific destination
is generated.

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
di-framework extensions install wasmcloud
di-framework wasmcloud doctor

di-framework extensions list
di-framework extensions uninstall wasmcloud
```

| Command | Behavior |
| --- | --- |
| `extensions install <spec>` | Install an extension package into the user-global store. |
| `extensions uninstall <name-or-package>` | Remove an installed extension. |
| `extensions list` | List installed extensions with their package names and versions. |

`<spec>` is an npm package name with an optional version range (`wasmcloud`,
`@di-framework/cli-plugin-wasmcloud@^5`). A bare `<name>` resolves to the canonical
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

Root help lists installed extensions alongside the built-in tree. The first available extension is
[wasmCloud deployment](wasmcloud.md); authors of new extensions start from
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
@di-framework/cli = arguments + presentation + exit status
```

| Layer | Owns | Does not own |
| --- | --- | --- |
| Feature packages | Domain validation and transformations, typed options and results, explicit write APIs, and progress callbacks. | Argument parsing, terminal formatting, process globals, or exit status. |
| CLI command handlers | Mapping parsed arguments to package options and typed results to presentation models. | Copied indexing, generation, audit, migration, validation, or other domain algorithms. |
| CLI infrastructure | Nested routing, help, injectable I/O, JSON envelopes, typed command failures, and centralized exit translation. | Feature-specific business rules. |

Command handlers return results or throw typed command failures. They do not call `process.exit()`, write
through global `console`, or translate domain results into exit statuses. Tests at the CLI boundary must
prove delegation to package APIs. If a workflow cannot be exposed without copying package internals, its
typed package API is extended first.

## Next steps

- [Installation](installation.md) - Core package and CLI setup
- [Quick Start](quick-start.md) - Basics after scaffolding
- [wasmCloud](wasmcloud.md) - Build and deploy apps as WebAssembly components
- [Kubernetes with di-framework-kube](kube.md) - Separate platform CLI and live example deployment workflow
- [HTTP Router](http-router.md) - HTTP routing and OpenAPI generation
- [Private service bindings](service-bindings.md) - Named in-process contracts (no dedicated CLI command)
- [Scheduling](scheduling.md) - `@Cron` (discovered by `wasmcloud build`, no `cron` group)
- [Agents](ai-utils.md) - Skills, plugins, and skill-index programmatic APIs
- [Runtime type checks](tsc.md) - Emit-time transforms wired by `init`
