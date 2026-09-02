/**
 * Build data/openapi.json from controller route definitions.
 * Run from package root: `bun run openapi`
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { generateOpenAPI } from '@di-framework/http';
import { bindEnv, bootstrap } from '../src/bootstrap';

bindEnv({} as any);
await bootstrap();

const doc = generateOpenAPI({
  title: 'di-framework Documentation Search API',
  version: '1.0.0',
  description: 'Writerside docs search on Cloudflare Workers',
});

const outDir = join(import.meta.dir, '../data');
mkdirSync(outDir, { recursive: true });

const outFile = join(outDir, 'openapi.json');
writeFileSync(outFile, `${JSON.stringify(doc, null, 2)}\n`);
console.log(`Wrote OpenAPI 3.1.0 document → ${outFile}`);
