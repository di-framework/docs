# Advanced Usage

Learn advanced patterns and techniques for using the DI framework effectively.

## Transient (Non-Singleton) Services

By default, all services are singletons - the same instance is reused. For services that need a new instance each time, use `singleton: false`:

```typescript
@Container({ singleton: false })
export class RequestContext {
  id = Math.random().toString();

  constructor(@Component(LoggerService) private logger: LoggerService) {
    this.logger.log(`Request context created: ${this.id}`);
  }
}

// Each resolve creates a new instance
const ctx1 = container.resolve(RequestContext); // new instance
const ctx2 = container.resolve(RequestContext); // different instance
console.log(ctx1.id !== ctx2.id); // true
```

**When to use transient services:**
- Request-scoped services
- Session-scoped services  
- Services with mutable state that shouldn't be shared
- Services that need fresh data on each use

## Factory Functions

Register services using factory functions for complex initialization logic:

```typescript
container.registerFactory('apiClient', () => {
  return new HttpClient({
    baseUrl: process.env.API_URL,
    timeout: 5000,
    headers: {
      'Authorization': `Bearer ${process.env.API_TOKEN}`
    }
  });
}, { singleton: true });

// Use in services
@Container()
export class UserService {
  constructor(@Component('apiClient') private api: any) {}
  
  async getUser(id: string) {
    return this.api.get(`/users/${id}`);
  }
}
```

**Factory function benefits:**
- Initialize services with environment variables
- Create instances with complex configuration
- Conditionally create different implementations
- Integrate third-party libraries

## Lifecycle Methods

Services can implement lifecycle methods for initialization and context management:

```typescript
@Container()
export class DatabaseService {
  private connected = false;
  private dbUrl: string = '';

  setEnv(env: Record<string, any>) {
    // Called to initialize environment-specific config
    this.dbUrl = env.DATABASE_URL;
    console.log('DB URL configured:', this.dbUrl);
  }

  setCtx(context: any) {
    // Called to set execution context
    console.log('Context set:', context);
  }

  connect() {
    this.connected = true;
    console.log('Connected to:', this.dbUrl);
  }
}

// Usage
const db = container.resolve(DatabaseService);
db.setEnv(process.env);
db.setCtx({ userId: '123' });
db.connect();
```

## Multiple Dependencies

Inject multiple dependencies using constructor parameters:

```typescript
@Container()
export class ApplicationContext {
  constructor(
    @Component(DatabaseService) private db: DatabaseService,
    @Component(LoggerService) private logger: LoggerService,
    @Component(AuthService) private auth: AuthService,
    @Component(CacheService) private cache: CacheService,
    @Component(EmailService) private email: EmailService
  ) {}

  async initialize() {
    this.logger.log('Initializing application...');
    await this.db.connect();
    this.auth.setup();
    this.cache.connect();
  }
}
```

## Custom Containers

Create isolated containers for different parts of your application:

```typescript
import { Container as DIContainer } from 'di-framework/container';

// Create custom containers
const apiContainer = new DIContainer();
const workerContainer = new DIContainer();

// Register services in specific containers
@Container({ container: apiContainer })
export class ApiService {
  // Only available in apiContainer
}

@Container({ container: workerContainer })
export class WorkerService {
  // Only available in workerContainer
}

// Resolve from specific containers
const apiService = apiContainer.resolve(ApiService);
const workerService = workerContainer.resolve(WorkerService);
```

**Use cases for custom containers:**
- Multi-tenant applications
- Plugin systems
- Testing with isolated environments
- Microservices within a monorepo

## Configuration Services

Create configuration services using factory functions:

```typescript
// Register configuration
container.registerFactory('config', () => ({
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    name: process.env.DB_NAME || 'myapp'
  },
  api: {
    key: process.env.API_KEY,
    secret: process.env.API_SECRET
  },
  features: {
    enableNewUI: process.env.ENABLE_NEW_UI === 'true',
    maxUploadSize: parseInt(process.env.MAX_UPLOAD_SIZE || '10485760')
  }
}), { singleton: true });

// Use in services
@Container()
export class DatabaseService {
  constructor(@Component('config') private config: any) {
    console.log('DB Config:', this.config.database);
  }
}
```

## Conditional Service Registration

Register different implementations based on environment:

```typescript
// Register different implementations
if (process.env.NODE_ENV === 'production') {
  container.registerFactory('logger', () => new ProductionLogger(), { singleton: true });
} else {
  container.registerFactory('logger', () => new DevelopmentLogger(), { singleton: true });
}

// Services get the right implementation
@Container()
export class UserService {
  constructor(@Component('logger') private logger: any) {
    this.logger.log('UserService initialized');
  }
}
```

## Service Composition

Compose complex services from simpler ones:

```typescript
@Container()
export class DataAccessLayer {
  constructor(
    @Component(DatabaseService) private db: DatabaseService,
    @Component(CacheService) private cache: CacheService
  ) {}

  async get(key: string) {
    // Try cache first
    const cached = await this.cache.get(key);
    if (cached) return cached;

    // Fall back to database
    const data = await this.db.query(`SELECT * FROM data WHERE key = '${key}'`);
    await this.cache.set(key, data);
    return data;
  }
}

@Container()
export class BusinessLogicLayer {
  constructor(
    @Component(DataAccessLayer) private dal: DataAccessLayer,
    @Component(ValidationService) private validator: ValidationService
  ) {}

  async processRequest(request: any) {
    this.validator.validate(request);
    return this.dal.get(request.key);
  }
}
```

## Next Steps

- [Error Handling](error-handling.md) - Learn how to handle errors in your DI setup
- [Best Practices](best-practices.md) - Follow recommended patterns
- [Testing](testing.md) - Test your services effectively
