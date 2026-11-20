// Compilador del modelo a EPUB 3.3.
// Genera semántica completa (epub:type + roles DPUB-ARIA), navegación con landmarks
// y metadatos de EPUB Accessibility 1.1.

import JSZip from 'jszip';
import type { Bloque, Imagen, Inline, Libro, Marca, Nota, Seccion, TipoSeccion } from './model.js';
import { esc, escAttr, limpiarXml } from './xml.js';

export const CARPETA = 'EPUB';

interface Semantica {
  epubType?: string;
  role?: string;
  cuerpo: 'frontmatter' | 'bodymatter' | 'backmatter';
}

export const SEMANTICA: Record<TipoSeccion, Semantica> = {
  portada: { epubType: 'cover', cuerpo: 'frontmatter' },
  ilustracion: { cuerpo: 'frontmatter' },
  creditos: { epubType: 'copyright-page', cuerpo: 'frontmatter' },
  indice: { epubType: 'toc', role: 'doc-toc', cuerpo: 'frontmatter' },
  dedicatoria: { epubType: 'dedication', role: 'doc-dedication', cuerpo: 'frontmatter' },
  prologo: { epubType: 'prologue', role: 'doc-prologue', cuerpo: 'bodymatter' },
  capitulo: { epubType: 'chapter', role: 'doc-chapter', cuerpo: 'bodymatter' },
  interludio: { epubType: 'chapter', role: 'doc-chapter', cuerpo: 'bodymatter' },
  epilogo: { epubType: 'epilogue', role: 'doc-epilogue', cuerpo: 'bodymatter' },
  posfacio: { epubType: 'afterword', role: 'doc-afterword', cuerpo: 'backmatter' },
  apendice: { epubType: 'appendix', role: 'doc-appendix', cuerpo: 'backmatter' },
  otro: { cuerpo: 'bodymatter' },
};

const ETIQUETA_MARCA: Record<Marca, [string, string]> = {
  negrita: ['<strong>', '</strong>'],
  cursiva: ['<em>', '</em>'],
  subrayado: ['<u>', '</u>'],
  tachado: ['<s>', '</s>'],
  versalitas: ['<span class="vs">', '</span>'],
  superindice: ['<sup>', '</sup>'],
  subindice: ['<sub>', '</sub>'],
};
const ORDEN_MARCAS: Marca[] = ['negrita', 'cursiva', 'subrayado', 'tachado', 'versalitas', 'superindice', 'subindice'];

export function archivoSeccion(s: Seccion): string {
  return `${s.id}.xhtml`;
}

export function rutaImagen(nombre: string): string {
  return `img/${nombre}`;
}

interface Contexto {
  libro: Libro;
  numeroNota: Map<string, number>;
  notasPorId: Map<string, Nota>;
}

function envolverMarcas(html: string, marcas: Marca[] = []): string {
  let r = html;
  for (const m of [...ORDEN_MARCAS].reverse()) {
    if (marcas.includes(m)) r = ETIQUETA_MARCA[m][0] + r + ETIQUETA_MARCA[m][1];
  }
  return r;
}

export function inlinesXhtml(lista: Inline[], ctx?: Contexto): string {
  let salida = '';
  for (const i of lista) {
    if (i.tipo === 'texto') {
      let h = envolverMarcas(esc(limpiarXml(i.texto)), i.marcas);
      if (i.idioma) h = `<span lang="${escAttr(i.idioma)}" xml:lang="${escAttr(i.idioma)}">${h}</span>`;
      if (i.enlace) h = `<a href="${escAttr(i.enlace)}">${h}</a>`;
      salida += h;
    } else if (i.tipo === 'ruby') {
      salida += envolverMarcas(`<ruby>${esc(i.base)}<rp>(</rp><rt>${esc(i.lectura)}</rt><rp>)</rp></ruby>`, i.marcas);
    } else if (i.tipo === 'salto') {
      salida += '<br/>';
    } else if (i.tipo === 'nota') {
      const n = ctx?.numeroNota.get(i.id);
      if (n === undefined) continue;
      salida += `<sup><a href="#${i.id}" id="r-${i.id}" epub:type="noteref" role="doc-noteref">${n}</a></sup>`;
    }
  }
  return salida;
}

