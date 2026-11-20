// Empaqueta una carpeta con manifiesto.json y principal.js en un .obiplugin.
// Uso: node scripts/empaquetar-plugin.mjs <carpeta> [salida.obiplugin]

import { readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import JSZip from 'jszip';

const [carpeta, salida] = process.argv.slice(2);
if (!carpeta) {
  console.log('Uso: node scripts/empaquetar-plugin.mjs <carpeta> [salida.obiplugin]');
  process.exit(2);
}
const manifiesto = JSON.parse(await readFile(join(carpeta, 'manifiesto.json'), 'utf8'));
const zip = new JSZip();
zip.file('manifiesto.json', JSON.stringify(manifiesto, null, 2));
zip.file('principal.js', await readFile(join(carpeta, 'principal.js'), 'utf8'));
const destino = salida ?? `${manifiesto.id ?? basename(carpeta)}.obiplugin`;
await writeFile(destino, await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));
console.log(`Plugin escrito en ${destino}`);
