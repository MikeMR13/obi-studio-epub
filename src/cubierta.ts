// Cubierta de imprenta: contraportada, lomo y portada en un solo PDF, con el ancho de lomo según
// el número de páginas y el papel. Se compagina con el mismo Vivliostyle que el interior, así que usa
// las mismas fuentes (incluidas las propias) y las mismas imágenes del libro.

import { PDFDocument } from 'pdf-lib';
import type { Cubierta, Libro, Recurso } from './model.js';
import { ROLES, ajustesImpresion, esVertical, temaCompleto } from './model.js';
import { caraFuente, fuentesTema } from './fuentes.js';
import { esc, escAttr } from './xml.js';

export const MM_POR_PULGADA = 25.4;
const PT_POR_MM = 72 / MM_POR_PULGADA;

/** Grosor por página de KDP (pulgadas), de su guía de cubiertas de tapa blanda. */
export const PAPELES_KDP: { id: Cubierta['papel']; nombre: string; pulgadas: number }[] = [
  { id: 'blanco', nombre: 'Blanco (tinta negra o color estándar)', pulgadas: 0.002252 },
  { id: 'crema', nombre: 'Crema', pulgadas: 0.0025 },
  { id: 'color-premium', nombre: 'Color prémium', pulgadas: 0.002347 },
];

export const CUBIERTA_PREDETERMINADA: Cubierta = {
  imprenta: 'kdp',
  papel: 'crema',
  colorFondo: '#1d2433',
  colorTexto: '#ffffff',
  codigoBarras: true,
};

export function cubiertaCompleta(libro: Pick<Libro, 'cubierta'>): Cubierta {
  return { ...CUBIERTA_PREDETERMINADA, ...(libro.cubierta ?? {}) };
}

export interface MedidasCubierta {
  /** Todo en milímetros. */
  sangrado: number;
  anchoPanel: number;
  alto: number;
  lomo: number;
  anchoTotal: number;
  altoTotal: number;
  paginas: number;
  /** KDP solo imprime texto en el lomo de los libros de más de 79 páginas. */
  textoLomo: boolean;
  /** Lomo calculado (KDP) o escrito a mano (el de la plantilla de IngramSpark u otra imprenta). */
  origenLomo: 'kdp' | 'manual';
  /** Contraportada a la derecha del lomo (libros de derecha a izquierda). */
  derechaAIzquierda: boolean;
}

export function medidasCubierta(libro: Libro, paginas: number): MedidasCubierta {
  const a = ajustesImpresion(libro);
  const c = cubiertaCompleta(libro);
  const sangrado = 0.125 * MM_POR_PULGADA;
  const papel = PAPELES_KDP.find((p) => p.id === c.papel) ?? PAPELES_KDP[0];
  const manual = c.imprenta !== 'kdp' && c.lomoManual && c.lomoManual > 0;
  const lomo = manual ? c.lomoManual! : Math.round(paginas * papel.pulgadas * MM_POR_PULGADA * 100) / 100;
  return {
    sangrado,
    anchoPanel: a.ancho,
    alto: a.alto,
    lomo,
    anchoTotal: Math.round((2 * sangrado + 2 * a.ancho + lomo) * 100) / 100,
    altoTotal: Math.round((2 * sangrado + a.alto) * 100) / 100,
    paginas,
    textoLomo: paginas > 79,
    origenLomo: manual ? 'manual' : 'kdp',
    derechaAIzquierda: esVertical(libro),
  };
}

/** Zona del código de barras (KDP): 2 × 1,2 pulgadas, a 0,25 pulgadas del lomo y del corte, abajo a la derecha de la contraportada. */
export const CODIGO_BARRAS = { ancho: 2 * MM_POR_PULGADA, alto: 1.2 * MM_POR_PULGADA, margen: 0.25 * MM_POR_PULGADA };

export interface AvisoCubierta {
  gravedad: 'error' | 'aviso' | 'info';
  plantilla: string;
  valores?: Record<string, string | number>;
}

/** Píxeles que necesita una imagen para cubrir un panel a 300 ppp. */
function pixeles(mm: number): number {
  return Math.ceil((mm / MM_POR_PULGADA) * 300);
}

