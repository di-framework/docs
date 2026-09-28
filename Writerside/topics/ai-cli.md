# AI CLI

`@di-framework/cli-plugin-ai` is a [CLI extension](cli.md#extensions) for agent
configuration and Agent Skills. It mounts `di-framework ai`.

In **6.0** the extension publishes from
[di-framework/cli-extensions](https://github.com/di-framework/cli-extensions).
Through 5.x the same leaves shipped inside `@di-framework/cli` in
[di-framework/di-framework](https://github.com/di-framework/di-framework). They
moved here when `@di-framework/ai` and `@di-framework/ai-utils` moved to
[di-framework/ai](https://github.com/di-framework/ai). Command paths are
unchanged: `di-framework ai agent` and `di-framework ai skills`. Install the
extension before using them.

```bash
di-framework extensions install ai
```

That installs `@di-framework/cli-plugin-ai`. Commands resolve
`@di-framework/ai-utils` from the current project and delegate domain decisions
to that package. The extension maps arguments, presents results, and translates
exit status. Commands run through `di-framework ai`.

The extension mounts one command group:

```text
di-framework ai
├── agent
│   ├── audit
│   ├── init
│   ├── inspect
│   └── migrate
└── skills
    ├── index
    │   ├── build
    │   ├── inspect
    │   ├── validate
    │   ├── query
    │   └── migrate
    └── validate
```

| Command | Purpose |
| --- | --- |
| `agent audit` | Read-only audit of neutral agent configuration. |
| `agent init` | Plan or create neutral `AGENTS.md`, `.agents/skills`, and `.aiignore` assets. |
| `agent inspect` | Read-only view of resolved sources, instructions, and ignore policy. |
| `agent migrate` | Plan or apply a migration from audited sources into neutral paths. |
| `skills index build\|inspect\|validate\|query\|migrate` | Build and use a semantic skills index. |
| `skills validate` | Validate discovered Agent Skills catalogs. |

Neutral skill discovery uses `.agents/skills` and `~/.agents/skills`. No
non-neutral path is consulted implicitly. The commands only discover the
neutral `AGENTS.md`, `.agents/skills`, `~/.agents/skills`, and root `.aiignore`
conventions automatically. An audit may report known vendor assets as migration
opportunities, but those assets are never loaded as active configuration and no
command creates a vendor-specific path or compatibility adapter.

As with every extension, the commands follow the [CLI contract](cli.md): the
same help forms, `--json` envelope, and exit-status table apply.

Programmatic equivalents live in [`@di-framework/ai-utils`](ai-utils.md) and
[Agent configuration](agent-foundations.md). Package APIs stay independent of
command-line arguments and terminal output.

## Skills index commands

```bash
di-framework ai skills index build \
  --skills-dir ./.agents/skills \
  --output ./.di-framework/skills-index.json
di-framework ai skills index inspect \
  --input ./.di-framework/skills-index.json
di-framework ai skills index validate \
  --input ./.di-framework/skills-index.json \
  --skills-dir ./.agents/skills
di-framework ai skills index query \
  --input ./.di-framework/skills-index.json \
  --query 'review TypeScript authorization'
di-framework ai skills index migrate \
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

For catalogs above the default discovery threshold, see
[Large catalogs](ai-utils.md#large-catalogs).

## Validate skill catalogs

`skills validate` uses the same neutral source resolution and
`validateSkillCatalog` API as application code:

```bash
# Workspace and user neutral defaults.
di-framework ai skills validate

# Explicit sources before the defaults.
di-framework ai skills validate \
  --workspace . \
  --skills-dir ./team-skills \
  --skills-package @example/shared-skills

# Explicit sources only.
di-framework ai skills validate \
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

## Agent configuration commands

### Audit

```bash
di-framework ai agent audit
di-framework ai agent audit \
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
di-framework ai agent inspect
di-framework ai agent inspect --working-directory packages/api --json
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
di-framework ai agent init

# Preview a selected subset.
di-framework ai agent init \
  --asset AGENTS.md \
  --asset .agents/skills

# Apply the generated plan after reviewing the preview.
di-framework ai agent init \
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
di-framework ai agent migrate
di-framework ai agent migrate --plan --json

# Select exact audited source paths.
di-framework ai agent migrate \
  --source ./legacy-agent-instructions.md \
  --source ./legacy-skills

# Generate and apply that invocation's exact plan.
di-framework ai agent migrate --apply
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

## Next steps

- [CLI](cli.md#extensions) — Install, list, and uninstall extensions
- [Agent Skills](ai-utils.md) — Builders, discovery, and semantic indexes
- [Agent configuration](agent-foundations.md) — Typed source, audit, and migration APIs
- [AI](ai.md) — Chat, tools, RAG, MCP, and agents
