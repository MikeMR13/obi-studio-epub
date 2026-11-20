// Comentarios de revisión: anclas en el texto y lectura de los comentarios de un Word.

import { DOMParser } from '@xmldom/xmldom';
import JSZip from 'jszip';
import type { Bloque, Comentario, Inline } from './model.js';
import { normalizarInlines, nuevoId } from './model.js';

function listasDe(b: Bloque): Inline[][] {
  if (b.tipo === 'parrafo' || b.tipo === 'subtitulo') return [b.contenido];
  if (b.tipo === 'lista') return b.elementos;
  return [];
}

/** Texto anclado a cada comentario en los bloques de una sección. */
export function textosComentados(bloques: Bloque[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const b of bloques)
    for (const l of listasDe(b)) for (const i of l) if (i.tipo === 'texto') for (const id of i.comentarios ?? []) m.set(id, (m.get(id) ?? '') + i.texto);
  return m;
}

const textoInline = (i: Inline) => (i.tipo === 'texto' ? i.texto : i.tipo === 'ruby' ? i.base : i.tipo === 'salto' ? '\n' : '');

function anclarEn(l: Inline[], id: string, aguja: string): Inline[] | null {
  const total = l.map(textoInline).join('');
  const ini = total.indexOf(aguja);
  if (ini < 0) return null;
  const fin = ini + aguja.length;
  const salida: Inline[] = [];
  let pos = 0;
  for (const i of l) {
    const a = pos;
    const b = pos + textoInline(i).length;
    pos = b;
    if (i.tipo !== 'texto' || b <= ini || a >= fin) {
      salida.push(i);
      continue;
    }
    const corteA = Math.max(ini, a) - a;
    const corteB = Math.min(fin, b) - a;
    if (corteA > 0) salida.push({ ...i, texto: i.texto.slice(0, corteA) });
    salida.push({ ...i, texto: i.texto.slice(corteA, corteB), comentarios: [...(i.comentarios ?? []), id] });
    if (corteB < i.texto.length) salida.push({ ...i, texto: i.texto.slice(corteB) });
  }
  return normalizarInlines(salida);
}

/**
 * Ancla el comentario `id` a la primera aparición de `texto` en los bloques (modifica los bloques).
 * Devuelve false si el texto ya no está.
 */
