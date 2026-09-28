# Deployment

di-framework supports applications deployed to Cloud Foundry and applications compiled to
WebAssembly components for the platform. Choose the integration that matches the target runtime:

| Target | Integration | Use it for |
| --- | --- | --- |
| [Cloud Foundry](cloudfoundry.md) | `@di-framework/cloudfoundry` | Discover `VCAP_APPLICATION` and `VCAP_SERVICES`, normalize bound services, and inject them through the DI container. |
| [Platform](wasmcloud.md) | `@di-framework/cli-plugin-platform` | Build a di-framework HTTP application as a WASI 0.3 component, develop locally, and deploy from a workspace `di-framework.deploy.toml` manifest. |
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
[native service bindings](wasmcloud.md#native-service-bindings) for the build and runtime contract.

[Platform backing services](backing-services.md) let tenant developers create `BackingService`
resources with `platform service`. Redis and NATS landed in 5.3.6. Dedicated PostgreSQL ships
in platform 6.0, and `platform deploy` wires a `Postgres` binding that sets `serviceName`.
Redis and NATS still use explicit `ServiceBinding` resources.

Application-authored [private service bindings](service-bindings.md) (`@ExportService` /
`@ServiceBinding`) are a separate in-process contract: callers receive a named DI proxy and do
not configure a URL. They are not wasmCloud host capabilities and are not mapped onto
independently deployed components by the CLI.

## Next steps

- [Cloud Foundry](cloudfoundry.md) - Connect an application to platform metadata and bound services
- [Platform](wasmcloud.md) - Build and deploy WebAssembly components
- [Platform backing services](backing-services.md) - Request Redis/NATS instances and project tenant binding configuration
- [Kubernetes with di-framework-kube](kube.md) - Deploy examples and verify real service bindings
- [Private service bindings](service-bindings.md) - Named in-process contracts without URLs
- [Remote actors](actors-distributed.md) - Cross-process actor RPC independent of wasmCloud
- [Platform actors](wasmcloud.md#actors) - Single-host actor workloads and hostPath storage
- [HTTP static assets](http-router.md#static-assets) - Live directory serving and host-side packaging
- [CLI](cli.md) - Install extensions and use the canonical command tree
