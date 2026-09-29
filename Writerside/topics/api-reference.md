# API Reference

Complete reference for all APIs provided by the DI framework.

## Decorators

### @Container(options?)

Marks a class as injectable and automatically registers it with the DI container.

**Options:**
- `singleton?: boolean` (default: `true`) - Create a new instance each time or reuse the same instance
- `container?: DIContainer` - Specify a custom container (defaults to global container)

> **Note:** Import as `import { Container as DIContainer } from 'di-framework/container'` to avoid name collision with the `@Container` decorator.

**Example:**

```typescript
import { Container } from 'di-framework/decorators';

// Singleton service (default)
@Container()
export class DatabaseService {
  connect() {
    console.log('Connected');
  }
}

// Non-singleton service
@Container({ singleton: false })
export class RequestScopedService {
  // New instance created for each resolution
}

// Custom container
import { Container as DIContainer } from 'di-framework/container';
const customContainer = new DIContainer();

@Container({ container: customContainer })
export class CustomService {
  // Registered in custom container
}
```

### @Component(target)

Marks a constructor parameter or property for dependency injection.

**Parameters:**
- `target` - The class to inject or a string identifier for factory-registered services

**Example - Constructor Parameter:**

```typescript
@Container()
export class OrderService {
  constructor(@Component(DatabaseService) private db: DatabaseService) {}
}
```

**Example - Property Injection:**

```typescript
@Container()
export class ReportService {
  @Component(DatabaseService)
  private db!: DatabaseService;
}
```

**Example - Factory Service:**

```typescript
@Container()
export class UserService {
  constructor(@Component('config') private config: any) {}
}
```

## Container API

### getContainer()

Returns the global DI container instance.

**Returns:** `Container`

**Example:**

```typescript
import { getContainer } from 'di-framework/container';

const container = getContainer();
```

### container.register(serviceClass, options?)

Manually register a service class.

**Parameters:**
- `serviceClass` - The class to register
- `options?` - Registration options
  - `singleton?: boolean` (default: `true`)

**Example:**

```typescript
container.register(UserService, { singleton: true });
```

### container.registerFactory(name, factory, options?)

Register a service using a factory function.

**Parameters:**
- `name: string` - Identifier for the service
- `factory: () => T` - Factory function that creates the service instance
- `options?` - Registration options
  - `singleton?: boolean` (default: `true`)

**Example:**

```typescript
container.registerFactory('config', () => ({
  apiKey: process.env.API_KEY,
  dbUrl: process.env.DATABASE_URL
}), { singleton: true });

// Use in services
@Container()
export class UserService {
  constructor(@Component('config') private config: any) {}
}
```

### container.resolve(serviceClass)

Resolve and get an instance of a service.

**Parameters:**
- `serviceClass` - The class or string identifier to resolve

**Returns:** Instance of the service with all dependencies injected

**Example:**

```typescript
// By class
const userService = container.resolve<UserService>(UserService);

// By name (for factory-registered services)
const config = container.resolve('config');
```

### container.has(serviceClass)

Check if a service is registered in the container.

**Parameters:**
- `serviceClass` - The class or string identifier to check

**Returns:** `boolean`

**Example:**

```typescript
if (container.has(UserService)) {
  const service = container.resolve(UserService);
}
```

### container.getServiceNames()

Get all registered service names.

**Returns:** `string[]` - Array of all registered service identifiers

**Example:**

```typescript
const names = container.getServiceNames();
console.log(names); // ['DatabaseService', 'UserService', ...]
```

## Lifecycle Methods

Services can optionally implement lifecycle methods that are called by the framework or your application code.

### setEnv(env: Record<string, any>)

Called to initialize environment-specific configuration.

**Example:**

```typescript
@Container()
export class DatabaseService {
  setEnv(env: Record<string, any>) {
    console.log('DB URL:', env.DATABASE_URL);
  }
}

const db = container.resolve(DatabaseService);
db.setEnv(process.env);
```

### setCtx(context: any)

Called to set execution context (e.g., request context).

**Example:**

```typescript
@Container()
export class RequestService {
  setCtx(context: any) {
    console.log('Context:', context);
  }
}

const service = container.resolve(RequestService);
service.setCtx({ userId: '123', requestId: 'abc' });
```

## Types

### Container

The DI container class.

```typescript
class Container {
  register<T>(serviceClass: new (...args: any[]) => T, options?: { singleton?: boolean }): void;
  registerFactory<T>(name: string, factory: () => T, options?: { singleton?: boolean }): void;
  resolve<T>(serviceClass: new (...args: any[]) => T | string): T;
  has(serviceClass: any): boolean;
  getServiceNames(): string[];
}
```

## Next Steps

- [Advanced Usage](advanced-usage.md) - Learn advanced patterns and techniques
- [Error Handling](error-handling.md) - Understand error scenarios and how to handle them
- [Testing](testing.md) - Learn how to test services with the DI framework
