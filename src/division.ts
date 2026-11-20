// División silábica en español con Hyphenopoly (patrones TeX): inserta guiones blandos (U+00AD) para la impresión.
// Así la división es igual en cualquier sistema, sin depender de los diccionarios del navegador.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import hyphenopoly from 'hyphenopoly';
import type { Inline, Libro } from './model.js';
import { rutaRecurso } from './recursos.js';

type Divisor = (texto: string) => string;
let divisor: Promise<Divisor | null> | undefined;

export function obtenerDivisor(): Promise<Divisor | null> {
  if (divisor) return divisor;
  const carpeta = rutaRecurso('hyphenopoly');
  if (!carpeta) return (divisor = Promise.resolve(null));
  const h = (hyphenopoly as any).config({
    require: ['es'],
    hyphen: '­',
    minWordLength: 6,
    leftmin: 2,
    rightmin: 3,
    loader: async (archivo: string) => readFile(join(carpeta, archivo)),
  });
  divisor = h.get('es').then((f: Divisor) => f).catch(() => null);
  return divisor!;
}

function dividirInlines(lista: Inline[], f: Divisor, idiomaLibro: string): void {
  for (const i of lista) {
    if (i.tipo !== 'texto') continue;
    if (i.idioma && !i.idioma.startsWith('es')) continue;
    if (!idiomaLibro.startsWith('es') && !i.idioma) continue;
    // No se dividen direcciones web ni palabras con mayúsculas intermedias (siglas, nombres en clave).
    i.texto = i.texto.replace(/[\p{L}\p{M}]{6,}/gu, (palabra) => (/\p{Lu}.*\p{Lu}/u.test(palabra) ? palabra : f(palabra)));
  }
}

/** Copia del libro con guiones blandos en el texto español. */
export async function dividirLibro(libro: Libro): Promise<Libro> {
  const f = await obtenerDivisor();
  const copia: Libro = { ...libro, secciones: structuredClone(libro.secciones) };
  if (!f) return copia;
  const idioma = libro.metadatos.idioma || 'es';
  for (const s of copia.secciones) {
    for (const b of s.bloques) {
      if (b.tipo === 'parrafo') dividirInlines(b.contenido, f, idioma);
      if (b.tipo === 'lista') b.elementos.forEach((e) => dividirInlines(e, f, idioma));
    }
    for (const n of s.notas) dividirInlines(n.contenido, f, idioma);
  }
  return copia;
}