export function revisarCubierta(libro: Libro, paginas?: number): AvisoCubierta[] {
  const avisos: AvisoCubierta[] = [];
  const c = cubiertaCompleta(libro);
  if (!paginas) {
    avisos.push({ gravedad: 'error', plantilla: 'Indica el número de páginas del interior (crea antes el PDF de imprenta para saberlo).' });
    return avisos;
  }
  const m = medidasCubierta(libro, paginas);
  if (c.imprenta !== 'kdp' && !(c.lomoManual && c.lomoManual > 0)) {
    avisos.push({ gravedad: 'error', plantilla: 'Escribe el ancho del lomo que da la plantilla de tu imprenta (IngramSpark no publica una fórmula por página).' });
  }
  if (paginas < 24) avisos.push({ gravedad: 'aviso', plantilla: 'Con {0} páginas el libro no llega al mínimo de 24 de KDP e IngramSpark.', valores: { 0: paginas } });
  if (!m.textoLomo) avisos.push({ gravedad: 'info', plantilla: 'Con {0} páginas el lomo queda sin texto: KDP solo lo imprime en libros de más de 79 páginas.', valores: { 0: paginas } });
  const portada = libro.recursos.find((r) => r.id === (c.portada ?? libro.metadatos.portada));
  const ancho = pixeles(m.anchoPanel + m.sangrado);
  const alto = pixeles(m.altoTotal);
  if (!portada) avisos.push({ gravedad: 'error', plantilla: 'El libro no tiene imagen de portada.' });
  else if ((portada.ancho ?? 0) < ancho * 0.95 || (portada.alto ?? 0) < alto * 0.95) {
    avisos.push({ gravedad: 'aviso', plantilla: 'La portada mide {0}×{1} px; para imprimirla a 300 ppp hacen falta {2}×{3} px.', valores: { 0: portada.ancho ?? '?', 1: portada.alto ?? '?', 2: ancho, 3: alto } });
  }
  const contra = c.contraportada ? libro.recursos.find((r) => r.id === c.contraportada) : undefined;
  if (contra && ((contra.ancho ?? 0) < ancho * 0.95 || (contra.alto ?? 0) < alto * 0.95)) {
    avisos.push({ gravedad: 'aviso', plantilla: 'La imagen de contraportada mide {0}×{1} px; para imprimirla a 300 ppp hacen falta {2}×{3} px.', valores: { 0: contra.ancho ?? '?', 1: contra.alto ?? '?', 2: ancho, 3: alto } });
  }
  avisos.push({
    gravedad: 'info',
    plantilla: 'Cubierta de {0} × {1} mm con un lomo de {2} mm ({3} páginas).',
    valores: { 0: m.anchoTotal.toFixed(2), 1: m.altoTotal.toFixed(2), 2: m.lomo.toFixed(2), 3: paginas },
  });
  return avisos;
}

const mm = (v: number) => `${Math.round(v * 1000) / 1000}mm`;

