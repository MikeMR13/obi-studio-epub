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

console.log('Recursos listos.');
