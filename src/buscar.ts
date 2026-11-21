// Buscar y reemplazar en el modelo: en párrafos, subtítulos, listas y notas, sin romper el formato.
// Una coincidencia puede cruzar cambios de formato (p. ej. «la **casa**»); el texto de reemplazo toma
// el formato del primer fragmento de la coincidencia. No cruza furigana, llamadas a notas ni saltos de línea.

import type { Bloque, Inline, Libro, Seccion } from './model.js';
import { normalizarInlines } from './model.js';

export interface OpcionesBusqueda {
  consulta: string;
  mayusculas?: boolean;
  palabraCompleta?: boolean;
  /** La consulta es una expresión regular (sintaxis de JavaScript). */
  regex?: boolean;
  /** Limitar a una sección. */
  seccion?: string;
}

export interface Coincidencia {
  seccion: string;
  /** Lugar: «b3» (bloque 3), «b3.1» (elemento 1 de la lista del bloque 3) o «n2» (nota 2). */
  lugar: string;
  /** Orden de la coincidencia dentro de su lugar. */
  orden: number;
  antes: string;
  texto: string;
  despues: string;
}

export class ErrorBusqueda extends Error {}

const SEPARADOR = '￼';

export function expresion(o: OpcionesBusqueda): RegExp {
  if (!o.consulta) throw new ErrorBusqueda('Escribe qué buscar.');
  let fuente = o.regex ? o.consulta : o.consulta.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (o.palabraCompleta) fuente = `(?<![\\p{L}\\p{N}_])(?:${fuente})(?![\\p{L}\\p{N}_])`;
  try {
    const r = new RegExp(fuente, `gu${o.mayusculas ? '' : 'i'}`);
    if (r.test('')) throw new ErrorBusqueda('La búsqueda no puede coincidir con un texto vacío.');
    return r;
  } catch (e) {
    if (e instanceof ErrorBusqueda) throw e;
    throw new ErrorBusqueda(`Expresión regular no válida: ${(e as Error).message}`);
  }
}

/** Texto plano de los fragmentos de texto; furigana, notas y saltos cortan las coincidencias. */
function plano(l: Inline[]): string {
  return l.map((i) => (i.tipo === 'texto' ? i.texto : SEPARADOR)).join('');
}

function coincidencias(texto: string, re: RegExp): { ini: number; fin: number; valor: RegExpExecArray }[] {
  const salida: { ini: number; fin: number; valor: RegExpExecArray }[] = [];
  re.lastIndex = 0;
  for (let m = re.exec(texto); m; m = re.exec(texto)) {
    if (m[0] === '') {
      re.lastIndex++;
      continue;
    }
    if (!m[0].includes(SEPARADOR)) salida.push({ ini: m.index, fin: m.index + m[0].length, valor: m });
  }
  return salida;
}

type Lugar = { lugar: string; leer: () => Inline[]; escribir: (l: Inline[]) => void };

function lugares(s: Seccion): Lugar[] {
  const salida: Lugar[] = [];
  s.bloques.forEach((b: Bloque, k) => {
    if (b.tipo === 'parrafo' || b.tipo === 'subtitulo') salida.push({ lugar: `b${k}`, leer: () => b.contenido, escribir: (l) => (b.contenido = l) });
    if (b.tipo === 'lista') b.elementos.forEach((_, j) => salida.push({ lugar: `b${k}.${j}`, leer: () => b.elementos[j], escribir: (l) => (b.elementos[j] = l) }));
    if (b.tipo === 'tabla') b.filas.flat().forEach((c, j) => salida.push({ lugar: `b${k}.${j}`, leer: () => c.contenido, escribir: (l) => (c.contenido = l) }));
    if (b.tipo === 'recuadro') b.lineas.forEach((x, j) => salida.push({ lugar: `b${k}.${j}`, leer: () => x.contenido, escribir: (l) => (x.contenido = l) }));
  });
  s.notas.forEach((n, k) => salida.push({ lugar: `n${k}`, leer: () => n.contenido, escribir: (l) => (n.contenido = l) }));
  return salida;
}

