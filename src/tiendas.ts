// Perfiles por tienda: las reglas de cada una (fuentes oficiales, noviembre de 2026) y el EPUB ajustado.
//  - Kindle (KDP): portada de 1600 × 2560 px recomendada, mínimo 625 × 1000, proporción 1,6:1, máximo 10 000 px por lado.
//  - Apple Books: imágenes interiores de 5,6 millones de píxeles como máximo; portada de 1400 px en el lado corto o más;
//    com.apple.ibooks.display-options.xml para que respete las fuentes incrustadas.
//  - Kobo: imágenes de 3 MB o menos (recomendado); portada vertical.
//  - Google Play Books: EPUB 3.3 preferido, con la portada dentro; portada de 640 a 7200 px.
//  - IngramSpark (EPUB): imágenes de 3,2 millones de píxeles como máximo, sin maquetación fija; portada de 1600 px en el lado corto.

import type { Libro, Recurso } from './model.js';
import { compilarArchivos, empaquetar } from './compilar.js';
import { fuentesTema } from './fuentes.js';
import { temaCompleto } from './model.js';
import { tamanoImagen } from './imagen.js';
import { reducir, sePuedeProcesar } from './procesar-imagen.js';

export { TIENDAS, tienda, type IdTienda, type Tienda } from './tiendas-lista.js';
import { tienda, type IdTienda } from './tiendas-lista.js';

export interface AvisoTienda {
  gravedad: 'error' | 'aviso' | 'info' | 'ok';
  /** Plantilla en español con {0}, {1}… (se traduce en la interfaz) y su texto ya armado. */
  plantilla: string;
  valores?: Record<string, string | number>;
  mensaje: string;
  seccion?: string;
}

function aviso(gravedad: AvisoTienda['gravedad'], plantilla: string, valores: (string | number)[] = [], seccion?: string): AvisoTienda {
  const v = Object.fromEntries(valores.map((x, k) => [String(k), x]));
  return { gravedad, plantilla, ...(valores.length ? { valores: v } : {}), mensaje: plantilla.replace(/\{(\d+)\}/g, (_m, k: string) => String(v[k])), ...(seccion ? { seccion } : {}) };
}

function medidas(r: Recurso): { ancho: number; alto: number } | undefined {
  return r.ancho && r.alto ? { ancho: r.ancho, alto: r.alto } : tamanoImagen(r.datos);
}

const MB = 1024 * 1024;

