// Procesado de imágenes en JavaScript puro (jimp): reducir, girar y recortar. Sin binarios nativos,
// para que funcione igual en Windows, macOS y Linux. SVG y WebP no se procesan: se dejan como están.

import { Jimp } from 'jimp';
import type { Libro, Recurso } from './model.js';
import { tamanoImagen } from './imagen.js';

export class ErrorImagen extends Error {}

const PROCESABLES = new Set(['image/jpeg', 'image/png', 'image/gif']);

export function sePuedeProcesar(tipoMime: string): boolean {
  return PROCESABLES.has(tipoMime);
}

async function leer(datos: Uint8Array) {
  try {
    return await Jimp.read(Buffer.from(datos));
  } catch (e) {
    throw new ErrorImagen(`No se pudo leer la imagen: ${(e as Error).message}`);
  }
}

async function escribir(img: Awaited<ReturnType<typeof leer>>, tipoMime: string, calidad = 85): Promise<Uint8Array> {
  // GIF se guarda como PNG para no perder calidad al recomprimir.
  const salida = tipoMime === 'image/jpeg' ? 'image/jpeg' : 'image/png';
  const b = salida === 'image/jpeg' ? await img.getBuffer('image/jpeg', { quality: calidad }) : await img.getBuffer('image/png');
  return new Uint8Array(b);
}

export interface Limites {
  /** Píxeles totales (ancho × alto) como máximo. */
  maxPixeles?: number;
  /** Lado más largo como máximo. */
  maxLado?: number;
  /** Tamaño del archivo como máximo, en bytes (se baja la calidad JPEG si hace falta). */
  maxBytes?: number;
}

/** Escala para cumplir los límites (1 si ya los cumple). */
export function escalaPara(ancho: number, alto: number, l: Limites): number {
  let e = 1;
  if (l.maxPixeles && ancho * alto > l.maxPixeles) e = Math.min(e, Math.sqrt(l.maxPixeles / (ancho * alto)));
  if (l.maxLado && Math.max(ancho, alto) > l.maxLado) e = Math.min(e, l.maxLado / Math.max(ancho, alto));
  return e;
}

/**
 * Devuelve el recurso reducido para cumplir los límites, o el mismo si ya los cumple o no se puede procesar.
 * Mantiene el id y el nombre (cambia la extensión si un GIF pasa a PNG).
 */
export async function reducir(r: Recurso, l: Limites): Promise<Recurso> {
  if (!sePuedeProcesar(r.tipoMime)) return r;
  const t = r.ancho && r.alto ? { ancho: r.ancho, alto: r.alto } : tamanoImagen(r.datos);
  if (!t) return r;
  const escala = escalaPara(t.ancho, t.alto, l);
  const pesada = l.maxBytes !== undefined && r.datos.length > l.maxBytes;
  if (escala >= 1 && !pesada) return r;
  const img = await leer(r.datos);
  // El margen de 0,995 evita quedar un píxel por encima del límite al redondear.
  if (escala < 1) img.resize({ w: Math.max(1, Math.floor(t.ancho * escala * 0.995)), h: Math.max(1, Math.floor(t.alto * escala * 0.995)) });
  let calidad = 85;
  let datos = await escribir(img, r.tipoMime, calidad);
  while (l.maxBytes && datos.length > l.maxBytes && r.tipoMime === 'image/jpeg' && calidad > 50) {
    calidad -= 10;
    datos = await escribir(img, r.tipoMime, calidad);
  }
  if (l.maxBytes && datos.length > l.maxBytes) {
    // Si aún pesa demasiado, se reduce el tamaño un 20 % cada vez.
    for (let k = 0; k < 6 && datos.length > l.maxBytes; k++) {
      img.resize({ w: Math.max(1, Math.floor(img.width * 0.8)) });
      datos = await escribir(img, r.tipoMime, calidad);
    }
  }
  const tipoMime = r.tipoMime === 'image/gif' ? 'image/png' : r.tipoMime;
  const nombre = r.tipoMime === 'image/gif' ? r.nombre.replace(/\.gif$/i, '.png') : r.nombre;
  return { ...r, nombre, tipoMime, datos, ancho: img.width, alto: img.height };
}

/** Gira 90, 180 o 270 grados en el sentido de las agujas del reloj. */
export async function girar(r: Recurso, grados: 90 | 180 | 270): Promise<Recurso> {
  if (!sePuedeProcesar(r.tipoMime)) throw new ErrorImagen('Esta imagen no se puede girar (solo JPEG, PNG y GIF).');
  const img = await leer(r.datos);
  // jimp gira en sentido contrario a las agujas del reloj.
  img.rotate(-grados);
  return { ...r, tipoMime: r.tipoMime === 'image/gif' ? 'image/png' : r.tipoMime, nombre: r.nombre.replace(/\.gif$/i, '.png'), datos: await escribir(img, r.tipoMime, 92), ancho: img.width, alto: img.height };
}

