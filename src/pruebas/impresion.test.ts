import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { libroNuevo, nuevoId, parrafo, type Libro } from '../model.js';
import { htmlImpresion, cssImpresion, margenInteriorAutomatico } from '../impresion.js';
import { revisarImpresion, resolucionEfectiva } from '../preflight.js';
import { dividirLibro } from '../division.js';
import { buscarNavegador } from '../pdf.js';
import { pdfDesdeLibro } from '../servicio-impresion.js';
import { rutaRecurso } from '../recursos.js';
import { pngSolido } from './fixtures.js';

const hayNavegador = !!buscarNavegador() && !!rutaRecurso('vivliostyle');
const PT = 72 / 25.4;

function libroDePrueba(): Libro {
  const l = libroNuevo('La espada del alba', 'Autora');
  const cap = l.secciones.find((s) => s.tipo === 'capitulo')!;
  const n = nuevoId('n');
  const texto = 'La madrugada sorprendió a los mercenarios atravesando desfiladeros interminables, mientras los comerciantes extranjeros discutían acaloradamente sobre impuestos extraordinarios y responsabilidades administrativas.';
  cap.bloques = [
    { tipo: 'parrafo', estilo: 'cuerpo', contenido: [{ tipo: 'texto', texto }, { tipo: 'nota', id: n }] },
    ...Array.from({ length: 30 }, () => parrafo(texto)),
  ];
  cap.notas = [{ id: n, contenido: [{ tipo: 'texto', texto: 'Nota de la traductora.' }] }];
  const ilu = { id: nuevoId('i'), nombre: 'ilu.png', tipoMime: 'image/png', datos: pngSolido(600, 900), ancho: 600, alto: 900 };
  l.recursos.push(ilu);
  l.secciones.splice(1, 0, { id: nuevoId('s'), tipo: 'indice', titulo: 'Índice', mostrarTitulo: true, enIndice: false, bloques: [], notas: [] });
  l.secciones.push({ id: nuevoId('s'), tipo: 'ilustracion', titulo: '', mostrarTitulo: false, enIndice: false, bloques: [{ tipo: 'imagen', recurso: ilu.id, alt: 'Aria' }], notas: [] });
  return l;
}

test('margen interior automático según páginas (tabla de KDP)', () => {
  assert.equal(margenInteriorAutomatico(100), 9.53);
  assert.equal(margenInteriorAutomatico(250), 12.7);
  assert.equal(margenInteriorAutomatico(400), 15.88);
  assert.equal(margenInteriorAutomatico(800), 22.23);
});

test('HTML de impresión: notas en su sitio, índice con números de página, cabeceras y capítulos en impar', () => {
  const l = libroDePrueba();
  const html = htmlImpresion(l, { interior: 12.7, digital: false });
  assert.match(html, /<span class="nota-pie">Nota de la traductora\.<\/span>/);
  assert.match(html, /<ol class="indice">/);
  assert.match(html, /class="pagina-imagen"/);
  const css = cssImpresion(l, { interior: 12.7, digital: false });
  assert.match(css, /size: 139\.7mm 215\.9mm/);
  assert.match(css, /target-counter\(attr\(href url\), page\)/);
  assert.match(css, /float: footnote/);
  assert.match(css, /string\(capitulo, first-except\)/);
  assert.match(css, /break-before: right/);
  // Con sangrado la página crece 3 mm por lado.
  l.impresion = { ...(l.impresion ?? ({} as never)), sangrado: 'uniforme' } as Libro['impresion'];
  assert.match(cssImpresion(l, { interior: 12.7, digital: false }), /size: 145\.7mm 221\.9mm/);
  // El PDF digital no lleva sangrado.
  assert.match(cssImpresion(l, { interior: 12.7, digital: true }), /size: 139\.7mm 215\.9mm/);
});

test('división silábica española con guiones blandos', { skip: !rutaRecurso('hyphenopoly') }, async () => {
  const l = libroNuevo();
  const cap = l.secciones.find((s) => s.tipo === 'capitulo')!;
  cap.bloques = [{ tipo: 'parrafo', estilo: 'cuerpo', contenido: [{ tipo: 'texto', texto: 'extraordinarias constelaciones' }, { tipo: 'texto', texto: 'Tokyo', idioma: 'en' }] }];
  const d = await dividirLibro(l);
  const b = d.secciones.find((s) => s.tipo === 'capitulo')!.bloques[0];
  assert.ok(b.tipo === 'parrafo');
  assert.equal(b.contenido[0].tipo === 'texto' && b.contenido[0].texto, 'ex­tra­or­di­na­rias cons­te­la­cio­nes');
  // El original no cambia.
  assert.doesNotMatch(JSON.stringify(cap.bloques), /­/);
});

test('revisión previa: resolución, páginas mínimas y márgenes', () => {
  const l = libroDePrueba();
  assert.equal(resolucionEfectiva({ id: 'x', nombre: 'x', tipoMime: 'image/png', datos: new Uint8Array(), ancho: 1650, alto: 2550 }, 139.7, 215.9), 300);
  const avisos = revisarImpresion(l, 12);
  assert.ok(avisos.some((a) => a.mensaje.includes('mínimo de 24')));
  assert.ok(avisos.some((a) => a.mensaje.includes('ppp') && a.gravedad === 'error'));
  l.impresion = { ...(l.impresion ?? ({} as never)), margenExterior: 4 } as Libro['impresion'];
  assert.ok(revisarImpresion(l).some((a) => a.mensaje.includes('Margen exterior')));
});

