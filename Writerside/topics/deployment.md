# Deployment

di-framework supports applications deployed to Cloud Foundry and applications compiled to
WebAssembly components for wasmCloud. Choose the integration that matches the target runtime:

| Target | Integration | Use it for |
| --- | --- | --- |
| [Cloud Foundry](cloudfoundry.md) | `@di-framework/cloudfoundry` | Discover `VCAP_APPLICATION` and `VCAP_SERVICES`, normalize bound services, and inject them through the DI container. |
| [wasmCloud](wasmcloud.md) | `@di-framework/cli-plugin-wasmcloud` | Build a di-framework HTTP application as a WASI 0.3 component, develop locally, and deploy from a workspace `di-framework.deploy.toml` manifest. |
| [Kubernetes with di-framework-kube](kube.md) | `di-framework-kube` and the wasmCloud extension | Create a local Kubesolo cluster with the wasmCloud operator and verify deployed apps against PostgreSQL, Redis, NATS, configuration, secrets, and HTTP services. |

The Cloud Foundry package configures an application at runtime; the platform CLI and manifest
remain responsible for pushing it. The wasmCloud extension provides its build, development,
application deploy and destroy, and managed-platform commands through the main `di-framework`
executable. Application deploy never runs Pulumi; Pulumi is used only for explicit
`wasmcloud platform` lifecycle of a managed target.

The kube CLI manages Kubesolo and the operator directly, with an embedded Helm client.
Its example workspace uses an external deployment target and pins the framework to 5.3.0.
Native services are consumed through `@di-framework/wasmcloud`; the platform and example
helpers provision their backends and credentials. See [native service bindings](wasmcloud.md#native-service-bindings)
for the build and runtime contract.

Application-authored [private service bindings](service-bindings.md) (`@ExportService` /
`@ServiceBinding`) are a separate in-process contract: callers receive a named DI proxy and do
not configure a URL. They are not wasmCloud host capabilities and are not mapped onto
independently deployed components by the CLI.

## Next steps

- [Cloud Foundry](cloudfoundry.md) - Connect an application to platform metadata and bound services
- [wasmCloud](wasmcloud.md) - Build and deploy WebAssembly components
- [Kubernetes with di-framework-kube](kube.md) - Deploy examples and verify real service bindings
- [Private service bindings](service-bindings.md) - Named in-process contracts without URLs
- [Remote actors](actors-distributed.md) - Cross-process actor RPC independent of wasmCloud
- [wasmCloud actors](wasmcloud.md#actors) - Single-host actor workloads and hostPath storage
- [CLI](cli.md) - Install extensions and use the canonical command tree
