// Importador de Word (.docx) con mammoth.
// Conserva capítulos (Título 1), subtítulos, negrita, cursiva, alineación, estilos propios de novela ligera,
// notas al pie, enlaces e imágenes con su texto alternativo.

import JSZip from 'jszip';
import mammoth from 'mammoth';
import type { Libro, Nota, Recurso, Seccion, Inline } from '../model.js';
import { TEMA_PREDETERMINADO, TIPOGRAFIA_PREDETERMINADA, nuevoId, nuevaSeccion, uuid, normalizarInlines } from '../model.js';
import { tamanoImagen, tipoPorContenido, extension } from '../imagen.js';
import { analizarHtml, analizarXml, attr, buscar, nombre, texto, todos, type Nodo } from './dom.js';
import { contenidoNota, convertirBloques, type OpcionesConversion } from './convertir.js';
import type { ResultadoImportacion } from './epub.js';
import { rutaImagen } from '../compilar.js';

// Estilos de Word (en español e inglés) que se convierten en estilos de párrafo de Obi Studio.
// Saltos de página de Word: se convierten en el salto de página de Obi Studio (o cortan capítulo).
const MAPA_SALTOS = ["br[type='page'] => hr.salto-pagina"];

const MAPA_ESTILOS = [
  "p[style-name='Pensamiento'] => p.pensamiento:fresh",
  "p[style-name='Thought'] => p.pensamiento:fresh",
  "p[style-name='Onomatopeya'] => p.onomatopeya:fresh",
  "p[style-name='Carta'] => p.carta:fresh",
  "p[style-name='Letter'] => p.carta:fresh",
  "p[style-name='Cita'] => p.cita:fresh",
  "p[style-name='Quote'] => p.cita:fresh",
  "p[style-name='Intense Quote'] => p.cita:fresh",
  "p[style-name='Cita destacada'] => p.cita:fresh",
  "p[style-name='Sin sangría'] => p.sin-sangria:fresh",
  "p[style-name='SinSangria'] => p.sin-sangria:fresh",
  "p[style-name='ObiCentrado'] => p.centrado:fresh",
  "p[style-name='ObiDerecha'] => p.derecha:fresh",
  "p[style-name='Title'] => h1.titulo-documento:fresh",
  "p[style-name='Título'] => h1.titulo-documento:fresh",
  "p[style-name='Subtitle'] => p.subtitulo-documento:fresh",
  "p[style-name='Subtítulo'] => p.subtitulo-documento:fresh",
  "r[style-name='Versalitas'] => span.vs",
  "r[style-name='Énfasis'] => span.boten",
  "r[style-name='Enfasis'] => span.boten",
  'small-caps => span.vs',
  'u => u',
  'strike => s',
];

/** Furigana escrita en Word con la convención de Aozora Bunko: ｜base《lectura》 o kanji《lectura》 → furigana. */
export function rubiesDeTexto(lista: Inline[]): Inline[] {
  const salida: Inline[] = [];
  const re = /｜([^｜《》]+)《([^》]+)》|([\p{Script=Han}々〆ヶ]+)《([^》]+)》/gu;
  for (const i of lista) {
    if (i.tipo !== 'texto' || !i.texto.includes('《')) {
      salida.push(i);
      continue;
    }
    let ultimo = 0;
    for (const m of i.texto.matchAll(re)) {
      if (m.index! > ultimo) salida.push({ ...i, texto: i.texto.slice(ultimo, m.index) });
      const ruby: Inline = { tipo: 'ruby', base: m[1] ?? m[3], lectura: m[2] ?? m[4] };
      if (i.marcas?.length) ruby.marcas = [...i.marcas];
      salida.push(ruby);
      ultimo = m.index! + m[0].length;
    }
    if (ultimo < i.texto.length) salida.push({ ...i, texto: i.texto.slice(ultimo) });
  }
  return normalizarInlines(salida);
}

/** «Salto de página antes» directo de un párrafo de Word: mammoth no lo lee, así que se cambia por un salto al principio. */
async function conSaltosAntes(datos: Uint8Array): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(datos);
  const doc = await zip.file('word/document.xml')?.async('string');
  if (!doc || !/<w:pageBreakBefore(?![^>]*w:val="(0|false|off)")[^>]*\/>/.test(doc)) return datos;
  const nuevo = doc.replace(/(<w:p\b[^>]*>)(\s*<w:pPr>(?:(?!<\/w:pPr>)[\s\S])*?<w:pageBreakBefore(?![^>]*w:val="(?:0|false|off)")[^>]*\/>[\s\S]*?<\/w:pPr>)/g, '$1$2<w:r><w:br w:type="page"/></w:r>');
  zip.file('word/document.xml', nuevo);
  return zip.generateAsync({ type: 'uint8array' });
}

