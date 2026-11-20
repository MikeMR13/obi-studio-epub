// Revisión previa del PDF de impresión: lo que suele hacer que una imprenta rechace el archivo.

import type { Libro, Recurso } from './model.js';
import { ajustesImpresion, temaCompleto } from './model.js';
import { MM_POR_PULGADA, sangradoMm, margenInteriorAutomatico } from './impresion.js';

export interface AvisoImpresion {
  gravedad: 'error' | 'aviso' | 'info';
  mensaje: string;
  seccion?: string;
  /** Plantilla del mensaje (en español, con {0}, {1}…) y sus valores, para traducirlo en la interfaz. */
  plantilla?: string;
  valores?: Record<string, string | number>;
}

/** «1, 3–5, 9» */
export function rangosPaginas(paginas: number[]): string {
  const partes: string[] = [];
  for (let i = 0; i < paginas.length; ) {
    let j = i;
    while (j + 1 < paginas.length && paginas[j + 1] === paginas[j] + 1) j++;
    partes.push(j > i ? `${paginas[i]}–${paginas[j]}` : String(paginas[i]));
    i = j + 1;
  }
  return partes.join(', ');
}

function aviso(gravedad: AvisoImpresion['gravedad'], plantilla: string, valores: (string | number)[] = [], seccion?: string): AvisoImpresion {
  const v = Object.fromEntries(valores.map((x, k) => [String(k), x]));
  const mensaje = plantilla.replace(/\{(\d+)\}/g, (_m, k: string) => String(v[k]));
  return { gravedad, mensaje, plantilla, ...(valores.length ? { valores: v } : {}), ...(seccion ? { seccion } : {}) };
}

/** Resolución efectiva (ppp) de una imagen mostrada dentro de una caja de ancho×alto mm, sin deformar. */
export function resolucionEfectiva(r: Recurso, anchoMm: number, altoMm: number, cubrir = false): number | undefined {
  if (!r.ancho || !r.alto || r.tipoMime === 'image/svg+xml') return undefined;
  const escalaAncho = anchoMm / r.ancho;
  const escalaAlto = altoMm / r.alto;
  const mmPorPixel = cubrir ? Math.max(escalaAncho, escalaAlto) : Math.min(escalaAncho, escalaAlto);
  return Math.round(MM_POR_PULGADA / mmPorPixel);
}

