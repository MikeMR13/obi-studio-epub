// Archivo de proyecto .obi: un ZIP con libro.json y las imágenes. Formato documentado y abierto
// para que el autor nunca quede atrapado.

import JSZip from 'jszip';
import { existsSync } from 'node:fs';
import { rename, writeFile, copyFile } from 'node:fs/promises';
import type { Libro, Recurso } from './model.js';

export const EXTENSION_PROYECTO = '.obi';

interface RecursoGuardado extends Omit<Recurso, 'datos'> {
  archivo: string;
}

export async function serializarProyecto(libro: Libro): Promise<Uint8Array> {
  const zip = new JSZip();
  const recursos: RecursoGuardado[] = libro.recursos.map((r) => {
    const { datos: _d, ...resto } = r;
    return { ...resto, archivo: `recursos/${r.id}-${r.nombre}` };
  });
  const json = { ...libro, recursos };
  zip.file('libro.json', JSON.stringify(json, null, 1));
  for (const r of libro.recursos) zip.file(`recursos/${r.id}-${r.nombre}`, r.datos);
  zip.file('LEEME.txt', 'Proyecto de Obi Studio EPUB. libro.json contiene el texto y la estructura; recursos/ las imágenes.\n');
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function deserializarProyecto(datos: Uint8Array): Promise<Libro> {
  const zip = await JSZip.loadAsync(datos);
  const json = await zip.file('libro.json')?.async('string');
  if (!json) throw new Error('El archivo no es un proyecto de Obi Studio.');
  const crudo = JSON.parse(json) as Omit<Libro, 'recursos'> & { recursos: RecursoGuardado[] };
  if (crudo.formato !== 'obi-studio') throw new Error('El archivo no es un proyecto de Obi Studio.');
  const recursos: Recurso[] = [];
  for (const r of crudo.recursos) {
    const f = zip.file(r.archivo);
    if (!f) continue;
    const { archivo: _a, ...resto } = r;
    recursos.push({ ...resto, datos: await f.async('uint8array') });
  }
  return { ...crudo, recursos };
}

/** Guarda de forma atómica y deja una copia .bak de la versión anterior. */
export async function guardarProyecto(ruta: string, libro: Libro): Promise<void> {
  const datos = await serializarProyecto(libro);
  const temporal = `${ruta}.tmp`;
  await writeFile(temporal, datos);
  if (existsSync(ruta)) await copyFile(ruta, `${ruta}.bak`);
  await rename(temporal, ruta);
}
