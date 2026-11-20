// Archivos de fuente (woff2, licencia OFL) que se incrustan en el EPUB y el PDF.

import { readFileSync } from 'node:fs';
import type { Fuente, Inline, Libro, Tema } from './model.js';
import { esVertical, fuente } from './model.js';
import { archivoCara, datosCara, fuentePropia } from './fuentes-propias.js';
import { rutaRecurso } from './recursos.js';

export const SUBCONJUNTOS = [
  {
    nombre: 'latin',
    rango: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
  },
  {
    nombre: 'latin-ext',
    rango: 'U+0100-02AF, U+0304, U+0308, U+0329, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
  },
];

export interface ArchivoFuente {
  archivo: string;
  familia: string;
  peso: string;
  estilo: string;
  /** unicode-range; vacío en las fuentes propias (ya son un subconjunto). */
  rango: string;
  /** Fuentes propias: datos en memoria (subconjunto) y su formato. */
  datos?: Uint8Array;
  formato?: 'ttf' | 'otf';
}

export const MIME_FUENTE = { woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf' } as const;

/** Datos de un archivo de fuente: los de la fuente propia o los de recursos/fuentes. */
export function datosArchivoFuente(a: ArchivoFuente): Uint8Array | undefined {
  return a.datos ?? leerFuente(a.archivo);
}

/** Archivos de una fuente; para títulos basta la redonda (normal) en 400 y 700. */
export function archivosFuente(f: Fuente, soloRedonda = false): ArchivoFuente[] {
  if (!f.archivo) return [];
  return f.estilos
    .filter((e) => !soloRedonda || e.endsWith('normal'))
    .flatMap((e) =>
      SUBCONJUNTOS.map((sub) => {
        const [peso, estilo] = e.split('-');
        return { archivo: `${f.archivo}-${sub.nombre}-${e}.woff2`, familia: f.familia, peso, estilo, rango: sub.rango };
      }),
    );
}

// ---------------------------------------------------------------------------
// Japonés: Noto Serif JP en ~120 subconjuntos por rango Unicode. Solo se incrustan los que cubren
// los caracteres japoneses que usa el libro (kana, kanji, signos de ancho completo).

export const FAMILIA_JAPONESA = 'Noto Serif JP';

let indiceJapones: { n: number; rango: string; tramos: [number, number][] }[] | null | undefined;

function subconjuntosJaponeses() {
  if (indiceJapones !== undefined) return indiceJapones;
  const ruta = rutaRecurso('fuentes', 'noto-serif-jp-indice.json');
  if (!ruta) return (indiceJapones = null);
  const crudo = JSON.parse(readFileSync(ruta, 'utf8')) as { n: number; rango: string }[];
  indiceJapones = crudo.map((x) => ({
    ...x,
    tramos: x.rango.split(',').map((t) => {
      const [a, b] = t.trim().replace(/^U\+/i, '').split('-');
      return [parseInt(a, 16), parseInt(b ?? a, 16)] as [number, number];
    }),
  }));
  return indiceJapones;
}

/** Caracteres de escritura japonesa (y signos CJK) que aparecen en el libro. */
export function caracteresJaponeses(libro: Libro): Set<number> {
  const cps = new Set<number>();
  const ver = (t: string) => {
    for (const c of t) {
      const cp = c.codePointAt(0)!;
      if (cp >= 0x2e80) cps.add(cp);
    }
  };
  const inl = (l: Inline[]) => l.forEach((i) => (i.tipo === 'texto' ? ver(i.texto) : i.tipo === 'ruby' && (ver(i.base), ver(i.lectura))));
  ver(libro.metadatos.titulo);
  for (const s of libro.secciones) {
    ver(s.titulo);
    for (const b of s.bloques) {
      if (b.tipo === 'parrafo' || b.tipo === 'subtitulo') inl(b.contenido);
      else if (b.tipo === 'lista') b.elementos.forEach(inl);
      else if (b.tipo === 'crudo') ver(b.xhtml);
      else if (b.tipo === 'imagen') ver(b.alt);
    }
    for (const n of s.notas) inl(n.contenido);
  }
  return cps;
}

/** Archivos de Noto Serif JP (400 y 700) que necesita el libro. Vacío si no hay japonés. */
export function archivosJaponeses(libro: Libro): ArchivoFuente[] {
  const cps = caracteresJaponeses(libro);
  const indice = cps.size ? subconjuntosJaponeses() : null;
  if (!indice) return [];
  const usados = indice.filter((x) => x.tramos.some(([a, b]) => [...cps].some((c) => c >= a && c <= b)));
  return usados.flatMap((x) =>
    ['400', '700'].map((peso) => ({ archivo: `noto-serif-jp-${x.n}-${peso}-normal.woff2`, familia: FAMILIA_JAPONESA, peso, estilo: 'normal', rango: x.rango })),
  );
}

/** Familia CSS con la fuente japonesa: delante en vertical, como respaldo en horizontal. */
function conJapones(familia: string, f: Fuente, vertical: boolean): string {
  const jp = `'${FAMILIA_JAPONESA}'`;
  if (vertical) return `${jp}, ${familia}`;
  return f.archivo ? `'${f.familia}', ${jp}, ${f.generica}` : `${jp}, ${f.generica}`;
}

export interface FuentesLibro {
  texto: Fuente;
  titulos: Fuente;
  archivos: ArchivoFuente[];
  /** Valores de font-family listos para el CSS. */
  familiaTexto: string;
  familiaTitulos: string;
}

/**
 * Fuentes que usa un tema. Con `impresion`, las «del lector» se sustituyen por una incrustada.
 * Con `libro`, se añade Noto Serif JP si el libro tiene texto japonés.
 */
export function fuentesTema(tema: Tema, impresion = false, libro?: Libro): FuentesLibro {
  const elegir = (id: string): Fuente => {
    const p = fuentePropia(libro, id);
    if (p) return { id, nombre: p.familia, familia: p.familia, archivo: id, estilos: p.caras.map((c) => `${c.peso}-${c.estilo}`), impresion: id, generica: p.generica };
    return impresion ? fuente(fuente(id).impresion) : fuente(id);
  };
  const archivosDe = (f: Fuente, soloRedonda = false): ArchivoFuente[] => {
    const p = fuentePropia(libro, f.id);
    if (!p || !libro) return archivosFuente(f, soloRedonda);
    return p.caras
      .filter((c) => !soloRedonda || c.estilo === 'normal')
      .map((c) => ({ archivo: archivoCara(p, c), familia: p.familia, peso: String(c.peso), estilo: c.estilo, rango: '', datos: datosCara(libro, p, c), formato: c.formato }));
  };
  const texto = elegir(tema.fuenteTexto);
  const titulos = elegir(tema.fuenteTitulos);
  const archivos = [...archivosDe(texto), ...(titulos.id === texto.id ? [] : archivosDe(titulos, true))];
  const jp = libro ? archivosJaponeses(libro) : [];
  if (!jp.length) return { texto, titulos, archivos, familiaTexto: familiaCss(texto), familiaTitulos: familiaCss(titulos) };
  const vertical = !!libro && esVertical(libro);
  return {
    texto,
    titulos,
    archivos: [...archivos, ...jp],
    familiaTexto: conJapones(familiaCss(texto), texto, vertical),
    familiaTitulos: conJapones(familiaCss(titulos), titulos, vertical),
  };
}

export function caraFuente(a: ArchivoFuente, carpeta: string): string {
  const formato = a.formato === 'otf' ? 'opentype' : a.formato === 'ttf' ? 'truetype' : 'woff2';
  const familia = a.familia.replace(/['\\]/g, '');
  return `@font-face { font-family: '${familia}'; font-weight: ${a.peso}; font-style: ${a.estilo}; src: url('${carpeta}${a.archivo}') format('${formato}');${a.rango ? ` unicode-range: ${a.rango};` : ''} }`;
}

export function familiaCss(f: Fuente): string {
  return f.archivo ? `'${f.familia.replace(/['\\]/g, '')}', ${f.generica}` : f.generica;
}

export function leerFuente(archivo: string): Uint8Array | undefined {
  const ruta = rutaRecurso('fuentes', archivo.replace(/[/\\]/g, ''));
  return ruta ? new Uint8Array(readFileSync(ruta)) : undefined;
}
