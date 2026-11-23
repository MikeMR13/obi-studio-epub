// Importador de EPUB (2 y 3): Sigil, Calibre, InDesign, Kindle Create y los que genera Obi Studio.

import JSZip from 'jszip';
import { corteSugerido } from './cortes.js';
import type { Bloque, Credito, Inline, Libro, Nota, Recurso, RolCredito, Seccion, TipoSeccion } from '../model.js';
import { TEMA_PREDETERMINADO, TIPOGRAFIA_PREDETERMINADA, TIPOS_SECCION, nuevoId, nuevaSeccion, textoPlano, uuid } from '../model.js';
import { rutaImagen } from '../compilar.js';
import { tamanoImagen, tipoPorContenido, tipoPorNombre, extension } from '../imagen.js';
import {
  ELEMENTO, analizarXhtml, analizarXml, attr, buscar, clases, hijos, hijosElemento, nombre, texto, tiposEpub, todos, type Nodo,
} from './dom.js';
import { analizarCss, contenidoNota, convertirBloques, type EstiloCss, type OpcionesConversion } from './convertir.js';

export interface AvisoImportacion {
  mensaje: string;
  archivo?: string;
}

export interface ResultadoImportacion {
  libro: Libro;
  avisos: AvisoImportacion[];
}

function dirDe(ruta: string): string {
  const i = ruta.lastIndexOf('/');
  return i < 0 ? '' : ruta.slice(0, i + 1);
}

export function resolverRuta(base: string, href: string): string {
  const sinFragmento = href.split('#')[0];
  let decodificada = sinFragmento;
  try {
    decodificada = decodeURIComponent(sinFragmento);
  } catch {
    /* se deja tal cual */
  }
  const partes = (dirDe(base) + decodificada).split('/');
  const salida: string[] = [];
  for (const p of partes) {
    if (p === '..') salida.pop();
    else if (p !== '.' && p !== '') salida.push(p);
  }
  return salida.join('/');
}

function nombreSeguro(nombreArchivo: string, usados: Set<string>, tipoMime: string): string {
  const base = nombreArchivo.split('/').pop() ?? 'imagen';
  let limpio = base
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[._-]+/, '');
  if (!/\.[a-z0-9]+$/i.test(limpio)) limpio += '.' + extension(tipoMime);
  if (!limpio || limpio.startsWith('.')) limpio = 'imagen' + limpio;
  let candidato = limpio;
  let k = 2;
  while (usados.has(candidato.toLowerCase())) {
    candidato = limpio.replace(/(\.[^.]+)$/, `-${k++}$1`);
  }
  usados.add(candidato.toLowerCase());
  return candidato;
}

const ROLES_VALIDOS: RolCredito[] = ['aut', 'ill', 'trl', 'edt'];

const PATRONES_TIPO: [RegExp, TipoSeccion][] = [
  [/^(cover|portada|cubierta)\b|表紙/i, 'portada'],
  [/^(pr[oó]logo|prologue|序章|プロローグ)/i, 'prologo'],
  [/^(ep[ií]logo|epilogue|終章|エピローグ)/i, 'epilogo'],
  [/^(posfacio|ep[ií]logo del autor|nota del autor|palabras del autor|afterword|あとがき)/i, 'posfacio'],
  [/^(interludio|intermedio|interlude|幕間)/i, 'interludio'],
  [/^(cr[eé]ditos|copyright|derechos|奥付)/i, 'creditos'],
  [/^([ií]ndice|contenido|tabla de contenidos?|contents|table of contents|目次)$/i, 'indice'],
  [/^(dedicatoria|dedication)/i, 'dedicatoria'],
  [/^(ap[eé]ndice|anexo|appendix)/i, 'apendice'],
  [/^(cap[ií]tulo|chapter|cap\.|第.+[章話])/i, 'capitulo'],
  [/^(\d+|[IVXLC]+)[.:\s-]/, 'capitulo'],
];

const TIPOS_EPUB: [string, TipoSeccion][] = [
  ['cover', 'portada'],
  ['prologue', 'prologo'],
  ['epilogue', 'epilogo'],
  ['afterword', 'posfacio'],
  ['copyright-page', 'creditos'],
  ['colophon', 'creditos'],
  ['toc', 'indice'],
  ['dedication', 'dedicatoria'],
  ['appendix', 'apendice'],
  ['chapter', 'capitulo'],
  // Portadilla (título, autor): no es un capítulo.
  ['titlepage', 'otro'],
  ['halftitlepage', 'otro'],
];