/** HTML de una sola página con la cubierta completa (contraportada, lomo y portada). */
export function htmlCubierta(libro: Libro, paginas: number): string {
  const m = medidasCubierta(libro, paginas);
  const c = cubiertaCompleta(libro);
  const t = temaCompleto(libro);
  const fuentes = fuentesTema(t, true, libro);
  const caras = fuentes.archivos.map((x) => caraFuente(x, 'fuentes/')).join('\n');
  const md = libro.metadatos;
  const autores = md.creditos.filter((x) => x.rol === 'aut').map((x) => x.nombre);
  const recurso = (id?: string): Recurso | undefined => (id ? libro.recursos.find((r) => r.id === id) : undefined);
  const portada = recurso(c.portada ?? md.portada);
  const contra = recurso(c.contraportada);
  const textoContra = (c.textoContraportada ?? md.descripcion ?? '').trim();
  const creditos = md.creditos.filter((x) => x.rol !== 'aut' && x.nombre.trim());
  const seguro = 0.25 * MM_POR_PULGADA;
  // Posiciones horizontales (desde la izquierda del archivo, con sangrado).
  const izquierdaEsContra = !m.derechaAIzquierda;
  const xContra = izquierdaEsContra ? 0 : m.sangrado + m.anchoPanel + m.lomo;
  const xLomo = m.sangrado + m.anchoPanel;
  const xPortada = izquierdaEsContra ? m.sangrado + m.anchoPanel + m.lomo : 0;
  const anchoLado = m.sangrado + m.anchoPanel;
  const barras = c.codigoBarras
    ? (() => {
        // Abajo a la derecha de la contraportada: a 0,25 pulgadas del corte y (si está a la derecha) del lomo.
        const derechaContra = izquierdaEsContra ? xLomo : xContra + anchoLado - m.sangrado;
        const x = derechaContra - CODIGO_BARRAS.margen - CODIGO_BARRAS.ancho;
        const y = m.altoTotal - m.sangrado - CODIGO_BARRAS.margen - CODIGO_BARRAS.alto;
        return `<div class="codigo-barras" style="left:${mm(x)};top:${mm(y)}"></div>`;
      })()
    : '';
  const imagen = (r: Recurso | undefined, x: number, clase: string) =>
    r ? `<img class="${clase}" src="img/${escAttr(r.nombre)}" alt="" style="left:${mm(x)};width:${mm(anchoLado)}"/>` : '';
  const lineasContra = textoContra
    .split(/\n+/)
    .map((p) => `<p>${esc(p)}</p>`)
    .join('');
  const nombreRol = (rol: string) => ROLES.find((r) => r.id === rol)?.nombre ?? rol;
  const lomo = m.textoLomo
    ? `<div class="lomo" style="left:${mm(xLomo)};width:${mm(m.lomo)}"><div class="texto-lomo"><span class="titulo-lomo">${esc(md.titulo)}</span>${autores.length ? `<span class="autor-lomo">${esc(autores.join(', '))}</span>` : ''}</div></div>`
    : '';
  const margenTexto = m.sangrado + seguro;
  return `<!DOCTYPE html>
<html lang="${escAttr(md.idioma || 'es')}">
<head>
<meta charset="utf-8"/>
<title>${esc(md.titulo)} — cubierta</title>
<style>
${caras}
@page { size: ${mm(m.anchoTotal)} ${mm(m.altoTotal)}; margin: 0; }
html, body { margin: 0; padding: 0; }
body { width: ${mm(m.anchoTotal)}; height: ${mm(m.altoTotal)}; position: relative; overflow: hidden; background: ${c.colorFondo}; color: ${c.colorTexto}; font-family: ${fuentes.familiaTexto}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
img.fondo { position: absolute; top: 0; height: ${mm(m.altoTotal)}; object-fit: cover; }
.contra { position: absolute; top: ${mm(margenTexto)}; left: ${mm(xContra + (izquierdaEsContra ? margenTexto : seguro))}; width: ${mm(anchoLado - margenTexto - seguro)}; height: ${mm(m.altoTotal - 2 * margenTexto - (c.codigoBarras ? CODIGO_BARRAS.alto + CODIGO_BARRAS.margen : 0))}; overflow: hidden; font-size: 10.5pt; line-height: 1.45; }
.contra p { margin: 0 0 0.7em; text-align: justify; hyphens: auto; }
.contra .creditos { margin-top: 1.2em; font-size: 9pt; opacity: 0.85; }
.lomo { position: absolute; top: 0; height: ${mm(m.altoTotal)}; display: flex; align-items: center; justify-content: center; }
.texto-lomo { writing-mode: vertical-rl; display: flex; align-items: center; justify-content: space-between; gap: 6mm; height: ${mm(m.altoTotal - 2 * margenTexto)}; max-width: ${mm(Math.max(1, m.lomo - 2 * 0.0625 * MM_POR_PULGADA))}; font-family: ${fuentes.familiaTitulos}; font-size: ${Math.min(14, Math.max(6, (m.lomo - 3) * 1.6)).toFixed(1)}pt; white-space: nowrap; overflow: hidden; }
.titulo-lomo { font-weight: bold; }
.codigo-barras { position: absolute; width: ${mm(CODIGO_BARRAS.ancho)}; height: ${mm(CODIGO_BARRAS.alto)}; background: #ffffff; }
</style>
</head>
<body>
${imagen(contra, xContra, 'fondo')}
${imagen(portada, xPortada, 'fondo')}
<div class="contra">${lineasContra}${creditos.length ? `<p class="creditos">${creditos.map((x) => `${esc(nombreRol(x.rol))}: ${esc(x.nombre)}`).join(' · ')}</p>` : ''}</div>
${lomo}
${barras}
</body>
</html>
`;
}

/** Archivos para compaginar la cubierta (libro.html, imágenes y fuentes propias). */
export function archivosCubierta(libro: Libro, paginas: number): Map<string, string | Uint8Array> {
  const archivos = new Map<string, string | Uint8Array>();
  archivos.set('libro.html', htmlCubierta(libro, paginas));
  for (const r of libro.recursos) archivos.set(`img/${r.nombre}`, r.datos);
  for (const a of fuentesTema(temaCompleto(libro), true, libro).archivos) if (a.datos) archivos.set(`fuentes/${a.archivo}`, a.datos);
  return archivos;
}

/** Ajusta el PDF de la cubierta al tamaño exacto y le pone los metadatos. */
export async function posprocesarCubierta(pdf: Uint8Array, libro: Libro, paginas: number): Promise<Uint8Array> {
  const m = medidasCubierta(libro, paginas);
  const doc = await PDFDocument.load(pdf);
  // Vivliostyle puede dejar una página en blanco detrás: la cubierta es una sola.
  while (doc.getPageCount() > 1) doc.removePage(doc.getPageCount() - 1);
  const p = doc.getPage(0);
  const W = m.anchoTotal * PT_POR_MM;
  const H = m.altoTotal * PT_POR_MM;
  const { height } = p.getSize();
  const y0 = Math.max(0, height - H);
  p.setMediaBox(0, y0, W, H);
  p.setCropBox(0, y0, W, H);
  p.setBleedBox(0, y0, W, H);
  p.setTrimBox(m.sangrado * PT_POR_MM, y0 + m.sangrado * PT_POR_MM, W - 2 * m.sangrado * PT_POR_MM, H - 2 * m.sangrado * PT_POR_MM);
  doc.setTitle(`${libro.metadatos.titulo} — cubierta`);
  doc.setCreator('Obi Studio EPUB');
  doc.setProducer('Obi Studio EPUB (Vivliostyle + Chromium + pdf-lib)');
  return doc.save();
}