/** Saltos de página que hay en un Word (para ofrecer cortar capítulos por ellos). */
export function contarSaltosWord(documentXml: string): number {
  return (documentXml.match(/<w:br\b[^>]*w:type="page"[^>]*\/>/g) ?? []).length + (documentXml.match(/<w:pageBreakBefore(?![^>]*w:val="(?:0|false|off)")[^>]*\/>/g) ?? []).length;
}

const MARCADOR_SALTO_WORD = /^⟦Salto de página[^⟧]*⟧$/;

/** Saca los saltos de página (hr.salto-pagina que mammoth deja dentro del párrafo) a un div entre dos párrafos. */
function sacarSaltos(cuerpo: Nodo) {
  for (const hr of todos(cuerpo, (n) => nombre(n) === 'hr' && attr(n, 'class').includes('salto-pagina'))) {
    const p = hr.parentNode as Nodo | null;
    const doc = (hr as unknown as { ownerDocument: { createElement(n: string): Nodo } }).ownerDocument;
    const quitar = (n: Nodo) => (n.parentNode as unknown as { removeChild(x: Nodo): void }).removeChild(n);
    // El marcador del Word de corrección ya dice dónde va el salto.
    if (p && MARCADOR_SALTO_WORD.test(texto(p).trim())) {
      quitar(hr);
      continue;
    }
    const div = doc.createElement('div');
    (div as unknown as { setAttribute(a: string, v: string): void }).setAttribute('class', 'salto-pagina');
    const siguiente = (n: Nodo) => (n as unknown as { nextSibling: Nodo | null }).nextSibling;
    const insertar = (nuevo: Nodo, despuesDe: Nodo) => (despuesDe.parentNode as unknown as { insertBefore(a: Nodo, b: Nodo | null): void }).insertBefore(nuevo, siguiente(despuesDe));
    if (!p || !/^(p|h[1-6]|li)$/.test(nombre(p))) {
      insertar(div, hr);
      quitar(hr);
      continue;
    }
    const segundo = (p as unknown as { cloneNode(d: boolean): Nodo }).cloneNode(false);
    for (let x = siguiente(hr); x; x = siguiente(hr)) (segundo as unknown as { appendChild(x: unknown): void }).appendChild(x);
    quitar(hr);
    insertar(div, p);
    insertar(segundo, div);
    const vacio = (n: Nodo) => !texto(n).trim() && !todos(n, (x) => nombre(x) === 'img').length;
    if (vacio(segundo)) quitar(segundo);
    if (vacio(p)) quitar(p);
  }
}

