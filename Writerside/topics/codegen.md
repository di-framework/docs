# Schema codegen

`@di-framework/codegen` turns versioned, typed **schema manifests** into deterministic application surfaces: validation helpers, an [HTTP controller](http-router.md) with OpenAPI metadata, [`@EventBridge`](events.md) routes, and opt-in [RPC](rpc.md) services and [AI tools](ai.md). You write the schemas, the manifest, and the handler; the generator writes the glue and keeps it in sync.

`di-framework generate` is the only entry point most projects need. The package also exposes a typed `generate()` function for build scripts.

## Features

- **Typed manifests**: plain TypeScript objects checked with `satisfies SchemaCodegenManifest`. No DSL, no `.proto`, no YAML.
- **Deterministic emitters**: every surface is sorted and stable, so repeated runs produce byte-identical output and clean diffs.
- **One handler, many transports**: HTTP, RPC, and tool surfaces validate input, call the same handler method, and validate output. The handler receives the transport name, and the HTTP route also passes the request.
- **OpenAPI for free**: generated routes carry `@Endpoint` metadata built from the manifest and the schemas' `jsonSchema`, so `di-framework http openapi generate` documents them.
- **Companion skeletons** (`--init`): creates missing handler classes and `@Policy` skeletons once and never overwrites them.
- **Ownership ledger**: generated files are listed in `.codegen-ledger.json` and start with an ownership header. Only files that carry the header are ever deleted.
- **Drift check** (`--check`): verifies committed output matches the manifests without writing anything. Exit code `1` on drift.

## Installation

```bash
bun add -d @di-framework/codegen @di-framework/cli
```

`@di-framework/core` is a peer dependency. Install the packages for the surfaces you generate: `@di-framework/http`, `@di-framework/events`, `@di-framework/rpc`, `@di-framework/ai`, and `@di-framework/authz` for policy skeletons.

The generator discovers manifest files with `Bun.Glob`, so run it with Bun. Direct file paths work in any runtime.

## Project layout

A default project looks like this:

```text
di-framework.codegen.ts          # optional config
src/
  contracts/
    orders.schemas.ts            # runtime schemas (hand-written)
    orders-v1.codegen.ts         # manifest (hand-written)
  handlers/
    order.handlers.ts            # created by --init, then owned by you
  policies/
    order.policy.ts              # created by --init, then owned by you
  generated/
    .codegen-ledger.json
    orders/v1/
      contracts.ts               # always
      http.ts                    # when an operation has http, or the manifest sets http.prefix
      events.ts                  # when an operation has events
      rpc.ts                     # when an operation has rpc
      tools.ts                   # when an operation has tool
```

Output for each manifest goes to `<outDir>/<name>/<version>/`. Two versions of the same contract coexist, which is how you ship `v2` without touching `v1`.

## Configuration

Create `di-framework.codegen.ts` in the project root. Every field is optional; the values below are the defaults.

```ts
import type { CodegenConfig } from '@di-framework/codegen';

export default {
  manifests: ['./src/contracts/**/*.codegen.ts'],
  outDir: './src/generated',
  companionsDir: './src/handlers',
  policiesDir: './src/policies',
  ledgerPath: './src/generated/.codegen-ledger.json',
} satisfies CodegenConfig;
```

| Field | Purpose |
| --- | --- |
| `manifests` | Glob patterns or file paths, relative to the working directory. |
| `outDir` | Root for generated surfaces. Each manifest writes to `<outDir>/<name>/<version>/`. |
| `companionsDir` | Reserved for handler skeletons. Handlers are placed at the manifest's `handler.module` path. |
| `policiesDir` | Where `--init` creates `<resource>.policy.ts` when an operation omits `policyModule`. |
| `ledgerPath` | Ownership ledger location. Defaults to `.codegen-ledger.json` inside `outDir`. |

The generator looks for `di-framework.codegen.ts`, `di-framework.codegen.js`, `codegen.config.ts`, then `codegen.config.js`. Pass `--config <path>` to use another file. Without any config file, the defaults apply.

## Runtime schemas

A runtime schema is any object with a `parse(input)` method and a `jsonSchema` property. Zod, Valibot, ArkType, or a hand-written validator all qualify; the generator never imports a validation library itself.

