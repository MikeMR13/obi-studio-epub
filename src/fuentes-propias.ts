// Fuentes propias del usuario (TTF u OTF, por ejemplo las instaladas en su sistema).
// Se lee su nombre y su licencia de incrustación (campo fsType de la tabla OS/2) y, al exportar,
// se incrusta solo el subconjunto de caracteres que usa el libro (HarfBuzz compilado a WebAssembly).

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { CaraFuentePropia, FuentePropia, Inline, Libro } from './model.js';
import { rutaRecurso } from './recursos.js';

export class ErrorFuente extends Error {}

export interface InfoFuente {
  familia: string;
  subfamilia: string;
  nombreCompleto: string;
  peso: number;
  estilo: 'normal' | 'italic';
  formato: 'ttf' | 'otf';
  fsType: number;
}

/** Lo que permite la licencia de la fuente (OpenType, tabla OS/2, campo fsType). */
export interface PermisoFuente {
  incrustable: boolean;
  /** Si es false, la licencia prohíbe hacer subconjuntos: se incrusta entera. */
  subconjunto: boolean;
  /** instalable · edicion · vista (vista previa e impresión) · restringida · mapa-de-bits */
  tipo: 'instalable' | 'edicion' | 'vista' | 'restringida' | 'mapa-de-bits';
}

export function permisoFuente(fsType: number): PermisoFuente {
  const subconjunto = (fsType & 0x0100) === 0;
  if (fsType & 0x0200) return { incrustable: false, subconjunto, tipo: 'mapa-de-bits' };
  // Bits 0–3: si hay varios, manda el menos restrictivo.
  if (fsType & 0x0008) return { incrustable: true, subconjunto, tipo: 'edicion' };
  if (fsType & 0x0004) return { incrustable: true, subconjunto, tipo: 'vista' };
  if (fsType & 0x0002) return { incrustable: false, subconjunto, tipo: 'restringida' };
  return { incrustable: true, subconjunto, tipo: 'instalable' };
}

function tablas(d: Uint8Array): Map<string, { offset: number; length: number }> {
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const n = v.getUint16(4);
  const t = new Map<string, { offset: number; length: number }>();
  for (let i = 0; i < n; i++) {
    const p = 12 + i * 16;
    if (p + 16 > d.length) break;
    const tag = String.fromCharCode(d[p], d[p + 1], d[p + 2], d[p + 3]);
    t.set(tag, { offset: v.getUint32(p + 8), length: v.getUint32(p + 12) });
  }
  return t;
}

const MAC_ROMAN_ALTO = 'ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ';

function leerNombres(d: Uint8Array, t: { offset: number; length: number }): Map<number, string> {
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const base = t.offset;
  const cuenta = v.getUint16(base + 2);
  const cadenas = base + v.getUint16(base + 4);
  const mejores = new Map<number, { prioridad: number; texto: string }>();
  for (let i = 0; i < cuenta; i++) {
    const r = base + 6 + i * 12;
    const plataforma = v.getUint16(r);
    const codificacion = v.getUint16(r + 2);
    const idioma = v.getUint16(r + 4);
    const id = v.getUint16(r + 6);
    const largo = v.getUint16(r + 8);
    const desde = cadenas + v.getUint16(r + 10);
    if (desde + largo > d.length) continue;
    let texto = '';
    let prioridad = 0;
    if (plataforma === 3 || plataforma === 0) {
      for (let k = 0; k + 1 < largo; k += 2) texto += String.fromCharCode(v.getUint16(desde + k));
      prioridad = plataforma === 3 && idioma === 0x409 ? 3 : 2;
    } else if (plataforma === 1 && codificacion === 0) {
      for (let k = 0; k < largo; k++) {
        const c = d[desde + k];
        texto += c < 128 ? String.fromCharCode(c) : MAC_ROMAN_ALTO[c - 128] ?? '?';
      }
      prioridad = idioma === 0 ? 1 : 0;
    } else continue;
    const actual = mejores.get(id);
    if (texto && (!actual || prioridad > actual.prioridad)) mejores.set(id, { prioridad, texto });
  }
  return new Map([...mejores].map(([k, x]) => [k, x.texto.replace(/\0/g, '').trim()]));
}

