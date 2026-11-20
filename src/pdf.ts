// Generación del PDF: Vivliostyle compagina el HTML de impresión en un Chromium y se imprime a PDF.
// En la app de escritorio el Chromium es el de Electron; en la línea de comandos y las pruebas, un Chrome o Edge instalado.
// Después, pdf-lib añade metadatos y las cajas de corte y sangrado (y recorta el sangrado interior para KDP).

import { existsSync } from 'node:fs';
import { PDFDocument, PDFName } from 'pdf-lib';
import type { Libro } from './model.js';
import { ajustesImpresion } from './model.js';
import { margenInteriorAutomatico, sangradoMm, MM_POR_PULGADA } from './impresion.js';

export type TipoPdf = 'impresion' | 'digital';

/** Recibe la URL del visor ya preparada y devuelve el PDF. */
export type Renderizador = (urlVisor: string) => Promise<Uint8Array>;

const PT_POR_MM = 72 / MM_POR_PULGADA;

export function urlVisor(base: string, clave: string, version: number): string {
  const src = `${base}/impresion/${clave}/${version}/libro.html`;
  return `${base}/vivliostyle/index.html#src=${src}&bookMode=false&renderAllPages=true&spread=false`;
}

export function buscarNavegador(): string | undefined {
  const candidatos = [
    process.env.OBI_CHROME,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean) as string[];
  return candidatos.find((c) => existsSync(c));
}

/** Renderizador con un Chrome/Edge del sistema (línea de comandos, pruebas y modo navegador). */
export function renderizadorChrome(): Renderizador {
  return async (url) => {
    const ejecutable = buscarNavegador();
    if (!ejecutable) throw new Error('Para crear el PDF fuera de la app de escritorio hace falta Chrome o Edge instalado (o la variable OBI_CHROME).');
    const { chromium } = await import('playwright-core');
    const navegador = await chromium.launch({ executablePath: ejecutable, args: ['--no-sandbox', '--font-render-hinting=none'] });
    try {
      const pagina = await navegador.newPage();
      await pagina.goto(url);
      await pagina.waitForSelector('[data-vivliostyle-viewer-status="complete"]', { timeout: 300_000 });
      await pagina.evaluate(() => document.fonts.ready);
      const pdf = await pagina.pdf({ preferCSSPageSize: true, printBackground: true, tagged: true, outline: true });
      return new Uint8Array(pdf);
    } finally {
      await navegador.close();
    }
  };
}

export async function contarPaginas(pdf: Uint8Array): Promise<number> {
  return (await PDFDocument.load(pdf, { updateMetadata: false })).getPageCount();
}

export interface ResultadoPdf {
  datos: Uint8Array;
  paginas: number;
  interior: number;
  ancho: number;
  alto: number;
}

/** Metadatos y cajas de impresión. */
export async function posprocesar(pdf: Uint8Array, libro: Libro, tipo: TipoPdf): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdf);
  const m = libro.metadatos;
  doc.setTitle(m.titulo, { showInWindowTitleBar: true });
  const autores = m.creditos.filter((c) => c.rol === 'aut').map((c) => c.nombre);
  if (autores.length) doc.setAuthor(autores.join(', '));
  if (m.descripcion) doc.setSubject(m.descripcion.slice(0, 500));
  doc.setCreator('Obi Studio EPUB');
  doc.setProducer('Obi Studio EPUB (Vivliostyle + Chromium + pdf-lib)');
  doc.setLanguage(m.idioma || 'es');
  doc.setCreationDate(new Date());
  doc.setModificationDate(new Date());

  const a = ajustesImpresion(libro);
  const b = tipo === 'impresion' ? sangradoMm(a) * PT_POR_MM : 0;
  const anchoExacto = a.ancho * PT_POR_MM + 2 * b;
  const altoExacto = a.alto * PT_POR_MM + 2 * b;
  doc.getPages().forEach((p, k) => {
    // Chromium redondea el tamaño de página hacia arriba (≈1 pt): se recorta el sobrante (derecha y abajo)
    // para que el PDF mida exactamente lo que pide la imprenta.
    const { width: w, height: h } = p.getSize();
    const dx = w - anchoExacto;
    const dy = h - altoExacto;
    const y0 = dy > 0 && dy < 4 ? dy : 0;
    const W = dx > 0 && dx < 4 ? anchoExacto : w;
    const H = dy > 0 && dy < 4 ? altoExacto : h;
    if (tipo === 'impresion' && a.sangrado === 'kdp' && b > 0) {
      // KDP: sangrado solo arriba, abajo y en el borde exterior. Página impar (derecha): el interior es la izquierda.
      const derecha = k % 2 === 0;
      const x = derecha ? b : 0;
      p.setMediaBox(x, y0, W - b, H);
      p.setCropBox(x, y0, W - b, H);
      p.setBleedBox(x, y0, W - b, H);
      // El corte queda donde estaba: a b del borde original en ambos casos.
      p.setTrimBox(b, y0 + b, W - 2 * b, H - 2 * b);
    } else {
      p.setMediaBox(0, y0, W, H);
      p.setCropBox(0, y0, W, H);
      if (tipo === 'impresion') {
        p.setBleedBox(0, y0, W, H);
        p.setTrimBox(b, y0 + b, W - 2 * b, H - 2 * b);
      }
    }
  });
  if (tipo === 'digital') {
    doc.catalog.set(PDFName.of('PageLayout'), PDFName.of('OneColumn'));
    doc.catalog.set(PDFName.of('ViewerPreferences'), doc.context.obj({ DisplayDocTitle: true }));
  }
  return doc.save({ useObjectStreams: true });
}

/**
 * Genera el PDF. Si el margen interior es automático, compagina una vez, cuenta las páginas
 * y, si el tramo de KDP cambia, vuelve a compaginar con el margen correcto.
 */
export async function generarPdf(
  libro: Libro,
  tipo: TipoPdf,
  preparar: (interior: number) => Promise<string>,
  renderizar: Renderizador,
): Promise<ResultadoPdf> {
  const a = ajustesImpresion(libro);
  let interior = a.margenInterior > 0 ? a.margenInterior : margenInteriorAutomatico(200);
  let pdf = await renderizar(await preparar(interior));
  let paginas = await contarPaginas(pdf);
  if (a.margenInterior <= 0 && tipo === 'impresion') {
    const correcto = margenInteriorAutomatico(paginas);
    if (correcto !== interior) {
      interior = correcto;
      pdf = await renderizar(await preparar(interior));
      paginas = await contarPaginas(pdf);
    }
  }
  const datos = await posprocesar(pdf, libro, tipo);
  return { datos, paginas, interior, ancho: a.ancho, alto: a.alto };
}