function clasificar(tipos: string[], titulo: string, archivo: string, bloques: Bloque[], esPrimero: boolean, portada?: string): TipoSeccion {
  for (const [t, tipo] of TIPOS_EPUB) if (tipos.includes(t)) return tipo;
  const soloImagenes = bloques.length > 0 && bloques.every((b) => b.tipo === 'imagen' || (b.tipo === 'parrafo' && !b.contenido.length));
  if (soloImagenes) {
    const img = bloques.find((b) => b.tipo === 'imagen');
    if (img && img.tipo === 'imagen' && (img.recurso === portada || (esPrimero && /cover|portada/i.test(archivo)))) return 'portada';
    return 'ilustracion';
  }
  for (const [re, tipo] of PATRONES_TIPO) if (re.test(titulo.trim())) return tipo;
  const nombreArchivo = archivo.split('/').pop() ?? '';
  if (/title[_-]?page|portadilla/i.test(nombreArchivo)) return 'otro';
  if (/cover|portada/i.test(nombreArchivo) && esPrimero) return 'portada';
  if (/toc|contents|indice/i.test(nombreArchivo)) return 'indice';
  if (/copyright|creditos|colophon/i.test(nombreArchivo)) return 'creditos';
  if (/chap|cap|ch\d/i.test(nombreArchivo)) return 'capitulo';
  return titulo ? 'capitulo' : 'otro';
}

function etiquetasNavegacion(zip: Map<string, string>, rutaNav: string | undefined, rutaNcx: string | undefined): Map<string, string> {
  const etiquetas = new Map<string, string>();
  if (rutaNav && zip.has(rutaNav)) {
    const { documento } = analizarXhtml(zip.get(rutaNav)!);
    const nav = buscar(documento, (n) => nombre(n) === 'nav' && tiposEpub(n).includes('toc')) ?? buscar(documento, (n) => nombre(n) === 'nav');
    if (nav) {
      for (const a of todos(nav, (n) => nombre(n) === 'a')) {
        const destino = resolverRuta(rutaNav, attr(a, 'href'));
        const etiqueta = texto(a).replace(/\s+/g, ' ').trim();
        if (etiqueta && !etiquetas.has(destino)) etiquetas.set(destino, etiqueta);
      }
    }
  }
  if (!etiquetas.size && rutaNcx && zip.has(rutaNcx)) {
    const ncx = analizarXml(zip.get(rutaNcx)!);
    for (const np of todos(ncx, (n) => nombre(n) === 'navpoint')) {
      const label = buscar(np, (n) => nombre(n) === 'text');
      const content = buscar(np, (n) => nombre(n) === 'content');
      if (!label || !content) continue;
      const destino = resolverRuta(rutaNcx, attr(content, 'src'));
      if (!etiquetas.has(destino)) etiquetas.set(destino, texto(label).replace(/\s+/g, ' ').trim());
    }
  }
  return etiquetas;
}

interface EntradaNav {
  /** Ruta del documento (sin fragmento). */
  ruta: string;
  fragmento: string;
  etiqueta: string;
  nivel: number;
}

/** Índice del nav (o del NCX) con sus niveles, para leer los textos del índice y los subtítulos que salen en él. */
function indiceNavegacion(zip: Map<string, string>, rutaNav: string | undefined, rutaNcx: string | undefined): { entradas: EntradaNav[]; dosNiveles: boolean } {
  const entradas: EntradaNav[] = [];
  let dosNiveles = false;
  const nivelDe = (n: Nodo, contenedor: string) => {
    let k = 0;
    for (let p = n.parentNode as Nodo | null; p; p = p.parentNode as Nodo | null) if (p.nodeType === 1 && nombre(p) === contenedor) k++;
    return k;
  };
  const anadir = (base: string, href: string, etiqueta: string, nivel: number) => {
    const destino = resolverRuta(base, href);
    const [ruta, fragmento = ''] = destino.split('#');
    if (etiqueta) entradas.push({ ruta, fragmento, etiqueta, nivel });
  };
  if (rutaNav && zip.has(rutaNav)) {
    const { documento } = analizarXhtml(zip.get(rutaNav)!);
    const nav = buscar(documento, (n) => nombre(n) === 'nav' && tiposEpub(n).includes('toc')) ?? buscar(documento, (n) => nombre(n) === 'nav');
    if (nav) {
      dosNiveles = clases(nav).includes('dos-niveles');
      for (const a of todos(nav, (n) => nombre(n) === 'a')) anadir(rutaNav, attr(a, 'href'), texto(a).replace(/\s+/g, ' ').trim(), nivelDe(a, 'ol'));
    }
  } else if (rutaNcx && zip.has(rutaNcx)) {
    const ncx = analizarXml(zip.get(rutaNcx)!);
    for (const np of todos(ncx, (n) => nombre(n) === 'navpoint')) {
      const label = buscar(np, (n) => nombre(n) === 'text');
      const content = hijosElemento(np).find((n) => nombre(n) === 'content');
      if (label && content) anadir(rutaNcx, attr(content, 'src'), texto(label).replace(/\s+/g, ' ').trim(), nivelDe(np, 'navpoint') + 1);
    }
  }
  const minimo = Math.min(...entradas.map((e) => e.nivel));
  for (const e of entradas) e.nivel = e.nivel - minimo + 1;
  return { entradas, dosNiveles: dosNiveles || entradas.some((e) => e.nivel === 2) };
}

