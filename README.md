# DI Framework documentation

This repository owns the source, versioned builds, search Worker, and deployment for [docs.di-framework.dev](https://docs.di-framework.dev).

## Version model

- `main` publishes `latest` at `/` and `/latest/`.
- `docs/vMAJOR.MINOR` publishes a maintained snapshot at `/vMAJOR.MINOR/`.
- `supported-versions.json` is the deployment source of truth. The version selector is generated only from entries that were built successfully.

To correct an older version, branch from its `docs/vMAJOR.MINOR` branch, open a pull request targeting that branch, and merge it. Do not rewrite a framework tag or release asset.

## Local checks

```sh
bun install --frozen-lockfile
bun run check
```

The Writerside site can be previewed from the `Writerside` project. Search lives in `search/`; see [search/README.md](search/README.md) for its API and Cloudflare bindings.

## Deployment and rollback

`deploy.yml` validates the Worker contract, builds every entry in `supported-versions.json`, reindexes each version, publishes one Pages artifact, and runs production smoke tests. This ordering prevents the frontend from publishing a search route the Worker does not support.

Worker source changes require `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets. The token should be limited to this Worker, Workers AI, Vectorize, and KV. Reindexing uses GitHub OIDC and does not expose Cloudflare credentials.

Rollback by reverting the offending commit. For version-specific content, revert on the corresponding docs branch. Pages deployments are also retained in the GitHub environment deployment history.

## Adding a framework release

The framework repository sends a `framework-release` dispatch containing the tag. Create the corresponding maintenance branch when a new minor is introduced, add it to `supported-versions.json`, and merge that change before removing an older supported branch.
