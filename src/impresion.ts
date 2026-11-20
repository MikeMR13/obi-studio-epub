// Libro para imprimir: un HTML con CSS Paged Media que compagina Vivliostyle.
// Sale del mismo modelo y del mismo tema que el EPUB.

import type { Impresion, Libro, Nota, Seccion } from './model.js';
import { ajustesImpresion, textoPlano } from './model.js';
import { bloquesXhtml, numerarNotas, inlinesXhtml, type Contexto } from './compilar.js';
import { esc, escAttr } from './xml.js';
import { temaCompleto, esVertical } from './model.js';
import { fuentesTema, caraFuente, familiaCss } from './fuentes.js';
import { cssTema, contenidoTitulo } from './estilo-tema.js';

export const MM_POR_PULGADA = 25.4;

/** Margen interior (medianil) según el número de páginas, como pide KDP Print. */
export function margenInteriorAutomatico(paginas: number): number {
  const pulgadas = paginas <= 150 ? 0.375 : paginas <= 300 ? 0.5 : paginas <= 500 ? 0.625 : paginas <= 700 ? 0.75 : 0.875;
  return Math.round(pulgadas * 2540) / 100;
}

export function sangradoMm(a: Impresion): number {
  return a.sangrado === 'ninguno' ? 0 : a.sangrado === 'kdp' ? 3.175 : 3;
}

export interface OpcionesImpresion {
  /** Margen interior efectivo en mm. */
  interior: number;
  /** PDF digital: sin sangrado y con márgenes simétricos. */
  digital: boolean;
}

const TIPOS_TEXTO = new Set(['prologo', 'capitulo', 'interludio', 'epilogo', 'posfacio', 'apendice', 'otro', 'dedicatoria']);


