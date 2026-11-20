// Compilador del modelo a EPUB 3.3.
// Genera semántica completa (epub:type + roles DPUB-ARIA), navegación con landmarks
// y metadatos de EPUB Accessibility 1.1.

import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import type { Bloque, Imagen, Inline, Libro, Marca, Nota, Recuadro, Recurso, Seccion, TipoSeccion, VarianteRecuadro } from './model.js';
import { esc, escAttr, limpiarXml } from './xml.js';
import { temaCompleto, esVertical, VARIANTES_RECUADRO } from './model.js';
import { cssTema, separadorXhtml as separadorTema, contenidoTitulo } from './estilo-tema.js';
import { cssPropioSeguro } from './css-propio.js';
import { fuentesTema, caraFuente, familiaCss, datosArchivoFuente, MIME_FUENTE } from './fuentes.js';

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
  enfasis: ['<span class="boten">', '</span>'],
};
const ORDEN_MARCAS: Marca[] = ['negrita', 'cursiva', 'subrayado', 'tachado', 'versalitas', 'enfasis', 'superindice', 'subindice'];

export function archivoSeccion(s: Seccion): string {
  return `${s.id}.xhtml`;
}

export function rutaImagen(nombre: string): string {
  return `img/${nombre}`;
}

export interface Contexto {
  libro: Libro;
  numeroNota: Map<string, number>;
  notasPorId: Map<string, Nota>;
  /** Si se da, sustituye la llamada de nota (la impresión pone el texto de la nota en su sitio). */
  renderNota?: (nota: Nota | undefined, numero: number) => string;
  /** Si se da, sustituye la ruta de las imágenes. */
  rutaImg?: (nombre: string) => string;
  /** Escritura vertical: números de una o dos cifras y «!?» en horizontal dentro de la línea (tate-chū-yoko). */
  vertical?: boolean;
}

/** Tate-chū-yoko automático sobre texto ya escapado. */
export function tateChuYoko(html: string): string {
  return html.replace(/(?<![0-9])[0-9]{1,2}(?![0-9])|[!?]{2}/g, '<span class="tcy">$&</span>');
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
      const escapado = esc(limpiarXml(i.texto));
      let h = envolverMarcas(ctx?.vertical && !i.idioma ? tateChuYoko(escapado) : escapado, i.marcas);
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
      if (ctx?.renderNota) {
        salida += ctx.renderNota(ctx.notasPorId.get(i.id), n);
        continue;
      }
      salida += `<sup><a href="#${i.id}" id="r-${i.id}" epub:type="noteref" role="doc-noteref">${n}</a></sup>`;
    }
  }
  return salida;
}

function claseParrafo(estilo: string): string {
  return estilo === 'cuerpo' ? '' : ` class="${estilo}"`;
}

function imagenXhtml(img: Imagen, libro: Libro, clase = 'imagen', rutaImg = rutaImagen): string {
  const r = libro.recursos.find((x) => x.id === img.recurso);
  if (!r) return '';
  const alt = img.decorativa ? '' : img.alt;
  const extra = img.decorativa ? ' role="presentation"' : '';
  const pie = img.pie ? `<figcaption>${esc(img.pie)}</figcaption>` : '';
  return `<figure class="${clase}"><img src="${escAttr(rutaImg(r.nombre))}" alt="${escAttr(alt)}"${extra}/>${pie}</figure>`;
}

