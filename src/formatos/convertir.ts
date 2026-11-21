// Conversión de HTML/XHTML (de un EPUB o de Word) a bloques del modelo.
// Lo que el editor visual no sabe representar se guarda como bloque «crudo» para no perder nada.

import type { AspectoTexto, Bloque, EstiloParrafo, Inline, LineaRecuadro, Marca, Nota, Recuadro } from '../model.js';
import { ESTILOS_PARRAFO, VARIANTES_RECUADRO, nuevoId, normalizarInlines } from '../model.js';

const VARIANTES = VARIANTES_RECUADRO.map((v) => v.id);
import { ELEMENTO, TEXTO, CDATA, attr, clases, hijos, nombre, serializar, texto, tiposEpub, type Nodo } from './dom.js';

export interface EstiloCss {
  negrita?: boolean;
  cursiva?: boolean;
  versalitas?: boolean;
  subrayado?: boolean;
  tachado?: boolean;
  superindice?: boolean;
  alinear?: 'center' | 'right' | 'left' | 'justify';
  oculto?: boolean;
  /** Márgenes del párrafo en em (solo si se pueden pasar a em). */
  margenArriba?: number;
  margenAbajo?: number;
  /** Tamaño relativo (em), color y fondo. */
  tamano?: number;
  color?: string;
  fondo?: string;
}

/** Color CSS a #rrggbb (hex, rgb() o negro/blanco); undefined si no se reconoce. */
export function colorCss(v?: string): string | undefined {
  if (!v) return undefined;
  const t = v.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(t)) return t;
  if (/^#[0-9a-f]{3}$/.test(t)) return '#' + [...t.slice(1)].map((c) => c + c).join('');
  const m = t.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?/);
  if (m) {
    if (m[4] !== undefined && parseFloat(m[4]) === 0) return undefined;
    return '#' + m.slice(1, 4).map((x) => Math.min(255, Number(x)).toString(16).padStart(2, '0')).join('');
  }
  return ({ black: '#000000', white: '#ffffff', red: '#ff0000', blue: '#0000ff', green: '#008000', gray: '#808080', grey: '#808080' } as Record<string, string>)[t];
}

/** Tamaño de letra relativo (em) a partir de em, %, rem, px o pt (16 px = 12 pt = 1 em). */
function tamanoRelativo(v: string): number | undefined {
  const m = v.trim().match(/^(\d*\.?\d+)(em|rem|%|px|pt)$/);
  if (m) {
    const n = parseFloat(m[1]);
    const r = { em: n, rem: n, '%': n / 100, px: n / 16, pt: n / 12 }[m[2] as 'em'];
    return Math.round(r * 100) / 100;
  }
  return ({ 'xx-small': 0.6, 'x-small': 0.75, small: 0.89, medium: 1, large: 1.2, 'x-large': 1.5, 'xx-large': 2, smaller: 0.83, larger: 1.2 } as Record<string, number>)[v.trim()];
}

/** Longitud CSS en em (16 px = 1 em, 12 pt = 1 em); undefined si no se puede convertir. */
export function longitudEnEm(v?: string): number | undefined {
  if (!v) return undefined;
  const m = v.trim().match(/^(-?\d*\.?\d+)(em|rem|px|pt)?$/i);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  const u = (m[2] ?? '').toLowerCase();
  if (u === 'em' || u === 'rem') return n;
  if (u === 'px') return n / 16;
  if (u === 'pt') return n / 12;
  return n === 0 ? 0 : undefined;
}

/** Reglas de clase muy simples (`.x`, `p.x`, `span.x`) sacadas de las hojas de estilo del EPUB. */
export function analizarCss(css: string, destino = new Map<string, EstiloCss>()): Map<string, EstiloCss> {
  const sinComentarios = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}@]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sinComentarios))) {
    const estilo = estiloDeDeclaraciones(m[2]);
    if (!Object.keys(estilo).length) continue;
    for (const selector of m[1].split(',')) {
      const s = selector.trim();
      const clase = s.match(/^(?:[a-z0-9]+)?\.([\w-]+)$/i)?.[1];
      if (!clase) continue;
      destino.set(clase, { ...(destino.get(clase) ?? {}), ...estilo });
    }
  }
  return destino;
}