/** Nombre, grosor, estilo y licencia de una fuente TTF u OTF. */
export function leerFuentePropia(datos: Uint8Array): InfoFuente {
  if (datos.length < 12) throw new ErrorFuente('El archivo no es una fuente.');
  const firma = String.fromCharCode(...datos.subarray(0, 4));
  if (firma === 'ttcf') throw new ErrorFuente('Las colecciones de fuentes (.ttc) no se admiten: elige un archivo .ttf u .otf.');
  if (firma === 'wOFF' || firma === 'wOF2') throw new ErrorFuente('Las fuentes WOFF no se admiten: elige el archivo .ttf u .otf original.');
  const v = new DataView(datos.buffer, datos.byteOffset, datos.byteLength);
  const formato = firma === 'OTTO' ? 'otf' : v.getUint32(0) === 0x00010000 || firma === 'true' ? 'ttf' : undefined;
  if (!formato) throw new ErrorFuente('El archivo no es una fuente TrueType u OpenType.');
  const t = tablas(datos);
  const name = t.get('name');
  const os2 = t.get('OS/2');
  if (!name || !t.get('cmap')) throw new ErrorFuente('La fuente está incompleta (faltan tablas).');
  const nombres = leerNombres(datos, name);
  const familia = nombres.get(16) || nombres.get(1);
  if (!familia) throw new ErrorFuente('La fuente no tiene nombre de familia.');
  const subfamilia = nombres.get(17) || nombres.get(2) || 'Regular';
  let peso = 400;
  let fsType = 0;
  let cursiva = /italic|oblique|cursiva/i.test(subfamilia);
  if (os2 && os2.length >= 64) {
    peso = v.getUint16(os2.offset + 4) || 400;
    fsType = v.getUint16(os2.offset + 8);
    cursiva = cursiva || (v.getUint16(os2.offset + 62) & 1) === 1;
  } else if (/bold|negrita/i.test(subfamilia)) peso = 700;
  // Algunas fuentes antiguas usan 1–9 en lugar de 100–900.
  if (peso < 10) peso *= 100;
  peso = Math.min(900, Math.max(100, Math.round(peso / 100) * 100));
  return { familia, subfamilia, nombreCompleto: nombres.get(4) || `${familia} ${subfamilia}`, peso, estilo: cursiva ? 'italic' : 'normal', formato, fsType };
}

// ---------------------------------------------------------------------------
// Subconjuntos con HarfBuzz (WebAssembly, síncrono en Node).

interface ExportsHb {
  memory: WebAssembly.Memory;
  malloc(n: number): number;
  free(p: number): void;
  hb_blob_create(datos: number, largo: number, modo: number, user: number, destruir: number): number;
  hb_blob_destroy(b: number): void;
  hb_blob_get_length(b: number): number;
  hb_blob_get_data(b: number, largo: number): number;
  hb_face_create(blob: number, indice: number): number;
  hb_face_destroy(f: number): void;
  hb_face_reference_blob(f: number): number;
  hb_set_add(s: number, cp: number): void;
  hb_subset_input_create_or_fail(): number;
  hb_subset_input_destroy(i: number): void;
  hb_subset_input_unicode_set(i: number): number;
  hb_subset_or_fail(cara: number, entrada: number): number;
}

let hb: ExportsHb | null | undefined;

function harfbuzz(): ExportsHb | null {
  if (hb !== undefined) return hb;
  const ruta = rutaRecurso('harfbuzz', 'harfbuzz-subset.wasm');
  if (!ruta) return (hb = null);
  const modulo = new WebAssembly.Module(readFileSync(ruta));
  hb = new WebAssembly.Instance(modulo, {}).exports as unknown as ExportsHb;
  return hb;
}

/** Siempre se incluyen: latín básico y Latin-1, comillas, rayas y signos que añade la maquetación. */
const BASICOS: [number, number][] = [
  [0x20, 0x7e],
  [0xa0, 0xff],
  [0x2010, 0x2027],
  [0x2030, 0x203a],
  [0x20ac, 0x20ac],
  [0x2122, 0x2122],
];

