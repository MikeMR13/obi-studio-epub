// Compila la interfaz (Vite) y el proceso principal de Electron (esbuild) en dist/.

import { build as vite } from 'vite';
import { build as esbuild } from 'esbuild';
import { rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await vite({ configFile: 'vite.config.ts', logLevel: 'warn' });

const comun = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: false,
  // Los paquetes CommonJS empaquetados necesitan require() en un módulo ES.
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; import { fileURLToPath as __fu } from 'node:url'; import { dirname as __dn } from 'node:path'; const require = __cr(import.meta.url); const __filename = __fu(import.meta.url); const __dirname = __dn(__filename);",
  },
  // playwright-core solo se usa fuera de Electron (línea de comandos), desde node_modules.
  external: ['electron', 'vite', 'playwright-core'],
  logLevel: 'warning',
};
await esbuild({ ...comun, entryPoints: ['app/main.ts'], outfile: 'dist/main.mjs' });
await esbuild({ ...comun, entryPoints: ['src/cli.ts'], outfile: 'dist/cli.mjs' });
console.log('Compilado en dist/');