const TEXTO_LLAMADA = /^\s*(\[?\(?\*?\d{1,3}\)?\]?|\*{1,3}|※\d{0,3}|[†‡§]|[a-z])\s*$/i;
const TIPOS_NOTA = ['footnote', 'endnote', 'rearnote', 'note', 'footnotes', 'endnotes', 'rearnotes'];

/** Opciones de la conversión sencilla: qué del original se conserva al importar. */
export interface OpcionesImportacion {
  /** Párrafos vacíos (líneas en blanco). */
  vacios?: boolean;
  /** Espacio general del párrafo del original: los que se aparten de él conservan el suyo. */
  espaciado?: { arriba: number; abajo: number };
  /** Tamaño, color y fondo que dan las clases CSS a los fragmentos. */
  aspectos?: boolean;
  /** Estilo propio del libro que corresponde a cada párrafo del original. */
  estiloPropio?: (n: Nodo) => string | undefined;
  /** Párrafos de símbolos que son separadores de escena del original. */
  esSeparador?: (texto: string) => boolean;
  /** Nombre del archivo de la imagen que hace de separador de escena en el original. */
  separadorImagen?: string;
  /** Clases de capitulares hechas con un span (no se convierte su tamaño). */
  ignorarClases?: string[];
  /** Los h2 también abren capítulo. */
  cortarEnH2?: boolean;
  /** Saltos de página del original que abren capítulo. */
  saltoPagina?: (n: Nodo) => { antes: boolean; despues: boolean };
}

