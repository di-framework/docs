# Private service bindings

Independently authored services can export a callable contract and grant named callers access
through DI. Callers invoke operations on a binding name; they do not configure a URL or an
exposed HTTP endpoint.

> These APIs landed on di-framework `main` after the
> [v5.3.0](https://github.com/di-framework/di-framework/releases/tag/v5.3.0) tag
> ([PR #416](https://github.com/di-framework/di-framework/pull/416), closing
> [di-framework#402](https://github.com/di-framework/di-framework/issues/402)).
> They are documented here on **latest** (EAP) and are not in the frozen `/v5.3/` snapshot.

The runtime is **in-process**. `invoke()` is a same-process method call on a registered export.
There is no RPC, HTTP, or wasmCloud hop in this package. Use the same decorator API in local
development and tests; map targets with configuration or `LocalServiceDevManager` instead of
changing caller code.

This is distinct from [JSON-RPC and gRPC](rpc.md) (typed request/response over a transport) and
from [wasmCloud native bindings](wasmcloud.md#native-service-bindings) (Postgres, KV, messaging,
and similar host capabilities).

## Installation

```bash
bun add @di-framework/core
```

Canonical imports come from `@di-framework/core/service-bindings`. Decorators are also
re-exported from `@di-framework/core/decorators`.

```typescript
import { Container } from '@di-framework/core/decorators';
import { useContainer } from '@di-framework/core/container';
import {
  ExportService,
  ServiceBinding,
  LocalServiceDevManager,
  serviceBindingToken,
  UnboundCallerError,
} from '@di-framework/core/service-bindings';
```

## Checkout calling inventory

The [checkout-inventory example](https://github.com/di-framework/di-framework/tree/main/examples/checkout-inventory)
is the runnable walkthrough.

### 1. Declare the contract

```typescript
export interface ReservationItem {
  sku: string;
  quantity: number;
}

export interface InventoryContract {
  reserve(items: ReservationItem[]): Promise<{ reservationId: string }>;
  release(reservationId: string): Promise<{ released: boolean }>;
  checkStock(sku: string): Promise<number>;
}
```

### 2. Export operations on the target

```typescript
@Container()
@ExportService({
  name: 'inventory-service',
  version: '1.0.0',
  operations: ['reserve', 'release', 'checkStock'],
  description: 'Private inventory management service',
})
export class InventoryService implements InventoryContract {
  async reserve(items: ReservationItem[]) {
    return { reservationId: 'res_1' };
  }

  async release(reservationId: string) {
    return { released: true, reservationId };
  }

  async checkStock(sku: string) {
    return 0;
  }
}
```

`ExportService('inventory-service')` is equivalent to `{ name: 'inventory-service' }`.
`operations` lists the methods bound callers may invoke. If it is omitted, the runtime discovers
prototype function names (not instance arrow fields). Declare `operations` explicitly when the
export set should be narrower than every method.

### 3. Inject a named binding on the caller

```typescript
@Container()
export class CheckoutService {
  constructor(
    @ServiceBinding('inventory', {
      caller: 'checkout-service',
      target: 'inventory-service',
      expectedOperations: ['reserve', 'release'],
    })
    private readonly inventory: InventoryContract,
  ) {}

  async placeOrder(items: ReservationItem[]) {
    const reservation = await this.inventory.reserve(items);
    return reservation.reservationId;
  }
}
```

Injection always yields a proxy. Authorization, missing targets, and contract mismatches are
checked **at invocation**, not at construction.

### 4. Grant access and run both services locally

There is no filesystem auto-discovery. Register exports and grants explicitly:

```typescript
const dev = new LocalServiceDevManager();

dev.registerService('inventory-service', new InventoryService(), {
  operations: ['reserve', 'release', 'checkStock'],
});

dev.bind('checkout-service', 'inventory', 'inventory-service', {
  allowedOperations: ['reserve', 'release', 'checkStock'],
  grantAccess: true,
});

// Bound in configuration but not granted — invocations throw UnboundCallerError.
dev.bind('rogue-service', 'inventory', 'inventory-service', {
  grantAccess: false,
});

console.log(dev.formatStatusTable());

const checkout = useContainer().resolve(CheckoutService);
await checkout.placeOrder([{ sku: 'laptop', quantity: 1 }]);
```

From the example package:

```bash
bun run dev    # in-process mesh + demo calls
bun test
```

## Configuration and target selection

`ServiceBindingRuntime.current.configure()` maps the current service's binding names to targets
and records grants. Environment can change the target without changing caller code:

```typescript
import { ServiceBindingRuntime } from '@di-framework/core/service-bindings';

ServiceBindingRuntime.current.configure({
  currentServiceId: 'checkout-service',
  environment: 'production',
  bindings: { inventory: 'inventory-service' },
  grants: [
    {
      caller: 'checkout-service',
      target: 'inventory-service',
      allowedOperations: ['reserve', 'release', 'checkStock'],
    },
  ],
});
```

`bindings` may also be `{ inventory: { target, allowedOperations, mock } }`. `callers` maps
`{ [callerId]: { [bindingName]: CallerBindingConfig } }` when one runtime hosts several callers.

Constructor defaults and environment:

| Variable | Role |
| --- | --- |
| `DI_SERVICE_ID` | Current service id (default `default-service`) |
| `DI_SERVICE_ENV` | Environment (else `NODE_ENV`, else `development`) |
| `DI_BINDINGS` | JSON object mapping binding names for the **current** service |
| `DI_SERVICE_GRANTS` | JSON array of grants; entries with `environment` set are skipped when it does not match |

Invalid JSON logs a warning and is ignored. A grant of `caller: '*'` authorizes every caller of
that target. `requiresAuthorization: false` on `@ExportService` skips grant checks for that
export.

`LocalServiceDevManager` forces `environment = 'development'`.

## Status, reload, and mocks

| API | Behavior |
| --- | --- |
| `getStatus()` / `formatStatusTable()` | Reports `CONNECTED`, `UNBOUND`, `UNAVAILABLE`, or `MOCKED` |
| `diagnose()` | Emits `UNBOUND_CALLER` and `TARGET_UNAVAILABLE` diagnostics |
| `stopService` / `startService` | Flip the export between `stopped` and `running` |
| `reloadService(name, instance)` | Re-register the export under the same name; existing proxies keep working |
| `substituteMock(bindingName, mock, caller?)` | Serve a mock without changing caller classes |
| `reset()` | Clear the manager / `ServiceBindingRuntime.reset()` |

Mocks skip grant checks unless `setEnforceAuthorizationOnMocks(true)`.

For tests, register a mock on the DI token instead of going through the manager:

```typescript
container.registerValue(serviceBindingToken('inventory'), {
  reserve: async () => ({ reservationId: 'mock' }),
  release: async () => ({ released: true }),
  checkStock: async () => 99,
});
```

`serviceBindingToken(bindingName, caller?)` is `service-binding:${caller}:${bindingName}` when a
caller is supplied, otherwise `service-binding:${bindingName}`. Values with `$bindingMeta` are
treated as real proxies and are not used as mocks.

## Errors and troubleshooting

All errors extend `ServiceBindingError` and include a `code` plus `details.remediation`.

| Class | `code` | When |
| --- | --- | --- |
| `UnboundCallerError` | `UNBOUND_CALLER` | No grant from caller to target while authorization is on |
| `MissingBindingError` | `MISSING_BINDING` | Binding is not mapped and no export uses that name |
| `TargetUnavailableError` | `TARGET_UNAVAILABLE` | Export is missing or `status !== 'running'` |
| `IncompatibleContractError` | `INCOMPATIBLE_CONTRACT` | Operation is not in the export set, or a mock lacks the method |
| `UnauthorizedOperationError` | `UNAUTHORIZED_OPERATION` | Grant exists but `allowedOperations` excludes the method |

| Symptom | Likely cause |
| --- | --- |
| `UNBOUND_CALLER` | Missing `bind` / `grant` / `configure({ grants })` |
| `MISSING_BINDING` | Binding name never mapped and no matching `@ExportService` name |
| `TARGET_UNAVAILABLE` | `stopService`, or the class was never registered |
| `INCOMPATIBLE_CONTRACT` | Calling a method not listed in `operations` |
| Mock ignored | Caller-scoped token does not match the invoke caller, or the value is a real proxy |

`expectedOperations` on `@ServiceBinding` and `timeoutMs` / `required` on binding options are
stored on the decorator; the runtime does not validate or enforce them today.

## Local versus deployed

| | Local (`LocalServiceDevManager`) | Deployed as implemented |
| --- | --- | --- |
| Process | One Node/Bun process | Same in-process runtime |
| Grants | `bind` / `grant` | `configure({ grants })` or `DI_SERVICE_GRANTS` |
| Target selection | `bind(..., target)` | `bindings` / `callers` / `DI_BINDINGS` |
| Transport | Direct method call | Direct method call |
| Status / reload | Manager APIs | None beyond `configure()` |

wasmCloud, the CLI, and `@di-framework/rpc` do not map `@ExportService` / `@ServiceBinding` onto
independently deployed components. A wasmCloud workload can still use this API **inside** one
component.

## Next steps

- [Remote actors](actors-distributed.md) - Cross-process actor RPC and ownership (a different API)
- [RPC](rpc.md) - Typed request/response over memory, HTTP, sockets, and gRPC
- [Testing](testing.md) - Mock substitution and unbound-caller tests
- [wasmCloud](wasmcloud.md) - Native host capability bindings (not this API)
- [CLI](cli.md) - Canonical command tree (no dedicated bindings command)