/** Recorta el rectángulo indicado en fracciones (0–1) del ancho y el alto. */
export async function recortar(r: Recurso, x: number, y: number, ancho: number, alto: number): Promise<Recurso> {
  if (!sePuedeProcesar(r.tipoMime)) throw new ErrorImagen('Esta imagen no se puede recortar (solo JPEG, PNG y GIF).');
  const ok = (v: number) => Number.isFinite(v) && v >= 0 && v <= 1;
  if (![x, y, ancho, alto].every(ok) || ancho <= 0 || alto <= 0 || x + ancho > 1.0001 || y + alto > 1.0001) throw new ErrorImagen('El recorte está fuera de la imagen.');
  const img = await leer(r.datos);
  const px = Math.round(x * img.width);
  const py = Math.round(y * img.height);
  const w = Math.max(1, Math.min(img.width - px, Math.round(ancho * img.width)));
  const h = Math.max(1, Math.min(img.height - py, Math.round(alto * img.height)));
  img.crop({ x: px, y: py, w, h });
  return { ...r, tipoMime: r.tipoMime === 'image/gif' ? 'image/png' : r.tipoMime, nombre: r.nombre.replace(/\.gif$/i, '.png'), datos: await escribir(img, r.tipoMime, 92), ancho: img.width, alto: img.height };
}

/** Límites del EPUB optimizado: de sobra para cualquier pantalla de lector y muy por debajo de lo que pesan los originales de imprenta. */
export const LIMITES_EPUB = { maxPixeles: 4_000_000, maxBytes: 1_500_000 };

function opaca(img: Awaited<ReturnType<typeof leer>>): boolean {
  const d = img.bitmap.data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 255) return false;
  return true;
}

/**
 * Versión ligera de una imagen para el EPUB: como mucho 4 Mpx y, si un PNG no tiene transparencia
 * y pesa más de 500 KB, se pasa a JPEG. Devuelve el mismo recurso si no se gana nada.
 * `renombrar` = false impide cambiar la extensión (la imagen se cita por nombre en un bloque XHTML).
 */
export async function optimizar(r: Recurso, renombrar = true): Promise<Recurso> {
  if (!sePuedeProcesar(r.tipoMime)) return r;
  let img;
  try {
    img = await leer(r.datos);
  } catch {
    return r;
  }
  const escala = escalaPara(img.width, img.height, LIMITES_EPUB);
  if (escala < 1) img.resize({ w: Math.max(1, Math.floor(img.width * escala * 0.995)), h: Math.max(1, Math.floor(img.height * escala * 0.995)) });
  const aJpeg = renombrar && r.tipoMime !== 'image/jpeg' && r.datos.length > 500_000 && opaca(img);
  const tipoMime = aJpeg ? 'image/jpeg' : r.tipoMime === 'image/gif' ? (renombrar ? 'image/png' : 'image/gif') : r.tipoMime;
  if (tipoMime === 'image/gif') return r; // un GIF citado por nombre se deja tal cual
  if (escala >= 1 && !aJpeg && r.datos.length <= LIMITES_EPUB.maxBytes) return r;
  let datos = await escribir(img, tipoMime, 85);
  for (let calidad = 75; tipoMime === 'image/jpeg' && datos.length > LIMITES_EPUB.maxBytes && calidad >= 55; calidad -= 10) datos = await escribir(img, tipoMime, calidad);
  if (datos.length >= r.datos.length) return r;
  const ext = tipoMime === 'image/jpeg' ? 'jpg' : 'png';
  const nombre = tipoMime === r.tipoMime ? r.nombre : r.nombre.replace(/\.[^.]+$/, '') + '.' + ext;
  return { ...r, nombre, tipoMime, datos, ancho: img.width, alto: img.height };
}

/** Copia del libro con las imágenes optimizadas para el EPUB y los bytes que se ahorran. */
export async function libroConImagenesOptimizadas(libro: Libro): Promise<{ libro: Libro; ahorro: number }> {
  const citadas = new Set<string>();
  for (const s of libro.secciones) for (const b of s.bloques) if (b.tipo === 'crudo') for (const r of libro.recursos) if (b.xhtml.includes(r.nombre)) citadas.add(r.id);
  let ahorro = 0;
  const nombres = new Set(libro.recursos.map((r) => r.nombre));
  const recursos: Recurso[] = [];
  for (const r of libro.recursos) {
    let n = await optimizar(r, !citadas.has(r.id));
    if (n.nombre !== r.nombre && nombres.has(n.nombre)) n = { ...n, nombre: n.nombre.replace(/\.(\w+)$/, `-${r.id}.$1`) };
    nombres.add(n.nombre);
    ahorro += r.datos.length - n.datos.length;
    recursos.push(n);
  }
  return { libro: { ...libro, recursos }, ahorro };
}

/** La imagen en escala de grises (para imprimir en blanco y negro). */
export async function aGrises(r: Recurso): Promise<Recurso> {
  if (!sePuedeProcesar(r.tipoMime)) return r;
  const img = await leer(r.datos);
  img.greyscale();
  return { ...r, tipoMime: r.tipoMime === 'image/gif' ? 'image/png' : r.tipoMime, nombre: r.nombre.replace(/\.gif$/i, '.png'), datos: await escribir(img, r.tipoMime, 92) };
}
