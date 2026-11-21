// Glosario y fichas de personajes: nombres, lugares, técnicas… con su grafía correcta, y revisión del libro
// para encontrar las grafías distintas (variantes que se quieren evitar o parecidas: acentos, macrones,
// guiones, mayúsculas, vocales largas «uu/ou/ū»).

import type { Bloque, EntradaGlosario, Inline, Libro, Seccion, TipoTermino } from './model.js';
import { TIPOS_TERMINO, nuevoId, textoPlano } from './model.js';

/** Clave para comparar grafías: sin acentos ni macrones, sin espacios ni guiones, vocales largas simples. */
export function claveTermino(t: string): string {
  return t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s\-‐‑–·・'’`]/g, '')
    .replace(/ou/g, 'o')
    .replace(/(aa|ii|uu|ee|oo)/g, (m) => m[0])
    .replace(/[^\p{L}\p{N}]/gu, '');
}

export interface Ejemplo {
  seccion: string;
  titulo: string;
  contexto: string;
}

export interface Hallazgo {
  entrada: string;
  termino: string;
  /** Grafía encontrada en el libro. */
  encontrado: string;
  /** «variante»: una grafía que la entrada dice evitar; «parecido»: misma clave, distinta grafía. */
  tipo: 'variante' | 'parecido';
  veces: number;
  ejemplos: Ejemplo[];
}

export interface RevisionGlosario {
  hallazgos: Hallazgo[];
  /** Veces que aparece cada término (por id de entrada). */
  usos: Record<string, number>;
}

function textosSeccion(s: Seccion): string[] {
  const r: string[] = [];
  const de = (l: Inline[]) => r.push(textoPlano(l));
  for (const b of s.bloques as Bloque[]) {
    if (b.tipo === 'parrafo' || b.tipo === 'subtitulo') de(b.contenido);
    else if (b.tipo === 'lista') b.elementos.forEach(de);
    else if (b.tipo === 'recuadro') b.lineas.forEach((x) => de(x.contenido));
    else if (b.tipo === 'tabla') b.filas.forEach((f) => f.forEach((c) => de(c.contenido)));
  }
  s.notas.forEach((n) => de(n.contenido));
  if (s.titulo) r.push(s.titulo);
  return r;
}

