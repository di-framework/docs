# Biome plugins

`@di-framework/biome` is a set of Biome GritQL plugins for applications written with di-framework.
The rules match source patterns that fail at startup, load the wrong package, or put secrets in
a guest binding.

The plugins are syntactic. Missing registrations, cycles, and bounded-context edges still belong
to `ApplicationContext.start()` and `buildSemanticSchema()`.

## Installation

```bash
bun add -d @biomejs/biome @di-framework/biome@^6
```

```bash
npm install --save-dev @biomejs/biome @di-framework/biome@^6
```

`@di-framework/biome` **6.x** publishes from
[di-framework/di-framework](https://github.com/di-framework/di-framework)
(`packages/di-framework-biome`). Peer: `@biomejs/biome@^2.5.0`. It ships in the framework
**6.0.5** release.

`biome.json`:

```json
{
  "extends": ["@di-framework/biome"],
  "javascript": {
    "parser": {
      "unsafeParameterDecoratorsEnabled": true
    }
  }
}
```

`unsafeParameterDecoratorsEnabled` lets Biome parse `@Component` on constructor parameters.
Plugin paths resolve from the application root, so the package must be installed in
`node_modules`.

```bash
biome check .
```

`@di-framework/biome` enables every rule. `@di-framework/biome/correctness` is the same set
without the 5.x package renames (`no-wasmcloud-package`, `no-cli-plugin-wasmcloud`) and the
deprecated `@di-framework/socket/bun` alias.

Suppress one finding with `// biome-ignore lint/plugin/<rule-file-name>: reason`. The file name
is the `.grit` basename, such as `no-bootstrap-decorator`.

## Rules

| Rule | Catches |
| --- | --- |
| `no-bootstrap-decorator` | `@Bootstrap()` |
| `no-reflect-metadata` | `import 'reflect-metadata'` |
| `no-wasmcloud-package` | `@di-framework/wasmcloud` |
| `no-cli-plugin-wasmcloud` | `@di-framework/cli-plugin-wasmcloud` |
| `no-socket-bun-alias` | `@di-framework/socket/bun` |
| `no-actors-testing-import` | `@di-framework/actors/testing` outside `*.test.ts`, `*.test.tsx`, and `tests/` |
| `use-scoped-core-import` | Unscoped `di-framework/...` imports |
| `use-configuration-import` | `Bean` imported from config, or `Value` / `WithProfile` imported from core |
| `no-bean-outside-configuration` | `@Bean` without core `@Configuration()` |
| `use-bean-dependencies` | `@Bean` factory parameters without `dependencies` |
| `no-inject-outside-container` | `@Component`, `@Value`, or `@ServiceBinding` on a class that is not container-managed |
| `no-bad-cron-expression` | `@Cron` strings that are not a 5-field expression, including names such as `@daily`, a seconds field, and `?` |
| `no-generated-value-without-id` | `@GeneratedValue` without `@Id` on the same property |
| `no-plaintext-binding-secret` | `password`, `secret`, `token`, `uri`, `url`, or `connectionString` inside `@WasmCloudBinding` `config` |
| `use-wit-binding-name` | `@WasmCloudBinding` names with an uppercase letter or `_`. The diagnostic requires `/^[a-z][a-z0-9-]*$/` |
| `no-service-name-on-non-postgres` | `serviceName` on a class that does not extend `Postgres` |
| `no-short-auth-secret` | `registerAuth({ secret })` literals shorter than 32 characters |
| `no-emit-decorator-metadata` | `emitDecoratorMetadata: true` |
| `use-experimental-decorators` | `experimentalDecorators: false` |

`@GeneratedValue` is checked by two plugin files, `no-generated-value-without-id` and
`no-generated-value-without-id-property`, so both `name!:` and `name:` fields are covered.
`no-actors-testing-import` is included for every file except tests. The other rules apply to
the whole project.

`no-plaintext-binding-secret` tells you to reference the secret with `secretFrom`. See
[native service bindings](platform.md#native-service-bindings). `no-bad-cron-expression` matches
the [scheduling](scheduling.md) contract: a 5-field expression or a millisecond interval.

## Next steps

- [Runtime type checks](tsc.md) - Emit-time parameter guards
- [Best practices](best-practices.md) - Recommended application patterns
- [Authentication](auth.md) - Session and bearer secrets
- [Platform](platform.md#native-service-bindings) - `@WasmCloudBinding` configuration