export function anclarComentario(bloques: Bloque[], id: string, texto: string): boolean {
  const aguja = texto.split('\n')[0].trim();
  if (!aguja) return false;
  for (const b of bloques) {
    const listas = listasDe(b);
    for (let k = 0; k < listas.length; k++) {
      const r = anclarEn(listas[k], id, aguja);
      if (!r) continue;
      if (b.tipo === 'lista') b.elementos[k] = r;
      else (b as { contenido: Inline[] }).contenido = r;
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Comentarios de Word.

export interface ComentarioWord {
  /** w:id dentro del documento. */
  wid: string;
  autor: string;
  fecha: string;
  texto: string;
  /** w:id del comentario al que responde. */
  padre?: string;
  resuelto: boolean;
  /** Texto comentado. */
  ancla: string;
  /** Índice de la sección (encabezado de nivel 1) en la que está, desde 0. */
  seccion: number;
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const W15 = 'http://schemas.microsoft.com/office/word/2012/wordml';

type Nodo = { nodeType: number; localName?: string; namespaceURI?: string | null; childNodes?: ArrayLike<Nodo>; textContent?: string | null; getAttributeNS?: (ns: string, n: string) => string | null };

function hijos(n: Nodo): Nodo[] {
  return Array.from(n.childNodes ?? []);
}

function textoParrafo(p: Nodo): string {
  let t = '';
  const visitar = (n: Nodo) => {
    if (n.nodeType !== 1) return;
    if (n.namespaceURI === W && n.localName === 't') t += n.textContent ?? '';
    else if (n.namespaceURI === W && n.localName === 'tab') t += '\t';
    else if (n.namespaceURI === W && (n.localName === 'br' || n.localName === 'cr')) t += '\n';
    else hijos(n).forEach(visitar);
  };
  visitar(p);
  return t;
}

function parsear(xml: string) {
  return new DOMParser().parseFromString(xml, 'text/xml') as unknown as Nodo & { getElementsByTagNameNS(ns: string, n: string): ArrayLike<Nodo> };
}

/** Lee los comentarios de un .docx con su texto anclado, hilos (respuestas) y estado resuelto. */
export async function leerComentariosWord(datos: Uint8Array): Promise<ComentarioWord[]> {
  const zip = await JSZip.loadAsync(datos);
  const xmlComentarios = await zip.file('word/comments.xml')?.async('string');
  if (!xmlComentarios) return [];
  const xmlDocumento = (await zip.file('word/document.xml')?.async('string')) ?? '';
  const xmlExtendido = await zip.file('word/commentsExtended.xml')?.async('string');

  // Hilos y estado: commentsExtended enlaza el w14:paraId del último párrafo de cada comentario.
  const extendido = new Map<string, { padre?: string; hecho: boolean }>();
  if (xmlExtendido) {
    for (const e of Array.from(parsear(xmlExtendido).getElementsByTagNameNS(W15, 'commentEx'))) {
      const paraId = e.getAttributeNS!(W15, 'paraId');
      if (paraId) extendido.set(paraId, { padre: e.getAttributeNS!(W15, 'paraIdParent') || undefined, hecho: e.getAttributeNS!(W15, 'done') === '1' });
    }
  }
  const lista: ComentarioWord[] = [];
  const porParaId = new Map<string, string>();
  for (const c of Array.from(parsear(xmlComentarios).getElementsByTagNameNS(W, 'comment'))) {
    const wid = c.getAttributeNS!(W, 'id') ?? '';
    const parrafos = hijos(c).filter((n) => n.namespaceURI === W && n.localName === 'p');
    const ultimo = parrafos[parrafos.length - 1];
    const paraId = ultimo?.getAttributeNS?.(W14, 'paraId') ?? '';
    if (paraId) porParaId.set(paraId, wid);
    const ext = paraId ? extendido.get(paraId) : undefined;
    lista.push({
      wid,
      autor: c.getAttributeNS!(W, 'author') || 'Anónimo',
      fecha: c.getAttributeNS!(W, 'date') || new Date().toISOString(),
      texto: parrafos.map(textoParrafo).join('\n').trim(),
      resuelto: !!ext?.hecho,
      padre: ext?.padre,
      ancla: '',
      seccion: -1,
    });
  }
  for (const c of lista) if (c.padre) c.padre = porParaId.get(c.padre);

  // Texto anclado y sección de cada comentario, recorriendo el documento en orden.
  const porId = new Map(lista.map((c) => [c.wid, c]));
  const abiertos = new Set<string>();
  let seccion = -1;
  const recorrer = (n: Nodo) => {
    if (n.nodeType !== 1 || n.namespaceURI !== W) {
      hijos(n).forEach(recorrer);
      return;
    }
    if (n.localName === 'p') {
      const pPr = hijos(n).find((x) => x.namespaceURI === W && x.localName === 'pPr');
      const pStyle = pPr && hijos(pPr).find((x) => x.namespaceURI === W && x.localName === 'pStyle');
      const val = pStyle?.getAttributeNS?.(W, 'val') ?? '';
      if (/^(heading1|t[ií]tulo1|ttulo1)$/i.test(val)) seccion++;
      hijos(n).forEach(recorrer);
      for (const id of abiertos) {
        const c = porId.get(id);
        if (c && c.ancla && !c.ancla.endsWith('\n')) c.ancla += '\n';
      }
      return;
    }
    if (n.localName === 'commentRangeStart') {
      const id = n.getAttributeNS!(W, 'id') ?? '';
      const c = porId.get(id);
      if (c) {
        c.seccion = seccion;
        abiertos.add(id);
      }
      return;
    }
    if (n.localName === 'commentRangeEnd') {
      abiertos.delete(n.getAttributeNS!(W, 'id') ?? '');
      return;
    }
    if (n.localName === 'commentReference') {
      const c = porId.get(n.getAttributeNS!(W, 'id') ?? '');
      if (c && c.seccion < 0) c.seccion = seccion;
      return;
    }
    if (n.localName === 't') {
      for (const id of abiertos) {
        const c = porId.get(id);
        if (c) c.ancla += n.textContent ?? '';
      }
      return;
    }
    hijos(n).forEach(recorrer);
  };
  if (xmlDocumento) recorrer(parsear(xmlDocumento) as Nodo);
  for (const c of lista) c.ancla = c.ancla.trim();
  return lista;
}

const norm = (t: string) => t.normalize('NFKC').replace(/\s+/g, ' ').trim();

/**
 * Funde los comentarios del Word de una sección con los del proyecto:
 * los del proyecto se reconocen por autor y texto (y toman de Word el estado resuelto y las respuestas nuevas);
 * los nuevos del corrector se anclan a su texto. Devuelve cuántos comentarios y respuestas son nuevos.
 */
export function fundirComentarios(
  bloques: Bloque[],
  existentes: Comentario[],
  deWord: ComentarioWord[],
  todos: ComentarioWord[],
): { comentarios: Comentario[]; nuevos: number } {
  const resultado: Comentario[] = existentes.map((c) => ({ ...c, ...(c.respuestas ? { respuestas: [...c.respuestas] } : {}) }));
  const porWid = new Map<string, Comentario>();
  let nuevos = 0;
  const raices = deWord.filter((c) => !c.padre);
  for (const w of raices) {
    let c: Comentario | undefined = resultado.find((x) => norm(x.autor) === norm(w.autor) && norm(x.texto) === norm(w.texto));
    if (c) {
      c.resuelto = w.resuelto || undefined;
      if (!c.resuelto) delete c.resuelto;
    } else {
      c = { id: nuevoId('c'), autor: w.autor, fecha: w.fecha, texto: w.texto, ...(w.resuelto ? { resuelto: true } : {}) };
      if (!anclarComentario(bloques, c.id, w.ancla) && w.ancla) c.cita = w.ancla.slice(0, 500);
      resultado.push(c);
      nuevos++;
    }
    porWid.set(w.wid, c);
  }
  for (const w of todos.filter((x) => x.padre)) {
    const padre = porWid.get(w.padre!);
    if (!padre) continue;
    const respuestas = padre.respuestas ?? [];
    if (respuestas.some((r) => norm(r.autor) === norm(w.autor) && norm(r.texto) === norm(w.texto))) continue;
    respuestas.push({ autor: w.autor, fecha: w.fecha, texto: w.texto });
    padre.respuestas = respuestas;
    nuevos++;
  }
  for (const c of resultado) if (!c.respuestas?.length) delete c.respuestas;
  return { comentarios: resultado, nuevos };
}
