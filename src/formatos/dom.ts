// Utilidades sobre DOM (sirven para @xmldom/xmldom y para linkedom).

import { DOMParser as XmlParser } from '@xmldom/xmldom';
import { parseHTML } from 'linkedom';
import { escAttr, esc, limpiarXml } from '../xml.js';

export interface Nodo {
  nodeType: number;
  nodeName: string;
  localName?: string | null;
  nodeValue?: string | null;
  textContent?: string | null;
  childNodes: ArrayLike<Nodo>;
  parentNode?: Nodo | null;
  attributes?: ArrayLike<{ name: string; value: string }>;
  getAttribute?(nombre: string): string | null;
}

export const ELEMENTO = 1;
export const TEXTO = 3;
export const CDATA = 4;

export function nombre(n: Nodo): string {
  return (n.localName || n.nodeName || '').toLowerCase().replace(/^.*:/, '');
}

export function attr(n: Nodo, a: string): string {
  return n.getAttribute?.(a) ?? '';
}

export function hijos(n: Nodo): Nodo[] {
  return Array.from(n.childNodes ?? []);
}

export function hijosElemento(n: Nodo): Nodo[] {
  return hijos(n).filter((h) => h.nodeType === ELEMENTO);
}

export function texto(n: Nodo): string {
  return n.textContent ?? '';
}

export function clases(n: Nodo): string[] {
  return attr(n, 'class').split(/\s+/).filter(Boolean);
}

export function tiposEpub(n: Nodo): string[] {
  return (attr(n, 'epub:type') + ' ' + attr(n, 'role').replace(/doc-/g, '')).split(/\s+/).filter(Boolean);
}

export function buscar(raiz: Nodo, pred: (n: Nodo) => boolean): Nodo | undefined {
  for (const h of hijos(raiz)) {
    if (h.nodeType !== ELEMENTO) continue;
    if (pred(h)) return h;
    const r = buscar(h, pred);
    if (r) return r;
  }
  return undefined;
}

export function todos(raiz: Nodo, pred: (n: Nodo) => boolean, salida: Nodo[] = []): Nodo[] {
  for (const h of hijos(raiz)) {
    if (h.nodeType !== ELEMENTO) continue;
    if (pred(h)) salida.push(h);
    todos(h, pred, salida);
  }
  return salida;
}

/** Analiza XHTML/XML; si está mal formado, recurre al analizador HTML tolerante. */
export function analizarXhtml(fuente: string): { documento: Nodo; tolerante: boolean } {
  const errores: string[] = [];
  const parser = new XmlParser({
    onError: (nivel: string, msg: string) => {
      if (nivel !== 'warning') errores.push(msg);
    },
  });
  try {
    const doc = parser.parseFromString(fuente, 'application/xhtml+xml') as unknown as Nodo;
    if (!errores.length && doc && buscar(doc, (n) => nombre(n) === 'body')) return { documento: doc, tolerante: false };
  } catch {
    /* sigue con el analizador tolerante */
  }
  return { documento: analizarHtml(fuente), tolerante: true };
}

export function analizarXml(fuente: string): Nodo {
  return new XmlParser({ onError: () => undefined }).parseFromString(fuente, 'text/xml') as unknown as Nodo;
}

export function analizarHtml(fuente: string): Nodo {
  const html = /<html[\s>]/i.test(fuente) ? fuente : `<!DOCTYPE html><html><head></head><body>${fuente}</body></html>`;
  const { document } = parseHTML(html);
  return document as unknown as Nodo;
}

/** Comprueba que un fragmento XHTML esté bien formado. Devuelve el error o null. */
export function errorXhtml(fragmento: string): string | null {
  let error: string | null = null;
  const parser = new XmlParser({
    onError: (nivel: string, msg: string) => {
      if (nivel !== 'warning' && !error) error = msg;
    },
  });
  try {
    parser.parseFromString(
      `<div xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xmlns:xlink="http://www.w3.org/1999/xlink">${fragmento}</div>`,
      'application/xhtml+xml',
    );
  } catch (e) {
    error = String((e as Error).message ?? e);
  }
  return error;
}

const VACIOS = new Set(['br', 'hr', 'img', 'col', 'area', 'wbr', 'meta', 'link', 'source', 'track', 'input']);
const NS_POR_ELEMENTO: Record<string, string> = { svg: 'http://www.w3.org/2000/svg', math: 'http://www.w3.org/1998/Math/MathML' };

/** Serializa un nodo como XHTML bien formado; `reescribir` permite cambiar atributos (p. ej. rutas de imagen). */
export function serializar(
  n: Nodo,
  reescribir?: (elemento: string, atributo: string, valor: string) => string | null,
  dentroDeNs = false,
): string {
  if (n.nodeType === TEXTO || n.nodeType === CDATA) return esc(limpiarXml(n.nodeValue ?? ''));
  if (n.nodeType !== ELEMENTO) return '';
  const nombreReal = n.nodeName.includes(':') && !['svg', 'math'].includes(nombre(n)) ? n.nodeName : nombre(n);
  const etiqueta = /^[a-zA-Z]/.test(nombreReal) ? nombreReal : 'span';
  let atributos = '';
  let tieneXmlns = false;
  for (const a of Array.from(n.attributes ?? [])) {
    if (a.name === 'xmlns') tieneXmlns = true;
    if (/^on/i.test(a.name)) continue; // nada de scripts en línea
    let valor: string | null = a.value;
    if (reescribir) valor = reescribir(nombre(n), a.name, a.value);
    if (valor === null) continue;
    atributos += ` ${a.name}="${escAttr(valor)}"`;
  }
  const ns = NS_POR_ELEMENTO[nombre(n)];
  if (ns && !tieneXmlns && !dentroDeNs) atributos += ` xmlns="${ns}"`;
  if (nombre(n) === 'svg' && !/xmlns:xlink=/.test(atributos) && /xlink:/.test(serializarHijos(n, reescribir, true))) {
    atributos += ' xmlns:xlink="http://www.w3.org/1999/xlink"';
  }
  const contenido = serializarHijos(n, reescribir, dentroDeNs || !!ns);
  if (!contenido && (VACIOS.has(nombre(n)) || dentroDeNs || ns)) return `<${etiqueta}${atributos}/>`;
  return `<${etiqueta}${atributos}>${contenido}</${etiqueta}>`;
}

function serializarHijos(n: Nodo, reescribir?: (e: string, a: string, v: string) => string | null, dentroDeNs = false): string {
  return hijos(n)
    .filter((h) => nombre(h) !== 'script')
    .map((h) => serializar(h, reescribir, dentroDeNs))
    .join('');
}