function claseParrafo(estilo: string): string {
  return estilo === 'cuerpo' ? '' : ` class="${estilo}"`;
}

function imagenXhtml(img: Imagen, libro: Libro, clase = 'imagen'): string {
  const r = libro.recursos.find((x) => x.id === img.recurso);
  if (!r) return '';
  const alt = img.decorativa ? '' : img.alt;
  const extra = img.decorativa ? ' role="presentation"' : '';
  const pie = img.pie ? `<figcaption>${esc(img.pie)}</figcaption>` : '';
  return `<figure class="${clase}"><img src="${escAttr(rutaImagen(r.nombre))}" alt="${escAttr(alt)}"${extra}/>${pie}</figure>`;
}

function separadorXhtml(libro: Libro): string {
  switch (libro.tema.separador) {
    case 'linea':
      return '<hr class="escena"/>';
    case 'espacio':
      return '<div class="escena espacio" role="separator"></div>';
    default:
      return '<div class="escena" role="separator">* * *</div>';
  }
}

export function bloquesXhtml(bloques: Bloque[], ctx: Contexto, seccion?: Seccion): string {
  const partes: string[] = [];
  for (const b of bloques) {
    switch (b.tipo) {
      case 'parrafo': {
        const contenido = inlinesXhtml(b.contenido, ctx);
        partes.push(`<p${claseParrafo(b.estilo)}>${contenido || '<br/>'}</p>`);
        break;
      }
      case 'subtitulo':
        partes.push(`<h${b.nivel}>${inlinesXhtml(b.contenido, ctx)}</h${b.nivel}>`);
        break;
      case 'separador':
        partes.push(separadorXhtml(ctx.libro));
        break;
      case 'imagen':
        partes.push(imagenXhtml(b, ctx.libro, seccion?.tipo === 'ilustracion' ? 'ilustracion' : 'imagen'));
        break;
      case 'lista': {
        const t = b.ordenada ? 'ol' : 'ul';
        partes.push(`<${t}>${b.elementos.map((e) => `<li>${inlinesXhtml(e, ctx)}</li>`).join('')}</${t}>`);
        break;
      }
      case 'crudo':
        partes.push(b.xhtml);
        break;
    }
  }
  return partes.join('\n');
}

function numerarNotas(s: Seccion): Map<string, number> {
  const mapa = new Map<string, number>();
  const ver = (lista: Inline[]) => {
    for (const i of lista) if (i.tipo === 'nota' && !mapa.has(i.id)) mapa.set(i.id, mapa.size + 1);
  };
  for (const b of s.bloques) {
    if (b.tipo === 'parrafo' || b.tipo === 'subtitulo') ver(b.contenido);
    if (b.tipo === 'lista') b.elementos.forEach(ver);
  }
  return mapa;
}