export function estiloDeDeclaraciones(decl: string): EstiloCss {
  const e: EstiloCss = {};
  for (const parte of decl.split(';')) {
    const [prop, ...resto] = parte.split(':');
    if (!prop || !resto.length) continue;
    const p = prop.trim().toLowerCase();
    const v = resto.join(':').trim().toLowerCase();
    if (p === 'font-weight') e.negrita = v === 'bold' || v === 'bolder' || parseInt(v) >= 600;
    else if (p === 'font-style') e.cursiva = v.startsWith('italic') || v.startsWith('oblique');
    else if (p === 'font-variant' || p === 'font-variant-caps') e.versalitas = v.includes('small-caps');
    else if (p === 'text-decoration' || p === 'text-decoration-line') {
      e.subrayado = v.includes('underline');
      e.tachado = v.includes('line-through');
    } else if (p === 'vertical-align') e.superindice = v === 'super';
    else if (p === 'text-align' && ['center', 'right', 'left', 'justify'].includes(v)) e.alinear = v as EstiloCss['alinear'];
    else if (p === 'display' && v === 'none') e.oculto = true;
    else if (p === 'font-size') e.tamano = tamanoRelativo(v);
    else if (p === 'color') e.color = colorCss(v);
    else if (p === 'background-color' || (p === 'background' && !/url\(/.test(v))) e.fondo = colorCss(v.split(/\s+/)[0]);
    else if (p === 'margin-top') e.margenArriba = longitudEnEm(v);
    else if (p === 'margin-bottom') e.margenAbajo = longitudEnEm(v);
    else if (p === 'margin') {
      const partes = v.split(/\s+/);
      e.margenArriba = longitudEnEm(partes[0]);
      e.margenAbajo = longitudEnEm(partes[2] ?? partes[0]);
    }
  }
  for (const k of ['tamano', 'color', 'fondo'] as const) if (e[k] === undefined) delete e[k];
  if (e.margenArriba === undefined) delete e.margenArriba;
  if (e.margenAbajo === undefined) delete e.margenAbajo;
  for (const k of Object.keys(e) as (keyof EstiloCss)[]) if (e[k] === false) delete e[k];
  return e;
}

export interface OpcionesConversion {
  css: Map<string, EstiloCss>;
  /** Devuelve el id del recurso para un src/href de imagen, o undefined. */
  imagen: (src: string) => string | undefined;
  /** Devuelve la ruta de imagen que debe usarse dentro del XHTML crudo. */
  rutaCruda: (src: string) => string | null;
  /** ¿Este enlace es una llamada a nota? Si lo es, devuelve la clave de la nota. */
  claveNota: (a: Nodo) => string | undefined;
  /** ¿Este elemento es el cuerpo de una nota (ya extraída aparte)? */
  esCuerpoNota: (n: Nodo) => boolean;
  /** ¿Este enlace es un enlace de vuelta de una nota? */
  esEnlaceVuelta?: (a: Nodo) => boolean;
  /** Conservar los párrafos vacíos (líneas en blanco del original). */
  vacios?: boolean;
  /** Conservar el tamaño, color y fondo que dan las clases CSS a los fragmentos (el del atributo style se lee siempre). */
  aspectos?: boolean;
  /** Estilo de párrafo propio que corresponde a este párrafo del original (conversión sencilla). */
  estiloPropio?: (n: Nodo) => string | undefined;
  /** Párrafos de símbolos que son separadores de escena del original (además de los habituales). */
  esSeparador?: (texto: string) => boolean;
  /** ¿Esta imagen es el separador de escena del original? */
  imagenSeparador?: (src: string) => boolean;
  /** Clases cuyo CSS no se convierte en marcas ni aspecto (capitulares hechas con un span). */
  ignorarClases?: Set<string>;
  /**
   * Conservar el espacio propio de cada párrafo que se aparte del general (márgenes de sus clases CSS).
   * El margen escrito en el propio párrafo (atributo style, como lo escribe Obi Studio) se lee siempre.
   */
  espaciado?: { arriba: number; abajo: number };
}

export interface Parte {
  titulo?: string;
  /** Tipo semántico detectado en el elemento que abre la parte (epub:type / role). */
  tipos: string[];
  /** aria-label del elemento que abre la parte (título no visible). */
  etiqueta?: string;
  /** Imagen de cabecera del capítulo (div.cabecera-capitulo de Obi Studio). */
  imagenCabecera?: string;
  bloques: Bloque[];
}

const SEPARADOR = /^\s*(?:[*＊⁂◇◆□■○●☆★◎※~～·•\-–—=]\s*){1,7}$/;
const BLOQUES_CONTENEDOR = new Set(['div', 'section', 'article', 'main', 'header', 'footer', 'body', 'center', 'hgroup']);
const INLINE = new Set([
  'span', 'a', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'ins', 'sup', 'sub', 'small', 'big', 'font', 'cite',
  'abbr', 'mark', 'q', 'code', 'kbd', 'var', 'dfn', 'time', 'bdi', 'bdo', 'ruby', 'br', 'img', 'label', 'tt', 'wbr',
]);
const CRUDOS = new Set(['table', 'math', 'video', 'audio', 'iframe', 'object', 'pre', 'dl', 'form', 'details']);

const CLASES_PROPIAS = new Set<string>(ESTILOS_PARRAFO.map((e) => e.id));

function estiloDeNodo(n: Nodo, o: OpcionesConversion): EstiloCss {
  let e: EstiloCss = {};
  // Las clases de estilo de párrafo de Obi Studio ya se traducen a estilos; no se convierten en marcas.
  for (const c of clases(n)) if (!CLASES_PROPIAS.has(c) && !c.startsWith('ep-') && !o.ignorarClases?.has(c)) e = { ...e, ...(o.css.get(c) ?? {}) };
  const enLinea = attr(n, 'style');
  if (enLinea) e = { ...e, ...estiloDeDeclaraciones(enLinea) };
  return e;
}

function marcasDeEstilo(e: EstiloCss): Marca[] {
  const m: Marca[] = [];
  if (e.negrita) m.push('negrita');
  if (e.cursiva) m.push('cursiva');
  if (e.versalitas) m.push('versalitas');
  if (e.subrayado) m.push('subrayado');
  if (e.tachado) m.push('tachado');
  if (e.superindice) m.push('superindice');
  return m;
}

const MARCA_ETIQUETA: Record<string, Marca> = {
  b: 'negrita',
  strong: 'negrita',
  i: 'cursiva',
  em: 'cursiva',
  cite: 'cursiva',
  u: 'subrayado',
  ins: 'subrayado',
  s: 'tachado',
  strike: 'tachado',
  del: 'tachado',
  sup: 'superindice',
  sub: 'subindice',
};

interface EstadoInline {
  marcas: Marca[];
  enlace?: string;
  idioma?: string;
  aspecto?: AspectoTexto;
}

const conAspecto = (e: EstadoInline) => (e.aspecto && Object.keys(e.aspecto).length ? { aspecto: { ...e.aspecto } } : {});

export function convertirInlines(nodos: Nodo[], o: OpcionesConversion, estado: EstadoInline = { marcas: [] }): Inline[] {
  const salida: Inline[] = [];
  for (const n of nodos) {
    if (n.nodeType === TEXTO || n.nodeType === CDATA) {
      const t = (n.nodeValue ?? '').replace(/[\r\n\t ]+/g, ' ');
      if (t) salida.push({ tipo: 'texto', texto: t, marcas: [...estado.marcas], enlace: estado.enlace, idioma: estado.idioma, ...conAspecto(estado) });
      continue;
    }
    if (n.nodeType !== ELEMENTO) continue;
    const et = nombre(n);
    const est = estiloDeNodo(n, o);
    if (est.oculto) continue;
    if (et === 'br') {
      salida.push({ tipo: 'salto' });
      continue;
    }
    if (et === 'img' || et === 'svg' || et === 'script' || et === 'style' || et === 'rt' || et === 'rp') continue;
    if (et === 'a') {
      const clave = o.claveNota(n);
      if (clave) {
        salida.push({ tipo: 'nota', id: clave });
        continue;
      }
      if (o.esEnlaceVuelta?.(n)) continue;
    }
    if (et === 'sup' && hijos(n).length === 1 && nombre(hijos(n)[0]) === 'a' && o.claveNota(hijos(n)[0])) {
      salida.push({ tipo: 'nota', id: o.claveNota(hijos(n)[0])! });
      continue;
    }
    if (et === 'ruby') {
      const base = hijos(n)
        .filter((h) => h.nodeType === TEXTO || (h.nodeType === ELEMENTO && !['rt', 'rp'].includes(nombre(h))))
        .map((h) => texto(h))
        .join('')
        .trim();
      const lectura = hijos(n)
        .filter((h) => nombre(h) === 'rt')
        .map((h) => texto(h))
        .join('')
        .trim();
      if (base && lectura) salida.push({ tipo: 'ruby', base, lectura, ...(estado.marcas.length ? { marcas: [...estado.marcas] } : {}) });
      else if (base) salida.push({ tipo: 'texto', texto: base, marcas: [...estado.marcas], enlace: estado.enlace, idioma: estado.idioma, ...conAspecto(estado) });
      continue;
    }
    const nuevo: EstadoInline = { marcas: [...estado.marcas], enlace: estado.enlace, idioma: estado.idioma, aspecto: estado.aspecto ? { ...estado.aspecto } : undefined };
    // Tamaño, color y fondo: los del atributo style siempre; los de las clases, si se pide.
    const fuenteAspecto = o.aspectos ? est : attr(n, 'style') ? estiloDeDeclaraciones(attr(n, 'style')) : {};
    if (fuenteAspecto.tamano !== undefined || fuenteAspecto.color || fuenteAspecto.fondo) {
      const a: AspectoTexto = { ...(nuevo.aspecto ?? {}) };
      if (fuenteAspecto.tamano !== undefined) {
        const t = Math.round((a.tamano ?? 1) * fuenteAspecto.tamano * 100) / 100;
        if (Math.abs(t - 1) > 0.02) a.tamano = t;
        else delete a.tamano;
      }
      // El negro del texto y el blanco del fondo son los de siempre: no se fijan (el lector puede estar en modo oscuro).
      const canales = (c: string) => [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16));
      if (fuenteAspecto.color && Math.max(...canales(fuenteAspecto.color)) > 0x22) a.color = fuenteAspecto.color;
      if (fuenteAspecto.fondo && Math.min(...canales(fuenteAspecto.fondo)) < 0xf6) a.fondo = fuenteAspecto.fondo;
      nuevo.aspecto = a;
    }
    if (clases(n).includes('boten') && !nuevo.marcas.includes('enfasis')) nuevo.marcas.push('enfasis');
    if (clases(n).includes('vs') && !nuevo.marcas.includes('versalitas')) nuevo.marcas.push('versalitas');
    const m = MARCA_ETIQUETA[et];
    if (m && !nuevo.marcas.includes(m)) nuevo.marcas.push(m);
    for (const mm of marcasDeEstilo(est)) if (!nuevo.marcas.includes(mm)) nuevo.marcas.push(mm);
    const lang = attr(n, 'xml:lang') || attr(n, 'lang');
    if (lang) nuevo.idioma = lang;
    if (et === 'a') {
      const href = attr(n, 'href');
      if (/^(https?:|mailto:)/i.test(href)) nuevo.enlace = href;
    }
    salida.push(...convertirInlines(hijos(n), o, nuevo));
  }
  return salida;
}