export function cssImpresion(libro: Libro, op: OpcionesImpresion): string {
  const a = ajustesImpresion(libro);
  const t = temaCompleto(libro);
  const b = op.digital ? 0 : sangradoMm(a);
  const interior = op.digital ? (op.interior + a.margenExterior) / 2 : op.interior;
  const exterior = op.digital ? interior : a.margenExterior;
  const ancho = a.ancho + 2 * b;
  const alto = a.alto + 2 * b;
  const titulo = (libro.metadatos.titulo || '').replace(/["\\]/g, '\\$&');
  const sinMarcas = `@top-center { content: none; } @bottom-center { content: none; }`;
  const interlineado = Math.min(1.6, Math.max(1.2, t.interlineado * 0.92));
  const tema = temaCompleto(libro);
  // En vertical (de derecha a izquierda) la página impar queda a la izquierda.
  const vertical = esVertical(libro);
  const fuentes = fuentesTema(tema, true, libro);
  const familiaTexto = fuentes.familiaTexto;
  const familiaTitulos = fuentes.familiaTitulos;
  const caras = fuentes.archivos.map((x) => caraFuente(x, 'fuentes/')).join('\n');
  const cabecera = (lado: 'izq' | 'der') =>
    a.cabeceras ? `@top-center { content: ${lado === 'izq' ? 'string(libro, first-except)' : 'string(capitulo, first-except)'}; font-variant: small-caps; letter-spacing: 0.05em; font-size: 8.5pt; vertical-align: bottom; padding-bottom: 4mm; }` : '';
  const folio = a.folios ? `@bottom-center { content: counter(page); font-size: 9pt; vertical-align: top; padding-top: 4mm; }` : '';

  return `@charset "UTF-8";
${caras}
@page {
  size: ${ancho}mm ${alto}mm;
  margin-top: ${a.margenSuperior + b}mm;
  margin-bottom: ${a.margenInferior + b}mm;
  @footnote { border-top: 0.4pt solid #000; padding-top: 2mm; margin-top: 3mm; }
}
@page :right { margin-left: ${interior + b}mm; margin-right: ${exterior + b}mm; ${cabecera('der')} ${folio} }
@page :left { margin-left: ${exterior + b}mm; margin-right: ${interior + b}mm; ${cabecera('izq')} ${folio} }
@page :blank { ${sinMarcas} }
@page imagen { margin: 0; ${sinMarcas} }
@page preliminar { ${sinMarcas} }

html { font-family: ${familiaTexto}; font-size: ${a.cuerpo}pt; line-height: ${interlineado}; color: #000; }
body { margin: 0; widows: 2; orphans: 2; hyphens: manual; font-kerning: normal; font-variant-ligatures: common-ligatures; }
p { margin: ${t.espacioParrafos}em 0 0; text-indent: ${t.sangria}em; text-align: ${t.alinear === 'justificado' ? 'justify' : 'left'}; }
h1, h2, h3 { font-weight: 700; line-height: 1.25; hyphens: none; break-after: avoid; }
h2 { font-size: 1.2em; margin: 1.6em 0 0.8em; }
h3 { font-size: 1.05em; margin: 1.2em 0 0.6em; }
h1 + p, h2 + p, h3 + p, .escena + p, figure + p, p.sin-sangria { text-indent: 0; }
p.centrado { text-align: center; text-indent: 0; }
p.derecha { text-align: right; text-indent: 0; }
p.pensamiento { font-style: italic; }
p.onomatopeya { text-align: center; text-indent: 0; font-weight: 700; font-size: 1.2em; margin: 0.4em 0; }
p.carta { margin-left: 1.5em; margin-right: 1.5em; text-indent: 0; font-style: italic; }
p.cita { margin: 0.4em 1.5em; text-indent: 0; }
.escena { text-align: center; margin: 0.9em 0; text-indent: 0; break-after: avoid; }
.escena.espacio { height: 1.2em; margin: 0; }
hr.escena { width: 20%; margin: 1.2em auto; }
.vs { font-variant: small-caps; }
ruby rt { font-size: 0.5em; }
figure { margin: 0.8em 0; text-align: center; break-inside: avoid; }
figure img { max-width: 100%; max-height: ${Math.round((a.alto - a.margenSuperior - a.margenInferior) * 0.9)}mm; }
figcaption { font-size: 0.85em; font-style: italic; margin-top: 0.3em; }
ul, ol { margin: 0.5em 0; padding-left: 1.5em; }
table { border-collapse: collapse; margin: 0.8em auto; font-size: 0.9em; }
td, th { border: 0.4pt solid #000; padding: 0.2em 0.5em; }

section { break-before: page; counter-reset: footnote; }
section.texto { break-before: ${a.capituloEnImpar ? (vertical ? 'left' : 'right') : 'page'}; }
section.texto > h1 { string-set: capitulo content(text), libro "${titulo}"; margin: 0; padding: ${Math.max(6, tema.tituloEspacio * 5)}mm 0 10mm; }
section.texto > .cabecera-capitulo { margin: 8mm 0 0; }
section.texto > .cabecera-capitulo img { max-height: 45mm; }
section.texto > .cabecera-capitulo + h1 { padding-top: 6mm; }
${cssTema(tema, familiaTexto, familiaTitulos)}
.pagina-imagen.doble-izq img, .pagina-imagen.doble-der img { width: ${2 * a.ancho + 2 * b}mm; height: ${alto}mm; max-width: none; max-height: none; object-fit: cover; }
.pagina-imagen.doble-izq { justify-content: flex-start; }
.pagina-imagen.doble-der { justify-content: flex-end; }
section.doble { break-before: ${vertical ? 'right' : 'left'}; }
section.preliminar { page: preliminar; }
section.creditos p, section.preliminar p { text-indent: 0; text-align: center; }
section.creditos { font-size: 0.85em; }
section.dedicatoria p { text-align: center; text-indent: 0; font-style: italic; }
section.dedicatoria { padding-top: 35%; }
section.imagen { page: imagen; }
.pagina-imagen { writing-mode: horizontal-tb; width: ${ancho}mm; height: ${alto}mm; display: flex; align-items: center; justify-content: center; overflow: hidden; break-after: page; }
.pagina-imagen img { display: block; ${a.ilustracionesASangre && b > 0 ? `width: ${ancho}mm; height: ${alto}mm; object-fit: cover;` : `width: ${a.ancho}mm; height: ${a.alto}mm; object-fit: contain;`} }
.pagina-imagen.contenida img { max-width: ${a.ancho - 2 * a.margenExterior}mm; max-height: ${a.alto - a.margenSuperior - a.margenInferior}mm; }

ol.indice { list-style: none; padding: 0; margin: 0; }
ol.indice li { margin: 0.35em 0; display: flex; }
ol.indice a { color: inherit; text-decoration: none; flex: 1; }
ol.indice a::after { content: target-counter(attr(href url), page); float: right; padding-left: 1em; }

.nota-pie { float: footnote; font-size: 0.82em; line-height: 1.3; text-indent: 0; text-align: left; font-style: normal; font-weight: normal; }
.nota-pie::footnote-call { content: counter(footnote); vertical-align: super; font-size: 0.65em; line-height: 0; }
.nota-pie::footnote-marker { content: counter(footnote) '. '; }
a { color: inherit; text-decoration: none; }
.boten { text-emphasis: filled sesame; }
${vertical ? `html { writing-mode: vertical-rl; }
.tcy { text-combine-upright: all; }
p { text-align: justify; }
section.texto > h1 { padding: 0 ${Math.max(6, tema.tituloEspacio * 5)}mm 0 10mm; }
hr.escena { border: 0; border-right: 0.4pt solid ${tema.colorAcento}; width: 0; height: 20%; margin: auto 1.2em; }
figure img { max-width: 90%; max-height: none; }` : ''}
`;
}

function claseSeccion(s: Seccion): string {
  if (s.tipo === 'ilustracion' && s.doblePagina) return 'imagen doble';
  if (s.tipo === 'ilustracion' || s.tipo === 'portada') return 'imagen';
  if (s.tipo === 'creditos' || s.tipo === 'indice') return `preliminar ${s.tipo}`;
  return TIPOS_TEXTO.has(s.tipo) ? `texto ${s.tipo}` : s.tipo;
}

function renderNota(nota: Nota | undefined, ctx: Contexto): string {
  if (!nota) return '';
  // Dentro de la nota no se anidan otras notas.
  return `<span class="nota-pie">${inlinesXhtml(nota.contenido.filter((i) => i.tipo !== 'nota'), { ...ctx, renderNota: () => '' })}</span>`;
}

export function htmlImpresion(libro: Libro, op: OpcionesImpresion): string {
  const a = ajustesImpresion(libro);
  const lang = escAttr(libro.metadatos.idioma || 'es');
  const partes: string[] = [];
  const rutaImg = (nombre: string) => `img/${nombre}`;
  for (const s of libro.secciones) {
    if (s.tipo === 'portada' && !a.incluirPortada) continue;
    const clase = claseSeccion(s);
    const ctx: Contexto = {
      libro,
      numeroNota: numerarNotas(s),
      notasPorId: new Map(s.notas.map((n) => [n.id, n])),
      rutaImg,
      vertical: esVertical(libro),
    };
    ctx.renderNota = (nota) => renderNota(nota, ctx);
    let contenido = '';
    if (s.tipo === 'ilustracion' || s.tipo === 'portada') {
      const imgs = s.bloques.filter((b) => b.tipo === 'imagen');
      const ids = imgs.length ? imgs.map((b) => (b.tipo === 'imagen' ? b.recurso : '')) : s.tipo === 'portada' && libro.metadatos.portada ? [libro.metadatos.portada] : [];
      for (const id of ids) {
        const r = libro.recursos.find((x) => x.id === id);
        if (!r) continue;
        const src = escAttr(rutaImg(r.nombre));
        // Doble página: la misma imagen en dos páginas enfrentadas, cada una muestra su mitad.
        if (s.doblePagina && s.tipo === 'ilustracion') {
          const izq = `<div class="pagina-imagen doble-izq"><img src="${src}" alt=""/></div>`;
          const der = `<div class="pagina-imagen doble-der"><img src="${src}" alt=""/></div>`;
          // En vertical se pasa primero por la página derecha.
          contenido += esVertical(libro) ? der + izq : izq + der;
        }
        else contenido += `<div class="pagina-imagen"><img src="${src}" alt=""/></div>`;
      }
      const resto = s.bloques.filter((b) => b.tipo !== 'imagen');
      if (resto.length) contenido += bloquesXhtml(resto, ctx, s);
      if (!contenido) continue;
    } else if (s.tipo === 'indice') {
      const items = libro.secciones
        .filter((x) => x.enIndice && x.titulo && x.tipo !== 'indice' && x.tipo !== 'portada')
        .map((x) => `<li><a href="#s-${x.id}">${esc(x.titulo)}</a></li>`)
        .join('\n');
      contenido = `<h1>${esc(s.titulo || 'Índice')}</h1>\n<ol class="indice">\n${items}\n</ol>` + bloquesXhtml(s.bloques, ctx, s);
    } else {
      const cab = s.imagenCabecera ? libro.recursos.find((r) => r.id === s.imagenCabecera) : undefined;
      const encabezado =
        (cab ? `<div class="cabecera-capitulo"><img src="${escAttr(rutaImg(cab.nombre))}" alt=""/></div>\n` : '') +
        (s.mostrarTitulo && s.titulo ? `<h1>${contenidoTitulo(s.titulo)}</h1>\n` : '');
      contenido = encabezado + bloquesXhtml(s.bloques, ctx, s);
      // Notas sin llamada: al final de la sección para no perder texto.
      const huerfanas = s.notas.filter((n) => !ctx.numeroNota.has(n.id));
      for (const n of huerfanas) contenido += `<p class="sin-sangria">${inlinesXhtml(n.contenido, { ...ctx, renderNota: () => '' })}</p>`;
    }
    // Si el título no se muestra, se fija igual para la cabecera de página.
    const marcaCabecera = !(s.mostrarTitulo && s.titulo) && s.titulo && TIPOS_TEXTO.has(s.tipo)
      ? `<div style="string-set: capitulo '${s.titulo.replace(/['\\]/g, '\\$&')}', libro '${(libro.metadatos.titulo || '').replace(/['\\]/g, '\\$&')}'"></div>`
      : '';
    partes.push(`<section id="s-${s.id}" class="${clase}">\n${marcaCabecera}${contenido}\n</section>`);
  }
  const m = libro.metadatos;
  const autores = m.creditos.filter((c) => c.rol === 'aut').map((c) => c.nombre).join(', ');
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8"/>
<title>${esc(m.titulo)}</title>
${autores ? `<meta name="author" content="${escAttr(autores)}"/>` : ''}
<link rel="stylesheet" href="impresion.css"/>
</head>
<body>
${partes.join('\n')}
</body>
</html>
`;
}

export const FUENTES_IMPRESION = ['literata', 'noto-sans'].flatMap((f) =>
  ['latin', 'latin-ext'].flatMap((sub) => ['400-normal', '400-italic', '700-normal', '700-italic'].map((p) => `${f}-${sub}-${p}.woff2`)),
);

/** Archivos que sirve el servidor para compaginar: libro.html, impresion.css e imágenes (las fuentes se sirven aparte). */
export function archivosImpresion(libro: Libro, op: OpcionesImpresion): Map<string, string | Uint8Array> {
  const archivos = new Map<string, string | Uint8Array>();
  archivos.set('libro.html', htmlImpresion(libro, op));
  archivos.set('impresion.css', cssImpresion(libro, op));
  for (const r of libro.recursos) archivos.set(`img/${r.nombre}`, r.datos);
  return archivos;
}

export function palabrasLibro(libro: Libro): number {
  let n = 0;
  for (const s of libro.secciones) for (const b of s.bloques) if (b.tipo === 'parrafo') n += textoPlano(b.contenido).split(/\s+/).filter(Boolean).length;
  return n;
}
