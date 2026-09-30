# Go

Build a Wasm component with componentize-go that exports
`wasi:http/handler@0.3.0`, serve it with wash or Wasmtime, and publish it as
a wasmCloud WorkloadDeployment. The handler is ordinary `net/http`. The
wasmCloud Go SDK supplies the P3 world. This path does not use TinyGo and
does not use a Rust compiler target.

The component keeps WASI Preview 2 support imports beside the P3 HTTP export.
That shape passes on wash 2.8.0 (`ghcr.io/wasmcloud/wash:2.8.0`) and on wash
2.10.1. The example follows wasmCloud's
[http-p3-streaming](https://github.com/wasmCloud/go/tree/component/v0.1.6/examples/components/http-p3-streaming)
component at `go.wasmcloud.dev/component` v0.1.6.

Workload name used below: `go-p3-http`. Artifact: `dist/go_p3_http.wasm`.

## Toolchain

- Go 1.27.1 or newer.
- [componentize-go 0.4.3](https://github.com/bytecodealliance/componentize-go/releases/tag/v0.4.3)
  on `PATH`. `componentize-go --version` must print `componentize-go 0.4.3`.
- wash 2.8.0 or newer, and Wasmtime 48, for local serving.
- ORAS and kubectl for the cluster publish steps in
  [Publish](#publish).

`go.mod`:

```
module example.com/go-p3-http

go 1.27.1

require (
	go.bytecodealliance.org/pkg v0.2.4-0.20260911130647-2495ff7eca86
	go.wasmcloud.dev/component v0.1.6
)
```

Run `go mod download` after changing the require block. The bytecodealliance
module version is the one resolved with that SDK tag. Regenerate `go.sum`
with `go mod tidy` if you move either module.

The async world needs Go's `runtime.wasiOnIdle` patch. Componentize-go 0.4.3
downloads and caches a toolchain named `go1.27.1-wasi-on-idle`. It does not
replace the Go you have installed. Set `COMPONENTIZE_GO_GO` to the absolute
path of a patched `go` binary when you want to select one yourself. The patch
and the cache are described in wasmCloud's
[BUILDING.md](https://github.com/wasmCloud/go/blob/component/v0.1.6/BUILDING.md).

## Program

`main.go`. `wasihttp.HandleFunc` registers the handler. The blank import of
`go.wasmcloud.dev/component` selects the world
`wasmcloud:component-go/wasip3@0.2.0`. `main` stays empty. The component
entry is the registered handler.

```go
package main

import (
	"io"
	"net/http"

	"go.bytecodealliance.org/pkg/wasihttp"
	_ "go.wasmcloud.dev/component"
)

const about = "{\"app\":\"go-p3-http\",\"language\":\"go\",\"target\":\"wasi:http/service@0.3.0\",\"http\":\"wasi:http/handler@0.3.0\"}\n"
const maxBody = 64 * 1024

func init() { wasihttp.HandleFunc(handle) }

func handle(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("x-component-language", "go")
	w.Header().Set("x-wasi-version", "0.3.0")
	status, contentType, body := 200, "text/plain", []byte("ok\n")
	switch {
	case r.Method == "GET" && r.URL.Path == "/":
		contentType, body = "application/json", []byte(about)
	case r.Method == "GET" && r.URL.Path == "/health":
	case r.Method == "POST" && r.URL.Path == "/echo":
		defer r.Body.Close()
		data, err := io.ReadAll(io.LimitReader(r.Body, maxBody+1))
		if err != nil || len(data) > maxBody {
			status, body = 413, []byte("body rejected\n")
		} else {
			contentType, body = "application/octet-stream", data
		}
	default:
		status, body = 404, []byte("not found\n")
	}
	w.Header().Set("content-type", contentType)
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

func main() {}
```

`GET /` returns that JSON. `GET /health` returns `ok\n`. `POST /echo` copies
the body up to 64 KiB and returns 413 past that. Any other route returns 404
and `not found\n`.

## Build

```sh
mkdir -p dist
componentize-go \
  -w wasmcloud:component-go/wasip3@0.2.0 \
  build \
  -o dist/go_p3_http.wasm
wash inspect dist/go_p3_http.wasm
```

`wash inspect` must list an export of `wasi:http/handler@0.3.0`. Imports will
include both 0.2 and 0.3 WASI interfaces. That mix is expected for this SDK.

## Serve locally

`.wash/config.yaml` in the module directory:

```yaml
build:
  command: componentize-go -w wasmcloud:component-go/wasip3@0.2.0 build -o dist/go_p3_http.wasm
  component_path: dist/go_p3_http.wasm
dev:
  address: 127.0.0.1:8080
  wasm_proposals: [component-model-async]
  host_interfaces:
    - namespace: wasi
      package: http
      version: "0.3.0"
      interfaces: [handler]
      config:
        host: go-p3-http
```

```sh
wash dev
curl -H 'Host: go-p3-http' http://127.0.0.1:8080/
curl -H 'Host: go-p3-http' --data-binary 'hello Go' http://127.0.0.1:8080/echo
```

Wasmtime, after the component exists. `cli=y` covers the Preview 2 CLI
imports this builder leaves in the component:

```sh
wasmtime serve -S cli=y,p3=y --addr 127.0.0.1:8080 dist/go_p3_http.wasm
```

To compare two wash builds against one file, set `build.command` to `true`
and point `component_path` at the wasm you already inspected. Invoke wash
with `--user-config` and a copy of that yaml whose `dev.address` is a free
loopback port. Run wash from an empty directory so a project-level
`.wash/config.yaml` does not override the port. Readiness on stdout is
`listening for HTTP requests`. Wasmtime's line is `Serving HTTP on`.

Checks worth running before you publish: identity JSON and the two
`x-component-language` / `x-wasi-version` headers, `/health`, empty, text,
and 64 KiB binary echo, a chunked body, a 64 KiB plus one byte body (413),
an unknown route (404), and overlapping echo requests (32 requests from 8
clients is enough to see a concurrency failure).

## Publish

Follow [the shared publish steps](README.md#what-the-platform-runs) with:

| | |
| --- | --- |
| Workload name | `go-p3-http` |
| Wasm file | `dist/go_p3_http.wasm` |
| `Host` header | `go-p3-http` |

`wash inspect` supplies the import and export arrays in `oci-config.json`.
Set `component.target` to `wasi:http/service@0.3.0`. Push with
`--plain-http` when the registry URL is `http://`. Apply the Service and
WorkloadDeployment with the tenant kubeconfig, wait until
`workloaddeployment/go-p3-http` is Ready, and port-forward
`service/di-http` in the runtime namespace.

```sh
curl -H 'Host: go-p3-http' http://127.0.0.1:8080/
curl -H 'Host: go-p3-http' --data-binary 'hello Go' http://127.0.0.1:8080/echo
```

```sh
kubectl -n "$TENANT_NAMESPACE" delete \
  workloaddeployment/go-p3-http service/go-p3-http
```