/** Inlines limpios: espacios del principio y final recortados, idioma del libro omitido. */
export function inlinesLimpios(nodos: Nodo[], o: OpcionesConversion, base: EstadoInline = { marcas: [] }, idiomaLibro?: string): Inline[] {
  let lista = convertirInlines(nodos, o, base);
  for (const i of lista) {
    if (i.tipo === 'texto') {
      if (i.idioma && idiomaLibro && i.idioma.split('-')[0] === idiomaLibro.split('-')[0]) delete i.idioma;
      if (!i.enlace) delete i.enlace;
      if (!i.idioma) delete i.idioma;
    }
  }
  lista = normalizarInlines(lista);
  // Recortar espacios en los extremos y saltos sobrantes.
  while (lista.length && lista[0].tipo === 'salto') lista.shift();
  while (lista.length && lista[lista.length - 1].tipo === 'salto') lista.pop();
  const primero = lista[0];
  if (primero?.tipo === 'texto') primero.texto = primero.texto.replace(/^\s+/, '');
  const ultimo = lista[lista.length - 1];
  if (ultimo?.tipo === 'texto') ultimo.texto = ultimo.texto.replace(/\s+$/, '');
  return normalizarInlines(lista);
}

function estiloParrafo(n: Nodo, o: OpcionesConversion, heredado?: EstiloParrafo): EstiloParrafo {
  const propios = clases(n);
  const directo = ESTILOS_PARRAFO.find((e) => propios.includes(e.id));
  if (directo) return directo.id;
  const e = estiloDeNodo(n, o);
  if (e.alinear === 'center') return 'centrado';
  if (e.alinear === 'right') return 'derecha';
  return heredado ?? 'cuerpo';
}

