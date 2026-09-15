# wasmCloud backing services

In **5.3.6**, tenant developers can request independent Redis and NATS instances through
`di-framework wasmcloud service`. The shared `@di-framework/platform` package installs their
Kubernetes APIs, provisions the backends, and projects connection configuration for bindings.

## What changed in 5.3.6

| Resource | Scope | Purpose |
| --- | --- | --- |
| `BackingServiceClass` | Cluster | Administrator-owned provider, sizing defaults, limits, and tenant visibility. |
| `BackingService` | Tenant namespace | Request an independent `keyvalue` (Redis) or `messaging` (NATS) instance. |
| `ServiceBinding` | Tenant namespace | Associate a binding name with a service and create protected host configuration. |

All three use `apiVersion: platform.di-framework.dev/v1alpha1`. The release adds their
installation, reconciliation, tenant RBAC, admission policies, quotas, and backend network
policies, together with the `service create`, `list`, `get`, `delete`, and `classes` commands.

For tenant `alpha`, requests and binding projections live in `di-tenant-alpha`. Backend
Deployments, Services, and connection Secrets live in `di-runtime-alpha`. A service named
`stock` gets resources named `di-bs-stock` and a connection Secret named `di-bs-stock-conn`.

## Prepare the platform and target

Use `@di-framework/platform` **5.3.6** and the wasmCloud CLI extension from the same release.
Updating the application packages alone does not update the platform controller or CRDs.
An administrator must update the platform package and apply the existing Pulumi stack. For
an extension-managed project:

```bash
cd deploy/platform
npm install --save-exact @di-framework/platform@5.3.6
pulumi preview --stack dev
```

