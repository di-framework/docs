# DI Framework documentation

This repository owns the source, versioned builds, search Worker, and deployment for [docs.di-framework.dev](https://docs.di-framework.dev).

## Automated version model

- `main` publishes the rolling `latest` documentation at `/` and `/latest/`.
- The latest stable `@di-framework/core` minor publishes at `/vMAJOR.MINOR/` from an automatically managed `docs/vMAJOR.MINOR` snapshot branch.
- Every deployment checks npm for the current stable framework version. An hourly schedule repairs missed cross-repository release notifications without human intervention.
- A new release updates `supported-versions.json` and snapshots the newest docs commit that existed when the framework tag was created. This keeps unreleased documentation out of the stable version.
- The version selector is generated only after every listed version builds successfully. Do not edit `supported-versions.json` or its snapshot branch by hand.

`latest` appears as EAP in the selector; the npm-derived minor is marked as the current stable version.

## Local checks

```sh
bun install --frozen-lockfile
bun run check
```

The Writerside site can be previewed from the `Writerside` project. Search lives in `search/`; see [search/README.md](search/README.md) for its API and Cloudflare bindings.

## Deployment and rollback

`deploy.yml` validates the Worker contract, builds every entry in `supported-versions.json`, reindexes each version, publishes one Pages artifact, and runs production smoke tests. This ordering prevents the frontend from publishing a search route the Worker does not support.

Worker source changes require `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets. The token should be limited to this Worker, Workers AI, Vectorize, and KV. Reindexing uses GitHub OIDC and does not expose Cloudflare credentials.

Rollback by reverting the offending `main` commit. Correct stable documentation on `main`; the next framework patch release snapshots that correction automatically. Pages deployments are also retained in the GitHub environment deployment history.

## Adding a framework release

The framework repository may send a `framework-release` dispatch for an immediate update. The scheduled synchronizer is the fallback and uses the public npm package plus the corresponding GitHub tag, so a missing dispatch credential cannot leave the selector stale.