function separadorXhtml(ctx: Contexto): string {
  const t = temaCompleto(ctx.libro);
  const r = t.separador === 'imagen' && t.separadorImagen ? ctx.libro.recursos.find((x) => x.id === t.separadorImagen) : undefined;
  return separadorTema(t, r ? (ctx.rutaImg ?? rutaImagen)(r.nombre) : undefined);
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
        partes.push(separadorXhtml(ctx));
        break;
      case 'imagen':
        partes.push(imagenXhtml(b, ctx.libro, seccion?.tipo === 'ilustracion' ? 'ilustracion' : 'imagen', ctx.rutaImg));
        break;
      case 'lista': {
        const t = b.ordenada ? 'ol' : 'ul';
        partes.push(`<${t}>${b.elementos.map((e) => `<li>${inlinesXhtml(e, ctx)}</li>`).join('')}</${t}>`);
        break;
      }
      case 'crudo':
        partes.push(b.xhtml);
        break;
      case 'recuadro':
        partes.push(recuadroXhtml(b, ctx));
        break;
    }
  }
  return partes.join('\n');
}

const NOMBRE_RECUADRO_EN: Record<VarianteRecuadro, string> = {
  sistema: 'System window',
  notificacion: 'Notification',
  estado: 'Status window',
  chat: 'Chat',
  diario: 'Diary',
  nota: 'Note',
};

/** Recuadro de novela ligera: un div con párrafos, legible sin CSS y por los lectores de pantalla. */
export function recuadroXhtml(b: Recuadro, ctx: Contexto): string {
  const ingles = /^en\b/i.test(ctx.libro.metadatos.idioma || '');
  const nombre = ingles ? NOMBRE_RECUADRO_EN[b.variante] : VARIANTES_RECUADRO.find((v) => v.id === b.variante)!.nombre;
  const etiqueta = b.titulo ? `${nombre}: ${b.titulo}` : nombre;
  const lineas = b.lineas.map((l) => {
    const c = inlinesXhtml(l.contenido, ctx) || '<br/>';
    if (b.variante === 'estado') return `<p class="dato"><span class="etiqueta">${esc(l.etiqueta ?? '')}</span> <span class="valor">${c}</span></p>`;
    if (b.variante === 'chat') {
      const quien = l.etiqueta ? `<span class="emisor">${esc(l.etiqueta)}</span> ` : '';
      return `<p class="mensaje ${l.lado === 'der' ? 'der' : 'izq'}">${quien}<span class="globo">${c}</span></p>`;
    }
    return `<p>${c}</p>`;
  });
  const titulo = b.titulo ? `<p class="recuadro-titulo">${esc(b.titulo)}</p>\n` : '';
  return `<div class="recuadro recuadro-${b.variante}" role="group" aria-label="${escAttr(etiqueta)}">\n${titulo}${lineas.join('\n')}\n</div>`;
}

export function numerarNotas(s: Seccion): Map<string, number> {
  const mapa = new Map<string, number>();
  const ver = (lista: Inline[]) => {
    for (const i of lista) if (i.tipo === 'nota' && !mapa.has(i.id)) mapa.set(i.id, mapa.size + 1);
  };
  for (const b of s.bloques) {
    if (b.tipo === 'parrafo' || b.tipo === 'subtitulo') ver(b.contenido);
    if (b.tipo === 'lista') b.elementos.forEach(ver);
    if (b.tipo === 'recuadro') b.lineas.forEach((l) => ver(l.contenido));
  }
  return mapa;
}

