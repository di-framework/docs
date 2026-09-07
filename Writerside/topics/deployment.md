# Deployment

DI Framework supports applications deployed to Cloud Foundry and applications compiled to
WebAssembly components for wasmCloud. Choose the integration that matches the target runtime:

| Target | Integration | Use it for |
| --- | --- | --- |
| [Cloud Foundry](cloudfoundry.md) | `@di-framework/cloudfoundry` | Discover `VCAP_APPLICATION` and `VCAP_SERVICES`, normalize bound services, and inject them through the DI container. |
| [wasmCloud](wasmcloud.md) | `@di-framework/cli-plugin-wasmcloud` | Build a DI Framework HTTP application as a WASI 0.2 component, develop locally, and deploy through Pulumi. |

The Cloud Foundry package configures an application at runtime; the platform CLI and manifest
remain responsible for pushing it. The wasmCloud extension provides its build, development,
deployment, and destroy commands through the main `di-framework` executable.

## Next steps

- [Cloud Foundry](cloudfoundry.md) - Connect an application to platform metadata and bound services
- [wasmCloud](wasmcloud.md) - Build and deploy WebAssembly components
- [CLI](cli.md) - Install extensions and use the canonical command tree
