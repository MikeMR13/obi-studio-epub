// Control de cambios: las correcciones se guardan como cambios propuestos por grupos de párrafos
// y se aceptan o rechazan uno a uno.

import type { Bloque, CambioPropuesto, Inline, Nota, Seccion } from './model.js';
import { normalizarInlines, nuevoId, textoPlano } from './model.js';
export { textoBloques } from './diferencias.js';
import { anclarComentario, textosComentados } from './comentarios.js';
import { emparejar } from './diferencias.js';

export class ErrorCambio extends Error {}

/** Clave para comparar bloques: sin comentarios y con el texto de cada nota en lugar de su id. */
export function claveBloque(b: Bloque, notas: Nota[]): string {
  const limpiar = (l: Inline[]): unknown[] =>
    normalizarInlines(l.map((i) => (i.tipo === 'texto' && i.comentarios ? (({ comentarios: _c, ...r }) => r)(i) : i))).map((i) =>
      i.tipo === 'nota' ? { tipo: 'nota', texto: textoPlano(notas.find((n) => n.id === i.id)?.contenido ?? []) } : i,
    );
  if (b.tipo === 'parrafo' || b.tipo === 'subtitulo') return JSON.stringify({ ...b, contenido: limpiar(b.contenido) });
  if (b.tipo === 'lista') return JSON.stringify({ ...b, elementos: b.elementos.map(limpiar) });
  if (b.tipo === 'recuadro') return JSON.stringify({ ...b, lineas: b.lineas.map((l) => ({ ...l, contenido: limpiar(l.contenido) })) });
  return JSON.stringify(b);
}

const vacio = (b: Bloque) => b.tipo === 'parrafo' && !b.contenido.length;

function notasDe(bloques: Bloque[], notas: Nota[]): Nota[] {
  const ids = new Set<string>();
  const ver = (l: Inline[]) => l.forEach((i) => i.tipo === 'nota' && ids.add(i.id));
  for (const b of bloques) {
    if (b.tipo === 'parrafo' || b.tipo === 'subtitulo') ver(b.contenido);
    if (b.tipo === 'lista') b.elementos.forEach(ver);
    if (b.tipo === 'recuadro') b.lineas.forEach((l) => ver(l.contenido));
  }
  return notas.filter((n) => ids.has(n.id));
}

/** Propone los cambios que convierten la sección en los bloques nuevos. No modifica la sección. */
export function proponerCambios(
  s: Seccion,
  nuevos: Bloque[],
  notasNuevas: Nota[],
  autor: string,
  fecha = new Date().toISOString(),
  tituloNuevo?: string,
): CambioPropuesto[] {
  const a = s.bloques.map((b) => claveBloque(b, s.notas));
  const b = nuevos.map((x) => claveBloque(x, notasNuevas));
  const pares = emparejar(a, b);
  const cambios: CambioPropuesto[] = [];
  let i = 0;
  let j = 0;
  for (const [pi, pj] of [...pares, [a.length, b.length] as [number, number]]) {
    const antes = s.bloques.slice(i, pi);
    const despues = nuevos.slice(j, pj);
    // Los párrafos vacíos no viajan por Word: no son un cambio.
    if (antes.some((x) => !vacio(x)) || despues.some((x) => !vacio(x))) {
      const notas = notasDe(despues, notasNuevas);
      cambios.push({ id: nuevoId('k'), autor, fecha, posicion: i, antes, despues, ...(notas.length ? { notas } : {}) });
    }
    i = pi + 1;
    j = pj + 1;
  }
  if (tituloNuevo !== undefined && tituloNuevo !== s.titulo)
    cambios.unshift({ id: nuevoId('k'), autor, fecha, posicion: 0, antes: [], despues: [], titulo: { antes: s.titulo, despues: tituloNuevo } });
  return cambios;
}

/** Dónde están hoy los bloques `antes` del cambio (la sección pudo editarse después). */
function localizar(s: Seccion, c: CambioPropuesto): number {
  if (!c.antes.length) return Math.min(c.posicion, s.bloques.length);
  const claves = c.antes.map((b) => claveBloque(b, s.notas));
  const coincide = (p: number) => claves.every((k, n) => s.bloques[p + n] && claveBloque(s.bloques[p + n], s.notas) === k);
  if (coincide(c.posicion)) return c.posicion;
  for (let p = 0; p + claves.length <= s.bloques.length; p++) if (coincide(p)) return p;
  throw new ErrorCambio('El texto original de este cambio se editó después; ya no se puede aplicar. Recházalo y corrígelo a mano.');
}

function quitar(s: Seccion, id: string): CambioPropuesto {
  const c = s.cambios?.find((x) => x.id === id);
  if (!c) throw new ErrorCambio('Ese cambio ya no existe.');
  s.cambios = s.cambios!.filter((x) => x.id !== id);
  if (!s.cambios.length) delete s.cambios;
  return c;
}

export function aceptarCambio(s: Seccion, id: string) {
  const c = s.cambios?.find((x) => x.id === id);
  if (!c) throw new ErrorCambio('Ese cambio ya no existe.');
  if (c.titulo) {
    s.titulo = c.titulo.despues;
    quitar(s, id);
    return;
  }
  const pos = localizar(s, c);
  const anclas = textosComentados(s.bloques);
  s.bloques.splice(pos, c.antes.length, ...structuredClone(c.despues));
  // Notas: se añaden las del cambio y se quitan las que ya nadie llama.
  s.notas = notasDe(s.bloques, [...s.notas, ...(c.notas ?? []).filter((n) => !s.notas.some((x) => x.id === n.id))]);
  // Comentarios anclados en los párrafos sustituidos: se intentan volver a anclar en el texto nuevo.
  const ahora = textosComentados(s.bloques);
  for (const com of s.comentarios ?? []) {
    const texto = anclas.get(com.id);
    if (texto && !ahora.has(com.id) && !anclarComentario(s.bloques, com.id, texto)) com.cita = texto.slice(0, 500);
  }
  quitar(s, id);
  const desplazamiento = c.despues.length - c.antes.length;
  for (const otro of s.cambios ?? []) if (!otro.titulo && otro.posicion > c.posicion) otro.posicion += desplazamiento;
}

export function rechazarCambio(s: Seccion, id: string) {
  quitar(s, id);
}

/** Acepta todos los cambios de la sección; devuelve los que no se pudieron aplicar. */
export function aceptarTodos(s: Seccion): string[] {
  const fallos: string[] = [];
  for (const c of [...(s.cambios ?? [])]) {
    try {
      aceptarCambio(s, c.id);
    } catch (e) {
      fallos.push((e as Error).message);
    }
  }
  return fallos;
}
