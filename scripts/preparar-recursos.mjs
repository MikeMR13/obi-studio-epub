// Descarga EPUBCheck y crea un Java mínimo (jlink) en recursos/, para que el instalador no necesite nada más.
// Requiere Java 21 con jlink en el sistema donde se construye.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import JSZip from 'jszip';

const VERSION_EPUBCHECK = '5.4.0';
const MODULOS = ['java.base', 'java.xml', 'java.logging', 'java.naming', 'java.desktop', 'java.sql', 'java.management', 'jdk.zipfs'];

await mkdir('recursos', { recursive: true });

if (!existsSync('recursos/epubcheck/epubcheck.jar')) {
  console.log(`Descargando EPUBCheck ${VERSION_EPUBCHECK}…`);
  const r = await fetch(`https://github.com/w3c/epubcheck/releases/download/v${VERSION_EPUBCHECK}/epubcheck-${VERSION_EPUBCHECK}.zip`);
  if (!r.ok) throw new Error(`No se pudo descargar EPUBCheck: ${r.status}`);
  const zip = await JSZip.loadAsync(new Uint8Array(await r.arrayBuffer()));
  const prefijo = `epubcheck-${VERSION_EPUBCHECK}/`;
  for (const [ruta, f] of Object.entries(zip.files)) {
    if (f.dir || !ruta.startsWith(prefijo)) continue;
    const destino = join('recursos/epubcheck', ruta.slice(prefijo.length));
    await mkdir(join(destino, '..'), { recursive: true });
    await writeFile(destino, await f.async('uint8array'));
  }
} else console.log('EPUBCheck ya está en recursos/.');

if (!existsSync('recursos/java')) {
  console.log('Creando Java mínimo con jlink…');
  const jlink = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'jlink.exe' : 'jlink') : 'jlink';
  await rm('recursos/java.tmp', { recursive: true, force: true });
  execFileSync(jlink, ['--add-modules', MODULOS.join(','), '--strip-debug', '--no-man-pages', '--no-header-files', '--compress=zip-9', '--output', 'recursos/java.tmp'], { stdio: 'inherit' });
  await rename('recursos/java.tmp', 'recursos/java');
} else console.log('Java mínimo ya está en recursos/.');

// Visor de Vivliostyle (compaginación), fuentes OFL para imprimir y patrones de división silábica.
const { cp } = await import('node:fs/promises');
await rm('recursos/vivliostyle', { recursive: true, force: true });
await cp('node_modules/@vivliostyle/viewer/lib', 'recursos/vivliostyle', { recursive: true });
await mkdir('recursos/fuentes', { recursive: true });
for (const familia of ['literata', 'noto-sans', 'eb-garamond', 'cinzel']) {
  for (const sub of ['latin', 'latin-ext']) {
    for (const v of ['400-normal', '400-italic', '700-normal', '700-italic']) {
      const archivo = `${familia}-${sub}-${v}.woff2`;
      if (existsSync(`node_modules/@fontsource/${familia}/files/${archivo}`)) await cp(`node_modules/@fontsource/${familia}/files/${archivo}`, `recursos/fuentes/${archivo}`);
    }
  }
  await cp(`node_modules/@fontsource/${familia}/LICENSE`, `recursos/fuentes/LICENCIA-${familia}-OFL.txt`).catch(() => undefined);
}
// axe-core para el informe de accesibilidad (licencia MPL-2.0).
await mkdir('recursos/axe', { recursive: true });
await cp('node_modules/axe-core/axe.min.js', 'recursos/axe/axe.min.js');
await cp('node_modules/axe-core/locales/es.json', 'recursos/axe/es.json');
await cp('node_modules/axe-core/LICENSE', 'recursos/axe/LICENCIA-axe-core-MPL-2.0.txt').catch(() => undefined);

await mkdir('recursos/hyphenopoly', { recursive: true });
await cp('node_modules/hyphenopoly/patterns/es.wasm', 'recursos/hyphenopoly/es.wasm');
console.log('Recursos listos.');