/** Revisa el libro con las reglas de la tienda. No modifica nada. */
export async function revisarTienda(libro: Libro, id: IdTienda): Promise<AvisoTienda[]> {
  const t = tienda(id);
  const avisos: AvisoTienda[] = [];
  const portada = libro.recursos.find((r) => r.id === libro.metadatos.portada);
  if (!portada) avisos.push(aviso('error', 'El libro no tiene portada: {0} la pide dentro del EPUB.', [t.nombre]));
  else {
    const m = medidas(portada);
    if (m) {
      const corto = Math.min(m.ancho, m.alto);
      const largo = Math.max(m.ancho, m.alto);
      if (corto < t.portada.minCorto || (t.portada.minLargo && largo < t.portada.minLargo))
        avisos.push(aviso('error', 'La portada mide {0} × {1} px: {2} pide al menos {3} px en el lado corto. Recomendado: {4}.', [m.ancho, m.alto, t.nombre, t.portada.minCorto, t.portada.recomendada]));
      else avisos.push(aviso('ok', 'Portada de {0} × {1} px (recomendado: {2}).', [m.ancho, m.alto, t.portada.recomendada]));
      if (t.portada.maxLado && largo > t.portada.maxLado) avisos.push(aviso('error', 'La portada supera los {0} px por lado que admite {1}.', [t.portada.maxLado, t.nombre]));
      if (m.ancho > m.alto) avisos.push(aviso('aviso', 'La portada es horizontal; las tiendas la muestran en vertical.'));
      else if (t.portada.proporcion && Math.abs(m.alto / m.ancho - t.portada.proporcion) > 0.12)
        avisos.push(aviso('info', 'La portada tiene proporción {0}:1; {1} recomienda {2}:1.', [(m.alto / m.ancho).toFixed(2), t.nombre, t.portada.proporcion]));
    }
  }
  const limites = t.imagenes;
  for (const r of libro.recursos) {
    if (r.id === libro.metadatos.portada && !limites.maxPixeles && !limites.maxBytes) continue;
    const m = medidas(r);
    const pixeles = m ? m.ancho * m.alto : 0;
    const grande = (limites.maxPixeles && pixeles > limites.maxPixeles) || (limites.maxBytes && r.datos.length > limites.maxBytes);
    if (!grande) continue;
    const seccion = libro.secciones.find((s) => s.imagenCabecera === r.id || s.bloques.some((b) => b.tipo === 'imagen' && b.recurso === r.id))?.id;
    if (sePuedeProcesar(r.tipoMime))
      avisos.push(aviso('info', '«{0}» supera el límite de {1}; se reducirá al exportar para esta tienda (la de impresión no cambia).', [r.nombre, t.nombre], seccion));
    else avisos.push(aviso('error', '«{0}» supera el límite de {1} y no se puede reducir automáticamente.', [r.nombre, t.nombre], seccion));
  }
  if (t.sinPaginaFija && libro.secciones.some((s) => s.paginaFija))
    avisos.push(aviso('aviso', '{0} no acepta maquetación fija: las páginas fijas saldrán como páginas normales.', [t.nombre]));
  if (!libro.metadatos.descripcion?.trim()) avisos.push(aviso('aviso', 'Falta la sinopsis (pestaña Libro): la tienda la pide al publicar.'));
  if (id === 'apple' && fuentesTema(temaCompleto(libro), false, libro).archivos.length)
    avisos.push(aviso('info', 'Se añade el archivo de opciones de Apple Books para que use las fuentes incrustadas.'));
  if (id === 'kindle' && libro.escritura === 'vertical') avisos.push(aviso('ok', 'Kindle admite la escritura vertical japonesa.'));
  if (id === 'kobo') avisos.push(aviso('info', 'Kobo convierte el EPUB a su formato; si lo vendes por tu cuenta, el KEPUB (menú Más) da estadísticas y subrayado en los lectores Kobo.'));
  const tamano = (await compilarParaTienda(libro, id)).datos.length;
  if (t.maxEpubMb && tamano > t.maxEpubMb * MB) avisos.push(aviso('error', 'El EPUB pesa {0} MB; {1} admite hasta {2} MB.', [(tamano / MB).toFixed(1), t.nombre, t.maxEpubMb]));
  else avisos.push(aviso('ok', 'El EPUB para esta tienda pesa {0} MB.', [(tamano / MB).toFixed(1)]));
  return avisos;
}

/** Copia del libro ajustada a la tienda: imágenes reducidas y, si hace falta, sin páginas fijas. */
export async function libroParaTienda(libro: Libro, id: IdTienda): Promise<{ libro: Libro; cambios: string[] }> {
  const t = tienda(id);
  const cambios: string[] = [];
  const recursos: Recurso[] = [];
  for (const r of libro.recursos) {
    const n = await reducir(r, t.imagenes);
    if (n !== r) cambios.push(`${r.nombre}: ${r.ancho ?? '?'}×${r.alto ?? '?'} → ${n.ancho}×${n.alto}`);
    recursos.push(n);
  }
  const secciones = t.sinPaginaFija ? libro.secciones.map(({ paginaFija: _p, ...s }) => s) : libro.secciones;
  return { libro: { ...libro, recursos, secciones }, cambios };
}

const OPCIONES_APPLE = `<?xml version="1.0" encoding="UTF-8"?>
<display_options>
  <platform name="*">
    <option name="specified-fonts">true</option>
  </platform>
</display_options>
`;

export async function compilarParaTienda(libro: Libro, id: IdTienda): Promise<{ datos: Uint8Array; cambios: string[] }> {
  const ajustado = await libroParaTienda(libro, id);
  const extra = id === 'apple' && fuentesTema(temaCompleto(ajustado.libro), false, ajustado.libro).archivos.length ? { 'com.apple.ibooks.display-options.xml': OPCIONES_APPLE } : undefined;
  return { datos: await empaquetar(compilarArchivos(ajustado.libro), extra, ajustado.libro), cambios: ajustado.cambios };
}
