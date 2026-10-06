# Deployment

di-framework supports applications deployed to Cloud Foundry and applications compiled to
WebAssembly components for the platform. Choose the integration that matches the target runtime:

| Target | Integration | Use it for |
| --- | --- | --- |
| [Cloud Foundry](cloudfoundry.md) | `@di-framework/cloudfoundry` | Discover `VCAP_APPLICATION` and `VCAP_SERVICES`, normalize bound services, and inject them through the DI container. |
| [Cloudflare Workers](cloudflare.md) | `@di-framework/cloudflare` | Classify Worker bindings, read wrangler declarations, and inject them through the DI container. |
| [Platform](platform.md) | `@di-framework/cli-plugin-platform` | Build a di-framework HTTP application as a WASI 0.3 component, develop locally, and deploy from a workspace `di-framework.deploy.toml` manifest. Open the tenant console with `platform console`; tenant HTTP uses the gateway URL without a port-forward. |
| [Kubernetes with di-framework-kube](kube.md) | `di-framework-kube` and the platform extension | Create a local Kubesolo cluster with the wasmCloud operator and verify deployed apps against PostgreSQL, Redis, NATS, configuration, secrets, and HTTP services. |

The Cloud Foundry package configures an application at runtime; the platform CLI and manifest
remain responsible for pushing it. The platform extension provides its build, development,
application deploy and destroy, backing-service commands, and managed-platform commands through
the main `di-framework` executable. Application deploy never runs Pulumi; Pulumi is used only for explicit
`platform cluster` lifecycle of a managed target and for kube platform provisioning.

Both platform entrypoints use `@di-framework/platform` **6.x** from
[di-framework/platform](https://github.com/di-framework/platform). The extension's local
entrypoint provisions Docker or Podman/k0s and a registry; kube manages Kubesolo and invokes the shared
existing-cluster entrypoint through its persistent Pulumi stack. Kube installs an exact
published package version from npm by default; local tarballs are a development option. Its
embedded Helm client remains for status inspection and legacy cleanup.
Its example workspace uses an external deployment target and links DI Framework **6** with
`@di-framework/bindings` and `@di-framework/cli-plugin-platform` (`di-framework platform`
deploy). See [native service bindings](platform.md#native-service-bindings) for the build and
runtime contract.

[Platform backing services](backing-services.md) let tenant developers create `BackingService`
resources with `platform service` for Redis, NATS, blobstore, dedicated PostgreSQL, and egress.
`platform deploy` wires PostgreSQL through `serviceName` and, on tenant targets, egress through
`allowedIpNameLookups`. Blobstore uses `configFrom`, not `serviceName`; Redis and NATS use
explicit `ServiceBinding` resources. Those capabilities are in published `@di-framework/platform`
**6.0.7**. `di-framework-kube` still installs **6.0.2** unless you pass `--platform-package`.

Application-authored [private service bindings](service-bindings.md) (`@ExportService` /
`@ServiceBinding`) are a separate in-process contract: callers receive a named DI proxy and do
not configure a URL. They are not wasmCloud host capabilities and are not mapped onto
independently deployed components by the CLI.

## One-command local platform example

[platform-examples](https://github.com/di-framework/examples/tree/main/platform-examples)
deploys the Meshtastic collector and site with one `pulumi up`. Install Bun, Pulumi, Docker or
Podman, and the framework CLI with the locally built platform extension containing this work.
From an examples checkout:

```bash
export PULUMI_CONFIG_PASSPHRASE=meshtastic
cd platform-examples/deploy
bun install
pulumi up
pulumi stack output meshSiteUrl
eval "$(pulumi stack output console)"
```

`bun install` creates stack `dev` in `deploy/.pulumi-state` and records `containerCli`.
`pulumi up` starts k0s and the registry, builds `deploy/tenant-host` locally (wash 2.8.0 plus
`wasi-tls`), creates tenant `meshtastic` and user `dev`, approves MQTT egress, provisions the
shared `mesh-objects` blobstore, writes the tenant kubeconfig, and deploys both services.
The first host-image build compiles wash and can take about ten minutes. This example vendors
`@di-framework/platform` **6.0.2** and pushes its own host image into the cluster registry.
Other installs use published `@di-framework/platform` **6.0.7** and the
[default wasi-tls host image](platform.md#tenant-egress-and-tls).

`meshSiteUrl` is `http://mesh-site.meshtastic.localhost:28180/`. The console command prints its
loopback URL on a free port. Re-running `pulumi up` redeploys changed sources; `pulumi destroy`
removes the cluster, volumes, network, and generated kubeconfigs.

## Next steps

- [Cloud Foundry](cloudfoundry.md) - Connect an application to platform metadata and bound services
- [Cloudflare Workers](cloudflare.md) - Inject Worker bindings through the DI container
- [Platform](platform.md) - Build and deploy WebAssembly components
- [Platform backing services](backing-services.md) - Request Redis, NATS, blobstore, PostgreSQL, and egress services
- [Kubernetes with di-framework-kube](kube.md) - Deploy examples and verify real service bindings
- [Private service bindings](service-bindings.md) - Named in-process contracts without URLs
- [Remote actors](actors-distributed.md) - Cross-process actor RPC independent of wasmCloud
- [Platform actors](platform.md#actors) - Single-host actor workloads and tenant or non-tenant storage
- [HTTP static assets](http-router.md#static-assets) - Live directory serving and host-side packaging
- [CLI](cli.md) - Install extensions and use the canonical command tree
