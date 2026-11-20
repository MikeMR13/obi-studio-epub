// Archivo de proyecto .obi: un ZIP con libro.json y las imágenes. Formato documentado y abierto
// para que el autor nunca quede atrapado.

import JSZip from 'jszip';
import { existsSync } from 'node:fs';
import { rename, writeFile, copyFile } from 'node:fs/promises';
import type { CaraFuentePropia, FuentePropia, Libro, Recurso } from './model.js';
import { huella } from './versiones.js';

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
  // Imágenes de las versiones: se guardan una sola vez; si coinciden con una actual, se reutiliza su archivo.
  const actuales = new Map<string, string>();
  if (libro.recursosVersiones?.length) for (const r of libro.recursos) actuales.set(huella(r.datos), `recursos/${r.id}-${r.nombre}`);
  const deVersiones = (libro.recursosVersiones ?? []).map(({ datos, ...r }) => {
    const archivo = actuales.get(r.huella) ?? `recursos-versiones/${r.huella}-${r.nombre}`;
    if (!actuales.has(r.huella)) zip.file(archivo, datos);
    return { ...r, archivo };
  });
  const fuentesPropias = libro.fuentesPropias?.map((f) => ({
    ...f,
    caras: f.caras.map(({ datos, ...c }) => {
      const archivo = `fuentes/${f.id}-${c.peso}-${c.estilo}.${c.formato}`;
      zip.file(archivo, datos);
      return { ...c, archivo };
    }),
  }));
  const json = { ...libro, recursos, ...(deVersiones.length ? { recursosVersiones: deVersiones } : {}), ...(fuentesPropias ? { fuentesPropias } : {}) };
  zip.file('libro.json', JSON.stringify(json, null, 1));
  for (const r of libro.recursos) zip.file(`recursos/${r.id}-${r.nombre}`, r.datos);
  zip.file('LEEME.txt', 'Proyecto de Obi Studio EPUB. libro.json contiene el texto y la estructura; recursos/ las imágenes y fuentes/ las fuentes propias.\n');
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function deserializarProyecto(datos: Uint8Array): Promise<Libro> {
  const zip = await JSZip.loadAsync(datos);
  const json = await zip.file('libro.json')?.async('string');
  if (!json) throw new Error('El archivo no es un proyecto de Obi Studio.');
  const crudo = JSON.parse(json) as Omit<Libro, 'recursos' | 'recursosVersiones'> & {
    recursos: RecursoGuardado[];
    recursosVersiones?: (RecursoGuardado & { huella: string })[];
  };
  if (crudo.formato !== 'obi-studio') throw new Error('El archivo no es un proyecto de Obi Studio.');
  const recursos: Recurso[] = [];
  for (const r of crudo.recursos) {
    const f = zip.file(r.archivo);
    if (!f) continue;
    const { archivo: _a, ...resto } = r;
    recursos.push({ ...resto, datos: await f.async('uint8array') });
  }
  const recursosVersiones: NonNullable<Libro['recursosVersiones']> = [];
  for (const r of crudo.recursosVersiones ?? []) {
    const f = zip.file(r.archivo);
    if (!f) continue;
    const { archivo: _a, ...resto } = r;
    recursosVersiones.push({ ...resto, datos: await f.async('uint8array') });
  }
  const fuentesPropias: NonNullable<Libro['fuentesPropias']> = [];
  for (const f of (crudo.fuentesPropias ?? []) as unknown as (Omit<FuentePropia, 'caras'> & { caras: (Omit<CaraFuentePropia, 'datos'> & { archivo: string })[] })[]) {
    const caras: CaraFuentePropia[] = [];
    for (const { archivo, ...c } of f.caras) {
      const z = zip.file(archivo);
      if (z) caras.push({ ...c, datos: await z.async('uint8array') });
    }
    if (caras.length) fuentesPropias.push({ ...f, caras });
  }
  const { recursosVersiones: _rv, fuentesPropias: _fp, ...base } = crudo;
  return { ...base, recursos, ...(recursosVersiones.length ? { recursosVersiones } : {}), ...(fuentesPropias.length ? { fuentesPropias } : {}) };
}

/** Guarda de forma atómica y deja una copia .bak de la versión anterior. */
export async function guardarProyecto(ruta: string, libro: Libro): Promise<void> {
  const datos = await serializarProyecto(libro);
  const temporal = `${ruta}.tmp`;
  await writeFile(temporal, datos);
  if (existsSync(ruta)) await copyFile(ruta, `${ruta}.bak`);
  await rename(temporal, ruta);
}