const PALABRA = /[\p{L}\p{N}][\p{L}\p{N}\p{M}'’\-‐]*/gu;

/** Busca en el libro los usos de cada término y las grafías distintas. */
export function revisarGlosario(libro: Pick<Libro, 'secciones' | 'glosario'>, maxEjemplos = 3): RevisionGlosario {
  const entradas = (libro.glosario ?? []).filter((e) => e.termino.trim());
  const usos: Record<string, number> = {};
  const hallazgos = new Map<string, Hallazgo>();
  const exactos = new Set(entradas.map((e) => e.termino));
  const porClave = new Map<string, EntradaGlosario[]>();
  for (const e of entradas) {
    const k = claveTermino(e.termino);
    if (k) porClave.set(k, [...(porClave.get(k) ?? []), e]);
  }
  const maxPalabras = Math.max(1, ...entradas.map((e) => e.termino.trim().split(/\s+/).length + 1));
  const variantes = entradas.flatMap((e) => (e.variantes ?? []).filter((v) => v.trim()).map((v) => ({ e, v: v.trim() })));
  const anotar = (e: EntradaGlosario, encontrado: string, tipo: Hallazgo['tipo'], s: Seccion, texto: string, pos: number) => {
    const clave = `${e.id}\u0000${encontrado}`;
    const h = hallazgos.get(clave) ?? { entrada: e.id, termino: e.termino, encontrado, tipo, veces: 0, ejemplos: [] };
    h.veces++;
    if (h.ejemplos.length < maxEjemplos) {
      const ini = Math.max(0, pos - 40);
      const fin = Math.min(texto.length, pos + encontrado.length + 40);
      h.ejemplos.push({ seccion: s.id, titulo: s.titulo, contexto: (ini ? '…' : '') + texto.slice(ini, fin) + (fin < texto.length ? '…' : '') });
    }
    hallazgos.set(clave, h);
  };
  for (const s of libro.secciones) {
    for (const texto of textosSeccion(s)) {
      if (!texto) continue;
      const palabras = [...texto.matchAll(PALABRA)].map((m) => ({ t: m[0], i: m.index! }));
      // Usos exactos y grafías parecidas (n-gramas de hasta una palabra más que el término más largo).
      for (let i = 0; i < palabras.length; i++) {
        for (let n = 1; n <= maxPalabras && i + n <= palabras.length; n++) {
          const ini = palabras[i].i;
          const fin = palabras[i + n - 1].i + palabras[i + n - 1].t.length;
          const trozo = texto.slice(ini, fin);
          if (n > 1 && /[.,;:!?¡¿«»"“”()—]/.test(trozo)) break;
          const k = claveTermino(trozo);
          const candidatas = porClave.get(k);
          if (!candidatas) continue;
          for (const e of candidatas) {
            if (trozo === e.termino) usos[e.id] = (usos[e.id] ?? 0) + 1;
            else if (!exactos.has(trozo) && !(trozo.slice(1) === e.termino.slice(1) && trozo[0].toLowerCase() === e.termino[0].toLowerCase())) anotar(e, trozo, 'parecido', s, texto, ini);
          }
        }
      }
      // Variantes que se quieren evitar (palabra completa; sin distinguir mayúsculas, salvo si la variante
      // solo se diferencia del término en las mayúsculas). La grafía correcta nunca cuenta como variante.
      for (const { e, v } of variantes) {
        const exacta = v.toLowerCase() === e.termino.toLowerCase();
        const re = new RegExp(`(?<![\\p{L}\\p{N}])${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, exacta ? 'gu' : 'giu');
        for (const m of texto.matchAll(re)) if (m[0] !== e.termino) anotar(e, m[0], 'variante', s, texto, m.index!);
      }
    }
  }
  // Una grafía marcada como variante no se repite como «parecida».
  for (const [k, h] of hallazgos) if (h.tipo === 'parecido' && hallazgos.has(k) && variantes.some((x) => x.e.id === h.entrada && x.v.toLowerCase() === h.encontrado.toLowerCase())) hallazgos.delete(k);
  return { hallazgos: [...hallazgos.values()].sort((a, b) => (a.tipo === b.tipo ? b.veces - a.veces : a.tipo === 'variante' ? -1 : 1)), usos };
}

/** Limpia las entradas que llegan de la interfaz o de un archivo. */
export function glosarioValido(x: unknown): EntradaGlosario[] {
  if (!Array.isArray(x)) return [];
  const tipos = new Set(TIPOS_TERMINO.map((t) => t.id));
  const texto = (v: unknown, max = 300) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const ids = new Set<string>();
  const r: EntradaGlosario[] = [];
  for (const e of x.slice(0, 2000)) {
    if (!e || typeof e !== 'object') continue;
    const o = e as Record<string, unknown>;
    const termino = texto(o.termino, 200);
    if (!termino) continue;
    let id = texto(o.id, 60) || nuevoId('g');
    while (ids.has(id)) id = nuevoId('g');
    ids.add(id);
    const variantes = (Array.isArray(o.variantes) ? o.variantes : typeof o.variantes === 'string' ? o.variantes.split('|') : []).map((v) => texto(v, 200)).filter((v) => v && v !== termino).slice(0, 20);
    r.push({
      id,
      termino,
      tipo: tipos.has(o.tipo as TipoTermino) ? (o.tipo as TipoTermino) : 'otro',
      ...(variantes.length ? { variantes } : {}),
      ...(texto(o.original, 200) ? { original: texto(o.original, 200) } : {}),
      ...(texto(o.lectura, 200) ? { lectura: texto(o.lectura, 200) } : {}),
      ...(texto(o.descripcion, 2000) ? { descripcion: texto(o.descripcion, 2000) } : {}),
      ...(o.enLibro === true ? { enLibro: true } : {}),
    });
  }
  return r;
}

const COLUMNAS = ['termino', 'tipo', 'original', 'lectura', 'variantes', 'descripcion', 'en_libro'] as const;

/** Glosario en CSV (separado por comas, variantes separadas por «|»). */
export function glosarioACsv(g: EntradaGlosario[]): string {
  const celda = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const filas = g.map((e) => COLUMNAS.map((c) => celda(c === 'variantes' ? (e.variantes ?? []).join('|') : c === 'en_libro' ? (e.enLibro ? 'sí' : '') : String(e[c] ?? ''))).join(','));
  return '﻿' + [COLUMNAS.join(','), ...filas].join('\r\n') + '\r\n';
}

/** Lee un CSV de glosario (con cabecera; acepta coma o punto y coma). */
export function glosarioDeCsv(texto: string): EntradaGlosario[] {
  const t = texto.replace(/^﻿/, '');
  const sep = (t.split('\n')[0].match(/;/g) ?? []).length > (t.split('\n')[0].match(/,/g) ?? []).length ? ';' : ',';
  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = '';
  let comillas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (comillas) {
      if (c === '"' && t[i + 1] === '"') (celda += '"'), i++;
      else if (c === '"') comillas = false;
      else celda += c;
    } else if (c === '"') comillas = true;
    else if (c === sep) fila.push(celda), (celda = '');
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      fila.push(celda);
      if (fila.some((x) => x.trim())) filas.push(fila);
      fila = [];
      celda = '';
    } else celda += c;
  }
  fila.push(celda);
  if (fila.some((x) => x.trim())) filas.push(fila);
  if (!filas.length) return [];
  const cab = filas[0].map((x) => x.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''));
  const indice = (nombres: string[]) => cab.findIndex((x) => nombres.includes(x));
  const col = {
    termino: indice(['termino', 'term', 'nombre', 'name']),
    tipo: indice(['tipo', 'type']),
    original: indice(['original', 'japones', 'japanese']),
    lectura: indice(['lectura', 'reading', 'furigana']),
    variantes: indice(['variantes', 'variants', 'evitar']),
    descripcion: indice(['descripcion', 'description', 'nota', 'notes']),
    enLibro: indice(['en_libro', 'en libro', 'enlibro', 'in_book', 'in book']),
  };
  const conCabecera = col.termino >= 0;
  const datos = conCabecera ? filas.slice(1) : filas;
  return glosarioValido(
    datos.map((f) => {
      const v = (k: keyof typeof col, def: number) => f[col[k] >= 0 ? col[k] : conCabecera ? -1 : def] ?? '';
      return { termino: v('termino', 0), tipo: v('tipo', 1), original: v('original', 2), lectura: v('lectura', 3), variantes: v('variantes', 4), descripcion: v('descripcion', 5), enLibro: /^(s[ií]|yes|y|x|1|true|verdadero)$/i.test(v('enLibro', 6).trim()) };
    }),
  );
}

/** Bloques de la página de glosario del libro (las entradas marcadas «en el libro», por tipo y en orden alfabético). */
export function bloquesGlosario(g: EntradaGlosario[]): Bloque[] {
  const bloques: Bloque[] = [];
  const elegidas = g.filter((e) => e.enLibro);
  for (const tipo of TIPOS_TERMINO) {
    const de = elegidas.filter((e) => e.tipo === tipo.id).sort((a, b) => a.termino.localeCompare(b.termino));
    if (!de.length) continue;
    bloques.push({ tipo: 'subtitulo', nivel: 2, contenido: [{ tipo: 'texto', texto: tipo.plural }] });
    for (const e of de) {
      const extra = [e.original, e.lectura].filter(Boolean).join(', ');
      bloques.push({
        tipo: 'parrafo',
        estilo: 'sin-sangria',
        contenido: [
          { tipo: 'texto', texto: e.termino, marcas: ['negrita'] },
          ...(extra ? [{ tipo: 'texto' as const, texto: ` (${extra})` }] : []),
          ...(e.descripcion ? [{ tipo: 'texto' as const, texto: `: ${e.descripcion}` }] : []),
        ],
      });
    }
  }
  return bloques;
}
