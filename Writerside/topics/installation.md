# Installation

The core package has no runtime dependencies and works with SWC and TypeScript's decorator support.

## Requirements

- TypeScript 5.0 or higher
- SWC or TypeScript compiler with decorator support enabled

## Scaffold an app (recommended)

The fastest path is the app CLI:

```bash
bun x @di-framework/cli init my-api
cd my-api && bun install && bun run dev
```

That writes a `tsconfig.json` with `@di-framework/tsc` (`plugins`), `@di-framework/cli`, and sample `src/index.ts` (`ttsc` and TypeScript 7+ come with `@di-framework/tsc`). Scripts call `di-framework build` / `di-framework check` (which run `ttsc`). Runtime parameter checks are injected on emit (`bun run build`). See [CLI](cli.md) for `check` / `build` and [Runtime type checks](tsc.md).

## Install the Package

```bash
npm install @di-framework/core
```

or with yarn:

```bash
yarn add @di-framework/core
```

or with bun:

```bash
bun add @di-framework/core
```

## Configuration

### TypeScript Configuration

Ensure your `tsconfig.json` has the following settings:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": false,
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler"
  }
}
```

Apps from `di-framework init` also include `plugins: [{ "transform": "@di-framework/tsc" }]` and emit via `ttsc`. For manual setup of runtime parameter checks, see [Runtime type checks](tsc.md).
### SWC Configuration

If you're using SWC, ensure your `.swcrc` has decorator support enabled:

```json
{
  "jsc": {
    "parser": {
      "syntax": "typescript",
      "decorators": true
    },
    "transform": {
      "legacyDecorator": true,
      "decoratorMetadata": false
    }
  }
}
```

## No Additional Dependencies

The decorators are fully integrated with SWC's native support - **no need for `reflect-metadata` or any other polyfill**. This keeps your bundle size small and your dependencies minimal.

## Import paths and container singleton

Always import from the scoped package `@di-framework/core/*` to ensure a single global container instance. Mixing different import IDs (e.g., `di-framework/*` or relative paths to sources) can load a second copy of the library and create a second global container instance.

Correct:

```typescript
import { useContainer } from '@di-framework/core/container';
import { Container, Component } from '@di-framework/core/decorators';
```

Avoid:

```typescript
// Wrong: unscoped package id
import { useContainer } from 'di-framework/container';
// Wrong: relative source path
import { Container } from '../../di-framework/decorators';
```

## Verify Installation

Create a simple test file to verify the installation:

```typescript
import { Container } from '@di-framework/core/decorators';
import { useContainer } from '@di-framework/core/container';

@Container()
class TestService {
  getMessage() {
    return 'di-framework is working!';
  }
}

const container = useContainer();
const service = container.resolve(TestService);
console.log(service.getMessage());
```

Run the file with your TypeScript runner (ts-node, tsx, bun, etc.):

```bash
bun run test.ts
# Output: di-framework is working!
```

## Version 6 package sources

Version **6** publishes from several repositories. Core application packages (`@di-framework/core`,
`@di-framework/http`, and the other packages in the core monorepo) publish at **6.x** from
[di-framework/di-framework](https://github.com/di-framework/di-framework). AI packages,
the operated platform, bindings, and first-party CLI extensions publish from their own
repositories at **6.x**:

| Package | Repository |
| --- | --- |
| `@di-framework/core`, `@di-framework/http`, `@di-framework/cli`, and companion core packages | [di-framework/di-framework](https://github.com/di-framework/di-framework) |
| `@di-framework/ai`, `@di-framework/ai-utils` | [di-framework/ai](https://github.com/di-framework/ai) |
| `@di-framework/platform`, `@di-framework/bindings`, `@di-framework/cloudfoundry`, `@di-framework/cloudflare` | [di-framework/platform](https://github.com/di-framework/platform) |
| `@di-framework/cli-plugin-platform`, `@di-framework/cli-plugin-ai` | [di-framework/cli-extensions](https://github.com/di-framework/cli-extensions) |

Install platform and AI extensions with `di-framework extensions install platform` and
`di-framework extensions install ai`. Platform commands use the `platform` group (including
`platform cluster` for managed Pulumi targets). See [AI CLI](ai-cli.md) and
[Platform](platform.md). Sample apps live in
[di-framework/examples](https://github.com/di-framework/examples), including
[platform-examples](deployment.md#one-command-local-platform-example) for a single-command
local platform deploy. This is distinct from kube
[examples-apps](kube.md#deploy-the-examples), its application verification workspace.

`@di-framework/platform` **6.0.7** includes blobstore, egress, tenant kubeconfigs, and the HTTP
gateway. `di-framework-kube` still installs `@di-framework/platform@6.0.2` unless you pass
`--platform-package`. See [Kubernetes with di-framework-kube](kube.md).

## Optional Packages

The core package stands alone. Companion packages add data access, HTTP, GraphQL, events, sockets, RPC, configuration, authentication, and AI support:

| Package | Docs |
| --- | --- |
| `@di-framework/cli` | [CLI](cli.md) |
| `@di-framework/tsc` | [Runtime type checks](tsc.md) (default in `init`) |
| `@di-framework/biome` | [Biome plugins](biome.md) — GritQL rules for framework mistakes |
| `@di-framework/codegen` | [Schema codegen](codegen.md) — `di-framework generate` surfaces from schema manifests |
| `@di-framework/repo` | [Repositories](repositories.md), including the [wasmCloud PostgreSQL codec](repositories.md#wasmcloud-postgresql-values) |
| `@di-framework/http` | [HTTP Router](http-router.md) |
| `@di-framework/graphql` | [GraphQL](graphql.md) |
| `@di-framework/events` | [Events](events.md) |
| `@di-framework/queues` | [Queues](queues.md) — durable jobs (latest / EAP) |
| `@di-framework/actors` | [Actors](actors.md) — local virtual actors (latest / EAP) |
| `@di-framework/socket` | [Sockets](socket.md) |
| `@di-framework/rpc` | [RPC](rpc.md) |
| `@di-framework/config` | [Configuration](config.md) |
| `@di-framework/auth` | [Authentication](auth.md) |
| `@di-framework/authz` | [Resource Authorization](authorization.md) |
| `@di-framework/ai` | [AI](ai.md) |
| `@di-framework/ai-utils` | [Agent Skills](ai-utils.md) — `SKILL.md`, `.agents/plugins`, jailed file tools, opt-in Bash |
| `@di-framework/bindings` | [Native service bindings](platform.md#native-service-bindings) — PostgreSQL, key-value, blobstore, messaging, config, secrets, and outgoing HTTP |
| `@di-framework/cli-plugin-platform` | [Platform](platform.md) — WASI 0.3 build, development, and deployment extension |
| `@di-framework/cli-plugin-ai` | [AI CLI](ai-cli.md) — `ai agent` and `ai skills` |
| `@di-framework/platform` | [Shared Pulumi platform](kube.md) — infrastructure, tenant isolation, and [Redis, NATS, blobstore, PostgreSQL, and egress backing services](backing-services.md), tenant kubeconfigs, and the HTTP gateway used by kube and the platform CLI |
| `@di-framework/cloudfoundry` | [Cloud Foundry](cloudfoundry.md) — `VCAP_SERVICES` and `VCAP_APPLICATION` discovery |
| `@di-framework/cloudflare` | [Cloudflare Workers](cloudflare.md) — binding discovery, wrangler config, and DI injection |

For a local Kubernetes platform and live service-binding examples, use the separate
[di-framework-kube CLI](kube.md). It requires Node.js, npm, and Pulumi, and installs the shared
platform package from npm. Its [example workspace](kube.md#deploy-the-examples) links DI Framework
**6** with `@di-framework/bindings` and `@di-framework/cli-plugin-platform` for builds and
`di-framework platform deploy`. Published applications use the same packages at `@^6`.

## Next Steps

Now that you have the framework installed, learn how to use it:

- [Quick Start](quick-start.md) - Learn the basics with simple examples
- [CLI](cli.md) - Complete command tree, output contract, and package ownership
- [API Reference](api-reference.md) - Complete API documentation
