# Rust

Build a native `wasm32-wasip3` component that exports
`wasi:http/handler@0.3.0` and imports only WASI 0.3 interfaces, serve it
with Wasmtime 48 or wash 2.10.1, and publish it as a wasmCloud
WorkloadDeployment.

This is Rust's `wasm32-wasip3` target, not the wasmCloud 2.8.0 fixture that
compiles `wasm32-wasip1` and adapts it. A component can export
`wasi:http/handler@0.3.0` and still trap on a host whose Wasmtime cannot run
this compiler output. wash 2.8.0 (`ghcr.io/wasmcloud/wash:2.8.0`) and
Wasmtime 47.0.3 return HTTP 500 on the first request with an out-of-bounds
memory trap. Wasmtime 48.0.1 and wash 2.10.1 pass the same checks. Do not
apply this component to a host that is still on wash 2.8.0. Apply happens
before the HTTP check, and a failed check leaves the Service and
WorkloadDeployment in place.

The registry OCI config still uses `"os": "wasip2"`. That field is the
component category the registry expects. `wash inspect` is what records the
0.3 imports and the handler export.

Workload name used below: `rust-p3-http`. Release artifact:
`target/wasm32-wasip3/release/rust_p3_http.wasm`.

## Toolchain

- rustup.
- Channel `nightly-2026-09-26`, profile `minimal`, target `wasm32-wasip3`.
- `wasip3` 0.9.0 with feature `http-compat`.
- `wit-bindgen` 0.62.0 with default features off and feature `std` on.
- Wasmtime 48.0.1 for a local pass. wash 2.10.1 for a local wasmCloud pass.
- ORAS and kubectl for [Publish](#publish), and only against a host that is
  not wash 2.8.0.

`rust-toolchain.toml`:

```toml
[toolchain]
channel = "nightly-2026-09-26"
profile = "minimal"
targets = ["wasm32-wasip3"]
```

```sh
rustup toolchain install nightly-2026-09-26 --profile minimal --target wasm32-wasip3
```

`.cargo/config.toml` so plain `cargo build` selects the target:

```toml
[build]
target = "wasm32-wasip3"
```

`Cargo.toml`:

```toml
[package]
name = "rust-p3-http"
version = "0.1.0"
edition = "2024"
publish = false

[lib]
crate-type = ["cdylib"]

[dependencies]
bytes = "1"
http = "1"
http-body-util = "0.1"
wasip3 = { version = "=0.9.0", features = ["http-compat"] }
wit-bindgen = { version = "=0.62.0", default-features = false, features = ["std"] }

[profile.release]
opt-level = "s"
lto = true
codegen-units = 1
strip = "debuginfo"
```

`wit-bindgen`'s `std` feature is required at these pins. With the default
features selected through `wasip3`, concurrent requests on Wasmtime 48 hit
an assertion in async task-context handling. `std` selects Rust's task-local
implementation. Keep a concurrency check when you move the compiler or the
bindings.

## Program

`src/lib.rs`. The crate refuses to compile for any target other than
`wasm32-wasip3`. `wasip3::http::service::export!` generates the handler
export. `http-compat` converts between `http::Request` and the WASI request.

```rust
#[cfg(not(all(target_arch = "wasm32", target_env = "p3")))]
compile_error!("Build this crate with --target wasm32-wasip3");

use bytes::Bytes;
use http_body_util::{BodyExt, Full, Limited};
use wasip3::http::types::{ErrorCode, Request, Response};
use wasip3::http_compat::{http_from_wasi_request, http_into_wasi_response};

const MAX_ECHO_BYTES: usize = 64 * 1024;
const ABOUT: &str = concat!(
    "{\"app\":\"rust-p3-http\",\"language\":\"rust\",",
    "\"target\":\"wasm32-wasip3\",\"http\":\"wasi:http/handler@0.3.0\"}\n"
);

struct App;

impl wasip3::exports::http::handler::Guest for App {
    async fn handle(request: Request) -> Result<Response, ErrorCode> {
        let request = http_from_wasi_request(request)?;
        match (request.method().as_str(), request.uri().path()) {
            ("GET", "/") => respond(200, "application/json", Bytes::from_static(ABOUT.as_bytes())),
            ("GET", "/health") => respond(200, "text/plain", Bytes::from_static(b"ok\n")),
            ("POST", "/echo") => {
                match Limited::new(request.into_body(), MAX_ECHO_BYTES).collect().await {
                    Ok(body) => respond(200, "application/octet-stream", body.to_bytes()),
                    Err(_) => respond(413, "text/plain", Bytes::from_static(b"body rejected\n")),
                }
            }
            _ => respond(404, "text/plain", Bytes::from_static(b"not found\n")),
        }
    }
}

fn respond(status: u16, content_type: &str, body: Bytes) -> Result<Response, ErrorCode> {
    let response = http::Response::builder()
        .status(status)
        .header("content-type", content_type)
        .header("x-component-language", "rust")
        .header("x-wasi-version", "0.3.0")
        .body(Full::new(body))
        .expect("constant response metadata must be valid");
    http_into_wasi_response(response)
}

wasip3::http::service::export!(App);
```

## Build

```sh
cargo build --release --locked --target wasm32-wasip3
wash inspect target/wasm32-wasip3/release/rust_p3_http.wasm
```

Every import must be a `wasi:` interface at `@0.3.0`. The export list must
include `wasi:http/handler@0.3.0`. `--locked` requires a `Cargo.lock` you
generated with this toolchain. Commit that lockfile with the crate.

## Serve locally

Use wash 2.10.1. wash 2.8.0 reproduces the trap.

`.wash/config.yaml`:

```yaml
build:
  command: cargo build --locked --release --target wasm32-wasip3
  component_path: target/wasm32-wasip3/release/rust_p3_http.wasm
dev:
  address: 127.0.0.1:8080
  wasm_proposals:
    - component-model-async
  host_interfaces:
    - namespace: wasi
      package: http
      version: "0.3.0"
      interfaces: [handler]
      config:
        host: rust-p3-http
```

rustup's proxies have to be on `PATH` so `wash dev` finds the nightly
toolchain.

```sh
wash dev
curl -H 'Host: rust-p3-http' http://127.0.0.1:8080/
curl -H 'Host: rust-p3-http' --data-binary 'hello Rust' http://127.0.0.1:8080/echo
```

Wasmtime 48:

```sh
wasmtime serve -S p3=y --addr 127.0.0.1:8080 \
  target/wasm32-wasip3/release/rust_p3_http.wasm
```

`cli=y` is unnecessary. This component does not import Preview 2 CLI.

To hold the bytes fixed, build once and point a user config at that file
with `build.command: "true"`. Run `wash dev --user-config` from an empty
directory. Readiness is `listening for HTTP requests` for wash and
`Serving HTTP on` for Wasmtime.

Check identity JSON (`target` is `wasm32-wasip3`), both headers, `/health`,
empty, text, and 64 KiB echo, a chunked body, 413, 404, and 32 overlapping
requests from 8 clients. The concurrency check is the one that fails when
`wit-bindgen/std` is dropped.

## Publish

Only after the host is wash 2.10.1 or another Wasmtime that already passed
the local checks. On wash 2.8.0, stop after the local serve.

Follow [the shared publish steps](README.md#what-the-platform-runs) with:

| | |
| --- | --- |
| Workload name | `rust-p3-http` |
| Wasm file | `target/wasm32-wasip3/release/rust_p3_http.wasm` |
| `Host` header | `rust-p3-http` |

`oci-config.json` keeps `"os": "wasip2"`. Fill `imports` and `exports` from
`wash inspect`. Set `component.target` to `wasi:http/service@0.3.0`. Apply
with the tenant kubeconfig. If the first request traps, delete the objects.
They are not removed by a failed check.

```sh
kubectl -n "$TENANT_NAMESPACE" delete \
  workloaddeployment/rust-p3-http service/rust-p3-http
```
