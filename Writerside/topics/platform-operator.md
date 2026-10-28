# Platform operator

The platform operator is a Go operator that turns a namespaced `PlatformInstance`
(`platform.di-framework.dev/v1alpha1`) into a running, isolated copy of the di-framework platform.
v1alpha1 has one target: a vCluster on the operator's own cluster. Each install is the platform's
existing-cluster program (`@di-framework/platform/existing`), run through the Pulumi Automation API,
at the exact `@di-framework/platform` version the instance names.

The operator, its Helm chart and its Headlamp plugin publish from
[di-framework/platform](https://github.com/di-framework/platform/tree/main/platform/operator) and are
released together with the platform. This page describes release **6.0.22**.

| Page | Covers |
| --- | --- |
| This page | Host requirements, installing the chart, Headlamp and its plugin, a first instance, uninstalling. |
| [PlatformInstance reference](platform-instance-reference.md) | Every `spec` and `status` field, the conditions and their reasons. |
| [Operate platform instances](platform-operator-operations.md) | Upgrades, repair, `Retain` and `Delete`, reading conditions on failure, owner-Service resync. |

## Host requirements

The documented host is a single-node [KubeSolo](kube.md) cluster. The operator embeds the vCluster
chart (0.37.3, digest-checked) with values tested on KubeSolo, and its default `storageRootBase` is
`/var/lib/kubesolo/instances`. The admission policy that protects each instance was verified on
KubeSolo v1.2.0 (Kubernetes v1.35.7). v1alpha1 is single node only; multi-node is out of scope.

The operator needs:

- **cluster-admin.** The vCluster chart creates RBAC, workloads and Services in each instance's host
  namespace, and Kubernetes only lets Helm grant permissions it already holds. The chart binds
  `cluster-admin` by default (`rbac.clusterAdmin: true`). Install it only on a cluster where a
  cluster-admin operator is acceptable; instance owners are trusted in v1alpha1.
- **A host NetworkPolicy engine.** Instances run with `networkPolicyEngine: existing`, so the host
  cluster must enforce NetworkPolicy.
- **Kubernetes 1.30 or later** for the `ValidatingAdmissionPolicy` that protects each instance's
  `service/vcluster`. On an API server without admission policies the operator carries on and reports
  `OwnerServiceProtected=False`.
- **Egress to npm, the Pulumi plugin host and the platform's images.** Each install runs
  `npm install` and fetches the Pulumi Kubernetes provider plugin; the image doesn't carry them yet, so
  every instance's first install downloads both.
- **A namespace that admits `hostPath` pods** for the storage cleanup Job that runs when an instance
  with `deletionPolicy: Delete` is deleted. It is the release namespace unless `cleanupNamespace` names
  another.

## Install the operator

The chart installs once per cluster: the `PlatformInstance` CRD is cluster-scoped and its ClusterRole is
always named `platform-operator`. Every `v*` platform release publishes the chart at the release's
version.

```bash
helm install platform-operator oci://ghcr.io/di-framework/charts/platform-operator \
  --version 6.0.22 --namespace platform-operator --create-namespace
```

Allow privileged pods in the namespace the cleanup Jobs run in (the release namespace by default), so
Pod Security admission admits their `hostPath` mount:

```bash
kubectl label namespace platform-operator pod-security.kubernetes.io/enforce=privileged --overwrite
```

The chart installs the CRD, the operator Deployment and its RBAC, the operator's Pulumi state claim and
its passphrase Secret. The image is always pulled by digest (`image.digest`). The vCluster chart
version, its values and the platform version are not chart values: they come with the operator image,
and each `PlatformInstance` names its own `spec.version`.

### The passphrase and offline renders

The passphrase Secret encrypts the secrets in the operator's Pulumi state. If it ever changes, every
existing instance's state becomes unreadable at the operator's next restart, permanently.

- With `passphrase.existingSecret` empty (the default) the chart reads the cluster with `lookup`. It
  reuses an existing passphrase and generates one only on a first install. `helm install`,
  `helm upgrade` and `--dry-run=server` work. A render that cannot see the cluster fails instead of
  generating a new passphrase.
- `helm template`, client-side `--dry-run`, Argo CD and other GitOps tools need
  `passphrase.existingSecret`: create the Secret (key `passphrase`) yourself and name it.

  ```bash
  kubectl -n platform-operator create secret generic platform-operator-passphrase \
    --from-literal=passphrase="$(openssl rand -base64 36)"
  helm template platform-operator <chart> -n platform-operator \
    --set passphrase.existingSecret=platform-operator-passphrase
  ```

- `state.existingClaim` requires `passphrase.existingSecret`: the chart can't know the passphrase of
  state in a claim it didn't create.

### Chart values

| Value | Default | Operator flag |
| --- | --- | --- |
| `image.repository` | `ghcr.io/di-framework/platform-operator` | |
| `image.digest` | the operator image published with the release; must match `sha256:<64 hex>` | |
| `replicaCount` | `1`; more than 1 requires `leaderElect` | |
| `leaderElect` | `true` | `--leader-elect` |
| `storageRootBase` | `/var/lib/kubesolo/instances` | `--storage-root-base` |
| `installTimeout` | `30m` | `--install-timeout` |
| `repairInterval` | `30m` | `--repair-interval` |
| `targetPoll` | `10s` | `--target-poll` |
| `maxConcurrentInstalls` | `2` | `--max-concurrent-installs` |
| `cleanupNamespace` | empty: the release namespace | `--cleanup-namespace` (only when set) |
| `extraArgs` | `[]` | any other flag, such as `--zap-log-level=debug` |
| `state.size`, `state.storageClassName` | `10Gi`, the default class | `--state-dir` |
| `state.existingClaim` | none; requires `passphrase.existingSecret` | `--state-dir` |
| `passphrase.existingSecret` | none (generated; offline renders fail) | `--passphrase-file` |
| `rbac.clusterAdmin` | `true` | |
| `resources` | 100m CPU / 256Mi memory / 1Gi ephemeral requests; 2Gi memory / 6Gi ephemeral limits | |
| `emptyDirSizeLimit.home`, `emptyDirSizeLimit.tmp` | `4Gi`, `1Gi` | |
| `headlamp.enabled` | `false` | |

The state claim is `ReadWriteOnce`. On a multi-node cluster a standby replica on another node stays in
`ContainerCreating`, so keep one replica or use a `ReadWriteMany` class. The operator pod runs as uid 1000
with a read-only root filesystem.

## Headlamp and the PlatformInstance plugin

[Headlamp](https://headlamp.dev) is the operator's optional UI. Turn it on in the same chart:

```bash
helm upgrade --install platform-operator oci://ghcr.io/di-framework/charts/platform-operator \
  --version 6.0.22 --namespace platform-operator --create-namespace \
  --set headlamp.enabled=true
```

`headlamp.enabled=true` installs the upstream Headlamp chart 0.46.0, vendored in the operator chart.
Everything under `headlamp` is passed to that chart, so its service, ingress and authentication values
apply as documented upstream. Upstream binds Headlamp's own ServiceAccount to `cluster-admin`; users
still sign in with their own token unless `headlamp.config.unsafeUseServiceAccountToken` is set.

Headlamp's plugin manager sidecar (`headlamp.pluginsManager`, on by default) installs the
**di-framework Platform Instances** plugin from its
[Artifact Hub package](https://artifacthub.io/packages/headlamp/di-framework-platform/di-framework-platform)
at the plugin version, which is the platform release version:

```yaml
headlamp:
  pluginsManager:
    enabled: true
    configContent: |
      plugins:
        - name: di-framework-platform
          source: https://artifacthub.io/packages/headlamp/di-framework-platform/di-framework-platform
          version: 6.0.22
```

pluginctl downloads the tarball attached to the platform's GitHub release and checks its sha256. The
sidecar needs egress to npm, `artifacthub.io` and `github.com`. Keep `headlamp.config.watchPlugins` at
`true` (the chart's setting): the sidecar writes the plugin after Headlamp has started, and without the
watch Headlamp never serves it. The plugin requires Headlamp 0.46.0 or later.

The plugin is a client of the Kubernetes API only; anything it does, `kubectl apply` of the same YAML does
too. It adds:

- **Platform Instances** in the sidebar: name, namespace, phase, version (with the installed version
  while an upgrade is in progress), Ready and age.
- **Create** and **Edit spec** forms, with sections for tenants, users, tenant auth and tenant hosts.
  The forms check what the CRD would before sending. **Show YAML** shows the exact object that will be
  sent.
  Edit sends a JSON Patch of only the changed fields (**Show patch** shows it) and refuses to overwrite
  a concurrent change: reopen the form and retry.
- **Detail view**: spec and status, what the last install applied, endpoints, conditions with reasons
  and messages, recent Events, and the instance kubeconfig. The kubeconfig Secret is read only when you
  click Show or Download, with your own credentials, so RBAC on the Secret decides.

## Create an instance

```yaml
apiVersion: platform.di-framework.dev/v1alpha1
kind: PlatformInstance
metadata:
  name: one
  namespace: team-a
spec:
  version: 6.0.22          # exact @di-framework/platform version
  target:
    type: vcluster
  platform:                # optional
    networkPolicyEngine: existing
    gateway:
      httpNodePort: 30080                        # publishes the gateway; 0 keeps it in-instance only
      httpEndpoint: http://apps.example:30080   # public base URL; reported in status.endpoints.http
  deletionPolicy: Delete   # or Retain
```

```bash
kubectl apply -f one.yaml
kubectl get pi -A
```

`kubectl get pi` shows the requested and installed versions and the phase. The phase moves through
`Provisioning` (the vCluster is coming up) and `Installing` to `Ready`. The instance's admin kubeconfig
is in the Secret named by `status.kubeconfigSecretRef` (`<name>-kubeconfig`, key `kubeconfig`), in the
instance's namespace.

The kubeconfig's server is the in-cluster address `https://vcluster.<host namespace>.svc:443`, and the
instance's host namespace admits only the operator's namespace to that API. From anywhere else, use
`kubectl port-forward` to `svc/vcluster` in the host namespace (`pi-<namespace>-<name>-<hash>`, annotated
`platform.di-framework.dev/instance: <namespace>/<name>`) and point the kubeconfig at the local port;
the proxy certificate names `127.0.0.1` and `localhost`.

### Tenants, users and tenant auth

`spec.platform` also carries the instance's tenants, users, `tenantAuth` and tenant host image, so an
instance comes up with a working console and `/v1` API. The OAuth client secret is never inline:
`clientSecretRef` names a Secret and key in the instance's namespace.

```yaml
apiVersion: v1
kind: Secret
metadata: { name: tenant-auth-oauth, namespace: team-a }
stringData: { clientSecret: <the console's OAuth client secret> }
---
apiVersion: platform.di-framework.dev/v1alpha1
kind: PlatformInstance
metadata: { name: one, namespace: team-a }
spec:
  version: 6.0.22
  target: { type: vcluster }
  platform:
    tenants:
      - name: acme
    users:
      - name: dev
        memberships: [{ tenant: acme, role: developer }]
    tenantAuth:
      image: ghcr.io/di-framework/tenant-auth@sha256:<digest>
      issuer: https://id.example
      clientId: console
      clientSecretRef: { name: tenant-auth-oauth, key: clientSecret }
      registry: { component: ghcr.io/di-framework/oci-registry@sha256:<digest> }
```

Anyone who may create or edit a PlatformInstance in a namespace can have the operator read any Secret
in that namespace. Grant PlatformInstance write access only to those who may read that namespace's
Secrets. Field-by-field limits are in the [reference](platform-instance-reference.md#spec-platform).

## Uninstall

Delete the instances you no longer want **before** uninstalling the operator. Every `PlatformInstance`
carries the `platform.di-framework.dev/instance` finalizer, which only the operator removes; while the
operator is uninstalled, deleting an instance (or the CRD) hangs until it is installed again.

```bash
helm uninstall platform-operator --namespace platform-operator
```

`helm uninstall` removes the Deployment, the ServiceAccount and the RBAC. It keeps the
`PlatformInstance` CRD (and so every instance), the state claim `platform-operator-state` and the
passphrase Secret `platform-operator-passphrase`. Installing again with the same release name and
namespace adopts all three. The operator, not the chart, creates the admission policy
`platform-operator-protect-vcluster-service` and its binding; remove them by hand once no instance is
left:

```bash
kubectl delete validatingadmissionpolicybinding platform-operator-protect-vcluster-service
kubectl delete validatingadmissionpolicy platform-operator-protect-vcluster-service
```

## Next steps

- [PlatformInstance reference](platform-instance-reference.md)
- [Operate platform instances](platform-operator-operations.md)
- [Platform](platform.md) for building and deploying applications to an instance's tenants
