// Genera un catálogo de plugins: empaqueta cada carpeta (manifiesto.json + principal.js) y escribe
// catalogo.json con la huella SHA-256 de cada paquete. La carpeta de salida se puede publicar tal cual
// (GitHub Pages, un servidor web…) y añadir en Obi Studio por su URL.
// Uso: node scripts/catalogo-plugins.mjs <carpeta-de-plugins> <salida> [nombre del catálogo]

import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import JSZip from 'jszip';

export async function generarCatalogo(origen, salida, nombre = 'Catálogo') {
  await mkdir(salida, { recursive: true });
  const plugins = [];
  for (const carpeta of (await readdir(origen, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    const manifiesto = JSON.parse(await readFile(join(origen, carpeta, 'manifiesto.json'), 'utf8'));
    const zip = new JSZip();
    zip.file('manifiesto.json', JSON.stringify(manifiesto, null, 2));
    zip.file('principal.js', await readFile(join(origen, carpeta, 'principal.js'), 'utf8'));
    // Fecha fija: el mismo código da el mismo paquete y la misma huella.
    const datos = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', date: new Date('2026-01-01T00:00:00Z') });
    const archivo = `${manifiesto.id}-${manifiesto.version}.obiplugin`;
    await writeFile(join(salida, archivo), datos);
    const { id, nombre: n, version, autor, descripcion, tipos, permisos } = manifiesto;
    plugins.push({ id, nombre: n, version, autor, descripcion, tipos, permisos, archivo, sha256: createHash('sha256').update(datos).digest('hex') });
  }
  await writeFile(join(salida, 'catalogo.json'), JSON.stringify({ formato: 'obi-catalogo', version: 1, nombre, plugins }, null, 2));
  return plugins.length;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [origen, salida, nombre] = process.argv.slice(2);
  if (!origen || !salida) {
    console.log('Uso: node scripts/catalogo-plugins.mjs <carpeta-de-plugins> <salida> [nombre]');
    process.exit(2);
  }
  console.log(`${await generarCatalogo(origen, salida, nombre)} plugins en ${salida}/catalogo.json`);
}