```ts
// src/contracts/orders.schemas.ts
import type { RuntimeSchema } from '@di-framework/codegen';
import { z } from 'zod';

const CreateOrderValidator = z.object({
  customerId: z.string().min(1),
  amount: z.number().positive(),
  currency: z.string().length(3),
});

const OrderValidator = CreateOrderValidator.extend({
  id: z.string().min(1),
  status: z.enum(['pending', 'accepted', 'rejected']),
});

export type CreateOrder = z.infer<typeof CreateOrderValidator>;
export type Order = z.infer<typeof OrderValidator>;

export const CreateOrder: RuntimeSchema<CreateOrder> = {
  parse: (input) => CreateOrderValidator.parse(input),
  jsonSchema: z.toJSONSchema(CreateOrderValidator),
};

export const Order: RuntimeSchema<Order> = {
  parse: (input) => OrderValidator.parse(input),
  jsonSchema: z.toJSONSchema(OrderValidator),
};
```

Export the type and the value under the same name. Generated code imports both: the type for signatures and the value for `parse` and `jsonSchema`.

## Manifests

A manifest exports one default object. `name` and `version` become the output directory and the generated class names (`OrdersV1HttpController`, `OrdersV1Events`, and so on).

```ts
// src/contracts/orders-v1.codegen.ts
import type { SchemaCodegenManifest } from '@di-framework/codegen';
import { CreateOrder, Order } from './orders.schemas';

export default {
  name: 'orders',
  version: 'v1',

  schemas: { CreateOrder, Order },

  http: { prefix: '/v1' },

  operations: {
    createOrder: {
      input: 'CreateOrder',
      output: 'Order',

      handler: {
        module: '../handlers/order.handlers.ts',
        export: 'OrderHandlers',
        method: 'createOrder',
      },

      http: {
        method: 'POST',
        path: '/orders',
        successStatus: 201,
        summary: 'Create an order',
        description: 'Creates an order for the caller.',
        parameters: [
          { name: 'verbose', in: 'query', required: false, schema: { type: 'boolean' } },
        ],
      },

      events: {
        inbound: { topic: 'orders.create.v1', event: 'order.create.requested.v1' },
        outbound: { topic: 'orders.created.v1', event: 'order.created.v1' },
      },

      rpc: {
        package: 'orders.v1',
        inputFields: { customerId: 1, amount: { number: 2, type: 'double' } },
        outputFields: { id: 1 },
      },

      authorization: {
        resource: 'order',
        action: 'create',
        policyModule: '../policies/order.policy.ts',
      },

      tool: {
        name: 'create_order',
        description: 'Create an order for the authenticated principal',
      },
    },
  },
} satisfies SchemaCodegenManifest;
```

### `schemas`

Maps a schema name to a runtime schema. The generator needs to know which module exports each schema so it can emit imports:

- A bare runtime schema (`CreateOrder`) is assumed to live in `./<name>.schemas` next to the manifest, so `orders` resolves to `./orders.schemas`.
- `{ schema, module }` names the module explicitly: `{ schema: CreateOrder, module: './shared/order.schemas.ts' }`.

Module paths are relative to the manifest file. Extensions are stripped from emitted import specifiers.

### `operations`

Each operation needs `input`, `output`, and `handler`. Everything else is opt-in and turns on one surface.

| Key | Surface | Notes |
| --- | --- | --- |
| `handler` | all | `module` is relative to the manifest. `export` is a class, `method` a method on it. |
| `http` | `http.ts` | `method`, `path`, optional `successStatus`, `summary`, `description`, and `parameters`. Default status is `201` for `POST` and `200` otherwise. `parameters` holds OpenAPI parameter objects for query and header inputs; path parameters come from the route. |
| `events` | `events.ts` | `inbound` and `outbound` each take `topic` and `event`. Either may be omitted. |
| `rpc` | `rpc.ts` | `package` is required. `inputFields` and `outputFields` map field names to protobuf field numbers. |
| `authorization` | `--init`, `tools.ts` | `resource` and `action`. `policyModule` defaults to `<policiesDir>/<resource>.policy.ts`. |
| `tool` | `tools.ts` | `name` and `description` for the `@Tool`. |

Operations and schemas are processed in sorted order regardless of how the manifest lists them.

Include the `.ts` extension in `handler.module` and `policyModule`. `--init` creates the file at exactly that path, and generated imports drop the extension anyway.

## Generated surfaces

All generated files start with this header. The ledger and `--clean` treat it as proof of ownership:

```ts
// @generated by @di-framework/codegen — do not edit.
```

### `contracts.ts`

