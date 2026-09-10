# Scheduling

`@Cron` marks a DI-managed async method to run on a schedule. The application-facing decorator is
the same in local processes and wasmCloud deployments. Locally, the container starts in-process
timers when the service is resolved. In a wasmCloud deployment the plugin disables those timers
and Kubernetes CronJobs privately invoke the method.

> These APIs landed on di-framework `main` after the
> [v5.3.0](https://github.com/di-framework/di-framework/releases/tag/v5.3.0) tag
> ([PR #419](https://github.com/di-framework/di-framework/pull/419), closing
> [di-framework#403](https://github.com/di-framework/di-framework/issues/403)).
> They are documented here on **latest** (EAP) and are not in the frozen `/v5.3/` snapshot.

There is no `di-framework cron` command. Discovery, invoker generation, and CronJob manifests are
part of `di-framework wasmcloud build` / `deploy`.

## Installation

```bash
bun add @di-framework/core
```

```typescript
import { Component, Container, Cron } from '@di-framework/core/decorators';
```

`Cron` is also exported from `@di-framework/core/cron` and `@di-framework/core`.

## Declare a scheduled method

```typescript
@Container()
export class MaintenanceService {
  @Component(DatabaseRepository)
  public db!: DatabaseRepository;

  @Cron('0 2 * * *', {
    name: 'nightly-prune',
    description: 'Purges expired database session records nightly',
    allowConcurrent: false,
    timeoutMs: 10000,
  })
  public async purgeExpiredSessions(): Promise<{ pruned: number }> {
    const summary = await this.db.deleteExpiredRecords();
    return { pruned: summary.deletedCount };
  }

  @Cron(30000, { name: 'health-heartbeat' })
  public async heartbeat(): Promise<void> {
    await this.db.ping();
  }
}
```

The [scheduled-worker example](https://github.com/di-framework/di-framework/tree/main/examples/scheduled-worker)
runs two jobs (`nightly-prune` at 02:00 and `partition-rebalance` every 15 minutes) with
`"ingress": false` in `di-framework.config.json`.

```bash
bun test examples/scheduled-worker/tests/
```

## Schedule expressions

`@Cron(schedule, options?)` accepts:

- A **5-field cron string**: `minute hour dayOfMonth month dayOfWeek`
- A **numeric interval in milliseconds**

Supported field syntax: `*`, `*/N`, `N,M`, `N-M`, and exact `N`. Anything other than five
space-separated fields throws:

```text
Invalid cron expression "...": expected 5 fields (minute hour dayOfMonth month dayOfWeek)
```

Not supported: seconds / 6–7 fields, `@hourly` / `@daily`, `?`, month or day names (`MON`),
`CRON_TZ=…`, Sunday-as-7.

There is **no `timeZone` option**. In-process matching uses the process local `Date` fields, not
UTC and not an IANA zone. Generated Kubernetes CronJobs use the cluster controller timezone.

### Options

| Field | Default | Behavior |
| --- | --- | --- |
| `name` | `` `${className}.${methodName}` `` | Stable job id used by `invokeCronJob` and wasmCloud CronJobs |
| `allowConcurrent` | `false` | Overlapping `invokeCronJob` calls skip (or throw with `throwOnError`) |
| `description` | — | Human-readable only; unused at runtime |
| `timeoutMs` | — | Max wait on **`invokeCronJob`**. Does not cancel the running method |

Jobs register when the owning service is **resolved**. `allowConcurrent` and `timeoutMs` apply to
the invoke path, not to in-process `setInterval` / `setTimeout` timers.

### Numeric intervals in deployment

Locally, `@Cron(30000)` is a 30-second `setInterval`. For external schedulers the expression is
normalized to whole minutes:

```text
mins = max(1, round(schedule / 60000))
1 minute → * * * * *
N minutes → */N * * * *
```

Sub-minute intervals are rounded, not rejected. `@Cron(30000)` becomes every minute on wasmCloud.

## In-process versus external mode

`CronMode` is `'in-process' | 'external'`.

- Default: `process.env.DI_CRON_MODE === 'external' ? 'external' : 'in-process'`
- `container.setCronMode(mode)` must run **before** `resolve`, or timers already started
- `container.getCronMode()` / `container.isExternalCron()`

**In-process:** numeric schedules use `setInterval`; cron strings chain `setTimeout` (next fire is
at least one minute after now). Errors log `[Cron] Class.method threw` and the schedule continues.
Multiple processes or replicas each fire independently.

**External:** the job is still registered, but no in-component timers start. wasmCloud sets
`DI_CRON_MODE=external` on the workload whenever jobs are discovered, and the generated invoker
calls `container.setCronMode('external')` before `invokeCronJob`.

Exactly-once execution is not promised. External mode is “Kubernetes fires, the component runs
the method if reachable,” plus skip-on-overlap when `allowConcurrent` is false.

## Manual invocation and tests

There is no controllable cron clock. Tests call `invokeCronJob` instead of waiting for timers.
`CronRuntime` is a process singleton; tests should call `CronRuntime.reset()` in
`beforeEach` / `afterEach`.

```typescript
const result = await container.invokeCronJob<MaintenanceReport>('nightly-prune');
console.log(result.success, result.durationMs, result.status);
```

`CronExecutionResult` fields: `jobId`, `status` (`success` | `failure` | `skipped`), `success`,
`startedAt`, `completedAt`, `durationMs`, optional `result` / `error` / `reason`.

- Default: failures return `status: 'failure'` (no throw)
- `{ throwOnError: true }` throws `CronExecutionError` or `CronConcurrencyError`
- Unknown id always throws `CronJobNotFoundError` (lists available ids)
- Concurrent invoke with `allowConcurrent: false` returns `status: 'skipped'`

The scheduled method is always called with **zero arguments**. `CronInvocationContext`
(`timestamp`, `source`, `metadata`) is unused by the runtime.

Also available: `container.getCronJobs()`, `container.stopCronJobs()`,
`CronRuntime.current.getStatusReports()`. `container.clear()` stops timers and drops
registrations (the tested reload path). `ApplicationContext.stop()` calls `stopCronJobs()`.

There is no runtime API to change a schedule. Edit `@Cron`, rebuild, and redeploy.

## Scheduled-only applications

```json
{
  "name": "scheduled-worker",
  "entry": "src/index.ts",
  "ingress": false
}
```

`http: false` is treated the same as `ingress: false`.

When jobs exist, the wasmCloud plugin still exports `wasi:http/handler@0.3.0` and still emits a
**ClusterIP Service** on port 80 so CronJobs can POST to `/_di/cron/{jobId}/invoke`. Public
ingress (HTTP URL/host in the deploy result) is omitted. The application `fetch` handler is not
required for scheduling; control routes are intercepted before the app handler.

The default export must expose the DI container:

```typescript
export { container };
// or
export default { container };
```

## wasmCloud CronJobs

`di-framework wasmcloud build` discovers `@Cron(...)` calls with a **string or numeric literal**
under `src/` (otherwise the project root). Dynamic schedules are skipped. Duplicate `jobId`
values keep the first file.

Deploy applies one Kubernetes `batch/v1` CronJob per job:

- Name `{witName}-{kebab-job-id}`
- `concurrencyPolicy: Forbid` or `Allow` from `allowConcurrent`
- `curl` POST to `http://{name}.{ns}.svc.cluster.local/_di/cron/{jobId}/invoke`
- Default invoke timeout 30s when `timeoutMs` is omitted
- Workload `spec.replicas: 1`

`di-framework wasmcloud destroy` deletes `WorkloadDeployment,service,cronjob` labeled
`app.kubernetes.io/name=<witName>`. Redeploy `kubectl apply`s the regenerated manifest; jobs
removed from source are not pruned except via destroy.

Control HTTP authorizes with `DI_CONTROL_TOKEN` / `DI_CONTROL_IDENTITIES`. If those are unset,
anonymous invoke is allowed. Provision a control token before exposing the ClusterIP beyond a
trusted cluster.

`di-framework wasmcloud dev` serves locally and does **not** generate Kubernetes CronJobs.
`doctor` does not check cron configuration.

## Overlap, retries, missed runs

| Concern | Implemented behavior |
| --- | --- |
| Application-wide vs per-replica | Generated workloads use `replicas: 1`. External CronJobs are cluster-wide. In-process mode is per resolved instance. |
| Overlap | `allowConcurrent: false` skips a second `invokeCronJob`. In-process timers ignore this flag. |
| Timeouts | `timeoutMs` races the invoke; the running method is not cancelled. |
| Retries | No application-level retry option. Kubernetes Job `restartPolicy: OnFailure` restarts the curl pod. |
| Missed runs | No catch-up. In-process next fire is computed from **now**. |
| Restart | After a skipped overlap, a later invoke succeeds. |

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Job never fires locally | Service not resolved; or `DI_CRON_MODE=external` |
| Duplicate fires in deployment | In-process timers still running; confirm `DI_CRON_MODE=external` |
| `CronJobNotFoundError` | `name` / `` Class.method `` mismatch; or the service was never resolved |
| Invalid cron expression | Not five fields |
| wasmCloud skips a job | Non-literal `@Cron` argument |
| HTTP `ok: true` but job failed | Control HTTP reports that invoke did not throw; inspect `CronExecutionResult.success` |

## Next steps

- [Advanced Usage](advanced-usage.md) - Container patterns used by scheduled services
- [Testing](testing.md) - Isolated containers and `CronRuntime.reset()`
- [wasmCloud](wasmcloud.md) - Build and deploy the generated CronJobs
- [CLI](cli.md) - Canonical command tree (cron is not a built-in group)
