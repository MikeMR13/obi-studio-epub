// Versiones con nombre: instantáneas del libro guardadas dentro del proyecto .obi.
// Las imágenes se guardan una sola vez, por huella; una versión puede restaurar imágenes ya borradas.

import { createHash } from 'node:crypto';
import type { Libro, Recurso, Version } from './model.js';
import { TIPOS_SECCION, contarPalabras, nuevoId } from './model.js';

const nombreSeccion = (s: { titulo: string; tipo: string }) => s.titulo || TIPOS_SECCION.find((t) => t.id === s.tipo)?.nombre || s.tipo;

export class ErrorVersion extends Error {}

export function huella(datos: Uint8Array): string {
  return createHash('sha256').update(datos).digest('hex').slice(0, 20);
}

type RecursoVersion = Omit<Recurso, 'datos'> & { huella: string };

/** Datos de una versión sin la instantánea (para listas). */
export type ResumenVersion = Omit<Version, 'libro'>;

export function resumenVersiones(libro: Libro): ResumenVersion[] {
  return (libro.versiones ?? []).map(({ libro: _l, ...r }) => r);
}

export function palabrasLibro(libro: Libro): number {
  return libro.secciones.reduce((n, s) => n + contarPalabras(s), 0);
}

export function crearVersion(libro: Libro, nombre: string): ResumenVersion {
  const limpio = nombre.trim().slice(0, 120);
  if (!limpio) throw new ErrorVersion('Ponle un nombre a la versión.');
  const pool = libro.recursosVersiones ?? [];
  const recursos: RecursoVersion[] = libro.recursos.map(({ datos, ...r }) => {
    const h = huella(datos);
    if (!pool.some((x) => x.huella === h)) pool.push({ ...r, datos, huella: h });
    return { ...r, huella: h };
  });
  // Las fuentes propias no se versionan (son binarios grandes): se quedan las actuales al restaurar.
  const { versiones: _v, recursosVersiones: _p, fuentesPropias: _f, ...resto } = libro;
  const v: Version = {
    id: nuevoId('v'),
    nombre: limpio,
    fecha: new Date().toISOString(),
    palabras: palabrasLibro(libro),
    libro: JSON.stringify({ ...resto, recursos }),
  };
  libro.versiones = [...(libro.versiones ?? []), v];
  libro.recursosVersiones = pool;
  return resumenVersiones({ ...libro, versiones: [v] } as Libro)[0];
}

function buscarVersion(libro: Libro, id: string): Version {
  const v = libro.versiones?.find((x) => x.id === id);
  if (!v) throw new ErrorVersion('Esa versión no existe.');
  return v;
}

function instantanea(v: Version): Omit<Libro, 'recursos'> & { recursos: RecursoVersion[] } {
  return JSON.parse(v.libro);
}

/** Quita del almacén las imágenes que ya no usa ninguna versión. */
function podar(libro: Libro) {
  const usadas = new Set<string>();
  for (const v of libro.versiones ?? []) for (const r of instantanea(v).recursos) usadas.add(r.huella);
  libro.recursosVersiones = (libro.recursosVersiones ?? []).filter((r) => usadas.has(r.huella));
  if (!libro.recursosVersiones.length) delete libro.recursosVersiones;
  if (!libro.versiones?.length) delete libro.versiones;
}

export function eliminarVersion(libro: Libro, id: string) {
  buscarVersion(libro, id);
  libro.versiones = libro.versiones!.filter((v) => v.id !== id);
  podar(libro);
}

/**
 * Devuelve el libro de la versión. Antes guarda el estado actual como versión «Antes de restaurar…»
 * para poder volver atrás. Conserva todas las versiones.
 */
export function restaurarVersion(libro: Libro, id: string): { libro: Libro; avisos: string[] } {
  const v = buscarVersion(libro, id);
  crearVersion(libro, `Antes de restaurar «${v.nombre}»`);
  const datos = instantanea(v);
  const avisos: string[] = [];
  const disponibles = new Map<string, Recurso>();
  for (const r of libro.recursos) disponibles.set(huella(r.datos), r);
  for (const r of libro.recursosVersiones ?? []) if (!disponibles.has(r.huella)) disponibles.set(r.huella, r);
  const recursos: Recurso[] = [];
  for (const { huella: h, ...meta } of datos.recursos) {
    const r = disponibles.get(h);
    if (r) recursos.push({ ...meta, datos: r.datos });
    else avisos.push(`No se encontró la imagen «${meta.nombre}».`);
  }
  return {
    libro: { ...datos, recursos, versiones: libro.versiones, recursosVersiones: libro.recursosVersiones, ...(libro.fuentesPropias ? { fuentesPropias: libro.fuentesPropias } : {}) },
    avisos,
  };
}

export interface DiferenciaSeccion {
  titulo: string;
  estado: 'igual' | 'cambiada' | 'nueva' | 'borrada';
  palabrasVersion: number;
  palabrasAhora: number;
}

/** Compara la versión con el libro actual, sección por sección. */
export function compararVersion(libro: Libro, id: string): DiferenciaSeccion[] {
  const antes = instantanea(buscarVersion(libro, id));
  const salida: DiferenciaSeccion[] = [];
  const contenido = (s: Libro['secciones'][number]) => JSON.stringify([s.titulo, s.bloques, s.notas]);
  for (const s of libro.secciones) {
    const v = antes.secciones.find((x) => x.id === s.id);
    salida.push({
      titulo: nombreSeccion(s),
      estado: !v ? 'nueva' : contenido(v) === contenido(s) ? 'igual' : 'cambiada',
      palabrasVersion: v ? contarPalabras(v) : 0,
      palabrasAhora: contarPalabras(s),
    });
  }
  for (const v of antes.secciones)
    if (!libro.secciones.some((s) => s.id === v.id)) salida.push({ titulo: nombreSeccion(v), estado: 'borrada', palabrasVersion: contarPalabras(v), palabrasAhora: 0 });
  return salida;
}
