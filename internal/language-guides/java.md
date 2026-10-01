# Java

Compile a Java program with GraalVM Web Image to a core Wasm module, link
that module into a component that exports `wasi:http/handler@0.3.0`, and
publish the component as a wasmCloud WorkloadDeployment.

Web Image writes a JavaScript wrapper and a Wasm module.
`native-image --tool:svm-wasm` does not write a WASI HTTP component. Node
can run the wrapper. The tenant host does not run Node. The component is a
second build: a small `wasm32-unknown-unknown` HTTP handler plus a host
tool that merges the Graal module in as a core library named `glue`.

The Graal module defines two Wasm tables, a GC table and a funcref table.
Wasmtime's pooling allocator allows one table per module until
`WASMTIME_POOLING_MAX_TABLES_PER_MODULE` is raised. wash 2.8.0 without that
variable fails with `defined tables count of 2 exceeds the per-instance
limit of 1`. Set the variable to `4` on the wasmCloud host that will run
the component, and pass `-O pooling-max-tables-per-module=4` to local
Wasmtime. `component-model-async` is the extra proposal. GC, function
references, and exception handling are already on in Wasmtime 47 and 48.

This combination returns the program's stdout on wash 2.8.0, Wasmtime
47.0.3, and Wasmtime 48.0.1 once the table limit is raised. Module bytes
change between Graal builds. Publish the digest of the component you just
linked. Do not pin an older hash.

Workload name used below: `java-web-image`.

## Toolchain

Web Image:

- Oracle GraalVM 25.1 or later, with `lib/svm/tools/svm-wasm` present under
  the GraalVM home. A plain OpenJDK `javac` cannot produce the module.
  Verified with Oracle GraalVM 25.4.4.1.1. On macOS the home is
  `Contents/Home` inside the archive. `GRAALVM_HOME` or `JAVA_HOME` must
  point at a directory that contains `bin/native-image`.
- `wasm-as` from Binaryen 119 or later. Verified with Binaryen 133.
  `brew install binaryen` on macOS. `native-image` invokes `wasm-as`, so
  that directory has to be on `PATH`. `WEB_IMAGE_WASM_AS` is only a name
  you might use yourself. The Graal tool looks up `wasm-as` on `PATH`.
- Node.js 22 or later, and only if you want to run the wrapper. Verified
  with Node.js 22.23.2. Node before 25 needs `--experimental-wasm-exnref`.
  Node 25 and later do not. The tenant publish does not use Node.
- Xcode command-line tools on macOS. Native Image uses them.

Component link:

- rustup and Cargo. The handler target is `wasm32-unknown-unknown`. No
  nightly Rust toolchain is required for this link.
- `wasip3` 0.9.0, default features off, features `std` and `async-spawn`.
- `dlmalloc` 0.2.6 with feature `global`, as the handler's allocator.
- Host crates pinned together at 0.258.0: `wasmparser`, `wasm-encoder`,
  `wit-component`.
