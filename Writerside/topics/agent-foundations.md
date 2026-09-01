# Agent configuration

`@di-framework/ai-utils` provides vendor-neutral project discovery for skills,
repository instructions, and AI exclusion policy. These APIs are independent of
the CLI: applications, tests, and build tooling can inspect the same ordered
sources and typed diagnostics without constructing an agent.

## Neutral project layout

A repository can keep all three foundations at predictable paths:

```text
workspace/
├── AGENTS.md
├── .aiignore
├── .agents/
│   ├── AGENTS.md
│   └── skills/
│       └── code-reviewer/
│           ├── SKILL.md
│           └── references/
│               └── checklist.md
└── packages/
    └── api/
        └── AGENTS.md
```

`AGENTS.md` applies by directory hierarchy. The root file applies throughout
the workspace; `packages/api/AGENTS.md` is more specific when work occurs in
that subtree. `.agents/AGENTS.md` participates only when the working directory
is under `.agents/**`; it is not a second global instruction file.

Only `.agents/skills` paths are automatic. Vendor-specific skill directories
are never loaded implicitly.

## Shared source resolution

`resolveAgentSources` normalizes ordered candidates before any consumer loads
their contents:

```typescript
import { resolveAgentSources } from '@di-framework/ai-utils';

const resolution = resolveAgentSources(
  [
    { path: 'AGENTS.md', origin: 'workspace', kind: 'file' },
    { path: '~/.agents/skills', origin: 'user', kind: 'directory' },
  ],
  {
    workspace: process.cwd(),
    userDirectory: process.env.AGENT_HOME,
  },
);
```

Candidates are evaluated in array order. Every accepted source records its
lexical `path`, canonical `realPath`, `origin`, zero-based `precedence`, and
resolved `kind`. The first occurrence of a canonical path wins. Later aliases
produce `source-duplicate`; missing, unreadable, wrong-kind, broken-symlink,
and boundary failures also have stable diagnostic codes.

Origins determine containment:

| Origin | Boundary |
| --- | --- |
| `workspace` | Configured workspace |
| `user` | Configured user directory (also used for `~`) |
| `explicit`, `package`, `fallback`, `vendor`, `migration` | Workspace or an explicit `allowedDirectories` root |

The `vendor` and `migration` origins are provenance labels for explicit tooling;
they do not enable vendor discovery or grant filesystem access. Lexical and
canonical checks prevent symlinks from escaping the applicable boundary.

## Skill sources and precedence

The only automatic skill roots are:

```text
<workspace>/.agents/skills
~/.agents/skills
```

Explicit directories and packages use a typed source mode:

```typescript
const toolbox = SkillsToolbox.builder()
  .workspace(process.cwd())
  .addSkillsDirectory('./team-skills')
  .addPackage('@company/shared-skills')
  .sourceMode('merge')
  .build();
```

| Mode | Runtime order |
| --- | --- |
| `merge` (default) | Explicit directories, packages, workspace default, user default |
| `replace` | Explicit directories and packages only |

Within an npm package, discovery checks `package.json#skills` first, then
`.agents/skills`, then `skills`. Duplicate skill names use first-definition-wins
precedence. Inspect `toolbox.skillSources` for accepted roots and
`toolbox.skillDiagnostics` for source and duplicate findings.

### Validate without running an agent

Catalog validation uses the same source resolution and precedence as runtime
discovery:

```typescript
import { validateSkillCatalog } from '@di-framework/ai-utils';

const report = validateSkillCatalog({
  workspace: process.cwd(),
  sourceMode: 'merge',
  directories: ['./team-skills'],
});

if (!report.valid) {
  for (const diagnostic of report.diagnostics) {
    console.error(diagnostic.code, diagnostic.source.path);
  }
}
```

| API | Scope |
| --- | --- |
| `validateSkillDefinition` | One parsed or in-memory skill |
| `validateSkillDirectory` | One skill folder, `SKILL.md`, and resources |
| `validateSkillsDirectory` | One catalog root |
| `validateResolvedSkillCatalog` | Already-resolved ordered sources |
| `validateSkillCatalog` | Resolve and validate with runtime precedence |

Diagnostics cover invalid frontmatter, name and description rules,
name/directory mismatch, missing entrypoints, duplicates and shadowing,
unreadable resources, missing resources, broken symlinks, and resources that
escape the skill directory. Findings are typed, source-aware data with no
terminal formatting and do not require an agent or semantic index.

## Hierarchical `AGENTS.md`

