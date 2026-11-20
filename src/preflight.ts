// Revisión previa del PDF de impresión: lo que suele hacer que una imprenta rechace el archivo.

import type { Libro, Recurso } from './model.js';
import { ajustesImpresion } from './model.js';
import { MM_POR_PULGADA, sangradoMm, margenInteriorAutomatico } from './impresion.js';

export interface AvisoImpresion {
  gravedad: 'error' | 'aviso' | 'info';
  mensaje: string;
  seccion?: string;
}

/** Resolución efectiva (ppp) de una imagen mostrada dentro de una caja de ancho×alto mm, sin deformar. */
export function resolucionEfectiva(r: Recurso, anchoMm: number, altoMm: number, cubrir = false): number | undefined {
  if (!r.ancho || !r.alto || r.tipoMime === 'image/svg+xml') return undefined;
  const escalaAncho = anchoMm / r.ancho;
  const escalaAlto = altoMm / r.alto;
  const mmPorPixel = cubrir ? Math.max(escalaAncho, escalaAlto) : Math.min(escalaAncho, escalaAlto);
  return Math.round(MM_POR_PULGADA / mmPorPixel);
}

export function revisarImpresion(libro: Libro, paginas?: number): AvisoImpresion[] {
  const a = ajustesImpresion(libro);
  const avisos: AvisoImpresion[] = [];
  const b = sangradoMm(a);
  const interior = a.margenInterior > 0 ? a.margenInterior : margenInteriorAutomatico(paginas ?? 200);
  const anchoTexto = a.ancho - interior - a.margenExterior;
  const altoTexto = a.alto - a.margenSuperior - a.margenInferior;

  if (anchoTexto < 70) avisos.push({ gravedad: 'error', mensaje: `La caja de texto mide solo ${anchoTexto.toFixed(0)} mm de ancho: reduce los márgenes o usa un tamaño mayor.` });
  if (a.margenExterior < 6.35 + (b ? 3.175 : 0)) {
    avisos.push({ gravedad: 'aviso', mensaje: `Margen exterior de ${a.margenExterior} mm: KDP pide al menos ${b ? '9,5' : '6,35'} mm.` });
  }
  if (a.margenSuperior < 6.35 || a.margenInferior < 6.35) avisos.push({ gravedad: 'aviso', mensaje: 'Los márgenes superior e inferior deberían medir al menos 6,35 mm.' });
  if (a.margenInterior > 0 && paginas && a.margenInterior < margenInteriorAutomatico(paginas)) {
    avisos.push({
      gravedad: 'aviso',
      mensaje: `Con ${paginas} páginas el margen interior debería medir al menos ${margenInteriorAutomatico(paginas).toFixed(1)} mm (ahora ${a.margenInterior} mm). Déjalo en automático.`,
    });
  }
  if (paginas !== undefined) {
    if (paginas < 24) avisos.push({ gravedad: 'aviso', mensaje: `El libro tiene ${paginas} páginas; KDP Print e IngramSpark piden un mínimo de 24.` });
    if (paginas > 828) avisos.push({ gravedad: 'aviso', mensaje: `El libro tiene ${paginas} páginas; KDP Print admite como máximo 828 en este formato.` });
  }
  if (a.cuerpo < 9) avisos.push({ gravedad: 'aviso', mensaje: `Letra de ${a.cuerpo} pt: por debajo de 9 pt cuesta leer en papel.` });
  if (a.ilustracionesASangre && !b) avisos.push({ gravedad: 'info', mensaje: 'Las ilustraciones a sangre solo se aplican si eliges un sangrado.' });

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
        avisos.push({
          gravedad: ppp < 150 ? 'error' : 'aviso',
          seccion: s.id,
          mensaje: `«${r.nombre}» se imprimirá a ${ppp} ppp (se recomiendan 300). Para ${esPagina ? 'una página completa' : 'el ancho del texto'} hacen falta unos ${necesario} px de ancho; ahora tiene ${r.ancho}.`,
        });
      }
      if (esPagina && r.ancho && r.alto) {
        const proporcionImagen = r.ancho / r.alto;
        const proporcionPagina = a.ancho / a.alto;
        const diferencia = Math.abs(proporcionImagen - proporcionPagina) / proporcionPagina;
        if (diferencia > 0.08) {
          avisos.push({
            gravedad: 'info',
            seccion: s.id,
            mensaje: cubrir
              ? `«${r.nombre}» no tiene la proporción de la página: se recortarán los bordes.`
              : `«${r.nombre}» no tiene la proporción de la página: quedarán bandas blancas${r.ancho > r.alto ? ' (es horizontal)' : ''}.`,
          });
        }
      }
    }
    if (s.bloques.some((x) => x.tipo === 'crudo')) {
      avisos.push({ gravedad: 'info', seccion: s.id, mensaje: `«${s.titulo || s.tipo}» tiene bloques XHTML (tablas, SVG…): revísalos en la vista de impresión.` });
    }
  }
  return avisos;
}