/** Caracteres que usa el libro (texto, títulos, notas, metadatos) más los básicos. */
export function caracteresLibro(libro: Libro): Set<number> {
  const cps = new Set<number>();
  for (const [a, b] of BASICOS) for (let c = a; c <= b; c++) cps.add(c);
  const ver = (t?: string) => {
    if (t) for (const c of t) cps.add(c.codePointAt(0)!);
  };
  const inl = (l: Inline[]) =>
    l.forEach((i) => {
      if (i.tipo === 'texto') ver(i.texto);
      else if (i.tipo === 'ruby') (ver(i.base), ver(i.lectura));
    });
  const m = libro.metadatos;
  [m.titulo, m.subtitulo, m.serie, m.editorial, m.derechos, ...m.creditos.map((c) => c.nombre)].forEach(ver);
  for (const s of libro.secciones) {
    ver(s.titulo);
    for (const b of s.bloques) {
      if (b.tipo === 'parrafo' || b.tipo === 'subtitulo') inl(b.contenido);
      else if (b.tipo === 'lista') b.elementos.forEach(inl);
      else if (b.tipo === 'crudo') ver(b.xhtml.replace(/<[^>]*>/g, ' '));
      else if (b.tipo === 'imagen') ver(b.pie);
    }
    for (const n of s.notas) inl(n.contenido);
  }
  // Mayúsculas y minúsculas de todo (versalitas y títulos en mayúsculas las piden).
  for (const c of [...cps]) {
    const ch = String.fromCodePoint(c);
    ver(ch.toUpperCase());
    ver(ch.toLowerCase());
  }
  return cps;
}

/** Subconjunto de la fuente con esos caracteres; devuelve la fuente entera si HarfBuzz no está disponible. */
export function subconjuntoFuente(datos: Uint8Array, caracteres: Iterable<number>): Uint8Array {
  const h = harfbuzz();
  if (!h) return datos;
  const p = h.malloc(datos.length);
  new Uint8Array(h.memory.buffer).set(datos, p);
  const blob = h.hb_blob_create(p, datos.length, 2 /* HB_MEMORY_MODE_WRITABLE */, 0, 0);
  const cara = h.hb_face_create(blob, 0);
  h.hb_blob_destroy(blob);
  const entrada = h.hb_subset_input_create_or_fail();
  try {
    if (!entrada) throw new ErrorFuente('No se pudo preparar el subconjunto de la fuente.');
    const conjunto = h.hb_subset_input_unicode_set(entrada);
    for (const c of caracteres) h.hb_set_add(conjunto, c);
    const sub = h.hb_subset_or_fail(cara, entrada);
    if (!sub) throw new ErrorFuente('HarfBuzz no pudo crear el subconjunto de la fuente.');
    const res = h.hb_face_reference_blob(sub);
    const largo = h.hb_blob_get_length(res);
    const ptr = h.hb_blob_get_data(res, 0);
    const salida = new Uint8Array(h.memory.buffer, ptr, largo).slice();
    h.hb_blob_destroy(res);
    h.hb_face_destroy(sub);
    return salida;
  } finally {
    if (entrada) h.hb_subset_input_destroy(entrada);
    h.hb_face_destroy(cara);
    h.free(p);
  }
}

// ---------------------------------------------------------------------------
// Fuentes propias dentro del libro.

export const PREFIJO = 'propia-';

export function fuentePropia(libro: Pick<Libro, 'fuentesPropias'> | undefined, id: string): FuentePropia | undefined {
  return id.startsWith(PREFIJO) ? libro?.fuentesPropias?.find((f) => PREFIJO + f.id === id) : undefined;
}

/** Nombre de archivo de una cara dentro del EPUB y del PDF. */
export function archivoCara(f: FuentePropia, c: CaraFuentePropia): string {
  return `${f.id}-${c.peso}-${c.estilo}.${c.formato}`;
}

const cache = new Map<string, Uint8Array>();

/** Datos de una cara listos para incrustar: subconjunto del libro si la licencia lo permite. */
export function datosCara(libro: Libro, f: FuentePropia, c: CaraFuentePropia): Uint8Array {
  if (!permisoFuente(c.fsType).subconjunto) return c.datos;
  const cps = [...caracteresLibro(libro)].sort((a, b) => a - b);
  const clave = createHash('sha1').update(c.datos).update(cps.join(',')).digest('hex');
  let d = cache.get(clave);
  if (!d) {
    try {
      d = subconjuntoFuente(c.datos, cps);
    } catch {
      d = c.datos;
    }
    if (cache.size > 40) cache.clear();
    cache.set(clave, d);
  }
  return d;
}
