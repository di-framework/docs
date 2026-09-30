# Language guides

How to build a `wasi:http/handler@0.3.0` component in Go, Python, Rust, Java,
or Kotlin, serve it locally, and place it on a wasmCloud tenant. Each guide
stands alone. The commands are the upstream tools (`componentize-go`,
`componentize-py`, Cargo, GraalVM Web Image, Gradle, Wasmtime, wash, ORAS,
kubectl). Nothing here depends on a wrapper script.

## What the platform runs

The tenant HTTP router is `service/di-http` in the runtime namespace
(`di-runtime-<tenant>`). A request reaches one component when `Host` is that
component's workload name.

Each component is one Wasm component that exports `wasi:http/handler@0.3.0`.
Publish it to the platform registry, then apply two objects in the tenant
namespace (`di-tenant-<tenant>`), both named for the workload:

- a ClusterIP Service on port 80
- a `WorkloadDeployment` (`runtime.wasmcloud.dev/v1alpha1`) with one replica,
  `hostSelector.hostgroup` set to the tenant hostgroup (usually
  `tenant-<tenant>`), `kubernetes.service.name` set to the workload name, one
  component image, and this host interface:

```yaml
hostInterfaces:
  - namespace: wasi
    package: http
    version: "0.3.0"
    interfaces: [handler]
    config:
      host: <workload-name>
```

`environment` on the workload spec is the tenant namespace. Use a tenant
developer kubeconfig. Do not apply these objects with the cluster
administrator kubeconfig.

The registry stores components with OCI Wasm config media type
`application/vnd.wasm.config.v0+json`. The `os` field is `wasip2` even when
the component's WIT is WASI 0.3. That string is the registry's component
category, not the language ABI. Record the real imports and exports from
`wash inspect` inside the config. Push the Wasm layer as `application/wasm`.
The workload image is the in-cluster registry host plus the manifest digest
ORAS returns, not the tag you pushed.

```sh
export KUBECONFIG=/path/to/tenant-kubeconfig
export TENANT_NAMESPACE=di-tenant-polyglot
export RUNTIME_NAMESPACE=di-runtime-polyglot
export HOSTGROUP=tenant-polyglot
export REGISTRY_PUSH=192.168.40.128:30500
export REGISTRY_PULL=di-framework-registry.wasmcloud.svc.cluster.local:5000
export NAME=my-component
export WASM=my_component.wasm
```

Replace the host, ports, tenant name, and file names with the platform you
are deploying to. An HTTP push registry needs `oras --plain-http`. Omit that
flag when the push URL is HTTPS.

```sh
DIGEST=$(sha256sum "$WASM" | awk '{print $1}')
wash inspect "$WASM" > component.wit
```

`component.wit` must contain `export wasi:http/handler@0.3.0`. Copy the
import and export names into `oci-config.json`:

```json
{
  "architecture": "wasm",
  "os": "wasip2",
  "layerDigests": ["sha256:DIGEST"],
  "component": {
    "imports": ["wasi:http/types@0.3.0"],
    "exports": ["wasi:http/handler@0.3.0"],
    "target": "wasi:http/service@0.3.0"
  }
}
```

`layerDigests` is the SHA-256 of the Wasm file, prefixed with `sha256:`.
The import list above is only a shape. Use the names `wash inspect` printed.

```sh
oras push --plain-http \
  --config oci-config.json:application/vnd.wasm.config.v0+json \
  "$REGISTRY_PUSH/$NAME:sha256-$DIGEST" \
  "$WASM:application/wasm"

MANIFEST=$(oras manifest fetch --plain-http --descriptor \
  "$REGISTRY_PUSH/$NAME:sha256-$DIGEST" | jq -r .digest)
IMAGE="$REGISTRY_PULL/$NAME@$MANIFEST"
```

`workload.yaml`:

