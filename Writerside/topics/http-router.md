# HTTP Router

Lightweight TypeScript decorators and a type-safe router for [itty-router](https://github.com/kwhitley/itty-router). Includes a build-time OpenAPI 3.1 generator. Ported from `itty-decorators`.

## Features

- **Type-Safe Routing**: `TypedRouter` provides full TypeScript support for request bodies, response types, and context.
- **Auto JSON Enforcement**: Automatically validates `Content-Type: application/json` for mutation methods (POST, PUT, PATCH).
- **Multipart Support**: Opt into `multipart/form-data` handling with `Multipart<T>` and `{ multipart: true }`.
- **Declarative Metadata**: Use `@Controller` and `@Endpoint` decorators to document your API logic directly in code.
- **DI Integration**: `@Controller` composes the core DI `@Container` decorator, so controllers are auto-registered and can use `@Component` injection and `useContainer().resolve(...)`.
- **OpenAPI 3.1 Support**: Generate a complete OpenAPI specification from your code at build time.
- **Static assets**: `HttpRouter.builder().static()` serves a directory in development and packaged bytes after build.
- **Minimal Footprint**: Built on top of the ultra-light `itty-router`.

## Installation

```bash
# Install the HTTP package and core di-framework (peer dependency)
bun add @di-framework/http @di-framework/core
# or
npm install @di-framework/http @di-framework/core
```

## Quick Start

### 1. Create a Controller (DI-aware)

Annotate your API logic using decorators and the `TypedRouter`. Controllers are automatically registered with the DI container, so you can inject services and resolve the controller instance.

```typescript
import {
  TypedRouter,
  json,
  type RequestSpec,
  type ResponseSpec,
  type Json,
  Controller,
  Endpoint,
} from '@di-framework/http';
import { Component, Container } from '@di-framework/core/decorators';
import { useContainer } from '@di-framework/core/container';

const router = TypedRouter();

type EchoPayload = { message: string };
type EchoResponse = { echoed: string; timestamp: string };

// Example DI-managed service
@Container()
export class LoggerService {
  log(msg: string) {
    console.log(msg);
  }
}

@Controller()
export class EchoController {
  // Because @Controller composes the core @Container decorator, this class is
  // automatically registered with the DI container. We can inject services.
  @Component(LoggerService)
  private logger!: LoggerService;

  echoMessage(message: string): EchoResponse {
    this.logger.log(`Echoing: ${message}`);
    return { echoed: message, timestamp: new Date().toISOString() };
  }

  @Endpoint({
    summary: 'Echo a message',
    description: 'Returns the provided message with a server timestamp.',
    responses: {
      '200': { description: 'Successful echo' },
    },
  })
  static post = router.post<RequestSpec<Json<EchoPayload>>, ResponseSpec<EchoResponse>>(
    '/echo',
    (req) => {
      // Demonstrate auto DI registration: resolve the controller instance from
      // the global container without any manual registration.
      const controller = useContainer().resolve(EchoController);
      return json(controller.echoMessage(req.content.message));
    },
  );
}

// Add a simple GET route
router.get('/', () => json({ message: 'API is healthy' }));

export default {
  fetch: (request: Request, env: any, ctx: any) => router.fetch(request, env, ctx),
};
```

### 2. Multipart File Uploads

Use `Multipart<T>` and `{ multipart: true }` to accept `multipart/form-data` instead of JSON. The handler receives `req.content` typed as `FormData`.

```typescript
import {
  TypedRouter,
  json,
  type RequestSpec,
  type ResponseSpec,
  type Multipart,
} from '@di-framework/http';

const router = TypedRouter();

type UploadPayload = { files: File[] };
type UploadResult = { filenames: string[] };

router.post<RequestSpec<Multipart<UploadPayload>>, ResponseSpec<UploadResult>>(
  '/upload',
  (req) => {
    // req.content is typed as FormData
    const files = req.content.getAll('files') as File[];
    return json({ filenames: files.map((f) => f.name) });
  },
  { multipart: true },
);
```

### 3. Path and Query Parameters

Use `PathParams<T>` and `QueryParams<T>` combined with `RequestSpec<...>` to provide strong typing for URL path parameters (e.g., `/user/:id`) and query string parameters (e.g., `?search=term`). The handler will receive them in `req.params` and `req.query`.

```typescript
import {
  TypedRouter,
  json,
  type RequestSpec,
  type ResponseSpec,
  type PathParams,
  type QueryParams,
} from '@di-framework/http';

const router = TypedRouter();

type UserPathParams = { id: string };
type UserQueryParams = { includeDetails?: string };
type UserResponse = { id: string; detailsIncluded: boolean };

router.get<
  RequestSpec<PathParams<UserPathParams> & QueryParams<UserQueryParams>>,
  ResponseSpec<UserResponse>
>('/user/:id', (req) => {
  // req.params is typed as { id: string }
  const id = req.params.id;

  // req.query is typed as { includeDetails?: string | string[] }
  const detailsIncluded = req.query.includeDetails === 'true';

  return json({ id, detailsIncluded });
});
```

### OpenAPI Generation

`@di-framework/http` provides typed APIs and a registry for generating OpenAPI specs from your
controllers. Terminal routing and presentation belong to the unified `di-framework` CLI.

#### Using the CLI

Generate a spec through the canonical CLI command:

```bash
# Generate openapi.json from your controllers
di-framework http openapi generate --controllers ./src/index.ts
```

**Options:**

- `--controllers <path>`: (Required) Path to the file that imports all your decorated controllers.
- `--output <path>`: (Optional) Path to save the generated JSON (default: `openapi.json`).

#### Manual Generation

You can also generate the spec programmatically using the `generateOpenAPI` function and the default `registry`:

```typescript
import registry, { generateOpenAPI } from '@di-framework/http';
import './controllers/MyController'; // Import to trigger registration

const spec = generateOpenAPI(
  {
    title: 'My API',
    version: '1.0.0',
  },
  registry,
);

console.log(JSON.stringify(spec, null, 2));
```

If you need full control, you can iterate the `registry` manually:

```typescript
import registry from '@di-framework/http';

for (const target of registry.getTargets()) {
  // target is the decorated class
  // target[methodName].isEndpoint will be true
  // target[methodName].metadata contains your @Endpoint info
}
```

## API Reference

### `TypedRouter<Args[]>()`

A proxy for `itty-router` that enables type-safe method definitions.

- `Args`: An array of types representing additional arguments passed to `fetch` (e.g., `[Env, ExecutionContext]`).

### `json<T>(data: T, init?: ResponseInit)`

A typed wrapper around itty-router's `json` helper.

### `Json<T>` / `Multipart<T>`

Body spec markers used with `RequestSpec<>` to declare the expected content type. `Json<T>` types `req.content` as `T`; `Multipart<T>` types it as `FormData`. Multipart routes require passing `{ multipart: true }` as the third argument to the route method.

### `PathParams<T>` / `QueryParams<T>`

Spec markers used with `RequestSpec<>` to declare the expected type of path and query parameters. `PathParams<T>` types `req.params` as `T`; `QueryParams<T>` types `req.query` as `T`.

### `@Controller(options?)`

Composed decorator that:

- Marks a class for inclusion in the OpenAPI registry; and
- Registers the class with the core DI container (same instance as `@di-framework/core`).

**Options:** `{ singleton?: boolean; container?: DIContainer }`

### `@Endpoint(metadata)`

Method or property decorator that attaches OpenAPI metadata.

- `summary`: Short summary of the operation.
- `description`: Verbose explanation.
- `requestBody`: OpenAPI Request Body object.
- `responses`: OpenAPI Responses object.

### `HttpRouter.builder()` & `@HttpRouter(options?)`

An extensible, fluent builder above `TypedRouter()` and its corresponding decorator:

```typescript
import { HttpRouter } from '@di-framework/http';

// 1. Fluent Builder
const http = HttpRouter.builder()
  .prefix('/api')
  .use(loggingMiddleware)
  .catch((err) => new Response(JSON.stringify({ error: err.message }), { status: 500 }))
  .build();

http.get('/health', async () => new Response('OK'));

// 2. Class Decorator with DI integration
@HttpRouter({
  prefix: '/v1',
  use: [authMiddleware],
})
export class ApiRouter {}

// Resolve from DI container
const router = useContainer().resolve('HTTP_ROUTER');
```

- **`prefix(pathPrefix)`**: Sets a global base path prefix for registered routes.
- **`catch(handler)`**: Registers a custom global error handler.
- **`use(...middleware)`**: Registers global middleware executed on all routes.
- **`static(prefix, options)`**: Serve files from a directory or a packaged bundle. See [Static assets](#static-assets).
- **`withAuth(options)`**: Extension point for auth integrations without introducing runtime dependencies in `@di-framework/http`.
- **`extend(fn)`**: Register custom builder extensions.

## Static assets

Declare an asset directory once. During development the handler reads the directory on each
request. After packaging, the same mount serves in-memory bytes when the source directory is
gone.

> These APIs landed on di-framework `main` after the
> [v5.3.0](https://github.com/di-framework/di-framework/releases/tag/v5.3.0) tag
> ([PR #417](https://github.com/di-framework/di-framework/pull/417), closing
> [di-framework#412](https://github.com/di-framework/di-framework/issues/412)).
> They are documented here on **latest** (EAP) and are not in the frozen `/v5.3/` snapshot.

`TypedRouter()` has no `.static()` method. Mounts live on `HttpRouter.builder()` / the built
router, or `@HttpRouter({ static })`.

### Local serving

The [http-router example](https://github.com/di-framework/di-framework/tree/main/examples/packages/http-router)
mounts `public/` at `/static` next to `POST /echo` and `GET /`:

```typescript
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpRouter } from '@di-framework/http';

const publicDir = join(dirname(fileURLToPath(import.meta.url)), 'public');

const router = HttpRouter.builder()
  .static('/static', {
    directory: publicDir,
    cacheControl: 'public, max-age=3600',
    fallthrough: true,
  })
  .build();
```

`GET /static/style.css` and `HEAD /static/info.json` serve from disk. Edits appear without
rebuilding while live mode is on.

### Options

```typescript
interface StaticAssetOptions {
  directory: string;
  fallthrough?: boolean;   // default false
  cacheControl?: string;
  manifest?: StaticAssetManifest | string;
  package?: StaticAssetPackage;
  live?: boolean;
}
```

| Option | Behavior |
| --- | --- |
| `directory` | Required. Live root, and registry lookup key if no `package` / `manifest`. |
| `fallthrough` | `true`: miss / wrong method / bad path returns `undefined` so later routes run. `false`: 404 / 405 / 403 / 400. |
| `cacheControl` | Copied to `Cache-Control` on 200 and 304. |
| `manifest` | Object or JSON path (native only). Metadata-only manifests still need a live directory for bytes. |
| `package` | In-memory bundle with encoded contents. Used when not in live mode. |
| `live` | Force disk vs package. Default: live iff the directory exists **and** there are no packaged contents. Packaged contents win unless `live: true`. |

Hidden path segments (names starting with `.`) 404. Directory listings are disabled. Symlinks
that escape the real root are skipped at package time and 403/404 at serve time. There is **no**
configurable exclusions option.

Builder `prefix('/api')` plus `.static('/assets', …)` mounts at `/api/assets`.

### GET, HEAD, types, ETag

Only `GET` and `HEAD`. Other methods return 405 + `Allow: GET, HEAD` (or fallthrough).

| Case | Status |
| --- | --- |
| File found | 200 |
| Matching `If-None-Match` | 304, empty body |
| Missing / hidden / directory / no source | 404 |
| `..` / traversal | 403 (malformed `%` decode → 400) |
| Wrong method | 405 |

MIME comes from a built-in map; unknown types are `application/octet-stream`. Text types include
`charset=utf-8`.

ETag: packaged files use a strong tag from SHA-256; live disk uses a weak
`W/"<size>-<mtime>-<ctime>"` tag (no per-request hash). `If-None-Match` supports exact tags,
`W/`-stripped compare, comma lists, and `*`.

Live GET streams from the file descriptor and **omits** `Content-Length` (the file can change
while streaming). Live HEAD and packaged GET/HEAD set `Content-Length`. Consumers must read or
`cancel()` the body so the descriptor closes.

### Route order, middleware, and 404

`HttpRouterBuilder.build()` registers, in order: `.use()` middleware as `all('*')`, then
`.static()` mounts, then `withAuth` / `.extend()`, then application `get` / `post` after
`.build()`.

- Global middleware runs **before** the static handler.
- `withAuthRoutes` does **not** wrap already-mounted static routes. Guard assets with `.use(guard)`
  or `fallthrough: true` plus a later guarded route.
- Default `fallthrough: false` means a missing static path 404s and later routes never run.
- The example uses `fallthrough: true` so `GET /` and `POST /echo` coexist. Static uses `all`, so
  non-GET/HEAD also need fallthrough to reach `router.post(...)`.

### Packaging

Native `@di-framework/http` only (not the portable entry):

```typescript
import { packageStaticAssets, registerStaticAssets } from '@di-framework/http';

const pkg = packageStaticAssets({ directory: './public' });
registerStaticAssets('/static', pkg);
```

`packageStaticAssets({ directory, outputDir?, outFile?, format?, prefix? })` writes
`manifest.json` / `static-assets.json` or a JS/TS module that calls `registerStaticAssets`.
Manifests include posix keys, `contentType`, `size`, SHA-256 `hash`, and a strong `etag`.

Missing source directory at **package** time throws `Error: Directory not found: …`. Mounting
`.static()` does **not** validate the directory; a missing live root is 404 (or fallthrough) at
request time.

The wasmCloud plugin does **not** auto-discover `.static()` directories. Package on the build
host, then either pass `package: pkg` into `.static()` or import generated JS that registers the
bundle. The portable `/ wasmcloud` entry has no `node:fs` and no `packageStaticAssets`. Serve
without the source directory by using packaged contents (tests delete the directory and still
GET/HEAD/304).

Out of scope (not implemented): SPA fallback, index-file routing, compression, byte ranges,
remote storage, CDN provisioning, frontend compilation, configurable exclude globs, and
automatic CLI collection of asset directories.

## Next steps

- [wasmCloud](wasmcloud.md) - Component build; package assets on the host before bundling
- [CLI](cli.md) - `http openapi generate`
- [Deployment](deployment.md) - Target runtimes

