# Deployment

di-framework supports applications deployed to Cloud Foundry and applications compiled to
WebAssembly components for wasmCloud. Choose the integration that matches the target runtime:

| Target | Integration | Use it for |
| --- | --- | --- |
| [Cloud Foundry](cloudfoundry.md) | `@di-framework/cloudfoundry` | Discover `VCAP_APPLICATION` and `VCAP_SERVICES`, normalize bound services, and inject them through the DI container. |
| [wasmCloud](wasmcloud.md) | `@di-framework/cli-plugin-wasmcloud` | Build a di-framework HTTP application as a WASI 0.2 component, develop locally, and deploy from a workspace `di-framework.deploy.toml` manifest. |

The Cloud Foundry package configures an application at runtime; the platform CLI and manifest
remain responsible for pushing it. The wasmCloud extension provides its build, development,
application deploy and destroy, and managed-platform commands through the main `di-framework`
executable. Application deploy never runs Pulumi; Pulumi is used only for explicit
`wasmcloud platform` lifecycle of a managed target.

## Next steps

- [Cloud Foundry](cloudfoundry.md) - Connect an application to platform metadata and bound services
- [wasmCloud](wasmcloud.md) - Build and deploy WebAssembly components
- [CLI](cli.md) - Install extensions and use the canonical command tree