export async function importarEpub(datos: Uint8Array, importacion: OpcionesImportacion = {}): Promise<ResultadoImportacion> {
  const avisos: AvisoImportacion[] = [];
  const zip = await JSZip.loadAsync(datos);
  const textos = new Map<string, string>();
  const binarios = new Map<string, Uint8Array>();
  for (const [ruta, f] of Object.entries(zip.files)) {
    if (f.dir) continue;
    if (/\.(x?html?|xml|opf|ncx|css)$/i.test(ruta)) textos.set(ruta, await f.async('string'));
    else binarios.set(ruta, await f.async('uint8array'));
  }

  const container = textos.get('META-INF/container.xml');
  if (!container) throw new Error('El archivo no es un EPUB válido: falta META-INF/container.xml.');
  const rootfile = buscar(analizarXml(container), (n) => nombre(n) === 'rootfile');
  const rutaOpf = rootfile ? attr(rootfile, 'full-path') : '';
  if (!rutaOpf || !textos.has(rutaOpf)) throw new Error('El EPUB no tiene un paquete OPF legible.');
  const opf = analizarXml(textos.get(rutaOpf)!);
  const paquete = buscar(opf, (n) => nombre(n) === 'package')!;
  const metadata = buscar(paquete, (n) => nombre(n) === 'metadata');
  const manifest = buscar(paquete, (n) => nombre(n) === 'manifest');
  const spine = buscar(paquete, (n) => nombre(n) === 'spine');
  if (!manifest || !spine) throw new Error('El paquete OPF no tiene manifiesto u orden de lectura.');

  interface Item { id: string; ruta: string; tipo: string; props: string[] }
  const items = new Map<string, Item>();
  for (const it of hijosElemento(manifest).filter((n) => nombre(n) === 'item')) {
    items.set(attr(it, 'id'), {
      id: attr(it, 'id'),
      ruta: resolverRuta(rutaOpf, attr(it, 'href')),
      tipo: attr(it, 'media-type'),
      props: attr(it, 'properties').split(/\s+/).filter(Boolean),
    });
  }

  // --- Metadatos ---
  const md = metadata ? hijosElemento(metadata) : [];
  const dc = (n: string) => md.filter((x) => nombre(x) === n);
  const refina = (id: string, prop: string) =>
    md.find((x) => nombre(x) === 'meta' && attr(x, 'refines') === `#${id}` && attr(x, 'property') === prop);
  const metaProp = (prop: string) => md.find((x) => nombre(x) === 'meta' && attr(x, 'property') === prop);
  const metaNombre = (n: string) => md.find((x) => nombre(x) === 'meta' && attr(x, 'name') === n);

  const titulos = dc('title');
  const principal = titulos.find((t) => texto(refina(attr(t, 'id'), 'title-type') ?? ({ textContent: '' } as Nodo)).trim() !== 'subtitle') ?? titulos[0];
  const subtitulo = titulos.find((t) => texto(refina(attr(t, 'id'), 'title-type') ?? ({ textContent: '' } as Nodo)).trim() === 'subtitle');
  const creditos: Credito[] = [];
  for (const c of [...dc('creator'), ...dc('contributor')]) {
    const n = texto(c).trim();
    if (!n) continue;
    let rol = (attr(c, 'opf:role') || texto(refina(attr(c, 'id'), 'role') ?? ({ textContent: '' } as Nodo))).trim() as RolCredito;
    if (!ROLES_VALIDOS.includes(rol)) {
      if (nombre(c) === 'creator') rol = 'aut';
      else continue;
    }
    creditos.push({ nombre: n, rol });
  }
  const idPaquete = attr(paquete, 'unique-identifier');
  const identificadores = dc('identifier');
  const ident = (identificadores.find((i) => attr(i, 'id') === idPaquete) ?? identificadores[0]);
  const idioma = texto(dc('language')[0] ?? ({ textContent: 'es' } as Nodo)).trim() || 'es';
  const coleccion = md.find((x) => nombre(x) === 'meta' && attr(x, 'property') === 'belongs-to-collection');
  const serie = coleccion ? texto(coleccion).trim() : attr(metaNombre('calibre:series') ?? ({} as Nodo), 'content');
  const volumenTexto = coleccion
    ? texto(refina(attr(coleccion, 'id'), 'group-position') ?? ({ textContent: '' } as Nodo))
    : attr(metaNombre('calibre:series_index') ?? ({} as Nodo), 'content');

  // --- Recursos ---
  const recursos: Recurso[] = [];
  const recursoPorRuta = new Map<string, string>();
  const usados = new Set<string>();
  const anadirRecurso = (ruta: string): string | undefined => {
    if (recursoPorRuta.has(ruta)) return recursoPorRuta.get(ruta);
    const d = binarios.get(ruta) ?? (textos.has(ruta) && /\.svg$/i.test(ruta) ? new TextEncoder().encode(textos.get(ruta)!) : undefined);
    if (!d) return undefined;
    const tipo = tipoPorContenido(d) ?? tipoPorNombre(ruta);
    if (!tipo) {
      avisos.push({ mensaje: `Imagen en un formato que EPUB no admite; se omitió: ${ruta}`, archivo: ruta });
      return undefined;
    }
    const id = nuevoId('i');
    const tam = tamanoImagen(d);
    if (!tam && tipo !== 'image/svg+xml') avisos.push({ mensaje: `La imagen está dañada o incompleta y no se puede leer; el EPUB no pasará la validación hasta que la sustituyas.`, archivo: ruta });
    recursos.push({ id, nombre: nombreSeguro(ruta, usados, tipo), tipoMime: tipo, datos: d, ancho: tam?.ancho, alto: tam?.alto });
    recursoPorRuta.set(ruta, id);
    return id;
  };
  for (const it of items.values()) {
    if (it.tipo.startsWith('image/')) {
      if (it.tipo === 'image/svg+xml' && !binarios.has(it.ruta) && textos.has(it.ruta)) binarios.set(it.ruta, new TextEncoder().encode(textos.get(it.ruta)!));
    }
  }
  let portadaId: string | undefined;
  const itemPortada =
    [...items.values()].find((i) => i.props.includes('cover-image')) ??
    items.get(attr(metaNombre('cover') ?? ({} as Nodo), 'content'));
  if (itemPortada && itemPortada.tipo.startsWith('image/')) portadaId = anadirRecurso(itemPortada.ruta);

  // --- Hojas de estilo ---
  const css = new Map<string, EstiloCss>();
  for (const it of items.values()) if (it.tipo === 'text/css' && textos.has(it.ruta)) analizarCss(textos.get(it.ruta)!, css);

  // --- Navegación (títulos de secciones sin encabezado) ---
  const rutaNav = [...items.values()].find((i) => i.props.includes('nav'))?.ruta;
  const rutaNcx = [...items.values()].find((i) => i.tipo === 'application/x-dtbncx+xml')?.ruta;
  const etiquetas = etiquetasNavegacion(textos, rutaNav, rutaNcx);
  const navegacion = indiceNavegacion(textos, rutaNav, rutaNcx);

  // --- Documentos del orden de lectura ---
  interface Doc { ruta: string; cuerpo: Nodo; ids: Map<string, Nodo>; clases: string[] }
  const docs: Doc[] = [];
  for (const ref of hijosElemento(spine).filter((n) => nombre(n) === 'itemref')) {
    const it = items.get(attr(ref, 'idref'));
    if (!it) {
      avisos.push({ mensaje: `El orden de lectura nombra un documento que no está en el manifiesto («${attr(ref, 'idref')}»); se omitió.` });
      continue;
    }
    if (!textos.has(it.ruta)) {
      if (/x?html/.test(it.tipo)) avisos.push({ mensaje: 'Falta en el EPUB un documento del orden de lectura; esa parte del libro no se pudo importar.', archivo: it.ruta });
      continue;
    }
    if (!/x?html/.test(it.tipo)) continue;
    const { documento, tolerante } = analizarXhtml(textos.get(it.ruta)!);
    if (tolerante) avisos.push({ mensaje: 'XHTML mal formado; se importó con el analizador tolerante.', archivo: it.ruta });
    const cuerpo = buscar(documento, (n) => nombre(n) === 'body');
    if (!cuerpo) continue;
    for (const st of todos(documento, (n) => nombre(n) === 'style')) analizarCss(texto(st), css);
    const ids = new Map<string, Nodo>();
    for (const e of todos(cuerpo, (n) => !!attr(n, 'id'))) ids.set(attr(e, 'id'), e);
    const clasesCuerpo = clases(cuerpo);
    // Segunda mitad de una doble página fija de Obi Studio: la primera ya la representa.
    if (clasesCuerpo.includes('doble-2')) continue;
    docs.push({ ruta: it.ruta, cuerpo, ids, clases: clasesCuerpo });
  }
  const indiceIds = new Map<string, Nodo>();
  for (const d of docs) for (const [id, e] of d.ids) indiceIds.set(`${d.ruta}#${id}`, e);

  // --- Notas: llamadas y cuerpos ---
  const llamadas = new Map<Nodo, string>();
  const cuerpos = new Map<string, Nodo>();
  const nodosCuerpo = new Set<Nodo>();
  const subirABloque = (n: Nodo): Nodo => {
    let x: Nodo | null | undefined = n;
    while (x && !['p', 'li', 'div', 'aside', 'dd', 'section'].includes(nombre(x))) x = x.parentNode;
    return x ?? n;
  };
  for (const d of docs) {
    for (const a of todos(d.cuerpo, (n) => nombre(n) === 'a' && attr(n, 'href').includes('#'))) {
      const href = attr(a, 'href');
      const destinoArchivo = href.startsWith('#') ? d.ruta : resolverRuta(d.ruta, href);
      const clave = `${destinoArchivo}#${href.split('#')[1]}`;
      const destino = indiceIds.get(clave);
      if (!destino) continue;
      const tipos = tiposEpub(a);
      const tiposDestino = tiposEpub(destino);
      const enSup = nombre(a.parentNode ?? a) === 'sup' || hijosElemento(a).some((h) => nombre(h) === 'sup');
      const claseNota = clases(a).some((c) => /note|nota|fn|footnote/i.test(c));
      const esLlamada =
        tipos.includes('noteref') ||
        tiposDestino.some((t) => TIPOS_NOTA.includes(t)) ||
        (TEXTO_LLAMADA.test(texto(a)) && (enSup || claseNota) && !tiposEpub(destino).includes('noteref'));
      if (!esLlamada) continue;
      // El destino de vuelta (la llamada misma) no es una nota.
      if (tiposEpub(destino).includes('noteref') || destino === a) continue;
      // Enlace de vuelta de una nota (EPUB 2, sin epub:type): apunta a un enlace que a su vez apunta a
      // un elemento que contiene este enlace. Sin esto, el párrafo de la llamada se tomaba por la nota.
      if (tipos.includes('backlink') || attr(a, 'role') === 'doc-backlink' || clases(a).some((c) => /back|vuelta|volver|return/i.test(c))) continue;
      if (nombre(destino) === 'a' && attr(destino, 'href').includes('#')) {
        const hrefVuelta = attr(destino, 'href');
        const objetivoVuelta = indiceIds.get(`${hrefVuelta.startsWith('#') ? destinoArchivo : resolverRuta(destinoArchivo, hrefVuelta)}#${hrefVuelta.split('#')[1]}`);
        let x: Nodo | null | undefined = a;
        while (x && x !== objetivoVuelta) x = x.parentNode;
        if (x) continue;
      }
      const cuerpo = nombre(destino) === 'a' || nombre(destino) === 'span' || nombre(destino) === 'sup' ? subirABloque(destino) : destino;
      if (cuerpo === d.cuerpo) continue;
      llamadas.set(a, clave);
      cuerpos.set(clave, cuerpo);
      nodosCuerpo.add(cuerpo);
    }
  }
  const llamadaPorId = new Set<string>();
  for (const a of llamadas.keys()) if (attr(a, 'id')) llamadaPorId.add(attr(a, 'id'));

  const esContenedorDeNotas = (n: Nodo): boolean => {
    if (nodosCuerpo.has(n)) return true;
    const tipos = tiposEpub(n);
    if (tipos.some((t) => ['footnotes', 'endnotes', 'rearnotes'].includes(t))) return true;
    const hijosE = hijosElemento(n);
    if ((nombre(n) === 'ol' || nombre(n) === 'ul') && hijosE.length && hijosE.every((h) => nodosCuerpo.has(h))) return true;
    // Bloque de notas de EPUB 2 (pandoc, Calibre): solo notas, su título y la raya de separación.
    const esNotaOLista = (h: Nodo): boolean => nodosCuerpo.has(h) || ((nombre(h) === 'ol' || nombre(h) === 'ul') && hijosElemento(h).length > 0 && hijosElemento(h).every((x) => nodosCuerpo.has(x)));
    if (['div', 'section', 'aside'].includes(nombre(n)) && hijosE.some(esNotaOLista) && hijosE.every((h) => esNotaOLista(h) || nombre(h) === 'hr' || (/^h[1-6]$/.test(nombre(h)) && texto(h).trim().length < 40))) return true;
    return false;
  };

  let rutaActual = '';
  let idSeparador: string | undefined;
  const { separadorImagen, ignorarClases, ...resto } = importacion;
  const deObiStudio = [...textos.entries()].some(([r, t]) => /\.css$/i.test(r) && t.includes('Generado por Obi Studio'));
  // Sin indicación (abrir en el editor) y en un EPUB ajeno, se corta en los h2 cuando son ellos los capítulos
  // (un documento con «Volumen 1» como h1 y «Capítulo 1»… como h2).
  if (resto.cortarEnH2 === undefined && !deObiStudio) {
    const titulos = (et: string) => docs.flatMap((d) => todos(d.cuerpo, (n) => nombre(n) === et).map((n) => texto(n)));
    if (corteSugerido(titulos('h1'), titulos('h2')) === 'h2') resto.cortarEnH2 = true;
  }
  const opciones: OpcionesConversion = {
    ...resto,
    ...(ignorarClases?.length ? { ignorarClases: new Set(ignorarClases) } : {}),
    ...(separadorImagen
      ? {
          imagenSeparador: (src: string) => {
            const ruta = resolverRuta(rutaActual, src);
            if (ruta.split('/').pop() !== separadorImagen) return false;
            idSeparador ??= anadirRecurso(ruta);
            return !!idSeparador;
          },
        }
      : {}),
    css,
    imagen: (src) => anadirRecurso(resolverRuta(rutaActual, src)),
    rutaCruda: (src) => {
      const id = anadirRecurso(resolverRuta(rutaActual, src));
      const r = recursos.find((x) => x.id === id);
      return r ? rutaImagen(r.nombre) : null;
    },
    claveNota: (a) => llamadas.get(a),
    // Un EPUB de Obi Studio guarda las tablas XHTML tal cual: solo las editables vuelven como tabla.
    ...(deObiStudio ? { tablaEditable: (t: Nodo) => clases(t).includes('tabla') } : {}),
    esCuerpoNota: esContenedorDeNotas,
    esEnlaceVuelta: (a) => {
      const href = attr(a, 'href');
      const frag = href.split('#')[1];
      return tiposEpub(a).includes('backlink') || (!!frag && llamadaPorId.has(frag));
    },
  };

  // --- Conversión ---
  const secciones: Seccion[] = [];
  const deDocConNotas = new Set<Seccion>();
  const rutasConNotas = new Set([...cuerpos.keys()].map((c) => c.split('#')[0]));
  const claveASeccion = new Map<Seccion, Set<string>>();
  docs.forEach((d, k) => {
    rutaActual = d.ruta;
    const tiposCuerpo = tiposEpub(d.cuerpo);
    const seccionRaiz = hijosElemento(d.cuerpo).length === 1 ? hijosElemento(d.cuerpo)[0] : undefined;
    const tiposRaiz = seccionRaiz ? tiposEpub(seccionRaiz) : [];
    const partes = convertirBloques(d.cuerpo, opciones, idioma);
    partes.forEach((p, j) => {
      const tipos = [...p.tipos, ...(j === 0 ? [...tiposRaiz, ...tiposCuerpo] : [])];
      const etiqueta = j === 0 ? etiquetas.get(d.ruta) : undefined;
      const titulo = p.titulo ?? p.etiqueta ?? etiqueta ?? '';
      // En un EPUB de Obi Studio la sección lleva su tipo como clase (así vuelven «otro» e «interludio»).
      const tipoPropio = deObiStudio && j === 0 && seccionRaiz ? (clases(seccionRaiz).find((c) => TIPOS_SECCION.some((t) => t.id === c)) as TipoSeccion | undefined) : undefined;
      const tipo = tipoPropio ?? clasificar(tipos, titulo, d.ruta, p.bloques, k === 0 && j === 0, portadaId);
      const s = nuevaSeccion(tipo, titulo);
      s.mostrarTitulo = p.titulo !== undefined && !!p.titulo;
      s.enIndice = !!titulo && !['portada', 'ilustracion'].includes(tipo);
      if (navegacion.entradas.length && j === 0 && titulo) {
        // Con índice: la sección sale en él si el índice apunta a su documento, con el texto que tenga allí.
        const enNav = navegacion.entradas.find((e) => e.ruta === d.ruta && e.nivel === 1) ?? navegacion.entradas.find((e) => e.ruta === d.ruta);
        if (!enNav) s.enIndice = false;
        else if (enNav.nivel === 1 && enNav.etiqueta !== titulo.replace(/\s+/g, ' ').trim()) s.tituloIndice = enNav.etiqueta;
      }
      if (navegacion.dosNiveles) {
        // Subtítulos que no salen en un índice de dos niveles (se comparan por su texto).
        const textosNav = new Set(navegacion.entradas.filter((e) => e.ruta === d.ruta && e.nivel >= 2).map((e) => e.etiqueta));
        for (const b of p.bloques) if (b.tipo === 'subtitulo' && b.nivel === 2 && !b.fueraDeIndice && !textosNav.has(textoPlano(b.contenido).replace(/\s+/g, ' ').trim())) b.fueraDeIndice = true;
      }
      s.bloques = tipo === 'indice' ? [] : p.bloques;
      if (p.imagenCabecera) s.imagenCabecera = p.imagenCabecera;
      if (d.clases.includes('fija') && (tipo === 'ilustracion' || tipo === 'portada')) s.paginaFija = true;
      if (d.clases.includes('doble') && tipo === 'ilustracion') s.doblePagina = true;
      if (tipo === 'portada' && !portadaId) {
        const img = p.bloques.find((b) => b.tipo === 'imagen');
        if (img && img.tipo === 'imagen') portadaId = img.recurso;
      }
      const claves = new Set<string>();
      const ver = (l: Inline[]) => l.forEach((i) => i.tipo === 'nota' && claves.add(i.id));
      for (const b of s.bloques) {
        if (b.tipo === 'parrafo' || b.tipo === 'subtitulo') ver(b.contenido);
        if (b.tipo === 'lista') b.elementos.forEach(ver);
        if (b.tipo === 'tabla') b.filas.forEach((f) => f.forEach((c) => ver(c.contenido)));
        if (b.tipo === 'recuadro') b.lineas.forEach((x) => ver(x.contenido));
      }
      claveASeccion.set(s, claves);
      if (rutasConNotas.has(d.ruta)) deDocConNotas.add(s);
      secciones.push(s);
    });
  });

  // --- Asignar notas a la sección que las llama ---
  const contenidoPorClave = new Map<string, Inline[]>();
  for (const [clave, cuerpo] of cuerpos) {
    rutaActual = clave.split('#')[0];
    contenidoPorClave.set(clave, contenidoNota(cuerpo, opciones, idioma));
  }
  for (const s of secciones) {
    const mapa = new Map<string, string>();
    const notas: Nota[] = [];
    for (const clave of claveASeccion.get(s) ?? []) {
      const contenido = contenidoPorClave.get(clave);
      if (!contenido) continue;
      const id = nuevoId('n');
      mapa.set(clave, id);
      notas.push({ id, contenido: structuredClone(contenido) });
    }
    const cambiar = (l: Inline[]) => l.filter((i) => i.tipo !== 'nota' || mapa.has(i.id)).map((i) => (i.tipo === 'nota' ? { ...i, id: mapa.get(i.id)! } : i));
    for (const b of s.bloques) {
      if (b.tipo === 'parrafo' || b.tipo === 'subtitulo') b.contenido = cambiar(b.contenido);
      if (b.tipo === 'lista') b.elementos = b.elementos.map(cambiar);
      if (b.tipo === 'tabla') b.filas.forEach((f) => f.forEach((c) => (c.contenido = cambiar(c.contenido))));
      if (b.tipo === 'recuadro') b.lineas.forEach((x) => (x.contenido = cambiar(x.contenido)));
    }
    s.notas = notas;
  }

  const finales = secciones.filter((s) => s.bloques.length || (deDocConNotas.has(s) ? false : s.tipo === 'indice' || s.tipo === 'portada' || (s.titulo && s.mostrarTitulo)));
  if (!finales.length) throw new Error('El EPUB no tiene contenido legible.');

  // Escritura vertical: progresión de derecha a izquierda y writing-mode vertical en las hojas de estilo.
  const cssTexto = [...items.values()].filter((i) => i.tipo === 'text/css').map((i) => textos.get(i.ruta) ?? '').join('\n');
  const vertical = attr(spine, 'page-progression-direction') === 'rtl' && /writing-mode\s*:\s*vertical-rl/i.test(cssTexto);

  const libro: Libro = {
    formato: 'obi-studio',
    version: 1,
    metadatos: {
      titulo: principal ? texto(principal).trim() : 'Sin título',
      subtitulo: subtitulo ? texto(subtitulo).trim() : undefined,
      creditos,
      idioma,
      identificador: ident ? texto(ident).trim() : `urn:uuid:${uuid()}`,
      fecha: dc('date')[0] ? texto(dc('date')[0]).trim().slice(0, 10) : undefined,
      editorial: dc('publisher')[0] ? texto(dc('publisher')[0]).trim() : undefined,
      descripcion: dc('description')[0] ? texto(dc('description')[0]).replace(/<[^>]+>/g, '').trim() : undefined,
      derechos: dc('rights')[0] ? texto(dc('rights')[0]).trim() : undefined,
      serie: serie || undefined,
      volumen: volumenTexto && !isNaN(parseFloat(volumenTexto)) ? parseFloat(volumenTexto) : undefined,
      resumenAccesibilidad: (() => {
        const r = metaProp('schema:accessibilitySummary') ? texto(metaProp('schema:accessibilitySummary')!).trim() : '';
        // El resumen automático de Obi Studio se vuelve a generar al compilar.
        return r && !r.startsWith('Libro con navegación estructurada') ? r : undefined;
      })(),
      portada: portadaId,
    },
    secciones: finales,
    recursos,
    tema: { ...TEMA_PREDETERMINADO, ...(idSeparador ? { separador: 'imagen' as const, separadorImagen: idSeparador } : {}) },
    tipografia: { ...TIPOGRAFIA_PREDETERMINADA },
    ...(vertical ? { escritura: 'vertical' as const } : {}),
    ...(navegacion.dosNiveles ? { profundidadIndice: 2 as const } : {}),
  };
  for (const k of Object.keys(libro.metadatos) as (keyof Libro['metadatos'])[]) {
    if (libro.metadatos[k] === undefined || libro.metadatos[k] === '') delete libro.metadatos[k];
  }
  // Recursos no usados (p. ej. imágenes del manifiesto que nadie muestra) quedan fuera.
  const usadosIds = new Set<string>();
  if (libro.metadatos.portada) usadosIds.add(libro.metadatos.portada);
  if (libro.tema.separadorImagen) usadosIds.add(libro.tema.separadorImagen);
  for (const s of libro.secciones) for (const b of [...s.bloques, ...(s.imagenCabecera ? [{ tipo: 'imagen', recurso: s.imagenCabecera } as const] : [])]) {
    if (b.tipo === 'imagen') usadosIds.add(b.recurso);
    if (b.tipo === 'crudo') for (const r of recursos) if (b.xhtml.includes(rutaImagen(r.nombre))) usadosIds.add(r.id);
  }
  libro.recursos = recursos.filter((r) => usadosIds.has(r.id));
  return { libro, avisos };
}

export { ELEMENTO };