One `validate<Schema>(input: unknown): <Schema>` function per schema, delegating to `parse`. Every other surface imports from here.

### `http.ts`

A `@Controller` class named `<Name><Version>HttpController` plus a module-level `TypedRouter` exported as `routes`. Each HTTP operation becomes a static route field on the controller, registered on `routes` at the manifest `prefix` joined with the operation `path`, so `prefix: '/v1'` and `path: '/orders'` register `/v1/orders`.

The route resolves the controller from the container, takes the parsed request content, validates it as the input schema, and calls the handler with `{ transport: 'http', request }`. If the handler returns a `Response` it is sent as is, which is the escape hatch for redirects, streams, and custom headers. Any other result is validated as the output schema and returned with `json(...)` and the configured status.

```ts
// src/generated/orders/v1/http.ts (excerpt)
const routes = TypedRouter();

@Controller()
export class OrdersV1HttpController {
  @Component(OrderHandlers)
  private handlers!: OrderHandlers;

  @Endpoint({
    summary: 'Create an order',
    description: 'Creates an order for the caller.',
    parameters: [{"name":"verbose","in":"query","required":false,"schema":{"type":"boolean"}}],
    requestBody: {
      content: { 'application/json': { schema: CreateOrder.jsonSchema } },
      required: true,
    },
    responses: {
      '201': {
        description: 'Create an order',
        content: { 'application/json': { schema: Order.jsonSchema } },
      },
    },
  })
  static createOrder = routes.post('/v1/orders', async (request) => {
    const self = useContainer().resolve(OrdersV1HttpController);
    const body = (request as { content?: unknown }).content;
    const command = validateCreateOrder(body);

    const output = await self.handlers.createOrder(command, {
      transport: 'http' as const,
      request,
    });

    if (output instanceof Response) return output;
    return json(validateOrder(output), { status: 201 });
  });
}

export { routes };
```

Every route carries `@Endpoint` metadata: `summary`, `description`, and `parameters` from the manifest, a JSON `requestBody` built from the input schema for `POST`, `PUT`, and `PATCH`, and a response for `successStatus` built from the output schema. A `204` response has no body. Run `di-framework http openapi generate --controllers ./src/generated/orders/v1/http.ts` to emit the document.

Input always comes from the request content. `GET` and `HEAD` routes fall back to `{}` when there is no body, so path and query parameters are documented through `parameters` but are not mapped onto the input schema.

Handlers are injected with `@Component`. When every HTTP operation in a manifest shares one handler class the property is named `handlers`; otherwise each class gets its own property.

Serve the routes by importing the module, which also registers the controller with the container:

```ts
import { routes } from './generated/orders/v1/http';

export default {
  fetch: (request: Request, env: unknown, ctx: unknown) => routes.fetch(request, env, ctx),
};
```

Each manifest version exports its own `routes`. Mount several with one outer `TypedRouter` or serve them from separate entry points.

### `events.ts`

An `@EventBridge` class named `<Name><Version>Events`. An `inbound` route declares `@Inbound({ topic, event, validate })` with the input validator, so broker messages are checked before they reach the container bus. An `outbound` route declares `@Outbound(event, { topic })`. The events surface declares routes only; it does not call the handler. Subscribe to the inbound event with `@Subscriber` as usual.

### `rpc.ts`

Emitted when any operation sets `rpc`. One `@RpcMessage` class per operation input (`<Operation>Request`) and output (`<OutputSchema>Message`), with `@RpcField` numbers from `inputFields` and `outputFields`, plus an `@RpcService({ package })` class named `<Name><Version>RpcService` with one `@RpcMethod` per operation. The method validates input, calls the handler with `{ transport: 'rpc' }`, and validates the output.

A field can be a bare number (`customerId: 1`), which means a `string`, or `{ number, type }`. Numeric types (`double`, `float`, `int32`, `int64`, `uint32`, `uint64`) emit `number`, `bool` emits `boolean`, and everything else emits `string`.

### `tools.ts`

Emitted when any operation sets `tool`. A `@ToolSet` and `@Container` class named `<Name><Version>Tools` with one `@Tool` per operation. The tool's `inputSchema` is the input schema's `jsonSchema`. `auth.resource` on the tool set is the first operation's `authorization.resource`, or the manifest name when none is set; `auth.action` on each tool is the operation's `authorization.action`, or `execute`. The tool validates input, calls the handler with `{ transport: 'ai-tool' }`, and validates the output.

## Companion skeletons

