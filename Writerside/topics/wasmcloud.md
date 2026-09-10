# wasmCloud

`@di-framework/cli-plugin-wasmcloud` is a [CLI extension](cli.md#extensions) for targeting
[wasmCloud](https://wasmcloud.com): it builds a di-framework HTTP application into a WASI 0.3
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
| `dev` | Build, then serve locally with wasmtime, wash, or jco. |
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
WASI-HTTP-to-Web-Fetch adapter exporting `wasi:http/handler@0.3.0`. It generates the guest world
and `wit.lock.json` from the application's WIT requirements, then componentizes with
`@di-framework/componentize-qjs`. This wasmtime-48 fork supports the imported async functions
used by native service bindings. Set `DI_FRAMEWORK_COMPONENTIZE_QJS` to override the resolved CLI.
Intermediate build state lives in the disposable `.di-framework/` directory; the finished
component is written to the configured `output` path. JSON `data` contains `application`,
`component`, `entry`, and `profile`.

## Native service bindings

Install `@di-framework/wasmcloud` alongside core and HTTP, keeping the packages and the CLI
extension on the same framework release. The kube examples pin them to **5.3.0**.
Declare exported binding classes in `src/bindings.ts`, or select another file with
`"bindings": "src/services/bindings.ts"` in the project configuration:

```typescript
import { Container } from '@di-framework/core/decorators';
import { Config, Postgres, WasmCloudBinding } from '@di-framework/wasmcloud';

@WasmCloudBinding('orders-database', {
  config: { database: 'orders' },
  secretFrom: 'orders-database-binding',
})
@Container()
export class OrdersDatabase extends Postgres {}

@WasmCloudBinding('app-config', {
  config: { greeting: 'Hello' },
  configFrom: 'orders-config',
})
@Container()
export class AppConfig extends Config {}
```

These host capabilities are not [private service bindings](service-bindings.md)
(`@ExportService` / `@ServiceBinding`). Application-authored bindings are an in-process DI
contract inside one component; native bindings are WIT imports generated from `@WasmCloudBinding`
classes.

Resolve these classes through `useContainer().resolve(...)` or inject them with `@Component`.
The build discovers the declarations statically, creates real WIT imports in
`.di-framework/guests.js`, and initializes those guests before application evaluation. This
includes services resolved at module startup.

| Class | WIT capability | Version |
| --- | --- | --- |
| `Postgres` | `wasmcloud:postgres` | `0.2.0` |
| `KeyValue` | `wasmcloud:keyvalue` | `0.2.0` |
| `Blobstore` | `wasmcloud:blobstore` | `0.1.0` |
| `Messaging` | `wasmcloud:messaging` | `0.3.0` |
| `Config` | `wasi:config` | `0.2.0-rc.1` |
| `Secrets` | `wasmcloud:secrets` | `2.1.0` |
| `OutgoingHttp` | `wasi:http/client` | `0.3.0` |

These WIT package versions are independent of both the framework version and the WASI 0.3
component-model preview. The bindings consume services; your infrastructure must provision the
database, Redis, NATS, ConfigMaps, Secrets, and host configuration. `configFrom` references a
ConfigMap and `secretFrom` references a Kubernetes Secret. For capabilities that use a Secret,
an omitted `secretFrom` defaults to `<application>-<binding>`. Keep credentials out of inline
`config` and project files.

For PostgreSQL, configure the native host's connection through `WASH_POSTGRES_URL` and select
the database with the binding's `config.database`. A Secret reference on the binding alone
does not configure that host connection. See the [working PostgreSQL example](kube.md#postgresql-binding)
for provisioning and verification.

### Binding changes in 5.3.0

QuickJS emits unlabeled WIT imports. The extension now omits `hostInterfaces[].name` for
PostgreSQL, key-value, blobstore, messaging, and secrets so the host selects the provider route
that can link those imports. Binding names still select the guest and configuration overlay.
Unnamed config and outgoing HTTP requirements also retain their class's `config`, `configFrom`,
and `secretFrom` overlays.

HTTP ingress and outgoing requirements share one unnamed host declaration per WIT version.
The runtime links HTTP `client` and key-value `types` internally, so they remain in guest WIT
imports but are omitted from host discovery. These changes and the binding startup fix are
included in 5.3.0; consumers no longer need the earlier Bun compatibility patch.

The kube examples verify one binding of each kind. Multiple labeled, independently
credentialed backends are outside that verification; the QuickJS PostgreSQL path uses the
host connection and does not support separate credentials per named binding.

## Node compatibility and permissions

The plugin uses unenv plus WASI-backed implementations for the Node APIs below. This is a
compatibility layer inside QuickJS, with a different filesystem and process model from Node.

| API | Guest behavior |
| --- | --- |
| `node:path`, `Buffer` | Provided through the Node compatibility preset. |
| `node:fs` | In-memory filesystem; missing files report `ENOENT`. Selected project config files are seeded at build time. Writes do not establish durable storage. |
| `process`, `node:module` | Guest-shaped environment and working directory; `createRequire` reports `MODULE_NOT_FOUND`. |
| `node:net`, `node:dgram` | TCP, UDP, and name lookup over WASI 0.3 sockets. |
| `node:http` | HTTP/1.1 over the TCP implementation, including chunked request and response bodies and upgrade support. |
| `node:crypto` | WASI randomness, hashes, HMAC, and a Web Crypto subset including HKDF, AES-GCM, and ECDH P-256. |
| `node:timers`, global timers | WASI monotonic clock; cancellation, refresh, and ref/unref flags. Flags do not control process lifetime in a component. |
| `node:async_hooks` | AsyncLocalStorage context scopes and binding; transformed Promise continuations and timer callbacks retain context. |
| `node:tls`, `node:https`, `node:child_process` | Remain unenv mocks. |

Text encoding and Fetch globals initialize before application imports. The fixes carried
forward from 5.2.13 cover startup, async context, timers, and chunked HTTP. The bundler lowers
async functions and `for await` loops to instrumented Promise continuations; native
async-generator bodies and dynamically evaluated async code are not instrumented.

The filesystem seed includes `.json`, `.yaml`, `.yml`, `.toml`, and `.env` files from the
project, subject to size limits and excluded directories. These become component content:
use runtime bindings for secrets. Markdown skill files are not automatically seeded.

WASI DNS lookups require an explicit project allowlist:

```json
{
  "name": "socket-app",
  "entry": "src/app.ts",
  "allowedIpNameLookups": ["echo.wasmcloud.svc.cluster.local"]
}
```

The deployer writes this list to the component's `localResources.allowedIpNameLookups`.
Omission leaves the host's default denial in place. Socket, clock, and randomness imports
are runtime WASI capabilities, not wasmCloud `hostInterfaces`.

Native `OutgoingHttp` requests separately require the destination in the workload component's
`localResources.allowedHosts`. The binding does not grant egress access. Framework project
configuration does not yet expose that field; the [kube deployment helper](kube.md#outgoing-http-permissions)
applies an endpoint-specific grant after deployment.

## Local development

```bash
di-framework wasmcloud dev [--host <address>] [--port <port>]
```

`dev` rebuilds the component and listens on `127.0.0.1:8000` by default. It selects wasmtime
from PATH first, then wash, then jco. Use wasmtime 46+ for this path. Set
`DI_FRAMEWORK_WASMCLOUD_DEV_RUNNER` to `wasmtime`, `wash`, or `jco` to select a runner explicitly.
Tool output streams to the terminal until the server stops. The command uses the nearest
`di-framework.config.json` above the working directory.

The wasmtime runner uses `serve -S cli -S p3 -S config`, supporting WASI HTTP and unlabeled
`wasi:config`. wasmCloud-only imports such as PostgreSQL require wash or a wasmCloud host.
For wash, the extension writes `.di-framework/wash-dev.yaml` with the address, host interfaces,
and async component proposal, then invokes `wash dev --user-config`.
`WASMCLOUD_POSTGRES_URL` supplies `dev.postgres_url` for that local runner.

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

[targets.development.registry]
push = "https://registry.example.com/team"
pull = "registry.internal.example.com/team"
insecure = false
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

Platform deploy runs `pulumi install` automatically for the generated project. Its default
loopback ports are Kubernetes `26443`, registry `25000`, and HTTP `28180`; configure `apiPort`,
`registryPort`, or `httpPort` in the generated Pulumi stack to choose different ports.

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
| `registry` | yes | OCI registry prefix, or `{ push, pull, insecure }` transport object |
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

The registry object separates the address used by ORAS to push from the address used by the
cluster to pull. A string registry remains supported. An `http://` push URL or `insecure = true`
enables ORAS plain HTTP for that target. See [Kubernetes with di-framework-kube](kube.md) for
an external-target workflow using a loopback publisher and an in-cluster registry service.

## Scheduled jobs

`di-framework wasmcloud build` discovers `@Cron(...)` methods with a string or numeric literal
and writes `.di-framework/cron.json` plus an invoker. Deploy applies one Kubernetes
`batch/v1` CronJob per job. The workload sets `DI_CRON_MODE=external` so in-component timers do
not fire. Generated workloads use `replicas: 1`.

Scheduled-only projects (`"ingress": false`) still export `wasi:http/handler` and still get a
ClusterIP Service so CronJobs can POST to `/_di/cron/{jobId}/invoke`. Public ingress is omitted.
The default export must expose the DI container (`export { container }` or
`export default { container }`).

`destroy` deletes `WorkloadDeployment,service,cronjob` labeled
`app.kubernetes.io/name=<witName>`. `dev` and `doctor` do not generate or check CronJobs.

See [Scheduling](scheduling.md) for expressions, overlap, and `invokeCronJob`.

## Queue workers

Build discovers `@QueueHandler('name', { numeric options })`. A project is a queue worker when
handlers exist and either `applicationType` is `"worker"` or the sources have no HTTP controller
decorators.

Generated guests import WASI SQLite, export `wasi:http/handler`, and `pump()` jobs on control
HTTP (`/_di/queues/`) rather than starting poll loops. Public ingress is omitted. The workload
uses `replicas: 1`, `deployPolicy: Recreate`, `hostgroup: storage`, and
`QUEUE_DB_PATH=/data/queue.db`. A ClusterIP Service still exists for control routes.

See [Queues](queues.md#wasmcloud-workers).

## Static assets

The extension does not scan `.static()` mounts. Package files on the build host with
`packageStaticAssets` from native `@di-framework/http`, then `registerStaticAssets` or pass
`package:` into `.static()` so the guest can serve bytes without the source directory. See
[HTTP static assets](http-router.md#static-assets).

## Actors

> Actor wasmCloud integration landed in
> [PR #422](https://github.com/di-framework/di-framework/pull/422)
> (closing [di-framework#411](https://github.com/di-framework/di-framework/issues/411)), after
> the v5.3.0 tag.

Carry a local actor into a **single-host** wasmCloud workload. Mailboxes live in the guest.
SQLite files live on a hostPath volume. Multi-host relocation is not implemented; see
[remote actors](actors-distributed.md) for the out-of-band ownership protocol.

The [wasmcloud-actor-counter example](https://github.com/di-framework/di-framework/tree/main/examples/wasmcloud-actor-counter)
sets `"actors": true` in `di-framework.config.json` and reuses the local `CounterActor`.

### Build

`di-framework wasmcloud build` scans `@Actor` / `@ActorMethod` and writes `.di-framework/actors.js`:

```javascript
storage = new SqliteActorStorage({
  baseDir: resolveStorageDir(), // ACTOR_STORAGE_DIR || DI_STORAGE_DIR || './.actors'
  fileLocking: false,
});
runtime = new ActorRuntime({ storage });
runtime.register(CounterActor, { name, namespace });
export async function dispatchActorInvocation(actorType, actorKey, method, args = [])
```

Inside the guest, `SqliteActorStorage` is `WasmSqliteActorStorage` (`wasmcloud` export
condition). `fileLocking` is ignored. Exclusive write is a **deployment** constraint
(`replicas: 1`), not a VFS lock. `DI_SQLITE_BACKEND=wasm`.

Migrations declared on `@Actor({ migrations })` stay on the imported class; there is no separate
migration artifact. They still run before activation. A failed migration blocks the actor and
rejects invocations.

### Private invocation

Control path `POST /_actors/invoke`. Other HTTP routes are not intercepted by actor headers.
If `DI_CONTROL_TOKEN` / `DI_CONTROL_IDENTITIES` are unset, local/dev is open (anonymous).
Error JSON uses stable `error.name`; handler text is `'Actor invocation failed'` (no stacks).

### Deployed storage

Generated `WorkloadDeployment`:

- `spec.replicas: 1` (any other value throws `WASMCLOUD_STORAGE_REPLICA_CONSTRAINT`)
- `deployPolicy: Recreate` — drain in-flight calls and release the volume before the new
  version starts (not a Kubernetes `strategy: { type: Recreate }` field)
- `hostSelector.hostgroup: storage`
- hostPath `/var/lib/di-framework/storage/<wit-name>` mounted at `/data/actors`
- Env: `ACTOR_STORAGE_DIR=/data/actors`

There is no PersistentVolumeClaim. Process restart on the same hostPath keeps SQLite files.
**Host loss loses the files** unless the operator backs that directory. Multi-replica and
multi-host failover are not supported with this storage.

```bash
di-framework wasmcloud build
di-framework wasmcloud deploy
# restart the workload and call the same actor key — count is unchanged if the volume survived
```

Upgrade/drain: Recreate waits for the old replica to exit so the new one can open `/data/actors`.
Migration failure: the actor refuses activation; inspect `failedMigration` locally with
`di-framework actor inspect` against a copied DB, or read control error names.

## Application deploy and destroy

```bash
di-framework wasmcloud deploy [name] [--target <name>] [--yes]
di-framework wasmcloud destroy [name] [--target <name>] [--yes]
```

For the selected project the extension:

1. Builds the component.
2. Publishes it with `oras` under a stable reference derived from canonical build and deployment
   inputs (`<registry>/<wit-name>:sha256-<deployment-digest>`). The component-byte digest is reported
   separately because componentization snapshots can vary for identical inputs.
3. Derives a wasmCloud `WorkloadDeployment` and Kubernetes `Service` (written under
   `.di-framework/deploy/`, not checked in).
4. Configures HTTP ingress with the project name as its Host value, applies the resources with
   `kubectl`, and waits until the workload is ready.

For the generated Pulumi platform, call an app with
`curl -H 'Host: greeter' http://127.0.0.1:28180/`. The kube platform uses port `28080` by default.
Readiness does not prove a service binding works: follow deployment with requests that exercise
the actual backend, as in the [kube smoke checks](kube.md#verification).

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
- [HTTP Router](http-router.md) - Fetch-compatible routing and host-side static asset packaging
- [Private service bindings](service-bindings.md) - In-process named contracts, not host WIT imports
- [Scheduling](scheduling.md) - `@Cron` discovery, CronJobs, and `DI_CRON_MODE=external`
- [Queues](queues.md) - Durable workers without public ingress
- [Actors](actors.md) - Local runtime reused by wasmCloud guests
- [Remote actors](actors-distributed.md) - Ownership protocol (not wasmCloud multi-host routing)
- [Installation](installation.md) - Core package and CLI setup
- [Kubernetes with di-framework-kube](kube.md) - Local cluster and verified service-binding examples