function contieneSoloImagen(n: Nodo): Nodo | undefined {
  let imagen: Nodo | undefined;
  const recorrer = (x: Nodo): boolean => {
    for (const h of hijos(x)) {
      if (h.nodeType === TEXTO && (h.nodeValue ?? '').trim()) return false;
      if (h.nodeType !== ELEMENTO) continue;
      const et = nombre(h);
      if (et === 'img' || et === 'svg') {
        if (imagen) return false;
        imagen = h;
      } else if (et === 'br') continue;
      else if (!recorrer(h)) return false;
    }
    return true;
  };
  return recorrer(n) ? imagen : undefined;
}

function srcImagen(n: Nodo): { src: string; alt: string } | undefined {
  if (nombre(n) === 'img') return { src: attr(n, 'src'), alt: attr(n, 'alt') };
  if (nombre(n) === 'svg') {
    const img = hijos(n).find((h) => nombre(h) === 'image');
    const otros = hijos(n).filter((h) => h.nodeType === ELEMENTO && !['image', 'title', 'desc'].includes(nombre(h)));
    if (!img || otros.length) return undefined;
    const titulo = hijos(n).find((h) => nombre(h) === 'title');
    return { src: attr(img, 'xlink:href') || attr(img, 'href'), alt: attr(n, 'aria-label') || (titulo ? texto(titulo).trim() : '') };
  }
  return undefined;
}

