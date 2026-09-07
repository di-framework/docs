# Cloud Foundry

`@di-framework/cloudfoundry` connects a DI Framework application to Cloud Foundry or Tanzu
Application Service. It detects the platform environment, parses `VCAP_APPLICATION` and
`VCAP_SERVICES`, normalizes service credentials into typed models, and makes those models available
through dependency injection.

The package configures an application after it starts on the platform. Continue to use your Cloud
Foundry manifest and the `cf` CLI to push and manage the application itself.

## Installation

```bash
bun add @di-framework/cloudfoundry @di-framework/core
```

```bash
npm install @di-framework/cloudfoundry @di-framework/core
```

## Dependency injection

Enable the connectors on a container, then inject application metadata or a service by its bound
name:

```typescript
import { Container } from '@di-framework/core/decorators';
import {
  CloudFoundryService,
  EnableCloudFoundryConnectors,
  VcapApplication,
  type CloudFoundryApplicationInfo,
  type RedisServiceInfo,
  type RelationalServiceInfo,
} from '@di-framework/cloudfoundry';

@EnableCloudFoundryConnectors()
@Container()
export class ApplicationServices {
  @VcapApplication()
  private application!: CloudFoundryApplicationInfo;

  @CloudFoundryService('orders-db')
  private database!: RelationalServiceInfo;

  @CloudFoundryService('orders-cache')
  private cache!: RedisServiceInfo;
}
```

`@CloudFoundryService` accepts a service name, label, regular expression, or typed filter. By
default a missing service is an error. Use `required: false`, `defaultValue`, or `fallbackEnv` when
the binding is optional or has a local equivalent.

## Programmatic discovery

Use `CloudFoundryEnvironment` when application code needs to inspect the environment directly:

```typescript
import { CloudFoundryEnvironment } from '@di-framework/cloudfoundry';

const environment = new CloudFoundryEnvironment();

if (environment.isCloudFoundry()) {
  const application = environment.getApplicationInfo();
  const database = environment.getRelationalServiceInfo();
  const cache = environment.getRedisServiceInfo();

  console.log(application?.applicationName, database?.dialect, cache?.host);
}
```

Application metadata includes the application and space identifiers, names, URIs, instance data,
and resource limits exposed by `VCAP_APPLICATION`.

## Supported services

The default creator registry recognizes common platform services and returns a normalized model for
each category:

| Category | Examples | Model |
| --- | --- | --- |
| Relational database | PostgreSQL, MySQL, MariaDB, SQLite | `RelationalServiceInfo` |
| Cache | Redis, Redis TLS, Redis cluster | `RedisServiceInfo` |
| Messaging | RabbitMQ, CloudAMQP | `AmqpServiceInfo` |
| Blob storage | MinIO, Amazon S3, object stores | `BlobStorageServiceInfo` |
| User-provided service | Services created with `cf cups` | `UserProvidedServiceInfo` |

Register a `CloudFoundryServiceInfoCreator` with `getDefaultRegistry()` to normalize another
service type.

## Local fallback

Local fallback is enabled by default when no Cloud Foundry services are present. The environment
checks standard variables including `DATABASE_URL`, `REDIS_URL`, `AMQP_URL`, and `S3_BUCKET` and
exposes matching service models. Pass `localFallback: false` when constructing
`CloudFoundryEnvironment` or enabling the connectors to require platform bindings instead.

## Next steps

- [Deployment](deployment.md) - Compare deployment targets
- [Configuration](config.md) - Load typed application configuration
- [Repositories](repositories.md) - Connect normalized database credentials to a data layer