`discoverAgentInstructions` walks from the workspace root to a working
directory without crossing the workspace boundary:

```typescript
import { discoverAgentInstructions } from '@di-framework/ai-utils';

const instructions = discoverAgentInstructions({
  workspace: process.cwd(),
  workingDirectory: 'packages/api',
  maxBytes: 32 * 1024,
});
```

At each directory, `AGENTS.md` is the automatic filename. Additional filenames
must be configured through `fallbackFilenames`; `.agents.md` has no special
meaning. Files are combined broad-to-specific, whitespace-only files are
skipped, and the default combined UTF-8 limit is 32 KiB. `sources` retains the
ordered provenance and loaded byte count; `diagnostics` reports missing,
boundary, empty, unreadable, and size-limit outcomes.

`SkillsAgent` enables repository instruction discovery by default. Configure or
disable it explicitly:

```typescript
const bundle = SkillsAgent.builder()
  .chatModel(model)
  .workspace(process.cwd())
  .instructionDiscovery({ workingDirectory: 'packages/api' })
  .buildBundle();

console.log(bundle.instructions?.sources);

const isolated = SkillsAgent.builder()
  .chatModel(model)
  .workspace(process.cwd())
  .instructionDiscovery(false)
  .build();
```

System prompt sections have deterministic authority and order:

1. caller-provided `.system(...)` instructions;
2. repository instructions, broad-to-specific; and
3. memory-tool instructions when memory is enabled.

The caller has highest authority. Within repository instructions, the closest
file is the most specific. Instruction text cannot add tools, expand allowed
directories, or weaken the filesystem sandbox.

## Root `.aiignore` policy

`.aiignore` is independent of source-control `.gitignore`. Only
`<workspace>/.aiignore` is discovered; nested policy files are not loaded. The
syntax follows `.gitignore` conventions: comments, `*`, `**`, `?`, character
ranges, directory-only and root-relative rules, `!` negation, and
last-match-wins precedence.

```typescript
import {
  evaluateAiIgnorePath,
  loadAiIgnorePolicy,
} from '@di-framework/ai-utils';

const policy = loadAiIgnorePolicy({ workspace: process.cwd() });
const evaluation = evaluateAiIgnorePath(policy, 'build/generated.ts');

console.log(evaluation.decision, evaluation.rule?.line, evaluation.source.path);
```

`compileAiIgnorePolicy` compiles explicitly supplied text without reading CLI or
agent state. Evaluations report the effective rule and policy source. The root
policy file itself always receives the `policy-file` decision so it remains
available to bootstrap evaluation.

### Discovery enforcement

The workspace policy is applied consistently to recursive walking, Glob, Grep,
skill discovery, and `AGENTS.md` discovery. Ignored directories are pruned
before their entries are visited; ignored files are not read or returned.

`SkillsToolbox` loads the root policy for these discovery surfaces. Low-level
factories accept an explicit `aiIgnorePolicy`. Use `onSuppressed` to collect
content-free `aiignore-suppressed` diagnostics:

```typescript
const suppressed = [];
const tools = SkillsToolbox.builder()
  .workspace(process.cwd())
  .aiIgnorePolicy(policy)
  .onSuppressed((diagnostic) => suppressed.push(diagnostic))
  .buildTools();
```

A suppression diagnostic identifies the path, path kind, discovery surface,
policy path, matching line, and precedence where applicable. It never contains
the ignored file content or rule text.

### Direct file-tool enforcement

Direct access is opt-in and cumulative through `.aiIgnore(mode)`:

| Mode | Directory listing | Read | Edit | Write |
| --- | --- | --- | --- | --- |
| `discovery` | Filter or reject | Allow | Allow | Allow |
| `read` | Filter or reject | Reject | Reject | Allow |
| `read-write` | Filter or reject | Reject | Reject | Reject |

Edit is blocked in `read` mode because it must read the existing file and may
return a result snippet. Direct tool factories accept the same compiled policy:

```typescript
import { readTool } from '@di-framework/ai-utils';

const read = readTool({
  allowedDirectories: [process.cwd()],
  aiIgnore: { policy, enforcement: 'read' },
});
```

Policy rejections identify the requested path, policy path, and matching line,
without exposing file content or rule text. Paths in another explicitly allowed
root are not governed by the workspace policy.

## Security precedence

`.aiignore` only removes access; it cannot grant access. Enforcement order is:

1. filesystem sandbox and allowed-directory boundaries;
2. fixed structural exclusions such as `.git`, `node_modules`, `dist`, and
   `coverage`, plus traversal depth limits; and