`di-framework generate --init` creates files that you own. It never overwrites an existing file, so run it whenever you add an operation and fill in what appears.

For each operation whose `handler.module` is missing:

```ts
import { Container } from '@di-framework/core/decorators';
import type {
  CreateOrder,
  Order,
} from '../contracts/orders.schemas';

export type IngressContext = {
  transport: 'http' | 'event' | 'rpc' | 'ai-tool';
  request?: Request;
};

@Container()
export class OrderHandlers {
  async createOrder(
    input: CreateOrder,
    context: IngressContext,
  ): Promise<Order> {
    void input;
    void context;
    throw new Error('Not implemented');
  }
}
```

For each operation with `authorization` whose policy module is missing:

```ts
import { Policy } from '@di-framework/authz';

@Policy('order')
export class OrderPolicy {
  // Add explicit allow/deny declarations here.
  // With no matching allow rule, authorization remains denied.
}
```

The HTTP route passes the incoming `Request` in the context, so declare `request?: Request` on `IngressContext` as shown if your handler needs headers, cookies, or the URL.

Generated surfaces do not import the policy. Bind it to the controller or resolver as described in [Resource Authorization](authorization.md).

## Ledger, drift, and cleanup

Every run writes `.codegen-ledger.json` listing the files it produced. On the next run, a file in the ledger that no manifest produces anymore is **stale**:

- `di-framework generate` reports it and leaves it in place.
- `di-framework generate --clean` deletes it, but only when the file still starts with the ownership header. Files without the header, including companion skeletons, are reported and skipped.
- `di-framework generate --check` treats it as drift.

`--check` never writes. It exits `1` when a generated file is missing, differs from what the manifests produce, or is stale. Wire it into CI next to `di-framework check`:

```yaml
- run: bun x di-framework generate --check
```

Commit the generated directory and the ledger. The check keeps them honest, and committed output means `tsc`, editors, and reviewers see the real code.

## CLI

```text
di-framework generate [--config <path>] [--outDir <path>] [--init] [--check] [--clean]
```

| Flag | Description |
| --- | --- |
| `--config <path>` | Config file to load instead of the discovered default. |
| `--outDir <path>` | Override `outDir`. The ledger moves with it. |
| `--init` | Create missing handler and policy skeletons. |
| `--check` | Report drift without writing. Exit `1` on drift. |
| `--clean` | Delete stale files that carry the ownership header. |

Each file is listed with its status (`created`, `updated`, `unchanged`, `deleted`, or `drifted`). With `--json`, `data` is the `GenerateResult` described below. Unknown arguments exit `2`. See [CLI](cli.md) for the shared output contract.

## Programmatic API

```ts
import { generate } from '@di-framework/codegen';

const result = await generate({
  config: './di-framework.codegen.ts', // or a CodegenConfig object
  cwd: process.cwd(),
  init: false,
  check: process.env.CI === 'true',
  clean: false,
});

if (result.drifted) {
  console.error(result.diagnostics.join('\n'));
  process.exit(1);
}
```

`GenerateOptions` also accepts `manifests: SchemaCodegenManifest[]` to bypass file discovery and `outDir` to override the configured directory. `GenerateResult` has `success`, `drifted`, `files` (each with `path`, `relativePath`, `content`, and `status`), `ledgerPath`, and `diagnostics`.

Lower-level exports are available for custom pipelines: `loadConfig`, `findManifestFiles`, `loadManifests`, `validateManifestShape`, `normalizeManifest`, `normalizeImportPath`, `loadLedger`, `saveLedger`, `hasOwnershipHeader`, and `OWNERSHIP_HEADER`.

## Versioning contracts

Add a new manifest rather than editing a published one. `orders-v2.codegen.ts` with `version: 'v2'` and `http: { prefix: '/v2' }` emits into `src/generated/orders/v2/` with its own `OrdersV2HttpController` and `routes`, so both versions serve side by side until you delete the `v1` manifest and run `--clean`.

## Next Steps

- [CLI](cli.md) - `generate` in the canonical command tree and the JSON output contract
- [HTTP Router](http-router.md) - What the generated controller plugs into, and OpenAPI generation
- [Events](events.md) - Transports for the generated `@EventBridge`
- [RPC](rpc.md) - Serving the generated `@RpcService` over JSON-RPC and gRPC
- [AI](ai.md) - Registering the generated `@ToolSet` with an agent
- [Resource Authorization](authorization.md) - Filling in the generated `@Policy`