export function convertirBloques(raiz: Nodo, o: OpcionesConversion, idiomaLibro?: string): Parte[] {
  const partes: Parte[] = [{ tipos: [], bloques: [] }];
  const actual = () => partes[partes.length - 1];

  const anadirImagen = (n: Nodo, pie?: string): boolean => {
    const s = srcImagen(n);
    if (!s) return false;
    if (!pie && o.imagenSeparador?.(s.src)) {
      actual().bloques.push({ tipo: 'separador' });
      return true;
    }
    const id = o.imagen(s.src);
    if (!id) return false;
    const decorativa = attr(n, 'role') === 'presentation' || (nombre(n) === 'img' && n.getAttribute?.('alt') === '' && !pie);
    actual().bloques.push({ tipo: 'imagen', recurso: id, alt: s.alt.trim(), decorativa: decorativa || undefined, pie: pie || undefined });
    return true;
  };

  const anadirCrudo = (n: Nodo) => {
    const xhtml = serializar(n, (el, a, v) => {
      if ((el === 'img' && a === 'src') || (el === 'image' && (a === 'xlink:href' || a === 'href'))) return o.rutaCruda(v);
      if (a === 'id') return null; // los id se regeneran; evita choques
      return v;
    });
    actual().bloques.push({ tipo: 'crudo', xhtml });
  };

  /** Espacio propio de un párrafo: el de su atributo style y, si se pide, el de sus clases cuando difiere del general. */
  const espacioDe = (n?: Nodo): { espacioAntes?: number; espacioDespues?: number } => {
    if (!n) return {};
    const r: { espacioAntes?: number; espacioDespues?: number } = {};
    const estilo = attr(n, 'style');
    // Lo que escribe Obi Studio (margin-top/margin-bottom en em) vuelve siempre, para la ida y vuelta.
    const propio = (prop: string) => estilo.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*(-?\\d*\\.?\\d+)em\\s*(?:;|$)`))?.[1];
    if (propio('margin-top') !== undefined) r.espacioAntes = parseFloat(propio('margin-top')!);
    if (propio('margin-bottom') !== undefined) r.espacioDespues = parseFloat(propio('margin-bottom')!);
    const enLinea = estilo ? estiloDeDeclaraciones(estilo) : {};
    if (o.espaciado) {
      let deClase: EstiloCss = {};
      for (const c of clases(n)) deClase = { ...deClase, ...(o.css.get(c) ?? {}) };
      const arriba = r.espacioAntes ?? enLinea.margenArriba ?? deClase.margenArriba;
      const abajo = r.espacioDespues ?? enLinea.margenAbajo ?? deClase.margenAbajo;
      if (arriba !== undefined && Math.abs(arriba - o.espaciado.arriba) > 0.05) r.espacioAntes = Math.round(arriba * 100) / 100;
      if (abajo !== undefined && Math.abs(abajo - o.espaciado.abajo) > 0.05) r.espacioDespues = Math.round(abajo * 100) / 100;
    }
    return r;
  };

  const anadirParrafo = (nodos: Nodo[], estilo: EstiloParrafo, base: EstadoInline, nodo?: Nodo) => {
    const contenido = inlinesLimpios(nodos, o, base, idiomaLibro);
    const plano = contenido.map((i) => (i.tipo === 'texto' ? i.texto : i.tipo === 'ruby' ? i.base : '')).join('');
    const vacio = !contenido.length || (!plano.trim() && contenido.every((i) => i.tipo === 'texto' || i.tipo === 'salto'));
    if (vacio) {
      // Línea en blanco del original: se conserva como párrafo vacío si se pide.
      if (o.vacios && nodo) actual().bloques.push({ tipo: 'parrafo', estilo: 'cuerpo', contenido: [], ...espacioDe(nodo) });
      return;
    }
    if ((SEPARADOR.test(plano) || o.esSeparador?.(plano.trim())) && !contenido.some((i) => i.tipo === 'nota')) {
      actual().bloques.push({ tipo: 'separador' });
      return;
    }
    const propia = nodo ? (clases(nodo).find((c) => c.startsWith('ep-'))?.slice(3) ?? o.estiloPropio?.(nodo)) : undefined;
    actual().bloques.push({ tipo: 'parrafo', estilo, contenido, ...espacioDe(nodo), ...(propia ? { clase: propia } : {}) });
  };

  const recorrer = (n: Nodo, estiloHeredado?: EstiloParrafo, base: EstadoInline = { marcas: [] }) => {
    let pendientes: Nodo[] = [];
    const vaciar = () => {
      if (pendientes.length) anadirParrafo(pendientes, estiloHeredado ?? 'cuerpo', base);
      pendientes = [];
    };
    for (const h of hijos(n)) {
      if (h.nodeType === TEXTO || h.nodeType === CDATA) {
        pendientes.push(h);
        continue;
      }
      if (h.nodeType !== ELEMENTO) continue;
      const et = nombre(h);
      if (o.esCuerpoNota(h)) continue;
      if (['script', 'style', 'head', 'title', 'meta', 'link', 'nav'].includes(et)) continue;
      const est = estiloDeNodo(h, o);
      if (est.oculto) continue;
      if (INLINE.has(et) && !(et === 'img' || et === 'svg')) {
        pendientes.push(h);
        continue;
      }
      vaciar();
      const marcasBloque: EstadoInline = { ...base, marcas: [...base.marcas, ...marcasDeEstilo(est)] };
      if (et === 'h1') {
        const t = texto(h).replace(/\s+/g, ' ').trim();
        if (actual().bloques.length || actual().titulo !== undefined) partes.push({ tipos: [], bloques: [] });
        actual().titulo = t;
        continue;
      }
      if (/^h[2-6]$/.test(et)) {
        const contenido = inlinesLimpios(hijos(h), o, { marcas: [] }, idiomaLibro);
        if (!contenido.length) continue;
        // Un h2 al principio de una parte sin título hace de título.
        if (et === 'h2' && actual().titulo === undefined && !actual().bloques.length) {
          actual().titulo = texto(h).replace(/\s+/g, ' ').trim();
          continue;
        }
        actual().bloques.push({ tipo: 'subtitulo', nivel: et === 'h2' ? 2 : 3, contenido });
        continue;
      }
      if (et === 'hr') {
        actual().bloques.push({ tipo: 'separador' });
        continue;
      }
      // Recuadros de novela ligera de Obi Studio (div.recuadro.recuadro-<variante>).
      const variante = et === 'div' && clases(h).includes('recuadro') ? VARIANTES.find((v) => clases(h).includes(`recuadro-${v}`)) : undefined;
      if (variante) {
        let titulo: string | undefined;
        const lineas: LineaRecuadro[] = [];
        for (const p of hijos(h)) {
          if (p.nodeType !== ELEMENTO) continue;
          const cp = clases(p);
          if (cp.includes('recuadro-titulo')) {
            titulo = texto(p).replace(/\s+/g, ' ').trim();
            continue;
          }
          const span = (clase: string) => hijos(p).find((x) => nombre(x) === 'span' && clases(x).includes(clase));
          const linea = {} as LineaRecuadro;
          const et2 = variante === 'estado' ? span('etiqueta') : variante === 'chat' ? span('emisor') : undefined;
          if (et2) {
            const t = texto(et2).replace(/\s+/g, ' ').trim();
            if (t) linea.etiqueta = t;
          }
          if (variante === 'chat') linea.lado = cp.includes('der') ? 'der' : 'izq';
          const cuerpo = variante === 'estado' ? span('valor') : variante === 'chat' ? span('globo') : undefined;
          // Sin las marcas que pone el CSS del recuadro (negrita de la notificación, cursiva del diario).
          const contenido = inlinesLimpios(cuerpo ? hijos(cuerpo) : hijos(p), o, base, idiomaLibro);
          lineas.push({ ...linea, contenido: contenido.every((i) => i.tipo === 'salto') ? [] : contenido });
        }
        if (!lineas.length) lineas.push({ contenido: [] });
        const r: Recuadro = { tipo: 'recuadro', variante, ...(titulo ? { titulo } : {}), lineas };
        actual().bloques.push(r);
        continue;
      }
      if (clases(h).includes('cabecera-capitulo')) {
        const img = contieneSoloImagen(h);
        const sImg = img ? srcImagen(img) : undefined;
        const id = sImg ? o.imagen(sImg.src) : undefined;
        if (id) {
          if (actual().bloques.length || actual().titulo !== undefined) partes.push({ tipos: [], bloques: [] });
          actual().imagenCabecera = id;
          continue;
        }
      }
      if (clases(h).includes('escena') || attr(h, 'role') === 'separator') {
        actual().bloques.push({ tipo: 'separador' });
        continue;
      }
      if (et === 'img' || et === 'svg') {
        if (!anadirImagen(h) && et === 'svg') anadirCrudo(h);
        continue;
      }
      if (et === 'figure') {
        const img = contieneSoloImagen({ ...h, childNodes: hijos(h).filter((x) => nombre(x) !== 'figcaption') } as Nodo);
        const cap = hijos(h).find((x) => nombre(x) === 'figcaption');
        if (img && anadirImagen(img, cap ? texto(cap).replace(/\s+/g, ' ').trim() : undefined)) continue;
        anadirCrudo(h);
        continue;
      }
      if (et === 'p' || et === 'li' || et === 'dd' || et === 'dt') {
        const img = contieneSoloImagen(h);
        if (img) {
          if (!anadirImagen(img) && nombre(img) === 'svg') anadirCrudo(img);
          continue;
        }
        if (h.parentNode && hijos(h).some((x) => nombre(x) === 'p' || nombre(x) === 'div')) {
          recorrer(h, estiloParrafo(h, o, estiloHeredado), marcasBloque);
          continue;
        }
        anadirParrafo(hijos(h), estiloParrafo(h, o, estiloHeredado), marcasBloque, et === 'p' ? h : undefined);
        continue;
      }
      if (et === 'ul' || et === 'ol') {
        const elementos = hijos(h)
          .filter((x) => nombre(x) === 'li' && !o.esCuerpoNota(x))
          .map((li) => inlinesLimpios(hijos(li), o, marcasBloque, idiomaLibro))
          .filter((e) => e.length);
        if (elementos.length) actual().bloques.push({ tipo: 'lista', ordenada: et === 'ol', elementos });
        continue;
      }
      if (et === 'blockquote') {
        recorrer(h, 'cita', marcasBloque);
        continue;
      }
      if (et === 'aside') {
        recorrer(h, estiloHeredado, marcasBloque);
        continue;
      }
      if (CRUDOS.has(et)) {
        anadirCrudo(h);
        continue;
      }
      if (BLOQUES_CONTENEDOR.has(et) || !INLINE.has(et)) {
        const tipos = tiposEpub(h);
        if (et === 'section' && !actual().bloques.length && !actual().tipos.length) {
          if (tipos.length) actual().tipos = tipos;
          if (attr(h, 'aria-label')) actual().etiqueta = attr(h, 'aria-label');
        }
        // Un div que solo tiene texto en línea es un párrafo.
        const soloInline = hijos(h).every((x) => x.nodeType !== ELEMENTO || INLINE.has(nombre(x)));
        const img = contieneSoloImagen(h);
        if (img) {
          if (!anadirImagen(img) && nombre(img) === 'svg') anadirCrudo(img);
          continue;
        }
        if (soloInline && et !== 'body' && et !== 'section') anadirParrafo(hijos(h), estiloParrafo(h, o, estiloHeredado), marcasBloque, et === 'div' ? h : undefined);
        else recorrer(h, et === 'div' ? estiloParrafo(h, o, estiloHeredado) : estiloHeredado, marcasBloque);
        continue;
      }
    }
    vaciar();
  };
  recorrer(raiz);
  return partes.filter((p, k) => k === 0 ? p.bloques.length || p.titulo !== undefined : true);
}

/** Contenido de una nota: sus párrafos unidos con saltos de línea, sin el enlace de vuelta ni el número inicial. */
export function contenidoNota(n: Nodo, o: OpcionesConversion, idiomaLibro?: string): Inline[] {
  const bloques = convertirBloques(n, { ...o, esCuerpoNota: () => false }, idiomaLibro).flatMap((p) => p.bloques);
  const inlines: Inline[] = [];
  for (const b of bloques) {
    if (b.tipo !== 'parrafo' && b.tipo !== 'subtitulo') continue;
    if (inlines.length) inlines.push({ tipo: 'salto' });
    inlines.push(...b.contenido);
  }
  if (!inlines.length) {
    const solo = inlinesLimpios(hijos(n), o, { marcas: [] }, idiomaLibro);
    inlines.push(...solo);
  }
  const primero = inlines[0];
  if (primero?.tipo === 'texto') {
    primero.texto = primero.texto.replace(/^\s*(\[\d+\]|\(\d+\)|\d+[.)]?|\*+|※\d*)\s*/, '');
  }
  return normalizarInlines(inlines.filter((i) => i.tipo !== 'nota'));
}

export function nuevaNota(contenido: Inline[]): Nota {
  return { id: nuevoId('n'), contenido };
}
