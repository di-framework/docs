# Kubernetes with di-framework-kube

`di-framework-kube` creates an isolated local Kubernetes cluster with Kubesolo and provisions
its wasmCloud platform through the shared `@di-framework/platform` TypeScript/Pulumi package.
The [platform CLI extension](platform.md#managed-pulumi-target) uses the same package for its
local k0s platform. Operator configuration, Tenant/User CRDs, the tenancy controller, admission
policies, and HTTP routing come from one implementation. `@di-framework/platform` **6.0.1**
publishes from [di-framework/platform](https://github.com/di-framework/platform) and includes
[requestable Redis, NATS, and dedicated PostgreSQL backing services](backing-services.md).
Redis and NATS landed in 5.3.6.

Kubesolo creation and deletion remain owned by `di-framework-kube`. Application builds and
deployments remain owned by the framework extension and use an external target in
`di-framework.deploy.toml`. The CLI downloads a pinned, checksum-verified `kubesoloctl` on first
use. Its embedded Helm client is retained for status inspection and legacy cleanup; new
installations and updates run through Pulumi.

The kube CLI's built-in defaults remain Kubesolo **1.2.0**, wasmCloud runtime operator **2.8.0**,
and the platform package version compiled into that CLI. Those defaults are independent of
application framework versions. The published platform package to select for 6.0 APIs is
`@di-framework/platform@6.0.1`. The
[kube example workspace](https://github.com/di-framework/kube/tree/main/examples-apps) targets
DI Framework **6** with `@di-framework/bindings` and `@di-framework/cli-plugin-platform`
(`di-framework platform` commands). It includes fifteen HTTP apps covering PostgreSQL,
configuration, secrets, key-value, blobstore, messaging, outgoing HTTP, Node compatibility,
and additional verification apps for static assets, actors, cron, queues, and migrations.

## Build and start the platform

Container mode supports macOS and Linux on amd64 and arm64. Install a running container engine
(Docker or Podman), Node.js, npm, and the Pulumi CLI. Source builds also require Go 1.26+.
When both Docker and Podman are installed, set `DI_CONTAINER_CLI=podman` if Podman should run
Kubesolo containers and build the optional TLS host image.
Use a kube build containing the [shared-platform integration](https://github.com/di-framework/kube/pull/6);
older Helm-only builds do not expose `--platform-package` or `--platform-config`.

```bash
git clone https://github.com/di-framework/kube.git di-framework-kube
cd di-framework-kube
make build
./bin/di-framework-kube up
./bin/di-framework-kube status
./bin/di-framework-kube outputs
```

`up` installs the CLI's compiled `@di-framework/platform` version directly from npm. No local
package build or tarball is required. To select the published 6.0 platform explicitly:

```bash
./bin/di-framework-kube up --platform-package @di-framework/platform@6.0.1
```

The default instance is `local`. Its dedicated kubeconfig selects the cluster independently of
your current kubectl context. `outputs` returns the kubeconfig path, namespace, and HTTP
and Kubernetes endpoints. Workload HTTP listens on `http://127.0.0.1:28080`, forwarded to
the default host group through NodePort `30080`. HTTP routing uses the request's Host header.

Re-running `up` updates the instance's existing Pulumi stack. Tool prerequisites are checked
before creating Kubesolo. Platform commands do not require standalone `helm` or `kubectl`;
the example deployment workflow uses `kubectl`.

## Platform state and ownership

Each instance keeps its generated TypeScript project in `<state-dir>/<name>/platform`, using
stack `dev` and a local file backend inside that directory. `--state-dir` selects the state
root. The default is `di-framework-kube` under the operating system's user configuration
directory. The platform directory includes a mode-0600 `.passphrase` file and the project,
stack configuration, and state history. Back up the whole instance directory, including its
kubeconfig.

A cluster-level ownership claim prevents another kube instance from installing a competing
platform. An existing project also rejects a changed cluster, namespace, or release identity.
Failed updates preserve their state for retry or cleanup; ownership is released only after a
successful destroy. Sharing a package does not make two Pulumi stacks interchangeable.

For direct Pulumi inspection, change into the recorded platform directory, set
`PULUMI_CONFIG_PASSPHRASE` from its `.passphrase` file without printing it, and use
`pulumi preview --stack dev`. The project records its backend URL. Do not run direct Pulumi
operations and kube lifecycle commands concurrently. Use an external application deployment
target with the kubeconfig and your registry; do not initialize a second managed platform for
the same cluster.

## Tenants and users

Supply a JSON file with `--platform-config` to declare tenants and their users:

```json
{
  "tenants": [{ "name": "alpha" }],
  "users": [
    { "name": "alice", "memberships": [{ "tenant": "alpha", "role": "developer" }] }
  ]
}
```

```bash
./bin/di-framework-kube up --platform-config /absolute/path/platform.json
```

The shared platform provisions tenant namespaces, runtimes, Redis/NATS backends, and RBAC.
It reports Tenant/User readiness through their custom resources. A declaration for `alice`
creates the Kubernetes service account and membership bindings; it does not issue a kubeconfig
or configure an identity provider. Credential issuance remains an administrator operation.

Updates that omit `--platform-config` preserve existing declarations. Supplying the file
replaces the declared tenant/user configuration; use explicit empty arrays when clearing it.
The file also accepts these platform settings:

| Setting | Purpose |
| --- | --- |
| `tenantHostImage` | Runtime image for tenant hosts. |
| `tenantHostImagePullPolicy` | Kubernetes pull policy for that image. |
| `storageRoot` | Node-local root for tenant data. |
| `networkPolicyEngine` | `kube-router` installs the policy-only controller; `existing` uses a controller already supplied by the cluster. |

Managed Kubesolo uses the shared package's pinned kube-router **2.10.0** controller in
policy-only mode, preserving its bridge networking and service proxy. External clusters default
to `existing` and must enforce NetworkPolicy themselves. The platform keeps
`allowSharedHosts: false` and tenant host namespaces enforced even after administrator Helm
value overrides. Admission restricts guest capabilities and protects platform-owned settings.

Tenant storage currently uses single-node host paths, normally under `/var/lib/kubesolo`.
Service mode forwards `--kubesolo-data` as its storage root unless configured otherwise.
This is a local storage profile, not a distributed storage or backup service. Retained tenant
data can survive platform resource cleanup, but purging the cluster removes its data volume.

The example fixtures below run in the administrator-managed platform namespace. They are not a
recipe for bypassing tenant admission or granting tenant developers access to platform Secrets.
The example workspace already uses 6.0 bindings and the platform CLI extension. Older kube
instances may still need an explicit platform package upgrade and `di-framework extensions install
platform` before tenant backing-service commands match the docs:

```bash
./bin/di-framework-kube up --platform-package @di-framework/platform@6.0.1
di-framework extensions install platform
```

See [Platform backing services](backing-services.md) for tenant prerequisites, CLI commands, and
binding projection. Upgrading the platform package does not migrate existing example backends or
warehouse data automatically.

## Deploy the examples

In addition to the platform prerequisites and built binary, install Bun 1.3+, Node.js 22+,
`kubectl`, `oras`, and the platform extension (`di-framework extensions install platform`). From
the repository root:

```bash
cd examples-apps
# Sibling checkouts: ../../di-framework, ../../cli-extensions, ../../platform
(cd ../../di-framework && bun install)
(cd ../../cli-extensions && bun install)
(cd ../../platform && bun install)
bun run link:framework
bun install --frozen-lockfile
bun run check
bun test
bun run deploy
bun run smoke
```

The workspace links DI Framework **6** packages from those checkouts (core, HTTP, CLI,
`@di-framework/bindings`, and `@di-framework/cli-plugin-platform`) through Bun overrides. Re-run
`link:framework` after switching branches in a linked checkout.

The deploy helper starts or updates the selected instance, provisions fixtures needed by
the selected apps, and installs a local OCI registry with a 2Gi persistent-volume claim.
ORAS publishes through a temporary loopback port-forward on `127.0.0.1:25001`; the host pulls
through the registry's Kubernetes service. The port-forward closes when deployment finishes.
This registry uses plain HTTP for local development, and the helper enables insecure registry
pulls on the host. Dependencies and base images still require network access.

For every discovered `apps/*/di-framework.config.json`, the helper invokes
`di-framework platform deploy <name> --yes`. It adjusts each generated Service's target port
to `9191` for this host profile, then checks the app's live `/health` route. Generated components
and workload manifests remain under the app's ignored `dist/` and `.di-framework/` directories.

Select apps by name to shorten a redeployment:

```bash
bun run deploy postgres
bun run smoke postgres
```

Both deployment and smoke checks report failures and exit nonzero. Deployment continues to
the remaining apps when an individual application fails.

## Example applications

All apps expose `/`, `/health`, and a JSON 404 fallback. The Host header selects the app.

| App / HTTP Host | Request | What it verifies |
| --- | --- | --- |
| `greeter` | `GET /greet/Ada?lang=es` | DI-managed service, path and query parameters. |
| `catalog` | `GET /products?q=mug` | Shared injectable catalog, filtering, JSON responses and 404s. |
| `quotes` | `POST /quote` | Property injection, JSON body validation, totals in integer cents. |
| `node-runtime` | `GET /verify` | Guest process, Buffer, path, seeded and in-memory files, AsyncLocalStorage, and `createRequire` failure. |
| `node-crypto` | `GET /verify` | Hash, HMAC, HKDF, AES-GCM, ECDH, and random-value checks. |
| `node-http` | `GET /verify` | Chunked HTTP request and response over WASI TCP. |
| `node-network` | `GET /verify`, `GET /verify/ip` | TCP, UDP, and DNS against an in-cluster echo fixture. |
| `postgres` | `POST /verify` | SQL insert/read/update/delete and database error propagation. |
| `config` | `POST /verify` | ConfigMap overrides, merged configuration, missing keys. |
| `secrets` | `POST /verify` | Secret lookup/reveal, digest comparison, missing-key errors. |
| `keyvalue` | `POST /verify` | Redis-backed set/get/update/delete. |
| `blobstore` | `POST /verify` | NATS JetStream object write/read/delete through WIT streams. |
| `messaging` | `POST /verify` | NATS publish and request/reply with a separate responder. |
| `outgoing-http` | `POST /verify` | Native `OutgoingHttp.send` to an in-cluster HTTP endpoint. |

```bash
curl -H 'Host: greeter' 'http://127.0.0.1:28080/greet/Ada?lang=es'

curl -H 'Host: quotes' -H 'Content-Type: application/json' \
  -d '{"items":[{"sku":"mug","quantity":2},{"sku":"stickers","quantity":3}]}' \
  http://127.0.0.1:28080/quote

curl -H 'Host: postgres' -H 'Content-Type: application/json' \
  -d '{}' http://127.0.0.1:28080/verify
```

## PostgreSQL binding

The PostgreSQL app declares its DI service in `apps/postgres/src/bindings.ts`:

```typescript
import { Container } from '@di-framework/core/decorators';
import { Postgres, WasmCloudBinding } from '@di-framework/bindings';

@WasmCloudBinding('example-database', {
  config: { database: 'examples' },
  secretFrom: 'examples-postgres-binding',
})
@Container()
export class ExampleDatabase extends Postgres {}
```

Applications import `@di-framework/bindings`, as shown above. The application resolves the class
at module startup and calls native `wasmcloud:postgres/query@0.2.0` through `queryBatch`. No Node
PostgreSQL driver is needed. Guest initialization precedes application evaluation, and the generated
host declaration matches the unlabeled QuickJS import.

The deployment helper creates `examples-postgres`, its ClusterIP service, and a 1Gi persistent
volume claim. It generates a password and connection URL in the `examples-postgres-binding`
Secret and reuses that Secret on later runs. `infra/postgres-host.yaml` supplies its `url` key
as `WASH_POSTGRES_URL` to the native host plugin. First provisioning restarts the host so it
receives the credentials, briefly restarting other example workloads on that host too.

`GET /health` executes `SELECT 1`. `POST /verify` creates a temporary table in one batch,
asserts inserted and updated values inside PostgreSQL, deletes the row, and checks that it is
gone. It also confirms a deliberate SQL error propagates. The temporary table is dropped on
commit, keeping repeated and concurrent probes isolated.

The fixture uses plaintext PostgreSQL inside the cluster without a host port. Database data
survives pod restarts; deleting the cluster removes it. Preserve the credentials with the
initialized volume. This example covers `queryBatch`, not streamed `query`, prepared
statements, or multiple independently credentialed databases.

## Other service bindings

```bash
bun run deploy config secrets keyvalue blobstore messaging outgoing-http
bun run smoke config secrets keyvalue blobstore messaging outgoing-http
```

Each app declares its binding in `src/bindings.ts` and resolves it at module startup. Its
health and verification requests exercise the actual host service. The fixtures are:

| Fixture | Purpose |
| --- | --- |
| `binding-config` | ConfigMap whose value overrides inline binding configuration. |
| `binding-secrets` | Generated token reused across deployments. The app returns only its SHA-256 digest; smoke compares it with `binding-secret-check`. |
| `binding-redis` | Key-value backend with uniquely named probe keys that are removed after checks. |
| `binding-nats` | Separate JetStream server for blobstore checks, using ephemeral storage. |
| `binding-echo` | HTTP endpoint and messaging responder on the platform NATS broker, using the existing `wasmcloud-data-tls` certificate for mutual TLS. |

Messaging verification succeeds only if the responder observed the preceding publication with
the same unique token. Redis and object-store NATS use ClusterIP services with no host ports.
These fixtures require no external account and assume the default platform release and service
names. They verify functionality, not production durability or multiple labeled backends.

### Outgoing HTTP permissions

For `outgoing-http`, the helper patches the component's local resources with:

```yaml
localResources:
  allowedHosts:
    - http://binding-echo:8080
```

Without this grant the runtime returns `HTTP-request-denied`. Project configuration does not yet
expose `allowedHosts`, so the helper applies it after application deployment and before live
health checks. WASI socket DNS permissions instead use the project's `allowedIpNameLookups`; the
two settings serve different networking paths.

## Verification

`bun test` exercises local Bun code. `bun run smoke` sends requests to deployed QuickJS
components, checks status codes and response bodies, and includes the backend-dependent
checks. Operator readiness alone cannot verify a binding. Run both local checks and smoke
checks after changing framework dependencies.

The shared-platform integration was verified on 2026-09-14 using a locally packed shared
package on a fresh Kubesolo cluster: tenant/user readiness, an update preserving declarations,
a repeat deployment with all 27 resources unchanged, and teardown. A tenant probe reached its
Redis instance while an outside probe was rejected; the default host and operator also
restarted successfully under network policies. That verification did not rerun the fourteen
application examples or exercise an npm-installed artifact.

On 2026-09-08, an earlier **patched 5.2.13** workspace passed **61/61 live API checks across
14 apps**, typechecking, and **40 local tests** on Kubesolo 1.2.0 with operator 2.8.0. That run
predates the move to DI Framework **6**, `@di-framework/bindings`, and `di-framework platform`
deploy. Run the commands above on your machine to verify the current linked workspace (Docker or
Podman container mode).

The Node probes do not cover TLS/HTTPS or child processes, which remain mocks in the guest
compatibility layer. The PostgreSQL and other service probes use native WIT bindings.

### Using a SkillsAgent

These examples establish service-binding behavior; they do not yet verify a complete
`SkillsAgent` from `@di-framework/ai-utils`. For an agent example, provide skill content in
the guest explicitly: the current filesystem seed does not include Markdown or the hidden
`.agents` tree. In-memory writes are not a persistent workspace, and Bash or subprocess
tools cannot rely on the mocked `child_process` implementation.

Also verify the chosen model adapter's HTTP transport, destination grant, streaming behavior,
and Secret-backed credentials inside the component. The outgoing HTTP fixture demonstrates
a native request path; it does not establish that an arbitrary model SDK's Node HTTPS path
works. See [Node compatibility and permissions](platform.md#node-compatibility-and-permissions)
and [Agent Skills](ai-utils.md).

## Configure and inspect an instance

From `examples-apps`, select another instance or ports with:

```bash
DI_KUBE_NAME=examples DI_HTTP_PORT=28081 DI_REGISTRY_PORT=25002 bun run deploy
DI_KUBE_NAME=examples bun run smoke
```

`DI_KUBE_BIN` selects an absolute binary path. For an existing instance, keep the HTTP port
chosen when it was created; container-engine port mappings are fixed at container creation.

Use its private kubeconfig when inspecting resources:

```bash
export KUBECONFIG="$(../bin/di-framework-kube kubeconfig --name local)"
kubectl -n wasmcloud get workloaddeployments,workloadreplicasets
kubectl -n wasmcloud logs deployment/hostgroup-default --tail=100
```

From the repository root, install onto an explicitly selected existing cluster with:

```bash
./bin/di-framework-kube up --name edge \
  --kubeconfig /secure/path/admin.kubeconfig --context edge-admin
```

Repeated `--values` / `-f` flags supply administrator Helm overrides to the shared Pulumi profile.
The platform still enforces shared-host and watched-namespace settings. Native Linux service
mode is available through `sudo ./bin/di-framework-kube up --name edge --run-mode service`;
it requires the host setup described in the repository README.

## Migrate a Helm-only installation

`up` refuses to adopt an unmanaged existing Helm release or another platform's CRDs. Existing
Helm-only instance state still supports `status` and `down`. Back up application/backend data
and credentials, arrange downtime, and explicitly remove the legacy release with `down` before
running the shared-platform `up`. Do not use `--purge-cluster` as a migration shortcut: it
removes the cluster's data. Automated resource import and data migration are not provided.

## Remove the platform

From the repository root, destroy the instance's Pulumi-managed platform while preserving Kubesolo:

```bash
./bin/di-framework-kube down --name local
```

To permanently remove the managed cluster and its data volume:

```bash
./bin/di-framework-kube down --name local --purge-cluster
```

Cleanup checks for Pulumi and Node.js before changing ownership; npm is not required for
`down`. Purging deletes the example database, registry, and retained tenant data. It is refused for clusters supplied
with `--kubeconfig`.

## Develop the shared package locally

For unpublished infrastructure changes only, build and pack `@di-framework/platform` in the
[di-framework/platform](https://github.com/di-framework/platform) checkout, then supply the
resulting tarball to a separate test instance:

```bash
# In di-framework/platform, package platform/platform:
cd platform/platform
bun run build
npm pack --pack-destination /tmp

# In the kube checkout:
./bin/di-framework-kube up --name shared-test --http-port 28089 \
  --platform-package file:/tmp/di-framework-platform-6.0.1.tgz
```

Use the filename produced by `npm pack` if its version differs. Regular installs use npm.

## Next steps

- [Platform](platform.md) - Component builds, binding declarations, runtime behavior, and deployment targets
- [Example workspace](https://github.com/di-framework/kube/tree/main/examples-apps) - Application sources, fixtures, deployment helper, and API checks
- [Platform README](https://github.com/di-framework/kube/blob/main/README.md) - CLI options, supported modes, and release builds
