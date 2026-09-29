import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';

const script = join(import.meta.dir, 'sync-supported-version.ts');

function runSync(version: string, manifest: unknown) {
  const root = mkdtempSync(join(tmpdir(), 'docs-sync-'));
  const manifestPath = join(root, 'supported-versions.json');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const result = Bun.spawnSync(['bun', script, manifestPath, version], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    status: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    manifest: JSON.parse(readFileSync(manifestPath, 'utf8')),
  };
}

const latest = {
  version: 'latest',
  ref: 'main',
  path: '/',
  isCurrent: false,
};

describe('sync-supported-version', () => {
  test('replaces the same major and keeps older majors', () => {
    const result = runSync('6.1.0', [
      {
        version: 'v1.0',
        ref: 'docs/v1.0',
        path: '/v1.0/',
        release: 'v1.0.1',
        isCurrent: false,
      },
      {
        version: 'v5.3',
        ref: 'docs/v5.3',
        path: '/v5.3/',
        release: 'v5.3.7',
        isCurrent: false,
      },
      {
        version: 'v6.0',
        ref: 'docs/v6.0',
        path: '/v6.0/',
        release: 'v6.0.1',
        isCurrent: true,
      },
      latest,
    ]);

    expect(result.status).toBe(0);
    expect(result.manifest).toEqual([
      {
        version: 'v1.0',
        ref: 'docs/v1.0',
        path: '/v1.0/',
        release: 'v1.0.1',
        isCurrent: false,
      },
      {
        version: 'v5.3',
        ref: 'docs/v5.3',
        path: '/v5.3/',
        release: 'v5.3.7',
        isCurrent: false,
      },
      {
        version: 'v6.1',
        ref: 'docs/v6.1',
        path: '/v6.1/',
        release: 'v6.1.0',
        isCurrent: true,
      },
      latest,
    ]);
    expect(JSON.parse(result.stdout)).toMatchObject({ branch: 'docs/v6.1', changed: true });
  });

  test('derives the current minor from the published patch', () => {
    const result = runSync('5.2.3', [
      {
        version: 'v5.0',
        ref: 'docs/v5.0',
        path: '/v5.0/',
        isCurrent: true,
      },
      latest,
    ]);

    expect(result.status).toBe(0);
    expect(result.manifest).toEqual([
      {
        version: 'v5.2',
        ref: 'docs/v5.2',
        path: '/v5.2/',
        release: 'v5.2.3',
        isCurrent: true,
      },
      latest,
    ]);
    expect(JSON.parse(result.stdout).changed).toBe(true);
  });

  test('is idempotent for the same release', () => {
    const manifest = [
      {
        version: 'v5.2',
        ref: 'docs/v5.2',
        path: '/v5.2/',
        release: 'v5.2.3',
        isCurrent: true,
      },
      latest,
    ];
    const result = runSync('v5.2.3', manifest);

    expect(result.status).toBe(0);
    expect(result.manifest).toEqual(manifest);
    expect(JSON.parse(result.stdout).changed).toBe(false);
  });

  test('rejects prerelease versions', () => {
    const result = runSync('5.3.0-beta.1', []);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('stable semantic version');
  });
});