```yaml
apiVersion: v1
kind: List
items:
  - apiVersion: v1
    kind: Service
    metadata:
      name: my-component
      namespace: di-tenant-polyglot
      labels:
        app.kubernetes.io/name: my-component
    spec:
      type: ClusterIP
      ports:
        - name: http
          port: 80
          targetPort: 80
  - apiVersion: runtime.wasmcloud.dev/v1alpha1
    kind: WorkloadDeployment
    metadata:
      name: my-component
      namespace: di-tenant-polyglot
      labels:
        app.kubernetes.io/name: my-component
    spec:
      replicas: 1
      template:
        spec:
          environment: di-tenant-polyglot
          hostSelector:
            hostgroup: tenant-polyglot
          kubernetes:
            service:
              name: my-component
          components:
            - name: my-component
              image: di-framework-registry.wasmcloud.svc.cluster.local:5000/my-component@sha256:manifest
          hostInterfaces:
            - namespace: wasi
              package: http
              version: "0.3.0"
              interfaces: [handler]
              config:
                host: my-component
```

Substitute `$NAME`, `$TENANT_NAMESPACE`, `$HOSTGROUP`, and `$IMAGE` before
applying.

```sh
kubectl apply --dry-run=server -f workload.yaml
kubectl apply -f workload.yaml
kubectl -n "$TENANT_NAMESPACE" wait "workloaddeployment/$NAME" \
  --for=condition=Ready --timeout=120s
kubectl -n "$RUNTIME_NAMESPACE" port-forward --address=127.0.0.1 \
  service/di-http 8080:80
curl -H "Host: $NAME" http://127.0.0.1:8080/
```

Remove the workload with the same tenant kubeconfig:

```sh
kubectl -n "$TENANT_NAMESPACE" delete \
  "workloaddeployment/$NAME" "service/$NAME"
```

## Local serve

wash 2.8.0 is the host image these guides were checked against
(`ghcr.io/wasmcloud/wash:2.8.0`). A `.wash/config.yaml` for `wash dev`:

```yaml
build:
  command: "true"
  component_path: dist/component.wasm
dev:
  address: 127.0.0.1:8080
  wasm_proposals: [component-model-async]
  host_interfaces:
    - namespace: wasi
      package: http
      version: "0.3.0"
      interfaces: [handler]
      config:
        host: my-component
```

Point `component_path` at the built component and set `host` to the workload
name. `build.command: "true"` skips a rebuild when the file is already there.
Replace it with the language build command when wash should compile.

Wasmtime 48 serves the same component with:

```sh
wasmtime serve -S p3=y --addr 127.0.0.1:8080 dist/component.wasm
```

Add `cli=y` when the component also imports WASI Preview 2 CLI support, which
Go and Python do. Send `Host: <workload-name>` on every request.

## Guides

| Language | Produces an HTTP component by | Host note |
| --- | --- | --- |
| [Go](go.md) | componentize-go 0.4.3 | Passes on wash 2.8.0 |
| [Python](python.md) | componentize-py 0.25.1 | Passes on wash 2.8.0. Wasmtime needs `cli=y,p3=y` |
| [Rust](rust.md) | `cargo build --target wasm32-wasip3` | Traps on wash 2.8.0 and Wasmtime 47. Passes on wash 2.10.1 and Wasmtime 48 |
| [Java](java.md) | GraalVM Web Image, then a component link | Two Wasm tables. The host needs `WASMTIME_POOLING_MAX_TABLES_PER_MODULE=4` |
| [Kotlin](kotlin.md) | Kotlin/Wasm WASI Preview 1, then a component link | One memory and one table. Runs on wash 2.8.0 as it is |

Go, Python, and Rust export the handler directly. Java and Kotlin compile a
core module that does not speak HTTP. A `wasm32-unknown-unknown` handler
imports that module as a core library named `glue` and exports
`wasi:http/handler@0.3.0`. `wit-component` 0.258 encodes the pair. The guest
call into `glue` has to stay a core call inside the one host entry. A second
component function traps once `component-model-async` is enabled.