const limpio = (t: string) => t.replaceAll(SEPARADOR, ' ');

export function buscar(libro: Libro, o: OpcionesBusqueda, maximo = 1000): { coincidencias: Coincidencia[]; total: number } {
  const re = expresion(o);
  const salida: Coincidencia[] = [];
  let total = 0;
  for (const s of libro.secciones) {
    if (o.seccion && s.id !== o.seccion) continue;
    for (const l of lugares(s)) {
      const texto = plano(l.leer());
      coincidencias(texto, re).forEach((m, orden) => {
        total++;
        if (salida.length < maximo)
          salida.push({
            seccion: s.id,
            lugar: l.lugar,
            orden,
            antes: limpio(texto.slice(Math.max(0, m.ini - 40), m.ini)),
            texto: limpio(texto.slice(m.ini, m.fin)),
            despues: limpio(texto.slice(m.fin, m.fin + 40)),
          });
      });
    }
  }
  return { coincidencias: salida, total };
}

/** Sustituye en una lista de inlines; `elegir(k)` decide qué coincidencias (por orden) se reemplazan. */
export function reemplazarEnInlines(l: Inline[], re: RegExp, reemplazo: string, regex: boolean, elegir: (k: number) => boolean): { inlines: Inline[]; n: number } {
  const texto = plano(l);
  const ms = coincidencias(texto, re).filter((_, k) => elegir(k));
  if (!ms.length) return { inlines: l, n: 0 };
  // Posición de cada inline en el texto plano.
  const tramos: { ini: number; fin: number }[] = [];
  let pos = 0;
  for (const i of l) {
    const largo = i.tipo === 'texto' ? i.texto.length : 1;
    tramos.push({ ini: pos, fin: pos + largo });
    pos += largo;
  }
  const salida: Inline[] = [];
  l.forEach((i, k) => {
    if (i.tipo !== 'texto') {
      salida.push(i);
      return;
    }
    const { ini: a, fin: b } = tramos[k];
    let texto = '';
    let cursor = a;
    for (const m of ms) {
      if (m.fin <= a || m.ini >= b) continue;
      texto += i.texto.slice(cursor - a, Math.max(m.ini, a) - a);
      // El texto nuevo va en el inline donde empieza la coincidencia.
      if (m.ini >= a) texto += regex ? m.valor[0].replace(new RegExp(re.source, re.flags.replace('g', '')), reemplazo) : reemplazo;
      cursor = Math.min(m.fin, b);
    }
    texto += i.texto.slice(cursor - a);
    if (texto) salida.push({ ...i, texto });
  });
  return { inlines: normalizarInlines(salida), n: ms.length };
}

/**
 * Reemplaza en el libro (lo modifica). Con `solo`, reemplaza únicamente esa coincidencia.
 * Devuelve cuántas se reemplazaron y en qué secciones.
 */
export function reemplazar(
  libro: Libro,
  o: OpcionesBusqueda,
  reemplazo: string,
  solo?: { seccion: string; lugar: string; orden: number },
): { n: number; secciones: string[] } {
  const re = expresion(o);
  let n = 0;
  const secciones = new Set<string>();
  for (const s of libro.secciones) {
    if ((o.seccion && s.id !== o.seccion) || (solo && s.id !== solo.seccion)) continue;
    for (const l of lugares(s)) {
      if (solo && l.lugar !== solo.lugar) continue;
      const r = reemplazarEnInlines(l.leer(), re, reemplazo, !!o.regex, (k) => !solo || k === solo.orden);
      if (!r.n) continue;
      l.escribir(r.inlines);
      n += r.n;
      secciones.add(s.id);
    }
  }
  return { n, secciones: [...secciones] };
}