export async function importarDocx(
  datos: Uint8Array,
  /** `saltos: false` ignora los saltos de página (el Word de corrección los pone entre capítulos). */
  importacion: { vacios?: boolean; cortarEnH2?: boolean; cortarEnSaltos?: boolean; saltos?: boolean } = {},
): Promise<ResultadoImportacion> {
  const avisos: ResultadoImportacion['avisos'] = [];
  const recursos: Recurso[] = [];
  const usados = new Set<string>();

  const saltos = importacion.saltos !== false;
  if (saltos) datos = await conSaltosAntes(datos);
  const buffer = Buffer.from(datos.buffer, datos.byteOffset, datos.byteLength);
  const resultado = await mammoth.convertToHtml(
    { buffer },
    {
      styleMap: saltos ? [...MAPA_SALTOS, ...MAPA_ESTILOS] : MAPA_ESTILOS,
      includeDefaultStyleMap: true,
      ...(importacion.vacios ? { ignoreEmptyParagraphs: false } : {}),
      // Mammoth no exporta la alineación: se convierte en un estilo antes de transformar.
      transformDocument: (mammoth as any).transforms.paragraph((p: any) => {
        if (p.styleId || p.styleName) {
          if (p.alignment === 'center' && /^(Normal|Body Text|Texto independiente)$/i.test(p.styleName ?? '')) {
            return { ...p, styleId: 'ObiCentrado', styleName: 'ObiCentrado' };
          }
          return p;
        }
        if (p.alignment === 'center') return { ...p, styleId: 'ObiCentrado', styleName: 'ObiCentrado' };
        if (p.alignment === 'right') return { ...p, styleId: 'ObiDerecha', styleName: 'ObiDerecha' };
        return p;
      }),
      convertImage: mammoth.images.imgElement(async (imagen: any) => {
        const d = new Uint8Array(await imagen.read());
        const tipo = tipoPorContenido(d);
        if (!tipo) {
          avisos.push({ mensaje: 'Se omitió una imagen en un formato que EPUB no admite (por ejemplo EMF o TIFF).' });
          return { src: '' };
        }
        const id = nuevoId('i');
        let nombreArchivo = `imagen-${recursos.length + 1}.${extension(tipo)}`;
        while (usados.has(nombreArchivo)) nombreArchivo = `imagen-${recursos.length + 1}-${usados.size}.${extension(tipo)}`;
        usados.add(nombreArchivo);
        const tam = tamanoImagen(d);
        recursos.push({ id, nombre: nombreArchivo, tipoMime: tipo, datos: d, ancho: tam?.ancho, alto: tam?.alto });
        return { src: `obi-recurso:${id}`, alt: imagen.altText ?? '' };
      }),
    },
  );
  for (const m of resultado.messages) {
    if (m.type === 'warning' && /Unrecognised paragraph style/.test(m.message)) {
      const estilo = m.message.match(/'([^']+)'/)?.[1];
      if (estilo && !avisos.some((a) => a.mensaje.includes(estilo))) {
        avisos.push({ mensaje: `El estilo de Word «${estilo}» se importó como texto normal.` });
      }
    }
  }

  const documento = analizarHtml(resultado.value);
  const cuerpo = buscar(documento, (n) => nombre(n) === 'body')!;
  sacarSaltos(cuerpo);

  // Notas al pie y finales de mammoth: <a href="#footnote-1" id="footnote-ref-1"> y <li id="footnote-1">.
  const cuerpos = new Map<string, Nodo>();
  for (const li of todos(cuerpo, (n) => nombre(n) === 'li' && /^(footnote|endnote)-\d+$/.test(attr(n, 'id')))) {
    cuerpos.set(attr(li, 'id'), li);
  }
  const valoresCuerpo = new Set(cuerpos.values());

  // Título del documento (estilo Título) a metadatos.
  const tituloDoc = buscar(cuerpo, (n) => nombre(n) === 'h1' && attr(n, 'class').includes('titulo-documento'));
  const subtituloDoc = buscar(cuerpo, (n) => nombre(n) === 'p' && attr(n, 'class').includes('subtitulo-documento'));
  const quitar = (n?: Nodo) => {
    const padre = n?.parentNode as unknown as { removeChild(x: unknown): void } | undefined;
    if (n && padre) padre.removeChild(n);
  };
  const tituloTexto = tituloDoc ? texto(tituloDoc).trim() : '';
  const subtituloTexto = subtituloDoc ? texto(subtituloDoc).trim() : '';
  quitar(tituloDoc);
  quitar(subtituloDoc);

  const opciones: OpcionesConversion = {
    vacios: importacion.vacios,
    ...(importacion.cortarEnH2 ? { cortarEnH2: true } : {}),
    ...(importacion.cortarEnSaltos ? { saltoPagina: (n: Nodo) => ({ antes: nombre(n) === 'div' && attr(n, 'class').includes('salto-pagina'), despues: false }) } : {}),
    css: new Map(),
    imagen: (src) => (src.startsWith('obi-recurso:') ? src.slice('obi-recurso:'.length) : undefined),
    rutaCruda: (src) => {
      const r = recursos.find((x) => `obi-recurso:${x.id}` === src);
      return r ? rutaImagen(r.nombre) : null;
    },
    claveNota: (a) => {
      const frag = attr(a, 'href').replace(/^#/, '');
      return cuerpos.has(frag) ? frag : undefined;
    },
    esCuerpoNota: (n) => valoresCuerpo.has(n) || (nombre(n) === 'ol' && Array.from(n.childNodes).some((h) => valoresCuerpo.has(h))),
    esEnlaceVuelta: (a) => /^#(footnote|endnote)-ref-\d+$/.test(attr(a, 'href')),
  };

  const partes = convertirBloques(cuerpo, opciones, 'es');
  // En Word es habitual un salto de página antes de cada capítulo: al principio o al final de un capítulo no hace nada.
  for (const p of partes) {
    while (p.bloques[0]?.tipo === 'saltoPagina') p.bloques.shift();
    while (p.bloques[p.bloques.length - 1]?.tipo === 'saltoPagina') p.bloques.pop();
  }
  const secciones: Seccion[] = [];
  partes.forEach((p, k) => {
    const sinTitulo = p.titulo === undefined;
    if (sinTitulo && !p.bloques.length) return;
    const titulo = p.titulo ?? (k === 0 && partes.length > 1 ? '' : tituloTexto || 'Capítulo 1');
    let tipo: Seccion['tipo'] = 'capitulo';
    if (/^(pr[oó]logo|prologue)/i.test(titulo)) tipo = 'prologo';
    else if (/^(ep[ií]logo|epilogue)/i.test(titulo)) tipo = 'epilogo';
    else if (/^(posfacio|afterword|palabras del autor|nota del autor|あとがき)/i.test(titulo)) tipo = 'posfacio';
    else if (/^(interludio|interlude)/i.test(titulo)) tipo = 'interludio';
    else if (/^(dedicatoria)/i.test(titulo)) tipo = 'dedicatoria';
    else if (/^(cr[eé]ditos)/i.test(titulo)) tipo = 'creditos';
    else if (!titulo && k === 0) tipo = 'otro';
    const s = nuevaSeccion(tipo, titulo);
    s.mostrarTitulo = !!p.titulo;
    s.enIndice = !!titulo;
    s.bloques = p.bloques;
    const notas: Nota[] = [];
    const mapa = new Map<string, string>();
    const cambiar = (l: Inline[]): Inline[] =>
      l.map((i) => {
        if (i.tipo !== 'nota') return i;
        if (!mapa.has(i.id)) {
          const id = nuevoId('n');
          mapa.set(i.id, id);
          notas.push({ id, contenido: contenidoNota(cuerpos.get(i.id)!, opciones, 'es') });
        }
        return { ...i, id: mapa.get(i.id)! };
      });
    for (const b of s.bloques) {
      if (b.tipo === 'parrafo' || b.tipo === 'subtitulo') b.contenido = rubiesDeTexto(cambiar(b.contenido));
      if (b.tipo === 'lista') b.elementos = b.elementos.map((e) => rubiesDeTexto(cambiar(e)));
      if (b.tipo === 'tabla') b.filas.forEach((f) => f.forEach((c) => (c.contenido = rubiesDeTexto(cambiar(c.contenido)))));
    }
    for (const n of notas) n.contenido = rubiesDeTexto(n.contenido);
    s.notas = notas;
    secciones.push(s);
  });
  if (!secciones.length) secciones.push({ ...nuevaSeccion('capitulo', 'Capítulo 1'), bloques: [{ tipo: 'parrafo', estilo: 'cuerpo', contenido: [] }] });

  // Metadatos de docProps/core.xml.
  let tituloCore = '';
  let autorCore = '';
  try {
    const zip = await JSZip.loadAsync(datos);
    const core = await zip.file('docProps/core.xml')?.async('string');
    if (core) {
      const x = analizarXml(core);
      tituloCore = texto(buscar(x, (n) => nombre(n) === 'title') ?? ({ textContent: '' } as Nodo)).trim();
      autorCore = texto(buscar(x, (n) => nombre(n) === 'creator') ?? ({ textContent: '' } as Nodo)).trim();
    }
  } catch {
    /* sin metadatos */
  }

  const libro: Libro = {
    formato: 'obi-studio',
    version: 1,
    metadatos: {
      titulo: tituloTexto || tituloCore || 'Libro sin título',
      subtitulo: subtituloTexto || undefined,
      creditos: autorCore ? [{ nombre: autorCore, rol: 'aut' }] : [],
      idioma: 'es',
      identificador: `urn:uuid:${uuid()}`,
      fecha: new Date().toISOString().slice(0, 10),
    },
    secciones,
    recursos,
    tema: { ...TEMA_PREDETERMINADO },
    tipografia: { ...TIPOGRAFIA_PREDETERMINADA },
  };
  if (!libro.metadatos.subtitulo) delete libro.metadatos.subtitulo;
  return { libro, avisos };
}
