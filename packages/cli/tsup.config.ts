import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsup';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8'));

export default defineConfig({
  entry: ['src/cli.tsx'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: false,
  splitting: false,
  external: ['update-notifier'],
  // Publish the patched framework; npm consumers do not apply workspace patches.
  noExternal: ['incur'],
  banner: {
    js: [
      '#!/usr/bin/env node',
      'import { createRequire as __linkCliCreateRequire } from "node:module";',
      'var require = __linkCliCreateRequire(import.meta.url);',
    ].join('\n'),
  },
  define: {
    __CLI_VERSION__: JSON.stringify(pkg.version),
    __CLI_NAME__: JSON.stringify(pkg.name),
  },
});
