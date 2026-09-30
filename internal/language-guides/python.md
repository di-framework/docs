# Python

Build a Wasm component with componentize-py that exports
`wasi:http/handler@0.3.0`, serve it with wash or Wasmtime, and publish it as
a wasmCloud WorkloadDeployment. The component contains the Python runtime.
It exports P3 HTTP and keeps Preview 2 support imports. The world is
`wasi:http/service@0.3.0`, the same world as componentize-py's tagged
[http-p3 example](https://github.com/bytecodealliance/componentize-py/tree/v0.25.1/examples/http-p3).

That shape passes on wash 2.8.0 (`ghcr.io/wasmcloud/wash:2.8.0`) and on wash
2.10.1. Wasmtime needs both CLI and P3 features because of the Preview 2
imports. Snapshot builds can hash differently from one run to the next.
Publish one inspected file, and compare runtimes against that same file.

Workload name used below: `python-p3-http`. Artifact:
`dist/python_p3_http.wasm`.

## Toolchain

- Python 3.11 or newer.
- [componentize-py 0.25.1](https://github.com/bytecodealliance/componentize-py/releases/tag/v0.25.1).
  `componentize-py --version` must print `componentize-py 0.25.1`.

```sh
python3 -m venv .venv
.venv/bin/pip install 'componentize-py==0.25.1'
export PATH="$PWD/.venv/bin:$PATH"
```

A native binary from that GitHub release is the same tool. Put it on `PATH`.

- wash 2.8.0 or newer, and Wasmtime 48, for local serving.
- ORAS and kubectl for [Publish](#publish).

The WIT must be the `wit/` tree from the `v0.25.1` tag of
`bytecodealliance/componentize-py`, not a newer WASI checkout. Download that
tag and copy every `*.wit` file under its `wit/` directory into `./wit`,
keeping the relative paths (`deps/` included). Confirm the files against the
checksums published with that tag before you componentize. A mismatch here
produces a component whose imports do not match the host.

## Program

`app.py` next to `wit/`. The module name passed to `componentize` is `app`,
so the file must be named `app.py`. The handler is async. Body bytes move
through the canonical stream, and the request's completion future is read
before a successful echo so a failed request is not returned as 200.

```python
import json
import componentize_py_async_support
import wit_world
from componentize_py_types import Ok
from wit_world import exports
from wit_world.imports.wasi_http_types import Fields, Method_Get, Method_Post, Request, Response

MAX_BODY = 64 * 1024
ABOUT = (json.dumps({
    "app": "python-p3-http", "language": "python",
    "target": "wasi:http/service@0.3.0", "http": "wasi:http/handler@0.3.0",
}) + "\n").encode()


def trailers_future():
    return wit_world.result_option_wasi_http_types_fields_wasi_http_types_error_code_future(lambda: Ok(None))[1]


def unit_future():
    return wit_world.result_unit_wasi_http_types_error_code_future(lambda: Ok(None))[1]


def respond(status, content_type, body):
    writer, reader = wit_world.byte_stream()

    async def send():
        with writer:
            await writer.write_all(body)

    componentize_py_async_support.spawn(send())
    response = Response.new(Fields.from_list([
        ("content-type", content_type.encode()),
        ("x-component-language", b"python"),
        ("x-wasi-version", b"0.3.0"),
    ]), reader, trailers_future())[0]
    response.set_status_code(status)
    return response


class Handler(exports.Handler):
    async def handle(self, request: Request) -> Response:
        method = request.get_method()
        path = (request.get_path_with_query() or "").split("?", 1)[0]
        if isinstance(method, Method_Get) and path == "/":
            return respond(200, "application/json", ABOUT)
        if isinstance(method, Method_Get) and path == "/health":
            return respond(200, "text/plain", b"ok\n")
        if isinstance(method, Method_Post) and path == "/echo":
            reader, trailers = Request.consume_body(request, unit_future())
            body = bytearray()
            with reader:
                while not reader.writer_dropped:
                    body.extend(await reader.read(min(16384, MAX_BODY + 1 - len(body))))
                    if len(body) > MAX_BODY:
                        return respond(413, "text/plain", b"body rejected\n")
            await trailers.read()
            return respond(200, "application/octet-stream", bytes(body))
        return respond(404, "text/plain", b"not found\n")
```

`componentize-py` generates `wit_world` from the WIT at build time. Those
imports are not pip packages.

## Build

```sh
mkdir -p dist
componentize-py \
  -d wit \
  -w wasi:http/service@0.3.0 \
  componentize app \
  -o dist/python_p3_http.wasm
wash inspect dist/python_p3_http.wasm
```

The export list must include `wasi:http/handler@0.3.0`. Preview 2 imports
alongside that export are expected.

## Serve locally

`.wash/config.yaml`:

```yaml
build:
  command: componentize-py -d wit -w wasi:http/service@0.3.0 componentize app -o dist/python_p3_http.wasm
  component_path: dist/python_p3_http.wasm
dev:
  address: 127.0.0.1:8080
  wasm_proposals: [component-model-async]
  host_interfaces:
    - namespace: wasi
      package: http
      version: "0.3.0"
      interfaces: [handler]
      config:
        host: python-p3-http
```

```sh
wash dev
curl -H 'Host: python-p3-http' http://127.0.0.1:8080/
curl -H 'Host: python-p3-http' --data-binary 'hello Python' http://127.0.0.1:8080/echo
```

Wasmtime:

```sh
wasmtime serve -S cli=y,p3=y --addr 127.0.0.1:8080 dist/python_p3_http.wasm
```

`cli=y` is required. `p3=y` alone fails to satisfy the Preview 2 imports.

When you compare wash 2.8.0 and wash 2.10.1, componentize once, record
`sha256sum dist/python_p3_http.wasm`, and serve that file with
`build.command: "true"`. A second `componentize-py` invocation can change
the bytes even when `app.py` did not. Run `wash dev --user-config` from an
empty directory so another `.wash/config.yaml` does not replace the address.
Readiness is `listening for HTTP requests` for wash and `Serving HTTP on`
for Wasmtime.

Check identity JSON, both response headers, `/health`, empty, text, and
64 KiB echo, a chunked body, 413 over the limit, 404, and 32 overlapping
echo requests from 8 clients.

## Publish

Follow [the shared publish steps](README.md#what-the-platform-runs) with:

| | |
| --- | --- |
| Workload name | `python-p3-http` |
| Wasm file | `dist/python_p3_http.wasm` |
| `Host` header | `python-p3-http` |

Put the `wash inspect` names into `oci-config.json`. Set
`component.target` to `wasi:http/service@0.3.0`. Because the file hash can
change between builds, push the digest you just inspected and set the
workload `image` to the manifest digest ORAS fetched. Apply with the tenant
kubeconfig, wait until `workloaddeployment/python-p3-http` is Ready, and
port-forward `service/di-http`.

```sh
curl -H 'Host: python-p3-http' http://127.0.0.1:8080/
```

```sh
kubectl -n "$TENANT_NAMESPACE" delete \
  workloaddeployment/python-p3-http service/python-p3-http
```
