# Kotlin

Compile a Kotlin/Wasm WASI Preview 1 command, link it into a component that
exports `wasi:http/handler@0.3.0`, and publish that component as a wasmCloud
WorkloadDeployment.

The Kotlin program is a core module. It imports `wasi_snapshot_preview1` and
does not export an HTTP handler. The tenant host runs components. A
`wasm32-unknown-unknown` handler imports the command as a core library named
`glue` and returns the command's stdout as `text/plain`. The command module
is unchanged as a core module. The link step adds shims so the handler can
call it.

The template this program follows is JetBrains'
[kotlin-wasm-wasi-template](https://github.com/Kotlin/kotlin-wasm-wasi-template)
(Apache-2.0). Kotlin stays at 2.3.0. Gradle 9.4.1 is the wrapper that runs
that compiler on JDK 26 as well as on JDK 17.

The production module has one memory and one table. It does not need
`WASMTIME_POOLING_MAX_TABLES_PER_MODULE`. It passes on wash 2.8.0
(`ghcr.io/wasmcloud/wash:2.8.0`) and on Wasmtime 48.0.1. Clock values change
on every request. The registry digest is the push you just made.

Workload name used below: `kotlin-wasm-wasi`.

## Toolchain

Command:

- JDK 17 or newer. Gradle 9.4.1 also runs on JDK 26.
- Kotlin 2.3.0, plugin `org.jetbrains.kotlin.multiplatform`.
- A Gradle wrapper whose distribution URL is
  `https://services.gradle.org/distributions/gradle-9.4.1-bin.zip`.

Component link:

- rustup and Cargo, target `wasm32-unknown-unknown`.
- `wasip3` 0.9.0, default features off, features `std` and `async-spawn`.
- `dlmalloc` 0.2.6 with feature `global`.
- Host crates at 0.258.0: `wasmparser`, `wasm-encoder`, `wit-component`.
- wash 2.8.0 and Wasmtime for local serving.
- ORAS and kubectl for [Publish](#publish).

```sh
rustup target add wasm32-unknown-unknown
```

## Program

`build.gradle.kts`:

```kotlin
@file:OptIn(ExperimentalWasmDsl::class)

import org.jetbrains.kotlin.gradle.ExperimentalWasmDsl

plugins {
    kotlin("multiplatform") version "2.3.0"
}

repositories {
    mavenCentral()
}

kotlin {
    wasmWasi {
        nodejs()
        binaries.executable()
    }
}
```

`src/wasmWasiMain/kotlin/Main.kt`. Clocks go through
`wasi_snapshot_preview1.clock_time_get`. `dummy` is exported because some
WasmEdge runs expect an `_initialize` companion. The HTTP link does not call
`dummy`.

```kotlin
import kotlin.wasm.WasmImport
import kotlin.wasm.WasmExport
import kotlin.wasm.unsafe.Pointer
import kotlin.wasm.unsafe.UnsafeWasmMemoryApi
import kotlin.wasm.unsafe.withScopedMemoryAllocator

fun main() {
    println("Hello from Kotlin via WASI")
    println("Current 'realtime' timestamp is: ${wasiRealTime()}")
    println("Current 'monotonic' timestamp is: ${wasiMonotonicTime()}")
}

@WasmImport("wasi_snapshot_preview1", "clock_time_get")
private external fun wasiRawClockTimeGet(clockId: Int, precision: Long, resultPtr: Int): Int

private const val REALTIME = 0
private const val MONOTONIC = 1

@OptIn(UnsafeWasmMemoryApi::class)
fun wasiGetTime(clockId: Int): Long = withScopedMemoryAllocator { allocator ->
    val rp0 = allocator.allocate(8)
    val ret = wasiRawClockTimeGet(clockId, precision = 1, resultPtr = rp0.address.toInt())
    check(ret == 0) { "Invalid WASI return code $ret" }
    Pointer(rp0.address.toInt().toUInt()).loadLong()
}

fun wasiRealTime(): Long = wasiGetTime(REALTIME)
fun wasiMonotonicTime(): Long = wasiGetTime(MONOTONIC)

@WasmExport
fun dummy() {}
```

A Node test that the monotonic clock does not move backwards belongs in
`src/wasmWasiTest` and runs with:

```sh
./gradlew wasmWasiNodeTest
```

## Build the command

```sh
./gradlew compileProductionExecutableKotlinWasmWasi
```

The production module is:

```text
build/compileSync/wasmWasi/main/productionExecutable/kotlin/kotlin-wasm-wasi.wasm
```

Copy it to `dist/kotlin_wasm_wasi.wasm`. Run it as a command before linking:

```sh
wasmtime run dist/kotlin_wasm_wasi.wasm
```

Stdout contains these three prefixes. The numbers after the prefixes change:

```text
Hello from Kotlin via WASI
Current 'realtime' timestamp is:
Current 'monotonic' timestamp is:
```

`wasmtime run` is the Preview 1 command. It is not the HTTP component.

## HTTP handler

Same shape as a core-module HTTP front. The handler exports
`wasi:http/handler@0.3.0` and imports `glue`:

| Import | Signature | Role |
| --- | --- | --- |
| `run` | `(i64, i64) -> i32` | Realtime nanoseconds, monotonic nanoseconds, then the command. Returns the exit code. |
| `stdout_len` | `() -> i32` | Captured stdout length. |
| `stdout_byte` | `(i32) -> i32` | One stdout byte. |

The handler reads `wasi:clocks` `system-clock` and `monotonic-clock` at 0.3
and passes those values into `run`. Preview 1 `clock_time_get` inside the
command must return the values it was given, not a second clock source.
`fd_write` must copy stdout into a buffer the handler can read, capped (4096
bytes is enough for this program). The call stays a core call inside `handle`.

`Cargo.toml`:

```toml
[package]
name = "kotlin-wasm-wasi-handler"
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
use wasip3::clocks::{monotonic_clock, system_clock};
use wasip3::http::types::{ErrorCode, Fields, Request, Response};
use wasip3::{wit_bindgen, wit_future, wit_stream};

wasip3::http::service::export!(Handler);

struct Handler;

#[link(wasm_import_module = "glue")]
extern "C" {
    fn run(realtime_ns: i64, monotonic_ns: i64) -> i32;
    fn stdout_len() -> i32;
    fn stdout_byte(index: i32) -> i32;
}

fn kotlin_stdout() -> Vec<u8> {
    let now = system_clock::now();
    let realtime = now
        .seconds
        .saturating_mul(1_000_000_000)
        .saturating_add(i64::from(now.nanoseconds));
    let monotonic = monotonic_clock::now() as i64;
    let exit = unsafe { run(realtime, monotonic) };
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
        let body = kotlin_stdout();
        let headers = Fields::from_list(&[
            ("content-type".into(), b"text/plain; charset=utf-8".to_vec()),
            ("x-component-language".into(), b"kotlin".to_vec()),
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

Workspace profiles match the Java link: `panic = "abort"` on dev and
release, and release `opt-level = "s"`, `lto = true`, `codegen-units = 1`.

```sh
cargo build -p kotlin-wasm-wasi-handler --release --target wasm32-unknown-unknown
```

## Link

The command imports three Preview 1 functions (`clock_time_get` twice in
spirit, plus `fd_write` and `proc_exit` as the module actually imports them).
Replace those imports with local shims in the same module so function indexes
of the original code stay valid. Add globals for the realtime and monotonic
values `run` receives, and a buffer for stdout. Export `run`, `stdout_len`,
and `stdout_byte`. Validate with `wasmparser` and `WasmFeatures::all()`.

`wit-component` 0.258.0 encodes the pair. The library name must be `glue`,
matching `wasm_import_module`.

```rust
let mut encoder = wit_component::ComponentEncoder::default();
encoder.module(&handler)?;
encoder.library("glue", &glue, wit_component::LibraryInfo { arguments: Vec::new() })?;
encoder.validate(true);
let component = encoder.encode()?;
```

Composer dependencies:

```toml
[dependencies]
anyhow = "1"
wasm-encoder = "=0.258.0"
wasmparser = "=0.258.0"
wit-component = "=0.258.0"
```

```sh
cargo build -p kotlin-wasm-wasi-compose
./target/debug/kotlin-wasm-wasi-compose \
  dist/kotlin_wasm_wasi.wasm \
  target/wasm32-unknown-unknown/release/handler.wasm \
  dist/kotlin_wasm_wasi.component.wasm
wash inspect dist/kotlin_wasm_wasi.component.wasm
```

The inspect output must include `export wasi:http/handler@0.3.0`.

## Serve locally

Wasmtime does not need a pooling-table override:

```sh
wasmtime serve -S cli=y,p3=y --addr 127.0.0.1:8080 \
  dist/kotlin_wasm_wasi.component.wasm
```

`.wash/config.yaml`:

```yaml
build:
  command: "true"
  component_path: dist/kotlin_wasm_wasi.component.wasm
dev:
  address: 127.0.0.1:8080
  wasm_proposals: [component-model-async]
  host_interfaces:
    - namespace: wasi
      package: http
      version: "0.3.0"
      interfaces: [handler]
      config:
        host: kotlin-wasm-wasi
```

```sh
wash dev
curl -H 'Host: kotlin-wasm-wasi' http://127.0.0.1:8080/
```

Request `/` twice. Each body contains the greeting and both clock lines.
The timestamps differ between the two responses.

## Publish

No hostgroup environment change is required for this module. The host image
can stay `ghcr.io/wasmcloud/wash:2.8.0`.

Follow [the shared publish steps](README.md#what-the-platform-runs) with:

| | |
| --- | --- |
| Workload name | `kotlin-wasm-wasi` |
| Wasm file | `dist/kotlin_wasm_wasi.component.wasm` |
| `Host` header | `kotlin-wasm-wasi` |

`oci-config.json` uses `"os": "wasip2"` and `component.target`
`wasi:http/service@0.3.0`. Fill imports and exports from `wash inspect`.
The workload image is the manifest digest from that push.

After Ready, port-forward `service/di-http` and request `/` twice.

```sh
curl -H 'Host: kotlin-wasm-wasi' http://127.0.0.1:8080/
```

```sh
kubectl -n "$TENANT_NAMESPACE" delete \
  workloaddeployment/kotlin-wasm-wasi service/kotlin-wasm-wasi
```