- wash 2.8.0 and Wasmtime 47 or 48 for local serving.
- ORAS and kubectl for [Publish](#publish).

```sh
rustup target add wasm32-unknown-unknown
```

## Program

`HelloWebImage.java`. The identity line says `"host":"javascript"` because
Web Image's own wrapper is a JavaScript host. Leave that string if you want
the body below. The HTTP handler ignores the request path and returns
stdout.

```java
public final class HelloWebImage {
    static final String ABOUT = "{\"app\":\"java-web-image\",\"language\":\"java\",\"backend\":\"svm-wasm\",\"host\":\"javascript\"}\n";

    public static int add(int left, int right) {
        return left + right;
    }

    public static void main(String[] args) {
        System.out.print(ABOUT);
        System.out.println("add(3, 4)=" + add(3, 4));
    }
}
```

Every successful HTTP response is these two lines, with headers
`content-type: text/plain`, `x-component-language: java`, and
`x-wasi-version: 0.3.0`:

```text
{"app":"java-web-image","language":"java","backend":"svm-wasm","host":"javascript"}
add(3, 4)=7
```

## Build the Web Image module

```sh
mkdir -p dist/classes
javac -d dist/classes HelloWebImage.java
export PATH="$(dirname "$(command -v wasm-as)"):$PATH"
native-image --tool:svm-wasm -cp dist/classes HelloWebImage dist/java-web-image
```

`--tool:svm-wasm` has to be the first `native-image` argument. The image
name is the last argument. On success the directory contains:

- `dist/java-web-image.js`, the Node wrapper
- `dist/java-web-image.js.wasm`, the core module (magic bytes `\0asm`)
- `dist/java-web-image.js.wat`, the text form

The wrapper looks up `require` and `__filename`. Those exist for CommonJS.
If the directory is treated as an ES module, add `dist/package.json`
containing `{"type":"commonjs"}` and run Node with `dist` as the working
directory:

```sh
node --experimental-wasm-exnref dist/java-web-image.js
```

Drop `--experimental-wasm-exnref` on Node.js 25 or later. Stdout must be the
two lines above. This run does not produce the tenant artifact.

## HTTP handler

The handler is a `cdylib` for `wasm32-unknown-unknown`. It exports
`wasi:http/handler@0.3.0` through `wasip3::http::service::export!` and
imports three core functions from module `glue`:

| Import | Signature | Role |
| --- | --- | --- |
| `run` | `() -> i32` | Execute the Java program. The `i32` is the process exit code. |
| `stdout_len` | `() -> i32` | Byte length of captured stdout. |
| `stdout_byte` | `(i32) -> i32` | One stdout byte. |

Call them as core functions during `handle`. Do not lift `run` into a second
component function. With `component-model-async` enabled, a second component
entry traps.

`Cargo.toml` for the handler:

```toml
[package]
name = "java-web-image-handler"
version = "0.1.0"
edition = "2021"
publish = false

[lib]
name = "handler"
path = "src/lib.rs"
crate-type = ["cdylib"]

[dependencies]
dlmalloc = { version = "0.2.6", features = ["global"] }
wasip3 = { version = "=0.9.0", default-features = false, features = ["std", "async-spawn"] }
```

`src/lib.rs`:

```rust
use wasip3::http::types::{ErrorCode, Fields, Request, Response};
use wasip3::{wit_bindgen, wit_future, wit_stream};

wasip3::http::service::export!(Handler);

struct Handler;

#[link(wasm_import_module = "glue")]
extern "C" {
    fn run() -> i32;
    fn stdout_len() -> i32;
    fn stdout_byte(index: i32) -> i32;
}

fn java_stdout() -> Vec<u8> {
    let exit = unsafe { run() };
    let len = unsafe { stdout_len() };
    let mut body = Vec::with_capacity(len.max(0) as usize);
    for index in 0..len {
        body.push(unsafe { stdout_byte(index) } as u8);
    }
    let _ = exit;
    body
}

impl wasip3::exports::http::handler::Guest for Handler {
    async fn handle(_request: Request) -> Result<Response, ErrorCode> {
        let body = java_stdout();
        let headers = Fields::from_list(&[
            ("content-type".into(), b"text/plain; charset=utf-8".to_vec()),
            ("x-component-language".into(), b"java".to_vec()),
            ("x-wasi-version".into(), b"0.3.0".to_vec()),
        ])
        .map_err(|_| ErrorCode::InternalError(Some("response headers were rejected".into())))?;

        let (mut body_tx, body_rx) = wit_stream::new();
        let (body_result_tx, body_result_rx) = wit_future::new(|| Ok(None));
        let (response, _transmission) = Response::new(headers, Some(body_rx), body_result_rx);
        drop(body_result_tx);

        wit_bindgen::spawn_local(async move {
            let _ = body_tx.write_all(body).await;
        });
        Ok(response)
    }
}
```

Workspace `Cargo.toml` members are `handler` and `compose`. Both release and
dev profiles set `panic = "abort"`. Release also sets `opt-level = "s"`,
`lto = true`, and `codegen-units = 1`.

```sh
cargo build -p java-web-image-handler --release --target wasm32-unknown-unknown
```

The core module is
`target/wasm32-unknown-unknown/release/handler.wasm`.

## Link

Graal's imports use Wasm GC types, so they cannot be declared as component
imports. A native composer rewrites the Graal module, then
`wit_component::ComponentEncoder` (crate `wit-component` 0.258.0) encodes
the handler as the main module and the rewritten Graal module as a library
named `glue` with no instantiation arguments.

The rewrite has to keep every existing function index stable, because the
code, table, element, and start sections are copied unchanged. Replace each
Graal import with a local function of the same type. Append new function
types after Graal's rec groups for `run`, `stdout_len`, and `stdout_byte`.
A rec-group type written as `() -> i32` is not the type the canonical ABI
lifts, so those three exports need types appended past Graal's groups.
Capture stdout inside the rewritten module and serve it through
`stdout_len` and `stdout_byte`. Validate the merged core module with
`wasmparser` and `WasmFeatures::all()` before encoding. Then:

```rust
let mut encoder = wit_component::ComponentEncoder::default();
encoder.module(&handler)?;
encoder.library("glue", &glue, wit_component::LibraryInfo { arguments: Vec::new() })?;
encoder.validate(true);
let component = encoder.encode()?;
```

Composer `Cargo.toml`:

```toml
[package]
name = "java-web-image-compose"
version = "0.1.0"
edition = "2021"
publish = false

[[bin]]
name = "java-web-image-compose"
path = "src/main.rs"

[dependencies]
anyhow = "1"
wasm-encoder = "=0.258.0"
wasmparser = "=0.258.0"
wit-component = "=0.258.0"
```

```sh
cargo build -p java-web-image-compose
./target/debug/java-web-image-compose \
  dist/java-web-image.js.wasm \
  target/wasm32-unknown-unknown/release/handler.wasm \
  dist/java_web_image.wasm
wash inspect dist/java_web_image.wasm
```

`wash inspect` must show an export of `wasi:http/handler@0.3.0`. The output
file is the artifact you serve and publish.

## Serve locally

```sh
export WASMTIME_POOLING_MAX_TABLES_PER_MODULE=4
wasmtime serve -S cli=y,p3=y \
  -O pooling-max-tables-per-module=4 \
  --addr 127.0.0.1:8080 \
  dist/java_web_image.wasm
```

wash needs the same variable in the environment. `.wash/config.yaml` has no
field for it. A raw `wash dev` without the variable hits the two-table
error.

```yaml
build:
  command: "true"
  component_path: dist/java_web_image.wasm
dev:
  address: 127.0.0.1:8080
  wasm_proposals: [component-model-async]
  host_interfaces:
    - namespace: wasi
      package: http
      version: "0.3.0"
      interfaces: [handler]
      config:
        host: java-web-image
```

```sh
export WASMTIME_POOLING_MAX_TABLES_PER_MODULE=4
wash dev
curl -H 'Host: java-web-image' http://127.0.0.1:8080/
```

Request `/` twice. Both responses are the two-line body. The handler does
not branch on the path.

## Publish

The hostgroup Deployment that runs this workload needs
`WASMTIME_POOLING_MAX_TABLES_PER_MODULE=4` in the host container
environment. Apply that variable with its own field manager so a later
platform reconcile does not drop it. Recreating the hostgroup Deployment
from the controller template removes the variable, and the workload then
fails the two-table check.

If the runtime quota cannot fit a second host pod beside the one already
running, set the hostgroup rollout to `maxSurge: 0` and `maxUnavailable: 1`
in the same apply. A quota of 2 CPU and 4Gi with a host container limit of
1 CPU and 2Gi is that case. The host image stays
`ghcr.io/wasmcloud/wash:2.8.0`.

Follow [the shared publish steps](README.md#what-the-platform-runs) with:

| | |
| --- | --- |
| Workload name | `java-web-image` |
| Wasm file | `dist/java_web_image.wasm` |
| `Host` header | `java-web-image` |

`oci-config.json` uses `"os": "wasip2"` and `component.target`
`wasi:http/service@0.3.0`. Imports and exports come from `wash inspect`.
Push the component you just linked. Graal output is not stable across
builds, so the workload image is that push's manifest digest.

After the WorkloadDeployment is Ready, port-forward `service/di-http` and
request `/` twice.

```sh
curl -H 'Host: java-web-image' http://127.0.0.1:8080/
```

```sh
kubectl -n "$TENANT_NAMESPACE" delete \
  workloaddeployment/java-web-image service/java-web-image
```
