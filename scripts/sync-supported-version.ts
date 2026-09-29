import { readFileSync, writeFileSync } from 'node:fs';

type VersionEntry = {
  version: string;
  ref?: string;
  path?: string;
  release?: string;
  isCurrent?: boolean;
};

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonical(nested)]),
    );
  }
  return value;
}

function minorParts(version: string): [number, number] | undefined {
  const match = /^v(\d+)\.(\d+)$/.exec(version);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2])];
}

function releaseParts(release: string): [number, number, number] | undefined {
  const match = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(release);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareRelease(left: [number, number, number], right: [number, number, number]): number {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

const manifestPath = process.argv[2];
const rawVersion = process.argv[3];
if (!manifestPath || rawVersion == null) {
  fail('usage: sync-supported-version.ts <manifest> <version>');
}

const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(rawVersion);
if (!match) {
  fail(`framework version must be a stable semantic version: ${JSON.stringify(rawVersion)}`);
}

const [, major, minor, patch] = match;
const tag = `v${major}.${minor}.${patch}`;
const docsVersion = `v${major}.${minor}`;
const branch = `docs/${docsVersion}`;
const syncedMajor = Number(major);

const versions = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown;
if (!Array.isArray(versions)) fail('supported versions must be a list');

const entries = versions as VersionEntry[];
const latest = entries.find((item) => item.version === 'latest');
if (!latest) fail('supported versions must contain a latest entry');

const existing = entries.find(
  (item) => item.version !== 'latest' && minorParts(item.version)?.[0] === syncedMajor,
);
if (existing?.release) {
  const recorded = releaseParts(existing.release);
  if (!recorded) {
    fail(
      `existing snapshot release is not a stable semantic version: ${JSON.stringify(existing.release)}`,
    );
  }
  const incoming: [number, number, number] = [syncedMajor, Number(minor), Number(patch)];
  if (compareRelease(incoming, recorded) < 0) {
    fail(`refusing to move the v${major} snapshot backward from ${existing.release} to ${tag}`);
  }
}

const kept = entries
  .filter((item) => item.version !== 'latest')
  .filter((item) => minorParts(item.version)?.[0] !== syncedMajor)
  .map((item) => ({ ...item, isCurrent: false }))
  .sort((left, right) => {
    const a = minorParts(left.version) ?? [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
    const b = minorParts(right.version) ?? [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
    return a[0] - b[0] || a[1] - b[1];
  });

const updated: VersionEntry[] = [
  ...kept,
  {
    version: docsVersion,
    ref: branch,
    path: `/${docsVersion}/`,
    release: tag,
    isCurrent: true,
  },
  {
    ...latest,
    version: 'latest',
    ref: 'main',
    path: '/',
    isCurrent: false,
  },
];

const changed = JSON.stringify(canonical(updated)) !== JSON.stringify(canonical(versions));
if (changed) {
  writeFileSync(manifestPath, `${JSON.stringify(updated, null, 2)}\n`);
}

console.log(JSON.stringify({ version: tag, docsVersion, branch, changed }));
