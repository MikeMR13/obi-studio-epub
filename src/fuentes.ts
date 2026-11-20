// Archivos de fuente (woff2, licencia OFL) que se incrustan en el EPUB y el PDF.

import { readFileSync } from 'node:fs';
import type { Fuente, Tema } from './model.js';
import { fuente } from './model.js';
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
  rango: string;
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

/** Fuentes que usa un tema. Con `impresion`, las «del lector» se sustituyen por una incrustada. */
export function fuentesTema(tema: Tema, impresion = false): { texto: Fuente; titulos: Fuente; archivos: ArchivoFuente[] } {
  const elegir = (id: string) => (impresion ? fuente(fuente(id).impresion) : fuente(id));
  const texto = elegir(tema.fuenteTexto);
  const titulos = elegir(tema.fuenteTitulos);
  const archivos = [...archivosFuente(texto), ...(titulos.id === texto.id ? [] : archivosFuente(titulos, true))];
  return { texto, titulos, archivos };
}

export function caraFuente(a: ArchivoFuente, carpeta: string): string {
  return `@font-face { font-family: '${a.familia}'; font-weight: ${a.peso}; font-style: ${a.estilo}; src: url('${carpeta}${a.archivo}') format('woff2'); unicode-range: ${a.rango}; }`;
}

export function familiaCss(f: Fuente): string {
  return f.archivo ? `'${f.familia}', ${f.generica}` : f.generica;
}

export function leerFuente(archivo: string): Uint8Array | undefined {
  const ruta = rutaRecurso('fuentes', archivo.replace(/[/\\]/g, ''));
  return ruta ? new Uint8Array(readFileSync(ruta)) : undefined;
}
