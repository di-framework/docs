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
