// Conversión entre el JSON de ProseMirror (editor visual) y los bloques del modelo.
// Es la única puerta entre el editor y el libro: el editor nunca guarda HTML.

import type { Bloque, EstiloParrafo, Inline, Marca } from './model.js';
import { ESTILOS_PARRAFO, normalizarInlines } from './model.js';

export interface PMMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface PMNodo {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNodo[];
  marks?: PMMark[];
  text?: string;
}

const MARCA_A_PM: Record<Marca, string> = {
  negrita: 'bold',
  cursiva: 'italic',
  subrayado: 'underline',
  tachado: 'strike',
  versalitas: 'versalitas',
  superindice: 'superscript',
  subindice: 'subscript',
};
const PM_A_MARCA: Record<string, Marca> = Object.fromEntries(Object.entries(MARCA_A_PM).map(([k, v]) => [v, k as Marca]));

function marcasPM(i: { marcas?: Marca[]; enlace?: string; idioma?: string }): PMMark[] | undefined {
  const m: PMMark[] = (i.marcas ?? []).map((x) => ({ type: MARCA_A_PM[x] }));
  if (i.enlace) m.push({ type: 'link', attrs: { href: i.enlace } });
  if (i.idioma) m.push({ type: 'idioma', attrs: { lang: i.idioma } });
  return m.length ? m : undefined;
}

export function inlinesAPM(lista: Inline[]): PMNodo[] {
  const salida: PMNodo[] = [];
  for (const i of lista) {
    if (i.tipo === 'texto') {
      if (!i.texto) continue;
      // ProseMirror no admite saltos de línea en el texto.
      const trozos = i.texto.split('\n');
      trozos.forEach((t, k) => {
        if (k > 0) salida.push({ type: 'hardBreak' });
        if (t) salida.push({ type: 'text', text: t, marks: marcasPM(i) });
      });
    } else if (i.tipo === 'salto') salida.push({ type: 'hardBreak' });
    else if (i.tipo === 'ruby') salida.push({ type: 'ruby', attrs: { base: i.base, lectura: i.lectura }, marks: marcasPM(i) });
    else if (i.tipo === 'nota') salida.push({ type: 'notaRef', attrs: { id: i.id } });
  }
  for (const n of salida) if (!n.marks) delete n.marks;
  return salida;
}

export function bloquesAPM(bloques: Bloque[]): PMNodo {
  const content: PMNodo[] = [];
  for (const b of bloques) {
    switch (b.tipo) {
      case 'parrafo':
        content.push({ type: 'paragraph', attrs: { estilo: b.estilo }, content: inlinesAPM(b.contenido) });
        break;
      case 'subtitulo':
        content.push({ type: 'heading', attrs: { level: b.nivel }, content: inlinesAPM(b.contenido) });
        break;
      case 'separador':
        content.push({ type: 'horizontalRule' });
        break;
      case 'imagen':
        content.push({ type: 'imagen', attrs: { recurso: b.recurso, alt: b.alt, decorativa: !!b.decorativa, pie: b.pie ?? '' } });
        break;
      case 'lista':
        content.push({
          type: b.ordenada ? 'orderedList' : 'bulletList',
          content: b.elementos.map((e) => ({ type: 'listItem', content: [{ type: 'paragraph', attrs: { estilo: 'cuerpo' }, content: inlinesAPM(e) }] })),
        });
        break;
      case 'crudo':
        content.push({ type: 'crudo', attrs: { xhtml: b.xhtml } });
        break;
    }
  }
  for (const c of content) if (c.content && !c.content.length) delete c.content;
  if (!content.length) content.push({ type: 'paragraph', attrs: { estilo: 'cuerpo' } });
  return { type: 'doc', content };
}

function datosMarcas(marks: PMMark[] = []): { marcas?: Marca[]; enlace?: string; idioma?: string } {
  const r: { marcas?: Marca[]; enlace?: string; idioma?: string } = {};
  const marcas: Marca[] = [];
  for (const m of marks) {
    if (PM_A_MARCA[m.type]) marcas.push(PM_A_MARCA[m.type]);
    else if (m.type === 'link' && m.attrs?.href) r.enlace = String(m.attrs.href);
    else if (m.type === 'idioma' && m.attrs?.lang) r.idioma = String(m.attrs.lang);
  }
  if (marcas.length) r.marcas = marcas;
  return r;
}

export function pmAInlines(nodos: PMNodo[] = []): Inline[] {
  const salida: Inline[] = [];
  for (const n of nodos) {
    if (n.type === 'text') salida.push({ tipo: 'texto', texto: n.text ?? '', ...datosMarcas(n.marks) });
    else if (n.type === 'hardBreak') salida.push({ tipo: 'salto' });
    else if (n.type === 'ruby') {
      const { marcas } = datosMarcas(n.marks);
      salida.push({ tipo: 'ruby', base: String(n.attrs?.base ?? ''), lectura: String(n.attrs?.lectura ?? ''), ...(marcas ? { marcas } : {}) });
    } else if (n.type === 'notaRef') salida.push({ tipo: 'nota', id: String(n.attrs?.id ?? '') });
  }
  return normalizarInlines(salida);
}

const ESTILOS_VALIDOS = new Set(ESTILOS_PARRAFO.map((e) => e.id));

export function pmABloques(doc: PMNodo): Bloque[] {
  const bloques: Bloque[] = [];
  for (const n of doc.content ?? []) {
    switch (n.type) {
      case 'paragraph': {
        const estilo = String(n.attrs?.estilo ?? 'cuerpo') as EstiloParrafo;
        bloques.push({ tipo: 'parrafo', estilo: ESTILOS_VALIDOS.has(estilo) ? estilo : 'cuerpo', contenido: pmAInlines(n.content) });
        break;
      }
      case 'heading': {
        const nivel = Number(n.attrs?.level) >= 3 ? 3 : 2;
        bloques.push({ tipo: 'subtitulo', nivel, contenido: pmAInlines(n.content) });
        break;
      }
      case 'horizontalRule':
        bloques.push({ tipo: 'separador' });
        break;
      case 'imagen': {
        const b: Bloque = { tipo: 'imagen', recurso: String(n.attrs?.recurso ?? ''), alt: String(n.attrs?.alt ?? '') };
        if (n.attrs?.decorativa) b.decorativa = true;
        if (n.attrs?.pie) b.pie = String(n.attrs.pie);
        bloques.push(b);
        break;
      }
      case 'bulletList':
      case 'orderedList':
        bloques.push({
          tipo: 'lista',
          ordenada: n.type === 'orderedList',
          elementos: (n.content ?? []).map((li) => pmAInlines((li.content ?? []).flatMap((p, k) => (k > 0 ? [{ type: 'hardBreak' }, ...(p.content ?? [])] : p.content ?? [])))),
        });
        break;
      case 'crudo':
        bloques.push({ tipo: 'crudo', xhtml: String(n.attrs?.xhtml ?? '') });
        break;
      case 'blockquote':
        for (const p of n.content ?? []) {
          if (p.type === 'paragraph') bloques.push({ tipo: 'parrafo', estilo: 'cita', contenido: pmAInlines(p.content) });
        }
        break;
    }
  }
  return bloques;
}
