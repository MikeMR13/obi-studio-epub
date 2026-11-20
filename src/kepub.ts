// Salida KEPUB para Kobo: el mismo EPUB con cada frase envuelta en <span class="koboSpan" id="kobo.P.F">
// y el cuerpo dentro de div#book-columns > div#book-inner. Así Kobo muestra estadísticas de lectura,
// subrayados precisos y la paginación de su motor propio.

import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import type { Libro } from './model.js';
import { compilarArchivos, empaquetar, imagenFija } from './compilar.js';

const XHTML = 'http://www.w3.org/1999/xhtml';
const BLOQUES = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'figcaption', 'td', 'th', 'dt', 'dd', 'blockquote', 'pre']);
const SIN_ENVOLVER = new Set(['ruby', 'rt', 'rp', 'script', 'style', 'svg', 'math', 'textarea']);
/** Frases: se corta después de . ! ? … 。！？ seguidos de espacio (o sin espacio en japonés). */
const FRASE = /[^.!?…。！？]*(?:[.!?…]+[»”’"')\]]*\s+|[。！？]+[」』）]*|$)/gu;

type Nodo = any;

function trocear(texto: string): string[] {
  const partes = texto.match(FRASE)?.filter((x) => x.length) ?? [texto];
  return partes.join('') === texto ? partes : [texto];
}

function envolver(doc: Nodo, bloque: Nodo, parrafo: number): void {
  let frase = 1;
  const recorrer = (n: Nodo) => {
    for (const h of Array.from(n.childNodes as ArrayLike<Nodo>)) {
      if (h.nodeType === 3) {
        if (!h.nodeValue || !h.nodeValue.trim()) continue;
        for (const trozo of trocear(h.nodeValue)) {
          const span = doc.createElementNS(XHTML, 'span');
          span.setAttribute('class', 'koboSpan');
          span.setAttribute('id', `kobo.${parrafo}.${frase++}`);
          span.appendChild(doc.createTextNode(trozo));
          n.insertBefore(span, h);
        }
        n.removeChild(h);
      } else if (h.nodeType === 1) {
        const nombre = (h.localName || '').toLowerCase();
        if (nombre === 'img' || SIN_ENVOLVER.has(nombre)) {
          // Imágenes y ruby se envuelven enteros para no romper su estructura.
          const span = doc.createElementNS(XHTML, 'span');
          span.setAttribute('class', 'koboSpan');
          span.setAttribute('id', `kobo.${parrafo}.${frase++}`);
          n.insertBefore(span, h);
          span.appendChild(h);
        } else if (!(h.getAttribute('class') || '').split(/\s+/).includes('koboSpan')) {
          recorrer(h);
        }
      }
    }
  };
  recorrer(bloque);
}

export function kepubXhtml(xhtml: string): string {
  const doc = new DOMParser().parseFromString(xhtml, 'application/xhtml+xml') as Nodo;
  const body = doc.getElementsByTagName('body')[0];
  if (!body) return xhtml;
  let parrafo = 1;
  const bloques: Nodo[] = [];
  const buscar = (n: Nodo) => {
    for (const h of Array.from(n.childNodes as ArrayLike<Nodo>)) {
      if (h.nodeType !== 1) continue;
      const nombre = (h.localName || '').toLowerCase();
      if (nombre === 'aside' || nombre === 'figure') {
        // Notas y figuras: sus párrafos y pies.
        buscar(h);
        if (nombre === 'figure') {
          const img = Array.from(h.getElementsByTagName('img') as ArrayLike<Nodo>)[0];
          if (img && img.parentNode === h) bloques.push(h);
        }
      } else if (BLOQUES.has(nombre)) bloques.push(h);
      else if (!SIN_ENVOLVER.has(nombre)) buscar(h);
    }
  };
  buscar(body);
  for (const b of bloques) envolver(doc, b, parrafo++);

  const columnas = doc.createElementNS(XHTML, 'div');
  columnas.setAttribute('id', 'book-columns');
  const interior = doc.createElementNS(XHTML, 'div');
  interior.setAttribute('id', 'book-inner');
  columnas.appendChild(interior);
  while (body.firstChild) interior.appendChild(body.firstChild);
  body.appendChild(columnas);
  const salida = new XMLSerializer().serializeToString(doc);
  return salida.startsWith('<?xml') ? salida : `<?xml version="1.0" encoding="UTF-8"?>\n${salida}`;
}

/** Archivos del KEPUB: los del EPUB con las secciones de texto transformadas. */
export function compilarArchivosKepub(libro: Libro): Map<string, string | Uint8Array> {
  const archivos = compilarArchivos(libro);
  const fijas = new Set(libro.secciones.filter((s) => imagenFija(libro, s)).flatMap((s) => [`${s.id}.xhtml`, `${s.id}-b.xhtml`]));
  for (const [ruta, datos] of archivos) {
    if (!ruta.endsWith('.xhtml') || ruta === 'nav.xhtml' || fijas.has(ruta) || typeof datos !== 'string') continue;
    archivos.set(ruta, kepubXhtml(datos));
  }
  return archivos;
}

export async function compilarKepub(libro: Libro): Promise<Uint8Array> {
  return empaquetar(compilarArchivosKepub(libro));
}