Then run `di-framework wasmcloud platform deploy local --yes` from the workspace root. Keep
the existing project, backend, stack, and tenant declarations. For a kube-managed installation,
select the platform package through [kube's existing instance](kube.md#build-and-start-the-platform);
avoid creating a second stack for the same cluster.

The administrator must have declared the tenant and granted the caller a developer membership.
A User declaration does not issue a kubeconfig; credential issuance remains an administrator
operation. See [tenants and users](kube.md#tenants-and-users).

Service commands use `kubectl` with the credentials resolved from the selected
[`di-framework.deploy.toml` target](wasmcloud.md#deployment-manifest). They create custom
resources through the Kubernetes API; the platform controller provisions the backend.
For an external target, use the caller's tenant kubeconfig:

```toml
default-target = "alpha"

[targets.alpha]
kubeconfig = "${KUBECONFIG}"
namespace = "di-tenant-alpha"
registry = "registry.example.test/team"
```

The target schema includes a registry even when running only service commands. Service commands
do not publish an application image. `--target`, `--namespace`, and `--context` select the
connection; omitting `--namespace` uses the target's namespace. With a managed target, explicitly
select the tenant namespace if the platform outputs point to the platform namespace.

## Create and inspect a service

```bash
di-framework wasmcloud service classes --target alpha
di-framework wasmcloud service create keyvalue --name stock --target alpha --wait
di-framework wasmcloud service create messaging --name events --target alpha --wait
di-framework wasmcloud service list --target alpha
di-framework wasmcloud service get stock --target alpha --json
```

| Capability | Default class | Provider | Default sizing |
| --- | --- | --- | --- |
| `keyvalue` | `keyvalue-redis` | Redis | `128Mi` memory, `250m` CPU, `1Gi` storage parameter |
| `messaging` | `messaging-nats` | NATS with JetStream | `128Mi` memory, `250m` CPU, `1Gi` storage parameter |

Names contain lowercase letters and digits separated by hyphens, start with a letter, and have
at most 40 characters. `create` requires a type and `--name`; it rejects an existing name.
Use `--class`, `--memory`, `--cpu`, and `--storage` to request class-approved settings:

```bash
di-framework wasmcloud service create keyvalue --name cache --target alpha \
  --class keyvalue-redis --memory 256Mi --cpu 500m --storage 2Gi \
  --deletion-policy Retain --wait --timeout 180
```

`--wait` polls the Ready condition every two seconds; its default timeout is 120 seconds.
Without it, successful creation means the API accepted the request. `get` and `list` report
readiness and endpoint summaries. A failed class lookup or invalid sizing reports `Failed`;
a Deployment that is still starting reports `Provisioning`. Fix the request or platform
configuration and let the controller retry.

`classes` attempts to read cluster classes and falls back to the built-in defaults when none
are returned or the query fails. Tenant roles do not grant cluster-wide class access. A fallback
listing does not prove those classes are installed or that the caller can use them.

### Class configuration and limits

Platform installation seeds `keyvalue-redis` and `messaging-nats` by default. The Pulumi
`seedDefaultBackingClasses` setting disables automatic seeding when `false`;
`backingServiceClasses` supplies named class declarations that replace matching defaults or
add classes. Classes support `AllTenants` and `SelectedTenants` visibility; the latter uses
`allowedTenants`.

The 5.3.6 tenant admission policy accepts only the two approved default class names. Adding
another class does not make its name usable by tenant requests. Administrators can adjust the
existing classes' sizing and visibility while retaining their approved names.

Default class bounds are `64Mi`–`2Gi` memory, `50m`–`2` CPU, and `256Mi`–`20Gi` for the storage
parameter. Requests must also fit the tenant's CPU and memory budget. Tenant resource settings
`backingServices` and `serviceBindings` cap custom-resource counts, with defaults of 10 and 40.
Runtime ResourceQuota also covers compute and declares a `50Gi` storage-request budget.

Backends currently use node-local hostPath storage. The storage parameter is validated, but it
does not allocate a PVC or enforce a filesystem size limit. The storage-request quota does not
limit bytes written to those host paths.

## Project a binding

Create a `ServiceBinding` in the same namespace as its `BackingService`. Save this as
`stock-binding.yaml` and apply it with the same kubeconfig used by the target:

```yaml
apiVersion: platform.di-framework.dev/v1alpha1
kind: ServiceBinding
metadata:
  name: warehouse-stock
  namespace: di-tenant-alpha
spec:
  serviceName: stock
  bindingName: stock
  capability: keyvalue
```

```bash
kubectl apply -f stock-binding.yaml
kubectl -n di-tenant-alpha get servicebindings.platform.di-framework.dev warehouse-stock -o yaml
kubectl -n di-tenant-alpha get configmap di-binding-stock
```

There is no ServiceBinding create command in 5.3.6. The controller checks that the referenced
service exists in the same namespace, matches the capability, and is Ready with an endpoint.
Unresolved or conflicting bindings report `Failed` and are retried on later reconciliations.

The controller creates `di-binding-<bindingName>` in the tenant namespace:

| Capability | ConfigMap keys |
| --- | --- |
| `keyvalue` | `backend=redis`, `url`, `prefix=<bindingName>:` |
| `messaging` | `backend=nats`, `url` |

When the backend connection contains supported credential fields, they are projected into a
separate `di-binding-<bindingName>-creds` Secret. Default Redis/NATS provisioning does not
configure backend authentication, so that Secret may be absent. CR status contains references
and readiness, never credential values.

Multiple ServiceBindings can share a `bindingName` when they agree on `serviceName` and
`capability`. The controller retains the shared projection while any matching binding remains,
including when the elected owner is removed. Deleting the last binding removes its projection;
it does not delete the BackingService. Endpoint and credential changes are reconciled into the
projection.

### Workload integration boundary

The projected configuration is intended for a **named** wasmCloud host interface. This fragment
shows the host-side contract for `stock`; it is not a complete deployable workload:

```yaml
hostInterfaces:
  - name: stock
    namespace: wasmcloud
    package: keyvalue
    configFrom:
      - name: di-binding-stock
    # Add secretFrom only when di-binding-stock-creds exists.
```

A messaging entry uses `package: messaging` and its own binding name. Subscription options stay
in the workload's inline `config`.

**Automatic application/decorator-to-ServiceBinding wiring is not included in 5.3.6.** Creating
the service and binding does not modify an existing workload or change its guest imports. The
[QuickJS native binding path](wasmcloud.md#binding-changes-in-530) still emits unnamed provider
requirements. End-to-end named-backend deployment wiring is tracked in
[issue #455](https://github.com/di-framework/di-framework/issues/455).

The Kubernetes `ServiceBinding` resource is also separate from the in-process
[`@ServiceBinding` decorator](service-bindings.md).

## Tenant restrictions

The tenant is the authorization boundary. Developer memberships can create, update, and delete
BackingServices and ServiceBindings in their tenant namespace; viewers can read them. Classes
remain administrator-owned. `workloadName` on a ServiceBinding is descriptive and does not grant
per-workload access; a Redis prefix is a key-naming convention, not authorization.

Kubernetes admission control checks requests before accepting them. Platform policies enforce
ownership labels, approved classes, and same-namespace service references. Tenant workloads may
use restricted `wasi` HTTP/config interfaces and `wasmcloud` keyvalue/messaging interfaces with
controller-managed references. Arbitrary backend URLs, user-supplied backend references, and
host-volume mounts are rejected. Stock keyvalue and default NATS retain transitional exceptions;
the stock ConfigMap cannot select a messaging backend.

Tenant users cannot mutate the reserved `di-bs-*`, `di-binding-*`, and `di-tenant-stock`
ConfigMaps/Secrets. Backend network policies allow ingress from the tenant hostgroup and require
an enforcing network-policy engine. Tenant developers still have Secret read access and runtime
pod port-forward access, so this does not isolate credentials or backends from other developers
within the same tenant. Shared hosts remain disabled.

## Deletion and existing data

```bash
di-framework wasmcloud service delete cache --target alpha
```

`spec.deletionPolicy` defaults to `Retain`:

- **Retain:** scale backend Deployments to zero and wait for the observed shutdown before
  releasing the service finalizer. Backend resources and hostPath data remain.
- **Delete:** request removal of owned Deployments, Services, and connection Secrets, then
  release the finalizer. This does not erase hostPath data or wait for all resource deletion
  to finish.

Tenant suspension scales backends down and reports `Suspended`. Do not treat `service delete`
as a data purge or a check that no application still depends on the service. Deleting a binding
revokes its projected configuration; workload rollout and data migration are separate operations.

Application NATS instances use `di-bs-<name>`. The fixed `di-nats` is the runtime data plane and
is managed by the tenant controller. Existing warehouse `di-redis` / `di-tenant-stock` resources
remain transitional; 5.3.6 does not migrate their data into newly requested services. Full
retention/cleanup and warehouse migration are tracked in
[issue #453](https://github.com/di-framework/di-framework/issues/453) and
[issue #456](https://github.com/di-framework/di-framework/issues/456).

## Troubleshooting

| Result | Check |
| --- | --- |
| `WASMCLOUD_SERVICE_UNAUTHORIZED` | The target kubeconfig, namespace, and tenant membership. |
| `WASMCLOUD_SERVICE_ALREADY_EXISTS` | Inspect the existing service or choose a new name. |
| `WASMCLOUD_SERVICE_NOT_READY` | Inspect service conditions, class visibility/sizing, and Deployment readiness; increase `--timeout` only if provisioning is still progressing. |
| `WASMCLOUD_SERVICE_PROVISIONING_FAILED` | Read the service's failure condition and correct the request or platform configuration. |
| Binding reports `Failed` | Check same-namespace service existence/readiness, matching capability, and conflicting bindings with the same `bindingName`. |
| Resource name cannot be adopted | Existing resources belong to another service UID; inspect retained resources before reusing a deleted service name. |
