# wasmCloud extension

`@di-framework/cli-plugin-wasmcloud` is a [CLI extension](cli.md#extensions) for targeting
[wasmCloud](https://wasmcloud.com): it builds a DI Framework HTTP application into a WASI 0.2
WebAssembly component, serves it locally, and deploys it through a Pulumi program.

```bash
di-framework extensions install wasmcloud
```

The extension mounts one command group:

```text
di-framework wasmcloud
├── build
├── dev
├── deploy
├── destroy
└── doctor
```

| Command | Purpose |
| --- | --- |
| `build` | Bundle the application entry and componentize it for WASI HTTP. |
| `dev` | Build, then serve the component locally with `jco serve`. |
| `deploy` | Build, then deploy via the Pulumi program above the project. |
| `destroy` | Destroy the deployed Pulumi stack. |
| `doctor` | Check the project and local toolchain for wasmCloud readiness. |

As with every extension, the commands follow the [CLI contract](cli.md): the same help forms,
`--json` envelope, and exit-status table apply.

## Project convention

A component project is marked by `di-framework.config.json` in the project root:

```json
{
  "name": "my-app",
  "entry": "src/app.ts",
  "output": "dist/my-app.wasm"
}
```

`name` and `entry` are required; `output` defaults to `dist/<name>.wasm`. Both paths must stay
inside the project directory. Commands may run from any directory inside the project; the nearest
`di-framework.config.json` above the working directory wins.

The entry module default-exports a Fetch-compatible handler: a
`(request: Request) => Response | Promise<Response>` function or an object with such a `fetch`
method. A `@di-framework/http` `TypedRouter` works as-is.

The extension owns the WebAssembly/WASI boundary. `build` bundles the entry behind a
WASI-HTTP-to-Web-Fetch adapter with vendored WASI 0.2.12 WIT definitions, then componentizes with
`jco`. Intermediate build state lives in the disposable `.di-framework/` directory; the finished
component is written to the configured `output` path. JSON `data` contains `application`,
`component`, `entry`, and `profile`.

## Local development

```bash
di-framework wasmcloud dev [--host <address>] [--port <port>]
```

`dev` rebuilds the component and serves it with `jco serve` on `127.0.0.1:8000` by default. Tool
output streams directly to the terminal until the server is stopped.

## Deploy and destroy

```bash
di-framework wasmcloud deploy [--yes]
di-framework wasmcloud destroy [--yes]
```

`deploy` builds the component, then runs `pulumi up` in the infrastructure root: the directory of
the nearest `Pulumi.yaml` found above the project directory. The Pulumi program itself is
infrastructure code owned outside the application project. `destroy` runs `pulumi destroy` for the
same stack. `--yes` skips the Pulumi confirmation prompt. A missing `Pulumi.yaml` reports
`WASMCLOUD_INFRA_NOT_FOUND` and exits `2`.

Pulumi environment defaults, applied without changing the caller's environment:

| Variable | Default | Meaning |
| --- | --- | --- |
| `DI_FRAMEWORK_STACK` | `dev` | Pulumi stack name selected for `up` and `destroy`. |
| `PULUMI_BACKEND_URL` | `file://~` | Local file backend unless a backend is configured. |
| `PULUMI_CONFIG_PASSPHRASE` | `local-dev` | Local development fallback when unset. |

## Doctor

```bash
di-framework wasmcloud doctor
```

`doctor` verifies the project loads and probes the local toolchain: Bun, Node.js,
`@di-framework/core` and `@di-framework/http` resolvable from the project, Pulumi, Docker, and
kubectl. JSON `data` lists every check with its result; any failed check exits `1`.

Bun runs the CLI, but `jco` itself requires a real Node.js installation on `PATH` — `build`, `dev`,
and `deploy` report `WASMCLOUD_NODE_REQUIRED` without it. Pulumi, Docker, and kubectl are only
needed for `deploy` and `destroy`.

## Next steps

- [CLI](cli.md) - The canonical command tree and the extensions mechanism
- [HTTP Router](http-router.md) - Fetch-compatible routing that runs unchanged in a component
- [Installation](installation.md) - Core package and CLI setup
