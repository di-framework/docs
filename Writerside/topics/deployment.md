# Deployment

di-framework supports applications deployed to Cloud Foundry and applications compiled to
WebAssembly components for the platform. Choose the integration that matches the target runtime:

| Target | Integration | Use it for |
| --- | --- | --- |
| [Cloud Foundry](cloudfoundry.md) | `@di-framework/cloudfoundry` | Discover `VCAP_APPLICATION` and `VCAP_SERVICES`, normalize bound services, and inject them through the DI container. |
| [Platform](platform.md) | `@di-framework/cli-plugin-platform` | Build a di-framework HTTP application as a WASI 0.3 component, develop locally, and deploy from a workspace `di-framework.deploy.toml` manifest. |
| [Kubernetes with di-framework-kube](kube.md) | `di-framework-kube` and the platform extension | Create a local Kubesolo cluster with the platform operator and verify deployed apps against PostgreSQL, Redis, NATS, configuration, secrets, and HTTP services. |

The Cloud Foundry package configures an application at runtime; the platform CLI and manifest
remain responsible for pushing it. The platform extension provides its build, development,
application deploy and destroy, backing-service commands, and managed-platform commands through
the main `di-framework` executable. Application deploy never runs Pulumi; Pulumi is used only for explicit
`platform cluster` lifecycle of a managed target and for kube platform provisioning.

Both platform entrypoints use `@di-framework/platform` **6.x** from
[di-framework/platform](https://github.com/di-framework/platform). The extension's local
entrypoint provisions Docker/k0s and a registry; kube manages Kubesolo and invokes the shared
existing-cluster entrypoint through its persistent Pulumi stack. Kube installs an exact
published package version from npm by default; local tarballs are a development option. Its
embedded Helm client remains for status inspection and legacy cleanup.
Its example workspace uses an external deployment target and still pins the framework to 5.3.0,
including `@di-framework/wasmcloud`. New applications import `@di-framework/bindings`. See
[native service bindings](platform.md#native-service-bindings) for the build and runtime contract.

[Platform backing services](backing-services.md) let tenant developers create `BackingService`
resources with `platform service`. Redis and NATS landed in 5.3.6. Dedicated PostgreSQL ships
in platform 6.0, and `platform deploy` wires a `Postgres` binding that sets `serviceName`.
Redis and NATS still use explicit `ServiceBinding` resources. Ready instances of those
services can be copied to object storage. See [Tenant backups](#tenant-backups).

Application-authored [private service bindings](service-bindings.md) (`@ExportService` /
`@ServiceBinding`) are a separate in-process contract: callers receive a named DI proxy and do
not configure a URL. They are not wasmCloud host capabilities and are not mapped onto
independently deployed components by the CLI.

## Tenant backups

Ready `BackingService` instances can be copied to an S3-compatible bucket and restored into an
empty service of the same type and class. Two private packages in
[di-framework/platform](https://github.com/di-framework/platform) implement that behavior. They
stay in the platform repository.

| Package | Role |
| --- | --- |
| `@di-framework/backup-destination` | Helm chart and operator. Installs into an existing `di-tenant-<name>` namespace and serves an HTML console. |
| `@di-framework/backup-agent` | Job image. Dumps or restores one service, checks that a restore target is empty, and deletes expired objects. |

The platform controller creates `di-tenant-<name>` and `di-runtime-<name>` when it reconciles a
Tenant. The backup Helm release is named `backups`, targets `di-tenant-<name>`, and sets
`createNamespace` to false. A Pulumi program calls `installBackupDestination` and depends on the
Tenant resource returned by `createPlatform` as `tenantResources`. The chart installs only when
the release namespace begins with `di-tenant-`.

A `BackupDestination` named `default` records the bucket, region, optional endpoint, credential
Secret, UTC cron schedule, and how many successful backups to keep. The default schedule is
`0 2 * * *`. A destination with no recorded attempt runs once when the operator starts. Point
`existingSecret` at a Secret you create. That Secret holds `AWS_ACCESS_KEY_ID` and
`AWS_SECRET_ACCESS_KEY`. An `http://` endpoint is accepted for `localhost` and for hostnames that
end in `.svc.cluster.local`. Every other endpoint uses `https://`.

The operator runs in the tenant namespace. Service `di-backup-console` publishes port 8080. The
page lists enrolled services and backup history. **Backup now** marks the destination due on the
next pass. **Restore** submits a `BackupRestore` for a succeeded backup and an empty target
service. The page does not show Secret values.

Each run is a Job in `di-runtime-<name>`. The agent does not call the Kubernetes API. It reads
`BACKUP_KIND` and writes a JSON result to `/dev/termination-log`. The operator records that
result on `Backup.status.phase` as `Succeeded` or `Failed`. A Job stays in progress until
Kubernetes sets its Complete or Failed condition, so one rejected attempt does not finish the
Backup while retries are still running.

| Service | Dump | Restore |
| --- | --- | --- |
| Postgres | `pg_dump -Fc` | `pg_restore` |
| Key-value | `redis-cli --rdb` | RESP replay of that RDB |
| Messaging | `nats account backup` of file-backed streams | `nats account restore` |

The database password is an environment variable. Messaging backups include file-backed JetStream
streams. Memory storage is reported as `MemoryStoreUnsupported`. A service that is not Ready, a
suspended destination, and a service whose declared storage is larger than 4 GiB are left for a
later pass.

Objects are stored under `di-framework/<tenant>/<service>/<uid>/<timestamp>/` unless `prefix` is
set. A successful run stores the archive and `manifest.json`. The destination keeps
`retention.successful` successful backups per service, 14 by default, and a later Job deletes
the older objects.

`@di-framework/platform` admits pods labeled `platform.di-framework.dev/component=backup-agent`,
in the same runtime namespace, to ports 5432, 6379, and 4222 on backing-service pods. That label
and `backup-operator` sit outside the broad tenant network policy. Further store access is
`extraEgress` on the destination. Each entry is a CIDR, a port, and a protocol. The operator
merges those rules into `di-backup-agent-network` and keeps the chart's DNS, backing-service, and
public TCP 443 rules. For an in-cluster Service, include the pod CIDR as well as the Service
CIDR. kube-router evaluates egress after kube-proxy rewrites the Service address to the pod
address. A new Job can start before its address is in that allow list. The agent retries a
refused connection before it reports the dump as failed.

## Next steps

- [Cloud Foundry](cloudfoundry.md) - Connect an application to platform metadata and bound services
- [Platform](platform.md) - Build and deploy WebAssembly components
- [Platform backing services](backing-services.md) - Request Redis/NATS instances and project tenant binding configuration
- [Tenant backups](#tenant-backups) - Schedule dumps of Ready backing services and restore into an empty service
- [Kubernetes with di-framework-kube](kube.md) - Deploy examples and verify real service bindings
- [Private service bindings](service-bindings.md) - Named in-process contracts without URLs
- [Remote actors](actors-distributed.md) - Cross-process actor RPC independent of wasmCloud
- [Platform actors](platform.md#actors) - Single-host actor workloads and hostPath storage
- [HTTP static assets](http-router.md#static-assets) - Live directory serving and host-side packaging
- [CLI](cli.md) - Install extensions and use the canonical command tree