function documento(libro: Libro, titulo: string, cuerpo: string, epubTypeBody?: string): string {
  const lang = escAttr(libro.metadatos.idioma || 'es');
  const tipoBody = epubTypeBody ? ` epub:type="${epubTypeBody}"` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">
<head>
<meta charset="utf-8"/>
<title>${esc(titulo)}</title>
<link rel="stylesheet" type="text/css" href="estilos.css"/>
</head>
<body${tipoBody}>
${cuerpo}
</body>
</html>
`;
}

function tituloDocumento(libro: Libro, s: Seccion): string {
  return s.titulo || libro.metadatos.titulo;
}

export function seccionXhtml(libro: Libro, s: Seccion): string {
  const sem = SEMANTICA[s.tipo];
  const numeroNota = numerarNotas(s);
  const notasPorId = new Map(s.notas.map((n) => [n.id, n]));
  const ctx: Contexto = { libro, numeroNota, notasPorId };
  const atributos: string[] = [];
  if (sem.epubType) atributos.push(`epub:type="${sem.epubType}"`);
  if (sem.role) atributos.push(`role="${sem.role}"`);
  atributos.push(`class="${s.tipo}"`);
  const idTitulo = `t-${s.id}`;
  let encabezado = '';
  if (s.mostrarTitulo && s.titulo) {
    atributos.push(`aria-labelledby="${idTitulo}"`);
    encabezado = `<h1 id="${idTitulo}">${esc(s.titulo)}</h1>\n`;
  } else if (s.titulo) {
    atributos.push(`aria-label="${escAttr(s.titulo)}"`);
  }

  let contenido: string;
  if (s.tipo === 'portada') {
    const portada = libro.recursos.find((r) => r.id === libro.metadatos.portada);
    const imgBloque = s.bloques.find((b): b is Imagen => b.tipo === 'imagen');
    const r = imgBloque ? libro.recursos.find((x) => x.id === imgBloque.recurso) : portada;
    const alt = imgBloque?.alt || `Portada de ${libro.metadatos.titulo}`;
    contenido = r ? `<img src="${escAttr(rutaImagen(r.nombre))}" alt="${escAttr(alt)}" role="doc-cover"/>` : '';
  } else if (s.tipo === 'indice') {
    contenido = indiceXhtml(libro) + bloquesXhtml(s.bloques, ctx, s);
  } else {
    contenido = bloquesXhtml(s.bloques, ctx, s);
  }

  // Notas: las referenciadas en orden, luego las huérfanas (para no perder texto).
  const ordenNotas = [...numeroNota.keys()].map((id) => notasPorId.get(id)).filter(Boolean) as Nota[];
  const huerfanas = s.notas.filter((n) => !numeroNota.has(n.id));
  let notas = '';
  for (const n of ordenNotas) {
    const num = numeroNota.get(n.id);
    notas += `<aside id="${n.id}" epub:type="footnote" role="doc-footnote"><p><a href="#r-${n.id}" role="doc-backlink">${num}.</a> ${inlinesXhtml(n.contenido, ctx)}</p></aside>\n`;
  }
  for (const n of huerfanas) {
    notas += `<aside id="${n.id}" epub:type="footnote" role="doc-footnote"><p>${inlinesXhtml(n.contenido, ctx)}</p></aside>\n`;
  }

  const cuerpo = `<section ${atributos.join(' ')}>\n${encabezado}${contenido}\n${notas}</section>`;
  return documento(libro, tituloDocumento(libro, s), cuerpo, sem.cuerpo);
}

function indiceXhtml(libro: Libro): string {
  const items = libro.secciones
    .filter((s) => s.enIndice && s.tipo !== 'indice' && s.titulo)
    .map((s) => `<li><a href="${archivoSeccion(s)}">${esc(s.titulo)}</a></li>`)
    .join('\n');
  return `<ol class="indice">\n${items}\n</ol>`;
}

export function navXhtml(libro: Libro): string {
  const secciones = libro.secciones.filter((s) => s.enIndice && s.titulo && s.tipo !== 'portada');
  const toc = (secciones.length ? secciones : libro.secciones.slice(0, 1))
    .map((s) => `<li><a href="${archivoSeccion(s)}">${esc(s.titulo || libro.metadatos.titulo)}</a></li>`)
    .join('\n');
  const marcas: string[] = [];
  const portada = libro.secciones.find((s) => s.tipo === 'portada');
  if (portada) marcas.push(`<li><a epub:type="cover" href="${archivoSeccion(portada)}">Portada</a></li>`);
  const indice = libro.secciones.find((s) => s.tipo === 'indice');
  if (indice) marcas.push(`<li><a epub:type="toc" href="${archivoSeccion(indice)}">Índice</a></li>`);
  const inicio = libro.secciones.find((s) => SEMANTICA[s.tipo].cuerpo === 'bodymatter');
  if (inicio) marcas.push(`<li><a epub:type="bodymatter" href="${archivoSeccion(inicio)}">Comienzo</a></li>`);
  const cuerpo = `<nav epub:type="toc" id="toc">
<h1>Índice</h1>
<ol>
${toc}
</ol>
</nav>
<nav epub:type="landmarks" id="landmarks" hidden="hidden">
<h2>Puntos de referencia</h2>
<ol>
${marcas.join('\n')}
</ol>
</nav>`;
  return documento(libro, 'Índice', cuerpo);
}

export function cssLibro(libro: Libro): string {
  const t = libro.tema;
  const familia = (f: string) => (f === 'sans-serif' ? 'sans-serif' : 'serif');
  return `@charset "UTF-8";
/* Generado por Obi Studio. Medidas relativas para que el lector pueda cambiar letra y tamaño. */
html { margin: 0; padding: 0; }
body { margin: 0 5%; font-family: ${familia(t.fuenteTexto)}; line-height: ${t.interlineado}; orphans: 2; widows: 2; }
h1, h2, h3 { font-family: ${familia(t.fuenteTitulos)}; font-weight: bold; text-align: center; line-height: 1.3; page-break-after: avoid; break-after: avoid; }
h1 { font-size: 1.5em; margin: 2em 0 1.5em; }
h2 { font-size: 1.25em; margin: 1.5em 0 1em; }
h3 { font-size: 1.1em; margin: 1.2em 0 0.8em; }
p { margin: ${t.espacioParrafos}em 0 0; text-indent: ${t.sangria}em; text-align: ${t.alinear === 'justificado' ? 'justify' : 'left'}; }
h1 + p, h2 + p, h3 + p, .escena + p, figure + p, p.sin-sangria { text-indent: 0; }
p.centrado { text-align: center; text-indent: 0; }
p.derecha { text-align: right; text-indent: 0; }
p.pensamiento { font-style: italic; }
p.onomatopeya { text-align: center; text-indent: 0; font-weight: bold; font-size: 1.2em; margin: 0.5em 0; }
p.carta { margin: 0 2em; text-indent: 0; font-style: italic; }
p.cita { margin: 0.5em 2em; text-indent: 0; }
.escena { text-align: center; margin: 1em 0; text-indent: 0; }
.escena.espacio { height: 1.5em; margin: 0; }
hr.escena { border: 0; border-top: 1px solid currentColor; width: 25%; margin: 1.5em auto; }
.vs { font-variant: small-caps; }
figure { margin: 1em 0; text-align: center; page-break-inside: avoid; break-inside: avoid; }
figure img { max-width: 100%; max-height: 95vh; }
figcaption { font-size: 0.9em; font-style: italic; margin-top: 0.3em; }
section.ilustracion, section.portada { margin: 0; padding: 0; text-align: center; }
section.ilustracion figure { margin: 0; }
section.ilustracion img, section.portada img { max-width: 100%; max-height: 100vh; }
section.creditos p, section.dedicatoria p { text-align: center; text-indent: 0; }
section.dedicatoria { margin-top: 30%; font-style: italic; }
ol.indice { list-style: none; padding: 0; }
ol.indice li { margin: 0.4em 0; }
aside[epub|type~="footnote"] { font-size: 0.9em; margin-top: 1em; }
aside p { text-indent: 0; }
a[epub|type~="noteref"] { text-decoration: none; }
ruby rt { font-size: 0.5em; }
`;
}

function mimeSeguro(tipo: string): boolean {
  return ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'].includes(tipo);
}

function fechaModificacion(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function identificador(id: string): string {
  const limpio = id.trim();
  if (/^(urn:|https?:)/i.test(limpio)) return limpio;
  const digitos = limpio.replace(/[-\s]/g, '');
  if (/^(97[89])?\d{9}[\dX]$/i.test(digitos)) return `urn:isbn:${digitos}`;
  return limpio || `urn:uuid:${globalThis.crypto.randomUUID()}`;
}

function usaRuby(libro: Libro): boolean {
  return libro.secciones.some((s) =>
    s.bloques.some((b) => (b.tipo === 'parrafo' || b.tipo === 'subtitulo') && b.contenido.some((i) => i.tipo === 'ruby')),
  );
}

function imagenesConTexto(libro: Libro): { hay: boolean; todasDescritas: boolean } {
  let hay = false;
  let todas = true;
  for (const s of libro.secciones) {
    for (const b of s.bloques) {
      if (b.tipo === 'imagen' && !b.decorativa) {
        hay = true;
        if (!b.alt.trim()) todas = false;
      }
    }
    if (s.tipo === 'portada') hay = true;
  }
  return { hay, todasDescritas: todas };
}

export function opf(libro: Libro, archivos: { href: string; id: string; tipo: string; props?: string }[]): string {
  const m = libro.metadatos;
  const lang = esc(m.idioma || 'es');
  const meta: string[] = [];
  meta.push(`<dc:identifier id="pub-id">${esc(identificador(m.identificador))}</dc:identifier>`);
  meta.push(`<dc:title id="titulo">${esc(m.titulo || 'Sin título')}</dc:title>`);
  meta.push(`<meta refines="#titulo" property="title-type">main</meta>`);
  if (m.subtitulo) {
    meta.push(`<dc:title id="subtitulo">${esc(m.subtitulo)}</dc:title>`);
    meta.push(`<meta refines="#subtitulo" property="title-type">subtitle</meta>`);
  }
  meta.push(`<dc:language>${lang}</dc:language>`);
  m.creditos.forEach((c, k) => {
    const etiqueta = c.rol === 'aut' ? 'dc:creator' : 'dc:contributor';
    meta.push(`<${etiqueta} id="c${k}">${esc(c.nombre)}</${etiqueta}>`);
    meta.push(`<meta refines="#c${k}" property="role" scheme="marc:relators">${c.rol}</meta>`);
  });
  if (m.fecha) meta.push(`<dc:date>${esc(m.fecha)}</dc:date>`);
  if (m.editorial) meta.push(`<dc:publisher>${esc(m.editorial)}</dc:publisher>`);
  if (m.descripcion) meta.push(`<dc:description>${esc(m.descripcion)}</dc:description>`);
  if (m.derechos) meta.push(`<dc:rights>${esc(m.derechos)}</dc:rights>`);
  meta.push(`<meta property="dcterms:modified">${fechaModificacion()}</meta>`);
  if (m.serie) {
    meta.push(`<meta property="belongs-to-collection" id="serie">${esc(m.serie)}</meta>`);
    meta.push(`<meta refines="#serie" property="collection-type">series</meta>`);
    if (m.volumen) meta.push(`<meta refines="#serie" property="group-position">${m.volumen}</meta>`);
  }
  const portada = archivos.find((a) => a.props?.includes('cover-image'));
  if (portada) meta.push(`<meta name="cover" content="${portada.id}"/>`);

  // Accesibilidad (EPUB Accessibility 1.1).
  const img = imagenesConTexto(libro);
  meta.push(`<meta property="schema:accessMode">textual</meta>`);
  if (img.hay) meta.push(`<meta property="schema:accessMode">visual</meta>`);
  meta.push(`<meta property="schema:accessModeSufficient">textual</meta>`);
  if (img.hay) meta.push(`<meta property="schema:accessModeSufficient">textual,visual</meta>`);
  const rasgos = ['structuralNavigation', 'tableOfContents', 'readingOrder', 'displayTransformability'];
  if (img.hay && img.todasDescritas) rasgos.push('alternativeText');
  if (usaRuby(libro)) rasgos.push('rubyAnnotations');
  for (const r of rasgos) meta.push(`<meta property="schema:accessibilityFeature">${r}</meta>`);
  meta.push(`<meta property="schema:accessibilityHazard">none</meta>`);
  const resumen =
    m.resumenAccesibilidad ||
    'Libro con navegación estructurada, índice y orden de lectura definido. El texto se puede agrandar y cambiar de fuente.' +
      (img.hay ? ' Las ilustraciones tienen descripción textual.' : '');
  meta.push(`<meta property="schema:accessibilitySummary">${esc(resumen)}</meta>`);
  meta.push(`<meta property="dcterms:conformsTo">EPUB Accessibility 1.1 - WCAG 2.1 Level AA</meta>`);
  meta.push(`<meta property="a11y:certifiedBy">${esc(m.editorial || m.creditos[0]?.nombre || 'Obi Studio')}</meta>`);

  const manifiesto = archivos
    .map((a) => `<item id="${a.id}" href="${escAttr(a.href)}" media-type="${a.tipo}"${a.props ? ` properties="${a.props}"` : ''}/>`)
    .join('\n');
  const spine = libro.secciones.map((s) => `<itemref idref="${s.id}"/>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" xml:lang="${lang}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
${meta.join('\n')}
</metadata>
<manifest>
${manifiesto}
</manifest>
<spine>
${spine}
</spine>
</package>
`;
}

export const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles>
<rootfile full-path="${CARPETA}/package.opf" media-type="application/oebps-package+xml"/>
</rootfiles>
</container>
`;

/** Archivos del EPUB en memoria, con rutas relativas a la carpeta EPUB/. */
export function compilarArchivos(libro: Libro): Map<string, string | Uint8Array> {
  const archivos = new Map<string, string | Uint8Array>();
  const manifiesto: { href: string; id: string; tipo: string; props?: string }[] = [];

  manifiesto.push({ href: 'nav.xhtml', id: 'nav', tipo: 'application/xhtml+xml', props: 'nav' });
  archivos.set('nav.xhtml', navXhtml(libro));
  manifiesto.push({ href: 'estilos.css', id: 'css', tipo: 'text/css' });
  archivos.set('estilos.css', cssLibro(libro));

  const usadas = new Set<string>();
  if (libro.metadatos.portada) usadas.add(libro.metadatos.portada);
  for (const s of libro.secciones) {
    for (const b of s.bloques) if (b.tipo === 'imagen') usadas.add(b.recurso);
    const xhtml = seccionXhtml(libro, s);
    archivos.set(archivoSeccion(s), xhtml);
    const props: string[] = [];
    if (/<svg[\s>]/.test(xhtml)) props.push('svg');
    if (/<math[\s>]/.test(xhtml)) props.push('mathml');
    manifiesto.push({ href: archivoSeccion(s), id: s.id, tipo: 'application/xhtml+xml', props: props.join(' ') || undefined });
    // Recursos referenciados desde bloques crudos.
    for (const b of s.bloques) {
      if (b.tipo !== 'crudo') continue;
      for (const r of libro.recursos) if (b.xhtml.includes(rutaImagen(r.nombre))) usadas.add(r.id);
    }
  }
  for (const r of libro.recursos) {
    if (!usadas.has(r.id) || !mimeSeguro(r.tipoMime)) continue;
    archivos.set(rutaImagen(r.nombre), r.datos);
    manifiesto.push({
      href: rutaImagen(r.nombre),
      id: r.id,
      tipo: r.tipoMime,
      props: r.id === libro.metadatos.portada ? 'cover-image' : undefined,
    });
  }
  archivos.set('package.opf', opf(libro, manifiesto));
  return archivos;
}

export async function empaquetar(archivos: Map<string, string | Uint8Array>): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', CONTAINER);
  for (const [ruta, datos] of archivos) zip.file(`${CARPETA}/${ruta}`, datos);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 9 }, mimeType: 'application/epub+zip' });
}

export async function compilar(libro: Libro): Promise<Uint8Array> {
  return empaquetar(compilarArchivos(libro));
}
