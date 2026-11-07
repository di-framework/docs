# Tenant access and registry

Each tenant can run its own **controller** and **console**, so tenant users work with an
identity-server login or a tenant API key instead of a Kubernetes credential. The controller
can also front a per-tenant OCI registry that tenant hosts pull workload components from.

These features are in published `@di-framework/platform` **6.0.30**,
`@di-framework/tenant-cli` **6.0.30**, and `@di-framework/cli-plugin-platform` **6.3.0**
from [di-framework/platform](https://github.com/di-framework/platform) and
[di-framework/cli-extensions](https://github.com/di-framework/cli-extensions).
`di-framework-kube` installs `@di-framework/platform@6.0.29` by default and accepts a newer
version via `--platform-package @di-framework/platform@6.0.30`; see [Kubernetes with di-framework-kube](kube.md).

## How it fits together

| Part | Runs in | Role |
| --- | --- | --- |
| Tenant controller | `di-runtime-<tenant>` | Authenticating proxy in front of the Kubernetes API and the `/v1` API. Resolves the caller's identity token or `dik_` API key, checks the caller's `User` membership in the tenant, and acts with a short-lived token for that user's ServiceAccount. Only paths inside `di-tenant-<tenant>` and `di-runtime-<tenant>` are forwarded. |
| Tenant console | `di-runtime-<tenant>` | OIDC relying party for the browser. Signs users in and shows overview, logs, members, and API keys by calling the controller as the user. Holds no cluster credential. |
| `di-tenant` / `di-framework platform` | Developer machine | Tenant CLIs in `@di-framework/tenant-cli` and `@di-framework/cli-plugin-platform`. Talk only to the controller over `/v1`. |
| Tenant registry | `di-tenant-<tenant>`, on the tenant's hosts | Optional OCI registry component (`di-tenant-registry`). The controller decides who may push and pull. |

Permissions are the user's own tenant role, so `developer` and `viewer` RBAC, quotas, and
admission policies apply unchanged. Suspending a `User` removes its ServiceAccount and cuts access,
including cached tokens.

## Enable tenant auth

Set the platform configuration `tenantAuth`. The tenant reconcile then deploys a controller
and console for every Tenant:

```yaml
tenantAuth:
  image: ghcr.io/di-framework/tenant-auth@sha256:<digest>
  issuer: http://identity.acme.localhost:28180
  oauthClient: { id: provisioner, secretName: tenant-auth-oauth }
  issuerUpstream: di-platform-gateway.wasmcloud.svc.cluster.local:80
  issuerUpstreamPodPort: 8080
  consolePublicUrl: http://console.{tenant}.localhost:28180
  controllerPublicUrl: https://controller.{tenant}.localhost:28180
```

| Field | Required | Meaning |
| --- | --- | --- |
| `image` | yes | Tenant-auth image, pinned by digest (`<repository>@sha256:<digest>`). A new digest rolls the controller and console. |
| `issuer` | yes | identity-server issuer URL, as both pods and browsers name it. |
| `oauthClient.id`, `oauthClient.secretName` | yes | The identity-server provisioner client ID and a Secret in the platform namespace (`wasmcloud`) holding its secret (key `clientSecret`). Reconcile uses it to register each tenant's console and CLI OAuth clients automatically. |
| `oauthClient.secretKey` | no | Secret key to read instead of `clientSecret`. |
| `issuerUpstream` | no | For a loopback issuer: the in-cluster `<service>.<namespace>:<port>` a sidecar forwards the issuer port to. |
| `issuerUpstreamPodPort` | no | The pod port behind `issuerUpstream`. |
| `issuerIp` | no | Issuer IPv4 address when pods cannot resolve its hostname. |
| `consolePublicUrl` | no | Browser-visible console URL; `{tenant}` is replaced. Derived from `routeUrlPattern` when routable, else `http://127.0.0.1:8787`. |
| `controllerPublicUrl` | no | Controller URL shown to users and CLIs; `{tenant}` is replaced. Derived from `routeUrlPattern` when routable, else `https://localhost:8788`. |
| `registry` | no | The tenant registry. See [Tenant registry](#tenant-registry). |

Both pods run in `di-runtime-<tenant>`. The runtime quota grows by their limits, so the
tenant's `spec.resources` stays the budget for its hosts and backing services. `Tenant.spec.resources.apiKeys`
caps the number of API keys in the tenant (default `1000`, range `1`–`10000`). The controller
runs one replica with the `Recreate` strategy; proxy sessions live in its memory.

Each tenant gets its own CA. The public trust bundle (`ca.crt`) is published to ConfigMap
`tenant-controller-ca` in `di-runtime-<tenant>` (and projected into `tenant-controller-ca-pub` in
`di-tenant-<tenant>`).

Unsetting `tenantAuth` removes every tenant-auth object, including the registry, and the quota
increase. Deleting a Tenant removes them too.

The reconcile does not adopt objects created by the earlier `deploy-local.ts` script.
`TenantAuthReady` reports `Refusing to adopt` until you delete them.

## Status conditions

The Tenant reports tenant-auth on its own condition. `Ready`, and with it every member's
access, never depends on the controller, console, or registry.

| Condition | Reason | Meaning |
| --- | --- | --- |
| `Ready` | `Reconciled` | Tenant resources are ready. |
| `Ready` | `Provisioning` | Waiting for runtime and backend deployments. |
| `Ready` | `Suspended` | The tenant is suspended; access is revoked. |
| `Ready` | `ReconcileError` | A tenant object failed to apply, for example a hostgroup conflict. The message carries the error. |
| `TenantAuthReady` | `Reconciled` / `Ready` | The controller and console (and registry, when configured) are ready. |
| `TenantAuthReady` | `Provisioning` | Waiting for the controller, console, or registry rollout. |
| `TenantAuthReady` | `Disabled` | Per-tenant auth is disabled for this installation or tenant. |
| `TenantAuthReady` | `PlatformConfigMissing` | Required platform configuration or Secret for tenant-auth is missing. |
| `TenantAuthReady` | `WaitingForUserController` | Waiting for the user/membership controller prerequisites before reconciling tenant-auth. |
| `TenantAuthReady` | `OAuthClientError` | Per-tenant OAuth client registration or rotation against the identity server failed. Existing workloads keep running. |
| `TenantAuthReady` | `ControllerCaNotOwned` | Secret `tenant-controller-ca-<tenant>` in the platform namespace was not written by this installation for this Tenant. Delete the foreign Secret to let the controller issue its own. |
| `TenantAuthReady` | `RouteError` | A gateway-shaped public URL cannot be routed. See [Gateway routes](#gateway-routes). |
| `TenantAuthReady` | `ApiKeyMigrationWaiting` | Waiting for `tenantAuth.image` to roll out before migrating legacy API keys. |
| `TenantAuthReady` | `ApiKeyMigrationFailed` | One or more legacy API keys could not be migrated (for example, `spec.resources.apiKeys` was exceeded). |
| `TenantAuthReady` | `RegistryHostConflict` | Another WorkloadDeployment claims the registry HTTP host. The message names it; the registry is not served until it is removed. |
| `TenantAuthReady` | `RegistryHostImageUnsupported` | `tenantHostImage` does not support isolated registry NATS credentials; update `tenantHostImage` to the current platform default. |
| `TenantAuthReady` | `RegistryStatefulSetNotOwned` | The registry backing StatefulSet or storage resource is not owned by this Tenant installation. |
| `TenantAuthReady` | `RegistryMigrating` | The registry is temporarily stopped while its object store is migrated to its isolated NATS account. |
| `TenantAuthReady` | `RegistryMigrationFailed` | The registry NATS store migration Job failed; inspect its logs and delete the Job to retry. |
| `TenantAuthReady` | `HostPullError` | The tenant hosts' registry wiring could not be read. The hosts are left as they were. |
| `TenantAuthReady` | `ReconcileError` | The tenant-auth step failed, for example on objects it refuses to adopt or a missing permission. |

Tenant-auth reconciles even when the tenant's own objects fail to apply. In that case the
Tenant reports both `Ready` False with `ReconcileError` and a separate `TenantAuthReady`.

```bash
kubectl get tenant <tenant> -o jsonpath='{range .status.conditions[*]}{.type}={.status} {.reason}: {.message}{"\n"}{end}'
```

## Gateway routes

When the platform publishes the [HTTP gateway](platform.md#tenant-kubeconfigs-and-http-gateway)
(`routeUrlPattern` is set), `createPlatform` and the operator derive the public URLs for the
`console`, `controller`, and `registry` services automatically unless overridden:

- With `routeUrlPattern: http://{host}.{tenant}.localhost:28180`, the derived defaults are
  `http://console.{tenant}.localhost:28180`, `https://controller.{tenant}.localhost:28180`, and
  `https://registry.{tenant}.localhost:28180`.
- When `routeUrlPattern` is unset or does not carry a routable service/host template, the fallback
  loopback defaults are `http://127.0.0.1:8787` (console), `https://localhost:8788` (controller),
  and `https://localhost:8790` (registry).

For routed `<label>.{tenant}.localhost` URLs on the gateway port:

- **Console:** plain HTTP to `tenant-console:8787`, with the original `Host`.
- **Controller and registry:** TLS passthrough. The gateway reads only the SNI name and pipes the
  connection to `tenant-controller:8788` (or `:8790` for the registry). The controller's own
  certificate covers both public hosts and verifies end to end. Plain HTTP to the controller or
  registry host gets `400`.

A URL is routed only when all of these hold:

- `routeUrlPattern` uses `http://`. A TLS terminator in front of the gateway breaks controller
  passthrough.
- The console URL uses `http://` and the controller and registry URLs use `https://`.
- The URL uses the gateway port.
- The label is a valid DNS label and is not shared with another tenant-auth URL.

A gateway-shaped URL that fails these checks is reported on `TenantAuthReady` with reason
`RouteError`; `Ready` is unaffected. Loopback defaults (`localhost` / `127.0.0.1`), other hosts,
and any URL while no gateway is published stay unrouted; reach them by port-forward.

Routed URLs are added to ConfigMap `di-platform-routes` in `di-tenant-<tenant>` as `consoleUrl`
and `controllerUrl`, next to `urlTemplate`. A routed label is taken away from tenant
workloads: `console.<tenant>.localhost` no longer reaches `di-http`.

## Developer workflow over `/v1`

You can work against a tenant controller with either `di-tenant` (`@di-framework/tenant-cli`,
which requires Bun) or `di-framework platform` (`@di-framework/cli-plugin-platform` **6.3.0**).
Both share the credential store at `$DI_FRAMEWORK_HOME/credentials.json` (default
`~/.di-framework/credentials.json`, mode `0600`) and require no Kubernetes credential.

### Log in and trust the controller CA

Extract the tenant CA from `tenant-controller-ca` (or `tenant-controller-ca-pub` in
`di-tenant-<tenant>`) and pass `--ca-file` on `login`:

```bash
kubectl -n di-runtime-acme get configmap tenant-controller-ca \
  -o jsonpath='{.data.ca\.crt}' > tenant-ca.crt

di-tenant login --controller https://controller.acme.localhost:28180 \
  --account acme --ca-file ./tenant-ca.crt
di-tenant whoami
di-tenant logout
```

- `login` calls `GET /v1/auth/info` for the account, identity-server
  issuer, and per-tenant public client ID, then runs a browser OIDC flow
  with PKCE and a loopback redirect. `--no-browser` prints the sign-in URL instead of opening it;
  `--api-key <key>` logs in with a `dik_` API key and skips the browser.
- `--ca-file <pem>` stores the PEM bundle in the credential entry, so subsequent `di-tenant` and
  `di-framework platform` commands (including `registry login`) trust the controller CA without
  repeating the flag. Pass `--no-ca` on a later `login` to clear a stored CA and rely on system
  roots or `NODE_EXTRA_CA_CERTS`.
- Tokens near expiry are refreshed automatically before the next command. `logout` revokes the
  refresh token at the issuer and removes the stored credential. `--account`, `DI_TENANT_ACCOUNT`,
  or the single stored login selects the tenant.

### `di-tenant` commands

```text
di-tenant login --controller <url> [--account <tenant>] [--api-key <key>] [--ca-file <pem> | --no-ca] [--no-browser]
di-tenant logout | whoami
di-tenant deploy preview|apply --env <prod|staging> --bundle <file>
di-tenant deployments list|stats --env <prod|staging> [--service <name>]
di-tenant deployments rollback --service <name> --env <prod|staging> [--to <id>]
di-tenant deployments remove --service <name> --env <prod|staging>
di-tenant services create <keyvalue|messaging|blobstore|postgres|egress> --name <name> --env <prod|staging> [--class] [--storage] [--memory] [--cpu] [--deletion-policy] [--destination]
di-tenant services delete --name <name> --env <prod|staging>
di-tenant secrets|vars list|set|update|unset [name] --env <prod|staging> [--from-file <path|->]
di-tenant registry [info] | registry login [--config <file> | --with <docker|podman|oras>]
di-tenant registry logout [--host <host>] [--config <file> | --with <docker|podman|oras>]
di-tenant logs --service <name> --env <prod|staging> [--deployment <id>] [--follow] [--since <dur>] [--tail <n>]
di-tenant proxy --service <name> --env <prod|staging> [--port <n>]
di-tenant init [name] [--dir <path>] [--name <name>] [--force]
```

- `di-tenant deployments remove --service <name> --env <env>` (`DELETE /v1/deployments/{service}?env=<env>`)
  deletes the WorkloadDeployment `<service>-<env>`, its `ServiceBinding`s, and its
  revision history ConfigMaps in that environment.
- `di-tenant services delete --name <name> --env <env>` (`DELETE /v1/services/{name}?env=<env>`)
  deletes a `BackingService`. It is refused with `409 Conflict` (listing the bound deployments)
  while any `ServiceBinding` in the tenant still references the service, regardless of
  `deletionPolicy` (`Retain` or `Delete`).
- The typed `/v1` client is published as `@di-framework/tenant-cli/client` (with test bundle
  helpers at `@di-framework/tenant-cli/testing` and the OpenAPI contract in `api/v1/openapi.yaml`).

### Controller-backed targets in `di-framework platform`

In `@di-framework/cli-plugin-platform` **6.3.0**, `di-framework.deploy.toml` supports
**account** and **controller** targets that deploy over `/v1` with no `kubeconfig`:

```toml
default-target = "acme-staging"

[targets.acme-staging]
account = "acme"
controller = "https://controller.acme.localhost:28180"
env = "staging"

[targets.acme-prod]
account = "acme"
domain = "example.com"          # derives https://acme.controller.example.com
env = "prod"
```

```bash
di-framework platform login --target acme-staging --ca-file ./tenant-ca.crt
di-framework platform whoami --target acme-staging

# Build a standalone /v1 DeployBundle JSON file (pushes component and pins @sha256 digest):
di-framework platform build --bundle dist/bundle.json --target acme-staging

# Preview or apply a deployment over /v1:
di-framework platform deploy --target acme-staging --preview
di-framework platform deploy --target acme-staging

# Manage vars, secrets, and logs over /v1:
di-framework platform vars set LOG_LEVEL --target acme-staging --value debug
di-framework platform secrets set db-password --target acme-staging --from-file ./db-password.txt
di-framework platform logs --target acme-staging --follow
di-framework platform destroy --target acme-staging
di-framework platform logout --target acme-staging
```

On an account or controller target, `di-framework platform deploy` queries
`GET /v1/deploy/registry`, pushes the compiled component to the tenant registry's public URL,
rewrites the bundle's component image to the in-cluster pull host
(`tenant-registry.di-runtime-<tenant>.svc/<repo>@sha256:<digest>`), and submits the bundle to
`POST /v1/deploy/preview` (with `--preview`) or `POST /v1/deploy`.

## Vars and secrets

The controller's `/v1` API stores per-environment configuration in `di-tenant-<tenant>`.
Environments are `prod` and `staging`. Every call needs `env`.

| Operation | Method and path | Roles |
| --- | --- | --- |
| List vars (names, values, update times) | `GET /v1/vars?env=<env>` | developer, viewer |
| Set a var | `PUT /v1/vars/{name}?env=<env>` | developer |
| Update an existing var (`404` if missing) | `PATCH /v1/vars/{name}?env=<env>` | developer |
| Unset a var | `DELETE /v1/vars/{name}?env=<env>` | developer |
| List secrets (names and update times only) | `GET /v1/secrets?env=<env>` | developer |
| Set a secret | `PUT /v1/secrets/{name}?env=<env>` | developer |
| Update an existing secret (`404` if missing) | `PATCH /v1/secrets/{name}?env=<env>` | developer |
| Unset a secret | `DELETE /v1/secrets/{name}?env=<env>` | developer |

Set and update take `{"value": "..."}`. With the CLI, values come from a file or stdin so they
stay out of shell history:

```bash
di-tenant vars set LOG_LEVEL --env staging --from-file -
di-tenant secrets set db-password --env prod --from-file ./db-password.txt
di-tenant secrets list --env prod
```

- **Vars** live in one ConfigMap per environment, `di-vars-<env>`. Names follow environment
  variable rules (`^[A-Za-z_][A-Za-z0-9_]*$`).
- **Secrets** live in one Secret per name and environment, `<name>.<env>`. `<name>` is a
  lowercase DNS label starting with a letter. It reaches the workload as an environment variable,
  upper-cased with `-` replaced by `_` (`db-password` becomes `DB_PASSWORD`). The `di-binding-*`
  and `di-bs-*` names are reserved for the platform.
- Secret values are never returned. Developers can create, replace, and delete tenant Secrets
  but not read them; viewers have no Secret access.
- A var and a secret that map to the same environment variable name in one environment are
  refused with `409`. A concurrent write is also a `409`; retry it.
- **Unset checks against deployed workloads:**
  - `DELETE /v1/secrets/{name}?env=<env>` (`secrets unset`) is **refused with `409 Conflict`**
    when any deployed WorkloadDeployment in the tenant lists `<name>.<env>` in `secretFrom`. The
    `application/problem+json` `detail` names the referencing workloads; remove or redeploy them
    without the secret first.
  - `DELETE /v1/vars/{name}?env=<env>` (`vars unset`) **succeeds with `200`** and returns
    `{ "warnings": [...] }` when any deployed workload references `di-vars-<env>` in `configFrom`
    (printing `warning: <detail>` to stderr in the CLI). Emptying the last var keeps the empty
    `di-vars-<env>` ConfigMap so running workloads continue to place replicas.

On deploy, each var of the environment and each secret named in the bundle reach the workload
as environment variables.

## Tenant registry

### Configure it

Add `tenantAuth.registry` to give every tenant its own OCI registry:

```yaml
tenantAuth:
  # ...
  registry:
    component: ghcr.io/di-framework/oci-registry@sha256:<digest>
    publicUrl: https://registry.{tenant}.localhost:28180
```

| Field | Required | Default | Meaning |
| --- | --- | --- | --- |
| `component` | yes | | Registry component, pinned by digest. |
| `publicUrl` | no | Derived from `routeUrlPattern`, else `https://localhost:8790` | Origin users log in and push to; `{tenant}` is replaced. `https://<label>.{tenant}.localhost` on the gateway port is routed by TLS passthrough, like the controller. |
| `limits.maxBodyBytes` | no | `536870912` (512 MiB) | Largest request body; larger is `413`. |
| `limits.upstreamTimeoutMs` | no | `60000` | Wait for the registry's response headers after the body is forwarded; then `504`. |
| `limits.maxConcurrent` | no | `16` | Requests at once; more are `503`. |
| `limits.uploadIdleTimeoutMs` | no | `60000` | How long an upload may send no byte; then `408`. |

Limits are positive integers. The reconcile renders them on the controller Deployment; a hand
edit is reverted.

The reconcile deploys the component as WorkloadDeployment `di-tenant-registry` in
`di-tenant-<tenant>`, on the tenant's own hosts. It takes one extra WorkloadDeployment slot of
quota, so the tenant keeps all of `spec.resources.workloads`. Its readiness and problems are
reported on `TenantAuthReady`, never on `Ready`. Unsetting `tenantAuth.registry` deletes the
workload and its pull credentials and gives the quota slot back.

The fallback `publicUrl` (`https://localhost:8790`) uses a port-forward
(`kubectl port-forward svc/tenant-controller 8790` in `di-runtime-<tenant>`), which only
developers may open. With a published gateway, use the routed
`https://registry.{tenant}.localhost:<gateway port>` so viewers can pull too.

### Reserved names

The registry's HTTP host is the label of `publicUrl` (`registry` by default). It is reserved
even while no registry is configured. Admission denies tenant users, and therefore `/v1/deploy`:

- any change to `di-tenant-registry`;
- any change to a WorkloadDeployment labelled `platform.di-framework.dev/component: tenant-auth`;
- any WorkloadDeployment whose `wasi:http` `config.host` is the registry host, in any case,
  with a trailing dot or a port.

`/v1/deploy` also refuses, with `422`, a service whose `<service>-<env>` host equals the
registry host. A workload that claimed the host before the reservation keeps its route; the
registry is then not served and `TenantAuthReady` reports `RegistryHostConflict` with its name.
Delete that workload to clear the conflict on the next poll.

### Push as a developer

Log in and push with `di-tenant registry`, or query `GET /v1/deploy/registry` directly:

```bash
di-tenant registry                       # prints URL, login host, and push prefix
di-tenant registry login                 # verifies GET <url>/v2/ using stored CA, writes Docker config
di-tenant registry login --with oras     # or docker / podman (passes password on stdin)
oras push registry.acme.localhost:28180/web:1.0.0 --ca-file tenant-ca.crt ...
di-tenant registry logout
```

`GET /v1/deploy/registry` is open to developers and viewers with their bearer credential. It
returns `url` (scheme, host, and optional port), an optional `repositoryPrefix`, `auth`
(`basic-identity`), and a `username` hint (`token`). It answers `503` when no registry is
configured, or when one is configured but not served (a host conflict or a suspended tenant).

When logging in directly with `oras`, `docker`, or `podman`, pass your identity-server access
token or a `dik_` API key as the Basic password (`username` is `token`). Developers may push and
pull; viewers may only pull. Identity access tokens expire, so a `dik_` API key suits CI. Plain
HTTP to the registry host through the gateway gets `400`.

### Reference the image in a workload

Push to the public origin, but reference the same repository on the in-cluster pull host in the
workload you deploy. Tenant hosts cannot use the public origin.

```text
registry.acme.localhost:28180/web:1.0.0             # push
tenant-registry.di-runtime-acme.svc/web@sha256:<d>  # workload component image
```

The pull host is `tenant-registry.di-runtime-<tenant>.svc` (no port). `/v1/deploy` and
`/v1/deploy/preview` refuse, with `422`, a bundle whose component or service image names the
public origin. The problem `detail` names the in-cluster reference to use. (When deploying with
`di-framework platform deploy` on an account or controller target, the CLI rewrites the image to
the pull host automatically.)

### How tenant hosts pull

- Service `tenant-registry` in `di-runtime-<tenant>` (`tenant-registry.di-runtime-<tenant>.svc:443`)
  points at the controller's pull-only listener (`:8791`), which allows `GET` and `HEAD` only (`405`
  otherwise) and admits only the tenant's host pods via NetworkPolicy.
- The listener always serves TLS on port 443 with the controller certificate, and the tenant hosts
  always mount the controller CA (`--oci-ca-path=/registry-ca/ca.crt`), even when
  `insecureRegistry` or `insecureRegistries` is set on the platform.
- Secret `di-tenant-registry-pull` in `di-runtime-<tenant>` holds a platform-generated pull-only
  credential mounted into the tenant host pods. Tenant users cannot read it; delete the Secret to
  rotate the token without restarting pods.

## Operations

### Tenant host core instances

`spec.runtime.coreInstances` sets `WASH_CORE_INSTANCES` on the tenant's hostgroup Deployment.
It is an integer from `1` to `10000`, default `100`. Set it in the platform `tenants`
declaration:

```yaml
tenants:
  - name: acme
    runtime:
      coreInstances: 300
```

The CRD schema enforces the bounds, and `pulumi up` rejects an out-of-range value before it
reaches the cluster. Changing the value rolls the tenant host.

Do not `kubectl set env` the hostgroup Deployment. That takes ownership of the value away from
`di-platform-controller`, and every later apply of the Deployment fails with `409`, leaving the
Tenant not Ready. To clear an existing hand edit, once per Deployment:

1. Set `coreInstances` to the live value and run `pulumi up`. If the same update also upgrades
   the package to a release that adds the field, follow the
   [two-step upgrade](#upgrade-when-a-release-adds-a-tenant-field) first.
2. Wait until the Tenant is `Ready=True` and `di-platform-controller` owns the
   `WASH_CORE_INSTANCES` value:

   ```bash
   T=<tenant>
   OWNERS='.metadata.managedFields[] | select([.fieldsV1 | .. | objects | select(has("k:{\"name\":\"WASH_CORE_INSTANCES\"}")) | .["k:{\"name\":\"WASH_CORE_INSTANCES\"}"] | has("f:value")] | any) | .manager'
   kubectl get tenant $T -o json | jq -r '.status.conditions[] | select(.type=="Ready") | .status'
   kubectl get deploy hostgroup-tenant-$T -n di-runtime-$T --show-managed-fields -o json | jq -r "$OWNERS"
   ```

   The second command must list `di-platform-controller` (and still `kubectl-set`).
3. Remove the stale `kubectl-set` entry. The `test` operations make the patch apply only if that
   index still holds it:

   ```bash
   i=$(kubectl get deploy hostgroup-tenant-$T -n di-runtime-$T --show-managed-fields -o json \
     | jq '.metadata.managedFields | map(.manager=="kubectl-set" and .operation=="Update") | index(true)')
   if [ "$i" = null ]; then echo "no kubectl-set entry; nothing to remove"; else
     kubectl patch deploy hostgroup-tenant-$T -n di-runtime-$T --type=json \
       -p "[{\"op\":\"test\",\"path\":\"/metadata/managedFields/$i/manager\",\"value\":\"kubectl-set\"},{\"op\":\"test\",\"path\":\"/metadata/managedFields/$i/operation\",\"value\":\"Update\"},{\"op\":\"remove\",\"path\":\"/metadata/managedFields/$i\"}]"
   fi
   ```

4. Re-run the owner check. It must print exactly `di-platform-controller`.

Keep this order. Removing `kubectl-set` before the controller owns the value leaves it unowned,
and the next apply resets it to `100`, rolling the host.

### Upgrade when a release adds a Tenant field

`pulumi up` cannot add a Tenant spec field to the CRD and set it on an existing Tenant in one
update. The preview checks the Tenant against the live CRD schema and fails with an error such as:

```text
.spec.runtime.coreInstances: field not declared in schema
```

Upgrade in two steps. This applies to any new Tenant field (such as `spec.runtime.coreInstances`
or `spec.resources.apiKeys`):

1. Run `pulumi up` with the new package and the field unset. This updates the CRD schema, the
   controller, and the tenant-auth image.
2. Set the field and run `pulumi up` again.

## Next steps

- [Platform](platform.md) - Deployment targets, tenant kubeconfigs, and the HTTP gateway
- [Platform backing services](backing-services.md) - Request Redis, NATS, blobstore, PostgreSQL, and egress
- [Kubernetes with di-framework-kube](kube.md) - Local cluster lifecycle and platform settings
- [Platform README](https://github.com/di-framework/platform/blob/main/platform/platform/README.md) - Full reconcile, network, and RBAC details
- [Tenant CLI README](https://github.com/di-framework/platform/blob/main/platform/tenant-cli/README.md) - Commands, the `/v1` contract, and the typed client
