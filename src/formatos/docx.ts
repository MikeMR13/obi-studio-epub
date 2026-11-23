// Importador de Word (.docx) con mammoth.
// Conserva capítulos (Título 1), subtítulos, negrita, cursiva, alineación, estilos propios de novela ligera,
// notas al pie, enlaces e imágenes con su texto alternativo.

import JSZip from 'jszip';
import { corteSugerido } from './cortes.js';
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
  'p.ObiTitulo1 => h1:fresh',
  'p.ObiTitulo2 => h2:fresh',
  'p.ObiSeparador => hr:fresh',
  "p[style-name='Pie de imagen'] => p.pie-imagen:fresh",
  "p[style-name='Caption'] => p.pie-imagen:fresh",
  "p[style-name='Descripción'] => p.pie-imagen:fresh",
  "p[style-name='Epígrafe'] => p.pie-imagen:fresh",
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
  "p[style-name='Author'] => p.autor-documento:fresh",
  "p[style-name='Autor'] => p.autor-documento:fresh",
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
/**
 * Líneas horizontales de Word (separadores de escena): un párrafo vacío con borde, o la «línea horizontal»
 * (`o:hr`). Mammoth no las ve; se les pone un estilo que el mapa convierte en <hr>.
 */
function marcarLineas(doc: string): string {
  return doc.replace(/<w:p\b[^>]*>(?:(?!<\/w:p>)[\s\S])*?<\/w:p>/g, (p) => {
    if (/<w:t(?:\s[^>]*)?>[^<]*\S/.test(p) || /<w:drawing\b/.test(p)) return p;
    const linea = /o:hr="t"/.test(p) || /<w:pBdr>(?:(?!<\/w:pBdr>)[\s\S])*?<w:(bottom|top)\b(?![^>]*w:val="(?:nil|none)")/.test(p);
    if (!linea) return p;
    const sinFiguras = p.replace(/<w:r\b(?:(?!<\/w:r>)[\s\S])*?<w:pict\b[\s\S]*?<\/w:r>/g, '');
    if (/<w:pPr>/.test(sinFiguras)) return sinFiguras.replace(/<w:pPr>(\s*<w:pStyle\b[^>]*\/>)?/, '<w:pPr><w:pStyle w:val="ObiSeparador"/>');
    return sinFiguras.replace(/(<w:p\b[^>]*>)/, '$1<w:pPr><w:pStyle w:val="ObiSeparador"/></w:pPr>');
  });
}

async function conSaltosAntes(datos: Uint8Array, saltos = true): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(datos);
  const original = await zip.file('word/document.xml')?.async('string');
  if (!original) return datos;
  const doc = marcarLineas(original);
  const conSaltos = saltos && /<w:pageBreakBefore(?![^>]*w:val="(0|false|off)")[^>]*\/>/.test(doc);
  if (!conSaltos) {
    if (doc === original) return datos;
    zip.file('word/document.xml', doc);
    return zip.generateAsync({ type: 'uint8array' });
  }
  const nuevo = doc.replace(/(<w:p\b[^>]*>)(\s*<w:pPr>(?:(?!<\/w:pPr>)[\s\S])*?<w:pageBreakBefore(?![^>]*w:val="(?:0|false|off)")[^>]*\/>[\s\S]*?<\/w:pPr>)/g, '$1$2<w:r><w:br w:type="page"/></w:r>');
  zip.file('word/document.xml', nuevo);
  return zip.generateAsync({ type: 'uint8array' });
}

/** Saltos de página que hay en un Word (para ofrecer cortar capítulos por ellos). */
export function contarSaltosWord(documentXml: string): number {
  return (documentXml.match(/<w:br\b[^>]*w:type="page"[^>]*\/>/g) ?? []).length + (documentXml.match(/<w:pageBreakBefore(?![^>]*w:val="(?:0|false|off)")[^>]*\/>/g) ?? []).length;
}

const MARCADOR_SALTO_WORD = /^⟦Salto de página[^⟧]*⟧$/;

/** Un pie de imagen (estilo «Pie de imagen» o «Descripción» de Word) justo después de una imagen: figure con figcaption. */
/**
 * Nivel de título (1 o 2) de los estilos de párrafo propios: los basados en «Título 1/2» (heading 1/2)
 * o con nivel de esquema 1/2. Mammoth solo reconoce los estilos de título de Word por su nombre.
 */
export async function nivelesDeEstilos(datos: Uint8Array): Promise<Map<string, number>> {
  const niveles = new Map<string, number>();
  let xml = '';
  try {
    xml = (await (await JSZip.loadAsync(datos)).file('word/styles.xml')?.async('string')) ?? '';
  } catch {
    return niveles;
  }
  const estilos = new Map<string, { nombre: string; base?: string; esquema?: number }>();
  for (const m of xml.matchAll(/<w:style\b[^>]*w:type="paragraph"[^>]*>([\s\S]*?)<\/w:style>/g)) {
    const id = m[0].match(/w:styleId="([^"]+)"/)?.[1];
    if (!id) continue;
    const esquema = m[1].match(/<w:outlineLvl w:val="(\d)"/)?.[1];
    estilos.set(id, { nombre: m[1].match(/<w:name w:val="([^"]+)"/)?.[1] ?? id, base: m[1].match(/<w:basedOn w:val="([^"]+)"/)?.[1], ...(esquema !== undefined ? { esquema: Number(esquema) } : {}) });
  }
  for (const id of estilos.keys()) {
    for (let x: string | undefined = id, k = 0; x && k < 12; x = estilos.get(x)?.base, k++) {
      const e = estilos.get(x);
      if (!e) break;
      const porNombre = e.nombre.match(/^(?:heading|t[ií]tulo) ?([12])$/i)?.[1];
      const nivel = porNombre ? Number(porNombre) : e.esquema !== undefined && e.esquema <= 1 ? e.esquema + 1 : undefined;
      if (nivel) {
        niveles.set(id, nivel);
        break;
      }
      if (e.esquema !== undefined) break;
    }
  }
  return niveles;
}