test('PDF para imprenta: tamaño, cajas de corte y sangrado KDP, fuentes incrustadas, metadatos', { skip: !hayNavegador, timeout: 300_000 }, async () => {
  const l = libroDePrueba();
  l.impresion = { ...(l.impresion ?? ({} as never)), sangrado: 'kdp' } as Libro['impresion'];
  const r = await pdfDesdeLibro(l, 'impresion');
  const doc = await PDFDocument.load(r.datos);
  assert.equal(doc.getPageCount(), r.paginas);
  assert.ok(r.paginas >= 4);
  assert.equal(r.interior, 9.53);
  assert.equal(doc.getTitle(), 'La espada del alba');
  assert.equal(doc.getAuthor(), 'Autora');
  const b = 3.175 * PT;
  const [p1, p2] = doc.getPages();
  // Página derecha: sin sangrado interior (izquierda). Página izquierda: sin sangrado interior (derecha).
  for (const p of [p1, p2]) {
    const media = p.getMediaBox();
    assert.ok(Math.abs(media.width - (139.7 * PT + b)) < 1, `ancho ${media.width}`);
    assert.ok(Math.abs(media.height - (215.9 * PT + 2 * b)) < 1, `alto ${media.height}`);
    const corte = p.getTrimBox();
    assert.ok(Math.abs(corte.width - 139.7 * PT) < 1 && Math.abs(corte.height - 215.9 * PT) < 1);
  }
  assert.ok(Math.abs(p1.getMediaBox().x - b) < 0.5);
  assert.ok(Math.abs(p2.getMediaBox().x) < 0.5);
  // Fuentes incrustadas: descriptores con archivo de fuente y Literata entre ellas.
  const descriptores = doc.context
    .enumerateIndirectObjects()
    .map(([, o]) => o)
    .filter((o): o is PDFDict => o instanceof PDFDict && o.get(PDFName.of('Type')) === PDFName.of('FontDescriptor'));
  assert.ok(descriptores.length > 0);
  assert.ok(descriptores.every((d) => d.has(PDFName.of('FontFile2')) || d.has(PDFName.of('FontFile3')) || d.has(PDFName.of('FontFile'))));
  assert.ok(descriptores.some((d) => String(d.get(PDFName.of('FontName'))).includes('Literata')));
});

test('PDF digital: sin sangrado y con el tamaño de corte', { skip: !hayNavegador, timeout: 300_000 }, async () => {
  const r = await pdfDesdeLibro(libroDePrueba(), 'digital');
  const p = (await PDFDocument.load(r.datos)).getPage(0);
  assert.ok(Math.abs(p.getWidth() - 139.7 * PT) < 0.05);
  assert.ok(Math.abs(p.getHeight() - 215.9 * PT) < 0.05);
});

test('PDF para imprenta: marcas de corte y páginas a color', { skip: !hayNavegador, timeout: 300_000 }, async () => {
  const { rangosPaginas } = await import('../preflight.js');
  const l = libroDePrueba();
  // Una segunda ilustración en gris: no cuenta como color.
  const gris = { id: nuevoId('i'), nombre: 'gris.png', tipoMime: 'image/png', datos: pngSolido(600, 900, [120, 120, 120]), ancho: 600, alto: 900 };
  l.recursos.push(gris);
  l.secciones.push({ id: nuevoId('s'), tipo: 'ilustracion', titulo: '', mostrarTitulo: false, enIndice: false, bloques: [{ tipo: 'imagen', recurso: gris.id, alt: 'Gris' }], notas: [] });
  l.impresion = { ...(l.impresion ?? ({} as never)), sangrado: 'uniforme', marcasCorte: true } as Libro['impresion'];
  const r = await pdfDesdeLibro(l, 'impresion');
  assert.equal(r.paginasColor?.length, 1, `páginas a color: ${r.paginasColor}`);
  const doc = await PDFDocument.load(r.datos);
  const p = doc.getPage(r.paginasColor![0] - 1);
  const media = p.getMediaBox();
  const corte = p.getTrimBox();
  const sangre = p.getBleedBox();
  assert.ok(Math.abs(corte.width - 139.7 * PT) < 1 && Math.abs(corte.height - 215.9 * PT) < 1, 'el corte no cambia');
  assert.ok(Math.abs(sangre.width - (139.7 + 6) * PT) < 1, 'el sangrado no cambia');
  assert.ok(media.width > sangre.width + 14 * PT && media.x < sangre.x, 'la página crece para las marcas');
  assert.equal(rangosPaginas([1, 3, 4, 5, 9]), '1, 3–5, 9');
  const avisos = revisarImpresion(l, r.paginas, r.paginasColor);
  assert.ok(avisos.some((a) => a.plantilla?.startsWith('Páginas a color')));
  assert.ok(avisos.some((a) => a.plantilla?.startsWith('Las marcas de corte')));
});
