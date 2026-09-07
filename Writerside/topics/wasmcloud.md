# wasmCloud

`@di-framework/cli-plugin-wasmcloud` is a [CLI extension](cli.md#extensions) for targeting
[wasmCloud](https://wasmcloud.com): it builds a di-framework HTTP application into a WASI 0.2
WebAssembly component, serves it locally, and deploys it from a workspace manifest.

```bash
di-framework extensions install wasmcloud
```

The extension mounts one command group:

```text
di-framework wasmcloud
├── build
├── dev
├── deploy
├── destroy
├── platform
│   ├── init
│   ├── deploy
│   └── destroy
└── doctor
```

| Command | Purpose |
| --- | --- |
| `build` | Bundle the application entry and componentize it for WASI HTTP. |
| `dev` | Build, then serve the component locally with `jco serve`. |
| `deploy [name]` | Build, publish, and apply a wasmCloud `WorkloadDeployment` for a project. |
| `destroy [name]` | Remove that project's generated `WorkloadDeployment` and `Service`. Never tears down the platform. |
| `platform init` | Generate `deploy/platform` from extension templates and register it as the default `local` target. |
| `platform deploy <target>` | Provision a managed platform target (`pulumi up`: k0s, registry, wasmCloud operator). |
| `platform destroy <target>` | Tear down a managed platform target (`pulumi destroy`) only. |
| `doctor` | Check the project and local toolchain for wasmCloud readiness. |

Run these commands directly. Do not wrap them in `package.json` scripts.

As with every extension, the commands follow the [CLI contract](cli.md): the same help forms,
`--json` envelope, and exit-status table apply.

## Project convention

A component project is marked by `di-framework.config.json` in the project root:

```json
{
  "name": "my-app",
  "entry": "src/app.ts",
  "output": "dist/my-app.wasm"
}
```

The configured `name` is the only project identity. `name` and `entry` are required; `output`
defaults to `dist/<name>.wasm`. Both paths must stay inside the project directory. There is no
`apps` classifier and no required `apps/` directory — projects may live in any layout.

The entry module default-exports a Fetch-compatible handler: a
`(request: Request) => Response | Promise<Response>` function or an object with such a `fetch`
method. A `@di-framework/http` `TypedRouter` works as-is.

The extension owns the WebAssembly/WASI boundary. `build` bundles the entry behind a
WASI-HTTP-to-Web-Fetch adapter with vendored WASI 0.2.12 WIT definitions, then componentizes with
`jco`. Intermediate build state lives in the disposable `.di-framework/` directory; the finished
component is written to the configured `output` path. JSON `data` contains `application`,
`component`, `entry`, and `profile`.

## Local development

```bash
di-framework wasmcloud dev [--host <address>] [--port <port>]
```

`dev` rebuilds the component and serves it with `jco serve` on `127.0.0.1:8000` by default. Tool
output streams directly to the terminal until the server is stopped. `dev` uses the nearest
`di-framework.config.json` above the working directory.

## Deployment manifest

Deployment topology lives in `di-framework.deploy.toml` at the workspace root. The CLI finds it by
walking upward from the current directory. The file describes **targets**, not applications: it must
not declare an `apps` table.

```toml
default-target = "local"

[targets.local]
platform = "deploy/platform"
stack = "dev"

[targets.development]
kubeconfig = "${KUBECONFIG}"
context = "team-development"
namespace = "wasmcloud"
registry = "registry.example.com/team"
```

- `di-framework wasmcloud deploy` with no name uses the nearest `di-framework.config.json`.
- `di-framework wasmcloud deploy greeter` recursively discovers projects under the workspace
  (skipping `.git`, `node_modules`, `.di-framework`, and generated output such as `dist/` and
  `coverage/` by default) and matches the configured `name`. Duplicate names fail with every
  conflicting path (`WASMCLOUD_DUPLICATE_PROJECT`).
- `--target <name>` selects a declared target; without it the CLI uses `default-target`.
- `${VAR}` interpolation fails with `WASMCLOUD_ENV_UNSET` if the variable is unset or empty. Do not
  put credentials in the manifest.

Optional `[discovery]` `include` / `exclude` glob lists refine the search. Directories `.git`,
`node_modules`, and `.di-framework` are always skipped.

A missing or malformed manifest reports `WASMCLOUD_DEPLOY_MANIFEST_NOT_FOUND` or
`WASMCLOUD_DEPLOY_MANIFEST_INVALID` and exits `2`.

### Managed Pulumi target

A managed target has `platform` (a directory inside the workspace that contains `Pulumi.yaml`) and
an optional `stack` (default `dev`). It must not mix those fields with kubeconfig fields.

From the workspace root, generate a self-contained local platform — k0s, a local OCI registry, and
the wasmCloud operator — from templates shipped with the extension:

```bash
di-framework wasmcloud platform init
di-framework wasmcloud platform deploy local --yes
```

`platform init` writes `deploy/platform` and creates or updates `di-framework.deploy.toml` so
`local` is a managed target (`platform = "deploy/platform"`, `stack = "dev"`). Existing files are
left alone unless you pass `--force` / `-f`. When it finishes it prints the exact start command:

```text
di-framework wasmcloud platform deploy local --yes
```

The generated Pulumi project provisions only platform concerns. It must not contain application
names, component builds, Kubernetes Services for apps, or `WorkloadDeployment` objects.

k0s and the registry are local Docker resources because they are not Kubernetes objects. Once k0s
yields a kubeconfig, that value is passed to a Kubernetes provider and the operator is installed
with Pulumi `kubernetes.helm.v3.Release` (`oci://ghcr.io/wasmcloud/charts/wasmcloud`) — not by
shelling out to `helm`.

The CLI reads a small output contract from `pulumi stack output --json`:

| Output | Required | Meaning |
| --- | --- | --- |
| `kubeconfig` | yes | kubeconfig YAML or a filesystem path |
| `namespace` | yes | Kubernetes namespace for workloads |
| `registry` | yes | OCI registry prefix |
| `context` | no | kubectl context |
| `endpoints.http` / `endpoints.kubernetes` / `endpoints.registry` | no | optional URLs |

Provision and tear down that stack explicitly. Application `destroy` never runs `pulumi destroy`.

```bash
di-framework wasmcloud platform deploy local --yes
di-framework wasmcloud platform destroy local --yes
```

`--yes` skips the Pulumi confirmation prompt on platform commands.

Pulumi environment defaults, applied without changing the caller's environment:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PULUMI_BACKEND_URL` | `file://~` | Local file backend unless a backend is configured. |
| `PULUMI_CONFIG_PASSPHRASE` | `local-dev` | Local development fallback when unset. |

A managed target whose platform directory has no `Pulumi.yaml` reports `WASMCLOUD_PLATFORM_NOT_FOUND`.
A stack that has not been deployed, or whose outputs do not match the contract, reports
`WASMCLOUD_PLATFORM_NOT_READY` or `WASMCLOUD_PLATFORM_OUTPUT_INVALID`.

### Existing cluster

When kubeconfig and a registry are already available, declare an **external** target with only
access information: `kubeconfig`, `namespace`, and `registry`, plus optional `context`. Deploy:

```bash
export KUBECONFIG="$HOME/.kube/config"
di-framework wasmcloud deploy greeter --target development
```

External and managed fields are mutually exclusive. An incomplete target reports
`WASMCLOUD_DEPLOY_MANIFEST_INVALID`.

## Application deploy and destroy

```bash
di-framework wasmcloud deploy [name] [--target <name>] [--yes]
di-framework wasmcloud destroy [name] [--target <name>] [--yes]
```

For the selected project the extension:

1. Builds the component.
2. Publishes it with `oras` under an immutable content-derived reference
   (`<registry>/<wit-name>:sha256-<digest>`).
3. Derives a wasmCloud `WorkloadDeployment` and Kubernetes `Service` (written under
   `.di-framework/deploy/`, not checked in).
4. Applies them with `kubectl` and waits until the workload is ready.

`destroy` deletes only those generated resources for that application on the selected target. It
must never run `pulumi destroy`. `--yes` is accepted for compatibility; application deploy and
destroy do not prompt.

The generated Kubernetes objects are an implementation detail. Do not treat them as application
configuration.

## Doctor

```bash
di-framework wasmcloud doctor
```

`doctor` verifies the project loads and probes the local toolchain: Bun, Node.js,
`@di-framework/core` and `@di-framework/http` resolvable from the project, Pulumi, Docker, kubectl,
and oras. JSON `data` lists every check with its result; any failed check exits `1`.

Bun runs the CLI, but `jco` itself requires a real Node.js installation on `PATH` — `build`, `dev`,
and `deploy` report `WASMCLOUD_NODE_REQUIRED` without it. Pulumi and Docker are needed for
`platform deploy` and `platform destroy`. kubectl and oras are needed for application `deploy` and
`destroy`.

## Next steps

- [CLI](cli.md) - The canonical command tree and the extensions mechanism
- [HTTP Router](http-router.md) - Fetch-compatible routing that runs unchanged in a component
- [Installation](installation.md) - Core package and CLI setup
