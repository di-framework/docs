# Tenant access and registry

Each tenant can run its own **controller** and **console**, so tenant users work with an
identity-server login or a tenant API key instead of a Kubernetes credential. The controller
can also front a per-tenant OCI registry that tenant hosts pull workload components from.

These features are in published `@di-framework/platform` **6.0.10** and
`@di-framework/tenant-cli` **6.0.10**, both from
[di-framework/platform](https://github.com/di-framework/platform). `di-framework-kube` still
installs `@di-framework/platform@6.0.2` by default; see [Kubernetes with di-framework-kube](kube.md).

<!-- TODO: confirm a published ghcr.io/di-framework/tenant-auth digest that includes the
registry listeners (platform#129, #130) and a published ghcr.io/di-framework/oci-registry
digest. The platform README says the oci-registry publish workflow has not been run yet. -->

## How it fits together

| Part | Runs in | Role |
| --- | --- | --- |
| Tenant controller | `di-runtime-<tenant>` | Authenticating proxy in front of the Kubernetes API and the `/v1` API. Resolves the caller's identity token or `dik_` API key, checks the caller's `User` membership in the tenant, and acts with a short-lived token for that user's ServiceAccount. Only paths inside `di-tenant-<tenant>` and `di-runtime-<tenant>` are forwarded. |
| Tenant console | `di-runtime-<tenant>` | OIDC relying party for the browser. Signs users in and shows overview, logs, members, and API keys by calling the controller as the user. Holds no cluster credential. |
| `di-tenant` | Developer machine | Tenant CLI in `@di-framework/tenant-cli`. Talks only to the controller. |
| Tenant registry | `di-tenant-<tenant>`, on the tenant's hosts | Optional OCI registry component. The controller decides who may push and pull. |

Permissions are the user's own tenant role, so `developer` and `viewer` RBAC, quotas, and
admission policies apply unchanged. Suspending a `User` removes its ServiceAccount and cuts access,
including cached tokens.

## Enable tenant auth

Set the platform configuration `tenantAuth`. The tenant reconcile then deploys a controller
and console for every Tenant:

```yaml
tenantAuth:
  image: ghcr.io/di-framework/tenant-auth@sha256:<digest>
  issuer: https://identity.example.com
  oauthClient: { id: <client-id>, secretName: tenant-auth-oauth }
  consolePublicUrl: http://console.{tenant}.localhost:28180
  controllerPublicUrl: https://controller.{tenant}.localhost:28180
```

| Field | Required | Meaning |
| --- | --- | --- |
| `image` | yes | Tenant-auth image, pinned by digest (`<repository>@sha256:<digest>`). A new digest rolls the controller and console. |
| `issuer` | yes | identity-server issuer URL, as both pods and browsers name it. |
| `oauthClient.id`, `oauthClient.secretName` | yes | The console's confidential OAuth client and a Secret in the platform namespace holding its secret (key `clientSecret`). |
| `oauthClient.secretKey` | no | Secret key to read instead of `clientSecret`. |
| `issuerUpstream` | no | For a loopback issuer: the in-cluster `<service>.<namespace>:<port>` a sidecar forwards the issuer port to. |
| `issuerUpstreamPodPort` | no | The pod port behind `issuerUpstream`. |
| `issuerIp` | no | Issuer IPv4 address when pods cannot resolve its hostname. |
| `consolePublicUrl` | no | Browser-visible console URL; `{tenant}` is replaced. Default `http://127.0.0.1:8787`. |
| `controllerPublicUrl` | no | Controller URL shown to users and CLIs; `{tenant}` is replaced. Default `https://127.0.0.1:8788`. |
| `registry` | no | The tenant registry. See [Tenant registry](#tenant-registry). |

Until per-tenant OAuth clients land, every console shares one confidential client. Store its
secret in the platform namespace before enabling `tenantAuth`; the console Deployment cannot
start until that Secret exists. The reconcile copies it into each runtime namespace.

Both pods run in `di-runtime-<tenant>`. The runtime quota grows by their limits, so the
tenant's `spec.resources` stays the budget for its hosts and backing services. The controller
runs one replica with the `Recreate` strategy; proxy sessions live in its memory.

The platform controller issues the tenant controller a self-signed certificate. The console
pins its CA from ConfigMap `tenant-controller-ca` in `di-runtime-<tenant>`. The certificate
is replaced 30 days before it expires or when its names change. Kubeconfigs the console issued
before a renewal embed the old CA; download a new one.

Unsetting `tenantAuth` removes every tenant-auth object, including the registry, and the quota
increase. Deleting a Tenant removes them too.

The reconcile does not adopt objects created by the earlier `deploy-local.ts` script.
`TenantAuthReady` reports `Refusing to adopt` until you delete them. The full object list is
in the [platform README](https://github.com/di-framework/platform/blob/main/platform/platform/README.md#tenant-controller-and-console).

## Status conditions

The Tenant reports tenant-auth on its own condition. `Ready`, and with it every member's
access, never depends on the controller, console, or registry.

| Condition | Reason | Meaning |
| --- | --- | --- |
| `Ready` | `Reconciled` | Tenant resources are ready. |
| `Ready` | `Provisioning` | Waiting for runtime and backend deployments. |
| `Ready` | `Suspended` | The tenant is suspended; access is revoked. |
| `Ready` | `ReconcileError` | A tenant object failed to apply, for example a hostgroup conflict. The message carries the error. |
| `TenantAuthReady` | `Reconciled` | The controller and console (and registry, when configured) are ready. |
| `TenantAuthReady` | `Provisioning` | Waiting for the controller, console, or registry. |
| `TenantAuthReady` | `RouteError` | A gateway-shaped public URL cannot be routed. See [Gateway routes](#gateway-routes). |
| `TenantAuthReady` | `RegistryHostConflict` | Another WorkloadDeployment claims the registry host. The message names it; the registry is not served until it is removed. |
| `TenantAuthReady` | `HostPullError` | The tenant hosts' registry wiring could not be read. The hosts are left as they were. |
| `TenantAuthReady` | `ReconcileError` | The tenant-auth step failed, for example on objects it refuses to adopt or a missing permission. |

Tenant-auth reconciles even when the tenant's own objects fail to apply. In that case the
Tenant reports both `Ready` False with `ReconcileError` and a separate `TenantAuthReady`.

```bash
kubectl get tenant <tenant> -o jsonpath='{range .status.conditions[*]}{.type}={.status} {.reason}: {.message}{"\n"}{end}'
```

## Gateway routes

When the platform publishes the [HTTP gateway](platform.md#tenant-kubeconfigs-and-http-gateway)
(`routeUrlPattern` is set), a public URL of the form `<label>.{tenant}.localhost` on the gateway
port is routed through it. A new Tenant then gets a reachable console and controller with no
port-forward.

- **Console:** plain HTTP to `tenant-console:8787`, with the original `Host`.
- **Controller:** TLS passthrough. The gateway reads only the SNI name and pipes the connection
  to `tenant-controller:8788`. The controller's own certificate, which covers the public host,
  verifies end to end. Plain HTTP to the controller host gets `400`.

A URL is routed only when all of these hold:

- `routeUrlPattern` uses `http://`. A TLS terminator in front of the gateway breaks controller
  passthrough.
- The console URL uses `http://` and the controller URL uses `https://`.
- The URL uses the gateway port.
- The label is a valid DNS label and is not shared with another tenant-auth URL.

A gateway-shaped URL that fails these checks is reported on `TenantAuthReady` with reason
`RouteError`; `Ready` is unaffected. The `127.0.0.1` defaults, other hosts, and any URL while no
gateway is published stay unrouted; reach them by port-forward.

Routed URLs are added to ConfigMap `di-platform-routes` in `di-tenant-<tenant>` as `consoleUrl`
and `controllerUrl`, next to `urlTemplate`. A routed label is taken away from tenant
workloads: `console.<tenant>.localhost` no longer reaches `di-http`. NetworkPolicies admit only
the gateway pods to each routed port.

Clients of the controller must trust the tenant's CA from ConfigMap `tenant-controller-ca`.

## Log in with the tenant CLI

Install `@di-framework/tenant-cli`. Its `di-tenant` command requires Bun.

```bash
di-tenant login --controller https://controller.acme.localhost:28180 --account acme
di-tenant whoami
di-tenant logout
```

`login` reads `GET /v1/auth/info` for the account, issuer, and public client id, then runs a
browser sign-in with PKCE and a loopback redirect. The identity server must register that
public client (default id `tenant-cli`). `--no-browser` prints the sign-in URL instead of
opening it. `--api-key <key>` logs in with a `dik_` API key and skips the browser; create keys
on the console's API keys page.

The credential is stored in `$DI_FRAMEWORK_HOME/credentials.json` (default `~/.di-framework`).
Tokens near expiry are refreshed before the next command. `logout` revokes the refresh token at
the issuer. There is no token argument on any command. `--account`, `DI_TENANT_ACCOUNT`, or the
only stored login selects the tenant.

<!-- TODO: confirm how di-tenant trusts the tenant controller's self-signed CA
(tenant-controller-ca); the CLI has no CA flag. -->

The CLI is a pilot. Other commands are `deploy preview|apply`, `logs`, `services create`,
`deployments list|stats|rollback`, `secrets`, `vars`, `proxy`, and `init`. `deploy` sends a
bundle file; the CLI does not build bundles yet. The typed client is published as
`@di-framework/tenant-cli/client`, with the OpenAPI contract in `api/v1/openapi.yaml`.

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
| `publicUrl` | no | `https://127.0.0.1:8790` | Origin users log in and push to; `{tenant}` is replaced. `https://<label>.{tenant}.localhost` on the gateway port is routed by TLS passthrough, like the controller. |
| `limits.maxBodyBytes` | no | `536870912` (512 MiB) | Largest request body; larger is `413`. |
| `limits.upstreamTimeoutMs` | no | `60000` | Wait for the registry's response headers after the body is forwarded; then `504`. |
| `limits.maxConcurrent` | no | `16` | Requests at once; more are `503`. |
| `limits.uploadIdleTimeoutMs` | no | `60000` | How long an upload may send no byte; then `408`. |

Limits are positive integers. The reconcile renders them on the controller Deployment; a hand
edit is reverted.

The reconcile deploys the component as WorkloadDeployment `di-tenant-registry` in
`di-tenant-<tenant>`, on the tenant's own hosts. It stores data in the tenant hosts' blobstore.
It takes one extra WorkloadDeployment slot of quota, so the tenant keeps all of
`spec.resources.workloads`. Its readiness and problems are reported on `TenantAuthReady`,
never on `Ready`. Unsetting `tenantAuth.registry` deletes the workload, the host pull Secret
and Service, and gives the quota slot back.

The platform controller's ClusterRole gains `create` and `delete` on `workloaddeployments`.
`pulumi up` applies it; a hand-rolled upgrade must apply the ClusterRole before the new
controller, or `TenantAuthReady` reports `403`.

The default `publicUrl` is a port-forward (`kubectl port-forward svc/tenant-controller 8790`
in `di-runtime-<tenant>`), which only developers may open. With a published gateway, use the
routed `https://registry.{tenant}.localhost:<gateway port>` so viewers can pull too.

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

Ask the controller where the registry is:

```text
GET /v1/deploy/registry
```

Developers and viewers may call it with their bearer credential. The answer carries `url` (an
origin: scheme, host, and optional port), an optional `repositoryPrefix`, `auth`
(`basic-identity`), and a `username` hint (`token`). It answers `503` when no registry is
configured, or when one is configured but not served (a host conflict or a suspended tenant).

<!-- TODO: confirm whether di-tenant or the typed client will wrap GET /v1/deploy/registry;
neither does in 6.0.10. -->

Log in to the host of `url` with your identity-server access token or a `dik_` API key as the
Basic password; the username is ignored. Developers may push and pull; viewers may only pull.
Trust the tenant CA from `tenant-controller-ca`, for example with `oras login --ca-file` or
`/etc/docker/certs.d/<host>/ca.crt`.

```bash
oras login registry.acme.localhost:28180 --ca-file tenant-ca.crt
oras push registry.acme.localhost:28180/web:1.0.0 ...
```

Identity access tokens expire, so a stored `docker login` stops working. A `dik_` API key suits
CI. Plain HTTP to the registry host through the gateway gets `400`.

### Reference the image in a workload

Push to the public origin, but reference the same repository on the in-cluster pull host in the
workload you deploy. Tenant hosts cannot use the public origin.

```text
registry.acme.localhost:28180/web:1.0.0             # push
tenant-registry.di-runtime-acme.svc/web@sha256:<d>  # workload component image
```

The pull host is `tenant-registry.di-runtime-<tenant>.svc`, with no port. `/v1/deploy` and
`/v1/deploy/preview` refuse, with `422`, a bundle whose component or service image names the
public origin. The problem `detail` names the in-cluster reference to use.

### How tenant hosts pull

- Service `tenant-registry` in `di-runtime-<tenant>` points at a pull-only controller listener.
  It allows `GET` and `HEAD` only (`405` otherwise), so nothing can be pushed or deleted through
  it. NetworkPolicy admits only the tenant's host pods.
- Secret `di-tenant-registry-pull` in `di-runtime-<tenant>` holds a platform-generated
  credential that allows pulls only. Tenant users cannot read it. Delete the Secret to rotate
  it; no restart is needed.
- By default the listener serves TLS on port 443 with the controller certificate, and hosts
  trust the tenant CA. A certificate renewal rolls the hosts. With `insecureRegistry`, the
  listener is plain HTTP on port 80 and no CA is mounted.
- Wiring the hosts, a CA renewal, and unsetting the registry each roll the tenant hosts once.

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

Upgrade in two steps. This applies to any new Tenant field:

1. Run `pulumi up` with the new package and the field unset. This updates the CRD schema, the
   controller, and the tenant-auth image.
2. Set the field and run `pulumi up` again.

## Next steps

- [Platform](platform.md) - Deployment targets, tenant kubeconfigs, and the HTTP gateway
- [Platform backing services](backing-services.md) - Request Redis, NATS, blobstore, PostgreSQL, and egress
- [Kubernetes with di-framework-kube](kube.md) - Local cluster lifecycle and platform settings
- [Platform README](https://github.com/di-framework/platform/blob/main/platform/platform/README.md) - Full reconcile, network, and RBAC details
- [Tenant CLI README](https://github.com/di-framework/platform/blob/main/platform/tenant-cli/README.md) - Commands, the `/v1` contract, and the typed client
