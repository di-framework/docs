# Kubernetes with di-framework-kube

`di-framework-kube` creates an isolated local Kubernetes cluster with Kubesolo and installs
the wasmCloud runtime operator. Use it to deploy DI Framework WebAssembly components and
verify their connections to real services. The
[kube repository](https://github.com/di-framework/kube) includes fourteen example apps targeting
DI Framework **5.3.0**, with PostgreSQL, configuration, secrets, key-value, blobstore,
messaging, outgoing HTTP, and Node compatibility checks.

The CLI embeds the Helm client and downloads a pinned, checksum-verified `kubesoloctl` on
first use. It pins Kubesolo **1.2.0** and wasmCloud runtime operator **2.8.0**. Framework,
platform, and WIT versions are independent: upgrading to 5.3.0 does not require changing
the operator chart.

This is a separate executable from `di-framework wasmcloud`. It manages the cluster and
operator; the framework extension builds and deploys applications through an external
target in `di-framework.deploy.toml`.

## Build and start the platform

Container mode supports macOS and Linux on amd64 and arm64 and requires a running Docker
Engine. To build the binary from source, install Go 1.26+:

```bash
git clone https://github.com/di-framework/kube.git di-framework-kube
cd di-framework-kube
make build
./bin/di-framework-kube up
./bin/di-framework-kube status
./bin/di-framework-kube outputs
```

The default instance is `local`. Its dedicated kubeconfig keeps operations independent of
your current kubectl context. `outputs` returns the kubeconfig path, namespace, and HTTP
and Kubernetes endpoints. Workload HTTP listens on `http://127.0.0.1:28080`, forwarded to
the default host group through NodePort `30080`. HTTP routing uses the request's Host header.

Re-running `up` upgrades the instance's Helm release in place. The platform commands do not
require standalone `helm` or `kubectl`; the example deployment workflow uses `kubectl`.

## Deploy the examples

In addition to Docker and the built binary, install Bun 1.3+, Node.js 22+, `kubectl`, and
`oras`. From the repository root:

```bash
cd examples-apps
bun install --frozen-lockfile
bun run check
bun test
bun run deploy
bun run smoke
```

The workspace pins framework dependencies and overrides to 5.3.0. That release includes
the binding fixes, so no Bun compatibility patch is required.

The deploy helper starts or updates the selected instance, provisions fixtures needed by
the selected apps, and installs a local OCI registry with a 2Gi persistent-volume claim.
ORAS publishes through a temporary loopback port-forward on `127.0.0.1:25001`; the host pulls
through the registry's Kubernetes service. The port-forward closes when deployment finishes.
This registry uses plain HTTP for local development, and the helper enables insecure registry
pulls on the host. Dependencies and base images still require network access.

For every discovered `apps/*/di-framework.config.json`, the helper invokes
`di-framework wasmcloud deploy <name> --yes`. It adjusts each generated Service's target port
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
import { Postgres, WasmCloudBinding } from '@di-framework/wasmcloud';

@WasmCloudBinding('example-database', {
  config: { database: 'examples' },
  secretFrom: 'examples-postgres-binding',
})
@Container()
export class ExampleDatabase extends Postgres {}
```

The application resolves the class at module startup and calls native
`wasmcloud:postgres/query@0.2.0` through `queryBatch`. No Node PostgreSQL driver is needed.
Guest initialization precedes application evaluation in 5.3.0, and the generated host
declaration matches the unlabeled QuickJS import.

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

Without this grant the runtime returns `HTTP-request-denied`. The 5.3.0 framework project
configuration does not expose `allowedHosts`, so the helper applies it after application
deployment and before live health checks. WASI socket DNS permissions instead use the
project's `allowedIpNameLookups`; the two settings serve different networking paths.

## Verification

`bun test` exercises local Bun code. `bun run smoke` sends requests to deployed QuickJS
components, checks status codes and response bodies, and includes the backend-dependent
checks. Operator readiness alone cannot verify a binding. Run both local checks and smoke
checks after changing framework dependencies.

On 2026-09-08, the earlier **patched 5.2.13** workspace passed **61/61 live API checks across
14 apps**, typechecking, and **40 local tests** on Kubesolo 1.2.0 with operator 2.8.0. Those
results cover the changes merged into 5.3.0; they are not a fresh deployment result for the
published 5.3.0 packages. The workspace now resolves 5.3.0 without the patch. Run the commands
above to verify that release in your environment.

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
works. See [Node compatibility and permissions](wasmcloud.md#node-compatibility-and-permissions)
and [Agent Skills](ai-utils.md).

## Configure and inspect an instance

From `examples-apps`, select another instance or ports with:

```bash
DI_KUBE_NAME=examples DI_HTTP_PORT=28081 DI_REGISTRY_PORT=25002 bun run deploy
DI_KUBE_NAME=examples bun run smoke
```

`DI_KUBE_BIN` selects an absolute binary path. For an existing instance, keep the HTTP port
chosen when it was created; Docker port mappings are fixed at container creation.

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

Repeated `--values` / `-f` flags supply Helm overrides after the built-in profile. Native Linux service
mode is available through `sudo ./bin/di-framework-kube up --name edge --run-mode service`;
it requires the host setup described in the repository README.

## Remove the platform

From the repository root, remove wasmCloud while preserving Kubesolo:

```bash
./bin/di-framework-kube down --name local
```

To permanently remove the managed cluster and its data volume:

```bash
./bin/di-framework-kube down --name local --purge-cluster
```

Purging deletes the example database and registry data. It is refused for clusters supplied
with `--kubeconfig`.

## Next steps

- [wasmCloud](wasmcloud.md) - Component builds, binding declarations, runtime behavior, and deployment targets
- [Example workspace](https://github.com/di-framework/kube/tree/main/examples-apps) - Application sources, fixtures, deployment helper, and API checks
- [Platform README](https://github.com/di-framework/kube/blob/main/README.md) - CLI options, supported modes, and release builds