3. `.aiignore` matching.

A negated rule can re-include a policy-ignored path, but cannot re-enable a path
rejected by a stronger layer. Sandbox denials take precedence over policy
messages. Symlink checks use canonical paths so an apparently in-workspace link
cannot escape the workspace.

## Audit repository configuration

`auditAgentConfiguration` combines the instruction, skill, and ignore-policy
APIs into one stable typed report without constructing an agent, creating an
index, or changing the repository:

```typescript
import { auditAgentConfiguration } from '@di-framework/ai-utils';

const report = auditAgentConfiguration({
  workspace: process.cwd(),
  workingDirectory: 'packages/api',
  directories: ['./team-skills'],
  sourceMode: 'merge',
});

for (const finding of report.findings) {
  console.log(finding.severity, finding.code, finding.path);
}
```

The report contains:

- `valid`, which is false when any finding has `error` severity;
- workspace and working-directory paths;
- content-free instruction provenance and the combined byte count;
- resolved skill sources and names;
- the active root `.aiignore` policy and content-free suppression diagnostics;
- detected vendor assets and neutral migration opportunities; and
- sorted findings with stable codes, severity, paths, provenance, and optional
  precedence, related paths, and recommended action.

Instruction bodies and suppressed file contents are not included. Known vendor
paths are checked only to report explicit migration opportunities; their
configuration is never loaded into the active instruction or skill set.

## Plan and execute neutral migrations

Migration is split into two APIs so callers can persist, display, approve, or
test a deterministic JSON-safe plan before any write occurs:

```typescript
import {
  auditAgentConfiguration,
  executeAgentConfigurationMigration,
  planAgentConfigurationMigration,
} from '@di-framework/ai-utils';

const audit = auditAgentConfiguration({ workspace: process.cwd() });
const plan = planAgentConfigurationMigration(audit, {
  // Omit to plan every audited opportunity.
  opportunityPaths: audit.migrationOpportunities.map(({ path }) => path),
  requests: [
    { target: '.agents/AGENTS.md', content: '# Agent defaults\n' },
    { target: '.agents/skills' },
    { target: '.aiignore', content: 'private/\n' },
  ],
});

// Safe default: validate and classify the exact plan without writing.
const preview = executeAgentConfigurationMigration(plan);

// Explicit opt-in: execute the same fingerprinted plan.
const applied = executeAgentConfigurationMigration(plan, { dryRun: false });
```

`planAgentConfigurationMigration` includes all audited opportunities by default.
Set `includeAuditOpportunities: false` for neutral initialization only, or pass
`opportunityPaths` to select exact audited sources. Explicit `requests` can
initialize only these neutral assets:

```text
AGENTS.md
.agents/AGENTS.md
.agents/skills/**
.aiignore
```

Each version-1 plan action has a stable ID, operation (`create-directory`,
`write-file`, or `replace-file`), fingerprinted source data when applicable,
original target state, status, and code. Plans expose target collisions,
incompatible kinds, unsafe symlinks, unreadable sources, duplicate targets,
boundary failures, and backup collisions as data rather than hiding them.

Execution is a dry run unless `dryRun: false` is passed. Before applying, the
executor checks the plan boundary, target state, and source fingerprint again.
It creates files through same-directory staging and an atomic no-replace link.
Existing files are not replaced unless planning explicitly requested a
`replace-file` action; that action retains the old file beside the target with
the `.di-framework-backup` suffix. Symbolic-link sources and targets are
rejected.

The execution result reports `success`, `changed`, and every action in exactly
one of `applied`, `skipped`, or `failed`, making collisions and partial failures
visible to automation. These APIs copy approved content into neutral paths;
they do not remove the source, create vendor directories or adapters, expose a
CLI, or build a semantic index.

### Neutral migration targets

Migration plans map workspace and user skill sources to
`<workspace>/.agents/skills` and `~/.agents/skills`. Repository instructions
target `AGENTS.md`; a caller can temporarily include another instruction name
through `fallbackFilenames` while moving its content. Use
`.sourceMode('replace')` when explicit skill directories and packages must be
the complete catalog instead of supplementing the neutral automatic roots.

Package metadata should declare `package.json#skills` or place packaged skills
in `.agents/skills` (with `skills` as the final conventional fallback). After
applying a migration, verify the audit report, source precedence, instruction
provenance, and `.aiignore` suppressions before deliberately removing old source
assets. There is no implicit compatibility scan: non-neutral paths do not become
active configuration unless the application passes them as explicit sources.