export function revisarImpresion(libro: Libro, paginas?: number, paginasColor?: number[]): AvisoImpresion[] {
  const a = ajustesImpresion(libro);
  const avisos: AvisoImpresion[] = [];
  const b = sangradoMm(a);
  const interior = a.margenInterior > 0 ? a.margenInterior : margenInteriorAutomatico(paginas ?? 200);
  const anchoTexto = a.ancho - interior - a.margenExterior;
  const altoTexto = a.alto - a.margenSuperior - a.margenInferior;

  if (anchoTexto < 70) avisos.push(aviso('error', 'La caja de texto mide solo {0} mm de ancho: reduce los márgenes o usa un tamaño mayor.', [anchoTexto.toFixed(0)]));
  if (a.margenExterior < 6.35 + (b ? 3.175 : 0)) {
    avisos.push(aviso('aviso', 'Margen exterior de {0} mm: KDP pide al menos {1} mm.', [a.margenExterior, b ? 9.5 : 6.35]));
  }
  if (a.margenSuperior < 6.35 || a.margenInferior < 6.35) avisos.push(aviso('aviso', 'Los márgenes superior e inferior deberían medir al menos 6,35 mm.'));
  if (a.margenInterior > 0 && paginas && a.margenInterior < margenInteriorAutomatico(paginas)) {
    avisos.push(
      aviso('aviso', 'Con {0} páginas el margen interior debería medir al menos {1} mm (ahora {2} mm). Déjalo en automático.', [
        paginas,
        margenInteriorAutomatico(paginas).toFixed(1),
        a.margenInterior,
      ]),
    );
  }
  if (paginas !== undefined) {
    if (paginas < 24) avisos.push(aviso('aviso', 'El libro tiene {0} páginas; KDP Print e IngramSpark piden un mínimo de 24.', [paginas]));
    if (paginas > 828) avisos.push(aviso('aviso', 'El libro tiene {0} páginas; KDP Print admite como máximo 828 en este formato.', [paginas]));
  }
  if (a.cuerpo < 9) avisos.push(aviso('aviso', 'Letra de {0} pt: por debajo de 9 pt cuesta leer en papel.', [a.cuerpo]));
  if (a.marcasCorte) avisos.push(aviso('info', 'Las marcas de corte son para imprentas tradicionales: KDP Print e IngramSpark rechazan los PDF que las llevan.'));
  if (paginasColor?.length) {
    avisos.push(
      aviso('info', 'Páginas a color en el último PDF: {0} ({1} de {2}). La imprenta cobra el color aparte; si el libro va en blanco y negro, marca «Imágenes en escala de grises».', [
        rangosPaginas(paginasColor),
        paginasColor.length,
        paginas ?? '?',
      ]),
    );
    const t = temaCompleto(libro);
    const gris = (c: string) => {
      const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c.trim());
      if (!m) return true;
      const v = m.slice(1).map((x) => parseInt(x, 16));
      return Math.max(...v) - Math.min(...v) <= 20;
    };
    if (!gris(t.colorTitulos) || !gris(t.colorAcento)) {
      avisos.push(aviso('info', 'El tema usa color en los títulos o los adornos, así que esas páginas también cuentan como de color. Para blanco y negro, elige colores grises en Tema.'));
    }
  }
  if (a.ilustracionesASangre && !b) avisos.push(aviso('info', 'Las ilustraciones a sangre solo se aplican si eliges un sangrado.'));

  for (const s of libro.secciones) {
    const esPagina = s.tipo === 'ilustracion' || (s.tipo === 'portada' && a.incluirPortada);
    if (s.tipo === 'portada' && !a.incluirPortada) continue;
    const ids = s.bloques.filter((x) => x.tipo === 'imagen').map((x) => (x.tipo === 'imagen' ? x.recurso : ''));
    if (s.tipo === 'portada' && !ids.length && libro.metadatos.portada) ids.push(libro.metadatos.portada);
    for (const id of ids) {
      const r = libro.recursos.find((x) => x.id === id);
      if (!r) continue;
      const cubrir = esPagina && a.ilustracionesASangre && b > 0;
      const caja = esPagina ? (cubrir ? [a.ancho + 2 * b, a.alto + 2 * b] : [a.ancho, a.alto]) : [anchoTexto, altoTexto * 0.9];
      const ppp = resolucionEfectiva(r, caja[0], caja[1], cubrir);
      if (ppp !== undefined && ppp < 300) {
        const necesario = Math.ceil((caja[0] / MM_POR_PULGADA) * 300);
        avisos.push(
          aviso(
            ppp < 150 ? 'error' : 'aviso',
            esPagina
              ? '«{0}» se imprimirá a {1} ppp (se recomiendan 300). Para una página completa hacen falta unos {2} px de ancho; ahora tiene {3}.'
              : '«{0}» se imprimirá a {1} ppp (se recomiendan 300). Para el ancho del texto hacen falta unos {2} px de ancho; ahora tiene {3}.',
            [r.nombre, ppp, necesario, r.ancho ?? 0],
            s.id,
          ),
        );
      }
      if (esPagina && r.ancho && r.alto) {
        const proporcionImagen = r.ancho / r.alto;
        const proporcionPagina = a.ancho / a.alto;
        const diferencia = Math.abs(proporcionImagen - proporcionPagina) / proporcionPagina;
        if (diferencia > 0.08) {
          avisos.push(
            aviso(
              'info',
              cubrir
                ? '«{0}» no tiene la proporción de la página: se recortarán los bordes.'
                : r.ancho > r.alto
                  ? '«{0}» no tiene la proporción de la página: quedarán bandas blancas (es horizontal).'
                  : '«{0}» no tiene la proporción de la página: quedarán bandas blancas.',
              [r.nombre],
              s.id,
            ),
          );
        }
      }
    }
    if (s.bloques.some((x) => x.tipo === 'crudo')) {
      avisos.push(aviso('info', '«{0}» tiene bloques XHTML (tablas, SVG…): revísalos en la vista de impresión.', [s.titulo || s.tipo], s.id));
    }
  }
  return avisos;
}
