# Cloudflare Workers

`@di-framework/cloudflare` connects a di-framework application to Cloudflare Workers. It classifies
Worker bindings, reads wrangler declarations, and injects those bindings through the DI container.

Worker bindings arrive on the request `env` object. Register factories at startup, then publish
`env` from the handler before resolving services.

## Installation

```bash
bun add @di-framework/cloudflare@^6 @di-framework/core@^5
```

```bash
npm install @di-framework/cloudflare@^6 @di-framework/core@^5
```

`@di-framework/cloudflare` **6.x** publishes from
[di-framework/platform](https://github.com/di-framework/platform) (`adapters/cloudflare`).
The current release is **6.0.7**. Peer: `@di-framework/core@^5`.

This package is the Workers binding connector. WebSocket and Durable Object sockets stay in
[`@di-framework/socket`](socket.md). Workers AI chat, embeddings, and Vectorize stay in
[`@di-framework/ai`](ai.md#cloudflare-workers-ai-and-vectorize).

## Dependency injection

Enable binding factories on a container, then inject a binding by its wrangler name:

```typescript
import { Container } from '@di-framework/core/decorators';
import {
  CloudflareBinding,
  type D1BindingInfo,
  EnableCloudflareBindings,
  type KvBindingInfo,
  setCloudflareBindings,
} from '@di-framework/cloudflare';

@EnableCloudflareBindings()
@Container()
export class OrderService {
  @CloudflareBinding('ORDERS')
  db!: D1BindingInfo;

  @CloudflareBinding('SESSIONS')
  sessions!: KvBindingInfo;

  async cart(id: string) {
    return this.sessions.binding?.get(id);
  }
}

export default {
  async fetch(request: Request, env: Record<string, unknown>) {
    setCloudflareBindings(env);
    const orders = new OrderService();
    const cart = await orders.cart(new URL(request.url).pathname);
    return new Response(cart == null ? 'empty' : String(cart));
  },
};
```

Call `setCloudflareBindings(env)` before the first read of an injected property. Property getters
keep the first value they resolve.

## Discovery

```typescript
import { CloudflareEnvironment } from '@di-framework/cloudflare';

const cf = new CloudflareEnvironment({ bindings: env });

const db = cf.getD1Binding('ORDERS');
const sessions = cf.getKvBinding('SESSIONS');
const bucket = cf.getR2Binding();
```

`getKvBinding()` without a name returns the first KV binding in name order. The same pattern
exists for D1, R2, Durable Objects, queues, service bindings, Workers AI, Hyperdrive, Vectorize,
and Analytics Engine.

The classifier covers KV, D1, R2, Durable Object namespaces, Queues, service bindings, Workers AI,
Hyperdrive, Vectorize, Analytics Engine, Images, Workflows, rate limits, browsers, pipelines, and
plain vars. Wrangler declarations supply kinds whose host objects look alike: assets, email,
dispatch namespaces, Secrets Store, and mTLS certificates, plus `vars`.

String bindings are vars. Names listed in `secretNames` are secrets. `kindHints` forces a kind
when the live object is ambiguous. A parsed wrangler config (JSON, not JSONC) supplies those
kinds through `parseWranglerBindings`. `CloudflareDetector` matches the Workers user agent and
`CF_PAGES=1`.

Outside Workers, a JSON object in `CLOUDFLARE_BINDINGS`, or an object passed as `localFallback`,
fills the same map. Set `localFallback: false` to require a published Worker env.

`getDefaultRegistry().register(...)` adds a custom classifier. The default priority is `high`,
so it runs before the built-ins. `{ priority: 'low' }` runs after them.

## Workers AI and Vectorize

`@CloudflareBinding('AI')` injects `{ binding }`, which
[`WorkersAiChatModel`](ai.md#cloudflare-workers-ai-and-vectorize) and
`WorkersAiEmbeddingModel` accept directly. A function reads the env published by
`setCloudflareBindings`:

```typescript
import { WorkersAiChatModel, WorkersAiEmbeddingModel, VectorizeVectorStore } from '@di-framework/ai';
import { getCloudflareBindings, setCloudflareBindings } from '@di-framework/cloudflare';

const chat = new WorkersAiChatModel({
  binding: () => getCloudflareBindings()?.AI,
  model: '@cf/meta/llama-3.1-8b-instruct',
});

export default {
  fetch(_request: Request, env: Record<string, unknown>) {
    setCloudflareBindings(env);
    const embeddings = WorkersAiEmbeddingModel.of(() => env.AI);
    const store = new VectorizeVectorStore({
      index: () => env.VECTORS,
      embeddingModel: embeddings,
    });
    return new Response(store.name);
  },
};
```

## Next steps

- [AI](ai.md#cloudflare-workers-ai-and-vectorize) - Workers AI chat and embeddings, and Vectorize
- [Sockets](socket.md#cloudflare-workers-and-durable-objects) - Workers and Durable Object sockets
- [Authentication](auth.md) - Sessions and bearer tokens on Workers
- [Deployment](deployment.md) - Cloud Foundry and the wasmCloud platform