function textosDe(cuerpo: Nodo, etiqueta: string): string[] {
  return todos(cuerpo, (n) => nombre(n) === etiqueta).map((n) => texto(n));
}

function piesDeImagen(cuerpo: Nodo) {
  type Elemento = Nodo & { ownerDocument: { createElement(n: string): Nodo }; previousElementSibling?: Nodo | null };
  for (const pie of todos(cuerpo, (n) => nombre(n) === 'p' && attr(n, 'class').split(/\s+/).includes('pie-imagen'))) {
    const previo = (pie as Elemento).previousElementSibling;
    const img = previo && nombre(previo) === 'p' && !texto(previo).trim() ? todos(previo, (n) => nombre(n) === 'img') : [];
    if (!previo || img.length !== 1) continue;
    const doc = (pie as Elemento).ownerDocument;
    const figura = doc.createElement('figure') as Nodo & { appendChild(x: Nodo): void };
    const leyenda = doc.createElement('figcaption') as Nodo & { appendChild(x: Nodo): void };
    for (const h of [...(pie as unknown as { childNodes: Nodo[] }).childNodes]) leyenda.appendChild(h);
    (previo.parentNode as unknown as { insertBefore(a: Nodo, b: Nodo): void }).insertBefore(figura, previo);
    figura.appendChild(img[0]);
    figura.appendChild(leyenda);
    for (const x of [previo, pie]) (x.parentNode as unknown as { removeChild(y: Nodo): void }).removeChild(x);
  }
}

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
  datos = await conSaltosAntes(datos, saltos);
  const nivelesTitulo = await nivelesDeEstilos(datos);
  const buffer = Buffer.from(datos.buffer, datos.byteOffset, datos.byteLength);
  const resultado = await mammoth.convertToHtml(
    { buffer },
    {
      styleMap: saltos ? [...MAPA_SALTOS, ...MAPA_ESTILOS] : MAPA_ESTILOS,
      includeDefaultStyleMap: true,
      ...(importacion.vacios ? { ignoreEmptyParagraphs: false } : {}),
      // Mammoth no exporta la alineación: se convierte en un estilo antes de transformar.
      transformDocument: (mammoth as any).transforms.paragraph((p: any) => {
        // Estilos propios de título («Capítulo», basado en Título 1 o con nivel de esquema 1): h1 / h2.
        const nivel = p.styleId ? nivelesTitulo.get(p.styleId) : undefined;
        if (nivel && !/^(heading|t[ií]tulo) ?\d$/i.test(p.styleName ?? '')) return { ...p, styleId: `ObiTitulo${nivel}`, styleName: `ObiTitulo${nivel}` };
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
  piesDeImagen(cuerpo);

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
  const autorDoc = buscar(cuerpo, (n) => nombre(n) === 'p' && attr(n, 'class').includes('autor-documento'));
  const tituloTexto = tituloDoc ? texto(tituloDoc).trim() : '';
  const subtituloTexto = subtituloDoc ? texto(subtituloDoc).trim() : '';
  const autorTexto = autorDoc ? texto(autorDoc).trim() : '';
  quitar(tituloDoc);
  quitar(subtituloDoc);
  quitar(autorDoc);

  const opciones: OpcionesConversion = {
    vacios: importacion.vacios,
    // Sin indicación (abrir en el editor), se corta en los h2 cuando son ellos los capítulos.
    ...((importacion.cortarEnH2 ?? corteSugerido(textosDe(cuerpo, 'h1'), textosDe(cuerpo, 'h2')) === 'h2') ? { cortarEnH2: true } : {}),
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
  let idiomaWord = '';
  try {
    const zip = await JSZip.loadAsync(datos);
    const core = await zip.file('docProps/core.xml')?.async('string');
    if (core) {
      const x = analizarXml(core);
      tituloCore = texto(buscar(x, (n) => nombre(n) === 'title') ?? ({ textContent: '' } as Nodo)).trim();
      autorCore = texto(buscar(x, (n) => nombre(n) === 'creator') ?? ({ textContent: '' } as Nodo)).trim();
      idiomaWord = texto(buscar(x, (n) => nombre(n) === 'language') ?? ({ textContent: '' } as Nodo)).trim();
    }
    // Si no, el idioma predeterminado de los estilos (w:docDefaults), que Word pone siempre.
    if (!idiomaWord) {
      const estilos = (await zip.file('word/styles.xml')?.async('string')) ?? '';
      idiomaWord = estilos.match(/<w:docDefaults>[\s\S]*?<w:lang\b[^>]*\bw:val="([^"]+)"/)?.[1] ?? '';
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
      // El autor escrito en la portadilla (estilo Autor) manda sobre el de las propiedades del archivo,
      // que suele ser el usuario de Word que lo creó.
      creditos: autorTexto || autorCore ? [{ nombre: autorTexto || autorCore, rol: 'aut' }] : [],
      idioma: /^[a-z]{2,3}(-[A-Za-z0-9]{1,8})*$/.test(idiomaWord) ? idiomaWord : 'es',
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