function documento(libro: Libro, titulo: string, cuerpo: string, epubTypeBody?: string, extra: { viewport?: string; clase?: string } = {}): string {
  const lang = escAttr(libro.metadatos.idioma || 'es');
  const tipoBody = (epubTypeBody ? ` epub:type="${epubTypeBody}"` : '') + (extra.clase ? ` class="${extra.clase}"` : '');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">
<head>
<meta charset="utf-8"/>${extra.viewport ? `\n<meta name="viewport" content="${extra.viewport}"/>` : ''}
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

/** ¿Esta sección sale como página fija (pre-paginated)? Solo ilustraciones y portada con una imagen de tamaño conocido. */
export function imagenFija(libro: Libro, s: Seccion): Recurso | undefined {
  if (!s.paginaFija || (s.tipo !== 'ilustracion' && s.tipo !== 'portada')) return undefined;
  const b = s.bloques.find((x): x is Imagen => x.tipo === 'imagen');
  const id = b?.recurso ?? (s.tipo === 'portada' ? libro.metadatos.portada : undefined);
  const r = libro.recursos.find((x) => x.id === id);
  return r?.ancho && r?.alto ? r : undefined;
}

/** Documentos de una página fija: uno, o dos si es doble página (cada uno con su mitad de la imagen). */
export function documentosFijos(libro: Libro, s: Seccion, r: Recurso): { archivo: string; id: string; xhtml: string; lado?: 'left' | 'right' }[] {
  const sem = SEMANTICA[s.tipo];
  const b = s.bloques.find((x): x is Imagen => x.tipo === 'imagen');
  const alt = b?.decorativa ? '' : b?.alt || (s.tipo === 'portada' ? `Portada de ${libro.metadatos.titulo}` : '');
  const role = s.tipo === 'portada' ? ' role="doc-cover"' : b?.decorativa ? ' role="presentation"' : '';
  const atributos = [sem.epubType ? `epub:type="${sem.epubType}"` : '', `class="${s.tipo}"`, s.titulo ? `aria-label="${escAttr(s.titulo)}"` : ''].filter(Boolean).join(' ');
  const img = (clase: string, altImg: string) => `<img class="fija${clase}" src="${escAttr(rutaImagen(r.nombre))}" alt="${escAttr(altImg)}"${altImg ? role : ' role="presentation"'}/>`;
  if (!(s.doblePagina && s.tipo === 'ilustracion')) {
    const cuerpo = `<section ${atributos}>\n${img('', alt)}\n</section>`;
    return [{ archivo: archivoSeccion(s), id: s.id, xhtml: documento(libro, tituloDocumento(libro, s), cuerpo, sem.cuerpo, { viewport: `width=${r.ancho}, height=${r.alto}`, clase: 'fija' }) }];
  }
  // Doble página: en libros horizontales se lee primero la izquierda; en verticales, la derecha.
  const ancho = Math.round(r.ancho! / 2);
  const viewport = `width=${ancho}, height=${r.alto}`;
  const orden: ('izq' | 'der')[] = esVertical(libro) ? ['der', 'izq'] : ['izq', 'der'];
  return orden.map((mitad, k) => {
    const cuerpo = `<section ${atributos}>\n${img(` mitad-${mitad}`, k === 0 ? alt : '')}\n</section>`;
    return {
      archivo: k === 0 ? archivoSeccion(s) : `${s.id}-b.xhtml`,
      id: k === 0 ? s.id : `${s.id}-b`,
      lado: mitad === 'izq' ? 'left' : 'right',
      xhtml: documento(libro, tituloDocumento(libro, s), cuerpo, sem.cuerpo, { viewport, clase: `fija doble doble-${k + 1}` }),
    };
  });
}

export function seccionXhtml(libro: Libro, s: Seccion): string {
  const fija = imagenFija(libro, s);
  if (fija) return documentosFijos(libro, s, fija)[0].xhtml;
  const sem = SEMANTICA[s.tipo];
  const numeroNota = numerarNotas(s);
  const notasPorId = new Map(s.notas.map((n) => [n.id, n]));
  const ctx: Contexto = { libro, numeroNota, notasPorId, vertical: esVertical(libro) };
  const atributos: string[] = [];
  if (sem.epubType) atributos.push(`epub:type="${sem.epubType}"`);
  if (sem.role) atributos.push(`role="${sem.role}"`);
  atributos.push(`class="${s.tipo}"`);
  const idTitulo = `t-${s.id}`;
  let encabezado = '';
  if (s.mostrarTitulo && s.titulo) {
    atributos.push(`aria-labelledby="${idTitulo}"`);
    encabezado = `<h1 id="${idTitulo}">${contenidoTitulo(s.titulo)}</h1>\n`;
  } else if (s.titulo) {
    atributos.push(`aria-label="${escAttr(s.titulo)}"`);
  }

  const cabecera = s.imagenCabecera ? libro.recursos.find((r) => r.id === s.imagenCabecera) : undefined;
  if (cabecera) encabezado = `<div class="cabecera-capitulo"><img src="${escAttr(rutaImagen(cabecera.nombre))}" alt="" role="presentation"/></div>\n` + encabezado;

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
  const t = temaCompleto(libro);
  const f = fuentesTema(t, false, libro);
  const caras = f.archivos.map((a) => caraFuente(a, 'fuentes/')).join('\n');
  return `@charset "UTF-8";
/* Generado por Obi Studio (tema «${(t.nombre ?? 'personalizado').replace(/\*\//g, '')}»). Medidas relativas para que el lector pueda cambiar letra y tamaño. */
${caras}
html { margin: 0; padding: 0; }
body { margin: 0 5%; font-family: ${f.familiaTexto}; line-height: ${t.interlineado}; orphans: 2; widows: 2; }
h1, h2, h3 { font-weight: bold; line-height: 1.3; page-break-after: avoid; break-after: avoid; }
h1 { margin: ${t.tituloEspacio}em 0 1.5em; }
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
hr.escena { width: 25%; margin: 1.5em auto; }
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
.boten { text-emphasis: filled sesame; -webkit-text-emphasis: filled sesame; }
body.fija { margin: 0; padding: 0; overflow: hidden; }
body.fija section { margin: 0; padding: 0; }
body.fija img.fija { display: block; width: 100%; height: 100%; max-width: none; max-height: none; margin: 0; }
body.fija.doble img.fija { width: 200%; }
body.fija.doble img.mitad-der { margin-left: -100%; }
${cssTema(t, f.familiaTexto, f.familiaTitulos)}
${esVertical(libro) ? cssVertical(t.colorAcento) : ''}${cssPropioSeguro(libro)}`;
}

function cssVertical(acento: string): string {
  return `/* Escritura vertical (tategaki) */
html { writing-mode: vertical-rl; -webkit-writing-mode: vertical-rl; -epub-writing-mode: vertical-rl; }
body { margin: 5% 0; }
p { text-align: justify; }
.tcy { text-combine-upright: all; -webkit-text-combine: horizontal; -epub-text-combine: horizontal; }
hr.escena { border: 0; border-right: 1px solid ${acento}; width: 0; height: 25%; margin: auto 1.5em; }
figure img { max-height: 95%; max-width: 95vw; }
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

export function opf(
  libro: Libro,
  archivos: { href: string; id: string; tipo: string; props?: string }[],
  lectura: { idref: string; props?: string }[] = libro.secciones.map((s) => ({ idref: s.id })),
): string {
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
  const spine = lectura.map((x) => `<itemref idref="${x.idref}"${x.props ? ` properties="${x.props}"` : ''}/>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" xml:lang="${lang}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
${meta.join('\n')}
</metadata>
<manifest>
${manifiesto}
</manifest>
<spine${esVertical(libro) ? ' page-progression-direction="rtl"' : ''}>
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

  const tema = temaCompleto(libro);
  for (const a of fuentesTema(tema, false, libro).archivos) {
    const datos = datosArchivoFuente(a);
    if (!datos) continue;
    archivos.set(`fuentes/${a.archivo}`, datos);
    manifiesto.push({ href: `fuentes/${a.archivo}`, id: `f-${a.archivo.replace(/\.\w+$/, '').replace(/[^\w-]/g, '-')}`, tipo: MIME_FUENTE[a.formato ?? 'woff2'] });
  }

  const lectura: { idref: string; props?: string }[] = [];
  const usadas = new Set<string>();
  if (libro.metadatos.portada) usadas.add(libro.metadatos.portada);
  if (tema.separador === 'imagen' && tema.separadorImagen) usadas.add(tema.separadorImagen);
  // Imágenes que cita el CSS propio.
  const css = cssPropioSeguro(libro);
  if (css) for (const r of libro.recursos) if (css.includes(rutaImagen(r.nombre))) usadas.add(r.id);
  for (const s of libro.secciones) {
    if (s.imagenCabecera) usadas.add(s.imagenCabecera);
    for (const b of s.bloques) if (b.tipo === 'imagen') usadas.add(b.recurso);
    const fija = imagenFija(libro, s);
    if (fija) {
      usadas.add(fija.id);
      for (const d of documentosFijos(libro, s, fija)) {
        archivos.set(d.archivo, d.xhtml);
        manifiesto.push({ href: d.archivo, id: d.id, tipo: 'application/xhtml+xml' });
        lectura.push({ idref: d.id, props: `rendition:layout-pre-paginated ${d.lado ? `rendition:page-spread-${d.lado}` : 'rendition:spread-none'}` });
      }
      continue;
    }
    lectura.push({ idref: s.id });
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
  archivos.set('package.opf', opf(libro, manifiesto, lectura));
  return archivos;
}

/** Clave de ofuscación del IDPF: SHA-1 del identificador único sin espacios. */
export function claveOfuscacion(identificador: string): Uint8Array {
  return new Uint8Array(createHash('sha1').update(identificador.replace(/[\u0020\u0009\u000d\u000a]/g, ''), 'utf8').digest());
}

/** Ofusca (o desofusca: es simétrico) los primeros 1040 bytes de una fuente. */
export function ofuscarFuente(datos: Uint8Array, clave: Uint8Array): Uint8Array {
  const salida = datos.slice();
  for (let i = 0; i < Math.min(1040, salida.length); i++) salida[i] ^= clave[i % clave.length];
  return salida;
}

/** Ofusca las fuentes propias marcadas y devuelve el META-INF/encryption.xml (o nada). */
function aplicarOfuscacion(archivos: Map<string, string | Uint8Array>, libro: Libro): string | undefined {
  const marcadas = (libro.fuentesPropias ?? []).filter((f) => f.ofuscar);
  if (!marcadas.length) return undefined;
  const clave = claveOfuscacion(libro.metadatos.identificador);
  const rutas: string[] = [];
  for (const [ruta, datos] of archivos) {
    if (!ruta.startsWith('fuentes/') || typeof datos === 'string') continue;
    if (!marcadas.some((f) => ruta.startsWith(`fuentes/${f.id}-`))) continue;
    archivos.set(ruta, ofuscarFuente(datos, clave));
    rutas.push(`${CARPETA}/${ruta}`);
  }
  if (!rutas.length) return undefined;
  const datos = rutas
    .map((r) => `  <enc:EncryptedData>\n    <enc:EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/>\n    <enc:CipherData><enc:CipherReference URI="${escAttr(r)}"/></enc:CipherData>\n  </enc:EncryptedData>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">\n${datos}\n</encryption>\n`;
}

export async function empaquetar(archivos: Map<string, string | Uint8Array>, metaInf: Record<string, string> = {}, libro?: Libro): Promise<Uint8Array> {
  if (libro?.fuentesPropias?.some((f) => f.ofuscar)) {
    archivos = new Map(archivos);
    const cifrado = aplicarOfuscacion(archivos, libro);
    if (cifrado) metaInf = { ...metaInf, 'encryption.xml': cifrado };
  }
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', CONTAINER);
  // Archivos propios de una tienda (p. ej. las opciones de Apple Books).
  for (const [nombre, contenido] of Object.entries(metaInf)) zip.file(`META-INF/${nombre}`, contenido);
  for (const [ruta, datos] of archivos) zip.file(`${CARPETA}/${ruta}`, datos);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 9 }, mimeType: 'application/epub+zip' });
}

export async function compilar(libro: Libro): Promise<Uint8Array> {
  return empaquetar(compilarArchivos(libro), {}, libro);
}
