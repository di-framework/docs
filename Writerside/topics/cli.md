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
│   ├── inspect
│   ├── audit
│   ├── init
│   └── migrate
└── mx
    ├── build
    ├── test
    ├── typecheck
    └── publish
```

This tree is exhaustive. There are no public command aliases, deprecated routes, or
package-specific alternatives. In particular, maintainer commands are available only below
`di-framework mx`.

| Command | Purpose |
| --- | --- |
| `init` | Scaffold an application. |
| `build` | Build an application, including configured runtime type transforms. |
| `check` | Typecheck an application without emitting output. |
| `generate` | Generate configured application surfaces. |
| `skills index build\|inspect\|validate\|query\|migrate` | Build, examine, validate, search, or migrate the skills index. |
| `skills validate` | Validate skill catalogs and report diagnostics. |
| `http openapi generate` | Generate an OpenAPI document from HTTP controllers. |
| `agent inspect` | Inspect resolved agent instructions, skills, precedence, and ignore policy without writing files. |
| `agent audit` | Audit a repository's agent configuration without writing files. |
| `agent init` | Plan or create neutral agent assets without vendor-specific paths. |
| `agent migrate` | Plan or explicitly apply migration to neutral agent assets. Planning is the default. |
| `mx build\|test\|typecheck\|publish` | Run di-framework monorepo maintainer workflows. |

Command-specific options and examples are documented as their implementations become available. The
command paths and conventions on this page are the stable public contract.

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

## Naming and help

- Command names are lowercase English words in `kebab-case`. Groups use nouns and operations use
  imperative verbs.
- `di-framework help`, `di-framework --help`, and `di-framework -h` show root help. Every group and leaf
  accepts the same three help forms for that node.
- Explicitly requested help goes to standard output with exit status `0`. An incomplete group writes its
  help to standard error with exit status `2`.
- Help includes usage, available children or options, and a short description.
- Unknown commands, unknown options, missing option values, and extra positional arguments identify the
  invalid token and show the nearest relevant help. Arguments are never silently ignored.
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
    "code": "configuration_invalid",
    "message": "The skill source could not be resolved.",
    "details": {}
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
- [HTTP Router](http-router.md) - HTTP routing and OpenAPI generation
- [Agent Skills](ai-utils.md) - Skills and skill-index programmatic APIs
- [Runtime type checks](tsc.md) - Emit-time transforms wired by `init`
